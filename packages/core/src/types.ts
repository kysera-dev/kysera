import type { Kysely, Transaction } from 'kysely'
import type { KyseraExecutorMarker } from '@kysera/executor'

/**
 * Supported database dialects across all Kysera packages.
 * Use this type for dialect-specific logic and configuration.
 *
 * @example
 * ```typescript
 * import type { Dialect } from '@kysera/core'
 *
 * function getDefaultPort(dialect: Dialect): number {
 *   switch (dialect) {
 *     case 'postgres': return 5432
 *     case 'mysql': return 3306
 *     case 'sqlite': return 0 // file-based
 *     case 'mssql': return 1433
 *   }
 * }
 * ```
 */
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql'

/**
 * Union type representing either a Kysely database instance or a transaction.
 *
 * This type is fundamental to Kysera's architecture, allowing functions to work
 * seamlessly with both regular database connections and transactions. This enables
 * type-safe transaction composition without code duplication.
 *
 * **Note**: This type intentionally excludes KyseraExecutor/KyseraTransaction to avoid
 * TypeScript union type complexity that breaks query builder type inference. When working
 * with plugin-aware executors, use `AnyExecutor<DB>` from this package or import the
 * specific executor types from `@kysera/executor`.
 *
 * @template DB - The database schema type
 *
 * @example Basic usage
 * ```typescript
 * import type { Executor } from '@kysera/core'
 * import type { Database } from './database'
 *
 * // Function that works with both db and transactions
 * async function getUser(
 *   executor: Executor<Database>,
 *   userId: string
 * ) {
 *   return executor
 *     .selectFrom('users')
 *     .where('id', '=', userId)
 *     .selectAll()
 *     .executeTakeFirst()
 * }
 *
 * // Use with database
 * const user = await getUser(db, '123')
 *
 * // Use with transaction
 * await db.transaction(async (trx) => {
 *   const user = await getUser(trx, '123')
 * })
 * ```
 *
 * @example With plugin-aware executors - use AnyExecutor
 * ```typescript
 * import type { AnyExecutor } from '@kysera/core'
 * import type { Database } from './database'
 * import { createExecutor } from '@kysera/executor'
 *
 * // Use AnyExecutor for functions that accept plugin-aware executors
 * async function getUser(
 *   executor: AnyExecutor<Database>,
 *   userId: string
 * ) {
 *   return executor
 *     .selectFrom('users')
 *     .where('id', '=', userId)
 *     .selectAll()
 *     .executeTakeFirst()
 * }
 *
 * const kyseraDb = await createExecutor(db, plugins)
 * const user = await getUser(kyseraDb, '123') // ✓ Works!
 * ```
 *
 * @see AnyExecutor For working with plugin-aware executors
 */
export type Executor<DB> = Kysely<DB> | Transaction<DB>

/**
 * Query metrics data.
 * Used by @kysera/debug and @kysera/infra for tracking query performance.
 */
export interface QueryMetrics {
  /** SQL query string */
  sql: string
  /** Query parameters */
  params?: unknown[]
  /** Query execution duration in milliseconds */
  duration: number
  /** Timestamp when query was executed */
  timestamp: number
}

/**
 * Common database column types
 */
export interface Timestamps {
  created_at: Date
  updated_at?: Date
}

export interface SoftDelete {
  deleted_at: Date | null
}

export interface AuditFields {
  created_by?: number
  updated_by?: number
}

/**
 * Utility type to extract selectable (read) type from a table definition.
 *
 * @deprecated **DEPRECATED in v0.7.0 - Will be removed in v1.0.0**
 *
 * Use Kysely's built-in `Selectable` type instead:
 * ```typescript
 * import type { Selectable } from 'kysely'
 * ```
 *
 * **Why deprecated?**
 * This custom implementation differs from Kysely's actual type handling,
 * particularly for `Generated<T>` and `ColumnType<S, I, U>` columns.
 * Kysely's native types provide correct behavior and better type inference.
 *
 * **Migration path:**
 * ```typescript
 * // Before (deprecated - will break in v1.0.0)
 * import type { Selectable } from '@kysera/core'
 *
 * // After (recommended - use Kysely's native type)
 * import type { Selectable } from 'kysely'
 * ```
 *
 * **Breaking change warning:**
 * This type will be removed in v1.0.0. Please migrate to Kysely's `Selectable` type.
 * TypeScript will show this deprecation warning at compile time.
 *
 * @template T - The table schema type
 *
 * @example
 * ```typescript
 * import type { Selectable, Generated } from 'kysely'
 *
 * // Table definition
 * interface UsersTable {
 *   id: Generated<number>
 *   email: string
 *   created_at: ColumnType<Date, string | undefined, never>
 * }
 *
 * interface Database {
 *   users: UsersTable
 * }
 *
 * // Selectable type extracts what you get from SELECT queries
 * type User = Selectable<UsersTable>
 * // Result: { id: number; email: string; created_at: Date }
 *
 * // Use in function return types
 * async function getUser(id: number): Promise<User | undefined> {
 *   return db
 *     .selectFrom('users')
 *     .where('id', '=', id)
 *     .selectAll()
 *     .executeTakeFirst()
 * }
 * ```
 */
