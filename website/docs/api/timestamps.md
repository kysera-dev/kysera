---
sidebar_position: 9
title: '@kysera/timestamps'
description: Automatic timestamps plugin API reference
---

# @kysera/timestamps

Automatic timestamp management plugin for Kysera - Automatically manage `created_at` and `updated_at` timestamps on your entities.

## Installation

```bash
npm install @kysera/timestamps
```

## Overview

| Metric                | Value                               |
| --------------------- | ----------------------------------- |
| **Bundle Size**       | ~4 KB (minified)                    |
| **Dependencies**      | @kysera/core (workspace)            |
| **Peer Dependencies** | kysely >=0.28.8, @kysera/repository |

## Exports

```typescript
// Main plugin
export { timestampsPlugin } from './index'

// Types
export type { TimestampsOptions, TimestampsMethods, TimestampsRepository }
```

## timestampsPlugin

Creates a timestamps plugin instance.

```typescript
function timestampsPlugin(options?: TimestampsOptions): Plugin
```

### TimestampsOptions

```typescript
interface TimestampsOptions {
  /**
   * Name of the created_at column
   * @default 'created_at'
   */
  createdAtColumn?: string

  /**
   * Name of the updated_at column
   * @default 'updated_at'
   */
  updatedAtColumn?: string

  /**
   * Whether to set updated_at on insert operations
   * @default false
   */
  setUpdatedAtOnInsert?: boolean

  /**
   * List of tables to apply timestamps to (whitelist)
   * If not specified, all tables will have timestamps
   */
  tables?: string[]

  /**
   * List of tables to exclude from timestamps (blacklist)
   */
  excludeTables?: string[]

  /**
   * Custom timestamp generator function
   * @default () => new Date()
   */
  getTimestamp?: () => Date | string | number

  /**
   * Date format for timestamps
   * - 'iso': ISO 8601 string (default)
   * - 'unix': Unix timestamp in milliseconds
   * - 'date': JavaScript Date object
   * @default 'iso'
   */
  dateFormat?: 'iso' | 'unix' | 'date'

  /**
   * Name of the primary key column
   * NOTE: Only affects touch() method. updateMany/touchMany use hardcoded 'id'
   * @default 'id'
   */
  primaryKeyColumn?: string

  /**
   * Logger for plugin operations
   */
  logger?: KyseraLogger
}
```

### Configuration Examples

```typescript
import { timestampsPlugin } from '@kysera/timestamps'

// Default configuration (zero config)
const plugin = timestampsPlugin()

// Custom column names
const plugin = timestampsPlugin({
  createdAtColumn: 'created',
  updatedAtColumn: 'modified'
})

// Unix timestamps
const plugin = timestampsPlugin({
  dateFormat: 'unix',
  getTimestamp: () => Date.now()
})

// Only specific tables
const plugin = timestampsPlugin({
  tables: ['users', 'posts', 'comments']
})

// Exclude specific tables
const plugin = timestampsPlugin({
  excludeTables: ['audit_logs', 'migrations']
})

// Custom timestamp source
const plugin = timestampsPlugin({
  getTimestamp: () => new Date().toISOString()
})

// Set updated_at on insert
const plugin = timestampsPlugin({
  setUpdatedAtOnInsert: true
})

// Custom primary key (only affects touch())
const plugin = timestampsPlugin({
  primaryKeyColumn: 'user_id'
})
```

## Repository Methods

When a repository is extended by the timestamps plugin, the following methods are added:

### TimestampsMethods Interface

```typescript
interface TimestampsMethods<T> {
  // Date range queries
  findCreatedAfter(date: Date | string): Promise<T[]>
  findCreatedBefore(date: Date | string): Promise<T[]>
  findCreatedBetween(start: Date | string, end: Date | string): Promise<T[]>
  findUpdatedAfter(date: Date | string): Promise<T[]>

  // Recent records
  findRecentlyCreated(limit?: number): Promise<T[]>
  findRecentlyUpdated(limit?: number): Promise<T[]>

  // Batch operations
  createMany(inputs: unknown[]): Promise<T[]>
  updateMany(ids: (number | string)[], input: unknown): Promise<void>
  touchMany(ids: (number | string)[]): Promise<void>

  // Utilities
  touch(id: number | string): Promise<T>
  createWithoutTimestamps(input: unknown): Promise<T>
  updateWithoutTimestamp(id: number | string, input: unknown): Promise<T>
  getTimestampColumns(): { createdAt: string; updatedAt: string }
}
```

