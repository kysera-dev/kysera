/**
 * withDebug must log SQL compiled by the wrapped database's OWN dialect
 * compiler (previously it always used DefaultQueryCompiler, so logged SQL
 * could differ from what the driver actually received).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import { withDebug } from '../src/index.js'
import { silentLogger } from '@kysera/core'

interface DB {
  users: { id: Generated<number>; name: string }
}

describe('withDebug against a real dialect', () => {
  let db: Kysely<DB>

  afterEach(async () => {
    await db.destroy()
  })

  it('records dialect-correct SQL and parameters in metrics', async () => {
    db = new Kysely<DB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') })
    })
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('name', 'text')
      .execute()

    const debugDb = withDebug(db, { logQuery: false, logger: silentLogger })

    await debugDb.insertInto('users').values({ name: 'alice' }).execute()
    await debugDb.selectFrom('users').selectAll().where('name', '=', 'alice').execute()

    const metrics = debugDb.getMetrics()
    const select = metrics.find(m => m.sql.startsWith('select'))
    expect(select).toBeDefined()
    // SQLite compiler: double-quoted identifiers + positional ? placeholders
    expect(select!.sql).toBe('select * from "users" where "name" = ?')
    expect(select!.params).toEqual(['alice'])
    expect(select!.duration).toBeGreaterThanOrEqual(0)
  })

  it('measures duration for real query execution', async () => {
    db = new Kysely<DB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') })
    })
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('name', 'text')
      .execute()

    const slowCalls: Array<{ sql: string; duration: number }> = []
    const debugDb = withDebug(db, {
      logQuery: false,
      logger: silentLogger,
      slowQueryThreshold: 0.0001,
      onSlowQuery: (sql, duration) => slowCalls.push({ sql, duration })
    })

    await debugDb.selectFrom('users').selectAll().execute()
    expect(slowCalls.length).toBeGreaterThanOrEqual(1)
    expect(slowCalls[0]?.sql).toBe('select * from "users"')
  })
})
