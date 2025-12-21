# @kysera/repository

Repository pattern implementation with unified plugin support for Kysera.

**Note:** The `createORM` function creates a plugin container for the Repository pattern - not a traditional ORM with entity mapping, Unit of Work, or Identity Map.

[![Version](https://img.shields.io/npm/v/@kysera/repository.svg)](https://www.npmjs.com/package/@kysera/repository)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## Overview

The Repository package provides a repository pattern interface for Kysely with full plugin support via [@kysera/executor](../executor). It supports flexible validation adapters (Zod, Valibot, TypeBox, or custom), CQRS-lite patterns, and works seamlessly with plugins like soft-delete and RLS.

**Key Features:**
- Repository pattern with CRUD operations
- Unified plugin system via [@kysera/executor](../executor)
- Flexible validation adapters (Zod, Valibot, TypeBox, custom)
- Primary key flexibility (single, composite, UUID)
- Bulk operations and pagination
- CQRS-lite support (Repository writes + DAL reads)
- Full TypeScript type safety

## Installation

```bash
pnpm add @kysera/repository kysely
```

Optional validation libraries:

```bash
# For Zod validation
pnpm add zod

# For Valibot validation
pnpm add valibot

# For TypeBox validation
pnpm add @sinclair/typebox
```

## Quick Start

### Basic Repository

```typescript
import { createRepositoryFactory, nativeAdapter } from '@kysera/repository';
import { Kysely } from 'kysely';

interface User {
  id: number;
  name: string;
  email: string;
}

interface Database {
  users: User;
}

const db: Kysely<Database> = /* ... */;
const factory = createRepositoryFactory(db);

const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: {
    create: nativeAdapter<{ name: string; email: string }>(),
  },
});

// CRUD operations
const user = await userRepo.create({ name: 'Alice', email: 'alice@example.com' });
const found = await userRepo.findById(user.id);
const updated = await userRepo.update(user.id, { name: 'Alice Smith' });
await userRepo.delete(user.id);
```

### With Zod Validation

```typescript
import { createRepositoryFactory, zodAdapter } from '@kysera/repository';
import { z } from 'zod';

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: {
    create: zodAdapter(CreateUserSchema),
    update: zodAdapter(CreateUserSchema.partial()),
  },
});

// Validation happens automatically
const user = await userRepo.create({
  name: 'Bob',
  email: 'invalid-email' // Throws validation error
});
```

## Core API

### createORM

Create a plugin container with unified plugin management via [@kysera/executor](../executor).

```typescript
import { createORM } from '@kysera/repository';
import { softDeletePlugin } from '@kysera/soft-delete';
import { rlsPlugin } from '@kysera/rls';

const orm = await createORM(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema }),
]);
```

**Plugin Container Interface:**

```typescript
interface PluginOrm<DB> {
  // Plugin-aware executor (Kysely instance with plugin interception)
  executor: Kysely<DB>;

  // Create a repository with plugin support
  createRepository<T>(factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T): T;

  // Apply plugin interceptors to query builders
  applyPlugins<QB>(qb: QB, operation: string, table: string, metadata?: Record<string, unknown>): QB;

  // Registered plugins in resolved dependency order
  plugins: readonly Plugin[];

  // Create a DAL context with plugins
  createContext(): DbContext<DB>;

  // Execute a transaction with both Repository and DAL patterns
  transaction<T>(fn: (ctx: DbContext<DB>) => Promise<T>): Promise<T>;
}
```

### createRepositoryFactory

Create a factory for building type-safe repositories.

```typescript
import { createRepositoryFactory } from '@kysera/repository';

const factory = createRepositoryFactory(db);

const userRepo = factory.create({
  tableName: 'users',
  primaryKey: 'id',           // Optional, default: 'id'
  primaryKeyType: 'number',   // Optional, default: 'number'
  mapRow: (row) => row,
  schemas: {
    create: nativeAdapter<CreateUserInput>(),
    update: nativeAdapter<UpdateUserInput>(),
  },
});
```

## Plugin Integration

Plugins work by intercepting queries and extending repository interfaces. The plugin container uses [@kysera/executor](../executor) internally for unified plugin management.

### Using Plugins

```typescript
import { createORM } from '@kysera/repository';
import { softDeletePlugin } from '@kysera/soft-delete';

const orm = await createORM(db, [softDeletePlugin()]);

// Create repository with plugin extensions
const userRepo = orm.createRepository((executor, applyPlugins) => {
  const factory = createRepositoryFactory(executor);
  return factory.create({
    tableName: 'users',
    mapRow: (row) => row,
    schemas: {
      create: nativeAdapter<CreateUserInput>(),
    },
  });
});

// Plugin methods are automatically available
await userRepo.create({ name: 'Alice', email: 'alice@example.com' });
await userRepo.softDelete(1);  // Added by soft-delete plugin
await userRepo.restore(1);     // Added by soft-delete plugin
```

### Plugin Lifecycle

1. **Validation** - Plugins validated for conflicts and dependencies
2. **Resolution** - Plugins sorted by priority and dependencies
3. **Initialization** - `plugin.onInit()` called (if defined)
4. **Interception** - `plugin.interceptQuery()` applied to all queries
5. **Extension** - `plugin.extendRepository()` adds methods to repositories

### Manual Plugin Application

```typescript
const orm = await createORM(db, [softDeletePlugin()]);

// Manually apply plugins to custom queries
let query = orm.executor.selectFrom('users').selectAll();

query = orm.applyPlugins(query, 'select', 'users', {
  customMetadata: 'value'
});

const users = await query.execute();
```

## CQRS-lite Pattern

Combine Repository writes with DAL reads in the same transaction with shared plugins.

```typescript
import { createORM } from '@kysera/repository';
import { createQuery } from '@kysera/dal';
import { softDeletePlugin } from '@kysera/soft-delete';

const orm = await createORM(db, [softDeletePlugin()]);

// Define DAL query for complex reads
const getUserStats = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('users')
    .leftJoin('posts', 'posts.user_id', 'users.id')
    .select([
      'users.id',
      'users.name',
      (eb) => eb.fn.count('posts.id').as('postCount'),
    ])
    .where('users.id', '=', userId)
    .groupBy(['users.id', 'users.name'])
    .executeTakeFirst()
);

// Use in transaction with Repository
const result = await orm.transaction(async (ctx) => {
  // Create repository for writes
  const userRepo = orm.createRepository((executor) => {
    const factory = createRepositoryFactory(executor);
    return factory.create({
      tableName: 'users',
      mapRow: (row) => row,
      schemas: { create: nativeAdapter<CreateUserInput>() },
    });
  });

  // Write: Create user via Repository
  const user = await userRepo.create({
    name: 'Alice',
    email: 'alice@example.com',
  });

  // Read: Get stats via DAL (plugins automatically applied)
  const stats = await getUserStats(ctx, user.id);

  return { user, stats };
});
```

**Benefits:**
- Separation of concerns (Repository for writes, DAL for complex reads)
- Shared transaction context
- Plugins apply to both patterns
- Full type safety

## Repository API

All repositories implement the `BaseRepository` interface:

### Core Operations

```typescript
// Create
const user = await repo.create({ name: 'Alice', email: 'alice@example.com' });

// Read
const found = await repo.findById(1);
const all = await repo.findAll();
const filtered = await repo.find({ where: { name: 'Alice' } });
const one = await repo.findOne({ where: { email: 'alice@example.com' } });

// Update
const updated = await repo.update(1, { name: 'Alice Smith' });

// Delete
const deleted = await repo.delete(1); // Returns true if deleted
```

### Bulk Operations

```typescript
// Bulk create
const users = await repo.bulkCreate([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
]);

// Bulk update
const updated = await repo.bulkUpdate([
  { id: 1, data: { name: 'Alice Smith' } },
  { id: 2, data: { name: 'Bob Jones' } },
]);

// Bulk delete
const deletedCount = await repo.bulkDelete([1, 2, 3]);
```

### Queries

```typescript
// Count
const total = await repo.count();
const filtered = await repo.count({ where: { active: true } });

// Exists
const exists = await repo.exists({ where: { email: 'alice@example.com' } });

// Find by IDs
const users = await repo.findByIds([1, 2, 3]);
```

### Pagination

**Offset-based pagination:**

```typescript
const result = await repo.paginate({
  limit: 10,
  offset: 0,
  orderBy: 'created_at',
  orderDirection: 'desc',
});

console.log(result.items); // Array of entities
console.log(result.total); // Total count
console.log(result.limit); // 10
console.log(result.offset); // 0
```

**Cursor-based pagination:**

```typescript
const result = await repo.paginateCursor({
  limit: 10,
  orderBy: 'created_at',
  orderDirection: 'desc',
});

console.log(result.items); // Array of entities
console.log(result.nextCursor); // { value: Date, id: number }
console.log(result.hasMore); // boolean

// Next page
const nextPage = await repo.paginateCursor({
  limit: 10,
  cursor: result.nextCursor,
  orderBy: 'created_at',
  orderDirection: 'desc',
});
```

### Transactions

```typescript
await repo.transaction(async (trx) => {
  const user = await trx
    .insertInto('users')
    .values({ name: 'Alice', email: 'alice@example.com' })
    .returningAll()
    .executeTakeFirstOrThrow();

  await trx
    .insertInto('profiles')
    .values({ user_id: user.id, bio: 'Hello!' })
    .execute();
});
```

## Validation Adapters

The repository supports multiple validation libraries through a unified adapter interface.

### Zod Adapter

```typescript
import { z } from 'zod';
import { zodAdapter } from '@kysera/repository';

const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

const repo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: {
    create: zodAdapter(UserSchema),
    update: zodAdapter(UserSchema.partial()),
  },
});
```

### Valibot Adapter

```typescript
import * as v from 'valibot';
import { valibotAdapter } from '@kysera/repository';

const UserSchema = v.object({
  name: v.string([v.minLength(1)]),
  email: v.string([v.email()]),
});

const repo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: {
    create: valibotAdapter(UserSchema, v),
  },
});
```

### TypeBox Adapter

```typescript
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { typeboxAdapter } from '@kysera/repository';

const UserSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  email: Type.String({ format: 'email' }),
});

const repo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: {
    create: typeboxAdapter(UserSchema, Value),
  },
});
```

### Native Adapter (No Validation)

```typescript
import { nativeAdapter } from '@kysera/repository';

const repo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: {
    create: nativeAdapter<CreateUserInput>(),
  },
});
```

### Custom Adapter

```typescript
import { customAdapter } from '@kysera/repository';

const isPositiveNumber = customAdapter<number>((data) => {
  if (typeof data !== 'number' || data <= 0) {
    throw new Error('Must be a positive number');
  }
  return data;
});
```

## Primary Key Configuration

Repositories support flexible primary key configurations.

### Default (id: number)

```typescript
const repo = factory.create({
  tableName: 'users',
  // primaryKey defaults to 'id'
  // primaryKeyType defaults to 'number'
  mapRow: (row) => row,
  schemas: { create: nativeAdapter() },
});
```

### Custom Column Name

```typescript
const repo = factory.create({
  tableName: 'users',
  primaryKey: 'user_id',
  primaryKeyType: 'number',
  mapRow: (row) => row,
  schemas: { create: nativeAdapter() },
});
```

### UUID Primary Key

```typescript
const repo = factory.create({
  tableName: 'users',
  primaryKey: 'id',
  primaryKeyType: 'uuid',
  mapRow: (row) => row,
  schemas: { create: nativeAdapter() },
});
```

### Composite Primary Key

```typescript
const repo = factory.create({
  tableName: 'user_roles',
  primaryKey: ['user_id', 'role_id'],
  primaryKeyType: 'number',
  mapRow: (row) => row,
  schemas: { create: nativeAdapter() },
});

// Usage with composite key
const userRole = await repo.findById({ user_id: 1, role_id: 2 });
await repo.delete({ user_id: 1, role_id: 2 });
```

## ContextAwareRepository

Abstract base class for repositories that need clean transaction handling via executor switching:

```typescript
import { ContextAwareRepository } from '@kysera/repository';
import type { Executor } from '@kysera/core';

class UserRepository extends ContextAwareRepository<Database, 'users'> {
  async create(data: { email: string; name: string }): Promise<User> {
    return this.db
      .insertInto(this.tableName)
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(id: number): Promise<User | null> {
    return this.db
      .selectFrom(this.tableName)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst() ?? null;
  }
}

// Normal usage
const userRepo = new UserRepository(db, 'users');
const user = await userRepo.findById(1);

// Transaction usage - switch executor cleanly
await db.transaction().execute(async (trx) => {
  const txUserRepo = userRepo.withExecutor(trx);
  const txPostRepo = postRepo.withExecutor(trx);

  const user = await txUserRepo.create({ email: 'test@example.com', name: 'Test' });
  await txPostRepo.create({ userId: user.id, title: 'Hello' });
});
```

**Benefits:**
- Clean API: No `executor` parameter in every method
- Type-safe: `withExecutor()` returns same repository type
- Preserves instance: Custom properties preserved

## Upsert Helpers

Functions for INSERT ... ON CONFLICT DO UPDATE operations:

```typescript
import { upsert, upsertMany } from '@kysera/repository';

// Single record upsert
const wallet = await upsert(db, 'wallets', {
  name: 'Main Wallet',
  balance: 1000
}, {
  conflictColumns: ['name'],
  returning: true
});

// Batch upsert
const prices = await upsertMany(db, 'price_history', [
  { pair: 'BTC/USD', timestamp: now, price: 50000 },
  { pair: 'ETH/USD', timestamp: now, price: 3000 },
], {
  conflictColumns: ['pair', 'timestamp'],
  updateColumns: ['price'],
  returning: true
});

// Upsert with specific update columns
await upsert(db, 'users', {
  email: 'alice@example.com',
  name: 'Alice Updated',
  role: 'admin'
}, {
  conflictColumns: ['email'],
  updateColumns: ['name'],  // Only update name, not role
});
```

**UpsertOptions:**
- `conflictColumns`: Columns defining the conflict constraint
- `updateColumns`: Columns to update (default: all except conflictColumns)
- `returning`: Whether to return upserted record(s)

## Helper Functions

### withPlugins

Create a repository with plugins in one step:

```typescript
import { withPlugins } from '@kysera/repository';
import { softDeletePlugin } from '@kysera/soft-delete';

const userRepo = await withPlugins(
  (executor, applyPlugins) => {
    const factory = createRepositoryFactory(executor);
    return factory.create({
      tableName: 'users',
      mapRow: (row) => row,
      schemas: { create: nativeAdapter() },
    });
  },
  db,
  [softDeletePlugin()]
);
```

### createSimpleRepository

Create a repository without schemas (useful for plugins):

```typescript
import { createSimpleRepository } from '@kysera/repository';

const userRepo = createSimpleRepository(
  db,
  'users',
  (row) => row,
  {
    primaryKey: 'id',
    primaryKeyType: 'number',
  }
);
```

### createRepositoriesFactory

Create a bundle of repositories for use in transactions:

```typescript
import { createRepositoriesFactory } from '@kysera/repository';

const createRepositories = createRepositoriesFactory({
  users: (executor) => createUserRepository(executor),
  posts: (executor) => createPostRepository(executor),
  comments: (executor) => createCommentRepository(executor),
});

// Use with database instance
const repos = createRepositories(db);
await repos.users.findById(1);

// Use within transaction
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx);
  await repos.users.create({ name: 'Alice' });
  await repos.posts.create({ userId: 1, title: 'Hello' });
});
```

## Architecture

The repository package architecture in v0.7.0:

```
@kysera/repository
├── createORM
│   └── uses @kysera/executor internally
│       ├── Validates, resolves, and initializes plugins
│       ├── Creates plugin-aware executor (Kysely instance)
│       └── Provides applyPlugins function
├── createRepositoryFactory
│   ├── Creates table operations (selectById, insert, update, etc.)
│   └── Creates base repository (CRUD + pagination + validation)
└── Plugin integration
    ├── interceptQuery: Modifies queries before execution
    └── extendRepository: Adds methods to repository instances
```

**Key design principles:**
- **Unified Execution Layer** - [@kysera/executor](../executor) provides plugin interception for both Repository and DAL
- **Type Safety** - Full TypeScript support with strict typing
- **Plugin Compatibility** - Both `interceptQuery` and `extendRepository` applied to repositories
- **Transaction Support** - Plugins automatically propagate through transactions

## Best Practices

1. **Use createORM for plugin management** - Let [@kysera/executor](../executor) handle plugin lifecycle
2. **Prefer validation** - Use Zod or similar for runtime safety
3. **Use transactions** - Wrap related operations in transactions
4. **Leverage CQRS-lite** - Use Repository for writes, DAL for complex reads
5. **Bulk operations** - Use bulkCreate/bulkUpdate/bulkDelete for efficiency
6. **Cursor pagination** - Prefer cursor-based pagination for large datasets

## Related Packages

- **[@kysera/executor](../executor)** - Plugin execution layer (used internally)
- **[@kysera/dal](../dal)** - Functional Data Access Layer for complex queries
- **[@kysera/soft-delete](../soft-delete)** - Soft delete plugin
- **[@kysera/audit](../audit)** - Audit logging plugin
- **[@kysera/timestamps](../timestamps)** - Automatic timestamp plugin
- **[@kysera/rls](../rls)** - Row-Level Security plugin

## License

MIT
