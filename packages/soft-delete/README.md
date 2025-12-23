# @kysera/soft-delete

Soft delete plugin for Kysera. Implements soft delete functionality through @kysera/executor's Unified Execution Layer with automatic filtering of deleted records.

## Features

- Automatic filtering of soft-deleted records in SELECT queries via @kysera/executor's plugin interception
- Repository methods for soft delete operations (softDelete, restore, hardDelete)
- Bulk operations (softDeleteMany, restoreMany, hardDeleteMany) with optimized single-query fetching
- Query methods for deleted records (findWithDeleted, findAllWithDeleted, findDeleted)
- Works with both Repository and DAL patterns through @kysera/executor's Unified Execution Layer
- Full transaction support with ACID compliance
- Configurable deleted column name, primary key, and table filtering
- Cross-runtime compatible (Node.js, Bun, Deno)
- Zero runtime dependencies

## Installation

```bash
npm install @kysera/soft-delete
# or
pnpm add @kysera/soft-delete
# or
yarn add @kysera/soft-delete
# or
bun add @kysera/soft-delete
```

### Peer Dependencies

```json
{
  "@kysera/executor": ">=0.7.0",
  "kysely": ">=0.28.8",
  "zod": ">=4.1.13"
}
```

Note: `zod` is optional (used for configuration schema validation in `kysera-cli`)

### Optional Zod Schema Validation

If you need to validate configuration options (e.g., in a CLI tool or config file), you can import the Zod schema separately:

```typescript
import { SoftDeleteOptionsSchema } from '@kysera/soft-delete/schema'

const result = SoftDeleteOptionsSchema.safeParse({
  deletedAtColumn: 'deleted_at',
  includeDeleted: false,
  tables: ['users', 'posts']
})

if (result.success) {
  console.log('Valid configuration:', result.data)
} else {
  console.error('Invalid configuration:', result.error)
}
```

**Important**: The main package (`@kysera/soft-delete`) works without Zod installed. Only import `/schema` if you need validation functionality.

## Quick Start

### With Repository Pattern

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { createExecutor } from '@kysera/executor'

// Step 1: Create executor with soft-delete plugin
const executor = await createExecutor(db, [
  softDeletePlugin({
    deletedAtColumn: 'deleted_at',
    includeDeleted: false,
    tables: ['users', 'posts'] // Only these tables support soft delete
  })
])

// Step 2: Create ORM with plugin-enabled executor
const orm = await createORM(executor, [])

// Step 3: Create repository
const userRepo = orm.createRepository(createUserRepository)

// Soft delete a user (sets deleted_at timestamp)
await userRepo.softDelete(1)

// Find all users (excludes soft-deleted automatically)
const users = await userRepo.findAll()

// Find including deleted records
const allUsers = await userRepo.findAllWithDeleted()

// Restore a soft-deleted user
await userRepo.restore(1)

// Permanently delete (real DELETE)
await userRepo.hardDelete(1)

// Batch operations (optimized single-query fetching)
await userRepo.softDeleteMany([1, 2, 3])
await userRepo.restoreMany([1, 2, 3])
await userRepo.hardDeleteMany([1, 2, 3])
```

### With DAL Pattern

```typescript
import { createExecutor } from '@kysera/executor'
import { createContext, createQuery, withTransaction } from '@kysera/dal'
import { softDeletePlugin } from '@kysera/soft-delete'
import { sql } from 'kysely'

// Step 1: Create executor with soft-delete plugin (Unified Execution Layer)
const executor = await createExecutor(db, [
  softDeletePlugin({
    deletedAtColumn: 'deleted_at',
    includeDeleted: false
  })
])

// Step 2: Create context - plugins automatically apply to all queries
const ctx = createContext(executor)

// Step 3: Define queries - soft-delete filter applied automatically
const getUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
)

// Execute queries - deleted records automatically filtered
const users = await getUsers(ctx) // Excludes soft-deleted
const user = await getUserById(ctx, 1)

