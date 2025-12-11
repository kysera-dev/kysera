---
sidebar_position: 1
title: Introduction
description: Production-ready type-safe data access toolkit built on Kysely with zero compromises
---

# Kysera

**Production-ready type-safe data access toolkit built on top of Kysely with zero compromises on reliability, type safety, and performance.**

## What is Kysera?

Kysera is a lightweight, modular data access toolkit that builds upon [Kysely](https://kysely.dev) - the type-safe SQL query builder. Unlike traditional ORMs with entity mapping, Unit of Work, and Identity Map, Kysera provides lightweight patterns on top of Kysely. It provides:

- **Repository Pattern** with validation-agnostic design (Zod, Valibot, TypeBox, or native)
- **Functional DAL** for type-inferred queries and context-based transactions
- **Plugin System** for extensibility (soft delete, audit, timestamps, RLS)
- **Infrastructure Utilities** (health checks, retry, circuit breaker) as opt-in packages
- **Zero External Dependencies** in core packages
- **Full TypeScript** with strict mode support

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

| Package | Description | Size |
|---------|-------------|------|
| [@kysera/core](/docs/api/core) | Error handling, pagination, types, logger | ~8KB |
| [@kysera/repository](/docs/api/repository) | Repository pattern with validation adapters | ~12KB |
| [@kysera/dal](/docs/api/dal) | Functional Data Access Layer | ~7KB |

### Infrastructure Packages (Opt-in)

| Package | Description | Size |
|---------|-------------|------|
| [@kysera/infra](/docs/api/infra) | Health checks, retry, circuit breaker, shutdown | ~12KB |
| [@kysera/debug](/docs/api/debug) | Query logging, profiling, SQL formatting | ~5KB |
| [@kysera/testing](/docs/api/testing) | Test utilities (transaction rollback, factories) | ~6KB |
| [@kysera/migrations](/docs/api/migrations) | Migration system with dry-run support | ~11KB |

### Plugins

| Package | Description | Size |
|---------|-------------|------|
| [@kysera/soft-delete](/docs/plugins/soft-delete) | Soft delete plugin | ~4KB |
| [@kysera/audit](/docs/plugins/audit) | Audit logging plugin | ~11KB |
| [@kysera/timestamps](/docs/plugins/timestamps) | Automatic timestamps plugin | ~4KB |
| [@kysera/rls](/docs/plugins/rls) | Row-level security plugin | ~44KB |

## Architecture

```
Layer 4: Plugins (@kysera/soft-delete, @kysera/audit, @kysera/timestamps, @kysera/rls)
         ↓
Layer 3: Data Access (@kysera/repository OR @kysera/dal - choose your style)
         ↓
Layer 2: Infrastructure (@kysera/infra, @kysera/debug, @kysera/testing - opt-in)
         ↓
Layer 1: Core Utilities (@kysera/core - minimal)
         ↓
Layer 0: Kysely Foundation (Direct usage, no wrapper)
```

## Quick Example

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { createRepositoryFactory } from '@kysera/repository'
import { z } from 'zod'

// Define schema
interface Database {
  users: {
    id: Generated<number>
    email: string
    name: string
  }
}

// Create connection
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString: '...' }) })
})

// Create repository
const factory = createRepositoryFactory(db)
const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: {
    create: z.object({ email: z.string().email(), name: z.string() }),
    update: z.object({ email: z.string().email(), name: z.string() }).partial()
  }
})

// Use repository
const user = await userRepo.create({ email: 'john@example.com', name: 'John' })
const users = await userRepo.findAll()
```

## Requirements

- **Node.js** 20+ or **Bun** 1.0+ or **Deno**
- **TypeScript** 5.0+ (recommended)
- **Kysely** 0.28.8+
- **Validation library** (optional): Zod 4.x, Valibot, TypeBox, or none

## Database Support

- PostgreSQL
- MySQL
- SQLite

## Next Steps

- [Getting Started](/docs/getting-started) - Quick 5-minute setup guide
- [Core Concepts](/docs/core-concepts/overview) - Understand the architecture
- [API Reference](/docs/api/core) - Detailed API documentation
