---
sidebar_position: 2
title: '@kysera/core'
description: Core utilities package API reference
---

# @kysera/core

Minimal core utilities for database operations with Kysely.

**Version:** 0.8.0

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

// Cursor Security
export * from './cursor-crypto'

// Dialect Detection
export * from './dialect-detection'

// Plugin Base Utilities
export * from './plugin-base'

// Version
export * from './version'
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

Offset and cursor-based pagination with configurable bounds.

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

**Pagination Bounds:**
- `MAX_PAGE`: 10,000 (maximum page number)
- `MAX_LIMIT`: 10,000 (maximum items per page)
- Default limit: 20 items
- These bounds prevent excessive database load and memory usage

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

### Cursor Security

Cryptographic functions for securing pagination cursors with HMAC signing and AES-256-GCM encryption.

```typescript
import { signCursor, verifyCursor, encryptCursor, decryptCursor } from '@kysera/core'

// Sign a cursor with HMAC
const signed = signCursor(cursor, 'my-secret-key')

// Verify and extract cursor
const original = verifyCursor(signed, 'my-secret-key')

// Encrypt cursor with AES-256-GCM
const encrypted = encryptCursor(cursor, 'my-secret-key')

// Decrypt cursor
const decrypted = decryptCursor(encrypted, 'my-secret-key')
```

**Exports:**
- `signCursor(cursor, secret, algorithm?)` - Sign cursor with HMAC
- `verifyCursor(signedCursor, secret, algorithm?)` - Verify and extract cursor
- `encryptCursor(cursor, secret)` - Encrypt cursor with AES-256-GCM
- `decryptCursor(encryptedCursor, secret)` - Decrypt cursor
- `CursorSecurityOptions` - Security options type

### Dialect Detection

Automatic database dialect detection from Kysely instances.

```typescript
import { detectDialect } from '@kysera/core'

const dialect = detectDialect(db)
// Returns: 'postgres' | 'mysql' | 'sqlite' | 'mssql'

// Use for dialect-specific logic
if (dialect === 'postgres') {
  // PostgreSQL-specific code
}
```

**Exports:**
- `detectDialect(executor)` - Detect database dialect from Kysely instance
- `Dialect` - Type for supported dialects

### Version

Package version information and utilities.

```typescript
import { VERSION, getPackageVersion, formatVersionString, isDevelopmentVersion } from '@kysera/core'

console.log(VERSION) // '0.8.0'
console.log(getPackageVersion()) // '0.8.0'
console.log(formatVersionString('v')) // 'v0.8.0'
console.log(isDevelopmentVersion()) // false (true in development)
```

**Exports:**
- `VERSION` - Current package version constant
- `getPackageVersion()` - Get package version
- `formatVersionString(prefix?)` - Format version with optional prefix
- `isDevelopmentVersion()` - Check if running in development mode

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
  /** Maximum rows to return (default: 20, max: 10,000) */
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
- Limit bounds: 1-10,000 (prevents accidental large queries)
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

## Plugin Base Utilities

Core provides base abstractions for creating Kysera plugins, reducing boilerplate and ensuring consistent behavior across the plugin ecosystem.

### BasePluginOptions

Common options shared by all Kysera plugins.

```typescript
import type { BasePluginOptions, BasePluginOptionsWithPrimaryKey } from '@kysera/core'

// Define plugin-specific options by extending base options
interface MyPluginOptions extends BasePluginOptions {
  customOption: string
  anotherOption?: number
}

// With primary key support
interface AuditPluginOptions extends BasePluginOptionsWithPrimaryKey {
  auditTable?: string
  captureOldValues?: boolean
}
```

**BasePluginOptions Interface:**

```typescript
interface BasePluginOptions extends TableFilterConfig {
  /** Logger for plugin operations. @default silentLogger */
  logger?: KyseraLogger
  /** Tables to apply plugin to (whitelist) */
  tables?: string[]
  /** Tables to exclude from plugin processing */
  excludeTables?: string[]
}

interface BasePluginOptionsWithPrimaryKey extends BasePluginOptions {
  /** Primary key column name. @default 'id' */
  primaryKeyColumn?: string
}
```

### createPluginConfig()

Creates a resolved plugin configuration with defaults applied.

```typescript
import { createPluginConfig, type BasePluginOptionsWithPrimaryKey } from '@kysera/core'

interface SoftDeleteOptions extends BasePluginOptionsWithPrimaryKey {
  deletedAtColumn?: string
}

export function softDeletePlugin(options: SoftDeleteOptions = {}): Plugin {
  const config = createPluginConfig('soft-delete', options)

  // Access resolved configuration
  config.logger.debug('Initializing soft-delete plugin')
  console.log(config.primaryKeyColumn) // 'id' (default)
  console.log(config.excludeTables)    // [] (default)

  // Use config.tables and config.excludeTables to filter tables
  // (implement your own shouldApplyToTable logic as needed)
}
```

**Returns:**

```typescript
interface ResolvedPluginConfig {
  readonly name: string
  readonly logger: KyseraLogger
  readonly tables: string[] | undefined
  readonly excludeTables: string[]
  readonly primaryKeyColumn: string
}
```

### createPluginMetadata()

Creates plugin metadata with optional defaults.

```typescript
import { createPluginMetadata, PLUGIN_PRIORITIES } from '@kysera/core'

const metadata = createPluginMetadata('soft-delete', '0.8.0', {
  priority: PLUGIN_PRIORITIES.FILTER,
  conflictsWith: ['hard-delete-only'],
  dependencies: ['timestamps']
})
```

**Returns:**

```typescript
interface PluginMetadata {
  name: string
  version: string
  dependencies?: readonly string[]
  priority?: number
  conflictsWith?: readonly string[]
}
```

### PLUGIN_PRIORITIES

Recommended priority values for different plugin types. Higher priority = runs first.

```typescript
import { PLUGIN_PRIORITIES, type PluginPriority } from '@kysera/core'

const priorities = {
  SECURITY: 1000,  // RLS, auth filters - run first
  FILTER: 500,     // Soft delete, tenant isolation
  TRANSFORM: 100,  // Timestamps, data transformation
  AUDIT: 50,       // Audit logging, change tracking
  DEFAULT: 0,      // Default priority
  DEBUG: -100      // Query logging, profiling - run last
}

// Type for priority values
type PluginPriority = 1000 | 500 | 100 | 50 | 0 | -100
```

**Execution Order:**

1. **SECURITY (1000)** - RLS, authentication filters
2. **FILTER (500)** - Soft delete, tenant isolation
3. **TRANSFORM (100)** - Timestamps, data transformation
4. **AUDIT (50)** - Audit logging, change tracking
5. **DEFAULT (0)** - Plugins without explicit priority
6. **DEBUG (-100)** - Query logging, profiling

**Example:**

```typescript
import { PLUGIN_PRIORITIES, createPluginMetadata } from '@kysera/core'

// Security plugin - runs first
const rlsMetadata = createPluginMetadata('rls', '1.0.0', {
  priority: PLUGIN_PRIORITIES.SECURITY
})

// Audit plugin - runs after transforms
const auditMetadata = createPluginMetadata('audit', '1.0.0', {
  priority: PLUGIN_PRIORITIES.AUDIT
})
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
