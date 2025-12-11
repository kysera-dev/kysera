# @kysera/dal

Functional Data Access Layer for Kysera ORM - Query functions with automatic plugin support.

## Overview

`@kysera/dal` provides a functional approach to database access as an alternative to traditional repository patterns. Write **query functions** that are composable, type-safe, and easy to test.

The DAL seamlessly integrates with `@kysera/executor` to provide automatic plugin support (soft-delete, RLS, audit, etc.) while maintaining a clean functional API.

## Features

- **Query Functions** - Pure functions instead of repository methods
- **Type Inference** - Return types automatically inferred from queries
- **Context Passing** - Explicit database context (no dependency injection)
- **Plugin Support** - Automatic plugin interception via `@kysera/executor`
- **Transaction Support** - First-class transactions with automatic plugin propagation
- **Composition Utilities** - Combine queries using `compose`, `chain`, `parallel`, etc.
- **Zero Dependencies** - Only `@kysera/executor` dependency (peers on Kysely)
- **Fully Typed** - Complete TypeScript support with strict mode

## Installation

```bash
npm install @kysera/dal @kysera/executor kysely

# Add plugins as needed
npm install @kysera/soft-delete @kysera/rls @kysera/audit

# Using pnpm
pnpm add @kysera/dal @kysera/executor kysely

# Using yarn
yarn add @kysera/dal @kysera/executor kysely

# Using bun
bun add @kysera/dal @kysera/executor kysely
```

## Quick Start

```typescript
import { Kysely } from 'kysely';
import { createExecutor } from '@kysera/executor';
import { softDeletePlugin } from '@kysera/soft-delete';
import { createQuery, withTransaction } from '@kysera/dal';

// Define your database schema
interface Database {
  users: {
    id: number;
    email: string;
    name: string;
    deleted_at: Date | null;
  };
}

const db = new Kysely<Database>({ /* config */ });

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()]);

// Define query functions
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

// Use directly - soft-delete filter automatically applied
const user = await getUserById(executor, 1);

// Use in transactions - plugins propagate automatically
const result = await withTransaction(executor, async (ctx) => {
  const newUser = await createUser(ctx, {
    email: 'test@example.com',
    name: 'Test User'
  });
  return newUser;
});
```

## Core Concepts

### Query Functions

Query functions are the building blocks of the Functional DAL. They accept a database context and arguments, returning a Promise.

```typescript
import { createQuery } from '@kysera/dal';

// Simple select query
const findUserByEmail = createQuery((ctx, email: string) =>
  ctx.db
    .selectFrom('users')
    .selectAll()
    .where('email', '=', email)
    .executeTakeFirst()
);

// Insert query
const insertPost = createQuery((ctx, data: { title: string; body: string; user_id: number }) =>
  ctx.db
    .insertInto('posts')
    .values(data)
    .returningAll()
    .executeTakeFirstOrThrow()
);

// Update query
const updateUserName = createQuery((ctx, id: number, name: string) =>
  ctx.db
    .updateTable('users')
    .set({ name })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
);

// Delete query
const deletePost = createQuery((ctx, id: number) =>
  ctx.db
    .deleteFrom('posts')
    .where('id', '=', id)
    .executeTakeFirst()
);
```

### Plugin Integration

The DAL automatically integrates with `@kysera/executor` to provide seamless plugin support. When you use a `KyseraExecutor` instead of a raw Kysely instance, all queries automatically have plugins applied.

#### Basic Plugin Integration

```typescript
import { createExecutor } from '@kysera/executor';
import { softDeletePlugin } from '@kysera/soft-delete';
import { rlsPlugin } from '@kysera/rls';
import { createQuery } from '@kysera/dal';

// Create executor with plugins
const executor = await createExecutor(db, [
  softDeletePlugin(),
  rlsPlugin({
    schema: {
      users: { tenantIdColumn: 'tenant_id' },
      posts: { tenantIdColumn: 'tenant_id' }
    },
    getCurrentTenantId: () => currentTenantId
  })
]);

// Define queries - plugins apply automatically
const getUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
);

// Soft-delete filter and RLS automatically applied
const users = await getUsers(executor);
// Only returns users where:
// - deleted_at IS NULL (soft-delete plugin)
// - tenant_id = currentTenantId (RLS plugin)
```

#### How Plugin Propagation Works

1. **Query Creation**: When you pass a `KyseraExecutor` to a query function, the context preserves the executor with all its plugins
2. **Transaction Wrapping**: `withTransaction()` automatically wraps transaction instances with the same plugins as the parent executor
3. **Automatic Interception**: All query builders (`selectFrom`, `insertInto`, etc.) are intercepted by plugins before execution
4. **Type Safety**: Full TypeScript support - the database schema type is preserved through all transformations

