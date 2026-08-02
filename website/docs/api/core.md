---
sidebar_position: 2
title: '@kysera/core'
description: Core utilities package API reference
---

# @kysera/core

Minimal core utilities for database operations with Kysely.

**Version:** 0.9.0

## Installation

```bash
npm install @kysera/core
```

## Overview

**Dependencies:** `@kysera/executor` (declared as a runtime dependency, but used for type imports only — it adds no runtime code paths) (peer: kysely >=0.29.0)
**Database Support:** PostgreSQL, MySQL, SQLite, MSSQL

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

// Cursor Security (only the type is re-exported from main entry)
export type { CursorSecurityOptions } from './cursor-crypto'
// Functions available via '@kysera/core/cursor-crypto' subpath import

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

The unified error-code system is also importable:

```typescript
import { ErrorCodes, isValidErrorCode, getErrorCategory, type ErrorCode } from '@kysera/core'

ErrorCodes.VALIDATION_UNIQUE_VIOLATION // 'VALIDATION_UNIQUE_VIOLATION'
isValidErrorCode('DB_TIMEOUT') // true (type guard narrowing to ErrorCode)
getErrorCategory('DB_TIMEOUT') // 'DB'
```

- `ErrorCodes` - Const object with every unified error code (`DB_*`, `VALIDATION_*`, `RESOURCE_*`, `MIGRATION_*`, `PLUGIN_*`, ...)
- `ErrorCode` - Union type of all code strings
- `isValidErrorCode(code)` - Type guard for unknown strings
- `getErrorCategory(code)` - Returns the code's category prefix (e.g. `'DB'`, `'VALIDATION'`; `'UNKNOWN'` if unprefixed)

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

**Pagination Bounds** (internal constants — enforced automatically, not exported):
- Maximum page number: 1,000,000
- Maximum items per page: 10,000
- Default limit: 20 items
- `limit: 0` is honored as a special case: no rows are fetched (`data: []`); `paginate()` still runs the COUNT query and reports `totalPages: 0`
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

:::caution Secret length requirement
All cursor-crypto functions **throw** if the secret is shorter than 32 characters. Generate a strong secret (e.g. `openssl rand -hex 32`) and provide it via configuration.
:::

```typescript
import { signCursor, verifyCursor, encryptCursor, decryptCursor } from '@kysera/core/cursor-crypto'

// Secret must be at least 32 characters (throws otherwise)
const secret = process.env.CURSOR_SECRET! // e.g. 64 hex chars from `openssl rand -hex 32`

// Sign a cursor with HMAC
const signed = signCursor(cursor, secret)

// Verify and extract cursor
const original = verifyCursor(signed, secret)

// Encrypt cursor with AES-256-GCM
const encrypted = encryptCursor(cursor, secret)

// Decrypt cursor
const decrypted = decryptCursor(encrypted, secret)
```

**Exports:**
- `signCursor(cursor, secret, algorithm?)` - Sign cursor with HMAC
- `verifyCursor(signedCursor, secret, algorithm?)` - Verify and extract cursor
- `encryptCursor(cursor, secret)` - Encrypt cursor with AES-256-GCM
- `decryptCursor(encryptedCursor, secret)` - Decrypt cursor
- `CursorSecurityOptions` - Security options type

**CursorSecurityOptions** (accepted by `paginateCursor` via the `security` option):

```typescript
interface CursorSecurityOptions {
  /** Secret key for signing/encryption - MUST be at least 32 characters (functions throw otherwise) */
  secret: string
  /** Enable AES-256-GCM encryption in addition to HMAC signing (default: false) */
  encrypt?: boolean
  /** HMAC algorithm for signing (default: 'sha256') */
  algorithm?: 'sha256' | 'sha384' | 'sha512'
}
```

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

Package version information.

```typescript
import { VERSION } from '@kysera/core'

console.log(VERSION) // '0.9.0'
```

**Exports:**
- `VERSION` - Current package version constant

## Types

### Executor

```typescript
type Executor<DB> = Kysely<DB> | Transaction<DB>
```

### AnyExecutor

```typescript
type AnyExecutor<DB> = Kysely<DB> | Transaction<DB> | (Kysely<DB> & KyseraExecutorMarker<DB>)
```

The correct parameter type for functions that should accept plugin-aware executors as well as plain Kysely instances and transactions. Use it instead of `Executor<DB>` whenever a `KyseraExecutor` (from `@kysera/executor`) may be passed in:

```typescript
import type { AnyExecutor } from '@kysera/core'

async function findUser(db: AnyExecutor<Database>, userId: number) {
  return db.selectFrom('users').where('id', '=', userId).selectAll().executeTakeFirst()
}
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
  trace(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  fatal(message: string, ...args: unknown[]): void
}
```

### Query Helper Interfaces

```typescript
interface OffsetOptions {
  /** Maximum rows to return (max: 100). No default - omitting it applies no LIMIT */
  limit?: number
  /** Rows to skip (default: 0) */
  offset?: number
  /** Database dialect - lets the SQLite OFFSET workaround be skipped for other databases */
  dialect?: Dialect
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

<!-- doc-snippet: skip -->
```typescript
function applyOffset<DB, TB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options?: OffsetOptions
): SelectQueryBuilder<DB, TB, O>
```

**Features:**

- No COUNT(\*) query (~50% faster than paginate on large tables)
- No default limit — omitting `limit` leaves the query unlimited; when provided, it is clamped to 1-100 (prevents accidental large queries)
- Offset must be non-negative
- SQLite compatible: when `offset` is used without `limit`, a large LIMIT is auto-added because SQLite requires LIMIT with OFFSET. This workaround also applies when the dialect is unknown (safe default) — pass `dialect` to skip it for known non-SQLite databases

**Use cases:** Infinite scroll, "Load More" buttons, simple lists without total count.

### formatTimestampForDb

Format a `Date` as a database-compatible timestamp string.

<!-- doc-snippet: skip -->
```typescript
function formatTimestampForDb(date?: Date, dialect?: Dialect): string
```

**Dialect-specific output:**

- `mysql` / `mssql`: `YYYY-MM-DD HH:MM:SS.mmm` — these databases reject ISO 8601's `T` separator and `Z` suffix in DATETIME/TIMESTAMP columns
- `postgres` / `sqlite` (and the default): ISO 8601 (`YYYY-MM-DDTHH:MM:SS.mmmZ`)

**Example:**

```typescript
import { formatTimestampForDb } from '@kysera/core'

