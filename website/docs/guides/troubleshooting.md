---
sidebar_position: 6
title: Troubleshooting & FAQ
description: Common issues, solutions, and frequently asked questions for Kysera
---

# Troubleshooting & FAQ

This guide covers common issues you might encounter when using Kysera and provides solutions and workarounds.

## Troubleshooting

### Common Errors

#### "OFFSET/FETCH NEXT is not supported without ORDER BY" (MSSQL)

**Cause:** Microsoft SQL Server requires an `ORDER BY` clause when using offset pagination.

**Solution:** Always include `.orderBy()` before calling pagination methods:

```typescript
// ❌ This will fail on MSSQL
const result = await db
  .selectFrom('users')
  .selectAll()
  .limit(10)
  .offset(20)
  .execute()

// ✅ This works
const result = await db
  .selectFrom('users')
  .selectAll()
  .orderBy('id', 'asc')
  .limit(10)
  .offset(20)
  .execute()
```

When using pagination helpers:

```typescript
import { paginate } from '@kysera/core'

// Always provide orderBy
const result = await paginate(
  db.selectFrom('users').selectAll().orderBy('created_at', 'desc'),
  { page: 1, limit: 20 }
)
```

---

#### "Invalid pagination cursor" errors

**Cause:** The cursor is from a different query or has been corrupted/tampered with.

**Solution:** Ensure the cursor matches the columns specified in `orderBy`:

```typescript
// If you ordered by 'created_at'
const firstPage = await paginateCursor(
  db.selectFrom('posts').selectAll().orderBy('created_at', 'desc'),
  { limit: 20, cursorColumns: ['created_at'] }
)

// Use the cursor from the response
const nextPage = await paginateCursor(
  db.selectFrom('posts').selectAll().orderBy('created_at', 'desc'),
  {
    limit: 20,
    cursorColumns: ['created_at'],
    cursor: firstPage.nextCursor // Must be from the same query
  }
)
```

**Important:** Cursors are query-specific and cannot be reused across different queries or column orders.

---

#### "Cannot find module '@kysera/executor'"

**Cause:** Missing dependency. The executor package is required for plugin functionality.

**Solution:** Install the executor package:

```bash
pnpm add @kysera/executor
```

Ensure all packages are updated:

```bash
pnpm update @kysera/core @kysera/executor @kysera/repository @kysera/dal
```

---

#### Plugin not intercepting queries

**Cause:** Using raw Kysely instance instead of the executor.

**Solution:** Create and use an executor with your plugins:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

// ❌ Plugins won't work with raw Kysely
const db = new Kysely<Database>({ dialect })
const users = await db.selectFrom('users').selectAll().execute()

// ✅ Use executor for plugin interception
const executor = await createExecutor(db, [softDeletePlugin()])
const users = await executor.selectFrom('users').selectAll().execute()
```

For Repository pattern:

```typescript
import { createORM } from '@kysera/repository'

// ORM creates executor internally
const orm = await createORM(db, [softDeletePlugin()])
```

For DAL pattern:

```typescript
import { createContext } from '@kysera/dal'

const executor = await createExecutor(db, [softDeletePlugin()])
const ctx = createContext(executor) // Pass executor, not db
```

---

#### Type errors with dialect-specific code

**Cause:** Boolean and data type handling differs between databases.

**Solution:** Use dialect-specific values or utilities:

```typescript
// SQLite uses 1/0 for booleans
const sqliteQuery = db
  .selectFrom('users')
  .selectAll()
  .where('is_active', '=', 1) // Not true

// PostgreSQL/MySQL use true/false
const pgQuery = db
  .selectFrom('users')
  .selectAll()
  .where('is_active', '=', true)

// Use dialect detection for cross-database code
import { getDialect } from '@kysera/core'

const dialect = getDialect(db)
const activeValue = dialect === 'sqlite' ? 1 : true

const query = db
  .selectFrom('users')
  .selectAll()
  .where('is_active', '=', activeValue)
