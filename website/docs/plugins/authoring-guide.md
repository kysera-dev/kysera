---
sidebar_position: 6
title: Plugin Authoring Guide
description: How to create custom plugins for Kysera
---

# Plugin Authoring Guide

Learn how to create custom plugins to extend Kysera's functionality using **@kysera/executor's** Unified Execution Layer.

## Plugin Architecture

Kysera plugins are powered by **@kysera/executor**, which provides a unified execution layer for both Repository and DAL patterns. The architecture combines:

- **Query Interception**: Modify queries before execution (works in both patterns)
- **Method Override**: Add/wrap repository methods (Repository only)
- **Lifecycle Hooks**: Initialize plugins with `onInit`
- **Type Safety**: Full TypeScript support throughout
- **Dependency Management**: Automatic validation, ordering, and conflict detection

Plugins can use both interception and method override together, providing flexibility while maintaining predictability.

## Plugin Interface

```typescript
import type { Plugin } from '@kysera/executor'

interface Plugin {
  // Identity
  readonly name: string // Unique plugin name (e.g., '@kysera/soft-delete')
  readonly version: string // Semantic version

  // Dependencies and ordering
  readonly dependencies?: readonly string[] // Plugins that must load first
  readonly priority?: number // Higher = runs first (default: 0)
  readonly conflictsWith?: readonly string[] // Incompatible plugins

  // Lifecycle: Initialize plugin (called once during setup)
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void

  // Query interception: Works in both Repository and DAL patterns
  // Applied to: selectFrom, insertInto, updateTable, deleteFrom
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB

  // Repository extension: Repository pattern only
  // Add/wrap methods after repository creation
  extendRepository?<T extends object>(repo: T): T

  // Lifecycle: Cleanup plugin (called when executor is destroyed)
  onDestroy?(): Promise<void> | void
}

interface QueryBuilderContext {
  readonly operation: 'select' | 'insert' | 'update' | 'delete'
  readonly table: string
  readonly metadata: Record<string, unknown>
}
```

### Intercepted Methods

The executor intercepts these Kysely methods for plugin processing:

```typescript
// From @kysera/executor/src/types.ts
const INTERCEPTED_METHODS = [
  'selectFrom',   // SELECT queries → operation: 'select'
  'insertInto',   // INSERT queries → operation: 'insert'
  'updateTable',  // UPDATE queries → operation: 'update'
  'deleteFrom'    // DELETE queries → operation: 'delete'
] as const
```

## Creating a Plugin

### Step 1: Define Options

```typescript
export interface MyPluginOptions {
  enabled?: boolean
  customField?: string
  logger?: KyseraLogger
}
```

### Step 2: Create Plugin Factory

```typescript
import type { Plugin } from '@kysera/executor'
import { getRawDb } from '@kysera/executor'
import type { Kysely } from 'kysely'
import { silentLogger, type KyseraLogger } from '@kysera/core'

export const myPlugin = (options: MyPluginOptions = {}): Plugin => {
  const { enabled = true, customField = 'default', logger = silentLogger } = options

  // Track resources for cleanup
  let cleanupInterval: NodeJS.Timeout | undefined

  return {
    name: '@myorg/my-plugin',
    version: '1.0.0',
    priority: 0, // Default priority

    async onInit(executor) {
      logger.info('MyPlugin initialized')
      // Setup code (e.g., verify tables exist)
      const result = await executor
        .selectFrom('information_schema.tables')
        .where('table_name', '=', 'my_table')
        .executeTakeFirst()

      if (!result) {
        logger.warn('Required table "my_table" not found')
      }

      // Example: Start a background task
      cleanupInterval = setInterval(() => {
        logger.debug('Plugin background task running')
      }, 60000)
    },

    interceptQuery(qb, context) {
      // Add custom query filtering (works in both Repository and DAL)
      if (context.operation === 'select' && !context.metadata['skipFilter']) {
        logger.debug(`Filtering ${context.operation} on ${context.table}`)
        return qb.where('is_active', '=', true)
      }
      return qb
    },

    extendRepository<T extends object>(repo: T): T {
      if (!enabled) return repo

      const baseRepo = repo as any

      return {
        ...baseRepo,

        // Add new method
        async myCustomMethod() {
          logger.debug('Custom method called')
          // Use getRawDb to bypass interceptors if needed
          const rawDb = getRawDb(baseRepo.executor)
          return 'result'
        },

        // Override existing method
        async findAll() {
          logger.debug('findAll with custom logic')
          const result = await baseRepo.findAll()
          return result.map(row => ({ ...row, [customField]: true }))
        }
      } as T
    },

    async onDestroy() {
      logger.info('MyPlugin cleaning up')
      // Clean up resources
      if (cleanupInterval) {
        clearInterval(cleanupInterval)
        cleanupInterval = undefined
      }
      // Close connections, clear caches, etc.
    }
  }
}
```

