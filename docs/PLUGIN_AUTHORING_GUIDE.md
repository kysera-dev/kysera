# Kysera Plugin Authoring Guide

This guide explains how to create plugins for Kysera using the plugin system.

## Table of Contents

1. [Plugin Architecture](#plugin-architecture)
2. [Plugin Interface](#plugin-interface)
3. [Plugin Patterns](#plugin-patterns)
4. [Creating a Plugin](#creating-a-plugin)
5. [Testing Plugins](#testing-plugins)
6. [Best Practices](#best-practices)
7. [Examples](#examples)

## Plugin Architecture

Kysera uses a **Method Override pattern** for plugins, not full query interception. This design choice provides:

- **Simplicity**: Easier to understand and maintain
- **Explicitness**: Developers know exactly what methods they're calling
- **Type Safety**: Full TypeScript support with proper types
- **Predictability**: No hidden query transformations

### What Plugins CAN Do

✅ **Extend Repositories** - Add new methods to repositories
✅ **Override Methods** - Replace existing repository methods
✅ **Filter SELECT Queries** - Automatically modify SELECT queries
✅ **Lifecycle Hooks** - Run code on initialization
✅ **Result Transformation** - Transform query results

### What Plugins CANNOT Do

❌ **Intercept DELETE/UPDATE/INSERT at query level** - Use method override instead
❌ **Modify table operations directly** - Work through repository layer
❌ **Access raw SQL before execution** - Kysely handles compilation

## Plugin Interface

```typescript
interface Plugin {
  name: string
  version: string

  // Lifecycle hooks
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void

  // Query builder interceptors (limited scope)
  interceptQuery?<QB extends AnyQueryBuilder>(qb: QB, context: QueryBuilderContext): QB

  // Result interceptors
  afterQuery?(context: QueryContext, result: unknown): Promise<unknown> | unknown
  onError?(context: QueryContext, error: unknown): Promise<void> | void

  // Repository extensions (primary extension mechanism)
  extendRepository?<T extends object>(repo: T): T
}
```

### QueryBuilderContext

```typescript
interface QueryBuilderContext {
  operation: 'select' | 'insert' | 'update' | 'delete'
  table: string
  metadata: Record<string, unknown>
}
```

## Plugin Patterns

### 1. Method Override Pattern (Recommended)

Add new methods to repositories and override existing ones.

**Use Cases:**

- Soft delete
- Audit logging
- Custom validation
- Business logic

**Example:**

```typescript
export const softDeletePlugin = (): Plugin => ({
  name: 'soft-delete',
  version: '1.0.0',

  extendRepository<T extends object>(repo: T): T {
    const baseRepo = repo as BaseRepository

    return {
      ...baseRepo,

      // Add new method
      async softDelete(id: number) {
        return await baseRepo.update(id, {
          deleted_at: new Date().toISOString()
        })
      },

      // Override existing method
      async findAll() {
        return await baseRepo.executor
          .selectFrom(baseRepo.tableName)
          .selectAll()
          .where('deleted_at', 'is', null)
          .execute()
      }
    }
  }
})
```

### 2. SELECT Query Filtering Pattern

Automatically filter SELECT queries using `interceptQuery`.

**Use Cases:**

- Soft delete filtering
- Multi-tenancy
- Row-level security

**Example:**

```typescript
export const tenantPlugin = (tenantId: string): Plugin => ({
  name: 'tenant',
  version: '1.0.0',

  interceptQuery<QB>(qb: QB, context): QB {
    if (context.operation === 'select' && !context.metadata['skipTenant']) {
      return (qb as any).where(`${context.table}.tenant_id`, '=', tenantId)
    }
    return qb
  }
})
```

### 3. Result Transformation Pattern

Transform query results after execution.

**Use Cases:**

- Data masking
- Field formatting
- Computed properties

**Example:**

```typescript
export const maskingPlugin = (): Plugin => ({
  name: 'masking',
  version: '1.0.0',

  afterQuery(context, result) {
    if (context.operation === 'select' && Array.isArray(result)) {
      return result.map(row => ({
        ...row,
        email: row.email ? maskEmail(row.email) : null
      }))
    }
    return result
  }
})
```

### 4. Audit Logging Pattern

Log all database operations.

**Use Cases:**

- Compliance
- Debugging
- Analytics

**Example:**

```typescript
export const auditPlugin = (): Plugin => ({
  name: 'audit',
  version: '1.0.0',

  afterQuery(context, result) {
    console.log(`[AUDIT] ${context.operation} on ${context.table}`)
    console.log(`[AUDIT] SQL: ${context.sql}`)
    return result
  },

  onError(context, error) {
    console.error(`[AUDIT] Error in ${context.operation} on ${context.table}`)
    console.error(`[AUDIT] Error:`, error)
  }
})
```

## Creating a Plugin

### Step 1: Define Plugin Options

```typescript
export interface MyPluginOptions {
  enabled?: boolean
  customField?: string
}
```

### Step 2: Create Plugin Factory

```typescript
export const myPlugin = (options: MyPluginOptions = {}): Plugin => {
  const { enabled = true, customField = 'default' } = options

  return {
    name: '@company/my-plugin',
    version: '1.0.0'

    // Implementation...
  }
}
```

### Step 3: Implement Plugin Methods

```typescript
export const myPlugin = (options: MyPluginOptions = {}): Plugin => {
  return {
    name: '@company/my-plugin',
    version: '1.0.0',

    // Initialize plugin
    async onInit<DB>(executor: Kysely<DB>) {
      // Setup code (e.g., create audit tables)
      console.log('MyPlugin initialized')
    },

    // Extend repositories
    extendRepository<T extends object>(repo: T): T {
      const baseRepo = repo as BaseRepository

      return {
        ...baseRepo,

        async customMethod() {
          // Your custom logic
          return 'result'
        }
      }
    }
  }
}
```

### Step 4: Export Plugin

```typescript
// src/index.ts
export { myPlugin } from './plugin'
export type { MyPluginOptions } from './plugin'
```

## Testing Plugins

### Unit Tests

```typescript
import { describe, it, expect } from 'vitest'
import { myPlugin } from '../src'

describe('MyPlugin', () => {
  it('should create plugin with default options', () => {
    const plugin = myPlugin()

    expect(plugin.name).toBe('@company/my-plugin')
    expect(plugin.version).toBe('1.0.0')
  })

  it('should extend repository with custom method', () => {
    const plugin = myPlugin()

    const repo = {
      tableName: 'users',
      executor: {} as any,
      findAll: async () => []
    }

    const extended = plugin.extendRepository!(repo)

    expect(extended).toHaveProperty('customMethod')
  })
})
```

### Integration Tests

```typescript
import { createORM } from '@kysera/repository'
import { myPlugin } from '../src'

describe('MyPlugin Integration', () => {
  it('should work with Kysera', async () => {
    const orm = await createORM(db, [myPlugin()])

    const repo = orm.createRepository(createUserRepository)

    // Test that custom method exists and works
    await repo.customMethod()
  })
})
```

## Best Practices

### 1. ✅ DO: Use Method Override

```typescript
// GOOD: Explicit method
extendRepository(repo) {
  return {
    ...repo,
    async softDelete(id: number) {
      return await repo.update(id, { deleted_at: new Date() })
    }
  }
}
```

### 2. ❌ DON'T: Try to Intercept DELETE

```typescript
// BAD: This won't work as expected
interceptQuery(qb, context) {
  if (context.operation === 'delete') {
    // This metadata is never read!
    context.metadata['convertToUpdate'] = true
  }
  return qb
}
```

### 3. ✅ DO: Document Limitations

```typescript
/**
 * MyPlugin
 *
 * NOTE: This plugin does not intercept DELETE operations.
 * Use the softDelete() method instead of delete().
 */
```

### 4. ✅ DO: Provide TypeScript Types

```typescript
interface ExtendedRepository extends BaseRepository {
  softDelete(id: number): Promise<void>
  restore(id: number): Promise<void>
}
```

### 5. ✅ DO: Handle Errors Gracefully

```typescript
extendRepository(repo) {
  // Check if repo has required properties
  if (!('tableName' in repo)) {
    return repo // Return unchanged
  }

  // ... extend repo
}
```

### 6. ✅ DO: Use Versioning

```typescript
export const myPlugin = (): Plugin => ({
  name: '@company/my-plugin',
  version: '1.0.0' // Follow semver
  // ...
})
```

### 7. ✅ DO: Add Comprehensive JSDoc

````typescript
/**
 * MyPlugin - Brief description
 *
 * ## Usage
 * ```typescript
 * const plugin = myPlugin({ option: 'value' })
 * ```
 *
 * ## Methods Added
 * - customMethod(): Does something useful
 *
 * ## Architecture
 * Uses Method Override pattern.
 *
 * @param options - Configuration options
 * @returns Plugin instance
 */
export const myPlugin = (options: MyPluginOptions = {}): Plugin => {
  // ...
}
````

## Examples

### Complete Soft Delete Plugin

See [`packages/soft-delete/src/index.ts`](packages/soft-delete/src/index.ts) for a complete, production-ready example.

Key features:

- Configurable deleted_at column
- Table-specific soft delete support
- Multiple find methods (with/without deleted)
- Hard delete option
- Restore functionality

### Minimal Timestamp Plugin

```typescript
export const timestampPlugin = (): Plugin => ({
  name: '@kysera/timestamps',
  version: '1.0.0',

  extendRepository<T extends object>(repo: T): T {
    const baseRepo = repo as BaseRepository

    return {
      ...baseRepo,

      async create(data: any) {
        return await baseRepo.create({
          ...data,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      },

      async update(id: number, data: any) {
        return await baseRepo.update(id, {
          ...data,
          updated_at: new Date().toISOString()
        })
      }
    }
  }
})
```

### Debug Plugin

```typescript
export const debugPlugin = (): Plugin => ({
  name: '@kysera/debug',
  version: '1.0.0',

  afterQuery(context, result) {
    console.log(`[DEBUG] ${context.operation} ${context.table}`)
    console.log(`[DEBUG] SQL: ${context.sql}`)
    console.log(`[DEBUG] Result:`, result)
    return result
  },

  onError(context, error) {
    console.error(`[ERROR] ${context.operation} ${context.table}`)
    console.error(`[ERROR]`, error)
  }
})
```

## Conclusion

Kysera's plugin system is designed for simplicity and explicitness. Focus on extending repositories with new methods rather than trying to intercept queries at a low level.

---

**Last Updated**: 2025-10-01
**Kysera Version**: 0.1.0
