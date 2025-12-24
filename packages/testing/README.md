# @kysera/testing

Testing utilities for Kysera - transaction isolation, factories, seeding, and test helpers.

## Installation

Install as a development dependency:

```bash
npm install --save-dev @kysera/testing
# or
pnpm add -D @kysera/testing
# or
yarn add -D @kysera/testing
# or
bun add -D @kysera/testing
```

## Key Features

- **Transaction Rollback Testing** - Automatic rollback for isolated, fast tests
- **Database Cleanup Strategies** - Multiple strategies for cleaning test databases
- **Test Data Factories** - Generate test data with sensible defaults and overrides
- **Database Seeding** - Composable seeders for consistent test data
- **Test Helpers** - Utilities for assertions, waiting, and snapshots

## Quick Start

```typescript
import { testInTransaction, createFactory } from '@kysera/testing'

// Create a factory for test data
const createUser = createFactory({
  email: () => `user-${Date.now()}@example.com`,
  name: 'Test User',
  role: 'user'
})

// Test with automatic rollback
it('creates user', async () => {
  await testInTransaction(db, async trx => {
    const userData = createUser({ name: 'Alice' })

    const user = await trx.insertInto('users').values(userData).returningAll().executeTakeFirst()

    expect(user?.name).toBe('Alice')
  })
  // Database automatically rolled back - no cleanup needed!
})
```

## API Documentation

### Transaction Testing

#### `testInTransaction(db, fn)`

Test in a transaction that automatically rolls back. This is the **fastest testing approach** - no cleanup needed!

**Parameters:**

- `db` - Kysely database instance
- `fn` - Test function that receives a transaction

**Example:**

```typescript
import { testInTransaction } from '@kysera/testing'

it('creates and queries user', async () => {
  await testInTransaction(db, async trx => {
    await trx.insertInto('users').values({ email: 'test@example.com', name: 'Test User' }).execute()

    const user = await trx
      .selectFrom('users')
      .where('email', '=', 'test@example.com')
      .selectAll()
      .executeTakeFirst()

    expect(user?.name).toBe('Test User')
  })
  // Transaction automatically rolled back - database is clean!
})
```

#### `testWithSavepoints(db, fn)`

Test with savepoints for nested transaction testing. Useful for testing complex business logic that uses nested transactions.

**Parameters:**

- `db` - Kysely database instance
- `fn` - Test function that receives a transaction

**Example:**

```typescript
import { testWithSavepoints } from '@kysera/testing'

it('handles nested operations', async () => {
  await testWithSavepoints(db, async trx => {
    // Test complex nested transaction logic
    await createUserWithProfile(trx, userData)

    // Verify results
    const user = await trx.selectFrom('users').selectAll().executeTakeFirst()

    expect(user).toBeDefined()
  })
})
```

#### `testWithIsolation(db, isolationLevel, fn)`

Test with specific transaction isolation level. Useful for testing behavior under different isolation levels, such as testing for race conditions or phantom reads.

**Parameters:**

- `db` - Kysely database instance
- `isolationLevel` - One of: `'read uncommitted'`, `'read committed'`, `'repeatable read'`, `'serializable'`
- `fn` - Test function that receives a transaction

**Example:**

```typescript
import { testWithIsolation } from '@kysera/testing'

it('handles serializable isolation', async () => {
  await testWithIsolation(db, 'serializable', async trx => {
    // Test behavior under serializable isolation
    // Concurrent transactions will be serialized
  })
})
```

### Database Cleanup

#### `cleanDatabase(db, strategy, tables)`

Clean database using specified strategy. Different strategies have different performance characteristics:

- `'transaction'` - No cleanup (fastest, use with `testInTransaction`)
- `'delete'` - DELETE FROM each table (medium speed, FK-safe order required, uses parameterized queries for SQL injection prevention)
- `'truncate'` - TRUNCATE TABLE (fastest bulk clean, handles FKs automatically)

**SQL Injection Prevention:** All cleanup strategies use parameterized queries to safely handle table names and prevent SQL injection attacks.

**Dialect Detection:** Improved dialect detection with fallback strategies:
1. Check `db.getExecutor()?.adapter?.dialect` (Kysely 0.27+)
2. Check `db.config.dialect.constructor.name`
3. Return 'postgres' as safe fallback

**Parameters:**

