---
sidebar_position: 4
title: '@kysera/executor'
description: Unified Execution Layer API reference
---

# @kysera/executor

Unified Execution Layer for Kysera - Plugin-aware Kysely wrapper that enables plugins to work seamlessly with both Repository and DAL patterns.

## Installation

```bash
npm install @kysera/executor kysely
```

## Overview

**Dependencies:** None (peer: kysely >=0.28.8)

`@kysera/executor` provides a unified plugin system that works seamlessly with both Repository and DAL patterns. It wraps Kysely instances with plugin interception capabilities while maintaining full type safety and zero overhead when plugins aren't active.

## Key Features

- **Unified Plugin System** - Single plugin architecture for both Repository and DAL
- **Zero Overhead** - No performance penalty when no interceptor plugins are registered
- **Type Safe** - Full TypeScript support with Kysely types preserved
- **Transaction Support** - Plugins automatically propagate through transactions
- **Plugin Validation** - Detects conflicts, missing dependencies, and circular dependencies
- **Cross-Runtime** - Works with Node.js, Bun, and Deno

## Quick Start

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

const executor = await createExecutor(db, [softDeletePlugin()])

// All queries now have soft-delete filter applied automatically
const users = await executor.selectFrom('users').selectAll().execute()
```

**Intercepted Methods:**

The executor intercepts these Kysely methods to apply plugins:

- `selectFrom(table)` - SELECT queries
- `insertInto(table)` - INSERT queries
- `updateTable(table)` - UPDATE queries
- `deleteFrom(table)` - DELETE queries
- `replaceInto(table)` - MySQL REPLACE queries
- `mergeInto(table)` - SQL MERGE queries (Kysely 0.28.x)

All other Kysely methods pass through unchanged.

## Core Functions

### createExecutor

Creates a plugin-aware executor with async plugin initialization.

```typescript
async function createExecutor<DB>(
  db: Kysely<DB>,
  plugins?: readonly Plugin[],
  config?: ExecutorConfig
): Promise<KyseraExecutor<DB>>
```

**Parameters:**

- `db` - Kysely database instance
- `plugins` - Array of plugins to apply (default: `[]`)
- `config.enabled` - Enable/disable plugin interception at runtime (default: `true`)

**Returns:** `KyseraExecutor<DB>` - Plugin-aware Kysely wrapper

**Example:**

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

// With multiple plugins
const executor = await createExecutor(db, [softDeletePlugin(), rlsPlugin({ schema: rlsSchema })])

// With config
const executor = await createExecutor(db, plugins, {
  enabled: process.env.NODE_ENV === 'production'
})

// Use like normal Kysely instance
const users = await executor.selectFrom('users').selectAll().execute()
```

**Plugin Initialization:**

Plugins are:

1. Validated for conflicts and dependencies
2. Sorted by priority and dependencies (topological sort)
3. Initialized via `onInit` lifecycle hook (async)
4. Cached for efficient interception

**Performance:**

- **No plugins:** Returns augmented Kysely instance (zero overhead)
- **No interceptors:** Returns augmented Kysely instance (minimal overhead)
- **With interceptors:** Uses optimized Proxy with method caching

### destroyExecutor

Destroy an executor and call cleanup hooks for all plugins.

```typescript
async function destroyExecutor<DB>(executor: KyseraExecutor<DB>): Promise<void>
```

**Parameters:**

- `executor` - KyseraExecutor instance to destroy

**Returns:** `Promise<void>` - Resolves when all plugin `onDestroy` hooks have completed

**Example:**

```typescript
import { createExecutor, destroyExecutor } from '@kysera/executor'

const executor = await createExecutor(db, [myPlugin()])

// Use executor...
const users = await executor.selectFrom('users').selectAll().execute()

// Clean up when done (e.g., during application shutdown)
await destroyExecutor(executor)
```

**Use Cases:**

- Application shutdown - clean up plugin resources (connections, timers, etc.)
- Testing - ensure clean state between tests
- Hot reloading - destroy old executor before creating new one
- Resource management - explicitly release plugin resources

**Behavior:**

- Calls `onDestroy()` hook for each plugin in reverse order (dependencies last)
- Ignores plugins without `onDestroy` hook
- Errors in cleanup hooks are logged but don't throw (best-effort cleanup)
- Safe to call multiple times (no-op after first call)

### createExecutorSync

Synchronous version of `createExecutor` that skips async plugin initialization.

```typescript
function createExecutorSync<DB>(
  db: Kysely<DB>,
  plugins?: readonly Plugin[],
  config?: ExecutorConfig
): KyseraExecutor<DB>
```

**Parameters:**

