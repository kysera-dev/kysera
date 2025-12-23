/**
 * @kysera/dialects
 *
 * Dialect-specific utilities for Kysely database operations.
 * Supports PostgreSQL, MySQL, and SQLite with a unified adapter interface.
 *
 * @example
 * // Using the adapter interface
 * import { getAdapter } from '@kysera/dialects';
 *
 * const adapter = getAdapter('postgres');
 * const exists = await adapter.tableExists(db, 'users');
 * const columns = await adapter.getTableColumns(db, 'users');
 *
 * @example
 * // Using helper functions (backward compatible)
 * import { tableExists, escapeIdentifier, isUniqueConstraintError } from '@kysera/dialects';
 *
 * const exists = await tableExists(db, 'users', 'postgres');
 * const escaped = escapeIdentifier('user-data', 'mysql');
 *
 * @example
 * // Connection URL utilities
 * import { parseConnectionUrl, buildConnectionUrl } from '@kysera/dialects';
 *
 * const config = parseConnectionUrl('postgresql://user:pass@localhost:5432/mydb');
 * const url = buildConnectionUrl('postgres', { host: 'localhost', database: 'mydb' });
 */

// Types
export type {
  DatabaseDialect,
  ConnectionConfig,
  DialectAdapter,
  DatabaseErrorLike
} from './types.js'

// Factory and adapters
export { getAdapter, createDialectAdapter, registerAdapter } from './factory.js'
export { PostgresAdapter, postgresAdapter } from './adapters/postgres.js'
export { MySQLAdapter, mysqlAdapter } from './adapters/mysql.js'
export { SQLiteAdapter, sqliteAdapter } from './adapters/sqlite.js'

// Connection utilities
export { parseConnectionUrl, buildConnectionUrl, getDefaultPort } from './connection.js'

// Helper functions (standalone, backward compatible)
export {
  validateIdentifier,
  assertValidIdentifier,
  tableExists,
  getTableColumns,
  getTables,
  escapeIdentifier,
  getCurrentTimestamp,
  formatDate,
  isUniqueConstraintError,
  isForeignKeyError,
  isNotNullError,
  getDatabaseSize,
  truncateAllTables
} from './helpers.js'