### Step 3: Export Plugin

```typescript
// src/index.ts
export { myPlugin } from './plugin'
export type { MyPluginOptions } from './plugin'
```

## Plugin Patterns

### 1. Query Interception (Recommended for filtering)

Modify queries before execution. Works in **both Repository and DAL patterns**:

```typescript
import type { Plugin, QueryBuilderContext } from '@kysera/executor'

const myPlugin = (): Plugin => ({
  name: '@myorg/my-plugin',
  version: '1.0.0',

  interceptQuery(qb, context: QueryBuilderContext) {
    // Filter SELECT queries
    if (context.operation === 'select' && !context.metadata['includeDeleted']) {
      return qb.where(`${context.table}.deleted_at`, 'is', null)
    }

    // Validate INSERT operations
    if (context.operation === 'insert') {
      // Add audit fields automatically
      return qb.$call(qb => {
        // Note: This is a simplified example
        return qb
      })
    }

    return qb
  }
})
```

**Intercepted methods:**

- `selectFrom` → `operation: 'select'`
- `insertInto` → `operation: 'insert'`
- `updateTable` → `operation: 'update'`
- `deleteFrom` → `operation: 'delete'`

### 2. Repository Extension (Recommended for new methods)

Add or replace repository methods (Repository pattern only):

```typescript
extendRepository(repo) {
  const baseRepo = repo as any

  return {
    ...baseRepo,

    // Add new method
    async softDelete(id: number) {
      return await baseRepo.update(id, { deleted_at: new Date().toISOString() })
    },

    // Override existing method
    async findAll() {
      // Note: interceptQuery already filters, this is just an example
      return await baseRepo.executor
        .selectFrom(baseRepo.tableName)
        .where('deleted_at', 'is', null)
        .selectAll()
        .execute()
    }
  }
}
```

### 3. Bypassing Interceptors

Use `getRawDb` to access the underlying Kysely instance without plugin interception:

```typescript
import { getRawDb } from '@kysera/executor'

extendRepository(repo) {
  return {
    ...repo,

    async findWithDeleted(id: number) {
      // Bypass soft-delete filter
      const rawDb = getRawDb(repo.executor)
      return await rawDb
        .selectFrom(repo.tableName)
        .where('id', '=', id)
        .selectAll()
        .executeTakeFirst()
    }
  }
}
```

## Type Safety

### Define Extended Repository Type

```typescript
interface SoftDeleteMethods<T> {
  softDelete(id: number): Promise<T>
  restore(id: number): Promise<T>
  hardDelete(id: number): Promise<void>
  findWithDeleted(id: number): Promise<T | null>
}

export type SoftDeleteRepository<T, DB> = Repository<T, DB> & SoftDeleteMethods<T>
```

### Export Options Schema

```typescript
import { z } from 'zod'

export const SoftDeleteOptionsSchema = z.object({
  deletedAtColumn: z.string().default('deleted_at'),
  includeDeleted: z.boolean().default(false),
  tables: z.array(z.string()).optional(),
  primaryKeyColumn: z.string().default('id')
})

export type SoftDeleteOptions = z.infer<typeof SoftDeleteOptionsSchema>
```

## Testing Plugins

### Unit Tests

