---
sidebar_position: 5
title: Repository vs DAL
description: Choosing between Repository pattern and Functional DAL
---

# Repository vs Functional DAL

Kysera offers two approaches to data access: the **Repository pattern** (`@kysera/repository`) and the **Functional DAL** (`@kysera/dal`). This guide helps you choose the right approach for your project.

## Quick Decision Guide

```
Do you need repository extension plugins (audit.restore(), timestamps)?
├── Yes → Use Repository
└── No
    └── Do you need query interceptor plugins (soft-delete, RLS)?
        ├── Yes → Use DAL with KyseraExecutor OR Repository
        └── No
            └── Do you prefer OOP patterns with classes and methods?
                ├── Yes → Use Repository
                └── No
                    └── Do you need maximum type inference and tree-shaking?
                        ├── Yes → Use DAL
                        └── Either works - choose based on team preference
```

## Architecture Comparison

### Repository Pattern

The Repository pattern provides an **object-oriented** data access abstraction over database tables:

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { z } from 'zod'

// Create ORM with plugins
const orm = await createORM(db, [softDeletePlugin()])

// Define repository factory function
const createUserRepository = (executor, applyPlugins) => ({
  tableName: 'users',
  executor,
  async findById(id) {
    return executor.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
  },
  async create(data) {
    const validated = z
      .object({
        email: z.string().email(),
        name: z.string().min(1)
      })
      .parse(data)

    return executor.insertInto('users').values(validated).returningAll().executeTakeFirstOrThrow()
  }
  // ... other methods
})

// Create repository with plugin support
const userRepo = orm.createRepository(createUserRepository)

// Use repository methods (plugins automatically applied)
const user = await userRepo.findById(1)
const newUser = await userRepo.create({ email: 'test@example.com', name: 'Test' })

// Plugin extension methods also available
await userRepo.softDelete(1)
await userRepo.restore(1)
```

### Functional DAL

The Functional DAL provides **composable query functions** with automatic type inference:

```typescript
import { createQuery, withTransaction, createContext } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// Define queries as functions
const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
)

const getPostsByUserId = createQuery((ctx, userId: number) =>
  ctx.db.selectFrom('posts').selectAll().where('user_id', '=', userId).execute()
)

// Create context from executor (plugins automatically included)
const ctx = createContext(executor)

// Use queries (soft-delete filtering applied automatically)
const user = await getUserById(ctx, 1)

// Compose queries
const getUserWithPosts = async (ctx, id: number) => {
  const user = await getUserById(ctx, id)
  if (!user) return null
  const posts = await getPostsByUserId(ctx, user.id)
  return { ...user, posts }
}
```

## Feature Comparison

| Feature                          | Repository                    | Functional DAL              |
| -------------------------------- | ----------------------------- | --------------------------- |
| **Paradigm**                     | Object-Oriented               | Functional                  |
| **Abstraction Level**            | High (Repository methods)     | Low (Query functions)       |
| **Type Inference**               | Explicit generics             | Automatic from queries      |
| **Query Interceptor Plugins**    | Native                        | Native (via KyseraExecutor) |
| **Repository Extension Plugins** | Native                        | Not supported               |
| **Validation**                   | Built-in (Zod, Valibot, etc.) | Manual                      |
| **Transaction API**              | `repo.transaction()`          | `withTransaction()`         |
| **Bundle Size**                  | ~12 KB                        | ~7 KB                       |
| **Learning Curve**               | Moderate                      | Steep                       |
| **Boilerplate**                  | More                          | Less                        |
| **Tree-Shaking**                 | Medium                        | Excellent                   |
| **Testing**                      | Mock repositories             | Mock functions/context      |

## Architecture Deep Dive

Understanding how plugins work with both patterns requires examining the internal architecture.

### The Plugin System Architecture

Kysera's plugin system has two distinct mechanisms:

1. **Query Interceptors** (`interceptQuery`) - Modify query builders before execution
2. **Repository Extensions** (`extendRepository`) - Add new methods to repositories

Both patterns support **query interceptors** through `@kysera/executor`. Only Repository supports **repository extensions**.

### Plugin Interception Model

```
Repository Pattern (with KyseraExecutor):
┌─────────────────────────────────────────────────────────┐
│  Application Code                                       │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────┐                                    │
│  │  createORM()    │ ← Plugins registered here          │
│  │       │         │                                    │
│  │       ▼         │                                    │
│  │  ┌───────────┐  │                                    │
│  │  │ Plugins   │  │ interceptQuery() wraps QB          │
│  │  │ (chain)   │  │ extendRepository() adds methods    │
│  │  └─────┬─────┘  │                                    │
│  │        │        │                                    │
│  │        ▼        │                                    │
│  │  ┌───────────┐  │                                    │
│  │  │Repository │  │ ← Central execution point          │
│  │  └─────┬─────┘  │                                    │
│  └────────│────────┘                                    │
│           │                                             │
│           ▼                                             │
│    KyseraExecutor → Kysely → Database                   │
└─────────────────────────────────────────────────────────┘

