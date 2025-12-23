---
sidebar_position: 6
title: Migration Guide v0.6 → v0.7
description: Upgrading from Kysera v0.6 to v0.7
---

# Migration Guide: v0.6 → v0.7

This guide covers migrating from Kysera v0.6 to v0.7, which introduces the **Unified Execution Layer** - a significant architectural improvement that enables plugins to work seamlessly with both Repository and DAL patterns.

## Overview

**Version 0.7** is a major release that introduces:

- **@kysera/executor** - New foundation package for plugin-aware query execution
- **Unified Plugin System** - Plugins now work with both Repository and DAL patterns
- **MSSQL (SQL Server) Support** - Full support for Microsoft SQL Server
- **Dialect-Aware Pagination** - Optimized pagination for each database dialect
- **Improved Plugin Architecture** - Better performance and flexibility

:::tip No Breaking Changes for Most Users
If you're using Repository or DAL without plugins, **no code changes are required**. The v0.7 API is backward compatible. This guide focuses on users who want to leverage the new plugin capabilities.
:::

## What's New in v0.7

### 1. Unified Execution Layer (@kysera/executor)

The biggest change in v0.7 is the introduction of `@kysera/executor`, a new foundation package that sits between Kysely and your data access layer:

```
┌─────────────────────────────────────────────────────────┐
│  Before v0.7 (v0.6)                                     │
│  ┌──────────────┐                                       │
│  │  Repository  │ ← Plugins only here                   │
│  └──────┬───────┘                                       │
│         │                                               │
│         ▼                                               │
│     Kysely → Database                                   │
│                                                         │
│  ┌──────────────┐                                       │
│  │     DAL      │ ← No plugin support                   │
│  └──────┬───────┘                                       │
│         │                                               │
│         ▼                                               │
│     Kysely → Database                                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  After v0.7                                             │
│  ┌──────────────┐                                       │
│  │  Repository  │ ← Full plugin support                 │
│  └──────┬───────┘                                       │
│         │                                               │
│         ▼                                               │
│  ┌──────────────┐                                       │
│  │  Executor    │ ← Plugin interception layer           │
│  └──────┬───────┘                                       │
│         │                                               │
│         ▼                                               │
│     Kysely → Database                                   │
│                                                         │
│  ┌──────────────┐                                       │
│  │     DAL      │ ← Plugin support via Executor         │
│  └──────┬───────┘                                       │
│         │                                               │
│         ▼                                               │
│  ┌──────────────┐                                       │
│  │  Executor    │ ← Same plugin interception            │
│  └──────┬───────┘                                       │
│         │                                               │
│         ▼                                               │
│     Kysely → Database                                   │
└─────────────────────────────────────────────────────────┘
```

**Key Benefits:**

- **Single Plugin System** - Write plugins once, use with both Repository and DAL
- **Zero Overhead** - No performance penalty when plugins aren't active
- **Type Safety** - Full TypeScript support with Kysely types preserved
- **Transaction Propagation** - Plugins automatically work in transactions

### 2. Plugin System Improvements

**v0.6 Plugin Architecture:**
- Query interceptors only worked with Repository pattern
- DAL had no plugin support
- Each pattern had its own plugin loading mechanism

**v0.7 Plugin Architecture:**
- `createExecutor` provides unified plugin interception
- Both Repository and DAL can use query interceptor plugins
- Repository additionally supports extension plugins (restore(), softDelete(), etc.)
- Consistent plugin behavior across all patterns

### 3. MSSQL (SQL Server) Support

Full support for Microsoft SQL Server has been added:

- MSSQL-specific pagination using `OFFSET/FETCH NEXT`
- Cursor pagination with `TOP` clause optimization
- Proper dialect detection and SQL generation
- All pagination functions accept optional `dialect: 'mssql'` parameter

### 4. Dialect-Aware Pagination

Pagination functions are now optimized for each database:

| Database   | Offset Pagination     | Cursor Pagination          |
| ---------- | --------------------- | -------------------------- |
| PostgreSQL | `LIMIT/OFFSET`        | Row value comparison       |
| MySQL      | `LIMIT/OFFSET`        | Standard WHERE clauses     |
| SQLite     | `LIMIT/OFFSET`        | Standard WHERE clauses     |
| MSSQL      | `OFFSET/FETCH NEXT`   | `TOP` clause               |

