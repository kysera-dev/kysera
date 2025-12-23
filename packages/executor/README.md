# @kysera/executor

Unified Execution Layer for Kysera - plugin-aware Kysely wrapper that enables plugins to work seamlessly with both Repository and DAL patterns.

## Overview

`@kysera/executor` is the foundation package for Kysera's plugin system. It provides transparent query interception that allows plugins to modify queries before execution without changing your code. This enables features like soft deletes, row-level security, audit logging, and more.

**Key Features:**

- **Zero Overhead Path** - No performance penalty when no plugins or interceptors are used
- **Minimal Overhead** - <15% overhead with 1-3 interceptor plugins in production workloads
- **Type Safe** - Full TypeScript support with all Kysely types preserved
- **Transaction Support** - Plugins automatically propagate through transactions
- **Plugin Validation** - Detects conflicts, missing dependencies, and circular dependencies
- **Cross-Pattern** - Works with both Repository and DAL patterns

## Installation

```bash
pnpm add @kysera/executor kysely
```

## Quick Start

### Basic Usage

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { Kysely, PostgresDialect } from 'kysely'

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    /* config */
  })
})

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// All queries now have soft-delete filter applied automatically
const users = await executor.selectFrom('users').selectAll().execute()
// Returns only non-deleted users
```

### With DAL Pattern

```typescript
import { createExecutor } from '@kysera/executor'
import { createContext, createQuery, withTransaction } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// Create DAL context with executor
const ctx = createContext(executor)

// Define queries - plugins apply automatically
const getUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())

const getUser = createQuery((ctx, id: string) =>
  ctx.db.selectFrom('users').where('id', '=', id).selectAll().executeTakeFirst()
)

// Execute - soft-delete filter automatically applied
const users = await getUsers(ctx)
const user = await getUser(ctx, 'user-123')
```

### With Transactions

```typescript
import { withTransaction } from '@kysera/dal'

// Plugins automatically propagate through transactions
await withTransaction(executor, async ctx => {
  const user = await ctx.db
    .insertInto('users')
    .values({ name: 'Alice' })
    .returningAll()
    .executeTakeFirst()

  const post = await ctx.db
    .insertInto('posts')
    .values({ user_id: user.id, title: 'Hello' })
    .returningAll()
    .executeTakeFirst()

  // Both queries respect all registered plugins
})
```

## API Reference

### Core Functions

#### `createExecutor(db, plugins?, config?)`

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
- `config.enabled` - Enable/disable plugin interception (default: `true`)

**Returns:** Plugin-aware executor

**Example:**

```typescript
const executor = await createExecutor(db, [softDeletePlugin(), auditPlugin()])
```

**Performance:**

- Zero overhead when `plugins = []` or `enabled = false`
- Zero overhead when plugins have no `interceptQuery` hook
- Minimal overhead with interceptor plugins (<15% for 1-3 plugins)

---

#### `createExecutorSync(db, plugins?, config?)`

Synchronous version of `createExecutor` that skips async plugin initialization.

```typescript
function createExecutorSync<DB>(
  db: Kysely<DB>,
  plugins?: readonly Plugin[],
  config?: ExecutorConfig
): KyseraExecutor<DB>
```

**Use Case:** When you need synchronous executor creation or plugins don't require `onInit`.

**Example:**

```typescript
const executor = createExecutorSync(db, [softDeletePlugin()])
```

---

#### `isKyseraExecutor(value)`

Type guard to check if a value is a KyseraExecutor.

```typescript
function isKyseraExecutor<DB>(value: Kysely<DB> | KyseraExecutor<DB>): value is KyseraExecutor<DB>
```

**Example:**

```typescript
if (isKyseraExecutor(db)) {
  const plugins = getPlugins(db)
  console.log(`${plugins.length} plugins registered`)
}
```

---

#### `getPlugins(executor)`

Get the array of registered plugins from an executor.

```typescript
function getPlugins<DB>(executor: KyseraExecutor<DB>): readonly Plugin[]
```

**Returns:** Plugins in execution order (sorted by priority and dependencies)

**Example:**

```typescript
const plugins = getPlugins(executor)
console.log(plugins.map(p => `${p.name}@${p.version}`))
```

---

#### `getRawDb(executor)`

Get the raw Kysely instance, bypassing all plugin interceptors.

```typescript
function getRawDb<DB>(executor: Kysely<DB>): Kysely<DB>
```

**Use Case:** For internal plugin operations that should not trigger other plugins.

**Example:**

```typescript
// Inside a soft-delete plugin's restore method:
const rawDb = getRawDb(executor)

