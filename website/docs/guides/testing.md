---
sidebar_position: 2
title: Testing
description: Testing strategies with Kysera
---

# Testing

Strategies and utilities for testing Kysera applications.

## Transaction-Based Testing

The fastest approach - each test runs in a transaction that automatically rolls back.

<!-- doc-snippet: skip -->
```typescript
import { testInTransaction } from '@kysera/testing'

describe('User Repository', () => {
  it('should create user', async () => {
    await testInTransaction(db, async (trx) => {
      const repos = createRepos(trx)

      const user = await repos.users.create({
        email: 'test@example.com',
        name: 'Test User'
      })

      expect(user.id).toBeDefined()
      expect(user.email).toBe('test@example.com')

      // No cleanup needed - transaction rolls back!
    })
  })

  it('should find user by ID', async () => {
    await testInTransaction(db, async (trx) => {
      const repos = createRepos(trx)

      const created = await repos.users.create({ ... })
      const found = await repos.users.findById(created.id)

      expect(found).toEqual(created)
    })
  })
})
```

### Savepoints for Nested Transactions

When the code under test opens its own nested transactions, use
`testWithSavepoints` — it creates a savepoint before the test body and rolls
back to it afterwards (an optional third `logger` argument reports unexpected
rollback errors):

```typescript
import { testWithSavepoints } from '@kysera/testing'

it('handles nested operations', async () => {
  await testWithSavepoints(db, async (trx) => {
    await createUserWithProfile(trx, userData)

    const user = await trx.selectFrom('users').selectAll().executeTakeFirst()
    expect(user).toBeDefined()
  })
})
```

### Testing Under a Specific Isolation Level

`testWithIsolation` runs the rollback-transaction with an explicit isolation
level (`'read uncommitted'`, `'read committed'`, `'repeatable read'`,
`'serializable'`), using kysely's dialect-aware `setIsolationLevel()`:

```typescript
import { testWithIsolation } from '@kysera/testing'

it('detects write skew under serializable', async () => {
  await testWithIsolation(db, 'serializable', async (trx) => {
    // Test behavior under serializable isolation
  })
})
```

## Test Data Factories

Create consistent test data with factories:

```typescript
import { createFactory, createSequenceFactory, createMany } from '@kysera/testing'

// createFactory value functions take NO arguments - they're re-invoked on each build
const userFactory = createFactory({
  email: () => `user-${Date.now()}@example.com`,
  name: 'Test User',
  status: 'active'
})

// Override specific fields
const admin = userFactory({ status: 'admin' })

// For sequential data, use createSequenceFactory - it passes a sequence number
const sequencedUser = createSequenceFactory(seq => ({
  email: `user${seq}@example.com`,
  name: `User ${seq}`,
  status: 'active'
}))

const user1 = sequencedUser() // { email: 'user1@...', name: 'User 1', ... }
const user2 = sequencedUser() // { email: 'user2@...', name: 'User 2', ... }

// Generate multiple
const users = createMany(sequencedUser, 10)
```

## Testing Services

Test services with dependency injection:

<!-- doc-snippet: skip -->
```typescript
class UserService {
  constructor(private repos = createRepos(db)) {}

  async createUserWithProfile(data: CreateUserInput) {
    // Use repository's transaction method
    return this.repos.users.transaction(async trx => {
      const user = await trx
        .insertInto('users')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow()

      await trx.insertInto('profiles').values({ userId: user.id }).execute()

      return user
    })
  }
}

describe('UserService', () => {
  it('should create user with profile', async () => {
    await testInTransaction(db, async trx => {
      const service = new UserService(createRepos(trx))

      const user = await service.createUserWithProfile({
        email: 'test@example.com',
        name: 'Test'
      })

      expect(user.id).toBeDefined()

      const profile = await trx
        .selectFrom('profiles')
        .where('user_id', '=', user.id)
        .executeTakeFirst()

      expect(profile).toBeDefined()
    })
  })
})
```

## Testing Transactions

Verify transaction rollback behavior:

```typescript
it('should rollback on error', async () => {
  const initialCount = await countRows(db, 'users')

  await expect(
    db.transaction().execute(async trx => {
      const repos = createRepos(trx)
      await repos.users.create({ email: 'test@test.com', name: 'Test' })
      throw new Error('Force rollback')
    })
  ).rejects.toThrow('Force rollback')

  // Verify rollback
  const finalCount = await countRows(db, 'users')
  expect(finalCount).toBe(initialCount)
})
```

## Testing Plugins

Test plugin behavior with soft delete:

<!-- doc-snippet: skip -->
```typescript
import { createORM, createRepositoryFactory, nativeAdapter } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

describe('Soft Delete Plugin', () => {
  it('should soft delete user', async () => {
    await testInTransaction(db, async trx => {
      // Create executor with soft delete plugin using createORM
      const orm = await createORM(trx, [softDeletePlugin()])

      // Create repository using orm's createRepository
      const userRepo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users',
          mapRow: row => row,
          schemas: {
            create: nativeAdapter()
          }
        })
      })

      // Create and soft delete user
      const user = await userRepo.create({
        email: 'test@example.com',
        name: 'Test User'
      })
      await userRepo.softDelete(user.id)

      // Should not find with regular query
      const found = await userRepo.findById(user.id)
      expect(found).toBeNull()

      // Should find with findWithDeleted
      const foundDeleted = await userRepo.findWithDeleted(user.id)
      expect(foundDeleted).toBeDefined()
      expect(foundDeleted?.deleted_at).toBeDefined()
    })
  })
})
```

