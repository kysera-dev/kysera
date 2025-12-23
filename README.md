# Kysera

**Version 0.7.3** — Type-safe data access toolkit for TypeScript built on Kysely. Repository pattern, Functional DAL, and plugin ecosystem. Not an ORM.

## What's New in 0.7.x

### 0.7.3 - Security & Plugin Lifecycle (December 2025)

- **Security Fixes**: SQL injection prevention in testing utilities, proper error handling in dialect adapters
- **Plugin Lifecycle**: Added `onDestroy` hook for resource cleanup (pairs with existing `onInit`)
- **Schema Support**: `withSchema()` now maintains plugin interception (was bypassing plugins in 0.7.0-0.7.2)
- **Cross-Runtime**: Enhanced compatibility for Node.js, Bun, and Deno

### 0.7.0 - Unified Execution Layer (Major Architecture Update)

- **@kysera/executor**: New foundation package enabling plugins to work across both Repository and DAL patterns
- **Plugin Interception**: Write plugins once, use them everywhere (no more separate Repository vs DAL plugins)
- **Breaking Change**: Both `@kysera/dal` and `@kysera/repository` now require `@kysera/executor`
- **Migration**: Update plugin imports from `@kysera/repository` to `@kysera/executor`

## Quick Start (5 Minutes to First Query)

```bash
# Install Kysely (required peer dependency)
npm install kysely pg

# Install Kysera packages (pick what you need)
npm install @kysera/core           # Errors, pagination, types, logger
npm install @kysera/executor       # Unified Execution Layer (required for plugins)
npm install @kysera/repository zod # Repository pattern with validation
npm install @kysera/dal            # Functional Data Access Layer
npm install @kysera/soft-delete    # Soft delete plugin
npm install @kysera/audit          # Audit logging plugin
npm install @kysera/timestamps     # Auto timestamps plugin
npm install @kysera/rls            # Row-Level Security plugin
npm install @kysera/infra          # Health checks, retry, circuit breaker
npm install @kysera/debug          # Query logging and profiling
npm install @kysera/testing        # Test utilities and factories
npm install @kysera/migrations     # Migration system
```

```typescript
// 1. Define schema
import { Generated } from 'kysely'

interface Database {
  users: {
    id: Generated<number>
    email: string
    name: string
    created_at: Generated<Date>
  }
}

// 2. Connect
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.DATABASE_URL
    })
  })
})

// 3. Query - that's it!
const users = await db.selectFrom('users').selectAll().execute()
```

## Core Philosophy

### 1. Unified Execution Layer — The Foundation

**@kysera/executor** is the cornerstone that enables plugins to work seamlessly across both Repository and DAL patterns:

- **Single plugin interception point** — Write plugins once, use them everywhere
- **Schema-aware** — `withSchema()` maintains plugin interception
- **Lifecycle hooks** — `onInit` and `onDestroy` for resource management
- **Zero runtime overhead** — Proxy-based interception with minimal performance impact

### 2. Minimal Core, Optional Everything

- Core contains only essentials: errors, pagination, types
- Infrastructure (health, retry) in separate package
- All features are opt-in plugins
- Tree-shakeable ESM architecture

### 3. Explicit Over Implicit

- Every operation is traceable
- No hidden context propagation
- Transaction boundaries are clear
- No automatic behaviors

### 4. Smart Validation Strategy

- Validate external inputs always
- Trust database outputs (configurable)
- Support for multiple validation libraries (Zod, Valibot, ArkType, Yup)
- Performance-conscious approach

### 5. Cross-Runtime Compatibility

- **Node.js** >= 20.0.0 (primary, fully tested)
- **Bun** >= 1.0.0 (fully supported, native speed)
- **Deno** (experimental support)
- No runtime-specific APIs in core packages

### 6. Production-First Design

- Health checks and monitoring
- Graceful shutdown support
- Circuit breaker and retry patterns
- Comprehensive error handling
- SQL injection prevention
- Proper error propagation

## Packages

### Core Packages

| Package              | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `@kysera/core`       | Core utilities - errors, pagination, types, logger             |
| `@kysera/executor`   | Unified Execution Layer - plugin interception foundation       |
| `@kysera/repository` | Repository pattern with smart validation (uses executor)       |
| `@kysera/dal`        | Functional Data Access Layer - query composition (uses executor) |

