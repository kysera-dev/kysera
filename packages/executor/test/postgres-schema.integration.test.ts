/**
 * PostgreSQL Schema Support Integration Tests for KyseraExecutor
 *
 * These tests verify that the executor properly handles PostgreSQL schemas
 * and that plugins work correctly with schema-scoped queries.
 *
 * Run with: pnpm test:docker or docker-compose -f docker-compose.test.yml up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
import type { Generated } from 'kysely'
import pg from 'pg'
import {
  createExecutor,
  schemaPlugin,
  getResolvedSchema,
  type Plugin,
  type QueryBuilderContext
} from '../src/index.js'

const { Pool } = pg

// Skip tests if PostgreSQL is not available
const POSTGRES_AVAILABLE = process.env['CI'] || process.env['POSTGRES_HOST']

interface TestDB {
  users: {
    id: Generated<number>
    name: string
    email: string
    deleted_at: Date | null
    tenant_id: number
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    deleted_at: Date | null
  }
}

const getConnectionConfig = () => ({
  host: process.env['POSTGRES_HOST'] ?? 'localhost',
  port: parseInt(process.env['POSTGRES_PORT'] ?? '5432', 10),
  user: process.env['POSTGRES_USER'] ?? 'test',
  password: process.env['POSTGRES_PASSWORD'] ?? 'test',
  database: process.env['POSTGRES_DATABASE'] ?? 'kysera_test'
})

/**
 * Create a soft-delete plugin for testing
 */
function createTestSoftDeletePlugin(): Plugin {
  return {
    name: '@kysera/soft-delete-test',
    version: '1.0.0',
    priority: 100,
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      if (context.operation !== 'select') {
        return qb
      }
      return (qb as unknown as { where: (...args: unknown[]) => QB }).where(
        'deleted_at',
        'is',
        null
      )
    }
  }
}

/**
 * Create an RLS plugin for testing
 */
function createTestRLSPlugin(tenantId: number): Plugin {
  return {
    name: '@kysera/rls-test',
    version: '1.0.0',
    priority: 90,
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      if (context.table !== 'users') {
        return qb
      }
      return (qb as unknown as { where: (...args: unknown[]) => QB }).where(
        'tenant_id',
        '=',
        tenantId
      )
    }
  }
}

