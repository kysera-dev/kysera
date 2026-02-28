/**
 * Database error hierarchy with multi-database support
 *
 * Uses unified ErrorCodes from @kysera/core/error-codes for consistency
 * across the entire Kysera ecosystem.
 */

import { ErrorCodes } from './error-codes.js'
import type { Dialect } from './types.js'

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

/**
 * Base error class for all database-related errors in Kysera.
 *
 * This is the foundation error type that all specific database errors extend from.
 * It provides a consistent structure with error codes from the unified ErrorCodes system,
 * making it easy to handle database errors across different dialects (PostgreSQL, MySQL, SQLite, MSSQL).
 *
 * @example
 * ```typescript
 * // Create a generic database error
 * const error = new DatabaseError(
 *   'Connection timeout',
 *   ErrorCodes.DB_CONNECTION_ERROR,
 *   'Failed to connect after 30s'
 * )
 *
 * // Check error properties
 * console.log(error.message) // 'Connection timeout'
 * console.log(error.code) // 'DB_CONNECTION_ERROR'
 * console.log(error.detail) // 'Failed to connect after 30s'
 *
 * // Serialize to JSON for API responses
 * const json = error.toJSON()
 * // { name: 'DatabaseError', message: '...', code: '...', detail: '...' }
 * ```
 */
