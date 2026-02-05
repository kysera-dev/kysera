/**
 * @kysera/dialects
 *
 * Dialect-specific utilities for Kysely database operations.
 * Supports PostgreSQL, MySQL, SQLite, and MSSQL with a unified adapter interface.
 *
 * @example
 * // Using the adapter interface
 * import { getAdapter, createDialectAdapter } from '@kysera/dialects';
 *
 * // Get default adapter (uses 'public' schema for postgres)
 * const adapter = getAdapter('postgres');
 * const exists = await adapter.tableExists(db, 'users');
 *
 * // Create adapter with custom default schema
 * const authAdapter = createDialectAdapter('postgres', { defaultSchema: 'auth' });
 * const authTables = await authAdapter.getTables(db);
 *
 * // Override schema per-call
 * const adminTables = await adapter.getTables(db, { schema: 'admin' });
 *
 * @example
 * // PostgreSQL schema management
 * import { PostgresAdapter, createPostgresAdapter } from '@kysera/dialects';
 *
 * const adapter = createPostgresAdapter({ defaultSchema: 'public' });
 *
 * // Schema operations (PostgreSQL/MSSQL only)
 * await adapter.createSchema(db, 'tenant_123');
 * const schemas = await adapter.getSchemas(db);
 * await adapter.dropSchema(db, 'tenant_123', { cascade: true });
 *
 * @example
 * // Using helper functions (backward compatible)
 * import { tableExists, escapeIdentifier, isUniqueConstraintError } from '@kysera/dialects';
 *
 * const exists = await tableExists(db, 'users', 'postgres');
 * const existsInAuth = await tableExists(db, 'users', 'postgres', { schema: 'auth' });
 * const escaped = escapeIdentifier('user-data', 'mysql');
 *
 * @example
 * // Connection URL utilities
 * import { parseConnectionUrl, buildConnectionUrl } from '@kysera/dialects';
 *
 * const config = parseConnectionUrl('postgresql://user:pass@localhost:5432/mydb');
 * const url = buildConnectionUrl('postgres', { host: 'localhost', database: 'mydb' });
 */

// Types - Dialect is the canonical type from @kysera/core
export type {
  Dialect,
  ConnectionConfig,
  DialectAdapter,
  DialectAdapterOptions,
  SchemaOptions,
  DatabaseErrorLike
} from './types.js'

// Factory and adapters
export {
  getAdapter,
  createDialectAdapter,
  registerAdapter,
  type AdapterOptions
} from './factory.js'

// PostgreSQL adapter with schema management
export {
  PostgresAdapter,
  postgresAdapter,
  createPostgresAdapter,
  type PostgresAdapterOptions
} from './adapters/postgres.js'

// MySQL adapter
export {
  MySQLAdapter,
  mysqlAdapter,
  createMySQLAdapter,
  type MySQLAdapterOptions
} from './adapters/mysql.js'

// SQLite adapter
export {
  SQLiteAdapter,
  sqliteAdapter,
  createSQLiteAdapter,
  type SQLiteAdapterOptions
} from './adapters/sqlite.js'

// MSSQL adapter with schema management
export {
  MSSQLAdapter,
  mssqlAdapter,
  createMSSQLAdapter,
  type MSSQLAdapterOptions
} from './adapters/mssql.js'

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
  truncateAllTables,
  // Schema utilities
  resolveSchema,
  qualifyTableName,
  // Multi-tenant utilities
  getTenantSchemaName,
  parseTenantSchemaName,
  isTenantSchema,
  filterTenantSchemas,
  extractTenantIds,
  type TenantSchemaConfig,
  type SchemaCopyOptions,
  // Error detection utilities
  extractErrorInfo,
  createErrorMatcher,
  errorMatchers,
  type ExtractedErrorInfo,
  type ErrorMatcherConfig
} from './helpers.js'
