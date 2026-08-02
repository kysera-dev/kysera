---
sidebar_position: 3
title: '@kysera/dal'
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

**Dependencies:** `@kysera/core`, `@kysera/executor` (peer: kysely >=0.29.0)

`@kysera/dal` provides a functional approach to database access as an alternative to traditional repository patterns. Instead of classes and methods, you write **query functions** that are composable, type-safe, and easy to test.

:::info
**Native Plugin Support!** DAL now seamlessly integrates with `@kysera/executor` to provide automatic plugin interception (soft-delete, RLS, audit, etc.) while maintaining a clean functional API. Plugins automatically propagate through transactions via `withTransaction()`.
:::

## Key Features

- **Query Functions** - Pure functions instead of repository methods
- **Type Inference** - Return types automatically inferred from queries
- **Context Passing** - Explicit database context (no dependency injection containers)
- **Plugin Support** - Automatic plugin interception via `@kysera/executor` integration
- **Transaction Support** - First-class transaction handling with automatic plugin propagation
- **Composition Utilities** - Combine queries with `compose`, `chain`, `parallel`, `conditional`, `mapResult`
- **Lean Dependencies** - Runtime dependencies on `@kysera/core` and `@kysera/executor` only (peer: Kysely)
- **Fully Typed** - Complete TypeScript support with strict mode enabled

## Quick Start

### Basic Usage (without plugins)

```typescript
import { Kysely } from 'kysely'
import { createQuery, withTransaction, type DbContext } from '@kysera/dal'

// Create query functions
const getUserById = createQuery((ctx: DbContext<Database>, id: number) =>
  ctx.db.selectFrom('users').select(['id', 'email', 'name']).where('id', '=', id).executeTakeFirst()
)

const createUser = createQuery((ctx: DbContext<Database>, data: { email: string; name: string }) =>
  ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
)

// Use directly
const user = await getUserById(db, 1)

// Use in transactions
const result = await withTransaction(db, async ctx => {
  return createUser(ctx, { email: 'test@example.com', name: 'Test' })
})
```

### With Plugins (via KyseraExecutor)

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'
import { createQuery, withTransaction, type DbContext } from '@kysera/dal'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin(), rlsPlugin({ schema: rlsSchema })])

// Define query functions - plugins automatically applied
const getUsers = createQuery((ctx: DbContext<Database>) => ctx.db.selectFrom('users').selectAll().execute())

// Soft-deleted records automatically filtered + RLS policies applied
const users = await getUsers(executor)

// Plugins automatically propagate to transactions
const result = await withTransaction(executor, async ctx => {
  // All queries in transaction have soft-delete filter and RLS policies applied
  const activeUsers = await getUsers(ctx)
  return activeUsers
})
```

## Core Concepts

### Query Functions

Query functions are the building blocks of the Functional DAL. They accept a database context and arguments, returning a Promise with the result:

```typescript
import { createQuery, type DbContext } from '@kysera/dal'

// Select query
const findUserByEmail = createQuery((ctx: DbContext<Database>, email: string) =>
  ctx.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
)

// Insert query
const insertPost = createQuery((ctx: DbContext<Database>, data: { title: string; userId: number }) =>
  ctx.db.insertInto('posts').values(data).returningAll().executeTakeFirstOrThrow()
)

// Update query
const updateUserName = createQuery((ctx: DbContext<Database>, id: number, name: string) =>
  ctx.db.updateTable('users').set({ name }).where('id', '=', id).returningAll().executeTakeFirst()
)

// Delete query
const deletePost = createQuery((ctx: DbContext<Database>, id: number) =>
  ctx.db.deleteFrom('posts').where('id', '=', id).executeTakeFirst()
)
```

**Return type inference:** TypeScript automatically infers the return type from your query:

```typescript
const user = await findUserByEmail(db, 'test@example.com')
// Type: { id: number; email: string; name: string } | undefined
```

### Database Context

The `DbContext` wraps either a Kysely instance, a Transaction, or a KyseraExecutor, providing metadata about the execution context:

```typescript
import { createContext, isInTransaction, withContext } from '@kysera/dal'

// Create a context manually
const ctx = createContext(db)

// Create context from KyseraExecutor (plugins preserved)
const executor = await createExecutor(db, [softDeletePlugin()])
const pluginCtx = createContext(executor)

// Use with a context wrapper
const users = await withContext(db, async ctx => {
  return getAllUsers(ctx)
})

// Check if in transaction
const myQuery = createQuery((ctx: DbContext<Database>, id: number) => {
  if (isInTransaction(ctx)) {
    console.log('Running inside transaction')
  }
  return ctx.db.selectFrom('users').where('id', '=', id).executeTakeFirst()
})
```

### Transactions

Execute multiple queries atomically within a transaction:

```typescript
import { withTransaction, createTransactionalQuery, type DbContext } from '@kysera/dal'

// Regular transaction
const result = await withTransaction(db, async ctx => {
  const user = await createUser(ctx, userData)
  const profile = await createProfile(ctx, { userId: user.id, ...profileData })
  return { user, profile }
})

// Query that REQUIRES a transaction
const transferFunds = createTransactionalQuery(
  async (ctx: DbContext<Database>, fromId: number, toId: number, amount: number) => {
    await ctx.db
      .updateTable('accounts')
      .set(eb => ({ balance: eb('balance', '-', amount) }))
      .where('id', '=', fromId)
      .execute()
    await ctx.db
      .updateTable('accounts')
      .set(eb => ({ balance: eb('balance', '+', amount) }))
      .where('id', '=', toId)
      .execute()
    return { success: true }
  }
)

// This will work
await withTransaction(db, ctx => transferFunds(ctx, 1, 2, 100))

// This will throw: "Query requires a transaction"
await transferFunds(db, 1, 2, 100)
```

**Plugin propagation in transactions:** When using `KyseraExecutor`, plugins are automatically propagated to transaction contexts:

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

await withTransaction(executor, async ctx => {
  // ctx.db is a KyseraTransaction with soft-delete plugin automatically applied
  const users = await getUsers(ctx)
  // Returns only non-deleted users
})
```

