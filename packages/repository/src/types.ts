import type {
  Generated,
  Selectable as KyselySelectable,
  SelectQueryBuilder,
  InsertQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
  Transaction,
  Insertable,
  Updateable
} from 'kysely'

/**
 * Repository-specific type utilities
 */

/**
 * Remove Generated<> wrapper from types
 */
export type Unwrap<T> = T extends Generated<infer U> ? U : T

/**
 * Convert table type to domain type (removes Generated<>)
 */
export type DomainType<Table> = {
  [K in keyof Table]: Unwrap<Table[K]>
}

/**
 * Extract selectable fields from table
 */
export type EntityType<Table> = KyselySelectable<Table>

/**
 * Create input type (omit generated fields)
 */
export type CreateInput<Table> = {
  [K in keyof Table as Table[K] extends Generated<unknown> ? never : K]: Table[K]
}

/**
 * Update input type (all fields optional)
 */
export type UpdateInput<Table> = Partial<CreateInput<Table>>

/**
 * Generic database schema constraint
 * Ensures all tables have at least an id field
 */
export type DatabaseSchema = {
  [K: string]: {
    id: Generated<number> | number
    [key: string]: unknown
  }
}

/**
 * Type-safe table name constraint
 */
export type TableName<DB> = keyof DB & string

/**
 * Extract table type from database schema
 */
export type ExtractTable<DB, TN extends keyof DB> = DB[TN]

/**
 * Type-safe selectable row from a table
 */
export type SelectableRow<DB, TN extends keyof DB> = KyselySelectable<ExtractTable<DB, TN>>

/**
 * Type-safe insertable row into a table
 */
export type InsertableRow<DB, TN extends keyof DB> = Insertable<ExtractTable<DB, TN>>

/**
 * Type-safe updateable row in a table
 */
export type UpdateableRow<DB, TN extends keyof DB> = Updateable<ExtractTable<DB, TN>>

/**
 * Type helper for where conditions
 */
export type WhereConditions<DB, TN extends keyof DB> = Partial<SelectableRow<DB, TN>>

/**
 * Type guard for validating database results
 */
export function isValidRow<T>(value: unknown): value is T {
  return value !== null && typeof value === 'object'
}

/**
 * Type helper for transaction handling
 */
export type TransactionHandler<DB, R> = (trx: Transaction<DB>) => Promise<R>

/**
 * Type helper for plugin query builders
 *
 * Note: We use 'any' here intentionally because plugins need to work
 * with any database schema and Kysely's type system is too strict
 * for fully generic plugin interfaces.
 */
export type AnyQueryBuilder =
  | SelectQueryBuilder<any, any, any>
  | InsertQueryBuilder<any, any, any>
  | UpdateQueryBuilder<any, any, any, any>
  | DeleteQueryBuilder<any, any, any>