// This query bypasses soft-delete filter to find deleted records
const deletedUser = await rawDb
  .selectFrom('users')
  .where('id', '=', userId)
  .where('deleted_at', 'is not', null)
  .selectAll()
  .executeTakeFirst()
```

**Important:** Use with caution. Bypassing plugins can lead to inconsistent behavior.

---

#### `destroyExecutor(executor)`

Destroy an executor and call the `onDestroy` hook for all registered plugins.

```typescript
async function destroyExecutor<DB>(executor: KyseraExecutor<DB>): Promise<void>
```

**Parameters:**

- `executor` - KyseraExecutor instance to destroy

**Use Case:** Cleanup when shutting down application or when executor is no longer needed.

**Example:**

```typescript
const executor = await createExecutor(db, [
  {
    name: 'connection-pool',
    version: '1.0.0',
    async onInit(db) {
      console.log('Initializing connection pool')
    },
    async onDestroy(db) {
      console.log('Closing connection pool')
      // Close connections, release resources, etc.
    }
  }
])

// Later...
await destroyExecutor(executor)
// Logs: "Closing connection pool"
```

**Important:** After calling `destroyExecutor`, the executor should not be used for further queries.

---

#### `wrapTransaction(trx, plugins)`

Wrap a Kysely transaction with plugins.

```typescript
function wrapTransaction<DB>(
  trx: Transaction<DB>,
  plugins: readonly Plugin[]
): KyseraTransaction<DB>
```

**Parameters:**

- `trx` - Kysely transaction instance
- `plugins` - Plugins to apply to the transaction

**Returns:** Plugin-aware transaction

**Use Case:** Manual transaction wrapping when not using `withTransaction`.

**Example:**

```typescript
await db.transaction().execute(async trx => {
  const wrappedTrx = wrapTransaction(trx, [softDeletePlugin()])

  // Plugins now apply within transaction
  const users = await wrappedTrx.selectFrom('users').selectAll().execute()
})
```

---

#### `applyPlugins(qb, plugins, context)`

Manually apply plugins to a query builder.

```typescript
function applyPlugins<QB>(qb: QB, plugins: readonly Plugin[], context: QueryBuilderContext): QB
```

**Parameters:**

- `qb` - Query builder instance
- `plugins` - Plugins to apply
- `context` - Query context (operation, table, metadata)

**Returns:** Modified query builder

**Use Case:** Complex queries that bypass normal interception or custom plugin composition.

**Example:**

```typescript
const qb = db.selectFrom('users').selectAll()
const context: QueryBuilderContext = {
  operation: 'select',
  table: 'users',
  metadata: {}
}

const modifiedQb = applyPlugins(qb, [softDeletePlugin()], context)
const users = await modifiedQb.execute()
```

---

#### `validatePlugins(plugins)`

Validate plugins for conflicts, duplicates, missing dependencies, and circular dependencies.

```typescript
function validatePlugins(plugins: readonly Plugin[]): void
```

**Throws:** `PluginValidationError` if validation fails

**Validation checks:**

- Duplicate plugin names
- Missing dependencies
- Conflicting plugins
- Circular dependencies

**Example:**

```typescript
try {
  validatePlugins([
    { name: 'a', version: '1.0.0', dependencies: ['b'] },
    { name: 'b', version: '1.0.0', dependencies: ['a'] }
  ])
} catch (error) {
  if (error instanceof PluginValidationError) {
    console.error(error.type, error.details)
    // type: 'CIRCULAR_DEPENDENCY'
    // details: { pluginName: 'a', cycle: ['a', 'b', 'a'] }
  }
}
```

---

#### `resolvePluginOrder(plugins)`

Resolve plugin execution order using topological sort with priority.

```typescript
function resolvePluginOrder(plugins: readonly Plugin[]): Plugin[]
```

**Returns:** Sorted plugins in execution order

**Sorting rules:**

1. Dependencies must run before dependents
2. Higher priority runs first (default priority: 0)
3. Alphabetical by name when priority is equal

**Example:**

```typescript
const plugins = [
  { name: 'audit', version: '1.0.0', priority: 50 },
  { name: 'soft-delete', version: '1.0.0', priority: 100 },
  { name: 'rls', version: '1.0.0', priority: 90 }
]