## Breaking Changes

:::warning Breaking Changes
While v0.7 is mostly backward compatible, there are a few breaking changes to be aware of.
:::

### 1. Package Dependencies

`@kysera/executor` is now a **required peer dependency** for:
- `@kysera/repository`
- `@kysera/dal`
- All plugin packages (`@kysera/soft-delete`, `@kysera/rls`, etc.)

**Action Required:** Install `@kysera/executor` when upgrading:

```bash
pnpm add @kysera/executor
```

### 2. Plugin Architecture Changes

**v0.6:** Plugins were directly passed to `createORM()` or repository factories.

**v0.7:** Plugins are loaded via `createExecutor()` first, then the executor is passed to `createORM()`.

**Before (v0.6):**
```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

// Plugins passed directly to ORM
const orm = await createORM(db, [softDeletePlugin()])
```

**After (v0.7):**
```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugins first
const executor = await createExecutor(db, [softDeletePlugin()])

// Pass executor to ORM (no additional plugins needed)
const orm = await createORM(executor, [])
```

:::tip Simplified API
Actually, in v0.7, `createORM()` still accepts plugins for convenience! Both approaches work:

```typescript
// Approach 1: Pass plugins to createORM (backward compatible)
const orm = await createORM(db, [softDeletePlugin()])

// Approach 2: Use createExecutor first (recommended for DAL + Repository)
const executor = await createExecutor(db, [softDeletePlugin()])
const orm = await createORM(executor, [])
```

Use **Approach 2** if you're using both Repository and DAL patterns with shared plugins.
:::

### 3. DAL Plugin Support

**v0.6:** DAL queries had **no plugin support**. All filtering was manual.

**v0.7:** DAL queries support plugins via `createExecutor()`.

**Before (v0.6) - Manual Filtering:**
```typescript
import { createQuery } from '@kysera/dal'

// Must add soft-delete filter manually
const getActiveUsers = createQuery(ctx =>
  ctx.db
    .selectFrom('users')
    .selectAll()
    .where('deleted_at', 'is', null) // Manual filtering!
    .execute()
)

await getActiveUsers(db)
```

**After (v0.7) - Automatic Filtering:**
```typescript
import { createExecutor } from '@kysera/executor'
import { createQuery } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with soft-delete plugin
const executor = await createExecutor(db, [softDeletePlugin()])

// Query automatically filters soft-deleted records
const getUsers = createQuery(ctx =>
  ctx.db.selectFrom('users').selectAll().execute()
)

await getUsers(executor) // Soft-delete filter applied automatically!
```

### 4. MSSQL Pagination Requires ORDER BY

MSSQL's `OFFSET/FETCH NEXT` syntax **requires** an `ORDER BY` clause:

**Before (v0.6) - May Work Without ORDER BY:**
```typescript
import { paginate } from '@kysera/core'

// This worked in v0.6 for most databases
const result = await paginate(
  db.selectFrom('users').selectAll(),
  { page: 1, limit: 20 }
)
```

**After (v0.7) - MSSQL Requires ORDER BY:**
```typescript
import { paginate } from '@kysera/core'

// MSSQL requires ORDER BY
const result = await paginate(
  db.selectFrom('users')
    .selectAll()
    .orderBy('id', 'asc'), // Required for MSSQL!
  { page: 1, limit: 20, dialect: 'mssql' }
)
```

:::tip Auto-Detection
The `dialect` parameter is optional. Kysera auto-detects your database type from the Kysely instance. You only need to specify `dialect` explicitly for testing or multi-database scenarios.
:::

## Migration Steps

### Step 1: Update Dependencies

Update all Kysera packages to v0.7.x:

```bash
# Update all packages
pnpm add @kysera/core@^0.7.3 \
         @kysera/executor@^0.7.3 \
         @kysera/repository@^0.7.3 \
         @kysera/dal@^0.7.3 \
         @kysera/soft-delete@^0.7.3 \
         @kysera/rls@^0.7.3 \
         @kysera/audit@^0.7.3 \
         @kysera/timestamps@^0.7.3
```

