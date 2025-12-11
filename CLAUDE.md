# Kysera

Type-safe data access toolkit for TypeScript, built on Kysely. Repository pattern, Functional DAL, and plugin ecosystem — not an ORM.

## Quick Start

```bash
pnpm install        # Install dependencies
pnpm build          # Build all packages
pnpm test           # Run tests
pnpm dev            # Watch mode
pnpm typecheck      # Type checking
pnpm lint           # ESLint
pnpm format         # Prettier
```

**Package-specific:**
```bash
pnpm --filter @kysera/core build      # Build single package
turbo build --filter=@kysera/core     # With Turborepo
```

## Monorepo Structure

```
kysera/
├── packages/           # 12 published packages
│   ├── core/          # Errors, pagination, types, logger
│   ├── executor/      # Unified Execution Layer (plugin interception)
│   ├── repository/    # Repository pattern + Zod validation
│   ├── dal/           # Functional Data Access Layer
│   ├── soft-delete/   # Soft delete plugin
│   ├── audit/         # Audit logging with restore
│   ├── timestamps/    # Auto created_at/updated_at
│   ├── migrations/    # Migration system
│   ├── rls/           # Row-Level Security
│   ├── debug/         # Query logging & profiling
│   ├── infra/         # Health checks, retry, circuit breaker
│   └── testing/       # Transaction isolation, factories
├── apps/cli/          # @kysera/cli - CLI tool
├── examples/          # blog-app, e-commerce, multi-tenant-saas
├── website/           # Docusaurus documentation
└── scripts/           # Release & automation
```

## Version Info

| Tool | Version |
|------|---------|
| Kysera packages | 0.7.0 |
| @kysera/executor | 0.7.0 |
| @kysera/dal | 0.7.0 |
| @kysera/repository | 0.7.0 |
| Kysely (peer) | >=0.28.8 |
| TypeScript | ^5.9.2 |
| Turbo | ^2.6.3 |
| Vitest | ^4.0.15 |
| Zod (optional) | ^4.1.13 |
| pnpm | >=10.0.0 |
| Node.js | >=20.0.0 |
| Bun | >=1.0.0 |

## Critical Rules

### Must Follow
- ESM-only (`"type": "module"`)
- TypeScript strict mode (all flags enabled)
- Zero runtime dependencies in core packages
- Cross-runtime compatibility (Node, Bun, Deno)
- 95% test coverage minimum
- No `any` types

### Must Not Do
- CommonJS exports
- External runtime dependencies in core
- Mutable state
- Synchronous I/O
- Runtime-specific code

## Code Patterns

### Unified Execution Layer (NEW in v0.7)
```typescript
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '@kysera/rls'

// Create plugin-aware executor (works with both Repository and DAL)
const executor = await createExecutor(db, [
  softDeletePlugin(),
  rlsPlugin({ schema: rlsSchema })
])

// Plugins automatically apply to all queries
const users = await executor.selectFrom('users').selectAll().execute()
```

### Repository with Plugins
```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])
const userRepo = orm.createRepository(createUserRepository)

// Repository methods have soft-delete extensions
await userRepo.softDelete(1)
await userRepo.restore(1)
```

### DAL Pattern with Plugins
```typescript
import { createQuery, createContext, withTransaction } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'

// Create executor with plugins
const executor = await createExecutor(db, [softDeletePlugin()])

// DAL queries automatically get plugin filters
const getUser = createQuery((ctx, id: string) =>
  ctx.db.selectFrom('users').where('id', '=', id).executeTakeFirst()
)

const ctx = createContext(executor)  // Pass executor, not raw db
const user = await getUser(ctx, '1') // soft-delete filter applied!

// Transactions preserve plugins
await withTransaction(executor, async (txCtx) => {
  await getUser(txCtx, userId)  // plugins still work in transaction
})
```

### CQRS-lite Pattern (Repository + DAL)
```typescript
const orm = await createORM(db, [softDeletePlugin()])

await orm.transaction(async (ctx) => {
  // Repository for writes
  const userRepo = orm.createRepository(createUserRepository)
  const user = await userRepo.create({ name: 'Alice' })

  // DAL for complex reads (same transaction, same plugins)
  const stats = await getDashboardStats(ctx, user.id)
})
```

### Error Handling
```typescript
import { parseDatabaseError, DatabaseError } from '@kysera/core'

try {
  await repo.create(data)
} catch (error) {
  const dbError = parseDatabaseError(error, 'postgres')
  if (dbError instanceof UniqueConstraintError) {
    // Handle duplicate
  }
}
```

## Package Dependencies

```
@kysera/executor (0 deps) ← NEW: Unified Execution Layer
    │
    ├── @kysera/dal → @kysera/executor
    │
    └── @kysera/repository → @kysera/executor, @kysera/dal
            ├── @kysera/soft-delete → @kysera/executor, @kysera/core
            ├── @kysera/audit → @kysera/core
            ├── @kysera/timestamps → @kysera/core
            └── @kysera/rls → @kysera/executor, @kysera/core

@kysera/core (0 deps)
@kysera/debug → @kysera/core
@kysera/infra → @kysera/core
@kysera/testing (0 deps)
@kysera/migrations → @kysera/core
```

**Key Change in v0.7**: `@kysera/executor` is the new foundation package that enables plugins to work with both Repository and DAL patterns. Both `@kysera/dal` and `@kysera/repository` now depend on it for unified plugin interception.

## Testing

**Test commands:**
```bash
pnpm test                          # All tests
pnpm test:coverage                 # With coverage
pnpm test:multi-db                 # PostgreSQL/MySQL/SQLite
pnpm test:docker                   # Docker containers
```

**Coverage thresholds (vitest.config.ts):**
- Lines: 95%
- Functions: 95%
- Branches: 85%
- Statements: 95%

**Test file locations:** `packages/*/test/`

## Build Configuration

**tsup.config.ts pattern:**
```typescript
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],        // ESM only
  dts: true,
  minify: true,
  treeshake: true,
  target: 'esnext',
  platform: 'neutral',    // Cross-runtime
  external: ['kysely']
})
```

**Package exports pattern:**
```json
{
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "sideEffects": false
}
```

## Release Process

Uses Changesets for versioning:
```bash
pnpm changeset              # Create changeset
pnpm changeset:version      # Bump versions
pnpm release                # Full release
pnpm release:dry            # Dry run
```

## CI/CD

GitHub Actions workflows (`.github/workflows/`):
- `release.yml` - Main release (Node 20.x, 22.x matrix)
- `cli-release.yml` - CLI releases
- `deploy-docs.yml` - Documentation deployment

## Decision Framework

Priority order:
1. **Correctness** - Must work correctly
2. **Type Safety** - Fully typed, no any
3. **Simplicity** - Easiest to understand
4. **Performance** - Production-ready
5. **Size** - Smaller is better

## File Locations

| Purpose | Location |
|---------|----------|
| Source code | `packages/*/src/` |
| Tests | `packages/*/test/` |
| Build output | `packages/*/dist/` |
| Documentation | `website/docs/` |
| Specifications | `specs/` |
| Release scripts | `scripts/` |

## Troubleshooting

**Build issues:**
```bash
turbo daemon clean          # Clear Turborepo cache
pnpm install --force        # Force reinstall
```

**Test database:**
```bash
pnpm docker:up              # Start PostgreSQL/MySQL
pnpm docker:down            # Stop containers
```
