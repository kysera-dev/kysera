---
sidebar_position: 6
title: '@kysera/testing'
description: Testing utilities API reference
---

# @kysera/testing

Testing utilities for Kysera - transaction isolation, factories, seeding, and test helpers.

## Installation

Install as a development dependency:

```bash
npm install --save-dev @kysera/testing
```

## Overview

**Dependencies:** None (peer: kysely >=0.28.8)

:::info Package Type
This is a **utility package** for testing. It's not part of the Repository/DAL pattern - it provides testing helpers that work with Kysely instances directly.
:::

## Key Features

- **Transaction Rollback Testing** - Automatic rollback for isolated, fast tests
- **Database Cleanup Strategies** - Multiple strategies for cleaning test databases
- **Test Data Factories** - Generate test data with sensible defaults
- **Database Seeding** - Composable seeders for consistent test data
- **Test Helpers** - Utilities for assertions, waiting, and snapshots

## Quick Start

```typescript
import { testInTransaction, createFactory } from '@kysera/testing'

const createUser = createFactory({
  email: () => `user-${Date.now()}@example.com`,
  name: 'Test User',
  role: 'user'
})

it('creates user', async () => {
  await testInTransaction(db, async trx => {
    const userData = createUser({ name: 'Alice' })
    const user = await trx.insertInto('users').values(userData).returningAll().executeTakeFirst()
    expect(user?.name).toBe('Alice')
  })
  // Database automatically rolled back - no cleanup needed!
})
```

## Transaction Testing

### testInTransaction()

Test in a transaction that automatically rolls back. **Fastest testing approach.**

```typescript
import { testInTransaction } from '@kysera/testing'

it('creates and queries user', async () => {
  await testInTransaction(db, async trx => {
    await trx.insertInto('users').values({ email: 'test@example.com', name: 'Test' }).execute()
    const user = await trx
      .selectFrom('users')
      .where('email', '=', 'test@example.com')
      .selectAll()
      .executeTakeFirst()
    expect(user?.name).toBe('Test')
  })
  // Automatically rolled back
})
```

### testWithSavepoints()

Test with savepoints for nested transaction testing.

```typescript
import { testWithSavepoints } from '@kysera/testing'

it('handles nested operations', async () => {
  await testWithSavepoints(db, async trx => {
    await createUserWithProfile(trx, userData)
    // Verify results...
  })
})
```

### testWithIsolation()

Test with specific transaction isolation level.

```typescript
import { testWithIsolation } from '@kysera/testing'

it('handles serializable isolation', async () => {
  await testWithIsolation(db, 'serializable', async trx => {
    // Test behavior under serializable isolation
  })
})
```

**Isolation Levels:** `'read uncommitted'`, `'read committed'`, `'repeatable read'`, `'serializable'`

## Database Cleanup

### cleanDatabase()

Clean database using specified strategy.

```typescript
import { cleanDatabase } from '@kysera/testing'

// Truncate - fast bulk cleanup
afterEach(async () => {
  await cleanDatabase(db, 'truncate', ['users', 'orders', 'order_items'])
})

// Delete - requires FK-safe order (children first)
afterEach(async () => {
  await cleanDatabase(db, 'delete', ['order_items', 'orders', 'users'])
})
```

**Strategies:**

- `'transaction'` - No cleanup (use with `testInTransaction`)
- `'delete'` - DELETE FROM each table (medium speed, FK-safe order required)
- `'truncate'` - TRUNCATE TABLE (fastest bulk clean, handles FKs automatically)

**Security Features:**
- **SQL injection prevention** - Table names are validated against database schema
- **Dialect detection** - Automatic fallback if dialect not specified
- **Safe identifier escaping** - Uses dialect-specific escaping for table names
- Only whitelisted tables from the schema can be truncated/deleted

## Test Data Factories

### createFactory()

Create a generic test data factory.

```typescript
import { createFactory } from '@kysera/testing'

const createUser = createFactory({
  email: () => `user-${Date.now()}@example.com`,
  name: 'Test User',
  role: 'user'
})

const user1 = createUser() // Use defaults
const admin = createUser({ role: 'admin' }) // Override
```

### createMany()

Create multiple instances.

```typescript
import { createMany } from '@kysera/testing'

const users = createMany(createUser, 5)
const admins = createMany(createUser, 3, i => ({
  name: `Admin ${i + 1}`,
  role: 'admin'
}))
```

