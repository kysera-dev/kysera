import { describe, it, expect, beforeEach } from 'vitest'
import { Kysely, SqliteDialect, sql } from 'kysely'
import Database from 'better-sqlite3'
import { createRepositoryFactory, nativeAdapter, zodAdapter } from '../src/index.js'
import { withTransaction, createContext } from '@kysera/dal'
import { z } from 'zod'

interface DB { users: { id: number; name: string; email: string; age: number | null } }

function mkdb(log?: (sql: string) => void) {
  return new Kysely<DB>({
    dialect: new SqliteDialect({ database: new Database(':memory:') }),
    ...(log ? { log: (e: any) => { if (e.level === 'query') log(e.query.sql) } } : {})
  })
}
async function seed(db: Kysely<DB>) {
  await sql`create table users (id integer primary key autoincrement, name text, email text, age integer)`.execute(db)
  await db.insertInto('users').values([
    { name: 'alice', email: 'a@x.com', age: 30 },
    { name: 'bob', email: 'b@x.com', age: null },
    { name: 'carol', email: 'c@x.com', age: 40 }
  ] as any).execute()
}
const mk = (db: any, extra: any = {}) => createRepositoryFactory(db).create({
  tableName: 'users', mapRow: (r: any) => r, schemas: { create: nativeAdapter<any>() }, ...extra
})

