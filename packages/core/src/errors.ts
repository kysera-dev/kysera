/**
 * Database error hierarchy with multi-database support
 */

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
    super(
      `UNIQUE constraint violation on ${table}`,
      'UNIQUE_VIOLATION'
    )
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
    super(
      `FOREIGN KEY constraint violation`,
      'FOREIGN_KEY_VIOLATION'
    )
    this.name = 'ForeignKeyError'
  }
}

export class NotFoundError extends DatabaseError {
  constructor(entity: string, filters?: Record<string, unknown>) {
    const message = `${entity} not found`
    const detail = filters ? JSON.stringify(filters) : undefined
    super(message, 'NOT_FOUND', detail)
    this.name = 'NotFoundError'
  }
}

export class BadRequestError extends DatabaseError {
  constructor(message: string) {
    super(message, 'BAD_REQUEST')
    this.name = 'BadRequestError'
  }
}

export type DatabaseDialect = 'postgres' | 'mysql' | 'sqlite'

/**
 * Multi-database error parser
 * Supports PostgreSQL, MySQL, and SQLite
 */
export function parseDatabaseError(
  error: unknown,
  dialect: DatabaseDialect = 'postgres'
): DatabaseError {
  if (!error || typeof error !== 'object') {
    return new DatabaseError('Unknown database error', 'UNKNOWN')
  }

  const dbError = error as any

  // PostgreSQL error handling
  if (dialect === 'postgres' && 'code' in dbError) {
    switch (dbError.code) {
      case '23505': // unique_violation
        // Extract columns from detail message: "Key (email)=(value) already exists."
        const detailMatch = dbError.detail?.match(/Key \(([^)]+)\)=/)
        const columns = detailMatch
          ? detailMatch[1].split(',').map((col: string) => col.trim())
          : (dbError.columns || [])

        return new UniqueConstraintError(
          dbError.constraint || 'unique',
          dbError.table || 'unknown',
          columns
        )

      case '23503': // foreign_key_violation
        return new ForeignKeyError(
          dbError.constraint || 'foreign_key',
          dbError.table || 'unknown',
          dbError.detail?.match(/table "(.+?)"/)?.[1] || 'unknown'
        )

      case '23502': // not_null_violation
        return new DatabaseError(
          `Not null constraint violation on column ${dbError.column}`,
          '23502',
          dbError.column
        )

      case '23514': // check_violation
        return new DatabaseError(
          `Check constraint violation: ${dbError.constraint}`,
          '23514'
        )

      default:
        return new DatabaseError(
          dbError.message || 'Database error',
          dbError.code
        )
    }
  }

  // MySQL error handling
  if (dialect === 'mysql' && 'code' in dbError) {
    switch (dbError.code) {
      case 'ER_DUP_ENTRY':
      case 'ER_DUP_KEY':
        // Parse MySQL duplicate entry error
        // Format: "Duplicate entry 'value' for key 'table.column'" or "'constraint_name'"
        const dupMatch = dbError.sqlMessage?.match(/Duplicate entry '(.+?)' for key '(.+?)'/)
        const constraintName = dupMatch?.[2] || 'unique'

        // Extract column name from constraint (format: "table.column" or "column")
        const columnMatch = constraintName.match(/\.([^.]+)$/) || constraintName.match(/^([^.]+)$/)
        const columns = columnMatch ? [columnMatch[1]] : []

        const error = new UniqueConstraintError(
          constraintName,
          'unknown', // MySQL doesn't provide table name easily
          columns
        )
        // Override code for MySQL
        ;(error as any).code = 'ER_DUP_ENTRY'
        return error

      case 'ER_NO_REFERENCED_ROW':
      case 'ER_NO_REFERENCED_ROW_2':
      case 'ER_ROW_IS_REFERENCED':
      case 'ER_ROW_IS_REFERENCED_2':
        return new ForeignKeyError(
          'foreign_key',
          'unknown',
          'unknown'
        )

      case 'ER_BAD_NULL_ERROR':
        const nullMatch = dbError.sqlMessage?.match(/Column '(.+?)' cannot be null/)
        const columnName = nullMatch?.[1]
        return new DatabaseError(
          columnName ? `Not null constraint violation on column ${columnName}` : 'Not null constraint violation',
          'ER_BAD_NULL_ERROR',
          columnName
        )

      case 'ER_NO_DEFAULT_FOR_FIELD':
        // MySQL 8.0+ uses this error code instead of ER_BAD_NULL_ERROR
        const fieldMatch = dbError.sqlMessage?.match(/Field '(.+?)' doesn't have a default value/)
        const fieldName = fieldMatch?.[1]
        return new DatabaseError(
          fieldName ? `Not null constraint violation on column ${fieldName}` : 'Not null constraint violation',
          'ER_NO_DEFAULT_FOR_FIELD',
          fieldName
        )

      default:
        return new DatabaseError(
          dbError.sqlMessage || dbError.message || 'Database error',
          dbError.code
        )
    }
  }

  // SQLite error handling
  if (dialect === 'sqlite') {
    const message = dbError.message || ''

    if (message.includes('UNIQUE constraint failed')) {
      const match = message.match(/UNIQUE constraint failed: (\w+)\.(\w+)/)
      return new UniqueConstraintError(
        'unique',
        match?.[1] || 'unknown',
        match?.[2] ? [match[2]] : []
      )
    }

    if (message.includes('FOREIGN KEY constraint failed')) {
      return new ForeignKeyError('foreign_key', 'unknown', 'unknown')
    }

    if (message.includes('NOT NULL constraint failed')) {
      const match = message.match(/NOT NULL constraint failed: (\w+)\.(\w+)/)
      return new DatabaseError(
        `NOT NULL constraint violation`,
        'SQLITE_CONSTRAINT',
        match?.[2]
      )
    }

    return new DatabaseError(message, 'UNKNOWN')
  }

  return new DatabaseError('Unknown database error', 'UNKNOWN')
}