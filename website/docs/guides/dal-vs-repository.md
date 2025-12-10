---
sidebar_position: 5
title: Repository vs DAL
description: Choosing between Repository pattern and Functional DAL
---

# Repository vs Functional DAL

Kysera offers two approaches to data access: the **Repository pattern** (`@kysera/repository`) and the **Functional DAL** (`@kysera/dal`). This guide helps you choose the right approach for your project.

## Quick Decision Guide

```
Do you need plugins (soft-delete, audit, timestamps, RLS)?
├── Yes → Use Repository
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

The Repository pattern provides an **object-oriented** abstraction over database tables:

```typescript
import { createRepositoryFactory, createORM } from '@kysera/repository';
import { softDeletePlugin } from '@kysera/soft-delete';
import { z } from 'zod';

// Create factory
const factory = createRepositoryFactory(db);

// Define repository
const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
  }),
  schemas: {
    create: z.object({
      email: z.string().email(),
      name: z.string().min(1),
    }),
  },
});

// Use repository methods
const user = await userRepo.findById(1);
const users = await userRepo.findAll();
const newUser = await userRepo.create({ email: 'test@example.com', name: 'Test' });
```

### Functional DAL

The Functional DAL provides **composable query functions** with automatic type inference:

```typescript
import { createQuery, withTransaction, parallel } from '@kysera/dal';

// Define queries as functions
const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
);

const getPostsByUserId = createQuery((ctx, userId: number) =>
  ctx.db.selectFrom('posts').selectAll().where('user_id', '=', userId).execute()
);

// Use directly
const user = await getUserById(db, 1);

// Compose queries
const getUserWithPosts = async (db, id: number) => {
  const user = await getUserById(db, id);
  if (!user) return null;
  const posts = await getPostsByUserId(db, user.id);
  return { ...user, posts };
};
```

## Feature Comparison

| Feature | Repository | Functional DAL |
|---------|-----------|----------------|
| **Paradigm** | Object-Oriented | Functional |
| **Abstraction Level** | High (Repository class) | Low (Query functions) |
| **Type Inference** | Explicit generics | Automatic from queries |
| **Plugin Support** | Native | None (manual integration) |
| **Validation** | Built-in (Zod, Valibot, etc.) | Manual |
| **Transaction API** | `repo.transaction()` | `withTransaction()` |
| **Bundle Size** | ~12 KB | ~7 KB |
| **Learning Curve** | Moderate | Steep |
| **Boilerplate** | More | Less |
| **Tree-Shaking** | Medium | Excellent |
| **Testing** | Mock repositories | Mock functions/context |

## Architecture Deep Dive

Understanding **why** plugins only work with Repository requires examining the internal architecture.

### The Plugin Interception Model

```
Repository Pattern:
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
│       Kysely → Database                                 │
└─────────────────────────────────────────────────────────┘

Functional DAL:
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

### Why DAL Cannot Use Plugins

The `createQuery` function creates standalone functions that directly access Kysely:

```typescript
// From @kysera/dal/src/query.ts
export function createQuery<DB, TArgs, TResult>(
  queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult> {
  const fn = (dbOrCtx: Kysely<DB> | DbContext<DB>, ...args: TArgs) => {
    const ctx = 'db' in dbOrCtx ? dbOrCtx : createContext(dbOrCtx);
    return queryFn(ctx, ...args);  // Directly executes user's function
  };
  return fn;
}
```

The QueryBuilder is built and executed **entirely within the user's function**. There's no interception point for plugins.

In contrast, Repository has `createORM` which:

```typescript
// From @kysera/repository/src/plugin.ts
function createRepository<T>(factory): T {
  let repo = factory(executor, applyPlugins);  // Plugins can intercept here

  for (const plugin of plugins) {
    if (plugin.extendRepository) {
      repo = plugin.extendRepository(repo);   // Plugins wrap methods here
    }
  }
  return repo;
}
```

