---
sidebar_position: 1
title: Errors
description: Error handling API reference
---

# Error Handling

Multi-database error parsing with typed error classes.

## Error Classes

### DatabaseError

Base error class for all database errors.

```typescript
class DatabaseError extends Error {
  readonly code: string
  readonly detail?: string

  constructor(message: string, code: string, detail?: string)

  toJSON(): Record<string, unknown>
}
```

### UniqueConstraintError

Thrown when a UNIQUE constraint is violated.

```typescript
class UniqueConstraintError extends DatabaseError {
  constraint: string // Constraint name
  table: string // Table name
  columns: string[] // Affected columns

  constructor(constraint: string, table: string, columns: string[])
}
```

### ForeignKeyError

Thrown when a FOREIGN KEY constraint is violated.

```typescript
class ForeignKeyError extends DatabaseError {
  constraint: string
  table: string
  referencedTable: string

  constructor(constraint: string, table: string, referencedTable: string)
}
```

### NotFoundError

Thrown when an entity is not found.

```typescript
class NotFoundError extends DatabaseError {
  constructor(entity: string, filters?: Record<string, unknown>)
}
```

**Example:**

```typescript
throw new NotFoundError('User', { id: 123 })
// message: 'User not found'
// detail: '{"id":123}'
// code: 'RESOURCE_NOT_FOUND'
```

### BadRequestError

Thrown for invalid requests.

```typescript
class BadRequestError extends DatabaseError {
  constructor(message: string)
}
```

### NotNullError

Thrown when a NOT NULL constraint is violated.

```typescript
class NotNullError extends DatabaseError {
  readonly column: string
  readonly table?: string

  constructor(column: string, table?: string)
}
```

### CheckConstraintError

Thrown when a CHECK constraint is violated.

```typescript
class CheckConstraintError extends DatabaseError {
  readonly constraint: string
  readonly table?: string

  constructor(constraint: string, table?: string)
}
```

### SoftDeleteError

Base error class for soft-delete plugin errors.

```typescript
class SoftDeleteError extends DatabaseError {
  constructor(message: string, detail?: string, code?: string)
}
```

### RecordNotDeletedError

Thrown when attempting to restore a record that is not soft-deleted.

```typescript
class RecordNotDeletedError extends SoftDeleteError {
  readonly recordId: string | number
  readonly tableName?: string

  constructor(recordId: string | number, tableName?: string)
}
```

### AuditError

Base error class for audit plugin errors.

```typescript
class AuditError extends DatabaseError {
  constructor(message: string, detail?: string, code?: string)
}
```

### AuditRestoreError

Thrown when an audit restore operation fails.

```typescript
class AuditRestoreError extends AuditError {
  readonly auditId: number
  readonly operation: string
  readonly reason: string

  constructor(auditId: number, operation: string, reason: string)
}
```

### AuditMissingValuesError

Thrown when an audit log entry is missing required old values.

```typescript
class AuditMissingValuesError extends AuditError {
  readonly auditId: number

  constructor(auditId: number)
}
```

### TimestampsError

Base error class for timestamps plugin errors.

```typescript
class TimestampsError extends DatabaseError {
  constructor(message: string, detail?: string, code?: string)
}
```

### TimestampColumnMissingError

Thrown when a required timestamp column is missing from the table.

```typescript
class TimestampColumnMissingError extends TimestampsError {
  readonly tableName: string
  readonly columnName: string

  constructor(tableName: string, columnName: string)
}
```

## Error Parsing

### parseDatabaseError

Parse raw database errors into typed errors.

```typescript
function parseDatabaseError(error: unknown, dialect?: 'postgres' | 'mysql' | 'sqlite' | 'mssql'): DatabaseError
```

**Parameters:**

- `error` - Raw error from database driver
- `dialect` - Database dialect (default: `'postgres'`)

**Returns:** Typed `DatabaseError` or subclass

**Example:**

```typescript
// PostgreSQL example
try {
  await db.insertInto('users').values({ email: 'test@test.com' }).execute()
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')

  if (dbError instanceof UniqueConstraintError) {
    console.log('Duplicate:', dbError.constraint)
    console.log('Columns:', dbError.columns)
  }
}

// MSSQL example
try {
  await db.insertInto('users').values({ email: 'duplicate@example.com' }).execute()
} catch (error) {
  const dbError = parseDatabaseError(error, 'mssql')
  if (dbError instanceof UniqueConstraintError) {
    console.log('Duplicate entry:', dbError.constraint)
  }
}
```