#### Multiple Plugins

```typescript
import { createExecutor } from '@kysera/executor';
import { softDeletePlugin } from '@kysera/soft-delete';
import { rlsPlugin } from '@kysera/rls';
import { auditPlugin } from '@kysera/audit';

const executor = await createExecutor(db, [
  softDeletePlugin(),           // Priority: 100
  rlsPlugin({ /* ... */ }),     // Priority: 90
  auditPlugin({ /* ... */ })    // Priority: 80
]);

// All plugins apply in priority order (higher = runs first)
const getUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
);

const users = await getUsers(executor);
```

### Transactions

Execute multiple queries atomically within a transaction. Plugins automatically propagate to the transaction context.

```typescript
import { withTransaction, createTransactionalQuery } from '@kysera/dal';

// Regular transaction
const result = await withTransaction(executor, async (ctx) => {
  const user = await createUser(ctx, userData);
  const profile = await createProfile(ctx, { userId: user.id, ...profileData });
  return { user, profile };
});

// Query that REQUIRES a transaction
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
await withTransaction(executor, (ctx) => transferFunds(ctx, 1, 2, 100));

// This will throw: "Query requires a transaction"
await transferFunds(executor, 1, 2, 100);
```

## Composition

### compose

Compose two query functions sequentially, passing the result of the first to the second:

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

const result = await getUserWithPosts(executor, 1);
// { id: 1, email: '...', name: '...', posts: [...] }
```

### chain

Chain multiple transformations on a query result:

```typescript
import { createQuery, chain } from '@kysera/dal';

const getUser = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
);

const getUserComplete = chain(
  getUser,
  async (ctx, user) => ({ ...user, posts: await getPosts(ctx, user.id) }),
  async (ctx, data) => ({ ...data, followers: await getFollowers(ctx, data.id) }),
  async (ctx, data) => ({ ...data, stats: await getStats(ctx, data.id) })
);

const fullUser = await getUserComplete(executor, 1);
// { ...user, posts: [...], followers: [...], stats: {...} }
```

### parallel

Execute multiple queries concurrently and combine their results:

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

const dashboard = await getDashboardData(executor, userId);
// { user: {...}, stats: {...}, notifications: [...] }
```

### conditional

Execute a query conditionally based on runtime logic:

```typescript
import { createQuery, conditional } from '@kysera/dal';

const getPremiumFeatures = createQuery((ctx, userId: number) =>
  ctx.db.selectFrom('premium_features').selectAll().where('user_id', '=', userId).execute()
);

const getFeatures = conditional(
  (ctx, userId: number, isPremium: boolean) => isPremium,
  getPremiumFeatures,
  []  // Fallback: empty array for non-premium users
);

const features = await getFeatures(executor, userId, true);  // Executes query
const emptyFeatures = await getFeatures(executor, userId, false);  // Returns []
```

### mapResult

Transform array results with a mapper function:

```typescript
import { createQuery, mapResult } from '@kysera/dal';

const getAllUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
);

const getUserNames = mapResult(getAllUsers, (user) => user.name);

const names = await getUserNames(executor);  // string[]
```

## API Reference

### Query Creation

#### `createQuery<DB, TArgs, TResult>(queryFn)`

Create a typed query function.

**Parameters:**
- `queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>` - Query implementation

**Returns:** `QueryFunction<DB, TArgs, TResult>`

**Example:**
```typescript
const getUserById = createQuery((ctx, id: number) =>
  ctx.db
    .selectFrom('users')
    .select(['id', 'email', 'name'])
    .where('id', '=', id)
    .executeTakeFirst()
);

// Usage with KyseraExecutor (plugins applied)
const user = await getUserById(executor, 1);

// Usage with context (inside transaction)
await withTransaction(executor, async (ctx) => {
  const user = await getUserById(ctx, 1);
  return user;
});
```

#### `createTransactionalQuery<DB, TArgs, TResult>(queryFn)`

Create a query function that requires a transaction context.

**Parameters:**
- `queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>` - Query implementation

**Returns:** `QueryFunction<DB, TArgs, TResult>`

**Throws:** Error if called outside a transaction

**Example:**
```typescript
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
await withTransaction(executor, (ctx) => transferFunds(ctx, 1, 2, 100));

// This will throw an error
await transferFunds(executor, 1, 2, 100); // Error: Query requires transaction
```

### Context Management

#### `createContext<DB>(db)`

Create a database context from any database instance.

**Parameters:**
- `db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>` - Database instance

**Returns:** `DbContext<DB>`

**Example:**
```typescript
import { createContext } from '@kysera/dal';
import { createExecutor } from '@kysera/executor';

const executor = await createExecutor(db, [softDeletePlugin()]);
const ctx = createContext(executor);
const user = await findUserById(ctx, 1); // soft-delete filter applied
```