formatTimestampForDb() // '2024-01-15T10:30:00.000Z' (defaults: now, ISO 8601)
formatTimestampForDb(new Date(), 'mysql') // '2024-01-15 10:30:00.000'
formatTimestampForDb(new Date(), 'postgres') // '2024-01-15T10:30:00.000Z'
```

Use this instead of `new Date().toISOString()` when writing timestamps manually, so the format stays correct across dialects.

### applyDateRange

Apply date range filter to a query.

<!-- doc-snippet: skip -->
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

<!-- doc-snippet: skip -->
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

<!-- doc-snippet: skip -->
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

Simple cursor-based pagination that uses `id` column in ascending order. A convenience wrapper around `paginateCursor`.

<!-- doc-snippet: skip -->
```typescript
async function paginateCursorSimple<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options?: PaginationOptions
): Promise<PaginatedResult<O>>
```

**Example:**

```typescript
import { paginateCursorSimple } from '@kysera/core'

const result = await paginateCursorSimple(db.selectFrom('posts').selectAll(), {
  limit: 20,
  cursor: lastCursor
})
// { data: [...], pagination: { limit: 20, hasNext: true, hasPrev: true, nextCursor: '...', prevCursor: '...' } }
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

<!-- doc-snippet: skip -->
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

  // Use the exported shouldApplyToTable() helper to honor tables/excludeTables:
  // if (!shouldApplyToTable(tableName, config)) return qb
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

### shouldApplyToTable()

Check whether a plugin should process a given table, honoring whitelist/blacklist configuration. Use this instead of hand-rolling table filtering in custom plugins.

<!-- doc-snippet: skip -->
```typescript
function shouldApplyToTable(tableName: string, config: TableFilterConfig): boolean

interface TableFilterConfig {
  /** Tables to apply to (whitelist). When non-empty, takes precedence over excludeTables */
  tables?: string[]
  /** Tables to exclude (blacklist). Only consulted when no whitelist is set */
  excludeTables?: string[]
}
```

**Rules:** a non-empty `tables` whitelist wins (only listed tables match, `excludeTables` is ignored); otherwise a non-empty `excludeTables` blacklist rejects its entries; with neither set (or empty arrays), every table matches.

**Example:**

<!-- doc-snippet: skip -->
```typescript
import { shouldApplyToTable, type TableFilterConfig } from '@kysera/core'

const config: TableFilterConfig = { excludeTables: ['migrations', 'audit_logs'] }

shouldApplyToTable('users', config)      // true
shouldApplyToTable('migrations', config) // false

// In a plugin's interceptQuery:
interceptQuery(qb, context) {
  if (!shouldApplyToTable(context.table, config)) return qb
  // ... apply plugin logic
}
```

Because `BasePluginOptions` extends `TableFilterConfig`, the config object produced by `createPluginConfig()` can be passed straight in.

### createPluginMetadata()

Creates plugin metadata with optional defaults.

```typescript
import { createPluginMetadata, PLUGIN_PRIORITIES } from '@kysera/core'

const metadata = createPluginMetadata('soft-delete', '0.9.0', {
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

<!-- doc-snippet: skip -->
```typescript
import { PLUGIN_PRIORITIES, type PluginPriority } from '@kysera/core'

const priorities = {
  CONTEXT: 1100,   // Schema routing, request scoping - run before security
  SECURITY: 1000,  // RLS, auth filters - run first among enforcement tiers
  FILTER: 500,     // Soft delete, tenant isolation
  TRANSFORM: 100,  // Timestamps, data transformation
  AUDIT: 50,       // Audit logging, change tracking
  DEFAULT: 0,      // Default priority
  DEBUG: -100      // Query logging, profiling - run last
}

// Type for priority values
type PluginPriority = 1100 | 1000 | 500 | 100 | 50 | 0 | -100
```

**Execution Order:**

1. **CONTEXT (1100)** - Schema routing, request scoping (e.g. `@kysera/executor`'s `schemaPlugin`) — runs before security so security plugins can read the resolved context (such as `metadata.__resolvedSchema`)
2. **SECURITY (1000)** - RLS, authentication filters
3. **FILTER (500)** - Soft delete, tenant isolation
4. **TRANSFORM (100)** - Timestamps, data transformation
5. **AUDIT (50)** - Audit logging, change tracking
6. **DEFAULT (0)** - Plugins without explicit priority
7. **DEBUG (-100)** - Query logging, profiling

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

<!-- doc-snippet: skip -->
```typescript
// Before (deprecated)
import { checkDatabaseHealth, withRetry, testInTransaction } from '@kysera/core'

// After
import { checkDatabaseHealth, withRetry, CircuitBreaker } from '@kysera/infra'
import { testInTransaction, createFactory } from '@kysera/testing'
import { withDebug, QueryProfiler } from '@kysera/debug'
```
