# @kysera/dal

Functional Data Access Layer for Kysera ORM - Query functions, context passing, and composition utilities.

## Overview

`@kysera/dal` provides a functional approach to database access as an alternative to traditional repository patterns. Instead of classes and methods, you write **query functions** that are composable, type-safe, and easy to test.

## Features

- **Query Functions** - Pure functions instead of repository methods
- **Type Inference** - Return types automatically inferred from queries
- **Context Passing** - Explicit database context (no dependency injection containers)
- **Transaction Support** - First-class transaction handling with automatic context propagation
- **Composition Utilities** - Combine queries using `compose`, `chain`, `parallel`, etc.
- **Zero Dependencies** - Only peer dependency on Kysely
- **Fully Typed** - Complete TypeScript support with strict mode

## Installation

```bash
npm install @kysera/dal kysely
# or
pnpm add @kysera/dal kysely
# or
yarn add @kysera/dal kysely
# or
bun add @kysera/dal kysely
```

## Quick Start

```typescript
import { Kysely } from 'kysely';
import { createQuery, withTransaction } from '@kysera/dal';

// Define your database schema
interface Database {
  users: {
    id: number;
    email: string;
    name: string;
  };
}

const db = new Kysely<Database>({ /* config */ });

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
const insertPost = createQuery((ctx, data: { title: string; body: string; userId: number }) =>
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

### Database Context

The `DbContext` type wraps either a Kysely instance or a Transaction, providing metadata about the execution context.

```typescript
import { createContext, isInTransaction, withContext } from '@kysera/dal';

// Create a context manually
const ctx = createContext(db);

// Use with a context wrapper
const users = await withContext(db, async (ctx) => {
  return getAllUsers(ctx);
});

// Check if in transaction
const myQuery = createQuery((ctx, id: number) => {
  if (isInTransaction(ctx)) {
    console.log('Running inside transaction');
  }
  return ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
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

// This will throw: "Query requires a transaction"
await transferFunds(db, 1, 2, 100);
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

const result = await getUserWithPosts(db, 1);
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

const fullUser = await getUserComplete(db, 1);
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

const dashboard = await getDashboardData(db, userId);
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

const features = await getFeatures(db, userId, true);  // Executes query
const emptyFeatures = await getFeatures(db, userId, false);  // Returns []
```

### mapResult

Transform array results with a mapper function:

```typescript
import { createQuery, mapResult } from '@kysera/dal';

const getAllUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
);

const getUserNames = mapResult(getAllUsers, (user) => user.name);

const names = await getUserNames(db);  // string[]
```

## API Reference

### Query Creation

#### `createQuery<DB, TArgs, TResult>(queryFn)`

Create a typed query function.

**Parameters:**
- `queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>` - Query implementation

**Returns:** `QueryFunction<DB, TArgs, TResult>`

#### `createTransactionalQuery<DB, TArgs, TResult>(queryFn)`

Create a query function that requires a transaction context.

**Parameters:**
- `queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>` - Query implementation

**Returns:** `QueryFunction<DB, TArgs, TResult>`

**Throws:** Error if called outside a transaction

### Context Management

#### `createContext<DB>(db)`

Create a database context from a Kysely or Transaction instance.

**Parameters:**
- `db: Kysely<DB> | Transaction<DB>` - Database instance

**Returns:** `DbContext<DB>`

#### `withTransaction<DB, T>(db, fn, options?)`

Execute a function within a transaction.

**Parameters:**
- `db: Kysely<DB>` - Database instance
- `fn: (ctx: DbContext<DB>) => Promise<T>` - Function to execute
- `options?: TransactionOptions` - Transaction options

**Returns:** `Promise<T>`

#### `withContext<DB, T>(db, fn)`

Execute a function with a database context (no transaction).

**Parameters:**
- `db: Kysely<DB>` - Database instance
- `fn: (ctx: DbContext<DB>) => Promise<T>` - Function to execute

**Returns:** `Promise<T>`

#### `isInTransaction<DB>(ctx)`

Check if context is within a transaction.

**Parameters:**
- `ctx: DbContext<DB>` - Database context

**Returns:** `boolean`

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
  readonly db: Kysely<DB> | Transaction<DB>;
  readonly isTransaction: boolean;
}
```

### `QueryFunction<DB, TArgs, TResult>`

Query function signature.

```typescript
type QueryFunction<DB, TArgs extends readonly unknown[], TResult> = (
  ctxOrDb: DbContext<DB> | Kysely<DB>,
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

**Note:** Isolation level configuration is dialect-specific and should typically be set at the connection pool level. The `isolationLevel` option logs a warning as Kysely's Transaction API doesn't expose `raw()` for runtime configuration.

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

### User Management Service

```typescript
import { createQuery, withTransaction, parallel } from '@kysera/dal';

// Queries
const createUser = createQuery((ctx, data: { email: string; name: string }) =>
  ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
);

const createUserProfile = createQuery((ctx, data: { userId: number; bio: string }) =>
  ctx.db.insertInto('profiles').values(data).returningAll().executeTakeFirstOrThrow()
);

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
);

const getProfileByUserId = createQuery((ctx, userId: number) =>
  ctx.db.selectFrom('profiles').selectAll().where('user_id', '=', userId).executeTakeFirst()
);

// Service function using transaction
async function registerUser(db: Kysely<Database>, data: RegisterData) {
  return withTransaction(db, async (ctx) => {
    const user = await createUser(ctx, {
      email: data.email,
      name: data.name,
    });

    const profile = await createUserProfile(ctx, {
      userId: user.id,
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

const userData = await getUserData(db, userId);
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

const post = await getPostWithAuthor(db, postId);
// { id, title, body, user_id, author: { id, name, email } }
```

## Requirements

- **Node.js**: >=20.0.0
- **Bun**: >=1.0.0
- **Kysely**: >=0.28.8

## License

MIT

## Contributing

Contributions are welcome! Please see the [main repository](https://github.com/kysera-dev/kysera) for guidelines.

## Links

- [GitHub Repository](https://github.com/kysera-dev/kysera)
- [Issue Tracker](https://github.com/kysera-dev/kysera/issues)
- [Kysely Documentation](https://kysely.dev)
