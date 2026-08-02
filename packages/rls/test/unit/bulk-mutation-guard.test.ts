/**
 * P1.4 — bulk repository mutations vs value-based policies.
 *
 * SEMANTIC TRUTH (verified red against the pre-guard plugin): the RLS plugin
 * wrapped only the single-row create/update/delete methods, so
 * bulkCreate/bulkUpdate/bulkDelete received ONLY the SQL-level filter()
 * narrowing from interceptQuery. Value-based allow()/deny()/validate()
 * policies — and default-deny itself — were silently skipped: a bulkUpdate
 * succeeded where the identical single update() threw RLSPolicyViolation.
 *
 * The guards close that gap by mirroring N single-row calls exactly:
 * per-input checkCreate for bulkCreate, and fetch-then-check per row for
 * bulkUpdate/bulkDelete (one raw batched SELECT through the per-operation
 * row cache), bounded by maxBulkRowChecks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import { createORM, createRepositoryFactory, nativeAdapter } from '@kysera/repository'
import { NotFoundError } from '@kysera/core'
import { rlsPlugin } from '../../src/plugin.js'
import { defineRLSSchema, allow, filter, validate } from '../../src/policy/index.js'
import { rlsContext } from '../../src/context/index.js'
import { RLSPolicyViolation, RLSPolicyEvaluationError } from '../../src/errors.js'

interface TestDB {
  posts: {
    id: Generated<number>
    title: string
    tenant_id: string
    owner_id: number
  }
}

interface BulkRepo {
  create(data: unknown): Promise<{ id: number }>
  update(id: number, data: unknown): Promise<unknown>
  delete(id: number): Promise<boolean>
  bulkCreate(inputs: unknown[]): Promise<unknown[]>
  bulkUpdate(updates: { id: number; data: unknown }[]): Promise<unknown[]>
  bulkDelete(ids: number[]): Promise<number>
}

const schema = defineRLSSchema<TestDB>({
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId as string })),
      allow('create', () => true),
      validate('create', ctx => ctx.data?.['tenant_id'] === ctx.auth.tenantId),
      // Value-based: only the owner may update/delete a row. Not expressible
      // as a filter for this test's purposes — must be evaluated per row.
      allow('update', ctx => ctx.row?.['owner_id'] === ctx.auth.userId),
      allow('delete', ctx => ctx.row?.['owner_id'] === ctx.auth.userId)
    ]
  }
})

const userCtx = (userId: number, tenantId = 't1') => ({
  auth: { userId, tenantId, roles: ['user'], isSystem: false },
  timestamp: new Date()
})

const systemCtx = () => ({
  auth: { userId: 0, tenantId: 't1', roles: ['system'], isSystem: true },
  timestamp: new Date()
})

async function createDb(): Promise<Kysely<TestDB>> {
  const db = new Kysely<TestDB>({
    dialect: new SqliteDialect({ database: new Database(':memory:') })
  })
  await db.schema
    .createTable('posts')
    .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
    .addColumn('title', 'text')
    .addColumn('tenant_id', 'text')
    .addColumn('owner_id', 'integer')
    .execute()
  await db
    .insertInto('posts')
    .values([
      { title: 'mine-1', tenant_id: 't1', owner_id: 1 },
      { title: 'mine-2', tenant_id: 't1', owner_id: 1 },
      { title: 'theirs', tenant_id: 't1', owner_id: 2 }
    ])
    .execute()
  return db
}

function createRepo(db: Kysely<TestDB>, orm: Awaited<ReturnType<typeof createORM<TestDB>>>): BulkRepo {
  return orm.createRepository(executor =>
    createRepositoryFactory(executor).create({
      tableName: 'posts',
      mapRow: r => r,
      schemas: { create: nativeAdapter() }
    })
  ) as unknown as BulkRepo
}

describe('bulk mutations under value-based policies (P1.4)', () => {
  let db: Kysely<TestDB>
  let repo: BulkRepo

  beforeEach(async () => {
    db = await createDb()
    const orm = await createORM(db, [rlsPlugin({ schema })])
    repo = createRepo(db, orm)
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('TRUTH: single update on a non-owned row is denied by allow()', async () => {
    await rlsContext.runAsync(userCtx(1), async () => {
      await expect(repo.update(3, { title: 'hijack' })).rejects.toThrow(RLSPolicyViolation)
    })
  })

  it('bulkUpdate enforces allow() per row — parity with single update', async () => {
    await rlsContext.runAsync(userCtx(1), async () => {
      // Pre-guard behavior: this call succeeded, silently bypassing allow()
      await expect(
        repo.bulkUpdate([
          { id: 1, data: { title: 'ok' } },
          { id: 3, data: { title: 'hijack' } }
        ])
      ).rejects.toThrow(RLSPolicyViolation)
    })

    // The denied batch must not have touched ANY row (check bypasses RLS)
    const rows = await db.selectFrom('posts').selectAll().orderBy('id').execute()
    expect(rows.map(r => r.title)).toEqual(['mine-1', 'mine-2', 'theirs'])
  })

  it('bulkUpdate succeeds when every row passes allow()', async () => {
    await rlsContext.runAsync(userCtx(1), async () => {
      const results = await repo.bulkUpdate([
        { id: 1, data: { title: 'updated-1' } },
        { id: 2, data: { title: 'updated-2' } }
      ])
      expect(results).toHaveLength(2)
    })
    const rows = await db.selectFrom('posts').selectAll().orderBy('id').execute()
    expect(rows.map(r => r.title)).toEqual(['updated-1', 'updated-2', 'theirs'])
  })

  it('bulkDelete enforces allow() per row', async () => {
    await rlsContext.runAsync(userCtx(1), async () => {
      await expect(repo.bulkDelete([1, 3])).rejects.toThrow(RLSPolicyViolation)
    })
    const count = await db.selectFrom('posts').selectAll().execute()
    expect(count).toHaveLength(3)

    await rlsContext.runAsync(userCtx(1), async () => {
      expect(await repo.bulkDelete([1, 2])).toBe(2)
    })
  })

  it('bulkCreate enforces validate() per input', async () => {
    await rlsContext.runAsync(userCtx(1), async () => {
      await expect(
        repo.bulkCreate([
          { title: 'fine', tenant_id: 't1', owner_id: 1 },
          { title: 'cross-tenant', tenant_id: 't2', owner_id: 1 }
        ])
      ).rejects.toThrow(RLSPolicyViolation)
    })
    expect(await db.selectFrom('posts').selectAll().execute()).toHaveLength(3)

    await rlsContext.runAsync(userCtx(1), async () => {
      const created = await repo.bulkCreate([
        { title: 'a', tenant_id: 't1', owner_id: 1 },
        { title: 'b', tenant_id: 't1', owner_id: 1 }
      ])
      expect(created).toHaveLength(2)
    })
  })

  it('missing rows are left to the base not-found handling (parity with single)', async () => {
    await rlsContext.runAsync(userCtx(1), async () => {
      await expect(
        repo.bulkUpdate([{ id: 999, data: { title: 'ghost' } }])
      ).rejects.toThrow(NotFoundError)
    })
  })

  it('system context bypasses bulk checks', async () => {
    await rlsContext.runAsync(systemCtx(), async () => {
      const results = await repo.bulkUpdate([
        { id: 1, data: { title: 's1' } },
        { id: 3, data: { title: 's3' } }
      ])
      expect(results).toHaveLength(2)
    })
  })

  it('batches beyond maxBulkRowChecks throw RLSPolicyEvaluationError, not silence', async () => {
    const orm = await createORM(db, [rlsPlugin({ schema, maxBulkRowChecks: 2 })])
    const bounded = createRepo(db, orm)

    await rlsContext.runAsync(userCtx(1), async () => {
      const error = await bounded
        .bulkUpdate([
          { id: 1, data: { title: 'x' } },
          { id: 2, data: { title: 'y' } },
          { id: 3, data: { title: 'z' } }
        ])
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RLSPolicyEvaluationError)
      expect((error as Error).message).toContain('maxBulkRowChecks=2')

      // Within the bound the same repository still evaluates per row
      await expect(
        bounded.bulkUpdate([
          { id: 1, data: { title: 'x' } },
          { id: 2, data: { title: 'y' } }
        ])
      ).resolves.toHaveLength(2)
    })
  })

  it('filter-only tables (defaultDeny: false) skip the per-row fetch entirely', async () => {
    const statements: string[] = []
    const filterDb = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') }),
      log(event) {
        if (event.level === 'query') statements.push(event.query.sql)
      }
    })
    await filterDb.schema
      .createTable('posts')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('title', 'text')
      .addColumn('tenant_id', 'text')
      .addColumn('owner_id', 'integer')
      .execute()
    await filterDb
      .insertInto('posts')
      .values([{ title: 'p1', tenant_id: 't1', owner_id: 1 }])
      .execute()

    const filterOnlySchema = defineRLSSchema<TestDB>({
      posts: {
        defaultDeny: false,
        policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId as string }))]
      }
    })
    const orm = await createORM(filterDb, [rlsPlugin({ schema: filterOnlySchema })])
    const filterRepo = createRepo(filterDb, orm)

    try {
      await rlsContext.runAsync(userCtx(1), async () => {
        statements.length = 0
        await filterRepo.bulkUpdate([{ id: 1, data: { title: 'renamed' } }])
        const selects = statements.filter(
          s => s.toLowerCase().startsWith('select') && s.includes('"posts"')
        )
        // No value-based policies for 'update' and not default-deny: the
        // guard must not add a row fetch (SQL narrowing already enforces
        // the filter policies)
        expect(selects).toHaveLength(0)
      })
    } finally {
      await filterDb.destroy()
    }
  })
})