- `db` - Kysely database instance
- `plugins` - Array of plugins to apply (default: `[]`)
- `config.enabled` - Enable/disable plugin interception (default: `true`)

**Returns:** `KyseraExecutor<DB>` - Plugin-aware Kysely wrapper

**Example:**

```typescript
import { createExecutorSync } from '@kysera/executor'

// Synchronous creation (no onInit hooks called)
const executor = createExecutorSync(db, [softDeletePlugin()])

// Use immediately
const users = await executor.selectFrom('users').selectAll().execute()
```

**Use Cases:**

- Plugins without `onInit` hooks
- Performance-critical initialization paths
- Testing scenarios where initialization isn't needed

**Limitations:**

- Does not call `plugin.onInit()` hooks
- Plugins requiring async initialization will not work correctly

### isKyseraExecutor

Type guard to check if a value is a `KyseraExecutor`.

```typescript
function isKyseraExecutor<DB>(value: Kysely<DB> | KyseraExecutor<DB>): value is KyseraExecutor<DB>
```

**Parameters:**

- `value` - Kysely or KyseraExecutor instance to check

**Returns:** `true` if value is a KyseraExecutor, `false` otherwise

**Example:**

```typescript
import { isKyseraExecutor, createExecutor } from '@kysera/executor'

function processDb(db: Kysely<DB> | KyseraExecutor<DB>) {
  if (isKyseraExecutor(db)) {
    const plugins = db.__plugins
    console.log(`Using ${plugins.length} plugins`)
  } else {
    console.log('Plain Kysely instance')
  }
}

const executor = await createExecutor(db, [softDeletePlugin()])
processDb(executor) // "Using 1 plugins"
processDb(db) // "Plain Kysely instance"
```

### getPlugins

Get the list of plugins from a KyseraExecutor.

```typescript
function getPlugins<DB>(executor: KyseraExecutor<DB>): readonly Plugin[]
```

**Parameters:**

- `executor` - KyseraExecutor instance

**Returns:** Array of plugins in execution order

**Example:**

```typescript
import { getPlugins } from '@kysera/executor'

const executor = await createExecutor(db, [softDeletePlugin(), rlsPlugin({ schema })])

const plugins = getPlugins(executor)
console.log(plugins.map(p => p.name))
// ['@kysera/rls', '@kysera/soft-delete']
// (ordered by priority and dependencies)
```

### getRawDb

Get the raw Kysely instance from an executor, bypassing plugin interceptors.

```typescript
function getRawDb<DB>(executor: Kysely<DB>): Kysely<DB>
```

**Parameters:**

- `executor` - Kysely or KyseraExecutor instance

**Returns:** Raw Kysely instance without plugin interception

**Example:**

```typescript
import { getRawDb } from '@kysera/executor'

const executor = await createExecutor(db, [softDeletePlugin()])

// This query has soft-delete filter applied
const users = await executor.selectFrom('users').selectAll().execute()

// This query BYPASSES soft-delete filter
const rawDb = getRawDb(executor)
const allUsers = await rawDb.selectFrom('users').selectAll().execute()
```

**Use Cases:**

- Plugin internal queries that shouldn't trigger interceptors
- Avoiding double-filtering (e.g., soft-delete plugin checking its own records)
- Admin operations that need full database access
- Performance-critical queries where plugin overhead must be avoided

**Safety:**

Use with caution - bypassing plugins can expose deleted records, violate RLS policies, etc.

### wrapTransaction

Wrap a transaction with plugins from an executor.

```typescript
function wrapTransaction<DB>(
  trx: Transaction<DB>,
  plugins: readonly Plugin[]
): KyseraTransaction<DB>
```

**Parameters:**

- `trx` - Kysely transaction instance
- `plugins` - Array of plugins to apply

**Returns:** `KyseraTransaction<DB>` - Plugin-aware transaction

**Example:**

```typescript
import { wrapTransaction, getPlugins } from '@kysera/executor'

const executor = await createExecutor(db, [softDeletePlugin()])

await db.transaction().execute(async trx => {
  // Wrap transaction with same plugins as executor
  const wrappedTrx = wrapTransaction(trx, getPlugins(executor))

  // Plugins applied within transaction
  const users = await wrappedTrx.selectFrom('users').selectAll().execute()
})
```

**Note:** Usually not needed - `executor.transaction()` automatically wraps transactions.

### applyPlugins

Manually apply plugins to a query builder.

```typescript
function applyPlugins<QB>(qb: QB, plugins: readonly Plugin[], context: QueryBuilderContext): QB
```

**Parameters:**

