import type { Kysely, Transaction } from 'kysely'

/**
 * Union type representing either a Kysely database instance or a transaction.
 *
 * This type is fundamental to Kysera's architecture, allowing functions to work
 * seamlessly with both regular database connections and transactions. This enables
 * type-safe transaction composition without code duplication.
 *
 * @template DB - The database schema type
 *
 * @example
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
 *   // ... more operations in transaction
 * })
 * ```
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
 * This type extracts the types that can be selected from a database table,
 * respecting Kysely's column type system. For columns with generated values
 * or custom types, it uses the `__select__` type; otherwise, it uses the
 * column type directly.
 *
 * @template T - The table schema type
 *
 * @example
 * ```typescript
 * import type { Selectable, Generated } from '@kysera/core'
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
 * This type extracts the types required for INSERT operations, respecting
 * generated values, defaults, and column constraints. For columns with
 * custom insert types, it uses the `__insert__` type; otherwise, it uses
 * the column type directly.
 *
 * @template T - The table schema type
 *
 * @example
 * ```typescript
 * import type { Insertable, Generated } from '@kysera/core'
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
 * This type extracts the types allowed for UPDATE operations, respecting
 * immutable columns and custom update constraints. For columns with custom
 * update types, it uses the `__update__` type; otherwise, it uses the
 * column type directly.
 *
 * @template T - The table schema type
 *
 * @example
 * ```typescript
 * import type { Updateable, Generated } from '@kysera/core'
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
