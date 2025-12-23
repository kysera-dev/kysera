---
sidebar_position: 2
title: Getting Started
description: Quick start guide for Kysera - 5 minutes to your first query
---

# Getting Started

Get up and running with Kysera in 5 minutes.

## Installation


### Prerequisites

- **Runtime**: Node.js >=20.0.0, Bun >=1.0.0, or Deno (experimental)
- **TypeScript**: ^5.9.2 (recommended)
- **Module System**: ESM-only (no CommonJS)

### Step 1: Install Core Dependencies

```bash
# Install Kysely (peer dependency) and database driver
npm install kysely@^0.28.9 pg

# For other databases:
# npm install kysely@^0.28.9 mysql2      # MySQL
# npm install kysely@^0.28.9 better-sqlite3  # SQLite
```

### Step 2: Install Kysera Foundation

```bash
# Install in order - executor first (foundation layer)
npm install @kysera/core           # Errors, pagination, types, logger (~8KB)
npm install @kysera/executor       # Unified Execution Layer - plugin foundation (~6KB)
```

### Step 3: Choose Your Pattern (or use both)

```bash
# Repository pattern (structured CRUD with validation)
npm install @kysera/repository     # Repository pattern (~12KB)

# Functional DAL (type-inferred queries with context)
npm install @kysera/dal            # Functional DAL (~7KB)

# Or install both for CQRS-lite pattern
```

### Step 4: Add Validation (Optional)

```bash
# Choose one validation library or none
npm install zod@^4.1.13                    # Popular schema validation (recommended)
# OR: npm install valibot                  # Lightweight alternative
# OR: npm install @sinclair/typebox        # JSON Schema based
```

### Step 5: Add Plugins (Optional)

```bash
npm install @kysera/soft-delete    # Soft delete plugin (~4KB)
npm install @kysera/audit          # Audit logging plugin (~11KB)
npm install @kysera/timestamps     # Auto timestamps plugin (~4KB)
npm install @kysera/rls            # Row-level security plugin (~44KB)
```

### Step 6: Add Infrastructure (Optional)

```bash
npm install @kysera/infra          # Health checks, retry, circuit breaker (~12KB)
npm install @kysera/debug          # Query logging and profiling (~5KB)
npm install @kysera/testing        # Test utilities (~6KB) - dev dependency
npm install @kysera/migrations     # Migration system (~11KB)
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

### 3. Create Executor with Plugins

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { timestampsPlugin } from '@kysera/timestamps'

// Create executor with plugins (foundation layer)
const executor = await createExecutor(db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' }),
  timestampsPlugin({ createdAtColumn: 'created_at', updatedAtColumn: 'updated_at' })
])

// Plugins now apply to ALL queries through this executor
```

### 4. Option A: Repository Pattern

```typescript
import { createORM, createRepositoryFactory } from '@kysera/repository'
import { z } from 'zod'

// Define validation schemas
const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
})

// Create ORM (plugin container, not traditional ORM)
const orm = await createORM(executor, [])

// Create repository
const userRepo = orm.createRepository(exec => {
  const factory = createRepositoryFactory(exec)
  return factory.create({
    tableName: 'users' as const,
    mapRow: row => row,
    schemas: {
      create: userSchema,
      update: userSchema.partial()
    }
  })
})
```

### 4. Option B: Functional DAL Pattern

```typescript
import { createQuery, createContext } from '@kysera/dal'

// Define queries with type inference
const getUser = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').where('id', '=', id).selectAll().executeTakeFirst()
)

const listUsers = createQuery((ctx, limit = 10) =>
  ctx.db.selectFrom('users').selectAll().limit(limit).execute()
)

const createUser = createQuery((ctx, data: { email: string; name: string }) =>
  ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
)

// Create context with executor (plugins apply automatically)
const ctx = createContext(executor)
```

### 5. Use Your Chosen Pattern

#### Using Repository Pattern

```typescript
// Create a user (timestamps added automatically)
const user = await userRepo.create({
  email: 'john@example.com',
  name: 'John Doe'
})
// Result: { id: 1, email: '...', name: '...', created_at: Date, updated_at: Date, deleted_at: null }

// Find user by ID
const foundUser = await userRepo.findById(user.id)

// Update user (updated_at set automatically)
const updated = await userRepo.update(user.id, {
  name: 'John Smith'
})

// List users with pagination (soft-deleted automatically excluded)
const { data, hasNext } = await userRepo.findAll({
  limit: 10,
  offset: 0
})

// Soft delete user (sets deleted_at instead of removing)
await userRepo.softDelete(user.id)

// Include soft-deleted records
const allUsers = await userRepo.findAllWithDeleted()

// Restore soft-deleted user
await userRepo.restore(user.id)
```

#### Using Functional DAL Pattern

```typescript
// All queries automatically filtered by plugins
const user = await createUser(ctx, {
  email: 'john@example.com',
  name: 'John Doe'
})
// Timestamps added automatically by timestampsPlugin

const foundUser = await getUser(ctx, user.id)
// Returns null if soft-deleted

const users = await listUsers(ctx, 20)
// Automatically excludes soft-deleted records
```

## Using Transactions

### Repository Pattern with Transactions

