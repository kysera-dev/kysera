---
sidebar_position: 3
title: "@kysera/dal"
description: Functional Data Access Layer API reference
---

# @kysera/dal

Functional Data Access Layer for Kysera - Query functions, context passing, plugin support, and composition utilities.

## Installation

```bash
# Basic installation (Kysely only)
npm install @kysera/dal kysely

# With plugin support (recommended)
npm install @kysera/dal @kysera/executor kysely

# Add plugins as needed
npm install @kysera/soft-delete @kysera/rls @kysera/audit
```

## Overview

**Dependencies:** `@kysera/executor` (peer: kysely >=0.28.8)
**Zero Runtime Dependencies** in core package

`@kysera/dal` provides a functional approach to database access as an alternative to traditional repository patterns. Instead of classes and methods, you write **query functions** that are composable, type-safe, and easy to test.

:::info New in v0.7.0
**Native Plugin Support!** DAL now seamlessly integrates with `@kysera/executor` to provide automatic plugin interception (soft-delete, RLS, audit, etc.) while maintaining a clean functional API. Plugins automatically propagate through transactions via `withTransaction()`.
:::

## Key Features

- **Query Functions** - Pure functions instead of repository methods
- **Type Inference** - Return types automatically inferred from queries
- **Context Passing** - Explicit database context (no dependency injection containers)
- **Plugin Support** - Automatic plugin interception via `@kysera/executor` integration
- **Transaction Support** - First-class transaction handling with automatic plugin propagation
- **Composition Utilities** - Combine queries with `compose`, `chain`, `parallel`, `conditional`, `mapResult`
- **Zero Dependencies** - Only peer dependency on Kysely (optional `@kysera/executor` for plugins)
- **Fully Typed** - Complete TypeScript support with strict mode enabled

## Quick Start

### Basic Usage (without plugins)

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

### With Plugins (via KyseraExecutor)

```typescript
import { createExecutor } from '@kysera/executor';
import { softDeletePlugin } from '@kysera/soft-delete';
import { rlsPlugin } from '@kysera/rls';
import { createQuery, withTransaction } from '@kysera/dal';

// Create executor with plugins
const executor = await createExecutor(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema })
]);

// Define query functions - plugins automatically applied
const getUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
);

// Soft-deleted records automatically filtered + RLS policies applied
const users = await getUsers(executor);

// Plugins automatically propagate to transactions
const result = await withTransaction(executor, async (ctx) => {
  // All queries in transaction have soft-delete filter and RLS policies applied
  const activeUsers = await getUsers(ctx);
  return activeUsers;
});
```

## Core Concepts

### Query Functions

Query functions are the building blocks of the Functional DAL. They accept a database context and arguments, returning a Promise with the result:

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

// Delete query
const deletePost = createQuery((ctx, id: number) =>
  ctx.db.deleteFrom('posts').where('id', '=', id).executeTakeFirst()
);
```

**Return type inference:** TypeScript automatically infers the return type from your query:

```typescript
const user = await findUserByEmail(db, 'test@example.com');
// Type: { id: number; email: string; name: string } | undefined
```

### Database Context

The `DbContext` wraps either a Kysely instance, a Transaction, or a KyseraExecutor, providing metadata about the execution context:

```typescript
import { createContext, isInTransaction, withContext } from '@kysera/dal';

// Create a context manually
const ctx = createContext(db);

// Create context from KyseraExecutor (plugins preserved)
const executor = await createExecutor(db, [softDeletePlugin()]);
const pluginCtx = createContext(executor);

// Use with a context wrapper
const users = await withContext(db, async (ctx) => {
  return getAllUsers(ctx);
});

// Check if in transaction
const myQuery = createQuery((ctx, id: number) => {
  if (isInTransaction(ctx)) {
    console.log('Running inside transaction');
  }
  return ctx.db.selectFrom('users').where('id', '=', id).executeTakeFirst();
});
```

### Transactions

Execute multiple queries atomically within a transaction:

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

// This will work
await withTransaction(db, (ctx) => transferFunds(ctx, 1, 2, 100));

// This will throw: "Query requires a transaction"
await transferFunds(db, 1, 2, 100);
```

**Plugin propagation in transactions:** When using `KyseraExecutor`, plugins are automatically propagated to transaction contexts:

```typescript
const executor = await createExecutor(db, [softDeletePlugin()]);

await withTransaction(executor, async (ctx) => {
  // ctx.db is a KyseraTransaction with soft-delete plugin automatically applied
  const users = await getUsers(ctx);
  // Returns only non-deleted users
});
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

## API Reference

### Context Management

#### createContext

Create a database context from any database instance.

```typescript
function createContext<DB>(
  db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>
): DbContext<DB>
```

**Parameters:**
- `db` - Database instance (Kysely, Transaction, KyseraExecutor, or KyseraTransaction)

**Returns:** `DbContext<DB>` with the following properties:
- `db` - The original database instance
- `isTransaction` - Boolean indicating if the context is within a transaction

**Notes:**
- Supports raw Kysely instances and plugin-aware KyseraExecutor
- When using KyseraExecutor, plugins are automatically preserved in the context
- Transaction state is detected via the `isTransaction` property on the database instance

**Example:**
```typescript
import { createContext } from '@kysera/dal';
import { createExecutor } from '@kysera/executor';

// With KyseraExecutor (plugins preserved)
const executor = await createExecutor(db, [softDeletePlugin()]);
const ctx = createContext(executor);
const user = await findUserById(ctx, 1); // soft-delete filter applied

// With plain Kysely
const plainCtx = createContext(db);
const allUsers = await findUserById(plainCtx, 1); // no plugin filtering
```

#### withContext

Execute a function with a database context.

```typescript
function withContext<DB, T>(
  db: Kysely<DB> | KyseraExecutor<DB>,
  fn: (ctx: DbContext<DB>) => Promise<T>
): Promise<T>
```

Creates a context without a transaction. Supports both Kysely and KyseraExecutor instances.

**Example:**
```typescript
import { withContext } from '@kysera/dal';

