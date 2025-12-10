---
sidebar_position: 1
title: Overview
description: Core concepts and architecture of Kysera ORM
---

# Core Concepts Overview

Kysera is built on a layered architecture that allows you to use only what you need while maintaining full type safety and production readiness.

## Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Plugins                                               │
│  (@kysera/soft-delete, @kysera/audit, @kysera/timestamps, etc.) │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Repository Pattern (@kysera/repository)               │
│  Optional - Provides structured data access with validation     │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Core Utilities (@kysera/core)                         │
│  Debug, errors, health checks, pagination, retry, testing       │
├─────────────────────────────────────────────────────────────────┤
│  Layer 0: Kysely Foundation                                     │
│  Direct SQL query builder - no wrapper required                 │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 0: Kysely Foundation

You can use Kysely directly without any Kysera wrapper:

```typescript
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString: '...' }) })
})

// Direct Kysely usage - no abstraction
const users = await db.selectFrom('users').selectAll().execute()
```

### Layer 1: Core Utilities

Add production utilities without changing your data access patterns:

```typescript
import { withDebug, checkDatabaseHealth, parseDatabaseError } from '@kysera/core'

// Debug wrapper for query logging
const debugDb = withDebug(db, { logQuery: true, slowQueryThreshold: 100 })

// Health checks for monitoring
const health = await checkDatabaseHealth(db, pool)

// Type-safe error handling
try {
  await db.insertInto('users').values({ email: 'duplicate@test.com' }).execute()
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')
  if (dbError instanceof UniqueConstraintError) {
    // Handle constraint violation
  }
}
```

### Layer 2: Repository Pattern

Optional structured data access with validation:

```typescript
import { createRepositoryFactory } from '@kysera/repository'

const factory = createRepositoryFactory(db)
const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: { create: CreateUserSchema, update: UpdateUserSchema }
})

const user = await userRepo.create({ email: 'test@example.com', name: 'Test' })
```

### Layer 3: Plugins

Extend repository functionality with plugins:

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { auditPlugin } from '@kysera/audit'

const orm = await createORM(db, [softDeletePlugin(), auditPlugin()])
```

## Key Concepts

### Executor Pattern

The `Executor` type is central to Kysera's transaction support:

```typescript
type Executor<DB> = Kysely<DB> | Transaction<DB>
```

This allows repository factories to work identically in normal context or within transactions:

```typescript
// Normal usage
const repos = createRepositories(db)
const user = await repos.users.findById(1)

// Within transaction - same API!
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx)
  await repos.users.create({ ... })
  await repos.posts.create({ ... })
})
```

### Smart Validation

Kysera uses a smart validation strategy for optimal performance:

- **Input validation**: Always enabled (validates user data)
- **Output validation**: Configurable (development vs production)

```typescript
const userRepo = factory.create({
  tableName: 'users',
  schemas: {
    create: CreateUserSchema,  // Always validated
    entity: UserSchema         // Optional - validates DB results
  },
  validateDbResults: process.env.NODE_ENV === 'development'
})
```

### Type Mapping

Kysera maintains full type safety through a three-layer type system:

```typescript
// 1. Table Types (from Kysely)
interface UsersTable {
  id: Generated<number>
  email: string
  created_at: Generated<Date>
}

// 2. Domain Types (Selectable)
type User = Selectable<UsersTable>

// 3. Validation Schemas (Zod)
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  created_at: z.date()
})
```

## What's Next

- [Architecture](/docs/core-concepts/architecture) - Deep dive into the architecture
- [Repository Pattern](/docs/core-concepts/repository-pattern) - Learn about repositories
- [Transactions](/docs/core-concepts/transactions) - Transaction handling
- [Validation](/docs/core-concepts/validation) - Validation strategies
- [Error Handling](/docs/core-concepts/error-handling) - Error types and parsing
