---
sidebar_position: 4
title: Pagination
description: Pagination utilities API reference
---

# Pagination

Offset-based and cursor-based pagination utilities.

## paginate

Offset-based pagination for queries.

```typescript
async function paginate<DB, TB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options?: PaginationOptions
): Promise<PaginatedResult<O>>
```

### PaginationOptions

```typescript
interface PaginationOptions {
  page?: number // Page number (default: 1, max: 1,000,000)
  limit?: number // Items per page (default: 20, max: 10,000)
  cursor?: string // Cursor string for cursor-based pagination
  dialect?: 'postgres' | 'mysql' | 'sqlite' | 'mssql' // Database dialect (optional)
}
```

### PaginatedResult

```typescript
interface PaginatedResult<T> {
  data: T[]
  pagination: {
    page?: number
    limit?: number
    total?: number
    totalPages?: number
    hasNext: boolean
    hasPrev?: boolean
    nextCursor?: string
    prevCursor?: string
  }
}
```

### Example

```typescript
import { paginate } from '@kysera/core'

const result = await paginate(db.selectFrom('users').selectAll().where('status', '=', 'active'), {
  page: 1,
  limit: 20
})

console.log(result)
// {
//   data: [...],
//   pagination: {
//     page: 1,
//     limit: 20,
//     total: 150,
//     totalPages: 8,
//     hasNext: true,
//     hasPrev: false
//   }
// }
```

## paginateCursor

Cursor-based pagination for efficient large dataset handling.

```typescript
async function paginateCursor<DB, TB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: CursorOptions<O>
): Promise<PaginatedResult<O>>
```

### CursorOptions

```typescript
interface CursorOptions<O> {
  orderBy: Array<{
    column: keyof O & string
    direction: 'asc' | 'desc'
  }>
  limit?: number // Default: 20, max: 10,000
  cursor?: string // Cursor from previous page
  dialect?: 'postgres' | 'mysql' | 'sqlite' | 'mssql' // Database dialect (optional)
  security?: CursorSecurityOptions // Security options for cursor signing/encryption
}
```