const users = await withContext(db, async (ctx) => {
  return getAllUsers(ctx);
});
```

#### isInTransaction

Check if context is within a transaction.

```typescript
function isInTransaction<DB>(ctx: DbContext<DB>): boolean
```

**Example:**
```typescript
const myQuery = createQuery((ctx, id: number) => {
  if (isInTransaction(ctx)) {
    console.log('Running inside transaction');
  }
  return ctx.db.selectFrom('users').where('id', '=', id).executeTakeFirst();
});
```

### Query Creation

#### createQuery

Create a typed query function.

```typescript
function createQuery<DB, TArgs extends readonly unknown[], TResult>(
  queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult>
```

Query functions are the core building blocks of Functional DAL. They receive a database context and arguments, and return a Promise. The result type is automatically inferred from the query. Supports raw Kysely instances and plugin-aware KyseraExecutor.

**Example:**
```typescript
import { createQuery } from '@kysera/dal';

const getUserById = createQuery(
  (ctx, id: number) =>
    ctx.db
      .selectFrom('users')
      .select(['id', 'email', 'name'])
      .where('id', '=', id)
      .executeTakeFirst()
);

// Usage with raw Kysely
const user = await getUserById(db, 1);
// Type: { id: number; email: string; name: string } | undefined
```

#### createTransactionalQuery

Create a query function that requires a transaction.

```typescript
function createTransactionalQuery<DB, TArgs extends readonly unknown[], TResult>(
  queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult>
```

Throws an error if called outside a transaction context.

**Example:**
```typescript
import { createTransactionalQuery, withTransaction } from '@kysera/dal';

const transferFunds = createTransactionalQuery(
  async (ctx, fromId: number, toId: number, amount: number) => {
    await ctx.db
      .updateTable('accounts')
      .set((eb) => ({ balance: eb('balance', '-', amount) }))
      .where('id', '=', fromId)
      .execute();

    await ctx.db
      .updateTable('accounts')
      .set((eb) => ({ balance: eb('balance', '+', amount) }))
      .where('id', '=', toId)
      .execute();

    return { success: true };
  }
);

// This will work
await withTransaction(db, (ctx) => transferFunds(ctx, 1, 2, 100));

// This will throw an error
await transferFunds(db, 1, 2, 100); // Error: Query requires transaction
```

#### withTransaction

Execute a function within a transaction.

```typescript
function withTransaction<DB, T>(
  db: Kysely<DB> | KyseraExecutor<DB>,
  fn: (ctx: DbContext<DB>) => Promise<T>,
  options?: TransactionOptions
): Promise<T>
```

**Parameters:**
- `db` - Database instance (Kysely or KyseraExecutor)
- `fn` - Function to execute within the transaction context
- `options` - Optional transaction options (currently accepted but not implemented due to Kysely API limitations)

**Returns:** `Promise<T>` - Result of the function

**Notes:**
- If the database is a `KyseraExecutor`, plugins are automatically propagated to the transaction context using `wrapTransaction()`
- For plain Kysely instances, creates a standard Kysely transaction without plugins
- The function receives a `DbContext<DB>` with `isTransaction: true`
- Follows Kysely's transaction semantics (auto-commit on success, auto-rollback on error)

**Example:**
```typescript
import { withTransaction } from '@kysera/dal';

// Basic transaction
const result = await withTransaction(db, async (ctx) => {
  const user = await createUser(ctx, userData);
  const profile = await createProfile(ctx, { userId: user.id, ...profileData });
  return { user, profile };
});
```

**With KyseraExecutor (plugins propagated):**
```typescript
import { createExecutor } from '@kysera/executor';
import { withTransaction } from '@kysera/dal';

const executor = await createExecutor(db, [softDeletePlugin()]);

const result = await withTransaction(executor, async (ctx) => {
  // All queries in transaction have soft-delete filter applied
  // ctx.db is a KyseraTransaction with plugins wrapped
  const users = await getUsers(ctx);
  return users;
});
```

### Composition Utilities

#### compose

Compose two query functions sequentially. The result of the first query is passed to the second.

```typescript
function compose<DB, TArgs extends readonly unknown[], TFirst, TResult>(
  first: QueryFunction<DB, TArgs, TFirst>,
  second: (ctx: DbContext<DB>, result: TFirst) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult>
```

**Example:**
```typescript
import { createQuery, compose } from '@kysera/dal';

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
);

const getPostsByUserId = createQuery((ctx, userId: number) =>
  ctx.db.selectFrom('posts').selectAll().where('user_id', '=', userId).execute()
);

const getUserWithPosts = compose(
  getUserById,
  async (ctx, user) => ({
    ...user,
    posts: await getPostsByUserId(ctx, user.id),
  })
);

const result = await getUserWithPosts(db, 1);
// { id: 1, name: '...', posts: [...] }
```

#### chain

Chain multiple operations on a query result.

```typescript
function chain<DB, TArgs extends readonly unknown[], T1, T2>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>
): QueryFunction<DB, TArgs, T2>

// Supports up to 3 transform functions
function chain<DB, TArgs extends readonly unknown[], T1, T2, T3, T4>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>,
  t2: (ctx: DbContext<DB>, result: T2) => Promise<T3>,
  t3: (ctx: DbContext<DB>, result: T3) => Promise<T4>
): QueryFunction<DB, TArgs, T4>
```

**Example:**
```typescript
import { createQuery, chain } from '@kysera/dal';

const getUser = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
);

const getUserFull = chain(
  getUser,
  async (ctx, user) => ({ ...user, posts: await getPosts(ctx, user.id) }),
  async (ctx, data) => ({ ...data, followers: await getFollowers(ctx, data.id) })
);
```

#### parallel

Execute multiple queries in parallel. All queries receive the same arguments and are executed concurrently.

```typescript
function parallel<DB, TArgs extends readonly unknown[], T extends Record<string, QueryFunction<DB, TArgs, unknown>>>(
  queries: T
): QueryFunction<DB, TArgs, { [K in keyof T]: T[K] extends QueryFunction<DB, TArgs, infer R> ? R : never }>
```

**Example:**
```typescript
import { createQuery, parallel } from '@kysera/dal';

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
);

const getUserStats = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('user_stats').selectAll().where('user_id', '=', id).executeTakeFirst()
);

const getNotifications = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('notifications').selectAll().where('user_id', '=', id).execute()
);

const getDashboardData = parallel({
  user: getUserById,
  stats: getUserStats,
  notifications: getNotifications,
});

