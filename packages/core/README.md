# @kysera/core

> Minimal core utilities for Kysera - Database error handling, pagination, types, and logging interface.

[![Version](https://img.shields.io/npm/v/@kysera/core.svg)](https://www.npmjs.com/package/@kysera/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## 🎯 Features

- ✅ **Zero Runtime Dependencies** - Only peer dependency on Kysely
- ✅ **Multi-Database Error Parsing** - PostgreSQL, MySQL, SQLite, MSSQL with unified error hierarchy
- ✅ **Unified Error Codes** - Consistent error codes across the entire Kysera ecosystem
- ✅ **Pagination** - Both offset-based and cursor-based strategies
- ✅ **Type Utilities** - Executor, Timestamps, and common database types
- ✅ **Logger Interface** - Shared logger interface for ecosystem consistency
- ✅ **100% Type Safe** - Full TypeScript support with strict mode
- ✅ **Production Ready** - Minimal, focused, battle-tested

## 📦 Related Packages

Core functionality has been split into focused packages:

- **[@kysera/infra](../infra)** - Health checks, retry logic, circuit breaker, graceful shutdown, pool metrics
- **[@kysera/testing](../testing)** - Testing utilities, factories, database cleanup, transaction helpers
- **[@kysera/debug](../debug)** - Query logging, profiling, SQL formatting, performance tracking
- **[@kysera/dal](../dal)** - Functional Data Access Layer with composable queries

## 📥 Installation

```bash
# npm
npm install @kysera/core kysely

# pnpm
pnpm add @kysera/core kysely

# bun
bun add @kysera/core kysely

# deno
import * as core from "npm:@kysera/core"
```

## 🚀 Quick Start

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import {
  parseDatabaseError,
  UniqueConstraintError,
  ForeignKeyError,
  paginate,
  paginateCursor,
  type Executor
} from '@kysera/core'

// Create database connection
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  max: 10
})

const db = new Kysely({
  dialect: new PostgresDialect({ pool })
})

// Handle database errors
try {
  await db.insertInto('users').values({ email: 'duplicate@example.com' }).execute()
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')
  if (dbError instanceof UniqueConstraintError) {
    console.error(`Duplicate: ${dbError.columns.join(', ')}`)
  }
}

// Paginate results (offset-based)
const users = await paginate(db.selectFrom('users').selectAll().orderBy('created_at', 'desc'), {
  page: 1,
  limit: 20
})

