---
sidebar_position: 1
title: Factory
description: Repository factory API reference
---

# Repository Factory

Factory functions for creating repositories.

## createRepositoryFactory

Create a typed repository factory for a database instance.

```typescript
function createRepositoryFactory<DB>(executor: Executor<DB>): {
  executor: Executor<DB>
  create<TableName extends keyof DB & string, Entity, PK = number>(
    config: RepositoryConfig<DB[TableName], Entity> & { tableName: TableName }
  ): Repository<Entity, DB, PK>
}
```

The return type is anonymous — there is no exported `RepositoryFactory`
interface. Use `ReturnType<typeof createRepositoryFactory<DB>>` if you need to
name it.

### Usage

```typescript
import { createRepositoryFactory, zodAdapter } from '@kysera/repository'

const factory = createRepositoryFactory(db)

const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    create: zodAdapter(CreateUserSchema),
    update: zodAdapter(UpdateUserSchema)
  }
})
```

## createRepositoriesFactory

Create a factory that produces multiple repositories.

```typescript
function createRepositoriesFactory<DB, Repos extends Record<string, any>>(
  factories: RepositoryFactoryMap<DB, Repos>
): (executor: Executor<DB>) => Repos

type RepositoryFactoryMap<DB, Repos> = {
  [K in keyof Repos]: (executor: Executor<DB>) => Repos[K]
}
```

### Usage

```typescript
// Define factory
const createRepos = createRepositoriesFactory({
  users: createUserRepository,
  posts: createPostRepository,
  comments: createCommentRepository
})

// Use with database
const repos = createRepos(db)
const user = await repos.users.findById(1)

// Use in transaction
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)
  await repos.users.create({ ... })
  await repos.posts.create({ ... })
})
```

## createSimpleRepository

Create a basic repository without factory pattern. Uses `nativeAdapter` (no validation) by default.

```typescript
function createSimpleRepository<DB, TableName extends keyof DB & string, Entity, PK = number>(
  executor: Executor<DB>,
  tableName: TableName,
  mapRow: (row: Selectable<DB[TableName]>) => Entity,
  options?: {
    primaryKey?: PrimaryKeyColumn
    primaryKeyType?: PrimaryKeyTypeHint
    dialect?: DialectConfig
  }
): Repository<Entity, DB, PK>
```

### Usage

```typescript
const userRepo = createSimpleRepository(db, 'users', row => row, { primaryKey: 'id' })
```

## Repository Configuration

### RepositoryConfig

```typescript
interface RepositoryConfig<Table, Entity> {
  // Required
  tableName: string
  mapRow: (row: Selectable<Table>) => Entity
  schemas: {
    create: ValidationSchema            // Required input validation
    update?: ValidationSchema           // Optional (uses create.partial() if omitted)
    entity?: ValidationSchema<Entity>   // Optional result validation
  }

  // Optional
  schema?: string                              // PostgreSQL schema (e.g., 'auth', 'tenant_123')
  primaryKey?: PrimaryKeyColumn                // Default: 'id'
  primaryKeyType?: PrimaryKeyTypeHint          // Default: 'number'
  dialect?: DialectConfig                      // Deprecated wrapper — see note below
  validationStrategy?: 'none' | 'strict'       // Default: 'strict'
  validateDbResults?: boolean                   // Default: NODE_ENV === 'development'
  logger?: KyseraLogger                         // Warnings/diagnostics. Default: silentLogger
}
```

:::note DialectConfig is deprecated
`DialectConfig` (`{ dialect: 'postgres' | 'mysql' | 'sqlite' | 'mssql' }`) is a
legacy wrapper kept for backwards compatibility. For new code, import the
`Dialect` union from `@kysera/core` when you need the dialect type itself.
:::

:::info ValidationSchema
The `schemas` property uses the `ValidationSchema` interface, not raw Zod types. Wrap Zod schemas with `zodAdapter()`, Valibot schemas with `valibotAdapter()`, TypeBox schemas with `typeboxAdapter()`, or use `nativeAdapter()` for no validation. See the [Validation API](/docs/api/repository/validation) for details.
:::

### Row Mapping

```typescript
interface UserRow {
  id: Generated<number>
  email: string
  first_name: string
  last_name: string
  created_at: Generated<Date>
}

interface User {
  id: number
  email: string
  fullName: string
  createdAt: Date
}

const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row): User => ({
    id: row.id,
    email: row.email,
    fullName: `${row.first_name} ${row.last_name}`,
    createdAt: row.created_at
  }),
  schemas: { create: zodAdapter(CreateUserSchema) }
})
```

### Primary Key Configuration

```typescript
// Numeric ID (default)
{ primaryKey: 'id' }

// UUID
{
  primaryKey: 'uuid',
  primaryKeyType: 'uuid'
}

// Custom column name
{
  primaryKey: 'account_number',
  primaryKeyType: 'string'
}

// Composite key
{
  primaryKey: ['tenant_id', 'user_id']
}
```

### Validation Configuration

Validation is configured per repository, not via environment variables:

```typescript
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    entity: zodAdapter(UserSchema), // used only when validateDbResults is on
    create: zodAdapter(CreateUserSchema)
  },
  validationStrategy: 'strict', // input validation: 'strict' (default) | 'none'
  validateDbResults: false // output validation; default: NODE_ENV === 'development'
})
```

- `validationStrategy: 'none'` skips input validation in `create`/`update` (and bulk variants).
- `validateDbResults: true` re-validates mapped rows against `schemas.entity`.

The `KYSERA_VALIDATION_MODE` environment variable does **not** affect factory
repositories. It only drives the standalone `shouldValidate()` /
`createValidator().validateConditional()` helpers, which resolve it to a single
boolean (there is no input/output split). See the
[Validation API](/docs/api/repository/validation) for details.

## Best Practices

### 1. Define Repository Functions

```typescript
// user.repository.ts
export function createUserRepository(executor: Executor<Database>) {
  const factory = createRepositoryFactory(executor)

  return factory.create({
    tableName: 'users' as const,
    mapRow: mapUserRow,
    schemas: {
      create: zodAdapter(CreateUserSchema),
      update: zodAdapter(UpdateUserSchema)
    }
  })
}
```

### 2. Create Bundle Factory

```typescript
// repositories.ts
export const createRepositories = createRepositoriesFactory({
  users: createUserRepository,
  posts: createPostRepository,
  comments: createCommentRepository,
  profiles: createProfileRepository
})

export type Repositories = ReturnType<typeof createRepositories>
```

### 3. Use in Services

```typescript
class UserService {
  constructor(private repos = createRepositories(db)) {}

  async createUserWithProfile(data: CreateUserInput) {
    return this.repos.users.transaction(async trx => {
      const repos = createRepositories(trx)
      const user = await repos.users.create(data)
      await repos.profiles.create({ userId: user.id })
      return user
    })
  }
}
```