### Infrastructure

| Package              | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `@kysera/infra`      | Health checks, retry, circuit breaker, graceful shutdown   |
| `@kysera/debug`      | Query logging, profiling, SQL formatting                   |
| `@kysera/testing`    | Test utilities - transaction isolation, factories, seeding |
| `@kysera/migrations` | Migration system with dry-run support                      |

### Plugins

| Package               | Description                          |
| --------------------- | ------------------------------------ |
| `@kysera/soft-delete` | Soft delete with auto-filtering      |
| `@kysera/audit`       | Audit logging with bulk optimization |
| `@kysera/timestamps`  | Auto created_at/updated_at           |
| `@kysera/rls`         | Row-Level Security policies          |

## Development

This is a monorepo managed with Turborepo and pnpm.

### Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Development mode
pnpm dev
```

### Project Structure

```
kysera/
├── packages/
│   ├── core/          # Core utilities (errors, pagination, types)
│   ├── executor/      # Unified Execution Layer (plugin foundation)
│   ├── repository/    # Repository pattern (depends on executor)
│   ├── dal/           # Functional Data Access Layer (depends on executor)
│   ├── soft-delete/   # Soft delete plugin
│   ├── audit/         # Audit logging plugin
│   ├── timestamps/    # Timestamps plugin
│   ├── rls/           # Row-Level Security plugin
│   ├── infra/         # Infrastructure (health, retry, shutdown)
│   ├── debug/         # Query debugging and profiling
│   ├── testing/       # Test utilities
│   ├── migrations/    # Migration system
│   └── dialects/      # Database-specific adapters
├── apps/
│   └── cli/           # Kysera CLI tool
├── examples/
│   ├── blog-app/           # Blog application example
│   ├── e-commerce/         # E-commerce with transactions
│   └── multi-tenant-saas/  # Multi-tenant SaaS patterns
├── website/           # Documentation website
└── turbo.json         # Turborepo configuration
```

### Running the Example

```bash
# Navigate to example
cd examples/blog-app

# Set up database (PostgreSQL required)
createdb blog_example

# Run migrations
pnpm migrate

# Run the example
pnpm dev
```

## Core Features

### Unified Execution Layer (New in 0.7.0)

The executor provides a foundation for plugins to work across both Repository and DAL patterns:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

// Create plugin-aware executor
const executor = await createExecutor(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema })
])

// Plugins automatically apply to all queries
const users = await executor.selectFrom('users').selectAll().execute()

// withSchema() maintains plugin interception (fixed in 0.7.3)
const otherSchema = executor.withSchema('other_schema')
await otherSchema.selectFrom('users').selectAll().execute() // Plugins still active!

// Use with Repository pattern
import { createORM } from '@kysera/repository'
const orm = await createORM(executor, []) // Inherits executor's plugins
const userRepo = orm.createRepository(createUserRepository)

// Use with DAL pattern
import { createContext } from '@kysera/dal'
const ctx = createContext(executor) // Inherits executor's plugins
const user = await getUser(ctx, '1')
```

**Plugin Lifecycle Hooks:**

```typescript
export const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',

  // Called when executor is initialized
  async onInit(executor) {
    // Initialize resources, open connections, etc.
  },

  // Called when executor is destroyed (new in 0.7.3)
  async onDestroy() {
    // Cleanup resources, close connections, clear timers
  },

  // Intercept queries before execution
  interceptQuery(qb, context) {
    if (context.operation === 'select') {
      return qb.where('active', '=', true)
    }
    return qb
  }
}
```

### Error Handling

Multi-database error parsing with typed errors:

```typescript
import { DatabaseError, parseDatabaseError } from '@kysera/core'

try {
  await userRepo.create(userData)
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres') // postgres, mysql, sqlite

  if (dbError instanceof UniqueConstraintError) {
    // Handle unique constraint violation
    console.error(`Duplicate ${dbError.constraint}: ${dbError.message}`)
  } else if (dbError instanceof ForeignKeyConstraintError) {
    // Handle foreign key violation
  }
}
```

### Health Checks

Monitor database connection health:

