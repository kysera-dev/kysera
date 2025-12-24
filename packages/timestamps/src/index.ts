import type { Plugin } from '@kysera/executor'
import type { Repository } from '@kysera/repository'
import type { Kysely, SelectQueryBuilder } from 'kysely'
import { silentLogger, detectDialect } from '@kysera/core'
import type { KyseraLogger } from '@kysera/core'
import { VERSION } from './version.js'

/**
 * Database schema with timestamp columns
 */
type TimestampedTable = Record<string, unknown>

/**
 * Timestamp methods added to repositories
 */
export interface TimestampMethods<T> {
  findCreatedAfter(date: Date | string): Promise<T[]>
  findCreatedBefore(date: Date | string): Promise<T[]>
  findCreatedBetween(startDate: Date | string, endDate: Date | string): Promise<T[]>
  findUpdatedAfter(date: Date | string): Promise<T[]>
  findRecentlyUpdated(limit?: number): Promise<T[]>
  findRecentlyCreated(limit?: number): Promise<T[]>
  createWithoutTimestamps(input: unknown): Promise<T>
  updateWithoutTimestamp(id: number, input: unknown): Promise<T>
  touch(id: number): Promise<void>
  getTimestampColumns(): { createdAt: string; updatedAt: string }
  createMany(inputs: unknown[]): Promise<T[]>
  updateMany(ids: (number | string)[], input: unknown): Promise<T[]>
  touchMany(ids: (number | string)[]): Promise<void>
}

/**
 * Options for the timestamps plugin
 */
export interface TimestampsOptions {
  /**
   * Name of the created_at column
   * @default 'created_at'
   */
  createdAtColumn?: string

  /**
   * Name of the updated_at column
   * @default 'updated_at'
   */
  updatedAtColumn?: string

  /**
   * Whether to set updated_at on insert
   * @default false
   */
  setUpdatedAtOnInsert?: boolean

  /**
   * List of tables that should have timestamps
   * If not specified, all tables will have timestamps
   */
  tables?: string[]

  /**
   * Tables that should be excluded from timestamps
   */
  excludeTables?: string[]

  /**
   * Custom timestamp function (defaults to new Date().toISOString())
   */
  getTimestamp?: () => Date | string | number

  /**
   * Date format for database (ISO string by default)
   */
  dateFormat?: 'iso' | 'unix' | 'date'

