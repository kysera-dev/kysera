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

  it('savepoint names never collide across derived instances (silent-partial-rollback regression)', async () => {
    // Outer tx → nested tx (savepoint A) → withSchema-derived context inside
    // it → deeper nested tx (savepoint B). With the old per-object counter
    // both levels issued `kysera_sp_1`; the inner rollback then shadowed the
    // outer savepoint and level-1 work SURVIVED its own rollback.
    await withTransaction(db, async outer => {
      await outer.db.insertInto('users').values({ name: 'outer-work' }).execute()

      await expect(
        withTransaction(outer, async lvl1 => {
          await lvl1.db.insertInto('users').values({ name: 'lvl1-work' }).execute()

          const derived = createContext(lvl1.db.withSchema('main'), { schema: 'main' })
          await expect(
            withTransaction(derived, async lvl2 => {
              await lvl2.db.insertInto('users').values({ name: 'lvl2-work' }).execute()
              throw new Error('rollback lvl2')
            })
          ).rejects.toThrow('rollback lvl2')

          // lvl2 rolled back, lvl1 work still visible
          const mid = await lvl1.db.selectFrom('users').selectAll().execute()
          expect(mid.map(r => r.name).sort()).toEqual(['lvl1-work', 'outer-work'])

          throw new Error('rollback lvl1')
        })
      ).rejects.toThrow('rollback lvl1')

      // lvl1 (and lvl2) fully rolled back — with colliding names lvl1-work survived
      const after = await outer.db.selectFrom('users').selectAll().execute()
      expect(after.map(r => r.name)).toEqual(['outer-work'])
    })
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
