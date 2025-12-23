# Kysera Best Practices

This guide provides recommendations and best practices for using Kysera effectively in production applications.

## Table of Contents

1. [General Principles](#general-principles)
2. [Repository Pattern](#repository-pattern)
3. [Transaction Management](#transaction-management)
4. [Validation Strategy](#validation-strategy)
5. [Error Handling](#error-handling)
6. [Pagination](#pagination)
7. [Plugin Usage](#plugin-usage)
8. [Testing](#testing)
9. [Performance](#performance)
10. [Security](#security)

---

## General Principles

### ✅ Do: Keep Repositories Thin

Repositories should focus on data access logic only. Business logic belongs in services or domain models.

```typescript
// ✅ Good: Thin repository with clear responsibility
const user = await userRepo.findById(userId)
if (!user) throw new NotFoundError('User not found')

// ❌ Bad: Business logic in repository calls
const user = await userRepo.findByIdWithValidationAndNotifications(userId)
```

### ✅ Do: Use TypeScript Strict Mode

Kysera is designed for maximum type safety. Always enable strict mode:

```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true
  }
}
```

### ✅ Do: Prefer Composition Over Inheritance

Use plugins and factory functions instead of extending classes:

```typescript
// ✅ Good: Composition with plugins
const userRepo = withAudit(withSoftDelete(createRepository(db, 'users', userSchema)))

// ❌ Bad: Deep inheritance hierarchies
class AuditableUserRepository extends SoftDeleteRepository<User> {}
```

---

## Repository Pattern

### ✅ Do: Create Repository Factories

Use `createRepositoryFactory` for clean, reusable repository creation:

```typescript
// ✅ Good: Factory pattern
import { createRepositoryFactory } from '@kysera/repository'

const createRepositories = createRepositoryFactory({
  users: createUserRepository,
  posts: createPostRepository,
  comments: createCommentRepository
})

// Usage in transactions
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx)
  await repos.users.create({ ... })
})
```

### ✅ Do: Define Clear Schema Boundaries

Separate create, update, and entity schemas:

```typescript
// ✅ Good: Clear schema boundaries
const userSchemas = {
  entity: z.object({
    id: z.number(),
    email: z.string().email(),
    name: z.string(),
    created_at: z.string()
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

### ❌ Don't: Expose Raw Database Access

```typescript
// ❌ Bad: Exposing raw Kysely instance
class UserRepository {
  constructor(public db: Kysely<DB>) {}
}

// ✅ Good: Encapsulate database access
class UserRepository {
  constructor(private db: Kysely<DB>) {}

  async findActive(): Promise<User[]> {
    return this.db.selectFrom('users').where('active', '=', true).selectAll().execute()
  }
}
```

---

## Transaction Management

### ✅ Do: Use Transactions for Related Operations

Always wrap related database operations in transactions:

```typescript
// ✅ Good: Transaction for related operations
await db.transaction().execute(async trx => {
  const repos = createRepositories(trx)

  const user = await repos.users.create({ email, name })
  await repos.profiles.create({ user_id: user.id, bio })
  await repos.notifications.create({ user_id: user.id, type: 'welcome' })
})
```

### ✅ Do: Keep Transactions Short

Minimize transaction duration to avoid lock contention:

```typescript
// ✅ Good: Short transaction with preparation outside
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

// ❌ Bad: Long transaction with external calls
await db.transaction().execute(async trx => {
  const user = await trx.insertInto('users').values(input).execute()
  await sendWelcomeEmail(user.email) // ❌ External call in transaction
  await updateExternalService(user.id) // ❌ External call in transaction
})
```

### ✅ Do: Handle Transaction Rollbacks Explicitly

```typescript
// ✅ Good: Explicit error handling
try {
  await db.transaction().execute(async trx => {
    const repos = createRepositories(trx)
    await repos.users.create({ email, name })

    if (someCondition) {
      throw new BusinessError('Invalid operation')
    }

    await repos.audit.log('user_created')
  })
} catch (error) {
  if (error instanceof BusinessError) {
    // Handle business logic error
    logger.warn('Transaction rolled back:', error.message)
  } else {
    // Handle unexpected error
    logger.error('Transaction failed:', error)
    throw error
  }
}
```

### ❌ Don't: Mix Transaction and Non-Transaction Executors

```typescript
// ❌ Bad: Mixing executors breaks transaction atomicity
await db.transaction().execute(async (trx) => {
  const trxRepos = createRepositories(trx)
  const dbRepos = createRepositories(db) // ❌ Wrong executor!

  await trxRepos.users.create({ ... }) // In transaction
  await dbRepos.audit.log('created')    // ❌ Outside transaction!
})

// ✅ Good: Consistent executor usage
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx) // All use transaction
  await repos.users.create({ ... })
  await repos.audit.log('created') // Both in same transaction
})
```

---

## Validation Strategy

### ✅ Do: Use Environment-Based Validation

Configure validation based on environment:

```typescript
// ✅ Good: Environment-aware configuration
// Development: validate everything
process.env.KYSERA_VALIDATION_MODE = 'always'

// Production: validate inputs only
process.env.KYSERA_VALIDATION_MODE = 'production'

const userRepo = createRepository(db, 'users', {
  schemas: userSchemas,
  validationOptions: {
    mode: getValidationMode() // Respects environment
  }
})
```

### ✅ Do: Validate at API Boundaries

```typescript
// ✅ Good: Validate at API boundary
app.post('/users', async (req, res) => {
  // Validate request body first
  const input = await createUserSchema.parseAsync(req.body)

  // Repository receives validated data
  const user = await userRepo.create(input)
  res.json(user)
})

// ❌ Bad: Relying only on repository validation
app.post('/users', async (req, res) => {
  try {
    // No validation at API layer
    const user = await userRepo.create(req.body) // ❌ Unvalidated input
    res.json(user)
  } catch (error) {
    // Catching validation errors as 500 errors
    res.status(500).json({ error: error.message })
  }
})
```

### ✅ Do: Use Custom Validation for Complex Rules

```typescript
// ✅ Good: Custom validation for business rules
const createUserSchema = z
  .object({
    email: z.string().email(),
    age: z.number().min(18, 'Must be 18 or older')
  })
  .refine(
    async data => {
      // Custom business rule: check if email is unique
      const existing = await userRepo.findByEmail(data.email)
      return !existing
    },
    { message: 'Email already exists' }
  )
```

---

## Error Handling

### ✅ Do: Use Typed Errors

Leverage Kysera's error hierarchy for specific error handling:

```typescript
import { DatabaseError, UniqueConstraintError, NotFoundError } from '@kysera/core'

try {
  await userRepo.create({ email: 'duplicate@example.com' })
} catch (error) {
  if (error instanceof UniqueConstraintError) {
    return res.status(409).json({ error: 'Email already exists' })
  }

  if (error instanceof DatabaseError) {
    logger.error('Database error:', error.originalError)
    return res.status(500).json({ error: 'Database error' })
  }

  throw error // Unknown error
}
```

### ✅ Do: Log Errors with Context

```typescript
// ✅ Good: Contextual error logging
try {
  await userRepo.update(userId, data)
} catch (error) {
  logger.error('Failed to update user', {
    userId,
    data,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  })
  throw error
}
```

### ❌ Don't: Swallow Errors

```typescript
// ❌ Bad: Silently catching errors
try {
  await userRepo.delete(userId)
} catch (error) {
  // ❌ No logging, no re-throwing
}

// ✅ Good: Explicit error handling
try {
  await userRepo.delete(userId)
} catch (error) {
  logger.warn('User deletion failed', { userId, error })
  // Re-throw if appropriate
  if (error instanceof DatabaseError) {
    throw new ApplicationError('Failed to delete user')
  }
}
```

---

## Pagination

### ✅ Do: Use Cursor Pagination for Large Datasets

```typescript
// ✅ Good: Cursor pagination for infinite scroll
const result = await paginateCursor(db.selectFrom('posts').selectAll(), {
  limit: 20,
  cursor: req.query.cursor,
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' } // Tie-breaker for consistency
  ]
})

res.json({
  items: result.data,
  nextCursor: result.pagination.nextCursor
})
```

### ✅ Do: Use Offset Pagination for Page Numbers

```typescript
// ✅ Good: Offset pagination when users need page numbers
const result = await paginate(db.selectFrom('users').selectAll(), {
  page: parseInt(req.query.page) || 1,
  limit: 20
})

res.json({
  items: result.data,
  page: result.pagination.page,
  totalPages: result.pagination.totalPages,
  total: result.pagination.total
})
```

### ❌ Don't: Use Offset Pagination for Large Datasets

```typescript
// ❌ Bad: Offset pagination with millions of rows
// Performance degrades significantly at high offsets
const page = 10000 // Skip 200,000 rows!
const result = await paginate(query, { page, limit: 20 })

// ✅ Good: Cursor pagination doesn't have this problem
const result = await paginateCursor(query, { cursor, limit: 20 })
```

---

## Plugin Usage

### ✅ Do: Order Plugins Correctly

Plugin order matters - outer plugins wrap inner plugins:

```typescript
// ✅ Good: Logical plugin order
// 1. Audit (outermost - captures everything)
// 2. Soft Delete (affects queries)
// 3. Timestamps (innermost - modifies data)
const userRepo = withAudit(
  withSoftDelete(withTimestamps(createRepository(db, 'users', userSchema)))
)
```

### ✅ Do: Configure Plugins Per-Table

```typescript
// ✅ Good: Different plugins for different tables
const createRepositories = createRepositoryFactory({
  users: db => withAudit(withSoftDelete(createUserRepository(db))),
  audit_logs: db => createAuditLogRepository(db), // No plugins
  sessions: db => withTimestamps(createSessionRepository(db)) // Only timestamps
})
```

### ❌ Don't: Apply Audit Plugin to Audit Tables

```typescript
// ❌ Bad: Audit plugin on audit table creates infinite loop!
const auditRepo = withAudit(
  createRepository(db, 'audit_logs', auditSchema),
  { auditTable: 'audit_logs' } // ❌ Auditing itself!
)

// ✅ Good: No audit plugin on audit table
const auditRepo = createRepository(db, 'audit_logs', auditSchema)
```

---

## Testing

### ✅ Do: Use Transaction-Based Tests

```typescript
import { testInTransaction } from '@kysera/core'

describe('User Repository', () => {
  it('should create user', async () => {
    await testInTransaction(db, async trx => {
      const repos = createRepositories(trx)

      const user = await repos.users.create({
        email: 'test@example.com',
        name: 'Test User'
      })

      expect(user.id).toBeDefined()
      expect(user.email).toBe('test@example.com')

      // Transaction rolls back automatically
    })
  })
})
```

### ✅ Do: Use Factories for Test Data

```typescript
import { createFactory } from '@kysera/core'

// ✅ Good: Reusable test data factories
const userFactory = createFactory<User>({
  email: () => `user-${Date.now()}@example.com`,
  name: () => `User ${Date.now()}`,
  status: 'active'
})

// Generate unique test data
const user1 = userFactory()
const user2 = userFactory()
expect(user1.email).not.toBe(user2.email)
```

### ✅ Do: Test Transaction Rollbacks

```typescript
it('should rollback on error', async () => {
  await expect(
    db.transaction().execute(async trx => {
      const repos = createRepositories(trx)
      await repos.users.create({ email, name })
      throw new Error('Force rollback')
    })
  ).rejects.toThrow('Force rollback')

  // Verify rollback
  const users = await userRepo.findAll()
  expect(users).toHaveLength(0)
})
```

---

## Performance

### ✅ Do: Use Bulk Operations

```typescript
// ✅ Good: Bulk operations for multiple records
await userRepo.bulkUpdate([
  { id: 1, data: { status: 'active' } },
  { id: 2, data: { status: 'active' } },
  { id: 3, data: { status: 'active' } }
])

// ❌ Bad: Sequential individual updates
for (const id of [1, 2, 3]) {
  await userRepo.update(id, { status: 'active' }) // ❌ Slow!
}
```

### ✅ Do: Limit Debug Plugin Memory

```typescript
// ✅ Good: Configure memory limits for debug plugin
const debugDb = withDebug(db, {
  maxMetrics: 1000, // Keep only last 1000 queries
  logQuery: process.env.NODE_ENV === 'development'
})
```

### ✅ Do: Use Indexes for Pagination

```sql
-- ✅ Good: Indexes on pagination columns
CREATE INDEX idx_posts_created_at_id ON posts (created_at DESC, id DESC);

-- Makes cursor pagination efficient
```

### ❌ Don't: Select Unnecessary Columns

```typescript
// ❌ Bad: Selecting all columns when only need few
const users = await db.selectFrom('users').selectAll().execute()
const names = users.map(u => u.name)

// ✅ Good: Select only needed columns
const users = await db.selectFrom('users').select(['id', 'name']).execute()
```

---

## Security

### ✅ Do: Sanitize User Input

```typescript
// ✅ Good: Always validate and sanitize
const createUserSchema = z.object({
  email: z.string().email().toLowerCase(), // Sanitize
  name: z.string().min(1).max(100).trim(), // Validate length
  role: z.enum(['user', 'admin']) // Restrict values
})

const input = createUserSchema.parse(req.body)
await userRepo.create(input)
```

### ✅ Do: Use Parameterized Queries

```typescript
// ✅ Good: Kysely uses parameterized queries by default
await db
  .selectFrom('users')
  .where('email', '=', userInput) // ✅ Safe - parameterized
  .selectAll()
  .execute()

// ❌ Bad: Raw SQL with string interpolation
await sql`SELECT * FROM users WHERE email = '${userInput}'` // ❌ SQL injection risk!
```

### ✅ Do: Implement Row-Level Security

```typescript
// ✅ Good: Enforce access control in repositories
class UserRepository {
  async findById(id: number, requestUserId: number): Promise<User> {
    const user = await this.db
      .selectFrom('users')
      .where('id', '=', id)
      .selectAll()
      .executeTakeFirst()

    if (!user) throw new NotFoundError('User not found')

    // Enforce access control
    if (user.id !== requestUserId && !user.is_public) {
      throw new ForbiddenError('Access denied')
    }

    return user
  }
}
```

### ❌ Don't: Log Sensitive Data

```typescript
// ❌ Bad: Logging sensitive information
logger.info('User created', {
  email: user.email,
  password: user.password // ❌ Never log passwords!
})

// ✅ Good: Redact sensitive fields
logger.info('User created', {
  userId: user.id,
  email: user.email
  // password omitted
})
```

---

## Additional Resources

- [Getting Started Guide](./GETTING_STARTED.md)
- [API Documentation](./docs/api/index.html)
- [Migration Guide](./packages/migrations/README.md)
- [Plugin Authoring Guide](./PLUGIN_AUTHORING_GUIDE.md)
- [Specification](./specs/spec.md)

---

## Quick Reference

### ✅ DO

- Keep repositories thin and focused
- Use transactions for related operations
- Validate at API boundaries
- Use typed errors
- Use cursor pagination for large datasets
- Order plugins logically
- Test with transaction rollbacks
- Use bulk operations
- Limit debug plugin memory
- Sanitize user input
- Use parameterized queries

### ❌ DON'T

- Expose raw database access
- Mix transaction and non-transaction executors
- Swallow errors
- Use offset pagination for millions of rows
- Apply audit plugin to audit tables
- Select unnecessary columns
- Log sensitive data
- Use string interpolation in SQL

---

**Version**: 0.1.0
**Last Updated**: 2025-10-01