- `db` - Kysely database instance
- `strategy` - Cleanup strategy: `'transaction'`, `'delete'`, or `'truncate'`
- `tables` - List of tables to clean (required for `'delete'` and `'truncate'` strategies)

**Example with delete strategy:**

```typescript
import { cleanDatabase } from '@kysera/testing'

afterEach(async () => {
  // Tables in FK-safe order (children first)
  // Uses parameterized queries to prevent SQL injection
  await cleanDatabase(db, 'delete', ['order_items', 'orders', 'users'])
})
```

**Example with truncate strategy:**

```typescript
import { cleanDatabase } from '@kysera/testing'

afterEach(async () => {
  // Order doesn't matter - CASCADE handles FKs
  await cleanDatabase(db, 'truncate', ['users', 'orders', 'order_items'])
})
```

### Test Data Factories

#### `createFactory(defaults)`

Create a generic test data factory. Factories allow you to create test data with sensible defaults while still being able to override specific fields.

**Parameters:**

- `defaults` - Object with default values (values can be static or functions)

**Returns:** Factory function that creates test data

**Example - Basic factory:**

```typescript
import { createFactory } from '@kysera/testing'

const createUser = createFactory({
  email: () => `user-${Date.now()}@example.com`,
  name: 'Test User',
  role: 'user'
})

// Create with defaults
const user1 = createUser()
// { email: 'user-1234567890@example.com', name: 'Test User', role: 'user' }

// Create with overrides
const admin = createUser({ role: 'admin', name: 'Admin User' })
// { email: 'user-1234567891@example.com', name: 'Admin User', role: 'admin' }
```

**Example - With sequential IDs:**

```typescript
let userId = 0
const createUser = createFactory({
  id: () => ++userId,
  email: () => `user-${userId}@example.com`,
  name: 'Test User'
})

const user1 = createUser()
// { id: 1, email: 'user-1@example.com', name: 'Test User' }

const user2 = createUser()
// { id: 2, email: 'user-2@example.com', name: 'Test User' }
```

#### `createMany(factory, count, overridesFn?)`

Create multiple instances using a factory.

**Parameters:**

- `factory` - Factory function
- `count` - Number of instances to create
- `overridesFn` - Optional function to generate overrides for each instance

**Returns:** Array of created instances

**Example:**

```typescript
import { createFactory, createMany } from '@kysera/testing'

const createUser = createFactory({
  email: () => `user-${Date.now()}@example.com`,
  name: 'Test User'
})

// Create 5 users with defaults
const users = createMany(createUser, 5)

// Create 3 users with custom overrides
const admins = createMany(createUser, 3, i => ({
  name: `Admin ${i + 1}`,
  role: 'admin'
}))
```

#### `createSequenceFactory(defaults)`

Create a factory with a built-in sequence counter that increments with each call.

**Parameters:**

- `defaults` - Function that receives sequence number and returns defaults object

**Returns:** Factory function with sequence support

**Example:**

```typescript
import { createSequenceFactory } from '@kysera/testing'

const createUser = createSequenceFactory(seq => ({
  id: seq,
  email: `user-${seq}@example.com`,
  name: `User ${seq}`
}))

const user1 = createUser()
// { id: 1, email: 'user-1@example.com', name: 'User 1' }

const user2 = createUser()
// { id: 2, email: 'user-2@example.com', name: 'User 2' }
```

### Database Seeding

#### `seedDatabase(db, fn)`

Seed database with test data. Executes the seeding function within a transaction. If the seeding function throws, the transaction is rolled back.

**Parameters:**

- `db` - Kysely database instance
- `fn` - Seeding function that receives a transaction

**Example:**

```typescript
import { seedDatabase } from '@kysera/testing'

beforeAll(async () => {
  await seedDatabase(db, async trx => {
    // Insert test users
    await trx
      .insertInto('users')
      .values([
        { email: 'alice@example.com', name: 'Alice' },
        { email: 'bob@example.com', name: 'Bob' }
      ])
      .execute()

    // Insert related data
    await trx
      .insertInto('posts')
      .values([{ user_id: 1, title: 'First Post' }])
      .execute()
  })
})
```

#### `composeSeeders(seeders)`

Create a composable seeder by combining multiple seed functions.

**Parameters:**

- `seeders` - Array of seed functions

**Returns:** Combined seed function

**Example:**

