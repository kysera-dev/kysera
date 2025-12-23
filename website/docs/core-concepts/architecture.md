---
sidebar_position: 2
title: Architecture
description: Understanding Kysera's architectural design and patterns
---

# Architecture

Kysera follows a modular, layered architecture designed for flexibility, type safety, and production readiness.

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

## Package Architecture

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
│  │     rls      │                                              │
│  └──────────────┘                                              │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│              Data Access Layer (choose your style)             │
│  ┌─────────────────────────┐  ┌──────────────────────────────┐│
│  │   @kysera/repository    │  │        @kysera/dal           ││
│  │  Repository + Validation│  │   Functional + Type Infer    ││
│  └─────────────────────────┘  └──────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                Infrastructure Layer (opt-in)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ @kysera/infra│  │@kysera/debug │  │   @kysera/testing    │ │
│  │Health, Retry │  │ Logging, SQL │  │  Factories, Cleanup  │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                  @kysera/core (minimal, ~8KB)                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐   │
│  │    Errors    │ │  Pagination  │ │   Types + Logger     │   │
│  └──────────────┘ └──────────────┘ └──────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                          Kysely                                │
│  Type-safe SQL Query Builder for TypeScript                    │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                     Database Drivers                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  PostgreSQL  │  │    MySQL     │  │       SQLite         │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
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

Plugins extend repository functionality through three mechanisms:

### 1. Query Interception

Modify queries before execution:

```typescript
interceptQuery(qb, context) {
  if (context.operation === 'select') {
    return qb.where('deleted_at', 'is', null)
  }
  return qb
}
```

### 2. Repository Extension

Add new methods to repositories:

```typescript
extendRepository(repo) {
  return {
    ...repo,
    async softDelete(id: number) { /* ... */ },
    async restore(id: number) { /* ... */ }
  }
}
```

## Performance Characteristics

| Package            | Size        | Overhead                  |
| ------------------ | ----------- | ------------------------- |
| @kysera/core       | ~8KB        | Minimal                   |
| @kysera/repository | ~12KB       | Less than 0.3ms per query |
| @kysera/dal        | ~7KB        | Less than 0.2ms per query |
| @kysera/infra      | ~12KB       | Less than 0.2ms per query |
| @kysera/debug      | ~5KB        | Less than 0.1ms per query |
| @kysera/testing    | ~6KB        | Dev-only                  |
| Plugins            | 4-12KB each | Less than 0.1ms per query |

### Benchmarks

- Cursor pagination: 72K queries/second
- Debug plugin: 18K queries/second with memory management
- Cursor encoding: 4-5M operations/second