## Composition Utilities

### compose

Compose two queries sequentially:

```typescript
import { compose } from '@kysera/dal'

const getUserWithPosts = compose(getUserById, async (ctx, user) => ({
  ...user,
  posts: await getPostsByUserId(ctx, user.id)
}))

const result = await getUserWithPosts(db, 1)
// { id: 1, email: '...', posts: [...] }
```

### chain

Chain multiple transformations:

```typescript
import { chain } from '@kysera/dal'

const getUserComplete = chain(
  getUser,
  async (ctx, user) => ({ ...user, posts: await getPosts(ctx, user.id) }),
  async (ctx, data) => ({ ...data, followers: await getFollowers(ctx, data.id) })
)
```

### parallel

Execute multiple queries concurrently:

<!-- doc-snippet: skip -->
```typescript
import { parallel } from '@kysera/dal'

const getDashboardData = parallel({
  user: getUserById,
  stats: getUserStats,
  notifications: getNotifications
})

const dashboard = await getDashboardData(db, userId)
// { user: {...}, stats: {...}, notifications: [...] }
```

### conditional

Execute conditionally:

```typescript
import { conditional } from '@kysera/dal'

const getFeatures = conditional(
  (ctx, userId: number, isPremium: boolean) => isPremium,
  getPremiumFeatures,
  [] // Fallback for non-premium users
)
```

### mapResult

Transform array results:

```typescript
import { mapResult } from '@kysera/dal'

const getUserNames = mapResult(getAllUsers, user => user.name)
const names = await getUserNames(db) // string[]
```

## API Reference

### Context Management

#### createContext

Create a database context from any database instance.

<!-- doc-snippet: skip -->
```typescript
function createContext<DB>(
  db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>,
  options?: CreateContextOptions | boolean
): DbContext<DB>

interface CreateContextOptions {
  /** Override transaction detection */
  isTransaction?: boolean
  /** PostgreSQL schema for all queries in this context */
  schema?: string
}
```

**Parameters:**

- `db` - Database instance (Kysely, Transaction, KyseraExecutor, or KyseraTransaction)
- `options` - Optional configuration object or boolean (boolean for backward compatibility with `isTransaction`)

**Returns:** `DbContext<DB>` with the following properties:

- `db` - The database instance (wrapped with schema if specified)
- `isTransaction` - Boolean indicating if the context is within a transaction
- `schema` - The PostgreSQL schema (if specified)

**Notes:**

- Supports raw Kysely instances and plugin-aware KyseraExecutor
- When using KyseraExecutor, plugins are automatically preserved in the context
- Transaction state is detected via the `isTransaction` property on the database instance
- The context is immutable - any modifications return a new context
- When `schema` is specified, the db instance is wrapped with `.withSchema(schema)`

**Integration with @kysera/executor:**

When you pass a `KyseraExecutor` to `createContext()`, the executor's plugin interceptors are automatically available to all queries that use the context. This enables DAL queries to benefit from automatic filtering (soft-delete, RLS) without any additional configuration.

**Example:**

```typescript
import { createContext } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'

// With KyseraExecutor (plugins preserved)
const executor = await createExecutor(db, [softDeletePlugin()])
const ctx = createContext(executor)
const user = await findUserById(ctx, 1) // soft-delete filter applied

// With plain Kysely
const plainCtx = createContext(db)
const allUsers = await findUserById(plainCtx, 1) // no plugin filtering

// With schema option
const schemaCtx = createContext(executor, { schema: 'auth' })
const authUsers = await findUserById(schemaCtx, 1) // queries use 'auth' schema
```

#### createSchemaContext

Convenience function to create a schema-scoped context.

<!-- doc-snippet: skip -->
```typescript
function createSchemaContext<DB>(
  db: Kysely<DB> | KyseraExecutor<DB>,
  schema: string
): DbContext<DB>
```

**Parameters:**

- `db` - Database or executor instance (not transactions - use `createContext` for those)
- `schema` - PostgreSQL schema name to scope all queries to

**Returns:** `DbContext<DB>` with the schema applied

**Notes:**

- Simpler API than `createContext` when only schema is needed
- Does not accept `Transaction<DB>` or `KyseraTransaction<DB>` (top-level only)
- Internally calls `createContext(db, { schema })`

**Use Cases:**

1. **Multi-tenant applications (schema-per-tenant pattern):**

```typescript
import { createSchemaContext } from '@kysera/dal'

const tenantSchema = `tenant_${request.tenantId}`
const ctx = createSchemaContext(executor, tenantSchema)

// All queries scoped to tenant's schema
const users = await getUsers(ctx) // SELECT * FROM "tenant_123"."users"
```

2. **Domain separation:**

```typescript
// Separate contexts for different domains
const authCtx = createSchemaContext(executor, 'auth')
const adminCtx = createSchemaContext(executor, 'admin')

const user = await getUser(authCtx, userId) // auth.users
const settings = await getSettings(adminCtx) // admin.settings
```

#### withContext

Execute a function with a database context.

<!-- doc-snippet: skip -->
```typescript
function withContext<DB, T>(
  db: Kysely<DB> | KyseraExecutor<DB>,
  fn: (ctx: DbContext<DB>) => Promise<T>
): Promise<T>
```

Creates a context without a transaction. Supports both Kysely and KyseraExecutor instances.

**Example:**

```typescript
import { withContext } from '@kysera/dal'

const users = await withContext(db, async ctx => {
  return getAllUsers(ctx)
})
```

#### isInTransaction

Check if context is within a transaction.

<!-- doc-snippet: skip -->
```typescript
function isInTransaction<DB>(ctx: DbContext<DB>): boolean
```

**Example:**

```typescript
const myQuery = createQuery((ctx: DbContext<Database>, id: number) => {
  if (isInTransaction(ctx)) {
    console.log('Running inside transaction')
  }
  return ctx.db.selectFrom('users').where('id', '=', id).executeTakeFirst()
})
```

#### toContext

