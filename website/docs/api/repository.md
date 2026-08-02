---
sidebar_position: 3
title: '@kysera/repository'
description: Repository pattern package API reference
---

# @kysera/repository

Type-safe repository pattern implementation with validation-agnostic design. Supports Zod, Valibot, TypeBox, or native TypeScript validation.

## Installation

```bash
npm install @kysera/repository

# Optional: Install your preferred validation library
npm install zod           # Popular schema validation
# or: npm install valibot   # Lightweight alternative
# or: npm install @sinclair/typebox  # JSON Schema based
# or: none - use native TypeScript validation
```

## Overview

**Dependencies:** @kysera/executor, @kysera/dal, @kysera/core
**Peer Dependencies:** kysely >=0.29.0, zod ^4.x (optional)

:::tip Unified Execution Layer
`@kysera/repository` uses `@kysera/executor` under the hood for plugin management. Plugins work through query interception (`interceptQuery`) and repository extensions (`extendRepository`). Query interceptors apply to both Repository and DAL patterns. Repository extensions work only with Repository pattern.
:::

## Core Exports

```typescript
// Factory functions
export { createRepositoryFactory } from './repository'
export { createRepositoriesFactory } from './helpers'
export { createSimpleRepository } from './repository'
export type { Executor, RepositoryFactoryMap, RepositoriesFromFactory } from './helpers'

// Repository manager with plugins
export { createORM, withPlugins } from './plugin'
export type { PluginOrm, ApplyPluginsFunction } from './plugin'

// Validation
export { getValidationMode, shouldValidate, createValidator, safeParse } from './validation'

// Validation adapters
export {
  zodAdapter,
  valibotAdapter,
  typeboxAdapter,
  nativeAdapter,
  customAdapter,
  normalizeSchema,
  isValidationSchema
} from './validation-adapter'
export type {
  ValidationSchema,
  ValidationError,
  ValidationIssue,
  ValidationResult
} from './validation-adapter'

// Base repository
export { createBaseRepository } from './base-repository'
export type { BaseRepository, RepositoryConfig, TableOperations } from './base-repository'

// Table operations
export { createTableOperations } from './table-operations'
export type { TableOperationsOptions } from './table-operations'

// Query operators
export {
  isOperatorObject,
  isValidOperator,
  isLogicalOperator,
  hasOperators,
  validateOperators,
  extractColumns,
  applyCondition,
  applyWhereClause,
  InvalidOperatorError,
  InvalidOperatorValueError,
  ALL_OPERATORS,
  COMPARISON_OPERATORS,
  ARRAY_OPERATORS,
  STRING_OPERATORS,
  NULL_OPERATORS,
  RANGE_OPERATORS,
  LOGICAL_OPERATORS
} from './operators'
export type {
  FindOptions,
  FindResult,
  WhereClause,
  SortSpec,
  OperatorKey,
  ComparisonOperators,
  ArrayOperators,
  StringOperators,
  NullOperators,
  RangeOperator,
  FieldOperators,
  ConditionValue
} from './operators'

// Context-aware repository
export { ContextAwareRepository } from './context-aware'

// Upsert helpers
export { upsert, upsertMany, atomicStatusTransition } from './upsert'
export type { UpsertOptions, StatusTransitionOptions } from './upsert'

// Primary key & column-safety utilities
export { extractPrimaryKey } from './primary-key-utils'
export {
  assertValidIdentifier,
  validateColumnNames,
  validateConditions,
  getAllowedColumnsFromPkConfig
} from './column-validation'
export type { ColumnValidationOptions } from './column-validation'

// Re-export executor types
export type { Plugin, QueryBuilderContext } from '@kysera/executor'
export { PluginValidationError, validatePlugins, resolvePluginOrder } from '@kysera/executor'

// Types AND runtime primary-key helpers (normalizePrimaryKeyConfig,
// isCompositeKey, getPrimaryKeyColumns, normalizePrimaryKeyInput, isValidRow)
export * from './types'
```

