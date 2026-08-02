import type { Plugin, QueryBuilderContext, BaseRepositoryLike } from '@kysera/executor'
import { getRawDb, isRepositoryLike, withPluginMetadata } from '@kysera/executor'
import type { SelectQueryBuilder } from 'kysely'
import { NotFoundError, SoftDeleteError, RecordNotDeletedError, silentLogger, formatTimestampForDb, detectDialect, shouldApplyToTable, fetchRowShared, ROW_VISIBILITY_WITH_DELETED } from '@kysera/core'
import type { KyseraLogger, Dialect, RowFetchExecutor } from '@kysera/core'
import { VERSION } from './version.js'

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
   * Takes precedence over excludeTables when both are provided.
   *
   * @example ['users', 'posts', 'comments']
   */
  tables?: string[]

  /**
   * Tables that should be excluded from soft delete.
   * Ignored if `tables` whitelist is provided.
   *
   * @example ['migrations', 'sessions']
   */
  excludeTables?: string[]

  /**
   * Primary key column name used for identifying records.
   * Tables with different primary key names (uuid, user_id, etc.) can be configured.
   *
   * @default 'id'
   * @example 'uuid', 'user_id', 'post_id'
   */
  primaryKeyColumn?: string

  /**
   * Logger for plugin operations.
   * Uses KyseraLogger interface from @kysera/core.
   *
   * @default silentLogger (no output)
   */
  logger?: KyseraLogger
}

/**
 * Methods added to repositories by the soft delete plugin
 */
export interface SoftDeleteMethods<T> {
  softDelete(id: number | string): Promise<T>
  restore(id: number | string): Promise<T>
  hardDelete(id: number | string): Promise<void>
  findWithDeleted(id: number | string): Promise<T | null>
  findAllWithDeleted(): Promise<T[]>
  findDeleted(): Promise<T[]>
  softDeleteMany(ids: (number | string)[]): Promise<T[]>
  restoreMany(ids: (number | string)[]): Promise<T[]>
  hardDeleteMany(ids: (number | string)[]): Promise<void>
}

/**
 * Repository extended with soft delete methods.
 * Uses a generic base repository type for flexibility across different repository implementations.
 *
 * @typeParam Entity - The entity type managed by the repository
 * @typeParam BaseRepo - The base repository type to extend (defaults to Record<string, never>)
 *
 * @example
 * ```typescript
 * // Type-safe usage with base repository
 * type User = { id: number; name: string; deleted_at: Date | null };
 * type UserRepo = { findAll(): Promise<User[]>; findById(id: number): Promise<User> };
 * type ExtendedUserRepo = SoftDeleteRepository<User, UserRepo>;
 *
 * // Now includes both UserRepo methods and soft delete methods
 * const repo: ExtendedUserRepo = ...;
 * await repo.findAll();        // From UserRepo
 * await repo.softDelete(1);    // From SoftDeleteMethods
 * ```
 */
export type SoftDeleteRepository<
  Entity,
  BaseRepo extends object = Record<string, never>
> = BaseRepo & SoftDeleteMethods<Entity>

/**
 * Internal repository interface for soft-delete operations.
 * Uses the unified BaseRepositoryLike interface from @kysera/executor.
 */