export class DatabaseError extends Error {
  /**
   * Creates a new DatabaseError instance.
   *
   * @param message - Human-readable error message
   * @param code - Error code from ErrorCodes enum for programmatic handling
   * @param detail - Optional additional context about the error
   */
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

/**
 * Error thrown when a UNIQUE constraint is violated in the database.
 *
 * This occurs when attempting to insert or update a row with values that would
 * create a duplicate in a column or set of columns marked as UNIQUE. Works across
 * all supported database dialects (PostgreSQL, MySQL, SQLite, MSSQL).
 *
 * @example
 * ```typescript
 * import { parseDatabaseError, UniqueConstraintError } from '@kysera/core'
 *
 * try {
 *   await db.insertInto('users')
 *     .values({ email: 'alice@example.com', username: 'alice' })
 *     .execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'postgres')
 *
 *   if (dbError instanceof UniqueConstraintError) {
 *     console.log(dbError.table) // 'users'
 *     console.log(dbError.columns) // ['email'] or ['username']
 *     console.log(dbError.constraint) // 'users_email_unique'
 *
 *     // Return user-friendly error message
 *     return `${dbError.columns.join(', ')} already exists`
 *   }
 * }
 * ```
 */
export class UniqueConstraintError extends DatabaseError {
  /**
   * Creates a new UniqueConstraintError instance.
   *
   * @param constraint - Name of the violated constraint (e.g., 'users_email_unique')
   * @param table - Name of the table where the constraint was violated
   * @param columns - Array of column names involved in the unique constraint
   */
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

/**
 * Error thrown when a FOREIGN KEY constraint is violated in the database.
 *
 * This occurs when attempting to insert or update a row that references a non-existent
 * row in another table, or when trying to delete a row that is referenced by other rows.
 * Works across all supported database dialects (PostgreSQL, MySQL, SQLite, MSSQL).
 *
 * @example
 * ```typescript
 * import { parseDatabaseError, ForeignKeyError } from '@kysera/core'
 *
 * try {
 *   // Try to insert a post with non-existent user_id
 *   await db.insertInto('posts')
 *     .values({ title: 'Hello', user_id: 999 })
 *     .execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'postgres')
 *
 *   if (dbError instanceof ForeignKeyError) {
 *     console.log(dbError.table) // 'posts'
 *     console.log(dbError.referencedTable) // 'users'
 *     console.log(dbError.constraint) // 'posts_user_id_fkey'
 *
 *     // Return user-friendly error message
 *     return `Referenced ${dbError.referencedTable} does not exist`
 *   }
 * }
 *
 * // Or when deleting a referenced row
 * try {
 *   await db.deleteFrom('users').where('id', '=', 1).execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'postgres')
 *
 *   if (dbError instanceof ForeignKeyError) {
 *     return 'Cannot delete user with existing posts'
 *   }
 * }
 * ```
 */
export class ForeignKeyError extends DatabaseError {
  /**
   * Creates a new ForeignKeyError instance.
   *
   * @param constraint - Name of the violated foreign key constraint (e.g., 'posts_user_id_fkey')
   * @param table - Name of the table where the constraint was violated
   * @param referencedTable - Name of the table being referenced by the foreign key
   */
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

/**
 * Error thrown when a requested database entity cannot be found.
 *
 * This is typically used by repository methods when a query returns no results
 * and the caller expects at least one result (e.g., findById, update, delete).
 * Unlike database constraint errors, this is an application-level error.
 *
 * @example
 * ```typescript
 * import { NotFoundError } from '@kysera/core'
 *
 * // In a repository method
 * async findById(id: number) {
 *   const user = await this.db
 *     .selectFrom('users')
 *     .where('id', '=', id)
 *     .selectAll()
 *     .executeTakeFirst()
 *
 *   if (!user) {
 *     throw new NotFoundError('User', { id })
 *   }
 *
 *   return user
 * }
 *
 * // Catching the error
 * try {
 *   const user = await userRepo.findById(999)
 * } catch (error) {
 *   if (error instanceof NotFoundError) {
 *     console.log(error.message) // 'User not found'
 *     console.log(error.detail) // '{"id":999}'
 *     return { status: 404, error: error.message }
 *   }
 * }
 * ```
 */
export class NotFoundError extends DatabaseError {
  /**
   * Creates a new NotFoundError instance.
   *
   * @param entity - Name of the entity that was not found (e.g., 'User', 'Post')
   * @param filters - Optional object containing the filter criteria used in the search
   */
  constructor(entity: string, filters?: Record<string, unknown>) {
    const message = `${entity} not found`
    const detail = filters ? JSON.stringify(filters) : undefined
    super(message, ErrorCodes.RESOURCE_NOT_FOUND, detail)
    this.name = 'NotFoundError'
  }
}

/**
 * Error thrown when a database operation receives invalid input or parameters.
 *
 * This is an application-level error used to signal that the request itself is malformed
 * or contains invalid data, before any database constraints are even checked. Common use
 * cases include validation failures, missing required fields, or invalid query parameters.
 *
 * @example
 * ```typescript
 * import { BadRequestError } from '@kysera/core'
 *
 * // In a repository method
 * async create(data: CreateUserInput) {
 *   // Validate before attempting database operation
 *   if (!data.email?.includes('@')) {
 *     throw new BadRequestError('Invalid email format')
 *   }
 *
 *   if (data.age !== undefined && data.age < 0) {
 *     throw new BadRequestError('Age must be a positive number')
 *   }
 *
 *   return await this.db.insertInto('users').values(data).execute()
 * }
 *
 * // Catching the error
 * try {
 *   await userRepo.create({ email: 'invalid', age: -5 })
 * } catch (error) {
 *   if (error instanceof BadRequestError) {
 *     console.log(error.message) // 'Invalid email format'
 *     return { status: 400, error: error.message }
 *   }
 * }
 * ```
 */
export class BadRequestError extends DatabaseError {
  /**
   * Creates a new BadRequestError instance.
   *
   * @param message - Description of why the request is invalid
   */
  constructor(message: string) {
    super(message, ErrorCodes.RESOURCE_BAD_REQUEST)
    this.name = 'BadRequestError'
  }
}

/**
 * Error thrown when a NOT NULL constraint is violated in the database.
 *
 * This occurs when attempting to insert or update a row with a NULL value in a column
 * that is defined as NOT NULL. Works across all supported database dialects
 * (PostgreSQL, MySQL, SQLite, MSSQL).
 *
 * @example
 * ```typescript
 * import { parseDatabaseError, NotNullError } from '@kysera/core'
 *
 * try {
 *   // Try to insert a user without required email field
 *   await db.insertInto('users')
 *     .values({ username: 'alice' }) // email is missing and NOT NULL
 *     .execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'postgres')
 *
 *   if (dbError instanceof NotNullError) {
 *     console.log(dbError.column) // 'email'
 *     console.log(dbError.table) // 'users'
 *
 *     // Return user-friendly error message
 *     return `${dbError.column} is required`
 *   }
 * }
 *
 * // Also caught when updating to NULL
 * try {
 *   await db.updateTable('users')
 *     .set({ email: null })
 *     .where('id', '=', 1)
 *     .execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'postgres')
 *
 *   if (dbError instanceof NotNullError) {
 *     return 'Email cannot be empty'
 *   }
 * }
 * ```
 */
export class NotNullError extends DatabaseError {
  /**
   * Creates a new NotNullError instance.
   *
   * @param column - Name of the column that violated the NOT NULL constraint
   * @param table - Optional name of the table containing the column
   */
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
 * Error thrown when a CHECK constraint is violated in the database.
 *
 * This occurs when attempting to insert or update a row with values that don't satisfy
 * a CHECK constraint condition. CHECK constraints allow you to define custom validation
 * rules at the database level (e.g., age >= 0, price > 0). Works across all supported
 * database dialects (PostgreSQL, MySQL, SQLite, MSSQL).
 *
 * @example
 * ```typescript
 * import { parseDatabaseError, CheckConstraintError } from '@kysera/core'
 *
 * // Assuming table has: CHECK (age >= 0)
 * try {
 *   await db.insertInto('users')
 *     .values({ email: 'alice@example.com', age: -5 })
 *     .execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'postgres')
 *
 *   if (dbError instanceof CheckConstraintError) {
 *     console.log(dbError.constraint) // 'users_age_check'
 *     console.log(dbError.table) // 'users'
 *
 *     // Return user-friendly error message
 *     return 'Age must be a positive number'
 *   }
 * }
 *
 * // Another example with price constraint: CHECK (price > 0)
 * try {
 *   await db.insertInto('products')
 *     .values({ name: 'Widget', price: 0 })
 *     .execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'postgres')
 *
 *   if (dbError instanceof CheckConstraintError) {
 *     return 'Price must be greater than zero'
 *   }
 * }
 * ```
 */
export class CheckConstraintError extends DatabaseError {
  /**
   * Creates a new CheckConstraintError instance.
   *
   * @param constraint - Name of the violated CHECK constraint (e.g., 'users_age_check')
   * @param table - Optional name of the table containing the constraint
   */
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


// ============================================================================
// Plugin-Specific Error Classes
// ============================================================================

/**
 * Base error class for soft-delete plugin errors.
 *
 * This is the foundation error type for all soft-delete related errors.
 * It extends DatabaseError to maintain consistency with the error hierarchy.
 *
 * @example
 * ```typescript
 * import { SoftDeleteError } from '@kysera/core'
 *
 * // Generic soft-delete error
 * throw new SoftDeleteError('Soft delete operation failed', 'Invalid deleted_at column')
 *
 * // Catching the error
 * try {
 *   await repo.softDelete(id)
 * } catch (error) {
 *   if (error instanceof SoftDeleteError) {
 *     console.log(error.message) // 'Soft delete operation failed'
 *     console.log(error.detail) // 'Invalid deleted_at column'
 *   }
 * }
 * ```
 */
export class SoftDeleteError extends DatabaseError {
  /**
   * Creates a new SoftDeleteError instance.
   *
   * @param message - Human-readable error message
   * @param detail - Optional additional context about the error
   * @param code - Optional error code override for subclasses (defaults to SOFT_DELETE_ERROR)
   */
  constructor(message: string, detail?: string, code?: string) {
    super(message, code ?? ErrorCodes.SOFT_DELETE_ERROR, detail)
    this.name = 'SoftDeleteError'
  }
}

/**
 * Error thrown when attempting to restore a record that is not soft-deleted.
 *
 * This occurs when calling restore() on a record that hasn't been soft-deleted,
 * or when trying to perform operations that require a soft-deleted record.
 *
 * @example
 * ```typescript
 * import { RecordNotDeletedError } from '@kysera/core'
 *
 * // In a repository restore method
 * const user = await db.selectFrom('users')
 *   .where('id', '=', id)
 *   .selectAll()
 *   .executeTakeFirst()
 *
 * if (!user?.deleted_at) {
 *   throw new RecordNotDeletedError(id, 'users')
 * }
 *
 * // Catching the error
 * try {
 *   await repo.restore(123)
 * } catch (error) {
 *   if (error instanceof RecordNotDeletedError) {
 *     return 'Record is not deleted, cannot restore'
 *   }
 * }
 * ```
 */
export class RecordNotDeletedError extends SoftDeleteError {
  /**
   * Creates a new RecordNotDeletedError instance.
   *
   * @param recordId - ID of the record that is not deleted
   * @param tableName - Optional name of the table containing the record
   */
  constructor(
    public readonly recordId: string | number,
    public readonly tableName?: string
  ) {
    const tableInfo = tableName ? ` in table ${tableName}` : ''
    const message = `Record ${recordId} is not deleted${tableInfo}`
    super(message, undefined, ErrorCodes.RECORD_NOT_DELETED)
    this.name = 'RecordNotDeletedError'
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      recordId: this.recordId,
      tableName: this.tableName
    }
  }
}

/**
 * Base error class for audit plugin errors.
 *
 * This is the foundation error type for all audit-related errors.
 * It extends DatabaseError to maintain consistency with the error hierarchy.
 *
 * @example
 * ```typescript
 * import { AuditError } from '@kysera/core'
 *
 * // Generic audit error
 * throw new AuditError('Audit operation failed', 'Audit table not initialized')
 *
 * // Catching the error
 * try {
 *   await auditPlugin.logChange(change)
 * } catch (error) {
 *   if (error instanceof AuditError) {
 *     console.log(error.message) // 'Audit operation failed'
 *     console.log(error.detail) // 'Audit table not initialized'
 *   }
 * }
 * ```
 */
export class AuditError extends DatabaseError {
  /**
   * Creates a new AuditError instance.
   *
   * @param message - Human-readable error message
   * @param detail - Optional additional context about the error
   * @param code - Optional error code override for subclasses (defaults to AUDIT_ERROR)
   */
  constructor(message: string, detail?: string, code?: string) {
    super(message, code ?? ErrorCodes.AUDIT_ERROR, detail)
    this.name = 'AuditError'
  }
}

/**
 * Error thrown when an audit restore operation fails.
 *
 * This occurs when attempting to restore data from an audit log entry fails,
 * typically because the operation type doesn't support restoration or the
 * old values are missing/invalid.
 *
 * @example
 * ```typescript
 * import { AuditRestoreError } from '@kysera/core'
 *
 * // In an audit restore method
 * const auditLog = await getAuditLog(auditId)
 *
 * if (auditLog.operation === 'INSERT') {
 *   throw new AuditRestoreError(
 *     auditId,
 *     auditLog.operation,
 *     'Cannot restore INSERT operations'
 *   )
 * }
 *
 * // Catching the error
 * try {
 *   await auditPlugin.restore(123)
 * } catch (error) {
 *   if (error instanceof AuditRestoreError) {
 *     console.log(`Failed to restore audit ${error.auditId}: ${error.reason}`)
 *   }
 * }
 * ```
 */
export class AuditRestoreError extends AuditError {
  /**
   * Creates a new AuditRestoreError instance.
   *
   * @param auditId - ID of the audit log entry
   * @param operation - The operation type that failed to restore (e.g., 'UPDATE', 'DELETE')
   * @param reason - Description of why the restore failed
   */
  constructor(
    public readonly auditId: number,
    public readonly operation: string,
    public readonly reason: string
  ) {
    const message = `Cannot restore audit ${auditId} (${operation}): ${reason}`
    super(message, undefined, ErrorCodes.AUDIT_RESTORE_ERROR)
    this.name = 'AuditRestoreError'
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      auditId: this.auditId,
      operation: this.operation,
      reason: this.reason
    }
  }
}

/**
 * Error thrown when an audit log entry is missing required old values.
 *
 * This occurs when attempting to restore or analyze an audit log entry that
 * doesn't have the necessary old_values data captured, typically because the
 * audit plugin wasn't configured to capture old values for that operation.
 *
 * @example
 * ```typescript
 * import { AuditMissingValuesError } from '@kysera/core'
 *
 * // In an audit restore method
 * const auditLog = await getAuditLog(auditId)
 *
 * if (!auditLog.old_values) {
 *   throw new AuditMissingValuesError(auditId)
 * }
 *
 * // Catching the error
 * try {
 *   await auditPlugin.restore(123)
 * } catch (error) {
 *   if (error instanceof AuditMissingValuesError) {
 *     return 'Cannot restore: old values were not captured'
 *   }
 * }
 * ```
 */
export class AuditMissingValuesError extends AuditError {
  /**
   * Creates a new AuditMissingValuesError instance.
   *
   * @param auditId - ID of the audit log entry missing values
   */
  constructor(public readonly auditId: number) {
    const message = `Audit log ${auditId} is missing old_values required for restoration`
    super(message, undefined, ErrorCodes.AUDIT_MISSING_VALUES)
    this.name = 'AuditMissingValuesError'
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      auditId: this.auditId
    }
  }
}

/**
 * Base error class for timestamps plugin errors.
 *
 * This is the foundation error type for all timestamps-related errors.
 * It extends DatabaseError to maintain consistency with the error hierarchy.
 *
 * @example
 * ```typescript
 * import { TimestampsError } from '@kysera/core'
 *
 * // Generic timestamps error
 * throw new TimestampsError('Timestamp operation failed', 'Invalid column type')
 *
 * // Catching the error
 * try {
 *   await timestampsPlugin.applyTimestamps(data)
 * } catch (error) {
 *   if (error instanceof TimestampsError) {
 *     console.log(error.message) // 'Timestamp operation failed'
 *     console.log(error.detail) // 'Invalid column type'
 *   }
 * }
 * ```
 */
export class TimestampsError extends DatabaseError {
  /**
   * Creates a new TimestampsError instance.
   *
   * @param message - Human-readable error message
   * @param detail - Optional additional context about the error
   * @param code - Optional error code override for subclasses (defaults to TIMESTAMPS_ERROR)
   */
  constructor(message: string, detail?: string, code?: string) {
    super(message, code ?? ErrorCodes.TIMESTAMPS_ERROR, detail)
    this.name = 'TimestampsError'
  }
}

/**
 * Error thrown when a required timestamp column is missing from the table.
 *
 * This occurs when the timestamps plugin is configured to use specific columns
 * (e.g., created_at, updated_at) but those columns don't exist in the database
 * table schema.
 *
 * @example
 * ```typescript
 * import { TimestampColumnMissingError } from '@kysera/core'
 *
 * // In timestamps plugin validation
 * const tableMetadata = await getTableMetadata('users')
 *
 * if (!tableMetadata.columns.includes('created_at')) {
 *   throw new TimestampColumnMissingError('users', 'created_at')
 * }
 *
 * // Catching the error
 * try {
 *   await timestampsPlugin.initialize()
 * } catch (error) {
 *   if (error instanceof TimestampColumnMissingError) {
 *     console.log(`Table ${error.tableName} is missing column ${error.columnName}`)
 *     // Maybe create a migration to add the column
 *   }
 * }
 * ```
 */
export class TimestampColumnMissingError extends TimestampsError {
  /**
   * Creates a new TimestampColumnMissingError instance.
   *
   * @param tableName - Name of the table missing the timestamp column
   * @param columnName - Name of the missing timestamp column
   */
  constructor(
    public readonly tableName: string,
    public readonly columnName: string
  ) {
    const message = `Table ${tableName} is missing required timestamp column: ${columnName}`
    super(message, undefined, ErrorCodes.TIMESTAMP_COLUMN_MISSING)
    this.name = 'TimestampColumnMissingError'
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      tableName: this.tableName,
      columnName: this.columnName
    }
  }
}

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
    default: {
      // Standardized error message extraction (nullish coalescing for consistency)
      const message = dbError.sqlMessage ?? dbError.message ?? 'Database error'
      return new DatabaseError(message, dbError.code ?? ErrorCodes.DB_UNKNOWN)
    }
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

