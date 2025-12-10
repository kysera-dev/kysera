---
sidebar_position: 6
title: Plugin Authoring Guide
description: How to create custom plugins for Kysera
---

# Plugin Authoring Guide

Learn how to create custom plugins to extend Kysera's functionality.

## Plugin Architecture

Kysera plugins use a **Method Override pattern**, not full query interception. This provides:

- **Simplicity**: Easier to understand and maintain
- **Explicitness**: Developers know exactly what methods they're calling
- **Type Safety**: Full TypeScript support
- **Predictability**: No hidden query transformations

## Plugin Interface

```typescript
interface Plugin {
  name: string
  version: string
  dependencies?: string[]      // Plugins this depends on
  priority?: number            // Higher = runs first
  conflictsWith?: string[]     // Incompatible plugins

  // Lifecycle
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void

  // Query interception (limited to SELECT)
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB

  // Result handling
  afterQuery?(context: QueryContext, result: unknown): Promise<unknown> | unknown
  onError?(context: QueryContext, error: unknown): Promise<void> | void

  // Repository extension (primary mechanism)
  extendRepository?<T>(repo: T): T
}
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
export const myPlugin = (options: MyPluginOptions = {}): Plugin => {
  const {
    enabled = true,
    customField = 'default',
    logger = silentLogger
  } = options

  return {
    name: '@myorg/my-plugin',
    version: '1.0.0',

    async onInit(executor) {
      logger.info('MyPlugin initialized')
      // Setup code (e.g., verify tables exist)
    },

    extendRepository<T extends object>(repo: T): T {
      if (!enabled) return repo

      const baseRepo = repo as BaseRepository

      return {
        ...baseRepo,

        // Add new method
        async myCustomMethod() {
          logger.debug('Custom method called')
          return 'result'
        },

        // Override existing method
        async findAll() {
          logger.debug('findAll with custom logic')
          const result = await baseRepo.findAll()
          return result.map(row => ({ ...row, [customField]: true }))
        }
      } as T
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

### 1. Method Override (Recommended)

Add or replace repository methods:

```typescript
extendRepository(repo) {
  return {
    ...repo,
    async softDelete(id: number) {
      return await repo.update(id, { deleted_at: new Date().toISOString() })
    },
    async findAll() {
      // Override to filter deleted
      return await repo.executor
        .selectFrom(repo.tableName)
        .where('deleted_at', 'is', null)
        .selectAll()
        .execute()
    }
  }
}
```

### 2. Query Interception (SELECT only)

Filter SELECT queries automatically:

```typescript
interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
  if (context.operation === 'select' && !context.metadata['includeDeleted']) {
    return (qb as any).where(`${context.table}.deleted_at`, 'is', null)
  }
  return qb
}
```

### 3. Result Transformation

Process query results:

```typescript
afterQuery(context, result) {
  if (context.operation === 'select' && Array.isArray(result)) {
    return result.map(row => ({
      ...row,
      email: row.email ? maskEmail(row.email) : null
    }))
  }
  return result
}
```

### 4. Error Handling

Handle or log errors:

```typescript
onError(context, error) {
  logger.error(`Error in ${context.operation} on ${context.table}`, error)
  // Don't throw - let error propagate
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
  primaryKeyColumn: z.string().default('id'),
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
import { myPlugin } from '../src'

describe('MyPlugin Integration', () => {
  it('should work with ORM', async () => {
    const orm = await createORM(db, [myPlugin()])

    const repo = orm.createRepository(createUserRepository)

    const result = await repo.myCustomMethod()
    expect(result).toBe('result')
  })
})
```

## Best Practices

### 1. Use Semantic Versioning

```typescript
export const myPlugin = (): Plugin => ({
  name: '@myorg/my-plugin',
  version: '1.0.0',  // Follow semver
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

### 6. Declare Dependencies

```typescript
export const myPlugin = (): Plugin => ({
  name: '@myorg/my-plugin',
  version: '1.0.0',
  dependencies: ['@kysera/soft-delete'],  // Requires soft-delete
  conflictsWith: ['@other/similar-plugin'],  // Conflicts with
  priority: 10,  // Run after soft-delete (lower priority)
})
```

## Complete Example

```typescript
import { Plugin, KyseraLogger, silentLogger } from '@kysera/core'
import { z } from 'zod'

export const CachePluginOptionsSchema = z.object({
  ttl: z.number().default(60000),
  maxSize: z.number().default(100),
  enabled: z.boolean().default(true),
})

export type CachePluginOptions = z.infer<typeof CachePluginOptionsSchema>

export const cachePlugin = (options: CachePluginOptions = {}): Plugin => {
  const config = CachePluginOptionsSchema.parse(options)
  const cache = new Map<string, { data: unknown; expires: number }>()

  return {
    name: '@kysera/cache',
    version: '1.0.0',

    extendRepository<T extends object>(repo: T): T {
      if (!config.enabled) return repo

      const baseRepo = repo as any

      return {
        ...baseRepo,

        async findById(id: number) {
          const cacheKey = `${baseRepo.tableName}:${id}`
          const cached = cache.get(cacheKey)

          if (cached && cached.expires > Date.now()) {
            return cached.data
          }

          const result = await baseRepo.findById(id)

          cache.set(cacheKey, {
            data: result,
            expires: Date.now() + config.ttl
          })

          return result
        },

        invalidateCache(id?: number) {
          if (id) {
            cache.delete(`${baseRepo.tableName}:${id}`)
          } else {
            // Clear all entries for this table
            for (const key of cache.keys()) {
              if (key.startsWith(baseRepo.tableName)) {
                cache.delete(key)
              }
            }
          }
        }
      } as T
    }
  }
}
```