:::tip Cursor Security
The `security` option enables HMAC signing and/or AES-256-GCM encryption for cursors to prevent tampering. See the [Cursor Security section in @kysera/core](/docs/api/core#cursor-security) for details.
:::

### Example

```typescript
import { paginateCursor } from '@kysera/core'

// First page
const page1 = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' } // Tie-breaker
  ],
  limit: 20
})

// Next page using cursor
const page2 = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' }
  ],
  limit: 20,
  cursor: page1.pagination.nextCursor
})
```

### Result

```typescript
{
  data: [...],
  pagination: {
    limit: 20,
    hasNext: true,
    hasPrev: true,
    nextCursor: 'eyJjcmVhdGVkX2F0IjoiMjAyNC0wMS0xNS4...',
    prevCursor: 'eyJjcmVhdGVkX2F0IjoiMjAyNC0wMS0xNS4...'
  }
}
```

## Cursor Format

Cursors are base64-encoded:

- **Single column:** `base64(column):base64(value)`
- **Multi-column:** `base64(JSON.stringify({col1: val1, col2: val2}))`

## Performance Comparison

| Method | Time Complexity     | Use Case                            |
| ------ | ------------------- | ----------------------------------- |
| Offset | O(n) at high pages  | Small datasets, page numbers needed |
| Cursor | O(log n) with index | Large datasets, infinite scroll     |

### When to Use Offset

- Need page numbers (e.g., "Page 3 of 10")
- Small to medium datasets (< 10,000 rows)
- Random page access needed

### When to Use Cursor

- Large datasets (> 10,000 rows)
- Infinite scroll UI
- Real-time data (inserts/deletes during pagination)
- Sequential access only

## Database Optimizations

### PostgreSQL

When all columns are ASC, uses efficient row value comparison:

```sql
-- Efficient: Single comparison
WHERE (created_at, id) > ($1, $2)
ORDER BY created_at, id

-- Less efficient: Compound conditions
WHERE created_at > $1 OR (created_at = $1 AND id > $2)
```

### Indexing

Create composite indexes for cursor pagination:

```sql
-- PostgreSQL
CREATE INDEX idx_posts_cursor ON posts (created_at DESC, id DESC);

-- MySQL
CREATE INDEX idx_posts_cursor ON posts (created_at DESC, id DESC);
```

## paginateCursorSimple

Simplified cursor pagination that uses `id` column in ascending order. A convenience wrapper around `paginateCursor`.

```typescript
async function paginateCursorSimple<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options?: PaginationOptions
): Promise<PaginatedResult<O>>
```

Internally calls `paginateCursor` with `orderBy: [{ column: 'id', direction: 'asc' }]`. The table must have an `id` column.

## Best Practices

### 1. Always Include Tie-Breaker

```typescript
// Good: Include unique column for consistent ordering
{
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' } // Unique tie-breaker
  ]
}

// Bad: May have inconsistent ordering
{
  orderBy: [{ column: 'created_at', direction: 'desc' }]
}
```

### 2. Create Appropriate Indexes

```sql
-- Index should match ORDER BY columns
CREATE INDEX idx_posts_pagination ON posts (created_at DESC, id DESC);
```

### 3. Limit Maximum Page Size

```typescript
const limit = Math.min(options.limit ?? 20, 10_000) // Max 10,000
```

## Database-Specific Behavior

### Supported Databases

Kysera pagination supports PostgreSQL, MySQL, SQLite, and MSSQL. The dialect is usually auto-detected but can be explicitly specified.

### MSSQL-Specific Requirements

MSSQL has specific requirements for offset pagination:

#### Offset Pagination

MSSQL requires an `ORDER BY` clause when using offset pagination. Kysera uses the `OFFSET/FETCH NEXT` syntax:

```typescript
import { paginate } from '@kysera/core'

// MSSQL offset pagination
const result = await paginate(
  db.selectFrom('users')
    .selectAll()
    .orderBy('id', 'asc'), // ORDER BY required for MSSQL
  {
    page: 1,
    limit: 20,
    dialect: 'mssql'
  }
)

// Generated SQL (MSSQL):
// SELECT * FROM users
// ORDER BY id ASC
// OFFSET 0 ROWS
// FETCH NEXT 20 ROWS ONLY
```

**Important:** If you attempt offset pagination on MSSQL without an `ORDER BY` clause, the query will fail.

#### Cursor Pagination

MSSQL cursor pagination uses the `TOP` clause for efficient queries:

```typescript
import { paginateCursor } from '@kysera/core'

const page1 = await paginateCursor(
  db.selectFrom('posts').selectAll(),
  {
    orderBy: [
      { column: 'created_at', direction: 'desc' },
      { column: 'id', direction: 'desc' }
    ],
    limit: 20,
    dialect: 'mssql'
  }
)

// Generated SQL (MSSQL):
// SELECT TOP 21 * FROM posts
// WHERE (created_at < @p1 OR (created_at = @p1 AND id < @p2))
// ORDER BY created_at DESC, id DESC
```

### PostgreSQL Row Value Comparison

When all columns use the same direction (all `asc` or all `desc`), PostgreSQL uses efficient row value comparison:

```typescript
// Efficient PostgreSQL query
const result = await paginateCursor(
  db.selectFrom('posts').selectAll(),
  {
    orderBy: [
      { column: 'created_at', direction: 'desc' },
      { column: 'id', direction: 'desc' } // Same direction
    ],
    limit: 20
  }
)

// PostgreSQL generates:
// SELECT * FROM posts
// WHERE (created_at, id) < ($1, $2)
// ORDER BY created_at DESC, id DESC
// LIMIT 20
```

### MySQL and SQLite

MySQL and SQLite use standard `LIMIT/OFFSET` syntax:

```typescript
// MySQL/SQLite pagination
const result = await paginate(
  db.selectFrom('users').selectAll(),
  { page: 1, limit: 20, dialect: 'mysql' }
)

// Generated SQL:
// SELECT * FROM users LIMIT 20 OFFSET 0
```

### Auto-Detection vs Explicit Dialect

The dialect parameter is optional. Kysera typically auto-detects the database type from the Kysely instance, but you can override it:

```typescript
// Auto-detected (recommended)
const result = await paginate(query, { page: 1, limit: 20 })

// Explicit dialect (for testing or specific optimizations)
const result = await paginate(query, {
  page: 1,
  limit: 20,
  dialect: 'mssql'
})
```
