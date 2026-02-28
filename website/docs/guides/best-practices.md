---
sidebar_position: 1
title: Best Practices
description: Production-ready patterns for Kysera
---

# Best Practices

Recommendations for using Kysera effectively in production applications.

## Choosing Data Access Pattern

### Repository vs Functional DAL

Choose the right pattern for your use case:

| Use Case                                                        | Recommended                               |
| --------------------------------------------------------------- | ----------------------------------------- |
| Need repository extension plugins (audit.restore(), timestamps) | **Repository**                            |
| Need query interceptor plugins (soft-delete, RLS filtering)     | **Repository or DAL with createExecutor** |
| Multi-tenant application with RLS                               | **Repository or DAL with createExecutor** |
| Complex custom queries, analytics                               | **DAL**                                   |
| Vertical Slice Architecture                                     | **DAL**                                   |
| Team prefers OOP patterns                                       | **Repository**                            |
| Team prefers functional patterns                                | **DAL**                                   |

```typescript
// Repository: Full plugin support (interceptors + extensions)
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { auditPlugin } from '@kysera/audit'

const orm = await createORM(db, [softDeletePlugin(), auditPlugin()])
const userRepo = orm.createRepository(createUserRepository)
await userRepo.softDelete(1) // Plugin extension method works!

// DAL with createExecutor: Query interceptor plugins only
import { createExecutor } from '@kysera/executor'
import { createQuery } from '@kysera/dal'

const executor = await createExecutor(db, [softDeletePlugin()])
const getUsers = createQuery(
  ctx => ctx.db.selectFrom('users').selectAll().execute() // Soft-delete filter applied!
)
await getUsers(executor)

// DAL: Pure functional queries, no plugins
import { sql } from 'kysely'

const getAnalytics = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('events')
    .select([sql`count(*)`.as('total')])
    .where('user_id', '=', userId)
    .executeTakeFirst()
)
```

:::tip
You can mix both patterns using the **CQRS-lite** pattern via `orm.transaction()`. Repository for writes (with full plugin support) and DAL for complex reads (sharing the same plugins). See [Repository vs DAL Guide](/docs/guides/dal-vs-repository) for detailed comparison.
:::

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
  users: executor => createUserRepository(executor),
  posts: executor => createPostRepository(executor)
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

await db.transaction().execute(async trx => {
  // Quick DB operations only
  await trx.insertInto('users').values(userData).execute()
})

