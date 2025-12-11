---
sidebar_position: 3
title: Types
description: Type definitions for @kysera/repository
---

# Types

Type definitions for the repository package.

## Core Types

### Executor

Union type for database instance or transaction.

```typescript
type Executor<DB> = Kysely<DB> | Transaction<DB>
```

### Repository

Full repository interface with all methods.

```typescript
interface Repository<Entity, DB, PK = number> {
  readonly executor: Executor<DB>
  readonly tableName: string

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

  // Query operations
  findAll(): Promise<Entity[]>
  find(options?: QueryOptions): Promise<Entity[]>
  findOne(options?: QueryOptions): Promise<Entity | null>
  count(options?: QueryOptions): Promise<number>
  exists(options?: QueryOptions): Promise<boolean>

  // Pagination
  paginate(options: PaginateOptions): Promise<PaginatedItems<Entity>>
  paginateCursor<K extends keyof Entity>(
    options: CursorPaginateOptions<Entity, K, PK>
  ): Promise<CursorPaginatedItems<Entity, K, PK>>

  // Transactions
  transaction<R>(fn: (trx: Transaction<DB>) => Promise<R>): Promise<R>
  withTransaction(trx: Transaction<DB>): Repository<Entity, DB, PK>
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

```typescript
interface QueryOptions {
  where?: Record<string, unknown>
}

interface PaginateOptions {
  limit: number
  offset?: number
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
}

interface CursorPaginateOptions<Entity, K extends keyof Entity, PK> {
  limit: number
  cursor?: { value: Entity[K]; id: PK } | null
  orderBy?: K
  orderDirection?: 'asc' | 'desc'
}
```

## Result Types

```typescript
interface PaginatedItems<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

interface CursorPaginatedItems<T, K extends keyof T, PK> {
  items: T[]
  nextCursor: { value: T[K]; id: PK } | null
  hasMore: boolean
}
```

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

## Helper Functions

### normalizePrimaryKeyConfig

```typescript
function normalizePrimaryKeyConfig(
  primaryKey?: PrimaryKeyColumn,
  primaryKeyType?: PrimaryKeyTypeHint
): PrimaryKeyConfig
```

### isCompositeKey

```typescript
function isCompositeKey(columns: PrimaryKeyColumn): columns is string[]
```

### getPrimaryKeyColumns

```typescript
function getPrimaryKeyColumns(columns: PrimaryKeyColumn): string[]
```

### normalizePrimaryKeyInput

```typescript
function normalizePrimaryKeyInput(
  columns: PrimaryKeyColumn,
  input: PrimaryKeyInput
): CompositeKeyValue
```

### isValidRow

```typescript
function isValidRow<T>(value: unknown): value is T
```

## Plugin Types

```typescript
interface Plugin {
  name: string
  version: string
  dependencies?: string[]
  priority?: number
  conflictsWith?: string[]

  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB
  extendRepository?<T>(repo: T): T
}

interface QueryBuilderContext {
  operation: 'select' | 'insert' | 'update' | 'delete'
  table: string
  metadata: Record<string, unknown>
}
```

## Usage Examples

### Type-Safe Repository

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
    create: z.object({ email: z.string().email(), name: z.string() }),
    update: z.object({ email: z.string().email(), name: z.string() }).partial()
  }
})
```