```typescript
import { describe, it, expect } from 'vitest'
import { myPlugin } from '../src'

describe('MyPlugin', () => {
  it('should create plugin with default options', () => {
    const plugin = myPlugin()

    expect(plugin.name).toBe('@myorg/my-plugin')
    expect(plugin.version).toBe('1.0.0')
  })

  it('should extend repository', () => {
    const plugin = myPlugin()

    const repo = {
      tableName: 'users',
      executor: {} as any,
      findAll: async () => []
    }

    const extended = plugin.extendRepository!(repo)

    expect(extended).toHaveProperty('myCustomMethod')
  })
})
```

### Integration Tests

```typescript
import { createORM } from '@kysera/repository'
import { createExecutor } from '@kysera/executor'
import { myPlugin } from '../src'

describe('MyPlugin Integration', () => {
  it('should work with createORM', async () => {
    const orm = await createORM(db, [myPlugin()])

    const repo = orm.createRepository(createUserRepository)

    const result = await repo.myCustomMethod()
    expect(result).toBe('result')
  })

  it('should work with executor directly', async () => {
    const executor = await createExecutor(db, [myPlugin()])

    // Query interception works with executor
    const users = await executor.selectFrom('users').selectAll().execute()

    // Plugin filtering applied automatically
    expect(users.every(u => u.is_active === true)).toBe(true)
  })
})
```

## Best Practices

### 1. Use Semantic Versioning

```typescript
export const myPlugin = (): Plugin => ({
  name: '@myorg/my-plugin',
  version: '1.0.0' // Follow semver
})
```

### 2. Document Limitations

```typescript
/**
 * MyPlugin
 *
 * NOTE: This plugin does not intercept DELETE operations.
 * Use the softDelete() method instead of delete().
 */
```

### 3. Handle Errors Gracefully

```typescript
extendRepository(repo) {
  if (!('tableName' in repo)) {
    return repo  // Return unchanged if not a proper repo
  }
  // ... extend repo
}
```

### 4. Support Configuration

```typescript
export const myPlugin = (options: MyPluginOptions = {}): Plugin => {
  const config = { ...defaultOptions, ...options }
  // Use config throughout
}
```

### 5. Use Logging

```typescript
import { silentLogger, KyseraLogger } from '@kysera/core'

export interface MyPluginOptions {
  logger?: KyseraLogger
}

export const myPlugin = (options: MyPluginOptions = {}): Plugin => {
  const logger = options.logger ?? silentLogger
  // Use logger for debug output
}
```

### 6. Declare Dependencies and Priority

```typescript
export const myPlugin = (): Plugin => ({
  name: '@myorg/my-plugin',
  version: '1.0.0',

  // Dependencies: Must load after these plugins
  dependencies: ['@kysera/soft-delete'],

  // Conflicts: Cannot be used with these plugins
  conflictsWith: ['@other/similar-plugin'],

  // Priority: Higher runs first (default: 0)
  // 50: Security plugins (RLS)
  // 10: Validation plugins
  // 0: Standard plugins
  // -10: Logging/audit plugins
  priority: 10
})
```

**Plugin order resolution:**

1. Topological sort by dependencies
2. Sort by priority (higher first)
3. Alphabetical by name (for stability)

**Validation:**

- Duplicate names → `PluginValidationError`
- Missing dependencies → `PluginValidationError`
- Circular dependencies → `PluginValidationError`
- Conflicts → `PluginValidationError`

## Complete Example: Cache Plugin with Lifecycle

