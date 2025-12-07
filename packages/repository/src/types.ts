import type {
  Generated,
  Selectable as KyselySelectable,
  SelectQueryBuilder,
  InsertQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
  Transaction,
  Insertable,
  Updateable,
} from 'kysely';

/**
 * Repository-specific type utilities
 */

/**
 * Primary key value types supported by the repository
 */
export type PrimaryKeyValue = string | number;

/**
 * Primary key column name(s)
 * - Single string for simple primary keys (e.g., 'id', 'user_id', 'uuid')
 * - String array for composite primary keys (e.g., ['tenant_id', 'user_id'])
 */
export type PrimaryKeyColumn = string | string[];

/**
 * Primary key type hints for proper handling
 * - 'number': Auto-incrementing integer IDs (default)
 * - 'string': String-based IDs
 * - 'uuid': UUID strings (handled specially for generation)
 */
export type PrimaryKeyTypeHint = 'number' | 'string' | 'uuid';

/**
 * Composite primary key value type
 * Maps column names to their values
 */
export type CompositeKeyValue = Record<string, PrimaryKeyValue>;

/**
 * Primary key input type - can be a single value or composite key object
 */
export type PrimaryKeyInput = PrimaryKeyValue | CompositeKeyValue;

/**
 * Primary key configuration for a repository
 */
export interface PrimaryKeyConfig {
  /** Column name(s) for the primary key. Default: 'id' */
  columns: PrimaryKeyColumn;
  /** Type hint for the primary key. Default: 'number' */
  type: PrimaryKeyTypeHint;
}

/**
 * Normalize primary key configuration from various input formats
 */
export function normalizePrimaryKeyConfig(
  primaryKey?: PrimaryKeyColumn,
  primaryKeyType?: PrimaryKeyTypeHint
): PrimaryKeyConfig {
  return {
    columns: primaryKey ?? 'id',
    type: primaryKeyType ?? 'number',
  };
}

/**
 * Check if a primary key is composite (multi-column)
 */
export function isCompositeKey(columns: PrimaryKeyColumn): columns is string[] {
  return Array.isArray(columns);
}

/**
 * Get primary key columns as an array (normalizes single column to array)
 */
export function getPrimaryKeyColumns(columns: PrimaryKeyColumn): string[] {
  return isCompositeKey(columns) ? columns : [columns];
}

/**
 * Normalize primary key input to a record format
 */
export function normalizePrimaryKeyInput(
  columns: PrimaryKeyColumn,
  input: PrimaryKeyInput
): CompositeKeyValue {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return input;
  }

  // Single value with single column
  if (!isCompositeKey(columns)) {
    return { [columns]: input as PrimaryKeyValue };
  }

  throw new Error(
    'Composite primary key requires an object with keys: ' + columns.join(', ')
  );
}

/**
 * Remove Generated<> wrapper from types
 */
export type Unwrap<T> = T extends Generated<infer U> ? U : T;

/**
 * Convert table type to domain type (removes Generated<>)
 */
export type DomainType<Table> = {
  [K in keyof Table]: Unwrap<Table[K]>;
};

/**
 * Extract selectable fields from table
 */
export type EntityType<Table> = KyselySelectable<Table>;

/**
 * Create input type (omit generated fields)
 */
export type CreateInput<Table> = {
  [K in keyof Table as Table[K] extends Generated<unknown> ? never : K]: Table[K];
};

/**
 * Update input type (all fields optional)
 */
export type UpdateInput<Table> = Partial<CreateInput<Table>>;

/**
 * Generic database schema constraint
 * Tables can have any primary key, not just 'id'
 */
export type DatabaseSchema = {
  [K: string]: {
    [key: string]: unknown;
  };
};

/**
 * Type-safe table name constraint
 */
export type TableName<DB> = keyof DB & string;

/**
 * Extract table type from database schema
 */
export type ExtractTable<DB, TN extends keyof DB> = DB[TN];

/**
 * Type-safe selectable row from a table
 */
export type SelectableRow<DB, TN extends keyof DB> = KyselySelectable<ExtractTable<DB, TN>>;

/**
 * Type-safe insertable row into a table
 */
export type InsertableRow<DB, TN extends keyof DB> = Insertable<ExtractTable<DB, TN>>;

/**
 * Type-safe updateable row in a table
 */
export type UpdateableRow<DB, TN extends keyof DB> = Updateable<ExtractTable<DB, TN>>;

/**
 * Type helper for where conditions
 */
export type WhereConditions<DB, TN extends keyof DB> = Partial<SelectableRow<DB, TN>>;

/**
 * Type guard for validating database results
 */
export function isValidRow<T>(value: unknown): value is T {
  return value !== null && typeof value === 'object';
}

/**
 * Type helper for transaction handling
 */
export type TransactionHandler<DB, R> = (trx: Transaction<DB>) => Promise<R>;

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
  | DeleteQueryBuilder<any, any, any>;
