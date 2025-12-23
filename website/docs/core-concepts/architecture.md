---
sidebar_position: 2
title: Architecture
description: Understanding Kysera's architectural design and patterns
---

# Architecture


Kysera follows a modular, layered architecture designed for flexibility, type safety, and production readiness. The architecture is built on three core layers: **Core Utilities** → **Executor (Foundation)** → **Data Access Patterns (DAL/Repository)**.

## Design Principles

### 1. Minimal Core, Optional Everything

The core package is intentionally minimal (~8KB):

- Error handling and error codes
- Pagination helpers (offset and cursor-based)
- Type definitions (Executor, Timestamps, etc.)
- Logger interface

Infrastructure utilities (health, retry, debug, testing) are separate opt-in packages:

- `@kysera/infra` - Health checks, retry, circuit breaker, shutdown
- `@kysera/debug` - Query logging, profiling, SQL formatting
- `@kysera/testing` - Test utilities (transaction rollback, factories)

Everything else (repository pattern, plugins) is optional and tree-shakeable.

### 2. Zero External Dependencies

Core packages have zero runtime dependencies:

```json
{
  "dependencies": {},
  "peerDependencies": {
    "kysely": ">=0.28.8"
  }
}
```

This ensures:

- Minimal security surface
- No bloat from transitive dependencies
- Full control over code execution
- Tree-shakeable exports

### 3. ESM-Only Architecture

Kysera is ESM-only for modern environments:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

Benefits:

- Faster module loading
- Better tree-shaking
- Deno and Bun compatible
- No CommonJS overhead

### 4. TypeScript Strict Mode

All packages use the strictest TypeScript configuration:

```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true
  }
}
```

## 3-Layer Architecture

The modern architecture features **@kysera/executor** as the foundation layer:

```
┌────────────────────────────────────────────────────────────────┐
│                        User Application                        │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                         Plugins Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ soft-delete  │  │    audit     │  │     timestamps       │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│  ┌──────────────┐                                              │
│  │     rls      │    Plugin flow: Register → Validate →       │
│  └──────────────┘    Intercept queries through executor        │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│       Layer 3: Data Access Patterns (choose your style)        │
│  ┌─────────────────────────┐  ┌──────────────────────────────┐│
│  │   @kysera/repository    │  │        @kysera/dal           ││
│  │  CRUD + Validation +    │  │   Functional Queries +       ││
│  │  Plugin Extensions      │  │   Type Inference             ││
│  │  (depends on executor)  │  │   (depends on executor)      ││
│  └─────────────────────────┘  └──────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│    Layer 2: FOUNDATION - @kysera/executor (~8KB, 0 deps)      │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  • Query Interception (plugins modify queries)           │ │
│  │  • Transaction Propagation (plugins work in transactions)│ │
│  │  • Plugin Validation (conflicts, dependencies, cycles)   │ │
│  │  • KyseraExecutor type (extends Kysely<DB>)             │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│          Layer 1.5: Infrastructure Layer (opt-in)              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ @kysera/infra│  │@kysera/debug │  │   @kysera/testing    │ │
│  │Health, Retry │  │ Logging, SQL │  │  Factories, Cleanup  │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│          Layer 1: Core Utilities (@kysera/core ~8KB)           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐   │
│  │    Errors    │ │  Pagination  │ │   Types + Logger     │   │
│  └──────────────┘ └──────────────┘ └──────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                  Layer 0: Kysely Foundation                    │
│                Type-safe SQL Query Builder                     │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                              Database Drivers                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  PostgreSQL  │  │    MySQL     │  │    SQLite    │  │    MSSQL     │        │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘        │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Dependency Flow

```
@kysera/core (0 deps)
    ↓
@kysera/executor (depends on: kysely)
    ↓
    ├── @kysera/dal (depends on: executor, core)
    └── @kysera/repository (depends on: executor, dal, core)
            ↓
            └── Plugins (soft-delete, audit, rls, timestamps)
                (depend on: executor, core)
```

## Repository Factory Pattern

The factory pattern enables clean dependency injection:

```typescript
// Factory function - creates repository with injected executor
export function createUserRepository(executor: Executor<Database>) {
  return {
    async findById(id: number): Promise<User | null> {
      return executor.selectFrom('users').where('id', '=', id).executeTakeFirst()
    },
    async create(input: CreateUserInput): Promise<User> {
      return executor.insertInto('users').values(input).returningAll().executeTakeFirstOrThrow()
    }
  }
}

// Factory of factories - creates all repositories
export function createRepositories(executor: Executor<Database>) {
  return {
    users: createUserRepository(executor),
    posts: createPostRepository(executor)
  } as const
}
```

## Plugin Architecture

Plugins extend functionality through the `@kysera/executor` foundation layer:

### Plugin Flow Through Executor

```
User Code
    ↓
createExecutor(db, [softDeletePlugin(), rlsPlugin()])
    ↓
Plugin Validation (conflicts, dependencies, circular deps)
    ↓
KyseraExecutor created
    ↓
Query Execution: executor.selectFrom('users').execute()
    ↓
Query Interception (plugins modify query)
    ↓
Final Query: WHERE deleted_at IS NULL AND tenant_id = ?
    ↓
Database
```

### 1. Query Interceptors (Work with Both Repository & DAL)

Modify queries before execution through the executor:

```typescript
// Plugin definition
{
  name: 'soft-delete',
  interceptQuery(qb, context) {
    if (context.operation === 'select') {
      return qb.where('deleted_at', 'is', null)
    }
    return qb
  }
}

// Automatic application through executor
const executor = await createExecutor(db, [softDeletePlugin()])
const users = await executor.selectFrom('users').selectAll().execute()
// -> SELECT * FROM users WHERE deleted_at IS NULL
```

### 2. Repository Extensions (Work with Repository Only)

Add new methods to repositories:

```typescript
// Plugin definition
{
  name: 'soft-delete',
  extendRepository(repo) {
    return {
      ...repo,
      async softDelete(id: number) {
        return repo.executor
          .updateTable(repo.tableName)
          .set({ deleted_at: new Date() })
          .where('id', '=', id)
          .execute()
      },
      async restore(id: number) { /* ... */ }
    }
  }
}

// Usage
const orm = await createORM(db, [softDeletePlugin()])
const userRepo = orm.createRepository(createUserRepository)
await userRepo.softDelete(1) // Extension method
```

## Performance Characteristics

| Package            | Size        | Overhead                  | Dependencies |
| ------------------ | ----------- | ------------------------- | ------------ |
| @kysera/core       | ~8KB        | Minimal                   | 0            |
| @kysera/executor   | ~8KB        | &lt;0.1ms (no interceptors)  | 0            |
|                    |             | &lt;0.2ms (with interceptors)| (kysely peer)|
| @kysera/repository | ~12KB       | &lt;0.3ms per query          | executor, dal|
| @kysera/dal        | ~7KB        | &lt;0.2ms per query          | executor     |
| @kysera/infra      | ~12KB       | &lt;0.2ms per query          | core         |
| @kysera/debug      | ~5KB        | &lt;0.1ms per query          | core         |
| @kysera/testing    | ~6KB        | Dev-only                  | 0            |
| Plugins            | 4-12KB each | &lt;0.1ms per query          | executor, core|

### Benchmarks

- Cursor pagination: 72K queries/second
- Debug plugin: 18K queries/second with memory management
- Cursor encoding: 4-5M operations/second
