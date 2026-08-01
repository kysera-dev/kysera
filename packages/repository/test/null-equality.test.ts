/**
 * Regression: { col: null } in the SIMPLE where path (no $ operators) must
 * compile to IS NULL. It used to emit `col = NULL`, which matches zero rows
 * in SQL — find({where:{col:null}}) silently returned nothing.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Kysely, SqliteDialect, sql } from 'kysely'
import Database from 'better-sqlite3'
import { createRepositoryFactory, nativeAdapter } from '../src/index.js'

interface DB { users: { id: number; name: string; age: number | null } }

describe('null equality in simple where path', () => {
  let db: Kysely<DB>
  let repo: ReturnType<ReturnType<typeof createRepositoryFactory<DB>>['create']>

  beforeEach(async () => {
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: new Database(':memory:') }) })
    await sql`create table users (id integer primary key autoincrement, name text, age integer)`.execute(db)
    await db.insertInto('users').values([
      { name: 'alice', age: 30 },
      { name: 'bob', age: null }
    ] as never).execute()
    repo = createRepositoryFactory(db).create({
      tableName: 'users',
      mapRow: r => r,
      schemas: { create: nativeAdapter() }
    })
  })

  it('find({ where: { age: null } }) matches NULL rows (was: zero rows)', async () => {
    const rows = await repo.find({ where: { age: null } as never }) as Array<{ name: string }>
    expect(rows.map(r => r.name)).toEqual(['bob'])
  })

  it('findOne with null condition works', async () => {
    const row = await repo.findOne({ where: { age: null } as never }) as { name: string } | null
    expect(row?.name).toBe('bob')
  })

  it('count({ where: { age: null } }) counts NULL rows', async () => {
    expect(await repo.count({ where: { age: null } as never })).toBe(1)
  })

  it('mixed null and non-null conditions', async () => {
    const rows = await repo.find({ where: { age: null, name: 'bob' } as never }) as unknown[]
    expect(rows).toHaveLength(1)
  })
})