  // Standardized error message extraction (nullish coalescing for consistency)
  const errorMessage = dbError.message ?? 'Database error'
  return new DatabaseError(errorMessage, dbError.code ?? ErrorCodes.DB_UNKNOWN)
}

/**
 * Multi-database error parser that converts raw database errors into typed Kysera error classes.
 *
 * This function intelligently parses database-specific error codes and messages from PostgreSQL,
 * MySQL, SQLite, and MSSQL into strongly-typed error classes (UniqueConstraintError, ForeignKeyError,
 * NotNullError, CheckConstraintError, etc.). This allows you to handle database errors in a
 * database-agnostic way while getting detailed information about what went wrong.
 *
 * Uses unified ErrorCodes from @kysera/core/error-codes for consistent error code formatting
 * across all database dialects.
 *
 * @param error - The raw database error object thrown by the database driver
 * @param dialect - The database dialect ('postgres', 'mysql', 'sqlite', 'mssql'). Defaults to 'postgres'
 * @returns A typed DatabaseError instance with detailed constraint information
 *
 * @example
 * ```typescript
 * import { parseDatabaseError, UniqueConstraintError, ForeignKeyError, NotNullError } from '@kysera/core'
 *
 * // PostgreSQL example
 * try {
 *   await db.insertInto('users')
 *     .values({ email: 'alice@example.com' })
 *     .execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'postgres')
 *
 *   if (dbError instanceof UniqueConstraintError) {
 *     console.log(`Duplicate ${dbError.columns.join(', ')} in ${dbError.table}`)
 *   } else if (dbError instanceof NotNullError) {
 *     console.log(`Missing required field: ${dbError.column}`)
 *   }
 * }
 *
 * // MySQL example
 * try {
 *   await db.insertInto('posts')
 *     .values({ title: 'Hello', user_id: 999 })
 *     .execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'mysql')
 *
 *   if (dbError instanceof ForeignKeyError) {
 *     console.log(`Invalid reference to ${dbError.referencedTable}`)
 *   }
 * }
 *
 * // SQLite example
 * try {
 *   await db.insertInto('products')
 *     .values({ name: 'Widget', price: -10 })
 *     .execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'sqlite')
 *
 *   if (dbError instanceof CheckConstraintError) {
 *     console.log(`Validation failed: ${dbError.constraint}`)
 *   }
 * }
 *
 * // MSSQL example
 * try {
 *   await db.deleteFrom('users').where('id', '=', 1).execute()
 * } catch (error) {
 *   const dbError = parseDatabaseError(error, 'mssql')
 *
 *   if (dbError instanceof ForeignKeyError) {
 *     console.log('Cannot delete: record is referenced by other tables')
 *   }
 * }
 *
 * // Generic error handling across all dialects
 * async function createUser(data: UserInput, dialect: Dialect) {
 *   try {
 *     return await db.insertInto('users').values(data).execute()
 *   } catch (error) {
 *     const dbError = parseDatabaseError(error, dialect)
 *
 *     // Handle errors in a database-agnostic way
 *     switch (dbError.constructor) {
 *       case UniqueConstraintError:
 *         throw new Error('User already exists')
 *       case NotNullError:
 *         throw new Error('Missing required field')
 *       case ForeignKeyError:
 *         throw new Error('Invalid reference')
 *       default:
 *         throw new Error('Database error occurred')
 *     }
 *   }
 * }
 * ```
 */