const dashboard = await getDashboardData(db, userId);
// { user: {...}, stats: {...}, notifications: [...] }
```

#### conditional

Execute a query conditionally.

```typescript
function conditional<DB, TArgs extends readonly unknown[], TResult, TFallback = undefined>(
  condition: (ctx: DbContext<DB>, ...args: TArgs) => boolean | Promise<boolean>,
  query: QueryFunction<DB, TArgs, TResult>,
  fallback?: TFallback
): QueryFunction<DB, TArgs, TResult | TFallback>
```

**Example:**
```typescript
import { conditional } from '@kysera/dal';

const getPremiumFeatures = createQuery((ctx, userId: number) =>
  ctx.db.selectFrom('premium_features').selectAll().where('user_id', '=', userId).execute()
);

const getFeatures = conditional(
  (ctx, userId: number, isPremium: boolean) => isPremium,
  getPremiumFeatures,
  []  // Return empty array for non-premium users
);
```

#### mapResult

Map over query results.

```typescript
function mapResult<DB, TArgs extends readonly unknown[], TItem, TResult>(
  query: QueryFunction<DB, TArgs, TItem[]>,
  mapper: (item: TItem, index: number) => TResult
): QueryFunction<DB, TArgs, TResult[]>
```

**Example:**
```typescript
import { mapResult } from '@kysera/dal';

const getUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
);

const getUserNames = mapResult(getUsers, (user) => user.name);

const names = await getUserNames(db); // string[]
```

## TypeScript Types

### DbContext

Database context for query functions. Supports both raw Kysely instances and plugin-aware KyseraExecutor.

```typescript
interface DbContext<DB = Record<string, unknown>> {
  /** Database or transaction instance (raw or plugin-aware) */
  readonly db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>;
  /** Whether the context is within a transaction */
  readonly isTransaction: boolean;
}
```

### QueryFunction

Query function signature. A query function accepts database context or any database instance and arguments, returning a Promise with the result.

```typescript
type QueryFunction<DB, TArgs extends readonly unknown[], TResult> = (
  ctxOrDb: DbContext<DB> | Kysely<DB> | KyseraExecutor<DB>,
  ...args: TArgs
) => Promise<TResult>
```

### TransactionOptions

Options for transaction execution.

```typescript
interface TransactionOptions {
  /**
   * Isolation level for the transaction.
   */
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
}
```

**Note:** The `isolationLevel` option is defined for future compatibility but not currently implemented. Kysely's `Transaction` API doesn't expose runtime configuration methods for isolation levels. Isolation levels should typically be configured at the connection pool level or via database-specific configuration.

### Type Inference Utilities

```typescript
/** Infer result type from a query function */
type InferResult<T> = T extends QueryFunction<Record<string, unknown>, readonly unknown[], infer R>
  ? R
  : never;

/** Infer arguments type from a query function */
type InferArgs<T> = T extends QueryFunction<Record<string, unknown>, infer A, unknown>
  ? A
  : never;

/** Infer database type from a query function */
type InferDB<T> = T extends QueryFunction<infer DB, readonly unknown[], unknown> ? DB : never;
```

### ParallelResult

Result type for parallel query execution.

```typescript
type ParallelResult<
  T extends Record<string, QueryFunction<Record<string, unknown>, readonly unknown[], unknown>>
> = {
  [K in keyof T]: T[K] extends QueryFunction<Record<string, unknown>, readonly unknown[], infer R>
    ? R
    : never;
};
```

### Re-exported Executor Types

For convenience, `@kysera/dal` re-exports types from `@kysera/executor`:

```typescript
import type {
  Plugin,
  KyseraExecutor,
  KyseraTransaction,
  AnyKyseraExecutor,
  QueryBuilderContext,
} from '@kysera/dal';
```

- **`Plugin`** - Plugin interface for creating custom plugins
- **`KyseraExecutor<DB>`** - Plugin-aware Kysely wrapper type
- **`KyseraTransaction<DB>`** - Plugin-aware Transaction wrapper type
- **`AnyKyseraExecutor<DB>`** - Union of KyseraExecutor or KyseraTransaction
- **`QueryBuilderContext`** - Context passed to `interceptQuery` hooks

See [@kysera/executor documentation](/docs/api/executor) for full details on these types.

## Plugin Integration

:::tip KyseraExecutor Integration
**DAL seamlessly integrates with `@kysera/executor` for plugin support!** When you pass a `KyseraExecutor` to DAL queries, query interceptor plugins like `@kysera/soft-delete` and `@kysera/rls` are automatically applied.
:::

### How Plugin Support Works

DAL integrates with `@kysera/executor` to enable plugin support. The integration works through the plugin system's two mechanisms:

1. **`interceptQuery`** - Modifies query builders (adds WHERE clauses, filters, policies) - **✅ Fully supported in DAL via KyseraExecutor**
2. **`extendRepository`** - Adds methods to repositories (softDelete, restore, etc.) - **⚠️ Repository only (not applicable to DAL)**

### Using Plugins with DAL

To use plugins with DAL, create a `KyseraExecutor` with your plugins and pass it to your query functions:

```typescript
import { createExecutor } from '@kysera/executor';
import { softDeletePlugin } from '@kysera/soft-delete';
import { rlsPlugin } from '@kysera/rls';
import { createQuery } from '@kysera/dal';