Normalize any accepted input to a `DbContext`.

<!-- doc-snippet: skip -->
```typescript
function toContext<DB>(
  ctxOrDb: DbContext<DB> | Kysely<DB> | KyseraExecutor<DB>
): DbContext<DB>
```

Returns the input as-is if it is already a `DbContext` (detected via `isDbContext()`); otherwise wraps it with `createContext()`. This is the same normalizer the built-in composition utilities (`compose`, `chain`, `parallel`, ...) use internally — reach for it when writing your own combinators so they accept a context or a raw database instance interchangeably:

```typescript
import { toContext, type DbContext, type QueryFunction } from '@kysera/dal'

function withTiming<DB, TArgs extends readonly unknown[], TResult>(
  query: QueryFunction<DB, TArgs, TResult>
): QueryFunction<DB, TArgs, TResult> {
  return async (ctxOrDb, ...args) => {
    const ctx = toContext(ctxOrDb)
    const start = performance.now()
    try {
      return await query(ctx, ...args)
    } finally {
      console.log(`Query took ${performance.now() - start}ms`)
    }
  }
}
```

### Query Creation

#### createQuery

Create a typed query function.

<!-- doc-snippet: skip -->
```typescript
function createQuery<DB, TArgs extends readonly unknown[], TResult>(
  queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult>
```

Query functions are the core building blocks of Functional DAL. They receive a database context and arguments, and return a Promise. The result type is automatically inferred from the query. Supports raw Kysely instances and plugin-aware KyseraExecutor.

**Example:**

```typescript
import { createQuery, type DbContext } from '@kysera/dal'

const getUserById = createQuery((ctx: DbContext<Database>, id: number) =>
  ctx.db.selectFrom('users').select(['id', 'email', 'name']).where('id', '=', id).executeTakeFirst()
)

// Usage with raw Kysely
const user = await getUserById(db, 1)
// Type: { id: number; email: string; name: string } | undefined
```

#### createTransactionalQuery

Create a query function that requires a transaction.

<!-- doc-snippet: skip -->
```typescript
function createTransactionalQuery<DB, TArgs extends readonly unknown[], TResult>(
  queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult>
```

Throws an error if called outside a transaction context.

**Example:**

```typescript
import { createTransactionalQuery, withTransaction, type DbContext } from '@kysera/dal'

const transferFunds = createTransactionalQuery(
  async (ctx: DbContext<Database>, fromId: number, toId: number, amount: number) => {
    await ctx.db
      .updateTable('accounts')
      .set(eb => ({ balance: eb('balance', '-', amount) }))
      .where('id', '=', fromId)
      .execute()

    await ctx.db
      .updateTable('accounts')
      .set(eb => ({ balance: eb('balance', '+', amount) }))
      .where('id', '=', toId)
      .execute()

    return { success: true }
  }
)

// This will work
await withTransaction(db, ctx => transferFunds(ctx, 1, 2, 100))

// This will throw an error
await transferFunds(db, 1, 2, 100) // Error: Query requires transaction
```

#### withTransaction

Execute a function within a transaction.

<!-- doc-snippet: skip -->
```typescript
function withTransaction<DB, T>(
  db: Kysely<DB> | KyseraExecutor<DB> | DbContext<DB>,
  fn: (ctx: DbContext<DB>) => Promise<T>,
  options?: TransactionOptionsWithLogger
): Promise<T>
```

**Parameters:**

- `db` - Database instance (Kysely or KyseraExecutor) or an existing `DbContext` (pass the context to preserve its schema and enable savepoint nesting)
- `fn` - Function to execute within the transaction context
- `options` - Optional transaction options (isolation level, logger, rollback error handling - see below)

**Returns:** `Promise<T>` - Result of the function

**Notes:**

- If the database is a `KyseraExecutor`, plugins are automatically propagated to the transaction context using `wrapTransaction()`
- For plain Kysely instances, creates a standard Kysely transaction without plugins
- The function receives a `DbContext<DB>` with `isTransaction: true`
- Follows Kysely's transaction semantics (auto-commit on success, auto-rollback on error)
- Passing an existing `DbContext` (e.g. from `createSchemaContext`) preserves its schema in the transaction context

**Nested Transactions (Savepoints):**

`withTransaction()` supports nesting. When called inside an existing transaction, it does not open a new top-level transaction — it automatically creates a savepoint instead (`SAVEPOINT kysera_sp_N`; `SAVE TRANSACTION` on MSSQL). On success the savepoint is released; if the nested function throws, only the savepoint is rolled back and the outer transaction stays intact:

```typescript
await withTransaction(executor, async ctx => {
  const user = await createUser(ctx, userData)

  try {
    // ✅ Nested call automatically issues SAVEPOINT kysera_sp_N
    await withTransaction(ctx, async innerCtx => {
      await createProfile(innerCtx, profileData)
      throw new Error('Profile validation failed')
    })
  } catch (error) {
    // Rolled back to the savepoint only - the user created above
    // is still part of the outer transaction and will be committed
  }
})
```

Do **not** call `ctx.db.transaction().execute()` inside a transaction to get a savepoint — that attempts a nested top-level transaction, which Kysely 0.29 rejects. Use nested `withTransaction()` calls instead.

**Transaction Options:**

The `options` parameter allows specifying isolation level:

```typescript
interface TransactionOptions {
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'
}
```

**Note:** The `isolationLevel` option is passed to Kysely but may not be supported by all database drivers. Check your database and driver documentation for isolation level support.

**Example:**

```typescript
import { withTransaction } from '@kysera/dal'

// Basic transaction
const result = await withTransaction(db, async ctx => {
  const user = await createUser(ctx, userData)
  const profile = await createProfile(ctx, { userId: user.id, ...profileData })
  return { user, profile }
})
```

**With KyseraExecutor (plugins propagated):**

```typescript
import { createExecutor } from '@kysera/executor'
import { withTransaction } from '@kysera/dal'

const executor = await createExecutor(db, [softDeletePlugin()])

const result = await withTransaction(executor, async ctx => {
  // All queries in transaction have soft-delete filter applied
  // ctx.db is a KyseraTransaction with plugins wrapped
  const users = await getUsers(ctx)
  return users
})
```

