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
  page?: number // Page number (default: 1)
  limit?: number // Items per page (default: 20)
}
```

### PaginatedResult

```typescript
interface PaginatedResult<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
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
  limit?: number // Default: 20
  cursor?: string | null // Cursor from previous page
}
```

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

Simplified cursor pagination with fewer options.

```typescript
async function paginateCursorSimple<DB, TB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options?: PaginationOptions
): Promise<PaginatedResult<O>>
```

Uses default ordering by primary key.

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
const limit = Math.min(options.limit ?? 20, 100) // Max 100
```
