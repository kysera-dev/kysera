---
sidebar_position: 4
title: Pagination
description: Pagination strategies and implementation
---

# Pagination

Implementing efficient pagination with Kysera.

## Lightweight Offset (applyOffset)

When you don't need total count, use `applyOffset` for a ~50% performance boost:

```typescript
import { applyOffset } from '@kysera/core'

// Simple pagination without COUNT(*)
const users = await applyOffset(db.selectFrom('users').selectAll().orderBy('id'), {
  limit: 20,
  offset: 0
}).execute()

// Infinite scroll pattern
async function loadMore(offset: number) {
  const posts = await applyOffset(
    db.selectFrom('posts').selectAll().where('published', '=', true).orderBy('created_at', 'desc'),
    { limit: 20, offset }
  ).execute()

  return {
    posts,
    hasMore: posts.length === 20 // If full page, might be more
  }
}
```

**Key features:**

- No COUNT(\*) query
- Limit: 1-100 (auto-bounded)
- SQLite compatible

## Offset Pagination

Traditional page-based pagination with total count.

```typescript
import { paginate } from '@kysera/core'

const result = await paginate(
  db.selectFrom('posts').selectAll().where('status', '=', 'published'),
  { page: 1, limit: 20 }
)

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

### When to Use

- Need page numbers (e.g., "Page 3 of 10")
- Small to medium datasets (< 10,000 rows)
- Random page access needed
- Admin panels, simple lists

### Pros and Cons

| Pros                | Cons                           |
| ------------------- | ------------------------------ |
| Simple to implement | O(n) at high pages             |
| Page numbers        | Inconsistent with data changes |
| Jump to any page    | Performance degrades           |

## Cursor Pagination

Efficient keyset-based pagination.

```typescript
import { paginateCursor } from '@kysera/core'

// First page
const page1 = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' }
  ],
  limit: 20
})

// Next page
const page2 = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' }
  ],
  limit: 20,
  cursor: page1.pagination.nextCursor
})
```

### When to Use

- Large datasets (> 10,000 rows)
- Infinite scroll UI
- Real-time data (frequent inserts/deletes)
- API responses
- Mobile apps

### Pros and Cons

| Pros                     | Cons                   |
| ------------------------ | ---------------------- |
| O(log n) with index      | No page numbers        |
| Stable with data changes | Sequential access only |
| Consistent performance   | More complex           |

## Repository Pagination

Using repository methods:

```typescript
// Offset
const page = await userRepo.paginate({
  limit: 20,
  offset: 0,
  orderBy: 'created_at',
  orderDirection: 'desc'
})

// Cursor
const result = await userRepo.paginateCursor({
  limit: 20,
  cursor: null,
  orderBy: 'created_at',
  orderDirection: 'desc'
})
```

## API Implementation

### REST API with Offset

```typescript
app.get('/posts', async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const limit = Math.min(parseInt(req.query.limit) || 20, 100)

  const result = await paginate(db.selectFrom('posts').selectAll(), { page, limit })

  res.json({
    data: result.data,
    meta: {
      page: result.pagination.page,
      limit: result.pagination.limit,
      total: result.pagination.total,
      totalPages: result.pagination.totalPages
    },
    links: {
      self: `/posts?page=${page}&limit=${limit}`,
      first: `/posts?page=1&limit=${limit}`,
      last: `/posts?page=${result.pagination.totalPages}&limit=${limit}`,
      next: result.pagination.hasNext ? `/posts?page=${page + 1}&limit=${limit}` : null,
      prev: result.pagination.hasPrev ? `/posts?page=${page - 1}&limit=${limit}` : null
    }
  })
})
```

### REST API with Cursor

```typescript
app.get('/posts', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100)
  const cursor = req.query.cursor || null

  const result = await paginateCursor(db.selectFrom('posts').selectAll(), {
    orderBy: [
      { column: 'created_at', direction: 'desc' },
      { column: 'id', direction: 'desc' }
    ],
    limit,
    cursor
  })

  res.json({
    data: result.data,
    meta: {
      hasMore: result.pagination.hasNext
    },
    cursors: {
      next: result.pagination.nextCursor,
      prev: result.pagination.prevCursor
    }
  })
})
```

## Date Range Filtering

Combine with pagination for filtered results:

```typescript
import { applyOffset, applyDateRange } from '@kysera/core'

// Get posts from last month, paginated
const result = await applyOffset(
  applyDateRange(db.selectFrom('posts').selectAll().orderBy('created_at', 'desc'), 'created_at', {
    from: new Date('2024-01-01'),
    to: new Date('2024-01-31')
  }),
  { limit: 50 }
).execute()

// Last N days helper
function getLastNDays(days: number) {
  const now = new Date()
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return { from, to: now }
}

const recentPosts = await applyDateRange(
  db.selectFrom('posts').selectAll(),
  'created_at',
  getLastNDays(7)
).execute()
```

## Database Optimization

### Indexes for Cursor Pagination

```sql
-- Single column ordering
CREATE INDEX idx_posts_created_at ON posts (created_at DESC);

-- Multi-column (recommended)
CREATE INDEX idx_posts_cursor ON posts (created_at DESC, id DESC);

-- With filtering
CREATE INDEX idx_posts_status_created ON posts (status, created_at DESC, id DESC);
```

### Partial Indexes (PostgreSQL)

```sql
-- Index only active posts
CREATE INDEX idx_active_posts ON posts (created_at DESC, id DESC)
WHERE status = 'published';
```

## Best Practices

### 1. Always Include Tie-Breaker

```typescript
// Good: Unique tie-breaker prevents duplicates
{
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' } // Unique!
  ]
}

// Bad: May have inconsistent results
{
  orderBy: [{ column: 'created_at', direction: 'desc' }]
}
```

### 2. Limit Maximum Page Size

```typescript
const limit = Math.min(parseInt(req.query.limit) || 20, 100)
```

### 3. Use Cursor for Large Datasets

```typescript
// Large dataset? Use cursor
if (totalCount > 10000) {
  return paginateCursor(query, options)
}
// Small dataset? Offset is fine
return paginate(query, options)
```

### 4. Cache Total Count

For offset pagination, total count query can be expensive:

```typescript
// Cache total count
const cacheKey = `posts:count:${JSON.stringify(where)}`
let total = await cache.get(cacheKey)

if (!total) {
  total = await db.selectFrom('posts').select(db.fn.count('id')).executeTakeFirst()
  await cache.set(cacheKey, total, 60) // Cache for 60s
}
```

### 5. Consider Deferred Pagination

For complex queries, fetch IDs first:

```typescript
// Get just IDs (fast with index)
const ids = await db
  .selectFrom('posts')
  .select('id')
  .orderBy('created_at', 'desc')
  .limit(20)
  .offset(offset)
  .execute()

// Fetch full records
const posts = await db
  .selectFrom('posts')
  .selectAll()
  .where(
    'id',
    'in',
    ids.map(r => r.id)
  )
  .execute()
```
