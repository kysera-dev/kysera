---
sidebar_position: 2
title: Soft Delete
description: Soft delete plugin for Kysera
---

# Soft Delete Plugin

Mark records as deleted without permanently removing them from the database. Soft-delete filtering works automatically with both **Repository** and **DAL** patterns through the unified `@kysera/executor` layer.

## Installation

```bash
npm install @kysera/soft-delete
```

## Quick Start

### Repository Pattern

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin({ deletedAtColumn: 'deleted_at' })])

const userRepo = orm.createRepository(createUserRepository)

// Soft delete (sets deleted_at timestamp)
await userRepo.softDelete(userId)

// Find only active users (automatic filtering)
const activeUsers = await userRepo.findAll()

// Find including deleted
const allUsers = await userRepo.findAllWithDeleted()

// Restore a soft-deleted user
await userRepo.restore(userId)

// Permanently delete
await userRepo.hardDelete(userId)
```

### DAL Pattern

```typescript
import { createQuery, createContext } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with soft-delete plugin
const executor = await createExecutor(db, [softDeletePlugin({ deletedAtColumn: 'deleted_at' })])

// DAL queries automatically filter soft-deleted records
const getActiveUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())

const ctx = createContext(executor)
const activeUsers = await getActiveUsers(ctx) // Excludes soft-deleted

// Per-query override with metadata
const getAllUsers = createQuery(ctx => {
  const qb = ctx.db.selectFrom('users').selectAll()
  // @ts-expect-error - metadata is not typed yet
  qb.__queryContext = { ...qb.__queryContext, metadata: { includeDeleted: true } }
  return qb.execute()
})
```

## Configuration

All options are optional with sensible defaults:

```typescript
interface SoftDeleteOptions {
  /**
   * Column name for soft delete timestamp
   * @default 'deleted_at'
   */
  deletedAtColumn?: string

  /**
   * Include deleted records by default in queries
   * When false, soft-deleted records are automatically filtered out
   * @default false
   */
  includeDeleted?: boolean

  /**
   * List of tables that support soft delete
   * If not provided, all tables are assumed to support it
   * @example ['users', 'posts', 'comments']
   */
  tables?: string[]

  /**
   * Primary key column name used for identifying records
   * @default 'id'
   * @example 'uuid', 'user_id', 'post_id'
   */
  primaryKeyColumn?: string

  /**
   * Logger for plugin operations
   * @default silentLogger (no output)
   */
  logger?: KyseraLogger
}
```

### Configuration Examples

```typescript
// Custom deleted column name
softDeletePlugin({ deletedAtColumn: 'removed_at' })

// UUID primary key
softDeletePlugin({ primaryKeyColumn: 'uuid' })

// Table whitelist (only these tables support soft delete)
softDeletePlugin({ tables: ['users', 'posts', 'comments'] })

// Include deleted by default (requires explicit filtering)
softDeletePlugin({ includeDeleted: true })

// Enable logging
import { consoleLogger } from '@kysera/core'
softDeletePlugin({ logger: consoleLogger })
```

## Repository Extensions

The plugin adds the following methods to repositories created with `@kysera/repository`:

### Single Record Operations

```typescript
interface SoftDeleteMethods<T> {
  softDelete(id: number | string): Promise<T>
  restore(id: number | string): Promise<T>
  hardDelete(id: number | string): Promise<void>
  findWithDeleted(id: number | string): Promise<T | null>
}
```

| Method                | Description                              | Returns             | Throws                                  |
| --------------------- | ---------------------------------------- | ------------------- | --------------------------------------- |
| `softDelete(id)`      | Sets deleted_at to CURRENT_TIMESTAMP     | Soft-deleted record | `NotFoundError` if record doesn't exist |
| `restore(id)`         | Sets deleted_at to NULL                  | Restored record     | `NotFoundError` if record doesn't exist |
| `hardDelete(id)`      | Permanently deletes record (real DELETE) | void                | N/A                                     |
| `findWithDeleted(id)` | Finds by ID including soft-deleted       | Record or null      | N/A                                     |

### Batch Operations

```typescript
interface SoftDeleteMethods<T> {
  softDeleteMany(ids: (number | string)[]): Promise<T[]>
  restoreMany(ids: (number | string)[]): Promise<T[]>
  hardDeleteMany(ids: (number | string)[]): Promise<void>
}
```

| Method                | Description                          | Returns                       | Throws                                      |
| --------------------- | ------------------------------------ | ----------------------------- | ------------------------------------------- |
| `softDeleteMany(ids)` | Soft deletes multiple records        | Array of soft-deleted records | `NotFoundError` if any record doesn't exist |
| `restoreMany(ids)`    | Restores multiple records            | Array of restored records     | N/A                                         |
| `hardDeleteMany(ids)` | Permanently deletes multiple records | void                          | N/A                                         |

### Query Methods

```typescript
interface SoftDeleteMethods<T> {
  findAllWithDeleted(): Promise<T[]>
  findDeleted(): Promise<T[]>
}
```

| Method                 | Description                                       | Returns                      |
| ---------------------- | ------------------------------------------------- | ---------------------------- |
| `findAll()`            | Returns only active records (automatic filtering) | Array of non-deleted records |
| `findById(id)`         | Returns only if not deleted (automatic filtering) | Record or null               |
| `findAllWithDeleted()` | Returns all records including soft-deleted        | Array of all records         |
| `findDeleted()`        | Returns only soft-deleted records                 | Array of deleted records     |

## Automatic Query Filtering

SELECT queries automatically exclude soft-deleted records in both Repository and DAL patterns:

```typescript
// Repository pattern - automatic filtering
const users = await userRepo.findAll()
// SQL: SELECT * FROM users WHERE deleted_at IS NULL

