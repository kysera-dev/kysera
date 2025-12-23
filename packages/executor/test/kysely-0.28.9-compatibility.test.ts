/**
 * Kysely 0.28.9 Compatibility Tests
 *
 * Tests to verify Kysera works correctly with Kysely 0.28.9 changes:
 * - Plugin system (transformQuery, transformResult)
 * - Query builder API (selectFrom, insertInto, updateTable, deleteFrom)
 * - Transaction handling
 *
 * Key fixes in Kysely 0.28.9:
 * - withSchema() now correctly applies to DELETE USING clause (PR #1648)
 * - withSchema() no longer adds schema prefix to row-level locking clauses (PR #1659)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, sql, DefaultQueryCompiler } from 'kysely'
import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  UnknownRow,
  RootOperationNode,
  Generated
} from 'kysely'
import BetterSqlite3 from 'better-sqlite3'
import {
  createExecutor,
  createExecutorSync,
  type Plugin,
  type QueryBuilderContext
} from '../src/index.js'

interface TestDatabase {
  users: {
    id: Generated<number>
    name: string
    email: string
    tenant_id: number
    created_at: Generated<string>
  }
  orders: {
    id: Generated<number>
    user_id: number
    amount: number
    status: string
  }
}

describe('Kysely 0.28.9 Compatibility', () => {
  let db: Kysely<TestDatabase>
  let sqlite: InstanceType<typeof BetterSqlite3>

  beforeEach(() => {
    sqlite = new BetterSqlite3(':memory:')
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({ database: sqlite })
    })

    // Create tables
    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        tenant_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    sqlite.exec(`
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      )
    `)

    // Seed test data
    sqlite.exec(`
      INSERT INTO users (id, name, email, tenant_id) VALUES
        (1, 'Alice', 'alice@example.com', 1),
        (2, 'Bob', 'bob@example.com', 1),
        (3, 'Charlie', 'charlie@example.com', 2)
    `)
    sqlite.exec(`
      INSERT INTO orders (id, user_id, amount, status) VALUES
        (1, 1, 100.00, 'completed'),
        (2, 1, 200.00, 'pending'),
        (3, 2, 150.00, 'completed')
    `)
  })

  afterEach(async () => {
    await db.destroy()
  })

  describe('Plugin System Compatibility', () => {
    it('should work with KyselyPlugin interface (transformQuery/transformResult)', async () => {
      const queryLog: string[] = []

      // Create a Kysely plugin using the standard interface
      const loggingPlugin: KyselyPlugin = {
        transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
          const compiler = new DefaultQueryCompiler()
          const compiled = compiler.compileQuery(args.node, args.queryId)
          queryLog.push(compiled.sql)
          return args.node
        },
        transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
          return Promise.resolve(args.result)
        }
      }

      // Apply plugin via Kysely's withPlugin
      const dbWithPlugin = db.withPlugin(loggingPlugin)

      const result = await dbWithPlugin.selectFrom('users').selectAll().execute()

      expect(result).toHaveLength(3)
      expect(queryLog).toHaveLength(1)
      expect(queryLog[0]).toContain('select')
      expect(queryLog[0]).toContain('users')
    })

    it('should work with Kysera Plugin interface via createExecutor', async () => {
      const interceptedQueries: string[] = []

      const trackingPlugin: Plugin = {
        name: 'tracking',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          interceptedQueries.push(`${context.operation} on ${context.table}`)
          return qb
        }
      }

      const executor = createExecutorSync(db, [trackingPlugin])

      await executor.selectFrom('users').selectAll().execute()
      await executor.selectFrom('orders').selectAll().execute()

      expect(interceptedQueries).toContain('select on users')
      expect(interceptedQueries).toContain('select on orders')
    })

    it('should work with createExecutor async factory', async () => {
      const interceptedTables: string[] = []

      const simplePlugin: Plugin = {
        name: 'simple-tracking',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, ctx: QueryBuilderContext): QB {
          interceptedTables.push(ctx.table)
          return qb
        }
      }

      // createExecutor returns a Promise for consistency with async initialization patterns
      const executor = await createExecutor(db, [simplePlugin])

      const result = await executor.selectFrom('users').selectAll().execute()
      expect(result).toHaveLength(3)
      expect(interceptedTables).toContain('users')
    })
  })

  describe('Query Builder API Compatibility', () => {
    it('should support selectFrom with all common methods', async () => {
      const result = await db
        .selectFrom('users')
        .select(['id', 'name', 'email'])
        .where('tenant_id', '=', 1)
        .orderBy('name', 'asc')
        .limit(10)
        .execute()

      expect(result).toHaveLength(2)
      expect(result[0]?.name).toBe('Alice')
    })

    it('should support insertInto with returningAll (SQLite)', async () => {
      const result = await db
        .insertInto('users')
        .values({
          name: 'David',
          email: 'david@example.com',
          tenant_id: 1
        })
        .returningAll()
        .executeTakeFirst()

      expect(result).toBeDefined()
      expect(result?.name).toBe('David')
      expect(result?.id).toBe(4)
    })

    it('should support updateTable with set and where', async () => {
      const result = await db
        .updateTable('users')
        .set({ name: 'Alice Updated' })
        .where('id', '=', 1)
        .returningAll()
        .executeTakeFirst()

      expect(result).toBeDefined()
      expect(result?.name).toBe('Alice Updated')
    })

    it('should support deleteFrom with where', async () => {
      await db.deleteFrom('orders').where('status', '=', 'pending').execute()

      const remaining = await db.selectFrom('orders').selectAll().execute()
      expect(remaining).toHaveLength(2)
      expect(remaining.every(o => o.status === 'completed')).toBe(true)
    })

    it('should support complex where conditions with expression builder', async () => {
      const result = await db
        .selectFrom('users')
        .selectAll()
        .where(eb => eb.or([eb('tenant_id', '=', 1), eb('name', '=', 'Charlie')]))
        .execute()

      expect(result).toHaveLength(3)
    })

    it('should support subqueries', async () => {
      const result = await db
        .selectFrom('orders')
        .selectAll()
        .where('user_id', 'in', qb =>
          qb.selectFrom('users').select('id').where('tenant_id', '=', 1)
        )
        .execute()

      expect(result).toHaveLength(3)
    })
  })

  describe('Transaction Compatibility', () => {
    it('should support transaction with execute pattern', async () => {
      const result = await db.transaction().execute(async trx => {
        await trx
          .insertInto('users')
          .values({
            name: 'TxUser',
            email: 'tx@example.com',
            tenant_id: 1
          })
          .execute()

        return trx.selectFrom('users').selectAll().execute()
      })

      expect(result).toHaveLength(4)
    })

    it('should rollback transaction on error', async () => {
      try {
        await db.transaction().execute(async trx => {
          await trx
            .insertInto('users')
            .values({
              name: 'WillRollback',
              email: 'rollback@example.com',
              tenant_id: 1
            })
            .execute()

          throw new Error('Intentional error for rollback test')
        })
      } catch {
        // Expected error
      }

      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(3) // Original count, insert rolled back
    })
  })

  describe('SQL Template Tag Compatibility', () => {
    it('should support sql template tag for raw SQL', async () => {
      const result = await sql<{ total: number }>`
        SELECT COUNT(*) as total FROM users WHERE tenant_id = ${1}
      `.execute(db)

      expect(result.rows[0]?.total).toBe(2)
    })

    it('should support sql.raw for dynamic SQL', async () => {
      const tableName = 'users'
      const result = await sql`
        SELECT * FROM ${sql.raw(tableName)} LIMIT 1
      `.execute(db)

      expect(result.rows).toHaveLength(1)
    })
  })

  describe('DefaultQueryCompiler Compatibility', () => {
    it('should compile queries correctly with DefaultQueryCompiler', async () => {
      const query = db.selectFrom('users').select('name').where('id', '=', 1)

      const compiled = query.compile()

      expect(compiled.sql).toContain('select')
      expect(compiled.sql).toContain('"name"')
      expect(compiled.sql).toContain('users')
      expect(compiled.parameters).toContain(1)
    })

    it('should work with DefaultQueryCompiler for plugin transformations', () => {
      // Verify DefaultQueryCompiler is available and working with query compilation
      // Using expect to validate the import is available
      expect(DefaultQueryCompiler).toBeDefined()

      // Build a query node
      const query = db.selectFrom('users').selectAll().where('tenant_id', '=', 1)
      const compiled = query.compile()

      expect(compiled.sql).toMatch(/select\s+\*\s+from\s+"users"/i)
      expect(compiled.parameters).toEqual([1])
    })
  })

  describe('Executor Integration with Kysely 0.28.9', () => {
    it('should work with multiple plugins', async () => {
      const plugin1Calls: string[] = []
      const plugin2Calls: string[] = []

      const plugin1: Plugin = {
        name: 'plugin1',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, ctx: QueryBuilderContext): QB {
          plugin1Calls.push(ctx.table)
          return qb
        }
      }

      const plugin2: Plugin = {
        name: 'plugin2',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, ctx: QueryBuilderContext): QB {
          plugin2Calls.push(ctx.table)
          return qb
        }
      }

      const executor = createExecutorSync(db, [plugin1, plugin2])

      await executor.selectFrom('users').selectAll().execute()
      await executor.selectFrom('orders').selectAll().execute()

      expect(plugin1Calls).toEqual(['users', 'orders'])
      expect(plugin2Calls).toEqual(['users', 'orders'])
    })

    it('should preserve query builder methods after plugin interception', async () => {
      const filterPlugin: Plugin = {
        name: 'filter',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, ctx: QueryBuilderContext): QB {
          if (ctx.table === 'users' && ctx.operation === 'select') {
            return (qb as any).where('tenant_id', '=', 1) as QB
          }
          return qb
        }
      }

      const executor = createExecutorSync(db, [filterPlugin])

      // Additional where should be combined with plugin's where
      const result = await executor
        .selectFrom('users')
        .selectAll()
        .where('name', 'like', 'A%')
        .execute()

      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('Alice')
    })

    it('should work with transactions through executor', async () => {
      const loggingPlugin: Plugin = {
        name: 'logging',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb
        }
      }

      const executor = createExecutorSync(db, [loggingPlugin])

      const result = await executor.transaction().execute(async trx => {
        await trx
          .insertInto('users')
          .values({
            name: 'TxTest',
            email: 'txtest@example.com',
            tenant_id: 1
          })
          .execute()

        return trx.selectFrom('users').selectAll().execute()
      })

      expect(result).toHaveLength(4)
    })
  })
})
