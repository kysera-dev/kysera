---
sidebar_position: 8
title: '@kysera/soft-delete'
description: Soft delete plugin API reference
---

# @kysera/soft-delete

Soft delete plugin for Kysera - Mark records as deleted without permanently removing them from the database.

## Installation

```bash
npm install @kysera/soft-delete
```

## Overview

| Metric                | Value                          |
| --------------------- | ------------------------------ |
| **Bundle Size**       | ~4 KB (minified)               |
| **Dependencies**      | @kysera/core, @kysera/executor |
| **Peer Dependencies** | kysely >=0.28.8                |

## Exports

```typescript
// Main plugin
export { softDeletePlugin } from './index'

// Types
export type { SoftDeleteOptions, SoftDeleteMethods, SoftDeleteRepository }

// Zod schema (for kysera-cli)
export { SoftDeleteOptionsSchema }
```

## Architecture

The soft-delete plugin uses the **Unified Execution Layer** (`@kysera/executor`) to work with both **Repository** and **DAL** patterns:

- **Plugin Interface**: Implements the standard `Plugin` interface from `@kysera/executor`
- **Query Interception**: Uses `interceptQuery()` hook to automatically filter soft-deleted records from SELECT queries
- **Repository Extensions**: Uses `extendRepository()` hook to add soft-delete methods to repositories
- **Raw Database Access**: Uses `getRawDb()` from executor to bypass interceptors when needed

### How It Works

1. The executor wraps Kysely with a Proxy that intercepts `.selectFrom()` calls
2. When a SELECT query is built, the plugin's `interceptQuery()` is called
3. The plugin adds `WHERE deleted_at IS NULL` to the query builder
4. The filtered query is executed
5. This works in **both Repository and DAL patterns** automatically

## softDeletePlugin

Creates a soft delete plugin instance.

```typescript
function softDeletePlugin(options?: SoftDeleteOptions): Plugin
```

### SoftDeleteOptions

```typescript
interface SoftDeleteOptions {
  /**
   * Column name for soft delete timestamp.
   * @default 'deleted_at'
   */
  deletedAtColumn?: string

  /**
   * Include soft-deleted records by default in queries.
   * When false, soft-deleted records are automatically filtered out.
   * @default false
   */
  includeDeleted?: boolean

  /**
   * List of tables that support soft delete.
   * If not provided, all tables are assumed to support it.
   * @example ['users', 'posts', 'comments']
   */
  tables?: string[]

  /**
   * Primary key column name used for identifying records.
   * Tables with different primary key names can be configured.
   * @default 'id'
   * @example 'uuid', 'user_id', 'post_id'
   */
  primaryKeyColumn?: string

  /**
   * Logger for plugin operations.
   * Uses KyseraLogger interface from @kysera/core.
   * @default silentLogger
   */
  logger?: KyseraLogger
}
```

### Configuration Examples

```typescript
import { softDeletePlugin } from '@kysera/soft-delete'

// Default configuration
const plugin = softDeletePlugin()

// Custom column name
const plugin = softDeletePlugin({
  deletedAtColumn: 'removed_at'
})

// UUID primary key
const plugin = softDeletePlugin({
  primaryKeyColumn: 'uuid'
})

// Only specific tables
const plugin = softDeletePlugin({
  tables: ['users', 'posts', 'comments']
})

// Include deleted by default (not recommended)
const plugin = softDeletePlugin({
  includeDeleted: true
})

// Custom logger
import { createLogger } from '@kysera/core'
const plugin = softDeletePlugin({
  logger: createLogger({ level: 'debug' })
})
```

## Repository Pattern

When used with `@kysera/repository`, the plugin extends repositories with additional methods.

### Setup with Repository

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [
  softDeletePlugin({
    deletedAtColumn: 'deleted_at',
    tables: ['users', 'posts']
  })
])

const userRepo = orm.createRepository(createUserRepository)

// Automatic filtering - findAll excludes soft-deleted
const activeUsers = await userRepo.findAll()

