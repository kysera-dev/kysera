/**
 * SECURITY regression: soft-delete's "with deleted" surfaces must NOT bypass
 * RLS. The old implementation queried the raw (un-proxied) Kysely instance,
 * so findAllWithDeleted() returned OTHER TENANTS' rows inside a tenant
 * context. Now those methods use a scoped opt-out (metadata.includeDeleted)
 * that disables only the soft-delete predicate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import { createORM } from '@kysera/repository'
import { createRepositoryFactory, nativeAdapter } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '../../src/plugin.js'
import { defineRLSSchema, filter } from '../../src/policy/index.js'
import { rlsContext } from '../../src/context/index.js'

interface TestDB {
  posts: {
    id: Generated<number>
    title: string
    tenant_id: string
    deleted_at: string | null
  }
}

interface SoftDeleteRepo {
  findAll(): Promise<Array<{ title: string }>>
  findAllWithDeleted(): Promise<Array<{ title: string }>>
  findWithDeleted(id: number): Promise<{ title: string } | null>
  findDeleted(): Promise<Array<{ title: string }>>
  restore(id: number): Promise<unknown>
  hardDelete(id: number): Promise<void>
}

const schema = defineRLSSchema<TestDB>({
  posts: {
    policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId as string }))]
  }
})

const tenantCtx = (tenantId: string) => ({
  auth: { userId: 1, tenantId, roles: ['user'], isSystem: false },
  timestamp: new Date()
})

describe('soft-delete + RLS: no cross-tenant bypass', () => {
  let db: Kysely<TestDB>
  let repo: SoftDeleteRepo

  beforeEach(async () => {
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') })
    })
    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('title', 'text')
      .addColumn('tenant_id', 'text')
      .addColumn('deleted_at', 'text')
      .execute()
    await db
      .insertInto('posts')
      .values([
        { title: 'T1-POST', tenant_id: 't1', deleted_at: null },
        { title: 'T2-SECRET', tenant_id: 't2', deleted_at: null },
        { title: 'T2-DELETED', tenant_id: 't2', deleted_at: '2024-01-01' },
        { title: 'T1-DELETED', tenant_id: 't1', deleted_at: '2024-01-01' }
      ])
      .execute()

    const orm = await createORM(db, [rlsPlugin({ schema }), softDeletePlugin()])
    repo = orm.createRepository(executor =>
      createRepositoryFactory(executor).create({
        tableName: 'posts',
        mapRow: r => r,
        schemas: { create: nativeAdapter() }
      })
    ) as unknown as SoftDeleteRepo
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('findAll: only own tenant, only live rows', async () => {
    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      const rows = await repo.findAll()
      expect(rows.map(r => r.title)).toEqual(['T1-POST'])
    })
  })

  it('findAllWithDeleted: own tenant only (was: leaked ALL tenants)', async () => {
    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      const rows = await repo.findAllWithDeleted()
      expect(rows.map(r => r.title).sort()).toEqual(['T1-DELETED', 'T1-POST'])
    })
  })

  it('findWithDeleted: cannot read another tenant’s row', async () => {
    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      // id=2 (T2-SECRET) and id=3 (T2-DELETED) belong to tenant t2
      expect(await repo.findWithDeleted(2)).toBeNull()
      expect(await repo.findWithDeleted(3)).toBeNull()
      // Own deleted row IS visible
      const own = await repo.findWithDeleted(4)
      expect(own?.title).toBe('T1-DELETED')
    })
  })

  it('findDeleted: only own tenant’s deleted rows', async () => {
    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      const rows = await repo.findDeleted()
      expect(rows.map(r => r.title)).toEqual(['T1-DELETED'])
    })
  })

  it('restore: cannot restore another tenant’s deleted row', async () => {
    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      // T2-DELETED is invisible through RLS → NotFoundError
      await expect(repo.restore(3)).rejects.toThrow(/not found/i)
    })
    const t2row = await db.selectFrom('posts').selectAll().where('id', '=', 3).executeTakeFirst()
    expect(t2row?.deleted_at).not.toBeNull()
  })

  it('hardDelete: cannot purge another tenant’s row', async () => {
    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      await repo.hardDelete(2)
    })
    const t2row = await db.selectFrom('posts').selectAll().where('id', '=', 2).executeTakeFirst()
    expect(t2row?.title).toBe('T2-SECRET')
  })

  it('restore works for own tenant’s deleted row', async () => {
    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      await repo.restore(4)
    })
    const row = await db.selectFrom('posts').selectAll().where('id', '=', 4).executeTakeFirst()
    expect(row?.deleted_at).toBeNull()
  })
})
