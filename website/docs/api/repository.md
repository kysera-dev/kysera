---
sidebar_position: 3
title: "@kysera/repository"
description: Repository pattern package API reference
---

# @kysera/repository

Type-safe repository pattern implementation with Zod validation.

## Installation

```bash
npm install @kysera/repository zod
```

## Overview

**Version:** 0.5.1
**Bundle Size:** ~12 KB (minified)
**Dependencies:** @kysera/core
**Peer Dependencies:** kysely >=0.28.8, zod ^4.x

## Core Exports

```typescript
// Factory functions
export { createRepositoryFactory } from './repository'
export { createRepositoriesFactory } from './repository'
export { createSimpleRepository } from './base-repository'

// ORM with plugins
export { createORM, withPlugins } from './plugin'

// Validation
export { getValidationMode, shouldValidate, createValidator, safeParse } from './validation'

// Types
export * from './types'
```

## createRepositoryFactory

Create a typed repository factory.

```typescript
function createRepositoryFactory<DB>(
  executor: Executor<DB>
): {
  executor: Executor<DB>
  create<TableName, Entity, PK>(config: RepositoryConfig<TableName, Entity, PK>): Repository<Entity, DB, PK>
}
```

### RepositoryConfig

```typescript
interface RepositoryConfig<TableName, Entity, PK = number> {
  tableName: TableName
  primaryKey?: string | string[]           // Default: 'id'
  primaryKeyType?: 'number' | 'string' | 'uuid'
  mapRow: (row: Selectable<Table>) => Entity
  schemas: {
    entity?: z.ZodType<Entity>             // Optional result validation
    create: z.ZodType                      // Required input validation
    update?: z.ZodType                     // Optional update validation
  }
  validateDbResults?: boolean              // Default: NODE_ENV === 'development'
  validationStrategy?: 'none' | 'strict'   // Default: 'strict'
}
```

### Example

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
    }),
    update: z.object({
      email: z.string().email().optional(),
      name: z.string().min(1).optional()
    })
  }
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

Create multiple repositories at once for transaction support.

```typescript
function createRepositoriesFactory<DB, Repos>(
  factories: { [K in keyof Repos]: (executor: Executor<DB>) => Repos[K] }
): (executor: Executor<DB>) => Repos
```

### Example

```typescript
const createRepos = createRepositoriesFactory({
  users: (executor) => createUserRepository(executor),
  posts: (executor) => createPostRepository(executor)
})

// Normal usage
const repos = createRepos(db)

// Transaction usage
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)
  await repos.users.create({ ... })
  await repos.posts.create({ ... })
})
```

## createORM

Create an ORM instance with plugin support.

```typescript
async function createORM<DB>(
  executor: Kysely<DB>,
  plugins?: Plugin[]
): Promise<{
  executor: Kysely<DB>
  createRepository: <T>(factory: (executor, applyPlugins) => T) => T
  applyPlugins: ApplyPluginsFunction
  plugins: Plugin[]
}>
```

### Example

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' })
])

const userRepo = orm.createRepository((executor) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({ tableName: 'users', ... })
})

// Repository has plugin methods
await userRepo.softDelete(userId)
```

## Primary Key Types

```typescript
// Single column (default)
{ primaryKey: 'id', primaryKeyType: 'number' }

// UUID
{ primaryKey: 'uuid', primaryKeyType: 'uuid' }

// Custom name
{ primaryKey: 'user_id', primaryKeyType: 'number' }

// Composite
{ primaryKey: ['tenant_id', 'user_id'] }
```

## Database Support

| Feature | PostgreSQL | MySQL | SQLite |
|---------|------------|-------|--------|
| RETURNING | Native | Emulated | Native |
| Bulk Insert | Single query | Single query | Single query |
| Boolean | true/false | 1/0 | 1/0 |

See [Factory](/docs/api/repository/factory), [Validation](/docs/api/repository/validation), and [Types](/docs/api/repository/types) for more details.
