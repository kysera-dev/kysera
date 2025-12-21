---
sidebar_position: 1
title: API Overview
description: API reference overview for all Kysera packages
---

# API Reference

Complete API documentation for all Kysera packages.

:::info What is Kysera?
Kysera is a **type-safe data access toolkit** built on Kysely, not a traditional ORM. It provides composable patterns (Repository, DAL) and plugins for common database features, while maintaining Kysely's lightweight philosophy and full SQL control.
:::

:::tip Unified Execution Layer (v0.7+)
Kysera now features a **Unified Execution Layer** powered by `@kysera/executor`. This foundation package enables plugins to work seamlessly with both Repository and DAL patterns through query interception. [Learn more about the architecture](#architecture-overview).
:::

## Architecture Overview

Kysera follows a layered architecture with `@kysera/executor` as the foundation:

```
┌─────────────────────────────────────────────────────┐
│  Application Layer (Repository / DAL Patterns)      │
│  - @kysera/repository: Repository with validation   │
│  - @kysera/dal: Functional query composition        │
├─────────────────────────────────────────────────────┤
│  Plugin Layer (Query Interceptors & Extensions)     │
│  - @kysera/soft-delete, @kysera/rls, etc.          │
├─────────────────────────────────────────────────────┤
│  Unified Execution Layer                            │
│  - @kysera/executor: Plugin-aware Kysely wrapper    │
├─────────────────────────────────────────────────────┤
│  Kysely Query Builder (peer dependency)             │
└─────────────────────────────────────────────────────┘
```

**Key Concepts:**

- **@kysera/executor** wraps Kysely instances with plugin interception capabilities
- **Plugins** work with BOTH Repository and DAL patterns through the executor
- **Query interceptors** (e.g., soft-delete filters, RLS policies) apply automatically to all queries
- **Repository extensions** (e.g., `repo.softDelete()`, `repo.restore()`) work only with Repository pattern

## Package Index

### Core Packages

| Package | Description | Bundle Size |
|---------|-------------|-------------|
| [@kysera/core](/docs/api/core) | Core utilities - errors, pagination, logger, types | ~8 KB |
| [@kysera/executor](/docs/api/executor) | **Foundation**: Unified plugin execution layer | ~8 KB |
| [@kysera/repository](/docs/api/repository) | Repository pattern with validation | ~12 KB |
| [@kysera/dal](/docs/api/dal) | Functional Data Access Layer | ~7 KB |

### Infrastructure Packages

| Package | Description | Bundle Size |
|---------|-------------|-------------|
| [@kysera/infra](/docs/api/infra) | Health checks, retry, circuit breaker, shutdown | ~12 KB |
| [@kysera/dialects](/docs/api/dialects) | Dialect-specific utilities - PostgreSQL, MySQL, SQLite | ~5 KB |
| [@kysera/debug](/docs/api/debug) | Query logging, profiling, SQL formatting | ~5 KB |
| [@kysera/testing](/docs/api/testing) | Testing utilities and factories | ~6 KB |
| [@kysera/migrations](/docs/api/migrations) | Database migration system | ~12 KB |

### Plugin Packages

| Package | Description | Bundle Size |
|---------|-------------|-------------|
| [@kysera/soft-delete](/docs/api/soft-delete) | Soft delete functionality | ~4 KB |
| [@kysera/timestamps](/docs/api/timestamps) | Automatic timestamp management | ~4 KB |
| [@kysera/audit](/docs/api/audit) | Comprehensive audit logging | ~8 KB |
| [@kysera/rls](/docs/api/rls) | Row-Level Security for multi-tenancy | ~10 KB |

## @kysera/core

Core utilities including error handling, pagination, and logging.

| Module | Description |
|--------|-------------|
| [Errors](/docs/api/core/errors) | Multi-database error parsing |
| [Pagination](/docs/api/core/pagination) | Offset and cursor pagination |
| [Logger](/docs/api/core/logger) | Configurable logging interface |

```typescript
import { parseDatabaseError, paginate, consoleLogger } from '@kysera/core'
```

## Package Dependencies

Understanding the dependency hierarchy helps you choose the right packages:

```
@kysera/executor (foundation - 0 dependencies)
    │
    ├──> @kysera/dal (depends on executor)
    │       └──> Used for: Functional queries with plugin support
    │
    ├──> @kysera/repository (depends on executor + dal)
    │       └──> Used for: Repository pattern with validation and plugin methods
    │
    └──> Plugin packages (use executor's Plugin interface)
            ├──> @kysera/soft-delete (query interceptor + repository extensions)
            ├──> @kysera/rls (query interceptor + repository extensions)
            ├──> @kysera/timestamps (repository extensions only)
            └──> @kysera/audit (repository extensions only)

@kysera/core (standalone - 0 dependencies)
    └──> Used by: All packages for errors, pagination, logging

@kysera/dialects (standalone - 0 dependencies)
    └──> Used by: All packages for dialect-specific operations, error detection, introspection
```

**Plugin Capabilities:**

| Plugin Feature | Works with Repository | Works with DAL |
|----------------|----------------------|----------------|
| Query Interceptors (`interceptQuery`) | ✅ Yes | ✅ Yes (via executor) |
| Repository Extensions (`extendRepository`) | ✅ Yes | ❌ No |

**Examples:**
- `@kysera/soft-delete`: Automatic filtering works in both; `repo.softDelete()` method only in Repository
- `@kysera/rls`: RLS policies work in both; validation methods only in Repository
- `@kysera/timestamps`: Repository only (no query interception needed)
- `@kysera/audit`: Repository only (no query interception needed)

## @kysera/executor

**Foundation package** - Unified plugin execution layer enabling plugins to work with both Repository and DAL patterns. [Full Documentation →](/docs/api/executor)

```typescript
import { createExecutor, isKyseraExecutor, getPlugins, getRawDb } from '@kysera/executor'
```

**Core Concept:** Wraps Kysely instances with plugin interception, allowing automatic query modification (filtering, policies) before execution while maintaining full type safety.

**Key Features:**
- Zero overhead when no interceptor plugins are registered
- Automatic plugin validation (conflicts, dependencies, circular deps)
- Transaction propagation - plugins automatically work in transactions
- Plugin priority and dependency resolution
- `getRawDb()` for bypassing interceptors when needed

**Quick Example:**
```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

const executor = await createExecutor(db, [softDeletePlugin()])

// Automatic soft-delete filtering
const users = await executor.selectFrom('users').selectAll().execute()

// Works in transactions
await executor.transaction().execute(async (trx) => {
  // Plugins automatically applied
  const user = await trx.selectFrom('users').where('id', '=', 1).executeTakeFirst()
})
```

## @kysera/repository

Type-safe repository pattern implementation with full plugin support. [Full Documentation →](/docs/api/repository)

| Module | Description |
|--------|-------------|
| [Factory](/docs/api/repository/factory) | Repository factory functions |
| [Validation](/docs/api/repository/validation) | Validation utilities |
| [Types](/docs/api/repository/types) | Type definitions |

```typescript
import { createRepositoryFactory, createORM, withPlugins } from '@kysera/repository'
```

**Plugin Integration:** Uses `@kysera/executor` internally, supporting both query interceptors (`interceptQuery`) and repository extensions (`extendRepository`).

## @kysera/dal

Functional Data Access Layer for composable queries with query interceptor support via `KyseraExecutor`. [Full Documentation →](/docs/api/dal)

```typescript
import { createQuery, withTransaction, createContext, compose, parallel } from '@kysera/dal'
```

**Plugin Integration:** Works with `@kysera/executor` to support query interceptor plugins (soft-delete, RLS, etc.). Repository extension plugins are not available in DAL.

## @kysera/dialects

Dialect-specific utilities for PostgreSQL, MySQL, and SQLite. [Full Documentation →](/docs/api/dialects)

```typescript
import {
  getAdapter,
  parseConnectionUrl,
  buildConnectionUrl,
  tableExists,
  escapeIdentifier,
  isUniqueConstraintError
} from '@kysera/dialects'
```

**Core Concept:** Provides a unified adapter interface for dialect-specific operations, enabling portable code that works across PostgreSQL, MySQL, and SQLite.

**Key Features:**
- Unified adapter interface for all supported dialects
- Connection URL parsing and building
- Database introspection (tableExists, getTableColumns, getTables)
- Error detection (unique, foreign key, not-null constraints)
- Dialect-specific SQL helpers (escapeIdentifier, getCurrentTimestamp, formatDate)
- Testing utilities (truncateAllTables, getDatabaseSize)

**Quick Example:**
```typescript
import { getAdapter, parseConnectionUrl } from '@kysera/dialects'

// Parse connection URL
const config = parseConnectionUrl('postgresql://user:pass@localhost:5432/mydb')

// Get dialect adapter
const adapter = getAdapter('postgres')

// Check table existence
const exists = await adapter.tableExists(db, 'users')

// Detect constraint errors
try {
  await db.insertInto('users').values({ email: 'duplicate@example.com' }).execute()
} catch (error) {
  if (adapter.isUniqueConstraintError(error)) {
    console.log('Email already exists')
  }
}
```

## @kysera/infra

Infrastructure utilities for production applications.

```typescript
import {
  checkDatabaseHealth,
  HealthMonitor,
  withRetry,
  CircuitBreaker,
  registerShutdownHandlers
} from '@kysera/infra'
```

## @kysera/debug

Debug and profiling utilities.

```typescript
import { withDebug, QueryProfiler, formatSQL, highlightSQL } from '@kysera/debug'
```

## @kysera/testing

Testing utilities for Kysera applications.

```typescript
import {
  testInTransaction,
  createFactory,
  cleanDatabase,
  seedDatabase
} from '@kysera/testing'
```

## @kysera/migrations

Database migration system.

```typescript
import {
  createMigration,
  createMigrationRunner,
  runMigrations,
  getMigrationStatus
} from '@kysera/migrations'
```

## Plugin Packages

### @kysera/soft-delete

Mark records as deleted without removing them.

```typescript
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' })
])

// Methods added: softDelete, restore, hardDelete, findWithDeleted, etc.
```

### @kysera/timestamps

Automatic timestamp management.

```typescript
import { timestampsPlugin } from '@kysera/timestamps'

const orm = await createORM(db, [
  timestampsPlugin()  // Zero config!
])

// created_at and updated_at are set automatically
```

### @kysera/audit

Comprehensive audit logging.

```typescript
import { auditPlugin } from '@kysera/audit'

const orm = await createORM(db, [
  auditPlugin({
    getUserId: () => currentUser?.id,
    captureOldValues: true,
    captureNewValues: true
  })
])

// Methods added: getAuditHistory, getAuditLog, restoreFromAudit
```

### @kysera/rls

Row-Level Security for multi-tenant applications.

```typescript
import { rlsPlugin, defineRLSSchema, filter, allow, rlsContext } from '@kysera/rls'

const rlsSchema = defineRLSSchema({
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow(['update', 'delete'], ctx => ctx.auth.userId === ctx.row?.author_id)
    ]
  }
})

const orm = await createORM(db, [rlsPlugin({ schema: rlsSchema })])

// All queries automatically filtered by tenant
await rlsContext.runAsync({ auth: { userId: 1, tenantId: 'acme', roles: [] } }, async () => {
  const posts = await postRepo.findAll()  // Filtered by tenant_id = 'acme'
})
```

## Quick Reference

### Creating a Repository

```typescript
import { createRepositoryFactory } from '@kysera/repository'
import { z } from 'zod'

const factory = createRepositoryFactory(db)

const userRepo = factory.create({
  tableName: 'users' as const,
  mapRow: (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at
  }),
  schemas: {
    create: z.object({
      email: z.string().email(),
      name: z.string().min(1)
    })
  }
})
```

### Using Plugins (Unified Approach)

With the Unified Execution Layer, create an executor with plugins that work across both Repository and DAL:

```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { timestampsPlugin } from '@kysera/timestamps'
import { auditPlugin } from '@kysera/audit'
import { rlsPlugin } from '@kysera/rls'

// Create executor with query interceptor plugins
const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema }),    // RLS policies (query interceptor)
  softDeletePlugin()                    // Soft-delete filter (query interceptor)
])

// createORM creates a plugin container (repository manager), not a traditional ORM
// It gets both query interceptors + extension methods
const orm = await createORM(executor, [
  timestampsPlugin(),                   // Repository extension only
  auditPlugin({                         // Repository extension only
    getUserId: () => currentUser?.id
  })
])

// DAL pattern: Gets query interceptors only
import { createQuery } from '@kysera/dal'
const getUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
)
// RLS and soft-delete filters automatically applied!
const users = await getUsers(executor)
```

**Key Points:**
- **Query interceptor plugins** (soft-delete, RLS) → Add to executor
- **Repository extension plugins** (timestamps, audit) → Add to `createORM` (plugin container)
- Both patterns share the same query interceptors for consistent behavior
- `createORM` is a plugin container/repository manager, not a traditional ORM

### Error Handling

```typescript
import { parseDatabaseError, UniqueConstraintError, ForeignKeyError } from '@kysera/core'

try {
  await userRepo.create({ email: 'existing@example.com', name: 'Test' })
} catch (rawError) {
  const error = parseDatabaseError(rawError, 'postgres')

  if (error instanceof UniqueConstraintError) {
    console.log(`Duplicate value in columns: ${error.columns.join(', ')}`)
  }

  if (error instanceof ForeignKeyError) {
    console.log(`Foreign key violation: ${error.constraint}`)
  }
}
```

### Health Checks

```typescript
import { checkDatabaseHealth, HealthMonitor } from '@kysera/infra'

// One-time check
const health = await checkDatabaseHealth(db)
console.log(health.status)  // 'healthy' | 'degraded' | 'unhealthy'

// Continuous monitoring
const monitor = new HealthMonitor(db, { intervalMs: 30000 })
monitor.start((result) => {
  if (result.status !== 'healthy') {
    alerting.send('Database health issue', result)
  }
})
```

### Pagination

```typescript
import { paginate, paginateCursor } from '@kysera/core'

// Offset pagination
const page = await paginate(
  db.selectFrom('posts').selectAll(),
  { page: 1, limit: 20 }
)
// { items: [...], total: 100, page: 1, limit: 20, totalPages: 5 }

// Cursor pagination
const result = await paginateCursor(
  db.selectFrom('posts').selectAll(),
  {
    orderBy: [{ column: 'created_at', direction: 'desc' }],
    limit: 20,
    cursor: previousCursor
  }
)
// { items: [...], nextCursor: {...}, hasMore: true }
```

### Transactions with Plugins

Plugins automatically propagate through transactions:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { createORM } from '@kysera/repository'
import { withTransaction, createQuery } from '@kysera/dal'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// Repository pattern - plugins in transactions
const orm = await createORM(executor, [])
await orm.transaction(async (ctx) => {
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create({ email: 'new@example.com', name: 'New User' })
  // Soft-delete filter applied within transaction
  const activeUsers = await userRepo.findAll()
})

// DAL pattern - plugins in transactions
const getUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
)

