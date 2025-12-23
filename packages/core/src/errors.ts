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
 * async function createUser(data: UserInput, dialect: DatabaseDialect) {
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
