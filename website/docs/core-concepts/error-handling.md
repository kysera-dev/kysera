---
sidebar_position: 6
title: Error Handling
description: Error handling and typed errors in Kysera
---

# Error Handling

Kysera provides a comprehensive error handling system with typed errors for different database operations.

## Error Hierarchy

```
DatabaseError (base)
├── UniqueConstraintError
├── ForeignKeyError
├── NotFoundError
├── BadRequestError
├── NotNullError
└── CheckConstraintError
```

## Error Classes

### DatabaseError

Base error class for all database errors:

```typescript
class DatabaseError extends Error {
  code: string
  detail?: string
  originalError?: unknown

  toJSON(): Record<string, unknown>
}
```

### UniqueConstraintError

Thrown when a UNIQUE constraint is violated:

```typescript
class UniqueConstraintError extends DatabaseError {
  constraint: string // e.g., 'users_email_unique'
  table: string // e.g., 'users'
  columns: string[] // e.g., ['email']
}
```

### ForeignKeyError

Thrown when a FOREIGN KEY constraint is violated:

```typescript
class ForeignKeyError extends DatabaseError {
  constraint: string // e.g., 'posts_user_id_fkey'
  table: string // e.g., 'posts'
  referencedTable: string // e.g., 'users'
}
```

### NotFoundError

Thrown when an entity is not found:

```typescript
class NotFoundError extends DatabaseError {
  // Message includes entity name and optional filter details
  // Example: "User not found" with detail: {"id": 123}
}
```

**Constructor:**

```typescript
new NotFoundError(entity: string, filters?: Record<string, unknown>)
```

### NotNullError

Thrown when a NOT NULL constraint is violated:

```typescript
class NotNullError extends DatabaseError {
  column: string
}
```

### CheckConstraintError

Thrown when a CHECK constraint is violated:

```typescript
class CheckConstraintError extends DatabaseError {
  constraint: string
}
```

## Parsing Database Errors

Use `parseDatabaseError` to convert raw database errors into typed errors:

```typescript
import { parseDatabaseError, UniqueConstraintError, ForeignKeyError } from '@kysera/core'

try {
  await db.insertInto('users').values({ email: 'duplicate@test.com' }).execute()
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')

  if (dbError instanceof UniqueConstraintError) {
    console.log('Duplicate:', dbError.constraint, dbError.columns)
    // Handle duplicate entry
  } else if (dbError instanceof ForeignKeyError) {
    console.log('Invalid reference:', dbError.referencedTable)
    // Handle invalid foreign key
  } else {
    // Handle other database errors
    throw dbError
  }
}
```

## Multi-Database Support

The error parser works with all supported databases:

### PostgreSQL

```typescript
const error = parseDatabaseError(pgError, 'postgres')
// Handles: 23505 (unique), 23503 (foreign key), 23502 (not null), 23514 (check)
```

### MySQL

```typescript
const error = parseDatabaseError(mysqlError, 'mysql')
// Handles: ER_DUP_ENTRY, ER_NO_REFERENCED_ROW, ER_BAD_NULL_ERROR
```

### SQLite

```typescript
const error = parseDatabaseError(sqliteError, 'sqlite')
// Handles: UNIQUE constraint failed, FOREIGN KEY constraint failed, etc.
```

## Unified Error Codes

Kysera provides a unified error code system:

```typescript
// Database errors
'DB_CONNECTION_FAILED'
'DB_QUERY_FAILED'
'DB_TRANSACTION_FAILED'
'DB_TIMEOUT'
'DB_POOL_EXHAUSTED'

// Validation errors
'VALIDATION_UNIQUE_VIOLATION'
'VALIDATION_FOREIGN_KEY_VIOLATION'
'VALIDATION_NOT_NULL_VIOLATION'
'VALIDATION_CHECK_VIOLATION'

// Resource errors
'RESOURCE_NOT_FOUND'
'RESOURCE_BAD_REQUEST'
'RESOURCE_ALREADY_EXISTS'
'RESOURCE_CONFLICT'
```

## Error Handling Patterns

### In Repositories

```typescript
async function createUser(data: CreateUserInput): Promise<User> {
  try {
    return await db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
  } catch (error) {
    const dbError = parseDatabaseError(error, dialect)

    if (dbError instanceof UniqueConstraintError) {
      throw new BadRequestError(`Email ${data.email} already exists`)
    }

    throw dbError
  }
}
```

### In API Handlers

```typescript
app.post('/users', async (req, res) => {
  try {
    const user = await userRepo.create(req.body)
    res.status(201).json(user)
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      })
    }

    if (error instanceof UniqueConstraintError) {
      return res.status(409).json({
        error: 'Resource already exists',
        field: error.columns[0]
      })
    }

    if (error instanceof NotFoundError) {
      return res.status(404).json({
        error: 'Resource not found'
      })
    }

    // Log unexpected errors
    logger.error('Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})
```

### Error Logging

```typescript
try {
  await userRepo.update(userId, data)
} catch (error) {
  logger.error('Failed to update user', {
    userId,
    data: { ...data, password: '[REDACTED]' }, // Don't log sensitive data
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    code: error instanceof DatabaseError ? error.code : undefined
  })
  throw error
}
```

## JSON Serialization

All errors support JSON serialization for API responses:

```typescript
const error = new UniqueConstraintError('users_email_unique', 'users', ['email'])

console.log(error.toJSON())
// {
//   name: 'UniqueConstraintError',
//   message: 'UNIQUE constraint violation on users',
//   code: 'VALIDATION_UNIQUE_VIOLATION',
//   constraint: 'users_email_unique',
//   table: 'users',
//   columns: ['email']
// }
```

## Best Practices

### 1. Use Typed Errors

```typescript
// Good: Specific error handling
if (error instanceof UniqueConstraintError) {
  return { error: 'Email already exists' }
}

// Bad: Generic error handling
if (error.message.includes('duplicate')) {
  return { error: 'Something is duplicate' }
}
```

### 2. Don't Swallow Errors

```typescript
// Bad: Silent error swallowing
try {
  await userRepo.delete(userId)
} catch (error) {
  // Nothing here - dangerous!
}

// Good: Explicit handling
try {
  await userRepo.delete(userId)
} catch (error) {
  logger.warn('User deletion failed', { userId, error })
  if (error instanceof DatabaseError) {
    throw new ApplicationError('Failed to delete user')
  }
  throw error
}
```

### 3. Preserve Error Context

```typescript
// Good: Wrap with context
try {
  await processOrder(orderId)
} catch (error) {
  throw new ApplicationError(`Failed to process order ${orderId}`, { cause: error })
}
```