// Cursor-based pagination for large datasets
const posts = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [{ column: 'id', direction: 'asc' }],
  limit: 20
})
```

---

## 📚 Table of Contents

1. [Error Handling](#-error-handling)
   - [Error Hierarchy](#error-hierarchy)
   - [Multi-Database Error Parser](#multi-database-error-parser)
   - [Error Codes](#error-codes)
   - [Usage Examples](#usage-examples)
2. [Pagination](#-pagination)
   - [Offset Pagination](#offset-pagination)
   - [Cursor Pagination](#cursor-pagination)
   - [Performance Comparison](#performance-comparison)
   - [MSSQL-Specific Pagination Notes](#mssql-specific-pagination-notes)
3. [Type Utilities](#-type-utilities)
   - [Executor Type](#executor-type)
   - [Common Column Types](#common-column-types)
4. [Logger Interface](#-logger-interface)
5. [API Reference](#-api-reference)
6. [Migration Notes](#-migration-notes)
7. [Multi-Database Testing](#-multi-database-testing)
8. [Best Practices](#-best-practices)

---

## 🚨 Error Handling

The error handling system provides unified error parsing across PostgreSQL, MySQL, SQLite, and MSSQL with a rich error hierarchy.

### Error Hierarchy

```typescript
DatabaseError (base class)
├── UniqueConstraintError
├── ForeignKeyError
├── NotNullError
├── CheckConstraintError
├── NotFoundError
└── BadRequestError
```

### Multi-Database Error Parser

The `parseDatabaseError` function automatically detects and parses database-specific errors into a unified format.

#### PostgreSQL Error Codes

| Error Code | Type                  | Description                      |
| ---------- | --------------------- | -------------------------------- |
| `23505`    | UniqueConstraintError | UNIQUE constraint violation      |
| `23503`    | ForeignKeyError       | FOREIGN KEY constraint violation |
| `23502`    | NotNullError          | NOT NULL constraint violation    |
| `23514`    | CheckConstraintError  | CHECK constraint violation       |

#### MySQL Error Codes

| Error Code                | Type                  | Description            |
| ------------------------- | --------------------- | ---------------------- |
| `ER_DUP_ENTRY`            | UniqueConstraintError | Duplicate entry        |
| `ER_DUP_KEY`              | UniqueConstraintError | Duplicate key          |
| `ER_NO_REFERENCED_ROW`    | ForeignKeyError       | Foreign key violation  |
| `ER_ROW_IS_REFERENCED`    | ForeignKeyError       | Foreign key violation  |
| `ER_BAD_NULL_ERROR`       | NotNullError          | NOT NULL violation     |
| `ER_NO_DEFAULT_FOR_FIELD` | NotNullError          | Required field missing |

#### SQLite Error Messages

| Message Pattern                 | Type                  | Description           |
| ------------------------------- | --------------------- | --------------------- |
| `UNIQUE constraint failed`      | UniqueConstraintError | Unique violation      |
| `FOREIGN KEY constraint failed` | ForeignKeyError       | Foreign key violation |
| `NOT NULL constraint failed`    | NotNullError          | NOT NULL violation    |
| `CHECK constraint failed`       | CheckConstraintError  | CHECK violation       |

#### MSSQL Error Codes

| Error Code   | Type                  | Description                  |
| ------------ | --------------------- | ---------------------------- |
| `2627`       | UniqueConstraintError | UNIQUE constraint violation  |
| `2601`       | UniqueConstraintError | Duplicate key index          |
| `515`        | NotNullError          | NOT NULL constraint violation|
| `547`        | ForeignKeyError       | FOREIGN KEY violation        |

### Error Codes

@kysera/core provides a comprehensive, unified error code system used across the entire Kysera ecosystem:

```typescript
import { ErrorCodes, getErrorCategory, isValidErrorCode } from '@kysera/core'

// All error codes follow the format: CATEGORY_SUBCATEGORY_SPECIFIC
// Examples:
ErrorCodes.DB_CONNECTION_FAILED
ErrorCodes.VALIDATION_UNIQUE_VIOLATION
ErrorCodes.MIGRATION_UP_FAILED
ErrorCodes.PLUGIN_INIT_FAILED

// Utility functions
const category = getErrorCategory('DB_CONNECTION_FAILED') // 'DB'
const isValid = isValidErrorCode('DB_CONNECTION_FAILED') // true
```

**Error Code Categories:**

- `DB_*` - Database errors (connection, query, transaction)
- `VALIDATION_*` - Validation and constraint errors
- `RESOURCE_*` - Resource errors (not found, conflict)
- `MIGRATION_*` - Migration errors
- `PLUGIN_*` - Plugin system errors
- `AUDIT_*` - Audit system errors
- `CONFIG_*` - Configuration errors
- `FS_*` - File system errors
- `NETWORK_*` - Network errors

### Usage Examples

#### Basic Error Parsing

```typescript
import { parseDatabaseError, UniqueConstraintError } from '@kysera/core'

try {
  await db.insertInto('users').values({ email: 'existing@example.com', name: 'John' }).execute()
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')

  if (dbError instanceof UniqueConstraintError) {
    console.error(`Duplicate value in ${dbError.table}.${dbError.columns.join(', ')}`)
    console.error(`Constraint: ${dbError.constraint}`)
  }
}
```

#### Handling Different Error Types

```typescript
import {
  parseDatabaseError,
  UniqueConstraintError,
  ForeignKeyError,
  NotFoundError,
  NotNullError,
  CheckConstraintError
} from '@kysera/core'

async function createPost(userId: number, title: string) {
  try {
    return await db
      .insertInto('posts')
      .values({ user_id: userId, title, content: '...' })
      .returningAll()
      .executeTakeFirstOrThrow()
  } catch (error) {
    const dbError = parseDatabaseError(error, 'postgres')

    if (dbError instanceof ForeignKeyError) {
      throw new Error(`User ${userId} does not exist`)
    }

    if (dbError instanceof UniqueConstraintError) {
      throw new Error(`Post with title "${title}" already exists`)
    }

    if (dbError instanceof NotNullError) {
      throw new Error(`Required field ${dbError.column} is missing`)
    }

    // Generic database error
    throw new Error(`Database error: ${dbError.message}`)
  }
}
```

#### Error Serialization

All error types support JSON serialization for logging and API responses:

```typescript
const dbError = parseDatabaseError(error, 'postgres')