## Error Codes

### Unified Error Code System

```typescript
// Database errors
'DB_CONNECTION_FAILED'
'DB_QUERY_FAILED'
'DB_TRANSACTION_FAILED'
'DB_TIMEOUT'
'DB_POOL_EXHAUSTED'
'DB_UNKNOWN'

// Validation errors
'VALIDATION_UNIQUE_VIOLATION'
'VALIDATION_FOREIGN_KEY_VIOLATION'
'VALIDATION_NOT_NULL_VIOLATION'
'VALIDATION_CHECK_VIOLATION'
'VALIDATION_INVALID_INPUT'
'VALIDATION_REQUIRED_FIELD'
'VALIDATION_INVALID_TYPE'

// Resource errors
'RESOURCE_NOT_FOUND'
'RESOURCE_ALREADY_EXISTS'
'RESOURCE_CONFLICT'
'RESOURCE_BAD_REQUEST'

// Migration errors
'MIGRATION_UP_FAILED'
'MIGRATION_DOWN_FAILED'
'MIGRATION_VALIDATION_FAILED'
'MIGRATION_NOT_FOUND'
'MIGRATION_DUPLICATE_NAME'
'MIGRATION_LOCK_FAILED'
'MIGRATION_ALREADY_EXECUTED'

// Plugin errors
'PLUGIN_VALIDATION_FAILED'
'PLUGIN_INIT_FAILED'
'PLUGIN_CONFLICT'
'PLUGIN_DEPENDENCY_MISSING'
'PLUGIN_DUPLICATE'
'PLUGIN_NOT_FOUND'
'SOFT_DELETE_ERROR'
'RECORD_NOT_DELETED'
'TIMESTAMPS_ERROR'
'TIMESTAMP_COLUMN_MISSING'

// Audit errors
'AUDIT_LOG_NOT_FOUND'
'AUDIT_RESTORE_NOT_SUPPORTED'
'AUDIT_OLD_VALUES_MISSING'
'AUDIT_TABLE_CREATION_FAILED'
'AUDIT_ERROR'
'AUDIT_RESTORE_ERROR'
'AUDIT_MISSING_VALUES'

// Config errors
'CONFIG_NOT_FOUND'
'CONFIG_VALIDATION_FAILED'
'CONFIG_PARSE_ERROR'
'CONFIG_REQUIRED_MISSING'
'CONFIG_INVALID_VALUE'

// FileSystem errors
'FS_FILE_NOT_FOUND'
'FS_PERMISSION_DENIED'
'FS_DIRECTORY_NOT_FOUND'
'FS_FILE_EXISTS'
'FS_WRITE_FAILED'
'FS_READ_FAILED'

// Network errors
'NETWORK_CONNECTION_REFUSED'
'NETWORK_TIMEOUT'
'NETWORK_DNS_FAILED'
'NETWORK_SSL_ERROR'
```

## Database-Specific Codes

### PostgreSQL

| Code  | Error Type            |
| ----- | --------------------- |
| 23505 | UniqueConstraintError |
| 23503 | ForeignKeyError       |
| 23502 | NotNullError          |
| 23514 | CheckConstraintError  |

### MySQL

| Code                 | Error Type            |
| -------------------- | --------------------- |
| ER_DUP_ENTRY         | UniqueConstraintError |
| ER_NO_REFERENCED_ROW | ForeignKeyError       |
| ER_BAD_NULL_ERROR    | NotNullError          |

### SQLite

| Message Contains       | Error Type            |
| ---------------------- | --------------------- |
| UNIQUE constraint      | UniqueConstraintError |
| FOREIGN KEY constraint | ForeignKeyError       |
| NOT NULL constraint    | NotNullError          |

### MSSQL

| Error Code | Error Type            | Description                      |
| ---------- | --------------------- | -------------------------------- |
| 2627, 2601 | UniqueConstraintError | Unique constraint violation      |
| 515        | NotNullError          | NOT NULL constraint violation    |
| 547        | ForeignKeyError       | Foreign key constraint violation |

## JSON Serialization

All errors support JSON serialization:

```typescript
const error = new UniqueConstraintError('users_email_key', 'users', ['email'])

console.log(JSON.stringify(error.toJSON()))
// {
//   "name": "UniqueConstraintError",
//   "message": "UNIQUE constraint violation on users",
//   "code": "VALIDATION_UNIQUE_VIOLATION",
//   "constraint": "users_email_key",
//   "table": "users",
//   "columns": ["email"]
// }
```
