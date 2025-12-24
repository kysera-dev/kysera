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
import { applyOffset, MAX_LIMIT } from '@kysera/core'

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
- Limit: 1-100 (auto-bounded via `MAX_LIMIT = 100`)
- Compatible with PostgreSQL, MySQL, SQLite, and MSSQL

**Bounds checking:**

```typescript
// Limit is automatically clamped to valid range
applyOffset(query, { limit: 0 }) // Uses 1 (minimum)
applyOffset(query, { limit: 20000 }) // Uses 100 (MAX_LIMIT)
applyOffset(query, { limit: -5 }) // Uses 1 (minimum)
```

## Offset Pagination

Traditional page-based pagination with total count.

```typescript
import { paginate, MAX_LIMIT } from '@kysera/core'

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

### Bounds Checking

Kysera automatically enforces safe limits to prevent performance issues:

```typescript
// Page bounds
paginate(query, { page: 0 }) // Uses page 1 (minimum)
paginate(query, { page: 15000 }) // Uses page 15000 (no upper bound on pages)
paginate(query, { page: -5 }) // Uses page 1 (minimum)

// Limit bounds (MAX_LIMIT = 100)
paginate(query, { page: 1, limit: 0 }) // Uses limit 1 (minimum)
paginate(query, { page: 1, limit: 20000 }) // Uses limit 100 (MAX_LIMIT)
paginate(query, { page: 1, limit: -10 }) // Uses limit 1 (minimum)

// MSSQL requires ORDER BY for offset pagination
paginate(
  db.selectFrom('users').selectAll().orderBy('id', 'asc'),
  { page: 1, limit: 20, dialect: 'mssql' }
)
```

**Important:** High page numbers with offset pagination can skip many rows and degrade performance. For large datasets or high page numbers, use cursor pagination instead.

### When to Use

- Need page numbers (e.g., "Page 3 of 10")
- Small to medium datasets
- Random page access needed
- Admin panels, simple lists

### Pros and Cons

| Pros                | Cons                           |
| ------------------- | ------------------------------ |
| Simple to implement | O(n) at high pages             |
| Page numbers        | Inconsistent with data changes |
| Jump to any page    | Performance degrades           |
| Built-in bounds     | Max limit of 100 rows per page |

## Cursor Pagination

Efficient keyset-based pagination.

```typescript
import { paginateCursor, MAX_LIMIT } from '@kysera/core'

// First page
const page1 = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' } // Always include unique tie-breaker
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

### Bounds Checking

Cursor pagination also enforces limit bounds for safety:

```typescript
import { MAX_LIMIT } from '@kysera/core' // MAX_LIMIT = 100

// Limit bounds automatically enforced
paginateCursor(query, { orderBy: [...], limit: 0 }) // Uses 1 (minimum)
paginateCursor(query, { orderBy: [...], limit: 20000 }) // Uses 100 (MAX_LIMIT)
paginateCursor(query, { orderBy: [...], limit: -10 }) // Uses 1 (minimum)

// No page limit - cursor pagination scales to any dataset size
const millionthPage = await paginateCursor(query, {
  orderBy: [{ column: 'id', direction: 'asc' }],
  limit: 20,
  cursor: lastCursor // Still O(log n) performance!
})

// MSSQL uses TOP clause for cursor pagination
paginateCursor(
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
```

### When to Use

- Large datasets
- Infinite scroll UI
- Real-time data (frequent inserts/deletes)
- API responses
- Mobile apps
- When you need consistent performance at any dataset size

### Pros and Cons

| Pros                     | Cons                   |
| ------------------------ | ---------------------- |
| O(log n) with index      | No page numbers        |
| Stable with data changes | Sequential access only |
| Consistent performance   | More complex           |
| No page limit            | Requires unique order  |

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

## Database-Specific Behavior

### Supported Databases

Kysera pagination supports **PostgreSQL**, **MySQL**, **SQLite**, and **MSSQL**. The dialect is usually auto-detected from your Kysely instance, but can be explicitly specified via the `dialect` parameter.

### MSSQL Requirements and Optimizations

MSSQL has specific requirements and optimizations for pagination:

#### Offset Pagination

MSSQL **requires** an `ORDER BY` clause when using offset pagination. Kysera uses the MSSQL `OFFSET/FETCH NEXT` syntax:

```typescript
import { paginate } from '@kysera/core'

// CORRECT: ORDER BY required for MSSQL
const result = await paginate(
  db.selectFrom('users')
    .selectAll()
    .orderBy('id', 'asc'), // Required!
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

// WRONG: Will fail without ORDER BY
const result = await paginate(
  db.selectFrom('users').selectAll(), // Missing ORDER BY
  { page: 1, limit: 20, dialect: 'mssql' }
)
// Error: MSSQL requires ORDER BY for offset pagination
```

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

**Why TOP 21 for limit 20?** The extra row is fetched to determine if there's a next page (`hasNext`).

### PostgreSQL Optimizations

PostgreSQL uses efficient row value comparison when all ORDER BY columns have the same direction:

```typescript
// All columns DESC - uses row value comparison
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

// Efficient PostgreSQL query:
// SELECT * FROM posts
// WHERE (created_at, id) < ($1, $2)
// ORDER BY created_at DESC, id DESC
// LIMIT 20

// Mixed directions - uses compound conditions
const mixed = await paginateCursor(
  db.selectFrom('posts').selectAll(),
  {
    orderBy: [
      { column: 'created_at', direction: 'desc' },
      { column: 'id', direction: 'asc' } // Different direction
    ],
    limit: 20
  }
)

// Less efficient (but still correct):
// SELECT * FROM posts
// WHERE created_at < $1 OR (created_at = $1 AND id > $2)
// ORDER BY created_at DESC, id ASC
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

Both support cursor pagination with standard WHERE clauses:

```typescript
// MySQL cursor pagination
const page1 = await paginateCursor(
  db.selectFrom('posts').selectAll(),
  {
    orderBy: [{ column: 'id', direction: 'asc' }],
    limit: 20,
    dialect: 'mysql'
  }
)

// MySQL query:
// SELECT * FROM posts
// WHERE id > ?
// ORDER BY id ASC
// LIMIT 20
```

### Dialect Auto-Detection

The `dialect` parameter is optional. Kysera auto-detects the database type from your Kysely instance:

```typescript
import { Kysely, MssqlDialect } from 'kysely'

const db = new Kysely({
  dialect: new MssqlDialect(/* ... */)
})

// Auto-detected as MSSQL
const result = await paginate(
  db.selectFrom('users').selectAll().orderBy('id'),
  { page: 1, limit: 20 } // No dialect needed
)

// Explicit override (for testing or multi-database scenarios)
const result = await paginate(
  db.selectFrom('users').selectAll().orderBy('id'),
  { page: 1, limit: 20, dialect: 'mssql' } // Explicit
)
```

## Database Optimization

### Indexes for Cursor Pagination

```sql
-- PostgreSQL / MySQL / MSSQL
CREATE INDEX idx_posts_created_at ON posts (created_at DESC);

-- Multi-column (recommended for cursor pagination)
CREATE INDEX idx_posts_cursor ON posts (created_at DESC, id DESC);

-- With filtering (all databases)
CREATE INDEX idx_posts_status_created ON posts (status, created_at DESC, id DESC);

-- MSSQL with INCLUDE columns (for covering index)
CREATE INDEX idx_posts_cursor_mssql ON posts (created_at DESC, id DESC)
INCLUDE (title, content, author_id);
```

### Partial Indexes

```sql
-- PostgreSQL: Partial index for published posts only
CREATE INDEX idx_active_posts ON posts (created_at DESC, id DESC)
WHERE status = 'published';

-- MSSQL: Filtered index (similar to PostgreSQL partial index)
CREATE INDEX idx_active_posts_mssql ON posts (created_at DESC, id DESC)
WHERE status = 'published';
```

## Cursor Security

**NEW in v0.7.3**: Prevent cursor tampering with signing and encryption.

### Why Cursor Security Matters

Cursors are base64-encoded values that can be decoded and modified by clients. Without protection, malicious users can:

- Tamper with cursor values to access unauthorized data
- Skip to arbitrary positions in result sets
- Bypass pagination limits
- Access data outside their permission scope

### HMAC Signing (Recommended)

Sign cursors with HMAC to detect tampering:

```typescript
import { paginateCursor } from '@kysera/core'

const page1 = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' }
  ],
  limit: 20,
  security: {
    secret: process.env.CURSOR_SECRET!, // Minimum 16 characters
    algorithm: 'sha256' // Default: sha256, options: sha256 | sha384 | sha512
  }
})

// Cursor format: base64-cursor.signature
// Example: aWQ=:MTA=.a1b2c3d4e5f6...

