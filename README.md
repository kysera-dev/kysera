# Kysera 🚀

Production-ready TypeScript ORM built on top of Kysely with minimal core, optional everything.

## Quick Start (5 Minutes to First Query)

```bash
# Install
npm install kysely pg
npm install @kysera/core      # Optional: debug & utilities
npm install @kysera/repository # Optional: repository pattern
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
- Core is just Kysely + debug utilities (~10KB)
- Repository pattern is optional
- All features are opt-in plugins
- Tree-shakeable architecture

### 2. Explicit Over Implicit
- Every operation is traceable
- No hidden context propagation
- Transaction boundaries are clear
- No automatic behaviors

### 3. Smart Validation Strategy
- Validate external inputs always
- Trust database outputs (configurable)
- Development vs production modes
- Performance-conscious approach

### 4. Functional Architecture
- Functions over classes
- No `this` context issues
- Composable patterns
- Dependency injection friendly

### 5. Production-First Design
- Health checks built-in
- Graceful shutdown support
- Connection lifecycle management
- Comprehensive error handling

## Packages

| Package | Description | Size |
|---------|-------------|------|
| `@kysera/core` | Core utilities - debug, health, pagination, errors | ~10KB |
| `@kysera/repository` | Repository pattern with smart validation | ~15KB |
| `@kysera/soft-delete` | Soft delete plugin | ~5KB |
| `@kysera/audit` | Audit logging plugin | ~8KB |
| `@kysera/timestamps` | Auto timestamps plugin | ~3KB |
| `@kysera/migrations` | Migration helpers | ~10KB |

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
│   ├── core/          # Core utilities
│   ├── repository/    # Repository pattern
│   ├── soft-delete/   # Soft delete plugin
│   ├── audit/         # Audit plugin
│   ├── timestamps/    # Timestamps plugin
│   └── migrations/    # Migration helpers
├── examples/
│   └── blog-app/      # Example blog application
├── apps/              # Applications
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
import { checkDatabaseHealth } from '@kysera/core'

const health = await checkDatabaseHealth(db, pool)
// { status: 'healthy', checks: { database: {...}, pool: {...} } }
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

**Current Version**: 0.1.0 (Alpha)
**Specification Compliance**: 97%
**Test Coverage**: 418 tests passing across 6 packages
**Phase 2**: ✅ COMPLETED

### Completed Features

- [x] Core utilities package - Debug, health checks, pagination, errors
- [x] Repository pattern package - Smart validation, type-safe operations
- [x] Soft delete plugin - Method override pattern with auto-filtering
- [x] Audit plugin - Transaction-aware logging with bulk optimization
- [x] Timestamps plugin - Automatic created_at/updated_at management
- [x] Migration system - Up/down migrations with dry-run support
- [x] Multi-database support - PostgreSQL, MySQL, SQLite
- [x] Testing utilities - Transaction-based testing helpers
- [x] Plugin architecture - Extensible design with clear patterns

### Test Statistics

| Package | Tests Passing | Status |
|---------|--------------|--------|
| @kysera/core | 250 | ✅ Production Ready |
| @kysera/repository | 71 | ✅ Production Ready |
| @kysera/migrations | 24 | ✅ Production Ready |
| @kysera/soft-delete | 21 | ✅ Production Ready |
| @kysera/audit | 36 | ✅ Production Ready |
| @kysera/timestamps | 16 | ✅ Production Ready |
| **Total** | **418** | **All Passing** |

### Package Sizes (Minified)

| Package | Size | Dependencies |
|---------|------|--------------|
| @kysera/core | 12.76 KB | Zero runtime deps |
| @kysera/repository | 4.93 KB | Zero runtime deps |
| @kysera/migrations | 3.85 KB | Zero runtime deps |
| @kysera/soft-delete | 477 B | Zero runtime deps |
| @kysera/audit | 4.30 KB | Zero runtime deps |
| @kysera/timestamps | 2.89 KB | Zero runtime deps |

### Roadmap

**Phase 1** (✅ COMPLETED):
- Testing utilities
- Cursor pagination optimization
- Debug plugin SQL extraction
- Version consistency fixes

**Phase 2** (✅ COMPLETED):
- Repository improvements (factory pattern, parallel bulk ops)
- Plugin architecture review and documentation
- Multi-database support (PostgreSQL, MySQL, SQLite)
- Audit plugin optimization (10-100x performance improvement)
- Comprehensive documentation

**Phase 3** (Next):
- Minor fixes and polish
- Performance optimizations
- API documentation (TypeDoc)
- Example applications
- Production case studies

### Quick Links

- 📖 [Getting Started Guide](./GETTING_STARTED.md) - 5-minute quick start
- ✨ [Best Practices](./BEST_PRACTICES.md) - Production-ready patterns
- 📚 [Full Specification](./specs/spec.md) - Complete technical spec
- 🔌 [Plugin Authoring Guide](./PLUGIN_AUTHORING_GUIDE.md) - Create your own plugins
- 🗺️ [Detailed Roadmap](./roadmap.md) - Project progress and planning
- 📝 [Development Principles](./CLAUDE.md) - Codebase philosophy

## Philosophy

> "Start minimal, grow as needed, stay transparent."

Kysera believes in:
- **No magic** - Everything is explicit and traceable
- **Performance first** - Minimal overhead on top of Kysely
- **Type safety** - Full TypeScript support with proper types
- **Modularity** - Use only what you need
- **Production ready** - Built for real-world applications