---
sidebar_position: 1
title: API Overview
description: API reference overview for all Kysera packages
---

# API Reference

Complete API documentation for all Kysera packages.

## Package Index

### Core Packages

| Package | Description | Bundle Size |
|---------|-------------|-------------|
| [@kysera/core](/docs/api/core) | Core utilities - errors, pagination, logger, types | ~8 KB |
| [@kysera/repository](/docs/api/repository) | Repository pattern with validation | ~12 KB |
| [@kysera/dal](/docs/api/dal) | Functional Data Access Layer | ~7 KB |

### Infrastructure Packages

| Package | Description | Bundle Size |
|---------|-------------|-------------|
| [@kysera/infra](/docs/api/infra) | Health checks, retry, circuit breaker, shutdown | ~12 KB |
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

## @kysera/repository

Type-safe repository pattern implementation.

| Module | Description |
|--------|-------------|
| [Factory](/docs/api/repository/factory) | Repository factory functions |
| [Validation](/docs/api/repository/validation) | Validation utilities |
| [Types](/docs/api/repository/types) | Type definitions |

```typescript
import { createRepositoryFactory, createORM, withPlugins } from '@kysera/repository'
```

## @kysera/dal

Functional Data Access Layer for composable queries.

```typescript
import { createQuery, withTransaction, compose, parallel } from '@kysera/dal'
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

### Using Multiple Plugins

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { timestampsPlugin } from '@kysera/timestamps'
import { auditPlugin } from '@kysera/audit'

const orm = await createORM(db, [
  timestampsPlugin(),           // Auto timestamps
  softDeletePlugin(),           // Soft delete
  auditPlugin({                 // Audit logging
    getUserId: () => currentUser?.id
  })
])
```

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

### Transactions

```typescript
import { createRepositoriesFactory } from '@kysera/repository'

const createRepos = createRepositoriesFactory({
  users: (executor) => createUserRepository(executor),
  posts: (executor) => createPostRepository(executor)
})

await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)

  const user = await repos.users.create({ email: 'new@example.com', name: 'New User' })
  await repos.posts.create({ title: 'First Post', userId: user.id })

  // Both operations commit or roll back together
})
```

## Version Compatibility

| Package | Version | Kysely | Node.js | Bun | Deno |
|---------|---------|--------|---------|-----|------|
| @kysera/core | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/repository | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/dal | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/infra | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/debug | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/testing | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/migrations | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/soft-delete | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/timestamps | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/audit | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |
| @kysera/rls | 0.6.0 | >=0.28.8 | >=20 | >=1.0 | >=1.40 |

## Database Support

| Feature | PostgreSQL | MySQL | SQLite |
|---------|------------|-------|--------|
| RETURNING clause | Native | Emulated | Native |
| JSONB columns | Native | JSON type | TEXT |
| Partial indexes | Supported | Limited | Supported |
| Row-level security | Native + App | App-level | App-level |
| Boolean type | true/false | 1/0 | 1/0 |
