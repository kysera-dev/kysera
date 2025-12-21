---
sidebar_position: 3
title: "@kysera/repository"
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

**Version:** 0.7.0
**Bundle Size:** ~12 KB (minified)
**Dependencies:** @kysera/executor, @kysera/dal, @kysera/core
**Peer Dependencies:** kysely >=0.28.8, zod ^4.x (optional)

:::tip Unified Execution Layer (v0.7+)
`@kysera/repository` uses `@kysera/executor` under the hood for plugin management. Plugins work through query interception (`interceptQuery`) and repository extensions (`extendRepository`). Query interceptors apply to both Repository and DAL patterns. Repository extensions work only with Repository pattern.
:::

## Core Exports

```typescript
// Factory functions
export { createRepositoryFactory } from './repository'
export { createRepositoriesFactory } from './helpers'
export { createSimpleRepository } from './repository'

// Repository manager with plugins
export { createORM, withPlugins } from './plugin'
export type { PluginOrm, ApplyPluginsFunction } from './plugin'

// Validation
export {
  getValidationMode,
  shouldValidate,
  createValidator,
  safeParse
} from './validation'

// Validation adapters
export {
  zodAdapter,
  valibotAdapter,
  typeboxAdapter,
  nativeAdapter,
  customAdapter,
  normalizeSchema
} from './validation-adapter'
export type { ValidationSchema, ValidationError } from './validation-adapter'

// Base repository
export { createBaseRepository } from './base-repository'
export type { BaseRepository, RepositoryConfig, TableOperations } from './base-repository'

// Table operations
export { createTableOperations } from './table-operations'

// Context-aware repository
export { ContextAwareRepository } from './context-aware'

// Upsert helpers
export { upsert, upsertMany } from './upsert'
export type { UpsertOptions } from './upsert'

// Re-export executor types
export type { Plugin, QueryBuilderContext } from '@kysera/executor'
export { PluginValidationError, validatePlugins, resolvePluginOrder } from '@kysera/executor'

// Types
export * from './types'
```

## createRepositoryFactory

Create a typed repository factory that provides methods for creating individual repositories.

```typescript
function createRepositoryFactory<DB>(
  executor: Executor<DB>
): {
  executor: Executor<DB>
  create<TableName extends keyof DB & string, Entity, PK = number>(
    config: RepositoryConfig<TableName, Entity, PK>
  ): Repository<Entity, DB, PK>
}

// Executor type accepts both Kysely instance and Transaction
type Executor<DB> = Kysely<DB> | Transaction<DB>
```

### RepositoryConfig

```typescript
interface RepositoryConfig<TableName, Entity, PK = number> {
  tableName: TableName
  primaryKey?: PrimaryKeyColumn           // Default: 'id'
  primaryKeyType?: PrimaryKeyTypeHint     // Default: 'number'
  mapRow: (row: Selectable<DB[TableName]>) => Entity
  schemas: {
    entity?: ValidationSchema<Entity>     // Optional result validation
    create: ValidationSchema              // Required input validation
    update?: ValidationSchema             // Optional update validation (uses create.partial() if omitted)
  }
  validateDbResults?: boolean             // Default: NODE_ENV === 'development'
  validationStrategy?: 'none' | 'strict'  // Default: 'strict'
}

// Primary key types
type PrimaryKeyColumn = string | string[]  // Single: 'id', Composite: ['tenant_id', 'user_id']
type PrimaryKeyTypeHint = 'number' | 'string' | 'uuid'
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
  mapRow: (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at
  }),
  schemas: {
    create: zodAdapter(CreateUserSchema),
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
  mapRow: (row) => row,
  schemas: {
    create: nativeAdapter<CreateUserInput>(),
    update: nativeAdapter<Partial<CreateUserInput>>(),
  },
  validateDbResults: false,
})
```

## Repository Methods

### Single Record Operations

```typescript
// Find by ID
async findById(id: PK): Promise<Entity | null>

// Create
async create(input: unknown): Promise<Entity>

// Update
async update(id: PK, input: unknown): Promise<Entity>

// Delete
async delete(id: PK): Promise<boolean>
```

### Batch Operations

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

### Query Operations

```typescript
// Find all
async findAll(): Promise<Entity[]>

// Find with conditions
async find(options?: { where?: Record<string, unknown> }): Promise<Entity[]>

// Find one
async findOne(options?: { where?: Record<string, unknown> }): Promise<Entity | null>

// Count
async count(options?: { where?: Record<string, unknown> }): Promise<number>

// Exists
async exists(options?: { where?: Record<string, unknown> }): Promise<boolean>
```

### Pagination

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

```typescript
// Execute within transaction
async transaction<R>(fn: (trx: Transaction<DB>) => Promise<R>): Promise<R>

// Get repository with transaction
withTransaction(trx: Transaction<DB>): Repository<Entity, DB, PK>
```

## createRepositoriesFactory

Create multiple repositories at once for transaction support. This helper provides a clean pattern for managing multiple repositories with shared executor.

