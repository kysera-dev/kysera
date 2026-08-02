---
sidebar_position: 3
title: Types
description: Type definitions for @kysera/repository
---

# Types

Type definitions for the repository package.

## Core Types

### Executor

Alias of `AnyExecutor` from `@kysera/core`: a raw Kysely instance, a
transaction, or a plugin-aware `KyseraExecutor` (a `Kysely` proxy carrying the
executor marker from `@kysera/executor`).

```typescript
type Executor<DB> = AnyExecutor<DB>
// = Kysely<DB> | Transaction<DB> | (Kysely<DB> & KyseraExecutorMarker<DB>)
```

### Repository

Full repository interface with all methods.

```typescript
interface Repository<Entity, DB, PK = number> extends BaseRepository<DB, Entity, PK> {
  readonly executor: Executor<DB>
  readonly tableName: string
  withTransaction(trx: Transaction<DB>): Repository<Entity, DB, PK>
}

interface BaseRepository<DB, Entity, PK = number> {
  // Single operations
  findById(id: PK): Promise<Entity | null>
  create(input: unknown): Promise<Entity>
  update(id: PK, input: unknown): Promise<Entity>
  delete(id: PK): Promise<boolean>

  // Batch operations
  findByIds(ids: PK[]): Promise<Entity[]>
  bulkCreate(inputs: unknown[]): Promise<Entity[]>
  bulkUpdate(updates: Array<{ id: PK; data: unknown }>): Promise<Entity[]>
  bulkDelete(ids: PK[]): Promise<number>

  // Query operations (with operator support)
  findAll(): Promise<Entity[]>
  find<Cols extends keyof Entity = keyof Entity>(
    options?: FindOptions<Entity, Cols>
  ): Promise<Pick<Entity, Cols>[] | Entity[]>
  findOne<Cols extends keyof Entity = keyof Entity>(
    options?: FindOptions<Entity, Cols>
  ): Promise<Pick<Entity, Cols> | Entity | null>
  count(options?: { where?: WhereClause<Entity> | Record<string, unknown> }): Promise<number>
  exists(options?: { where?: WhereClause<Entity> | Record<string, unknown> }): Promise<boolean>
  findAndCount<Cols extends keyof Entity = keyof Entity>(
    options?: FindOptions<Entity, Cols>
  ): Promise<{ items: Pick<Entity, Cols>[] | Entity[]; total: number }>

  // Pagination (option/result shapes are inline — they are not exported types)
  paginate(options: {
    limit: number
    offset?: number
    orderBy?: string // Default: first primary-key column
    orderDirection?: 'asc' | 'desc'
  }): Promise<{ items: Entity[]; total: number; limit: number; offset: number }>
  paginateCursor<K extends keyof Entity>(options: {
    limit: number
    cursor?: { value: Entity[K]; id: PK } | null
    orderBy?: K // Default: first primary-key column
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

## Primary Key Types

```typescript
// Single value
type PrimaryKeyValue = string | number

// Column configuration
type PrimaryKeyColumn = string | string[]

// Type hint
type PrimaryKeyTypeHint = 'number' | 'string' | 'uuid'

// Input type
type PrimaryKeyInput = PrimaryKeyValue | CompositeKeyValue

// Composite key
type CompositeKeyValue = Record<string, PrimaryKeyValue>

// Full configuration
interface PrimaryKeyConfig {
  columns: PrimaryKeyColumn
  type: PrimaryKeyTypeHint
}
```

## Query Options

Filtering, sorting, and column selection use the exported `FindOptions` type
(and its companions `SortSpec`, `WhereClause`, and `FindResult`) — see
[Query Operators](/docs/api/repository/operators#findoptions-interface) for the
full operator reference:

```typescript
interface FindOptions<Entity, Columns extends keyof Entity = keyof Entity> {
  where?: WhereClause<Entity> | Record<string, unknown>
  orderBy?: keyof Entity | string
  orderDirection?: 'asc' | 'desc'
  sort?: SortSpec<Entity>[]
  select?: Columns[]
  limit?: number
  offset?: number
}

interface SortSpec<Entity> {
  column: keyof Entity
  direction: 'asc' | 'desc'
}

// Result of find(): Pick<Entity, Columns>[] when select is used, Entity[] otherwise
type FindResult<Entity, Columns extends keyof Entity> = [Columns] extends [keyof Entity]
  ? Pick<Entity, Columns>[]
  : Entity[]