```typescript
import type { Plugin, QueryBuilderContext } from '@kysera/executor'
import { getRawDb } from '@kysera/executor'
import type { Kysely } from 'kysely'
import { silentLogger, type KyseraLogger } from '@kysera/core'
import { z } from 'zod'

export const CachePluginOptionsSchema = z.object({
  ttl: z.number().default(60000),
  maxSize: z.number().default(100),
  enabled: z.boolean().default(true)
})

export type CachePluginOptions = z.infer<typeof CachePluginOptionsSchema>

export const cachePlugin = (options: CachePluginOptions = {}): Plugin => {
  const config = CachePluginOptionsSchema.parse(options)
  const cache = new Map<string, { data: unknown; expires: number }>()
  let logger: KyseraLogger = silentLogger
  let cleanupInterval: NodeJS.Timeout | undefined

  return {
    name: '@kysera/cache',
    version: '1.0.0',
    priority: -10, // Run after other plugins (logging/caching priority)

    async onInit<DB>(executor: Kysely<DB>): Promise<void> {
      logger.info?.('[Cache] Plugin initialized', {
        ttl: config.ttl,
        maxSize: config.maxSize
      })

      // Start cache cleanup interval
      if (config.enabled) {
        cleanupInterval = setInterval(() => {
          const now = Date.now()
          for (const [key, value] of cache.entries()) {
            if (value.expires < now) {
              cache.delete(key)
              logger.debug?.(`[Cache] Evicted expired key: ${key}`)
            }
          }
        }, 60000)
      }
    },

    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      // Mark queries as cacheable
      if (context.operation === 'select') {
        context.metadata['cacheable'] = true
        logger.debug?.(`[Cache] Marking ${context.table} query as cacheable`)
      }
      return qb
    },

    extendRepository<T extends object>(repo: T): T {
      if (!config.enabled) return repo

      const baseRepo = repo as any

      return {
        ...baseRepo,

        async findById(id: number) {
          const cacheKey = `${baseRepo.tableName}:${id}`
          const cached = cache.get(cacheKey)

          if (cached && cached.expires > Date.now()) {
            logger.debug?.(`[Cache] Hit: ${cacheKey}`)
            return cached.data
          }

          logger.debug?.(`[Cache] Miss: ${cacheKey}`)
          const result = await baseRepo.findById(id)

          if (cache.size >= config.maxSize) {
            // Evict oldest entry
            const firstKey = cache.keys().next().value
            cache.delete(firstKey)
          }

          cache.set(cacheKey, {
            data: result,
            expires: Date.now() + config.ttl
          })

          return result
        },

        async update(id: number, data: any) {
          const result = await baseRepo.update(id, data)
          // Invalidate cache on update
          const cacheKey = `${baseRepo.tableName}:${id}`
          cache.delete(cacheKey)
          logger.debug?.(`[Cache] Invalidated: ${cacheKey}`)
          return result
        },

        invalidateCache(id?: number) {
          if (id) {
            const cacheKey = `${baseRepo.tableName}:${id}`
            cache.delete(cacheKey)
            logger.debug?.(`[Cache] Manual invalidation: ${cacheKey}`)
          } else {
            // Clear all entries for this table
            let count = 0
            for (const key of cache.keys()) {
              if (key.startsWith(baseRepo.tableName)) {
                cache.delete(key)
                count++
              }
            }
            logger.debug?.(`[Cache] Cleared ${count} entries for ${baseRepo.tableName}`)
          }
        },

        getCacheStats() {
          return {
            size: cache.size,
            maxSize: config.maxSize,
            ttl: config.ttl
          }
        }
      } as T
    },

    async onDestroy(): Promise<void> {
      logger.info?.('[Cache] Plugin shutting down')

      // Clear cleanup interval
      if (cleanupInterval) {
        clearInterval(cleanupInterval)
        cleanupInterval = undefined
      }

      // Clear all cached data
      const cacheSize = cache.size
      cache.clear()
      logger.debug?.(`[Cache] Cleared ${cacheSize} cache entries`)
    }
  }
}
```

### Lifecycle Best Practices

1. **onInit**: Set up resources (connections, intervals, caches)
2. **interceptQuery/extendRepository**: Implement plugin functionality
3. **onDestroy**: Clean up resources to prevent memory leaks

```typescript
export const myPlugin = (): Plugin => {
  let connection: DatabaseConnection | undefined
  let interval: NodeJS.Timeout | undefined

  return {
    name: '@myorg/my-plugin',
    version: '1.0.0',

    async onInit(executor) {
      // Initialize resources
      connection = await createConnection()
      interval = setInterval(() => cleanup(), 60000)
    },

    // ... plugin implementation ...

    async onDestroy() {
      // Clean up resources
      if (interval) clearInterval(interval)
      if (connection) await connection.close()
    }
  }
}
```