const sorted = resolvePluginOrder(plugins)
// Result: [soft-delete (100), rls (90), audit (50)]
```

---

### Types

#### `Plugin`

Plugin interface - unified for both Repository and DAL patterns.

```typescript
interface Plugin {
  /** Unique plugin name (e.g., '@kysera/soft-delete') */
  readonly name: string

  /** Plugin version (semver) */
  readonly version: string

  /** Plugin dependencies (must be loaded first) */
  readonly dependencies?: readonly string[]

  /** Higher priority = runs first (default: 0) */
  readonly priority?: number

  /** Plugins that conflict with this one */
  readonly conflictsWith?: readonly string[]

  /**
   * Lifecycle: Called once when plugin is initialized
   * Use for setup, validation, or resource allocation
   */
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void

  /**
   * Lifecycle: Called when executor is destroyed
   * Use for cleanup, releasing resources, closing connections
   */
  onDestroy?<DB>(executor: Kysely<DB>): Promise<void> | void

  /**
   * Query interception: Modify query builder before execution
   * This is where most plugin logic lives
   * Works in both Repository and DAL patterns
   */
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB

  /**
   * Repository extensions: Add methods to repositories
   * Only used in Repository pattern, ignored in DAL
   */
  extendRepository?<T extends object>(repo: T): T
}
```

**Available Hooks:**

- `onInit` - Plugin initialization (async)
- `onDestroy` - Plugin cleanup/teardown (async)
- `interceptQuery` - Query interception (most common)
- `extendRepository` - Repository pattern only

---

#### `QueryBuilderContext`

Context passed to `interceptQuery` hook.

```typescript
interface QueryBuilderContext {
  /** Type of operation: 'select' | 'insert' | 'update' | 'delete' */
  readonly operation: 'select' | 'insert' | 'update' | 'delete'

  /** Table name being queried */
  readonly table: string

  /** Additional metadata (extensible) */
  readonly metadata: Record<string, unknown>
}
```

**Example:**

```typescript
const plugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
    console.log(`${context.operation} on ${context.table}`)
    // Output: "select on users"
    return qb
  }
}
```

---

#### `KyseraExecutor<DB>`

Plugin-aware Kysely wrapper type.

```typescript
type KyseraExecutor<DB> = Kysely<DB> & {
  readonly __kysera: true
  readonly __plugins: readonly Plugin[]
  readonly __rawDb: Kysely<DB>
}
```

**Usage:** Use `KyseraExecutor<DB>` instead of `Kysely<DB>` when you need to ensure plugins are available.

---

#### `KyseraTransaction<DB>`

Plugin-aware Transaction wrapper type.

```typescript
type KyseraTransaction<DB> = Transaction<DB> & {
  readonly __kysera: true
  readonly __plugins: readonly Plugin[]
  readonly __rawDb: Kysely<DB>
}
```

**Usage:** Returned by `wrapTransaction` and used internally by the executor's transaction handling.

---

#### `ExecutorConfig`

Configuration options for executor creation.

```typescript
interface ExecutorConfig {
  /** Enable/disable plugin interception at runtime (default: true) */
  readonly enabled?: boolean
}
```

**Example:**

```typescript
// Disable plugins for testing or debugging
const executor = await createExecutor(db, plugins, { enabled: false })
```

---

#### `PluginValidationError`

Error thrown when plugin validation fails.

```typescript
class PluginValidationError extends Error {
  readonly type: PluginValidationErrorType
  readonly details: PluginValidationDetails
}

type PluginValidationErrorType =
  | 'DUPLICATE_NAME'
  | 'MISSING_DEPENDENCY'
  | 'CONFLICT'
  | 'CIRCULAR_DEPENDENCY'

