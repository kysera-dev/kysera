/**
 * Regression tests from the plugin audit:
 *
 * 1. CTE names must not be treated as soft-deletable tables — the exact
 *    repro `ex.with('t', q => q.selectFrom('posts').select('id'))
 *    .selectFrom('t')` used to throw `no such column: t.deleted_at`.
 *    CTE names accumulate across chained .with() calls.
 *
 * 2. Generic UPDATE/DELETE through the executor are narrowed with
 *    `deleted_at IS NULL` — soft-deleted rows are not silently mutable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '../src/index.js'

interface TestDB {
  posts: {
    id: Generated<number>
    title: string
    deleted_at: string | null
  }
}

describe('soft-delete: CTE handling and mutation narrowing', () => {
  let db: Kysely<TestDB>

  beforeEach(async () => {
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') })
    })
    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('title', 'text')
      .addColumn('deleted_at', 'text')
      .execute()
    await db
      .insertInto('posts')
      .values([
        { title: 'live', deleted_at: null },
        { title: 'dead', deleted_at: '2024-01-01' }
      ])
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
  })

  describe('CTE names are not soft-deletable tables', () => {
    it('exact audit repro: with(t) + selectFrom(t) works under default config', async () => {
      const executor = await createExecutor(db, [softDeletePlugin()])
      // Used to throw: no such column: t.deleted_at
      const rows = await executor
        .with('t', q => q.selectFrom('posts').select('id'))
        .selectFrom('t')
        .selectAll()
        .execute()
      // CTE body IS filtered (only the live row enters the CTE)
      expect(rows).toHaveLength(1)
    })

    it('CTE names accumulate across chained with() calls', async () => {
      const executor = await createExecutor(db, [softDeletePlugin()])
      // Second .with() returns a fresh proxy — 'a' must survive into it
      const rows = await executor
        .with('a', q => q.selectFrom('posts').select('id'))
        .with('b', q => q.selectFrom('a').selectAll())
        .selectFrom('b')
        .selectAll()
        .execute()
      expect(rows).toHaveLength(1)
    })

    it('parenthesized CTE names (columns list) are registered too', async () => {
      const executor = await createExecutor(db, [softDeletePlugin()])
      const rows = await executor
        .with('t(pid)', q => q.selectFrom('posts').select('id'))
        .selectFrom('t')
        .selectAll()
        .execute()
      expect(rows).toHaveLength(1)
    })
  })

  describe('UPDATE/DELETE narrowing (deleted rows are not silently mutable)', () => {
    it('generic UPDATE via executor cannot resurrect a soft-deleted row', async () => {
      const executor = await createExecutor(db, [softDeletePlugin()])
      await executor.updateTable('posts').set({ title: 'RESURRECTED' }).where('id', '=', 2).execute()

      const row = await db.selectFrom('posts').selectAll().where('id', '=', 2).executeTakeFirst()
      expect(row?.title).toBe('dead')
    })

    it('generic DELETE via executor cannot hard-delete a soft-deleted row', async () => {
      const executor = await createExecutor(db, [softDeletePlugin()])
      await executor.deleteFrom('posts').where('id', '=', 2).execute()

      const rows = await db.selectFrom('posts').selectAll().execute()
      expect(rows).toHaveLength(2)
    })

    it('live rows remain freely updatable and deletable', async () => {
      const executor = await createExecutor(db, [softDeletePlugin()])
      await executor.updateTable('posts').set({ title: 'edited' }).where('id', '=', 1).execute()
      const row = await db.selectFrom('posts').selectAll().where('id', '=', 1).executeTakeFirst()
      expect(row?.title).toBe('edited')

      await executor.deleteFrom('posts').where('id', '=', 1).execute()
      const rows = await db.selectFrom('posts').selectAll().execute()
      expect(rows.map(r => r.title)).toEqual(['dead'])
    })

    it('metadata.includeDeleted opts a query out of the narrowing', async () => {
      const executor = await createExecutor(db, [softDeletePlugin()])
      const { withPluginMetadata } = await import('@kysera/executor')
      const optOut = withPluginMetadata(executor, { includeDeleted: true })

      await optOut.updateTable('posts').set({ title: 'RAISED' }).where('id', '=', 2).execute()
      const row = await db.selectFrom('posts').selectAll().where('id', '=', 2).executeTakeFirst()
      expect(row?.title).toBe('RAISED')
    })
  })
})