### Date Range Queries

#### findCreatedAfter

Find records created after a specific date.

```typescript
async findCreatedAfter(date: Date | string): Promise<T[]>
```

**Parameters:**

- `date` - Date object or ISO string

**Example:**

```typescript
const weekAgo = new Date()
weekAgo.setDate(weekAgo.getDate() - 7)
const recentPosts = await postRepo.findCreatedAfter(weekAgo)
```

#### findCreatedBefore

Find records created before a specific date.

```typescript
async findCreatedBefore(date: Date | string): Promise<T[]>
```

**Example:**

```typescript
const oldPosts = await postRepo.findCreatedBefore('2024-01-01')
```

#### findCreatedBetween

Find records created within a date range.

```typescript
async findCreatedBetween(start: Date | string, end: Date | string): Promise<T[]>
```

**Example:**

```typescript
const posts = await postRepo.findCreatedBetween('2024-01-01', '2024-01-31')
```

#### findUpdatedAfter

Find records updated after a specific date.

```typescript
async findUpdatedAfter(date: Date | string): Promise<T[]>
```

**Example:**

```typescript
const yesterday = new Date()
yesterday.setDate(yesterday.getDate() - 1)
const updatedPosts = await postRepo.findUpdatedAfter(yesterday)
```

### Recent Records

#### findRecentlyCreated

Get the most recently created records.

```typescript
async findRecentlyCreated(limit?: number): Promise<T[]>
```

**Parameters:**

- `limit` - Maximum number of records (default: 10)

**Example:**

```typescript
// Get 10 most recently created posts
const latestPosts = await postRepo.findRecentlyCreated()

// Get 50 most recently created
const latestPosts = await postRepo.findRecentlyCreated(50)
```

#### findRecentlyUpdated

Get the most recently updated records.

```typescript
async findRecentlyUpdated(limit?: number): Promise<T[]>
```

**Example:**

```typescript
const recentlyUpdated = await postRepo.findRecentlyUpdated(25)
```

### Batch Operations

#### createMany

Create multiple records with automatic timestamps.

```typescript
async createMany(inputs: unknown[]): Promise<T[]>
```

**Example:**

```typescript
const posts = await postRepo.createMany([
  { title: 'Post 1', content: '...' },
  { title: 'Post 2', content: '...' },
  { title: 'Post 3', content: '...' }
])
// All posts have created_at set automatically
```

#### updateMany

Update multiple records with automatic updated_at.

```typescript
async updateMany(ids: (number | string)[], input: unknown): Promise<void>
```

:::warning Primary Key Limitation
`updateMany()` uses hardcoded `'id'` for the WHERE clause. For tables with custom primary keys, use individual `update()` calls.
:::

**Example:**

```typescript
// Requires primary key column named 'id'
await postRepo.updateMany([1, 2, 3], { status: 'published' })
```

#### touchMany

Update only timestamps for multiple records.

```typescript
async touchMany(ids: (number | string)[]): Promise<void>
```

:::warning Primary Key Limitation
`touchMany()` uses hardcoded `'id'` for the WHERE clause. For tables with custom primary keys, use `touch()` in a loop.
:::

**Example:**

```typescript
// Requires primary key column named 'id'
await postRepo.touchMany([1, 2, 3, 4, 5])

// For custom primary keys, use touch() in a loop:
for (const userId of userIds) {
  await userRepo.touch(userId)
}
```

### Utilities

#### touch

Update only the `updated_at` timestamp for a record.

```typescript
async touch(id: number): Promise<void>
```

**Parameters:**

- `id` - Primary key of the record (numeric)

**Returns:** Nothing (updates the record in place)

**Example:**

```typescript
// Update user's last activity timestamp
await userRepo.touch(userId)

// Fetch the user to see the updated timestamp
const user = await userRepo.findById(userId)
console.log(`User last active: ${user.updated_at}`)
```

#### createWithoutTimestamps

Create a record bypassing automatic timestamp setting.

```typescript
async createWithoutTimestamps(input: unknown): Promise<T>
```

**Example:**

