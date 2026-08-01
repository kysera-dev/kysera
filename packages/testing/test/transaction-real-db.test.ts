/**
 * Transaction utilities against a REAL database (in-memory SQLite).
 *
 * Previously testInTransaction/testWithSavepoints/testWithIsolation were only
 * exercised with hand-built mocks — the SAVEPOINT statements had never been
 * executed once in CI.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import { testInTransaction, testWithSavepoints, testWithIsolation } from '../src/index.js'

interface DB {
  users: { id: Generated<number>; name: string }
}

describe('transaction utilities on real SQLite', () => {
  let db: Kysely<DB>

  beforeEach(async () => {
    db = new Kysely<DB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') })
    })
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('name', 'text')
      .execute()
    await db.insertInto('users').values({ name: 'seed' }).execute()
  })

  afterEach(async () => {
    await db.destroy()
  })

  describe('testInTransaction', () => {
    it('rolls back all changes after the test body', async () => {
      await testInTransaction(db, async trx => {
        await trx.insertInto('users').values({ name: 'temp' }).execute()
        const inside = await trx.selectFrom('users').selectAll().execute()
        expect(inside).toHaveLength(2)
      })

      const after = await db.selectFrom('users').selectAll().execute()
      expect(after).toHaveLength(1)
      expect(after[0]?.name).toBe('seed')
    })

    it('propagates test body failures while still rolling back', async () => {
      await expect(
        testInTransaction(db, async trx => {
          await trx.insertInto('users').values({ name: 'temp' }).execute()
          throw new Error('assertion failed')
        })
      ).rejects.toThrow('assertion failed')

      const after = await db.selectFrom('users').selectAll().execute()
      expect(after).toHaveLength(1)
    })
  })

  describe('testWithSavepoints', () => {
    it('executes real SAVEPOINT / ROLLBACK TO SAVEPOINT statements', async () => {
      await testWithSavepoints(db, async trx => {
        await trx.insertInto('users').values({ name: 'sp-temp' }).execute()
        const inside = await trx.selectFrom('users').selectAll().execute()
        expect(inside).toHaveLength(2)
      })

      const after = await db.selectFrom('users').selectAll().execute()
      expect(after).toHaveLength(1)
    })

    it('rolls back to savepoint even when the body throws', async () => {
      await expect(
        testWithSavepoints(db, async trx => {
          await trx.insertInto('users').values({ name: 'sp-temp' }).execute()
          throw new Error('body failed')
        })
      ).rejects.toThrow('body failed')

      const after = await db.selectFrom('users').selectAll().execute()
      expect(after).toHaveLength(1)
    })
  })

  describe('testWithIsolation', () => {
    it('serializable works on SQLite and rolls back (native semantics)', async () => {
      // kysely's SqliteDriver accepts 'serializable' (SQLite's native mode).
      // The old raw `SET TRANSACTION ISOLATION LEVEL` was a SQL syntax error.
      await testWithIsolation(db, 'serializable', async trx => {
        await trx.insertInto('users').values({ name: 'iso-temp' }).execute()
      })
      const after = await db.selectFrom('users').selectAll().execute()
      expect(after).toHaveLength(1)
    })

    it('other levels are ignored by the SQLite driver but still roll back', async () => {
      // kysely's SqliteDriver issues a plain `begin` regardless of isolation
      // settings — real isolation-level assertions live in the multi-db suite
      await testWithIsolation(db, 'read committed', async trx => {
        await trx.insertInto('users').values({ name: 'rc-temp' }).execute()
      })
      const after = await db.selectFrom('users').selectAll().execute()
      expect(after).toHaveLength(1)
    })

    it('rejects invalid isolation level names at runtime', async () => {
      await expect(
        testWithIsolation(db, 'chaos' as never, async () => {
          /* never runs */
        })
      ).rejects.toThrow(/Invalid isolation level: chaos/)
    })
  })
})
