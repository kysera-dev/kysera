---
sidebar_position: 3
title: Repository Pattern
description: Understanding the repository pattern in Kysera
---

# Repository Pattern


Kysera's repository pattern provides a clean abstraction over database operations with type safety and validation built-in. repositories are built on top of the **@kysera/executor** foundation layer, enabling unified plugin support.

## Creating Repositories

### Using createORM with Plugins (Recommended)

The recommended approach - `createORM` internally uses `createExecutor()` for plugin support:

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { z } from 'zod'

// Define validation schemas
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
})

const UpdateUserSchema = CreateUserSchema.partial()

// Step 1: createORM internally creates a KyseraExecutor with plugins
const orm = await createORM(db, [softDeletePlugin()])
// Equivalent to:
// const executor = await createExecutor(db, [softDeletePlugin()])
// const orm = createORM(executor, [])

// Define repository factory function
const createUserRepository = (executor, applyPlugins) => ({
  tableName: 'users',
  executor, // This is a KyseraExecutor with plugins

  async findById(id) {
    // Query interceptors automatically apply soft-delete filter
    return executor.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
  },

  async create(data) {
    const validated = CreateUserSchema.parse(data)
    return executor.insertInto('users').values(validated).returningAll().executeTakeFirstOrThrow()
  },

  async update(id, data) {
    const validated = UpdateUserSchema.parse(data)
    return executor
      .updateTable('users')
      .set(validated)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  // ... other methods
})

// Create repository with plugin support
const userRepo = orm.createRepository(createUserRepository)

// Use repository methods (query interceptors automatically applied)
const user = await userRepo.findById(1)
// -> SELECT * FROM users WHERE id = 1 AND deleted_at IS NULL

// Plugin extension methods also available
await userRepo.softDelete(1) // Extension method from plugin
await userRepo.restore(1)     // Extension method from plugin
```

### Alternative: Using Repository Factory (No Plugins)

For simpler use cases without plugins:

```typescript
import { createRepositoryFactory } from '@kysera/repository'
import { z } from 'zod'

// Create factory
const factory = createRepositoryFactory(db)

// Create repository (no plugin support)
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at
  }),
  schemas: {
    create: CreateUserSchema,
    update: UpdateUserSchema
  }
})
```

### Repository Configuration

```typescript
interface RepositoryConfig<Table, Entity> {
  tableName: string
  primaryKey?: string | string[] // Default: 'id'
  primaryKeyType?: 'number' | 'string' | 'uuid'
  mapRow: (row: Selectable<Table>) => Entity
  schemas: {
    entity?: z.ZodType<Entity> // Optional result validation
    create: z.ZodType // Required
    update?: z.ZodType // Optional
  }
  // Validation controlled via KYSERA_VALIDATION_MODE environment variable
  // or NODE_ENV fallback - see Validation guide
}
```

## Repository Methods

Every repository provides these standard methods:

### Single Record Operations

```typescript
// Find by ID
const user = await userRepo.findById(1)

// Create new record
const newUser = await userRepo.create({
  email: 'john@example.com',
  name: 'John Doe'
})

// Update record
const updated = await userRepo.update(1, { name: 'John Smith' })

// Delete record
const deleted = await userRepo.delete(1)
```

### Batch Operations

```typescript
// Find multiple by IDs
const users = await userRepo.findByIds([1, 2, 3])

// Bulk create (efficient single query)
const newUsers = await userRepo.bulkCreate([
  { email: 'user1@example.com', name: 'User 1' },
  { email: 'user2@example.com', name: 'User 2' }
])

// Bulk update
const updated = await userRepo.bulkUpdate([
  { id: 1, data: { status: 'active' } },
  { id: 2, data: { status: 'active' } }
])

// Bulk delete
const count = await userRepo.bulkDelete([1, 2, 3])
```

### Query Operations

```typescript
// Find all
const allUsers = await userRepo.findAll()

// Find with conditions
const activeUsers = await userRepo.find({
  where: { status: 'active' }
})

// Find one with conditions
const admin = await userRepo.findOne({
  where: { role: 'admin' }
})

// Count records
const count = await userRepo.count({
  where: { status: 'active' }
})

// Check existence
const exists = await userRepo.exists({
  where: { email: 'test@example.com' }
})
```

### Pagination

```typescript
// Offset-based pagination
const page = await userRepo.paginate({
  limit: 20,
  offset: 0,
  orderBy: 'created_at',
  orderDirection: 'desc'
})
// Returns: { items: User[], total: number, limit: number, offset: number }