function hasMessageProperty(error: unknown): error is { message: string } {
  return typeof error === 'object' && error !== null && 'message' in error
}

function isRawDatabaseError(error: object): error is RawDatabaseError {
  return (
    'message' in error ||
    'code' in error ||
    'sqlMessage' in error ||
    'detail' in error ||
    'constraint' in error
  )
}

export function parseDatabaseError(
  error: unknown,
  dialect: Dialect = 'postgres'
): DatabaseError {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return new DatabaseError('Unknown database error', ErrorCodes.DB_UNKNOWN)
  }

  // SQLite errors only use the message string, so handle before property validation
  if (dialect === 'sqlite') {
    const message = hasMessageProperty(error) ? error.message : ''
    return parseSQLiteError(message)
  }

  if (!isRawDatabaseError(error)) {
    return new DatabaseError('Unknown database error', ErrorCodes.DB_UNKNOWN)
  }

  const dbError = error as RawDatabaseError

  if (dialect === 'postgres' && dbError.code) {
    return parsePostgresError(dbError)
  }

  if (dialect === 'mysql' && dbError.code) {
    return parseMySQLError(dbError)
  }

  if (dialect === 'mssql') {
    return parseMSSQLError(dbError)
  }

  return new DatabaseError('Unknown database error', ErrorCodes.DB_UNKNOWN)
}