#### `withTransaction<DB, T>(db, fn, options?)`

Execute a function within a transaction.

**Parameters:**
- `db: Kysely<DB> | KyseraExecutor<DB>` - Database instance
- `fn: (ctx: DbContext<DB>) => Promise<T>` - Function to execute
- `options?: TransactionOptions` - Transaction options (optional)

**Returns:** `Promise<T>`

**Example:**
```typescript
// Basic usage
const result = await withTransaction(executor, async (ctx) => {
  const user = await createUser(ctx, userData);
  const profile = await createProfile(ctx, { userId: user.id, ...profileData });
  return { user, profile };
});

// With KyseraExecutor (plugins propagated)
const result = await withTransaction(executor, async (ctx) => {
  // All queries in transaction have plugins applied
  const users = await getUsers(ctx);
  return users;
});
```

#### `withContext<DB, T>(db, fn)`

Execute a function with a database context (no transaction).

**Parameters:**
- `db: Kysely<DB> | KyseraExecutor<DB>` - Database instance
- `fn: (ctx: DbContext<DB>) => Promise<T>` - Function to execute

**Returns:** `Promise<T>`

**Example:**
```typescript
const users = await withContext(executor, async (ctx) => {
  return getAllUsers(ctx);
});
```

#### `isInTransaction<DB>(ctx)`

Check if context is within a transaction.

**Parameters:**
- `ctx: DbContext<DB>` - Database context

**Returns:** `boolean`

**Example:**
```typescript
const myQuery = createQuery((ctx, id: number) => {
  if (isInTransaction(ctx)) {
    console.log('Running inside transaction');
  }
  return ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
});
```

### Composition

#### `compose<DB, TArgs, TFirst, TResult>(first, second)`

Compose two query functions sequentially.

**Parameters:**
- `first: QueryFunction<DB, TArgs, TFirst>` - First query
- `second: (ctx: DbContext<DB>, result: TFirst) => Promise<TResult>` - Second query

**Returns:** `QueryFunction<DB, TArgs, TResult>`

#### `chain<DB, TArgs, T1, T2, ...>(query, ...transforms)`

Chain multiple transformations on a query result.

**Parameters:**
- `query: QueryFunction<DB, TArgs, T1>` - Initial query
- `...transforms: Array<(ctx: DbContext<DB>, result) => Promise<result>>` - Transform functions

**Returns:** `QueryFunction<DB, TArgs, TN>` (where N is the last transform result type)

**Overloads:** Supports 1-3 transform functions with full type inference

#### `parallel<DB, TArgs, T>(queries)`

Execute multiple queries in parallel.

**Parameters:**
- `queries: Record<string, QueryFunction<DB, TArgs, unknown>>` - Object of query functions

**Returns:** `QueryFunction<DB, TArgs, ParallelResult<T>>`

#### `conditional<DB, TArgs, TResult, TFallback>(condition, query, fallback?)`

Execute a query conditionally.

**Parameters:**
- `condition: (ctx: DbContext<DB>, ...args: TArgs) => boolean | Promise<boolean>` - Condition function
- `query: QueryFunction<DB, TArgs, TResult>` - Query to execute if true
- `fallback?: TFallback` - Value to return if false

**Returns:** `QueryFunction<DB, TArgs, TResult | TFallback>`

#### `mapResult<DB, TArgs, TItem, TResult>(query, mapper)`

Map over array results.

**Parameters:**
- `query: QueryFunction<DB, TArgs, TItem[]>` - Query returning array
- `mapper: (item: TItem, index: number) => TResult` - Mapper function

**Returns:** `QueryFunction<DB, TArgs, TResult[]>`

## TypeScript Types

### `DbContext<DB>`

Database context interface.

```typescript
interface DbContext<DB = Record<string, unknown>> {
  readonly db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>;
  readonly isTransaction: boolean;
}
```

### `QueryFunction<DB, TArgs, TResult>`

Query function signature.

```typescript
type QueryFunction<DB, TArgs extends readonly unknown[], TResult> = (
  ctxOrDb: DbContext<DB> | Kysely<DB> | KyseraExecutor<DB>,
  ...args: TArgs
) => Promise<TResult>;
```

### `TransactionOptions`

Transaction execution options.

```typescript
interface TransactionOptions {
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
}
```

**Note:** Isolation level configuration is dialect-specific and should typically be set at the connection pool level.

### Type Inference Utilities

```typescript
// Infer result type from query function
type InferResult<T> = T extends QueryFunction<any, any, infer R> ? R : never;

// Infer arguments type from query function
type InferArgs<T> = T extends QueryFunction<any, infer A, any> ? A : never;

// Infer database type from query function
type InferDB<T> = T extends QueryFunction<infer DB, any, any> ? DB : never;
```