console.log(JSON.stringify(dbError.toJSON(), null, 2))
// {
//   "name": "UniqueConstraintError",
//   "message": "UNIQUE constraint violation on users",
//   "code": "VALIDATION_UNIQUE_VIOLATION",
//   "constraint": "users_email_key",
//   "table": "users",
//   "columns": ["email"]
// }
```

#### Custom Error Types

##### NotFoundError

```typescript
import { NotFoundError } from '@kysera/core'

const user = await db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst()

if (!user) {
  throw new NotFoundError('User', { id: userId })
}
```

##### BadRequestError

```typescript
import { BadRequestError } from '@kysera/core'

if (!email.includes('@')) {
  throw new BadRequestError('Invalid email format')
}
```

---

## 🔧 Query Helpers

Lightweight utility functions for common query patterns.

### applyOffset

Lightweight limit/offset pagination without COUNT(\*) query (~50% faster than `paginate`):

```typescript
import { applyOffset } from '@kysera/core'

// Simple offset pagination
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
    hasMore: posts.length === 20
  }
}
```

**Options:**

- `limit`: 1-100 (default: 20, bounded for safety)
- `offset`: >= 0 (default: 0)

### applyDateRange

Apply date range filter to a query:

```typescript
import { applyDateRange } from '@kysera/core'

// Date range filtering
const posts = await applyDateRange(db.selectFrom('posts').selectAll(), 'created_at', {
  from: new Date('2024-01-01'),
  to: new Date('2024-12-31')
}).execute()

// Combine with offset
const analytics = await applyOffset(
  applyDateRange(db.selectFrom('events').selectAll().orderBy('created_at', 'desc'), 'created_at', {
    from: startDate,
    to: endDate
  }),
  { limit: 100 }
).execute()
```

**Options:**

- `from`: Start date (inclusive)
- `to`: End date (inclusive)

---

## 📄 Pagination

Two pagination strategies: offset-based (simple) and cursor-based (scalable).

### Offset Pagination

Best for: Small to medium datasets, UIs with page numbers.

**Pagination Bounds:**
- `MAX_PAGE` = 1,000,000 (maximum page number)
- `MAX_LIMIT` = 10,000 (maximum records per page)
- Default limit: 20 records per page

```typescript
import { paginate } from '@kysera/core'

const result = await paginate(db.selectFrom('users').selectAll().orderBy('created_at', 'desc'), {
  page: 2,
  limit: 20
})

console.log(`Page ${result.pagination.page} of ${result.pagination.totalPages}`)
console.log(`Total records: ${result.pagination.total}`)
console.log(`Has next: ${result.pagination.hasNext}`)
console.log(`Has prev: ${result.pagination.hasPrev}`)

result.data.forEach(user => {
  console.log(`${user.id}: ${user.name}`)
})
```

#### Default Options

```typescript
{
  page: 1,        // Start from page 1 (max: 1,000,000)
  limit: 20       // Default 20 (max: 10,000, min: 1)
}
```

#### Complex Queries

```typescript
const result = await paginate(
  db
    .selectFrom('posts')
    .innerJoin('users', 'users.id', 'posts.user_id')
    .select(['posts.id', 'posts.title', 'posts.created_at', 'users.name as author'])
    .where('posts.published', '=', true)
    .orderBy('posts.created_at', 'desc'),
  { page: 1, limit: 10 }
)
```

### Cursor Pagination

Best for: Large datasets, infinite scroll, real-time feeds, APIs.

**Pagination Bounds:**
- `MAX_LIMIT` = 10,000 records per page
- Cursor pagination automatically enforces this limit for safety

#### Single Column Ordering (Optimized)

```typescript
import { paginateCursor } from '@kysera/core'

// First page
const page1 = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [{ column: 'id', direction: 'asc' }],
  limit: 20
})

console.log(`Loaded ${page1.data.length} posts`)
console.log(`Has next: ${page1.pagination.hasNext}`)

