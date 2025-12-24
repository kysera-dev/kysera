# Kysera

Type-safe data access toolkit for TypeScript built on Kysely. Repository pattern, Functional DAL, and plugin ecosystem. Not an ORM.

## Quick Start

```bash
npm install kysely pg @kysera/core @kysera/executor @kysera/repository zod
```

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

// 1. Define schema
interface Database {
  users: { id: Generated<number>; email: string; name: string }
}

// 2. Connect
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) })
})

// 3. Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// 4. Create ORM
const orm = await createORM(executor, [])
const userRepo = orm.createRepository(createUserRepository)

// 5. Query - plugins apply automatically
const users = await userRepo.findAll() // Automatically filters deleted records
```

**Supported Databases:** PostgreSQL, MySQL, SQLite, MSSQL

## Packages

### Core
| Package | Description |
|---------|-------------|
| `@kysera/core` | Errors, pagination, types, logger |
| `@kysera/executor` | Unified Execution Layer - plugin-aware Kysely wrapper |
| `@kysera/repository` | Repository pattern with smart validation |
| `@kysera/dal` | Functional Data Access Layer with plugin integration |
| `@kysera/dialects` | Dialect-specific utilities for PostgreSQL, MySQL, SQLite |

### Plugins
| Package | Description |
|---------|-------------|
| `@kysera/soft-delete` | Soft delete with auto-filtering |
| `@kysera/audit` | Audit logging |
| `@kysera/timestamps` | Automatic created_at/updated_at management |
| `@kysera/rls` | Row-Level Security with native RLS support |

### Infrastructure
| Package | Description |
|---------|-------------|
| `@kysera/infra` | Health checks, retry, circuit breaker, graceful shutdown |
| `@kysera/debug` | Query logging, profiling, SQL formatting |
| `@kysera/testing` | Transaction isolation, factories, seeding |
| `@kysera/migrations` | Migration system with dry-run support |

### CLI
| Package | Description |
|---------|-------------|
| `@kysera/cli` | Command-line tool for migrations, codegen, and more |

## Core Features

### Unified Execution Layer

Plugins work across both Repository and DAL patterns:

```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'

const executor = await createExecutor(db, [softDeletePlugin()])

// Works everywhere
const users = await executor.selectFrom('users').selectAll().execute()
```

### Repository Pattern

```typescript
const userRepo = orm.createRepository({
  tableName: 'users',
  schemas: { entity: UserSchema, create: CreateUserSchema },
})

const users = await userRepo.findAll()
await userRepo.create({ email: 'alice@example.com', name: 'Alice' })
```

### Functional DAL

```typescript
import { createQuery, createContext } from '@kysera/dal'

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').where('id', '=', id).executeTakeFirst()
)

const ctx = createContext(executor)
const user = await getUserById(ctx, 1)
```

### Error Handling

```typescript
import { parseDatabaseError, UniqueConstraintError } from '@kysera/core'

try {
  await userRepo.create(userData)
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')
  if (dbError instanceof UniqueConstraintError) {
    // Handle duplicate
  }
}
```

### Pagination

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

## Development

```bash
pnpm install     # Install dependencies
pnpm build       # Build all packages
pnpm test        # Run tests
pnpm dev         # Development mode
```

### Project Structure

```
kysera/
├── packages/
│   ├── core/          # Errors, pagination, types, logger
│   ├── executor/      # Unified Execution Layer
│   ├── repository/    # Repository pattern
│   ├── dal/           # Functional DAL
│   ├── dialects/      # Dialect-specific utilities
│   ├── soft-delete/   # Soft delete plugin
│   ├── audit/         # Audit plugin
│   ├── timestamps/    # Timestamps plugin
│   ├── rls/           # RLS plugin
│   ├── infra/         # Health, retry, circuit breaker
│   ├── debug/         # Query debugging
│   ├── testing/       # Test utilities
│   └── migrations/    # Migration system
├── apps/
│   └── cli/           # @kysera/cli
├── examples/          # blog-app, e-commerce, multi-tenant-saas
├── website/           # Docusaurus documentation site
├── docs/              # Additional documentation
└── scripts/           # Release and automation scripts
```

## Philosophy

- **No magic** — Everything is explicit and traceable
- **Performance first** — Minimal overhead on Kysely
- **Type safety** — Full TypeScript support
- **Modularity** — Use only what you need
- **Production ready** — Health checks, resilience patterns, security

## Documentation

Full documentation available at **[kysera.dev](https://kysera.dev)**:
- [Getting Started](https://kysera.dev/docs/getting-started)
- [API Reference](https://kysera.dev/docs/api)
- [Guides](https://kysera.dev/docs/guides)

## License

MIT
