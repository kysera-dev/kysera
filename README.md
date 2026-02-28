<p align="center">
  <img src="website/static/img/logo.png" alt="Kysera" width="120" />
</p>

<h1 align="center">Kysera</h1>

<p align="center">
  <strong>Type-safe data access toolkit for TypeScript, built on <a href="https://kysely.dev">Kysely</a></strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kysera/core"><img src="https://img.shields.io/npm/v/@kysera/core?color=0284c7&label=npm" alt="npm version"></a>
  <a href="https://github.com/kysera-dev/kysera/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kysera-dev/kysera?color=0284c7" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-0284c7" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/runtime-Node%20%7C%20Bun%20%7C%20Deno-0284c7" alt="Cross-runtime">
  <img src="https://img.shields.io/badge/databases-PostgreSQL%20%7C%20MySQL%20%7C%20SQLite%20%7C%20MSSQL-0284c7" alt="Databases">
</p>

<p align="center">
  Repository pattern &bull; Functional DAL &bull; Plugin ecosystem &bull; Not an ORM
</p>

<p align="center">
  <a href="https://kysera.dev">Documentation</a> &bull;
  <a href="https://kysera.dev/docs/getting-started">Getting Started</a> &bull;
  <a href="https://kysera.dev/docs/api/overview">API Reference</a> &bull;
  <a href="https://github.com/kysera-dev/kysera/tree/main/examples">Examples</a>
</p>

---

## Why Kysera?

Kysera extends [Kysely](https://kysely.dev) with production-ready patterns — without hiding the query builder or inventing a new query language. You get repositories, plugins, security, and infrastructure while keeping full control over your SQL.

- **Zero magic** — explicit, traceable, debuggable
- **Zero runtime deps** in core packages
- **Full type safety** — strict TypeScript, no `any`
- **Plugin architecture** — compose behavior across Repository and DAL patterns
- **Cross-runtime** — Node.js, Bun, Deno
- **4,600+ tests** at 95%+ coverage

## Install

```bash
npm install kysely @kysera/core @kysera/executor @kysera/repository
```

## Quick Start

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { timestampsPlugin } from '@kysera/timestamps'

// Define your schema
interface Database {
  users: {
    id: Generated<number>
    email: string
    name: string
    created_at: Generated<Date>
    updated_at: Generated<Date>
    deleted_at: Date | null
  }
}

// Connect
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) })
})

// Create executor with plugins — they apply automatically to all queries
const executor = await createExecutor(db, [
  softDeletePlugin(),
  timestampsPlugin()
])

// Create ORM and repository
const orm = await createORM(executor, [])
const userRepo = orm.createRepository({
  tableName: 'users',
  schemas: { entity: UserSchema, create: CreateUserSchema }
})

// Query — plugins apply transparently
const users = await userRepo.findAll()           // filters deleted, includes timestamps
await userRepo.create({ email: 'a@b.com', name: 'Alice' }) // auto-sets created_at/updated_at
await userRepo.softDelete(1)                      // sets deleted_at instead of DELETE
```

## Packages

### Core

| Package | Description |
|---------|-------------|
| [`@kysera/core`](packages/core) | Errors, pagination, types, logger |
| [`@kysera/executor`](packages/executor) | Unified Execution Layer — plugin-aware Kysely wrapper (zero deps) |
| [`@kysera/repository`](packages/repository) | Repository pattern with Zod validation and MongoDB-style queries |
| [`@kysera/dal`](packages/dal) | Functional Data Access Layer — query functions, context, composition |
| [`@kysera/dialects`](packages/dialects) | Dialect-specific utilities and error parsing |

### Plugins

| Package | Description |
|---------|-------------|
| [`@kysera/soft-delete`](packages/soft-delete) | Soft delete with automatic query filtering |
| [`@kysera/timestamps`](packages/timestamps) | Auto `created_at` / `updated_at` management |
| [`@kysera/audit`](packages/audit) | Audit logging with restore support |
| [`@kysera/rls`](packages/rls) | Row-Level Security — declarative policies, native PostgreSQL RLS |

### Infrastructure

| Package | Description |
|---------|-------------|
| [`@kysera/infra`](packages/infra) | Health checks, retry, circuit breaker, graceful shutdown |
| [`@kysera/debug`](packages/debug) | Query logging, profiling, SQL formatting |
| [`@kysera/testing`](packages/testing) | Transaction isolation, factories, seeding |
| [`@kysera/migrations`](packages/migrations) | Migration system with dry-run and rollback |

### CLI

| Package | Description |
|---------|-------------|
| [`@kysera/cli`](apps/cli) | Migrations, codegen, health monitoring, schema management |

## Features

### Unified Execution Layer

The executor is the foundation — plugins defined once work across Repository and DAL patterns:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

const executor = await createExecutor(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema })
])

// Direct query — plugins apply automatically
const users = await executor.selectFrom('users').selectAll().execute()
```

### MongoDB-Style Query Operators

Repository `find()` supports expressive filtering with type-safe operators:

```typescript
const users = await userRepo.find({
  where: {
    age: { $gte: 18, $lte: 65 },
    status: { $in: ['active', 'pending'] },
    email: { $contains: '@company.com' },
    name: { $startsWith: 'A' },
    score: { $between: [80, 100] }
  },
  sort: [{ column: 'created_at', direction: 'desc' }],
  limit: 20
})
```