// DAL pattern - automatic filtering
const getUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())
const users = await getUsers(ctx)
// SQL: SELECT * FROM users WHERE deleted_at IS NULL
```

### How It Works

The plugin uses query interception from `@kysera/executor`:

1. `createORM` or `createExecutor` wraps Kysely with a plugin-aware executor
2. The executor intercepts `.selectFrom()` calls using a Proxy
3. When a SELECT query is built, `interceptQuery()` is called for each plugin
4. The soft-delete plugin adds `WHERE deleted_at IS NULL` to the query builder
5. The filtered query is executed

**This works automatically in both Repository and DAL patterns.**

### Filtering Behavior

| Query Type | Filtered? | Notes                                |
| ---------- | --------- | ------------------------------------ |
| SELECT     | ✅ Yes    | Automatic `WHERE deleted_at IS NULL` |
| INSERT     | ❌ No     | Inserts are not affected             |
| UPDATE     | ❌ No     | Updates are not affected             |
| DELETE     | ❌ No     | Use `softDelete()` method instead    |

**Important**: DELETE operations are NOT automatically converted to soft deletes. This is by design for simplicity and explicitness. Use the `softDelete()` method to perform soft deletes.

## Usage Examples

### Repository Pattern Examples

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])
const userRepo = orm.createRepository(createUserRepository)

// Single operations
await userRepo.softDelete(userId)
await userRepo.restore(userId)
await userRepo.hardDelete(userId)

// Batch operations (efficient single queries)
await userRepo.softDeleteMany([1, 2, 3, 4, 5]) // Single UPDATE
await userRepo.restoreMany([1, 2, 3]) // Single UPDATE
await userRepo.hardDeleteMany([1, 2, 3]) // Single DELETE

// Query methods
const active = await userRepo.findAll() // Excludes deleted
const all = await userRepo.findAllWithDeleted() // Includes deleted
const deleted = await userRepo.findDeleted() // Only deleted
const user = await userRepo.findWithDeleted(id) // Find by ID including deleted
```

### DAL Pattern Examples

```typescript
import { createQuery, createContext, withTransaction } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { getRawDb } from '@kysera/executor'

const executor = await createExecutor(db, [softDeletePlugin()])

// Automatic filtering
const getActiveUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())
const users = await getActiveUsers(executor) // Filtered automatically

// Include deleted with getRawDb
const getAllUsers = createQuery(ctx => {
  const rawDb = getRawDb(ctx.db)
  return rawDb.selectFrom('users').selectAll().execute()
})
const allUsers = await getAllUsers(executor) // No filtering

// Manual soft delete in DAL
const softDeleteUser = createQuery((ctx, userId: number) =>
  ctx.db.updateTable('users').set({ deleted_at: new Date() }).where('id', '=', userId).execute()
)

// Restore in DAL
const restoreUser = createQuery((ctx, userId: number) =>
  ctx.db.updateTable('users').set({ deleted_at: null }).where('id', '=', userId).execute()
)
```

### Combined Pattern (CQRS-lite)

````typescript
import { createORM } from '@kysera/repository'
import { createQuery } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])