### Composition Utilities

#### compose

Compose two query functions sequentially. The result of the first query is passed to the second.

<!-- doc-snippet: skip -->
```typescript
function compose<DB, TArgs extends readonly unknown[], TFirst, TResult>(
  first: QueryFunction<DB, TArgs, TFirst>,
  second: (ctx: DbContext<DB>, result: TFirst) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult>
```

**Example:**

```typescript
import { createQuery, compose, type DbContext } from '@kysera/dal'

const getUserById = createQuery((ctx: DbContext<Database>, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
)

const getPostsByUserId = createQuery((ctx: DbContext<Database>, userId: number) =>
  ctx.db.selectFrom('posts').selectAll().where('user_id', '=', userId).execute()
)

const getUserWithPosts = compose(getUserById, async (ctx, user) => ({
  ...user,
  posts: await getPostsByUserId(ctx, user.id)
}))

const result = await getUserWithPosts(db, 1)
// { id: 1, name: '...', posts: [...] }
```

#### chain

Chain multiple operations on a query result.

<!-- doc-snippet: skip -->
```typescript
function chain<DB, TArgs extends readonly unknown[], T1, T2>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>
): QueryFunction<DB, TArgs, T2>

// Overloads accept up to 7 transform functions
function chain<DB, TArgs extends readonly unknown[], T1, T2, T3, T4, T5, T6, T7, T8>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>,
  t2: (ctx: DbContext<DB>, result: T2) => Promise<T3>,
  t3: (ctx: DbContext<DB>, result: T3) => Promise<T4>,
  t4: (ctx: DbContext<DB>, result: T4) => Promise<T5>,
  t5: (ctx: DbContext<DB>, result: T5) => Promise<T6>,
  t6: (ctx: DbContext<DB>, result: T6) => Promise<T7>,
  t7: (ctx: DbContext<DB>, result: T7) => Promise<T8>
): QueryFunction<DB, TArgs, T8>
```

Need more than 7 transforms? Chain the chained query: `chain(chain(getUser, t1, ..., t7), t8, t9)`.

**Example:**

```typescript
import { createQuery, chain, type DbContext } from '@kysera/dal'

const getUser = createQuery((ctx: DbContext<Database>, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
)

const getUserFull = chain(
  getUser,
  async (ctx, user) => ({ ...user, posts: await getPosts(ctx, user.id) }),
  async (ctx, data) => ({ ...data, followers: await getFollowers(ctx, data.id) })
)
```

#### parallel

Execute multiple queries in parallel. All queries receive the same arguments and are executed concurrently.

<!-- doc-snippet: skip -->
```typescript
function parallel<
  DB,
  TArgs extends readonly unknown[],
  T extends Record<string, QueryFunction<DB, TArgs, unknown>>
>(
  queries: T
): QueryFunction<
  DB,
  TArgs,
  { [K in keyof T]: T[K] extends QueryFunction<DB, TArgs, infer R> ? R : never }
>
```

**Example:**

<!-- doc-snippet: skip -->
```typescript
import { createQuery, parallel, type DbContext } from '@kysera/dal'

const getUserById = createQuery((ctx: DbContext<Database>, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
)

const getUserStats = createQuery((ctx: DbContext<Database>, id: number) =>
  ctx.db.selectFrom('user_stats').selectAll().where('user_id', '=', id).executeTakeFirst()
)

const getNotifications = createQuery((ctx: DbContext<Database>, id: number) =>
  ctx.db.selectFrom('notifications').selectAll().where('user_id', '=', id).execute()
)

const getDashboardData = parallel({
  user: getUserById,
  stats: getUserStats,
  notifications: getNotifications
})

const dashboard = await getDashboardData(db, userId)
// { user: {...}, stats: {...}, notifications: [...] }
```

#### conditional

Execute a query conditionally.

<!-- doc-snippet: skip -->
```typescript
function conditional<DB, TArgs extends readonly unknown[], TResult, TFallback = undefined>(
  condition: (ctx: DbContext<DB>, ...args: TArgs) => boolean | Promise<boolean>,
  query: QueryFunction<DB, TArgs, TResult>,
  fallback?: TFallback
): QueryFunction<DB, TArgs, TResult | TFallback>
```

**Example:**

<!-- doc-snippet: skip -->
```typescript
import { conditional } from '@kysera/dal'

const getPremiumFeatures = createQuery((ctx: DbContext<Database>, userId: number) =>
  ctx.db.selectFrom('premium_features').selectAll().where('user_id', '=', userId).execute()
)

const getFeatures = conditional(
  (ctx, userId: number, isPremium: boolean) => isPremium,
  getPremiumFeatures,
  [] // Return empty array for non-premium users
)
```

#### mapResult

Map over query results.

<!-- doc-snippet: skip -->
```typescript
function mapResult<DB, TArgs extends readonly unknown[], TItem, TResult>(
  query: QueryFunction<DB, TArgs, TItem[]>,
  mapper: (item: TItem, index: number) => TResult
): QueryFunction<DB, TArgs, TResult[]>
```

**Example:**

```typescript
import { mapResult } from '@kysera/dal'

const getUsers = createQuery((ctx: DbContext<Database>) => ctx.db.selectFrom('users').selectAll().execute())

const getUserNames = mapResult(getUsers, user => user.name)

const names = await getUserNames(db) // string[]
```

## TypeScript Types

### DbContext

Database context for query functions. Supports both raw Kysely instances and plugin-aware KyseraExecutor.

```typescript
interface DbContext<DB = Record<string, unknown>> {
  /** Marker symbol for reliable type detection */
  readonly [DB_CONTEXT_SYMBOL]: true
  /** Database or transaction instance (raw or plugin-aware) */
  readonly db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>
  /** Whether the context is within a transaction */
  readonly isTransaction: boolean
  /** PostgreSQL schema context (when using createSchemaContext or schema option) */
  readonly schema?: string
}
```