**New in v0.7:**
- `@kysera/executor` is now required if using plugins

### Step 2: Update Imports

No import changes are needed for basic usage. If you're using plugins, you may want to import `createExecutor`:

```typescript
// New import in v0.7
import { createExecutor } from '@kysera/executor'

// Existing imports (unchanged)
import { createORM } from '@kysera/repository'
import { createQuery, withTransaction } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'
```

### Step 3: Update Repository Pattern (If Using Plugins)

If you're using the Repository pattern with plugins:

**Before (v0.6):**
```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

const orm = await createORM(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema })
])

const userRepo = orm.createRepository(createUserRepository)

// Plugin methods available
await userRepo.softDelete(1)
await userRepo.restore(1)
```

**After (v0.7) - Option 1 (Backward Compatible):**
```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

// No changes needed! Still works in v0.7
const orm = await createORM(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema })
])

const userRepo = orm.createRepository(createUserRepository)

// Plugin methods still available
await userRepo.softDelete(1)
await userRepo.restore(1)
```

**After (v0.7) - Option 2 (Recommended for DAL + Repository):**
```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

// Create executor with plugins
const executor = await createExecutor(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema })
])

// Pass executor to ORM (no additional plugins needed)
const orm = await createORM(executor, [])

const userRepo = orm.createRepository(createUserRepository)

// Plugin methods available
await userRepo.softDelete(1)
await userRepo.restore(1)
```

**Why Option 2?** If you're using both Repository and DAL patterns, Option 2 allows you to **share the same executor and plugins** across both patterns.

### Step 4: Update DAL Pattern (NEW Plugin Support)

The DAL pattern now supports plugins via `createExecutor`:

**Before (v0.6) - No Plugins:**
```typescript
import { createQuery } from '@kysera/dal'

// Manual soft-delete filtering
const getUsers = createQuery(ctx =>
  ctx.db
    .selectFrom('users')
    .selectAll()
    .where('deleted_at', 'is', null) // Manual filter
    .execute()
)

await getUsers(db)
```

**After (v0.7) - With Plugins:**
```typescript
import { createExecutor } from '@kysera/executor'
import { createQuery } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// Query automatically applies soft-delete filter
const getUsers = createQuery(ctx =>
  ctx.db.selectFrom('users').selectAll().execute()
)

await getUsers(executor) // Soft-delete filter applied!
```

**Transactions Also Work:**
```typescript
import { withTransaction } from '@kysera/dal'

await withTransaction(executor, async ctx => {
  // Plugins still apply inside transaction
  const users = await getUsers(ctx)
})
```

### Step 5: Update Pagination for MSSQL (If Applicable)

If you're using MSSQL, ensure all offset pagination queries include an `ORDER BY` clause:

**Before (v0.6):**
```typescript
import { paginate } from '@kysera/core'

const result = await paginate(
  db.selectFrom('users').selectAll(),
  { page: 1, limit: 20 }
)
```

**After (v0.7) - MSSQL Requires ORDER BY:**
```typescript
import { paginate } from '@kysera/core'

const result = await paginate(
  db.selectFrom('users')
    .selectAll()
    .orderBy('id', 'asc'), // Required for MSSQL!
  { page: 1, limit: 20 }
  // dialect auto-detected, or explicitly set: { dialect: 'mssql' }
)
```

**Cursor Pagination (MSSQL Optimized):**
```typescript
import { paginateCursor } from '@kysera/core'

const page1 = await paginateCursor(
  db.selectFrom('posts').selectAll(),
  {
    orderBy: [
      { column: 'created_at', direction: 'desc' },
      { column: 'id', direction: 'desc' }
    ],
    limit: 20
    // MSSQL uses TOP clause automatically when detected
  }
)
```

### Step 6: Update Tests

If you're testing with plugins, update your test setup:

