/**
 * SECURITY regression tests: RLS on the DAL/executor mutation path.
 *
 * Before the fix, interceptQuery only set dead `__rlsRequired` metadata for
 * mutations — `executor.updateTable('posts').set(...).where('id','=',X)`
 * rewrote and deleted OTHER TENANTS' rows inside a tenant context.
 * Verified empirically against real SQLite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import { createExecutor } from '@kysera/executor'
import { rlsPlugin } from '../../src/plugin.js'
import { defineRLSSchema, filter } from '../../src/policy/index.js'
import { rlsContext } from '../../src/context/index.js'

interface TestDB {
  posts: {
    id: Generated<number>
    title: string
    tenant_id: string
  }
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

describe('RLS mutation enforcement (DAL/executor path)', () => {
  let db: Kysely<TestDB>

  beforeEach(async () => {
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') })
    })
    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('title', 'text')
      .addColumn('tenant_id', 'text')
      .execute()
    await db
      .insertInto('posts')
      .values([
        { title: 'T1-POST', tenant_id: 't1' },
        { title: 'T2-SECRET', tenant_id: 't2' }
      ])
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('UPDATE via executor cannot touch another tenant’s rows', async () => {
    const executor = await createExecutor(db, [rlsPlugin({ schema })])

    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      // id=2 belongs to tenant t2 — the RLS predicate must exclude it
      await executor
        .updateTable('posts')
        .set({ title: 'HACKED' })
        .where('id', '=', 2)
        .execute()
    })

    const row = await db.selectFrom('posts').selectAll().where('id', '=', 2).executeTakeFirst()
    expect(row?.title).toBe('T2-SECRET')
  })

  it('DELETE via executor cannot remove another tenant’s rows', async () => {
    const executor = await createExecutor(db, [rlsPlugin({ schema })])

    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      await executor.deleteFrom('posts').where('id', '=', 2).execute()
    })

    const rows = await db.selectFrom('posts').selectAll().execute()
    expect(rows).toHaveLength(2)
  })

  it('UPDATE within own tenant still works', async () => {
    const executor = await createExecutor(db, [rlsPlugin({ schema })])

    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      await executor
        .updateTable('posts')
        .set({ title: 'UPDATED-BY-OWNER' })
        .where('id', '=', 1)
        .execute()
    })

    const row = await db.selectFrom('posts').selectAll().where('id', '=', 1).executeTakeFirst()
    expect(row?.title).toBe('UPDATED-BY-OWNER')
  })

  it('missing context + allowUnfilteredQueries:false makes mutations touch nothing', async () => {
    const executor = await createExecutor(db, [
      rlsPlugin({ schema, requireContext: false, allowUnfilteredQueries: false })
    ])

    // No rlsContext at all
    await executor.updateTable('posts').set({ title: 'GHOST' }).execute()
    await executor.deleteFrom('posts').where('id', '=', 1).execute()

    const rows = await db.selectFrom('posts').selectAll().orderBy('id').execute()
    expect(rows.map(r => r.title)).toEqual(['T1-POST', 'T2-SECRET'])
  })

  it('system context bypasses mutation filtering', async () => {
    const executor = await createExecutor(db, [rlsPlugin({ schema })])

    await rlsContext.runAsync(
      { auth: { userId: 0, roles: [], isSystem: true }, timestamp: new Date() },
      async () => {
        await executor.updateTable('posts').set({ title: 'SYSTEM' }).where('id', '=', 2).execute()
      }
    )

    const row = await db.selectFrom('posts').selectAll().where('id', '=', 2).executeTakeFirst()
    expect(row?.title).toBe('SYSTEM')
  })

  it('using the plugin before onInit fails loudly (createExecutorSync)', async () => {
    const { createExecutorSync } = await import('@kysera/executor')
    const executor = createExecutorSync(db, [rlsPlugin({ schema })])

    // The executor wraps plugin exceptions; the cause is the RLSError
    await expect(
      rlsContext.runAsync(tenantCtx('t1'), async () =>
        executor.selectFrom('posts').selectAll().execute()
      )
    ).rejects.toThrow(/Plugin used before initialization/)
  })

  it('onDestroy before onInit does not throw', async () => {
    const plugin = rlsPlugin({ schema })
    expect(() => plugin.onDestroy?.()).not.toThrow()
  })

  it('SECURITY: withPluginMetadata({skipRLS:true}) must NOT bypass RLS', async () => {
    // The metadata channel is publicly reachable — a metadata switch would
    // disable row security without context, roles, or an audit trail.
    // Exact auditor repro: tenant-1 user, isSystem:false.
    const { withPluginMetadata } = await import('@kysera/executor')
    const executor = await createExecutor(db, [rlsPlugin({ schema })])
    const escaped = withPluginMetadata(executor, { skipRLS: true })

    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      const rows = await escaped.selectFrom('posts').selectAll().execute()
      expect(rows.map(r => r.title)).toEqual(['T1-POST'])
    })

    // Mutations through the same channel stay scoped too
    await rlsContext.runAsync(tenantCtx('t1'), async () => {
      await escaped.updateTable('posts').set({ title: 'HACKED' }).where('id', '=', 2).execute()
    })
    const row = await db.selectFrom('posts').selectAll().where('id', '=', 2).executeTakeFirst()
    expect(row?.title).toBe('T2-SECRET')
  })
})