```typescript
// Useful for data imports
const importedPost = await postRepo.createWithoutTimestamps({
  title: 'Imported Post',
  content: '...',
  created_at: originalCreatedAt // Preserve original date
})
```

#### updateWithoutTimestamp

Update a record without changing `updated_at`.

```typescript
async updateWithoutTimestamp(id: number | string, input: unknown): Promise<T>
```

**Example:**

```typescript
// Update view count without changing updated_at
await postRepo.updateWithoutTimestamp(postId, {
  view_count: post.view_count + 1
})
```

#### getTimestampColumns

Get the configured column names.

```typescript
getTimestampColumns(): { createdAt: string; updatedAt: string }
```

**Example:**

```typescript
const columns = postRepo.getTimestampColumns()
console.log(columns) // { createdAt: 'created_at', updatedAt: 'updated_at' }
```

## Automatic Timestamp Setting

### On Create

The plugin automatically sets `created_at` when inserting records:

```typescript
const post = await postRepo.create({
  title: 'Hello World',
  content: 'My first post'
})
console.log(post.created_at) // 2024-01-15T10:30:00.000Z
```

### On Update

The plugin automatically sets `updated_at` when updating records:

```typescript
await postRepo.update(postId, { title: 'Updated Title' })
// updated_at is set automatically
```

## Query Interception

The plugin intercepts `insert` and `update` operations:

```typescript
// Plugin implementation (simplified)
interceptQuery(qb, context) {
  const timestamp = getTimestamp()

  if (context.operation === 'insert') {
    return qb.set({ [createdAtColumn]: timestamp })
  }

  if (context.operation === 'update') {
    return qb.set({ [updatedAtColumn]: timestamp })
  }

  return qb
}
```

## Usage with Plugin Container

```typescript
import { createORM, createRepositoryFactory } from '@kysera/repository'
import { timestampsPlugin } from '@kysera/timestamps'
import { z } from 'zod'

// createORM creates a plugin container (repository manager), not a traditional ORM
const orm = await createORM(db, [
  timestampsPlugin() // Zero config!
])

const postRepo = orm.createRepository(executor => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'posts',
    mapRow: row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }),
    schemas: {
      create: z.object({
        title: z.string().min(1),
        content: z.string()
      })
    }
  })
})

// created_at is set automatically
const post = await postRepo.create({
  title: 'Hello World',
  content: 'My first post'
})

// updated_at is set automatically on update
await postRepo.update(post.id, { title: 'Updated Title' })
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

## TypeScript Types

### TimestampsRepository

```typescript
type TimestampsRepository<Entity, DB> = Repository<Entity, DB> & TimestampsMethods<Entity>
```

### Database Schema Type

```typescript
interface PostsTable {
  id: Generated<number>
  title: string
  content: string
  created_at: Generated<Date> // Generated - has default
  updated_at: Date | null // Nullable for new records
}
```

## Performance

The timestamps plugin adds minimal overhead:

| Operation           | Overhead                    |
| ------------------- | --------------------------- |
| create              | +0.1ms                      |
| update              | +0.1ms                      |
| findRecentlyCreated | +0.2ms                      |
| createMany          | &lt;1ms regardless of count |

## Known Limitations

### Primary Key Column

The `primaryKeyColumn` option **only affects the `touch()` method**. The following methods use hardcoded `'id'`:

| Method            | Respects `primaryKeyColumn`? |
| ----------------- | ---------------------------- |
| `create()`        | N/A                          |
| `update()`        | N/A                          |
| `touch(id)`       | ✅ Yes                       |
| `updateMany(ids)` | ❌ No - uses `'id'`          |
| `touchMany(ids)`  | ❌ No - uses `'id'`          |
| `createMany()`    | N/A                          |

**Workaround:**

```typescript
// For tables with custom primary keys
for (const userId of userIds) {
  await userRepo.touch(userId) // Respects primaryKeyColumn
}
```

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

### 4. Exclude System Tables

```typescript
timestampsPlugin({
  excludeTables: ['migrations', 'audit_logs', 'system_config']
})
```

## See Also

- [Timestamps Plugin Guide](/docs/plugins/timestamps)
- [@kysera/repository](/docs/api/repository)
- [@kysera/soft-delete](/docs/api/soft-delete)