```typescript
import { composeSeeders, seedDatabase, type SeedFunction } from '@kysera/testing'

const seedUsers: SeedFunction<DB> = async trx => {
  await trx
    .insertInto('users')
    .values([
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com', name: 'Bob' }
    ])
    .execute()
}

const seedPosts: SeedFunction<DB> = async trx => {
  await trx
    .insertInto('posts')
    .values([
      { user_id: 1, title: 'First Post' },
      { user_id: 2, title: 'Second Post' }
    ])
    .execute()
}

const seedAll = composeSeeders([seedUsers, seedPosts])

beforeAll(async () => {
  await seedDatabase(db, seedAll)
})
```

### Test Helpers

#### `waitFor(condition, options?)`

Wait for a condition to be true. Useful for testing async operations like background jobs, event handlers, or eventual consistency scenarios.

**Parameters:**

- `condition` - Function that returns true when condition is met
- `options` - Configuration options:
  - `timeout` - Maximum time to wait in milliseconds (default: 5000)
  - `interval` - Interval between condition checks in milliseconds (default: 100)
  - `timeoutMessage` - Custom error message on timeout

**Throws:** Error if timeout is exceeded before condition is met

**Example - Basic usage:**

```typescript
import { waitFor } from '@kysera/testing'

// Wait for user to appear in database
await waitFor(async () => {
  const user = await db
    .selectFrom('users')
    .where('email', '=', 'test@example.com')
    .executeTakeFirst()
  return user !== undefined
})
```

**Example - With custom options:**

```typescript
import { waitFor } from '@kysera/testing'

await waitFor(
  async () => {
    const count = await getProcessedCount()
    return count >= 10
  },
  {
    timeout: 10000,
    interval: 200,
    timeoutMessage: 'Jobs did not complete in time'
  }
)
```

#### `snapshotTable(db, table)`

Snapshot database table state for later comparison.

**Parameters:**

- `db` - Kysely database instance
- `table` - Table name to snapshot

**Returns:** Array of all rows in the table

**Example:**

```typescript
import { snapshotTable } from '@kysera/testing'

const before = await snapshotTable(db, 'users')

// Perform operations...
await createUser(db, userData)

const after = await snapshotTable(db, 'users')
expect(after.length).toBe(before.length + 1)
```

#### `countRows(db, table)`

Count rows in a table.

**Parameters:**

- `db` - Kysely database instance
- `table` - Table name

**Returns:** Number of rows in the table

**Example:**

```typescript
import { countRows } from '@kysera/testing'

const initialCount = await countRows(db, 'users')
await createUser(db, userData)
const newCount = await countRows(db, 'users')

expect(newCount).toBe(initialCount + 1)
```

#### `assertRowExists(db, table, where)`

Assert that a row exists in a table.

**Parameters:**

- `db` - Kysely database instance
- `table` - Table name
- `where` - Conditions to match (key-value pairs)

**Returns:** The found row

**Throws:** Error if no matching row is found

**Example:**

```typescript
import { assertRowExists } from '@kysera/testing'

const user = await assertRowExists(db, 'users', {
  email: 'test@example.com'
})

expect(user.name).toBe('Test User')
```

#### `assertRowNotExists(db, table, where)`

Assert that no row exists matching the conditions.

**Parameters:**

- `db` - Kysely database instance
- `table` - Table name
- `where` - Conditions to match (key-value pairs)

**Throws:** Error if a matching row is found

**Example:**

```typescript
import { assertRowNotExists } from '@kysera/testing'

await deleteUser(db, userId)

await assertRowNotExists(db, 'users', { id: userId })
```

## Plugin Testing

Utilities for testing Kysera plugins in isolation and integration scenarios.

### createMockPlugin()

Creates a mock plugin that records all intercepted operations. Useful for testing plugin composition and execution order.

```typescript
import { createMockPlugin } from '@kysera/testing'
import { createExecutor } from '@kysera/executor'

const mockPlugin = createMockPlugin('test-plugin', {
  onIntercept: (qb, ctx) => {
    console.log(`Intercepted ${ctx.operation} on ${ctx.table}`)
    return qb
  }
})

const executor = await createExecutor(db, [mockPlugin, softDeletePlugin()])

await executor.selectFrom('users').selectAll().execute()

// Check recorded operations
expect(mockPlugin.operations).toHaveLength(1)
expect(mockPlugin.operations[0].operation).toBe('select')
expect(mockPlugin.operations[0].table).toBe('users')

// Reset tracking
mockPlugin.reset()
```