describe.skipIf(!POSTGRES_AVAILABLE)('KyseraExecutor - PostgreSQL Schema Integration', () => {
  let db: Kysely<TestDB>

  const TEST_SCHEMA_1 = 'executor_test_a'
  const TEST_SCHEMA_2 = 'executor_test_b'

  beforeAll(async () => {
    const pool = new Pool(getConnectionConfig())
    db = new Kysely<TestDB>({
      dialect: new PostgresDialect({ pool })
    })

    // Clean up any existing test schemas
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA_1} CASCADE`).execute(db)
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA_2} CASCADE`).execute(db)

    // Create test schemas
    await sql.raw(`CREATE SCHEMA ${TEST_SCHEMA_1}`).execute(db)
    await sql.raw(`CREATE SCHEMA ${TEST_SCHEMA_2}`).execute(db)

    // Create tables in schema 1
    await db.withSchema(TEST_SCHEMA_1).schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('name', 'text', col => col.notNull())
      .addColumn('email', 'text', col => col.notNull())
      .addColumn('deleted_at', 'timestamp')
      .addColumn('tenant_id', 'integer', col => col.notNull().defaultTo(1))
      .execute()

    await db.withSchema(TEST_SCHEMA_1).schema
      .createTable('posts')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('user_id', 'integer', col => col.notNull())
      .addColumn('title', 'text', col => col.notNull())
      .addColumn('deleted_at', 'timestamp')
      .execute()

    // Create tables in schema 2
    await db.withSchema(TEST_SCHEMA_2).schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('name', 'text', col => col.notNull())
      .addColumn('email', 'text', col => col.notNull())
      .addColumn('deleted_at', 'timestamp')
      .addColumn('tenant_id', 'integer', col => col.notNull().defaultTo(1))
      .execute()
  })

  afterAll(async () => {
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA_1} CASCADE`).execute(db)
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA_2} CASCADE`).execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    // Insert test data in schema 1
    await db.withSchema(TEST_SCHEMA_1).insertInto('users').values([
      { name: 'Alice', email: 'alice@test.com', tenant_id: 1 },
      { name: 'Bob', email: 'bob@test.com', tenant_id: 1 },
      { name: 'Charlie (deleted)', email: 'charlie@test.com', deleted_at: new Date(), tenant_id: 1 },
      { name: 'Dave (tenant 2)', email: 'dave@test.com', tenant_id: 2 }
    ]).execute()

    // Insert test data in schema 2
    await db.withSchema(TEST_SCHEMA_2).insertInto('users').values([
      { name: 'Eve', email: 'eve@test.com', tenant_id: 1 }
    ]).execute()
  })

  afterEach(async () => {
    // Clean up data
    await db.withSchema(TEST_SCHEMA_1).deleteFrom('posts').execute()
    await db.withSchema(TEST_SCHEMA_1).deleteFrom('users').execute()
    await db.withSchema(TEST_SCHEMA_2).deleteFrom('users').execute()
  })

  describe('Basic withSchema Support', () => {
    it('should execute queries in specified schema', async () => {
      const executor = await createExecutor(db, [])

      const schema1Users = await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()

      expect(schema1Users.length).toBe(4)
      expect(schema1Users.some(u => u.name === 'Alice')).toBe(true)

      const schema2Users = await executor
        .withSchema(TEST_SCHEMA_2)
        .selectFrom('users')
        .selectAll()
        .execute()

      expect(schema2Users.length).toBe(1)
      expect(schema2Users[0]?.name).toBe('Eve')
    })

    it('should cache schema proxies for performance', async () => {
      const executor = await createExecutor(db, [createTestSoftDeletePlugin()])

      const schemaExecutor1a = executor.withSchema(TEST_SCHEMA_1)
      const schemaExecutor1b = executor.withSchema(TEST_SCHEMA_1)
      const schemaExecutor2 = executor.withSchema(TEST_SCHEMA_2)

      // Same schema returns cached proxy
      expect(schemaExecutor1a).toBe(schemaExecutor1b)
      // Different schema returns different proxy
      expect(schemaExecutor1a).not.toBe(schemaExecutor2)
    })

    it('should track __schema property on executor', async () => {
      const executor = await createExecutor(db, [createTestSoftDeletePlugin()])

      expect(executor.__schema).toBeUndefined()

      const schemaExecutor = executor.withSchema(TEST_SCHEMA_1)
      // Cast to access the runtime __schema property set by the executor proxy
      expect((schemaExecutor as unknown as { __schema?: string }).__schema).toBe(TEST_SCHEMA_1)
    })
  })

  describe('Plugin Interception with Schema', () => {
    it('should apply soft-delete filter in specific schema', async () => {
      const executor = await createExecutor(db, [createTestSoftDeletePlugin()])

      // Without soft-delete plugin: 4 users
      const allUsers = await db
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()
      expect(allUsers.length).toBe(4)

      // With soft-delete plugin: 3 users (Charlie excluded)
      const activeUsers = await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()
      expect(activeUsers.length).toBe(3)
      expect(activeUsers.every(u => !u.name.includes('deleted'))).toBe(true)
    })

    it('should apply RLS filter in specific schema', async () => {
      const executor = await createExecutor(db, [createTestRLSPlugin(1)])

      // With RLS plugin: only tenant 1 users
      const tenant1Users = await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()

      // Should include Alice, Bob, Charlie but not Dave
      expect(tenant1Users.length).toBe(3)
      expect(tenant1Users.every(u => u.tenant_id === 1)).toBe(true)
    })

    it('should apply multiple plugins in schema-scoped query', async () => {
      const executor = await createExecutor(db, [
        createTestSoftDeletePlugin(),
        createTestRLSPlugin(1)
      ])

      // With both plugins: only active tenant 1 users
      const activeUsers = await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()

      // Alice and Bob only (not Charlie-deleted, not Dave-tenant2)
      expect(activeUsers.length).toBe(2)
      expect(activeUsers.every(u => u.tenant_id === 1)).toBe(true)
      expect(activeUsers.every(u => u.deleted_at === null)).toBe(true)
    })
  })

  describe('SchemaPlugin Integration', () => {
    it('should resolve schema and set in context metadata', async () => {
      let capturedSchema: string | undefined
      let capturedResolvedSchema: string | undefined

      const executor = await createExecutor(db, [
        schemaPlugin({ defaultSchema: 'public' }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            capturedSchema = ctx.schema
            capturedResolvedSchema = getResolvedSchema(ctx)
            return qb
          }
        }
      ])

      await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()

      expect(capturedSchema).toBe(TEST_SCHEMA_1)
      expect(capturedResolvedSchema).toBe(TEST_SCHEMA_1)
    })

    it('should use default schema when none specified', async () => {
      let capturedResolvedSchema: string | undefined

      const executor = await createExecutor(db, [
        schemaPlugin({ defaultSchema: TEST_SCHEMA_1 }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            capturedResolvedSchema = getResolvedSchema(ctx)
            return qb
          }
        }
      ])

      await executor.selectFrom('users').selectAll().execute()

      expect(capturedResolvedSchema).toBe(TEST_SCHEMA_1)
    })

    it('should validate allowed schemas', async () => {
      await expect(
        createExecutor(db, [
          schemaPlugin({
            defaultSchema: TEST_SCHEMA_1,
            allowedSchemas: [TEST_SCHEMA_2]
          })
        ])
      ).rejects.toThrow(/not in allowed list/)
    })

    it('should resolve schema dynamically based on table', async () => {
      let capturedSchemas: string[] = []

      const executor = await createExecutor(db, [
        schemaPlugin({
          defaultSchema: TEST_SCHEMA_1,
          resolveSchema: (ctx) => {
            // Use different schema for users table
            if (ctx.table === 'users') {
              return TEST_SCHEMA_2
            }
            return undefined
          }
        }),
        {
          name: 'test-capture',
          version: '1.0.0',
          interceptQuery: (qb, ctx) => {
            const schema = getResolvedSchema(ctx)
            if (schema) capturedSchemas.push(schema)
            return qb
          }
        }
      ])

      // Query users - should resolve to schema 2
      await executor.selectFrom('users').selectAll().execute()
      expect(capturedSchemas[0]).toBe(TEST_SCHEMA_2)

      capturedSchemas = []

      // Create posts table in schema 1 for this test
      await db.withSchema(TEST_SCHEMA_1).insertInto('posts').values({
        user_id: 1,
        title: 'Test Post'
      }).execute()

      // Query posts - should use default schema 1
      await executor.selectFrom('posts').selectAll().execute()
      expect(capturedSchemas[0]).toBe(TEST_SCHEMA_1)
    })
  })

  describe('Transactions with Schema', () => {
    it('should preserve schema context in transaction', async () => {
      const executor = await createExecutor(db, [createTestSoftDeletePlugin()])

      await executor.withSchema(TEST_SCHEMA_1).transaction().execute(async (trx) => {
        // Insert user
        await trx.insertInto('users').values({
          name: 'Frank',
          email: 'frank@test.com',
          tenant_id: 1
        }).execute()

        // Verify with soft-delete filter
        const users = await trx.selectFrom('users').selectAll().execute()
        expect(users.some(u => u.name === 'Frank')).toBe(true)
      })

      // Verify committed
      const allUsers = await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()
      expect(allUsers.some(u => u.name === 'Frank')).toBe(true)
    })

    it('should rollback transaction in specific schema', async () => {
      const executor = await createExecutor(db, [])

      try {
        await executor.withSchema(TEST_SCHEMA_1).transaction().execute(async (trx) => {
          await trx.insertInto('users').values({
            name: 'Grace',
            email: 'grace@test.com',
            tenant_id: 1
          }).execute()

          // Force rollback
          throw new Error('Force rollback')
        })
      } catch {
        // Expected
      }

      // Verify NOT committed
      const users = await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()
      expect(users.some(u => u.name === 'Grace')).toBe(false)
    })

    it('should apply plugins in transaction within schema', async () => {
      const executor = await createExecutor(db, [createTestSoftDeletePlugin()])

      await executor.withSchema(TEST_SCHEMA_1).transaction().execute(async (trx) => {
        // Should only see active users
        const users = await trx.selectFrom('users').selectAll().execute()
        expect(users.length).toBe(3) // Not 4, because Charlie is soft-deleted
      })
    })
  })

  describe('Cross-Schema Operations', () => {
    it('should support queries across different schemas', async () => {
      const executor = await createExecutor(db, [])

      const schema1Users = await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()

      const schema2Users = await executor
        .withSchema(TEST_SCHEMA_2)
        .selectFrom('users')
        .selectAll()
        .execute()

      expect(schema1Users.length).toBe(4)
      expect(schema2Users.length).toBe(1)

      // Combined count
      expect(schema1Users.length + schema2Users.length).toBe(5)
    })

    it('should maintain isolation between schemas', async () => {
      const executor = await createExecutor(db, [])

      // Insert in schema 1
      await executor.withSchema(TEST_SCHEMA_1).insertInto('users').values({
        name: 'Schema1User',
        email: 'schema1@test.com',
        tenant_id: 1
      }).execute()

      // Insert in schema 2
      await executor.withSchema(TEST_SCHEMA_2).insertInto('users').values({
        name: 'Schema2User',
        email: 'schema2@test.com',
        tenant_id: 1
      }).execute()

      // Each schema should only see its own data
      const schema1Users = await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()
      expect(schema1Users.some(u => u.name === 'Schema1User')).toBe(true)
      expect(schema1Users.some(u => u.name === 'Schema2User')).toBe(false)

      const schema2Users = await executor
        .withSchema(TEST_SCHEMA_2)
        .selectFrom('users')
        .selectAll()
        .execute()
      expect(schema2Users.some(u => u.name === 'Schema1User')).toBe(false)
      expect(schema2Users.some(u => u.name === 'Schema2User')).toBe(true)
    })
  })

  describe('Insert/Update/Delete with Schema', () => {
    it('should insert into specific schema', async () => {
      const executor = await createExecutor(db, [])

      const result = await executor
        .withSchema(TEST_SCHEMA_1)
        .insertInto('users')
        .values({ name: 'NewUser', email: 'new@test.com', tenant_id: 1 })
        .returningAll()
        .executeTakeFirstOrThrow()

      expect(result.name).toBe('NewUser')
      expect(result.id).toBeGreaterThan(0)
    })

    it('should update in specific schema', async () => {
      const executor = await createExecutor(db, [])

      await executor
        .withSchema(TEST_SCHEMA_1)
        .updateTable('users')
        .set({ name: 'Alice Updated' })
        .where('email', '=', 'alice@test.com')
        .execute()

      const updated = await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .where('email', '=', 'alice@test.com')
        .executeTakeFirst()

      expect(updated?.name).toBe('Alice Updated')
    })

    it('should delete from specific schema', async () => {
      const executor = await createExecutor(db, [])

      await executor
        .withSchema(TEST_SCHEMA_1)
        .deleteFrom('users')
        .where('email', '=', 'bob@test.com')
        .execute()

      const users = await executor
        .withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()

      expect(users.some(u => u.email === 'bob@test.com')).toBe(false)
    })
  })
})