// Repository for writes
const userRepo = orm.createRepository(createUserRepository)

// DAL for reads
const getUserStats = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('users')
    .leftJoin('posts', 'posts.user_id', 'users.id')
    .select([
      'users.id',
      'users.name',
      db.fn.count('posts.id').as('post_count')
    ])
    .where('users.id', '=', userId)
    .groupBy('users.id')
    .executeTakeFirst()
)

// Use in transaction
await orm.transaction(async (ctx) => {
  // Write with repository
  const user = await userRepo.create({ name: 'Alice' })

  // Read with DAL (same transaction, same plugins)
  const stats = await getUserStats(ctx, user.id)

  // Soft delete with repository
  await userRepo.softDelete(user.id)
})

## Database Schema

Ensure your tables have the deleted_at column:

```sql
-- PostgreSQL
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL;
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NULL;

-- MySQL
ALTER TABLE users ADD COLUMN deleted_at DATETIME DEFAULT NULL;
CREATE INDEX idx_users_deleted_at ON users(deleted_at);

-- SQLite
ALTER TABLE users ADD COLUMN deleted_at TEXT DEFAULT NULL;
CREATE INDEX idx_users_deleted_at ON users(deleted_at);
````

## Transaction Support

Soft delete operations respect ACID properties and work correctly with transactions.

### Repository Pattern

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])

await orm.transaction(async ctx => {
  const userRepo = orm.createRepository(createUserRepository)
  const postRepo = orm.createRepository(createPostRepository)

  // All operations in transaction
  await userRepo.softDelete(userId)
  await postRepo.softDeleteMany([1, 2, 3])

  // If transaction fails, all operations roll back
})
```

### DAL Pattern

```typescript
import { withTransaction } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

const executor = await createExecutor(db, [softDeletePlugin()])

await withTransaction(executor, async txCtx => {
  // All queries in transaction have soft-delete filter applied
  const user = await getUser(txCtx, userId)
  const posts = await getUserPosts(txCtx, userId)

  // Manual soft delete in transaction
  await txCtx.db
    .updateTable('users')
    .set({ deleted_at: new Date() })
    .where('id', '=', userId)
    .execute()

  // If transaction fails, all operations roll back
})
```

### Cascade Soft Delete

For related entities, manually implement cascade soft delete:

```typescript
await orm.transaction(async ctx => {
  const userRepo = orm.createRepository(createUserRepository)
  const postRepo = orm.createRepository(createPostRepository)

  // 1. Find child records
  const userPosts = await postRepo.findBy({ user_id: userId })

  // 2. Soft delete children
  await postRepo.softDeleteMany(userPosts.map(p => p.id))

  // 3. Soft delete parent
  await userRepo.softDelete(userId)

  // All operations commit or roll back together
})
```

**Plugins are automatically propagated to transactions**, so soft-delete filtering works correctly in both patterns.

## Per-Query Override

You can override the soft-delete filter on a per-query basis using metadata.

### Using Metadata (Advanced)

```typescript
import { createQuery } from '@kysera/dal'

const getAllUsersIncludingDeleted = createQuery(ctx => {
  const qb = ctx.db.selectFrom('users').selectAll()

  // Override soft-delete filter for this query
  // @ts-expect-error - metadata is not typed yet
  qb.__queryContext = {
    ...qb.__queryContext,
    metadata: { includeDeleted: true }
  }

  return qb.execute()
})
```

### Using getRawDb (Recommended)

For better type safety, use `getRawDb()` to bypass all plugin interceptors:

```typescript
import { getRawDb } from '@kysera/executor'
import { createQuery } from '@kysera/dal'

const getAllUsers = createQuery(ctx => {
  // Get raw Kysely instance without plugin interception
  const rawDb = getRawDb(ctx.db)
  return rawDb.selectFrom('users').selectAll().execute()
})
```

## Best Practices

### 1. Schema Design

Always use nullable `deleted_at` columns:

```typescript
interface UsersTable {
  id: Generated<number>
  email: string
  deleted_at: Date | null // Must be nullable
}
```

### 2. Database Indexes

Create partial indexes for active records (PostgreSQL):

```sql
-- Index only active records
CREATE INDEX idx_users_active ON users(id)
WHERE deleted_at IS NULL;

-- Composite index with deleted_at
CREATE INDEX idx_users_email_active ON users(email)
WHERE deleted_at IS NULL;
```