// Next page with same security options
const page2 = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' }
  ],
  limit: 20,
  cursor: page1.pagination.nextCursor,
  security: {
    secret: process.env.CURSOR_SECRET!,
    algorithm: 'sha256'
  }
})
```

**Tampered cursors throw `BadRequestError`:**

```typescript
try {
  await paginateCursor(query, {
    orderBy: [...],
    cursor: tamperedCursor,
    security: { secret: process.env.CURSOR_SECRET! }
  })
} catch (error) {
  // BadRequestError: Invalid cursor signature: cursor has been tampered with
}
```

### AES-256-GCM Encryption (Maximum Security)

Encrypt cursors to hide their contents completely:

```typescript
const page1 = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [{ column: 'id', direction: 'asc' }],
  limit: 20,
  security: {
    secret: process.env.CURSOR_SECRET!,
    encrypt: true, // Enable AES-256-GCM encryption
    algorithm: 'sha384' // Optional: defaults to sha256
  }
})

// Cursor format: iv.encrypted.authTag.signature
// Values are completely hidden from client
```

**Benefits of encryption:**

- Cursors cannot be decoded by clients
- Completely hides pagination state
- Prevents information leakage
- Still detects tampering via HMAC signature

**Performance considerations:**

| Method          | Speed  | Security   | Cursor Size |
| --------------- | ------ | ---------- | ----------- |
| No security     | Fastest| None       | Smallest    |
| HMAC signing    | Fast   | High       | +64 bytes   |
| AES-256-GCM     | Good   | Maximum    | +128 bytes  |

### API Implementation with Security

```typescript
import { paginateCursor } from '@kysera/core'
import { BadRequestError } from '@kysera/core'

const CURSOR_SECRET = process.env.CURSOR_SECRET! // Set in environment

app.get('/api/posts', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100)
  const cursor = req.query.cursor || null

  try {
    const result = await paginateCursor(
      db.selectFrom('posts').selectAll(),
      {
        orderBy: [
          { column: 'created_at', direction: 'desc' },
          { column: 'id', direction: 'desc' }
        ],
        limit,
        cursor,
        security: {
          secret: CURSOR_SECRET,
          encrypt: true // Optional: use encryption for sensitive data
        }
      }
    )

    res.json({
      data: result.data,
      cursors: {
        next: result.pagination.nextCursor,
        prev: result.pagination.prevCursor
      }
    })
  } catch (error) {
    if (error instanceof BadRequestError) {
      // Tampered cursor detected
      return res.status(400).json({ error: 'Invalid cursor' })
    }
    throw error
  }
})
```

### Secret Key Management

**Best practices:**

```typescript
// ✅ Good: Environment variable
const secret = process.env.CURSOR_SECRET!

// ✅ Good: Key management service
const secret = await kms.getSecret('cursor-secret')

// ❌ Bad: Hard-coded secret
const secret = 'my-secret-key-12345' // Don't do this!

// ❌ Bad: Short secret
const secret = 'short' // Minimum 16 characters required
```

**Generate secure secrets:**

```bash
# Generate a secure 32-byte secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Or use OpenSSL
openssl rand -hex 32
```

**Add to environment:**

```bash
# .env
CURSOR_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

### Algorithm Selection

Choose HMAC algorithm based on security requirements:

```typescript
// SHA-256 (default) - Fast, secure for most use cases
security: { secret, algorithm: 'sha256' }

// SHA-384 - Higher security, slightly slower
security: { secret, algorithm: 'sha384' }

// SHA-512 - Maximum security, larger signatures
security: { secret, algorithm: 'sha512' }
```

### Migration from Unsigned Cursors

If you have existing unsigned cursors in client apps:

```typescript
// Option 1: Gradual migration with fallback
async function paginateWithMigration(query, options) {
  try {
    // Try with security first
    return await paginateCursor(query, {
      ...options,
      security: { secret: CURSOR_SECRET }
    })
  } catch (error) {
    if (error instanceof BadRequestError && options.cursor) {
      // Fallback: try without security for old cursors
      return await paginateCursor(query, {
        ...options,
        security: undefined
      })
    }
    throw error
  }
}

// Option 2: Version-prefixed cursors
const version = 'v2'
const cursor = `${version}:${signedCursor}`

// Parse and route based on version
if (cursor.startsWith('v2:')) {
  // Use new signed pagination
} else {
  // Use old unsigned pagination
}
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
if (totalCount > 1000) {
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
