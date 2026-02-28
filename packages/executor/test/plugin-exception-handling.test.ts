import { describe, it, expect, beforeEach } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import BetterSqlite3 from 'better-sqlite3'
import {
  createExecutor,
  createExecutorSync,
  applyPlugins,
  type Plugin,
  type QueryBuilderContext
} from '../src/index.js'

/**
 * M-13: Plugin exception handling in interceptQuery
 *
 * Verifies the H-11 fix that wraps plugin.interceptQuery() in try/catch
 * in packages/executor/src/executor.ts. Tests ensure:
 *
 * 1. When a plugin throws in interceptQuery, the error is caught and a descriptive error is thrown
 * 2. The error message includes plugin name and operation context
 * 3. Other plugins still work even if one fails
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

describe('M-13: Plugin exception handling in interceptQuery', () => {
  let db: Kysely<TestDatabase>

  beforeEach(() => {
    const sqlite = new BetterSqlite3(':memory:')
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
  })

  describe('error wrapping in executor proxy (createInterceptedMethod)', () => {
    it('catches plugin Error and throws descriptive error with plugin name and context', async () => {
      const failingPlugin: Plugin = {
        name: 'failing-plugin',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw new Error('Something went wrong in the plugin')
        }
      }

      const executor = await createExecutor(db, [failingPlugin])

      expect(() => executor.selectFrom('users')).toThrow(
        'Plugin "failing-plugin" threw during interceptQuery for select on "users": Something went wrong in the plugin'
      )
    })

    it('includes correct operation type in error for insert', async () => {
      const failingPlugin: Plugin = {
        name: 'insert-failer',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw new Error('Insert interception failed')
        }
      }

      const executor = await createExecutor(db, [failingPlugin])

      expect(() => executor.insertInto('users')).toThrow(
        'Plugin "insert-failer" threw during interceptQuery for insert on "users": Insert interception failed'
      )
    })

    it('includes correct operation type in error for update', async () => {
      const failingPlugin: Plugin = {
        name: 'update-failer',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw new Error('Update interception failed')
        }
      }

      const executor = await createExecutor(db, [failingPlugin])

      expect(() => executor.updateTable('users')).toThrow(
        'Plugin "update-failer" threw during interceptQuery for update on "users": Update interception failed'
      )
    })

    it('includes correct operation type in error for delete', async () => {
      const failingPlugin: Plugin = {
        name: 'delete-failer',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw new Error('Delete interception failed')
        }
      }

      const executor = await createExecutor(db, [failingPlugin])

      expect(() => executor.deleteFrom('users')).toThrow(
        'Plugin "delete-failer" threw during interceptQuery for delete on "users": Delete interception failed'
      )
    })

    it('includes correct table name in error message', async () => {
      const failingPlugin: Plugin = {
        name: 'table-failer',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw new Error('Boom')
        }
      }

      const executor = await createExecutor(db, [failingPlugin])

      expect(() => executor.selectFrom('posts')).toThrow(
        'Plugin "table-failer" threw during interceptQuery for select on "posts": Boom'
      )
    })

    it('handles non-Error thrown values (strings)', async () => {
      const failingPlugin: Plugin = {
        name: 'string-thrower',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw 'a plain string error'
        }
      }

      const executor = await createExecutor(db, [failingPlugin])

      expect(() => executor.selectFrom('users')).toThrow(
        'Plugin "string-thrower" threw during interceptQuery for select on "users": a plain string error'
      )
    })

    it('handles non-Error thrown values (numbers)', async () => {
      const failingPlugin: Plugin = {
        name: 'number-thrower',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw 42
        }
      }

      const executor = await createExecutor(db, [failingPlugin])

      expect(() => executor.selectFrom('users')).toThrow(
        'Plugin "number-thrower" threw during interceptQuery for select on "users": 42'
      )
    })

    it('handles non-Error thrown values (objects)', async () => {
      const failingPlugin: Plugin = {
        name: 'object-thrower',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw { code: 'PLUGIN_ERROR', detail: 'Something broke' }
        }
      }

      const executor = await createExecutor(db, [failingPlugin])

      expect(() => executor.selectFrom('users')).toThrow(
        'Plugin "object-thrower" threw during interceptQuery for select on "users":'
      )
    })

    it('handles undefined thrown value', async () => {
      const failingPlugin: Plugin = {
        name: 'undefined-thrower',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw undefined
        }
      }

      const executor = await createExecutor(db, [failingPlugin])

      expect(() => executor.selectFrom('users')).toThrow(
        'Plugin "undefined-thrower" threw during interceptQuery for select on "users": undefined'
      )
    })
  })

  describe('first plugin fails, subsequent plugins are not reached', () => {
    it('stops plugin chain when first plugin throws', async () => {
      const calls: string[] = []

      const failingPlugin: Plugin = {
        name: 'failing-first',
        version: '1.0.0',
        priority: 10, // Higher priority, runs first
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          calls.push('failing-first')
          throw new Error('First plugin failed')
        }
      }

      const healthyPlugin: Plugin = {
        name: 'healthy-second',
        version: '1.0.0',
        priority: 5, // Lower priority, would run second
        interceptQuery<QB>(qb: QB, _context: QueryBuilderContext): QB {
          calls.push('healthy-second')
          return qb
        }
      }

      const executor = await createExecutor(db, [failingPlugin, healthyPlugin])

      expect(() => executor.selectFrom('users')).toThrow(
        'Plugin "failing-first" threw during interceptQuery'
      )

      // The failing plugin was called, but the healthy one was not
      expect(calls).toEqual(['failing-first'])
    })
  })

  describe('other plugins still work when a failing plugin is not in the chain', () => {
    it('healthy plugins work independently of a failing plugin on different executors', async () => {
      const healthyPlugin: Plugin = {
        name: 'healthy-plugin',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB
          }
          return qb
        }
      }

      // Create an executor with only the healthy plugin
      const healthyExecutor = await createExecutor(db, [healthyPlugin])

      // Healthy executor works fine
      const users = await healthyExecutor.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(2)
      expect(users.every(u => u.deleted_at === null)).toBe(true)
    })

    it('second plugin works if first succeeds but second fails', async () => {
      const calls: string[] = []

      const goodPlugin: Plugin = {
        name: 'good-plugin',
        version: '1.0.0',
        priority: 10,
        interceptQuery<QB>(qb: QB, _context: QueryBuilderContext): QB {
          calls.push('good-plugin')
          return qb
        }
      }

      const badPlugin: Plugin = {
        name: 'bad-plugin',
        version: '1.0.0',
        priority: 5,
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          calls.push('bad-plugin')
          throw new Error('Bad plugin broke')
        }
      }

      const executor = await createExecutor(db, [goodPlugin, badPlugin])

      expect(() => executor.selectFrom('users')).toThrow(
        'Plugin "bad-plugin" threw during interceptQuery for select on "users": Bad plugin broke'
      )

      // Good plugin was called before bad plugin
      expect(calls).toEqual(['good-plugin', 'bad-plugin'])
    })
  })

  describe('error wrapping in applyPlugins', () => {
    it('catches plugin Error and throws descriptive error', () => {
      const failingPlugin: Plugin = {
        name: 'apply-failer',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw new Error('applyPlugins failure')
        }
      }

      const qb = db.selectFrom('users').selectAll()
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      expect(() => applyPlugins(qb, [failingPlugin], context)).toThrow(
        'Plugin "apply-failer" threw during interceptQuery for select on "users": applyPlugins failure'
      )
    })

    it('includes correct context in applyPlugins error for different operations', () => {
      const failingPlugin: Plugin = {
        name: 'context-failer',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw new Error('Boom')
        }
      }

      const qb = db.selectFrom('posts').selectAll()
      const context: QueryBuilderContext = {
        operation: 'delete',
        table: 'posts',
        metadata: {}
      }

      expect(() => applyPlugins(qb, [failingPlugin], context)).toThrow(
        'Plugin "context-failer" threw during interceptQuery for delete on "posts": Boom'
      )
    })

    it('handles non-Error thrown values in applyPlugins', () => {
      const failingPlugin: Plugin = {
        name: 'string-thrower',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw 'just a string'
        }
      }

      const qb = db.selectFrom('users').selectAll()
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      expect(() => applyPlugins(qb, [failingPlugin], context)).toThrow(
        'Plugin "string-thrower" threw during interceptQuery for select on "users": just a string'
      )
    })

    it('stops at first failing plugin in applyPlugins chain', () => {
      const calls: string[] = []

      const plugin1: Plugin = {
        name: 'plugin1',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          calls.push('plugin1')
          return qb
        }
      }

      const failingPlugin: Plugin = {
        name: 'failing-plugin',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB): QB {
          calls.push('failing-plugin')
          throw new Error('Fail')
        }
      }

      const plugin3: Plugin = {
        name: 'plugin3',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          calls.push('plugin3')
          return qb
        }
      }

      const qb = db.selectFrom('users').selectAll()
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      expect(() => applyPlugins(qb, [plugin1, failingPlugin, plugin3], context)).toThrow(
        'Plugin "failing-plugin" threw during interceptQuery'
      )

      // plugin1 ran, failing-plugin ran and threw, plugin3 never reached
      expect(calls).toEqual(['plugin1', 'failing-plugin'])
    })
  })

  describe('error handling in transactions', () => {
    it('catches plugin errors within transactions', async () => {
      const failingPlugin: Plugin = {
        name: 'trx-failer',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw new Error('Transaction plugin failure')
        }
      }

      const executor = await createExecutor(db, [failingPlugin])

      await expect(
        executor.transaction().execute(async trx => {
          trx.selectFrom('users')
        })
      ).rejects.toThrow(
        'Plugin "trx-failer" threw during interceptQuery for select on "users": Transaction plugin failure'
      )
    })
  })

  describe('error handling with createExecutorSync', () => {
    it('catches plugin errors from synchronously created executor', () => {
      const failingPlugin: Plugin = {
        name: 'sync-failer',
        version: '1.0.0',
        interceptQuery<QB>(_qb: QB, _context: QueryBuilderContext): QB {
          throw new Error('Sync failure')
        }
      }

      const executor = createExecutorSync(db, [failingPlugin])

      expect(() => executor.selectFrom('users')).toThrow(
        'Plugin "sync-failer" threw during interceptQuery for select on "users": Sync failure'
      )
    })
  })

  describe('plugin that throws conditionally', () => {
    it('only fails for specific tables', async () => {
      const conditionalPlugin: Plugin = {
        name: 'conditional-failer',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.table === 'posts') {
            throw new Error('Posts table not allowed')
          }
          return qb
        }
      }

      const executor = await createExecutor(db, [conditionalPlugin])

      // Users should work fine
      const users = await executor.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(3)

      // Posts should fail
      expect(() => executor.selectFrom('posts')).toThrow(
        'Plugin "conditional-failer" threw during interceptQuery for select on "posts": Posts table not allowed'
      )
    })

    it('only fails for specific operations', async () => {
      const conditionalPlugin: Plugin = {
        name: 'select-only',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'delete') {
            throw new Error('Deletes are not permitted')
          }
          return qb
        }
      }

      const executor = await createExecutor(db, [conditionalPlugin])

      // Select should work fine
      const users = await executor.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(3)

      // Delete should fail
      expect(() => executor.deleteFrom('users')).toThrow(
        'Plugin "select-only" threw during interceptQuery for delete on "users": Deletes are not permitted'
      )
    })
  })
})
