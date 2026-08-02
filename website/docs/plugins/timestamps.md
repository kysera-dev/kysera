---
sidebar_position: 4
title: Timestamps
description: Automatic timestamp management plugin for Kysera
---

# Timestamps Plugin

Automatically manage `created_at` and `updated_at` timestamps on your entities. This is a **repository-level plugin**: it works by wrapping repository write methods via `extendRepository()` and has no query interceptor — writes made directly on the executor or through DAL queries are **not** timestamped.

## Installation

```bash
npm install @kysera/timestamps
```

## Basic Usage

### With Repository Pattern

<!-- doc-snippet: skip -->
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

### Executor and DAL Writes Are NOT Timestamped

The plugin has no `interceptQuery` hook — it only extends repositories. An insert issued directly on the executor (or from a DAL query) passes through unchanged:

```typescript
import { createExecutor } from '@kysera/executor'
import { timestampsPlugin } from '@kysera/timestamps'

const executor = await createExecutor(db, [timestampsPlugin()])

// NOT timestamped — the plugin never sees this query
const post = await executor
  .insertInto('posts')
  .values({ title: 'Hello World', content: 'My first post' })
  .returningAll()
  .executeTakeFirst()
// post.created_at is NULL (or whatever your schema default provides)
```

Route writes through a repository to get automatic timestamps:

```typescript
const orm = await createORM(db, [timestampsPlugin()])
const postRepo = orm.createRepository(createPostRepository)

const post = await postRepo.create({ title: 'Hello World', content: 'My first post' })
console.log(post.created_at) // Set automatically
```

For executor/DAL writes, set the columns yourself or rely on database defaults (`DEFAULT CURRENT_TIMESTAMP`).

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
  primaryKeyColumn?: string // Default: 'id' (touch, touchMany, updateMany, createMany fallback)
  logger?: KyseraLogger
}
```

### Primary Key Column Support

All methods that use ID-based filtering respect the `primaryKeyColumn` configuration option:

| Method            | Uses `primaryKeyColumn`? | Notes                       |
| ----------------- | ------------------------ | --------------------------- |
| `create()`        | N/A                      | No ID-based filtering       |
| `update()`        | N/A                      | No ID-based filtering       |
| `touch(id)`       | ✅ Yes                   | Uses configured primary key |
| `updateMany(ids)` | ✅ Yes                   | Uses configured primary key |
| `touchMany(ids)`  | ✅ Yes                   | Uses configured primary key |
| `createMany()`    | ✅ On MySQL/MSSQL        | Fallback fetches inserted rows by primary key |

:::tip UUID Primary Keys
For tables with UUID or custom primary keys, configure `primaryKeyColumn`:

```typescript
timestampsPlugin({
  primaryKeyColumn: 'uuid' // All methods will use this column for WHERE clauses
})
```
:::

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

// Custom primary key (affects all ID-based operations)
timestampsPlugin({
  primaryKeyColumn: 'user_id' // touch(), updateMany(), touchMany() will all use user_id
})
```

## Added Methods

Besides the methods below, the plugin transparently wraps the base repository's `create()`, `update()`, `bulkCreate()`, and `bulkUpdate()` methods (when present), so single-row and bulk writes all receive the same timestamp injection — no separate call needed.

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

| Method                   | Description                      | Returns |
| ------------------------ | -------------------------------- | ------- |
| `createMany(inputs)`     | Create with automatic timestamps | `T[]`   |
| `updateMany(ids, input)` | Update with automatic timestamps | `T[]`   |
| `touchMany(ids)`         | Update only timestamps           | `void`  |

### Utilities

| Method                              | Description             | Returns                             |
| ----------------------------------- | ----------------------- | ----------------------------------- |
| `touch(id)`                         | Update only updated_at  | `void`                              |
| `createWithoutTimestamps(input)`    | Create bypassing plugin | `T`                                 |
| `updateWithoutTimestamp(id, input)` | Update bypassing plugin | `T`                                 |
| `getTimestampColumns()`             | Get column names        | `{ createdAt: string; updatedAt: string }` |

## Usage Examples

### Recent Records

<!-- doc-snippet: skip -->
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

```typescript
// Create many with automatic timestamps
const posts = await postRepo.createMany([
  { title: 'Post 1', content: '...' },
  { title: 'Post 2', content: '...' },
  { title: 'Post 3', content: '...' }
])

// Update many - respects primaryKeyColumn configuration, returns updated records
const updated = await postRepo.updateMany([1, 2, 3], { status: 'published' })

// Touch many - respects primaryKeyColumn configuration
await postRepo.touchMany([1, 2, 3, 4, 5])

// For UUID primary keys, configure primaryKeyColumn:
// timestampsPlugin({ primaryKeyColumn: 'uuid' })
await userRepo.touchMany(['uuid-1', 'uuid-2', 'uuid-3'])
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

## Database Compatibility

The timestamps plugin handles database-specific differences in how records are returned after INSERT operations:

### RETURNING Clause Support

| Database   | RETURNING Support | Behavior                                       |
| ---------- | ----------------- | ---------------------------------------------- |
| PostgreSQL | ✅ Full support   | Single `INSERT ... RETURNING *`                |
| SQLite     | ✅ 3.35+          | Single `INSERT ... RETURNING *`                |
| MySQL      | ❌ Not supported  | Per-row insert-then-fetch fallback             |
| MSSQL      | ❌ Not used       | Per-row insert-then-fetch fallback (the plugin does not use the OUTPUT clause) |

### How the Fallback Works

On dialects without `RETURNING` support (MySQL, MSSQL), `createMany()` falls back to inserting rows **one at a time** and fetching each inserted row back by primary key:

```typescript
// PostgreSQL/SQLite: single bulk query with RETURNING
const rows = await db.insertInto('posts').values(allRows).returningAll().execute()

// MySQL/MSSQL fallback: two queries PER ROW (2N total)
for (const item of allRows) {
  const result = await db.insertInto('posts').values(item).executeTakeFirst()
  // Fetch by insertId (auto-increment PKs) or by the PK value from the input
  const row = await db
    .selectFrom('posts')
    .selectAll()
    .where('id', '=', Number(result.insertId))
    .executeTakeFirst()
}
```

**Performance implications:**
- MySQL/MSSQL: `createMany()` issues 2 queries per row (insert + fetch) — 2N round trips for N rows
- PostgreSQL/SQLite: `createMany()` is a single bulk INSERT with `RETURNING`
- Consider using database defaults for timestamps in high-throughput MySQL/MSSQL scenarios

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

| Operation                        | Overhead                                       |
| -------------------------------- | ---------------------------------------------- |
| create                           | +0.1ms                                         |
| update                           | +0.1ms                                         |
| findRecentlyCreated              | +0.2ms                                         |
| createMany (PostgreSQL/SQLite)   | Single bulk INSERT with RETURNING              |
| createMany (MySQL/MSSQL)         | 2 queries per row (insert + fetch by primary key) |

## Schema Validation (Optional)

The plugin's configuration can be validated with Zod via the `/schema` subpath:

```typescript
import { TimestampsOptionsSchema } from '@kysera/timestamps/schema'

const result = TimestampsOptionsSchema.safeParse({
  createdAtColumn: 'created_at',
  updatedAtColumn: 'updated_at',
  setUpdatedAtOnInsert: true
})
```

:::tip
The main `@kysera/timestamps` package works without Zod installed. Only import from `/schema` if you need runtime validation.
:::

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

## See Also

- [@kysera/timestamps API Reference](/docs/api/timestamps)
- [Audit Plugin Guide](/docs/plugins/audit)