- `qb` - Query builder instance
- `plugins` - Array of plugins to apply
- `context` - Query context (operation, table, metadata)

**Returns:** Modified query builder

**Example:**

```typescript
import { applyPlugins, getPlugins } from '@kysera/executor'

const executor = await createExecutor(db, [softDeletePlugin()])

// Manual plugin application for complex queries
let query = db.selectFrom('users').selectAll()

query = applyPlugins(query, getPlugins(executor), {
  operation: 'select',
  table: 'users',
  metadata: {}
})

const users = await query.execute()
```

**Use Cases:**

- Dynamic query building where automatic interception doesn't work
- Custom query builder patterns
- Testing plugin behavior in isolation

### validatePlugins

Validate plugins for conflicts, dependencies, and circular dependencies.

```typescript
function validatePlugins(plugins: readonly Plugin[]): void
```

**Parameters:**

- `plugins` - Array of plugins to validate

**Throws:** `PluginValidationError` if validation fails

**Example:**

```typescript
import { validatePlugins, PluginValidationError } from '@kysera/executor'

try {
  validatePlugins([
    { name: 'plugin-a', version: '1.0.0', dependencies: ['plugin-b'] },
    { name: 'plugin-b', version: '1.0.0', dependencies: ['plugin-a'] }
  ])
} catch (error) {
  if (error instanceof PluginValidationError) {
    console.log(error.type) // 'CIRCULAR_DEPENDENCY'
    console.log(error.details) // { pluginName: 'plugin-a', cycle: [...] }
  }
}
```

**Validation Checks:**

1. **Duplicate Names** - Each plugin must have a unique name
2. **Missing Dependencies** - All dependencies must be registered
3. **Conflicts** - Conflicting plugins cannot be loaded together
4. **Circular Dependencies** - Dependency graph must be acyclic

**Error Types:**

```typescript
type PluginValidationErrorType =
  | 'DUPLICATE_NAME'
  | 'MISSING_DEPENDENCY'
  | 'CONFLICT'
  | 'CIRCULAR_DEPENDENCY'
  | 'INITIALIZATION_FAILED'
```

### resolvePluginOrder

Resolve plugin execution order using topological sort with priority.

```typescript
function resolvePluginOrder(plugins: readonly Plugin[]): Plugin[]
```

**Parameters:**

- `plugins` - Array of plugins to sort

**Returns:** Sorted array of plugins in execution order

**Example:**

```typescript
import { resolvePluginOrder } from '@kysera/executor'

const sorted = resolvePluginOrder([
  { name: 'audit', version: '1.0.0', priority: 0 },
  { name: 'rls', version: '1.0.0', priority: 50 },
  { name: 'soft-delete', version: '1.0.0', priority: 0 }
])

console.log(sorted.map(p => p.name))
// ['rls', 'audit', 'soft-delete']
// (rls first due to priority 50, then alphabetical)
```

**Ordering Algorithm:**

1. **Topological Sort** - Plugins with dependencies run after their dependencies
2. **Priority** - Within same level, higher priority runs first (default: 0)
3. **Tie-Breaking** - Alphabetical by name for stability

**Priority Guidelines:**

- **50**: Security plugins (RLS) - must filter before other plugins see data
- **10**: Validation plugins - validate early
- **0**: Standard plugins (default)
- **-10**: Logging/audit plugins - capture final state

## Types

### Plugin

Plugin interface for extending Kysera functionality.

```typescript
interface Plugin {
  /** Unique plugin name */
  readonly name: string
  /** Plugin version */
  readonly version: string
  /** Plugin dependencies (must be loaded first) */
  readonly dependencies?: readonly string[]
  /** Higher priority = runs first (default: 0) */
  readonly priority?: number
  /** Plugins that conflict with this one */
  readonly conflictsWith?: readonly string[]

  /** Lifecycle: Called once when plugin is initialized */
  onInit?<DB>(db: Kysely<DB>): Promise<void> | void

  /** Lifecycle: Called when plugin is destroyed (cleanup) */
  onDestroy?(): Promise<void> | void

  /** Query interception: Modify query builder before execution */
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB

  /** Repository extensions: Add methods to repositories (Repository pattern only) */
  extendRepository?<T extends object>(repo: T): T
}
```

**Plugin Hooks:**

| Hook               | When Called                                   | Use Case                                |
| ------------------ | --------------------------------------------- | --------------------------------------- |
| `onInit`           | Once during `createExecutor`                  | Setup, validation, schema checks        |
| `onDestroy`        | During cleanup (manual or shutdown)           | Close connections, release resources    |
| `interceptQuery`   | Before query execution                        | Add WHERE clauses, modify queries       |
| `extendRepository` | Repository creation (Repository pattern only) | Add custom methods                      |