interface PluginValidationDetails {
  readonly pluginName: string
  readonly missingDependency?: string
  readonly conflictingPlugin?: string
  readonly cycle?: readonly string[]
}
```

---

## Creating Custom Plugins

### Basic Plugin

```typescript
import type { Plugin, QueryBuilderContext } from '@kysera/executor'

export function myPlugin(): Plugin {
  return {
    name: '@myorg/my-plugin',
    version: '1.0.0',
    priority: 50,

    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      // Add your logic here
      if (context.operation === 'select' && context.table === 'users') {
        return (qb as any).where('active', '=', true)
      }
      return qb
    }
  }
}
```

### Plugin with Initialization

```typescript
export function cachePlugin(redisClient: Redis): Plugin {
  return {
    name: '@myorg/cache',
    version: '1.0.0',

    async onInit(db) {
      // Initialize cache, warm up, etc.
      await redisClient.ping()
      console.log('Cache plugin initialized')
    },

    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      // Add cache hints to metadata
      context.metadata.cacheKey = `${context.table}:${context.operation}`
      return qb
    }
  }
}
```

### Plugin with Dependencies

```typescript
export function auditPlugin(): Plugin {
  return {
    name: '@kysera/audit',
    version: '1.0.0',
    priority: 40,

    // Requires soft-delete to be loaded first
    dependencies: ['@kysera/soft-delete'],

    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      // Audit logic here
      return qb
    }
  }
}
```

### Plugin with Conflicts

```typescript
export function hardDeletePlugin(): Plugin {
  return {
    name: '@myorg/hard-delete',
    version: '1.0.0',

    // Cannot coexist with soft-delete
    conflictsWith: ['@kysera/soft-delete'],

    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      // Hard delete logic
      return qb
    }
  }
}
```

### Accessing Raw Database in Plugins

```typescript
import { getRawDb } from '@kysera/executor'

export function softDeletePlugin(): Plugin {
  return {
    name: '@kysera/soft-delete',
    version: '1.0.0',

    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      if (context.operation === 'select') {
        return (qb as any).where('deleted_at', 'is', null)
      }
      return qb
    },

    extendRepository<T extends { executor: any }>(repo: T): T {
      return {
        ...repo,
        async restore(id: string) {
          // Use raw DB to bypass soft-delete filter
          const rawDb = getRawDb(repo.executor)

          return rawDb
            .updateTable('users')
            .where('id', '=', id)
            .set({ deleted_at: null })
            .returningAll()
            .executeTakeFirst()
        }
      }
    }
  }
}
```

## Performance

The executor is designed for production workloads with minimal overhead.

### Benchmark Results

Based on benchmark tests with SQLite (in-memory):

| Configuration          | Queries/sec | Overhead vs Pure Kysely  |
| ---------------------- | ----------- | ------------------------ |
| Pure Kysely (baseline) | ~100,000    | 0%                       |
| Executor (no plugins)  | ~95,000     | <5% (zero overhead path) |
| Executor (1 plugin)    | ~90,000     | <15%                     |
| Executor (3 plugins)   | ~80,000     | <25%                     |
| Executor (5 plugins)   | ~70,000     | <35%                     |

### Optimization Strategies

1. **Zero Overhead Path**: When no plugins have `interceptQuery`, the executor takes a fast path with zero overhead
2. **Method Caching**: Intercepted methods are cached to avoid repeated creation
3. **Set-based Lookups**: O(1) lookups instead of array iterations
4. **Lazy Proxy Creation**: Proxies are only created when needed

### Performance Tips

- Only enable plugins you need
- Use `createExecutorSync` when plugins don't need initialization
- Consider plugin priority - critical filters should run first
- Use `getRawDb` for internal queries that don't need interception
- Disable executor in development: `createExecutor(db, plugins, { enabled: false })`

## Integration with DAL

The executor seamlessly integrates with `@kysera/dal` for functional query composition:

```typescript
import { createExecutor } from '@kysera/executor'
import { createContext, createQuery, withTransaction } from '@kysera/dal'

// Create executor
const executor = await createExecutor(db, [
  softDeletePlugin(),
  rlsPlugin({ tenantIdColumn: 'tenant_id' })
])

// Create context
const ctx = createContext(executor)