:::note Operator errors
`InvalidOperatorError` is thrown for unknown operator names (e.g. `$regex`),
while `InvalidOperatorValueError` is thrown when a valid operator receives a
malformed value (`$in` without an array, `$between` without a two-element
tuple, a string operator with a non-string, `$isNull` with a non-boolean).
Both fail loudly instead of silently dropping the filter, which would return
the whole table. See [Query Operators](/docs/api/repository/operators#error-handling).
:::

## createRepositoryFactory

Create a typed repository factory that provides methods for creating individual repositories.

<!-- doc-snippet: skip -->
```typescript
function createRepositoryFactory<DB>(executor: Executor<DB>): {
  executor: Executor<DB>
  create<TableName extends keyof DB & string, Entity, PK = number>(
    config: RepositoryConfig<DB[TableName], Entity> & { tableName: TableName }
  ): Repository<Entity, DB, PK>
}

// Executor accepts a Kysely instance, a Transaction, or a plugin-aware
// KyseraExecutor from @kysera/executor (alias of AnyExecutor from @kysera/core)
type Executor<DB> = Kysely<DB> | Transaction<DB> | (Kysely<DB> & KyseraExecutorMarker<DB>)
```

### RepositoryConfig

```typescript
interface RepositoryConfig<Table, Entity> {
  tableName: string // factory.create() narrows this to keyof DB & string
  /**
   * PostgreSQL schema for this repository.
   * When set, all queries are scoped to this schema.
   * @example 'auth', 'admin', 'tenant_123'
   */
  schema?: string
  primaryKey?: PrimaryKeyColumn // Default: 'id'
  primaryKeyType?: PrimaryKeyTypeHint // Default: 'number'
  /**
   * Database dialect configuration.
   * Recommended for production to avoid relying on Kysely internals.
   * @deprecated Wrapper kept for backwards compatibility — see note below
   */
  dialect?: DialectConfig
  mapRow: (row: Selectable<Table>) => Entity
  schemas: {
    entity?: ValidationSchema<Entity> // Optional result validation
    create: ValidationSchema // Required input validation
    update?: ValidationSchema // Optional update validation (uses create.partial() if omitted)
  }
  validateDbResults?: boolean // Default: NODE_ENV === 'development'
  validationStrategy?: 'none' | 'strict' // Default: 'strict'
  logger?: KyseraLogger // Warnings and diagnostics. Default: silentLogger
}

// Primary key types
type PrimaryKeyColumn = string | string[] // Single: 'id', Composite: ['tenant_id', 'user_id']
type PrimaryKeyTypeHint = 'number' | 'string' | 'uuid'

// Dialect configuration
interface DialectConfig {
  dialect: 'postgres' | 'mysql' | 'sqlite' | 'mssql' // = Dialect from @kysera/core
}
```

:::note DialectConfig is deprecated
`DialectConfig` is a legacy wrapper around the `Dialect` union and is kept for
backwards compatibility. For new code, import `Dialect` from `@kysera/core`
when you need the dialect type itself.
:::

**Schema Option:**

The `schema` option enables PostgreSQL schema support for multi-tenant applications or domain separation:

<!-- doc-snippet: skip -->
```typescript
// Multi-tenant pattern
const tenantUserRepo = factory.create({
  tableName: 'users',
  schema: `tenant_${tenantId}`, // All queries use this schema
  mapRow: row => row,
  schemas: { create: zodAdapter(CreateUserSchema) }
})

// Domain separation
const authUserRepo = factory.create({
  tableName: 'users',
  schema: 'auth', // Queries use auth.users
  mapRow: row => row,
  schemas: { create: zodAdapter(CreateUserSchema) }
})
```

### Example with Zod

```typescript
import { createRepositoryFactory, zodAdapter } from '@kysera/repository'
import { z } from 'zod'

const factory = createRepositoryFactory(db)

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
})

const userRepo = factory.create({
  tableName: 'users' as const,
  mapRow: row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at
  }),
  schemas: {
    create: zodAdapter(CreateUserSchema)
    // update automatically uses CreateUserSchema.partial()
  }
})
```

### Example with Native Adapter (No Validation)

```typescript
import { createRepositoryFactory, nativeAdapter } from '@kysera/repository'

interface CreateUserInput {
  email: string
  name: string
}

const factory = createRepositoryFactory(db)

const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    create: nativeAdapter<CreateUserInput>(),
    update: nativeAdapter<Partial<CreateUserInput>>()
  },
  validateDbResults: false
})
```

## Repository Methods

All repository methods are type-safe and integrate with your configured validation library (Zod, Valibot, TypeBox, or native TypeScript).

### Single Record Operations

<!-- doc-snippet: skip -->
```typescript
// Find by ID
async findById(id: PK): Promise<Entity | null>

// Create - validates input with create schema
async create(input: unknown): Promise<Entity>

// Update - validates input with update schema (or create.partial())
async update(id: PK, input: unknown): Promise<Entity>

// Delete - always a hard DELETE. The soft-delete plugin never converts this
// method; it adds separate softDelete()/restore()/hardDelete() methods instead.
async delete(id: PK): Promise<boolean>
```

**Validation Integration:**

The `create` and `update` methods automatically validate input using your configured schemas:

```typescript
import { createRepositoryFactory, zodAdapter } from '@kysera/repository'
import { z } from 'zod'

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  age: z.number().min(18)
})

const factory = createRepositoryFactory(db)
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    create: zodAdapter(CreateUserSchema)
    // update automatically uses CreateUserSchema.partial()
  }
})

// ✅ Valid input - passes validation
const user = await userRepo.create({
  email: 'alice@example.com',
  name: 'Alice',
  age: 25
})

// ❌ Invalid input - throws validation error
await userRepo.create({
  email: 'not-an-email',
  name: '',
  age: 15
})
// ValidationError: email must be valid email, name must not be empty, age must be >= 18

// Update validation (all fields optional by default)
await userRepo.update(user.id, {
  name: 'Alice Updated' // Only updating name - valid!
})
```

### Batch Operations

<!-- doc-snippet: skip -->
```typescript
// Find multiple
async findByIds(ids: PK[]): Promise<Entity[]>

// Bulk create
async bulkCreate(inputs: unknown[]): Promise<Entity[]>

// Bulk update
async bulkUpdate(updates: Array<{ id: PK; data: unknown }>): Promise<Entity[]>

// Bulk delete
async bulkDelete(ids: PK[]): Promise<number>
```

**`bulkCreate` behavior:**

- **PostgreSQL/SQLite:** Uses a single `INSERT ... RETURNING` query for efficiency.
- **MySQL:** Inserts records one-by-one inside an automatic transaction (MySQL lacks `RETURNING` support). If any insert fails, the entire batch is rolled back.

**`bulkUpdate` behavior:**

- Updates are processed **sequentially** (one at a time, not in parallel).
- If any record is not found, a `NotFoundError` is thrown immediately and remaining updates are skipped.
- For atomicity, wrap in a transaction: `await repo.transaction(async trx => repo.withTransaction(trx).bulkUpdate(updates))` — the callback must use a transaction-bound repository (outer-repo calls escape the transaction and, since kysely 0.29, deadlock on single-connection SQLite)

### Query Operations

<!-- doc-snippet: skip -->
```typescript
// Find all
async findAll(): Promise<Entity[]>

// Find with conditions (simple equality)
async find(options?: { where?: Record<string, unknown> }): Promise<Entity[]>

// Find with advanced operators, sorting, and column selection
async find<Cols extends keyof Entity>(options?: FindOptions<Entity, Cols>): Promise<Pick<Entity, Cols>[]>

// Find one
async findOne<Cols extends keyof Entity>(options?: FindOptions<Entity, Cols>): Promise<Pick<Entity, Cols> | null>

// Count
async count(options?: { where?: WhereClause<Entity> | Record<string, unknown> }): Promise<number>

// Exists
async exists(options?: { where?: WhereClause<Entity> | Record<string, unknown> }): Promise<boolean>

// Find with count (for pagination UI)
async findAndCount<Cols extends keyof Entity>(options?: FindOptions<Entity, Cols>): Promise<{
  items: Pick<Entity, Cols>[]
  total: number
}>
```

### Enhanced find() with Operators

The `find()` method supports MongoDB-style query operators for advanced filtering, sorting, and column selection:

<!-- doc-snippet: skip -->
```typescript
import type { FindOptions, WhereClause } from '@kysera/repository'

interface FindOptions<Entity, Cols extends keyof Entity = keyof Entity> {
  where?: WhereClause<Entity> | Record<string, unknown> // plain records allowed for dynamic conditions
  orderBy?: keyof Entity | string // strings are validated as plain SQL identifiers
  orderDirection?: 'asc' | 'desc'
  sort?: Array<{ column: keyof Entity; direction: 'asc' | 'desc' }>
  select?: Cols[]
  limit?: number
  offset?: number
}
```

**Supported Operators:**

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equal to | `{ status: { $eq: 'active' } }` |
| `$ne` | Not equal to | `{ status: { $ne: 'deleted' } }` |
| `$gt` | Greater than | `{ age: { $gt: 18 } }` |
| `$gte` | Greater than or equal | `{ age: { $gte: 18 } }` |
| `$lt` | Less than | `{ price: { $lt: 100 } }` |
| `$lte` | Less than or equal | `{ price: { $lte: 100 } }` |
| `$in` | Value in array | `{ status: { $in: ['active', 'pending'] } }` |
| `$nin` | Value not in array | `{ role: { $nin: ['admin', 'super'] } }` |
| `$like` | SQL LIKE pattern | `{ email: { $like: '%@example.com' } }` |
| `$ilike` | Case-insensitive LIKE (all dialects) | `{ name: { $ilike: '%john%' } }` |
| `$contains` | Contains substring | `{ title: { $contains: 'hello' } }` |
| `$startsWith` | Starts with | `{ code: { $startsWith: 'PRE_' } }` |
| `$endsWith` | Ends with | `{ filename: { $endsWith: '.pdf' } }` |
| `$between` | Value between range | `{ price: { $between: [10, 100] } }` |
| `$isNull` | Is NULL | `{ deletedAt: { $isNull: true } }` |
| `$isNotNull` | Is NOT NULL | `{ email: { $isNotNull: true } }` |
| `$or` | Logical OR | `{ $or: [{ status: 'a' }, { status: 'b' }] }` |
| `$and` | Logical AND | `{ $and: [{ age: { $gte: 18 } }, { age: { $lte: 65 } }] }` |

:::info MongoDB NULL semantics
`$ne` and `$nin` follow MongoDB semantics: rows where the column is `NULL`
**match**. Kysera compiles them to `(col <> ? OR col IS NULL)` and
`(col NOT IN (...) OR col IS NULL)` — plain SQL `<>` / `NOT IN` would silently
drop NULL rows. To also exclude NULLs, add `null` to the list
(`$nin: [x, null]`) or combine with `$isNotNull: true`. Symmetrically,
`$in: [x, null]` matches NULL rows, and `$ne: null` compiles to `IS NOT NULL`.
:::

**Examples:**

```typescript
// Simple equality (backwards compatible)
const activeUsers = await userRepo.find({ where: { status: 'active' } })

// With comparison operators
const adults = await userRepo.find({
  where: {
    age: { $gte: 18, $lte: 65 },
    status: { $in: ['active', 'verified'] }
  }
})

// With string operators
const exampleEmails = await userRepo.find({
  where: {
    email: { $like: '%@example.com' }
  }
})

// With logical operators
const relevantUsers = await userRepo.find({
  where: {
    $or: [
      { role: 'admin' },
      { role: 'moderator' },
      { $and: [{ role: 'user' }, { verified: true }] }
    ]
  }
})

// With sorting
const recentUsers = await userRepo.find({
  where: { status: 'active' },
  orderBy: 'createdAt',
  orderDirection: 'desc',
  limit: 10
})

// With multiple sort columns
const sortedUsers = await userRepo.find({
  sort: [
    { column: 'lastName', direction: 'asc' },
    { column: 'firstName', direction: 'asc' }
  ]
})

// With column selection
const userEmails = await userRepo.find({
  where: { status: 'active' },
  select: ['id', 'email', 'name']
})
// Returns Pick<User, 'id' | 'email' | 'name'>[]

// findAndCount for pagination UI
const { items, total } = await userRepo.findAndCount({
  where: { status: 'active' },
  orderBy: 'createdAt',
  orderDirection: 'desc',
  limit: 10,
  offset: 0
})
console.log(`Showing ${items.length} of ${total} results`)
```

**Null Handling:**

```typescript
// Find users with no deleted_at (not soft-deleted)
const activeUsers = await userRepo.find({
  where: { deletedAt: { $isNull: true } }
})

// Find users with verified email
const verifiedUsers = await userRepo.find({
  where: { emailVerifiedAt: { $isNotNull: true } }
})

// Direct null comparison
const nullNameUsers = await userRepo.find({
  where: { middleName: null }  // Uses IS NULL
})
```

**Combining Operators:**

```typescript
// Multiple operators on same field
const priceRange = await productRepo.find({
  where: {
    price: { $gte: 10, $lte: 100 },
    category: { $in: ['electronics', 'books'] },
    description: { $contains: 'sale' }
  }
})

// Nested logical conditions
const complexQuery = await userRepo.find({
  where: {
    status: 'active',
    $or: [
      { role: 'admin' },
      {
        $and: [
          { role: 'user' },
          { createdAt: { $gte: oneMonthAgo } }
        ]
      }
    ]
  }
})
```

### Pagination

<!-- doc-snippet: skip -->
```typescript
// Offset pagination
async paginate(options: {
  limit: number
  offset?: number
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
}): Promise<{
  items: Entity[]
  total: number
  limit: number
  offset: number
}>

// Cursor pagination
async paginateCursor<K extends keyof Entity>(options: {
  limit: number
  cursor?: { value: Entity[K]; id: PK } | null
  orderBy?: K
  orderDirection?: 'asc' | 'desc'
}): Promise<{
  items: Entity[]
  nextCursor: { value: Entity[K]; id: PK } | null
  hasMore: boolean
}>
```

### Transaction Support

<!-- doc-snippet: skip -->
```typescript
// Execute within transaction
async transaction<R>(fn: (trx: Transaction<DB>) => Promise<R>): Promise<R>

// Get repository with transaction
withTransaction(trx: Transaction<DB>): Repository<Entity, DB, PK>
```

## createRepositoriesFactory

Create multiple repositories at once for transaction support. This helper provides a clean pattern for managing multiple repositories with shared executor.

<!-- doc-snippet: skip -->
```typescript
function createRepositoriesFactory<DB, Repos extends Record<string, any>>(
  factories: RepositoryFactoryMap<DB, Repos>
): (executor: Executor<DB>) => Repos

type RepositoryFactoryMap<DB, Repos> = {
  [K in keyof Repos]: (executor: Executor<DB>) => Repos[K]
}
```

### Example

<!-- doc-snippet: skip -->
```typescript
import { createRepositoriesFactory } from '@kysera/repository'

// Define your repository factories
const createRepos = createRepositoriesFactory({
  users: executor => createUserRepository(executor),
  posts: executor => createPostRepository(executor),
  comments: executor => createCommentRepository(executor)
})

// Normal usage with database instance
const repos = createRepos(db)
await repos.users.findById(1)
await repos.posts.findAll()

// Transaction usage (clean one-liner!)
await db.transaction().execute(async trx => {
  const repos = createRepos(trx)
  const user = await repos.users.create({ name: 'Alice', email: 'alice@example.com' })
  const post = await repos.posts.create({ userId: user.id, title: 'Hello World' })
  await repos.comments.create({ postId: post.id, text: 'Great post!' })
})

// Infer the bundle type from the factory
import type { RepositoriesFromFactory } from '@kysera/repository'
type Repositories = RepositoriesFromFactory<typeof createRepos>
```

## createORM

Create a plugin container (repository manager) with plugin support. Despite its name, `createORM` is not a traditional ORM - it's a lightweight plugin container that manages repositories and provides unified plugin execution via `@kysera/executor`.

<!-- doc-snippet: skip -->
```typescript
async function createORM<DB>(
  db: Kysely<DB>, // a KyseraExecutor is accepted too — it is a Kysely subtype
  plugins?: Plugin[]
): Promise<PluginOrm<DB>>

interface PluginOrm<DB> {
  /** Plugin-aware executor from @kysera/executor (declared as Kysely<DB>) */
  executor: Kysely<DB>
  /** Create a repository with plugin support */
  createRepository: <T extends object>(
    factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T
  ) => T
  /** Apply plugin interceptors to query builders */
  applyPlugins: ApplyPluginsFunction
  /** Registered plugins in resolved order */
  plugins: readonly Plugin[]
  /** Create a DAL context with plugins */
  createContext(): DbContext<DB>
  /** Execute a transaction with both Repository and DAL patterns */
  transaction<T>(fn: (ctx: DbContext<DB>) => Promise<T>): Promise<T>
}

type ApplyPluginsFunction = <QB extends AnyQueryBuilder>(
  qb: QB,
  operation: string,
  table: string,
  metadata?: Record<string, unknown>
) => QB
```

:::note Declared vs runtime type
`PluginOrm.executor` (and the executor passed to repository factories) is
declared as plain `Kysely<DB>` so existing Kysely-typed code accepts it without
casts. At runtime it is the plugin-aware executor created by
`createExecutor()` — use `isKyseraExecutor()` / `getPlugins()` from
`@kysera/executor` to introspect it.
:::

**Parameters:**

- `db` - Kysely database instance or KyseraExecutor (if executor passed, its plugins are used)
- `plugins` - Optional array of plugins to apply (merged with executor plugins if executor is passed)

**Returns:** `Promise<PluginOrm<DB>>` - Plugin container with executor and repository factory

**What is createORM?**

`createORM` is a **plugin container** and **repository manager**, not a traditional ORM. It provides:

- Plugin initialization and lifecycle management
- Unified query interception across repositories
- Repository factory with plugin extensions
- Transaction support for both Repository and DAL patterns

**How it works:**

1. Creates a plugin-aware executor using `createExecutor(db, plugins)` from `@kysera/executor`
2. Plugins are validated, dependencies resolved, and initialized
3. Query interceptors (`interceptQuery`) apply automatically via `applyPlugins` function
4. Repository extensions (`extendRepository`) add custom methods during `createRepository`
5. Provides `createContext()` for DAL integration and `transaction()` for CQRS-lite patterns

### Basic Example

<!-- doc-snippet: skip -->
```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

// Create plugin container (repository manager) with plugins
const orm = await createORM(db, [
  rlsPlugin({ schema: rlsSchema }), // Query interceptor + repository extensions
  softDeletePlugin() // Query interceptor + repository extensions
])

// Create repository factory function
const createUserRepository = (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'users',
    mapRow: row => row,
    schemas: {
      create: zodAdapter(CreateUserSchema)
    }
  })
}

// Create repository - gets both interceptors and extension methods
const userRepo = orm.createRepository(createUserRepository)

// Query interceptors applied automatically
const users = await userRepo.findAll() // RLS + soft-delete filters applied

// Extension methods available from plugins
await userRepo.softDelete(userId) // from softDeletePlugin
await userRepo.restore(userId) // from softDeletePlugin
```

### CQRS-lite Pattern: Repository + DAL

Mix Repository (for writes with validation) and DAL (for complex reads) in the same transaction:

<!-- doc-snippet: skip -->
```typescript
import { createORM } from '@kysera/repository'
import { createQuery } from '@kysera/dal'

const orm = await createORM(db, [softDeletePlugin()])

// Define DAL queries for complex reads
const getUserStats = createQuery((ctx: DbContext<Database>, userId: number) =>
  ctx.db
    .selectFrom('user_stats')
    .innerJoin('aggregates', 'aggregates.user_id', 'user_stats.user_id')
    .selectAll()
    .where('user_stats.user_id', '=', userId)
    .executeTakeFirst()
)

// Use both patterns in transaction
await orm.transaction(async ctx => {
  // Repository for writes (with validation and extension methods)
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create({ email: 'test@example.com', name: 'Test' })

  // DAL for complex reads (same transaction, same plugins)
  const stats = await getUserStats(ctx, user.id)

  return { user, stats }
})
```

### Advanced: Shared Executor Pattern

For maximum control and reusability, create an executor first and share it across Repository and DAL patterns:

<!-- doc-snippet: skip -->
```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { createContext } from '@kysera/dal'

// Create executor with plugins once
const executor = await createExecutor(db, [rlsPlugin({ schema: rlsSchema }), softDeletePlugin()])

// Option 1: Use with Repository pattern
const orm = await createORM(executor, []) // No additional plugins needed
const userRepo = orm.createRepository(createUserRepository)

// Option 2: Use with DAL pattern (same executor, same plugins)
const dalCtx = createContext(executor)
const users = await getUsersQuery(dalCtx)

// Both patterns share the same plugin behavior!
```

**Benefits of shared executor:**

- Single source of truth for plugin configuration
- Query interceptors work consistently in both Repository and DAL
- Better performance (plugins initialized once)
- Easier testing (mock the executor once)

## Validation Adapters

Kysera Repository supports multiple validation libraries through adapters. This eliminates vendor lock-in and lets you choose your preferred validation library.

### ValidationSchema Interface

All adapters implement this unified interface:

```typescript
interface ValidationSchema<T = unknown> {
  parse(data: unknown): T // Parse and validate (throws on error)
  safeParse(data: unknown): ValidationResult<T> // Safe parse (returns result)
  partial?(): ValidationSchema<Partial<T>> // Make all fields optional (for update)
}

type ValidationResult<T> = { success: true; data: T } | { success: false; error: ValidationError }
```

### zodAdapter

<!-- doc-snippet: skip -->
```typescript
import { z } from 'zod'
import { zodAdapter } from '@kysera/repository'

const UserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(18)
})

const validator = zodAdapter(UserSchema)

// Use in repository
schemas: {
  create: zodAdapter(UserSchema),
  // update automatically uses UserSchema.partial()
}
```

### valibotAdapter

<!-- doc-snippet: skip -->
```typescript
import * as v from 'valibot'
import { valibotAdapter } from '@kysera/repository'

const UserSchema = v.object({
  name: v.string(),
  email: v.string([v.email()]),
  age: v.number([v.minValue(18)])
})

const validator = valibotAdapter(UserSchema, v)

schemas: {
  create: valibotAdapter(UserSchema, v),
}
```

### typeboxAdapter

<!-- doc-snippet: skip -->
```typescript
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { typeboxAdapter } from '@kysera/repository'

const UserSchema = Type.Object({
  name: Type.String(),
  email: Type.String({ format: 'email' }),
  age: Type.Number({ minimum: 18 })
})

const validator = typeboxAdapter(UserSchema, Value)

schemas: {
  create: typeboxAdapter(UserSchema, Value),
}
```

### nativeAdapter

No runtime validation - just type casting. Use when you trust your data sources.

<!-- doc-snippet: skip -->
```typescript
import { nativeAdapter } from '@kysera/repository'

interface CreateUserInput {
  name: string
  email: string
  age: number
}

schemas: {
  create: nativeAdapter<CreateUserInput>(),
  update: nativeAdapter<Partial<CreateUserInput>>(),
}
```

### customAdapter

Create your own validation adapter from a simple validate function:

<!-- doc-snippet: skip -->
```typescript
import { customAdapter } from '@kysera/repository'

const validateUser = customAdapter<User>((data) => {
  if (typeof data !== 'object' || !data) {
    throw new Error('Invalid user data')
  }
  const user = data as Record<string, unknown>
  if (typeof user.email !== 'string' || !user.email.includes('@')) {
    throw new Error('Invalid email')
  }
  return user as User
})

schemas: {
  create: validateUser,
}
```

## withPlugins

Simplified helper function for creating a single repository with plugins. This is a convenience wrapper around `createORM`.

<!-- doc-snippet: skip -->
```typescript
async function withPlugins<DB, T extends object>(
  factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T,
  executor: Kysely<DB>,
  plugins: Plugin[]
): Promise<T>
```

### Basic Example

<!-- doc-snippet: skip -->
```typescript
import { withPlugins } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

// Define your repository factory
const createUserRepo = (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'users',
    mapRow: row => ({
      id: row.id,
      email: row.email,
      name: row.name
    }),
    schemas: {
      create: zodAdapter(
        z.object({
          email: z.string().email(),
          name: z.string()
        })
      )
    }
  })
}

// Create repository with soft delete plugin
const userRepo = await withPlugins(createUserRepo, db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' })
])

// Use extended methods from plugin
await userRepo.softDelete(1)
await userRepo.restore(2)
```

**When to use:**

- Simple single repository setup with plugins
- You don't need DAL integration
- You want minimal boilerplate

**Use `createORM()` instead when:**

- Creating multiple repositories with shared plugins
- You need DAL integration (`createContext`, `transaction`)
- You want CQRS-lite pattern support

## ContextAwareRepository

Abstract base class for repositories that need clean transaction handling via executor switching.

<!-- doc-snippet: skip -->
```typescript
abstract class ContextAwareRepository<DB, Table extends string> {
  constructor(executor: Executor<DB>, tableName: Table)

  /** Create a new repository instance with a different executor (e.g., transaction) */
  withExecutor(executor: Executor<DB>): this

  /** Protected accessor for the current executor */
  protected get db(): Executor<DB>

  /** The table name this repository operates on */
  readonly tableName: Table
}
```

### Example Usage

<!-- doc-snippet: skip -->
```typescript
import { ContextAwareRepository } from '@kysera/repository'
import type { Executor } from '@kysera/core'

class UserRepository extends ContextAwareRepository<Database, 'users'> {
  async create(data: { email: string; name: string }): Promise<User> {
    return this.db.insertInto(this.tableName).values(data).returningAll().executeTakeFirstOrThrow()
  }

  async findById(id: number): Promise<User | null> {
    return (
      this.db.selectFrom(this.tableName).selectAll().where('id', '=', id).executeTakeFirst() ?? null
    )
  }
}

// Normal usage
const userRepo = new UserRepository(db, 'users')
const user = await userRepo.findById(1)

// Transaction usage - clean executor switching!
await db.transaction().execute(async trx => {
  const txUserRepo = userRepo.withExecutor(trx)
  const txPostRepo = postRepo.withExecutor(trx)

  const user = await txUserRepo.create({ email: 'test@example.com', name: 'Test' })
  await txPostRepo.create({ userId: user.id, title: 'Hello' })
  // Both operations in same transaction
})
```

**Benefits:**

- Clean API: No `executor` parameter in every method
- Type-safe: `withExecutor()` returns same repository type with all methods
- Preserves instance: Custom properties and methods are preserved

## Upsert Helpers

Functions for INSERT ... ON CONFLICT DO UPDATE operations.

### upsert

Insert a single record, updating on conflict.

<!-- doc-snippet: skip -->
```typescript
async function upsert<DB, Table, Row>(
  db: Kysely<DB>,
  table: Table,
  data: Insertable<Row>,
  options: UpsertOptions<Insertable<Row>>
): Promise<Selectable<Row> | void>

interface UpsertOptions<T> {
  /** Columns that define the conflict constraint */
  conflictColumns: (keyof T)[]
  /** Columns to update on conflict (default: all except conflictColumns) */
  updateColumns?: (keyof T)[]
  /** Whether to return the upserted record */
  returning?: boolean
}
```

### upsertMany

Batch upsert multiple records.

<!-- doc-snippet: skip -->
```typescript
async function upsertMany<DB, Table, Row>(
  db: Kysely<DB>,
  table: Table,
  data: Insertable<Row>[],
  options: UpsertOptions<Insertable<Row>>
): Promise<Selectable<Row>[] | void>
```

### Upsert Examples

<!-- doc-snippet: skip -->
```typescript
import { upsert, upsertMany } from '@kysera/repository'

// Single record upsert
const wallet = await upsert(
  db,
  'wallets',
  {
    name: 'Main Wallet',
    balance: 1000
  },
  {
    conflictColumns: ['name'],
    returning: true
  }
)

// Upsert with specific update columns
await upsert(
  db,
  'users',
  {
    email: 'alice@example.com',
    name: 'Alice Updated',
    role: 'admin'
  },
  {
    conflictColumns: ['email'],
    updateColumns: ['name'], // Only update name, not role
    returning: true
  }
)

// Batch upsert
const prices = await upsertMany(
  db,
  'price_history',
  [
    { pair: 'BTC/USD', timestamp: now, price: 50000 },
    { pair: 'ETH/USD', timestamp: now, price: 3000 }
  ],
  {
    conflictColumns: ['pair', 'timestamp'],
    updateColumns: ['price'],
    returning: true
  }
)

// Upsert in transaction
await db.transaction().execute(async trx => {
  await upsertMany(trx, 'inventory', items, {
    conflictColumns: ['sku'],
    updateColumns: ['quantity', 'updated_at']
  })
})
```

### atomicStatusTransition

Race-safe status transition: updates a record's status only if it currently has
the expected status, using a single atomic `UPDATE ... WHERE status = ?`.
Returns the updated record, or `null` when the status didn't match — meaning
another process already performed the transition.

<!-- doc-snippet: skip -->
```typescript
async function atomicStatusTransition<DB, Table extends keyof DB & string, S>(
  db: Executor<DB>,
  table: Table,
  where: Partial<Selectable<DB[Table]>>,
  options: StatusTransitionOptions<Selectable<DB[Table]>, S>
): Promise<Selectable<DB[Table]> | null>

interface StatusTransitionOptions<T, S> {
  /** Column name containing the status (default: 'status') */
  statusColumn?: string
  /** Current status that must match for the transition to occur */
  fromStatus: S
  /** New status to set */
  toStatus: S
  /** Additional data to update along with the status */
  additionalUpdates?: Partial<T>
  /** Whether to return the updated entity (default: true) */
  returning?: boolean
}
```

<!-- doc-snippet: skip -->
```typescript
import { atomicStatusTransition } from '@kysera/repository'

// Prevent double-processing: only one worker wins the pending → processing race
const payment = await atomicStatusTransition(
  db,
  'payments',
  { id: paymentId },
  {
    fromStatus: 'pending',
    toStatus: 'processing',
    additionalUpdates: { started_at: new Date() }
  }
)

if (!payment) {
  // Another worker already claimed this payment — safe to skip
  return
}
```

Typical uses: payment pipelines (`pending → processing → completed`), order
state machines, and any transition that must not be applied twice under
concurrency.

## TableOperations

Low-level interface for database operations. Used internally by `createBaseRepository` but can be used directly for custom repository implementations.

<!-- doc-snippet: skip -->
```typescript
function createTableOperations<DB, TableName extends keyof DB & string>(
  db: Executor<DB>,
  tableName: TableName,
  pkConfig?: PrimaryKeyConfig,
  options?: TableOperationsOptions | DialectConfig
): TableOperations<DB[TableName]>

interface TableOperationsOptions {
  /** Database dialect type (optional, defaults to auto-detection) */
  dialect?: 'postgres' | 'mysql' | 'sqlite' | 'mssql'
  /** PostgreSQL schema for queries. When set, all queries are scoped to this schema. */
  schema?: string
}

interface TableOperations<Table> {
  selectAll(): Promise<Selectable<Table>[]>
  selectById(id: PrimaryKeyInput): Promise<Selectable<Table> | undefined>
  selectByIds(ids: PrimaryKeyInput[]): Promise<Selectable<Table>[]>
  selectWhere(conditions: Record<string, unknown>): Promise<Selectable<Table>[]>
  selectOneWhere(conditions: Record<string, unknown>): Promise<Selectable<Table> | undefined>
  insert(data: unknown): Promise<Selectable<Table>>
  insertMany(data: unknown[]): Promise<Selectable<Table>[]>
  updateById(id: PrimaryKeyInput, data: unknown): Promise<Selectable<Table> | undefined>
  deleteById(id: PrimaryKeyInput): Promise<boolean>
  deleteByIds(ids: PrimaryKeyInput[]): Promise<number>
  count(conditions?: Record<string, unknown>): Promise<number>
  paginate(options: {
    limit: number
    offset: number
    orderBy: string
    orderDirection: 'asc' | 'desc'
  }): Promise<Selectable<Table>[]>
  paginateCursor(options: {
    limit: number
    cursor?: { value: unknown; id: PrimaryKeyInput } | null
    orderBy: string
    orderDirection: 'asc' | 'desc'
  }): Promise<Selectable<Table>[]>
}
```

**Schema Support:**

When `options.schema` is provided, all queries are automatically scoped to that PostgreSQL schema using Kysely's `.withSchema()`:

```typescript
const operations = createTableOperations(db, 'users', pkConfig, {
  schema: 'auth',
  dialect: 'postgres'
})

// All operations use auth.users
const users = await operations.selectAll()
// Executes: SELECT * FROM "auth"."users"
```

### Example: Custom Repository

```typescript
import { createTableOperations } from '@kysera/repository'

const operations = createTableOperations(db, 'users', {
  columns: 'id',
  type: 'number'
})

// Use operations directly
const users = await operations.selectAll()
const user = await operations.selectById(1)
await operations.insert({ name: 'Alice', email: 'alice@example.com' })
```

### Example: Multi-Tenant with Schema

```typescript
import { createTableOperations } from '@kysera/repository'

function createTenantOperations(tenantId: string) {
  return createTableOperations(db, 'users', { columns: 'id', type: 'number' }, {
    schema: `tenant_${tenantId}`,
    dialect: 'postgres'
  })
}

// Each tenant's operations are scoped to their schema
const tenant1Ops = createTenantOperations('acme')
const tenant2Ops = createTenantOperations('globex')

const acmeUsers = await tenant1Ops.selectAll() // FROM "tenant_acme"."users"
const globexUsers = await tenant2Ops.selectAll() // FROM "tenant_globex"."users"
```

## BaseRepository Interface

The core repository interface that all repositories implement:

```typescript
interface BaseRepository<DB, Entity, PK = number> {
  // Single operations
  findById(id: PK): Promise<Entity | null>
  findAll(): Promise<Entity[]>
  create(input: unknown): Promise<Entity>
  update(id: PK, input: unknown): Promise<Entity>
  delete(id: PK): Promise<boolean>

  // Batch operations
  findByIds(ids: PK[]): Promise<Entity[]>
  bulkCreate(inputs: unknown[]): Promise<Entity[]>
  bulkUpdate(updates: { id: PK; data: unknown }[]): Promise<Entity[]>
  bulkDelete(ids: PK[]): Promise<number>

  // Query operations with operator support
  find<Cols extends keyof Entity = keyof Entity>(
    options?: FindOptions<Entity, Cols>
  ): Promise<Cols extends keyof Entity ? Pick<Entity, Cols>[] : Entity[]>

  findOne<Cols extends keyof Entity = keyof Entity>(
    options?: FindOptions<Entity, Cols>
  ): Promise<(Cols extends keyof Entity ? Pick<Entity, Cols> : Entity) | null>

  count(options?: { where?: WhereClause<Entity> | Record<string, unknown> }): Promise<number>

  exists(options?: { where?: WhereClause<Entity> | Record<string, unknown> }): Promise<boolean>

  findAndCount<Cols extends keyof Entity = keyof Entity>(
    options?: FindOptions<Entity, Cols>
  ): Promise<{
    items: Cols extends keyof Entity ? Pick<Entity, Cols>[] : Entity[]
    total: number
  }>

  // Pagination (option/result shapes are inline — see the Pagination section)
  paginate(options: {
    limit: number
    offset?: number
    orderBy?: string
    orderDirection?: 'asc' | 'desc'
  }): Promise<{ items: Entity[]; total: number; limit: number; offset: number }>
  paginateCursor<K extends keyof Entity>(options: {
    limit: number
    cursor?: { value: Entity[K]; id: PK } | null
    orderBy?: K
    orderDirection?: 'asc' | 'desc'
  }): Promise<{
    items: Entity[]
    nextCursor: { value: Entity[K]; id: PK } | null
    hasMore: boolean
  }>

  // Transaction
  transaction<R>(fn: (trx: Transaction<DB>) => Promise<R>): Promise<R>
}
```

## Plugin Integration

### Plugin Types

Plugins can provide two types of functionality:

1. **Query Interceptors** (`interceptQuery`) - Modify queries before execution
   - Examples: soft-delete filtering, RLS policies
   - Work with both Repository and DAL patterns
   - Applied automatically by the plugin-aware executor

2. **Repository Extensions** (`extendRepository`) - Add methods to repositories
   - Examples: `repo.softDelete()`, `repo.restore()`, `repo.getAuditHistory()`
   - Work only with Repository pattern
   - Applied by `createORM` during repository creation

### Plugin Execution Flow

<!-- doc-snippet: skip -->
```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

// 1. createORM creates executor with plugins
const orm = await createORM(db, [softDeletePlugin()])

// 2. createRepository creates base repository
const userRepo = orm.createRepository((executor, applyPlugins) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({ tableName: 'users', ... })
})

// 3. Plugins extend the repository via extendRepository
// Result: userRepo has both automatic filtering AND extension methods

// 4. Query interceptors apply automatically
const users = await userRepo.findAll()
// -> SELECT * FROM users WHERE deleted_at IS NULL

// 5. Extension methods available
await userRepo.softDelete(userId)
// -> UPDATE users SET deleted_at = NOW() WHERE id = ?
```

### Working with Executor

You can access the underlying executor from the repository manager:

<!-- doc-snippet: skip -->
```typescript
const orm = await createORM(db, [softDeletePlugin()])

// Access the executor
const executor = orm.executor

// Check loaded plugins
import { isKyseraExecutor, getPlugins, getRawDb } from '@kysera/executor'

if (isKyseraExecutor(executor)) {
  // Get loaded plugins
  const plugins = getPlugins(executor)
  console.log(plugins.map(p => p.name))

  // Get raw Kysely instance (bypasses plugins)
  const rawDb = getRawDb(executor)
  // Queries on rawDb bypass all plugin interceptors
}
```

### Transaction Plugin Propagation

Plugins automatically propagate through transactions:

<!-- doc-snippet: skip -->
```typescript
const orm = await createORM(db, [
  rlsPlugin({ schema: rlsSchema }),
  softDeletePlugin()
])

await orm.transaction(async (ctx) => {
  // ctx.db has all plugins applied
  const userRepo = orm.createRepository(createUserRepository)

  // All queries inherit plugins from executor
  const users = await userRepo.findAll()  // RLS + soft-delete applied
  await userRepo.create({ ... })           // RLS validation applied
})
```

## Primary Key Types

Kysera Repository supports various primary key configurations:

<!-- doc-snippet: skip -->
```typescript
// Single column with auto-increment (default)
{
  primaryKey: 'id',
  primaryKeyType: 'number'
}

// UUID primary key
{
  primaryKey: 'uuid',
  primaryKeyType: 'uuid'
}

// Custom column name
{
  primaryKey: 'user_id',
  primaryKeyType: 'number'
}

// String-based ID
{
  primaryKey: 'slug',
  primaryKeyType: 'string'
}

// Composite primary key
{
  primaryKey: ['tenant_id', 'user_id'],
  primaryKeyType: 'number'
}
```

### Working with Composite Keys

<!-- doc-snippet: skip -->
```typescript
const factory = createRepositoryFactory(db)

const tenantUserRepo = factory.create({
  tableName: 'tenant_users',
  primaryKey: ['tenant_id', 'user_id'],
  mapRow: row => row,
  schemas: {
    create: zodAdapter(CreateTenantUserSchema)
  }
})

// Find by composite key
const user = await tenantUserRepo.findById({ tenant_id: 1, user_id: 42 })

// Delete by composite key
await tenantUserRepo.delete({ tenant_id: 1, user_id: 42 })

// Bulk operations with composite keys
const users = await tenantUserRepo.findByIds([
  { tenant_id: 1, user_id: 42 },
  { tenant_id: 1, user_id: 43 }
])
```

### extractPrimaryKey

Extract the primary key value from a row or entity — a scalar for single-column
keys, an object for composite keys:

```typescript
import { extractPrimaryKey } from '@kysera/repository'

extractPrimaryKey({ id: 1, name: 'Alice' }, { columns: 'id', type: 'number' })
// 1

extractPrimaryKey(
  { tenant_id: 1, user_id: 42, role: 'admin' },
  { columns: ['tenant_id', 'user_id'], type: 'number' }
)
// { tenant_id: 1, user_id: 42 }
```

## Dynamic Column Safety

Repository methods that accept dynamic column names (`find` conditions,
`orderBy` strings, `selectWhere`, …) validate them before they reach SQL. The
guard surface is exported for use in custom query code:

```typescript
import {
  assertValidIdentifier,
  validateColumnNames,
  validateConditions,
  getAllowedColumnsFromPkConfig
} from '@kysera/repository'
import type { ColumnValidationOptions } from '@kysera/repository'

// Reject anything that is not a plain SQL identifier
assertValidIdentifier('created_at', 'orderBy column') // OK
assertValidIdentifier('name desc', 'orderBy column') // throws

// Strict whitelist check for condition keys
validateColumnNames({ name: 'Alice' }, new Set(['id', 'name', 'email'])) // OK
validateColumnNames({ evil: '1' }, new Set(['id', 'name'])) // throws

// Combined helper used by table operations:
// - with options.allowedColumns: strict whitelist membership
// - without: identifier-shape check on every key
validateConditions(conditions, pkConfig, {
  allowedColumns: new Set(['id', 'name', 'email'])
})

// Derive a minimal whitelist from a PrimaryKeyConfig
const allowed = getAllowedColumnsFromPkConfig({
  columns: ['tenant_id', 'user_id'],
  type: 'number'
})
// Set { 'tenant_id', 'user_id' }
```

`ColumnValidationOptions` is `{ enabled?: boolean; allowedColumns?: ReadonlySet<string> }`
— validation is on by default and cheap enough to keep enabled in production.
Dynamic `orderBy` values that are not plain identifiers (e.g. `'name desc'`)
throw instead of being sent to the database, which also catches the SQLite
failure mode where such a value would be treated as a string literal.

## CQRS-lite Pattern

Use `orm.createContext()` and `orm.transaction()` to mix Repository (writes with validation) and DAL (complex reads) patterns:

```typescript
import { createORM } from '@kysera/repository'
import { createQuery } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])

// Define DAL queries for complex reads
const getDashboardStats = createQuery((ctx: DbContext<Database>, userId: number) =>
  ctx.db
    .selectFrom('users')
    .innerJoin('posts', 'posts.user_id', 'users.id')
    .innerJoin('comments', 'comments.post_id', 'posts.id')
    .select([
      'users.id',
      'users.name',
      eb => eb.fn.count('posts.id').as('post_count'),
      eb => eb.fn.count('comments.id').as('comment_count')
    ])
    .where('users.id', '=', userId)
    .groupBy(['users.id', 'users.name'])
    .executeTakeFirst()
)

// Mix patterns in transaction
const result = await orm.transaction(async ctx => {
  // Repository for writes (with validation and extension methods)
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create({
    email: 'test@example.com',
    name: 'Test User'
  })

  // DAL for complex reads (same transaction, same plugins)
  const stats = await getDashboardStats(ctx, user.id)

  return { user, stats }
})
```

**Benefits:**

- Repository for CRUD with validation and type safety
- DAL for complex queries with full Kysely flexibility
- Shared plugins across both patterns (soft-delete, RLS, etc.)
- Single transaction for consistency

## Validation Control

Repository validation is controlled **per repository** through config options —
environment variables never change the behavior of factory-created repositories:

<!-- doc-snippet: skip -->
```typescript
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    entity: zodAdapter(UserSchema), // used only when validateDbResults is on
    create: zodAdapter(CreateUserSchema)
  },
  validationStrategy: 'strict', // input validation: 'strict' (default) | 'none'
  validateDbResults: true // output validation; default: NODE_ENV === 'development'
})
```

- **Input validation** (`create`, `update`, and bulk variants) runs through
  `schemas.create` / `schemas.update` unless `validationStrategy: 'none'` is set.
- **Output validation** re-parses mapped rows with `schemas.entity`, only when
  `validateDbResults` is `true`. Its default is derived from `NODE_ENV` at
  repository creation (`'development'` → on, anything else → off).

The `KYSERA_VALIDATION_MODE` environment variable affects **only** the
standalone helpers `shouldValidate()` and `createValidator().validateConditional()`
— it is never consulted by factory-created repositories:

```typescript
import { getValidationMode, shouldValidate } from '@kysera/repository'

// KYSERA_VALIDATION_MODE=always|never|development|production (falls back to NODE_ENV)
console.log(getValidationMode()) // 'development' | 'production' | 'always' | 'never'
console.log(shouldValidate()) // single boolean derived from the mode
```

## Database Support

| Feature        | PostgreSQL   | MySQL                       | SQLite       |
| -------------- | ------------ | --------------------------- | ------------ |
| RETURNING      | Native       | Emulated (insert + refetch) | Native       |
| Bulk Insert    | Single query | Row-by-row in a transaction | Single query |
| Composite Keys | ✓            | ✓                           | ✓            |
| UUID           | ✓            | ✓                           | ✓            |
| Pagination     | LIMIT/OFFSET | LIMIT/OFFSET                | LIMIT/OFFSET |

**Notes:**

- MySQL is the only dialect with special handling: it lacks `RETURNING`, so Kysera re-fetches created/updated records by primary key (using `insertId` for auto-increment keys). Every other dialect gets standard `RETURNING`-based queries via `returningAll()`.
- MySQL bulk inserts run row-by-row inside an automatic transaction and are rolled back as a whole on failure — see [`bulkCreate` behavior](#batch-operations).
- `'mssql'` is accepted as a `DialectConfig` value, but repository operations contain no MSSQL-specific code paths (in particular, no OUTPUT-clause handling).
- `paginate()` and `paginateCursor()` always emit `ORDER BY`, defaulting `orderBy` to the first primary-key column when not given. `find({ limit, offset })` adds no default ordering — pass `orderBy` or `sort` for deterministic pages.
- Boolean values are returned as the driver provides them (e.g. `1`/`0` on MySQL and SQLite) — Kysera performs no normalization; convert in `mapRow` if your entity uses `boolean`.
- All databases support composite primary keys.

See [Factory](/docs/api/repository/factory), [Validation](/docs/api/repository/validation), and [Types](/docs/api/repository/types) for more details.