**Example:**

```typescript
import type { Plugin } from '@kysera/executor'

const loggingPlugin: Plugin = {
  name: '@myapp/logging',
  version: '1.0.0',
  priority: -10, // Run after other plugins

  onInit: async db => {
    console.log('Plugin initialized')
  },

  interceptQuery: (qb, context) => {
    console.log(`Query: ${context.operation} on ${context.table}`)
    return qb
  }
}
```

### QueryBuilderContext

Context passed to `interceptQuery` hooks.

```typescript
interface QueryBuilderContext {
  /** Type of operation */
  readonly operation: 'select' | 'insert' | 'update' | 'delete' | 'replace' | 'merge'
  /** Table name */
  readonly table: string
  /** Current schema context (if withSchema was called) */
  readonly schema?: string
  /** Additional metadata (shared across plugin chain) */
  readonly metadata: Record<string, unknown>
}
```

**Schema Context:**

When `executor.withSchema()` is used, the `schema` property contains the current schema name. This allows plugins to adjust their behavior based on schema context:

```typescript
interceptQuery: (qb, context) => {
  if (context.schema === 'system') {
    // Skip filtering for system schema
    return qb
  }
  return qb.where('deleted_at', 'is', null)
}
```

**Example:**

```typescript
interceptQuery: (qb, context) => {
  // Check operation type
  if (context.operation === 'select') {
    return qb.where(`${context.table}.deleted_at`, 'is', null)
  }

  // Share data between plugins via metadata
  context.metadata['processed_by_my_plugin'] = true

  return qb
}
```

**Metadata Usage:**

Plugins can use `context.metadata` to communicate:

```typescript
// Plugin A sets metadata
const pluginA: Plugin = {
  name: 'plugin-a',
  interceptQuery: (qb, context) => {
    context.metadata['skip_plugin_b'] = true
    return qb
  }
}

// Plugin B reads metadata
const pluginB: Plugin = {
  name: 'plugin-b',
  dependencies: ['plugin-a'],
  interceptQuery: (qb, context) => {
    if (context.metadata['skip_plugin_b']) {
      return qb // Skip processing
    }
    return qb.where('active', '=', true)
  }
}
```

### KyseraExecutor

Plugin-aware Kysely wrapper type.

```typescript
type KyseraExecutor<DB> = Kysely<DB> & KyseraExecutorMarker<DB>

interface KyseraExecutorMarker<DB = unknown> {
  readonly __kysera: true
  readonly __plugins: readonly Plugin[]
  readonly __rawDb: Kysely<DB>
  readonly __schema?: string
}
```

**Properties:**

- `__kysera` - Type marker (always `true`)
- `__plugins` - Registered plugins in execution order
- `__rawDb` - Raw Kysely instance bypassing interceptors
- `__schema` - Current schema context (when `withSchema()` is used)

**Example:**

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

// Access marker properties
console.log(executor.__kysera) // true
console.log(executor.__plugins.length) // 1
console.log(executor.__rawDb === db) // true

// Use as normal Kysely instance
const users = await executor.selectFrom('users').selectAll().execute()
```

### KyseraTransaction

Plugin-aware Transaction wrapper type.

```typescript
type KyseraTransaction<DB> = Transaction<DB> & KyseraExecutorMarker<DB>
```

Transactions created from `KyseraExecutor` automatically inherit plugins:

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

await executor.transaction().execute(async trx => {
  // trx is KyseraTransaction<DB> with plugins
  console.log(trx.__kysera) // true
  console.log(trx.__plugins.length) // 1

  // Queries inside transaction have plugins applied
  const users = await trx.selectFrom('users').selectAll().execute()
})
```

### ExecutorConfig

Configuration for executor creation.

```typescript
interface ExecutorConfig {
  /** Enable/disable plugin interception at runtime */
  readonly enabled?: boolean
}
```

**Example:**

```typescript
// Disable plugins in development
const executor = await createExecutor(db, plugins, {
  enabled: process.env.NODE_ENV === 'production'
})

// Conditionally enable plugins
const executor = await createExecutor(db, plugins, {
  enabled: featureFlags.pluginsEnabled
})
```

### PluginValidationError

Error thrown when plugin validation fails.

```typescript
class PluginValidationError extends Error {
  constructor(
    message: string,
    public readonly type: PluginValidationErrorType,
    public readonly details: PluginValidationDetails
  );
}

type PluginValidationErrorType =
  | 'DUPLICATE_NAME'
  | 'MISSING_DEPENDENCY'
  | 'CONFLICT'
  | 'CIRCULAR_DEPENDENCY'
  | 'INITIALIZATION_FAILED';

interface PluginValidationDetails {
  readonly pluginName: string;
  readonly missingDependency?: string;
  readonly conflictingPlugin?: string;
  readonly cycle?: readonly string[];
}
```