```typescript
// Transactions with plugins preserved
await orm.transaction(async (txCtx) => {
  // Create repositories with transaction context
  const txUserRepo = orm.createRepository(createUserRepository)
  const txPostRepo = orm.createRepository(createPostRepository)

  // All operations are atomic, plugins still apply
  const user = await txUserRepo.create({
    email: 'jane@example.com',
    name: 'Jane Doe'
  })
  // Timestamps added automatically in transaction

  await txPostRepo.create({
    user_id: user.id,
    title: 'First Post',
    content: 'Hello World!'
  })
  // Timestamps added automatically

  // If error occurs, both operations roll back
})
```

### Functional DAL with Transactions

```typescript
import { withTransaction } from '@kysera/dal'

// Transactions preserve plugins
await withTransaction(executor, async (txCtx) => {
  // All queries use the same transaction
  const user = await createUser(txCtx, {
    email: 'jane@example.com',
    name: 'Jane Doe'
  })

  const post = await createPost(txCtx, {
    user_id: user.id,
    title: 'First Post',
    content: 'Hello World!'
  })

  // Plugins (soft-delete, timestamps) still work in transaction
  // If error occurs, both operations roll back
})
```

## Combining Multiple Plugins

Plugins work with both Repository and DAL patterns through the Unified Execution Layer:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { auditPlugin } from '@kysera/audit'
import { timestampsPlugin } from '@kysera/timestamps'

// Create executor with multiple plugins
const executor = await createExecutor(db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' }),
  timestampsPlugin({
    createdAtColumn: 'created_at',
    updatedAtColumn: 'updated_at'
  }),
  auditPlugin({
    getUserId: () => currentUser?.id || null,
    captureOldValues: true,
    captureNewValues: true
  })
])

// Now use with Repository pattern
const orm = await createORM(executor, [])
const userRepo = orm.createRepository(createUserRepository)

// OR use with DAL pattern
const ctx = createContext(executor)

// ALL queries through executor get:
// - Automatic timestamps (created_at, updated_at)
// - Soft delete filtering (deleted_at)
// - Audit logging on mutations
```

### Plugin-Specific Methods

Some plugins add methods to repositories:

```typescript
// Soft delete methods (Repository pattern only)
await userRepo.softDelete(userId)        // Sets deleted_at timestamp
await userRepo.restore(userId)           // Clears deleted_at
await userRepo.findAllWithDeleted()      // Include soft-deleted records
await userRepo.findDeletedOnly()         // Only soft-deleted records

// Audit methods (Repository pattern only)
const history = await userRepo.getAuditHistory(userId)
const entry = await userRepo.getAuditEntry(auditId)
await userRepo.restoreFromAudit(auditId) // Restore old values

// Query filtering (works in both Repository and DAL)
const users = await getUsers(ctx)        // Automatically excludes soft-deleted
```

## Health Checks

```typescript
import { checkDatabaseHealth, createMetricsPool } from '@kysera/infra'

const pool = new Pool({
  /* config */
})
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
const page1 = await paginate(db.selectFrom('users').selectAll(), { page: 1, limit: 20 })

// Cursor-based pagination (more efficient for large datasets)
const result = await paginateCursor(db.selectFrom('users').selectAll(), {
  orderBy: [{ column: 'created_at', direction: 'desc' }],
  limit: 20
})

// Get next page using cursor
const nextPage = await paginateCursor(db.selectFrom('users').selectAll(), {
  orderBy: [{ column: 'created_at', direction: 'desc' }],
  limit: 20,
  cursor: result.pagination.nextCursor
})
```

## CQRS-lite Pattern (Repository + DAL)

Combine both patterns for commands and queries:

```typescript
import { createORM } from '@kysera/repository'
import { createQuery, createContext } from '@kysera/dal'

// Create executor with plugins
const executor = await createExecutor(db, [
  softDeletePlugin(),
  timestampsPlugin()
])

// Create ORM for writes
const orm = await createORM(executor, [])

// Define complex read queries with DAL
const getDashboardStats = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('users')
    .leftJoin('posts', 'users.id', 'posts.user_id')
    .select(({ fn }) => [
      'users.id',
      'users.name',
      fn.count('posts.id').as('post_count')
    ])
    .where('users.id', '=', userId)
    .groupBy('users.id')
    .executeTakeFirst()
)

// Use in transaction - both patterns work together
await orm.transaction(async (txCtx) => {
  // Repository for writes
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create({ email: 'test@example.com', name: 'Test' })

  // DAL for complex reads (same transaction context)
  const stats = await getDashboardStats(txCtx, user.id)

  // Both share the same plugins and transaction
})
```

## Next Steps

- [Core Concepts](/docs/core-concepts/overview) - Understand the architecture
- [Unified Execution Layer](/docs/api/executor) - Learn about @kysera/executor
- [Repository Pattern](/docs/core-concepts/repository-pattern) - Deep dive into repositories
- [Functional DAL](/docs/api/dal) - Type-safe functional queries
- [Plugins](/docs/plugins/overview) - Explore available plugins
- [Best Practices](/docs/guides/best-practices) - Production-ready patterns
- [API Reference](/docs/api/core) - Detailed API documentation