// Soft delete within transaction
await withTransaction(executor, async txCtx => {
  await txCtx.db
    .updateTable('users')
    .set({ deleted_at: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', 1)
    .execute()

  // Subsequent queries in same transaction see the deletion
  const users = await getUsers(txCtx) // User 1 excluded
})
```

## Plugin Architecture

The soft-delete plugin leverages `@kysera/executor`'s Unified Execution Layer for seamless plugin support across both Repository and DAL patterns.

### How It Works

```typescript
import { createExecutor, getRawDb } from '@kysera/executor'
import type { Plugin, QueryBuilderContext } from '@kysera/executor'

// Step 1: Register plugin with createExecutor() - Unified Execution Layer
const executor = await createExecutor(db, [
  softDeletePlugin({
    deletedAtColumn: 'deleted_at',
    includeDeleted: false
  })
])

// Step 2: Plugin interceptQuery hook adds WHERE clause automatically
const users = await executor.selectFrom('users').selectAll().execute()
// SQL: SELECT * FROM users WHERE users.deleted_at IS NULL

// Step 3: Works with both Repository and DAL patterns
const orm = await createORM(executor, [])
const ctx = createContext(executor)
```

### Plugin Interface

The plugin implements the `Plugin` interface from `@kysera/executor`:

```typescript
interface Plugin {
  name: string
  version: string
  interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB
  extendRepository<T extends object>(repo: T): T
}
```

#### interceptQuery

Modifies SELECT query builders to automatically filter out soft-deleted records:

```typescript
interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
  // Check if table supports soft delete
  const supportsSoftDelete = !tables || tables.includes(context.table);

  // Only filter SELECT queries when not explicitly including deleted
  if (
    supportsSoftDelete &&
    context.operation === 'select' &&
    !context.metadata['includeDeleted'] &&
    !includeDeleted
  ) {
    // Add WHERE deleted_at IS NULL to the query builder
    return qb.where(`${context.table}.${deletedAtColumn}`, 'is', null);
  }

  return qb;
}
```

#### extendRepository

Adds soft delete methods to repositories (Repository pattern only):

```typescript
extendRepository<T extends object>(repo: T): T {
  // Adds: softDelete, restore, hardDelete, findWithDeleted,
  // findAllWithDeleted, findDeleted, softDeleteMany, restoreMany, hardDeleteMany
}
```

### Using getRawDb

The plugin uses `getRawDb()` from `@kysera/executor` to bypass interceptors when needed:

```typescript
import { getRawDb } from '@kysera/executor'

// Inside plugin's extendRepository method
const rawDb = getRawDb(repo.executor)

// Use rawDb to bypass soft-delete filter
// (needed for findWithDeleted, restore, etc.)
const allRecords = await rawDb.selectFrom('users').selectAll().execute() // No soft-delete filter applied
```

This is critical for methods like `findWithDeleted()` and `restore()` that need to access soft-deleted records.

## Configuration Options

### SoftDeleteOptions

```typescript
interface SoftDeleteOptions {
  /**
   * Column name for soft delete timestamp.
   * @default 'deleted_at'
   */
  deletedAtColumn?: string

  /**
   * Include deleted records by default in queries.
   * When false, soft-deleted records are automatically filtered out.
   * @default false
   */
  includeDeleted?: boolean

  /**
   * List of tables that support soft delete.
   * If not provided, all tables are assumed to support it.
   * @example ['users', 'posts', 'comments']
   */
  tables?: string[]

  /**
   * Primary key column name used for identifying records.
   * @default 'id'
   * @example 'uuid', 'user_id', 'post_id'
   */
  primaryKeyColumn?: string

  /**
   * Logger for plugin operations.
   * Uses KyseraLogger interface from @kysera/core.
   * @default silentLogger (no output)
   */
  logger?: KyseraLogger
}
```

### Example Configurations

```typescript
// Default configuration
softDeletePlugin()

// Custom deleted column
softDeletePlugin({
  deletedAtColumn: 'removed_at'
})

// Only specific tables
softDeletePlugin({
  tables: ['users', 'posts'], // Only these tables support soft delete
  deletedAtColumn: 'deleted_at'
})

// Include deleted by default
softDeletePlugin({
  includeDeleted: true // Don't filter deleted records
})

// Custom primary key
softDeletePlugin({
  primaryKeyColumn: 'uuid' // For tables using 'uuid' instead of 'id'
})

// With logging
import { consoleLogger } from '@kysera/core'

softDeletePlugin({
  logger: consoleLogger
})
```

## Repository Methods

The plugin extends repositories with the following methods:

### SoftDeleteMethods Interface

```typescript
interface SoftDeleteMethods<T> {
  softDelete(id: number | string): Promise<T>
  restore(id: number | string): Promise<T>
  hardDelete(id: number | string): Promise<void>
  findWithDeleted(id: number | string): Promise<T | null>
  findAllWithDeleted(): Promise<T[]>
  findDeleted(): Promise<T[]>
  softDeleteMany(ids: (number | string)[]): Promise<T[]>
  restoreMany(ids: (number | string)[]): Promise<T[]>
  hardDeleteMany(ids: (number | string)[]): Promise<void>
}
```

### Method Documentation

#### softDelete(id)

Marks a record as deleted by setting the `deleted_at` timestamp to `CURRENT_TIMESTAMP`.

```typescript
// Soft delete user with id 1
const deletedUser = await userRepo.softDelete(1)
console.log(deletedUser.deleted_at) // '2025-12-11T10:30:00Z'

// Record still exists in database but won't appear in findAll()
const users = await userRepo.findAll() // Excludes deleted user
```

**Returns**: `Promise<T>` - The soft-deleted record
**Throws**: `NotFoundError` if record doesn't exist

#### restore(id)

Restores a soft-deleted record by setting `deleted_at` to `null`.

```typescript
// Restore soft-deleted user
const restoredUser = await userRepo.restore(1)
console.log(restoredUser.deleted_at) // null

// Record now appears in queries again
const users = await userRepo.findAll() // Includes restored user
```

**Returns**: `Promise<T>` - The restored record
**Throws**: `NotFoundError` if record doesn't exist

#### hardDelete(id)

Permanently deletes a record using real SQL DELETE. Cannot be restored.

```typescript
// Permanently delete user
await userRepo.hardDelete(1)

// Record is gone forever
const user = await userRepo.findWithDeleted(1) // null
```

**Returns**: `Promise<void>`

#### findWithDeleted(id)

Finds a record by ID including soft-deleted records.

```typescript
// Find user even if soft-deleted
const user = await userRepo.findWithDeleted(1)
if (user?.deleted_at) {
  console.log('User was soft-deleted')
}
```

**Returns**: `Promise<T | null>`

#### findAllWithDeleted()

Returns all records including soft-deleted ones.

```typescript
// Get all users including deleted
const allUsers = await userRepo.findAllWithDeleted()
const deletedCount = allUsers.filter(u => u.deleted_at !== null).length
console.log(`${deletedCount} deleted users`)
```

**Returns**: `Promise<T[]>`

#### findDeleted()

Returns only soft-deleted records.

```typescript
// Get only deleted users
const deletedUsers = await userRepo.findDeleted()
console.log(`Found ${deletedUsers.length} deleted users`)
```

**Returns**: `Promise<T[]>`

#### softDeleteMany(ids)

Soft deletes multiple records in a single operation (bulk operation).

```typescript
// Soft delete multiple users at once
const deletedUsers = await userRepo.softDeleteMany([1, 2, 3])
console.log(`Soft deleted ${deletedUsers.length} users`)
```

**Returns**: `Promise<T[]>` - Array of deleted records
**Throws**: `NotFoundError` if any record doesn't exist

#### restoreMany(ids)

Restores multiple soft-deleted records in a single operation.

```typescript
// Restore multiple users at once
const restoredUsers = await userRepo.restoreMany([1, 2, 3])
console.log(`Restored ${restoredUsers.length} users`)
```

**Returns**: `Promise<T[]>` - Array of restored records

#### hardDeleteMany(ids)

Permanently deletes multiple records in a single operation.

```typescript
// Permanently delete multiple users
await userRepo.hardDeleteMany([1, 2, 3])
```

**Returns**: `Promise<void>`

## DAL Integration

The soft-delete plugin works seamlessly with the DAL pattern through the executor layer.

### Automatic Filtering in DAL Queries

```typescript
import { createExecutor } from '@kysera/executor'
import { createContext, createQuery } from '@kysera/dal'

const executor = await createExecutor(db, [softDeletePlugin()])

// Define queries - filter applied automatically
const getAllUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
)

