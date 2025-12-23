---
sidebar_position: 4
title: Timestamps
description: Automatic timestamp management plugin for Kysera
---

# Timestamps Plugin

Automatically manage `created_at` and `updated_at` timestamps on your entities.

## Installation

```bash
npm install @kysera/timestamps
```

## Basic Usage

```typescript
import { createORM } from '@kysera/repository'
import { timestampsPlugin } from '@kysera/timestamps'

const orm = await createORM(db, [
  timestampsPlugin() // Zero config!
])

const postRepo = orm.createRepository(executor => {
  const factory = createRepositoryFactory(executor)
  return factory.create({ tableName: 'posts' /* ... */ })
})

// created_at is set automatically
const post = await postRepo.create({
  title: 'Hello World',
  content: 'My first post'
})
console.log(post.created_at) // 2024-01-15T10:30:00.000Z

// updated_at is set automatically on update
await postRepo.update(post.id, { title: 'Updated Title' })
```

## Configuration

```typescript
interface TimestampsOptions {
  createdAtColumn?: string // Default: 'created_at'
  updatedAtColumn?: string // Default: 'updated_at'
  setUpdatedAtOnInsert?: boolean // Default: false
  tables?: string[] // Whitelist tables
  excludeTables?: string[] // Blacklist tables
  getTimestamp?: () => Date | string | number
  dateFormat?: 'iso' | 'unix' | 'date' // Default: 'iso'
  primaryKeyColumn?: string // Default: 'id' (only affects touch() method)
  logger?: KyseraLogger
}
```

### Important Limitation

:::warning Primary Key Column Limitation

The `primaryKeyColumn` option **only affects the `touch()` method**. The following methods currently hardcode the column name as `'id'`:

- `updateMany(ids, input)` - Uses hardcoded `'id'` for WHERE clause
- `touchMany(ids)` - Uses hardcoded `'id'` for WHERE clause

**Workaround**: If your table uses a different primary key column (e.g., `user_id`, `uuid`), you should:

- Use `touch(id)` for single record updates (respects `primaryKeyColumn`)
- Avoid `updateMany()` and `touchMany()` for tables with non-standard primary keys
- Manually construct queries for batch operations on such tables

This limitation will be addressed in a future version.

:::

### Methods and Primary Key Column Support

| Method            | Respects `primaryKeyColumn`? | Notes                       |
| ----------------- | ---------------------------- | --------------------------- |
| `create()`        | N/A                          | No ID-based filtering       |
| `update()`        | N/A                          | No ID-based filtering       |
| `touch(id)`       | ✅ Yes                       | Uses configured primary key |
| `updateMany(ids)` | ❌ No                        | Hardcoded to `'id'`         |
| `touchMany(ids)`  | ❌ No                        | Hardcoded to `'id'`         |
| `createMany()`    | N/A                          | No ID-based filtering       |

### Configuration Examples

```typescript
// Custom column names
timestampsPlugin({
  createdAtColumn: 'created',
  updatedAtColumn: 'modified'
})

// Unix timestamps
timestampsPlugin({
  dateFormat: 'unix',
  getTimestamp: () => Date.now()
})

// Only specific tables
timestampsPlugin({
  tables: ['users', 'posts', 'comments']
})

// Custom timestamp source
timestampsPlugin({
  getTimestamp: () => new Date().toISOString()
})

// Custom primary key (only affects touch() method)
timestampsPlugin({
  primaryKeyColumn: 'user_id' // touch() will use user_id, but updateMany/touchMany still use 'id'
})
```

## Added Methods

### Date Range Queries

| Method                           | Description                 |
| -------------------------------- | --------------------------- |
| `findCreatedAfter(date)`         | Records created after date  |
| `findCreatedBefore(date)`        | Records created before date |
| `findCreatedBetween(start, end)` | Records created in range    |
| `findUpdatedAfter(date)`         | Records updated after date  |

### Recent Records

| Method                        | Description                         |
| ----------------------------- | ----------------------------------- |
| `findRecentlyCreated(limit?)` | Most recently created (default: 10) |
| `findRecentlyUpdated(limit?)` | Most recently updated (default: 10) |