### The Technical Difference

| Aspect | Repository | DAL |
|--------|-----------|-----|
| **Query Building** | Via repository methods that call `applyPlugins()` | Direct `ctx.db.xxx()` calls |
| **Interception Point** | `interceptQuery` receives QB before execution | None - user controls entire flow |
| **Method Extension** | `extendRepository` wraps CRUD methods | No methods to wrap |
| **Centralization** | Single `createRepository` entry point | Distributed query functions |

## Plugin System

:::warning Critical Difference
**Plugins only work with Repository pattern.** DAL queries bypass the plugin system entirely because they execute Kysely queries directly without going through the plugin interception layer.
:::

### How Plugins Work

Plugins integrate with Repository through two hooks:

```typescript
interface Plugin {
  name: string;
  version: string;
  priority?: number;        // Higher = runs first (default: 0)
  dependencies?: string[];  // Must be loaded before this plugin

  // Intercept and modify query builders BEFORE execution
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB;

  // Extend repository with new methods AFTER creation
  extendRepository?<T extends object>(repo: T): T;

  // Lifecycle hooks
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void;
  afterQuery?(context: QueryContext, result: unknown): unknown;
  onError?(context: QueryContext, error: unknown): void;
}
```

### Plugin Behavior by Pattern

| Plugin | Repository | DAL |
|--------|-----------|-----|
| **@kysera/soft-delete** | Auto-filters `deleted_at IS NULL` | Must filter manually |
| **@kysera/timestamps** | Auto-sets `created_at`/`updated_at` | Must set manually |
| **@kysera/audit** | Auto-logs all changes | Must log manually |
| **@kysera/rls** | Auto-filters by tenant, validates access | Context available, manual filters |

### Example: Soft Delete

**Repository (automatic):**
```typescript
const orm = await createORM(db, [softDeletePlugin()]);
const userRepo = orm.createRepository(createUserRepository);

// Automatically excludes deleted records
const users = await userRepo.findAll();

// Plugin adds these methods
await userRepo.softDelete(1);
await userRepo.restore(1);
await userRepo.findAllWithDeleted();
```

**DAL (manual):**
```typescript
// Must add filter manually
const getActiveUsers = createQuery((ctx) =>
  ctx.db
    .selectFrom('users')
    .selectAll()
    .where('deleted_at', 'is', null)  // Manual!
    .execute()
);

// Must implement soft delete manually
const softDeleteUser = createQuery((ctx, id: number) =>
  ctx.db
    .updateTable('users')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute()
);
```

## RLS (Row-Level Security) Compatibility

### Repository with RLS

RLS works seamlessly with Repository:

```typescript
import { rlsPlugin, defineRLSSchema, filter, allow, rlsContext } from '@kysera/rls';

const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow(['update', 'delete'], ctx => ctx.auth.userId === ctx.row?.author_id),
    ],
  },
});

const orm = await createORM(db, [rlsPlugin({ schema: rlsSchema })]);
const postRepo = orm.createRepository(createPostRepository);

await rlsContext.runAsync(
  { auth: { userId: 1, tenantId: 'acme', roles: ['user'] } },
  async () => {
    // Automatically filtered by tenant_id
    const posts = await postRepo.findAll();

    // Automatically validates author_id for updates
    await postRepo.update(1, { title: 'New Title' });
  }
);
```

### DAL with RLS

RLS context is available in DAL, but filtering is manual:

```typescript
import { rlsContext } from '@kysera/rls';

const getPostsByTenant = createQuery((ctx) => {
  const rlsCtx = rlsContext.getContextOrNull();

  let query = ctx.db.selectFrom('posts').selectAll();

  // Must apply filter manually
  if (rlsCtx && !rlsCtx.auth.isSystem && rlsCtx.auth.tenantId) {
    query = query.where('tenant_id', '=', rlsCtx.auth.tenantId);
  }

  return query.execute();
});

// Context still works
await rlsContext.runAsync(
  { auth: { userId: 1, tenantId: 'acme', roles: ['user'] } },
  async () => {
    const posts = await getPostsByTenant(db);  // Manually filtered
  }
);
```

