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

## When to Use DAL vs Repository

| Scenario | Repository | Functional DAL |
|----------|------------|----------------|
| CRUD operations with validation | Better | Suitable |
| Complex custom queries | Limited | Better |
| Multi-table transactions | Verbose | Better |
| Vertical Slice Architecture | Not ideal | Ideal |
| Maximum type inference | Medium | Excellent |
| Tree-shaking critical | Medium | Excellent |