export type Selectable<T> = {
  [K in keyof T]: T[K] extends { __select__: infer S } ? S : T[K]
}

/**
 * Utility type to extract insertable (create) type from a table definition.
 *
 * @deprecated **DEPRECATED in v0.7.0 - Will be removed in v1.0.0**
 *
 * Use Kysely's built-in `Insertable` type instead:
 * ```typescript
 * import type { Insertable } from 'kysely'
 * ```
 *
 * **Why deprecated?**
 * This custom implementation differs from Kysely's actual type handling,
 * particularly for `Generated<T>` and `ColumnType<S, I, U>` columns.
 * Kysely's native types provide correct behavior and better type inference.
 *
 * **Migration path:**
 * ```typescript
 * // Before (deprecated - will break in v1.0.0)
 * import type { Insertable } from '@kysera/core'
 *
 * // After (recommended - use Kysely's native type)
 * import type { Insertable } from 'kysely'
 * ```
 *
 * **Breaking change warning:**
 * This type will be removed in v1.0.0. Please migrate to Kysely's `Insertable` type.
 * TypeScript will show this deprecation warning at compile time.
 *
 * @template T - The table schema type
 *
 * @example
 * ```typescript
 * import type { Insertable, Generated } from 'kysely'
 *
 * // Table definition
 * interface UsersTable {
 *   id: Generated<number>
 *   email: string
 *   name: string
 *   created_at: ColumnType<Date, string | undefined, never>
 * }
 *
 * // Insertable type extracts what you provide for INSERT
 * type NewUser = Insertable<UsersTable>
 * // Result: { id?: number; email: string; name: string; created_at?: string }
 *
 * // Use in function parameter types
 * async function createUser(data: NewUser): Promise<User> {
 *   return db
 *     .insertInto('users')
 *     .values(data)
 *     .returningAll()
 *     .executeTakeFirstOrThrow()
 * }
 *
 * // Usage
 * const user = await createUser({
 *   email: 'alice@example.com',
 *   name: 'Alice'
 *   // id and created_at are optional (generated)
 * })
 * ```
 */
export type Insertable<T> = {
  [K in keyof T]: T[K] extends { __insert__: infer I } ? I : T[K]
}

/**
 * Utility type to extract updateable (modify) type from a table definition.
 *
 * @deprecated **DEPRECATED in v0.7.0 - Will be removed in v1.0.0**
 *
 * Use Kysely's built-in `Updateable` type instead:
 * ```typescript
 * import type { Updateable } from 'kysely'
 * ```
 *
 * **Why deprecated?**
 * This custom implementation differs from Kysely's actual type handling,
 * particularly for `Generated<T>` and `ColumnType<S, I, U>` columns.
 * Kysely's native types provide correct behavior and better type inference.
 *
 * **Migration path:**
 * ```typescript
 * // Before (deprecated - will break in v1.0.0)
 * import type { Updateable } from '@kysera/core'
 *
 * // After (recommended - use Kysely's native type)
 * import type { Updateable } from 'kysely'
 * ```
 *
 * **Breaking change warning:**
 * This type will be removed in v1.0.0. Please migrate to Kysely's `Updateable` type.
 * TypeScript will show this deprecation warning at compile time.
 *
 * @template T - The table schema type
 *
 * @example
 * ```typescript
 * import type { Updateable, Generated } from 'kysely'
 *
 * // Table definition
 * interface UsersTable {
 *   id: Generated<number>
 *   email: string
 *   name: string
 *   created_at: ColumnType<Date, string | undefined, never>  // never = not updateable
 *   updated_at: ColumnType<Date, string | undefined, string | undefined>
 * }
 *
 * // Updateable type extracts what you can update
 * type UserUpdate = Updateable<UsersTable>
 * // Result: { id?: number; email?: string; name?: string; updated_at?: string }
 * // Note: created_at is excluded (never type)
 *
 * // Use in function parameter types
 * async function updateUser(
 *   id: number,
 *   data: Partial<UserUpdate>
 * ): Promise<User> {
 *   return db
 *     .updateTable('users')
 *     .set(data)
 *     .where('id', '=', id)
 *     .returningAll()
 *     .executeTakeFirstOrThrow()
 * }
 *
 * // Usage
 * const user = await updateUser(1, {
 *   name: 'Alice Smith'
 *   // created_at cannot be updated
 * })
 * ```
 */