// Next page
if (page1.pagination.nextCursor) {
  const page2 = await paginateCursor(db.selectFrom('posts').selectAll(), {
    orderBy: [{ column: 'id', direction: 'asc' }],
    cursor: page1.pagination.nextCursor,
    limit: 20
  })
}
```

#### Multi-Column Ordering

```typescript
const result = await paginateCursor(db.selectFrom('posts').selectAll(), {
  orderBy: [
    { column: 'score', direction: 'desc' }, // Primary sort
    { column: 'created_at', direction: 'desc' } // Secondary sort (tie-breaker)
  ],
  limit: 20
})
```

#### Cursor Format

Cursors are base64-encoded for security and compactness using cross-runtime compatible Base64 encoding (uses browser's `btoa`/`atob` in browsers, Node.js `Buffer` in Node.js):

**Single column:** `base64(column):base64(value)`
**Multi-column:** `base64(JSON.stringify({column1: value1, column2: value2}))`

```typescript
// Example cursor decoding (internal):
// "aWQ=:MTA="  →  { id: 10 }
// "eyJzY29yZSI6NTAsImNyZWF0ZWRfYXQiOiIyMDI0LTAxLTAxIn0="  →  { score: 50, created_at: "2024-01-01" }
```

### Performance Comparison

| Strategy   | Query Complexity      | Dataset Size         | Use Case                     |
| ---------- | --------------------- | -------------------- | ---------------------------- |
| **Offset** | `O(n)` at high pages  | Small-Medium (<100k) | Admin panels, page numbers   |
| **Cursor** | `O(log n)` with index | Large (millions+)    | Feeds, infinite scroll, APIs |

#### Cursor Optimization Details

- **Single-column ordering:** Uses simple WHERE clause `WHERE column > value` → `O(log n)` with index
- **Multi-column ordering:** Uses compound WHERE clauses → Still better than offset pagination
- **Database compatibility:** Works with PostgreSQL, MySQL, SQLite, and MSSQL

**Index Recommendation:**

```sql
-- For multi-column cursor pagination
CREATE INDEX idx_posts_score_created ON posts(score DESC, created_at DESC);
```

### MSSQL-Specific Pagination Notes

MSSQL has unique requirements for pagination that are handled automatically when you specify `dialect: 'mssql'`:

#### Offset Pagination (OFFSET/FETCH NEXT)

MSSQL requires an explicit ORDER BY clause when using OFFSET pagination. The implementation uses the `OFFSET ... ROWS FETCH NEXT ... ROWS ONLY` syntax:

```typescript
// MSSQL pagination automatically uses OFFSET/FETCH NEXT
const result = await paginate(
  db.selectFrom('users')
    .selectAll()
    .orderBy('id', 'asc'), // ORDER BY required for MSSQL
  { page: 1, limit: 20, dialect: 'mssql' }
)

// Generated SQL (MSSQL):
// SELECT * FROM users ORDER BY id ASC OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY
```

#### Cursor Pagination (TOP Clause)

MSSQL cursor pagination uses the `TOP` clause for optimal performance:

```typescript
const result = await paginateCursor(
  db.selectFrom('posts').selectAll(),
  {
    orderBy: [{ column: 'id', direction: 'asc' }],
    limit: 20,
    dialect: 'mssql'
  }
)

// Generated SQL (MSSQL):
// SELECT TOP(21) * FROM posts WHERE id > @cursor ORDER BY id ASC
```

**Important MSSQL Requirements:**

- Always provide an ORDER BY clause for offset pagination
- MSSQL doesn't support LIMIT/OFFSET syntax - use `dialect: 'mssql'` to automatically generate correct syntax
- Cursor pagination automatically handles the TOP clause

---

## 🎨 Type Utilities

### Executor Type

The `Executor<DB>` type accepts both `Kysely<DB>` and `Transaction<DB>`, enabling dependency injection:

```typescript
import type { Executor } from '@kysera/core'

class UserRepository {
  async findById(executor: Executor<Database>, id: number) {
    return await executor.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
  }

  async create(executor: Executor<Database>, data: NewUser) {
    return await executor.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
  }
}

// Usage with db
const user = await repo.findById(db, 123)