// Create plugin-aware executor
const executor = await createExecutor(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema })
]);

// Define DAL query
const getUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
);

// Plugins automatically applied via interceptQuery!
const users = await getUsers(executor);
// - Soft-deleted records automatically filtered
// - RLS policies automatically applied
```

**What you get with DAL + KyseraExecutor:**

- ✅ **Query Interceptors** (`interceptQuery`) - Automatic filtering, RLS policies, audit logging
- ✅ **Transaction Plugin Propagation** - Plugins automatically work in `withTransaction()`
- ✅ **Type Safety** - Full TypeScript support with database schema preserved
- ⚠️ **No Repository Extensions** (`extendRepository`) - Convenience methods like `repo.softDelete()` not available

DAL gets automatic filtering and policies, but not the convenience methods. This is perfect for read-heavy operations and complex queries where you want plugin behavior without repository boilerplate.

### Plugin Compatibility Matrix

| Plugin | Repository | DAL with KyseraExecutor | DAL without KyseraExecutor |
|--------|-----------|-------------------------|----------------------------|
| `@kysera/soft-delete` | Automatic filtering + methods | Automatic filtering ✅ | Manual filtering required |
| `@kysera/timestamps` | Automatic timestamps | N/A (uses extendRepository) | Manual timestamps required |
| `@kysera/audit` | Automatic logging + methods | N/A (uses extendRepository) | Manual logging required |
| `@kysera/rls` | Automatic filtering + validation | Automatic filtering ✅ | Context available, manual filtering |

### Plugin Examples

#### Basic Plugin Usage

```typescript
import { createExecutor } from '@kysera/executor';
import { softDeletePlugin } from '@kysera/soft-delete';
import { rlsPlugin } from '@kysera/rls';
import { createQuery, withTransaction } from '@kysera/dal';

// Create executor with multiple plugins
const executor = await createExecutor(db, [
  softDeletePlugin(),                    // Priority: 100
  rlsPlugin({ schema: rlsSchema })       // Priority: 90
]);

// Define query functions - same as without plugins!
const getUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
);

// Queries automatically have all plugin interceptors applied
const users = await getUsers(executor);
// - Soft-delete filter applied (deleted_at IS NULL)
// - RLS policies applied (tenant filtering, etc.)
```

#### Transactions with Plugin Propagation

When using `withTransaction()` with a `KyseraExecutor`, plugins are automatically propagated to the transaction context:

```typescript
import { withTransaction } from '@kysera/dal';
import { createExecutor } from '@kysera/executor';
import { softDeletePlugin } from '@kysera/soft-delete';

const executor = await createExecutor(db, [softDeletePlugin()]);

