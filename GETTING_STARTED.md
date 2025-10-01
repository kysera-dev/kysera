# Getting Started with Kysera

A quick-start guide to using Kysera - a TypeScript ORM built on top of Kysely with zero compromises on type safety and performance.

## Installation

```bash
# Install core packages
pnpm add kysely @kysera/core @kysera/repository

# Install database driver (choose one)
pnpm add pg              # PostgreSQL
pnpm add mysql2          # MySQL
pnpm add better-sqlite3  # SQLite

# Install optional plugins
pnpm add @kysera/audit @kysera/soft-delete @kysera/timestamps @kysera/migrations
```

## Quick Start

### 1. Define Your Database Schema

```typescript
import { Generated } from 'kysely'

// Define your database schema
interface Database {
  users: {
    id: Generated<number>
    email: string
    name: string
    created_at: Generated<Date>
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    content: string
    created_at: Generated<Date>
  }
}
```

### 2. Create Database Connection

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      host: 'localhost',
      database: 'myapp',
      user: 'postgres',
      password: 'postgres',
      max: 10
    })
  })
})
```

### 3. Create Repositories

```typescript
import { createRepositoryFactory } from '@kysera/repository'
import { z } from 'zod'

// Define schemas for validation
const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
})

const postSchema = z.object({
  user_id: z.number(),
  title: z.string().min(1),
  content: z.string()
})

// Create factory
const factory = createRepositoryFactory(db)

// Create repositories
const userRepo = factory.create({
  tableName: 'users' as const,
  mapRow: (row) => row,
  schemas: {
    create: userSchema,
    update: userSchema.partial()
  }
})

const postRepo = factory.create({
  tableName: 'posts' as const,
  mapRow: (row) => row,
  schemas: {
    create: postSchema,
    update: postSchema.partial()
  }
})
```

### 4. Use Repositories

```typescript
// Create a user
const user = await userRepo.create({
  email: 'john@example.com',
  name: 'John Doe'
})

// Find user by ID
const foundUser = await userRepo.findById(user.id)

// Update user
const updated = await userRepo.update(user.id, {
  name: 'John Smith'
})

// List users with pagination
const { data, hasNext } = await userRepo.findAll({
  limit: 10,
  offset: 0
})

// Delete user
await userRepo.delete(user.id)
```

## Using Transactions

```typescript
import { createRepositoriesFactory } from '@kysera/repository'

// Create factory for all repositories
const createRepositories = createRepositoriesFactory({
  users: (executor) => factory.create({ ...userConfig }),
  posts: (executor) => factory.create({ ...postConfig })
})

// Use in transaction
await db.transaction().execute(async (trx) => {
  // Create repositories with transaction executor
  const repos = createRepositories(trx)

  // All operations are atomic
  const user = await repos.users.create({
    email: 'jane@example.com',
    name: 'Jane Doe'
  })

  await repos.posts.create({
    user_id: user.id,
    title: 'First Post',
    content: 'Hello World!'
  })

  // If error occurs, both operations roll back
})
```

## Using Plugins

### Audit Plugin

```typescript
import { createORM } from '@kysera/repository'
import { auditPlugin } from '@kysera/audit'

// Create audit plugin
const audit = auditPlugin({
  auditTable: 'audit_logs',
  getUserId: () => currentUser?.id || null,
  captureOldValues: true,
  captureNewValues: true
})

// Create ORM with plugins
const orm = await createORM(db, [audit])

// Create repository with audit
const userRepo = orm.createRepository(() =>
  factory.create({
    tableName: 'users',
    mapRow: (row) => row,
    schemas: { create: userSchema, update: userSchema.partial() }
  })
)

// All CRUD operations are now audited
await userRepo.create({ email: 'test@example.com', name: 'Test' })
// Audit log created automatically ✅

// Get audit history
const history = await userRepo.getAuditHistory(userId)
```

### Soft Delete Plugin

```typescript
import { softDeletePlugin } from '@kysera/soft-delete'

const softDelete = softDeletePlugin({
  deletedAtColumn: 'deleted_at'
})

const orm = await createORM(db, [softDelete])

const userRepo = orm.createRepository(() =>
  factory.create({ tableName: 'users', ... })
)

// Soft delete (sets deleted_at timestamp)
await userRepo.softDelete(userId)

// Find only non-deleted records
const activeUsers = await userRepo.findAll()

// Find with deleted records
const allUsers = await userRepo.findAllWithDeleted()

// Restore soft-deleted record
await userRepo.restore(userId)

// Hard delete (permanent)
await userRepo.hardDelete(userId)
```

### Timestamps Plugin

```typescript
import { timestampsPlugin } from '@kysera/timestamps'

const timestamps = timestampsPlugin({
  createdAtColumn: 'created_at',
  updatedAtColumn: 'updated_at'
})

const orm = await createORM(db, [timestamps])

const postRepo = orm.createRepository(() =>
  factory.create({ tableName: 'posts', ... })
)

// created_at and updated_at are set automatically
const post = await postRepo.create({
  title: 'My Post',
  content: 'Content'
})

// updated_at is updated automatically
await postRepo.update(post.id, { title: 'Updated Title' })

// Manual timestamp update
await postRepo.touch(post.id)
```

## Database Migrations

```typescript
import { createMigrationRunner, createMigration } from '@kysera/migrations'
import { sql } from 'kysely'