**Operators:** `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` `$in` `$nin` `$like` `$ilike` `$contains` `$startsWith` `$endsWith` `$isNull` `$isNotNull` `$between` `$or` `$and`

### Functional DAL

For complex reads, use composable query functions:

```typescript
import { createQuery, createContext, withTransaction, compose, parallel } from '@kysera/dal'

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').where('id', '=', id).executeTakeFirst()
)

const getUserPosts = createQuery((ctx, userId: number) =>
  ctx.db.selectFrom('posts').where('user_id', '=', userId).execute()
)

// Compose and execute
const ctx = createContext(executor)
const user = await getUserById(ctx, 1)

// Parallel queries
const [user, posts] = await parallel(ctx, getUserById, getUserPosts)(ctx, 1, 1)

// Transactions preserve plugins
await withTransaction(ctx, async (txCtx) => {
  const user = await getUserById(txCtx, 1)   // plugins still active
})
```

### Row-Level Security

Declarative policies that transform queries at the executor level:

```typescript
import { createRLSSchema, allow, filter } from '@kysera/rls'

const rlsSchema = createRLSSchema({
  users: {
    policies: [
      allow('select').to('admin'),
      filter('select').to('user').where((ctx) => ({
        column: 'tenant_id',
        op: '=',
        value: ctx.tenantId
      }))
    ]
  }
})

const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema })
])
```

### Error Handling

Structured, dialect-aware error parsing:

```typescript
import { parseDatabaseError, UniqueConstraintError, ForeignKeyError } from '@kysera/core'

try {
  await userRepo.create(data)
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')
  if (dbError instanceof UniqueConstraintError) {
    console.log(dbError.constraint, dbError.columns)
  }
}
```

### Pagination

Offset and cursor-based pagination out of the box:

```typescript
import { paginate, paginateCursor } from '@kysera/core'

// Offset
const page = await paginate(query, { page: 1, limit: 20 })
// → { data, total, page, limit, totalPages, hasNext, hasPrev }

// Cursor (for infinite scroll / real-time feeds)
const feed = await paginateCursor(query, {
  orderBy: [{ column: 'created_at', direction: 'desc' }],
  limit: 20,
  after: lastCursor
})
// → { data, cursor, hasMore }
```

### Infrastructure

Production-ready resilience and observability:

```typescript
import { createHealthCheck } from '@kysera/infra/health'
import { withRetry, createCircuitBreaker } from '@kysera/infra/resilience'
import { gracefulShutdown } from '@kysera/infra/shutdown'

// Health checks
const health = createHealthCheck(db, { interval: 30_000 })

// Retry with exponential backoff
const result = await withRetry(() => fetchData(), {
  maxRetries: 3,
  backoff: 'exponential'
})

// Circuit breaker
const breaker = createCircuitBreaker({ threshold: 5, timeout: 30_000 })

// Graceful shutdown
gracefulShutdown({ db, onShutdown: () => console.log('bye') })
```

## CLI

```bash
npm install -g @kysera/cli

# Initialize project
kysera init

# Migrations
kysera migrate create add-users-table
kysera migrate up
kysera migrate status
kysera migrate rollback --steps 1

# Code generation
kysera generate model User
kysera generate repository User --with-tests
kysera generate crud User --with-api

# Database tools
kysera db seed
kysera health check
kysera debug explain "SELECT * FROM users"
```

## Architecture

```
@kysera/executor (0 deps) ← Foundation
    │
    ├── @kysera/dal ──────── Functional queries
    │
    └── @kysera/repository ─ Repository pattern
            │
            ├── @kysera/soft-delete
            ├── @kysera/timestamps
            ├── @kysera/audit
            └── @kysera/rls

@kysera/core (0 deps) ─── Shared errors, pagination, types
@kysera/dialects ───────── PostgreSQL, MySQL, SQLite, MSSQL
@kysera/infra ──────────── Health, retry, circuit breaker
@kysera/debug ──────────── Logging, profiling
@kysera/testing ────────── Factories, seeding, isolation
@kysera/migrations ─────── Schema versioning
```

## Examples

Working examples in [`examples/`](examples/):

- **[blog-app](examples/blog-app)** — Posts, comments, tags with soft-delete and audit
- **[e-commerce](examples/e-commerce)** — Products, orders, payments with transactions
- **[multi-tenant-saas](examples/multi-tenant-saas)** — Tenant isolation with RLS and schema separation

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm test             # Run tests (4,600+)
pnpm test:coverage    # With coverage report
pnpm test:multi-db    # PostgreSQL + MySQL + SQLite
pnpm dev              # Watch mode
pnpm typecheck        # Type checking
pnpm lint             # ESLint
```

**Requirements:** Node.js >=20, pnpm >=10, TypeScript ^5.9

## Documentation

Full docs at **[kysera.dev](https://kysera.dev)**

- [Getting Started](https://kysera.dev/docs/getting-started)
- [Core Concepts](https://kysera.dev/docs/core-concepts/overview)
- [API Reference](https://kysera.dev/docs/api/overview)
- [Plugin Guide](https://kysera.dev/docs/plugins/overview)
- [CLI Reference](https://kysera.dev/docs/cli/overview)

## License

[MIT](LICENSE)
