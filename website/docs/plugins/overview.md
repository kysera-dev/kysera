---
sidebar_position: 1
title: Plugin Overview
description: Overview of Kysera's plugin system
---

# Plugin System

Kysera's plugin system allows you to extend repository functionality without modifying core code.

## Available Plugins

| Plugin | Package | Description |
|--------|---------|-------------|
| [Soft Delete](/docs/plugins/soft-delete) | `@kysera/soft-delete` | Mark records as deleted without removing |
| [Audit](/docs/plugins/audit) | `@kysera/audit` | Track all database changes with history |
| [Timestamps](/docs/plugins/timestamps) | `@kysera/timestamps` | Automatic created_at/updated_at |
| [RLS](/docs/plugins/rls) | `@kysera/rls` | Row-level security for multi-tenant apps |

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

const userRepo = orm.createRepository((executor) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'users',
    mapRow: (row) => row,
    schemas: { create: CreateUserSchema }
  })
})

// Repository now has all plugin methods
await userRepo.softDelete(userId)           // From soft-delete
await userRepo.getAuditHistory(userId)      // From audit
await userRepo.findRecentlyCreated()        // From timestamps
```

## Plugin Architecture

Plugins can extend repositories in three ways:

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

### 2. Result Transformation

Process results after query execution:

```typescript
afterQuery(context, result) {
  // Transform or validate result
  return result
}
```

### 3. Repository Extension

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

## Plugin Interface

```typescript
interface Plugin {
  name: string
  version: string
  dependencies?: string[]      // Plugins this depends on (must be loaded first)
  priority?: number            // Higher = runs first (default: 0)
  conflictsWith?: string[]     // Incompatible plugins

  // Lifecycle - called once during createORM
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void

  // Query interception - modify QueryBuilder before execution
  interceptQuery?<QB extends AnyQueryBuilder>(
    qb: QB,
    context: QueryBuilderContext
  ): QB

  // Result handling (defined but not currently used in execution chain)
  afterQuery?(context: QueryContext, result: unknown): Promise<unknown> | unknown
  onError?(context: QueryContext, error: unknown): Promise<void> | void

  // Repository extension - add/wrap methods after creation
  extendRepository?<T extends object>(repo: T): T
}

interface QueryBuilderContext {
  operation: 'select' | 'insert' | 'update' | 'delete'
  table: string
  metadata: Record<string, unknown>  // Shared across plugin chain
}
```

:::info Note on afterQuery and onError
The `afterQuery` and `onError` hooks are defined in the interface but are not currently integrated into the execution chain. They are reserved for future use.
:::

## Plugin Order

Plugin order is determined by the `resolvePluginOrder` algorithm:

1. **Topological sort**: Plugins with dependencies MUST run after their dependencies
2. **Priority**: Within same level, higher `priority` runs first (default: 0)
3. **Tie-breaking**: Alphabetical by name for stability

```typescript
// Plugins are automatically sorted
const orm = await createORM(db, [
  auditPlugin(),                    // priority: 0
  softDeletePlugin(),               // priority: 0
  rlsPlugin({ schema }),            // priority: 50 (runs first!)
  timestampsPlugin()                // priority: 0
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

Kysera validates plugins for:
- Missing dependencies
- Circular dependencies
- Conflicting plugins
- Duplicate names

```typescript
import { validatePlugins } from '@kysera/repository'

try {
  validatePlugins([pluginA, pluginB])
} catch (error) {
  if (error instanceof PluginValidationError) {
    console.log(error.code)    // 'MISSING_DEPENDENCY' | 'CIRCULAR_DEPENDENCY' | 'CONFLICT'
    console.log(error.details)
  }
}
```

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
