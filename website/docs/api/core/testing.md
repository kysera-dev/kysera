---
sidebar_position: 6
title: Testing
description: Testing utilities API reference
---

# Testing Utilities

Utilities for testing database operations with automatic cleanup.

## testInTransaction

Run test code in a transaction that automatically rolls back.

```typescript
async function testInTransaction<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void>
```

### Example

```typescript
import { testInTransaction } from '@kysera/core'

describe('User Repository', () => {
  it('should create user', async () => {
    await testInTransaction(db, async (trx) => {
      const repos = createRepositories(trx)

      const user = await repos.users.create({
        email: 'test@example.com',
        name: 'Test User'
      })

      expect(user.id).toBeDefined()
      expect(user.email).toBe('test@example.com')

      // Transaction auto-rolls back - no cleanup needed!
    })
  })
})
```

## testWithSavepoints

Run tests with savepoints for nested transaction testing.

```typescript
async function testWithSavepoints<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void>
```

## cleanDatabase

Clean database tables using various strategies.

```typescript
async function cleanDatabase<DB>(
  db: Kysely<DB>,
  strategy: 'truncate' | 'transaction' | 'delete',
  tables?: string[]
): Promise<void>
```

### Strategies

| Strategy | Speed | Sequences | Use Case |
|----------|-------|-----------|----------|
| `truncate` | Slowest | Reset | Full cleanup between test suites |
| `delete` | Medium | Preserved | Cleanup preserving auto-increment |
| `transaction` | Fastest | Preserved | Per-test cleanup (via rollback) |

### Example

```typescript
beforeEach(async () => {
  await cleanDatabase(db, 'delete', ['users', 'posts'])
})

afterAll(async () => {
  await cleanDatabase(db, 'truncate')
})
```

## createFactory

Create test data factories.

```typescript
function createFactory<T>(defaults: {
  [K in keyof T]: T[K] | ((index: number) => T[K])
}): (overrides?: Partial<T>) => T
```

### Example

```typescript
import { createFactory } from '@kysera/core'

const createUser = createFactory({
  email: (i) => `user${i}@example.com`,
  name: (i) => `User ${i}`,
  status: 'active'
})

// Generate test data
const user1 = createUser()           // { email: 'user1@...', name: 'User 1', status: 'active' }
const user2 = createUser()           // { email: 'user2@...', name: 'User 2', status: 'active' }
const admin = createUser({ status: 'admin' })  // Override status

// Create multiple
const users = Array.from({ length: 10 }, () => createUser())
```

## waitFor

Wait for a condition to be true.

```typescript
async function waitFor(
  condition: () => Promise<boolean> | boolean,
  options?: {
    timeout?: number       // Default: 5000
    interval?: number      // Default: 100
    timeoutMessage?: string
  }
): Promise<void>
```

### Example

```typescript
// Wait for async job to complete
await waitFor(
  async () => {
    const job = await jobRepo.findById(jobId)
    return job?.status === 'completed'
  },
  { timeout: 10000, interval: 500 }
)
```

## seedDatabase

Seed the database within a transaction.

```typescript
async function seedDatabase<DB>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<void>
): Promise<void>
```

### Example

```typescript
await seedDatabase(db, async (trx) => {
  await trx.insertInto('users').values([
    { email: 'admin@example.com', name: 'Admin', role: 'admin' },
    { email: 'user@example.com', name: 'User', role: 'user' }
  ]).execute()

  await trx.insertInto('posts').values([
    { title: 'First Post', user_id: 1 }
  ]).execute()
})
```

## testWithIsolation

Run test with specific transaction isolation level.

```typescript
async function testWithIsolation<DB, T>(
  db: Kysely<DB>,
  level: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable',
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void>
```

### Example

```typescript
it('should handle concurrent updates', async () => {
  await testWithIsolation(db, 'serializable', async (trx) => {
    // Test concurrent access scenarios
  })
})
```

## snapshotTable

Take a snapshot of table data for comparison.

```typescript
async function snapshotTable<DB>(
  db: Kysely<DB>,
  table: string
): Promise<any[]>
```

## countRows

Count rows in a table.

```typescript
async function countRows<DB>(
  db: Kysely<DB>,
  table: string
): Promise<number>
```

### Example

```typescript
it('should delete user', async () => {
  await testInTransaction(db, async (trx) => {
    const before = await countRows(trx, 'users')

    await userRepo.delete(userId)

    const after = await countRows(trx, 'users')
    expect(after).toBe(before - 1)
  })
})
```

## Best Practices

### 1. Use Transaction-Based Tests

```typescript
// Fast: No actual cleanup needed
await testInTransaction(db, async (trx) => {
  const repos = createRepositories(trx)
  // Test code
})
```

### 2. Use Factories for Test Data

```typescript
const userFactory = createFactory({
  email: (i) => `test${i}@example.com`,
  name: (i) => `Test User ${i}`
})

const users = Array.from({ length: 100 }, () => userFactory())
```

### 3. Isolate Test Suites

```typescript
describe('User Service', () => {
  beforeAll(async () => {
    await seedDatabase(db, seedTestData)
  })

  afterAll(async () => {
    await cleanDatabase(db, 'truncate', ['users'])
  })
})
```
