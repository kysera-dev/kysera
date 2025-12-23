/**
 * Database error hierarchy with multi-database support
 *
 * Uses unified ErrorCodes from @kysera/core/error-codes for consistency
 * across the entire Kysera ecosystem.
 */

import { ErrorCodes } from './error-codes.js'

// Pre-compiled regex patterns for database error parsing (module-level constants)
const PG_KEY_REGEX = /Key \(([^)]+)\)=/
const PG_TABLE_REGEX = /table "(.+?)"/
const MYSQL_DUP_REGEX = /Duplicate entry '(.+?)' for key '(.+?)'/
const MYSQL_COLUMN_REGEX = /Column '(.+?)' cannot be null/
const MYSQL_FIELD_REGEX = /Field '(.+?)' doesn't have a default value/
const MYSQL_COL_DOT_REGEX = /\.([^.]+)$/
const MYSQL_COL_REGEX = /^([^.]+)$/
const SQLITE_UNIQUE_REGEX = /UNIQUE constraint failed: (\w+)\.(\w+)/
const SQLITE_NOT_NULL_REGEX = /NOT NULL constraint failed: (\w+)\.(\w+)/
const SQLITE_CHECK_REGEX = /CHECK constraint failed: (\w+)/
// MSSQL regex patterns
const MSSQL_UNIQUE_REGEX = /Cannot insert duplicate key.*?'([^']+)'/i
const MSSQL_UNIQUE_CONSTRAINT_REGEX = /constraint "?([^"]+)"?.*?column[s]? ?\(?'?([^')]+)/i
const MSSQL_NULL_REGEX = /Cannot insert the value NULL into column '([^']+)'/i
const MSSQL_FK_REGEX = /FOREIGN KEY constraint "?([^"]+)"?/i

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly detail?: string
  ) {
    super(message)
    this.name = 'DatabaseError'
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      detail: this.detail
    }
  }
}

export class UniqueConstraintError extends DatabaseError {
  constructor(
    public readonly constraint: string,
    public readonly table: string,
    public readonly columns: string[]
  ) {
    super(`UNIQUE constraint violation on ${table}`, ErrorCodes.VALIDATION_UNIQUE_VIOLATION)
    this.name = 'UniqueConstraintError'
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      constraint: this.constraint,
      table: this.table,
      columns: this.columns
    }
  }
}

export class ForeignKeyError extends DatabaseError {
  constructor(
    public readonly constraint: string,
    public readonly table: string,
    public readonly referencedTable: string
  ) {
    super(`FOREIGN KEY constraint violation`, ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION)
    this.name = 'ForeignKeyError'
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      constraint: this.constraint,
      table: this.table,
      referencedTable: this.referencedTable
    }
  }
}

export class NotFoundError extends DatabaseError {
  constructor(entity: string, filters?: Record<string, unknown>) {
    const message = `${entity} not found`
    const detail = filters ? JSON.stringify(filters) : undefined
    super(message, ErrorCodes.RESOURCE_NOT_FOUND, detail)
    this.name = 'NotFoundError'
  }
}

export class BadRequestError extends DatabaseError {
  constructor(message: string) {
    super(message, ErrorCodes.RESOURCE_BAD_REQUEST)
    this.name = 'BadRequestError'
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
    const tableInfo = table ? ` on table ${table}` : ''
    super(
      `NOT NULL constraint violation on column ${column}${tableInfo}`,
      ErrorCodes.VALIDATION_NOT_NULL_VIOLATION,
      column
    )
    this.name = 'NotNullError'
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      column: this.column,
      table: this.table
    }
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
    const tableInfo = table ? ` on table ${table}` : ''
    super(
      `CHECK constraint violation: ${constraint}${tableInfo}`,
      ErrorCodes.VALIDATION_CHECK_VIOLATION
    )
    this.name = 'CheckConstraintError'
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      constraint: this.constraint,
      table: this.table
    }
  }
}

export type DatabaseDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql'

/**
 * Database error with code property (internal type for parsing).
 * @internal
 */
interface RawDatabaseError {
  code?: string
  message?: string
  detail?: string
  constraint?: string
  table?: string
  column?: string
  columns?: string[]
  sqlMessage?: string
}

/**
 * Parse PostgreSQL-specific database errors.
 * @internal
 */
function parsePostgresError(dbError: RawDatabaseError): DatabaseError {
  switch (dbError.code) {
    case '23505': {
      const detailMatch = dbError.detail ? PG_KEY_REGEX.exec(dbError.detail) : null
      const matchedColumn = detailMatch?.[1]
      const columns = matchedColumn
        ? matchedColumn.split(',').map(col => col.trim())
        : (dbError.columns ?? [])
      return new UniqueConstraintError(
        dbError.constraint ?? 'unique',
        dbError.table ?? 'unknown',
        columns
      )
    }
    case '23503': {
      const tableMatch = dbError.detail ? PG_TABLE_REGEX.exec(dbError.detail) : null
      return new ForeignKeyError(
        dbError.constraint ?? 'foreign_key',
        dbError.table ?? 'unknown',
        tableMatch?.[1] ?? 'unknown'
      )
    }
    case '23502':
      return new NotNullError(dbError.column ?? 'unknown', dbError.table)
    case '23514':
      return new CheckConstraintError(dbError.constraint ?? 'unknown', dbError.table)
    default:
      return new DatabaseError(
        dbError.message ?? 'Database error',
        dbError.code ?? ErrorCodes.DB_UNKNOWN
      )
  }
}

