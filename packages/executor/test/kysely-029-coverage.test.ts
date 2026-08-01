/**
 * Coverage for kysely 0.29 API surface and proxy edge cases:
 * - native #private getters through the proxy (db.schema crashed before)
 * - $pickTables/$omitTables/$extendTables derived instances keep plugins
 * - with(name, query) direct-expression form (new in 0.29)
 * - transaction().setIsolationLevel/setAccessMode preserved
 * - startTransaction() controlled transactions + savepoints keep plugins
 * - connection() callback receives plugin-aware instance
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated, type SelectQueryBuilder } from 'kysely'
import Database from 'better-sqlite3'
import { createExecutor, isKyseraExecutor, type Plugin } from '../src/index.js'

interface TestDB {
  users: { id: Generated<number>; name: string; deleted_at: string | null }
  posts: { id: Generated<number>; user_id: number; title: string }
}

type AnySelect = SelectQueryBuilder<Record<string, Record<string, unknown>>, string, Record<string, unknown>>

/** Filter plugin: adds deleted_at IS NULL to selects on users */
const softDeleteLike = (): Plugin => ({
  name: 'soft-delete-like',
  version: '1.0.0',
  interceptQuery<QB>(qb: QB, context: { operation: string; table: string }): QB {
    if (context.operation === 'select' && context.table === 'users') {
      return (qb as unknown as AnySelect).where('deleted_at', 'is', null) as QB
    }
    return qb
  }
})

describe('kysely 0.29 API coverage', () => {
  let db: Kysely<TestDB>

  beforeEach(async () => {
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') })
    })
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('name', 'text')
      .addColumn('deleted_at', 'text')
      .execute()
    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('user_id', 'integer')
      .addColumn('title', 'text')
      .execute()
    await db
      .insertInto('users')
      .values([
        { name: 'alice', deleted_at: null },
        { name: 'bob', deleted_at: '2024-01-01' }
      ])
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
  })

  describe('native #private getters through proxy', () => {
    it('schema getter works with plugins (was: Cannot read private member)', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      await executor.schema
        .createTable('tags')
        .addColumn('id', 'integer', c => c.primaryKey())
        .execute()
      const tables = await executor.introspection.getTables()
      expect(tables.map(t => t.name)).toContain('tags')
    })

    it('fn / dynamic / case helpers are accessible', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      expect(executor.fn).toBeDefined()
      expect(executor.dynamic).toBeDefined()
      expect(executor.isTransaction).toBe(false)
    })

    it('marker-only executor exposes getters too', async () => {
      const executor = await createExecutor(db, [])
      expect(() => executor.schema).not.toThrow()
      expect(executor.isTransaction).toBe(false)
    })
  })

  describe('$pickTables / $omitTables / $extendTables keep plugin interception', () => {
    it('$pickTables result still applies plugins', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      const narrowed = executor.$pickTables<'users'>()
      expect(isKyseraExecutor(narrowed)).toBe(true)
      const rows = await narrowed.selectFrom('users').selectAll().execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.name).toBe('alice')
    })

    it('$omitTables result still applies plugins', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      const rows = await executor.$omitTables<'posts'>().selectFrom('users').selectAll().execute()
      expect(rows).toHaveLength(1)
    })

    it('$extendTables result still applies plugins', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      const rows = await executor
        .$extendTables<{ extra: { id: number } }>()
        .selectFrom('users')
        .selectAll()
        .execute()
      expect(rows).toHaveLength(1)
    })
  })

  describe('CTE with() forms', () => {
    it('with(name, callback) applies plugins inside the CTE body', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      const rows = await executor
        .with('active_users', qc => qc.selectFrom('users').select(['id', 'name']))
        .selectFrom('active_users')
        .selectAll()
        .execute()
      // soft-delete filter applied inside CTE: only alice
      expect(rows).toHaveLength(1)
      expect(rows[0]?.name).toBe('alice')
    })

    it('with(name, expression) direct form (0.29) does not crash and keeps outer interception', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      // Direct expression form: built from raw db, so the CTE body itself is
      // intentionally NOT intercepted — but the outer query keeps plugins.
      const expression = db.selectFrom('posts').select(['id', 'title'])
      const rows = await executor
        .with('all_posts', expression)
        .selectFrom('all_posts')
        .selectAll()
        .execute()
      expect(rows).toHaveLength(0)

      // Outer select on an intercepted table still filters
      const users = await executor
        .with('all_posts', expression)
        .selectFrom('users')
        .selectAll()
        .execute()
      expect(users).toHaveLength(1)
    })
  })

  describe('transaction builder surface', () => {
    it('setIsolationLevel is available and plugins apply inside', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      // SQLite accepts only 'snapshot'/'serializable'; use serializable
      const rows = await executor
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async trx => trx.selectFrom('users').selectAll().execute())
      expect(rows).toHaveLength(1)
    })

    it('plugins apply inside plain transaction and markers survive', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      await executor.transaction().execute(async trx => {
        expect(isKyseraExecutor(trx as never)).toBe(true)
        const rows = await trx.selectFrom('users').selectAll().execute()
        expect(rows).toHaveLength(1)
      })
    })

    it('transaction rollback works through the wrapper', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      await expect(
        executor.transaction().execute(async trx => {
          await trx.insertInto('users').values({ name: 'temp', deleted_at: null }).execute()
          throw new Error('rollback me')
        })
      ).rejects.toThrow('rollback me')
      const rows = await executor.selectFrom('users').selectAll().execute()
      expect(rows).toHaveLength(1)
    })
  })

  describe('startTransaction / controlled transactions', () => {
    it('controlled transaction keeps plugin interception and commits', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      const trx = await executor.startTransaction().execute()
      try {
        const rows = await trx.selectFrom('users').selectAll().execute()
        expect(rows).toHaveLength(1)
        await trx.insertInto('users').values({ name: 'carol', deleted_at: null }).execute()
        await trx.commit().execute()
      } catch (error) {
        await trx.rollback().execute()
        throw error
      }
      const after = await executor.selectFrom('users').selectAll().execute()
      expect(after.map(r => r.name).sort()).toEqual(['alice', 'carol'])
    })

    it('savepoint-derived transaction keeps plugins', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      const trx = await executor.startTransaction().execute()
      try {
        const afterSp = await trx.savepoint('sp1').execute()
        // Derived controlled transaction still filters soft-deleted rows
        const rows = await afterSp.selectFrom('users').selectAll().execute()
        expect(rows).toHaveLength(1)
        await afterSp.rollbackToSavepoint('sp1').execute()
        await trx.rollback().execute()
      } catch (error) {
        await trx.rollback().execute()
        throw error
      }
    })
  })

  describe('connection()', () => {
    it('callback receives plugin-aware instance', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      const rows = await executor.connection().execute(async conn => {
        expect(isKyseraExecutor(conn)).toBe(true)
        return conn.selectFrom('users').selectAll().execute()
      })
      expect(rows).toHaveLength(1)
    })
  })

  describe('withPlugin / withoutPlugins keep kysera interception', () => {
    it('withoutPlugins() strips kysely plugins but keeps kysera plugins', async () => {
      const executor = await createExecutor(db, [softDeleteLike()])
      const stripped = executor.withoutPlugins()
      expect(isKyseraExecutor(stripped)).toBe(true)
      const rows = await stripped.selectFrom('users').selectAll().execute()
      expect(rows).toHaveLength(1)
    })
  })
})
