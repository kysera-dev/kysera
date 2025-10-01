import type { Plugin } from '@kysera/repository'
import type { Kysely, SelectQueryBuilder } from 'kysely'

/**
 * Database schema with timestamp columns
 */
type TimestampedTable = Record<string, unknown>;

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
}

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
  where<V>(operator: string, value: V): SelectQueryBuilder<Record<string, TimestampedTable>, typeof tableName, {}>
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
 * Timestamps Plugin
 *
 * Automatically manages created_at and updated_at timestamps for database records.
 * Works by overriding repository methods to add timestamp values.
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
    setUpdatedAtOnInsert = false
  } = options

  return {
    name: '@kysera/timestamps',
    version: '1.0.0',

    interceptQuery(qb, _context) {
      // The interceptQuery method can't modify INSERT/UPDATE values in Kysely
      // We handle timestamps through repository method overrides instead
      return qb
    },

    extendRepository<T extends object>(repo: T): T {
      // Check if it's actually a repository (has required properties)
      if (!('tableName' in repo) || !('executor' in repo)) {
        return repo
      }

      // Type assertion is safe here as we've checked for properties
      const baseRepo = repo as T & { tableName: string; executor: unknown; create: Function; update: Function }

      // Skip if table doesn't support timestamps
      if (!shouldApplyTimestamps(baseRepo.tableName, options)) {
        return repo
      }

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

          return await originalUpdate(id, dataWithTimestamp)
        },

        /**
         * Find records created after a specific date
         */
        async findCreatedAfter(date: Date | string | number): Promise<unknown[]> {
          const query = createTimestampQuery(executor, baseRepo.tableName, createdAtColumn)
          const result = await query.where('>', String(date))
            .selectAll()
            .execute()
          return result
        },

        /**
         * Find records created before a specific date
         */
        async findCreatedBefore(date: Date | string | number): Promise<unknown[]> {
          const query = createTimestampQuery(executor, baseRepo.tableName, createdAtColumn)
          const result = await query.where('<', String(date))
            .selectAll()
            .execute()
          return result
        },

        /**
         * Find records created between two dates
         */
        async findCreatedBetween(startDate: Date | string | number, endDate: Date | string | number): Promise<unknown[]> {
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
          const result = await query.where('>', String(date))
            .selectAll()
            .execute()
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
          return await originalCreate(input)
        },

        /**
         * Update without modifying timestamp
         */
        async updateWithoutTimestamp(id: number, input: unknown): Promise<unknown> {
          return await originalUpdate(id, input)
        },

        /**
         * Touch a record (update its timestamp)
         */
        async touch(id: number): Promise<void> {
          const timestamp = getTimestamp(options)
          const updateData = { [updatedAtColumn]: timestamp }

          await executor
            .updateTable(baseRepo.tableName as never)
            .set(updateData as never)
            .where('id' as never, '=', id as never)
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
        }
      }

      return extendedRepo as T
    }
  }
}

/**
 * Default export
 */
export default timestampsPlugin