// Usage with transaction
await db.transaction().execute(async trx => {
  const user = await repo.findById(trx, 123)
  await repo.create(trx, { email: 'new@example.com' })
})
```

### Common Column Types

```typescript
import type { Timestamps, SoftDelete, AuditFields } from '@kysera/core'
import type { Generated } from 'kysely'

interface UsersTable extends Timestamps, SoftDelete, AuditFields {
  id: Generated<number>
  email: string
  name: string
  // Timestamps: created_at, updated_at
  // SoftDelete: deleted_at
  // AuditFields: created_by, updated_by
}
```

### Utility Types

```typescript
import type { Selectable, Insertable, Updateable } from '@kysely/core'
import type { Generated, ColumnType } from 'kysely'

interface UsersTable {
  id: Generated<number>
  email: string
  name: string
  created_at: ColumnType<Date, never, never> // Read-only
}

type User = Selectable<UsersTable>
// { id: number, email: string, name: string, created_at: Date }

type NewUser = Insertable<UsersTable>
// { email: string, name: string }

type UserUpdate = Updateable<UsersTable>
// { email?: string, name?: string }
```

### Query Metrics

The `QueryMetrics` interface is used by debug and infrastructure packages:

```typescript
import type { QueryMetrics } from '@kysera/core'

interface QueryMetrics {
  sql: string
  params?: unknown[]
  duration: number
  timestamp: number
}
```

---

## 🔌 Plugin Base Utilities

Core provides base abstractions for creating Kysera plugins, reducing boilerplate and ensuring consistent behavior across the plugin ecosystem.

### BasePluginOptions

Common options interface shared by all Kysera plugins:

```typescript
import type { BasePluginOptions, BasePluginOptionsWithPrimaryKey } from '@kysera/core'

// Base options for all plugins
interface BasePluginOptions {
  logger?: KyseraLogger  // Default: silentLogger
  tables?: string[]      // Whitelist tables (undefined = all)
  excludeTables?: string[] // Blacklist tables
}

// Extended options for plugins needing primary key
interface BasePluginOptionsWithPrimaryKey extends BasePluginOptions {
  primaryKeyColumn?: string // Default: 'id'
}
```

### createPluginConfig()

Standardizes plugin configuration with sensible defaults:

```typescript
import { createPluginConfig, type BasePluginOptionsWithPrimaryKey } from '@kysera/core'

interface MyPluginOptions extends BasePluginOptionsWithPrimaryKey {
  customOption: string
}

export function myPlugin(options: MyPluginOptions = {}): Plugin {
  const config = createPluginConfig('my-plugin', options)

  // config.logger - Configured logger (defaults to silentLogger)
  // config.tables - Whitelist (undefined = all tables)
  // config.excludeTables - Blacklist (defaults to [])
  // config.primaryKeyColumn - Primary key (defaults to 'id')

  config.logger.debug('Initializing my-plugin')

  return {
    name: config.name,
    // ... plugin implementation
  }
}
```

### createPluginMetadata()

Creates plugin metadata for dependency management and conflict detection:

```typescript
import { createPluginMetadata, PLUGIN_PRIORITIES } from '@kysera/core'

const metadata = createPluginMetadata('soft-delete', '0.8.0', {
  priority: PLUGIN_PRIORITIES.FILTER,
  dependencies: ['executor'],
  conflictsWith: ['hard-delete-only']
})
// { name: 'soft-delete', version: '0.8.0', priority: 500, ... }
```

### PLUGIN_PRIORITIES

Recommended priority values for consistent plugin ordering:

```typescript
import { PLUGIN_PRIORITIES } from '@kysera/core'

// Higher priority = runs first
PLUGIN_PRIORITIES.SECURITY  // 1000 - RLS, authentication (run first)
PLUGIN_PRIORITIES.FILTER    // 500  - Soft delete, tenant isolation
PLUGIN_PRIORITIES.TRANSFORM // 100  - Timestamps, data transformation
PLUGIN_PRIORITIES.AUDIT     // 50   - Audit logging, change tracking
PLUGIN_PRIORITIES.DEFAULT   // 0    - Default priority
PLUGIN_PRIORITIES.DEBUG     // -100 - Query logging, profiling (run last)
```

### Plugin Base Types

```typescript
// Resolved plugin configuration
interface ResolvedPluginConfig {
  readonly name: string
  readonly logger: KyseraLogger
  readonly tables: string[] | undefined
  readonly excludeTables: string[]
  readonly primaryKeyColumn: string
}

