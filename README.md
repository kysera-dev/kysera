# Kysera 🚀

Type-safe data access toolkit for TypeScript — Repository pattern, Functional DAL, and plugins for Kysely. Not an ORM.

## Quick Start (5 Minutes to First Query)

```bash
# Install Kysely (required)
npm install kysely pg

# Install Kysera packages (optional, pick what you need)
npm install @kysera/core           # Errors, pagination, types, logger
npm install @kysera/repository zod # Repository pattern with validation
npm install @kysera/infra          # Health checks, retry, circuit breaker
npm install @kysera/debug          # Query logging and profiling
npm install @kysera/testing        # Test utilities and factories
npm install @kysera/dal            # Functional Data Access Layer
npm install @kysera/soft-delete    # Soft delete plugin
npm install @kysera/audit          # Audit logging plugin
npm install @kysera/timestamps     # Auto timestamps plugin
npm install @kysera/migrations     # Migration system
npm install @kysera/rls            # Row-Level Security
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
const users = await db
  .selectFrom('users')
  .selectAll()
  .execute()
```

## Core Philosophy

### 1. Minimal Core, Optional Everything
- Core contains only essentials: errors, pagination, types
- Infrastructure (health, retry) in separate package
- All features are opt-in plugins
- Tree-shakeable ESM architecture

### 2. Explicit Over Implicit
- Every operation is traceable
- No hidden context propagation
- Transaction boundaries are clear
- No automatic behaviors

### 3. Smart Validation Strategy
- Validate external inputs always
- Trust database outputs (configurable)
- Support for multiple validation libraries (Zod, Valibot, ArkType, Yup)
- Performance-conscious approach

### 4. Functional Architecture
- Functions over classes
- No `this` context issues
- Composable patterns
- Dependency injection friendly

### 5. Production-First Design
- Health checks and monitoring
- Graceful shutdown support
- Circuit breaker and retry patterns
- Comprehensive error handling

## Packages

### Core Packages

| Package | Description | Version |
|---------|-------------|---------|
| `@kysera/core` | Core utilities - errors, pagination, types, logger | 0.6.0 |
| `@kysera/repository` | Repository pattern with smart validation | 0.6.0 |
| `@kysera/dal` | Functional Data Access Layer - query composition | 0.6.0 |

### Infrastructure

| Package | Description | Version |
|---------|-------------|---------|
| `@kysera/infra` | Health checks, retry, circuit breaker, graceful shutdown | 0.6.0 |
| `@kysera/debug` | Query logging, profiling, SQL formatting | 0.6.0 |
| `@kysera/testing` | Test utilities - transaction isolation, factories, seeding | 0.6.0 |
| `@kysera/migrations` | Migration system with dry-run support | 0.6.0 |

### Plugins

| Package | Description | Version |
|---------|-------------|---------|
| `@kysera/soft-delete` | Soft delete with auto-filtering | 0.6.0 |
| `@kysera/audit` | Audit logging with bulk optimization | 0.6.0 |
| `@kysera/timestamps` | Auto created_at/updated_at | 0.6.0 |
| `@kysera/rls` | Row-Level Security policies | 0.6.0 |

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
│   ├── repository/    # Repository pattern
│   ├── dal/           # Functional Data Access Layer
│   ├── infra/         # Infrastructure (health, retry, shutdown)
│   ├── debug/         # Query debugging and profiling
│   ├── testing/       # Test utilities
│   ├── migrations/    # Migration system
│   ├── soft-delete/   # Soft delete plugin
│   ├── audit/         # Audit logging plugin
│   ├── timestamps/    # Timestamps plugin
│   └── rls/           # Row-Level Security plugin
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

### Error Handling

Multi-database error parsing with typed errors:

```typescript
import { DatabaseError, parseDatabaseError } from '@kysera/core'

try {
  await userRepo.create(userData)
} catch (error) {
  const dbError = parseDatabaseError(error)

  if (dbError instanceof UniqueConstraintError) {
    // Handle unique constraint violation
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
monitor.on('unhealthy', (result) => alertOps(result))
monitor.start()
```

### Resilience Patterns

Built-in retry and circuit breaker:

```typescript
import { withRetry, CircuitBreaker } from '@kysera/infra'

// Retry with exponential backoff
const result = await withRetry(
  () => db.selectFrom('users').execute(),
  { maxAttempts: 3, backoff: 'exponential' }
)

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

### Functional DAL

Query composition without classes:

```typescript
import { createQuery, withTransaction, compose } from '@kysera/dal'

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').where('id', '=', id).executeTakeFirst()
)

const getUserWithPosts = compose(
  getUserById,
  async (ctx, user) => ({
    ...user,
    posts: await getPostsByUserId(ctx, user.id)
  })
)

