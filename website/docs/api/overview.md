---
sidebar_position: 1
title: API Overview
description: API reference overview for all Kysera packages
---

# API Reference

Complete API documentation for all Kysera packages.

## Package Index

### Core Package

| Module | Description |
|--------|-------------|
| [@kysera/core](/docs/api/core) | Core utilities and exports |
| [Errors](/docs/api/core/errors) | Error classes and parsing |
| [Debug](/docs/api/core/debug) | Query debugging and profiling |
| [Health](/docs/api/core/health) | Database health checks |
| [Pagination](/docs/api/core/pagination) | Offset and cursor pagination |
| [Retry](/docs/api/core/retry) | Retry logic and circuit breaker |
| [Testing](/docs/api/core/testing) | Testing utilities |

### Repository Package

| Module | Description |
|--------|-------------|
| [@kysera/repository](/docs/api/repository) | Repository pattern implementation |
| [Factory](/docs/api/repository/factory) | Repository factory functions |
| [Validation](/docs/api/repository/validation) | Validation utilities |
| [Types](/docs/api/repository/types) | Type definitions |

### Migrations Package

| Module | Description |
|--------|-------------|
| [@kysera/migrations](/docs/api/migrations) | Migration system |

## Quick Reference

### Creating a Repository

```typescript
import { createRepositoryFactory } from '@kysera/repository'

const factory = createRepositoryFactory(db)
const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: { create: CreateUserSchema }
})
```

### Using Plugins

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const orm = await createORM(db, [softDeletePlugin()])
```

### Error Handling

```typescript
import { parseDatabaseError, UniqueConstraintError } from '@kysera/core'

const error = parseDatabaseError(rawError, 'postgres')
if (error instanceof UniqueConstraintError) {
  // Handle duplicate
}
```

### Health Checks

```typescript
import { checkDatabaseHealth } from '@kysera/core'

const health = await checkDatabaseHealth(db, pool)
```

### Pagination

```typescript
import { paginate, paginateCursor } from '@kysera/core'

// Offset
const page = await paginate(query, { page: 1, limit: 20 })

// Cursor
const result = await paginateCursor(query, { limit: 20, orderBy: [...] })
```