// Cursor-based pagination (more efficient for large datasets)
const result = await userRepo.paginateCursor({
  limit: 20,
  cursor: null, // null for first page
  orderBy: 'created_at',
  orderDirection: 'desc'
})
// Returns: { items: User[], nextCursor: string | null, hasMore: boolean }
```

## Repository Bundles

### With createORM and Plugins

Create multiple repositories with shared plugins:

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create ORM with plugins
const orm = await createORM(db, [softDeletePlugin()])

// Create all repositories
const userRepo = orm.createRepository(createUserRepository)
const postRepo = orm.createRepository(createPostRepository)
const commentRepo = orm.createRepository(createCommentRepository)

// Use repositories (plugins automatically applied)
const user = await userRepo.findById(1)

// Transaction with orm.transaction() - plugins preserved
await orm.transaction(async (ctx) => {
  const user = await userRepo.create({ ... })

  // Can also use DAL queries in same transaction
  const stats = await getAnalytics(ctx, user.id)

  return { user, stats }
})
```

### Without Plugins (Factory Pattern)

For simpler use cases without plugins:

```typescript
import { createRepositoriesFactory } from '@kysera/repository'

// Define repository creators
const createRepos = createRepositoriesFactory({
  users: (executor) => createUserRepository(executor),
  posts: (executor) => createPostRepository(executor),
  comments: (executor) => createCommentRepository(executor)
})

// Normal usage
const repos = createRepos(db)
const user = await repos.users.findById(1)

// Transaction usage - same API!
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)
  const user = await repos.users.create({ ... })
  await repos.posts.create({ user_id: user.id, ... })
})
```

## Custom Primary Keys

Support for different primary key types:

```typescript
// UUID primary key
const postRepo = factory.create({
  tableName: 'posts',
  primaryKey: 'uuid',
  primaryKeyType: 'uuid'
  // ...
})

// Composite primary key
const orderItemRepo = factory.create({
  tableName: 'order_items',
  primaryKey: ['order_id', 'product_id']
  // ...
})

// Custom primary key name
const accountRepo = factory.create({
  tableName: 'accounts',
  primaryKey: 'account_number',
  primaryKeyType: 'string'
  // ...
})
```

## Row Mapping

Transform database rows to domain entities:

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
  })
  // ...
})
```

## Transaction Support

Repositories work seamlessly with transactions:

### With createORM (Recommended)

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])
const userRepo = orm.createRepository(createUserRepository)
const postRepo = orm.createRepository(createPostRepository)

// Use orm.transaction() - plugins preserved automatically
await orm.transaction(async (ctx) => {
  // All repos use the same transaction
  const user = await userRepo.create({ ... })
  await postRepo.create({ user_id: user.id, ... })

  // Can also use DAL queries in same transaction
  const stats = await getDashboardStats(ctx, user.id)

  return { user, stats }
})
```

### Without createORM (Repository Factory)

```typescript
// Method 1: Using repository bundles (RECOMMENDED)
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)
  // All repos use the same transaction
  const user = await repos.users.create({ ... })
  await repos.posts.create({ user_id: user.id, ... })
})

// Method 2: Using withTransaction for single repository
await db.transaction().execute(async (trx) => {
  const txUserRepo = userRepo.withTransaction(trx)
  const user = await txUserRepo.create({ ... })
})

// Method 3: Using transaction method (starts transaction automatically)
await userRepo.transaction(async (trx) => {
  // Create transactional repository instances
  const txUserRepo = userRepo.withTransaction(trx)
  const txPostRepo = postRepo.withTransaction(trx)

  const user = await txUserRepo.create({ ... })
  await txPostRepo.create({ user_id: user.id, ... })

  // Return value becomes the result of transaction()
  return user
})
```

## Best Practices

### 1. Keep Repositories Thin

Repositories should focus on data access only:

```typescript
// Good - data access only
const user = await userRepo.findById(userId)

// Bad - business logic in repository
const user = await userRepo.findByIdWithValidationAndNotifications(userId)
```

### 2. Define Clear Schema Boundaries

Separate schemas for different operations:

```typescript
const schemas = {
  entity: z.object({
    id: z.number(),
    email: z.string().email(),
    name: z.string(),
    created_at: z.date()
  }),
  create: z.object({
    email: z.string().email(),
    name: z.string().min(1)
  }),
  update: z.object({
    email: z.string().email().optional(),
    name: z.string().min(1).optional()
  })
}
```

### 3. Use Factory Pattern for DI

```typescript
// Service with injectable repository
class UserService {
  constructor(private repos = createRepos(db)) {}

  async createUser(data: CreateUserInput) {
    return this.repos.users.create(data)
  }
}

// Easy to test with mock
const testService = new UserService(createRepos(testDb))
```
