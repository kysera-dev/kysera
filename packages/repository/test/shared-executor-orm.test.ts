/**
 * Regression: createORM(executor, []) — the documented "shared executor
 * pattern" — used to return an ORM whose plugins list was EMPTY: interception
 * still worked, but extendRepository never ran, so repositories silently had
 * no plugin-added methods.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, sql, type Generated, type SelectQueryBuilder } from 'kysely'
import Database from 'better-sqlite3'
import { createExecutor, isRepositoryLike, type Plugin } from '@kysera/executor'
import { createORM, createRepositoryFactory, nativeAdapter } from '../src/index.js'

interface DB {
  users: { id: Generated<number>; name: string; deleted_at: string | null }
}

type AnySelect = SelectQueryBuilder<Record<string, Record<string, unknown>>, string, Record<string, unknown>>

/** Minimal soft-delete-like plugin: filter + repository extension */
const filterPlugin = (): Plugin => ({
  name: 'filter-plugin',
  version: '1.0.0',
  interceptQuery<QB>(qb: QB, context: { operation: string; table: string }): QB {
    if (context.operation === 'select' && context.table === 'users') {
      return (qb as unknown as AnySelect).where('deleted_at', 'is', null) as QB
    }
    return qb
  },
  extendRepository<T extends object>(repo: T): T {
    if (!isRepositoryLike(repo)) return repo
    return { ...repo, markerMethod: () => 'extended' } as T
  }
})

describe('createORM with a shared KyseraExecutor', () => {
  let db: Kysely<DB>

  beforeEach(async () => {
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: new Database(':memory:') }) })
    await sql`create table users (id integer primary key autoincrement, name text, deleted_at text)`.execute(db)
    await db
      .insertInto('users')
      .values([
        { name: 'alice', deleted_at: null },
        { name: 'ghost', deleted_at: '2024-01-01' }
      ])
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('createORM(executor, []) inherits the executor plugins', async () => {
    const executor = await createExecutor(db, [filterPlugin()])
    const orm = await createORM<DB>(executor, [])

    // Plugins visible on the ORM (was: [])
    expect(orm.plugins.map(p => p.name)).toEqual(['filter-plugin'])

    const repo = orm.createRepository(exec =>
      createRepositoryFactory(exec as Kysely<DB>).create({
        tableName: 'users',
        mapRow: r => r,
        schemas: { create: nativeAdapter() }
      })
    ) as unknown as { markerMethod?: () => string; findAll(): Promise<unknown[]> }

    // extendRepository ran (was: undefined)
    expect(repo.markerMethod?.()).toBe('extended')
    // Interception active through the shared executor
    expect(await repo.findAll()).toHaveLength(1)
  })

  it('createORM(db, [plugins]) still works as before', async () => {
    const orm = await createORM<DB>(db, [filterPlugin()])
    expect(orm.plugins.map(p => p.name)).toEqual(['filter-plugin'])
  })
})
