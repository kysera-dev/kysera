/**
 * Database error hierarchy with multi-database support
 *
 * Uses unified ErrorCodes from @kysera/core/error-codes for consistency
 * across the entire Kysera ecosystem.
 */

import { ErrorCodes, type ErrorCode } from './error-codes.js';

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode | string,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      detail: this.detail,
    };
  }
}

export class UniqueConstraintError extends DatabaseError {
  constructor(
    public readonly constraint: string,
    public readonly table: string,
    public readonly columns: string[]
  ) {
    super(`UNIQUE constraint violation on ${table}`, ErrorCodes.VALIDATION_UNIQUE_VIOLATION);
    this.name = 'UniqueConstraintError';
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      constraint: this.constraint,
      table: this.table,
      columns: this.columns,
    };
  }
}

export class ForeignKeyError extends DatabaseError {
  constructor(
    public readonly constraint: string,
    public readonly table: string,
    public readonly referencedTable: string
  ) {
    super(`FOREIGN KEY constraint violation`, ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION);
    this.name = 'ForeignKeyError';
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      constraint: this.constraint,
      table: this.table,
      referencedTable: this.referencedTable,
    };
  }
}

export class NotFoundError extends DatabaseError {
  constructor(entity: string, filters?: Record<string, unknown>) {
    const message = `${entity} not found`;
    const detail = filters ? JSON.stringify(filters) : undefined;
    super(message, ErrorCodes.RESOURCE_NOT_FOUND, detail);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends DatabaseError {
  constructor(message: string) {
    super(message, ErrorCodes.RESOURCE_BAD_REQUEST);
    this.name = 'BadRequestError';
  }
}

/**
 * Not Null constraint violation error
 */
export class NotNullError extends DatabaseError {
  constructor(
    public readonly column: string,
    public readonly table?: string
  ) {
    const tableInfo = table ? ` on table ${table}` : '';
    super(`NOT NULL constraint violation on column ${column}${tableInfo}`, ErrorCodes.VALIDATION_NOT_NULL_VIOLATION, column);
    this.name = 'NotNullError';
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      column: this.column,
      table: this.table,
    };
  }
}

/**
 * Check constraint violation error
 */
export class CheckConstraintError extends DatabaseError {
  constructor(
    public readonly constraint: string,
    public readonly table?: string
  ) {
    const tableInfo = table ? ` on table ${table}` : '';
    super(`CHECK constraint violation: ${constraint}${tableInfo}`, ErrorCodes.VALIDATION_CHECK_VIOLATION);
    this.name = 'CheckConstraintError';
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      constraint: this.constraint,
      table: this.table,
    };
  }
}

export type DatabaseDialect = 'postgres' | 'mysql' | 'sqlite';

/**
 * Multi-database error parser
 * Supports PostgreSQL, MySQL, and SQLite
 *
 * Uses unified ErrorCodes from @kysera/core/error-codes for consistent
 * error code formatting across all database dialects.
 */
export function parseDatabaseError(error: unknown, dialect: DatabaseDialect = 'postgres'): DatabaseError {
  if (!error || typeof error !== 'object') {
    return new DatabaseError('Unknown database error', ErrorCodes.DB_UNKNOWN);
  }

  const dbError = error as any;

  // PostgreSQL error handling
  if (dialect === 'postgres' && 'code' in dbError) {
    switch (dbError.code) {
      case '23505': // unique_violation
        // Extract columns from detail message: "Key (email)=(value) already exists."
        const detailMatch = dbError.detail?.match(/Key \(([^)]+)\)=/);
        const columns = detailMatch
          ? detailMatch[1].split(',').map((col: string) => col.trim())
          : dbError.columns || [];

        return new UniqueConstraintError(dbError.constraint || 'unique', dbError.table || 'unknown', columns);

      case '23503': // foreign_key_violation
        return new ForeignKeyError(
          dbError.constraint || 'foreign_key',
          dbError.table || 'unknown',
          dbError.detail?.match(/table "(.+?)"/)?.[1] || 'unknown'
        );

      case '23502': // not_null_violation
        return new NotNullError(dbError.column || 'unknown', dbError.table);

      case '23514': // check_violation
        return new CheckConstraintError(dbError.constraint || 'unknown', dbError.table);

      default:
        return new DatabaseError(dbError.message || 'Database error', dbError.code || ErrorCodes.DB_UNKNOWN);
    }
  }

  // MySQL error handling
  if (dialect === 'mysql' && 'code' in dbError) {
    switch (dbError.code) {
      case 'ER_DUP_ENTRY':
      case 'ER_DUP_KEY':
        // Parse MySQL duplicate entry error
        // Format: "Duplicate entry 'value' for key 'table.column'" or "'constraint_name'"
        const dupMatch = dbError.sqlMessage?.match(/Duplicate entry '(.+?)' for key '(.+?)'/);
        const constraintName = dupMatch?.[2] || 'unique';

        // Extract column name from constraint (format: "table.column" or "column")
        const columnMatch = constraintName.match(/\.([^.]+)$/) || constraintName.match(/^([^.]+)$/);
        const mysqlColumns = columnMatch ? [columnMatch[1]] : [];

        return new UniqueConstraintError(
          constraintName,
          'unknown', // MySQL doesn't provide table name easily
          mysqlColumns
        );

      case 'ER_NO_REFERENCED_ROW':
      case 'ER_NO_REFERENCED_ROW_2':
      case 'ER_ROW_IS_REFERENCED':
      case 'ER_ROW_IS_REFERENCED_2':
        return new ForeignKeyError('foreign_key', 'unknown', 'unknown');

      case 'ER_BAD_NULL_ERROR':
        const nullMatch = dbError.sqlMessage?.match(/Column '(.+?)' cannot be null/);
        const columnName = nullMatch?.[1] || 'unknown';
        return new NotNullError(columnName);

      case 'ER_NO_DEFAULT_FOR_FIELD':
        // MySQL 8.0+ uses this error code instead of ER_BAD_NULL_ERROR
        const fieldMatch = dbError.sqlMessage?.match(/Field '(.+?)' doesn't have a default value/);
        const fieldName = fieldMatch?.[1] || 'unknown';
        return new NotNullError(fieldName);

      default:
        return new DatabaseError(dbError.sqlMessage || dbError.message || 'Database error', dbError.code || ErrorCodes.DB_UNKNOWN);
    }
  }

  // SQLite error handling
  if (dialect === 'sqlite') {
    const message = dbError.message || '';

    if (message.includes('UNIQUE constraint failed')) {
      const match = message.match(/UNIQUE constraint failed: (\w+)\.(\w+)/);
      return new UniqueConstraintError('unique', match?.[1] || 'unknown', match?.[2] ? [match[2]] : []);
    }

    if (message.includes('FOREIGN KEY constraint failed')) {
      return new ForeignKeyError('foreign_key', 'unknown', 'unknown');
    }

    if (message.includes('NOT NULL constraint failed')) {
      const match = message.match(/NOT NULL constraint failed: (\w+)\.(\w+)/);
      return new NotNullError(match?.[2] || 'unknown', match?.[1]);
    }

    if (message.includes('CHECK constraint failed')) {
      const match = message.match(/CHECK constraint failed: (\w+)/);
      return new CheckConstraintError(match?.[1] || 'unknown');
    }

    return new DatabaseError(message, ErrorCodes.DB_UNKNOWN);
  }

  return new DatabaseError('Unknown database error', ErrorCodes.DB_UNKNOWN);
}