// Soft delete operations
await userRepo.softDelete(userId)
await userRepo.restore(userId)
```

### SoftDeleteMethods Interface

Repositories are extended with these methods:

```typescript
interface SoftDeleteMethods<T> {
  // Single record operations
  softDelete(id: number | string): Promise<T>
  restore(id: number | string): Promise<T>
  hardDelete(id: number | string): Promise<void>
  findWithDeleted(id: number | string): Promise<T | null>

  // Query methods
  findAllWithDeleted(): Promise<T[]>
  findDeleted(): Promise<T[]>

  // Bulk operations
  softDeleteMany(ids: (number | string)[]): Promise<T[]>
  restoreMany(ids: (number | string)[]): Promise<T[]>
  hardDeleteMany(ids: (number | string)[]): Promise<void>
}
```

### softDelete

Soft delete a record by setting the `deleted_at` timestamp.

```typescript
async softDelete(id: number | string): Promise<T>
```

**Parameters:**

- `id` - Primary key of the record

**Returns:** The soft-deleted record with `deleted_at` set

**Throws:** `NotFoundError` if record doesn't exist

**Example:**

```typescript
const deletedUser = await userRepo.softDelete(userId)
console.log(deletedUser.deleted_at) // Date timestamp
```

### restore

Restore a soft-deleted record by clearing the `deleted_at` timestamp.

```typescript
async restore(id: number | string): Promise<T>
```

**Parameters:**

- `id` - Primary key of the record

**Returns:** The restored record with `deleted_at` set to null

**Throws:** `NotFoundError` if record doesn't exist

**Example:**

```typescript
const restoredUser = await userRepo.restore(userId)
console.log(restoredUser.deleted_at) // null
```

### hardDelete

Permanently delete a record from the database (bypasses soft delete).

```typescript
async hardDelete(id: number | string): Promise<void>
```

**Parameters:**

- `id` - Primary key of the record

**Example:**

```typescript
await userRepo.hardDelete(userId)
// Record is permanently removed from database
```

### findWithDeleted

Find a record by ID including soft-deleted records.

```typescript
async findWithDeleted(id: number | string): Promise<T | null>
```

**Parameters:**

- `id` - Primary key of the record

**Returns:** The record or `null` if not found

**Example:**

```typescript
// Regular findById excludes soft-deleted
const user = await userRepo.findById(userId) // null if soft-deleted

// findWithDeleted includes soft-deleted
const user = await userRepo.findWithDeleted(userId) // Returns even if soft-deleted
```

### findAllWithDeleted

Find all records including soft-deleted ones.

```typescript
async findAllWithDeleted(): Promise<T[]>
```

**Returns:** Array of all records including soft-deleted

**Example:**

```typescript
// Regular findAll excludes soft-deleted
const activeUsers = await userRepo.findAll()

// findAllWithDeleted includes soft-deleted
const allUsers = await userRepo.findAllWithDeleted()
```

### findDeleted

Find only soft-deleted records.

```typescript
async findDeleted(): Promise<T[]>
```

**Returns:** Array of soft-deleted records only

**Example:**

```typescript
const deletedUsers = await userRepo.findDeleted()
console.log(`${deletedUsers.length} users in trash`)
```

### softDeleteMany

Soft delete multiple records in a single query (bulk operation).

```typescript
async softDeleteMany(ids: (number | string)[]): Promise<T[]>
```

**Parameters:**

- `ids` - Array of primary keys

**Returns:** Array of soft-deleted records

**Throws:** `NotFoundError` if any record doesn't exist

**Example:**

```typescript
const deleted = await userRepo.softDeleteMany([1, 2, 3, 4, 5])
console.log(`Soft-deleted ${deleted.length} users`)
```

### restoreMany

Restore multiple soft-deleted records in a single query (bulk operation).

```typescript
async restoreMany(ids: (number | string)[]): Promise<T[]>
```

**Parameters:**

- `ids` - Array of primary keys

**Returns:** Array of restored records

**Example:**

```typescript
const restored = await userRepo.restoreMany([1, 2, 3])
console.log(`Restored ${restored.length} users`)
```

### hardDeleteMany

Permanently delete multiple records in a single query (bulk operation).

```typescript
async hardDeleteMany(ids: (number | string)[]): Promise<void>
```

**Parameters:**

- `ids` - Array of primary keys

**Example:**

```typescript
await userRepo.hardDeleteMany([1, 2, 3])
// Records are permanently removed from database
```

## DAL Pattern

The plugin works seamlessly with `@kysera/dal` through the unified executor layer.

### Setup with DAL

```typescript
import { createQuery, createContext, withTransaction } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin({ deletedAtColumn: 'deleted_at' })])

