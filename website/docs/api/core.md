---
sidebar_position: 2
title: "@kysera/core"
description: Core utilities package API reference
---

# @kysera/core

Production-ready core utilities for database operations with Kysely.

## Installation

```bash
npm install @kysera/core
```

## Overview

**Version:** 0.5.1
**Bundle Size:** ~24 KB (minified)
**Dependencies:** None (peer: kysely >=0.28.8)
**Database Support:** PostgreSQL, MySQL, SQLite

## Exports

```typescript
// Error handling
export * from './errors'
export * from './error-codes'

// Utilities
export * from './debug'
export * from './health'
export * from './pagination'
export * from './retry'
export * from './shutdown'
export * from './testing'
export * from './types'
export * from './logger'
```

## Modules

### [Errors](/docs/api/core/errors)

Multi-database error parsing with typed errors.

```typescript
import { parseDatabaseError, UniqueConstraintError } from '@kysera/core'

const error = parseDatabaseError(rawError, 'postgres')
if (error instanceof UniqueConstraintError) {
  console.log(error.columns)  // ['email']
}
```

### [Debug](/docs/api/core/debug)

Query debugging, logging, and profiling.

```typescript
import { withDebug } from '@kysera/core'

const debugDb = withDebug(db, {
  logQuery: true,
  slowQueryThreshold: 100,
  onSlowQuery: (sql, duration) => console.warn(`Slow: ${sql}`)
})
```

### [Health](/docs/api/core/health)

Database health checks and monitoring.

```typescript
import { checkDatabaseHealth, createMetricsPool } from '@kysera/core'

const health = await checkDatabaseHealth(db, metricsPool)
// { status: 'healthy', checks: {...}, timestamp: Date }
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

### [Retry](/docs/api/core/retry)

Retry logic with exponential backoff and circuit breaker.

```typescript
import { withRetry, CircuitBreaker } from '@kysera/core'

const result = await withRetry(() => operation(), {
  maxAttempts: 3,
  delayMs: 1000,
  backoff: true
})
```

### [Testing](/docs/api/core/testing)

Testing utilities for transaction-based tests.

```typescript
import { testInTransaction, createFactory } from '@kysera/core'

await testInTransaction(db, async (trx) => {
  // Test code - auto rolls back
})
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