```typescript
function createRepositoriesFactory<DB, Repos extends Record<string, any>>(
  factories: RepositoryFactoryMap<DB, Repos>
): (executor: Executor<DB>) => Repos

type RepositoryFactoryMap<DB, Repos> = {
  [K in keyof Repos]: (executor: Executor<DB>) => Repos[K]
}
```

### Example

```typescript
import { createRepositoriesFactory } from '@kysera/repository'

// Define your repository factories
const createRepos = createRepositoriesFactory({
  users: (executor) => createUserRepository(executor),
  posts: (executor) => createPostRepository(executor),
  comments: (executor) => createCommentRepository(executor)
})

// Normal usage with database instance
const repos = createRepos(db)
await repos.users.findById(1)
await repos.posts.findAll()

// Transaction usage (clean one-liner!)
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)
  const user = await repos.users.create({ name: 'Alice', email: 'alice@example.com' })
  await repos.posts.create({ userId: user.id, title: 'Hello World' })
  await repos.comments.create({ postId: post.id, text: 'Great post!' })
})
```

## createORM

Create a plugin container (repository manager) with plugin support. Despite its name, `createORM` is not a traditional ORM - it's a lightweight plugin container that manages repositories and provides unified plugin execution via `@kysera/executor`.

```typescript
async function createORM<DB>(
  db: Kysely<DB>,
  plugins?: Plugin[]
): Promise<PluginOrm<DB>>

interface PluginOrm<DB> {
  /** Plugin-aware executor from @kysera/executor */
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

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

// Create plugin container (repository manager) with plugins
const orm = await createORM(db, [
  rlsPlugin({ schema: rlsSchema }),  // Query interceptor + repository extensions
  softDeletePlugin()                  // Query interceptor + repository extensions
])

// Create repository factory function
const createUserRepository = (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'users',
    mapRow: (row) => row,
    schemas: {
      create: zodAdapter(CreateUserSchema),
    }
  })
}

// Create repository - gets both interceptors and extension methods
const userRepo = orm.createRepository(createUserRepository)

// Query interceptors applied automatically
const users = await userRepo.findAll()  // RLS + soft-delete filters applied

// Extension methods available from plugins
await userRepo.softDelete(userId)       // from softDeletePlugin
await userRepo.restore(userId)          // from softDeletePlugin
```

### CQRS-lite Pattern: Repository + DAL

Mix Repository (for writes with validation) and DAL (for complex reads) in the same transaction:

```typescript
import { createORM } from '@kysera/repository'
import { createQuery } from '@kysera/dal'

const orm = await createORM(db, [softDeletePlugin()])

// Define DAL queries for complex reads
const getUserStats = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('user_stats')
    .innerJoin('aggregates', 'aggregates.user_id', 'user_stats.user_id')
    .selectAll()
    .where('user_stats.user_id', '=', userId)
    .executeTakeFirst()
)

// Use both patterns in transaction
await orm.transaction(async (ctx) => {
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

```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { createContext } from '@kysera/dal'

// Create executor with plugins once
const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema }),
  softDeletePlugin()
])

// Option 1: Use with Repository pattern
const orm = await createORM(executor, [])  // No additional plugins needed
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
  parse(data: unknown): T                      // Parse and validate (throws on error)
  safeParse(data: unknown): ValidationResult<T> // Safe parse (returns result)
  partial?(): ValidationSchema<Partial<T>>     // Make all fields optional (for update)
}

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError }
```

### zodAdapter

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

```typescript
async function withPlugins<DB, T extends object>(
  factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T,
  executor: Kysely<DB>,
  plugins: Plugin[]
): Promise<T>
```

### Basic Example

```typescript
import { withPlugins } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

// Define your repository factory
const createUserRepo = (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'users',
    mapRow: (row) => ({
      id: row.id,
      email: row.email,
      name: row.name
    }),
    schemas: {
      create: zodAdapter(z.object({
        email: z.string().email(),
        name: z.string()
      }))
    }
  })
}

// Create repository with soft delete plugin
const userRepo = await withPlugins(
  createUserRepo,
  db,
  [softDeletePlugin({ deletedAtColumn: 'deleted_at' })]
)

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

```typescript
import { ContextAwareRepository } from '@kysera/repository'
import type { Executor } from '@kysera/core'

class UserRepository extends ContextAwareRepository<Database, 'users'> {
  async create(data: { email: string; name: string }): Promise<User> {
    return this.db
      .insertInto(this.tableName)
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  async findById(id: number): Promise<User | null> {
    return this.db
      .selectFrom(this.tableName)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst() ?? null
  }
}

// Normal usage
const userRepo = new UserRepository(db, 'users')
const user = await userRepo.findById(1)

// Transaction usage - clean executor switching!
await db.transaction().execute(async (trx) => {
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

```typescript
async function upsertMany<DB, Table, Row>(
  db: Kysely<DB>,
  table: Table,
  data: Insertable<Row>[],
  options: UpsertOptions<Insertable<Row>>
): Promise<Selectable<Row>[] | void>
```

### Upsert Examples

```typescript
import { upsert, upsertMany } from '@kysera/repository'

