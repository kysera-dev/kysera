---
sidebar_position: 2
title: '@kysera/core'
description: Core utilities package API reference
---

# @kysera/core

Minimal core utilities for database operations with Kysely.

## Installation

```bash
npm install @kysera/core
```

## Overview

**Dependencies:** None (peer: kysely >=0.28.8)
**Database Support:** PostgreSQL, MySQL, SQLite

## Exports

```typescript
// Error handling
export * from './errors'
export * from './error-codes'

// Pagination
export * from './pagination'

// Query Helpers
export * from './helpers'

// Types and Logger
export * from './types'
export * from './logger'
```

:::info Modules Moved to Separate Packages
The following modules have been moved to dedicated packages for better tree-shaking and separation of concerns:

- **Debug utilities** → [`@kysera/debug`](/docs/api/debug)
- **Health checks, retry, circuit breaker, shutdown** → [`@kysera/infra`](/docs/api/infra)
- **Testing utilities** → [`@kysera/testing`](/docs/api/testing)
  :::

## Modules

### [Errors](/docs/api/core/errors)

Multi-database error parsing with typed errors.

```typescript
import { parseDatabaseError, UniqueConstraintError } from '@kysera/core'

const error = parseDatabaseError(rawError, 'postgres')
if (error instanceof UniqueConstraintError) {
  console.log(error.columns) // ['email']
}
```

### [Pagination](/docs/api/core/pagination)

Offset and cursor-based pagination.

```typescript
import { paginate, paginateCursor } from '@kysera/core'

// Offset pagination
const page = await paginate(query, { page: 1, limit: 20 })

// Cursor pagination
const result = await paginateCursor(query, {
  orderBy: [{ column: 'created_at', direction: 'desc' }],
  limit: 20
})
```

### Query Helpers

Lightweight utility functions for common query patterns.

```typescript
import { applyOffset, applyDateRange } from '@kysera/core'

// Lightweight offset pagination (without COUNT(*))
const users = await applyOffset(db.selectFrom('users').selectAll().orderBy('id'), {
  limit: 20,
  offset: 0
}).execute()

// Date range filtering
const posts = await applyDateRange(db.selectFrom('posts').selectAll(), 'created_at', {
  from: new Date('2024-01-01'),
  to: new Date('2024-12-31')
}).execute()

// Combine helpers for paginated date-filtered results
const analytics = await applyOffset(
  applyDateRange(db.selectFrom('events').selectAll().orderBy('created_at', 'desc'), 'created_at', {
    from: startDate,
    to: endDate
  }),
  { limit: 100, offset: 0 }
).execute()
```

### [Logger](/docs/api/core/logger)

Configurable logging interface.

```typescript
import { consoleLogger, silentLogger, createPrefixedLogger } from '@kysera/core'

const myLogger = createPrefixedLogger('[myapp]', consoleLogger)
```

## Types

### Executor

```typescript
type Executor<DB> = Kysely<DB> | Transaction<DB>
```

### Common Interfaces

```typescript
interface Timestamps {
  created_at: Date
  updated_at?: Date
}

interface SoftDelete {
  deleted_at: Date | null
}

interface AuditFields {
  created_by?: number
  updated_by?: number
}
```

### Logger Interface

```typescript
interface KyseraLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}
```

### Query Helper Interfaces

```typescript
interface OffsetOptions {
  /** Maximum rows to return (default: 20, max: 100) */
  limit?: number
  /** Rows to skip (default: 0) */
  offset?: number
}

interface DateRangeOptions {
  /** Start of date range (inclusive) */
  from?: Date
  /** End of date range (inclusive) */
  to?: Date
}
```

## Query Helpers API

### applyOffset

Apply limit/offset to a query without counting total. Lightweight alternative to `paginate()`.

```typescript
function applyOffset<DB, TB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options?: OffsetOptions
): SelectQueryBuilder<DB, TB, O>
```

**Features:**

- No COUNT(\*) query (~50% faster than paginate on large tables)
- Limit bounds: 1-100 (prevents accidental large queries)
- Offset must be non-negative
- SQLite compatible (auto-adds LIMIT when OFFSET is used)

**Use cases:** Infinite scroll, "Load More" buttons, simple lists without total count.

### applyDateRange

Apply date range filter to a query.

```typescript
function applyDateRange<DB, TB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  column: string,
  options?: DateRangeOptions
): SelectQueryBuilder<DB, TB, O>
```

**Features:**

- Both boundaries inclusive (`>=` and `<=`)
- Handles Date objects (converts to ISO string)
- Returns unchanged query if neither from nor to provided

### executeCount

Execute a count query and return the numeric result.

```typescript
async function executeCount<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>
): Promise<number>
```

**Example:**

```typescript
import { executeCount } from '@kysera/core'

// Count all active users
const count = await executeCount(db.selectFrom('users').where('status', '=', 'active'))
console.log(`Active users: ${count}`)
```

### executeGroupedCount

Execute a grouped count query and return counts by group.

```typescript
async function executeGroupedCount<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  groupColumn: string
): Promise<Record<string, number>>
```

**Example:**

```typescript
import { executeGroupedCount } from '@kysera/core'

// Count users by status
const countsByStatus = await executeGroupedCount(db.selectFrom('users'), 'status')
// { active: 150, inactive: 23, pending: 12 }
```

### paginateCursorSimple

Simple cursor-based pagination without complex ordering requirements.

```typescript
async function paginateCursorSimple<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: SimpleCursorOptions
): Promise<CursorPaginatedResult<O>>
```

**Example:**

```typescript
import { paginateCursorSimple } from '@kysera/core'

const result = await paginateCursorSimple(db.selectFrom('posts').selectAll(), {
  limit: 20,
  cursor: lastCursor,
  cursorColumn: 'id'
})
// { items: [...], nextCursor: '...', hasMore: true }
```

## Migration Guide

If you're upgrading from an earlier version where these utilities were in `@kysera/core`:

```typescript
// Before (deprecated)
import { checkDatabaseHealth, withRetry, testInTransaction } from '@kysera/core'

// After
import { checkDatabaseHealth, withRetry, CircuitBreaker } from '@kysera/infra'
import { testInTransaction, createFactory } from '@kysera/testing'
import { withDebug, QueryProfiler } from '@kysera/debug'
```