  /**
   * Name of the primary key column used by touch() method
   * @default 'id'
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
 * Repository extended with timestamp methods
 */
export type TimestampsRepository<Entity, DB> = Repository<Entity, DB> & TimestampMethods<Entity>

/**
 * Get the current timestamp based on options
 */
function getTimestamp(options: TimestampsOptions): Date | string | number {
  if (options.getTimestamp) {
    return options.getTimestamp()
  }

  const now = new Date()

  switch (options.dateFormat) {
    case 'unix':
      return Math.floor(now.getTime() / 1000)
    case 'date':
      return now
    case 'iso':
    default:
      return now.toISOString()
  }
}

/**
 * Check if a table should have timestamps
 */
function shouldApplyTimestamps(tableName: string, options: TimestampsOptions): boolean {
  if (options.excludeTables?.includes(tableName)) {
    return false
  }

  if (options.tables) {
    return options.tables.includes(tableName)
  }

  return true
}

/**
 * Type-safe query builder for timestamp operations
 */
function createTimestampQuery(
  executor: Kysely<Record<string, TimestampedTable>>,
  tableName: string,
  column: string
): {
  select(): SelectQueryBuilder<Record<string, TimestampedTable>, typeof tableName, {}>
  where<V>(
    operator: string,
    value: V
  ): SelectQueryBuilder<Record<string, TimestampedTable>, typeof tableName, {}>
} {
  return {
    select() {
      return executor.selectFrom(tableName as never)
    },
    where<V>(operator: string, value: V) {
      return executor
        .selectFrom(tableName as never)
        .where(column as never, operator as never, value as never)
    }
  }
}

/**
 * Check if dialect supports RETURNING clause
 *
 * Database compatibility:
 * - PostgreSQL: Full RETURNING support ✅
 * - SQLite: RETURNING supported in 3.35+ ✅ (most modern versions)
 * - MySQL: No RETURNING support ❌
 * - MSSQL: Uses OUTPUT clause ❌ (different syntax, not compatible with returningAll())
 *
 * **Implementation Notes:**
 * - We only check for MySQL since it's the only major dialect without RETURNING
 * - SQLite 3.35+ is widely deployed (released 2021-03-12)
 * - MSSQL support is minimal in Kysera ecosystem, treated as unsupported here
 * - If MSSQL full support is needed, this function should be extended to detect MSSQL
 *
 * @param executor - Kysely database executor
 * @returns true if RETURNING clause is supported
 */
function supportsReturning<DB>(executor: Kysely<DB>): boolean {
  const dialect = detectDialect(executor)
  // Return false for MySQL (doesn't support RETURNING)
  // Return false for MSSQL (uses OUTPUT, not RETURNING)
  // Return true for PostgreSQL and SQLite
  return dialect !== 'mysql' && dialect !== 'mssql'
}

/**
 * Timestamps Plugin
 *
 * Automatically manages created_at and updated_at timestamps for database records.
 * Works by overriding repository methods to add timestamp values.
 *
 * ## Features
 *
 * - Automatic `created_at` on insert
 * - Automatic `updated_at` on every update
 * - Configurable column names
 * - Configurable timestamp format (ISO, Unix, Date)
 * - Query helpers: findCreatedAfter, findUpdatedAfter, etc.
 * - Bulk operations: createMany, updateMany, touchMany
 * - **Cross-database support**: Works with PostgreSQL, MySQL, SQLite, and MSSQL
 *
 * ## Transaction Behavior
 *
 * **IMPORTANT**: Timestamp operations respect ACID properties and work correctly with transactions:
 *
 * - ✅ **Commits with transaction**: Timestamps are set using the same executor as the
 *   repository operation, so they commit together
 * - ✅ **Rolls back with transaction**: If a transaction is rolled back, all timestamp
 *   changes are also rolled back
 * - ✅ **Consistent timestamps**: All operations within a transaction can use the same
 *   timestamp by providing a custom `getTimestamp` function
 *
 * ### Correct Transaction Usage
 *
 * ```typescript
 * // ✅ CORRECT: Timestamps are part of transaction
 * await db.transaction().execute(async (trx) => {
 *   const repos = createRepositories(trx)  // Use transaction executor
 *   await repos.users.create({ email: 'test@example.com' })  // created_at auto-set
 *   await repos.posts.createMany([...])  // All created_at set consistently
 *   // If transaction rolls back, all changes including timestamps roll back
 * })
 * ```
 *
 * ### Consistent Timestamps Across Operations
 *
 * ```typescript
 * // Use shared timestamp for all operations in a transaction
 * const now = new Date()
 * const timestampsWithFixedTime = timestampsPlugin({
 *   getTimestamp: () => now
 * })
 *
 * await db.transaction().execute(async (trx) => {
 *   // All operations will have the exact same timestamp
 *   await repos.users.create(...)  // created_at = now
 *   await repos.posts.update(...)  // updated_at = now
 * })
 * ```
 *
 * @example
 * ```typescript
 * import { timestampsPlugin } from '@kysera/timestamps'
 *
 * const plugin = timestampsPlugin({
 *   createdAtColumn: 'created_at',
 *   updatedAtColumn: 'updated_at',
 *   tables: ['users', 'posts', 'comments']
 * })
 *
 * const orm = createORM(db, [plugin])
 * ```
 */
export const timestampsPlugin = (options: TimestampsOptions = {}): Plugin => {
  const {
    createdAtColumn = 'created_at',
    updatedAtColumn = 'updated_at',
    setUpdatedAtOnInsert = false,
    primaryKeyColumn = 'id',
    logger = silentLogger
  } = options

  return {
    name: '@kysera/timestamps',
    version: VERSION,
    priority: 50, // Run in the middle, after filtering but before audit

    /**
     * Lifecycle: No initialization needed for timestamps plugin
     */
    onInit() {
      // No initialization required
    },

    /**
     * Lifecycle: Cleanup resources when executor is destroyed
     */
    onDestroy(): Promise<void> {
      // No cleanup required - timestamps plugin has no persistent resources
      logger.debug('Timestamps plugin destroyed')
      return Promise.resolve()
    },

    extendRepository<T extends object>(repo: T): T {
      // Check if it's actually a repository (has required properties)
      if (!('tableName' in repo) || !('executor' in repo)) {
        return repo
      }

      // Type assertion is safe here as we've checked for properties
      const baseRepo = repo as T & {
        tableName: string
        executor: unknown
        create: Function
        update: Function
      }

      // Skip if table doesn't support timestamps
      if (!shouldApplyTimestamps(baseRepo.tableName, options)) {
        logger.debug(`Table ${baseRepo.tableName} excluded from timestamps, skipping extension`)
        return repo
      }

      logger.debug(`Extending repository for table ${baseRepo.tableName} with timestamp methods`)

      // Save original methods
      const originalCreate = baseRepo.create.bind(baseRepo)
      const originalUpdate = baseRepo.update.bind(baseRepo)
      const executor = baseRepo.executor as Kysely<Record<string, TimestampedTable>>

      const extendedRepo = {
        ...baseRepo,

        // Override create to add timestamps
        async create(input: unknown): Promise<unknown> {
          const data = input as Record<string, unknown>
          const timestamp = getTimestamp(options)
          const dataWithTimestamps: Record<string, unknown> = {
            ...data,
            [createdAtColumn]: data[createdAtColumn] ?? timestamp
          }

          if (setUpdatedAtOnInsert) {
            dataWithTimestamps[updatedAtColumn] = data[updatedAtColumn] ?? timestamp
          }

          logger.debug(`Creating record in ${baseRepo.tableName} with timestamp ${timestamp}`)
          return await originalCreate(dataWithTimestamps)
        },

        // Override update to set updated_at
        async update(id: number, input: unknown): Promise<unknown> {
          const data = input as Record<string, unknown>
          const timestamp = getTimestamp(options)
          const dataWithTimestamp: Record<string, unknown> = {
            ...data,
            [updatedAtColumn]: data[updatedAtColumn] ?? timestamp
          }

          logger.debug(`Updating record ${id} in ${baseRepo.tableName} with timestamp ${timestamp}`)
          return await originalUpdate(id, dataWithTimestamp)
        },

        /**
         * Find records created after a specific date
         */
        async findCreatedAfter(date: Date | string | number): Promise<unknown[]> {
          const query = createTimestampQuery(executor, baseRepo.tableName, createdAtColumn)
          const result = await query.where('>', String(date)).selectAll().execute()
          return result
        },

        /**
         * Find records created before a specific date
         */
        async findCreatedBefore(date: Date | string | number): Promise<unknown[]> {
          const query = createTimestampQuery(executor, baseRepo.tableName, createdAtColumn)
          const result = await query.where('<', String(date)).selectAll().execute()
          return result
        },

        /**
         * Find records created between two dates
         */
        async findCreatedBetween(
          startDate: Date | string | number,
          endDate: Date | string | number
        ): Promise<unknown[]> {
          const result = await executor
            .selectFrom(baseRepo.tableName as never)
            .selectAll()
            .where(createdAtColumn as never, '>=', startDate as never)
            .where(createdAtColumn as never, '<=', endDate as never)
            .execute()
          return result
        },

        /**
         * Find records updated after a specific date
         */
        async findUpdatedAfter(date: Date | string | number): Promise<unknown[]> {
          const query = createTimestampQuery(executor, baseRepo.tableName, updatedAtColumn)
          const result = await query.where('>', String(date)).selectAll().execute()
          return result
        },

        /**
         * Find recently updated records
         */
        async findRecentlyUpdated(limit = 10): Promise<unknown[]> {
          const result = await executor
            .selectFrom(baseRepo.tableName as never)
            .selectAll()
            .orderBy(updatedAtColumn as never, 'desc')
            .limit(limit)
            .execute()
          return result
        },

        /**
         * Find recently created records
         */
        async findRecentlyCreated(limit = 10): Promise<unknown[]> {
          const result = await executor
            .selectFrom(baseRepo.tableName as never)
            .selectAll()
            .orderBy(createdAtColumn as never, 'desc')
            .limit(limit)
            .execute()
          return result
        },

        /**
         * Create without adding timestamps
         */
        async createWithoutTimestamps(input: unknown): Promise<unknown> {
          logger.debug(`Creating record in ${baseRepo.tableName} without timestamps`)
          return await originalCreate(input)
        },

        /**
         * Update without modifying timestamp
         */
        async updateWithoutTimestamp(id: number, input: unknown): Promise<unknown> {
          logger.debug(`Updating record ${id} in ${baseRepo.tableName} without timestamp`)
          return await originalUpdate(id, input)
        },

        /**
         * Touch a record (update its timestamp)
         */
        async touch(id: number): Promise<void> {
          const timestamp = getTimestamp(options)
          const updateData = { [updatedAtColumn]: timestamp }

          logger.info(`Touching record ${id} in ${baseRepo.tableName}`)
          await executor
            .updateTable(baseRepo.tableName as never)
            .set(updateData as never)
            .where(primaryKeyColumn as never, '=', id as never)
            .execute()
        },

        /**
         * Get the timestamp column names
         */
        getTimestampColumns(): { createdAt: string; updatedAt: string } {
          return {
            createdAt: createdAtColumn,
            updatedAt: updatedAtColumn
          }
        },

        /**
         * Create multiple records with timestamps
         * Uses efficient bulk INSERT with automatic timestamp injection.
         * Supports PostgreSQL, MySQL, SQLite, and MSSQL with appropriate fallbacks.
         */
        async createMany(inputs: unknown[]): Promise<unknown[]> {
          // Handle empty arrays gracefully
          if (!inputs || inputs.length === 0) {
            return []
          }

          const timestamp = getTimestamp(options)
          const dataWithTimestamps = inputs.map(input => {
            const data = input as Record<string, unknown>
            const result: Record<string, unknown> = {
              ...data,
              [createdAtColumn]: data[createdAtColumn] ?? timestamp
            }

            if (setUpdatedAtOnInsert) {
              result[updatedAtColumn] = data[updatedAtColumn] ?? timestamp
            }

            return result
          })

          logger.info(
            `Creating ${inputs.length} records in ${baseRepo.tableName} with timestamp ${timestamp}`
          )

          // Check if dialect supports RETURNING
          if (supportsReturning(executor)) {
            // Use RETURNING for PostgreSQL/SQLite - most efficient
            const result = await executor
              .insertInto(baseRepo.tableName as never)
              .values(dataWithTimestamps as never)
              .returningAll()
              .execute()

            return result
          } else {
            // Fallback for MySQL/MSSQL - insert then select
            // This approach works for auto-increment primary keys
            await executor
              .insertInto(baseRepo.tableName as never)
              .values(dataWithTimestamps as never)
              .execute()

            // Fetch inserted records by matching on unique columns
            // For simplicity, we fetch the most recently created records
            // This works well when created_at is set to the same timestamp
            const insertedCount = dataWithTimestamps.length
            const result = await executor
              .selectFrom(baseRepo.tableName as never)
              .selectAll()
              .where(createdAtColumn as never, '=', timestamp as never)
              .orderBy(primaryKeyColumn as never, 'desc')
              .limit(insertedCount)
              .execute()

            // Reverse to maintain insertion order
            return result.reverse()
          }
        },

        /**
         * Update multiple records (sets updated_at for all)
         * Updates all specified records with the same data
         */
        async updateMany(ids: (number | string)[], input: unknown): Promise<unknown[]> {
          // Handle empty arrays gracefully
          if (!ids || ids.length === 0) {
            return []
          }

          const data = input as Record<string, unknown>
          const timestamp = getTimestamp(options)
          const dataWithTimestamp: Record<string, unknown> = {
            ...data,
            [updatedAtColumn]: data[updatedAtColumn] ?? timestamp
          }

          logger.info(
            `Updating ${ids.length} records in ${baseRepo.tableName} with timestamp ${timestamp}`
          )

          // Use Kysely's update with IN clause for efficient bulk update
          await executor
            .updateTable(baseRepo.tableName as never)
            .set(dataWithTimestamp as never)
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute()

          // Fetch and return updated records
          const result = await executor
            .selectFrom(baseRepo.tableName as never)
            .selectAll()
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute()

          return result
        },

        /**
         * Touch multiple records (update updated_at only)
         * Efficiently updates only the timestamp column
         */
        async touchMany(ids: (number | string)[]): Promise<void> {
          // Handle empty arrays gracefully
          if (!ids || ids.length === 0) {
            return
          }

          const timestamp = getTimestamp(options)
          const updateData = { [updatedAtColumn]: timestamp }

          logger.info(`Touching ${ids.length} records in ${baseRepo.tableName}`)
          await executor
            .updateTable(baseRepo.tableName as never)
            .set(updateData as never)
            .where(primaryKeyColumn as never, 'in', ids as never)
            .execute()
        }
      }

      return extendedRepo as T
    }
  }
}