### createSequenceFactory()

Factory with built-in sequence counter.

```typescript
import { createSequenceFactory } from '@kysera/testing'

const createUser = createSequenceFactory(seq => ({
  id: seq,
  email: `user-${seq}@example.com`,
  name: `User ${seq}`
}))

const user1 = createUser() // { id: 1, email: 'user-1@...' }
const user2 = createUser() // { id: 2, email: 'user-2@...' }
```

## Database Seeding

### seedDatabase()

Seed database with test data.

```typescript
import { seedDatabase } from '@kysera/testing'

beforeAll(async () => {
  await seedDatabase(db, async trx => {
    await trx
      .insertInto('users')
      .values([
        { email: 'alice@example.com', name: 'Alice' },
        { email: 'bob@example.com', name: 'Bob' }
      ])
      .execute()
  })
})
```

### composeSeeders()

Combine multiple seed functions.

```typescript
import { composeSeeders, seedDatabase, type SeedFunction } from '@kysera/testing';

const seedUsers: SeedFunction<DB> = async (trx) => {
  await trx.insertInto('users').values([...]).execute();
};

const seedPosts: SeedFunction<DB> = async (trx) => {
  await trx.insertInto('posts').values([...]).execute();
};

const seedAll = composeSeeders([seedUsers, seedPosts]);

beforeAll(async () => {
  await seedDatabase(db, seedAll);
});
```

## Test Helpers

### waitFor()

Wait for a condition to be true.

```typescript
import { waitFor } from '@kysera/testing'

await waitFor(async () => {
  const user = await db
    .selectFrom('users')
    .where('email', '=', 'test@example.com')
    .executeTakeFirst()
  return user !== undefined
})

// With options
await waitFor(async () => (await getProcessedCount()) >= 10, {
  timeout: 10000,
  interval: 200,
  timeoutMessage: 'Jobs did not complete'
})
```

### snapshotTable()

Snapshot table state for comparison.

```typescript
import { snapshotTable } from '@kysera/testing'

const before = await snapshotTable(db, 'users')
await createUser(db, userData)
const after = await snapshotTable(db, 'users')
expect(after.length).toBe(before.length + 1)
```

### countRows()

Count rows in a table.

```typescript
import { countRows } from '@kysera/testing'

const count = await countRows(db, 'users')
expect(count).toBe(5)
```

### assertRowExists()

Assert that a row exists.

```typescript
import { assertRowExists } from '@kysera/testing'

const user = await assertRowExists(db, 'users', { email: 'test@example.com' })
expect(user.name).toBe('Test User')
```

### assertRowNotExists()

Assert that no row exists.

```typescript
import { assertRowNotExists } from '@kysera/testing'

await deleteUser(db, userId)
await assertRowNotExists(db, 'users', { id: userId })
```

## TypeScript Types

```typescript
type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'
type CleanupStrategy = 'truncate' | 'transaction' | 'delete'
type FactoryFunction<T> = (overrides?: Partial<T>) => T
type SeedFunction<DB> = (trx: Transaction<DB>) => Promise<void>

interface WaitForOptions {
  timeout?: number // Default: 5000
  interval?: number // Default: 100
  timeoutMessage?: string
}
```

## Best Practices

### 1. Use Transaction Rollback for Speed

```typescript
// Fast - automatic rollback
await testInTransaction(db, async trx => {
  /* test */
})

// Slower - manual cleanup
await createUser(db, userData)
await cleanDatabase(db, 'truncate', ['users'])
```

### 2. Define Factories Once

```typescript
// factories.ts
export const createUser = createFactory({
  email: () => `user-${Date.now()}@example.com`,
  name: 'Test User'
})

// test file
import { createUser } from './factories'
```

### 3. Compose Seeders

```typescript
// seeders.ts
export const seedUsers: SeedFunction<DB> = async (trx) => { ... };
export const seedPosts: SeedFunction<DB> = async (trx) => { ... };
export const seedAll = composeSeeders([seedUsers, seedPosts]);
```

### 4. Choose Right Cleanup Strategy

- **Transaction**: Fastest (use with `testInTransaction`)
- **Truncate**: Fast bulk cleanup, handles FKs automatically
- **Delete**: Medium speed, requires FK-safe order
