/**
 * Dialect Helper Functions
 *
 * Standalone helper functions that accept dialect as parameter
 * for backward compatibility with existing code.
 */

import type { Kysely } from 'kysely'
import type { Dialect } from './types.js'
import { getAdapter } from './factory.js'

/**
 * Maximum allowed length for SQL identifiers
 */
const MAX_IDENTIFIER_LENGTH = 128

/**
 * Pattern for valid SQL identifiers
 * Allows alphanumeric, underscore, and dot for schema.table notation
 */
const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]*$/

/**
 * Validate a SQL identifier (table name, column name, etc.)
 *
 * @param name - The identifier to validate
 * @returns true if the identifier is valid, false otherwise
 *
 * @example
 * validateIdentifier('users')           // true
 * validateIdentifier('public.users')    // true
 * validateIdentifier('_private_table')  // true
 * validateIdentifier('123invalid')      // false (starts with number)
 * validateIdentifier('table-name')      // false (contains hyphen)
 * validateIdentifier('')                // false (empty)
 */
export function validateIdentifier(name: string): boolean {
  if (!name || name.length > MAX_IDENTIFIER_LENGTH) {
    return false
  }
  return IDENTIFIER_PATTERN.test(name)
}

/**
 * Assert that an identifier is valid, throwing an error if not
 *
 * @param name - The identifier to validate
 * @param context - Optional context for the error message (e.g., 'table name', 'column name')
 * @throws Error if the identifier is invalid
 *
 * @example
 * assertValidIdentifier('users', 'table name');  // passes
 * assertValidIdentifier('123bad', 'table name'); // throws Error: Invalid table name: 123bad
 */
export function assertValidIdentifier(name: string, context = 'identifier'): void {
  if (!validateIdentifier(name)) {
    throw new Error(`Invalid ${context}: ${name}`)
  }
}

/**
 * Check if table exists in the database
 *
 * @example
 * const exists = await tableExists(db, 'users', 'postgres');
 */
export async function tableExists(
  db: Kysely<any>,
  tableName: string,
  dialect: Dialect
): Promise<boolean> {
  return await getAdapter(dialect).tableExists(db, tableName)
}

/**
 * Get column names for a table
 *
 * @example
 * const columns = await getTableColumns(db, 'users', 'postgres');
 * // ['id', 'name', 'email', 'created_at']
 */
export async function getTableColumns(
  db: Kysely<any>,
  tableName: string,
  dialect: Dialect
): Promise<string[]> {
  return await getAdapter(dialect).getTableColumns(db, tableName)
}

/**
 * Get all tables in the database
 *
 * @example
 * const tables = await getTables(db, 'postgres');
 * // ['users', 'posts', 'comments']
 */
export async function getTables(db: Kysely<any>, dialect: Dialect): Promise<string[]> {
  return await getAdapter(dialect).getTables(db)
}

/**
 * Escape identifier for SQL (table names, column names, etc.)
 *
 * @example
 * escapeIdentifier('my-table', 'postgres') // '"my-table"'
 * escapeIdentifier('my-table', 'mysql')    // '`my-table`'
 */
export function escapeIdentifier(identifier: string, dialect: Dialect): string {
  return getAdapter(dialect).escapeIdentifier(identifier)
}

/**
 * Get SQL expression for current timestamp
 *
 * @example
 * getCurrentTimestamp('postgres') // 'CURRENT_TIMESTAMP'
 * getCurrentTimestamp('sqlite')   // "datetime('now')"
 */
export function getCurrentTimestamp(dialect: Dialect): string {
  return getAdapter(dialect).getCurrentTimestamp()
}

/**
 * Format date for database insertion
 *
 * @example
 * formatDate(new Date(), 'postgres') // '2024-01-15T10:30:00.000Z'
 * formatDate(new Date(), 'mysql')    // '2024-01-15 10:30:00'
 */
export function formatDate(date: Date, dialect: Dialect): string {
  return getAdapter(dialect).formatDate(date)
}

/**
 * Check if error is a unique constraint violation
 *
 * @example
 * try {
 *   await db.insertInto('users').values({ email: 'duplicate@example.com' }).execute();
 * } catch (error) {
 *   if (isUniqueConstraintError(error, 'postgres')) {
 *     console.log('Email already exists');
 *   }
 * }
 */
export function isUniqueConstraintError(error: unknown, dialect: Dialect): boolean {
  return getAdapter(dialect).isUniqueConstraintError(error)
}

/**
 * Check if error is a foreign key constraint violation
 *
 * @example
 * if (isForeignKeyError(error, 'mysql')) {
 *   console.log('Referenced row does not exist');
 * }
 */
export function isForeignKeyError(error: unknown, dialect: Dialect): boolean {
  return getAdapter(dialect).isForeignKeyError(error)
}

/**
 * Check if error is a not-null constraint violation
 *
 * @example
 * if (isNotNullError(error, 'sqlite')) {
 *   console.log('Required field is missing');
 * }
 */
export function isNotNullError(error: unknown, dialect: Dialect): boolean {
  return getAdapter(dialect).isNotNullError(error)
}

/**
 * Get database size in bytes
 *
 * @example
 * const size = await getDatabaseSize(db, 'postgres');
 * console.log(`Database size: ${size} bytes`);
 */
export async function getDatabaseSize(
  db: Kysely<any>,
  dialect: Dialect,
  databaseName?: string
): Promise<number> {
  return await getAdapter(dialect).getDatabaseSize(db, databaseName)
}

/**
 * Truncate all tables in the database (useful for testing)
 *
 * @example
 * // Truncate all tables except migrations
 * await truncateAllTables(db, 'postgres', ['kysely_migrations']);
 */
export async function truncateAllTables(
  db: Kysely<any>,
  dialect: Dialect,
  exclude: string[] = []
): Promise<void> {
  await getAdapter(dialect).truncateAllTables(db, exclude)
}