### spyOnPlugin()

Wraps an existing plugin to record all operations while preserving original behavior.

```typescript
import { spyOnPlugin } from '@kysera/testing'
import { softDeletePlugin } from '@kysera/soft-delete'

const spiedPlugin = spyOnPlugin(softDeletePlugin())

const executor = await createExecutor(db, [spiedPlugin])

await executor.deleteFrom('users').where('id', '=', 1).execute()

// Verify the plugin was called
expect(spiedPlugin.calls).toHaveLength(1)
expect(spiedPlugin.calls[0].operation).toBe('delete')

// Reset call tracking
spiedPlugin.reset()
```

### assertPluginBehavior()

Unit-level assertion helper for plugin interceptQuery methods.

```typescript
import { assertPluginBehavior } from '@kysera/testing'

const plugin = softDeletePlugin({ deletedAtColumn: 'deleted_at' })

const result = assertPluginBehavior(
  plugin,
  { where: () => mockQb }, // Mock query builder
  { operation: 'select', table: 'users', metadata: {} },
  { shouldModifyQuery: true }
)

expect(result.intercepted).toBe(true)
expect(result.modified).toBe(true)
```

### createInMemoryDatabase()

Creates an SQLite in-memory database for fast, isolated plugin tests.

```typescript
import { createInMemoryDatabase } from '@kysera/testing'
import { createExecutor } from '@kysera/executor'

const db = await createInMemoryDatabase(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    deleted_at TEXT
  )
`)

const executor = await createExecutor(db, [softDeletePlugin()])

// Run tests against in-memory database
await executor.insertInto('users').values({ email: 'test@example.com' }).execute()

// Cleanup
await db.destroy()
```

**Requirements:** `better-sqlite3` must be installed as a dev dependency.

### createPluginTestHarness()

Complete integration test framework with setup, execute, verify, and teardown phases.

```typescript
import { createPluginTestHarness } from '@kysera/testing'
import { softDeletePlugin } from '@kysera/soft-delete'
import { timestampsPlugin } from '@kysera/timestamps'

const harness = createPluginTestHarness({
  plugins: [softDeletePlugin(), timestampsPlugin()],
  schema: `
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `,
  seedData: async (executor) => {
    await executor.insertInto('posts').values({ title: 'Seed Post' }).execute()
  }
})

// Setup: create in-memory DB, apply schema, seed data
await harness.setup()

// Execute: run test code
const result = await harness.execute(async (executor) => {
  return executor.insertInto('posts')
    .values({ title: 'Test Post' })
    .returningAll()
    .executeTakeFirst()
})

// Verify: make assertions
harness.verify(result, (r) => {
  expect(r.created_at).toBeDefined()
  expect(r.updated_at).toBeDefined()
})

// Teardown: cleanup resources
await harness.teardown()
```

### Plugin Testing Types

```typescript
// Recorded operation from mock/spy plugins
interface RecordedOperation {
  operation: 'select' | 'insert' | 'update' | 'delete'
  table: string
  timestamp: Date
  metadata: Record<string, unknown>
}

// Plugin test result
interface PluginTestResult {
  intercepted: boolean
  modified: boolean
  error?: Error
}

// Assertion options
interface PluginAssertionOptions {
  expectedOperation?: 'select' | 'insert' | 'update' | 'delete'
  expectedTable?: string
  shouldModifyQuery?: boolean
}
```

## TypeScript Types

### Core Types

```typescript
import type { Kysely, Transaction } from 'kysely'

// Transaction isolation levels
type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'

// Cleanup strategies
type CleanupStrategy = 'truncate' | 'transaction' | 'delete'

// Factory types
type FactoryFunction<T> = (overrides?: Partial<T>) => T

type FactoryDefaults<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] | (() => T[K])
}

// Seeding types
type SeedFunction<DB> = (trx: Transaction<DB>) => Promise<void>