// DAL queries automatically get soft-delete filters
const getUser = createQuery((ctx, id: string) =>
  ctx.db.selectFrom('users').where('id', '=', id).selectAll().executeTakeFirst()
)

// Create context from executor
const ctx = createContext(executor)

// Query automatically excludes soft-deleted records
const user = await getUser(ctx, '1')
```

### Transaction Support (DAL)

Plugins are automatically propagated to transactions:

```typescript
await withTransaction(executor, async txCtx => {
  // All queries in transaction have soft-delete filter applied
  const user = await getUser(txCtx, userId)
  const posts = await getUserPosts(txCtx, userId)

  // Both queries automatically filter soft-deleted records
})
```

### Bypassing Filters (DAL)

To bypass soft-delete filters in DAL queries, use `getRawDb()`:

```typescript
import { getRawDb } from '@kysera/executor'

const getAllUsers = createQuery(ctx => {
  const rawDb = getRawDb(ctx.db)

  // This query includes soft-deleted records
  return rawDb.selectFrom('users').selectAll().execute()
})
```

## CQRS-lite Pattern

Combine Repository (writes) and DAL (reads) with shared plugins:

```typescript
import { createORM } from '@kysera/repository'
import { createQuery, createContext } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])

// Repository for writes
const userRepo = orm.createRepository(createUserRepository)

// DAL for complex reads
const getDashboardStats = createQuery((ctx, userId: string) =>
  ctx.db
    .selectFrom('users')
    .leftJoin('posts', 'users.id', 'posts.user_id')
    .where('users.id', '=', userId)
    .select(['users.id', 'users.name', sql<number>`count(posts.id)`.as('post_count')])
    .groupBy('users.id')
    .executeTakeFirst()
)

// Use together in transaction (same plugins!)
await orm.transaction(async ctx => {
  // Repository write
  const user = await userRepo.create({ name: 'Alice' })

  // DAL read - both respect soft-delete plugin
  const stats = await getDashboardStats(ctx, user.id)
})
```

## Automatic Query Filtering

The plugin automatically filters out soft-deleted records from SELECT queries:

```typescript
// This query automatically adds WHERE deleted_at IS NULL
const users = await userRepo.findAll()

// Equivalent SQL:
// SELECT * FROM users WHERE deleted_at IS NULL

// To include soft-deleted records:
const allUsers = await userRepo.findAllWithDeleted()
// SELECT * FROM users
```

## Query Interception Implementation

The plugin uses `interceptQuery()` from the `@kysera/executor` Plugin interface:

```typescript
// Simplified plugin implementation
{
  name: '@kysera/soft-delete',
  version: '0.7.0',

  interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
    // Only filter SELECT queries when not explicitly including deleted
    if (
      context.operation === 'select' &&
      !context.metadata['includeDeleted'] &&
      !includeDeleted
    ) {
      return qb.where(`${context.table}.${deletedAtColumn}`, 'is', null)
    }
    return qb
  },

  extendRepository<T>(repo: T): T {
    // Add softDelete, restore, hardDelete methods...
  }
}
```

**How it works:**

1. `createExecutor` wraps Kysely with a Proxy
2. When `.selectFrom()` is called, the plugin's `interceptQuery()` hook is invoked
3. The filter `WHERE deleted_at IS NULL` is applied to the query builder
4. The modified query is executed
5. Works in **both Repository and DAL patterns** automatically

## Method Override Pattern

**IMPORTANT**: This plugin uses the **Method Override** pattern, not full query interception:

- ✅ **SELECT queries** are automatically filtered to exclude soft-deleted records
- ❌ **DELETE operations** are NOT automatically converted to soft deletes
- ✅ Use `softDelete()` method explicitly instead of `delete()`
- ✅ Use `hardDelete()` method to bypass soft delete and perform a real DELETE

This design is intentional for simplicity and explicitness.

```typescript
// ❌ WRONG - delete() does NOT soft delete
await userRepo.delete(userId) // Permanently deletes!

