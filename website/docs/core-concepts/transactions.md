---
sidebar_position: 4
title: Transactions
description: Transaction management in Kysera
---

# Transactions

Kysera provides clean transaction support through the Executor pattern, making it easy to ensure atomic operations.

## Basic Transaction Usage

```typescript
await db.transaction().execute(async (trx) => {
  // All operations in this block are atomic
  const user = await trx.insertInto('users')
    .values({ email: 'john@example.com', name: 'John' })
    .returningAll()
    .executeTakeFirstOrThrow()

  await trx.insertInto('profiles')
    .values({ user_id: user.id, bio: 'Hello!' })
    .execute()

  // If any operation fails, all changes are rolled back
})
```

## The Executor Pattern

The key to Kysera's transaction support is the `Executor` type:

```typescript
type Executor<DB> = Kysely<DB> | Transaction<DB>
```

This allows repository factories to work with both normal database instances and transactions:

```typescript
export function createUserRepository(executor: Executor<Database>) {
  return {
    async findById(id: number) {
      return executor.selectFrom('users')
        .where('id', '=', id)
        .selectAll()
        .executeTakeFirst()
    },
    async create(data: CreateUserInput) {
      return executor.insertInto('users')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow()
    }
  }
}
```

## Repository Transactions

### Method 1: Repository Bundles (Recommended)

```typescript
const createRepos = createRepositoriesFactory({
  users: createUserRepository,
  posts: createPostRepository,
  comments: createCommentRepository
})

// Normal usage
const repos = createRepos(db)
const users = await repos.users.findAll()

// Transaction usage - same API!
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)

  const user = await repos.users.create({
    email: 'jane@example.com',
    name: 'Jane'
  })

  await repos.posts.create({
    user_id: user.id,
    title: 'First Post',
    content: 'Hello World!'
  })

  // Both operations succeed or both fail
})
```

### Method 2: ContextAwareRepository Pattern

The cleanest approach using the `ContextAwareRepository` abstract class:

```typescript
import { ContextAwareRepository } from '@kysera/repository'

class UserRepository extends ContextAwareRepository<Database, 'users'> {
  async create(data: { email: string; name: string }): Promise<User> {
    return this.db
      .insertInto(this.tableName)
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  async findById(id: number): Promise<User | null> {
    return this.db
      .selectFrom(this.tableName)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst() ?? null
  }
}

class PostRepository extends ContextAwareRepository<Database, 'posts'> {
  async create(data: { user_id: number; title: string }): Promise<Post> {
    return this.db
      .insertInto(this.tableName)
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow()
  }
}

// Create base repository instances
const userRepo = new UserRepository(db, 'users')
const postRepo = new PostRepository(db, 'posts')

// Normal usage
const user = await userRepo.findById(1)

// Transaction usage - switch executor cleanly
await db.transaction().execute(async (trx) => {
  const txUserRepo = userRepo.withExecutor(trx)
  const txPostRepo = postRepo.withExecutor(trx)

  const user = await txUserRepo.create({ email: 'test@example.com', name: 'Test' })
  await txPostRepo.create({ user_id: user.id, title: 'First Post' })
  // Both operations in same transaction
})
```

**Benefits:**
- No `executor` parameter in every method
- Type-safe: `withExecutor()` returns same type
- Custom properties preserved

### Method 3: withTransaction Method (Legacy)

```typescript
const userRepo = createUserRepository(db)

await db.transaction().execute(async (trx) => {
  const txUserRepo = userRepo.withTransaction(trx)
  await txUserRepo.create({ email: 'test@example.com', name: 'Test' })
})
```

### Method 4: Repository's transaction Method

```typescript
await userRepo.transaction(async (trx) => {
  // Create transactional repository instances
  const txUserRepo = userRepo.withTransaction(trx)
  const txPostRepo = postRepo.withTransaction(trx)

  // Operations within transaction
  const user = await txUserRepo.create({ ... })
  await txPostRepo.create({ user_id: user.id, ... })

  // Return value becomes the result of transaction()
  return user
})
```

## Transaction Best Practices

### Keep Transactions Short

Minimize transaction duration to avoid lock contention:

```typescript
// Good: Preparation outside transaction
const userData = await validateAndPrepareUserData(input)
const profileData = await fetchExternalProfile(input.socialId)

await db.transaction().execute(async (trx) => {
  // Quick database operations only
  const user = await trx.insertInto('users').values(userData).execute()
  await trx.insertInto('profiles').values({ ...profileData, user_id: user.id }).execute()
})

// Bad: Long-running operations inside transaction
await db.transaction().execute(async (trx) => {
  const user = await trx.insertInto('users').values(input).execute()
  await sendWelcomeEmail(user.email)        // External call - avoid!
  await updateExternalService(user.id)       // External call - avoid!
})
```

### Don't Mix Executors

```typescript
// Bad: Mixing executors breaks atomicity
await db.transaction().execute(async (trx) => {
  const trxRepos = createRepos(trx)
  const dbRepos = createRepos(db)  // Wrong!

  await trxRepos.users.create({ ... })   // In transaction
  await dbRepos.audit.log('created')     // Outside transaction!
})

// Good: Consistent executor usage
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)  // All use transaction
  await repos.users.create({ ... })
  await repos.audit.log('created')  // Both in same transaction
})
```

### Handle Rollbacks Explicitly

```typescript
try {
  await db.transaction().execute(async (trx) => {
    const repos = createRepos(trx)
    await repos.users.create({ email, name })

    if (someCondition) {
      throw new BusinessError('Invalid operation')
    }

    await repos.audit.log('user_created')
  })
} catch (error) {
  if (error instanceof BusinessError) {
    logger.warn('Transaction rolled back:', error.message)
    // Handle business logic error
  } else {
    logger.error('Transaction failed:', error)
    throw error
  }
}
```

## Nested Transactions

Kysely supports savepoints for nested transactions:

```typescript
await db.transaction().execute(async (trx) => {
  await repos.users.create({ ... })

  try {
    // Inner "transaction" uses savepoint
    await trx.transaction().execute(async (innerTrx) => {
      await innerRepos.posts.create({ ... })
      throw new Error('Rollback inner only')
    })
  } catch (error) {
    // Inner operations rolled back, outer continues
  }

  // User creation still committed
})
```

## Transaction Isolation Levels

Control isolation level when needed:

```typescript
await db.transaction()
  .setIsolationLevel('serializable')
  .execute(async (trx) => {
    // Operations with serializable isolation
  })
```

Available levels:
- `read uncommitted`
- `read committed` (default for most databases)
- `repeatable read`
- `serializable`

## Testing with Transactions

Use transaction rollback for fast, isolated tests:

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

      // Transaction auto-rolls back - no cleanup needed!
    })
  })
})
```
