---
sidebar_position: 1
title: Introduction
description: Production-ready TypeScript ORM built on Kysely with zero compromises
---

# Kysera

**Production-ready TypeScript ORM built on top of Kysely with zero compromises on reliability, type safety, and performance.**

## What is Kysera?

Kysera is a lightweight, modular ORM layer that builds upon [Kysely](https://kysely.dev) - the type-safe SQL query builder. It provides:

- **Repository Pattern** with smart validation
- **Plugin System** for extensibility (soft delete, audit, timestamps, RLS)
- **Production Utilities** (health checks, graceful shutdown, retry logic)
- **Zero External Dependencies** in core packages
- **Full TypeScript** with strict mode support

## Philosophy

> "Start minimal, grow as needed, stay transparent."

### Core Principles

1. **Minimal Core, Optional Everything**
   - Core is just Kysely + debug utilities (~24KB)
   - Repository pattern is optional
   - All features are opt-in plugins
   - Tree-shakeable ESM architecture

2. **Explicit Over Implicit**
   - Every operation is traceable
   - No hidden context propagation
   - Transaction boundaries are clear
   - No automatic behaviors

3. **Smart Validation Strategy**
   - Always validate external inputs
   - Trust database outputs (configurable)
   - Development vs production modes
   - Performance-conscious approach

4. **Functional Architecture**
   - Functions over classes
   - No `this` context issues
   - Composable patterns
   - Dependency injection friendly

5. **Production-First Design**
   - Health checks built-in
   - Graceful shutdown support
   - Connection lifecycle management
   - Comprehensive error handling

## Package Overview

| Package | Description | Size |
|---------|-------------|------|
| [@kysera/core](/docs/api/core) | Debug utilities, error handling, health checks, pagination | ~22KB |
| [@kysera/repository](/docs/api/repository) | Repository pattern with Zod validation | ~12KB |
| [@kysera/migrations](/docs/api/migrations) | Migration system with dry-run support | ~11KB |
| [@kysera/soft-delete](/docs/plugins/soft-delete) | Soft delete plugin | ~4KB |
| [@kysera/audit](/docs/plugins/audit) | Audit logging plugin | ~11KB |
| [@kysera/timestamps](/docs/plugins/timestamps) | Automatic timestamps plugin | ~4KB |
| [@kysera/rls](/docs/plugins/rls) | Row-level security plugin | ~44KB |

## Architecture

```
Layer 3: Plugins (@kysera/soft-delete, @kysera/audit, @kysera/timestamps, @kysera/rls)
         ↓
Layer 2: Repository Pattern (@kysera/repository - optional)
         ↓
Layer 1: Core Utilities (@kysera/core)
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
- **Zod** 4.x (for @kysera/repository)

## Database Support

- PostgreSQL
- MySQL
- SQLite

## Next Steps

- [Getting Started](/docs/getting-started) - Quick 5-minute setup guide
- [Core Concepts](/docs/core-concepts/overview) - Understand the architecture
- [API Reference](/docs/api/core) - Detailed API documentation
