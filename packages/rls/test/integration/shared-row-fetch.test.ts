/**
 * P0.3 — shared per-operation row fetch.
 *
 * A guarded mutation used to trigger one identical pre-fetch SELECT per
 * plugin: audit fetched the row for old-values capture, rls fetched it again
 * for value-policy evaluation, and soft-delete's restore() probed it a third
 * time. The per-operation row cache in @kysera/core collapses those into ONE
 * SELECT — scoped to exactly one logical repository call, never across calls.
 *
 * Query counting: every executed statement is recorded via Kysely's `log`
 * hook on the underlying database, so raw-db fetches (which bypass plugin
 * interception) are counted too.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import { createORM, createRepositoryFactory, nativeAdapter } from '@kysera/repository'
import { auditPlugin, type ParsedAuditLogEntry } from '@kysera/audit'
import { softDeletePlugin } from '@kysera/soft-delete'
import { rlsPlugin } from '../../src/plugin.js'
import { defineRLSSchema, allow, filter } from '../../src/policy/index.js'
import { rlsContext } from '../../src/context/index.js'
import { RLSPolicyViolation } from '../../src/errors.js'

interface TestDB {
  posts: {
    id: Generated<number>
    title: string
    tenant_id: string
    owner_id: number
    deleted_at: string | null
  }
}

interface StackedRepo {
  update(id: number, data: unknown): Promise<{ title: string }>
  delete(id: number): Promise<boolean>
  softDelete(id: number): Promise<unknown>
  restore(id: number): Promise<unknown>
  getAuditHistory(id: number | string): Promise<ParsedAuditLogEntry[]>
}

const schema = defineRLSSchema<TestDB>({
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId as string })),
      allow('create', () => true),
      // Value-based policies force the pre-mutation row fetch in rls
      allow('update', ctx => ctx.row?.['owner_id'] === ctx.auth.userId),
      allow('delete', ctx => ctx.row?.['owner_id'] === ctx.auth.userId)
    ]
  }
})

const userCtx = (userId: number) => ({
  auth: { userId, tenantId: 't1', roles: ['user'], isSystem: false },
  timestamp: new Date()
})

describe('shared per-operation row fetch (rls + audit + soft-delete)', () => {
  let db: Kysely<TestDB>
  let statements: string[]

  /** SELECTs against the entity table (audit_logs statements excluded). */
  const postsSelects = (): string[] =>
    statements.filter(
      s =>
        s.toLowerCase().startsWith('select') &&
        s.includes('"posts"') &&
        !s.includes('"audit_logs"')
    )

  beforeEach(async () => {
    statements = []
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') }),
      log: event => {
        if (event.level === 'query') statements.push(event.query.sql)
      }
    })
    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('title', 'text')
      .addColumn('tenant_id', 'text')
      .addColumn('owner_id', 'integer')
      .addColumn('deleted_at', 'text')
      .execute()
    await db
      .insertInto('posts')
      .values([
        { title: 'first', tenant_id: 't1', owner_id: 1, deleted_at: null },
        { title: 'second', tenant_id: 't1', owner_id: 1, deleted_at: null }
      ])
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
  })

  async function stackedRepo(plugins: Parameters<typeof createORM>[1]): Promise<StackedRepo> {
    const orm = await createORM(db, plugins)
    return orm.createRepository(executor =>
      createRepositoryFactory(executor).create({
        tableName: 'posts',
        mapRow: r => r,
        schemas: { create: nativeAdapter() }
      })
    ) as unknown as StackedRepo
  }

  it('rls + audit update: exactly ONE pre-fetch SELECT (was 2)', async () => {
    const repo = await stackedRepo([rlsPlugin({ schema }), auditPlugin()])

    await rlsContext.runAsync(userCtx(1), async () => {
      statements.length = 0
      const result = await repo.update(1, { title: 'renamed' })
      expect(result.title).toBe('renamed')
    })

    // audit's old-values fetch and rls's policy fetch share one raw SELECT;
    // the UPDATE itself uses RETURNING (no post-select on sqlite)
    expect(postsSelects()).toHaveLength(1)

    // Both consumers really used the fetched row: audit captured old values…
    const history = await rlsContext.runAsync(userCtx(1), async () =>
      repo.getAuditHistory(1)
    )
    expect(history).toHaveLength(1)
    expect(history[0]!.operation).toBe('UPDATE')
    expect(history[0]!.old_values?.['title']).toBe('first')
    expect(history[0]!.new_values?.['title']).toBe('renamed')
  })

  it('rls + audit update: cached row still enforces value policies (denial path)', async () => {
    const repo = await stackedRepo([rlsPlugin({ schema }), auditPlugin()])

    await rlsContext.runAsync(userCtx(2), async () => {
      statements.length = 0
      await expect(repo.update(1, { title: 'hijack' })).rejects.toThrow(RLSPolicyViolation)
      expect(postsSelects()).toHaveLength(1)
    })

    const row = await db
      .selectFrom('posts')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst()
    expect(row?.title).toBe('first')
  })

  it('rls + audit delete: exactly ONE pre-fetch SELECT (was 2)', async () => {
    const repo = await stackedRepo([rlsPlugin({ schema }), auditPlugin()])

    await rlsContext.runAsync(userCtx(1), async () => {
      statements.length = 0
      expect(await repo.delete(1)).toBe(true)
    })

    expect(postsSelects()).toHaveLength(1)
  })

  it('rls + soft-delete + audit restore: probe reuses audit old-values fetch (3 SELECTs -> 2)', async () => {
    const repo = await stackedRepo([
      rlsPlugin({ schema }),
      softDeletePlugin(),
      auditPlugin()
    ])

    await rlsContext.runAsync(userCtx(1), async () => {
      await repo.softDelete(1)

      statements.length = 0
      await repo.restore(1)
    })

    // restore = audit old-values fetch (shared with soft-delete's existence
    // probe) + soft-delete's post-update read-back. Before the cache: probe
    // ran separately -> 3 SELECTs.
    expect(postsSelects()).toHaveLength(2)
  })

  it('rls + soft-delete + audit softDelete: ONE SELECT total (pre-image only; post-image via UPDATE RETURNING)', async () => {
    // soft-delete scoped to the entity table so audit_logs (no deleted_at
    // column) is not narrowed when reading the audit trail below
    const repo = await stackedRepo([
      rlsPlugin({ schema }),
      softDeletePlugin({ tables: ['posts'] }),
      auditPlugin()
    ])

    await rlsContext.runAsync(userCtx(1), async () => {
      statements.length = 0
      await repo.softDelete(1)
    })

    // The two SELECTs this path used to issue were different snapshots:
    // audit's PRE-image fetch and soft-delete's POST-update read-back — not
    // shareable through the pre-mutation cache. On sqlite/postgres the
    // read-back is folded into UPDATE ... RETURNING instead, leaving only
    // audit's cache-backed pre-fetch.
    expect(postsSelects()).toHaveLength(1)
    const updates = statements.filter(s => s.toLowerCase().startsWith('update') && s.includes('"posts"'))
    expect(updates).toHaveLength(1)
    expect(updates[0]!.toLowerCase()).toContain('returning')

    // Audit captured both snapshots correctly
    const history = await rlsContext.runAsync(userCtx(1), async () =>
      repo.getAuditHistory(1)
    )
    expect(history).toHaveLength(1)
    expect(history[0]!.operation).toBe('UPDATE')
    expect(history[0]!.old_values?.['deleted_at']).toBeNull()
    expect(history[0]!.new_values?.['deleted_at']).not.toBeNull()
  })

  it('no sharing ACROSS operations: two updates fetch twice', async () => {
    const repo = await stackedRepo([rlsPlugin({ schema }), auditPlugin()])

    await rlsContext.runAsync(userCtx(1), async () => {
      statements.length = 0
      await repo.update(1, { title: 'one' })
      await repo.update(1, { title: 'two' })
    })

    // Each logical call gets a fresh cache — stale pre-images must never
    // leak into the next operation's policy checks or audit entries
    expect(postsSelects()).toHaveLength(2)

    const history = await rlsContext.runAsync(userCtx(1), async () =>
      repo.getAuditHistory(1)
    )
    const oldTitles = history.map(h => h.old_values?.['title']).sort()
    expect(oldTitles).toEqual(['first', 'one'])
  })

  it('concurrent operations keep isolated caches', async () => {
    const repo = await stackedRepo([rlsPlugin({ schema }), auditPlugin()])

    await rlsContext.runAsync(userCtx(1), async () => {
      statements.length = 0
      await Promise.all([
        repo.update(1, { title: 'parallel-1' }),
        repo.update(2, { title: 'parallel-2' })
      ])
    })

    // One pre-fetch per operation, and each operation saw its own row
    expect(postsSelects()).toHaveLength(2)
    const rows = await db.selectFrom('posts').selectAll().orderBy('id').execute()
    expect(rows.map(r => r.title)).toEqual(['parallel-1', 'parallel-2'])
  })

  it('rls alone: still a single fetch (no scope, direct path)', async () => {
    const repo = await stackedRepo([rlsPlugin({ schema })])

    await rlsContext.runAsync(userCtx(1), async () => {
      statements.length = 0
      await repo.update(1, { title: 'solo' })
    })

    expect(postsSelects()).toHaveLength(1)
  })

  it('rls + audit bulkUpdate: ONE batched pre-fetch serves audit old values AND per-row policy checks', async () => {
    const repo = (await stackedRepo([
      rlsPlugin({ schema }),
      auditPlugin()
    ])) as unknown as StackedRepo & {
      bulkUpdate(updates: { id: number; data: unknown }[]): Promise<unknown[]>
    }

    await rlsContext.runAsync(userCtx(1), async () => {
      statements.length = 0
      await repo.bulkUpdate([
        { id: 1, data: { title: 'bulk-1' } },
        { id: 2, data: { title: 'bulk-2' } }
      ])
    })

    // audit's batched old-values fetch primes the cache; rls's per-row
    // policy checks consume it without a second batch SELECT. The remaining
    // UPDATEs use RETURNING.
    expect(postsSelects()).toHaveLength(1)

    const history = await rlsContext.runAsync(userCtx(1), async () =>
      repo.getAuditHistory(1)
    )
    expect(history[0]!.old_values?.['title']).toBe('first')
  })
})