await withTransaction(executor, async (ctx) => {
  // Soft-delete filter automatically applied
  const users = await getUsers(ctx)
  // Both operations commit or roll back together
})

// Repository factory pattern
import { createRepositoriesFactory } from '@kysera/repository'

const createRepos = createRepositoriesFactory({
  users: (executor) => createUserRepository(executor),
  posts: (executor) => createPostRepository(executor)
})

await executor.transaction().execute(async (trx) => {
  const repos = createRepos(trx)
  // All queries inherit plugins from executor
  const user = await repos.users.create({ email: 'new@example.com', name: 'New User' })
  await repos.posts.create({ title: 'First Post', userId: user.id })
})
```

## Version Compatibility

| Package | Version | Kysely | Node.js | Bun | Deno |
|---------|---------|--------|---------|-----|------|
| @kysera/core | 0.6.1 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/executor | 0.7.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/repository | 0.7.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/dal | 0.7.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/dialects | 0.7.2 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/infra | 0.6.1 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/debug | 0.6.1 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/testing | 0.6.1 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/migrations | 0.6.1 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/soft-delete | 0.7.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/timestamps | 0.6.1 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/audit | 0.6.1 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/rls | 0.7.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |

## Database Support

| Feature | PostgreSQL | MySQL | SQLite |
|---------|------------|-------|--------|
| RETURNING clause | Native | Emulated | Native |
| JSONB columns | Native | JSON type | TEXT |
| Partial indexes | Supported | Limited | Supported |
| Row-level security | Native + App | App-level | App-level |
| Boolean type | true/false | 1/0 | 1/0 |