## Plugin Testing Utilities

`@kysera/testing` ships dedicated helpers for testing plugins in isolation.

### createMockPlugin

Records every intercepted operation — useful for verifying plugin composition and execution order:

```typescript
import { createMockPlugin } from '@kysera/testing'
import { createExecutor } from '@kysera/executor'

const mockPlugin = createMockPlugin('test-plugin', {
  onIntercept: (qb, ctx) => qb // Optional: transform the query or return it unmodified
})

const executor = await createExecutor(db, [mockPlugin, softDeletePlugin()])
await executor.selectFrom('users').selectAll().execute()

expect(mockPlugin.operations).toHaveLength(1)
expect(mockPlugin.operations[0].operation).toBe('select')
expect(mockPlugin.operations[0].table).toBe('users')

mockPlugin.reset() // Clear recorded operations
```

### spyOnPlugin

Wraps a real plugin, recording calls while preserving its behavior:

```typescript
import { spyOnPlugin } from '@kysera/testing'

const spiedPlugin = spyOnPlugin(softDeletePlugin())
const executor = await createExecutor(db, [spiedPlugin])

await executor.deleteFrom('users').where('id', '=', 1).execute()

expect(spiedPlugin.calls).toHaveLength(1)
expect(spiedPlugin.calls[0].operation).toBe('delete')
```

### createInMemoryDatabase

Creates an in-memory SQLite database from a SQL schema string (requires `better-sqlite3` as a dev dependency):

```typescript
import { createInMemoryDatabase } from '@kysera/testing'

const db = await createInMemoryDatabase<Database>(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    deleted_at TEXT
  )
`)

const executor = await createExecutor(db, [softDeletePlugin()])
await executor.insertInto('users').values({ email: 'test@example.com' }).execute()
```

### createPluginTestHarness

Structured setup/execute/verify/teardown for plugin integration tests, backed by an in-memory database:

```typescript
import { createPluginTestHarness } from '@kysera/testing'

const harness = createPluginTestHarness<Database>({
  plugins: [softDeletePlugin(), timestampsPlugin()],
  schema: `
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `
  // Optional: seedData: async executor => { ... }
})

await harness.setup()

const result = await harness.execute(executor =>
  executor.insertInto('posts').values({ title: 'Test Post' }).returningAll().executeTakeFirst()
)

harness.verify(result, r => {
  expect(r?.created_at).toBeDefined()
  expect(r?.updated_at).toBeDefined()
})

await harness.teardown()
```

For unit-testing a plugin's `interceptQuery` against a mock query builder, `assertPluginBehavior(plugin, mockQb, context, assertions)` reports whether the plugin intercepted and modified the query.

## Testing Security (SQL Injection Prevention)

Kysera uses parameterized queries by default. Test that user input is safely handled:

<!-- doc-snippet: skip -->
```typescript
import { sql } from 'kysely'

describe('SQL Injection Prevention', () => {
  it('should safely handle malicious input in where clause', async () => {
    await testInTransaction(db, async trx => {
      const repos = createRepos(trx)

      // Create test user
      await repos.users.create({ email: 'legit@example.com', name: 'Legit User' })

      // Attempt SQL injection
      const maliciousEmail = "' OR '1'='1"

      // Query builder uses parameterized queries - safe by default
      const result = await trx
        .selectFrom('users')
        .selectAll()
        .where('email', '=', maliciousEmail)
        .execute()

      // Should return empty (no match), not all users
      expect(result).toHaveLength(0)
    })
  })

  it('should safely handle user input in dynamic column names', async () => {
    await testInTransaction(db, async trx => {
      // Use sql.ref() for dynamic column names
      const userColumn = 'email' // Could be from user input (after validation!)

      const result = await trx
        .selectFrom('users')
        .select([sql.ref(userColumn)])
        .limit(1)
        .execute()

      expect(result[0]).toHaveProperty('email')
    })
  })

  it('should validate column names against allowlist', async () => {
    const ALLOWED_COLUMNS = ['email', 'name', 'created_at'] as const

    function getSortedUsers(sortBy: string) {
      // Validate against allowlist before using
      if (!ALLOWED_COLUMNS.includes(sortBy as any)) {
        throw new Error('Invalid sort column')
      }

      return db.selectFrom('users').selectAll().orderBy(sql.ref(sortBy)).execute()
    }

    await testInTransaction(db, async trx => {
      // Valid column - should work
      await expect(getSortedUsers('email')).resolves.toBeDefined()

      // Invalid column - should throw
      await expect(getSortedUsers('DROP TABLE users')).rejects.toThrow('Invalid sort column')
    })
  })
})
```

## Database Cleanup Strategies

### Transaction (Fastest)

```typescript
await testInTransaction(db, async trx => {
  // Test code - auto rollback
})
```

### Delete (Preserves Sequences)

```typescript
beforeEach(async () => {
  await cleanDatabase(db, 'delete', ['users', 'posts'])
})
```

### Truncate (Most Thorough)

```typescript
afterAll(async () => {
  await cleanDatabase(db, 'truncate', ['posts', 'users'])
})
```

Both the `'delete'` and `'truncate'` strategies require the table list.

## Integration Testing

Test with real database:

```typescript
import { seedDatabase, cleanDatabase } from '@kysera/testing'