**Before (v0.6):**
```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

describe('User Repository', () => {
  it('soft deletes users', async () => {
    const orm = await createORM(db, [softDeletePlugin()])
    const userRepo = orm.createRepository(createUserRepository)

    await userRepo.softDelete(1)
    const user = await userRepo.findById(1)
    expect(user).toBeNull()
  })
})
```

**After (v0.7):**
```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

describe('User Repository', () => {
  it('soft deletes users', async () => {
    // Create executor with plugins
    const executor = await createExecutor(db, [softDeletePlugin()])
    const orm = await createORM(executor, [])
    const userRepo = orm.createRepository(createUserRepository)

    await userRepo.softDelete(1)
    const user = await userRepo.findById(1)
    expect(user).toBeNull()

    // Clean up executor resources
    await executor.destroy()
  })
})
```

:::tip Resource Cleanup
Always call `executor.destroy()` in tests or during application shutdown to clean up plugin resources (connections, timers, etc.).
:::

## New Features in v0.7

### 1. CQRS-lite Pattern (Repository + DAL)

You can now use both Repository and DAL patterns in the same application with **shared plugins**:

```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { createQuery } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'
import { sql } from 'kysely'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// Create ORM using executor
const orm = await createORM(executor, [])

// Repository for writes (CRUD operations with full plugin support)
const userRepo = orm.createRepository(createUserRepository)

// DAL for complex reads (analytics, reports with same plugin filtering)
const getAnalytics = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('events')
    .select([
      sql<number>`count(*)`.as('total'),
      sql<number>`count(distinct date)`.as('activeDays')
    ])
    .where('user_id', '=', userId)
    .executeTakeFirst()
)

// Use both in same transaction with shared plugins
await orm.transaction(async ctx => {
  // Repository for writes (plugins + extension methods)
  const user = await userRepo.create({ email: 'test@example.com' })

  // DAL for complex reads (plugins applied via context)
  const stats = await getAnalytics(ctx, user.id)

  return { user, stats }
})
```

**Benefits:**
- Repository for writes (with extension methods like `softDelete()`, `restore()`)
- DAL for complex reads (better type inference, lower overhead)
- Shared plugins across both patterns
- Single transaction spanning both patterns

### 2. Executor Configuration

Configure plugin behavior at runtime:

```typescript
import { createExecutor } from '@kysera/executor'

// Disable plugins in development
const executor = await createExecutor(db, plugins, {
  enabled: process.env.NODE_ENV === 'production'
})

// Conditionally enable plugins
const executor = await createExecutor(db, plugins, {
  enabled: featureFlags.rlsEnabled
})
```

### 3. Plugin Lifecycle Hooks

Plugins now support `onInit` and `onDestroy` lifecycle hooks:

```typescript
import type { Plugin } from '@kysera/executor'

const myPlugin = (): Plugin => ({
  name: '@myapp/custom-plugin',
  version: '1.0.0',

  async onInit(db) {
    // Called once during createExecutor
    console.log('Plugin initialized')
    // Validate schema, setup resources, etc.
  },

  async onDestroy() {
    // Called during cleanup
    console.log('Plugin destroyed')
    // Close connections, clear timers, etc.
  },

  interceptQuery(qb, context) {
    // Intercept and modify queries
    return qb
  }
})

const executor = await createExecutor(db, [myPlugin()])
// ... use executor ...
await executor.destroy() // Calls onDestroy for cleanup
```

### 4. Plugin Validation

Automatic plugin validation detects conflicts and missing dependencies:

```typescript
import { createExecutor, PluginValidationError } from '@kysera/executor'

try {
  const executor = await createExecutor(db, [
    pluginA(), // depends on pluginB
    // pluginB missing!
  ])
} catch (error) {
  if (error instanceof PluginValidationError) {
    console.log(error.type) // 'MISSING_DEPENDENCY'
    console.log(error.details) // { pluginName: 'pluginA', missingDependency: 'pluginB' }
  }
}
```

**Validation Checks:**
- Duplicate plugin names
- Missing dependencies
- Conflicting plugins
- Circular dependencies

### 5. Raw Database Access

Bypass plugin interceptors when needed:

```typescript
import { getRawDb } from '@kysera/executor'

const executor = await createExecutor(db, [softDeletePlugin()])

// With plugins (soft-delete filter applied)
const users = await executor.selectFrom('users').selectAll().execute()

// Without plugins (bypass soft-delete filter)
const rawDb = getRawDb(executor)
const allUsers = await rawDb.selectFrom('users').selectAll().execute()
```

**Use Cases:**
- Admin operations requiring full database access
- Plugin internal queries (avoid double-filtering)
- Performance-critical queries

### 6. Multi-Database Testing

v0.7 includes improved testing utilities for multi-database scenarios:

```bash
# Test against PostgreSQL, MySQL, SQLite
pnpm test:multi-db

# Test with Docker containers
pnpm test:docker
```

**Environment Variables:**
```bash
# PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost:5432/kysera_test

# MySQL
MYSQL_DATABASE_URL=mysql://user:pass@localhost:3306/kysera_test

# SQLite (default)
SQLITE_DATABASE_URL=:memory:

# MSSQL (new in v0.7)
MSSQL_DATABASE_URL=mssql://user:pass@localhost:1433/kysera_test
```

## Deprecation Notices

### 1. Direct Kysely Instance with Plugins (Soft Deprecation)

**What's Deprecated:**
Passing raw Kysely instances to Repository or DAL when using plugins.

**Current Behavior (v0.7):**
Still works, but plugins won't intercept queries in DAL.

**Recommended Approach:**
Use `createExecutor()` for plugin support:

```typescript
// Deprecated (still works, but no DAL plugin support)
const orm = await createORM(db, [softDeletePlugin()])

// Recommended (full plugin support for both Repository and DAL)
const executor = await createExecutor(db, [softDeletePlugin()])
const orm = await createORM(executor, [])
```

**Timeline:**
- v0.7: Soft deprecation (warning in docs)
- v0.8: Deprecation warning in console
- v1.0: May require executor for plugins

### 2. Helper Functions in @kysera/dialects (Soft Deprecation)

**What's Deprecated:**
Helper functions like `tableExists(db, table, dialect)`.

**Recommended Approach:**
Use the adapter pattern:

```typescript
// Deprecated (still works)
import { tableExists } from '@kysera/dialects'
const exists = await tableExists(db, 'users', 'postgres')

// Recommended (better performance, type safety)
import { getAdapter } from '@kysera/dialects'
const adapter = getAdapter('postgres')
const exists = await adapter.tableExists(db, 'users')
```

**Timeline:**
- v0.7: Soft deprecation (recommendation in docs)
- Future versions: May be removed in favor of adapter pattern

## Troubleshooting

### Issue: "Cannot find module '@kysera/executor'"

**Cause:** Missing peer dependency.

**Solution:** Install `@kysera/executor`:

```bash
pnpm add @kysera/executor
```

### Issue: "MSSQL requires ORDER BY for offset pagination"

**Cause:** MSSQL's `OFFSET/FETCH NEXT` syntax requires an ORDER BY clause.

**Solution:** Add `.orderBy()` to your query:

```typescript
// Before (fails on MSSQL)
const result = await paginate(
  db.selectFrom('users').selectAll(),
  { page: 1, limit: 20 }
)

// After (works on all databases)
const result = await paginate(
  db.selectFrom('users').selectAll().orderBy('id', 'asc'),
  { page: 1, limit: 20 }
)
```

### Issue: Plugins Not Applying in DAL Queries

**Cause:** Passing raw Kysely instance instead of executor.

**Solution:** Create executor and pass it to DAL queries:

```typescript
// Before (plugins don't apply)
const getUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())
await getUsers(db) // No plugins!

// After (plugins apply)
const executor = await createExecutor(db, [softDeletePlugin()])
await getUsers(executor) // Plugins work!
```

### Issue: Memory Leak in Tests

**Cause:** Not destroying executor after tests.

**Solution:** Call `executor.destroy()` in cleanup:

```typescript
describe('Tests', () => {
  let executor: KyseraExecutor<Database>

  beforeEach(async () => {
    executor = await createExecutor(db, [myPlugin()])
  })

  afterEach(async () => {
    await executor.destroy() // Clean up resources
  })

  it('works', async () => {
    // Test code
  })
})
```