### `ParallelResult<T>`

Result type for parallel query execution.

```typescript
type ParallelResult<
  T extends Record<string, QueryFunction<any, any, any>>
> = {
  [K in keyof T]: T[K] extends QueryFunction<any, any, infer R> ? R : never;
};
```

## Examples

### Complete Example with Plugins

```typescript
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { createExecutor } from '@kysera/executor';
import { softDeletePlugin } from '@kysera/soft-delete';
import { rlsPlugin } from '@kysera/rls';
import { createQuery, withTransaction, parallel } from '@kysera/dal';

// Database schema
interface Database {
  users: {
    id: number;
    email: string;
    name: string;
    tenant_id: number;
    deleted_at: Date | null;
  };
  posts: {
    id: number;
    user_id: number;
    title: string;
    body: string;
    tenant_id: number;
    deleted_at: Date | null;
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
  softDeletePlugin(),
  rlsPlugin({
    schema: {
      users: { tenantIdColumn: 'tenant_id' },
      posts: { tenantIdColumn: 'tenant_id' }
    },
    getCurrentTenantId: () => currentTenantId
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

const createUser = createQuery((ctx, data: { email: string; name: string; tenant_id: number }) =>
  ctx.db
    .insertInto('users')
    .values(data)
    .returningAll()
    .executeTakeFirstOrThrow()
);

const createPost = createQuery((ctx, data: { user_id: number; title: string; body: string; tenant_id: number }) =>
  ctx.db
    .insertInto('posts')
    .values(data)
    .returningAll()
    .executeTakeFirstOrThrow()
);

// Use queries - plugins apply automatically
const user = await getUserById(executor, 1);
// Only returns if:
// - deleted_at IS NULL (soft-delete plugin)
// - tenant_id = currentTenantId (RLS plugin)

// Atomic operations with transaction
const result = await withTransaction(executor, async (ctx) => {
  const newUser = await createUser(ctx, {
    email: 'test@example.com',
    name: 'Test User',
    tenant_id: currentTenantId
  });

  const newPost = await createPost(ctx, {
    user_id: newUser.id,
    title: 'First Post',
    body: 'Hello World',
    tenant_id: currentTenantId
  });

  return { user: newUser, post: newPost };
});

// Parallel queries
const getUserData = parallel({
  user: getUserById,
  posts: getPostsByUserId
});

const userData = await getUserData(executor, userId);
// { user: {...}, posts: [...] }
```

### User Management Service

```typescript
import { createQuery, withTransaction, parallel } from '@kysera/dal';

// Queries
const createUser = createQuery((ctx, data: { email: string; name: string }) =>
  ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
);

const createUserProfile = createQuery((ctx, data: { user_id: number; bio: string }) =>
  ctx.db.insertInto('profiles').values(data).returningAll().executeTakeFirstOrThrow()
);

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
);

const getProfileByUserId = createQuery((ctx, userId: number) =>
  ctx.db.selectFrom('profiles').selectAll().where('user_id', '=', userId).executeTakeFirst()
);

// Service function using transaction
async function registerUser(executor: KyseraExecutor<Database>, data: RegisterData) {
  return withTransaction(executor, async (ctx) => {
    const user = await createUser(ctx, {
      email: data.email,
      name: data.name,
    });

    const profile = await createUserProfile(ctx, {
      user_id: user.id,
      bio: data.bio,
    });

    return { user, profile };
  });
}

// Fetch user data in parallel
const getUserData = parallel({
  user: getUserById,
  profile: getProfileByUserId,
});

const userData = await getUserData(executor, userId);
```

### Blog Post with Author

```typescript
import { createQuery, compose } from '@kysera/dal';

const getPostById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('posts').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
);

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
);

const getPostWithAuthor = compose(
  getPostById,
  async (ctx, post) => ({
    ...post,
    author: await getUserById(ctx, post.user_id),
  })
);

const post = await getPostWithAuthor(executor, postId);
// { id, title, body, user_id, author: { id, name, email } }
```

## Requirements

- **Node.js**: >=20.0.0
- **Bun**: >=1.0.0
- **Kysely**: >=0.28.8 (peer dependency)
- **@kysera/executor**: >=0.7.0 (dependency)

## License

MIT

## Contributing

Contributions are welcome! Please see the [main repository](https://github.com/kysera-dev/kysera) for guidelines.

## Links

- [GitHub Repository](https://github.com/kysera-dev/kysera)
- [Issue Tracker](https://github.com/kysera-dev/kysera/issues)
- [Kysely Documentation](https://kysely.dev)
