---
sidebar_position: 8
title: "@kysera/soft-delete"
description: Soft delete plugin API reference
---

# @kysera/soft-delete

Soft delete plugin for Kysera ORM - Mark records as deleted without permanently removing them from the database.

## Installation

```bash
npm install @kysera/soft-delete
```

## Overview

| Metric | Value |
|--------|-------|
| **Version** | 0.6.0 |
| **Bundle Size** | ~4 KB (minified) |
| **Dependencies** | @kysera/core (workspace) |
| **Peer Dependencies** | kysely >=0.28.8, @kysera/repository |

## Exports

```typescript
// Main plugin
export { softDeletePlugin } from './index'

// Types
export type { SoftDeleteOptions, SoftDeleteMethods, SoftDeleteRepository }
```

## softDeletePlugin

Creates a soft delete plugin instance.

```typescript
function softDeletePlugin(options?: SoftDeleteOptions): Plugin
```

### SoftDeleteOptions

```typescript
interface SoftDeleteOptions {
  /**
   * Name of the deleted_at column
   * @default 'deleted_at'
   */
  deletedAtColumn?: string

  /**
   * Include soft-deleted records by default
   * @default false
   */
  includeDeleted?: boolean

  /**
   * List of tables that should have soft delete
   * If not specified, all tables will have soft delete
   */
  tables?: string[]

  /**
   * Name of the primary key column
   * @default 'id'
   */
  primaryKeyColumn?: string

  /**
   * Logger for plugin operations
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

// Include deleted by default
const plugin = softDeletePlugin({
  includeDeleted: true
})
```

## Repository Methods

When a repository is extended by the soft-delete plugin, the following methods are added:

### SoftDeleteMethods Interface

```typescript
interface SoftDeleteMethods<T> {
  // Single record operations
  softDelete(id: number | string): Promise<T>
  restore(id: number | string): Promise<T>
  hardDelete(id: number | string): Promise<boolean>
  findWithDeleted(id: number | string): Promise<T | null>

  // Query methods
  findAllWithDeleted(): Promise<T[]>
  findDeleted(): Promise<T[]>

  // Batch operations
  softDeleteMany(ids: (number | string)[]): Promise<void>
  restoreMany(ids: (number | string)[]): Promise<void>
  hardDeleteMany(ids: (number | string)[]): Promise<number>
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

**Example:**
```typescript
const restoredUser = await userRepo.restore(userId)
console.log(restoredUser.deleted_at) // null
```

### hardDelete

Permanently delete a record from the database.

```typescript
async hardDelete(id: number | string): Promise<boolean>
```

**Parameters:**
- `id` - Primary key of the record

**Returns:** `true` if the record was deleted, `false` if not found

**Example:**
```typescript
const deleted = await userRepo.hardDelete(userId)
if (deleted) {
  console.log('User permanently deleted')
}
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

Soft delete multiple records in a single query.

```typescript
async softDeleteMany(ids: (number | string)[]): Promise<void>
```

**Parameters:**
- `ids` - Array of primary keys

**Example:**
```typescript
await userRepo.softDeleteMany([1, 2, 3, 4, 5])
```

### restoreMany

Restore multiple soft-deleted records in a single query.

```typescript
async restoreMany(ids: (number | string)[]): Promise<void>
```

**Parameters:**
- `ids` - Array of primary keys

**Example:**
```typescript
await userRepo.restoreMany([1, 2, 3])
```

### hardDeleteMany

Permanently delete multiple records in a single query.

```typescript
async hardDeleteMany(ids: (number | string)[]): Promise<number>
```

**Parameters:**
- `ids` - Array of primary keys

**Returns:** Number of records deleted

**Example:**
```typescript
const deletedCount = await userRepo.hardDeleteMany([1, 2, 3])
console.log(`${deletedCount} users permanently deleted`)
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

## Query Interception

The plugin intercepts `select` operations to add the `deleted_at IS NULL` filter:

```typescript
// Plugin implementation (simplified)
interceptQuery(qb, context) {
  if (context.operation === 'select' && !context.metadata['includeDeleted']) {
    return qb.where(deletedAtColumn, 'is', null)
  }
  return qb
}
```

## Usage with createORM

```typescript
import { createORM, createRepositoryFactory } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { z } from 'zod'

const orm = await createORM(db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' })
])

const userRepo = orm.createRepository((executor) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'users',
    mapRow: (row) => ({
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

## Transaction Support

Soft delete operations work with transactions:

```typescript
await db.transaction().execute(async (trx) => {
  const txRepo = userRepo.withTransaction(trx)

  await txRepo.softDelete(1)
  await txRepo.softDeleteMany([2, 3, 4])

  // Both operations commit or roll back together
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
type SoftDeleteRepository<Entity, DB> = Repository<Entity, DB> & SoftDeleteMethods<Entity>
```

### Database Schema Type

```typescript
interface UsersTable {
  id: Generated<number>
  email: string
  name: string
  deleted_at: Date | null  // Must be nullable
}
```

## Performance Considerations

### Batch Operations

Batch operations use efficient single queries:

| Records | Loop Time | Batch Time | Speedup |
|---------|-----------|------------|---------|
| 10 | 200ms | 15ms | 13x |
| 100 | 2000ms | 20ms | 100x |
| 1000 | 20000ms | 50ms | 400x |

### Partial Index (PostgreSQL)

```sql
-- Optimizes queries for active records
CREATE INDEX idx_users_active ON users(id)
WHERE deleted_at IS NULL;
```

## Best Practices

### 1. Use Nullable deleted_at

```typescript
interface UsersTable {
  deleted_at: Date | null  // Must be nullable
}
```

### 2. Handle Cascade Delete

```typescript
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)

  // Soft delete children first
  await repos.posts.softDeleteMany(
    (await repos.posts.find({ where: { user_id: userId } }))
      .map(p => p.id)
  )

  // Then soft delete parent
  await repos.users.softDelete(userId)
})
```

### 3. Clean Up Old Records

```typescript
// Periodically hard delete old soft-deleted records
const cutoffDate = new Date()
cutoffDate.setDate(cutoffDate.getDate() - 90)

await db
  .deleteFrom('users')
  .where('deleted_at', '<', cutoffDate)
  .execute()
```

### 4. Combine with Other Plugins

```typescript
const orm = await createORM(db, [
  softDeletePlugin(),     // Soft delete
  timestampsPlugin(),     // Automatic timestamps
  auditPlugin()           // Audit logging
])
```

## Error Handling

```typescript
try {
  await userRepo.softDelete(userId)
} catch (error) {
  if (error.message.includes('not found')) {
    // Record doesn't exist
  }
}
```

## See Also

- [Soft Delete Plugin Guide](/docs/plugins/soft-delete)
- [@kysera/repository](/docs/api/repository)
- [@kysera/audit](/docs/api/audit)
