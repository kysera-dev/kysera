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

The `[table]` argument is optional — omit it to pick the table interactively.

**Options:**

```
-o, --output <path>       Output directory (default: ./src/models)
--overwrite               Overwrite existing files
--timestamps              Include timestamp fields (default: true)
--no-timestamps           Exclude timestamp fields
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
kysera generate repository [table]
```

The `[table]` argument is optional — omit it to pick the table interactively.

**Options:**

```
-o, --output <path>       Output directory (default: ./src/repositories)
--overwrite               Overwrite existing files
--with-validation         Include Zod validation (default: true)
--with-pagination         Include pagination methods (default: true)
--with-soft-delete        Include soft delete support
--with-timestamps         Include timestamp support (default: true)
-c, --config <path>       Path to configuration file
-s, --schema <name>       PostgreSQL schema name (default: public)
```

**Generated:**

The generator emits a class with the standard CRUD surface (`findById`, `findAll`, `create`, `update`, `delete`, `count`, plus pagination when enabled). With `--with-soft-delete`, reads filter on `deleted_at` and `delete` becomes a soft delete:

```typescript
// src/repositories/user.repository.ts
import { Kysely } from 'kysely'
import type { User, NewUser, UserUpdate, UserTable } from '../models/user.js'
import type { Database } from '../database.js'
import { NewUserSchema, UpdateUserSchema } from '../schemas/user.schema.js'

export class UserRepository {
  constructor(private db: Kysely<Database>) {}

  async findById(id: number): Promise<User | undefined> {
    const result = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return result as User | undefined
  }

  async create(data: NewUser): Promise<User> {
    const validated = NewUserSchema.parse(data)

    const result = await this.db
      .insertInto('users')
      .values(validated as any)
      .returningAll()
      .executeTakeFirstOrThrow()

    return result as User
  }

  // findAll, update, delete, count, ...
}
```

### schema

Generate Zod validation schemas.

```bash
kysera generate schema [table]
```

The `[table]` argument is optional — omit it to pick the table interactively.

**Options:**

```
-o, --output <path>       Output directory (default: ./src/schemas)
--overwrite               Overwrite existing files
--strict                  Strict validation, no unknown keys (default: true)
--no-strict               Allow unknown keys in validation
-c, --config <path>       Path to configuration file
-s, --schema <name>       PostgreSQL schema name (default: public)
```

**Generated:**

Four schemas per table — entity, `New*` (insert), `Update*` (independently defined, not derived from the insert schema), and `*FilterSchema` — plus `validate*` and `safeParse*` helpers:

```typescript
// src/schemas/user.schema.ts
import { z } from 'zod'

export const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  created_at: z.date()
})
export type User = z.infer<typeof UserSchema>

// Schema for creating new records
export const NewUserSchema = z.object({
  email: z.string().email(),
  name: z.string()
})
export type NewUser = z.infer<typeof NewUserSchema>

// Schema for updating records
export const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().optional()
})
export type UpdateUser = z.infer<typeof UpdateUserSchema>

// Schema for filtering/querying records
export const UserFilterSchema = UserSchema.partial()
export type UserFilter = z.infer<typeof UserFilterSchema>

// Validation helpers (throwing and safe variants)
export const validateUser = (data: unknown) => UserSchema.parse(data)
export const validateNewUser = (data: unknown) => NewUserSchema.parse(data)
export const validateUpdateUser = (data: unknown) => UpdateUserSchema.parse(data)

export const safeParseUser = (data: unknown) => UserSchema.safeParse(data)
export const safeParseNewUser = (data: unknown) => NewUserSchema.safeParse(data)
export const safeParseUpdateUser = (data: unknown) => UpdateUserSchema.safeParse(data)
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
