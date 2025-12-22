import type { Plugin, QueryBuilderContext } from '@kysera/executor';
import { getRawDb } from '@kysera/executor';
import type { SelectQueryBuilder, Kysely } from 'kysely';
import { sql } from 'kysely';
import { NotFoundError, silentLogger } from '@kysera/core';
import type { KyseraLogger } from '@kysera/core';
import { z } from 'zod';
import { VERSION } from './version.js';

/**
 * Configuration options for the soft delete plugin.
 *
 * @example
 * ```typescript
 * const plugin = softDeletePlugin({
 *   deletedAtColumn: 'deleted_at',
 *   includeDeleted: false,
 *   tables: ['users', 'posts'], // Only these tables support soft delete
 *   primaryKeyColumn: 'id' // Default primary key column
 * })
 * ```
 */
export interface SoftDeleteOptions {
  /**
   * Column name for soft delete timestamp.
   *
   * @default 'deleted_at'
   */
  deletedAtColumn?: string;

  /**
   * Include deleted records by default in queries.
   * When false, soft-deleted records are automatically filtered out.
   *
   * @default false
   */
  includeDeleted?: boolean;

  /**
   * List of tables that support soft delete.
   * If not provided, all tables are assumed to support it.
   *
   * @example ['users', 'posts', 'comments']
   */
  tables?: string[];

  /**
   * Primary key column name used for identifying records.
   * Tables with different primary key names (uuid, user_id, etc.) can be configured.
   *
   * @default 'id'
   * @example 'uuid', 'user_id', 'post_id'
   */
  primaryKeyColumn?: string;

  /**
   * Logger for plugin operations.
   * Uses KyseraLogger interface from @kysera/core.
   *
   * @default silentLogger (no output)
   */
  logger?: KyseraLogger;
}

/**
 * Zod schema for SoftDeleteOptions
 * Used for validation and configuration in the kysera-cli
 */
export const SoftDeleteOptionsSchema = z.object({
  deletedAtColumn: z.string().optional(),
  includeDeleted: z.boolean().optional(),
  tables: z.array(z.string()).optional(),
  primaryKeyColumn: z.string().optional(),
});

/**
 * Methods added to repositories by the soft delete plugin
 */
export interface SoftDeleteMethods<T> {
  softDelete(id: number | string): Promise<T>;
  restore(id: number | string): Promise<T>;
  hardDelete(id: number | string): Promise<void>;
  findWithDeleted(id: number | string): Promise<T | null>;
  findAllWithDeleted(): Promise<T[]>;
  findDeleted(): Promise<T[]>;
  softDeleteMany(ids: (number | string)[]): Promise<T[]>;
  restoreMany(ids: (number | string)[]): Promise<T[]>;
  hardDeleteMany(ids: (number | string)[]): Promise<void>;
}

/**
 * Repository extended with soft delete methods
 * Note: Repository type is from @kysera/repository
 */
export type SoftDeleteRepository<Entity> = any & SoftDeleteMethods<Entity>;

