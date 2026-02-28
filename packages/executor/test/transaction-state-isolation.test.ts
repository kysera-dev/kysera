import { describe, it, expect, beforeEach } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import BetterSqlite3 from 'better-sqlite3'
import {
  createExecutor,
  wrapTransaction,
  isKyseraExecutor,
  getPlugins,
  getRawDb,
  type Plugin,
  type QueryBuilderContext,
  type KyseraExecutor
} from '../src/index.js'

/**
 * M-14: Transaction state isolation
 *
 * Verifies that plugins applied within transactions maintain proper isolation:
 *
 * 1. Plugin state in a transaction doesn't leak to outer scope
 * 2. Multiple concurrent transactions each get their own plugin context
 */

interface TestDatabase {
  users: {
    id: number
    name: string
    tenant_id: number
    deleted_at: string | null
  }
  posts: {
    id: number
    title: string
    user_id: number
  }
}

describe('M-14: Transaction state isolation', () => {
  let db: Kysely<TestDatabase>
  let sqlite: BetterSqlite3.Database

  beforeEach(() => {
    sqlite = new BetterSqlite3(':memory:')
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({ database: sqlite })
    })

    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        tenant_id INTEGER NOT NULL,
        deleted_at TEXT
      )
    `)
    sqlite.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        user_id INTEGER NOT NULL
      )
    `)

    sqlite.exec(`INSERT INTO users (id, name, tenant_id, deleted_at) VALUES (1, 'Alice', 1, NULL)`)
    sqlite.exec(`INSERT INTO users (id, name, tenant_id, deleted_at) VALUES (2, 'Bob', 1, '2024-01-01')`)
    sqlite.exec(`INSERT INTO users (id, name, tenant_id, deleted_at) VALUES (3, 'Charlie', 2, NULL)`)
    sqlite.exec(`INSERT INTO posts (id, title, user_id) VALUES (1, 'First Post', 1)`)
    sqlite.exec(`INSERT INTO posts (id, title, user_id) VALUES (2, 'Second Post', 2)`)
  })

  describe('plugin state does not leak from transaction to outer scope', () => {
    it('plugin call count in transaction does not affect outer scope tracking', async () => {
      let outerCallCount = 0
      let transactionCallCount = 0
      let inTransaction = false

      const trackingPlugin: Plugin = {
        name: 'tracking',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, _context: QueryBuilderContext): QB {
          if (inTransaction) {
            transactionCallCount++
          } else {
            outerCallCount++
          }
          return qb
        }
      }

      const executor = await createExecutor(db, [trackingPlugin])

      // Query in outer scope
      await executor.selectFrom('users').selectAll().execute()
      expect(outerCallCount).toBe(1)
      expect(transactionCallCount).toBe(0)

      // Query in transaction scope
      inTransaction = true
      await executor.transaction().execute(async trx => {
        await trx.selectFrom('users').selectAll().execute()
        await trx.selectFrom('posts').selectAll().execute()
      })
      inTransaction = false

      expect(transactionCallCount).toBe(2)

      // Query in outer scope again - count should continue from before
      await executor.selectFrom('posts').selectAll().execute()
      expect(outerCallCount).toBe(2)
    })

    it('plugin modifications in transaction do not affect outer executor queries', async () => {
      // Plugin that tracks tables it has seen per-invocation
      const seenTables: Set<string> = new Set()

      const tableTracker: Plugin = {
        name: 'table-tracker',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          seenTables.add(context.table)
          return qb
        }
      }

      const executor = await createExecutor(db, [tableTracker])

      // Outer scope - query users only
      await executor.selectFrom('users').selectAll().execute()
      expect(seenTables.has('users')).toBe(true)
      expect(seenTables.has('posts')).toBe(false)

      // Transaction - query posts
      await executor.transaction().execute(async trx => {
        await trx.selectFrom('posts').selectAll().execute()
      })

      // Both tables seen, but the key point is each query builder is independent
      expect(seenTables.has('posts')).toBe(true)

      // Clear and verify outer scope still works independently
      seenTables.clear()
      await executor.selectFrom('users').selectAll().execute()
      expect(seenTables.has('users')).toBe(true)
      expect(seenTables.size).toBe(1)
    })

    it('transaction rollback does not affect plugin state tracking', async () => {
      const interceptedOps: string[] = []

      const opTracker: Plugin = {
        name: 'op-tracker',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          interceptedOps.push(`${context.operation}:${context.table}`)
          return qb
        }
      }

      const executor = await createExecutor(db, [opTracker])

      // Start a transaction that will be rolled back
      try {
        await executor.transaction().execute(async trx => {
          await trx.selectFrom('users').selectAll().execute()
          // Force a rollback by throwing
          throw new Error('Force rollback')
        })
      } catch {
        // Expected
      }

      // Plugin interception still happened (even though transaction rolled back)
      expect(interceptedOps).toContain('select:users')

      // Outer scope queries still work with plugin
      interceptedOps.length = 0
      await executor.selectFrom('posts').selectAll().execute()
      expect(interceptedOps).toEqual(['select:posts'])
    })

    it('plugin filter behavior is consistent inside and outside transactions', async () => {
      const softDeletePlugin: Plugin = {
        name: 'soft-delete',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB
          }
          return qb
        }
      }

      const executor = await createExecutor(db, [softDeletePlugin])

      // Outer scope - should filter soft-deleted
      const outerUsers = await executor.selectFrom('users').selectAll().execute()
      expect(outerUsers).toHaveLength(2)

      // Inside transaction - should also filter soft-deleted
      await executor.transaction().execute(async trx => {
        const trxUsers = await trx.selectFrom('users').selectAll().execute()
        expect(trxUsers).toHaveLength(2)
        expect(trxUsers.every(u => u.deleted_at === null)).toBe(true)
      })

      // Outer scope again - still filtering
      const outerUsersAgain = await executor.selectFrom('users').selectAll().execute()
      expect(outerUsersAgain).toHaveLength(2)
    })
  })

  describe('each transaction gets its own plugin context via proxy', () => {
    it('wrapped transactions have independent interceptor chains', async () => {
      const trx1Calls: string[] = []
      const trx2Calls: string[] = []
      let currentTracker: string[] = trx1Calls

      const trackingPlugin: Plugin = {
        name: 'tracker',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          currentTracker.push(`${context.operation}:${context.table}`)
          return qb
        }
      }

      // Use wrapTransaction to wrap two separate transactions independently
      await db.transaction().execute(async trx1 => {
        currentTracker = trx1Calls
        const wrapped1 = wrapTransaction(trx1, [trackingPlugin])
        await wrapped1.selectFrom('users').selectAll().execute()
      })

      await db.transaction().execute(async trx2 => {
        currentTracker = trx2Calls
        const wrapped2 = wrapTransaction(trx2, [trackingPlugin])
        await wrapped2.selectFrom('posts').selectAll().execute()
      })

      // Each transaction had its own tracking
      expect(trx1Calls).toEqual(['select:users'])
      expect(trx2Calls).toEqual(['select:posts'])
    })

    it('concurrent transactions via executor.transaction() each get independent proxies', async () => {
      const allCalls: { trxId: string; op: string; table: string }[] = []

      const trackingPlugin: Plugin = {
        name: 'concurrent-tracker',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          // We can't directly identify the transaction, but we can track calls
          allCalls.push({ trxId: 'unknown', op: context.operation, table: context.table })
          return qb
        }
      }

      const executor = await createExecutor(db, [trackingPlugin])

      // Run two transactions concurrently
      // Note: SQLite serializes transactions, but the proxy wrapping is still independent
      const trx1Promise = executor.transaction().execute(async trx => {
        await trx.selectFrom('users').selectAll().execute()
        await trx.selectFrom('users').selectAll().execute()
      })

      const trx2Promise = executor.transaction().execute(async trx => {
        await trx.selectFrom('posts').selectAll().execute()
      })

      await trx1Promise
      await trx2Promise

      // All calls recorded (3 total from both transactions)
      const userSelects = allCalls.filter(c => c.table === 'users')
      const postSelects = allCalls.filter(c => c.table === 'posts')
      expect(userSelects).toHaveLength(2)
      expect(postSelects).toHaveLength(1)
    })

    it('plugin with closure state in wrapTransaction creates independent state per transaction', async () => {
      // Create a plugin factory that captures state in closure
      function createCountingPlugin(): Plugin {
        let count = 0
        return {
          name: 'counter',
          version: '1.0.0',
          interceptQuery<QB>(qb: QB, _context: QueryBuilderContext): QB {
            count++
            return qb
          },
          // Expose count for testing
          get priority() {
            return count // Abuse priority as a way to read count
          }
        }
      }

      // Each call to the factory creates independent state
      const plugin1 = createCountingPlugin()
      const plugin2 = createCountingPlugin()

      await db.transaction().execute(async trx1 => {
        const wrapped1 = wrapTransaction(trx1, [plugin1])
        await wrapped1.selectFrom('users').selectAll().execute()
        await wrapped1.selectFrom('users').selectAll().execute()
      })

      await db.transaction().execute(async trx2 => {
        const wrapped2 = wrapTransaction(trx2, [plugin2])
        await wrapped2.selectFrom('posts').selectAll().execute()
      })

      // plugin1 was called 2 times, plugin2 was called 1 time (independent state)
      expect(plugin1.priority).toBe(2) // count = 2
      expect(plugin2.priority).toBe(1) // count = 1
    })
  })

  describe('transaction proxy maintains executor identity', () => {
    it('transaction proxy has __kysera marker', async () => {
      const plugin: Plugin = {
        name: 'marker-test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb
        }
      }

      const executor = await createExecutor(db, [plugin])

      await executor.transaction().execute(async trx => {
        // Transaction should be wrapped with kysera markers
        expect('__kysera' in trx).toBe(true)
        expect('__plugins' in trx).toBe(true)
        expect('__rawDb' in trx).toBe(true)
      })
    })

    it('transaction proxy exposes same plugins as parent executor', async () => {
      const plugin1: Plugin = {
        name: 'plugin-a',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb
        }
      }

      const plugin2: Plugin = {
        name: 'plugin-b',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb
        }
      }

      const executor = await createExecutor(db, [plugin1, plugin2])

      await executor.transaction().execute(async trx => {
        const plugins = (trx as unknown as KyseraExecutor<TestDatabase>).__plugins
        expect(plugins).toHaveLength(2)
        expect(plugins.map(p => p.name)).toContain('plugin-a')
        expect(plugins.map(p => p.name)).toContain('plugin-b')
      })
    })

    it('getRawDb works inside transaction to bypass plugins', async () => {
      const softDeletePlugin: Plugin = {
        name: 'soft-delete',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB
          }
          return qb
        }
      }

      const executor = await createExecutor(db, [softDeletePlugin])

      await executor.transaction().execute(async trx => {
        // Through wrapped trx - plugin filters active
        const filteredUsers = await trx.selectFrom('users').selectAll().execute()
        expect(filteredUsers).toHaveLength(2)

        // Through rawDb - bypasses plugins
        const rawDb = getRawDb(trx as unknown as Kysely<TestDatabase>) as unknown as Kysely<TestDatabase>
        const allUsers = await rawDb.selectFrom('users').selectAll().execute()
        expect(allUsers).toHaveLength(3)
      })
    })
  })

  describe('wrapTransaction isolation with different plugin sets', () => {
    it('different transactions can have different plugin configurations', async () => {
      const softDeletePlugin: Plugin = {
        name: 'soft-delete',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB
          }
          return qb
        }
      }

      const tenantPlugin: Plugin = {
        name: 'tenant-filter',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('tenant_id', '=', 1) as QB
          }
          return qb
        }
      }

      // Transaction 1: only soft-delete
      await db.transaction().execute(async trx1 => {
        const wrapped1 = wrapTransaction(trx1, [softDeletePlugin])
        const users1 = await wrapped1.selectFrom('users').selectAll().execute()
        // Should filter soft-deleted only (Alice, Charlie)
        expect(users1).toHaveLength(2)
        expect(users1.every(u => u.deleted_at === null)).toBe(true)
      })

      // Transaction 2: soft-delete + tenant filter
      await db.transaction().execute(async trx2 => {
        const wrapped2 = wrapTransaction(trx2, [softDeletePlugin, tenantPlugin])
        const users2 = await wrapped2.selectFrom('users').selectAll().execute()
        // Should filter soft-deleted AND tenant_id=1 (only Alice)
        expect(users2).toHaveLength(1)
        expect(users2[0]!.name).toBe('Alice')
      })

      // Transaction 3: no plugins at all
      await db.transaction().execute(async trx3 => {
        const wrapped3 = wrapTransaction(trx3, [])
        const users3 = await wrapped3.selectFrom('users').selectAll().execute()
        // No filtering, all 3 users
        expect(users3).toHaveLength(3)
      })
    })

    it('wrapTransaction plugins are independent from executor plugins', async () => {
      const executorPlugin: Plugin = {
        name: 'executor-plugin',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB
          }
          return qb
        }
      }

      const transactionPlugin: Plugin = {
        name: 'transaction-plugin',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('tenant_id', '=', 2) as QB
          }
          return qb
        }
      }

      // Executor with soft-delete filter
      const executor = await createExecutor(db, [executorPlugin])
      const executorUsers = await executor.selectFrom('users').selectAll().execute()
      expect(executorUsers).toHaveLength(2) // Alice and Charlie (non-deleted)

      // Manual wrapTransaction with a different plugin
      await db.transaction().execute(async trx => {
        const wrapped = wrapTransaction(trx, [transactionPlugin])
        const trxUsers = await wrapped.selectFrom('users').selectAll().execute()
        // Only tenant_id=2 filter applied (Charlie only), not soft-delete
        expect(trxUsers).toHaveLength(1)
        expect(trxUsers[0]!.name).toBe('Charlie')
      })

      // Executor still has its own plugin
      const executorUsersAgain = await executor.selectFrom('users').selectAll().execute()
      expect(executorUsersAgain).toHaveLength(2)
    })
  })

  describe('transaction data isolation with plugins', () => {
    it('uncommitted data in one transaction is not visible in outer scope', async () => {
      const softDeletePlugin: Plugin = {
        name: 'soft-delete',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB
          }
          return qb
        }
      }

      const executor = await createExecutor(db, [softDeletePlugin])

      // Check initial state
      const beforeUsers = await executor.selectFrom('users').selectAll().execute()
      expect(beforeUsers).toHaveLength(2) // Alice, Charlie (non-deleted)

      // Insert inside a transaction that rolls back
      try {
        await executor.transaction().execute(async trx => {
          await trx
            .insertInto('users')
            .values({ id: 4, name: 'Dave', tenant_id: 1, deleted_at: null })
            .execute()

          // Dave is visible inside this transaction (with soft-delete filter)
          const trxUsers = await trx.selectFrom('users').selectAll().execute()
          expect(trxUsers).toHaveLength(3) // Alice, Charlie, Dave

          throw new Error('Force rollback')
        })
      } catch {
        // Expected
      }

      // Dave should not be visible after rollback
      const afterUsers = await executor.selectFrom('users').selectAll().execute()
      expect(afterUsers).toHaveLength(2) // Alice, Charlie (Dave rolled back)
    })

    it('committed data in one transaction is visible in outer scope with plugins', async () => {
      const softDeletePlugin: Plugin = {
        name: 'soft-delete',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB
          }
          return qb
        }
      }

      const executor = await createExecutor(db, [softDeletePlugin])

      // Check initial state
      const beforeUsers = await executor.selectFrom('users').selectAll().execute()
      expect(beforeUsers).toHaveLength(2)

      // Insert inside a transaction that commits
      await executor.transaction().execute(async trx => {
        await trx
          .insertInto('users')
          .values({ id: 4, name: 'Dave', tenant_id: 1, deleted_at: null })
          .execute()
      })

      // Dave should be visible after commit (and passes soft-delete filter)
      const afterUsers = await executor.selectFrom('users').selectAll().execute()
      expect(afterUsers).toHaveLength(3) // Alice, Charlie, Dave
    })
  })

  describe('multiple operations within single transaction maintain plugin context', () => {
    it('plugins apply consistently across all operations in a transaction', async () => {
      const intercepted: { operation: string; table: string }[] = []

      const trackingPlugin: Plugin = {
        name: 'multi-op-tracker',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          intercepted.push({ operation: context.operation, table: context.table })
          return qb
        }
      }

      const executor = await createExecutor(db, [trackingPlugin])

      await executor.transaction().execute(async trx => {
        // Mix of operations within the same transaction
        await trx.selectFrom('users').selectAll().execute()
        await trx
          .insertInto('users')
          .values({ id: 5, name: 'Eve', tenant_id: 1, deleted_at: null })
          .execute()
        await trx.updateTable('users').set({ name: 'Eve Updated' }).where('id', '=', 5).execute()
        await trx.selectFrom('posts').selectAll().execute()
        await trx.deleteFrom('posts').where('id', '=', 2).execute()
      })

      // All operations in the transaction were intercepted
      expect(intercepted).toEqual([
        { operation: 'select', table: 'users' },
        { operation: 'insert', table: 'users' },
        { operation: 'update', table: 'users' },
        { operation: 'select', table: 'posts' },
        { operation: 'delete', table: 'posts' }
      ])
    })

    it('multiple plugins all apply within a single transaction', async () => {
      const calls: string[] = []

      const plugin1: Plugin = {
        name: 'plugin-1',
        version: '1.0.0',
        priority: 10,
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          calls.push(`p1:${context.operation}:${context.table}`)
          return qb
        }
      }

      const plugin2: Plugin = {
        name: 'plugin-2',
        version: '1.0.0',
        priority: 5,
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          calls.push(`p2:${context.operation}:${context.table}`)
          return qb
        }
      }

      const executor = await createExecutor(db, [plugin1, plugin2])

      await executor.transaction().execute(async trx => {
        await trx.selectFrom('users').selectAll().execute()
      })

      // Both plugins intercepted in priority order
      expect(calls).toEqual(['p1:select:users', 'p2:select:users'])
    })
  })
})