```typescript
import { checkDatabaseHealth, HealthMonitor } from '@kysera/infra'

// Simple health check
const health = await checkDatabaseHealth(db, pool)
// { status: 'healthy', checks: [...], metrics: {...} }

// Continuous monitoring
const monitor = new HealthMonitor(db, { interval: 30000 })
monitor.on('unhealthy', result => alertOps(result))
monitor.start()
```

### Resilience Patterns

Built-in retry and circuit breaker:

```typescript
import { withRetry, CircuitBreaker } from '@kysera/infra'

// Retry with exponential backoff
const result = await withRetry(() => db.selectFrom('users').execute(), {
  maxAttempts: 3,
  backoff: 'exponential'
})

// Circuit breaker for external calls
const breaker = new CircuitBreaker({ threshold: 5, resetTimeout: 60000 })
const data = await breaker.execute(() => fetchExternalData())
```

### Query Debugging

Profile and debug queries:

```typescript
import { withDebug, QueryProfiler } from '@kysera/debug'

// Add debug capabilities
const debugDb = withDebug(db, {
  logQueries: true,
  slowQueryThreshold: 100
})

// Profile queries
const profiler = new QueryProfiler()
profiler.start()
// ... run queries ...
const report = profiler.getReport()
console.log(report.slowQueries)
```

### Pagination

Both offset and cursor-based pagination:

```typescript
import { paginate, paginateCursor } from '@kysera/core'

// Offset pagination
const result = await paginate(query, { page: 1, limit: 20 })

// Cursor pagination
const result = await paginateCursor(query, {
  orderBy: [{ column: 'created_at', direction: 'desc' }],
  limit: 20
})
```

### Functional DAL with Plugin Support

Query composition without classes, with automatic plugin interception:

```typescript
import { createQuery, withTransaction, compose, createContext } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// Define queries (plugins automatically apply)
const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').where('id', '=', id).executeTakeFirst()
)

const getUserWithPosts = compose(getUserById, async (ctx, user) => ({
  ...user,
  posts: await getPostsByUserId(ctx, user.id)
}))

// Create context with plugin-aware executor
const ctx = createContext(executor)
const user = await getUserById(ctx, 1) // Soft-delete filter automatically applied!

// Transactions preserve plugins
const result = await withTransaction(executor, async txCtx => {
  return getUserWithPosts(txCtx, 1) // Plugins work in transactions too
})
```

### Repository Pattern with Plugin Support

Type-safe repository with smart validation and plugin interception:

```typescript
import { createORM } from '@kysera/repository'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { auditPlugin } from '@kysera/audit'
import { timestampsPlugin } from '@kysera/timestamps'

// Create executor with plugins
const executor = await createExecutor(db, [
  softDeletePlugin(),
  timestampsPlugin(),
  auditPlugin()
])

// Create ORM with plugin-aware executor
const orm = await createORM(executor, []) // Inherits executor's plugins

// Define repository
const userRepo = orm.createRepository({
  tableName: 'users',
  mapRow: row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at
  }),
  schemas: {
    entity: UserSchema, // Zod, Valibot, ArkType, or Yup schema
    create: CreateUserSchema,
    update: UpdateUserSchema
  },
  validateDbResults: process.env.NODE_ENV === 'development'
})

// All repository methods automatically get:
// - Soft-delete filtering on queries
// - created_at/updated_at timestamps
// - Audit logging
const users = await userRepo.findAll() // Only non-deleted users
const user = await userRepo.create({ email: 'alice@example.com', name: 'Alice' })
// ↑ Automatically sets created_at, updated_at, and logs audit trail
```

### Testing Utilities

Isolated database testing:

```typescript
import { testInTransaction, createFactory } from '@kysera/testing'

const userFactory = createFactory({
  email: () => `user-${Date.now()}@test.com`,
  name: 'Test User'
})

it('creates user', async () => {
  await testInTransaction(db, async trx => {
    const userData = userFactory({ name: 'Alice' })
    const user = await trx.insertInto('users').values(userData).execute()
    expect(user.name).toBe('Alice')
  })
  // Automatically rolled back!
})
```

### Plugin System — Write Once, Use Everywhere

Extend functionality with plugins that work in both Repository and DAL patterns:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

// Create executor with plugins (works with both Repository and DAL)
const executor = await createExecutor(db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' }),
  rlsPlugin({ schema: rlsSchema, contextProvider: getCurrentUser })
])

