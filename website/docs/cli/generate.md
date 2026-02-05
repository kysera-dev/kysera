---
sidebar_position: 4
title: generate
description: Code generation commands
---

# kysera generate

Generate type-safe code from database schema.

## Commands

### model

Generate model interfaces.

```bash
kysera generate model [table]
kysera g model [table]
```

**Options:**

```
-o, --output <path>       Output directory (default: ./src/models)
--overwrite               Overwrite existing files
--timestamps              Include timestamp fields (default: true)
--soft-delete             Include soft delete fields
-c, --config <path>       Path to configuration file
-s, --schema <name>       PostgreSQL schema name (default: public)
```

**Generated:**

```typescript
// src/models/user.ts
import { Generated } from 'kysely'

export interface User {
  id: number
  email: string
  name: string
  createdAt: Date
}

export interface UserTable {
  id: Generated<number>
  email: string
  name: string
  created_at: Generated<Date>
}

export type NewUser = Omit<User, 'id' | 'createdAt'>
export type UserUpdate = Partial<NewUser>
```

### repository

Generate repository class.

```bash
kysera generate repository <table>
```

**Options:**

```
-o, --output <path>       Output directory (default: ./src/repositories)
--overwrite               Overwrite existing files
--with-validation         Include Zod validation (default: true)
--with-pagination         Include pagination methods (default: true)
-c, --config <path>       Path to configuration file
-s, --schema <name>       PostgreSQL schema name (default: public)
```

**Generated:**

```typescript
// src/repositories/user.repository.ts
import { createRepositoryFactory } from '@kysera/repository'
import { UserSchema, CreateUserSchema, UpdateUserSchema } from '../schemas/user.schema'

export function createUserRepository(executor: Executor<Database>) {
  const factory = createRepositoryFactory(executor)

  return factory.create({
    tableName: 'users' as const,
    mapRow: (row) => ({ ... }),
    schemas: {
      entity: UserSchema,
      create: CreateUserSchema,
      update: UpdateUserSchema
    }
  })
}
```

### schema

Generate Zod validation schemas.

```bash
kysera generate schema <table>
```

**Options:**

```
-o, --output <path>       Output directory (default: ./src/schemas)
--overwrite               Overwrite existing files
-c, --config <path>       Path to configuration file
-s, --schema <name>       PostgreSQL schema name (default: public)
```

**Generated:**

```typescript
// src/schemas/user.schema.ts
import { z } from 'zod'

export const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.date()
})

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100)
})

export const UpdateUserSchema = CreateUserSchema.partial()

export type User = z.infer<typeof UserSchema>
export type CreateUser = z.infer<typeof CreateUserSchema>
export type UpdateUser = z.infer<typeof UpdateUserSchema>
```

### crud

Generate complete CRUD stack.

```bash
kysera generate crud <table>
```

**Options:**

```
-o, --output-dir <path>   Base output directory (default: ./src)
--overwrite               Overwrite existing files
--with-validation         Include Zod validation (default: true)
--with-pagination         Include pagination (default: true)
--with-soft-delete        Include soft delete support
--with-timestamps         Include timestamp support (default: true)
--format                  Format with Prettier (default: true)
-c, --config <path>       Path to configuration file
-s, --schema <name>       PostgreSQL schema name (default: public)
```

**Generated Files:**

```
src/
├── models/user.ts
├── schemas/user.schema.ts
├── repositories/user.repository.ts
└── index.ts (exports)
```

## Examples

```bash
# Generate model for users table
kysera generate model User

# Generate full CRUD with soft delete
kysera generate crud Post --with-soft-delete

# Generate to custom directory
kysera generate crud Order --output-dir ./src/domain

# Regenerate existing files
kysera generate crud User --overwrite
```

## Type Mapping

| Database Type       | TypeScript Type |
| ------------------- | --------------- |
| serial, int, bigint | number          |
| varchar, text       | string          |
| boolean, bool       | boolean         |
| timestamp, datetime | Date            |
| json, jsonb         | unknown         |
| uuid                | string          |

## Best Practices

### 1. Generate After Schema Changes

```bash
kysera migrate up
kysera generate crud User --overwrite
```

### 2. Customize Generated Code

Generated code is a starting point. Customize:

- Validation rules
- Row mapping logic
- Additional methods

### 3. Use Consistent Naming

```bash
# Singular table names generate better code
kysera generate crud User     # → user.ts
kysera generate crud Post     # → post.ts
```