**Example:**

```typescript
import { validatePlugins, PluginValidationError } from '@kysera/executor'

try {
  validatePlugins(plugins)
} catch (error) {
  if (error instanceof PluginValidationError) {
    switch (error.type) {
      case 'DUPLICATE_NAME':
        console.error(`Duplicate plugin: ${error.details.pluginName}`)
        break
      case 'MISSING_DEPENDENCY':
        console.error(
          `Plugin "${error.details.pluginName}" requires "${error.details.missingDependency}"`
        )
        break
      case 'CONFLICT':
        console.error(
          `Plugin "${error.details.pluginName}" conflicts with "${error.details.conflictingPlugin}"`
        )
        break
      case 'CIRCULAR_DEPENDENCY':
        console.error(`Circular dependency: ${error.details.cycle?.join(' -> ')}`)
        break
    }
  }
}
```

### BaseRepositoryLike

Base interface for repository-like objects that can be extended by plugins.

```typescript
interface BaseRepositoryLike<DB = unknown> {
  /** The name of the database table this repository manages */
  readonly tableName: string
  /** The Kysely executor (database or transaction) */
  readonly executor: Kysely<DB>
  /** Find a record by its primary key */
  findById?: (id: unknown) => Promise<unknown>
  /** Find all records in the table */
  findAll?: () => Promise<unknown[]>
  /** Create a new record */
  create?: (data: unknown) => Promise<unknown>
  /** Update an existing record by primary key */
  update?: (id: unknown, data: unknown) => Promise<unknown>
  /** Delete a record by primary key (returns deleted record or boolean) */
  delete?: (id: unknown) => Promise<unknown>
}
```

This interface represents the minimum contract that a repository-like object must fulfill to be extended by plugins. It's designed to work with both the `@kysera/repository` pattern and custom repository implementations.

### isRepositoryLike

Type guard to check if an object is a repository-like object.

```typescript
function isRepositoryLike<DB = unknown>(obj: unknown): obj is BaseRepositoryLike<DB>
```

**Parameters:**

- `obj` - The object to check

**Returns:** `true` if the object is repository-like, `false` otherwise

**Example:**

```typescript
import { isRepositoryLike } from '@kysera/executor'

// In a plugin's extendRepository method:
extendRepository<T extends object>(repo: T): T {
  if (!isRepositoryLike(repo)) {
    return repo // Not a repository, skip extension
  }

  // Now we can safely access repo.tableName and repo.executor
  const { tableName, executor } = repo
  // ... extend the repository
}
```

## Intercepted Methods

The executor intercepts these Kysely methods to apply plugins:

```typescript
const INTERCEPTED_METHODS = {
  selectFrom: 'select',
  insertInto: 'insert',
  updateTable: 'update',
  deleteFrom: 'delete',
  replaceInto: 'replace',  // MySQL REPLACE
  mergeInto: 'merge'       // SQL MERGE (Kysely 0.28.x)
} as const
```

**Method Interception:**

| Kysely Method        | Operation Type | Plugins Applied |
| -------------------- | -------------- | --------------- |
| `selectFrom(table)`  | `'select'`     | ✅ Yes          |
| `insertInto(table)`  | `'insert'`     | ✅ Yes          |
| `updateTable(table)` | `'update'`     | ✅ Yes          |
| `deleteFrom(table)`  | `'delete'`     | ✅ Yes          |
| `replaceInto(table)` | `'replace'`    | ✅ Yes          |
| `mergeInto(table)`   | `'merge'`      | ✅ Yes          |
| All other methods    | N/A            | ❌ Pass-through |

**What this means:**

- Only table-starting methods trigger plugin interception
- Builder methods (`.where()`, `.select()`, `.join()`, etc.) pass through unchanged
- Execution methods (`.execute()`, `.executeTakeFirst()`) pass through unchanged
- Schema methods (`.schema`, `.introspection`) pass through unchanged

**Example:**

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

// ✅ Plugin intercepted (selectFrom triggers interception)
const users = await executor.selectFrom('users').selectAll().execute()
// WHERE deleted_at IS NULL is added

// ❌ Plugin NOT intercepted (starting with .with, not selectFrom)
const result = await executor
  .with('active_users', qb => qb.selectFrom('users').selectAll())
  .selectFrom('active_users')
  .selectAll()
  .execute()