describe('Integration', () => {
  beforeAll(async () => {
    // seedDatabase takes a function, not raw data
    await seedDatabase(db, async trx => {
      await trx
        .insertInto('users')
        .values([
          { email: 'alice@example.com', name: 'Alice', status: 'active' },
          { email: 'bob@example.com', name: 'Bob', status: 'active' }
        ])
        .execute()

      await trx
        .insertInto('posts')
        .values([
          { user_id: 1, title: 'Post 1' },
          { user_id: 2, title: 'Post 2' }
        ])
        .execute()
    })
  })

  afterAll(async () => {
    await cleanDatabase(db, 'truncate', ['posts', 'users'])
  })

  it('should handle complex query', async () => {
    const result = await db
      .selectFrom('users')
      .innerJoin('posts', 'posts.user_id', 'users.id')
      .where('users.status', '=', 'active')
      .select(['users.id', 'users.name', db.fn.count('posts.id').as('post_count')])
      .groupBy(['users.id', 'users.name'])
      .execute()

    expect(result.length).toBeGreaterThan(0)
  })
})
```

## Testing with Vitest

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    pool: 'forks' // Isolated processes for DB tests
  }
})
```

```typescript
// tests/setup.ts
import { db } from './db'

beforeAll(async () => {
  // Run migrations
  await runMigrations(db, migrations)
})

afterAll(async () => {
  await db.destroy()
})
```

## Best Practices

### 1. Use Transaction Isolation

<!-- doc-snippet: skip -->
```typescript
// Each test is isolated
await testInTransaction(db, async (trx) => { ... })
```

### 2. Create Fresh Data Per Test

```typescript
it('test 1', async () => {
  await testInTransaction(db, async trx => {
    const user = await createTestUser(trx) // Fresh data
    // Test...
  })
})
```

### 3. Test Edge Cases

<!-- doc-snippet: skip -->
```typescript
it('should handle not found', async () => {
  await testInTransaction(db, async (trx) => {
    const repos = createRepos(trx)
    const found = await repos.users.findById(999999)
    expect(found).toBeNull()
  })
})

it('should handle duplicate', async () => {
  await testInTransaction(db, async (trx) => {
    const repos = createRepos(trx)
    await repos.users.create({ email: 'test@test.com', ... })

    await expect(
      repos.users.create({ email: 'test@test.com', ... })
    ).rejects.toThrow(UniqueConstraintError)
  })
})
```

### 4. Test Validation

```typescript
it('should validate input', async () => {
  await testInTransaction(db, async trx => {
    const repos = createRepos(trx)

    await expect(repos.users.create({ email: 'invalid', name: '' })).rejects.toThrow()
  })
})
```

## Testing Error Parsing

Kysera's `parseDatabaseError()` converts raw driver errors into typed errors. It does **not** detect the dialect — the second parameter selects the parser and defaults to `'postgres'`:

<!-- doc-snippet: skip -->
```typescript
import { parseDatabaseError, UniqueConstraintError } from '@kysera/core'

describe('Database Error Parsing', () => {
  it('should parse unique constraint error', async () => {
    await testInTransaction(db, async trx => {
      const repos = createRepos(trx)

      // Create first user
      await repos.users.create({ email: 'test@example.com', name: 'Test' })

      try {
        // Attempt duplicate
        await repos.users.create({ email: 'test@example.com', name: 'Test2' })
        expect.unreachable('Should have thrown')
      } catch (err) {
        // Pass your database's dialect (defaults to 'postgres' when omitted)
        const error = parseDatabaseError(err, 'postgres') // or 'mysql', 'sqlite', 'mssql'

        expect(error).toBeInstanceOf(UniqueConstraintError)
        if (error instanceof UniqueConstraintError) {
          expect(error.constraint).toBeDefined()
          expect(error.columns).toContain('email')
          expect(error.table).toBe('users')
        }
      }
    })
  })

  it('should work across different databases', async () => {
    // Test with PostgreSQL
    const pgDb = new Kysely({ dialect: new PostgresDialect({ pool }) })
    // Test with MySQL
    const mysqlDb = new Kysely({ dialect: new MysqlDialect({ pool }) })
    // Test with SQLite
    const sqliteDb = new Kysely({ dialect: new SqliteDialect({ database }) })

    // parseDatabaseError works with all dialects
    // Just pass the correct dialect name
  })
})
```
