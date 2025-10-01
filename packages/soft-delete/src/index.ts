import type { Plugin, AnyQueryBuilder } from '@kysera/repository'
import type { SelectQueryBuilder, Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Configuration options for the soft delete plugin.
 *
 * @example
 * ```typescript
 * const plugin = softDeletePlugin({
 *   deletedAtColumn: 'deleted_at',
 *   includeDeleted: false,
 *   tables: ['users', 'posts'] // Only these tables support soft delete
 * })
 * ```
 */
export interface SoftDeleteOptions {
  /**
   * Column name for soft delete timestamp.
   *
   * @default 'deleted_at'
   */
  deletedAtColumn?: string

  /**
   * Include deleted records by default in queries.
   * When false, soft-deleted records are automatically filtered out.
   *
   * @default false
   */
  includeDeleted?: boolean

  /**
   * List of tables that support soft delete.
   * If not provided, all tables are assumed to support it.
   *
   * @example ['users', 'posts', 'comments']
   */
  tables?: string[]
}

interface BaseRepository {
  tableName: string
  executor: Kysely<Record<string, unknown>>
  findAll: () => Promise<unknown[]>
  findById: (id: number) => Promise<unknown>
  update: (id: number, data: Record<string, unknown>) => Promise<unknown>
}

/**
 * Soft Delete Plugin for Kysera ORM
 *
 * This plugin implements soft delete functionality using the Method Override pattern:
 * - Automatically filters out soft-deleted records from SELECT queries
 * - Adds softDelete(), restore(), and hardDelete() methods to repositories
 * - Provides findWithDeleted() and findDeleted() utility methods
 *
 * ## Usage
 *
 * ```typescript
 * import { softDeletePlugin } from '@kysera/soft-delete'
 * import { createORM } from '@kysera/repository'
 *
 * const orm = await createORM(db, [
 *   softDeletePlugin({
 *     deletedAtColumn: 'deleted_at',
 *     tables: ['users', 'posts']
 *   })
 * ])
 *
 * const userRepo = orm.createRepository(createUserRepository)
 *
 * // Soft delete a user (sets deleted_at)
 * await userRepo.softDelete(1)
 *
 * // Find all users (excludes soft-deleted)
 * await userRepo.findAll()
 *
 * // Find including deleted
 * await userRepo.findAllWithDeleted()
 *
 * // Restore a soft-deleted user
 * await userRepo.restore(1)
 *
 * // Permanently delete (real DELETE)
 * await userRepo.hardDelete(1)
 * ```
 *
 * ## Architecture Note
 *
 * This plugin uses Method Override, not full query interception:
 * - ✅ SELECT queries are automatically filtered
 * - ❌ DELETE queries are NOT automatically converted to soft deletes
 * - Use softDelete() method explicitly instead of delete()
 *
 * This design is intentional for simplicity and explicitness.
 *
 * @param options - Configuration options for soft delete behavior
 * @returns Plugin instance that can be used with createORM
 */
export const softDeletePlugin = (options: SoftDeleteOptions = {}): Plugin => {
  const {
    deletedAtColumn = 'deleted_at',
    includeDeleted = false,
    tables
  } = options

  return {
    name: '@kysera/soft-delete',
    version: '1.0.0',

    /**
     * Intercept queries to automatically filter soft-deleted records.
     *
     * NOTE: This plugin uses the Method Override pattern, not full query interception.
     * - SELECT queries are automatically filtered to exclude soft-deleted records
     * - DELETE operations are NOT automatically converted to soft deletes
     * - Use the softDelete() method instead of delete() to perform soft deletes
     * - Use hardDelete() method to bypass soft delete and perform a real DELETE
     *
     * This approach is simpler and more explicit than full query interception.
     */
    interceptQuery<QB extends AnyQueryBuilder>(qb: QB, context: { operation: string; table: string; metadata: Record<string, unknown> }): QB {
      // Check if table supports soft delete
      const supportsSoftDelete = !tables || tables.includes(context.table)

      // Only filter SELECT queries when not explicitly including deleted
      if (
        supportsSoftDelete &&
        context.operation === 'select' &&
        !context.metadata['includeDeleted'] &&
        !includeDeleted
      ) {
        // Add WHERE deleted_at IS NULL to the query builder
        type GenericSelectQueryBuilder = SelectQueryBuilder<
          Record<string, unknown>,
          string,
          Record<string, unknown>
        >
        return (qb as unknown as GenericSelectQueryBuilder)
          .where(`${context.table}.${deletedAtColumn}` as never, 'is', null) as QB
      }

      // Note: DELETE operations are NOT intercepted here
      // Use softDelete() method instead of delete() to perform soft deletes
      // This is by design - method override is simpler and more explicit

      return qb
    },

    /**
     * Extend repository with soft delete methods.
     *
     * Adds the following methods to repositories:
     * - softDelete(id): Marks record as deleted by setting deleted_at timestamp
     * - restore(id): Restores a soft-deleted record by setting deleted_at to null
     * - hardDelete(id): Permanently deletes a record (bypasses soft delete)
     * - findWithDeleted(id): Find a record including soft-deleted ones
     * - findAllWithDeleted(): Find all records including soft-deleted ones
     * - findDeleted(): Find only soft-deleted records
     *
     * Also overrides findAll() and findById() to automatically filter out
     * soft-deleted records (unless includeDeleted option is set).
     */
    extendRepository<T extends object>(repo: T): T {
      // Type assertion is safe here as we're checking for BaseRepository properties
      const baseRepo = repo as unknown as BaseRepository

      // Check if it's actually a repository (has required properties)
      if (!('tableName' in baseRepo) || !('executor' in baseRepo)) {
        return repo
      }

      // Check if table supports soft delete
      const supportsSoftDelete = !tables || tables.includes(baseRepo.tableName)

      // If table doesn't support soft delete, return unmodified repo
      if (!supportsSoftDelete) {
        return repo
      }

      // Wrap original methods to apply soft delete filtering
      const originalFindAll = baseRepo.findAll.bind(baseRepo)
      const originalFindById = baseRepo.findById.bind(baseRepo)

      const extendedRepo = {
        ...baseRepo,

        // Override base methods to filter soft-deleted records
        async findAll(): Promise<unknown[]> {
          if (!includeDeleted) {
            const result = await baseRepo.executor
              .selectFrom(baseRepo.tableName)
              .selectAll()
              .where(deletedAtColumn as never, 'is', null)
              .execute()
            return result as unknown[]
          }
          return await originalFindAll()
        },

        async findById(id: number): Promise<unknown> {
          if (!includeDeleted) {
            const result = await baseRepo.executor
              .selectFrom(baseRepo.tableName)
              .selectAll()
              .where('id' as never, '=', id as never)
              .where(deletedAtColumn as never, 'is', null)
              .executeTakeFirst()
            return result ?? null
          }
          return await originalFindById(id)
        },

        async softDelete(id: number): Promise<unknown> {
          // Use CURRENT_TIMESTAMP directly in SQL to avoid datetime format issues
          // This works across all databases (MySQL, PostgreSQL, SQLite)
          // We bypass repository.update() to avoid Zod validation issues with RawBuilder
          await baseRepo.executor
            .updateTable(baseRepo.tableName)
            .set({ [deletedAtColumn]: sql`CURRENT_TIMESTAMP` } as never)
            .where('id' as never, '=', id as never)
            .execute()

          // Fetch the updated record to verify it exists
          const record = await originalFindById(id)

          // If record not found or deleted_at not set, throw error
          if (!record) {
            throw new Error(`Record with id ${id} not found`)
          }

          return record
        },

        async restore(id: number): Promise<unknown> {
          return await baseRepo.update(id, { [deletedAtColumn]: null })
        },

        async hardDelete(id: number): Promise<void> {
          // Direct hard delete - bypass soft delete
          await baseRepo.executor
            .deleteFrom(baseRepo.tableName)
            .where('id' as never, '=', id as never)
            .execute()
        },

        async findWithDeleted(id: number): Promise<unknown> {
          // Use original method without filtering
          return await originalFindById(id)
        },

        async findAllWithDeleted(): Promise<unknown[]> {
          // Use original method without filtering
          return await originalFindAll()
        },

        async findDeleted(): Promise<unknown[]> {
          const result = await baseRepo.executor
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(deletedAtColumn as never, 'is not', null)
            .execute()
          return result as unknown[]
        }
      }

      return extendedRepo as T
    }
  }
}