Functional DAL (with KyseraExecutor):
┌─────────────────────────────────────────────────────────┐
│  Application Code                                       │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────┐                                    │
│  │ createQuery()   │ ← User-defined function            │
│  │       │         │                                    │
│  │       ▼         │                                    │
│  │  ctx.db.xxx()   │ ← KyseraExecutor access            │
│  └────────│────────┘                                    │
│           │                                             │
│           ▼                                             │
│    KyseraExecutor (Proxy) ← Interception point!         │
│           │                                             │
│           ▼                                             │
│  ┌─────────────────┐                                    │
│  │ Plugins (chain) │ interceptQuery() wraps QB          │
│  └────────┬────────┘                                    │
│           │                                             │
│           ▼                                             │
│       Kysely → Database                                 │
└─────────────────────────────────────────────────────────┘

Functional DAL (without KyseraExecutor):
┌─────────────────────────────────────────────────────────┐
│  Application Code                                       │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────┐                                    │
│  │ createQuery()   │ ← User-defined function            │
│  │       │         │                                    │
│  │       ▼         │                                    │
│  │  ctx.db.xxx()   │ ← Direct Kysely access             │
│  └────────│────────┘   NO interception point!           │
│           │                                             │
│           ▼                                             │
│       Kysely → Database                                 │
└─────────────────────────────────────────────────────────┘
```

### How KyseraExecutor Enables DAL Plugins

The `createQuery` function accepts either raw Kysely or `KyseraExecutor`:

```typescript
// From @kysera/dal/src/query.ts
export function createQuery<DB, TArgs, TResult>(
  queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult> {
  return (dbOrCtx: Kysely<DB> | KyseraExecutor<DB> | DbContext<DB>, ...args: TArgs) => {
    const ctx = 'db' in dbOrCtx ? dbOrCtx : createContext(dbOrCtx)
    return queryFn(ctx, ...args)
  }
}
```

When you pass a `KyseraExecutor` to a DAL query:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// DAL query receives the executor
const getUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())

// ctx.db is KyseraExecutor, which intercepts selectFrom() via Proxy
await getUsers(executor)
```

The `KyseraExecutor` is a **Proxy** that intercepts `selectFrom`, `insertInto`, `updateTable`, and `deleteFrom` calls, applying all plugin `interceptQuery` hooks before returning the query builder.

### The Technical Difference

| Aspect                    | Repository                            | DAL with KyseraExecutor     | DAL without KyseraExecutor  |
| ------------------------- | ------------------------------------- | --------------------------- | --------------------------- |
| **Query Building**        | Via repository methods                | Direct `ctx.db.xxx()` calls | Direct `ctx.db.xxx()` calls |
| **Interception Point**    | KyseraExecutor Proxy                  | KyseraExecutor Proxy        | None                        |
| **Query Interceptors**    | ✅ Supported                          | ✅ Supported                | ❌ Not available            |
| **Repository Extensions** | ✅ Supported                          | ❌ Not available            | ❌ Not available            |
| **Method Extension**      | `extendRepository` wraps CRUD methods | N/A - no methods to wrap    | N/A - no methods to wrap    |

## Plugin System

### Plugin Architecture

Kysera plugins have two integration mechanisms:

1. **Query Interceptors** (`interceptQuery`) - Work with both Repository and DAL (via `KyseraExecutor`)
2. **Repository Extensions** (`extendRepository`) - Only work with Repository pattern

### How Plugins Work

Plugins are defined with the following interface:

```typescript
interface Plugin {
  name: string
  version: string
  priority?: number // Higher = runs first (default: 0)
  dependencies?: string[] // Must be loaded before this plugin

  // Intercept and modify query builders BEFORE execution
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB

  // Extend repository with new methods AFTER creation
  extendRepository?<T extends object>(repo: T): T

  // Lifecycle hook
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void
}
```

### Plugin Behavior by Pattern

| Plugin                  | Repository                                            | DAL with KyseraExecutor           | DAL without KyseraExecutor        |
| ----------------------- | ----------------------------------------------------- | --------------------------------- | --------------------------------- |
| **@kysera/soft-delete** | Auto-filters `deleted_at IS NULL` + extension methods | Auto-filters `deleted_at IS NULL` | Must filter manually              |
| **@kysera/timestamps**  | Auto-sets `created_at`/`updated_at`                   | N/A (uses `extendRepository`)     | Must set manually                 |
| **@kysera/audit**       | Auto-logs all changes + extension methods             | N/A (uses `extendRepository`)     | Must log manually                 |
| **@kysera/rls**         | Auto-filters by tenant, validates access              | Auto-filters by tenant            | Context available, manual filters |

**Key Insight:** Plugins that only use `interceptQuery` (like soft-delete filtering and RLS filtering) work with DAL when using `KyseraExecutor`. Plugins that rely on `extendRepository` (like audit's `restore()` method or timestamps' automatic setting) only work with Repository.

### Example: Soft Delete

**Repository (automatic filtering + extension methods):**

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])
const userRepo = orm.createRepository(createUserRepository)

