import type { Plugin } from '@kysera/repository'

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
   * Tables to apply timestamps to (whitelist)
   * If not specified, applies to all tables
   */
  tables?: string[]

  /**
   * Tables to exclude from timestamps (blacklist)
   * Takes precedence over `tables` option
   */
  excludeTables?: string[]

  /**
   * Custom timestamp generator function
   * @default () => new Date()
   */
  timestampGenerator?: () => Date | string
}

/**
 * Check if timestamps should be applied to a table
 */
function shouldApplyTimestamps(
  table: string,
  options: TimestampsOptions
): boolean {
  // Check exclusions first (takes precedence)
  if (options.excludeTables?.includes(table)) {
    return false
  }

  // If whitelist is specified, table must be in it
  if (options.tables && !options.tables.includes(table)) {
    return false
  }

  return true
}

/**
 * Get timestamp value using custom generator or default
 */
function getTimestamp(options: TimestampsOptions): Date | string {
  if (options.timestampGenerator) {
    return options.timestampGenerator()
  }
  return new Date()
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

    extendRepository(repo) {
      // Skip if table doesn't support timestamps
      if (!shouldApplyTimestamps(repo.tableName, options)) {
        return repo
      }

      // Save original methods
      const originalCreate = repo.create.bind(repo)
      const originalUpdate = repo.update.bind(repo)

      return {
        ...repo,

        // Override create to add timestamps
        async create(input: any, metadata: Record<string, any> = {}): Promise<any> {
          // Skip if explicitly disabled
          if (metadata['skipTimestamps']) {
            return originalCreate(input, metadata)
          }

          const timestamp = getTimestamp(options)
          const dataWithTimestamps = {
            ...input,
            [createdAtColumn]: input[createdAtColumn] ?? timestamp
          }

          if (setUpdatedAtOnInsert) {
            dataWithTimestamps[updatedAtColumn] = input[updatedAtColumn] ?? timestamp
          }

          return originalCreate(dataWithTimestamps, metadata)
        },

        // Override update to add updated_at
        async update(id: number, input: any, metadata: Record<string, any> = {}): Promise<any> {
          // Skip if explicitly disabled
          if (metadata['skipTimestamps']) {
            return originalUpdate(id, input, metadata)
          }

          const timestamp = getTimestamp(options)
          const dataWithTimestamp = {
            ...input,
            [updatedAtColumn]: input[updatedAtColumn] ?? timestamp
          }

          return originalUpdate(id, dataWithTimestamp, metadata)
        },

        /**
         * Find records created after a specific date
         */
        async findCreatedAfter(date: Date | string): Promise<any[]> {
          return repo.executor
            .selectFrom(repo.tableName)
            .selectAll()
            .where(createdAtColumn, '>', date)
            .execute()
        },

        /**
         * Find records created before a specific date
         */
        async findCreatedBefore(date: Date | string): Promise<any[]> {
          return repo.executor
            .selectFrom(repo.tableName)
            .selectAll()
            .where(createdAtColumn, '<', date)
            .execute()
        },

        /**
         * Find records created between two dates
         */
        async findCreatedBetween(startDate: Date | string, endDate: Date | string): Promise<any[]> {
          return repo.executor
            .selectFrom(repo.tableName)
            .selectAll()
            .where(createdAtColumn, '>=', startDate)
            .where(createdAtColumn, '<=', endDate)
            .execute()
        },

        /**
         * Find records updated after a specific date
         */
        async findUpdatedAfter(date: Date | string): Promise<any[]> {
          return repo.executor
            .selectFrom(repo.tableName)
            .selectAll()
            .where(updatedAtColumn, '>', date)
            .execute()
        },

        /**
         * Find recently updated records
         */
        async findRecentlyUpdated(limit = 10): Promise<any[]> {
          return repo.executor
            .selectFrom(repo.tableName)
            .selectAll()
            .orderBy(updatedAtColumn, 'desc')
            .limit(limit)
            .execute()
        },

        /**
         * Find recently created records
         */
        async findRecentlyCreated(limit = 10): Promise<any[]> {
          return repo.executor
            .selectFrom(repo.tableName)
            .selectAll()
            .orderBy(createdAtColumn, 'desc')
            .limit(limit)
            .execute()
        },

        /**
         * Create record without auto-generating timestamps
         */
        async createWithoutTimestamps(input: any): Promise<any> {
          return originalCreate(input, { skipTimestamps: true })
        },

        /**
         * Update record without updating timestamp
         */
        async updateWithoutTimestamp(id: number, input: any): Promise<any> {
          return originalUpdate(id, input, { skipTimestamps: true })
        },

        /**
         * Touch a record (update only the updated_at timestamp)
         */
        async touch(id: number): Promise<void> {
          const timestamp = getTimestamp(options)
          await repo.executor
            .updateTable(repo.tableName)
            .set({ [updatedAtColumn]: timestamp })
            .where('id', '=', id)
            .execute()
        },

        /**
         * Get timestamp column names configuration
         */
        getTimestampColumns() {
          return {
            createdAt: createdAtColumn,
            updatedAt: updatedAtColumn
          }
        }
      }
    }
  }
}

/**
 * Create timestamps plugin for SQLite (uses ISO string dates)
 */
export function timestampsPluginSQLite(options: Omit<TimestampsOptions, 'timestampGenerator'> = {}) {
  return timestampsPlugin({
    ...options,
    timestampGenerator: () => new Date().toISOString()
  })
}

/**
 * Create timestamps plugin for Unix timestamps (seconds since epoch)
 */
export function timestampsPluginUnix(options: Omit<TimestampsOptions, 'timestampGenerator'> = {}) {
  return timestampsPlugin({
    ...options,
    timestampGenerator: () => Math.floor(Date.now() / 1000) as any
  })
}

/**
 * Type helper for tables with timestamps
 */
export interface Timestamped {
  created_at: Date | string
  updated_at?: Date | string | null
}

/**
 * Type helper to exclude timestamp fields from input types
 */
export type WithoutTimestamps<T> = Omit<T, 'created_at' | 'updated_at'>