```

---

#### Connection timeout with MSSQL

**Cause:** Database doesn't exist, incorrect connection string, or network issues.

**Solution:** Verify your Tedious configuration and database exists:

```typescript
import { Kysely, MssqlDialect } from 'kysely'
import { Tedious } from 'tedious'
import { TediousPool } from 'tarn-tedious'

const db = new Kysely<Database>({
  dialect: new MssqlDialect({
    tarn: {
      ...TediousPool,
      options: {
        min: 0,
        max: 10,
      },
    },
    tedious: {
      ...Tedious,
      connectionFactory: () => new Tedious.Connection({
        server: 'localhost',
        authentication: {
          type: 'default',
          options: {
            userName: 'sa',
            password: 'YourStrong@Passw0rd'
          }
        },
        options: {
          port: 1433,
          database: 'kysera_test', // Ensure this database exists
          trustServerCertificate: true,
          requestTimeout: 30000, // Increase timeout
          connectTimeout: 30000
        }
      })
    }
  })
})
```

Create the database if it doesn't exist:

```sql
CREATE DATABASE kysera_test;
```

---

### Performance Issues

#### Slow offset pagination on large datasets

**Problem:** Offset pagination becomes slower as the offset increases because the database must scan and skip rows.

**Solution:** Use cursor-based pagination for large datasets:

```typescript
import { paginateCursor } from '@kysera/core'

// ❌ Slow on large offsets
const result = await paginate(
  db.selectFrom('posts').selectAll().orderBy('id', 'asc'),
  { page: 1000, limit: 20 } // offset = 19,980
)

// ✅ Fast and consistent performance
const result = await paginateCursor(
  db.selectFrom('posts').selectAll().orderBy('id', 'asc'),
  { limit: 20, cursor: lastCursor, cursorColumns: ['id'] }
)
```

**Benchmark:** Cursor pagination maintains ~1-2ms query time regardless of position, while offset pagination can degrade to 100ms+ on large offsets.

---

#### Memory issues with large result sets

**Problem:** Loading thousands of rows into memory causes out-of-memory errors.

**Solution:** Use Kysely's native streaming or limit page sizes:

```typescript
// ❌ Loads all rows into memory
const allUsers = await db.selectFrom('users').selectAll().execute()

// ✅ Use Kysely's native stream() method
const stream = db.selectFrom('users').selectAll().stream()

for await (const user of stream) {
  await processUser(user)
}

// ✅ Or paginate with reasonable limits
import { paginate } from '@kysera/core'

const result = await paginate(
  db.selectFrom('users').selectAll().orderBy('id', 'asc'),
  { page: 1, limit: 100 } // Process in batches
)
```

**Note:** Kysera does not provide a separate `executeStream` utility. Use Kysely's built-in `.stream()` method directly for streaming large datasets.

---

#### Slow queries with plugins

**Problem:** Multiple plugins chained together slow down queries.

**Solution:** Plugins are applied in order. Optimize by:

1. Placing filtering plugins first (RLS, soft-delete)
2. Using database indexes on filtered columns
3. Profiling with the debug plugin

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'
import { debugPlugin } from '@kysera/debug'

// Order matters for performance
const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema }),    // Filter first
  softDeletePlugin(),                   // Then soft-delete filter
  debugPlugin({ logQueries: true })     // Debug last
])

// Ensure indexes exist on filtered columns
// CREATE INDEX idx_users_tenant_id ON users(tenant_id);
// CREATE INDEX idx_users_deleted_at ON users(deleted_at);
```

---

## FAQ

### General Questions

#### Q: Can I use Kysera without the executor?

**A:** Yes, but plugins won't intercept queries. The core utilities (pagination, error parsing, logging) work with raw Kysely:

```typescript
import { paginate, parseDatabaseError } from '@kysera/core'

// Works without executor
const result = await paginate(
  db.selectFrom('users').selectAll().orderBy('id', 'asc'),
  { page: 1, limit: 20 }
)

try {
  await db.insertInto('users').values(data).execute()
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')
  // Handle error
}
```

For full plugin functionality (soft-delete, RLS, audit, etc.), use `createExecutor()`.

---

#### Q: Which databases are supported?

**A:** Kysera supports all databases that Kysely supports:

| Database           | Tested | Notes                          |
| ------------------ | ------ | ------------------------------ |
| PostgreSQL         | ✅     | Primary development target     |
| MySQL              | ✅     | Full support                   |
| SQLite             | ✅     | Boolean values use 1/0         |
| MSSQL (SQL Server) | ✅     | Requires ORDER BY for OFFSET   |
| PlanetScale        | ⚠️     | MySQL-compatible               |
| CockroachDB        | ⚠️     | PostgreSQL-compatible          |
| Oracle             | ❓     | Untested, should work via Kysely |

---

#### Q: How do I handle different boolean types across databases?

**A:** Use dialect-specific values or create abstraction utilities:

```typescript
import { getDialect } from '@kysera/core'

// Option 1: Detect dialect at runtime
const dialect = getDialect(db)
const boolValue = (val: boolean) =>
  dialect === 'sqlite' ? (val ? 1 : 0) : val

const query = db
  .selectFrom('users')
  .selectAll()
  .where('is_active', '=', boolValue(true))

// Option 2: Use type-safe schema definitions
interface SqliteDatabase {
  users: {
    id: number
    is_active: 0 | 1 // SQLite booleans
  }
}

interface PostgresDatabase {
  users: {
    id: number
    is_active: boolean // PostgreSQL booleans
  }
}

// Option 3: Create helper functions
const isActive = (dialect: string) =>
  dialect === 'sqlite'
    ? sql<0 | 1>`is_active = 1`
    : sql<boolean>`is_active = true`
```

---

#### Q: Can I use multiple plugins together?

**A:** Yes, pass an array to `createExecutor()`:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'
import { auditPlugin } from '@kysera/audit'
import { timestampsPlugin } from '@kysera/timestamps'

const executor = await createExecutor(db, [
  timestampsPlugin(),              // Auto timestamps
  softDeletePlugin(),               // Soft deletes
  rlsPlugin({ schema: rlsSchema }), // Row-level security
  auditPlugin({ auditTable: 'audit_log' }) // Audit logging
])

// All plugins apply to queries
const user = await executor
  .selectFrom('users')
  .selectAll()
  .where('id', '=', 1)
  .executeTakeFirst()
```

Plugins are applied in order, which can affect performance. Place filtering plugins (RLS, soft-delete) first.

---

#### Q: How do I run tests against multiple databases?

**A:** Use environment variables to enable specific databases:

```bash
# Run all database tests
TEST_POSTGRES=true TEST_MYSQL=true TEST_MSSQL=true pnpm test

# Run only PostgreSQL tests
TEST_POSTGRES=true pnpm test

# Use Docker for test databases
pnpm docker:up          # Start PostgreSQL/MySQL containers
pnpm test:multi-db      # Run multi-database tests
pnpm docker:down        # Stop containers
```

In your test files:

```typescript
import { describe, it, beforeAll } from 'vitest'

const shouldTestPostgres = process.env.TEST_POSTGRES === 'true'
const shouldTestMysql = process.env.TEST_MYSQL === 'true'

describe.skipIf(!shouldTestPostgres)('PostgreSQL tests', () => {
  it('should work with PostgreSQL', async () => {
    // Test code
  })
})

describe.skipIf(!shouldTestMysql)('MySQL tests', () => {
  it('should work with MySQL', async () => {
    // Test code
  })
})
```

---

#### Q: What's the maximum page size?

**A:** The default maximum is **10,000 items per page**, configurable via the `MAX_LIMIT` constant:

```typescript
import { paginate, MAX_LIMIT } from '@kysera/core'

// Default max is 10,000
const result = await paginate(
  db.selectFrom('users').selectAll().orderBy('id', 'asc'),
  { page: 1, limit: 15000 } // Clamped to 10,000
)

console.log(result.limit) // 10000
```

**Why this limit?**

- Prevents accidental memory issues
- Protects database from expensive queries
- Encourages cursor pagination for large datasets

**To override (not recommended):**

```typescript
// Custom implementation without MAX_LIMIT
const customPaginate = async (query, { page, limit }) => {
  const offset = (page - 1) * limit
  return query.limit(limit).offset(offset).execute()
}
```

---

### Repository & DAL Questions

#### Q: Should I use Repository or DAL?

**A:** Use both together (CQRS-lite pattern):

```typescript
const orm = await createORM(db, [softDeletePlugin()])