### Issue: Type Errors After Upgrade

**Cause:** Outdated type definitions.

**Solution:** Clear caches and rebuild:

```bash
# Clear Turborepo cache
turbo daemon clean

# Clear node_modules and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Rebuild all packages
pnpm build

# Run type checking
pnpm typecheck
```

## Performance Considerations

### Zero Overhead When No Plugins

The executor has **zero overhead** when no plugins are registered or when plugins don't use interceptors:

```typescript
// No plugins - zero overhead (returns augmented Kysely)
const executor = await createExecutor(db, [])

// No interceptors - minimal overhead (returns augmented Kysely)
const executor = await createExecutor(db, [auditPlugin()]) // Only uses extendRepository

// With interceptors - optimized Proxy
const executor = await createExecutor(db, [softDeletePlugin()]) // Uses interceptQuery
```

### Plugin Interception Overhead

Benchmark results (relative to plain Kysely):

| Scenario                     | Overhead |
| ---------------------------- | -------- |
| Plain Kysely                 | 1.0x     |
| Executor with no plugins     | ~1.0x    |
| Executor with 1 plugin       | ~1.1x    |
| Executor with 3 plugins      | ~1.2x    |
| Executor with 5 plugins      | ~1.3x    |

**Optimization:** Use specific plugins only where needed, not globally.

### Transaction Performance

Transactions inherit plugins with minimal overhead:

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

await executor.transaction().execute(async trx => {
  // trx inherits plugins (same overhead as executor)
  const users = await trx.selectFrom('users').selectAll().execute()
})
```

## Testing Updates

### Multi-Database Testing

Test your code against all supported databases:

```bash
# Test all databases (PostgreSQL, MySQL, SQLite, MSSQL)
pnpm test:multi-db

# Docker-based testing
pnpm docker:up    # Start PostgreSQL, MySQL, MSSQL
pnpm test:docker  # Run tests
pnpm docker:down  # Stop containers
```

### Test Utilities

New testing utilities in v0.7:

```typescript
import { createExecutor, destroyExecutor } from '@kysera/executor'
import { testInTransaction } from '@kysera/testing'

describe('User Tests', () => {
  let executor: KyseraExecutor<Database>

  beforeEach(async () => {
    executor = await createExecutor(db, [softDeletePlugin()])
  })

  afterEach(async () => {
    await destroyExecutor(executor)
  })

  it('creates user', async () => {
    await testInTransaction(executor, async trx => {
      const orm = await createORM(trx, [])
      const userRepo = orm.createRepository(createUserRepository)

      const user = await userRepo.create({ email: 'test@example.com' })
      expect(user.id).toBeDefined()
      // Auto-rollback - no cleanup needed!
    })
  })
})
```

## Next Steps

After migrating to v0.7:

1. **Read the Executor Documentation:** [API Reference](/docs/api/executor)
2. **Explore Plugin Capabilities:** [Plugin Overview](/docs/plugins/overview)
3. **Review Best Practices:** [Best Practices Guide](/docs/guides/best-practices)
4. **Try CQRS-lite Pattern:** [Repository vs DAL Guide](/docs/guides/dal-vs-repository)
5. **Check MSSQL Support:** [Dialects API](/docs/api/dialects)

## Getting Help

If you encounter issues during migration:

- **Documentation:** Check the [API Reference](/docs/api/overview)
- **GitHub Issues:** [Report a bug](https://github.com/kysera-dev/kysera/issues)
- **Discussions:** [Ask questions](https://github.com/kysera-dev/kysera/discussions)

## See Also

- [Executor API](/docs/api/executor) - Complete executor reference
- [Repository API](/docs/api/repository) - Repository pattern reference
- [DAL API](/docs/api/dal) - Functional DAL reference
- [Best Practices](/docs/guides/best-practices) - Production patterns
- [Repository vs DAL](/docs/guides/dal-vs-repository) - Pattern comparison
- [Pagination Guide](/docs/guides/pagination) - MSSQL pagination support
- [Dialects API](/docs/api/dialects) - Multi-database support