// ✅ CORRECT - use softDelete()
await userRepo.softDelete(userId) // Sets deleted_at

// ✅ CORRECT - use hardDelete() for permanent deletion
await userRepo.hardDelete(userId) // Permanently deletes
```

## Transaction Support

Soft delete operations respect ACID properties and work correctly with transactions.

### Repository Pattern Transactions

```typescript
await db.transaction().execute(async trx => {
  const txORM = createORM(trx, [softDeletePlugin()])
  const txRepo = txORM.createRepository(createUserRepository)

  await txRepo.softDelete(1)
  await txRepo.softDeleteMany([2, 3, 4])

  // Both operations commit or roll back together
})
```

### DAL Pattern Transactions

```typescript
await withTransaction(executor, async txCtx => {
  // All queries in transaction have soft-delete filter applied
  const user = await getUser(txCtx, userId)

  // Soft-delete filter is automatically applied
  const posts = await getUserPosts(txCtx, userId)
})
```

### Cascade Soft Delete Pattern

For related entities, manually implement cascade soft delete:

```typescript
await db.transaction().execute(async trx => {
  const repos = createRepositories(trx)
  const userId = 123

  // First, soft delete child records
  const userPosts = await repos.posts.findBy({ user_id: userId })
  await repos.posts.softDeleteMany(userPosts.map(p => p.id))

  // Then, soft delete parent
  await repos.users.softDelete(userId)
})
```

## getRawDb() - Bypassing Interceptors

The `getRawDb()` function from `@kysera/executor` allows you to bypass plugin interceptors:

```typescript
import { getRawDb } from '@kysera/executor'

// In repository extension methods
const extendedRepo = {
  async findAllWithDeleted(): Promise<T[]> {
    // Use rawDb to bypass soft-delete filter
    const rawDb = getRawDb(baseRepo.executor)
    return await rawDb.selectFrom(baseRepo.tableName).selectAll().execute()
  }
}

// In DAL queries
const getAllUsersIncludingDeleted = createQuery(ctx => {
  const rawDb = getRawDb(ctx.db)
  return rawDb.selectFrom('users').selectAll().execute()
})
```

## Database Schema

Ensure your tables have the `deleted_at` column:

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
```

## TypeScript Types

### SoftDeleteRepository

```typescript
type SoftDeleteRepository<Entity> = Repository<Entity> & SoftDeleteMethods<Entity>
```

### Database Schema Type

```typescript
interface UsersTable {
  id: Generated<number>
  email: string
  name: string
  deleted_at: Date | null // Must be nullable
}
```

### Plugin Type

```typescript
const plugin: Plugin = softDeletePlugin({
  deletedAtColumn: 'deleted_at',
  tables: ['users', 'posts']
})
```

## Performance Considerations

### Batch Operations

Batch operations use efficient single queries:

| Records | Loop Time | Batch Time | Speedup |
| ------- | --------- | ---------- | ------- |
| 10      | 200ms     | 15ms       | 13x     |
| 100     | 2000ms    | 20ms       | 100x    |
| 1000    | 20000ms   | 50ms       | 400x    |

### Partial Index (PostgreSQL)

```sql
-- Optimizes queries for active records
CREATE INDEX idx_users_active ON users(id)
WHERE deleted_at IS NULL;
```

### Query Performance

The soft-delete filter adds minimal overhead:

```typescript
// Automatic filter adds WHERE clause
SELECT * FROM users WHERE deleted_at IS NULL

// With index, this is very fast (index-only scan)
```