// Automatically excludes deleted records via interceptQuery
const users = await userRepo.findAll()

// Plugin adds these extension methods via extendRepository
await userRepo.softDelete(1)
await userRepo.restore(1)
await userRepo.findAllWithDeleted()
```

**DAL with KyseraExecutor (automatic filtering only):**

```typescript
import { createExecutor } from '@kysera/executor'
import { createContext, createQuery } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with soft-delete plugin
const executor = await createExecutor(db, [softDeletePlugin()])

// Create context from executor
const ctx = createContext(executor)

// Automatically excludes deleted records via interceptQuery
const getUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())

await getUsers(ctx) // Soft-deleted records filtered automatically!

// Must implement soft delete manually (no extension methods)
const softDeleteUser = createQuery((ctx, id: number) =>
  ctx.db
    .updateTable('users')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute()
)
```

**DAL without KyseraExecutor (manual filtering):**

```typescript
// Must add filter manually
const getActiveUsers = createQuery(ctx =>
  ctx.db
    .selectFrom('users')
    .selectAll()
    .where('deleted_at', 'is', null) // Manual!
    .execute()
)

// Must implement soft delete manually
const softDeleteUser = createQuery((ctx, id: number) =>
  ctx.db
    .updateTable('users')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute()
)
```

## RLS (Row-Level Security) Compatibility

### Repository with RLS

RLS works seamlessly with Repository (automatic filtering + validation):

```typescript
import { rlsPlugin, defineRLSSchema, filter, allow, rlsContext } from '@kysera/rls'

const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow(['update', 'delete'], ctx => ctx.auth.userId === ctx.row?.author_id)
    ]
  }
})

const orm = await createORM(db, [rlsPlugin({ schema: rlsSchema })])
const postRepo = orm.createRepository(createPostRepository)