// Execute in transaction
const result = await withTransaction(db, async (ctx) => {
  return getUserWithPosts(ctx, 1)
})
```

### Repository Pattern (Optional)

Type-safe repository with smart validation:

```typescript
import { createRepositoryFactory } from '@kysera/repository'

const factory = createRepositoryFactory(db)

const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at
  }),
  schemas: {
    entity: UserSchema,      // Zod schema
    create: CreateUserSchema,
    update: UpdateUserSchema
  },
  validateDbResults: process.env.NODE_ENV === 'development'
})
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
  await testInTransaction(db, async (trx) => {
    const userData = userFactory({ name: 'Alice' })
    const user = await trx.insertInto('users').values(userData).execute()
    expect(user.name).toBe('Alice')
  })
  // Automatically rolled back!
})
```

### Plugin System

Extend functionality with plugins:

```typescript
import { softDeletePlugin } from '@kysera/soft-delete'
import { createORM } from '@kysera/repository'

const orm = createORM(db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' })
])

const userRepo = orm.createRepository(createUserRepository)

// Automatically filters deleted records
const users = await userRepo.findAll()

// Include deleted records
const allUsers = await userRepo.findAllWithDeleted()
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

**Current Version**: 0.6.0 (Stable)
**Total Packages**: 12
**Test Coverage**: 2500+ tests passing
**Phase 5**: ✅ COMPLETED

### Completed Features

- [x] Core utilities package - Errors, pagination, types, logger
- [x] Repository pattern - Smart validation, type-safe operations
- [x] Functional DAL - Query composition, context passing
- [x] Infrastructure package - Health checks, retry, circuit breaker, shutdown
- [x] Debug package - Query logging, profiling, SQL formatting
- [x] Testing utilities - Transaction isolation, factories, seeding
- [x] Soft delete plugin - Method override with auto-filtering
- [x] Audit plugin - Transaction-aware logging with bulk optimization
- [x] Timestamps plugin - Automatic created_at/updated_at
- [x] RLS plugin - Row-Level Security policies
- [x] Migration system - Up/down migrations with dry-run
- [x] CLI tool - Full-featured command-line interface
- [x] Multi-database support - PostgreSQL, MySQL, SQLite
- [x] Vertical Slice Architecture support

### Test Statistics

| Package | Tests | Status |
|---------|-------|--------|
| @kysera/cli | 1400 | ✅ Production Ready |
| @kysera/rls | 303 | ✅ Production Ready |
| @kysera/repository | 200+ | ✅ Production Ready |
| @kysera/testing | 117 | ✅ Production Ready |
| @kysera/audit | 109 | ✅ Production Ready |
| @kysera/migrations | 64 | ✅ Production Ready |
| @kysera/infra | 50+ | ✅ Production Ready |
| @kysera/soft-delete | 39+ | ✅ Production Ready |
| @kysera/dal | 37 | ✅ Production Ready |
| @kysera/debug | 30+ | ✅ Production Ready |
| @kysera/core | 30+ | ✅ Production Ready |
| @kysera/timestamps | 16+ | ✅ Production Ready |
| **Total** | **2500+** | **All Passing** |

### Architecture (v0.6.0)

```
┌─────────────────────────────────────────────────────────────┐
│                      @kysera/cli                            │
├─────────────────────────────────────────────────────────────┤
│  @kysera/dal  │  @kysera/repository  │  @kysera/migrations  │
├───────────────┼──────────────────────┼──────────────────────┤
│               │     @kysera/rls      │   @kysera/testing    │
│               │  @kysera/soft-delete │                      │
│               │    @kysera/audit     │                      │
│               │  @kysera/timestamps  │                      │
├───────────────┴──────────────────────┴──────────────────────┤
│     @kysera/infra     │     @kysera/debug     │             │
├───────────────────────┴───────────────────────┴─────────────┤
│                       @kysera/core                          │
├─────────────────────────────────────────────────────────────┤
│                         Kysely                              │
└─────────────────────────────────────────────────────────────┘
```

### Roadmap

**Phase 1-4** (✅ COMPLETED):
- Core utilities and repository pattern
- Plugin architecture and multi-database support
- Comprehensive documentation and examples
- Test coverage and security improvements

**Phase 5** (✅ COMPLETED):
- Vertical Slice Architecture support
- Package separation (dal, debug, infra, testing)
- Validation library abstraction (Zod, Valibot, ArkType, Yup)
- CLI improvements and new commands
- 2500+ tests across 12 packages

**Phase 6** (Next):
- Community feedback integration
- Additional database adapters
- Advanced caching strategies
- Performance benchmarks publication
- GraphQL integration exploration

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
