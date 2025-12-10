---
sidebar_position: 2
title: Debug (Moved)
description: Debug utilities have been moved to @kysera/debug
---

# Debug Utilities

:::warning Module Moved
Debug utilities have been moved to **[@kysera/debug](/docs/api/debug)** for better separation of concerns and tree-shaking.

```bash
npm install @kysera/debug
```

```typescript
// Before (deprecated)
import { withDebug, QueryProfiler, formatSQL } from '@kysera/core';

// After
import { withDebug, QueryProfiler, formatSQL } from '@kysera/debug';
```

See the full documentation at **[@kysera/debug](/docs/api/debug)**.
:::

---

## Legacy Documentation

The following documentation is kept for reference. For current implementation, see [@kysera/debug](/docs/api/debug).

---

Query debugging, logging, and performance profiling.

## withDebug

Wrap a Kysely instance with debug capabilities.

```typescript
function withDebug<DB>(
  db: Kysely<DB>,
  options?: DebugOptions
): Kysely<DB> & {
  getMetrics: () => QueryMetrics[]
  clearMetrics: () => void
}
```

### DebugOptions

```typescript
interface DebugOptions {
  logQuery?: boolean           // Log queries (default: true)
  logParams?: boolean          // Log parameters (default: false)
  slowQueryThreshold?: number  // Slow query threshold in ms (default: 100)
  onSlowQuery?: (sql: string, duration: number) => void
  logger?: KyseraLogger        // Logger instance
  maxMetrics?: number          // Max metrics to keep (default: 1000)
}
```

### Example

```typescript
import { withDebug } from '@kysera/core'

const debugDb = withDebug(db, {
  logQuery: true,
  logParams: process.env.NODE_ENV === 'development',
  slowQueryThreshold: 100,
  onSlowQuery: (sql, duration) => {
    console.warn(`Slow query (${duration}ms): ${sql}`)
  }
})

// Use normally
await debugDb.selectFrom('users').selectAll().execute()

// Get metrics
const metrics = debugDb.getMetrics()
console.log(`Executed ${metrics.length} queries`)

// Clear metrics
debugDb.clearMetrics()
```

## QueryMetrics

```typescript
interface QueryMetrics {
  sql: string
  parameters?: unknown[]
  duration: number      // In milliseconds
  timestamp: Date
  success: boolean
  error?: string
}
```

## QueryProfiler

Class for aggregating query metrics.

```typescript
class QueryProfiler {
  constructor(options?: { maxQueries?: number })

  record(metric: QueryMetrics): void
  clear(): void

  getSummary(): {
    totalQueries: number
    totalDuration: number
    averageDuration: number
    slowestQuery: QueryMetrics | null
    fastestQuery: QueryMetrics | null
    queries: QueryMetrics[]
  }
}
```

### Example

```typescript
import { QueryProfiler } from '@kysera/core'

const profiler = new QueryProfiler({ maxQueries: 100 })

// Record metrics
profiler.record({
  sql: 'SELECT * FROM users',
  duration: 15,
  timestamp: new Date(),
  success: true
})

// Get summary
const summary = profiler.getSummary()
console.log(`Average: ${summary.averageDuration}ms`)
console.log(`Slowest: ${summary.slowestQuery?.sql}`)
```

## formatSQL

Format SQL for better readability.

```typescript
function formatSQL(sql: string): string
```

### Example

```typescript
import { formatSQL } from '@kysera/core'

const sql = 'SELECT id, name, email FROM users WHERE status = $1 ORDER BY created_at DESC'
console.log(formatSQL(sql))
// SELECT id, name, email
// FROM users
// WHERE status = $1
// ORDER BY created_at DESC
```

## Performance

The debug wrapper adds minimal overhead:

| Operation | Overhead |
|-----------|----------|
| Per query | ~0.1-0.2ms |
| Memory | Circular buffer (configurable) |

The circular buffer (default 1000 entries) prevents memory leaks in long-running applications.

## Best Practices

### 1. Use in Development

```typescript
const debugDb = process.env.NODE_ENV === 'development'
  ? withDebug(db, { logQuery: true, logParams: true })
  : db
```

### 2. Monitor Slow Queries

```typescript
const debugDb = withDebug(db, {
  slowQueryThreshold: 100,
  onSlowQuery: (sql, duration) => {
    metrics.increment('slow_queries')
    logger.warn('Slow query detected', { sql, duration })
  }
})
```

### 3. Limit Memory Usage

```typescript
const debugDb = withDebug(db, {
  maxMetrics: 100  // Keep only last 100 queries
})
```