await rlsContext.runAsync({ auth: { userId: 1, tenantId: 'acme', roles: ['user'] } }, async () => {
  // Automatically filtered by tenant_id
  const posts = await postRepo.findAll()

  // Automatically validates author_id for updates
  await postRepo.update(1, { title: 'New Title' })
})
```

### DAL with RLS (via KyseraExecutor)

RLS filtering works automatically with `KyseraExecutor`:

```typescript
import { createExecutor } from '@kysera/executor'
import { rlsPlugin, defineRLSSchema, filter, rlsContext } from '@kysera/rls'

const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))]
  }
})

// Create executor with RLS plugin
const executor = await createExecutor(db, [rlsPlugin({ schema: rlsSchema })])

const getPosts = createQuery(ctx => ctx.db.selectFrom('posts').selectAll().execute())

await rlsContext.runAsync({ auth: { userId: 1, tenantId: 'acme', roles: ['user'] } }, async () => {
  // Automatically filtered by tenant_id via interceptQuery
  const posts = await getPosts(executor)
})
```

### DAL without KyseraExecutor (manual filtering)

Without `KyseraExecutor`, RLS context is available but filtering is manual:

```typescript
import { rlsContext } from '@kysera/rls'

const getPostsByTenant = createQuery(ctx => {
  const rlsCtx = rlsContext.getContextOrNull()

  let query = ctx.db.selectFrom('posts').selectAll()

  // Must apply filter manually
  if (rlsCtx && !rlsCtx.auth.isSystem && rlsCtx.auth.tenantId) {
    query = query.where('tenant_id', '=', rlsCtx.auth.tenantId)
  }

  return query.execute()
})

// Context still works
await rlsContext.runAsync({ auth: { userId: 1, tenantId: 'acme', roles: ['user'] } }, async () => {
  const posts = await getPostsByTenant(db) // Manually filtered
})
```

### RLS Feature Support

| RLS Feature                     | Repository | DAL with KyseraExecutor  | DAL without KyseraExecutor |
| ------------------------------- | ---------- | ------------------------ | -------------------------- |
| `rlsContext.runAsync()`         | ✅ Yes     | ✅ Yes                   | ✅ Yes                     |
| `rlsContext.getContextOrNull()` | ✅ Yes     | ✅ Yes                   | ✅ Yes                     |
| `rlsContext.asSystemAsync()`    | ✅ Yes     | ✅ Yes                   | ✅ Yes                     |
| Auto SELECT filtering           | ✅ Yes     | ✅ Yes                   | ❌ No                      |
| Auto mutation validation        | ✅ Yes     | ❌ No (extension method) | ❌ No                      |
| `repo.withoutRLS()`             | ✅ Yes     | ❌ No (extension method) | ❌ No                      |
| `repo.canAccess()`              | ✅ Yes     | ❌ No (extension method) | ❌ No                      |

## Transaction Handling

Both patterns support transactions, but with different APIs:

### Repository Transactions

```typescript
// Method 1: Repository's transaction method
await userRepo.transaction(async (trx) => {
  const repos = createRepos(trx);
  await repos.users.create({ ... });
  await repos.posts.create({ ... });
});

// Method 2: Kysely transaction with repos
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx);
  await repos.users.create({ ... });
  await repos.posts.create({ ... });
});
```

### DAL Transactions

```typescript
import { withTransaction, createContext, createQuery } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'

// Using withTransaction with executor (plugins propagated)
const executor = await createExecutor(db, [softDeletePlugin()])

const result = await withTransaction(executor, async ctx => {
  const user = await createUser(ctx, userData)
  const post = await createPost(ctx, { userId: user.id, ...postData })
  return { user, post }
})

// Transactional queries (throw if not in transaction)
const transferFunds = createTransactionalQuery(async (ctx, from, to, amount) => {
  await debit(ctx, from, amount)
  await credit(ctx, to, amount)
})

await withTransaction(executor, ctx => transferFunds(ctx, 1, 2, 100))
```

## Combining Both Patterns (CQRS-lite)

You can use both patterns in the same application with the **CQRS-lite** pattern via `orm.transaction()`:

```typescript
import { createORM } from '@kysera/repository'
import { createQuery } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'
import { sql } from 'kysely'