### Batch Operations

| Method                   | Description                      |
| ------------------------ | -------------------------------- |
| `createMany(inputs)`     | Create with automatic timestamps |
| `updateMany(ids, input)` | Update with automatic timestamps |
| `touchMany(ids)`         | Update only timestamps           |

### Utilities

| Method                              | Description             |
| ----------------------------------- | ----------------------- |
| `touch(id)`                         | Update only updated_at  |
| `createWithoutTimestamps(input)`    | Create bypassing plugin |
| `updateWithoutTimestamp(id, input)` | Update bypassing plugin |
| `getTimestampColumns()`             | Get column names        |

## Usage Examples

### Recent Records

```typescript
// Get 10 most recently created posts
const latestPosts = await postRepo.findRecentlyCreated()

// Get 50 most recently created
const latestPosts = await postRepo.findRecentlyCreated(50)

// Get recently updated
const recentlyUpdated = await postRepo.findRecentlyUpdated(25)
```

### Date Range Queries

```typescript
// Posts from last week
const weekAgo = new Date()
weekAgo.setDate(weekAgo.getDate() - 7)
const recentPosts = await postRepo.findCreatedAfter(weekAgo)

// Posts in date range
const posts = await postRepo.findCreatedBetween('2024-01-01', '2024-01-31')

// Recently modified posts
const updatedPosts = await postRepo.findUpdatedAfter(yesterday)
```

### Touch (Last Activity Tracking)

```typescript
// Update user's last activity
await userRepo.touch(userId)

// User's updated_at now reflects last activity
const user = await userRepo.findById(userId)
console.log(`User last active: ${user.updated_at}`)
```

### Batch Operations

:::warning
Note: `updateMany()` and `touchMany()` currently require tables to have a primary key column named `'id'`. See [Primary Key Column Limitation](#important-limitation) for details.
:::

```typescript
// Create many with automatic timestamps
const posts = await postRepo.createMany([
  { title: 'Post 1', content: '...' },
  { title: 'Post 2', content: '...' },
  { title: 'Post 3', content: '...' }
])

// Update many (requires primary key named 'id')
await postRepo.updateMany([1, 2, 3], { status: 'published' })

// Touch many (requires primary key named 'id')
await postRepo.touchMany([1, 2, 3, 4, 5])

// For tables with custom primary keys, use touch() in a loop:
for (const userId of userIds) {
  await userRepo.touch(userId) // Respects primaryKeyColumn configuration
}
```

### Bypassing Timestamps

```typescript
// Create without automatic timestamps
const importedPost = await postRepo.createWithoutTimestamps({
  title: 'Imported Post',
  content: '...',
  created_at: originalCreatedAt // Preserve original date
})

// Update without changing updated_at
await postRepo.updateWithoutTimestamp(postId, {
  view_count: post.view_count + 1
})
```

## Database Schema

```sql
-- PostgreSQL
ALTER TABLE posts ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE posts ADD COLUMN updated_at TIMESTAMP;
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_updated_at ON posts(updated_at DESC);

-- MySQL
ALTER TABLE posts ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE posts ADD COLUMN updated_at DATETIME;

-- SQLite
ALTER TABLE posts ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE posts ADD COLUMN updated_at TEXT;
```

## Performance

The timestamps plugin adds minimal overhead:

| Operation           | Overhead                          |
| ------------------- | --------------------------------- |
| create              | +0.1ms                            |
| update              | +0.1ms                            |
| findRecentlyCreated | +0.2ms                            |
| createMany          | Less than 1ms regardless of count |

## Best Practices

### 1. Index Timestamp Columns

```sql
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_updated_at ON posts(updated_at DESC);
```

### 2. Use for Activity Tracking

```typescript
// Track user activity without explicit field
app.use(async (req, res, next) => {
  if (req.user) {
    await userRepo.touch(req.user.id)
  }
  next()
})
```

### 3. Combine with Other Plugins

```typescript
const orm = await createORM(db, [
  timestampsPlugin(), // Handles timestamps
  softDeletePlugin(), // Handles deleted_at separately
  auditPlugin() // Full audit trail
])
```
