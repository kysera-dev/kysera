/**
 * Tests for SchemaPlugin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import {
  createExecutor,
  schemaPlugin,
  getResolvedSchema,
  SchemaValidationError,
  type QueryBuilderContext
} from '../src/index.js'

interface TestDB {
  users: {
    id: number
    name: string
  }
}

describe('SchemaPlugin', () => {
  let db: Kysely<TestDB>

  beforeEach(async () => {
    const database = new Database(':memory:')
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database })
    })

    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col => col.primaryKey())
      .addColumn('name', 'text', col => col.notNull())
      .execute()
  })

  describe('Basic Configuration', () => {
    it('should use public as default schema', async () => {
      const executor = await createExecutor(db, [schemaPlugin()])

      expect(executor.__plugins.length).toBe(1)
      expect(executor.__plugins[0]!.name).toBe('@kysera/schema')
    })

    it('should accept custom default schema', async () => {
      const executor = await createExecutor(db, [
        schemaPlugin({ defaultSchema: 'custom' })
      ])

      expect(executor.__plugins.length).toBe(1)
    })

    it('should have high priority (1000)', async () => {
      const executor = await createExecutor(db, [schemaPlugin()])

      expect(executor.__plugins[0]!.priority).toBe(1000)
    })
  })

  describe('Schema Validation', () => {
    it('should validate default schema during initialization', async () => {
      const validateSchema = vi.fn().mockResolvedValue(true)

      await createExecutor(db, [
        schemaPlugin({ defaultSchema: 'test', validateSchema })
      ])

      expect(validateSchema).toHaveBeenCalledWith('test')
    })

    it('should throw when default schema validation fails', async () => {
      const validateSchema = vi.fn().mockResolvedValue(false)

      // SchemaValidationError is wrapped in PluginValidationError during init
      await expect(
        createExecutor(db, [
          schemaPlugin({ defaultSchema: 'invalid', validateSchema })
        ])
      ).rejects.toThrow(/Invalid default schema/)
    })

    it('should throw when default schema not in allowedSchemas', async () => {
      await expect(
        createExecutor(db, [
          schemaPlugin({
            defaultSchema: 'not_allowed',
            allowedSchemas: ['public', 'auth']
          })
        ])
      ).rejects.toThrow(/not in allowed list/)
    })
  })

  describe('Allowed Schemas Whitelist', () => {
    it('should allow queries with whitelisted schemas', async () => {
      const executor = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: 'public',
          allowedSchemas: ['public', 'auth', 'admin']
        })
      ])

      // Should not throw
      await executor.selectFrom('users').selectAll().execute()
    })

    it('should throw for non-whitelisted schema in strict mode', async () => {
      const executor = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: 'public',
          allowedSchemas: ['public'],
          resolveSchema: () => 'unauthorized_schema',
          strictValidation: true
        })
      ])

      // The SchemaValidationError is thrown synchronously during selectFrom()
      // (when interceptors run), not as a rejected promise during execute()
      expect(() => {
        executor.selectFrom('users').selectAll()
      }).toThrow(/not in allowed list/)
    })

    it('should fall back to default schema in non-strict mode', async () => {
      let resolvedSchema: string | undefined

      const executor = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: 'public',
          allowedSchemas: ['public'],
          resolveSchema: () => 'unauthorized_schema',
          strictValidation: false
        }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            resolvedSchema = ctx.metadata['__resolvedSchema'] as string
            return qb
          }
        }
      ])

      await executor.selectFrom('users').selectAll().execute()

      expect(resolvedSchema).toBe('public')
    })
  })

  describe('Dynamic Schema Resolution', () => {
    it('should resolve schema from context', async () => {
      let capturedSchema: string | undefined

      const executor = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: 'public',
          resolveSchema: (ctx) => {
            if (ctx.table === 'users') return 'auth'
            return undefined
          }
        }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            capturedSchema = ctx.metadata['__resolvedSchema'] as string
            return qb
          }
        }
      ])

      await executor.selectFrom('users').selectAll().execute()

      expect(capturedSchema).toBe('auth')
    })

    it('should use default when resolver returns undefined', async () => {
      let capturedSchema: string | undefined

      const executor = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: 'fallback',
          resolveSchema: () => undefined
        }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            capturedSchema = ctx.metadata['__resolvedSchema'] as string
            return qb
          }
        }
      ])

      await executor.selectFrom('users').selectAll().execute()

      expect(capturedSchema).toBe('fallback')
    })

    it('should use schema from context when withSchema was called', async () => {
      let capturedContextSchema: string | undefined
      let capturedResolvedSchema: string | undefined

      const executor = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: 'public'
        }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            capturedContextSchema = ctx.schema
            capturedResolvedSchema = ctx.metadata['__resolvedSchema'] as string
            return qb
          }
        }
      ])

      // Use withSchema - the interceptors capture context during selectFrom()
      // SQLite doesn't support schemas, so execute() will fail, but context is already captured
      try {
        await executor.withSchema('tenant_1').selectFrom('users').selectAll().execute()
      } catch {
        // SQLite doesn't support schemas - that's expected
      }

      // Context should have been captured before the SQLite error
      expect(capturedContextSchema).toBe('tenant_1')
      expect(capturedResolvedSchema).toBe('tenant_1')
    })

    it('should allow resolveSchema to read from context.schema', async () => {
      let capturedResolvedSchema: string | undefined

      const executor = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: 'public',
          // Documented pattern: use context.schema (set by withSchema) as fallback
          resolveSchema: (ctx) => ctx.schema ?? 'public'
        }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            capturedResolvedSchema = ctx.metadata['__resolvedSchema'] as string
            return qb
          }
        }
      ])

      // Without withSchema - should use default
      await executor.selectFrom('users').selectAll().execute()
      expect(capturedResolvedSchema).toBe('public')

      // With withSchema - resolveSchema reads context.schema
      try {
        await executor.withSchema('tenant_abc').selectFrom('users').selectAll().execute()
      } catch {
        // SQLite doesn't support schemas
      }
      expect(capturedResolvedSchema).toBe('tenant_abc')
    })

    it('should support table-based routing with context.schema fallback', async () => {
      const capturedSchemas: string[] = []

      const executor = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: 'public',
          // Table-based auto-routing pattern from documentation
          resolveSchema: (ctx) => {
            if (ctx.table.startsWith('auth_')) return 'auth'
            if (ctx.table.startsWith('admin_')) return 'admin'
            return ctx.schema // fallback to withSchema() value
          }
        }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            capturedSchemas.push(ctx.metadata['__resolvedSchema'] as string)
            return qb
          }
        }
      ])

      // Regular table without withSchema - falls through to default
      await executor.selectFrom('users').selectAll().execute()
      expect(capturedSchemas[0]).toBe('public')

      // auth_ prefixed table - auto-routes to 'auth' schema
      try {
        await executor.selectFrom('auth_tokens' as 'users').selectAll().execute()
      } catch {
        // Table doesn't exist - but interceptor still runs
      }
      expect(capturedSchemas[1]).toBe('auth')

      // Regular table with withSchema - uses context.schema
      try {
        await executor.withSchema('tenant_123').selectFrom('users').selectAll().execute()
      } catch {
        // SQLite doesn't support schemas
      }
      expect(capturedSchemas[2]).toBe('tenant_123')
    })

    it('should follow resolution priority: resolveSchema > context.schema > defaultSchema', async () => {
      const capturedSchemas: string[] = []

      // Priority test: resolveSchema returns explicit value
      const executor1 = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: 'default',
          resolveSchema: () => 'resolved' // Always returns 'resolved'
        }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            capturedSchemas.push(ctx.metadata['__resolvedSchema'] as string)
            return qb
          }
        }
      ])

      // resolveSchema takes priority over both context.schema and defaultSchema
      try {
        await executor1.withSchema('from_withSchema').selectFrom('users').selectAll().execute()
      } catch {
        // SQLite doesn't support schemas
      }
      expect(capturedSchemas[0]).toBe('resolved')

      // Priority test: resolveSchema returns undefined, falls back to context.schema
      capturedSchemas.length = 0
      const executor2 = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: 'default',
          resolveSchema: () => undefined // Returns undefined
        }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            capturedSchemas.push(ctx.metadata['__resolvedSchema'] as string)
            return qb
          }
        }
      ])

      try {
        await executor2.withSchema('from_withSchema').selectFrom('users').selectAll().execute()
      } catch {
        // SQLite doesn't support schemas
      }
      expect(capturedSchemas[0]).toBe('from_withSchema')

      // Priority test: resolveSchema returns undefined, no withSchema, falls back to default
      capturedSchemas.length = 0
      await executor2.selectFrom('users').selectAll().execute()
      expect(capturedSchemas[0]).toBe('default')
    })
  })

  describe('getResolvedSchema helper', () => {
    it('should return resolved schema from context', () => {
      const ctx: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: { __resolvedSchema: 'test_schema' }
      }

      expect(getResolvedSchema(ctx)).toBe('test_schema')
    })

    it('should return undefined when no schema resolved', () => {
      const ctx: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      expect(getResolvedSchema(ctx)).toBeUndefined()
    })
  })

  describe('SchemaValidationError', () => {
    it('should contain error details', () => {
      const error = new SchemaValidationError(
        'Schema not allowed',
        'bad_schema',
        ['public', 'auth']
      )

      expect(error.name).toBe('SchemaValidationError')
      expect(error.message).toBe('Schema not allowed')
      expect(error.schema).toBe('bad_schema')
      expect(error.allowedSchemas).toEqual(['public', 'auth'])
    })
  })

  describe('Integration with Executor', () => {
    it('should work with other plugins', async () => {
      const calls: string[] = []

      const executor = await createExecutor(db, [
        schemaPlugin({ defaultSchema: 'app' }),
        {
          name: 'logger',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            calls.push(`logger: ${ctx.table}, schema: ${ctx.metadata['__resolvedSchema']}`)
            return qb
          }
        }
      ])

      await executor.selectFrom('users').selectAll().execute()

      expect(calls.length).toBe(1)
      expect(calls[0]).toContain('users')
      expect(calls[0]).toContain('app')
    })

    it('should preserve schema context through transactions', async () => {
      let capturedSchema: string | undefined

      const executor = await createExecutor(db, [
        schemaPlugin({ defaultSchema: 'transactional' }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            capturedSchema = ctx.metadata['__resolvedSchema'] as string
            return qb
          }
        }
      ])

      await executor.transaction().execute(async (trx) => {
        await trx.selectFrom('users').selectAll().execute()
      })

      expect(capturedSchema).toBe('transactional')
    })
  })
})

describe('Executor Schema Context', () => {
  let db: Kysely<TestDB>

  // Simple no-op plugin to enable proxy path
  const noOpPlugin = {
    name: 'noop',
    version: '1.0.0',
    interceptQuery: <QB>(qb: QB) => qb
  }

  beforeEach(async () => {
    const database = new Database(':memory:')
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database })
    })

    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col => col.primaryKey())
      .addColumn('name', 'text', col => col.notNull())
      .execute()
  })

  it('should track schema in QueryBuilderContext', async () => {
    let capturedSchema: string | undefined

    const executor = await createExecutor(db, [
      {
        name: 'test',
        version: '1.0.0',
        interceptQuery: (qb, ctx) => {
          capturedSchema = ctx.schema
          return qb
        }
      }
    ])

    // Without withSchema
    await executor.selectFrom('users').selectAll().execute()
    expect(capturedSchema).toBeUndefined()

    // With withSchema - SQLite doesn't support schemas, so execute() will fail
    // but the interceptor captures context during selectFrom()
    try {
      await executor.withSchema('test_schema').selectFrom('users').selectAll().execute()
    } catch {
      // SQLite doesn't support schemas - that's expected
    }
    expect(capturedSchema).toBe('test_schema')
  })

  it('should expose __schema property on executor (with interceptors)', async () => {
    // Note: __schema only works when using proxy path (i.e., with interceptors)
    const executor = await createExecutor(db, [noOpPlugin])

    expect(executor.__schema).toBeUndefined()

    const schemaExecutor = executor.withSchema('custom')
    // Cast to check the runtime property that our proxy adds
    expect((schemaExecutor as unknown as { __schema?: string }).__schema).toBe('custom')
  })

  it('should cache schema proxies (with interceptors)', async () => {
    // Note: Caching only works when using proxy path (i.e., with interceptors)
    const executor = await createExecutor(db, [noOpPlugin])

    const schema1a = executor.withSchema('schema1')
    const schema1b = executor.withSchema('schema1')
    const schema2 = executor.withSchema('schema2')

    // Same schema should return cached proxy
    expect(schema1a).toBe(schema1b)
    // Different schema should return different proxy
    expect(schema1a).not.toBe(schema2)
  })

  it('should work without interceptors but schema tracking is limited', async () => {
    // When no interceptors, Object.assign is used instead of Proxy
    // This means withSchema returns Kysely's native result, not our wrapped version
    const executor = await createExecutor(db, [])

    // __schema is undefined on non-proxy executor
    expect(executor.__schema).toBeUndefined()

    // withSchema still works (via Kysely) but returns unwrapped Kysely instance
    const schemaDb = executor.withSchema('test')
    // The returned object won't have __schema since it's not a KyseraExecutor proxy
    expect('__schema' in schemaDb).toBe(false)
  })
})