// Execute queries
const ctx = createContext(executor)
const users = await getAllUsers(ctx) // Excludes deleted
const user = await getUserById(ctx, 1)
```

### Query Interception

The plugin's `interceptQuery` method modifies SELECT query builders:

```typescript
// Original query
ctx.db.selectFrom('users').selectAll()

// After plugin interception
ctx.db.selectFrom('users').selectAll().where('users.deleted_at', 'is', null) // Added automatically
```

### Operations Not Intercepted

The plugin uses Method Override pattern, not full query interception:

- **SELECT queries**: Automatically filtered
- **INSERT queries**: Not affected
- **UPDATE queries**: Not affected
- **DELETE queries**: NOT converted to soft deletes

To perform soft deletes, use the `softDelete()` method explicitly:

```typescript
import { sql } from 'kysely'

// ❌ This performs a real DELETE (not soft delete)
await ctx.db.deleteFrom('users').where('id', '=', 1).execute()

// ✅ Use softDelete method instead (in Repository pattern)
await userRepo.softDelete(1)

// ✅ Or manual UPDATE in DAL pattern
await ctx.db
  .updateTable('users')
  .set({ deleted_at: sql`CURRENT_TIMESTAMP` })
  .where('id', '=', 1)
  .execute()
```

### DAL Transaction Support

```typescript
import { withTransaction } from '@kysera/dal'
import { sql } from 'kysely'