// No deleted_at filter added (limitation - see below)
```

## Limitations

While the executor provides powerful plugin capabilities, there are some limitations to be aware of:

### 1. SQL Template Strings (`sql`...`)

Raw SQL template strings bypass plugin interception entirely:

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

// ❌ NO plugin filtering - raw SQL bypasses interception
const users = await sql<User[]>`SELECT * FROM users`.execute(executor)
// Returns ALL users including deleted ones

// ✅ Use query builder instead
const users = await executor.selectFrom('users').selectAll().execute()
// Soft-delete filter applied correctly
```

**Workaround:** Use Kysely's query builder methods instead of raw SQL when plugins are needed.

### 2. CTEs (Common Table Expressions)

Queries starting with `.with()` are not intercepted:

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

// ❌ NO plugin filtering on CTE definition
const result = await executor
  .with('active_users', qb =>
    qb.selectFrom('users').selectAll() // No soft-delete filter here!
  )
  .selectFrom('active_users')
  .selectAll()
  .execute()

// ✅ Workaround: Apply plugins manually in CTE
const result = await executor
  .with('active_users', qb =>
    qb
      .selectFrom('users')
      .selectAll()
      .where('deleted_at', 'is', null) // Manual filter
  )
  .selectFrom('active_users')
  .selectAll()
  .execute()
```

**Workaround:** Manually apply filters in CTE definitions or use `applyPlugins()` helper.

### 3. Dynamic Query Building

Queries built outside the executor context don't get plugin interception:

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

// ❌ Building query before passing to executor
const baseQuery = db.selectFrom('users').selectAll()
const users = await baseQuery.execute() // No plugins applied

// ✅ Build query through executor
const users = await executor.selectFrom('users').selectAll().execute()
```

**Workaround:** Always start queries from the executor, not the raw database instance.

### 4. Subqueries

Subqueries created with `.selectFrom()` inside expressions don't trigger interception:

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

// ⚠️ Outer query gets filtering, subquery doesn't
const posts = await executor
  .selectFrom('posts')
  .select([
    'posts.id',
    'posts.title',
    eb =>
      eb
        .selectFrom('users') // Subquery - no soft-delete filter!
        .select('name')
        .whereRef('users.id', '=', 'posts.user_id')
        .as('author_name')
  ])
  .execute()

// ✅ Workaround: Use joins or apply filters manually
const posts = await executor
  .selectFrom('posts')
  .innerJoin('users', 'users.id', 'posts.user_id')
  .where('users.deleted_at', 'is', null) // Manual filter for join
  .select(['posts.id', 'posts.title', 'users.name as author_name'])
  .execute()
```

**Workaround:** Use joins instead of subqueries, or manually apply plugin filters.

### 5. Schema Introspection

Kysely's schema introspection methods bypass plugins:

```typescript
const executor = await createExecutor(db, [rlsPlugin({ schema: rlsSchema })])

// ❌ NO RLS filtering on introspection
const tables = await executor.introspection.getTables()
// Returns all tables regardless of RLS context
```

**Note:** This is expected behavior - introspection is metadata only and should not be filtered.

## Usage Patterns

### With Repository Pattern

```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// Create repository manager using executor (no additional plugins needed)
const orm = await createORM(executor, [])

const userRepo = orm.createRepository(exec => {
  const factory = createRepositoryFactory(exec)
  return factory.create({
    tableName: 'users',
    mapRow: row => row,
    schemas: { create: CreateUserSchema }
  })
})

// Repository has plugin methods
await userRepo.softDelete(userId)
```

### With DAL Pattern

```typescript
import { createExecutor } from '@kysera/executor'
import { createQuery, withTransaction } from '@kysera/dal'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin(), rlsPlugin({ schema: rlsSchema })])

// Create DAL queries
const getUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())

const createUser = createQuery((ctx, data: CreateUserInput) =>
  ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
)

// Plugins applied automatically
const users = await getUsers(executor)

// Plugins work in transactions
await withTransaction(executor, async ctx => {
  const user = await createUser(ctx, userData)
  return user
})
```

### Transaction Propagation

Plugins automatically propagate through transactions:

```typescript
const executor = await createExecutor(db, [softDeletePlugin(), rlsPlugin({ schema: rlsSchema })])

await executor.transaction().execute(async trx => {
  // trx inherits all plugins from executor
  const users = await trx.selectFrom('users').selectAll().execute()
  // ✅ Soft-delete filter applied
  // ✅ RLS filter applied

  await trx.insertInto('posts').values({ title: 'Post', user_id: 1 }).execute()
  // ✅ RLS context applied
})
```

### Bypassing Plugins

Use `getRawDb` to bypass plugin interceptors:

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

