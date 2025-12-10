---
sidebar_position: 2
title: Soft Delete
description: Soft delete plugin for Kysera
---

# Soft Delete Plugin

Mark records as deleted without permanently removing them from the database.

## Installation

```bash
npm install @kysera/soft-delete
```

## Basic Usage

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [
  softDeletePlugin({
    deletedAtColumn: 'deleted_at'
  })
])

const userRepo = orm.createRepository((executor) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({ tableName: 'users', /* ... */ })
})

// Soft delete a user
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

## Configuration

```typescript
interface SoftDeleteOptions {
  deletedAtColumn?: string       // Default: 'deleted_at'
  includeDeleted?: boolean       // Default: false
  tables?: string[]              // Only these tables (whitelist)
  primaryKeyColumn?: string      // Default: 'id'
  logger?: KyseraLogger
}
```

### Examples

```typescript
// Custom column name
softDeletePlugin({ deletedAtColumn: 'removed_at' })

// UUID primary key
softDeletePlugin({ primaryKeyColumn: 'uuid' })

// Only specific tables
softDeletePlugin({ tables: ['users', 'posts', 'comments'] })

// Include deleted by default
softDeletePlugin({ includeDeleted: true })
```

## Added Methods

### Single Record Operations

| Method | Description |
|--------|-------------|
| `softDelete(id)` | Set deleted_at timestamp |
| `restore(id)` | Clear deleted_at (restore record) |
| `hardDelete(id)` | Permanently delete record |
| `findWithDeleted(id)` | Find by ID including deleted |

### Query Methods

| Method | Description |
|--------|-------------|
| `findAll()` | Returns only active records (automatic) |
| `findById(id)` | Returns only if not deleted (automatic) |
| `findAllWithDeleted()` | Returns all records including deleted |
| `findDeleted()` | Returns only soft-deleted records |

### Batch Operations

| Method | Description |
|--------|-------------|
| `softDeleteMany(ids)` | Soft delete multiple records |
| `restoreMany(ids)` | Restore multiple records |
| `hardDeleteMany(ids)` | Permanently delete multiple records |

## Automatic Query Filtering

SELECT queries automatically exclude soft-deleted records:

```typescript
// This query automatically adds WHERE deleted_at IS NULL
const users = await userRepo.findAll()

// Equivalent to:
const users = await db
  .selectFrom('users')
  .where('deleted_at', 'is', null)
  .selectAll()
  .execute()
```

## Batch Operations

Batch operations use efficient single queries:

```typescript
// Single UPDATE query for all IDs
await userRepo.softDeleteMany([1, 2, 3, 4, 5])

// Single UPDATE query
await userRepo.restoreMany([1, 2, 3])

// Single DELETE query
await userRepo.hardDeleteMany([1, 2, 3])
```

### Performance

| Records | Loop Time | Batch Time | Speedup |
|---------|-----------|------------|---------|
| 10 | 200ms | 15ms | 13x |
| 100 | 2000ms | 20ms | 100x |
| 1000 | 20000ms | 50ms | 400x |

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

## Best Practices

### 1. Use Nullable deleted_at

```typescript
interface UsersTable {
  id: Generated<number>
  email: string
  deleted_at: Date | null  // Must be nullable
}
```

### 2. Create Partial Index (PostgreSQL)

```sql
CREATE INDEX idx_users_active ON users(id)
WHERE deleted_at IS NULL;
```

### 3. Clean Up Old Records

Periodically hard delete old soft-deleted records:

```typescript
// Delete records soft-deleted more than 90 days ago
const cutoffDate = new Date()
cutoffDate.setDate(cutoffDate.getDate() - 90)

await db
  .deleteFrom('users')
  .where('deleted_at', '<', cutoffDate)
  .execute()
```

### 4. Handle Cascade

When soft deleting parents, consider children:

```typescript
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)

  // Soft delete user and their posts
  await repos.posts.softDeleteMany(
    await repos.posts.find({ where: { user_id: userId } }).then(posts => posts.map(p => p.id))
  )
  await repos.users.softDelete(userId)
})
```
