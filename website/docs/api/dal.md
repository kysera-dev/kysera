---
sidebar_position: 3
title: "@kysera/dal"
description: Functional Data Access Layer API reference
---

# @kysera/dal

Functional Data Access Layer for Kysera ORM - Query functions, context passing, and composition utilities.

## Installation

```bash
npm install @kysera/dal kysely
```

## Overview

**Bundle Size:** ~7 KB (minified)
**Dependencies:** None (peer: kysely >=0.28.8)

`@kysera/dal` provides a functional approach to database access as an alternative to traditional repository patterns. Instead of classes and methods, you write **query functions** that are composable, type-safe, and easy to test.

## Key Features

- **Query Functions** - Pure functions instead of repository methods
- **Type Inference** - Return types automatically inferred from queries
- **Context Passing** - Explicit database context (no DI containers)
- **Transaction Support** - First-class transaction handling
- **Composition Utilities** - Combine queries with `compose`, `chain`, `parallel`

## Quick Start

```typescript
import { Kysely } from 'kysely';
import { createQuery, withTransaction } from '@kysera/dal';

// Create query functions
const getUserById = createQuery((ctx, id: number) =>
  ctx.db
    .selectFrom('users')
    .select(['id', 'email', 'name'])
    .where('id', '=', id)
    .executeTakeFirst()
);

const createUser = createQuery((ctx, data: { email: string; name: string }) =>
  ctx.db
    .insertInto('users')
    .values(data)
    .returningAll()
    .executeTakeFirstOrThrow()
);

// Use directly
const user = await getUserById(db, 1);

// Use in transactions
const result = await withTransaction(db, async (ctx) => {
  return createUser(ctx, { email: 'test@example.com', name: 'Test' });
});
```

## Query Functions

Query functions are the building blocks of the Functional DAL:

```typescript
import { createQuery } from '@kysera/dal';

// Select query
const findUserByEmail = createQuery((ctx, email: string) =>
  ctx.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
);

// Insert query
const insertPost = createQuery((ctx, data: { title: string; userId: number }) =>
  ctx.db.insertInto('posts').values(data).returningAll().executeTakeFirstOrThrow()
);

// Update query
const updateUserName = createQuery((ctx, id: number, name: string) =>
  ctx.db.updateTable('users').set({ name }).where('id', '=', id).returningAll().executeTakeFirst()
);
```

## Transactions

```typescript
import { withTransaction, createTransactionalQuery } from '@kysera/dal';

// Regular transaction
const result = await withTransaction(db, async (ctx) => {
  const user = await createUser(ctx, userData);
  const profile = await createProfile(ctx, { userId: user.id, ...profileData });
  return { user, profile };
});

// Query that REQUIRES a transaction
const transferFunds = createTransactionalQuery(
  async (ctx, fromId: number, toId: number, amount: number) => {
    await ctx.db.updateTable('accounts')
      .set((eb) => ({ balance: eb('balance', '-', amount) }))
      .where('id', '=', fromId).execute();
    await ctx.db.updateTable('accounts')
      .set((eb) => ({ balance: eb('balance', '+', amount) }))
      .where('id', '=', toId).execute();
    return { success: true };
  }
);

// This will throw: "Query requires a transaction"
await transferFunds(db, 1, 2, 100);

// This works
await withTransaction(db, (ctx) => transferFunds(ctx, 1, 2, 100));
```

## Composition Utilities

### compose

Compose two queries sequentially:

```typescript
import { compose } from '@kysera/dal';

const getUserWithPosts = compose(
  getUserById,
  async (ctx, user) => ({
    ...user,
    posts: await getPostsByUserId(ctx, user.id),
  })
);

const result = await getUserWithPosts(db, 1);
// { id: 1, email: '...', posts: [...] }
```

### chain

Chain multiple transformations:

```typescript
import { chain } from '@kysera/dal';

const getUserComplete = chain(
  getUser,
  async (ctx, user) => ({ ...user, posts: await getPosts(ctx, user.id) }),
  async (ctx, data) => ({ ...data, followers: await getFollowers(ctx, data.id) })
);
```

### parallel

Execute multiple queries concurrently:

```typescript
import { parallel } from '@kysera/dal';

const getDashboardData = parallel({
  user: getUserById,
  stats: getUserStats,
  notifications: getNotifications,
});

const dashboard = await getDashboardData(db, userId);
// { user: {...}, stats: {...}, notifications: [...] }
```

### conditional

Execute conditionally:

```typescript
import { conditional } from '@kysera/dal';

const getFeatures = conditional(
  (ctx, userId: number, isPremium: boolean) => isPremium,
  getPremiumFeatures,
  []  // Fallback for non-premium users
);
```

### mapResult

Transform array results:

```typescript
import { mapResult } from '@kysera/dal';

const getUserNames = mapResult(getAllUsers, (user) => user.name);
const names = await getUserNames(db);  // string[]
```

## Context Management

```typescript
import { createContext, isInTransaction, withContext } from '@kysera/dal';

// Create a context manually
const ctx = createContext(db);

// Use with context wrapper
const users = await withContext(db, async (ctx) => getAllUsers(ctx));

// Check if in transaction
const myQuery = createQuery((ctx, id: number) => {
  if (isInTransaction(ctx)) {
    console.log('Running inside transaction');
  }
  return ctx.db.selectFrom('users').where('id', '=', id).executeTakeFirst();
});
```

## TypeScript Types

```typescript
interface DbContext<DB> {
  readonly db: Kysely<DB> | Transaction<DB>;
  readonly isTransaction: boolean;
}

type QueryFunction<DB, TArgs, TResult> = (
  ctxOrDb: DbContext<DB> | Kysely<DB>,
  ...args: TArgs
) => Promise<TResult>;

interface TransactionOptions {
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
}

// Type inference utilities
type InferResult<T> = T extends QueryFunction<any, any, infer R> ? R : never;
type InferArgs<T> = T extends QueryFunction<any, infer A, any> ? A : never;
type InferDB<T> = T extends QueryFunction<infer DB, any, any> ? DB : never;
```

## Plugin Compatibility

:::warning Important Limitation
**DAL does not support Kysera plugins automatically.** Plugins like `@kysera/soft-delete`, `@kysera/timestamps`, `@kysera/audit`, and `@kysera/rls` are designed for the Repository pattern and do not apply to DAL queries.
:::

### Why Plugins Don't Work with DAL

Kysera plugins work through two mechanisms:

1. **`interceptQuery`** - Modifies query builders (adds WHERE clauses, etc.)
2. **`extendRepository`** - Adds methods to repositories (softDelete, restore, etc.)

DAL queries work directly with `ctx.db` (Kysely instance), bypassing these plugin hooks:

```typescript
// DAL query - plugins NOT applied
const getUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()  // Direct Kysely access
);

// Repository with plugins - plugins ARE applied
const orm = await createORM(db, [softDeletePlugin()]);
const users = await userRepo.findAll();  // Soft-deleted records filtered
```

### Plugin Compatibility Matrix

| Plugin | Repository | DAL |
|--------|-----------|-----|
| `@kysera/soft-delete` | Automatic filtering | Manual filtering required |
| `@kysera/timestamps` | Automatic timestamps | Manual timestamps required |
| `@kysera/audit` | Automatic logging | Manual logging required |
| `@kysera/rls` | Automatic filtering + validation | Context available, manual filtering |

### Manual Integration Patterns

If you need plugin-like behavior in DAL, implement it manually:

#### Soft Delete in DAL

```typescript
const getActiveUsers = createQuery((ctx) =>
  ctx.db
    .selectFrom('users')
    .selectAll()
    .where('deleted_at', 'is', null)  // Manual soft-delete filter
    .execute()
);

const softDeleteUser = createQuery((ctx, id: number) =>
  ctx.db
    .updateTable('users')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute()
);
```