// With plugins
const activeUsers = await executor.selectFrom('users').selectAll().execute()
// Returns only non-deleted users

// Without plugins
const rawDb = getRawDb(executor)
const allUsers = await rawDb.selectFrom('users').selectAll().execute()
// Returns ALL users including deleted
```

### Custom Plugin Example

```typescript
import type { Plugin, QueryBuilderContext } from '@kysera/executor'

const tenantPlugin = (tenantId: string): Plugin => ({
  name: '@myapp/tenant-filter',
  version: '1.0.0',
  priority: 50, // High priority - run before other plugins

  interceptQuery: (qb, context) => {
    // Only apply to SELECT queries
    if (context.operation === 'select') {
      return qb.where('tenant_id', '=', tenantId)
    }
    return qb
  },

  extendRepository: (repo: any) => ({
    ...repo,
    // Add method to query across all tenants
    findAllTenants: async () => {
      const rawDb = getRawDb(repo.executor)
      return await rawDb.selectFrom(repo.tableName).selectAll().execute()
    }
  })
})

// Usage
const executor = await createExecutor(db, [tenantPlugin('tenant-123')])
const users = await executor.selectFrom('users').selectAll().execute()
// Automatically filtered by tenant_id = 'tenant-123'
```

## Architecture

### How It Works

The executor uses different strategies based on plugin configuration:

**1. Zero Overhead Path** (no plugins or disabled):

```typescript
// Returns augmented Kysely with marker properties only
return Object.assign(db, {
  __kysera: true,
  __plugins: [],
  __rawDb: db
})
```

**2. Minimal Overhead Path** (no interceptors):

```typescript
// Plugins have no interceptQuery hooks
// Returns augmented Kysely without Proxy
return Object.assign(db, {
  __kysera: true,
  __plugins: sortedPlugins,
  __rawDb: db
})
```

**3. Proxy Path** (with interceptors):

```typescript
// Creates Proxy to intercept method calls
return new Proxy(db, {
  get(target, prop) {
    if (prop === 'selectFrom') {
      return table => {
        let qb = target.selectFrom(table)
        const context = { operation: 'select', table, metadata: {} }
        for (const plugin of interceptors) {
          qb = plugin.interceptQuery(qb, context)
        }
        return qb
      }
    }
    // ... similar for insertInto, updateTable, deleteFrom
  }
})
```

### Intercepted Methods

These methods trigger plugin interception:

| Method               | Operation   | Context                   |
| -------------------- | ----------- | ------------------------- |
| `selectFrom(table)`  | `'select'`  | Query builder for SELECT  |
| `insertInto(table)`  | `'insert'`  | Query builder for INSERT  |
| `updateTable(table)` | `'update'`  | Query builder for UPDATE  |
| `deleteFrom(table)`  | `'delete'`  | Query builder for DELETE  |
| `replaceInto(table)` | `'replace'` | Query builder for REPLACE |
| `mergeInto(table)`   | `'merge'`   | Query builder for MERGE   |

All other Kysely methods (`.where()`, `.select()`, `.execute()`, etc.) pass through without interception.

### Plugin Lifecycle

1. **Validation** - `validatePlugins()` checks for conflicts, dependencies, circular dependencies
2. **Ordering** - `resolvePluginOrder()` performs topological sort with priority
3. **Initialization** - Each plugin's `onInit()` called in order (async)
4. **Filtering** - Only plugins with `interceptQuery` are cached as interceptors
5. **Execution** - Interceptors applied on each intercepted method call

### Transaction Handling

Transactions inherit plugins automatically:

```typescript
executor.transaction().execute(async trx => {
  // trx is wrapped with same plugins as executor
  // Uses createProxy() with same interceptor array
})
```

Manual wrapping is also supported via `wrapTransaction(trx, plugins)`.

## Performance

### Zero Overhead Fast Paths

The executor uses multiple optimization strategies:

1. **No plugins:** Returns augmented Kysely instance (zero overhead)
2. **No interceptors:** Returns augmented Kysely instance (minimal overhead)
3. **With interceptors:** Uses optimized Proxy with:
   - Method caching (avoid repeated `.bind()` calls)
   - Set-based lookups (O(1) instead of O(n))
   - Cached intercepted methods
   - Cached transaction wrapper

### Benchmarks

```typescript
// Plain Kysely
const db = new Kysely({ ... });
const users = await db.selectFrom('users').selectAll().execute();
// Baseline: 1.0x

// Executor with no plugins
const executor = await createExecutor(db, []);
const users = await executor.selectFrom('users').selectAll().execute();
// ~1.0x (negligible overhead)