await withTransaction(executor, async (ctx) => {
  // ctx.db is a KyseraTransaction with soft-delete plugin automatically applied
  const user = await createUser(ctx, userData);
  const posts = await getUserPosts(ctx, user.id);
  // Both queries have soft-delete filter applied within the transaction
  return { user, posts };
});
```

**How plugin propagation works internally:**

1. `withTransaction()` checks if the database is a `KyseraExecutor` using `isKyseraExecutor(db)`
2. If yes, it retrieves plugins using `getPlugins(db)` and wraps the Kysely transaction using `wrapTransaction(trx, plugins)`
3. The wrapped transaction is placed in the context, so all queries automatically have plugins applied
4. If using raw Kysely (without executor), creates a standard Kysely transaction without plugins

This ensures consistent plugin behavior across both regular queries and transactional queries.

### Manual Integration Patterns (Without KyseraExecutor)

If you don't use `KyseraExecutor`, you can still implement plugin-like behavior manually:

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

| Scenario | Repository | DAL with KyseraExecutor | DAL without KyseraExecutor |
|----------|------------|------------------------|---------------------------|
| CRUD operations with validation | ✅ Better | ⚠️ Manual validation | ⚠️ Manual validation |
| Complex custom queries | ⚠️ Limited | ✅ Excellent | ✅ Excellent |
| Multi-table transactions | ⚠️ Verbose | ✅ Better | ✅ Better |
| Vertical Slice Architecture | ⚠️ Not ideal | ✅ Ideal | ✅ Ideal |
| Maximum type inference | ⚠️ Medium | ✅ Excellent | ✅ Excellent |
| Tree-shaking | ⚠️ Medium | ✅ Excellent | ✅ Excellent |
| Query interceptor plugins (soft-delete, RLS) | ✅ Native | ✅ Native | ❌ Manual |
| Repository extension plugins (audit, timestamps) | ✅ Native | ❌ Not supported | ❌ Not supported |
| Multi-tenant with RLS | ✅ Native | ✅ Native | ⚠️ Manual filtering |
| Bundle size | ~12 KB | ~7 KB | ~7 KB |

## Combining DAL and Repository (CQRS-lite Pattern)

You can use both patterns in the same application for different purposes. This is called the **CQRS-lite pattern**: Repository for writes (Commands), DAL for reads (Queries).

### Approach 1: Shared KyseraExecutor (Recommended)

Use a single `KyseraExecutor` for both DAL queries and Repository patterns. This ensures consistent plugin behavior:

```typescript
import { createExecutor } from '@kysera/executor';
import { createORM } from '@kysera/repository';
import { softDeletePlugin } from '@kysera/soft-delete';
import { withTransaction, createQuery } from '@kysera/dal';

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()]);

// Create repository manager - pass raw db, plugins already initialized via executor
const orm = await createORM(db, [softDeletePlugin()]);

// Define DAL queries - use executor for plugin support
const getUserStats = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('user_stats')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst()
);

// Use both patterns with DAL executor
await withTransaction(executor, async (ctx) => {
  // Repository for writes (with extension methods)
  const userRepo = orm.createRepository(createUserRepository);
  const user = await userRepo.create({ email: 'test@example.com' });

  // DAL for complex reads (with plugin filtering)
  const stats = await getUserStats(ctx, user.id);

  return { user, stats };
});
```

### Approach 2: createORM Transaction Context (Simpler)

Use the repository manager's transaction context directly for both Repository and DAL queries. The transaction context is a `DbContext`, which DAL queries can accept:

```typescript
import { createORM } from '@kysera/repository';
import { softDeletePlugin } from '@kysera/soft-delete';
import { createQuery } from '@kysera/dal';

// Create repository manager with plugins
const orm = await createORM(db, [softDeletePlugin()]);

// Define DAL query functions
const getUserStats = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('user_stats')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst()
);

// Use orm.transaction() - context works with both Repository and DAL
await orm.transaction(async (ctx) => {
  // Repository for writes (with extension methods)
  const userRepo = orm.createRepository(createUserRepository);
  const user = await userRepo.create({ email: 'test@example.com' });

  // DAL for complex reads (same transaction context)
  const stats = await getUserStats(ctx, user.id);

  return { user, stats };
});
```

:::tip Shared Plugin Context
Both approaches ensure consistent plugin behavior across Repository and DAL:
- **Query interceptors** (`interceptQuery`) are shared - both patterns get automatic filtering and policies
- **Repository extensions** (`extendRepository`) are Repository-only - methods like `softDelete()` and `restore()`
- **Transaction context** - Plugins automatically propagate to transactional queries in both patterns
:::

**Benefits of CQRS-lite pattern:**

- ✅ **Repository for writes** - Validation, extension methods (softDelete, restore, audit)
- ✅ **DAL for complex reads** - Multi-table joins, aggregations, custom queries
- ✅ **Shared soft-delete filtering** - Consistent behavior across both patterns
- ✅ **Shared RLS policies** - Same security rules for reads and writes
- ✅ **Consistent transactions** - Both patterns work seamlessly in same transaction
- ✅ **Type-safe composition** - Full TypeScript support across patterns

## Complete Example

Here's a complete example showing DAL with plugins in a real-world scenario:

```typescript
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { createExecutor } from '@kysera/executor';
import { softDeletePlugin } from '@kysera/soft-delete';
import { rlsPlugin } from '@kysera/rls';
import { createQuery, withTransaction, parallel, compose } from '@kysera/dal';