/**
 * Parse MySQL-specific database errors.
 * @internal
 */
function parseMySQLError(dbError: RawDatabaseError): DatabaseError {
  switch (dbError.code) {
    case 'ER_DUP_ENTRY':
    case 'ER_DUP_KEY': {
      const dupMatch = dbError.sqlMessage ? MYSQL_DUP_REGEX.exec(dbError.sqlMessage) : null
      const constraintName = dupMatch?.[2] ?? 'unique'
      const columnMatch =
        MYSQL_COL_DOT_REGEX.exec(constraintName) ?? MYSQL_COL_REGEX.exec(constraintName)
      const extractedColumn = columnMatch?.[1]
      const mysqlColumns = extractedColumn ? [extractedColumn] : []
      return new UniqueConstraintError(constraintName, 'unknown', mysqlColumns)
    }
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return new ForeignKeyError('foreign_key', 'unknown', 'unknown')
    case 'ER_BAD_NULL_ERROR': {
      const nullMatch = dbError.sqlMessage ? MYSQL_COLUMN_REGEX.exec(dbError.sqlMessage) : null
      return new NotNullError(nullMatch?.[1] ?? 'unknown')
    }
    case 'ER_NO_DEFAULT_FOR_FIELD': {
      const fieldMatch = dbError.sqlMessage ? MYSQL_FIELD_REGEX.exec(dbError.sqlMessage) : null
      return new NotNullError(fieldMatch?.[1] ?? 'unknown')
    }
    default:
      return new DatabaseError(
        dbError.sqlMessage ?? dbError.message ?? 'Database error',
        dbError.code ?? ErrorCodes.DB_UNKNOWN
      )
  }
}

/**
 * Parse SQLite-specific database errors.
 * @internal
 */
function parseSQLiteError(message: string): DatabaseError {
  if (message.includes('UNIQUE constraint failed')) {
    const match = SQLITE_UNIQUE_REGEX.exec(message)
    return new UniqueConstraintError(
      'unique',
      match?.[1] ?? 'unknown',
      match?.[2] ? [match[2]] : []
    )
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new ForeignKeyError('foreign_key', 'unknown', 'unknown')
  }
  if (message.includes('NOT NULL constraint failed')) {
    const match = SQLITE_NOT_NULL_REGEX.exec(message)
    return new NotNullError(match?.[2] ?? 'unknown', match?.[1])
  }
  if (message.includes('CHECK constraint failed')) {
    const match = SQLITE_CHECK_REGEX.exec(message)
    return new CheckConstraintError(match?.[1] ?? 'unknown')
  }
  return new DatabaseError(message, ErrorCodes.DB_UNKNOWN)
}

/**
 * Parse MSSQL-specific database errors.
 * MSSQL error codes: 2627 (unique), 2601 (unique), 515 (not null), 547 (FK)
 * @internal
 */
function parseMSSQLError(dbError: RawDatabaseError): DatabaseError {
  const message = dbError.message ?? ''
  const code = dbError.code ?? ''

  // Unique constraint violations (error 2627, 2601)
  if (
    code === '2627' ||
    code === '2601' ||
    message.toLowerCase().includes('cannot insert duplicate key') ||
    message.toLowerCase().includes('unique key constraint')
  ) {
    const match = MSSQL_UNIQUE_REGEX.exec(message)
    const constraintMatch = MSSQL_UNIQUE_CONSTRAINT_REGEX.exec(message)
    const constraint = match?.[1] ?? constraintMatch?.[1] ?? 'unique'
    const column = constraintMatch?.[2] ?? 'unknown'
    return new UniqueConstraintError(constraint, 'unknown', column !== 'unknown' ? [column] : [])
  }

  // Foreign key constraint violations (error 547)
  if (
    code === '547' ||
    message.toLowerCase().includes('foreign key constraint') ||
    message.toLowerCase().includes('conflicted with the foreign key')
  ) {
    const match = MSSQL_FK_REGEX.exec(message)
    return new ForeignKeyError(match?.[1] ?? 'foreign_key', 'unknown', 'unknown')
  }

  // Not null violations (error 515)
  if (
    code === '515' ||
    message.toLowerCase().includes('cannot insert the value null') ||
    message.toLowerCase().includes('does not allow nulls')
  ) {
    const match = MSSQL_NULL_REGEX.exec(message)
    return new NotNullError(match?.[1] ?? 'unknown')
  }

  return new DatabaseError(message || 'Database error', dbError.code ?? ErrorCodes.DB_UNKNOWN)
}

/**
 * Multi-database error parser
 * Supports PostgreSQL, MySQL, SQLite, and MSSQL
 *
 * Uses unified ErrorCodes from @kysera/core/error-codes for consistent
 * error code formatting across all database dialects.
 */
export function parseDatabaseError(
  error: unknown,
  dialect: DatabaseDialect = 'postgres'
): DatabaseError {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return new DatabaseError('Unknown database error', ErrorCodes.DB_UNKNOWN)
  }

  const dbError = error as RawDatabaseError

  if (dialect === 'postgres' && dbError.code) {
    return parsePostgresError(dbError)
  }

  if (dialect === 'mysql' && dbError.code) {
    return parseMySQLError(dbError)
  }

  if (dialect === 'sqlite') {
    return parseSQLiteError(dbError.message ?? '')
  }

  if (dialect === 'mssql') {
    return parseMSSQLError(dbError)
  }

  return new DatabaseError('Unknown database error', ErrorCodes.DB_UNKNOWN)
}