// Define queries
const getUser = createQuery((ctx, id: string) =>
  ctx.db.selectFrom('users').where('id', '=', id).selectAll().executeTakeFirst()
)

const updateUser = createQuery((ctx, id: string, data: Partial<User>) =>
  ctx.db.updateTable('users').where('id', '=', id).set(data).returningAll().executeTakeFirst()
)

// Execute with automatic plugin application
const user = await getUser(ctx, 'user-123')

// Transactions preserve plugins
await withTransaction(executor, async txCtx => {
  await updateUser(txCtx, 'user-123', { name: 'Updated' })
  // Plugins still apply within transaction
})
```

## Integration with Repository

The executor also powers the Repository pattern via `@kysera/repository`:

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { auditPlugin } from '@kysera/audit'

const orm = await createORM(db, [softDeletePlugin(), auditPlugin()])

const userRepo = orm.createRepository(createUserRepository)

// Plugins automatically applied to repository operations
const users = await userRepo.findAll() // Soft-delete filter applied
const user = await userRepo.create({ name: 'Alice' }) // Audit log created
```

The repository internally uses `createExecutor` to power plugin functionality.

## Best Practices

### 1. Plugin Naming

Use namespaced names to avoid conflicts:

```typescript
// Good
{ name: '@kysera/soft-delete', version: '1.0.0' }
{ name: '@myorg/custom-plugin', version: '1.0.0' }

// Bad
{ name: 'soft-delete', version: '1.0.0' }
{ name: 'plugin', version: '1.0.0' }
```

### 2. Plugin Priority

Reserve priority ranges for different concerns:

- **100-199**: Core data filters (soft-delete, RLS)
- **50-99**: Middleware (audit, logging)
- **0-49**: Post-processing (caching, enrichment)

### 3. Use Dependencies

Declare dependencies explicitly to ensure correct load order:

```typescript
{
  name: '@kysera/audit',
  version: '1.0.0',
  dependencies: ['@kysera/soft-delete'], // Audit needs soft-delete
  priority: 40
}
```

### 4. Avoid Conflicts

Use `conflictsWith` to prevent incompatible plugins:

```typescript
{
  name: '@myorg/hard-delete',
  version: '1.0.0',
  conflictsWith: ['@kysera/soft-delete']
}
```

### 5. Type Safety

Always maintain type safety when modifying query builders:

```typescript
interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
  // Cast to any only when necessary
  if (context.operation === 'select') {
    return (qb as any).where('deleted_at', 'is', null) as QB;
  }
  return qb; // Return unmodified if no changes
}
```

### 6. Testing Plugins

Test plugins in isolation before composing them:

```typescript
import { applyPlugins } from '@kysera/executor'

it('should filter deleted records', async () => {
  const qb = db.selectFrom('users').selectAll()
  const context = { operation: 'select', table: 'users', metadata: {} }

  const filtered = applyPlugins(qb, [softDeletePlugin()], context)
  const users = await filtered.execute()

  expect(users.every(u => u.deleted_at === null)).toBe(true)
})
```

## Query Interception Details

### Intercepted Methods

The executor intercepts the following Kysely query builder methods to apply plugins:

- `selectFrom` - SELECT queries
- `insertInto` - INSERT queries
- `updateTable` - UPDATE queries
- `deleteFrom` - DELETE queries
- `replaceInto` - REPLACE queries (MySQL)
- `mergeInto` - MERGE queries (SQL Server, Oracle)

**Example:**

```typescript
// All of these are intercepted and have plugins applied:
await executor.selectFrom('users').selectAll().execute()
await executor.insertInto('users').values(data).execute()
await executor.updateTable('users').set(data).execute()
await executor.deleteFrom('users').where('id', '=', 1).execute()
```

### Schema Support (withSchema)

The `withSchema()` method now maintains the plugin proxy with caching for optimal performance:

```typescript
// Schema switching preserves plugins
const publicUsers = await executor
  .withSchema('public')
  .selectFrom('users')
  .selectAll()
  .execute()
// soft-delete filter still applied!

const archiveUsers = await executor
  .withSchema('archive')
  .selectFrom('users')
  .selectAll()
  .execute()
// soft-delete filter still applied!
```