describe('AUDIT VERIFY', () => {
  let db: Kysely<DB>
  beforeEach(async () => { db = mkdb(); await seed(db) })

  it('A: NODE_ENV=development whitelists only PK columns', async () => {
    const prev = process.env['NODE_ENV']; process.env['NODE_ENV'] = 'development'
    try {
      const repo = mk(db)
      let err: any = null
      try { await repo.find({ where: { name: 'alice' } as any }) } catch (e) { err = e }
      console.log('A find(where) ->', err ? `THREW: ${(err as Error).message}` : 'ok')
      let err2: any = null
      try { await repo.find({ select: ['name'] as any }) } catch (e) { err2 = e }
      console.log('A find(select) ->', err2 ? `THREW: ${(err2 as Error).message}` : 'ok')
      let err3: any = null
      try { await repo.count({ where: { name: 'alice' } as any }) } catch (e) { err3 = e }
      console.log('A count(where, no operators) ->', err3 ? `THREW: ${(err3 as Error).message}` : 'ok (NO VALIDATION)')
    } finally { process.env['NODE_ENV'] = prev }
  })

  it('B: isolationLevel dropped', async () => {
    const sqls: string[] = []
    const db2 = mkdb(s => sqls.push(s))
    await sql`create table users (id integer primary key)`.execute(db2)
    await withTransaction(db2, async ctx => { await (ctx.db as any).selectFrom('users').selectAll().execute() },
      { isolationLevel: 'serializable' })
    console.log('B SQL ->', JSON.stringify(sqls))
  })

  it('C: schema ctx loses tx marker', async () => {
    let out = 'no error'
    try {
      await withTransaction(db, async ctx => {
        const scoped = createContext((ctx.db as any).withSchema('main'), { schema: 'main' })
        await withTransaction(scoped as any, async () => 1)
      })
    } catch (e) { out = `THREW: ${(e as Error).message}` }
    console.log('C ->', out)
  })

  it('D: find({select}) + entity validation', async () => {
    const S = z.object({ id: z.number(), name: z.string(), email: z.string(), age: z.number().nullable() })
    const repo = mk(db, { schemas: { entity: zodAdapter(S), create: nativeAdapter<any>() }, validateDbResults: true })
    let err: any = null
    try { await repo.find({ select: ['id', 'name'] as any }) } catch (e) { err = e }
    console.log('D ->', err ? `THREW: ${String(err).slice(0, 120)}` : 'ok')
  })

  it('E: $ne / $nin include NULL rows (Mongo semantics)', async () => {
    const repo = mk(db)
    // bob has age NULL — Mongo $ne/$nin match him; plain SQL <>/NOT IN would drop him
    const ne = await repo.find({ where: { age: { $ne: 30 } } as any })
    expect(ne.map((u: any) => u.name).sort()).toEqual(['bob', 'carol'])
    const nin = await repo.find({ where: { age: { $nin: [30] } } as any })
    expect(nin.map((u: any) => u.name).sort()).toEqual(['bob', 'carol'])
    // $nin including null excludes NULL rows too
    const ninNull = await repo.find({ where: { age: { $nin: [30, null] } } as any })
    expect(ninNull.map((u: any) => u.name)).toEqual(['carol'])
    // $in with null matches NULL rows
    const inNull = await repo.find({ where: { age: { $in: [40, null] } } as any })
    expect(inNull.map((u: any) => u.name).sort()).toEqual(['bob', 'carol'])
  })

  it('F: malformed operator values throw instead of silently dropping the filter', async () => {
    const repo = mk(db)
    await expect(repo.find({ where: { age: { $between: [30] } } as any })).rejects.toThrow(
      /Invalid value for operator "\$between"/
    )
    await expect(repo.find({ where: { age: { $isNull: 'yes' } } as any })).rejects.toThrow(
      /Invalid value for operator "\$isNull"/
    )
    await expect(repo.find({ where: { name: { $contains: null } } as any })).rejects.toThrow(
      /Invalid value for operator "\$contains"/
    )
    await expect(repo.find({ where: { age: { $in: 'oops' } } as any })).rejects.toThrow(
      /Invalid value for operator "\$in"/
    )
  })

  it('G: where("1","=","0") empty-key fallback', async () => {
    let out = 'ok (matched nothing)'
    try { await (db as any).selectFrom('users').selectAll().where('1', '=', '0').execute() }
    catch (e) { out = `THREW: ${(e as Error).message}` }
    console.log('G ->', out)
  })

  it('H: repo.transaction() + withTransaction(trx) rebinding rolls back correctly', async () => {
    // NOTE: calling outer-repo methods inside repo.transaction() is an
    // anti-pattern: operations stay bound to the base executor. Since kysely
    // 0.29 (strict single-connection mutex for SQLite) it deadlocks instead of
    // silently escaping the transaction. The correct pattern is to rebind:
    const repo = mk(db)
    try {
      await repo.transaction(async (trx: any) => {
        const txRepo = repo.withTransaction(trx)
        await txRepo.create({ name: 'zed', email: 'z@x.com', age: 1 })
        throw new Error('rollback')
      })
    } catch { /* expected */ }
    const survived = await repo.findOne({ where: { name: 'zed' } as any })
    expect(survived).toBeNull()
  })

  it('I: dist type/runtime export mismatch', async () => {
    const mod: any = await import('../dist/index.js')
    const declared = ['normalizePrimaryKeyConfig','getPrimaryKeyColumns','isCompositeKey','normalizePrimaryKeyInput','isValidRow','PluginValidationError','validatePlugins','resolvePluginOrder']
    console.log('I -> declared in .d.ts but undefined at runtime:', declared.filter(n => mod[n] === undefined))
  })

  it('J: $ilike is portable (LOWER LIKE) and works on sqlite', async () => {
    const repo = mk(db)
    const rows = await repo.find({ where: { name: { $ilike: 'AL%' } } as any })
    expect(rows.map((u: any) => u.name)).toEqual(['alice'])
  })

  it('K: paginate orderBy rejects non-identifier input', async () => {
    const repo = mk(db)
    await expect(repo.paginate({ limit: 2, orderBy: 'name desc' })).rejects.toThrow(
      /Invalid orderBy column/
    )
    // Legitimate identifier still works
    const ok = await repo.paginate({ limit: 2, orderBy: 'name', orderDirection: 'desc' })
    expect(ok.items.map((u: any) => u.name)).toEqual(['carol', 'bob'])
  })
  expect(true).toBe(true)
})
