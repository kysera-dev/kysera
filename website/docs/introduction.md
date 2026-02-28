---
sidebar_position: 1
title: Introduction
description: Production-ready type-safe data access toolkit built on Kysely with zero compromises
---

# Kysera

**Production-ready type-safe data access toolkit built on top of Kysely with zero compromises on reliability, type safety, and performance.**

## What is Kysera?

Kysera is a lightweight, modular data access toolkit that builds upon [Kysely](https://kysely.dev) - the type-safe SQL query builder. **Kysera is NOT a traditional ORM** - it has no entity mapping, Unit of Work, Identity Map, or lazy loading. Instead, it provides lightweight patterns and plugins on top of Kysely:

- **Unified Execution Layer** (`@kysera/executor`) - Foundation for plugin interception across all query patterns
- **Repository Pattern** with validation-agnostic design (Zod, Valibot, TypeBox, or native)
- **Functional DAL** for type-inferred queries and context-based transactions
- **Plugin System** for extensibility (soft delete, audit, timestamps, RLS) that works with both Repository and DAL
- **Infrastructure Utilities** (health checks, retry, circuit breaker) as opt-in packages
- **Zero External Dependencies** in core packages
- **Full TypeScript** with strict mode support
- **Cross-Runtime Compatibility** - Node.js >=20.0.0, Bun >=1.0.0, Deno (experimental)

## Philosophy

> "Start minimal, grow as needed, stay transparent."

### Core Principles

1. **Minimal Core, Optional Everything**
   - Core contains only essential utilities (~8KB): errors, pagination, types, logger
   - Infrastructure (health, retry, shutdown) is a separate opt-in package
   - Repository pattern is optional
   - All features are opt-in plugins
   - Tree-shakeable ESM architecture

2. **Explicit Over Implicit**
   - Every operation is traceable
   - No hidden context propagation
   - Transaction boundaries are clear
   - No automatic behaviors

3. **Validation-Agnostic Design**
   - Use any validation library: Zod, Valibot, TypeBox, or none
   - ValidationSchema adapter interface for library independence
   - Backward compatible with existing Zod schemas

4. **Dual API Approach**
   - **Repository Pattern**: CRUD operations with validation for structured access
   - **Functional DAL**: Type-inferred queries with context passing for complex operations

5. **Production-First Design**
   - Health checks via @kysera/infra (opt-in)
   - Graceful shutdown support
   - Circuit breaker and retry logic
   - Comprehensive error handling

## Package Overview

### Core Packages

| Package                                    | Description                                 | Size  |
| ------------------------------------------ | ------------------------------------------- | ----- |
| [@kysera/core](/docs/api/core)             | Error handling, pagination, types, logger   | ~8KB  |
| [@kysera/executor](/docs/api/executor)     | Unified Execution Layer (plugin foundation) | ~6KB  |
| [@kysera/repository](/docs/api/repository) | Repository pattern with validation adapters | ~12KB |
| [@kysera/dal](/docs/api/dal)               | Functional Data Access Layer                | ~7KB  |

### Infrastructure Packages (Opt-in)

| Package                                    | Description                                      | Size  |
| ------------------------------------------ | ------------------------------------------------ | ----- |
| [@kysera/infra](/docs/api/infra)           | Health checks, retry, circuit breaker, shutdown  | ~12KB |
| [@kysera/debug](/docs/api/debug)           | Query logging, profiling, SQL formatting         | ~5KB  |
| [@kysera/testing](/docs/api/testing)       | Test utilities (transaction rollback, factories) | ~6KB  |
| [@kysera/migrations](/docs/api/migrations) | Migration system with dry-run support            | ~11KB |

### Plugins

| Package                                          | Description                 | Size  |
| ------------------------------------------------ | --------------------------- | ----- |
| [@kysera/soft-delete](/docs/plugins/soft-delete) | Soft delete plugin          | ~4KB  |
| [@kysera/audit](/docs/plugins/audit)             | Audit logging plugin        | ~11KB |
| [@kysera/timestamps](/docs/plugins/timestamps)   | Automatic timestamps plugin | ~4KB  |
| [@kysera/rls](/docs/plugins/rls)                 | Row-level security plugin   | ~44KB |

## Architecture

```
Layer 5: Plugins (@kysera/soft-delete, @kysera/audit, @kysera/timestamps, @kysera/rls)
         ↓
Layer 4: Data Access (@kysera/repository OR @kysera/dal - choose your style)
         ↓
Layer 3: Unified Execution (@kysera/executor - plugin interception foundation)
         ↓
Layer 2: Infrastructure (@kysera/infra, @kysera/debug, @kysera/testing - opt-in)
         ↓
Layer 1: Core Utilities (@kysera/core - minimal)
         ↓
Layer 0: Kysely Foundation (Direct usage, no wrapper)
```

## Quick Example

### Repository Pattern with Plugins

```typescript
import { Kysely, PostgresDialect, Generated } from 'kysely'
import { Pool } from 'pg'
import { createExecutor } from '@kysera/executor'
import { createORM, zodAdapter } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { timestampsPlugin } from '@kysera/timestamps'
import { z } from 'zod'

// Define schema
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

// Create connection
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString: '...' }) })
})

// Create executor with plugins (foundation layer)
const executor = await createExecutor(db, [
  softDeletePlugin(),
  timestampsPlugin()
])

// Create ORM (plugin container, not traditional ORM)
const orm = await createORM(executor, [])

// Create repository
const userRepo = orm.createRepository(exec => {
  const factory = createRepositoryFactory(exec)
  return factory.create({
    tableName: 'users',
    mapRow: row => row,
    schemas: {
      create: zodAdapter(z.object({ email: z.string().email(), name: z.string() })),
      update: zodAdapter(z.object({ email: z.string().email(), name: z.string() }).partial())
    }
  })
})

// Use repository - plugins apply automatically
const user = await userRepo.create({ email: 'john@example.com', name: 'John' })
// created_at, updated_at set automatically by timestampsPlugin

await userRepo.softDelete(user.id)  // Sets deleted_at instead of hard delete
const activeUsers = await userRepo.findAll()  // Automatically excludes soft-deleted
```

### Functional DAL with Plugins

```typescript
import { createQuery, createContext, withTransaction } from '@kysera/dal'

// Define queries
const getUser = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').where('id', '=', id).selectAll().executeTakeFirst()
)

const listActiveUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
)

// Create context with executor (plugins apply automatically)
const ctx = createContext(executor)

// Queries automatically filtered by soft-delete plugin
const user = await getUser(ctx, 1)  // Returns null if soft-deleted
const users = await listActiveUsers(ctx)  // Excludes soft-deleted records

// Transactions preserve plugins
await withTransaction(executor, async (txCtx) => {
  const user = await getUser(txCtx, userId)
  // All queries in transaction have plugin filters
})
```

## Requirements

- **Runtime**: Node.js >=20.0.0, Bun >=1.0.0, or Deno (experimental)
- **TypeScript**: ^5.9.2 (recommended for best type inference)
- **Kysely**: >=0.28.9 (peer dependency)
- **Validation library** (optional): Zod ^4.3.6, Valibot, TypeBox, or none
- **Module System**: ESM-only (no CommonJS)

## Database Support

- PostgreSQL
- MySQL
- SQLite
- MSSQL (SQL Server)

## Next Steps

- [Getting Started](/docs/getting-started) - Quick 5-minute setup guide
- [Core Concepts](/docs/core-concepts/overview) - Understand the architecture
- [API Reference](/docs/api/core) - Detailed API documentation
