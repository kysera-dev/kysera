---
sidebar_position: 4
title: Transactions
description: Comprehensive transaction management in Kysera
---

# Transactions

Kysera provides **three transaction patterns** for different use cases, built on top of the **@kysera/executor** foundation layer. This ensures plugins automatically work in transactions through consistent plugin propagation.

## Transaction Patterns Overview

| Pattern | Package | Best For | Savepoints | Plugins |
|---------|---------|----------|-----------|---------|
| **DAL `withTransaction`** | `@kysera/dal` | Functional queries, nested transactions | ✅ Yes | ✅ Yes |
| **Repository ORM `transaction()`** | `@kysera/repository` | Multiple repositories, complex flows | ✅ Yes (via DAL) | ✅ Yes |
| **Base Repository `transaction()`** | `@kysera/repository` | Single repository operations | ❌ No | ⚠️ Partial |

:::tip Recommendation
Use **Pattern 1** (DAL `withTransaction`) or **Pattern 2** (ORM `transaction()`) for most use cases. They provide savepoint support, plugin propagation, and better composability.
:::

## Pattern 1: DAL `withTransaction` (Recommended)

**Primary transaction API with savepoint support and plugin propagation.**

### Use When

- Working with functional DAL queries
- Need nested transactions (automatic savepoints)
- Need plugin filters in transactions
- Maximum flexibility and control required

### Features

✅ Automatic savepoint handling for nested calls
✅ Plugin interception preserved
✅ Works with `KyseraExecutor`
✅ Isolation level control
✅ Error rollback with optional propagation

### Basic Example

```typescript
import { withTransaction } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

const executor = await createExecutor(db, [softDeletePlugin()])

const result = await withTransaction(executor, async (ctx) => {
  // All queries get plugin filters automatically
  const user = await createUser(ctx, userData)
  const profile = await createProfile(ctx, { userId: user.id })

  return { user, profile }
})
```

### Nested Transactions with Savepoints

```typescript
await withTransaction(executor, async (ctx) => {
  const user = await createUser(ctx, userData)

  try {
    // Nested call creates SAVEPOINT kysera_sp_1 automatically
    await withTransaction(ctx.db, async (nestedCtx) => {
      await riskyOperation(nestedCtx)
    })
  } catch (error) {
    // Savepoint rolled back, user/profile still in transaction
    console.log('Nested operation failed, continuing...')
  }

  return user // Transaction commits
})
```

### With Isolation Level

```typescript
await withTransaction(executor, async (ctx) => {
  // Critical operation with serializable isolation
  return await updateAccountBalance(ctx, accountId, amount)
}, { isolationLevel: 'serializable' })
```

**Available isolation levels:**
- `read uncommitted`
- `read committed` (default for most databases)
- `repeatable read`
- `serializable`

## Pattern 2: Repository ORM `transaction()` (Recommended for Repository Pattern)

**High-level transaction API for working with multiple repositories.**

### Use When

- Using Repository pattern (`createORM`)
- Need to coordinate multiple repositories
- Want clean repository API (no executor passing)
- Need plugins with repositories

### Features

✅ Internally uses `withTransaction` (savepoints + plugins)
✅ Clean API - no executor passing
✅ Works with plugin-extended repositories
✅ Type-safe context propagation

### Example

```typescript
import { createORM } from '@kysera/repository'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

const executor = await createExecutor(db, [softDeletePlugin()])
const orm = await createORM(executor, [softDeletePlugin()])

const result = await orm.transaction(async (ctx) => {
  // Create repositories with transaction context
  const userRepo = orm.createRepository(createUserRepository)
  const orderRepo = orm.createRepository(createOrderRepository)

  // Repositories automatically use transaction
  const user = await userRepo.create({ email: 'alice@example.com' })
  const order = await orderRepo.create({ userId: user.id, total: 100 })

  // Can also use DAL queries in same transaction
  const stats = await getDashboardStats(ctx, user.id)

  return { user, order, stats }
})
```

### CQRS-lite Pattern

Combine Repository (writes) with DAL (complex reads) in the same transaction:

```typescript
await orm.transaction(async (ctx) => {
  // Repository for writes (type-safe, validated)
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create(userData)

  // DAL for complex reads (flexible, composable)
  const analytics = await getComplexAnalytics(ctx, user.id)

  return { user, analytics }
})
```

## Pattern 3: Base Repository `transaction()` (Legacy/Simple Cases)

**Direct Kysely transaction - simple but limited.**

### Use When

- Single repository operations only
- No plugins needed
- No nested transactions
- Simple, isolated use case

### Limitations

❌ No savepoint support (nested calls create separate transactions)
❌ No automatic plugin propagation
❌ Cannot coordinate with other repositories

### Example

```typescript
const userRepo = createRepository(createUserRepository)

// Simple, isolated transaction
await userRepo.transaction(async (trx) => {
  // trx is raw Transaction<DB>, no plugins
  const user = await trx
    .insertInto('users')
    .values(userData)
    .returningAll()
    .executeTakeFirstOrThrow()

  // Manual plugin handling required
  return user
})
```

### Migration Path

If you need plugins or coordination, migrate to Pattern 1 or 2:

```typescript
// OLD (limited):
await userRepo.transaction(async (trx) => {
  // ...
})

// NEW (recommended):
await withTransaction(executor, async (ctx) => {
  // Use repository methods or DAL queries
  const userRepo = orm.createRepository(createUserRepository)
  // ...
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
      return executor.selectFrom('users').where('id', '=', id).selectAll().executeTakeFirst()
    },
    async create(data: CreateUserInput) {
      return executor.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
    }
  }
}
```

## Repository Transaction Methods

### Method 1: Repository Bundles

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
await db.transaction().execute(async trx => {
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
    return this.db.insertInto(this.tableName).values(data).returningAll().executeTakeFirstOrThrow()
  }

  async findById(id: number): Promise<User | null> {
    return (
      this.db.selectFrom(this.tableName).selectAll().where('id', '=', id).executeTakeFirst() ?? null
    )
  }
}

class PostRepository extends ContextAwareRepository<Database, 'posts'> {
  async create(data: { user_id: number; title: string }): Promise<Post> {
    return this.db.insertInto(this.tableName).values(data).returningAll().executeTakeFirstOrThrow()
  }
}

// Create base repository instances
const userRepo = new UserRepository(db, 'users')
const postRepo = new PostRepository(db, 'posts')

// Normal usage
const user = await userRepo.findById(1)