interface BaseRepository {
  tableName: string;
  executor: Kysely<Record<string, unknown>>;
  findAll: () => Promise<unknown[]>;
  findById: (id: number) => Promise<unknown>;
  update: (id: number, data: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Soft Delete Plugin for Kysera
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
 * ## Transaction Behavior
 *
 * **IMPORTANT**: Soft delete operations respect ACID properties and work correctly with transactions:
 *
 * - ✅ **Commits with transaction**: softDelete/restore operations use the same executor
 *   as other repository operations, so they commit together
 * - ✅ **Rolls back with transaction**: If a transaction is rolled back, soft delete
 *   operations are also rolled back
 * - ✅ **Atomic operations**: All soft delete operations (including bulk) are atomic
 *
 * ### Correct Transaction Usage
 *
 * ```typescript
 * // ✅ CORRECT: Soft delete is part of transaction
 * await db.transaction().execute(async (trx) => {
 *   const repos = createRepositories(trx)  // Use transaction executor
 *   await repos.users.softDelete(1)
 *   await repos.posts.softDeleteMany([1, 2, 3])
 *   // If transaction rolls back, both operations roll back
 * })
 * ```
 *
 * ### Cascade Soft Delete Pattern
 *
 * For related entities, you need to manually implement cascade soft delete:
 *
 * ```typescript
 * // Cascade soft delete pattern
 * await db.transaction().execute(async (trx) => {
 *   const repos = createRepositories(trx)
 *   const userId = 123
 *
 *   // First, soft delete child records
 *   const userPosts = await repos.posts.findBy({ user_id: userId })
 *   await repos.posts.softDeleteMany(userPosts.map(p => p.id))
 *
 *   // Then, soft delete parent
 *   await repos.users.softDelete(userId)
 * })
 * ```
 *
 * @param options - Configuration options for soft delete behavior
 * @returns Plugin instance that can be used with createORM
 */
export const softDeletePlugin = (options: SoftDeleteOptions = {}): Plugin => {
  const {
    deletedAtColumn = 'deleted_at',
    includeDeleted = false,
    tables,
    primaryKeyColumn = 'id',
    logger = silentLogger,
  } = options;

  return {
    name: '@kysera/soft-delete',
    version: VERSION,

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
     *
     * Works with both Repository and DAL patterns through the unified executor layer.
     */
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      // Check if table supports soft delete
      const supportsSoftDelete = !tables || tables.includes(context.table);

      // Only filter SELECT queries when not explicitly including deleted
      if (
        supportsSoftDelete &&
        context.operation === 'select' &&
        !context.metadata['includeDeleted'] &&
        !includeDeleted
      ) {
        logger.debug(`Filtering soft-deleted records from ${context.table}`);
        // Add WHERE deleted_at IS NULL to the query builder
        type GenericSelectQueryBuilder = SelectQueryBuilder<Record<string, unknown>, string, Record<string, unknown>>;
        return (qb as unknown as GenericSelectQueryBuilder).where(
          `${context.table}.${deletedAtColumn}` as never,
          'is',
          null
        ) as QB;
      }

      // Note: DELETE operations are NOT intercepted here
      // Use softDelete() method instead of delete() to perform soft deletes
      // This is by design - method override is simpler and more explicit

      return qb;
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
     * - softDeleteMany(ids): Soft delete multiple records (bulk operation)
     * - restoreMany(ids): Restore multiple soft-deleted records (bulk operation)
     * - hardDeleteMany(ids): Permanently delete multiple records (bulk operation)
     *
     * Also overrides findAll() and findById() to automatically filter out
     * soft-deleted records (unless includeDeleted option is set).
     */
    extendRepository<T extends object>(repo: T): T {
      // Type assertion is safe here as we're checking for BaseRepository properties
      const baseRepo = repo as unknown as BaseRepository;

      // Check if it's actually a repository (has required properties)
      if (!('tableName' in baseRepo) || !('executor' in baseRepo)) {
        return repo;
      }

      // Check if table supports soft delete
      const supportsSoftDelete = !tables || tables.includes(baseRepo.tableName);

      // If table doesn't support soft delete, return unmodified repo
      if (!supportsSoftDelete) {
        logger.debug(`Table ${baseRepo.tableName} does not support soft delete, skipping extension`);
        return repo;
      }

      logger.debug(`Extending repository for table ${baseRepo.tableName} with soft delete methods`);

      // Get raw db for queries that need to bypass interceptors
      const rawDb = getRawDb(baseRepo.executor);

      const extendedRepo = {
        ...baseRepo,

        // Override base methods to filter soft-deleted records
        // Use rawDb to avoid double filtering from interceptor
        async findAll(): Promise<unknown[]> {
          if (!includeDeleted) {
            const result = await rawDb
              .selectFrom(baseRepo.tableName)
              .selectAll()
              .where(deletedAtColumn as never, 'is', null)
              .execute();
            return result as unknown[];
          }
          // Include deleted: return all records
          const result = await rawDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .execute();
          return result as unknown[];
        },

        async findById(id: number): Promise<unknown> {
          if (!includeDeleted) {
            const result = await rawDb
              .selectFrom(baseRepo.tableName)
              .selectAll()
              .where(primaryKeyColumn as never, '=', id as never)
              .where(deletedAtColumn as never, 'is', null)
              .executeTakeFirst();
            return result ?? null;
          }
          // Include deleted: find by id regardless of deleted status
          const result = await rawDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, '=', id as never)
            .executeTakeFirst();
          return result ?? null;
        },

        async softDelete(id: number): Promise<unknown> {
          logger.info(`Soft deleting record ${id} from ${baseRepo.tableName}`);
          // Use rawDb to bypass interceptors (UPDATE doesn't need filtering anyway)
          await rawDb
            .updateTable(baseRepo.tableName)
            .set({ [deletedAtColumn]: sql`CURRENT_TIMESTAMP` } as never)
            .where(primaryKeyColumn as never, '=', id as never)
            .execute();

          // Fetch the updated record - use rawDb to see the just-deleted record
          const record = await rawDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, '=', id as never)
            .executeTakeFirst();

          if (!record) {
            logger.warn(`Record ${id} not found in ${baseRepo.tableName} for soft delete`);
            throw new NotFoundError('Record', { id });
          }

          return record;
        },

        async restore(id: number): Promise<unknown> {
          logger.info(`Restoring soft-deleted record ${id} from ${baseRepo.tableName}`);
          await rawDb
            .updateTable(baseRepo.tableName)
            .set({ [deletedAtColumn]: null } as never)
            .where(primaryKeyColumn as never, '=', id as never)
            .execute();

          // Fetch the restored record
          const record = await rawDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, '=', id as never)
            .executeTakeFirst();

          if (!record) {
            logger.warn(`Record ${id} not found in ${baseRepo.tableName} for restore`);
            throw new NotFoundError('Record', { id });
          }

          return record;
        },

        async hardDelete(id: number): Promise<void> {
          logger.info(`Hard deleting record ${id} from ${baseRepo.tableName}`);
          await rawDb
            .deleteFrom(baseRepo.tableName)
            .where(primaryKeyColumn as never, '=', id as never)
            .execute();
        },

        async findWithDeleted(id: number): Promise<unknown> {
          // Use rawDb to bypass soft-delete filter
          const result = await rawDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, '=', id as never)
            .executeTakeFirst();
          return result ?? null;
        },

        async findAllWithDeleted(): Promise<unknown[]> {
          // Use rawDb to bypass soft-delete filter and return ALL records
          const result = await rawDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .execute();
          return result as unknown[];
        },

        async findDeleted(): Promise<unknown[]> {
          // Use rawDb to bypass soft-delete filter, then filter for deleted only
          const result = await rawDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(deletedAtColumn as never, 'is not', null)
            .execute();
          return result as unknown[];
        },

        async softDeleteMany(ids: (number | string)[]): Promise<unknown[]> {
          if (ids.length === 0) {
            return [];
          }

          logger.info(`Soft deleting ${ids.length} records from ${baseRepo.tableName}`);

          await rawDb
            .updateTable(baseRepo.tableName)
            .set({ [deletedAtColumn]: sql`CURRENT_TIMESTAMP` } as never)
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute();

          // Use rawDb to see the just-deleted records
          const records = await rawDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute();

          if (records.length !== ids.length) {
            const foundIds = records.map((r: any) => r[primaryKeyColumn]);
            const missingIds = ids.filter((id) => !foundIds.includes(id));
            logger.warn(`Some records not found for soft delete: ${missingIds.join(', ')}`);
            throw new NotFoundError('Records', { ids: missingIds });
          }

          return records as unknown[];
        },

        async restoreMany(ids: (number | string)[]): Promise<unknown[]> {
          if (ids.length === 0) {
            return [];
          }

          logger.info(`Restoring ${ids.length} soft-deleted records from ${baseRepo.tableName}`);

          await rawDb
            .updateTable(baseRepo.tableName)
            .set({ [deletedAtColumn]: null } as never)
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute();

          const records = await rawDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute();

          return records as unknown[];
        },

        async hardDeleteMany(ids: (number | string)[]): Promise<void> {
          if (ids.length === 0) {
            return;
          }

          logger.info(`Hard deleting ${ids.length} records from ${baseRepo.tableName}`);

          await rawDb
            .deleteFrom(baseRepo.tableName)
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute();
        },
      };

      return extendedRepo as T;
    },
  };
};
