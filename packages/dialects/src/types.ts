/**
 * @kysera/dialects - Type Definitions
 *
 * Dialect-specific types and interfaces for database operations
 */

import type { Kysely } from 'kysely'
import type { Dialect } from '@kysera/core'

// Re-export Dialect from core for convenience
export type { Dialect }

/**
 * Database connection configuration
 */
export interface ConnectionConfig {
  host?: string | undefined
  port?: number | undefined
  database: string
  user?: string | undefined
  password?: string | undefined
  ssl?: boolean | undefined
}

/**
 * Options for schema-aware database operations.
 *
 * @example
 * // PostgreSQL: Query tables in a specific schema
 * await adapter.tableExists(db, 'users', { schema: 'auth' })
 *
 * @example
 * // Multi-tenant: Query tables in tenant-specific schema
 * await adapter.getTables(db, { schema: `tenant_${tenantId}` })
 */
export interface SchemaOptions {
  /**
   * Schema name for the operation.
   *
   * - PostgreSQL: Defaults to 'public' if not specified
   * - MySQL: Uses DATABASE() (schema = database in MySQL)
   * - SQLite: Not supported (single schema only)
   * - MSSQL: Defaults to 'dbo' if not specified
   */
  schema?: string
}

/**
 * Configuration options for creating dialect adapters
 */
export interface DialectAdapterOptions {
  /**
   * Default schema for all operations.
   * Can be overridden per-call via SchemaOptions.
   *
   * - PostgreSQL: Defaults to 'public'
   * - MySQL: Uses current database
   * - SQLite: Not applicable
   * - MSSQL: Defaults to 'dbo'
   */
  defaultSchema?: string
}

/**
 * Interface for dialect-specific operations
 */
export interface DialectAdapter {
  /** The dialect this adapter handles */
  readonly dialect: Dialect

  /**
   * Default schema for this adapter.
   * Used when SchemaOptions.schema is not specified.
   */
  readonly defaultSchema: string

  /** Get default port for this dialect */
  getDefaultPort(): number | null

  /** Get SQL expression for current timestamp */
  getCurrentTimestamp(): string

  /** Escape identifier for this dialect */
  escapeIdentifier(identifier: string): string

  /** Format date for this dialect */
  formatDate(date: Date): string

  /** Check if error is a unique constraint violation */
  isUniqueConstraintError(error: unknown): boolean

  /** Check if error is a foreign key constraint violation */
  isForeignKeyError(error: unknown): boolean

  /** Check if error is a not-null constraint violation */
  isNotNullError(error: unknown): boolean

  /**
   * Check if a table exists in the database
   *
   * @param db - Kysely database instance
   * @param tableName - Name of the table to check
   * @param options - Optional schema configuration
   * @returns true if table exists, false otherwise
   *
   * @example
   * // Check in default schema (public)
   * await adapter.tableExists(db, 'users')
   *
   * @example
   * // Check in specific schema
   * await adapter.tableExists(db, 'users', { schema: 'auth' })
   */
  tableExists(db: Kysely<any>, tableName: string, options?: SchemaOptions): Promise<boolean>

  /**
   * Get column names for a table
   *
   * @param db - Kysely database instance
   * @param tableName - Name of the table
   * @param options - Optional schema configuration
   * @returns Array of column names
   *
   * @example
   * const columns = await adapter.getTableColumns(db, 'users', { schema: 'auth' })
   * // ['id', 'email', 'password_hash', 'created_at']
   */
  getTableColumns(db: Kysely<any>, tableName: string, options?: SchemaOptions): Promise<string[]>

  /**
   * Get all tables in the database/schema
   *
   * @param db - Kysely database instance
   * @param options - Optional schema configuration
   * @returns Array of table names
   *
   * @example
   * // Get tables in auth schema
   * const tables = await adapter.getTables(db, { schema: 'auth' })
   * // ['users', 'sessions', 'tokens']
   */
  getTables(db: Kysely<any>, options?: SchemaOptions): Promise<string[]>

  /** Get database size in bytes */
  getDatabaseSize(db: Kysely<any>, databaseName?: string): Promise<number>

  /**
   * Truncate a single table
   *
   * @param db - Kysely database instance
   * @param tableName - Name of the table to truncate
   * @param options - Optional schema configuration
   * @returns true if table was truncated, false if table does not exist
   * @throws Error for other database errors
   */
  truncateTable(db: Kysely<any>, tableName: string, options?: SchemaOptions): Promise<boolean>

  /**
   * Truncate all tables in the database/schema (for testing)
   *
   * @param db - Kysely database instance
   * @param exclude - Array of table names to exclude
   * @param options - Optional schema configuration
   */
  truncateAllTables(db: Kysely<any>, exclude?: string[], options?: SchemaOptions): Promise<void>
}

/**
 * Error object shape for database error detection
 */
export interface DatabaseErrorLike {
  message?: string
  code?: string
  /** Error number (used by MSSQL for error codes like 2627, 547, 515) */
  number?: number
}