type SoftDeleteBaseRepository = BaseRepositoryLike<Record<string, unknown>>

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
    excludeTables,
    primaryKeyColumn = 'id',
    logger = silentLogger
  } = options

  return {
    name: '@kysera/soft-delete',
    version: VERSION,
    priority: 500, // FILTER plugin: runs after security (RLS=1000), before transforms

    /**
     * Lifecycle: No initialization needed for soft-delete plugin
     */
    onInit() {
      // No initialization required
    },

    /**
     * Lifecycle: Cleanup resources when executor is destroyed
     */
    onDestroy() {
      logger.debug('Soft-delete plugin destroyed')
    },

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
      const supportsSoftDelete = shouldApplyToTable(context.table, { tables, excludeTables })

      if (
        !supportsSoftDelete ||
        context.metadata['includeDeleted'] === true ||
        includeDeleted
      ) {
        return qb
      }

      // Filter SELECT queries, and ALSO narrow UPDATE/DELETE statements:
      // soft-deleted rows are invisible to reads, so leaving them freely
      // mutable/hard-deletable through the generic paths is a data-integrity
      // trap. Internal methods (softDelete/restore/hardDelete) opt out via
      // metadata.includeDeleted.
      if (
        context.operation === 'select' ||
        context.operation === 'update' ||
        context.operation === 'delete'
      ) {
        logger.debug(`Filtering soft-deleted records from ${context.table}`)
        // Once a table is aliased, SQL exposes only the alias as correlation
        // name — qualify with the alias when present ('users as u' -> 'u').
        // Kysely's update/delete builders share the same runtime .where()
        // surface as SelectQueryBuilder.
        const reference = context.alias ?? context.table
        type GenericSelectQueryBuilder = SelectQueryBuilder<
          Record<string, unknown>,
          string,
          Record<string, unknown>
        >
        return (qb as unknown as GenericSelectQueryBuilder).where(
          `${reference}.${deletedAtColumn}` as never,
          'is',
          null
        ) as QB
      }

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
     * - softDeleteMany(ids): Soft delete multiple records (bulk operation)
     * - restoreMany(ids): Restore multiple soft-deleted records (bulk operation)
     * - hardDeleteMany(ids): Permanently delete multiple records (bulk operation)
     *
     * Also overrides findAll() and findById() to automatically filter out
     * soft-deleted records (unless includeDeleted option is set).
     */
    extendRepository<T extends object>(repo: T): T {
      // Use the shared type guard from @kysera/executor
      if (!isRepositoryLike(repo)) {
        return repo
      }

      // Type assertion is safe after type guard
      const baseRepo = repo as unknown as SoftDeleteBaseRepository

      // Check if table supports soft delete
      const supportsSoftDelete = shouldApplyToTable(baseRepo.tableName, { tables, excludeTables })

      // If table doesn't support soft delete, return unmodified repo
      if (!supportsSoftDelete) {
        logger.debug(`Table ${baseRepo.tableName} does not support soft delete, skipping extension`)
        return repo
      }

      logger.debug(`Extending repository for table ${baseRepo.tableName} with soft delete methods`)

      // Scoped opt-out: skips ONLY this plugin's deleted_at filter while every
      // other plugin (RLS, audit, ...) stays active. The previous getRawDb
      // escape bypassed ALL plugins — findAllWithDeleted leaked other tenants'
      // rows when combined with RLS.
      const withDeletedDb = withPluginMetadata(baseRepo.executor, { includeDeleted: true })

      // Cache dialect detection per-repository (detectDialect compiles a test query)
      let cachedDialect: Dialect | undefined
      const getDialect = (): Dialect => {
        cachedDialect ??= detectDialect(getRawDb(baseRepo.executor))
        return cachedDialect
      }

      const extendedRepo = {
        ...baseRepo,

        // Override findAll/findById to use executor (goes through interceptors for filtering + respects transactions)
        async findAll(): Promise<unknown[]> {
          return await baseRepo.executor.selectFrom(baseRepo.tableName).selectAll().execute() as unknown[]
        },

        async findById(id: number | string): Promise<unknown> {
          const result = await baseRepo.executor
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, '=', id as never)
            .executeTakeFirst()
          return result ?? null
        },

        async softDelete(id: number | string): Promise<unknown> {
          logger.info(`Soft deleting record ${id} from ${baseRepo.tableName}`)

          // Opt out of the deleted_at narrowing: softDelete is documented as
          // idempotent (re-deleting refreshes the timestamp). RLS still applies.
          const result = await withDeletedDb
            .updateTable(baseRepo.tableName)
            .set({ [deletedAtColumn]: formatTimestampForDb(undefined, getDialect()) } as never)
            .where(primaryKeyColumn as never, '=', id as never)
            .executeTakeFirst()

          if (Number((result as { numUpdatedRows?: bigint })?.numUpdatedRows ?? 0) === 0) {
            throw new NotFoundError('Record', { id })
          }

          // Read back through the scoped opt-out (soft-delete filter off, RLS on)
          return await withDeletedDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, '=', id as never)
            .executeTakeFirst() ?? null
        },

        async restore(id: number | string): Promise<unknown> {
          logger.info(`Restoring soft-deleted record ${id} from ${baseRepo.tableName}`)

          // Existence probe must see deleted records — scoped opt-out, RLS on.
          // Routed through the per-operation row cache: under the audit
          // plugin's restore wrapper the same row was just fetched for
          // old-values capture with identical visibility (executor +
          // includeDeleted metadata), so the probe reuses that SELECT
          // (see @kysera/core row-cache).
          const existing = await fetchRowShared(
            withDeletedDb as unknown as RowFetchExecutor,
            baseRepo.tableName,
            primaryKeyColumn,
            id,
            ROW_VISIBILITY_WITH_DELETED
          )

          if (!existing) {
            throw new NotFoundError('Record', { id })
          }

          // Strict null/undefined check (not falsy — avoids false positive on 0, "", false)
          if (existing[deletedAtColumn] === null || existing[deletedAtColumn] === undefined) {
            throw new RecordNotDeletedError(id, baseRepo.tableName)
          }

          // The UPDATE must also opt out: the plugin now narrows executor
          // updates with `deleted_at IS NULL`, which would exclude the very
          // row being restored. RLS and other plugins still apply.
          await withDeletedDb
            .updateTable(baseRepo.tableName)
            .set({ [deletedAtColumn]: null } as never)
            .where(primaryKeyColumn as never, '=', id as never)
            .execute()

          // Fetch restored record (now visible through executor since deleted_at is null)
          const record = await baseRepo.executor
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, '=', id as never)
            .executeTakeFirst()

          if (!record) {
            throw new SoftDeleteError(
              `Record ${id} disappeared during restore in ${baseRepo.tableName}`,
              'Race condition: record was deleted between check and restore'
            )
          }

          return record
        },

        async hardDelete(id: number | string): Promise<void> {
          logger.info(`Hard deleting record ${id} from ${baseRepo.tableName}`)
          // Opt out of the deleted_at narrowing so already-soft-deleted rows
          // can be purged; RLS and other plugins still apply
          await withDeletedDb
            .deleteFrom(baseRepo.tableName)
            .where(primaryKeyColumn as never, '=', id as never)
            .execute()
        },

        async findWithDeleted(id: number | string): Promise<unknown> {
          // Scoped opt-out: soft-delete filter off, every other plugin on
          const result = await withDeletedDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, '=', id as never)
            .executeTakeFirst()
          return result ?? null
        },

        async findAllWithDeleted(): Promise<unknown[]> {
          // Scoped opt-out: soft-delete filter off, every other plugin on
          return await withDeletedDb.selectFrom(baseRepo.tableName).selectAll().execute() as unknown[]
        },

        async findDeleted(): Promise<unknown[]> {
          // Scoped opt-out, then select only deleted
          return await withDeletedDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(deletedAtColumn as never, 'is not', null)
            .execute() as unknown[]
        },

        async softDeleteMany(ids: (number | string)[]): Promise<unknown[]> {
          if (ids.length === 0) return []

          logger.info(`Soft deleting ${ids.length} records from ${baseRepo.tableName}`)

          // Opt out of the deleted_at narrowing (idempotent re-delete, RLS on)
          await withDeletedDb
            .updateTable(baseRepo.tableName)
            .set({ [deletedAtColumn]: formatTimestampForDb(undefined, getDialect()) } as never)
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute()

          // Read back through the scoped opt-out (just-deleted rows visible, RLS on)
          const records = await withDeletedDb
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute()

          if (records.length !== ids.length) {
            const foundIds = records.map((r: Record<string, unknown>) => r[primaryKeyColumn])
            const missingIds = ids.filter(id => !foundIds.includes(id))
            logger.warn(`Some records not found for soft delete: ${missingIds.join(', ')}`)
          }

          return records as unknown[]
        },

        async restoreMany(ids: (number | string)[]): Promise<unknown[]> {
          if (ids.length === 0) return []

          logger.info(`Restoring ${ids.length} soft-deleted records from ${baseRepo.tableName}`)

          // Opt out of the deleted_at narrowing (targets ARE deleted rows);
          // RLS and other plugins still apply
          await withDeletedDb
            .updateTable(baseRepo.tableName)
            .set({ [deletedAtColumn]: null } as never)
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute()

          // Fetch via executor (restored records are now visible through interceptor)
          const records = await baseRepo.executor
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute()

          return records as unknown[]
        },

        async hardDeleteMany(ids: (number | string)[]): Promise<void> {
          if (ids.length === 0) return

          logger.info(`Hard deleting ${ids.length} records from ${baseRepo.tableName}`)

          // Opt out of the deleted_at narrowing so soft-deleted rows can be
          // purged too; RLS and other plugins still apply
          await withDeletedDb
            .deleteFrom(baseRepo.tableName)
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute()
        }
      }

      return extendedRepo as T
    }
  }
}
