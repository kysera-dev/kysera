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
  code: string
  detail?: string
  originalError?: unknown

  constructor(
    message: string,
    options?: {
      code?: string
      detail?: string
      originalError?: unknown
    }
  )

  toJSON(): Record<string, unknown>
}
```

### UniqueConstraintError

Thrown when a UNIQUE constraint is violated.

```typescript
class UniqueConstraintError extends DatabaseError {
  constraint: string // Constraint name
  columns: string[] // Affected columns
  value?: unknown // Duplicate value

  constructor(constraint: string, columns?: string[], value?: unknown)
}
```

### ForeignKeyError

Thrown when a FOREIGN KEY constraint is violated.

```typescript
class ForeignKeyError extends DatabaseError {
  constraint: string
  table: string
  column: string
  referencedTable?: string

  constructor(constraint: string, table: string, column: string, referencedTable?: string)
}
```

### NotFoundError

Thrown when an entity is not found.

```typescript
class NotFoundError extends DatabaseError {
  entity?: string
  id?: unknown

  constructor(message?: string, entity?: string, id?: unknown)
}
```

### BadRequestError

Thrown for invalid requests.

```typescript
class BadRequestError extends DatabaseError {
  constructor(message: string, detail?: string)
}
```

### NotNullError

Thrown when a NOT NULL constraint is violated.

```typescript
class NotNullError extends DatabaseError {
  column: string

  constructor(column: string)
}
```

### CheckConstraintError

Thrown when a CHECK constraint is violated.

```typescript
class CheckConstraintError extends DatabaseError {
  constraint: string

  constructor(constraint: string)
}
```

## Error Parsing

### parseDatabaseError

Parse raw database errors into typed errors.

```typescript
function parseDatabaseError(error: unknown, dialect: 'postgres' | 'mysql' | 'sqlite' | 'mssql'): DatabaseError
```

**Parameters:**

- `error` - Raw error from database driver
- `dialect` - Database dialect

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
'VALIDATION_FAILED'

// Resource errors
'RESOURCE_NOT_FOUND'
'RESOURCE_BAD_REQUEST'
'RESOURCE_ALREADY_EXISTS'
'RESOURCE_CONFLICT'

// Migration errors
'MIGRATION_UP_FAILED'
'MIGRATION_DOWN_FAILED'
'MIGRATION_VALIDATION_FAILED'

// Plugin errors
'PLUGIN_INIT_FAILED'
'PLUGIN_VALIDATION_FAILED'
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
const error = new UniqueConstraintError('users_email_key', ['email'], 'test@test.com')

console.log(JSON.stringify(error.toJSON()))
// {
//   "name": "UniqueConstraintError",
//   "message": "Unique constraint violation",
//   "code": "VALIDATION_UNIQUE_VIOLATION",
//   "constraint": "users_email_key",
//   "columns": ["email"],
//   "value": "test@test.com"
// }
```
