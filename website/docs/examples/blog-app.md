---
sidebar_position: 2
title: Blog Application
description: Basic CRUD example with Kysera
---

# Blog Application

A foundational example demonstrating core Kysera patterns for a blog platform.

## Features

- Repository pattern with Zod validation
- Soft delete with restore capability
- Pagination (offset and cursor-based)
- Health checks integration
- Transaction management
- Error handling

## Database Schema

The blog-app uses TypeScript types for schema definition (not SQL CREATE TABLE statements):

```typescript
interface Database {
  users: {
    id: Generated<number>
    email: string
    name: string
    created_at: Generated<Date>
    deleted_at: Date | null
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    content: string
    published: boolean  // Note: boolean, not status enum
    created_at: Generated<Date>
    updated_at: Date | null
    deleted_at: Date | null
  }
  comments: {
    id: Generated<number>
    post_id: number
    user_id: number
    content: string
    created_at: Generated<Date>
    deleted_at: Date | null
  }
}
```

## Database Connection

The example uses `@kysera/infra` and `@kysera/debug` for production-ready database setup:

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { gracefulShutdown, createMetricsPool } from '@kysera/infra'
import { withDebug } from '@kysera/debug'
import type { Database } from './schema.js'

// Create base pool
const basePool = new Pool({
  connectionString: process.env['DATABASE_URL'] || 'postgresql://localhost/blog_example',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// Wrap pool with metrics (for health checks)
export const pool = createMetricsPool(basePool)

// Create Kysely instance
const baseDb = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: basePool }),
  log: process.env['NODE_ENV'] === 'development'
    ? ['query', 'error']
    : ['error']
})

// Add debug wrapper in development
export const db = withDebug(baseDb, {
  logQuery: process.env['NODE_ENV'] === 'development',
  logParams: false,
  slowQueryThreshold: 100,
  onSlowQuery: (sql, duration) => {
    console.warn(`Slow query (${duration}ms):`, sql)
  }
})
```

### Alternative: With Plugins (v0.7+)

For automatic soft-delete filtering and other plugin features:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugins
export const executor = await createExecutor(db, [softDeletePlugin()])

// Use executor instead of db in repositories
const userRepo = createUserRepository(executor)

// Queries automatically filter deleted records
const users = await userRepo.findAll()  // WHERE deleted_at IS NULL applied automatically
```

## Repository Implementation

This example demonstrates **hand-rolled repositories** with explicit Kysely queries. The example shows manual soft-delete filtering, but you can also use plugins for automatic filtering (see Alternative Pattern below):

### User Repository

```typescript
import type { Selectable } from 'kysely'
import { z } from 'zod'
import type { Executor } from '@kysera/core'
import { shouldValidate } from '@kysera/repository'
import type { Database, UsersTable } from '../db/schema.js'

// Domain types
export type User = Selectable<UsersTable>

// Validation schemas
export const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  created_at: z.date(),
  deleted_at: z.date().nullable(),
})

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
})

export const UpdateUserSchema = CreateUserSchema.partial()

// Mapper function
function mapUserRow(row: Selectable<UsersTable>): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    deleted_at: row.deleted_at
  }
}

// Repository function
export function createUserRepository(executor: Executor<Database>) {
  const validateDbResults = shouldValidate()  // Uses KYSERA_VALIDATION_MODE or NODE_ENV

  return {
    async findById(id: number): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)  // Manual soft-delete filtering
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findByEmail(email: string): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findAll(): Promise<User[]> {
      const rows = await executor
        .selectFrom('users')
        .selectAll()
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .execute()

      const users = rows.map(mapUserRow)
      return validateDbResults
        ? users.map(u => UserSchema.parse(u))
        : users
    },

    async create(input: unknown): Promise<User> {
      const validated = CreateUserSchema.parse(input)

      const row = await executor
        .insertInto('users')
        .values({
          ...validated,
          deleted_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async update(id: number, input: unknown): Promise<User> {
      const validated = UpdateUserSchema.parse(input)

      const row = await executor
        .updateTable('users')
        .set(validated)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async softDelete(id: number): Promise<void> {
      await executor
        .updateTable('users')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute()
    },

    async restore(id: number): Promise<void> {
      await executor
        .updateTable('users')
        .set({ deleted_at: null })
        .where('id', '=', id)
        .execute()
    }
  }
}
```

### Alternative Pattern: With Plugins (v0.7+)

For automatic soft-delete filtering using `@kysera/executor`:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import type { Executor } from '@kysera/core'
import { z } from 'zod'

// Create executor with soft-delete plugin
const executor = await createExecutor(db, [softDeletePlugin()])