await withTransaction(executor, async txCtx => {
  // Soft delete user
  await txCtx.db
    .updateTable('users')
    .set({ deleted_at: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', 1)
    .execute()

  // Query in same transaction sees deletion
  const users = await txCtx.db.selectFrom('users').selectAll().execute() // User 1 excluded

  // If transaction rolls back, soft delete is also rolled back
})
```

## Transaction Behavior

The soft-delete plugin respects ACID properties and works correctly with transactions.

### ACID Compliance

```typescript
import { withTransaction } from '@kysera/dal'

// ✅ CORRECT: Soft delete commits with transaction
await withTransaction(executor, async txCtx => {
  const repos = createRepositories(txCtx) // Use transaction executor
  await repos.users.softDelete(1)
  await repos.posts.softDeleteMany([1, 2, 3])
  // If transaction commits, both operations commit
  // If transaction rolls back, both operations roll back
})
```

### Rollback Behavior

```typescript
try {
  await withTransaction(executor, async txCtx => {
    const repos = createRepositories(txCtx)

    // Soft delete user
    await repos.users.softDelete(1)

    // Force rollback
    throw new Error('Force rollback')
  })
} catch (error) {
  // Transaction rolled back
}

// Verify soft-delete was rolled back
const user = await userRepo.findById(1)
console.log(user?.deleted_at) // null (not deleted)
```

### Cascade Soft Delete Pattern

The plugin does not automatically cascade soft deletes. You must implement cascade patterns manually:

```typescript
// Manual cascade soft delete
await db.transaction().execute(async trx => {
  const repos = createRepositories(trx)
  const userId = 123

  // Step 1: Find related records
  const userPosts = await repos.posts.findBy({ user_id: userId })
  const postIds = userPosts.map(p => p.id)

  // Step 2: Soft delete children first
  if (postIds.length > 0) {
    const postComments = await repos.comments.findBy({
      post_id: { in: postIds }
    })
    const commentIds = postComments.map(c => c.id)

    if (commentIds.length > 0) {
      await repos.comments.softDeleteMany(commentIds)
    }

    await repos.posts.softDeleteMany(postIds)
  }

  // Step 3: Soft delete parent
  await repos.users.softDelete(userId)
})
```

### Transaction Isolation

Soft-delete operations within a transaction are immediately visible to subsequent queries in the same transaction:

```typescript
await withTransaction(executor, async txCtx => {
  const repos = createRepositories(txCtx)

  // Before soft delete
  const usersBefore = await repos.users.findAll()
  console.log(usersBefore.length) // 10

  // Soft delete user
  await repos.users.softDelete(1)

  // Immediately visible in same transaction
  const usersAfter = await repos.users.findAll()
  console.log(usersAfter.length) // 9
})
```

## Database Schema Requirements

Your database tables need a `deleted_at` column (or custom column name) to support soft delete:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL -- Required for soft delete
);

CREATE INDEX idx_users_deleted_at ON users(deleted_at);
```

### Custom Column Name

```sql
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  removed_at TIMESTAMP NULL -- Custom name
);
```

```typescript
// Configure plugin to use custom column
softDeletePlugin({
  deletedAtColumn: 'removed_at',
  tables: ['posts']
})
```

### Custom Primary Key

```sql
CREATE TABLE comments (
  comment_id INTEGER PRIMARY KEY, -- Custom primary key
  content TEXT NOT NULL,
  deleted_at TIMESTAMP NULL
);
```

```typescript
// Configure plugin to use custom primary key
softDeletePlugin({
  primaryKeyColumn: 'comment_id',
  tables: ['comments']
})
```

## Type Safety

The plugin maintains full type safety with TypeScript. The `SoftDeleteRepository` type uses `Record<string, never>` for the database type parameter by default:

```typescript
import type { SoftDeleteRepository } from '@kysera/soft-delete'

// Extend repository type with soft delete methods
// Default: SoftDeleteRepository<User, Record<string, never>>
type UserRepository = SoftDeleteRepository<User>

const userRepo: UserRepository = orm.createRepository(executor => {
  const base = createRepositoryFactory(executor)
  return base.create({
    tableName: 'users',
    mapRow: row => row as User
  })
})

// TypeScript knows about soft delete methods
const deletedUser: User = await userRepo.softDelete(1)
const allUsers: User[] = await userRepo.findAllWithDeleted()
const deletedUsers: User[] = await userRepo.findDeleted()

// Batch operations are also typed
const deleted: User[] = await userRepo.softDeleteMany([1, 2, 3])
const restored: User[] = await userRepo.restoreMany([1, 2, 3])
```

## Error Handling

The plugin uses error types from `@kysera/core`:

```typescript
import { NotFoundError } from '@kysera/core'

try {
  await userRepo.softDelete(999) // Non-existent ID
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error('User not found:', error.metadata)
    // error.metadata = { id: 999 }
  }
}

try {
  await userRepo.softDeleteMany([1, 2, 999]) // One ID doesn't exist
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error('Some users not found:', error.metadata)
    // error.metadata = { ids: [999] }
  }
}
```

## Performance Considerations

### Index Requirements

Always add an index on the `deleted_at` column for optimal query performance:

```sql
CREATE INDEX idx_users_deleted_at ON users(deleted_at);
CREATE INDEX idx_posts_deleted_at ON posts(deleted_at);
```

### Query Performance

The plugin adds a `WHERE deleted_at IS NULL` condition to all SELECT queries. With proper indexing, this has minimal performance impact.

```sql
-- Without index: Full table scan
SELECT * FROM users WHERE deleted_at IS NULL;

-- With index: Index scan (fast)
CREATE INDEX idx_users_deleted_at ON users(deleted_at);
SELECT * FROM users WHERE deleted_at IS NULL;
```

### Bulk Operations

Use bulk methods for better performance when operating on multiple records:

```typescript
// ❌ Inefficient: N queries
for (const id of userIds) {
  await userRepo.softDelete(id)
}

// ✅ Efficient: Single query
await userRepo.softDeleteMany(userIds)
```

## Architecture Notes

### Method Override Pattern

The plugin uses Method Override, not full query interception:

- **SELECT queries**: Automatically filtered using `interceptQuery`
- **DELETE operations**: NOT automatically converted to soft deletes
- Use `softDelete()` method explicitly instead of `delete()`
- Use `hardDelete()` method to bypass soft delete and perform real DELETE

This design is intentional for simplicity and explicitness.

### Plugin Execution Flow

1. Plugin is registered with `createORM()` or `createExecutor()`
2. `interceptQuery()` modifies SELECT query builders to add `WHERE deleted_at IS NULL`
3. `extendRepository()` adds soft delete methods to repositories (Repository pattern only)
4. Query execution flows through the executor with plugin interception applied

### Raw Database Access

The plugin uses `getRawDb()` to access the underlying Kysely instance without plugin interception. This is necessary for:

- `findWithDeleted()`: Needs to see soft-deleted records
- `findAllWithDeleted()`: Needs to see all records
- `findDeleted()`: Needs to query deleted records specifically
- `softDelete()`, `restore()`: Need to fetch records after update

```typescript
import { getRawDb } from '@kysera/executor'

// Inside plugin
const rawDb = getRawDb(repo.executor)

// Bypass soft-delete filter
const allRecords = await rawDb.selectFrom('users').selectAll().execute()
```

## Testing

The package includes comprehensive test coverage:

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm test soft-delete-repository.test.ts

# Run DAL integration tests
pnpm test dal-integration.test.ts
```

Test files:

- `test/dal-integration.test.ts` - DAL pattern with createQuery and withTransaction
- `test/soft-delete-comprehensive.test.ts` - All 9 methods + configuration options
- `test/soft-delete-repository.test.ts` - Repository pattern core functionality
- `test/soft-delete-edge-cases.test.ts` - Edge cases and error handling
- `test/batch-operations.test.ts` - Bulk operation tests (softDeleteMany, etc.)
- `test/custom-primary-key.test.ts` - Custom primary key column support
- `test/soft-delete-custom-keys.test.ts` - Custom column name configurations
- `test/soft-delete-operations.test.ts` - Core soft delete operations
- `test/soft-delete.test.ts` - Basic soft delete functionality
- `test/soft-delete-plugin-interaction.test.ts` - Plugin interaction tests
- `test/multi-db.test.ts` - Multi-database compatibility (PostgreSQL, MySQL, SQLite)

## License

MIT

## Contributing

See the main [Kysera repository](https://github.com/kysera-dev/kysera) for contribution guidelines.

## Links

- [Documentation](https://kysera.dev)
- [GitHub](https://github.com/kysera-dev/kysera)
- [Issues](https://github.com/kysera-dev/kysera/issues)
- [NPM](https://www.npmjs.com/package/@kysera/soft-delete)