// Option 1: Use with Repository pattern
import { createORM } from '@kysera/repository'
const orm = await createORM(executor, [])
const userRepo = orm.createRepository(createUserRepository)
const users = await userRepo.findAll() // Automatically filters deleted and applies RLS

// Option 2: Use with DAL pattern
import { createContext } from '@kysera/dal'
const ctx = createContext(executor)
const users = await getUsers(ctx) // Same plugins apply!

// Option 3: Use executor directly
const users = await executor.selectFrom('users').selectAll().execute()
// Same plugins apply here too!
```

**Security Note:** SQL template queries bypass plugin interception for performance. Use with caution:

```typescript
// ⚠️ This bypasses all plugins (soft-delete, RLS, etc.)
await sql`SELECT * FROM users WHERE id = ${userId}`.execute(executor)

// ✅ Use query builders for plugin interception
await executor.selectFrom('users').where('id', '=', userId).selectAll().execute()
```

## Testing

The project uses Vitest for testing with high coverage requirements (>95%).

```bash
# Run tests for all packages
pnpm test

# Run tests in watch mode
pnpm test:watch

# Generate coverage report
pnpm test:coverage
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT

## Project Status

**Version**: 0.7.3
**Total Packages**: 13
**Status**: Production Ready
**Kysely Compatibility**: >= 0.28.9
**Runtime Support**: Node.js >= 20.0.0, Bun >= 1.0.0, Deno (experimental)

### Completed Features

- [x] **Core utilities package** - Errors, pagination, types, logger
- [x] **Unified Execution Layer** - Plugin interception foundation (@kysera/executor)
- [x] **Repository pattern** - Smart validation, type-safe operations (uses executor)
- [x] **Functional DAL** - Query composition, context passing (uses executor)
- [x] **Plugin system** - Write once, use everywhere (Repository + DAL)
- [x] **Soft delete plugin** - Auto-filtering with restore capability
- [x] **RLS plugin** - Row-Level Security policies
- [x] **Audit plugin** - Transaction-aware logging with bulk optimization
- [x] **Timestamps plugin** - Automatic created_at/updated_at
- [x] **Infrastructure package** - Health checks, retry, circuit breaker, shutdown
- [x] **Debug package** - Query logging, profiling, SQL formatting
- [x] **Testing utilities** - Transaction isolation, factories, cleanup
- [x] **Migration system** - Up/down migrations with dry-run
- [x] **Dialects package** - PostgreSQL, MySQL, SQLite adapters
- [x] **CLI tool** - Full-featured command-line interface
- [x] **Multi-database support** - PostgreSQL, MySQL, SQLite
- [x] **Cross-runtime compatibility** - Node.js, Bun, Deno
- [x] **Vertical Slice Architecture** support

### Recent Security Fixes (0.7.3)

- [x] SQL injection prevention in testing utilities
- [x] Proper error handling in dialect adapters
- [x] withSchema() now maintains plugin interception
- [x] onDestroy lifecycle hook for resource cleanup

### Architecture

**The Unified Execution Layer (@kysera/executor) is the foundation:**

```
┌─────────────────────────────────────────────────────────────────┐
│                         @kysera/cli                             │
├─────────────────────────────────────────────────────────────────┤
│  @kysera/dal  │  @kysera/repository  │  @kysera/migrations     │
│   (uses       │    (uses executor)   │                         │
│   executor)   │                      │                         │
├───────────────┴──────────────────────┴─────────────────────────┤
│                    Plugin Ecosystem                             │
│  @kysera/soft-delete │ @kysera/rls │ @kysera/audit │ @kysera/  │
│  @kysera/timestamps  │ (all use executor for interception)     │
├─────────────────────────────────────────────────────────────────┤
│              @kysera/executor (Unified Execution Layer)         │
│  • Plugin interception • withSchema() proxy • Lifecycle hooks   │
├─────────────────────────────────────────────────────────────────┤
│  @kysera/infra  │  @kysera/debug  │  @kysera/testing  │ @kysera│
│                 │                 │                   │ /dialects│
├─────────────────┴─────────────────┴───────────────────┴────────┤
│                       @kysera/core                              │
│           (errors, pagination, types, logger)                   │
├─────────────────────────────────────────────────────────────────┤
│                         Kysely >= 0.28.9                        │
│                    (peer dependency)                            │
└─────────────────────────────────────────────────────────────────┘
```