// Plugin metadata
interface PluginMetadata {
  name: string
  version: string
  dependencies?: readonly string[]
  priority?: number
  conflictsWith?: readonly string[]
}

// Priority type
type PluginPriority = 1000 | 500 | 100 | 50 | 0 | -100
```

---

## 📝 Logger Interface

Core provides a shared logger interface for consistency across the Kysera ecosystem:

```typescript
import { type KyseraLogger, consoleLogger, silentLogger, createPrefixedLogger } from '@kysera/core'

// Console logger (default)
const logger = consoleLogger
logger.info('Application started')
logger.warn('High memory usage')
logger.error('Connection failed')

// Silent logger (for production)
const silent = silentLogger

// Prefixed logger
const dbLogger = createPrefixedLogger('database', consoleLogger)
dbLogger.info('Query executed') // [kysera:info] [database] Query executed

// Custom logger implementation
const customLogger: KyseraLogger = {
  debug: (msg, ...args) => winston.debug(msg, ...args),
  info: (msg, ...args) => winston.info(msg, ...args),
  warn: (msg, ...args) => winston.warn(msg, ...args),
  error: (msg, ...args) => winston.error(msg, ...args)
}
```

---

## 📖 API Reference

### Errors

#### `parseDatabaseError(error: unknown, dialect: DatabaseDialect): DatabaseError`

Parse database-specific errors into unified format.

**Parameters:**

- `error` - Original database error
- `dialect` - `'postgres' | 'mysql' | 'sqlite' | 'mssql'`

**Returns:** `DatabaseError` or subclass

---

#### `class DatabaseError extends Error`

Base error class with serialization support.

**Properties:**

- `code: string` - Error code
- `detail?: string` - Additional details
- `toJSON(): object` - Serialize to JSON

---

#### `class UniqueConstraintError extends DatabaseError`

UNIQUE constraint violation.

**Properties:**

- `constraint: string` - Constraint name
- `table: string` - Table name
- `columns: string[]` - Affected columns

---

#### `class ForeignKeyError extends DatabaseError`

FOREIGN KEY constraint violation.

**Properties:**

- `constraint: string` - Constraint name
- `table: string` - Table name
- `referencedTable: string` - Referenced table

---

#### `class NotNullError extends DatabaseError`

NOT NULL constraint violation.

**Properties:**

- `column: string` - Column name
- `table?: string` - Table name

---

#### `class CheckConstraintError extends DatabaseError`

CHECK constraint violation.

**Properties:**

- `constraint: string` - Constraint name
- `table?: string` - Table name

---

#### `class NotFoundError extends DatabaseError`

Entity not found.

**Constructor:**

- `entity: string` - Entity name
- `filters?: Record<string, unknown>` - Search filters

---

#### `class BadRequestError extends DatabaseError`

Invalid request/data.

---

### Error Codes

#### `ErrorCodes`

Object containing all unified error codes.

**Examples:**

```typescript
ErrorCodes.DB_CONNECTION_FAILED
ErrorCodes.VALIDATION_UNIQUE_VIOLATION
ErrorCodes.RESOURCE_NOT_FOUND
```

---

#### `getErrorCategory(code: string): string`

Get error category from error code.

**Returns:** Category prefix (e.g., 'DB', 'VALIDATION')

---

#### `isValidErrorCode(code: string): boolean`

Type guard to check if a string is a valid error code.

---

### Pagination

#### `paginate<DB, TB, O>(query: SelectQueryBuilder<DB, TB, O>, options?: PaginationOptions): Promise<PaginatedResult<O>>`

Offset-based pagination.

**Options:**

```typescript
interface PaginationOptions {
  page?: number // Default: 1
  limit?: number // Default: 20, max: 10,000
  dialect?: 'postgres' | 'mysql' | 'sqlite' | 'mssql' // For MSSQL-specific syntax
}
```

**Returns:**

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

---

#### `paginateCursor<DB, TB, O>(query: SelectQueryBuilder<DB, TB, O>, options: CursorOptions<O>): Promise<PaginatedResult<O>>`

Cursor-based pagination.

**Options:**

```typescript
interface CursorOptions<T> {
  orderBy: Array<{
    column: keyof T & string
    direction: 'asc' | 'desc'
  }>
  cursor?: string
  limit?: number // Default: 20
  dialect?: 'postgres' | 'mysql' | 'sqlite' | 'mssql' // For MSSQL-specific syntax
}
```

**Returns:**

```typescript
interface PaginatedResult<T> {
  data: T[]
  pagination: {
    limit: number
    hasNext: boolean
    nextCursor?: string
  }
}
```

---

### Types

#### `type Executor<DB> = Kysely<DB> | Transaction<DB>`

Universal executor type.

---

#### `interface Timestamps`

Timestamp columns.

```typescript
{ created_at: Date, updated_at?: Date }
```

---

#### `interface SoftDelete`

Soft delete column.

```typescript
{
  deleted_at: Date | null
}
```

---

#### `interface AuditFields`

Audit columns.

```typescript
{ created_by?: number, updated_by?: number }
```

---

#### `interface QueryMetrics`

Query performance metrics.

```typescript
{
  sql: string
  params?: unknown[]
  duration: number
  timestamp: number
}
```

---

### Logger

#### `interface KyseraLogger`

Logger interface for Kysera ecosystem.

**Methods:**

- `debug(message: string, ...args: unknown[]): void`
- `info(message: string, ...args: unknown[]): void`
- `warn(message: string, ...args: unknown[]): void`
- `error(message: string, ...args: unknown[]): void`

---

#### `consoleLogger: KyseraLogger`

Simple console logger implementation.

---

#### `silentLogger: KyseraLogger`

No-op logger for silent operation.

---

#### `createPrefixedLogger(prefix: string, baseLogger?: KyseraLogger): KyseraLogger`

Create a logger with a specific prefix.

---

## 🔄 Migration Notes

### Feature Migration Guide

Features have been moved to specialized packages for better modularity:

#### Health Checks → @kysera/infra

```typescript
// Before (in @kysera/core)
import { checkDatabaseHealth, createMetricsPool, HealthMonitor } from '@kysera/core'