## Best Practices

### 1. Use Nullable deleted_at

```typescript
interface UsersTable {
  deleted_at: Date | null // ✅ Must be nullable
}
```

### 2. Handle Cascade Delete

```typescript
await db.transaction().execute(async trx => {
  const repos = createRepos(trx)

  // Soft delete children first
  const posts = await repos.posts.find({ where: { user_id: userId } })
  await repos.posts.softDeleteMany(posts.map(p => p.id))

  // Then soft delete parent
  await repos.users.softDelete(userId)
})
```

### 3. Clean Up Old Records

```typescript
// Periodically hard delete old soft-deleted records
const cutoffDate = new Date()
cutoffDate.setDate(cutoffDate.getDate() - 90)

await db.deleteFrom('users').where('deleted_at', '<', cutoffDate).execute()
```

### 4. Combine with Other Plugins

```typescript
const orm = await createORM(db, [
  softDeletePlugin(), // Soft delete
  timestampsPlugin(), // Automatic timestamps
  auditPlugin() // Audit logging
])
```

### 5. Use Explicit Methods

```typescript
// ❌ WRONG - delete() does NOT soft delete
await userRepo.delete(userId)

// ✅ CORRECT - use softDelete() explicitly
await userRepo.softDelete(userId)

// ✅ CORRECT - use hardDelete() for permanent deletion
await userRepo.hardDelete(userId)
```

## Error Handling

```typescript
import { NotFoundError } from '@kysera/core'

try {
  await userRepo.softDelete(userId)
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error('User not found:', error.context.id)
  }
}
```

## Complete Examples

### Repository Pattern Example

```typescript
import { createORM, createRepositoryFactory } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { z } from 'zod'

const orm = await createORM(db, [softDeletePlugin({ deletedAtColumn: 'deleted_at' })])

const userRepo = orm.createRepository(executor => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'users',
    mapRow: row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      deletedAt: row.deleted_at
    }),
    schemas: {
      create: z.object({
        email: z.string().email(),
        name: z.string()
      })
    }
  })
})

// Soft delete
await userRepo.softDelete(userId)

// Restore
await userRepo.restore(userId)

// Find all (excludes deleted)
const activeUsers = await userRepo.findAll()

// Find all including deleted
const allUsers = await userRepo.findAllWithDeleted()
```

### DAL Pattern Example

```typescript
import { createQuery, createContext, withTransaction } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugin
const executor = await createExecutor(db, [softDeletePlugin({ deletedAtColumn: 'deleted_at' })])

// Define queries
const getActiveUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())

const getAllUsers = createQuery(ctx => {
  const rawDb = getRawDb(ctx.db)
  return rawDb.selectFrom('users').selectAll().execute()
})

// Execute queries
const ctx = createContext(executor)
const activeUsers = await getActiveUsers(ctx) // Excludes soft-deleted
const allUsers = await getAllUsers(ctx) // Includes soft-deleted
```

### CQRS-lite Example

```typescript
import { createORM } from '@kysera/repository'
import { createQuery } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])

const getDashboardStats = createQuery((ctx, userId: string) =>
  ctx.db
    .selectFrom('users')
    .leftJoin('posts', 'users.id', 'posts.user_id')
    .where('users.id', '=', userId)
    .select(['users.id', 'users.name', sql<number>`count(posts.id)`.as('post_count')])
    .groupBy('users.id')
    .executeTakeFirst()
)

await orm.transaction(async ctx => {
  // Repository for writes
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create({ name: 'Alice' })

  // DAL for complex reads (same transaction, same plugins)
  const stats = await getDashboardStats(ctx, user.id)
})
```

## See Also

- [Soft Delete Plugin Guide](/docs/plugins/soft-delete)
- [@kysera/executor](/docs/api/executor) - Unified Execution Layer
- [@kysera/repository](/docs/api/repository) - Repository Pattern
- [@kysera/dal](/docs/api/dal) - Data Access Layer
- [@kysera/audit](/docs/api/audit) - Audit Logging