// Create ORM with plugins (internally uses createExecutor)
const orm = await createORM(db, [softDeletePlugin()])

// Repository for writes (CRUD operations)
const userRepo = orm.createRepository(createUserRepository)

// DAL for complex reads (analytics, reports)
const getAnalytics = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('events')
    .select([sql<number>`count(*)`.as('total'), sql<number>`count(distinct date)`.as('activeDays')])
    .where('user_id', '=', userId)
    .executeTakeFirst()
)

// Use both in same transaction with shared plugins
await orm.transaction(async ctx => {
  // Repository for writes (plugins + extension methods)
  const user = await userRepo.create({ email: 'test@example.com' })

  // DAL for complex reads (plugins applied via context)
  const stats = await getAnalytics(ctx, user.id)

  return { user, stats }
})
```

:::tip CQRS-lite Pattern
The `orm.transaction()` method creates a `DbContext` that works with both Repository and DAL patterns. Both share the same plugin interceptors, ensuring consistent behavior. Repository additionally gets extension methods from plugins.
:::

## When to Use Each Pattern

### Use Repository When:

- You need **repository extension methods** (audit.restore(), timestamps auto-setting)
- You need **automatic validation** (Zod, Valibot, etc.) on all operations
- Your team prefers **OOP patterns**
- You want a **consistent API** across all tables
- You're building a **traditional layered architecture**
- You need both query interceptors AND extension methods from plugins

### Use DAL with KyseraExecutor When:

- You need **query interceptor plugins** (soft-delete filtering, RLS filtering)
- You need **complex, custom queries** beyond CRUD
- You prefer **functional programming** patterns
- You want **maximum type inference** from queries
- **Bundle size** is critical (7 KB vs 12 KB for repository)
- You're using **Vertical Slice Architecture**
- You want queries **colocated** with feature code
- You don't need repository extension methods

### Use DAL without KyseraExecutor When:

- You don't need any plugins
- You want **minimal overhead** and direct Kysely access
- You're building simple CRUD operations
- Plugin functionality can be implemented manually when needed

### Use Both When:

- Repository for **write operations** with full plugin support (create, update, delete)
- DAL for **complex read operations** (reports, analytics, aggregations)
- You want to share plugins via `KyseraExecutor` across both patterns
- Different teams have different preferences
- Migrating from one pattern to another incrementally

## Migration Guide

### From Repository to DAL

```typescript
// Before (Repository)
const user = await userRepo.findById(1)
const users = await userRepo.find({ where: { status: 'active' } })

// After (DAL)
const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
)

const getActiveUsers = createQuery(ctx =>
  ctx.db.selectFrom('users').selectAll().where('status', '=', 'active').execute()
)

const user = await getUserById(db, 1)
const users = await getActiveUsers(db)
```

### From DAL to Repository

```typescript
// Before (DAL)
const createUser = createQuery((ctx, data: CreateUserInput) =>
  ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
)

// After (Repository)
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    create: CreateUserSchema
  }
})

const user = await userRepo.create(data)
```

## Best Practices

### For Repository

1. **Keep repositories thin** - data access only, no business logic
2. **Use factory pattern** for dependency injection
3. **Define clear schemas** for create/update operations
4. **Order plugins correctly** - timestamps → soft-delete → audit

### For DAL

1. **Create reusable query functions** for common operations
2. **Use composition utilities** (`compose`, `parallel`, `chain`)
3. **Create middleware helpers** for cross-cutting concerns
4. **Use `createTransactionalQuery`** for operations that require transactions

### For Both

1. **Choose one pattern as primary** to avoid confusion
2. **Document your choice** in the project README
3. **Be consistent** within each module/feature
4. **Test thoroughly** - both patterns have different testing approaches

## See Also

- [Repository API](/docs/api/repository) - Repository pattern reference
- [DAL API](/docs/api/dal) - Functional DAL reference
- [Plugins Overview](/docs/plugins/overview) - Plugin system architecture
- [RLS Plugin](/docs/plugins/rls) - Row-Level Security
- [Best Practices](/docs/guides/best-practices) - Production patterns