// After
import { checkDatabaseHealth, createMetricsPool, HealthMonitor } from '@kysera/infra'
```

#### Retry Logic & Circuit Breaker → @kysera/infra

```typescript
// Before
import { withRetry, CircuitBreaker, isTransientError } from '@kysera/core'

// After
import { withRetry, CircuitBreaker, isTransientError } from '@kysera/infra'
```

#### Graceful Shutdown → @kysera/infra

```typescript
// Before
import { createGracefulShutdown, shutdownDatabase } from '@kysera/core'

// After
import { createGracefulShutdown, shutdownDatabase } from '@kysera/infra'
```

#### Testing Utilities → @kysera/testing

```typescript
// Before
import { testInTransaction, createFactory, cleanDatabase } from '@kysera/core'

// After
import { testInTransaction, createFactory, cleanDatabase } from '@kysera/testing'
```

#### Debug & Profiling → @kysera/debug

```typescript
// Before
import { withDebug, QueryProfiler, formatSQL } from '@kysera/core'

// After
import { withDebug, QueryProfiler, formatSQL } from '@kysera/debug'
```

### What Remains in Core

Core now focuses on fundamental utilities:

- ✅ Error handling (DatabaseError, parseDatabaseError, error codes)
- ✅ Pagination (paginate, paginateCursor)
- ✅ Types (Executor, Timestamps, QueryMetrics)
- ✅ Logger interface (KyseraLogger)

---

## 🧪 Multi-Database Testing

@kysera/core supports testing against multiple databases simultaneously using environment variables. This ensures error handling works correctly across all supported databases.

### Running Tests with Multiple Databases

Use these environment variables to enable specific database tests:

```bash
# Test with PostgreSQL (default, always runs)
pnpm test

# Test with MySQL
TEST_MYSQL=1 pnpm test

# Test with MSSQL
TEST_MSSQL=1 pnpm test

# Test with all databases
TEST_POSTGRES=1 TEST_MYSQL=1 TEST_MSSQL=1 pnpm test
```

### Database-Specific Test Setup

Each database requires proper setup before running tests:

#### PostgreSQL (Default)

```bash
# Using Docker
docker run -d \
  --name kysera-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=kysera_test \
  -p 5432:5432 \
  postgres:16-alpine

