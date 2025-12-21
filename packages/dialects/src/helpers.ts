/**
 * Dialect Helper Functions
 *
 * Standalone helper functions that accept dialect as parameter
 * for backward compatibility with existing code.
 */

import type { Kysely } from 'kysely';
import type { DatabaseDialect } from './types.js';
import { getAdapter } from './factory.js';

/**
 * Check if table exists in the database
 *
 * @example
 * const exists = await tableExists(db, 'users', 'postgres');
 */
export async function tableExists(db: Kysely<any>, tableName: string, dialect: DatabaseDialect): Promise<boolean> {
  return getAdapter(dialect).tableExists(db, tableName);
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
  dialect: DatabaseDialect
): Promise<string[]> {
  return getAdapter(dialect).getTableColumns(db, tableName);
}

/**
 * Get all tables in the database
 *
 * @example
 * const tables = await getTables(db, 'postgres');
 * // ['users', 'posts', 'comments']
 */
export async function getTables(db: Kysely<any>, dialect: DatabaseDialect): Promise<string[]> {
  return getAdapter(dialect).getTables(db);
}

/**
 * Escape identifier for SQL (table names, column names, etc.)
 *
 * @example
 * escapeIdentifier('my-table', 'postgres') // '"my-table"'
 * escapeIdentifier('my-table', 'mysql')    // '`my-table`'
 */
export function escapeIdentifier(identifier: string, dialect: DatabaseDialect): string {
  return getAdapter(dialect).escapeIdentifier(identifier);
}

/**
 * Get SQL expression for current timestamp
 *
 * @example
 * getCurrentTimestamp('postgres') // 'CURRENT_TIMESTAMP'
 * getCurrentTimestamp('sqlite')   // "datetime('now')"
 */
export function getCurrentTimestamp(dialect: DatabaseDialect): string {
  return getAdapter(dialect).getCurrentTimestamp();
}

/**
 * Format date for database insertion
 *
 * @example
 * formatDate(new Date(), 'postgres') // '2024-01-15T10:30:00.000Z'
 * formatDate(new Date(), 'mysql')    // '2024-01-15 10:30:00'
 */
export function formatDate(date: Date, dialect: DatabaseDialect): string {
  return getAdapter(dialect).formatDate(date);
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
export function isUniqueConstraintError(error: unknown, dialect: DatabaseDialect): boolean {
  return getAdapter(dialect).isUniqueConstraintError(error);
}

/**
 * Check if error is a foreign key constraint violation
 *
 * @example
 * if (isForeignKeyError(error, 'mysql')) {
 *   console.log('Referenced row does not exist');
 * }
 */
export function isForeignKeyError(error: unknown, dialect: DatabaseDialect): boolean {
  return getAdapter(dialect).isForeignKeyError(error);
}

/**
 * Check if error is a not-null constraint violation
 *
 * @example
 * if (isNotNullError(error, 'sqlite')) {
 *   console.log('Required field is missing');
 * }
 */
export function isNotNullError(error: unknown, dialect: DatabaseDialect): boolean {
  return getAdapter(dialect).isNotNullError(error);
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
  dialect: DatabaseDialect,
  databaseName?: string
): Promise<number> {
  return getAdapter(dialect).getDatabaseSize(db, databaseName);
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
  dialect: DatabaseDialect,
  exclude: string[] = []
): Promise<void> {
  return getAdapter(dialect).truncateAllTables(db, exclude);
}