**Key Architectural Principles:**

1. **@kysera/executor** is the foundation that enables plugins to work across both Repository and DAL patterns
2. **Both @kysera/dal and @kysera/repository depend on @kysera/executor** for plugin interception
3. **All plugins** (soft-delete, RLS, audit, timestamps) depend on @kysera/executor
4. **@kysera/core** has zero dependencies and provides shared utilities
5. **Kysely** is a peer dependency (>= 0.28.9) for all packages

**Package Dependency Tree:**

```
@kysera/executor (0 deps, depends on Kysely peer)
    │
    ├── @kysera/dal → executor
    │
    ├── @kysera/repository → executor, dal
    │
    └── Plugins (all depend on executor):
        ├── @kysera/soft-delete → executor, core
        ├── @kysera/rls → executor, core
        ├── @kysera/audit → core
        └── @kysera/timestamps → core

@kysera/core (0 deps)
@kysera/infra → core
@kysera/debug → core
@kysera/testing (0 deps)
@kysera/dialects → core
@kysera/migrations → core
```

### Quick Links

- 📖 [Documentation Website](./website) - Full documentation
- 📝 [Development Principles](./CLAUDE.md) - Codebase philosophy

## Philosophy

> "Start minimal, grow as needed, stay transparent."

Kysera believes in:

- **No magic** - Everything is explicit and traceable
- **Performance first** - Minimal overhead on top of Kysely
- **Type safety** - Full TypeScript support with proper types
- **Modularity** - Use only what you need
- **Production ready** - Built for real-world applications
- **Security first** - SQL injection prevention, proper error handling, secure by default

## Version & Compatibility

### Current Version

- **Kysera**: 0.7.3
- **Kysely Peer Dependency**: >= 0.28.9
- **TypeScript**: ^5.9.2
- **Package Manager**: pnpm >= 10.0.0

### Runtime Support

| Runtime | Version      | Status              | Notes                                    |
| ------- | ------------ | ------------------- | ---------------------------------------- |
| Node.js | >= 20.0.0    | Fully Supported     | Primary development and testing platform |
| Bun     | >= 1.0.0     | Fully Supported     | Native speed, all tests passing          |
| Deno    | Latest       | Experimental        | Basic functionality works                |

### Database Support

| Database   | Version  | Dialect Package          | Status          |
| ---------- | -------- | ------------------------ | --------------- |
| PostgreSQL | >= 12.0  | `pg` or `postgres`       | Fully Supported |
| MySQL      | >= 8.0   | `mysql2`                 | Fully Supported |
| SQLite     | >= 3.35  | `better-sqlite3`         | Fully Supported |

### Migration Guide (0.6.x → 0.7.x)

**Breaking Changes:**

1. **Plugin imports** - Change from `@kysera/repository` to `@kysera/executor`:

```typescript
// Old (0.6.x)
import type { Plugin } from '@kysera/repository'

// New (0.7.x)
import type { Plugin } from '@kysera/executor'
```

2. **createORM signature** - Now accepts executor or db:

```typescript
// Old (0.6.x)
const orm = createORM(db, [softDeletePlugin()])

// New (0.7.x) - Option 1: Use executor (recommended)
const executor = await createExecutor(db, [softDeletePlugin()])
const orm = await createORM(executor, [])

// New (0.7.x) - Option 2: Pass plugins to createORM
const orm = await createORM(db, [softDeletePlugin()])
```

3. **DAL context** - Pass executor instead of raw db for plugin support:

```typescript
// Old (0.6.x) - Plugins didn't work in DAL
const ctx = createContext(db)

// New (0.7.x) - Plugins work automatically
const executor = await createExecutor(db, [softDeletePlugin()])
const ctx = createContext(executor)
```

**New Features in 0.7.x:**

- `onDestroy` lifecycle hook for plugins (0.7.3)
- `withSchema()` maintains plugin interception (0.7.3)
- Unified plugin system across Repository and DAL (0.7.0)
- Better error handling and SQL injection prevention (0.7.3)