// Helper types
interface WaitForOptions {
  timeout?: number
  interval?: number
  timeoutMessage?: string
}
```

## Usage Examples

### Complete Test Suite Example

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  testInTransaction,
  createFactory,
  createMany,
  seedDatabase,
  composeSeeders,
  waitFor,
  countRows,
  assertRowExists,
  type SeedFunction
} from '@kysera/testing'

// Define factories
const createUser = createFactory({
  email: () => `user-${Date.now()}@example.com`,
  name: 'Test User',
  role: 'user'
})

const createPost = createFactory({
  title: () => `Post ${Date.now()}`,
  content: 'Test content',
  published: false
})

// Define seeders
const seedUsers: SeedFunction<DB> = async trx => {
  await trx
    .insertInto('users')
    .values([
      { email: 'alice@example.com', name: 'Alice', role: 'admin' },
      { email: 'bob@example.com', name: 'Bob', role: 'user' }
    ])
    .execute()
}

const seedPosts: SeedFunction<DB> = async trx => {
  await trx
    .insertInto('posts')
    .values([
      { user_id: 1, title: 'First Post', published: true },
      { user_id: 2, title: 'Second Post', published: false }
    ])
    .execute()
}

// Setup test data
beforeAll(async () => {
  const seedAll = composeSeeders([seedUsers, seedPosts])
  await seedDatabase(db, seedAll)
})

describe('User operations', () => {
  it('creates user with transaction rollback', async () => {
    await testInTransaction(db, async trx => {
      const userData = createUser({ name: 'Charlie' })

      await trx.insertInto('users').values(userData).execute()

      const user = await assertRowExists(trx, 'users', {
        email: userData.email
      })

      expect(user.name).toBe('Charlie')
    })
    // User is automatically rolled back
  })

  it('creates multiple users', async () => {
    await testInTransaction(db, async trx => {
      const users = createMany(createUser, 3, i => ({
        name: `User ${i + 1}`
      }))

      await trx.insertInto('users').values(users).execute()

      const count = await countRows(trx, 'users')
      expect(count).toBe(5) // 2 from seed + 3 new
    })
  })

  it('waits for async operation', async () => {
    let processed = false

    // Simulate async operation
    setTimeout(() => {
      processed = true
    }, 500)

    await waitFor(() => processed, {
      timeout: 1000,
      interval: 50
    })

    expect(processed).toBe(true)
  })
})
```

### Integration with Vitest

```typescript
import { beforeEach, afterEach } from 'vitest'
import { cleanDatabase } from '@kysera/testing'

// Clean database after each test
afterEach(async () => {
  await cleanDatabase(db, 'truncate', ['posts', 'comments', 'users'])
})
```

### Integration with Jest

```typescript
import { beforeEach, afterEach } from '@jest/globals'
import { cleanDatabase } from '@kysera/testing'

// Clean database after each test
afterEach(async () => {
  await cleanDatabase(db, 'delete', [
    'comments', // Child tables first
    'posts',
    'users'
  ])
})
```

## Best Practices

### 1. Use Transaction Rollback for Speed

Transaction rollback is the fastest testing approach:

```typescript
// ✅ Fast - automatic rollback
await testInTransaction(db, async trx => {
  // test code
})

// ❌ Slower - manual cleanup
await createUser(db, userData)
await cleanDatabase(db, 'truncate', ['users'])
```

### 2. Define Factories Once, Use Everywhere

```typescript
// factories.ts
export const createUser = createFactory({
  email: () => `user-${Date.now()}@example.com`,
  name: 'Test User',
  role: 'user'
})

export const createPost = createFactory({
  title: () => `Post ${Date.now()}`,
  content: 'Test content'
})

// test file
import { createUser, createPost } from './factories'
```

### 3. Compose Seeders for Reusability

```typescript
// seeders.ts
export const seedUsers: SeedFunction<DB> = async trx => {
  // seed users
}

export const seedPosts: SeedFunction<DB> = async trx => {
  // seed posts
}

export const seedAll = composeSeeders([seedUsers, seedPosts])

// test file
import { seedAll } from './seeders'
```

### 4. Use Appropriate Cleanup Strategy

- **Transaction**: Fastest, use with `testInTransaction()`
- **Truncate**: Fast bulk cleanup, handles foreign keys automatically
- **Delete**: Medium speed, requires FK-safe order (children first)

```typescript
// Best for most cases
afterEach(async () => {
  await cleanDatabase(db, 'truncate', ['users', 'posts'])
})

// When FK order matters
afterEach(async () => {
  await cleanDatabase(db, 'delete', ['comments', 'posts', 'users'])
})
```

## Requirements

- **Kysely**: >=0.28.8
- **Node.js**: >=20.0.0
- **Bun**: >=1.0.0 (optional)

## License

MIT

## Contributing

Issues and pull requests are welcome at [github.com/kysera-dev/kysera](https://github.com/kysera-dev/kysera).
