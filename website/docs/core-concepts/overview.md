---
sidebar_position: 1
title: Overview
description: Core concepts and architecture of Kysera
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
│  @kysera/repository (CRUD + validation + plugin extensions)     │
│  @kysera/dal (Functional queries + type inference)              │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2.5: Unified Execution Layer (@kysera/executor ~8KB)     │
│  Plugin-aware Kysely wrapper, query interception               │
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

### Layer 2.5: Unified Execution Layer (v0.7+)

The `@kysera/executor` package provides a plugin-aware wrapper around Kysely:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

// Create plugin-aware executor
const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema }),  // High priority (50)
  softDeletePlugin()                  // Standard priority (0)
])

// Use like normal Kysely - plugins apply automatically
const users = await executor.selectFrom('users').selectAll().execute()
// -> SELECT * FROM users WHERE tenant_id = ? AND deleted_at IS NULL

// Works in transactions too
await executor.transaction().execute(async (trx) => {
  // trx inherits all plugins
  const user = await trx.selectFrom('users').where('id', '=', 1).executeTakeFirst()
})
```

**Key Features:**
- **Query Interception** - Plugins can modify queries before execution
- **Zero Overhead** - No performance penalty when no interceptor plugins are registered
- **Type Safe** - Full TypeScript support with Kysely types preserved
- **Transaction Propagation** - Plugins automatically work in transactions
- **Plugin Validation** - Detects conflicts, missing dependencies, and circular dependencies

**Why use `@kysera/executor`?**
- Enables plugins to work with **both** Repository and DAL patterns
- Provides automatic filtering (soft-delete, RLS) without code changes
- Foundation for unified plugin architecture across Kysera

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

**Repository Pattern** - Structured CRUD with validation and **full plugin support**:

```typescript
import { createRepositoryFactory, createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])
const userRepo = orm.createRepository(createUserRepository)

// Query interceptors work automatically
const users = await userRepo.findAll()  // Soft-deleted records filtered

// Extension methods from plugins
await userRepo.softDelete(1)
await userRepo.restore(1)
```

**Functional DAL** - Type-inferred queries with **query interceptor support** via `KyseraExecutor`:

```typescript
import { createExecutor } from '@kysera/executor'
import { createQuery, withTransaction } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
)

// Query interceptors applied automatically!
const user = await getUserById(executor, 1)  // Soft-deleted records filtered

// Plugins work in transactions too
const result = await withTransaction(executor, async (ctx) => {
  return getUserById(ctx, 1)  // Still filtered
})
```

:::tip Choosing Between Repository and DAL (v0.7+)
Both patterns now support query interceptor plugins through `@kysera/executor`:

- **Repository**: Query interceptors + extension methods (e.g., `repo.softDelete()`)
- **DAL with KyseraExecutor**: Query interceptors only (automatic filtering)
- **DAL without KyseraExecutor**: No plugin support (manual everything)

Use **Repository** when you need extension methods and validation.
Use **DAL with KyseraExecutor** when you need plugin filtering without repository overhead.
See [Repository vs DAL Guide](/docs/guides/dal-vs-repository) for detailed comparison.
:::

### Layer 4: Plugins

Extend repository functionality with plugins:

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { auditPlugin } from '@kysera/audit'

const orm = await createORM(db, [softDeletePlugin(), auditPlugin()])
```

## Key Concepts

### Unified Execution Layer (v0.7+)

The `@kysera/executor` package provides `KyseraExecutor`, a plugin-aware wrapper around Kysely:

```typescript
type KyseraExecutor<DB> = Kysely<DB> & {
  __kysera: true
  __plugins: readonly Plugin[]
  __rawDb: Kysely<DB>
}
```

This enables:
1. **Plugin interception** - Modify queries before execution
2. **Transaction propagation** - Plugins automatically work in transactions
3. **Unified plugin system** - Same plugins work with Repository and DAL patterns

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create plugin-aware executor
const executor = await createExecutor(db, [softDeletePlugin()])

// Works like Kysely, but with plugin interception
const users = await executor.selectFrom('users').selectAll().execute()
// -> SELECT * FROM users WHERE deleted_at IS NULL (plugin applied)

// Plugins propagate to transactions
await executor.transaction().execute(async (trx) => {
  // trx is KyseraTransaction with plugins
  const user = await trx.selectFrom('users').where('id', '=', 1).executeTakeFirst()
  // Soft-delete filter still applied
})
```

**Plugin Types:**
- **Query Interceptors** (`interceptQuery`) - Work with both Repository and DAL
- **Repository Extensions** (`extendRepository`) - Work only with Repository

### Executor Pattern (Legacy)

The `Executor` type allows factories to work with both Kysely and Transaction:

```typescript
type Executor<DB> = Kysely<DB> | Transaction<DB>
```

This pattern is now enhanced by `KyseraExecutor`, which extends it with plugin support:

```typescript
// Modern approach with plugins
const executor = await createExecutor(db, [softDeletePlugin()])
const orm = await createORM(executor, [])

// Legacy approach without plugins
const repos = createRepositories(db)

// Both work in transactions
await executor.transaction().execute(async (trx) => {
  const repos = createRepositories(trx)
  await repos.users.create({ ... })
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
  }
  // Output validation controlled via KYSERA_VALIDATION_MODE or NODE_ENV
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
- [Repository vs DAL](/docs/guides/dal-vs-repository) - Choose the right data access pattern
- [Transactions](/docs/core-concepts/transactions) - Transaction handling
- [Validation](/docs/core-concepts/validation) - Validation strategies
- [Error Handling](/docs/core-concepts/error-handling) - Error types and parsing
