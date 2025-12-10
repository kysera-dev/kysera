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
│  Layer 4: Plugins                                               │
│  (@kysera/soft-delete, @kysera/audit, @kysera/timestamps, etc.) │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Data Access (choose your style)                       │
│  @kysera/repository (CRUD + validation)                         │
│  @kysera/dal (Functional queries + type inference)              │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Infrastructure (opt-in)                               │
│  @kysera/infra (health, retry, circuit breaker)                 │
│  @kysera/debug (logging, profiling)                             │
│  @kysera/testing (test utilities)                               │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Core Utilities (@kysera/core ~8KB)                    │
│  Errors, error codes, pagination, types, logger                 │
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

The minimal core package (~8KB) provides essential utilities:

```typescript
import { parseDatabaseError, UniqueConstraintError, paginate } from '@kysera/core'

// Type-safe error handling
try {
  await db.insertInto('users').values({ email: 'duplicate@test.com' }).execute()
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')
  if (dbError instanceof UniqueConstraintError) {
    // Handle constraint violation
  }
}

// Pagination helpers
const page = await paginate(db.selectFrom('users').selectAll(), { page: 1, limit: 20 })
```

### Layer 2: Infrastructure (Opt-in)

Add production utilities from separate packages:

```typescript
import { withDebug } from '@kysera/debug'
import { checkDatabaseHealth, withRetry } from '@kysera/infra'

// Debug wrapper for query logging
const debugDb = withDebug(db, { logQuery: true, slowQueryThreshold: 100 })

// Health checks for monitoring
const health = await checkDatabaseHealth(db, pool)

// Retry with exponential backoff
const users = await withRetry(() => db.selectFrom('users').execute())
```

### Layer 3: Data Access

Choose your data access style:

**Repository Pattern** - Structured CRUD with validation:

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

**Functional DAL** - Type-inferred queries with context passing:

```typescript
import { createQuery, withTransaction } from '@kysera/dal'

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
)

// Use directly or in transactions
const user = await getUserById(db, 1)
const result = await withTransaction(db, async (ctx) => {
  return getUserById(ctx, 1)
})
```

### Layer 4: Plugins

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