export type Updateable<T> = {
  [K in keyof T]: T[K] extends { __update__: infer U } ? U : T[K]
}

/**
 * Extended executor type that includes KyseraExecutor.
 * Use when working with plugin-aware executors.
 *
 * This type is designed to work with both raw Kysely instances
 * and plugin-wrapped executors from @kysera/executor.
 *
 * **Type Safety:** This type properly references `KyseraExecutorMarker` from
 * `@kysera/executor` to ensure type consistency across packages. It will
 * automatically stay in sync with any changes to the executor marker interface.
 *
 * @template DB - The database schema type
 * @see {@link @kysera/executor#KyseraExecutor}
 * @see {@link @kysera/executor#KyseraExecutorMarker}
 *
 * @example
 * ```typescript
 * import type { AnyExecutor } from '@kysera/core'
 * import type { Database } from './database'
 *
 * // Function that works with any executor type
 * async function getUser(
 *   executor: AnyExecutor<Database>,
 *   userId: string
 * ) {
 *   return executor
 *     .selectFrom('users')
 *     .where('id', '=', userId)
 *     .selectAll()
 *     .executeTakeFirst()
 * }
 * ```
 */
export type AnyExecutor<DB> = Kysely<DB> | Transaction<DB> | (Kysely<DB> & KyseraExecutorMarker<DB>)

/**
 * Shared configuration for plugins that need primary key identification.
 *
 * This interface provides a consistent way for plugins to specify which column(s)
 * serve as the primary key in database tables. Supports both single-column keys
 * (most common) and composite keys (multiple columns).
 *
 * **Used by:**
 * - `@kysera/soft-delete` - For identifying records to soft delete/restore
 * - `@kysera/audit` - For tracking record changes by primary key
 * - `@kysera/timestamps` - For touch() method to update timestamps by ID
 *
 * **Common Patterns:**
 * - Numeric IDs: `'id'` (auto-increment, most common)
 * - UUIDs: `'uuid'` or `'guid'` (string-based identifiers)
 * - Prefixed IDs: `'user_id'`, `'post_id'` (table-specific naming)
 * - Composite keys: `['organization_id', 'user_id']` (multi-column keys)
 *
 * @example Single column (default)
 * ```typescript
 * import type { PrimaryKeyConfig } from '@kysera/core'
 *
 * // Numeric auto-increment ID (most common)
 * const config: PrimaryKeyConfig = {
 *   primaryKeyColumn: 'id'  // Default
 * }
 *
 * // UUID primary key
 * const uuidConfig: PrimaryKeyConfig = {
 *   primaryKeyColumn: 'uuid'
 * }
 *
 * // Custom primary key name
 * const customConfig: PrimaryKeyConfig = {
 *   primaryKeyColumn: 'user_id'
 * }
 * ```
 *
 * @example Composite primary keys
 * ```typescript
 * // Multi-tenant applications
 * const multiTenantConfig: PrimaryKeyConfig = {
 *   primaryKeyColumn: ['organization_id', 'user_id']
 * }
 *
 * // Time-series data with composite key
 * const timeSeriesConfig: PrimaryKeyConfig = {
 *   primaryKeyColumn: ['device_id', 'timestamp']
 * }
 * ```
 *
 * @example Extending in plugins
 * ```typescript
 * import type { PrimaryKeyConfig } from '@kysera/core'
 *
 * interface MyPluginConfig extends PrimaryKeyConfig {
 *   // Plugin-specific options
 *   enabled: boolean
 *   customOption: string
 * }
 *
 * const pluginConfig: MyPluginConfig = {
 *   primaryKeyColumn: 'id',  // From PrimaryKeyConfig
 *   enabled: true,
 *   customOption: 'value'
 * }
 * ```
 */
export interface PrimaryKeyConfig {
  /**
   * Name of the primary key column(s) used for identifying records
   *
   * **Single column (most common):**
   * - `'id'` - Auto-increment integer (default)
   * - `'uuid'` - UUID/GUID string
   * - `'<table>_id'` - Prefixed ID (e.g., 'user_id')
   *
   * **Composite keys (advanced):**
   * - `['org_id', 'user_id']` - Multi-column primary key
   * - `['device_id', 'timestamp']` - Time-series composite key
   *
   * **Requirements:**
   * - Column(s) must exist in all tables where the plugin is applied
   * - Column values must be unique (enforced by PRIMARY KEY constraint)
   * - Supports both numeric and string types
   * - For composite keys, all columns must be present
   *
   * @default 'id'
   *
   * @example
   * ```typescript
   * // Single column (default)
   * primaryKeyColumn: 'id'
   *
   * // UUID key
   * primaryKeyColumn: 'uuid'
   *
   * // Composite key (multi-tenant)
   * primaryKeyColumn: ['organization_id', 'user_id']
   * ```
   */
  primaryKeyColumn?: string | string[]
}