// Bad: External calls inside transaction
await db.transaction().execute(async trx => {
  await trx.insertInto('users').values(input).execute()
  await sendEmail(input.email) // External call holds lock!
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
    const user = await userRepo.create(req.body) // Unvalidated!
    res.json(user)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
```

### Use Environment-Based Validation

```typescript
// Development: Full validation
KYSERA_VALIDATION_MODE = always

// Production: Input only
KYSERA_VALIDATION_MODE = production
```

## Error Handling

### Use Typed Errors

```typescript
import {
  UniqueConstraintError,
  ForeignKeyError,
  NotNullError,
  ValidationError,
  parseDatabaseError
} from '@kysera/core'

// ✅ Good: Specific error handling with type guards
try {
  await userRepo.create({ email: 'test@test.com' })
} catch (err) {
  // Parse database-specific errors into typed errors
  const error = parseDatabaseError(err, 'postgres') // or 'mysql', 'sqlite'

  if (error instanceof UniqueConstraintError) {
    return res.status(409).json({
      error: 'Email already exists',
      constraint: error.constraint,
      columns: error.columns,
      table: error.table
    })
  }

  if (error instanceof ForeignKeyError) {
    return res.status(400).json({
      error: 'Referenced record does not exist',
      constraint: error.constraint,
      table: error.table
    })
  }

  if (error instanceof NotNullError) {
    return res.status(400).json({
      error: 'Required field is missing',
      column: error.column,
      table: error.table
    })
  }

  if (error instanceof ValidationError) {
    return res.status(400).json({
      error: 'Invalid input',
      issues: error.issues
    })
  }

  // Unknown error - log and return generic message
  logger.error('Unexpected error', { error })
  return res.status(500).json({ error: 'Internal server error' })
}

// ❌ Bad: Generic error handling
try {
  await userRepo.create(data)
} catch (error) {
  console.log(error) // No specific handling, poor UX
}
```

### Log with Context

```typescript
import type { Logger } from '@kysera/core'

try {
  await userRepo.update(userId, data)
} catch (err) {
  logger.error('Failed to update user', {
    userId,
    data: { ...data, password: '[REDACTED]' }, // Redact sensitive fields
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  })
  throw err
}
```

### Graceful Degradation

```typescript
import { createExecutor } from '@kysera/executor'
import { rlsPlugin } from '@kysera/rls'

async function createAppExecutor(db: Kysely<Database>) {
  try {
    // Attempt to create executor with plugins
    return await createExecutor(db, [rlsPlugin({ schema: rlsSchema })])
  } catch (error) {
    logger.warn('Failed to initialize plugins, using base executor', { error })
    // Fallback to executor without plugins
    return await createExecutor(db, [])
  }
}
```

## Pagination

### Use Cursor Pagination for Large Datasets

```typescript
// Good: Cursor pagination for large datasets
const result = await paginateCursor(query, {
  orderBy: [
    { column: 'created_at', direction: 'desc' },
    { column: 'id', direction: 'desc' } // Tie-breaker
  ],
  limit: 20
})

// Bad: Offset pagination at high pages
const page = 10000 // Skip 200,000 rows!
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
import { createORM } from '@kysera/repository'
import { timestampsPlugin } from '@kysera/timestamps'
import { softDeletePlugin } from '@kysera/soft-delete'
import { auditPlugin } from '@kysera/audit'

// Execution order matters: plugins wrap each other like onions
const orm = await createORM(db, [
  timestampsPlugin(), // 1. Modifies data first (adds timestamps)
  softDeletePlugin(), // 2. Filters queries (excludes soft-deleted)
  auditPlugin() // 3. Captures everything (outer layer)
])
```

### Don't Audit the Audit Table

```typescript
auditPlugin({
  excludeTables: ['audit_logs'] // Prevent infinite loop
})
```

### Cleanup Plugin Resources

Plugins may allocate resources (connections, timers, etc.). Always clean up when done:

```typescript
import { createExecutor } from '@kysera/executor'

const executor = await createExecutor(db, [myPlugin()])

// Use executor...

// Cleanup when shutting down
await executor.destroy()
// Calls plugin.onDestroy() for each plugin that implements it
```

For custom plugins with cleanup needs:

```typescript
import type { Plugin } from '@kysera/executor'

export function myPlugin(): Plugin {
  let interval: NodeJS.Timeout | undefined

  return {
    name: 'my-plugin',
    version: '1.0.0',

    async onInit() {
      // Start background task
      interval = setInterval(() => {
        // Periodic task...
      }, 60000)
    },

    async onDestroy() {
      // Cleanup resources
      if (interval) {
        clearInterval(interval)
      }
    }
  }
}
```

## Performance

### Use Bulk Operations

```typescript
// Good: Bulk operations (validates all inputs, consistent error behavior)
await userRepo.bulkUpdate([
  { id: 1, data: { status: 'active' } },
  { id: 2, data: { status: 'active' } }
])
```

:::note
`bulkUpdate` executes updates sequentially (one at a time) to ensure consistent ordering and predictable error behavior. For atomicity, wrap in a transaction: `await repo.transaction(async () => repo.bulkUpdate(updates))`. For true batch performance with many rows, consider using Kysely's raw query builder with a single UPDATE statement.
:::

### Limit Debug Plugin Memory

```typescript
const debugDb = withDebug(db, {
  maxMetrics: 1000 // Circular buffer prevents memory leaks (default: 1000)
})
```

### Select Only Needed Columns

```typescript
// Good: Select only needed columns
const users = await db.selectFrom('users').select(['id', 'name']).execute()

// Bad: Select all when only need few
const users = await db.selectFrom('users').selectAll().execute()
const names = users.map(u => u.name)
```

## Security

### Sanitize User Input

```typescript
import { z } from 'zod'

const createUserSchema = z.object({
  email: z.string().email().toLowerCase(), // Sanitize
  name: z.string().min(1).max(100).trim(), // Limit
  role: z.enum(['user', 'admin']) // Restrict
})
```

### Use Parameterized Queries (SQL Injection Prevention)

Kysera (via Kysely) automatically uses parameterized queries to prevent SQL injection:

```typescript
import { sql } from 'kysely'

// ✅ SAFE: Parameterized query (Kysely default)
const users = await db
  .selectFrom('users')
  .where('email', '=', userInput) // Automatically parameterized
  .execute()

// ✅ SAFE: sql.ref() for dynamic column names
const sortColumn = userInput // e.g., 'created_at'
const users = await db
  .selectFrom('users')
  .selectAll()
  .orderBy(sql.ref(sortColumn)) // Safe dynamic column
  .execute()

// ❌ DANGEROUS: String interpolation in raw SQL
await sql`SELECT * FROM users WHERE email = '${userInput}'`.execute(db)
// SQL injection vulnerability!

// ✅ SAFE: Use sql.raw() with parameterized values
const users = await sql`
  SELECT * FROM users
  WHERE email = ${userInput}
`.execute(db) // Kysely automatically parameterizes ${userInput}

// ❌ DANGEROUS: Template literal with sql.raw()
const query = sql.raw(`SELECT * FROM users WHERE email = '${userInput}'`)
// Vulnerable to SQL injection!

// ✅ SAFE: Use sql.raw() only for SQL fragments, not values
const orderByClause = sql.raw('created_at DESC, id DESC')
const users = await db
  .selectFrom('users')
  .selectAll()
  .orderBy(orderByClause)
  .execute()
```

**Key Security Rules:**
1. **Always use Kysely's query builder** for user input (automatically parameterized)
2. **Never use string interpolation** (`${userInput}`) in `sql.raw()`
3. **Use `sql.ref()`** for dynamic column/table names
4. **Validate and sanitize** all user input before queries
5. **Use allowlists** for dynamic column names instead of direct user input

```typescript
// Best practice: Allowlist for dynamic sorting
const ALLOWED_SORT_COLUMNS = ['created_at', 'name', 'email'] as const
type SortColumn = typeof ALLOWED_SORT_COLUMNS[number]

function getUsers(sortBy: string) {
  // Validate against allowlist
  if (!ALLOWED_SORT_COLUMNS.includes(sortBy as SortColumn)) {
    throw new Error('Invalid sort column')
  }

  return db
    .selectFrom('users')
    .selectAll()
    .orderBy(sql.ref(sortBy)) // Safe after validation
    .execute()
}
```

### Don't Log Sensitive Data

```typescript
// ❌ Bad: Logs password
logger.info('User created', { password: user.password })

// ✅ Good: No sensitive data
logger.info('User created', { userId: user.id, email: user.email })

// ✅ Good: Redact sensitive fields
const { password, ...safeData } = userData
logger.info('User data', safeData)
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
  email: i => `user${i}@test.com`,
  name: i => `User ${i}`
})

const users = Array.from({ length: 10 }, () => userFactory())
```