// Repository function (no manual deleted_at filtering needed)
export function createUserRepository(executor: Executor<Database>) {
  const validateDbResults = shouldValidate()

  return {
    async findById(id: number): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        // No manual deleted_at filter needed!
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findAll(): Promise<User[]> {
      const rows = await executor
        .selectFrom('users')
        .selectAll()
        // No manual deleted_at filter needed!
        .orderBy('created_at', 'desc')
        .execute()

      const users = rows.map(mapUserRow)
      return validateDbResults
        ? users.map(u => UserSchema.parse(u))
        : users
    },

    // Soft delete and restore still implemented manually
    // (plugin only provides filtering, not extension methods)
    async softDelete(id: number): Promise<void> {
      await executor
        .updateTable('users')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute()
    },

    async restore(id: number): Promise<void> {
      await executor
        .updateTable('users')
        .set({ deleted_at: null })
        .where('id', '=', id)
        .execute()
    }
  }
}
```

**Key Benefits:**
- Automatic `deleted_at IS NULL` filtering on all SELECT queries
- No risk of forgetting the filter in new queries
- Consistent behavior across all queries
- Can still access raw db via `getRawDb(executor)` for internal queries

## CLI Usage

The blog-app is a **CLI demonstration** showing various Kysera features:

```typescript
import { db, pool } from './db/connection.js'
import { createUserRepository } from './repositories/user.repository.js'
import { paginate } from '@kysera/core'
import { checkDatabaseHealth } from '@kysera/infra'

async function main() {
  console.log('🚀 Blog App Example - Kysera')

  // Check database health
  const health = await checkDatabaseHealth(db, pool)
  console.log('Database health:', health)

  // Create repository instance
  const userRepo = createUserRepository(db)

  // Create user
  console.log('\n📝 Creating user...')
  const user = await userRepo.create({
    email: 'john@example.com',
    name: 'John Doe'
  })
  console.log('Created user:', user)

  // Find by email
  console.log('\n🔍 Finding user by email...')
  const foundUser = await userRepo.findByEmail('john@example.com')
  console.log('Found user:', foundUser)

  // Update user
  console.log('\n✏️ Updating user...')
  if (foundUser) {
    const updated = await userRepo.update(foundUser.id, {
      name: 'John Updated'
    })
    console.log('Updated user:', updated)
  }

  // Pagination
  console.log('\n📋 Listing users with pagination...')
  const query = db
    .selectFrom('users')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')

  const paginatedUsers = await paginate(query, { page: 1, limit: 10 })
  console.log('Paginated users:', paginatedUsers)

  // Soft delete and restore
  console.log('\n🗑️ Soft deleting user...')
  if (foundUser) {
    await userRepo.softDelete(foundUser.id)
    console.log('User soft deleted')

    const deletedUser = await userRepo.findById(foundUser.id)
    console.log('User after soft delete:', deletedUser) // Should be null

    console.log('\n♻️ Restoring user...')
    await userRepo.restore(foundUser.id)
    const restoredUser = await userRepo.findById(foundUser.id)
    console.log('Restored user:', restoredUser)
  }

  await db.destroy()
  console.log('\n✅ Example completed!')
}

main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
```

## Key Patterns Demonstrated

1. **Hand-rolled repositories** - Direct Kysely queries without wrapper abstractions
2. **Factory pattern** - `createUserRepository(executor)` for easy dependency injection
3. **Manual soft delete** - Explicit `deleted_at` filtering in queries
4. **Zod validation** - Type-safe input/output validation with `.parse()`
5. **Mapper functions** - Separate data mapping from database rows to domain types
6. **Environment-aware validation** - Development-only database result validation
7. **Pagination** - Built-in offset pagination with `paginate()` from `@kysera/core`
8. **Health checks** - Production-ready monitoring with `checkDatabaseHealth()` from `@kysera/infra`
9. **Debug instrumentation** - Query logging and performance tracking with `@kysera/debug`
10. **Graceful shutdown** - Proper connection cleanup with `@kysera/infra`

## Running the Example

```bash
# Install dependencies
pnpm install

# Set up PostgreSQL database
createdb blog_example
export DATABASE_URL="postgresql://localhost/blog_example"

# Build the example
pnpm build

# Run the CLI demonstration
pnpm start
```

The example will:
1. Check database health
2. Create a user
3. Find user by email
4. Update user
5. List users with pagination
6. Soft delete and restore user

## Project Structure

```
blog-app/
├── src/
│   ├── db/
│   │   ├── connection.ts    # Database connection with metrics
│   │   ├── schema.ts        # TypeScript schema definitions
│   │   ├── migrations.ts    # Migration functions
│   │   └── migrate.ts       # Migration runner
│   ├── repositories/
│   │   └── user.repository.ts  # User repository implementation
│   └── index.ts             # Main CLI runner
├── package.json
└── tsconfig.json
```

## What's Different from Traditional ORMs?

Kysera is not a traditional ORM. Unlike ORMs with entity mapping, Unit of Work, and Identity Map, Kysera provides:

- **No magic** - Explicit Kysely queries, not auto-generated methods
- **Type-safe** - Full TypeScript inference without decorators
- **Manual control** - You write the queries, Kysera provides utilities
- **Lightweight** - No runtime overhead, just type-safe helpers
- **Flexible** - Use as much or as little as you need