#### Timestamps in DAL

```typescript
const createUser = createQuery((ctx, data: CreateUserInput) =>
  ctx.db
    .insertInto('users')
    .values({
      ...data,
      created_at: new Date().toISOString(),  // Manual timestamp
      updated_at: new Date().toISOString(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
);
```

#### RLS Context in DAL

RLS context (`rlsContext`) can be accessed in DAL, but you must apply filters manually:

```typescript
import { rlsContext } from '@kysera/rls';

const getUsersByTenant = createQuery((ctx) => {
  const rlsCtx = rlsContext.getContextOrNull();

  let query = ctx.db.selectFrom('users').selectAll();

  // Apply RLS filter manually
  if (rlsCtx && !rlsCtx.auth.isSystem && rlsCtx.auth.tenantId) {
    query = query.where('tenant_id', '=', rlsCtx.auth.tenantId);
  }

  return query.execute();
});

// Usage within RLS context
await rlsContext.runAsync(
  { auth: { userId: 1, tenantId: 'acme', roles: ['user'] } },
  async () => {
    const users = await getUsersByTenant(db);  // Filtered by tenant
  }
);
```

### Creating Reusable Middleware

For consistent plugin-like behavior across DAL queries:

```typescript
// Helper function for RLS filtering
function withTenantFilter<T>(
  query: SelectQueryBuilder<DB, any, T>,
  tableName: string
): SelectQueryBuilder<DB, any, T> {
  const ctx = rlsContext.getContextOrNull();
  if (!ctx || ctx.auth.isSystem) return query;
  if (!ctx.auth.tenantId) return query;

  return query.where(`${tableName}.tenant_id` as any, '=', ctx.auth.tenantId);
}

// Helper function for soft-delete filtering
function excludeDeleted<T>(
  query: SelectQueryBuilder<DB, any, T>,
  tableName: string,
  column = 'deleted_at'
): SelectQueryBuilder<DB, any, T> {
  return query.where(`${tableName}.${column}` as any, 'is', null);
}

// Usage
const getUsers = createQuery((ctx) =>
  excludeDeleted(
    withTenantFilter(
      ctx.db.selectFrom('users').selectAll(),
      'users'
    ),
    'users'
  ).execute()
);
```

## When to Use DAL vs Repository

| Scenario | Repository | Functional DAL |
|----------|------------|----------------|
| CRUD operations with validation | Better | Suitable |
| Complex custom queries | Limited | Better |
| Multi-table transactions | Verbose | Better |
| Vertical Slice Architecture | Not ideal | Ideal |
| Maximum type inference | Medium | Excellent |
| Tree-shaking critical | Medium | Excellent |
| **Need plugins (soft-delete, audit, RLS)** | **Native support** | **Manual integration** |
| **Multi-tenant with RLS** | **Better** | **Requires manual filters** |

## Combining DAL and Repository

You can use both patterns in the same application, but be cautious:

```typescript
// Using both patterns together
await db.transaction().execute(async (trx) => {
  // Repository for write operations (with plugins)
  const orm = await createORM(trx, [softDeletePlugin(), auditPlugin()]);
  const userRepo = orm.createRepository(createUserRepository);
  await userRepo.create({ email: 'test@example.com' });  // Plugins applied

  // DAL for complex read queries
  const ctx = createContext(trx);
  const stats = await getUserStats(ctx);  // No plugins, but same transaction
});
```

:::caution Transaction Consistency
When mixing patterns, ensure both use the same transaction executor (`trx`) to maintain ACID guarantees.
:::

## See Also

- [Repository vs DAL Guide](/docs/guides/dal-vs-repository) - Detailed comparison and decision guide
- [Repository API](/docs/api/repository) - Repository pattern reference
- [RLS Plugin](/docs/plugins/rls) - Row-Level Security for repositories
- [Soft Delete Plugin](/docs/plugins/soft-delete) - Soft delete for repositories