// Database schema
interface Database {
  users: {
    id: number;
    email: string;
    name: string;
    tenant_id: number;
    deleted_at: Date | null;
    created_at: Date;
  };
  posts: {
    id: number;
    user_id: number;
    title: string;
    body: string;
    tenant_id: number;
    deleted_at: Date | null;
    created_at: Date;
  };
  user_stats: {
    user_id: number;
    post_count: number;
    last_post_at: Date | null;
  };
}

// Initialize database
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL })
  })
});

// Create executor with plugins
const executor = await createExecutor(db, [
  softDeletePlugin(),                     // Automatic soft-delete filtering
  rlsPlugin({                            // Row-Level Security
    schema: {
      users: { tenantColumn: 'tenant_id' },
      posts: { tenantColumn: 'tenant_id' }
    }
  })
]);

// Define query functions
const getUserById = createQuery((ctx, id: number) =>
  ctx.db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
);

const getPostsByUserId = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('posts')
    .selectAll()
    .where('user_id', '=', userId)
    .execute()
);

const getUserStats = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('user_stats')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst()
);

const createUser = createQuery((ctx, data: { email: string; name: string; tenant_id: number }) =>
  ctx.db
    .insertInto('users')
    .values({
      ...data,
      created_at: new Date()
    })
    .returningAll()
    .executeTakeFirstOrThrow()
);

const createPost = createQuery((ctx, data: { user_id: number; title: string; body: string; tenant_id: number }) =>
  ctx.db
    .insertInto('posts')
    .values({
      ...data,
      created_at: new Date()
    })
    .returningAll()
    .executeTakeFirstOrThrow()
);

// Compose query for user with posts
const getUserWithPosts = compose(
  getUserById,
  async (ctx, user) => ({
    ...user,
    posts: await getPostsByUserId(ctx, user.id)
  })
);

// Parallel query for dashboard data
const getUserDashboard = parallel({
  user: getUserById,
  posts: getPostsByUserId,
  stats: getUserStats
});

// Usage examples
async function examples() {
  const currentTenantId = 1;

  // 1. Simple query with plugins applied
  const user = await getUserById(executor, 1);
  // - Only returns if deleted_at IS NULL (soft-delete)
  // - Only returns if tenant_id = currentTenantId (RLS)

  // 2. Composed query
  const userWithPosts = await getUserWithPosts(executor, 1);
  // - Both user and posts have plugins applied
  // { id: 1, email: '...', posts: [...] }

  // 3. Parallel queries
  const dashboard = await getUserDashboard(executor, 1);
  // - All queries run concurrently with plugins applied
  // { user: {...}, posts: [...], stats: {...} }

  // 4. Transaction with plugins
  const result = await withTransaction(executor, async (ctx) => {
    // Create new user
    const newUser = await createUser(ctx, {
      email: 'test@example.com',
      name: 'Test User',
      tenant_id: currentTenantId
    });

    // Create post for new user
    const newPost = await createPost(ctx, {
      user_id: newUser.id,
      title: 'First Post',
      body: 'Hello World',
      tenant_id: currentTenantId
    });

    // Get user with posts (plugins still applied in transaction)
    const userWithPosts = await getUserWithPosts(ctx, newUser.id);

    return { user: newUser, post: newPost, fullUser: userWithPosts };
  });

  return result;
}
```

## See Also

- [Executor API](/docs/api/executor) - Plugin system and KyseraExecutor reference
- [Repository vs DAL Guide](/docs/guides/dal-vs-repository) - Detailed comparison and decision guide
- [Repository API](/docs/api/repository) - Repository pattern reference
- [Soft Delete Plugin](/docs/plugins/soft-delete) - Soft delete plugin documentation
- [RLS Plugin](/docs/plugins/rls) - Row-Level Security plugin documentation
