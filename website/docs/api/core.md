---
sidebar_position: 2
title: "@kysera/core"
description: Core utilities package API reference
---

# @kysera/core

Minimal core utilities for database operations with Kysely.

## Installation

```bash
npm install @kysera/core
```

## Overview

**Version:** 0.7.0
**Bundle Size:** ~8 KB (minified)
**Dependencies:** None (peer: kysely >=0.28.8)
**Database Support:** PostgreSQL, MySQL, SQLite

## Exports

```typescript
// Error handling
export * from './errors'
export * from './error-codes'

// Pagination
export * from './pagination'

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
  console.log(error.columns)  // ['email']
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