### RLS Feature Support

| RLS Feature | Repository | DAL |
|-------------|-----------|-----|
| `rlsContext.runAsync()` | Yes | Yes |
| `rlsContext.getContextOrNull()` | Yes | Yes |
| `rlsContext.asSystemAsync()` | Yes | Yes |
| Auto SELECT filtering | Yes | No |
| Auto mutation validation | Yes | No |
| `repo.withoutRLS()` | Yes | No (method on repo) |
| `repo.canAccess()` | Yes | No (method on repo) |

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
// Using withTransaction
const result = await withTransaction(db, async (ctx) => {
  const user = await createUser(ctx, userData);
  const post = await createPost(ctx, { userId: user.id, ...postData });
  return { user, post };
});

// Transactional queries (throw if not in transaction)
const transferFunds = createTransactionalQuery(async (ctx, from, to, amount) => {
  await debit(ctx, from, amount);
  await credit(ctx, to, amount);
});

await withTransaction(db, (ctx) => transferFunds(ctx, 1, 2, 100));
```

## Combining Both Patterns

You can use both patterns in the same application:

```typescript
// Repository for CRUD with plugins
const orm = await createORM(db, [
  softDeletePlugin(),
  auditPlugin(),
]);
const userRepo = orm.createRepository(createUserRepository);

// DAL for complex queries
const getAnalytics = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('events')
    .select([
      sql<number>`count(*)`.as('total'),
      sql<number>`count(distinct date)`.as('activeDays'),
    ])
    .where('user_id', '=', userId)
    .executeTakeFirst()
);

// Use both in same transaction
await db.transaction().execute(async (trx) => {
  // Repository with plugins
  const orm = await createORM(trx, [softDeletePlugin()]);
  const userRepo = orm.createRepository(createUserRepository);
  const user = await userRepo.create({ email: 'test@example.com' });

  // DAL for analytics (no plugins needed)
  const ctx = createContext(trx);
  const stats = await getAnalytics(ctx, user.id);

  return { user, stats };
});
```

:::caution Consistency Warning
When mixing patterns, ensure both use the same executor (database or transaction) to maintain consistency.
:::

## When to Use Each Pattern

### Use Repository When:

- You need **plugins** (soft-delete, audit, timestamps, RLS)
- Building a **multi-tenant** application with RLS
- Your team prefers **OOP patterns**
- You need **built-in validation** (Zod, Valibot, etc.)
- You want a **consistent API** across all tables
- You're building a **traditional layered architecture**

### Use DAL When:

- You need **complex, custom queries** beyond CRUD
- You prefer **functional programming** patterns
- You want **maximum type inference** from queries
- **Bundle size** is critical (7 KB vs 12 KB)
- You're using **Vertical Slice Architecture**
- You don't need plugins or will implement functionality manually
- You want queries **colocated** with feature code

### Use Both When:

- Repository for **write operations** with plugins (create, update, delete)
- DAL for **complex read operations** (reports, analytics, aggregations)
- Different teams have different preferences
- Migrating from one pattern to another incrementally

## Migration Guide

### From Repository to DAL

```typescript
// Before (Repository)
const user = await userRepo.findById(1);
const users = await userRepo.find({ where: { status: 'active' } });

// After (DAL)
const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
);

const getActiveUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().where('status', '=', 'active').execute()
);

const user = await getUserById(db, 1);
const users = await getActiveUsers(db);
```

### From DAL to Repository

```typescript
// Before (DAL)
const createUser = createQuery((ctx, data: CreateUserInput) =>
  ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
);

// After (Repository)
const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: {
    create: CreateUserSchema,
  },
});

const user = await userRepo.create(data);
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
