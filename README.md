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
| `@kysera/executor` | Unified Execution Layer - plugin foundation |
| `@kysera/repository` | Repository pattern with validation |
| `@kysera/dal` | Functional Data Access Layer |

### Plugins
| Package | Description |
|---------|-------------|
| `@kysera/soft-delete` | Soft delete with auto-filtering |
| `@kysera/audit` | Audit logging |
| `@kysera/timestamps` | Auto created_at/updated_at |
| `@kysera/rls` | Row-Level Security |

### Infrastructure
| Package | Description |
|---------|-------------|
| `@kysera/infra` | Health checks, retry, circuit breaker |
| `@kysera/debug` | Query logging and profiling |
| `@kysera/testing` | Test utilities and factories |
| `@kysera/migrations` | Migration system |

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
│   ├── core/          # Core utilities
│   ├── executor/      # Unified Execution Layer
│   ├── repository/    # Repository pattern
│   ├── dal/           # Functional DAL
│   ├── soft-delete/   # Soft delete plugin
│   ├── audit/         # Audit plugin
│   ├── timestamps/    # Timestamps plugin
│   ├── rls/           # RLS plugin
│   ├── infra/         # Health, retry, circuit breaker
│   ├── debug/         # Query debugging
│   ├── testing/       # Test utilities
│   └── migrations/    # Migration system
├── examples/          # Example applications
└── website/           # Documentation
```

## Philosophy

- **No magic** — Everything is explicit and traceable
- **Performance first** — Minimal overhead on Kysely
- **Type safety** — Full TypeScript support
- **Modularity** — Use only what you need
- **Production ready** — Health checks, resilience patterns, security

## Documentation

See [website/docs](./website/docs) for full documentation including:
- [Getting Started](./website/docs/getting-started.md)
- [API Reference](./website/docs/api/)
- [Migration Guide](./website/docs/guides/migration-v07.md)
- [Troubleshooting](./website/docs/guides/troubleshooting.md)

## Contributing

Contributions welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT
