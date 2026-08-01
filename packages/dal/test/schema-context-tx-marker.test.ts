/**
 * Regression (audit probe C): a schema-scoped context derived inside a
 * transaction lost the in-transaction marker — withSchema() returns a NEW
 * object without the DAL symbol. Nested withTransaction then attempted a
 * top-level transaction on what is structurally a kysely Transaction:
 * rejected by kysely 0.29 and a deadlock on single-connection SQLite.
 * The fallback to kysely's own `isTransaction` getter fixes this: the
 * nested call becomes a savepoint.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import { withTransaction, createContext } from '../src/index.js'

interface DB {
  users: { id: Generated<number>; name: string }
}

describe('schema-scoped context keeps transaction detection', () => {
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
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('nested withTransaction over a withSchema-derived context uses a savepoint', async () => {
    // Before the fix this deadlocked (5s timeout) or threw — the nested call
    // tried to open a second top-level transaction on the same connection
    const result = await withTransaction(db, async ctx => {
      const scoped = createContext(ctx.db.withSchema('main'), { schema: 'main' })
      return withTransaction(scoped, async inner => {
        await inner.db.insertInto('users').values({ name: 'nested' }).execute()
        return 'ok'
      })
    })
    expect(result).toBe('ok')

    const rows = await db.selectFrom('users').selectAll().execute()
    expect(rows.map(r => r.name)).toEqual(['nested'])
  })

  it('inner savepoint rollback does not kill the outer transaction', async () => {
    await withTransaction(db, async ctx => {
      await ctx.db.insertInto('users').values({ name: 'outer' }).execute()

      const scoped = createContext(ctx.db.withSchema('main'), { schema: 'main' })
      await expect(
        withTransaction(scoped, async inner => {
          await inner.db.insertInto('users').values({ name: 'inner' }).execute()
          throw new Error('rollback inner')
        })
      ).rejects.toThrow('rollback inner')

      // Outer work survives the inner rollback
      const inside = await ctx.db.selectFrom('users').selectAll().execute()
      expect(inside.map(r => r.name)).toEqual(['outer'])
    })

    const rows = await db.selectFrom('users').selectAll().execute()
    expect(rows.map(r => r.name)).toEqual(['outer'])
  })
})