// Executor with non-interceptor plugins
const executor = await createExecutor(db, [auditPlugin()]);
const users = await executor.selectFrom('users').selectAll().execute();
// ~1.0x (no interception, minimal overhead)

// Executor with interceptor plugins
const executor = await createExecutor(db, [softDeletePlugin()]);
const users = await executor.selectFrom('users').selectAll().execute();
// ~1.1x (Proxy overhead + plugin execution)
```

## Schema Plugin

The executor package includes a built-in Schema Plugin for unified schema management across all queries.

### schemaPlugin

Create a schema management plugin with validation and resolution capabilities.

```typescript
import { schemaPlugin, getResolvedSchema } from '@kysera/executor'

function schemaPlugin(options?: SchemaPluginOptions): Plugin
```

### SchemaPluginOptions

```typescript
interface SchemaPluginOptions {
  /** Default schema for all queries. Default: 'public' */
  defaultSchema?: string
  /** Dynamic schema resolver called per-query */
  resolveSchema?: (context: QueryBuilderContext) => string | undefined
  /** Async function to validate schema exists during onInit() */
  validateSchema?: (schema: string) => boolean | Promise<boolean>
  /** Whitelist of permitted schemas */
  allowedSchemas?: string[]
  /** If true, throws error for invalid schema; if false, falls back to default. Default: true */
  strictValidation?: boolean
}
```

### Usage Examples

**Basic usage with default schema:**

```typescript
const executor = await createExecutor(db, [
  schemaPlugin({ defaultSchema: 'public' })
])

// All queries use 'public' schema
const users = await executor.selectFrom('users').selectAll().execute()
```

**With allowed schemas whitelist:**

```typescript
const executor = await createExecutor(db, [
  schemaPlugin({
    defaultSchema: 'public',
    allowedSchemas: ['public', 'auth', 'admin'],
    strictValidation: true // throws on invalid schema
  })
])

// Works - schema is in whitelist
const users = await executor.withSchema('auth').selectFrom('users').selectAll().execute()

// Throws SchemaValidationError - 'private' not in whitelist
const data = await executor.withSchema('private').selectFrom('data').selectAll().execute()
```

**Dynamic schema resolution (multi-tenant):**

```typescript
const executor = await createExecutor(db, [
  schemaPlugin({
    defaultSchema: 'public',
    resolveSchema: (context) => {
      // Resolve from metadata (set by RLS or other plugins)
      const tenantSchema = context.metadata['tenantSchema'] as string | undefined
      return tenantSchema ?? 'public'
    }
  })
])
```

**With schema validation:**

```typescript
const executor = await createExecutor(db, [
  schemaPlugin({
    defaultSchema: 'tenant_123',
    validateSchema: async (schema) => {
      // Check schema exists in database during plugin initialization
      const adapter = getAdapter('postgres')
      return adapter.schemaExists(db, schema)
    }
  })
])
```

### getResolvedSchema

Utility function to retrieve the resolved schema from query context metadata.

```typescript
function getResolvedSchema(context: QueryBuilderContext): string | undefined
```

Used by other plugins to access the resolved schema:

```typescript
const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  dependencies: ['@kysera/schema'], // Ensure schema plugin runs first

  interceptQuery: (qb, context) => {
    const schema = getResolvedSchema(context)
    console.log(`Query running in schema: ${schema}`)
    return qb
  }
}
```

### SchemaValidationError

Error thrown when schema validation fails.

```typescript
class SchemaValidationError extends Error {
  constructor(
    message: string,
    readonly schema: string,
    readonly allowedSchemas?: string[]
  )
}
```

**Example:**

```typescript
import { SchemaValidationError } from '@kysera/executor'

try {
  await executor.withSchema('invalid').selectFrom('users').execute()
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.log(`Invalid schema: ${error.schema}`)
    console.log(`Allowed schemas: ${error.allowedSchemas?.join(', ')}`)
  }
}
```

### Plugin Details

- **Name:** `@kysera/schema`
- **Version:** `1.0.0`
- **Priority:** `1000` (runs early, before other plugins)

The high priority ensures schema context is resolved before other plugins like soft-delete or RLS process the query.

## See Also

- [Repository API](/docs/api/repository) - Repository pattern reference
- [DAL API](/docs/api/dal) - Functional Data Access Layer reference
- [Plugin Overview](/docs/plugins/overview) - Plugin system overview
- [Plugin Authoring Guide](/docs/plugins/authoring-guide) - Creating custom plugins
- [Soft Delete Plugin](/docs/api/soft-delete) - Soft delete functionality
- [RLS Plugin](/docs/api/rls) - Row-Level Security