**Performance Note:** Schema proxies are cached, so repeated calls to `withSchema('public')` return the same proxy instance.

### Limitations

#### SQL Template Tag Bypasses Plugins

The Kysely `sql` template tag bypasses plugin interception:

```typescript
import { sql } from 'kysely'

// ❌ This bypasses plugins (no soft-delete filter!)
const users = await executor
  .selectFrom(sql`users`.as('users'))
  .selectAll()
  .execute()

// ✅ Workaround: Use normal query builders
const users = await executor
  .selectFrom('users')
  .selectAll()
  .execute()
// Plugins applied correctly
```

**Why this happens:** The `sql` template tag creates raw SQL fragments that bypass the query builder chain where plugins are applied.

**When you need raw SQL:**

```typescript
// For complex WHERE clauses, use sql inside the query builder:
const users = await executor
  .selectFrom('users')
  .where(sql`jsonb_array_length(metadata->'tags') > 5`)
  .selectAll()
  .execute()
// Soft-delete filter still applied to the FROM clause!
```

#### CTE Limitations (with/withRecursive)

Common Table Expressions (CTEs) created with `with()` or `withRecursive()` have limited plugin support:

```typescript
// ⚠️ Plugins only apply to the main query, not the CTE
const result = await executor
  .with('active_users', db =>
    db.selectFrom('users').selectAll() // ❌ Plugins NOT applied here
  )
  .selectFrom('active_users')
  .selectAll()
  .execute() // ✅ Plugins applied to outer query

// ✅ Workaround: Apply filters manually in CTE
const result = await executor
  .with('active_users', db =>
    db
      .selectFrom('users')
      .where('deleted_at', 'is', null) // Manual soft-delete filter
      .selectAll()
  )
  .selectFrom('active_users')
  .selectAll()
  .execute()
```

**Why this limitation exists:** CTEs are defined before the main query executes, and the CTE callback receives the raw `db` instance, not the plugin-wrapped executor.

**Future improvement:** This may be addressed in a future version by wrapping the callback parameter.

## Architecture & Design Decisions

### Type System Constraints

The executor implementation uses several type assertions (`as unknown as`) due to Kysely's complex type system. These are intentional and documented inline in the source code. Here's why they're necessary:

#### 1. Unconstrained Plugin Generic

The `Plugin.interceptQuery` method has an unconstrained generic parameter `QB`:

```typescript
interface Plugin {
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB
}
```

**Why it's unconstrained:**

Kysely's query builders (SelectQueryBuilder, InsertQueryBuilder, UpdateQueryBuilder, DeleteQueryBuilder) don't share a common base interface that includes query modification methods like `where()`, `and()`, etc. Each builder has a unique interface with different generic parameters.

**How plugins handle this:**

Plugins must handle type safety internally by:

1. Checking the operation type from context
2. Casting to the appropriate specific builder
3. Using type assertions when necessary

**Example:**

```typescript
interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
  if (context.operation === 'select') {
    // Cast to SelectQueryBuilder for type-safe WHERE clause
    type GenericSelect = SelectQueryBuilder<Record<string, unknown>, string, Record<string, unknown>>;
    return (qb as unknown as GenericSelect)
      .where('deleted_at', 'is', null) as QB;
  }
  return qb;
}
```

#### 2. Transaction Wrapping

Transaction wrapping requires explicit type casts because:

- `Transaction<DB>` extends `Kysely<DB>`, but TypeScript requires explicit casts for the proxy system
- The proxy creation function expects `Kysely<DB>`, not `Transaction<DB>`
- The wrapped result must be cast back to `Transaction<DB>` for user callbacks

**Example:**

```typescript
// Type assertions explained:
const wrappedTrx = createProxy(
  trx as unknown as Kysely<DB>, // Transaction -> Kysely (structurally compatible)
  interceptors,
  allPlugins
)
return fn(wrappedTrx as unknown as Transaction<DB>) // Proxy -> Transaction
```

#### 3. Dynamic Method Access

Methods like `selectFrom`, `insertInto`, etc. must be accessed dynamically:

```typescript
const originalMethod = (db as unknown as Record<string, (t: string) => unknown>)[method]
```