```

:::note Pagination shapes are not exported
There is no `QueryOptions` type, and names like `PaginateOptions` or
`PaginatedItems` are not importable from `@kysera/repository`. The
`paginate()` / `paginateCursor()` option and result shapes are declared inline
in the `BaseRepository` method signatures shown above.
:::

## Type Utilities

### Unwrap Generated

Remove `Generated<>` wrapper from types.

```typescript
type Unwrap<T> = T extends Generated<infer U> ? U : T
```

### Domain Type

Convert table type to domain type.

```typescript
type DomainType<Table> = {
  [K in keyof Table]: Unwrap<Table[K]>
}
```

### Entity Type

Alias for Kysely's Selectable.

```typescript
type EntityType<Table> = Selectable<Table>
```

### Input Types

```typescript
// Create input (omit generated fields)
type CreateInput<Table> = {
  [K in keyof Table as Table[K] extends Generated<unknown> ? never : K]: Table[K]
}

// Update input (partial create)
type UpdateInput<Table> = Partial<CreateInput<Table>>
```

### Table Utilities

```typescript
// Type-safe table name
type TableName<DB> = keyof DB & string

// Extract table from database
type ExtractTable<DB, TN extends keyof DB> = DB[TN]

// Selectable row type
type SelectableRow<DB, TN extends keyof DB> = Selectable<ExtractTable<DB, TN>>

// Insertable row type
type InsertableRow<DB, TN extends keyof DB> = Insertable<ExtractTable<DB, TN>>

// Updateable row type
type UpdateableRow<DB, TN extends keyof DB> = Updateable<ExtractTable<DB, TN>>

// WHERE conditions
type WhereConditions<DB, TN extends keyof DB> = Partial<SelectableRow<DB, TN>>
```

### Transaction Handler

```typescript
type TransactionHandler<DB, R> = (trx: Transaction<DB>) => Promise<R>
```

### Repository Bundle Helper

Extracts the repository bundle type from a `createRepositoriesFactory` result:

```typescript
type RepositoriesFromFactory<T extends (...args: never[]) => unknown> = ReturnType<T>

// type Repositories = RepositoriesFromFactory<typeof createRepositories>
```

## Helper Functions

### normalizePrimaryKeyConfig

{/* doc-snippet: skip */}
```typescript
function normalizePrimaryKeyConfig(
  primaryKey?: PrimaryKeyColumn,
  primaryKeyType?: PrimaryKeyTypeHint
): PrimaryKeyConfig
```

### isCompositeKey

{/* doc-snippet: skip */}
```typescript
function isCompositeKey(columns: PrimaryKeyColumn): columns is string[]
```

### getPrimaryKeyColumns

{/* doc-snippet: skip */}
```typescript
function getPrimaryKeyColumns(columns: PrimaryKeyColumn): string[]
```

### normalizePrimaryKeyInput

{/* doc-snippet: skip */}
```typescript
function normalizePrimaryKeyInput(
  columns: PrimaryKeyColumn,
  input: PrimaryKeyInput
): CompositeKeyValue
```

### isValidRow

{/* doc-snippet: skip */}
```typescript
function isValidRow<T>(value: unknown): value is T
```

## Plugin Types

```typescript
interface Plugin {
  readonly name: string
  readonly version: string
  readonly dependencies?: readonly string[]
  readonly priority?: number
  readonly conflictsWith?: readonly string[]

  onInit?<DB>(db: Kysely<DB>): Promise<void> | void
  onDestroy?(): Promise<void> | void
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB
  extendRepository?<T extends object>(repo: T): T
}

interface QueryBuilderContext {
  readonly operation: 'select' | 'insert' | 'update' | 'delete' | 'replace' | 'merge'
  /** Base table name without schema qualifier or alias ('public.users as u' -> 'users') */
  readonly table: string
  /** Table alias when aliased ('users as u' -> 'u'). Plugins adding column conditions must qualify with alias ?? table */
  readonly alias?: string
  /** Original table expression as passed to the query method (e.g. 'public.users as u'); equals table for plain references */
  readonly tableExpression?: string
  /** Schema from withSchema(...) or an explicit qualifier in the table expression */
  readonly schema?: string
  readonly metadata: Record<string, unknown>
}
```

## Usage Examples

### Type-Safe Repository

{/* doc-snippet: skip */}
```typescript
interface UsersTable {
  id: Generated<number>
  email: string
  name: string
  created_at: Generated<Date>
}

interface Database {
  users: UsersTable
}

type User = Selectable<UsersTable>
type CreateUser = CreateInput<UsersTable>
type UpdateUser = UpdateInput<UsersTable>

const userRepo: Repository<User, Database, number> = factory.create({
  tableName: 'users',
  mapRow: (row): User => row,
  schemas: {
    create: zodAdapter(z.object({ email: z.string().email(), name: z.string() })),
    update: zodAdapter(z.object({ email: z.string().email(), name: z.string() }).partial())
  }
})
```