// Define migrations
const migrations = [
  createMigration(
    '001_create_users',
    async (db) => {
      await db.schema
        .createTable('users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('email', 'varchar(255)', col => col.notNull().unique())
        .addColumn('name', 'varchar(100)', col => col.notNull())
        .addColumn('created_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .execute()
    },
    async (db) => {
      await db.schema.dropTable('users').execute()
    }
  ),

  createMigration(
    '002_create_posts',
    async (db) => {
      await db.schema
        .createTable('posts')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('user_id', 'integer', col =>
          col.notNull().references('users.id').onDelete('cascade')
        )
        .addColumn('title', 'varchar(255)', col => col.notNull())
        .addColumn('content', 'text', col => col.notNull())
        .addColumn('created_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .execute()
    },
    async (db) => {
      await db.schema.dropTable('posts').execute()
    }
  )
]

// Create migration runner
const runner = createMigrationRunner(db, migrations)

// Run all pending migrations
await runner.up()

// Check migration status
await runner.status()

// Rollback last migration
await runner.down(1)

// Rollback all migrations
await runner.reset()

// Dry run (preview without executing)
await runner.up({ dryRun: true })
```

## Health Checks

```typescript
import { checkDatabaseHealth, createMetricsPool } from '@kysera/core'
import { Pool } from 'pg'

const pool = new Pool({ /* config */ })
const metricsPool = createMetricsPool(pool)

// Check database health
const health = await checkDatabaseHealth(db, metricsPool)

console.log(health)
// {
//   status: 'healthy',
//   checks: {
//     database: {
//       connected: true,
//       latency: 12
//     },
//     pool: {
//       size: 10,
//       active: 2,
//       idle: 8,
//       waiting: 0
//     }
//   },
//   timestamp: Date
// }
```

## Testing Utilities

```typescript
import { testInTransaction, createFactory } from '@kysera/core'

describe('User Repository', () => {
  it('should create user in transaction', async () => {
    await testInTransaction(db, async (trx) => {
      const repos = createRepositories(trx)

      const user = await repos.users.create({
        email: 'test@example.com',
        name: 'Test User'
      })

      expect(user.id).toBeDefined()
      expect(user.email).toBe('test@example.com')

      // Transaction rolls back automatically after test ✅
    })
  })

  it('should use test factories', async () => {
    const createUser = createFactory({
      email: (i) => `user${i}@example.com`,
      name: (i) => `User ${i}`
    })

    const users = [
      createUser(1), // { email: 'user1@example.com', name: 'User 1' }
      createUser(2), // { email: 'user2@example.com', name: 'User 2' }
      createUser(3)  // { email: 'user3@example.com', name: 'User 3' }
    ]

    await userRepo.bulkCreate(users)
  })
})
```

## Error Handling

```typescript
import {
  DatabaseError,
  UniqueConstraintError,
  ValidationError
} from '@kysera/core'

try {
  await userRepo.create({
    email: 'duplicate@example.com',
    name: 'User'
  })
} catch (error) {
  if (error instanceof UniqueConstraintError) {
    console.error('Email already exists:', error.constraint)
    console.error('Value:', error.value)
  } else if (error instanceof ValidationError) {
    console.error('Invalid input:', error.errors)
  } else if (error instanceof DatabaseError) {
    console.error('Database error:', error.code, error.detail)
  } else {
    throw error
  }
}
```

## Pagination

```typescript
// Offset-based pagination
const page1 = await userRepo.findAll({ limit: 10, offset: 0 })
const page2 = await userRepo.findAll({ limit: 10, offset: 10 })

// Cursor-based pagination (more efficient)
import { cursorPaginate } from '@kysera/core'

const firstPage = await cursorPaginate(
  db.selectFrom('users').selectAll(),
  {
    orderBy: [{ column: 'created_at', direction: 'desc' }],
    limit: 10
  }
)

// Get next page using cursor
const secondPage = await cursorPaginate(
  db.selectFrom('users').selectAll(),
  {
    orderBy: [{ column: 'created_at', direction: 'desc' }],
    limit: 10,
    cursor: firstPage.nextCursor
  }
)
```

## Best Practices

### 1. Always Use Transactions for Related Operations

```typescript
// ✅ GOOD: Atomic operations
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx)
  const user = await repos.users.create({ ... })
  await repos.posts.create({ user_id: user.id, ... })
})

// ❌ BAD: Non-atomic operations
const user = await userRepo.create({ ... })
await postRepo.create({ user_id: user.id, ... })
// If second operation fails, first one is committed ❌
```

### 2. Use Validation Schemas

```typescript
// ✅ GOOD: Runtime validation with Zod
const schema = z.object({
  email: z.string().email(),
  age: z.number().min(18)
})

// ❌ BAD: No validation
const schema = z.unknown()
```

### 3. Handle Errors Gracefully

```typescript
// ✅ GOOD: Specific error handling
catch (error) {
  if (error instanceof UniqueConstraintError) {
    return { error: 'Email already exists' }
  }
  throw error
}

// ❌ BAD: Generic error handling
catch (error) {
  console.log(error)
}
```

### 4. Use Type-Safe Queries

```typescript
// ✅ GOOD: Type-safe
const users = await db
  .selectFrom('users')
  .selectAll()
  .where('email', '=', 'test@example.com')
  .execute()

// ❌ BAD: Raw SQL
const users = await db.raw('SELECT * FROM users WHERE email = ?', ['test@example.com'])
```

## Next Steps

- Read the [full specification](./specs/spec.md)
- Check out the [example blog application](./examples/blog-app)
- Review the [plugin authoring guide](./PLUGIN_AUTHORING_GUIDE.md)
- Explore individual package READMEs for detailed API documentation

## Support

- 📚 Documentation: [specs/spec.md](./specs/spec.md)
- 🐛 Issues: [GitHub Issues](https://github.com/omnitron/kysera/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/omnitron/kysera/discussions)

## License

MIT