For MySQL and SQLite, use regular indexes:

```sql
CREATE INDEX idx_users_deleted_at ON users(deleted_at);
```

### 3. Periodic Cleanup

Hard delete old soft-deleted records to prevent table bloat:

```typescript
import { createQuery } from '@kysera/dal'
import { getRawDb } from '@kysera/executor'

const cleanupOldDeleted = createQuery(async (ctx, daysOld: number) => {
  const rawDb = getRawDb(ctx.db)
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  await rawDb
    .deleteFrom('users')
    .where('deleted_at', '<', cutoffDate)
    .where('deleted_at', 'is not', null)
    .execute()
})

// Delete records soft-deleted more than 90 days ago
await cleanupOldDeleted(ctx, 90)
```

### 4. Cascade Operations

Implement cascade soft delete for related entities:

```typescript
await orm.transaction(async ctx => {
  const userRepo = orm.createRepository(createUserRepository)
  const postRepo = orm.createRepository(createPostRepository)
  const commentRepo = orm.createRepository(createCommentRepository)

  // Get all related records
  const posts = await postRepo.findBy({ user_id: userId })
  const comments = await commentRepo.findBy({ user_id: userId })

  // Soft delete in order: children first, then parent
  await commentRepo.softDeleteMany(comments.map(c => c.id))
  await postRepo.softDeleteMany(posts.map(p => p.id))
  await userRepo.softDelete(userId)
})
```

### 5. Unique Constraints

Handle unique constraints with soft-deleted records:

```sql
-- PostgreSQL: Partial unique index (excludes deleted)
CREATE UNIQUE INDEX idx_users_email_unique ON users(email)
WHERE deleted_at IS NULL;

-- MySQL/SQLite: Use composite unique constraint
-- This allows duplicate emails if one is soft-deleted
ALTER TABLE users ADD CONSTRAINT unique_active_email
  UNIQUE (email, deleted_at);
```

## Schema Validation (Optional)

The soft-delete plugin optionally supports Zod schema validation for configuration:

```typescript
import { SoftDeleteOptionsSchema } from '@kysera/soft-delete/schema'
import { z } from 'zod'

// Validate configuration
const config = SoftDeleteOptionsSchema.parse({
  deletedAtColumn: 'deleted_at',
  includeDeleted: false,
  tables: ['users', 'posts']
})
```

:::tip
The main `@kysera/soft-delete` package works without Zod installed. Only import from `/schema` if you need runtime validation.
:::

## Architecture

The soft-delete plugin uses the unified `@kysera/executor` layer:

### Plugin Interface

The plugin implements the standard `Plugin` interface from `@kysera/executor`:

```typescript
interface Plugin {
  name: string
  version: string
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB
  extendRepository?<T>(repo: T): T
}
```

### How It Works

1. **Query Interception**: The `interceptQuery()` hook adds `WHERE deleted_at IS NULL` to SELECT queries
2. **Repository Extensions**: The `extendRepository()` hook adds soft-delete methods (softDelete, restore, etc.)
3. **Raw Database Access**: Internal methods use `getRawDb()` to bypass interceptors
4. **Cross-Pattern Support**: Works with both Repository and DAL patterns

### Method Override Pattern

**IMPORTANT**: This plugin uses the **Method Override** pattern, not full query interception:

| Operation             | Behavior                                            |
| --------------------- | --------------------------------------------------- |
| ✅ SELECT queries     | Automatically filtered (`WHERE deleted_at IS NULL`) |
| ❌ DELETE operations  | NOT converted to soft deletes                       |
| ✅ Repository methods | Extended with `softDelete()`, `restore()`, etc.     |
| ✅ Hard delete        | Use `hardDelete()` method for real DELETE           |

**This design is intentional for simplicity and explicitness.** Users must explicitly call `softDelete()` instead of `delete()` to perform soft deletes.

### Performance Characteristics

- **SELECT overhead**: Minimal (adds one WHERE clause)
- **Batch operations**: Single query for multiple records
- **Index support**: Partial indexes recommended (PostgreSQL)
- **Transaction support**: Full ACID compliance

## See Also

- [Plugin Overview](/docs/plugins/overview)
- [Plugin Authoring Guide](/docs/plugins/authoring-guide)
- [@kysera/soft-delete API Reference](/docs/api/soft-delete)
- [@kysera/executor API Reference](/docs/api/executor)
- [@kysera/dal API Reference](/docs/api/dal)
