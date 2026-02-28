// @ts-nocheck - Test file with dynamic types that don't match strict TypeScript mode
/**
 * PostgreSQL Schema Support Integration Tests for DAL
 *
 * These tests verify that the DAL properly handles PostgreSQL schemas
 * and that schema context is preserved through transactions and queries.
 *
 * Run with: pnpm test:docker or docker-compose -f docker-compose.test.yml up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
import type { Generated } from 'kysely'
import pg from 'pg'
import {
  createExecutor,
  type Plugin,
  type QueryBuilderContext
} from '@kysera/executor'
import {
  createContext,
  createSchemaContext,
  withTransaction,
  createQuery
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
  orders: {
    id: Generated<number>
    user_id: number
    total: number
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

// Define DAL queries
const getUsers = createQuery((ctx) =>
  ctx.db.selectFrom('users').selectAll().execute()
)

const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
)

const getUserByEmail = createQuery((ctx, email: string) =>
  ctx.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
)

const createUser = createQuery((ctx, data: { name: string; email: string; tenant_id?: number }) =>
  ctx.db.insertInto('users').values({ tenant_id: 1, ...data }).returningAll().executeTakeFirstOrThrow()
)

const updateUser = createQuery((ctx, id: number, data: { name?: string; email?: string }) =>
  ctx.db.updateTable('users').set(data).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
)

const softDeleteUser = createQuery((ctx, id: number) =>
  ctx.db.updateTable('users').set({ deleted_at: new Date() }).where('id', '=', id).execute()
)

const getUserCount = createQuery(async (ctx) => {
  const result = await ctx.db.selectFrom('users').select(sql<number>`count(*)`.as('count')).executeTakeFirstOrThrow()
  return Number(result.count)
})

describe.skipIf(!POSTGRES_AVAILABLE)('DAL - PostgreSQL Schema Integration', () => {
  let db: Kysely<TestDB>

  const TENANT_SCHEMA_1 = 'dal_tenant_1'
  const TENANT_SCHEMA_2 = 'dal_tenant_2'
  const SHARED_SCHEMA = 'dal_shared'

  beforeAll(async () => {
    const pool = new Pool(getConnectionConfig())
    db = new Kysely<TestDB>({
      dialect: new PostgresDialect({ pool })
    })

    // Clean up any existing test schemas
    await sql.raw(`DROP SCHEMA IF EXISTS ${TENANT_SCHEMA_1} CASCADE`).execute(db)
    await sql.raw(`DROP SCHEMA IF EXISTS ${TENANT_SCHEMA_2} CASCADE`).execute(db)
    await sql.raw(`DROP SCHEMA IF EXISTS ${SHARED_SCHEMA} CASCADE`).execute(db)

    // Create test schemas
    await sql.raw(`CREATE SCHEMA ${TENANT_SCHEMA_1}`).execute(db)
    await sql.raw(`CREATE SCHEMA ${TENANT_SCHEMA_2}`).execute(db)
    await sql.raw(`CREATE SCHEMA ${SHARED_SCHEMA}`).execute(db)

    // Create tables in all schemas
    for (const schema of [TENANT_SCHEMA_1, TENANT_SCHEMA_2, SHARED_SCHEMA]) {
      await db.withSchema(schema).schema
        .createTable('users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('name', 'text', col => col.notNull())
        .addColumn('email', 'text', col => col.notNull())
        .addColumn('deleted_at', 'timestamp')
        .addColumn('tenant_id', 'integer', col => col.notNull().defaultTo(1))
        .execute()

      await db.withSchema(schema).schema
        .createTable('posts')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('user_id', 'integer', col => col.notNull())
        .addColumn('title', 'text', col => col.notNull())
        .addColumn('deleted_at', 'timestamp')
        .execute()

      await db.withSchema(schema).schema
        .createTable('orders')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('user_id', 'integer', col => col.notNull())
        .addColumn('total', 'integer', col => col.notNull().defaultTo(0))
        .execute()
    }
  })

  afterAll(async () => {
    await sql.raw(`DROP SCHEMA IF EXISTS ${TENANT_SCHEMA_1} CASCADE`).execute(db)
    await sql.raw(`DROP SCHEMA IF EXISTS ${TENANT_SCHEMA_2} CASCADE`).execute(db)
    await sql.raw(`DROP SCHEMA IF EXISTS ${SHARED_SCHEMA} CASCADE`).execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    // Insert test data in tenant 1 schema
    await db.withSchema(TENANT_SCHEMA_1).insertInto('users').values([
      { name: 'Alice', email: 'alice@tenant1.com', tenant_id: 1 },
      { name: 'Bob', email: 'bob@tenant1.com', tenant_id: 1 },
      { name: 'Deleted User', email: 'deleted@tenant1.com', deleted_at: new Date(), tenant_id: 1 }
    ]).execute()

    // Insert test data in tenant 2 schema
    await db.withSchema(TENANT_SCHEMA_2).insertInto('users').values([
      { name: 'Charlie', email: 'charlie@tenant2.com', tenant_id: 1 },
      { name: 'Diana', email: 'diana@tenant2.com', tenant_id: 1 }
    ]).execute()

    // Insert test data in shared schema
    await db.withSchema(SHARED_SCHEMA).insertInto('users').values([
      { name: 'SharedUser', email: 'shared@example.com', tenant_id: 0 }
    ]).execute()
  })

  afterEach(async () => {
    // Clean up data
    for (const schema of [TENANT_SCHEMA_1, TENANT_SCHEMA_2, SHARED_SCHEMA]) {
      await db.withSchema(schema).deleteFrom('orders').execute()
      await db.withSchema(schema).deleteFrom('posts').execute()
      await db.withSchema(schema).deleteFrom('users').execute()
    }
  })

  describe('createContext with schema', () => {
    it('should create context with schema option', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createContext(executor, { schema: TENANT_SCHEMA_1 })

      expect(ctx.schema).toBe(TENANT_SCHEMA_1)
      expect(ctx.isTransaction).toBe(false)
    })

    it('should scope queries to specified schema', async () => {
      const executor = await createExecutor(db, [])

      const ctx1 = createContext(executor, { schema: TENANT_SCHEMA_1 })
      const ctx2 = createContext(executor, { schema: TENANT_SCHEMA_2 })

      const tenant1Users = await getUsers(ctx1)
      const tenant2Users = await getUsers(ctx2)

      expect(tenant1Users.length).toBe(3)
      expect(tenant2Users.length).toBe(2)

      expect(tenant1Users.some(u => u.name === 'Alice')).toBe(true)
      expect(tenant2Users.some(u => u.name === 'Charlie')).toBe(true)
    })
  })

  describe('createSchemaContext', () => {
    it('should create schema-scoped context', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_1)

      expect(ctx.schema).toBe(TENANT_SCHEMA_1)
      expect(ctx.isTransaction).toBe(false)
    })

    it('should execute queries in correct schema', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_2)

      const users = await getUsers(ctx)
      expect(users.length).toBe(2)
      expect(users.every(u => u.email.includes('tenant2'))).toBe(true)
    })

    it('should work with plugins', async () => {
      const executor = await createExecutor(db, [createTestSoftDeletePlugin()])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_1)

      // Without plugin: 3 users (including deleted)
      // With plugin: 2 users (excluding deleted)
      const users = await getUsers(ctx)
      expect(users.length).toBe(2)
      expect(users.every(u => u.deleted_at === null)).toBe(true)
    })
  })

  describe('withTransaction with schema', () => {
    it('should preserve schema in transaction', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_1)

      const result = await withTransaction(ctx, async (txCtx) => {
        // Schema should be preserved
        expect(txCtx.schema).toBe(TENANT_SCHEMA_1)

        // Should only see tenant 1 users
        const users = await getUsers(txCtx)
        expect(users.length).toBe(3)

        return users
      })

      expect(result.length).toBe(3)
    })

    it('should commit transaction in correct schema', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_1)

      await withTransaction(ctx, async (txCtx) => {
        await createUser(txCtx, { name: 'NewUser', email: 'new@tenant1.com' })
      })

      // Verify committed in correct schema
      const users = await getUsers(createSchemaContext(executor, TENANT_SCHEMA_1))
      expect(users.some(u => u.name === 'NewUser')).toBe(true)

      // Should NOT appear in other schema
      const otherUsers = await getUsers(createSchemaContext(executor, TENANT_SCHEMA_2))
      expect(otherUsers.some(u => u.name === 'NewUser')).toBe(false)
    })

    it('should rollback transaction in correct schema', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_1)

      const countBefore = await getUserCount(ctx)

      try {
        await withTransaction(ctx, async (txCtx) => {
          await createUser(txCtx, { name: 'WillRollback', email: 'rollback@test.com' })
          throw new Error('Force rollback')
        })
      } catch {
        // Expected
      }

      // Verify NOT committed
      const countAfter = await getUserCount(createSchemaContext(executor, TENANT_SCHEMA_1))
      expect(countAfter).toBe(countBefore)
    })

    it('should apply plugins within schema transaction', async () => {
      const executor = await createExecutor(db, [createTestSoftDeletePlugin()])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_1)

      await withTransaction(ctx, async (txCtx) => {
        // Soft-delete filter should be applied
        const users = await getUsers(txCtx)
        expect(users.length).toBe(2) // Deleted user excluded
      })
    })

    it('should support nested transactions with savepoints', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_1)

      await withTransaction(ctx, async (outerCtx) => {
        await createUser(outerCtx, { name: 'OuterUser', email: 'outer@test.com' })

        try {
          await withTransaction(outerCtx, async (innerCtx) => {
            // Schema should still be preserved in nested transaction
            expect(innerCtx.schema).toBe(TENANT_SCHEMA_1)

            await createUser(innerCtx, { name: 'InnerUser', email: 'inner@test.com' })
            throw new Error('Force savepoint rollback')
          })
        } catch {
          // Savepoint rolled back, but outer transaction continues
        }

        // Verify outer user still exists in transaction
        const user = await getUserByEmail(outerCtx, 'outer@test.com')
        expect(user).toBeDefined()

        // Verify inner user was rolled back
        const innerUser = await getUserByEmail(outerCtx, 'inner@test.com')
        expect(innerUser).toBeUndefined()
      })

      // Verify outer user committed
      const committedUser = await getUserByEmail(ctx, 'outer@test.com')
      expect(committedUser).toBeDefined()
    })
  })

  describe('Multi-tenant patterns', () => {
    it('should isolate data between tenant schemas', async () => {
      const executor = await createExecutor(db, [])

      // Create user in tenant 1
      const ctx1 = createSchemaContext(executor, TENANT_SCHEMA_1)
      await createUser(ctx1, { name: 'Tenant1User', email: 'unique@tenant1.com' })

      // Create user in tenant 2
      const ctx2 = createSchemaContext(executor, TENANT_SCHEMA_2)
      await createUser(ctx2, { name: 'Tenant2User', email: 'unique@tenant2.com' })

      // Verify isolation
      const tenant1Users = await getUsers(ctx1)
      const tenant2Users = await getUsers(ctx2)

      expect(tenant1Users.some(u => u.email === 'unique@tenant1.com')).toBe(true)
      expect(tenant1Users.some(u => u.email === 'unique@tenant2.com')).toBe(false)

      expect(tenant2Users.some(u => u.email === 'unique@tenant1.com')).toBe(false)
      expect(tenant2Users.some(u => u.email === 'unique@tenant2.com')).toBe(true)
    })

    it('should support cross-tenant operations in transaction', async () => {
      const executor = await createExecutor(db, [])

      // Get users from both tenants in a single "coordination" context
      const ctx1 = createSchemaContext(executor, TENANT_SCHEMA_1)
      const ctx2 = createSchemaContext(executor, TENANT_SCHEMA_2)

      const [tenant1Count, tenant2Count] = await Promise.all([
        getUserCount(ctx1),
        getUserCount(ctx2)
      ])

      expect(tenant1Count).toBe(3)
      expect(tenant2Count).toBe(2)
    })

    it('should support shared schema for global data', async () => {
      const executor = await createExecutor(db, [])
      const sharedCtx = createSchemaContext(executor, SHARED_SCHEMA)

      // Query shared data
      const sharedUsers = await getUsers(sharedCtx)
      expect(sharedUsers.length).toBe(1)
      expect(sharedUsers[0]?.name).toBe('SharedUser')
    })
  })

  describe('DAL query composability with schema', () => {
    // Complex query using multiple DAL functions
    const getUserWithStats = createQuery(async (ctx, userId: number) => {
      const user = await getUserById(ctx, userId)
      if (!user) return null

      const orderCount = await ctx.db
        .selectFrom('orders')
        .select(sql<number>`count(*)`.as('count'))
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow()

      return {
        ...user,
        orderCount: Number(orderCount.count)
      }
    })

    it('should compose queries with schema context', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_1)

      // Get Alice
      const alice = await getUserByEmail(ctx, 'alice@tenant1.com')
      expect(alice).toBeDefined()

      // Insert orders for Alice
      await ctx.db.insertInto('orders').values([
        { user_id: alice!.id, total: 100 },
        { user_id: alice!.id, total: 200 }
      ]).execute()

      // Get user with stats
      const userWithStats = await getUserWithStats(ctx, alice!.id)
      expect(userWithStats).toBeDefined()
      expect(userWithStats!.name).toBe('Alice')
      expect(userWithStats!.orderCount).toBe(2)
    })

    it('should execute composed queries in transaction', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_1)

      await withTransaction(ctx, async (txCtx) => {
        // Create user and orders atomically
        const user = await createUser(txCtx, { name: 'NewCustomer', email: 'customer@test.com' })

        await txCtx.db.insertInto('orders').values([
          { user_id: user.id, total: 500 }
        ]).execute()

        const stats = await getUserWithStats(txCtx, user.id)
        expect(stats!.orderCount).toBe(1)
      })
    })
  })

  describe('Error handling with schema', () => {
    it('should throw meaningful error when querying wrong schema', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createSchemaContext(executor, 'nonexistent_schema')

      await expect(getUsers(ctx)).rejects.toThrow()
    })

    it('should rollback on constraint violation in specific schema', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createSchemaContext(executor, TENANT_SCHEMA_1)

      const countBefore = await getUserCount(ctx)

      await expect(
        withTransaction(ctx, async (txCtx) => {
          // This should succeed
          await createUser(txCtx, { name: 'User1', email: 'user1@test.com' })

          // This should fail due to NOT NULL constraint on title
          await txCtx.db.insertInto('posts').values({
            user_id: 1,
            title: null as unknown as string // NOT NULL violation
          }).execute()
        })
      ).rejects.toThrow()

      // All changes should be rolled back
      const countAfter = await getUserCount(ctx)
      expect(countAfter).toBe(countBefore)
    })
  })

  describe('Context without schema (default behavior)', () => {
    it('should work without schema option', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createContext(executor)

      expect(ctx.schema).toBeUndefined()
      expect(ctx.isTransaction).toBe(false)
    })

    it('should allow explicit withSchema in queries', async () => {
      const executor = await createExecutor(db, [])
      const ctx = createContext(executor)

      // Manually use withSchema in query
      const users = await ctx.db
        .withSchema(TENANT_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()

      expect(users.length).toBe(3)
    })
  })
})
