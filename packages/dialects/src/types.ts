/**
 * @kysera/dialects - Type Definitions
 *
 * Dialect-specific types and interfaces for database operations
 */

import type { Kysely } from 'kysely';

/**
 * Supported database dialects
 */
export type DatabaseDialect = 'postgres' | 'mysql' | 'sqlite';

/**
 * Database connection configuration
 */
export interface ConnectionConfig {
  host?: string | undefined;
  port?: number | undefined;
  database: string;
  user?: string | undefined;
  password?: string | undefined;
  ssl?: boolean | undefined;
}

/**
 * Interface for dialect-specific operations
 */
export interface DialectAdapter {
  /** The dialect this adapter handles */
  readonly dialect: DatabaseDialect;

  /** Get default port for this dialect */
  getDefaultPort(): number | null;

  /** Get SQL expression for current timestamp */
  getCurrentTimestamp(): string;

  /** Escape identifier for this dialect */
  escapeIdentifier(identifier: string): string;

  /** Format date for this dialect */
  formatDate(date: Date): string;

  /** Check if error is a unique constraint violation */
  isUniqueConstraintError(error: unknown): boolean;

  /** Check if error is a foreign key constraint violation */
  isForeignKeyError(error: unknown): boolean;

  /** Check if error is a not-null constraint violation */
  isNotNullError(error: unknown): boolean;

  /** Check if a table exists in the database */
  tableExists(db: Kysely<any>, tableName: string): Promise<boolean>;

  /** Get column names for a table */
  getTableColumns(db: Kysely<any>, tableName: string): Promise<string[]>;

  /** Get all tables in the database */
  getTables(db: Kysely<any>): Promise<string[]>;

  /** Get database size in bytes */
  getDatabaseSize(db: Kysely<any>, databaseName?: string): Promise<number>;

  /** Truncate a single table */
  truncateTable(db: Kysely<any>, tableName: string): Promise<void>;

  /** Truncate all tables (for testing) */
  truncateAllTables(db: Kysely<any>, exclude?: string[]): Promise<void>;
}

/**
 * Error object shape for database error detection
 */
export interface DatabaseErrorLike {
  message?: string;
  code?: string;
}
