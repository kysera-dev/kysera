---
sidebar_position: 2
title: Testing
description: Testing strategies with Kysera
---

# Testing

Strategies and utilities for testing Kysera applications.

## Transaction-Based Testing

The fastest approach - each test runs in a transaction that automatically rolls back.

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

## Test Data Factories

Create consistent test data with factories:

```typescript
import { createFactory } from '@kysera/testing'

const userFactory = createFactory({
  email: (i) => `user${i}@example.com`,
  name: (i) => `User ${i}`,
  status: 'active'
})

// Generate unique users
const user1 = userFactory()  // { email: 'user1@...', name: 'User 1', ... }
const user2 = userFactory()  // { email: 'user2@...', name: 'User 2', ... }

// Override specific fields
const admin = userFactory({ status: 'admin' })

// Generate multiple
const users = Array.from({ length: 10 }, () => userFactory())
```

## Testing Services

Test services with dependency injection:

```typescript
class UserService {
  constructor(private repos = createRepos(db)) {}

  async createUserWithProfile(data: CreateUserInput) {
    // Use repository's transaction method
    return this.repos.users.transaction(async (trx) => {
      const user = await trx
        .insertInto('users')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow()

      await trx
        .insertInto('profiles')
        .values({ userId: user.id })
        .execute()

      return user
    })
  }
}

describe('UserService', () => {
  it('should create user with profile', async () => {
    await testInTransaction(db, async (trx) => {
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
    db.transaction().execute(async (trx) => {
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

```typescript
import { createORM, createRepositoryFactory, nativeAdapter } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

describe('Soft Delete Plugin', () => {
  it('should soft delete user', async () => {
    await testInTransaction(db, async (trx) => {
      // Create executor with soft delete plugin using createORM
      const orm = await createORM(trx, [softDeletePlugin()])

      // Create repository using orm's createRepository
      const userRepo = orm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users',
          mapRow: (row) => row,
          schemas: {
            create: nativeAdapter(),
          },
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

## Database Cleanup Strategies

### Transaction (Fastest)

```typescript
await testInTransaction(db, async (trx) => {
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
  await cleanDatabase(db, 'truncate')
})
```

## Integration Testing

Test with real database:

```typescript
import { seedDatabase, cleanDatabase } from '@kysera/testing'

describe('Integration', () => {
  beforeAll(async () => {
    // seedDatabase takes a function, not raw data
    await seedDatabase(db, async (trx) => {
      await trx
        .insertInto('users')
        .values([
          { email: 'alice@example.com', name: 'Alice', status: 'active' },
          { email: 'bob@example.com', name: 'Bob', status: 'active' },
        ])
        .execute()

      await trx
        .insertInto('posts')
        .values([
          { user_id: 1, title: 'Post 1' },
          { user_id: 2, title: 'Post 2' },
        ])
        .execute()
    })
  })

  afterAll(async () => {
    await cleanDatabase(db, 'truncate')
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
    pool: 'forks',  // Isolated processes for DB tests
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

```typescript
// Each test is isolated
await testInTransaction(db, async (trx) => { ... })
```

### 2. Create Fresh Data Per Test

```typescript
it('test 1', async () => {
  await testInTransaction(db, async (trx) => {
    const user = await createTestUser(trx)  // Fresh data
    // Test...
  })
})
```

### 3. Test Edge Cases

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
  await testInTransaction(db, async (trx) => {
    const repos = createRepos(trx)

    await expect(
      repos.users.create({ email: 'invalid', name: '' })
    ).rejects.toThrow()
  })
})
```