:::caution Always create contexts via the API
`DbContext` includes the `[DB_CONTEXT_SYMBOL]: true` marker property. Hand-built object literals like `{ db, isTransaction: false }` lack the marker and fail `isDbContext()` — DAL functions will treat them as raw database instances (losing schema preservation, among other things). Always create contexts with `createContext()`, `createSchemaContext()`, or `toContext()`.
:::

**Schema Property:**

When `schema` is set, all queries executed through `ctx.db` use the specified PostgreSQL schema instead of the default (typically 'public'). The schema is applied via Kysely's `.withSchema()` method.

```typescript
const ctx = createSchemaContext(executor, 'tenant_123')
console.log(ctx.schema) // 'tenant_123'

// All queries through ctx.db are scoped to 'tenant_123' schema
const users = await ctx.db.selectFrom('users').selectAll().execute()
// Executes: SELECT * FROM "tenant_123"."users"
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
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'
}
```

**Note:** The `isolationLevel` option applies to top-level transactions only — it is set via Kysely's `transactionBuilder.setIsolationLevel()` before the transaction starts. It is ignored for nested (savepoint) calls, and driver support varies; check your database and driver documentation for isolation level support.

### TransactionOptionsWithLogger

Extended transaction options with logger support and rollback error handling.

```typescript
interface TransactionOptionsWithLogger extends TransactionOptions {
  /**
   * Logger for transaction operations.
   * Defaults to silentLogger (no-op).
   */
  logger?: KyseraLogger

  /**
   * How to handle savepoint rollback errors in nested transactions.
   *
   * - 'log-only' (default): Log rollback errors but don't throw (original error is more important)
   * - 'throw': Throw rollback error instead of original error (useful for debugging)
   * - 'callback': Call onRollbackError callback with both errors (for custom handling)
   *
   * @default 'log-only'
   */
  rollbackErrorMode?: 'log-only' | 'throw' | 'callback'

  /**
   * Callback invoked when savepoint rollback fails (only used with rollbackErrorMode: 'callback').
   *
   * Receives both the original error that triggered the rollback and the rollback error.
   * This allows custom error handling logic (e.g., logging to external service, alerting, etc.)
   *
   * @param originalError - The error that caused the savepoint to rollback
   * @param rollbackError - The error that occurred during rollback
   */
  onRollbackError?: (originalError: unknown, rollbackError: unknown) => void | Promise<void>
}
```

**Examples:**

```typescript
import { withTransaction } from '@kysera/dal'
import { consoleLogger } from '@kysera/core'

// With logger
await withTransaction(
  executor,
  async ctx => {
    return await createUser(ctx, userData)
  },
  { logger: consoleLogger }
)

// Throw rollback error instead of original error (debugging)
await withTransaction(
  executor,
  async ctx => {
    // ...
  },
  { rollbackErrorMode: 'throw' }
)

// Custom error handling callback
await withTransaction(
  executor,
  async ctx => {
    // ...
  },
  {
    rollbackErrorMode: 'callback',
    onRollbackError: async (originalError, rollbackError) => {
      await logToMonitoring({
        type: 'savepoint_rollback_failure',
        originalError,
        rollbackError
      })
    }
  }
)
```

### TransactionRequiredError

Error thrown when a transactional query is executed outside a transaction context.

<!-- doc-snippet: skip -->
```typescript
class TransactionRequiredError extends DatabaseError {
  name: 'TransactionRequiredError'
  code: 'DB_TRANSACTION_FAILED'
  constructor(message?: string)
}
```

Extends `DatabaseError` from `@kysera/core` for a consistent error hierarchy — it carries `code: 'DB_TRANSACTION_FAILED'` and supports `.toJSON()`.

**Default message:** `'Query requires a transaction. Use withTransaction() to execute this query.'`

**When thrown:** By queries created with `createTransactionalQuery()` when called outside a transaction.

**Example:**

```typescript
import { createTransactionalQuery, withTransaction, TransactionRequiredError, type DbContext } from '@kysera/dal'

const transferFunds = createTransactionalQuery(async (ctx: DbContext<Database>, from, to, amount) => {
  // ... transfer logic
})

// This throws TransactionRequiredError:
try {
  await transferFunds(db, 1, 2, 100)
} catch (error) {
  if (error instanceof TransactionRequiredError) {
    console.log('Must use withTransaction()')
  }
}

// This works:
await withTransaction(db, ctx => transferFunds(ctx, 1, 2, 100))
```

### Type Inference Utilities

```typescript
/** Infer result type from a query function */
type InferResult<T> =
  T extends QueryFunction<Record<string, unknown>, readonly unknown[], infer R> ? R : never

/** Infer arguments type from a query function */
type InferArgs<T> = T extends QueryFunction<Record<string, unknown>, infer A, unknown> ? A : never

/** Infer database type from a query function */
type InferDB<T> = T extends QueryFunction<infer DB, readonly unknown[], unknown> ? DB : never
```

### ParallelResult

Result type for parallel query execution.

```typescript
type ParallelResult<
  DB,
  TArgs extends readonly unknown[],
  T extends Record<string, QueryFunction<DB, TArgs, unknown>>
> = {
  [K in keyof T]: T[K] extends QueryFunction<DB, TArgs, infer R> ? R : never
}
```

**Note:** The type has 3 type parameters: `DB` (database schema), `TArgs` (query arguments), and `T` (queries object).

### Advanced Symbols and Utilities

For advanced use cases (testing, custom context detection, debugging), DAL exports internal symbols:

```typescript
import {
  DB_CONTEXT_SYMBOL,
  IN_TRANSACTION_SYMBOL,
  SAVEPOINT_COUNTER_SYMBOL,
  isDbContext
} from '@kysera/dal'
```

**Exported Symbols:**