# Connection string
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kysera_test
```

#### MySQL

```bash
# Using Docker
docker run -d \
  --name kysera-mysql \
  -e MYSQL_ROOT_PASSWORD=mysql \
  -e MYSQL_DATABASE=kysera_test \
  -p 3306:3306 \
  mysql:8

# Connection string
DATABASE_URL=mysql://root:mysql@localhost:3306/kysera_test
```

#### MSSQL

```bash
# Using Docker
docker run -d \
  --name kysera-mssql \
  -e "ACCEPT_EULA=Y" \
  -e "SA_PASSWORD=YourStrong@Passw0rd" \
  -p 1433:1433 \
  mcr.microsoft.com/mssql/server:2022-latest

# Connection string
DATABASE_URL=sqlserver://sa:YourStrong@Passw0rd@localhost:1433/kysera_test
```

### Continuous Integration

In CI/CD pipelines, you can run tests against all databases in parallel:

```yaml
# GitHub Actions example
strategy:
  matrix:
    database: [postgres, mysql, mssql]
steps:
  - name: Run tests
    run: TEST_${{ matrix.database | upper }}=1 pnpm test
```

### Error Handling Tests

The error handling system is tested against all supported databases to ensure consistent behavior:

- Unique constraint violations
- Foreign key violations
- NOT NULL violations
- CHECK constraint violations (where supported)

Each test verifies that `parseDatabaseError` correctly identifies and parses database-specific error codes into unified error types.

---

## ✨ Best Practices

### 1. Use Consistent Error Codes

```typescript
// ✅ Good: Use unified error codes
import { ErrorCodes } from '@kysera/core'

throw new DatabaseError('Connection failed', ErrorCodes.DB_CONNECTION_FAILED)

// ❌ Bad: Hard-coded strings
throw new DatabaseError('Connection failed', 'CONNECTION_ERROR')
```

### 2. Parse Errors for User-Friendly Messages

```typescript
try {
  await createUser(email)
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')

  if (dbError instanceof UniqueConstraintError) {
    throw new Error('Email already registered')
  }

  if (dbError instanceof ForeignKeyError) {
    throw new Error('Related record not found')
  }

  throw new Error('Failed to create user')
}
```

### 3. Use Cursor Pagination for Large Datasets

```typescript
// ❌ Bad for large datasets
const result = await paginate(query, { page: 1000, limit: 20 })
// Offset 19980 - scans 20k rows!

// ✅ Good: O(log n) with index
const result = await paginateCursor(query, {
  orderBy: [{ column: 'id', direction: 'asc' }],
  cursor,
  limit: 20
})
```

### 4. Use Executor Type for Flexibility

```typescript
// ✅ Works with both db and transactions
async function findUser(executor: Executor<DB>, id: number) {
  return executor.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
}

// Usage
await findUser(db, 123)
await db.transaction().execute(trx => findUser(trx, 123))
```

### 5. Leverage Type Utilities

```typescript
import type { Timestamps, SoftDelete, Selectable, Insertable } from '@kysera/core'

interface UsersTable extends Timestamps, SoftDelete {
  id: Generated<number>
  email: string
  name: string
}

type User = Selectable<UsersTable>
type NewUser = Insertable<UsersTable>
```

---

## 🤝 Contributing

Contributions are welcome! This package follows strict development principles:

- ✅ **Zero runtime dependencies** (peer deps only)
- ✅ **100% type safe** (TypeScript strict mode)
- ✅ **Comprehensive test coverage**
- ✅ **Cross-database compatible** (PostgreSQL, MySQL, SQLite, MSSQL)
- ✅ **ESM only** (no CommonJS)

See [CLAUDE.md](../../CLAUDE.md) for development guidelines.

---

## 📄 License

MIT © Kysera

---

## 🔗 Links

- [GitHub Repository](https://github.com/kysera-dev/kysera)
- [Kysely Documentation](https://kysely.dev)
- [Issue Tracker](https://github.com/kysera-dev/kysera/issues)
- [Changelog](../../CHANGELOG.md)

---

**Built with ❤️ for production TypeScript applications**
