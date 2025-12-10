---
sidebar_position: 2
title: Getting Started
description: Quick start guide for Kysera - 5 minutes to your first query
---

# Getting Started

Get up and running with Kysera in 5 minutes.

## Installation

```bash
# Install Kysely (required) and database driver
npm install kysely pg

# Install Kysera packages (pick what you need)
npm install @kysera/core           # Errors, pagination, types, logger (~8KB)
npm install @kysera/repository     # Repository pattern with validation adapters
npm install @kysera/dal            # Functional DAL with type inference

# Optional validation library (choose one or none)
npm install zod                    # Popular schema validation
# or: npm install valibot           # Lightweight alternative
# or: npm install @sinclair/typebox # JSON Schema based

# Infrastructure (opt-in)
npm install @kysera/infra          # Health checks, retry, circuit breaker
npm install @kysera/debug          # Query logging and profiling
npm install @kysera/testing        # Test utilities (dev dependency)

# Plugins
npm install @kysera/soft-delete    # Soft delete plugin
npm install @kysera/audit          # Audit logging plugin
npm install @kysera/timestamps     # Auto timestamps plugin
npm install @kysera/migrations     # Migration system
```

## Quick Start

### 1. Define Your Database Schema

```typescript
import { Generated } from 'kysely'

interface Database {
  users: {
    id: Generated<number>
    email: string
    name: string
    created_at: Generated<Date>
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    content: string
    created_at: Generated<Date>
  }
}
```

### 2. Create Database Connection

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      host: 'localhost',
      database: 'myapp',
      user: 'postgres',
      password: 'postgres',
      max: 10
    })
  })
})
```

### 3. Create Repositories

```typescript
import { createRepositoryFactory } from '@kysera/repository'
import { z } from 'zod'

// Define validation schemas
const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
})

// Create factory
const factory = createRepositoryFactory(db)

// Create repository
const userRepo = factory.create({
  tableName: 'users' as const,
  mapRow: (row) => row,
  schemas: {
    create: userSchema,
    update: userSchema.partial()
  }
})
```

### 4. Use Repositories

```typescript
// Create a user
const user = await userRepo.create({
  email: 'john@example.com',
  name: 'John Doe'
})

// Find user by ID
const foundUser = await userRepo.findById(user.id)

// Update user
const updated = await userRepo.update(user.id, {
  name: 'John Smith'
})

// List users with pagination
const { data, hasNext } = await userRepo.findAll({
  limit: 10,
  offset: 0
})

// Delete user
await userRepo.delete(user.id)
```

## Using Transactions

```typescript
await db.transaction().execute(async (trx) => {
  // Create repositories with transaction executor
  const txFactory = createRepositoryFactory(trx)
  const txUserRepo = txFactory.create({ /* ... */ })
  const txPostRepo = txFactory.create({ /* ... */ })

  // All operations are atomic
  const user = await txUserRepo.create({
    email: 'jane@example.com',
    name: 'Jane Doe'
  })

  await txPostRepo.create({
    user_id: user.id,
    title: 'First Post',
    content: 'Hello World!'
  })

  // If error occurs, both operations roll back
})
```

## Adding Plugins

### Soft Delete

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' })
])

const userRepo = orm.createRepository((executor) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({ tableName: 'users', /* ... */ })
})

// Soft delete (sets deleted_at timestamp)
await userRepo.softDelete(userId)

// Find only non-deleted records (automatic)
const activeUsers = await userRepo.findAll()

// Include deleted records
const allUsers = await userRepo.findAllWithDeleted()

// Restore soft-deleted record
await userRepo.restore(userId)
```

### Audit Logging

```typescript
import { auditPlugin } from '@kysera/audit'

const orm = await createORM(db, [
  auditPlugin({
    getUserId: () => currentUser?.id || null,
    captureOldValues: true,
    captureNewValues: true
  })
])

// All CRUD operations are now audited automatically
const user = await userRepo.create({ email: 'test@example.com', name: 'Test' })

// Get audit history
const history = await userRepo.getAuditHistory(user.id)
```

### Timestamps

```typescript
import { timestampsPlugin } from '@kysera/timestamps'

const orm = await createORM(db, [
  timestampsPlugin({
    createdAtColumn: 'created_at',
    updatedAtColumn: 'updated_at'
  })
])

// created_at and updated_at are set automatically
const post = await postRepo.create({
  title: 'My Post',
  content: 'Content'
})

// updated_at is updated automatically on every update
await postRepo.update(post.id, { title: 'Updated Title' })
```

## Health Checks

```typescript
import { checkDatabaseHealth, createMetricsPool } from '@kysera/infra'

const pool = new Pool({ /* config */ })
const metricsPool = createMetricsPool(pool)

const health = await checkDatabaseHealth(db, metricsPool)
console.log(health)
// {
//   status: 'healthy',
//   checks: {
//     database: { connected: true, latency: 12 },
//     pool: { size: 10, active: 2, idle: 8, waiting: 0 }
//   },
//   timestamp: Date
// }
```

## Error Handling

```typescript
import { DatabaseError, UniqueConstraintError, ForeignKeyError, NotFoundError } from '@kysera/core'
import { ZodError } from 'zod'

try {
  await userRepo.create({ email: 'duplicate@example.com', name: 'User' })
} catch (error) {
  if (error instanceof ZodError) {
    // Validation error from Zod schema
    console.error('Invalid input:', error.errors)
  } else if (error instanceof UniqueConstraintError) {
    console.error('Email already exists:', error.constraint)
  } else if (error instanceof ForeignKeyError) {
    console.error('Referenced record not found:', error.constraint)
  } else if (error instanceof NotFoundError) {
    console.error('Record not found')
  } else if (error instanceof DatabaseError) {
    console.error('Database error:', error.code, error.detail)
  } else {
    throw error
  }
}
```

## Pagination

```typescript
import { paginate, paginateCursor } from '@kysera/core'

// Offset-based pagination
const page1 = await paginate(
  db.selectFrom('users').selectAll(),
  { page: 1, limit: 20 }
)

// Cursor-based pagination (more efficient for large datasets)
const result = await paginateCursor(
  db.selectFrom('users').selectAll(),
  {
    orderBy: [{ column: 'created_at', direction: 'desc' }],
    limit: 20
  }
)

// Get next page using cursor
const nextPage = await paginateCursor(
  db.selectFrom('users').selectAll(),
  {
    orderBy: [{ column: 'created_at', direction: 'desc' }],
    limit: 20,
    cursor: result.pagination.nextCursor
  }
)
```

## Next Steps

- [Core Concepts](/docs/core-concepts/overview) - Understand the architecture
- [Repository Pattern](/docs/core-concepts/repository-pattern) - Deep dive into repositories
- [Plugins](/docs/plugins/overview) - Explore available plugins
- [Best Practices](/docs/guides/best-practices) - Production-ready patterns
- [API Reference](/docs/api/core) - Detailed API documentation