- **`DB_CONTEXT_SYMBOL`** - Symbol used to identify `DbContext` objects. Check if an object is a context: `obj[DB_CONTEXT_SYMBOL] === true`
- **`IN_TRANSACTION_SYMBOL`** - Symbol marker set on database instances during `withTransaction()`. Used for nested transaction detection.
- **`SAVEPOINT_COUNTER_SYMBOL`** - Symbol mirroring the last savepoint id issued for a database instance. The counter itself is process-global and monotonic — savepoint names (`kysera_sp_N`) are unique across the whole process, not numbered `1..n` per transaction. This guarantees collision-free names even when derived instances (`withSchema()`, executor re-wraps) are involved.

**Type Guard:**

- **`isDbContext<DB>(obj)`** - Type guard that returns `true` if `obj` is a valid `DbContext` object

```typescript
import { isDbContext } from '@kysera/dal'

function processDbOrContext(input: Kysely<DB> | DbContext<DB>) {
  if (isDbContext(input)) {
    // input is DbContext<DB>
    console.log('In transaction:', input.isTransaction)
    console.log('Schema:', input.schema)
  } else {
    // input is Kysely<DB>
    console.log('Raw Kysely instance')
  }
}
```

:::caution Internal Symbols
These symbols are exported for advanced use cases but are considered internal API. Use them only when necessary (e.g., testing, debugging, custom context management). The symbol values may change between versions.
:::

### Re-exported Executor Types

For convenience, `@kysera/dal` re-exports types from `@kysera/executor`:

```typescript
// Types
import type {
  Plugin,
  KyseraExecutor,
  KyseraTransaction,
  AnyKyseraExecutor,
  QueryBuilderContext,
  ExecutorConfig,
  KyseraExecutorMarker,
  PluginValidationDetails,
  PluginValidationErrorType
} from '@kysera/dal'

// Error class
import { PluginValidationError } from '@kysera/dal'
```

**Re-exported Types:**

- **`Plugin`** - Plugin interface for creating custom plugins
- **`KyseraExecutor<DB>`** - Plugin-aware Kysely wrapper type
- **`KyseraTransaction<DB>`** - Plugin-aware Transaction wrapper type
- **`AnyKyseraExecutor<DB>`** - Union of KyseraExecutor or KyseraTransaction
- **`QueryBuilderContext`** - Context passed to `interceptQuery` hooks
- **`ExecutorConfig`** - Configuration for executor creation
- **`KyseraExecutorMarker<DB>`** - Marker interface for identifying executors
- **`PluginValidationDetails`** - Details for plugin validation errors
- **`PluginValidationErrorType`** - Type of plugin validation error

**Re-exported Classes:**

- **`PluginValidationError`** - Error thrown when plugin validation fails

:::note Executor Functions Not Re-exported
Functions like `createExecutor()`, `destroyExecutor()`, `isKyseraExecutor()`, `getPlugins()`, `getRawDb()`, and `wrapTransaction()` are **not** re-exported from `@kysera/dal`. Import them directly from `@kysera/executor`:

```typescript
import { createExecutor, destroyExecutor, isKyseraExecutor } from '@kysera/executor'
```
:::

**Schema-Related Functions (DAL-native):**

- **`createSchemaContext()`** - Create a schema-scoped context (see above)
- **`CreateContextOptions`** - Options interface with `schema` property

See [@kysera/executor documentation](/docs/api/executor) for full details on executor types and functions.

### Schema Preservation in Transactions

When using `withTransaction()` with a schema-enabled context, pass the **context itself** (not `ctx.db`) and the schema is automatically preserved:

```typescript
const ctx = createSchemaContext(executor, 'tenant_123')

await withTransaction(ctx, async txCtx => {
  // txCtx.schema === 'tenant_123' (preserved from parent)
  const users = await getUsers(txCtx) // Uses tenant_123 schema
  const posts = await getPosts(txCtx) // Uses tenant_123 schema
})
```

**How it works:**

1. `withTransaction()` checks its first argument with `isDbContext()` — only a real `DbContext` (carrying the `DB_CONTEXT_SYMBOL` marker) exposes the parent's `schema`
2. The transaction is wrapped with `.withSchema()` using the parent's schema
3. The resulting context has both `isTransaction: true` and `schema` set
4. Nested savepoints also preserve the schema

:::caution Pass the context, not `ctx.db`
If you pass `ctx.db` (or a raw executor) instead of the context, `isDbContext()` returns `false` and `txCtx.schema` will be `undefined` — the `txCtx.schema === 'tenant_123'` guarantee only holds when the `DbContext` itself is passed to `withTransaction()`.
:::

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
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'
import { createQuery, type DbContext } from '@kysera/dal'

// Create plugin-aware executor
const executor = await createExecutor(db, [softDeletePlugin(), rlsPlugin({ schema: rlsSchema })])

// Define DAL query
const getUsers = createQuery((ctx: DbContext<Database>) => ctx.db.selectFrom('users').selectAll().execute())

// Plugins automatically applied via interceptQuery!
const users = await getUsers(executor)
// - Soft-deleted records automatically filtered
// - RLS policies automatically applied
```

**What you get with DAL + KyseraExecutor:**

- ✅ **Query Interceptors** (`interceptQuery`) - Automatic filtering and RLS policies (audit logging is `extendRepository`-based and not applied on the DAL path — see the matrix below)
- ✅ **Transaction Plugin Propagation** - Plugins automatically work in `withTransaction()`
- ✅ **Type Safety** - Full TypeScript support with database schema preserved
- ⚠️ **No Repository Extensions** (`extendRepository`) - Convenience methods like `repo.softDelete()` not available

DAL gets automatic filtering and policies, but not the convenience methods. This is perfect for read-heavy operations and complex queries where you want plugin behavior without repository boilerplate.

### Plugin Compatibility Matrix

| Plugin                | Repository                       | DAL with KyseraExecutor     | DAL without KyseraExecutor          |
| --------------------- | -------------------------------- | --------------------------- | ----------------------------------- |
| `@kysera/soft-delete` | Automatic filtering + methods    | Automatic filtering ✅      | Manual filtering required           |
| `@kysera/timestamps`  | Automatic timestamps             | N/A (uses extendRepository) | Manual timestamps required          |
| `@kysera/audit`       | Automatic logging + methods      | N/A (uses extendRepository) | Manual logging required             |
| `@kysera/rls`         | Automatic filtering + validation | Automatic filtering ✅      | Context available, manual filtering |

### Plugin Examples

#### Basic Plugin Usage

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'
import { createQuery, withTransaction, type DbContext } from '@kysera/dal'

// Create executor with multiple plugins
const executor = await createExecutor(db, [
  softDeletePlugin(), // Priority: 500 (FILTER)
  rlsPlugin({ schema: rlsSchema }) // Priority: 1000 (SECURITY) - runs first
])
// Execution order is by priority, not array order: rls (1000) then soft-delete (500)

// Define query functions - same as without plugins!
const getUsers = createQuery((ctx: DbContext<Database>) => ctx.db.selectFrom('users').selectAll().execute())

// Queries automatically have all plugin interceptors applied
const users = await getUsers(executor)
// - Soft-delete filter applied (deleted_at IS NULL)
// - RLS policies applied (tenant filtering, etc.)
```