// Transaction usage - switch executor cleanly
await db.transaction().execute(async trx => {
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

## Nested Transactions and Savepoints

### Automatic Savepoints (Pattern 1 & 2)

```typescript
await withTransaction(db, async (ctx) => {
  const user = await createUser(ctx, userData)

  // This creates SAVEPOINT kysera_sp_1
  await withTransaction(ctx.db, async (nestedCtx) => {
    await updateProfile(nestedCtx, user.id)
    throw new Error('Profile update failed')
  })
  // Savepoint rolled back, user creation still in transaction

  return user  // Transaction commits
})
```

### No Savepoints (Pattern 3)

```typescript
await repo.transaction(async (trx1) => {
  const user = await createUser(trx1)

  // This starts a NEW transaction (not nested!)
  await repo.transaction(async (trx2) => {
    // trx2 is separate from trx1
    // If this fails, trx1 is NOT rolled back
  })
})
```

### Savepoint Validation

- Savepoint names must be positive integers (validated by executor)
- Invalid savepoint names throw descriptive errors
- Rollback errors are logged with full context for debugging

### Dialect-Specific Savepoint Syntax

Different databases use slightly different syntax for savepoints:

**PostgreSQL:**
```sql
SAVEPOINT kysera_sp_1;
RELEASE SAVEPOINT kysera_sp_1;
ROLLBACK TO SAVEPOINT kysera_sp_1;
```

**MySQL:**
```sql
SAVEPOINT kysera_sp_1;
RELEASE SAVEPOINT kysera_sp_1;
ROLLBACK TO SAVEPOINT kysera_sp_1;
```

**SQLite:**
```sql
SAVEPOINT kysera_sp_1;
RELEASE kysera_sp_1;
ROLLBACK TO kysera_sp_1;
```

**MSSQL (SQL Server):**
```sql
SAVE TRANSACTION kysera_sp_1;
-- No explicit RELEASE in MSSQL
ROLLBACK TRANSACTION kysera_sp_1;
```

Kysera handles these differences automatically based on the dialect.

## Plugin Behavior in Transactions

### With `withTransaction` or ORM `transaction()`

```typescript
const executor = await createExecutor(db, [softDeletePlugin()])

await withTransaction(executor, async (ctx) => {
  // Plugins automatically applied
  const users = await ctx.db
    .selectFrom('users')
    .selectAll()
    .execute()
  // WHERE deleted_at IS NULL automatically added
})
```

### With Base Repository `transaction()`

```typescript
await repo.transaction(async (trx) => {
  // Raw transaction, NO plugin filters
  const users = await trx
    .selectFrom('users')
    .selectAll()
    .execute()
  // Must manually add: .where('deleted_at', 'is', null)
})
```

## Transaction Escape Hatch

Sometimes you need to bypass plugin interception in a transaction:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

const executor = await createExecutor(db, [softDeletePlugin()])

await executor.transaction().execute(async (trx) => {
  // Normal query - soft-delete filter applied
  const activeUsers = await trx.selectFrom('users').selectAll().execute()

  // Escape hatch - bypass plugins to get ALL users (including soft-deleted)
  const allUsers = await trx.__rawDb.selectFrom('users').selectAll().execute()

  console.log(`Active: ${activeUsers.length}, Total: ${allUsers.length}`)
})
```

**When to use `__rawDb`:**
- Admin operations that need to see all data (including soft-deleted)
- Debugging and data migration scripts
- Audit queries that need complete data visibility

## Transaction Best Practices

### 1. Keep Transactions Short

Minimize transaction duration to avoid lock contention:

```typescript
// Good: Preparation outside transaction
const userData = await validateAndPrepareUserData(input)
const profileData = await fetchExternalProfile(input.socialId)

await db.transaction().execute(async trx => {
  // Quick database operations only
  const user = await trx.insertInto('users').values(userData).execute()
  await trx
    .insertInto('profiles')
    .values({ ...profileData, user_id: user.id })
    .execute()
})

// Bad: Long-running operations inside transaction
await db.transaction().execute(async trx => {
  const user = await trx.insertInto('users').values(input).execute()
  await sendWelcomeEmail(user.email) // External call - avoid!
  await updateExternalService(user.id) // External call - avoid!
})
```

### 2. Don't Mix Executors

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

### 3. Handle Rollbacks Explicitly

```typescript
try {
  await db.transaction().execute(async trx => {
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

### 4. Use Isolation Levels Appropriately

```typescript
// Default (read committed) - most cases
await withTransaction(executor, async (ctx) => { ... })

// Serializable - critical financial operations
await withTransaction(executor, async (ctx) => {
  await transferMoney(ctx, fromAccount, toAccount, amount)
}, { isolationLevel: 'serializable' })
```

### 5. Handle Nested Errors Explicitly

```typescript
await withTransaction(executor, async (ctx) => {
  const user = await createUser(ctx, userData)

  try {
    await withTransaction(ctx.db, async (nestedCtx) => {
      await riskyOperation(nestedCtx)
    })
  } catch (error) {
    // Nested failed, but parent can continue
    await logError(ctx, error)
  }

  return user
})
```

### 6. Avoid Mixing Patterns

Pick one pattern per transaction scope:

```typescript
// ✅ GOOD: Consistent pattern
await withTransaction(executor, async (ctx) => {
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create(userData)
  const stats = await getStats(ctx, user.id)
})

// ❌ AVOID: Mixing base repo transaction with ORM
await baseRepo.transaction(async (trx) => {
  // This doesn't share the transaction properly!
  await orm.transaction(async (ctx) => { ... })
})
```

## Transaction Context Management

When using DAL or ORM patterns, the transaction context (`DbContext`) carries both the database executor and any additional metadata:

```typescript
type DbContext<DB> = {
  db: KyseraExecutor<DB> | Transaction<DB>
  // Additional context can be added
}
```

This allows you to:
- Pass transaction state through functional DAL queries
- Maintain plugin interception across nested calls
- Add custom metadata (user context, tenant ID, etc.)

## Error Handling and Rollbacks

### Automatic Rollback

All transaction patterns automatically roll back on errors:

```typescript
try {
  await withTransaction(executor, async (ctx) => {
    await createUser(ctx, userData)
    throw new Error('Something went wrong')
    await createProfile(ctx, profileData) // Never executed
  })
} catch (error) {
  // Transaction rolled back automatically
  console.error('Transaction failed:', error)
}
```

### Partial Rollback with Savepoints

```typescript
await withTransaction(executor, async (ctx) => {
  const user = await createUser(ctx, userData) // Committed if parent succeeds

  try {
    await withTransaction(ctx.db, async (nestedCtx) => {
      await createProfile(nestedCtx, profileData)
      throw new Error('Profile creation failed')
    })
  } catch (error) {
    // Only nested transaction rolled back
    console.log('Profile creation failed, user still created')
  }

  return user // Parent transaction commits
})
```

## Dialect-Specific Considerations

### PostgreSQL

- Full support for all isolation levels
- Excellent savepoint support
- `SERIALIZABLE` isolation uses SSI (Serializable Snapshot Isolation)
- Can handle high concurrency well

### MySQL

- InnoDB engine required for transactions
- `READ UNCOMMITTED` and `SERIALIZABLE` behave differently than PostgreSQL
- Savepoints supported in InnoDB
- MyISAM engine does NOT support transactions

### SQLite

- Limited isolation level support (only `SERIALIZABLE` and `READ UNCOMMITTED`)
- Savepoints fully supported
- Single-writer model (concurrent reads, exclusive writes)
- Consider WAL mode for better concurrency

### MSSQL (SQL Server)

- Full transaction support with all isolation levels
- Uses `SAVE TRANSACTION` instead of `SAVEPOINT`
- Supports snapshot isolation (similar to PostgreSQL's MVCC)
- Excellent support for complex nested transactions

## Testing with Transactions

Use transaction rollback for fast, isolated tests:

```typescript
import { testInTransaction } from '@kysera/testing'

describe('User Repository', () => {
  it('should create user', async () => {
    await testInTransaction(db, async trx => {
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

## When to Use Each Pattern

### Use DAL `withTransaction` if:

✅ Working primarily with functional queries
✅ Need nested transaction control
✅ Maximum flexibility required
✅ Building custom transaction workflows

### Use ORM `transaction()` if:

✅ Using Repository pattern extensively
✅ Coordinating multiple repositories
✅ Want clean, high-level API
✅ Need plugins with repositories

### Use Base Repository `transaction()` if:

✅ Single repository, simple operation
✅ No plugin requirements
✅ No nested transaction needs
✅ Isolated, self-contained work

## Migration Guide

### From Base Repository Pattern to DAL Pattern

```typescript
// BEFORE (base-repository.ts)
async transaction<R>(fn: (trx: Transaction<DB>) => Promise<R>): Promise<R> {
  return db.transaction().execute(fn)
}

// AFTER (recommended)
import { withTransaction } from '@kysera/dal'

async transaction<R>(fn: (ctx: DbContext<DB>) => Promise<R>): Promise<R> {
  return withTransaction(this.executor, fn)
}
```

This change adds:
- ✅ Savepoint support for nested calls
- ✅ Plugin propagation
- ✅ Consistent with DAL/ORM patterns

### Breaking Change Considerations

The signature change from `Transaction<DB>` to `DbContext<DB>` is minimal:

```typescript
// OLD signature
(trx: Transaction<DB>) => {
  return trx.selectFrom('users').selectAll().execute()
}

// NEW signature (backward compatible)
(ctx: DbContext<DB>) => {
  return ctx.db.selectFrom('users').selectAll().execute()
}
```

Add `ctx.db.` prefix to transaction references - that's it!

## Additional Resources

For detailed implementation examples, see:
- DAL: `packages/dal/test/transaction.test.ts`
- Repository: `packages/repository/test/orm.test.ts`
- Nested: `packages/testing/test/transaction.test.ts`

For issues or discussions, visit the [Kysera GitHub repository](https://github.com/kysera/kysera).