await orm.transaction(async ctx => {
  // Repository for writes (type-safe, validated)
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create({
    name: 'Alice',
    email: 'alice@example.com'
  })

  // DAL for complex reads (flexible queries)
  const stats = await getDashboardStats(ctx, user.id)
})
```

**Use Repository when:**
- CRUD operations
- Zod validation needed
- Type-safe mutations
- Working with single entities

**Use DAL when:**
- Complex joins
- Aggregations
- Custom queries
- Read-only operations

---

#### Q: How do I share plugins between Repository and DAL?

**A:** The executor enables plugin sharing:

```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { createContext } from '@kysera/dal'

// Create executor once
const executor = await createExecutor(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema })
])

// Both Repository and DAL use the same executor
const orm = await createORM(executor, [])
const dalCtx = createContext(executor)

// Plugins apply to both
await orm.transaction(async ctx => {
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.findById(1) // Soft-delete filter applied

  const stats = await getStats(ctx, user.id) // Same plugins
})
```

---

#### Q: Can I disable plugins for specific queries?

**A:** Not directly, but you can use the raw Kysely instance:

```typescript
import { createExecutor } from '@kysera/executor'

const db = new Kysely<Database>({ dialect })
const executor = await createExecutor(db, [softDeletePlugin()])

// Plugins applied
const activeUsers = await executor
  .selectFrom('users')
  .selectAll()
  .execute() // Excludes soft-deleted

// Bypass plugins
const allUsers = await db
  .selectFrom('users')
  .selectAll()
  .execute() // Includes soft-deleted
```

Alternatively, use plugin-specific options:

```typescript
// Some plugins support bypassing
const allUsers = await executor
  .selectFrom('users')
  .selectAll()
  .where('deleted_at', 'is not', null) // Explicit filter
  .execute()
```

---

### Plugin Questions

#### Q: How do I create custom plugins?

**A:** Implement the `KyseraPlugin` interface:

```typescript
import type { KyseraPlugin } from '@kysera/executor'

export function customPlugin(): KyseraPlugin {
  return {
    name: 'custom-plugin',
    transformQuery: async (args) => {
      const { node, executor } = args

      // Modify query AST
      if (node.kind === 'SelectQueryNode') {
        // Add custom WHERE clause, etc.
      }

      return node
    }
  }
}

// Use it
const executor = await createExecutor(db, [customPlugin()])
```

See existing plugins for examples:
- `@kysera/soft-delete` - Simple WHERE clause injection
- `@kysera/rls` - Tenant-based filtering
- `@kysera/audit` - Query interception and logging

---

#### Q: Do plugins work with transactions?

**A:** Yes, plugins are preserved in transactions:

```typescript
import { withTransaction } from '@kysera/dal'

const executor = await createExecutor(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema })
])

const ctx = createContext(executor)

await withTransaction(executor, async txCtx => {
  // Plugins still active in transaction
  const user = await getUserById(txCtx, '1')
  const posts = await getUserPosts(txCtx, '1')

  // Both queries have soft-delete and RLS filters
})
```

For Repository:

```typescript
const orm = await createORM(db, [softDeletePlugin()])

await orm.transaction(async ctx => {
  const userRepo = orm.createRepository(createUserRepository)
  await userRepo.softDelete(1) // Works in transaction
})
```

---

## Additional Resources

- [Core Concepts](/docs/core-concepts/overview)
- [Pagination Guide](/docs/guides/pagination)
- [Error Handling Guide](/docs/core-concepts/error-handling)
- [Plugin Development](/docs/plugins/authoring-guide)
- [GitHub Issues](https://github.com/omnitron-dev/kysera/issues)

---

**Still having issues?** [Open an issue on GitHub](https://github.com/omnitron-dev/kysera/issues/new) with:
- Kysera version (`@kysera/core`, `@kysera/executor`, etc.)
- Database type and version
- Minimal reproduction code
- Error messages and stack traces