#### Transactions with Plugin Propagation

When using `withTransaction()` with a `KyseraExecutor`, plugins are automatically propagated to the transaction context:

```typescript
import { withTransaction } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

const executor = await createExecutor(db, [softDeletePlugin()])

await withTransaction(executor, async ctx => {
  // ctx.db is a KyseraTransaction with soft-delete plugin automatically applied
  const user = await createUser(ctx, userData)
  const posts = await getUserPosts(ctx, user.id)
  // Both queries have soft-delete filter applied within the transaction
  return { user, posts }
})
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
const getActiveUsers = createQuery((ctx: DbContext<Database>) =>
  ctx.db
    .selectFrom('users')
    .selectAll()
    .where('deleted_at', 'is', null) // Manual soft-delete filter
    .execute()
)

const softDeleteUser = createQuery((ctx: DbContext<Database>, id: number) =>
  ctx.db
    .updateTable('users')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute()
)
```

#### Timestamps in DAL

Use `formatTimestampForDb` from `@kysera/core` for dialect-correct timestamp strings (MySQL/MSSQL reject ISO 8601's `T` separator and `Z` suffix):

```typescript
import { formatTimestampForDb } from '@kysera/core'

const createUser = createQuery((ctx: DbContext<Database>, data: CreateUserInput) => {
  const now = formatTimestampForDb() // ISO 8601 by default; pass dialect for MySQL/MSSQL
  return ctx.db
    .insertInto('users')
    .values({
      ...data,
      created_at: now, // Manual timestamp
      updated_at: now
    })
    .returningAll()
    .executeTakeFirstOrThrow()
})
```

#### RLS Context in DAL

RLS context (`rlsContext`) can be accessed in DAL, but you must apply filters manually:

```typescript
import { rlsContext } from '@kysera/rls'

const getUsersByTenant = createQuery((ctx: DbContext<Database>) => {
  const rlsCtx = rlsContext.getContextOrNull()

  let query = ctx.db.selectFrom('users').selectAll()

  // Apply RLS filter manually
  if (rlsCtx && !rlsCtx.auth.isSystem && rlsCtx.auth.tenantId) {
    query = query.where('tenant_id', '=', rlsCtx.auth.tenantId)
  }

  return query.execute()
})

// Usage within RLS context
await rlsContext.runAsync({ auth: { userId: 1, tenantId: 'acme', roles: ['user'] } }, async () => {
  const users = await getUsersByTenant(db) // Filtered by tenant
})
```

### Creating Reusable Middleware

For consistent plugin-like behavior across DAL queries:

```typescript
// Helper function for RLS filtering
function withTenantFilter<T>(
  query: SelectQueryBuilder<DB, any, T>,
  tableName: string
): SelectQueryBuilder<DB, any, T> {
  const ctx = rlsContext.getContextOrNull()
  if (!ctx || ctx.auth.isSystem) return query
  if (!ctx.auth.tenantId) return query

  return query.where(`${tableName}.tenant_id` as any, '=', ctx.auth.tenantId)
}

// Helper function for soft-delete filtering
function excludeDeleted<T>(
  query: SelectQueryBuilder<DB, any, T>,
  tableName: string,
  column = 'deleted_at'
): SelectQueryBuilder<DB, any, T> {
  return query.where(`${tableName}.${column}` as any, 'is', null)
}

// Usage
const getUsers = createQuery((ctx: DbContext<Database>) =>
  excludeDeleted(
    withTenantFilter(ctx.db.selectFrom('users').selectAll(), 'users'),
    'users'
  ).execute()
)
```

## When to Use DAL vs Repository

| Scenario                                         | Repository   | DAL with KyseraExecutor | DAL without KyseraExecutor |
| ------------------------------------------------ | ------------ | ----------------------- | -------------------------- |
| CRUD operations with validation                  | ✅ Better    | ⚠️ Manual validation    | ⚠️ Manual validation       |
| Complex custom queries                           | ⚠️ Limited   | ✅ Excellent            | ✅ Excellent               |
| Multi-table transactions                         | ⚠️ Verbose   | ✅ Better               | ✅ Better                  |
| Vertical Slice Architecture                      | ⚠️ Not ideal | ✅ Ideal                | ✅ Ideal                   |
| Maximum type inference                           | ⚠️ Medium    | ✅ Excellent            | ✅ Excellent               |
| Tree-shaking                                     | ⚠️ Medium    | ✅ Excellent            | ✅ Excellent               |
| Query interceptor plugins (soft-delete, RLS)     | ✅ Native    | ✅ Native               | ❌ Manual                  |
| Repository extension plugins (audit, timestamps) | ✅ Native    | ❌ Not supported        | ❌ Not supported           |
| Multi-tenant with RLS                            | ✅ Native    | ✅ Native               | ⚠️ Manual filtering        |
| Bundle size                                      | ~12 KB       | ~7 KB                   | ~7 KB                      |

## Combining DAL and Repository (CQRS-lite Pattern)

You can use both patterns in the same application for different purposes. This is called the **CQRS-lite pattern**: Repository for writes (Commands), DAL for reads (Queries).

### Approach 1: Shared KyseraExecutor (Recommended)

Use a single `KyseraExecutor` for both DAL queries and Repository patterns. This ensures consistent plugin behavior:

```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { withTransaction, createQuery, type DbContext } from '@kysera/dal'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// Create repository manager - pass raw db, plugins already initialized via executor
const orm = await createORM(db, [softDeletePlugin()])

// Define DAL queries - use executor for plugin support
const getUserStats = createQuery((ctx: DbContext<Database>, userId: number) =>
  ctx.db.selectFrom('user_stats').selectAll().where('user_id', '=', userId).executeTakeFirst()
)

// Use both patterns with DAL executor
await withTransaction(executor, async ctx => {
  // Repository for writes (with extension methods)
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create({ email: 'test@example.com' })

  // DAL for complex reads (with plugin filtering)
  const stats = await getUserStats(ctx, user.id)

  return { user, stats }
})
```

### Approach 2: createORM Transaction Context (Simpler)

Use the repository manager's transaction context directly for both Repository and DAL queries. The transaction context is a `DbContext`, which DAL queries can accept:

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { createQuery, type DbContext } from '@kysera/dal'

// Create repository manager with plugins
const orm = await createORM(db, [softDeletePlugin()])

// Define DAL query functions
const getUserStats = createQuery((ctx: DbContext<Database>, userId: number) =>
  ctx.db.selectFrom('user_stats').selectAll().where('user_id', '=', userId).executeTakeFirst()
)

// Use orm.transaction() - context works with both Repository and DAL
await orm.transaction(async ctx => {
  // Repository for writes (with extension methods)
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create({ email: 'test@example.com' })

  // DAL for complex reads (same transaction context)
  const stats = await getUserStats(ctx, user.id)

  return { user, stats }
})
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

<!-- doc-snippet: skip -->
```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'
import { createQuery, withTransaction, parallel, compose, type DbContext } from '@kysera/dal'

// Database schema
interface Database {
  users: {
    id: number
    email: string
    name: string
    tenant_id: number
    deleted_at: Date | null
    created_at: Date
  }
  posts: {
    id: number
    user_id: number
    title: string
    body: string
    tenant_id: number
    deleted_at: Date | null
    created_at: Date
  }
  user_stats: {
    user_id: number
    post_count: number
    last_post_at: Date | null
  }
}

// Initialize database
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL })
  })
})

// Create executor with plugins
const executor = await createExecutor(db, [
  softDeletePlugin(), // Automatic soft-delete filtering
  rlsPlugin({
    // Row-Level Security
    schema: {
      users: { tenantColumn: 'tenant_id' },
      posts: { tenantColumn: 'tenant_id' }
    }
  })
])

// Define query functions
const getUserById = createQuery((ctx: DbContext<Database>, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
)

const getPostsByUserId = createQuery((ctx: DbContext<Database>, userId: number) =>
  ctx.db.selectFrom('posts').selectAll().where('user_id', '=', userId).execute()
)

const getUserStats = createQuery((ctx: DbContext<Database>, userId: number) =>
  ctx.db.selectFrom('user_stats').selectAll().where('user_id', '=', userId).executeTakeFirst()
)

const createUser = createQuery((ctx: DbContext<Database>, data: { email: string; name: string; tenant_id: number }) =>
  ctx.db
    .insertInto('users')
    .values({
      ...data,
      created_at: new Date()
    })
    .returningAll()
    .executeTakeFirstOrThrow()
)

const createPost = createQuery(
  (ctx: DbContext<Database>, data: { user_id: number; title: string; body: string; tenant_id: number }) =>
    ctx.db
      .insertInto('posts')
      .values({
        ...data,
        created_at: new Date()
      })
      .returningAll()
      .executeTakeFirstOrThrow()
)

// Compose query for user with posts
const getUserWithPosts = compose(getUserById, async (ctx, user) => ({
  ...user,
  posts: await getPostsByUserId(ctx, user.id)
}))

// Parallel query for dashboard data
const getUserDashboard = parallel({
  user: getUserById,
  posts: getPostsByUserId,
  stats: getUserStats
})

// Usage examples
async function examples() {
  const currentTenantId = 1

  // 1. Simple query with plugins applied
  const user = await getUserById(executor, 1)
  // - Only returns if deleted_at IS NULL (soft-delete)
  // - Only returns if tenant_id = currentTenantId (RLS)

  // 2. Composed query
  const userWithPosts = await getUserWithPosts(executor, 1)
  // - Both user and posts have plugins applied
  // { id: 1, email: '...', posts: [...] }

  // 3. Parallel queries
  const dashboard = await getUserDashboard(executor, 1)
  // - All queries run concurrently with plugins applied
  // { user: {...}, posts: [...], stats: {...} }

  // 4. Transaction with plugins
  const result = await withTransaction(executor, async ctx => {
    // Create new user
    const newUser = await createUser(ctx, {
      email: 'test@example.com',
      name: 'Test User',
      tenant_id: currentTenantId
    })

    // Create post for new user
    const newPost = await createPost(ctx, {
      user_id: newUser.id,
      title: 'First Post',
      body: 'Hello World',
      tenant_id: currentTenantId
    })

    // Get user with posts (plugins still applied in transaction)
    const userWithPosts = await getUserWithPosts(ctx, newUser.id)

    return { user: newUser, post: newPost, fullUser: userWithPosts }
  })

  return result
}
```

## See Also

- [Executor API](/docs/api/executor) - Plugin system and KyseraExecutor reference
- [Repository vs DAL Guide](/docs/guides/dal-vs-repository) - Detailed comparison and decision guide
- [Repository API](/docs/api/repository) - Repository pattern reference
- [Soft Delete Plugin](/docs/plugins/soft-delete) - Soft delete plugin documentation
- [RLS Plugin](/docs/plugins/rls) - Row-Level Security plugin documentation
