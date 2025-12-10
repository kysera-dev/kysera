---
sidebar_position: 1
title: Best Practices
description: Production-ready patterns for Kysera
---

# Best Practices

Recommendations for using Kysera effectively in production applications.

## Repository Pattern

### Keep Repositories Thin

Repositories should focus on data access only:

```typescript
// Good: Data access only
const user = await userRepo.findById(userId)

// Bad: Business logic in repository
const user = await userRepo.findByIdWithValidationAndNotifications(userId)
```

### Use Factory Pattern

```typescript
// Good: Factory pattern with DI
const createRepos = createRepositoriesFactory({
  users: (executor) => createUserRepository(executor),
  posts: (executor) => createPostRepository(executor)
})

// Use in services
class UserService {
  constructor(private repos = createRepos(db)) {}
}
```

### Define Clear Schema Boundaries

```typescript
// Separate schemas for different operations
const schemas = {
  entity: z.object({
    id: z.number(),
    email: z.string().email(),
    createdAt: z.date()
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

## Transactions

### Always Use Transactions for Related Operations

```typescript
// Good: Atomic operations
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)
  const user = await repos.users.create({ ... })
  await repos.profiles.create({ userId: user.id, ... })
})

// Bad: Non-atomic operations
const user = await userRepo.create({ ... })
await profileRepo.create({ userId: user.id, ... })
// If second fails, first is committed!
```

### Keep Transactions Short

```typescript
// Good: Prepare outside, execute inside
const userData = await validateData(input)
const externalData = await fetchExternalService(input)

await db.transaction().execute(async (trx) => {
  // Quick DB operations only
  await trx.insertInto('users').values(userData).execute()
})

// Bad: External calls inside transaction
await db.transaction().execute(async (trx) => {
  await trx.insertInto('users').values(input).execute()
  await sendEmail(input.email)  // External call holds lock!
})
```

## Validation

### Validate at API Boundaries

```typescript
// Good: Validate at API boundary
app.post('/users', async (req, res) => {
  const input = CreateUserSchema.parse(req.body)
  const user = await userRepo.create(input)
  res.json(user)
})

// Bad: Rely only on repository validation
app.post('/users', async (req, res) => {
  try {
    const user = await userRepo.create(req.body)  // Unvalidated!
    res.json(user)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
```

### Use Environment-Based Validation

```typescript
// Development: Full validation
KYSERA_VALIDATION_MODE=always

// Production: Input only
KYSERA_VALIDATION_MODE=production
```

## Error Handling

### Use Typed Errors

```typescript
// Good: Specific error handling
try {
  await userRepo.create({ email: 'test@test.com' })
} catch (error) {
  if (error instanceof UniqueConstraintError) {
    return res.status(409).json({
      error: 'Email already exists',
      constraint: error.constraint,
      columns: error.columns
    })
  }
  if (error instanceof ValidationError) {
    return res.status(400).json({
      error: 'Invalid input',
      details: error.issues
    })
  }
  throw error
}

// Bad: Generic error handling
try {
  await userRepo.create(data)
} catch (error) {
  console.log(error)  // No specific handling
}
```

### Log with Context

```typescript
try {
  await userRepo.update(userId, data)
} catch (error) {
  logger.error('Failed to update user', {
    userId,
    data: { ...data, password: '[REDACTED]' },
    error: error instanceof Error ? error.message : String(error)
  })
  throw error
}
```

## Pagination

### Use Cursor Pagination for Large Datasets

```typescript
// Good: Cursor pagination for large datasets
const result = await paginateCursor(query, {
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' }  // Tie-breaker
  ],
  limit: 20
})

// Bad: Offset pagination at high pages
const page = 10000  // Skip 200,000 rows!
const result = await paginate(query, { page, limit: 20 })
```

### Create Appropriate Indexes

```sql
-- Index for cursor pagination
CREATE INDEX idx_posts_cursor ON posts (created_at DESC, id DESC);
```

## Plugins

### Order Plugins Correctly

```typescript
// Execution order matters: plugins wrap each other like onions
const orm = await createORM(db, [
  timestampsPlugin(), // 1. Modifies data first (adds timestamps)
  softDeletePlugin(), // 2. Filters queries (excludes soft-deleted)
  auditPlugin()       // 3. Captures everything (outer layer)
])
```

### Don't Audit the Audit Table

```typescript
auditPlugin({
  excludeTables: ['audit_logs']  // Prevent infinite loop
})
```

## Performance

### Use Bulk Operations

```typescript
// Good: Bulk operations
await userRepo.bulkUpdate([
  { id: 1, data: { status: 'active' } },
  { id: 2, data: { status: 'active' } }
])

// Bad: Sequential operations
for (const id of [1, 2]) {
  await userRepo.update(id, { status: 'active' })  // Slow!
}
```

### Limit Debug Plugin Memory

```typescript
const debugDb = withDebug(db, {
  maxMetrics: 1000  // Circular buffer prevents memory leaks (default: 1000)
})
```

### Select Only Needed Columns

```typescript
// Good: Select only needed columns
const users = await db
  .selectFrom('users')
  .select(['id', 'name'])
  .execute()

// Bad: Select all when only need few
const users = await db.selectFrom('users').selectAll().execute()
const names = users.map(u => u.name)
```

## Security

### Sanitize User Input

```typescript
const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),  // Sanitize
  name: z.string().min(1).max(100).trim(),  // Limit
  role: z.enum(['user', 'admin'])           // Restrict
})
```

### Use Parameterized Queries

```typescript
// Good: Parameterized (Kysely default)
await db.selectFrom('users')
  .where('email', '=', userInput)  // Safe
  .execute()

// Bad: String interpolation
await sql`SELECT * FROM users WHERE email = '${userInput}'`  // SQL injection!
```

### Don't Log Sensitive Data

```typescript
// Bad
logger.info('User created', { password: user.password })

// Good
logger.info('User created', { userId: user.id, email: user.email })
```

## Testing

### Use Transaction-Based Tests

```typescript
it('creates user', async () => {
  await testInTransaction(db, async (trx) => {
    const repos = createRepos(trx)
    const user = await repos.users.create({ ... })
    expect(user.id).toBeDefined()
    // Auto-rollback - no cleanup!
  })
})
```

### Use Factories for Test Data

```typescript
const userFactory = createFactory({
  email: (i) => `user${i}@test.com`,
  name: (i) => `User ${i}`
})

const users = Array.from({ length: 10 }, () => userFactory())
```
