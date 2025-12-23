---
sidebar_position: 1
title: Plugin Overview
description: Overview of Kysera's plugin system
---

# Plugin System

Kysera's plugin system allows you to extend repository functionality without modifying core code.

## Available Plugins

| Plugin                                   | Package               | Description                              |
| ---------------------------------------- | --------------------- | ---------------------------------------- |
| [Soft Delete](/docs/plugins/soft-delete) | `@kysera/soft-delete` | Mark records as deleted without removing |
| [Audit](/docs/plugins/audit)             | `@kysera/audit`       | Track all database changes with history  |
| [Timestamps](/docs/plugins/timestamps)   | `@kysera/timestamps`  | Automatic created_at/updated_at          |
| [RLS](/docs/plugins/rls)                 | `@kysera/rls`         | Row-level security for multi-tenant apps |

## Using Plugins

### Basic Setup

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { auditPlugin } from '@kysera/audit'
import { timestampsPlugin } from '@kysera/timestamps'

const orm = await createORM(db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' }),
  auditPlugin({ getUserId: () => currentUser?.id }),
  timestampsPlugin()
])

const userRepo = orm.createRepository(executor => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'users',
    mapRow: row => row,
    schemas: { create: CreateUserSchema }
  })
})

// Repository now has all plugin methods
await userRepo.softDelete(userId) // From soft-delete
await userRepo.getAuditHistory(userId) // From audit
await userRepo.findRecentlyCreated() // From timestamps
```

## Plugin Architecture

Kysera's plugin system is built on **@kysera/executor**, which provides a unified execution layer for both Repository and DAL patterns. Plugins are validated, sorted by dependencies and priority, and can extend functionality in multiple ways:

### 1. Query Interception

Modify query builders before execution. Works in **both Repository and DAL patterns**:

```typescript
interceptQuery(qb, context) {
  if (context.operation === 'select') {
    // Automatically filter soft-deleted records
    return qb.where('deleted_at', 'is', null)
  }
  return qb
}
```

**Intercepted operations:**

- `selectFrom` → `'select'`
- `insertInto` → `'insert'`
- `updateTable` → `'update'`
- `deleteFrom` → `'delete'`

### 2. Repository Extension (Repository only)

Add new methods to repositories:

```typescript
extendRepository(repo) {
  return {
    ...repo,
    async softDelete(id) { /* ... */ },
    async restore(id) { /* ... */ }
  }
}
```

### How It Works

1. **createORM** uses **createExecutor** internally
2. **Executor** wraps Kysely with a Proxy that intercepts query-building methods
3. **Plugins** are validated for dependencies, conflicts, and circular references
4. **Plugin order** is resolved via topological sort with priority
5. **Query interception** applies plugins to `selectFrom`, `insertInto`, `updateTable`, `deleteFrom`
6. **Transaction wrapping** preserves plugin behavior in transactions

## Plugin Interface

```typescript
interface Plugin {
  /** Unique plugin name (e.g., '@kysera/soft-delete') */
  readonly name: string

  /** Plugin version (semantic versioning) */
  readonly version: string

  /** Plugins this depends on (must be loaded first) */
  readonly dependencies?: readonly string[]

  /** Higher priority = runs first (default: 0) */
  readonly priority?: number

  /** Incompatible plugins */
  readonly conflictsWith?: readonly string[]

  /**
   * Lifecycle: Called once when plugin is initialized
   * Use for setup, validation, or checking database schema
   */
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void

  /**
   * Query interception: Modify query builder before execution
   * Works in both Repository and DAL patterns
   * Applied to: selectFrom, insertInto, updateTable, deleteFrom
   */
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB

  /**
   * Repository extensions: Add methods to repositories
   * Repository pattern only (not available in DAL)
   */
  extendRepository?<T extends object>(repo: T): T
}

interface QueryBuilderContext {
  /** Type of operation: 'select' | 'insert' | 'update' | 'delete' */
  readonly operation: 'select' | 'insert' | 'update' | 'delete'

  /** Table name being queried */
  readonly table: string

  /** Metadata shared across plugin chain */
  readonly metadata: Record<string, unknown>
}
```

## Plugin Order

Plugin order is determined by the `resolvePluginOrder` algorithm:

1. **Topological sort**: Plugins with dependencies MUST run after their dependencies
2. **Priority**: Within same level, higher `priority` runs first (default: 0)
3. **Tie-breaking**: Alphabetical by name for stability

```typescript
// Plugins are automatically sorted
const orm = await createORM(db, [
  auditPlugin(), // priority: 0
  softDeletePlugin(), // priority: 0
  rlsPlugin({ schema }), // priority: 50 (runs first!)
  timestampsPlugin() // priority: 0
])

// Actual execution order:
// 1. RLS (priority 50)
// 2. audit, softDelete, timestamps (priority 0, alphabetical)
```

:::tip Priority Guidelines

- **50**: Security plugins (RLS) - must filter before other plugins see data
- **10**: Validation plugins - validate early
- **0**: Standard plugins (default)
- **-10**: Logging/audit plugins - capture final state
  :::

## Plugin Validation

The **@kysera/executor** package validates plugins during initialization to ensure correctness:

**Validation checks:**

- ✅ No duplicate plugin names
- ✅ All dependencies are present
- ✅ No circular dependencies (detected via DFS)
- ✅ No conflicting plugins

```typescript
import { validatePlugins, PluginValidationError } from '@kysera/executor'

try {
  validatePlugins([pluginA, pluginB])
} catch (error) {
  if (error instanceof PluginValidationError) {
    console.log(error.type) // 'DUPLICATE_NAME' | 'MISSING_DEPENDENCY' | 'CIRCULAR_DEPENDENCY' | 'CONFLICT'
    console.log(error.details) // { pluginName, missingDependency?, conflictingPlugin?, cycle? }
  }
}
```

**Validation happens automatically:**

- When calling `createORM(db, plugins)` (via `createExecutor`)
- When calling `createExecutor(db, plugins)` directly

## Creating Custom Plugins

See the [Plugin Authoring Guide](/docs/plugins/authoring-guide) for detailed instructions on creating your own plugins.

```typescript
const myPlugin = (): Plugin => ({
  name: '@myorg/my-plugin',
  version: '1.0.0',

  extendRepository(repo) {
    return {
      ...repo,
      async myCustomMethod() {
        // Custom logic
      }
    }
  }
})
```