**Why:** TypeScript doesn't allow dynamic property access on `Kysely<DB>` without an index signature. The cast is safe because we validate the method exists in `INTERCEPTED_METHODS`.

#### 4. Object.assign Type Assertions

`Object.assign` returns intersection types that must be cast to union types:

```typescript
return Object.assign(db, {
  __kysera: true as const,
  __plugins: plugins,
  __rawDb: db
}) as KyseraExecutor<DB>
```

**Why:** `KyseraExecutor<DB> = Kysely<DB> & KyseraExecutorMarker<DB>`, and we're adding exactly those marker properties.

### Transaction API Limitation

The wrapped transaction only exposes the `.execute()` method, not `.setIsolationLevel()` or other transaction builder methods.

**Why this limitation exists:**

1. **Simplicity**: Keeps the plugin system simple and focused on query interception
2. **Intent**: Isolation level should be set before plugin interception begins
3. **Common case**: Most applications use default isolation levels

**Escape Hatch: Using `__rawDb`**

You can access the raw database instance via `executor.__rawDb` or `ctx.db.__rawDb` to bypass plugins when needed:

```typescript
import { withTransaction } from '@kysera/dal'

// Within a transaction, access raw db for special cases:
await withTransaction(executor, async ctx => {
  // Regular query with plugins
  const users = await ctx.db.selectFrom('users').selectAll().execute()

  // Access raw db to bypass plugins
  if ('__rawDb' in ctx.db) {
    const rawDb = ctx.db.__rawDb

    // This bypasses all plugins including soft-delete
    const deletedUsers = await rawDb
      .selectFrom('users')
      .where('deleted_at', 'is not', null)
      .selectAll()
      .execute()
  }

  return users
})
```

**Workaround for advanced use cases:**

```typescript
// Use raw database to set isolation level
await executor.__rawDb
  .transaction()
  .setIsolationLevel('serializable')
  .execute(async trx => {
    // Transaction runs with custom isolation level
    // but without plugin interception
  })
```

**Alternative pattern:**

```typescript
// For plugins + custom isolation, wrap manually:
await executor.__rawDb
  .transaction()
  .setIsolationLevel('serializable')
  .execute(async trx => {
    const wrappedTrx = wrapTransaction(trx, getPlugins(executor))
    // Now plugins are active in transaction with custom isolation
  })
```

### Type Safety Philosophy

The executor prioritizes:

1. **Runtime Safety**: All type assertions are validated at runtime where possible
2. **Developer Experience**: Full TypeScript support without forcing users to use casts
3. **Kysely Compatibility**: Works with all Kysely types and features
4. **Documentation**: All type assertions are documented inline with explanations

These architectural decisions allow the executor to provide a seamless plugin system while maintaining full type safety and Kysely compatibility.

## Troubleshooting

### Plugin Not Applied

**Problem:** Plugin's `interceptQuery` is not being called.

**Solutions:**

1. Verify plugin has `interceptQuery` hook defined
2. Check if executor is disabled: `createExecutor(db, plugins, { enabled: true })`
3. Ensure you're using the executor, not raw `db`

### Circular Dependency Error

**Problem:** `PluginValidationError: Circular dependency: a -> b -> a`

**Solution:** Review plugin dependencies and remove circular references.

### Performance Degradation

**Problem:** Queries are slower with plugins.

**Solutions:**

1. Profile plugins individually to find bottlenecks
2. Reduce number of plugins
3. Optimize plugin logic (avoid expensive operations in `interceptQuery`)
4. Consider using `getRawDb` for internal queries

### Type Errors with Query Builders

**Problem:** TypeScript errors when modifying query builders in plugins.

**Solution:** Use type assertions carefully:

```typescript
interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
  // Cast to any, apply method, cast back to QB
  return (qb as any).where('column', '=', value) as QB;
}
```

## License

MIT

## Related Packages

- **[@kysera/dal](../dal)** - Functional Data Access Layer
- **[@kysera/repository](../repository)** - Repository pattern with plugin support
- **[@kysera/soft-delete](../soft-delete)** - Soft delete plugin
- **[@kysera/audit](../audit)** - Audit logging plugin
- **[@kysera/rls](../rls)** - Row-level security plugin
- **[@kysera/core](../core)** - Core utilities and types