// Single record upsert
const wallet = await upsert(db, 'wallets', {
  name: 'Main Wallet',
  balance: 1000
}, {
  conflictColumns: ['name'],
  returning: true
})

// Upsert with specific update columns
await upsert(db, 'users', {
  email: 'alice@example.com',
  name: 'Alice Updated',
  role: 'admin'
}, {
  conflictColumns: ['email'],
  updateColumns: ['name'],  // Only update name, not role
  returning: true
})

// Batch upsert
const prices = await upsertMany(db, 'price_history', [
  { pair: 'BTC/USD', timestamp: now, price: 50000 },
  { pair: 'ETH/USD', timestamp: now, price: 3000 },
], {
  conflictColumns: ['pair', 'timestamp'],
  updateColumns: ['price'],
  returning: true
})

// Upsert in transaction
await db.transaction().execute(async (trx) => {
  await upsertMany(trx, 'inventory', items, {
    conflictColumns: ['sku'],
    updateColumns: ['quantity', 'updated_at']
  })
})
```

## TableOperations

Low-level interface for database operations. Used internally by `createBaseRepository` but can be used directly for custom repository implementations.

```typescript
function createTableOperations<DB, TableName extends keyof DB & string>(
  db: Executor<DB>,
  tableName: TableName,
  pkConfig?: PrimaryKeyConfig
): TableOperations<DB[TableName]>

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
  paginate(options: PaginateOptions): Promise<Selectable<Table>[]>
  paginateCursor(options: PaginateCursorOptions): Promise<Selectable<Table>[]>
}
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

  // Query operations
  find(options?: { where?: Record<string, unknown> }): Promise<Entity[]>
  findOne(options?: { where?: Record<string, unknown> }): Promise<Entity | null>
  count(options?: { where?: Record<string, unknown> }): Promise<number>
  exists(options?: { where?: Record<string, unknown> }): Promise<boolean>

  // Pagination
  paginate(options: PaginateOptions): Promise<PaginateResult<Entity>>
  paginateCursor<K extends keyof Entity>(options: PaginateCursorOptions<Entity, K>): Promise<PaginateCursorResult<Entity, K>>

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

```typescript
const factory = createRepositoryFactory(db)

const tenantUserRepo = factory.create({
  tableName: 'tenant_users',
  primaryKey: ['tenant_id', 'user_id'],
  mapRow: (row) => row,
  schemas: {
    create: zodAdapter(CreateTenantUserSchema),
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

## CQRS-lite Pattern

Use `orm.createContext()` and `orm.transaction()` to mix Repository (writes with validation) and DAL (complex reads) patterns:

```typescript
import { createORM } from '@kysera/repository'
import { createQuery } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])

// Define DAL queries for complex reads
const getDashboardStats = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('users')
    .innerJoin('posts', 'posts.user_id', 'users.id')
    .innerJoin('comments', 'comments.post_id', 'posts.id')
    .select([
      'users.id',
      'users.name',
      (eb) => eb.fn.count('posts.id').as('post_count'),
      (eb) => eb.fn.count('comments.id').as('comment_count')
    ])
    .where('users.id', '=', userId)
    .groupBy(['users.id', 'users.name'])
    .executeTakeFirst()
)

// Mix patterns in transaction
const result = await orm.transaction(async (ctx) => {
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

Control validation behavior via environment variables or options:

```typescript
// Environment variables (in order of precedence)
KYSERA_VALIDATION_MODE=always   // Always validate
KYSERA_VALIDATION_MODE=never    // Never validate
KYSERA_VALIDATION_MODE=development  // Validate in development
KYSERA_VALIDATION_MODE=production   // Don't validate in production
NODE_ENV=development  // Fallback: enables validation

// Repository-level control
const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: {
    create: zodAdapter(UserSchema),
  },
  validateDbResults: true,      // Validate DB results
  validationStrategy: 'strict'   // 'strict' | 'none'
})

// Validation helpers
import { getValidationMode, shouldValidate } from '@kysera/repository'

console.log(getValidationMode())  // 'development' | 'production' | 'always' | 'never'
console.log(shouldValidate())     // boolean
```

## Database Support

| Feature | PostgreSQL | MySQL | SQLite |
|---------|------------|-------|--------|
| RETURNING | Native | Emulated | Native |
| Bulk Insert | Single query | Single query | Single query |
| Boolean | true/false | 1/0 | 1/0 |
| Composite Keys | ✓ | ✓ | ✓ |
| UUID | ✓ | ✓ | ✓ |

**Notes:**
- MySQL doesn't support RETURNING clause - Kysera automatically emulates it by fetching inserted/updated records
- All databases support composite primary keys
- Boolean values are automatically normalized

See [Factory](/docs/api/repository/factory), [Validation](/docs/api/repository/validation), and [Types](/docs/api/repository/types) for more details.
