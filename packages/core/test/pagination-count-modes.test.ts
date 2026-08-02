/**
 * P1.5 — paginate() count strategies: 'exact' (default, legacy), 'none'
 * (skip COUNT, hasNext via limit+1 probe), 'estimated' (PostgreSQL
 * pg_class.reltuples, falling back to exact everywhere else).
 *
 * The real-PostgreSQL path is gated behind TEST_POSTGRES=true (same toggle
 * pattern as test/multi-db.test.ts); the estimate query's compiled shape is
 * verified dialect-accurately via kysely's DummyDriver.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresDialect,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteDialect,
  sql,
  type Generated
} from 'kysely'
import Database from 'better-sqlite3'
import { Pool } from 'pg'
import { paginate, estimatedCountQuery } from '../src/pagination.js'
import {
  resolveTestDatabases,
  acquireMultiDbLock,
  explainAvailability,
  type MultiDbLockRelease
} from '../../testing/src/detection.js'

interface CountDB {
  items: {
    id: Generated<number>
    name: string
  }
}

async function createSqliteDb(rows: number): Promise<{
  db: Kysely<CountDB>
  statements: string[]
}> {
  const statements: string[] = []
  const db = new Kysely<CountDB>({
    dialect: new SqliteDialect({ database: new Database(':memory:') }),
    log: event => {
      if (event.level === 'query') statements.push(event.query.sql)
    }
  })
  await db.schema
    .createTable('items')
    .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
    .addColumn('name', 'text')
    .execute()
  if (rows > 0) {
    await db
      .insertInto('items')
      .values(Array.from({ length: rows }, (_, i) => ({ name: `item-${i + 1}` })))
      .execute()
  }
  return { db, statements }
}

const countStatements = (statements: string[]): string[] =>
  statements.filter(s => s.toLowerCase().includes('count('))

describe('paginate count modes (sqlite)', () => {
  it('default (no count option): legacy exact behavior, no countMode field', async () => {
    const { db, statements } = await createSqliteDb(25)
    try {
      statements.length = 0
      const result = await paginate(db.selectFrom('items').selectAll(), { page: 2, limit: 10 })

      expect(result.data).toHaveLength(10)
      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNext: true,
        hasPrev: true
      })
      expect('countMode' in result.pagination).toBe(false)
      expect(countStatements(statements)).toHaveLength(1)
    } finally {
      await db.destroy()
    }
  })

  it("count: 'exact' reports countMode and keeps totals", async () => {
    const { db } = await createSqliteDb(25)
    try {
      const result = await paginate(db.selectFrom('items').selectAll(), {
        page: 1,
        limit: 10,
        count: 'exact'
      })
      expect(result.pagination.countMode).toBe('exact')
      expect(result.pagination.total).toBe(25)
      expect(result.pagination.totalPages).toBe(3)
      expect(result.pagination.hasNext).toBe(true)
    } finally {
      await db.destroy()
    }
  })

  it("count: 'none' skips the COUNT query and derives hasNext from a limit+1 probe", async () => {
    const { db, statements } = await createSqliteDb(25)
    try {
      statements.length = 0
      const page1 = await paginate(db.selectFrom('items').selectAll().orderBy('id'), {
        page: 1,
        limit: 10,
        count: 'none'
      })
      expect(countStatements(statements)).toHaveLength(0)
      expect(page1.data).toHaveLength(10)
      expect(page1.pagination.total).toBeUndefined()
      expect(page1.pagination.totalPages).toBeUndefined()
      expect(page1.pagination.hasNext).toBe(true)
      expect(page1.pagination.hasPrev).toBe(false)
      expect(page1.pagination.countMode).toBe('none')

      const page3 = await paginate(db.selectFrom('items').selectAll().orderBy('id'), {
        page: 3,
        limit: 10,
        count: 'none'
      })
      expect(page3.data).toHaveLength(5)
      expect(page3.pagination.hasNext).toBe(false)

      const page4 = await paginate(db.selectFrom('items').selectAll().orderBy('id'), {
        page: 4,
        limit: 10,
        count: 'none'
      })
      expect(page4.data).toHaveLength(0)
      expect(page4.pagination.hasNext).toBe(false)
    } finally {
      await db.destroy()
    }
  })

  it("count: 'none' with an exact page boundary probes correctly", async () => {
    const { db } = await createSqliteDb(20)
    try {
      const page2 = await paginate(db.selectFrom('items').selectAll().orderBy('id'), {
        page: 2,
        limit: 10,
        count: 'none'
      })
      // 20 rows, page 2 of 10: full page but NO next page
      expect(page2.data).toHaveLength(10)
      expect(page2.pagination.hasNext).toBe(false)
    } finally {
      await db.destroy()
    }
  })

  it("count: 'estimated' on a non-postgres dialect falls back to exact", async () => {
    const { db, statements } = await createSqliteDb(25)
    try {
      statements.length = 0
      const result = await paginate(db.selectFrom('items').selectAll(), {
        page: 1,
        limit: 10,
        dialect: 'sqlite',
        count: 'estimated'
      })
      expect(result.pagination.countMode).toBe('exact')
      expect(result.pagination.total).toBe(25)
      expect(countStatements(statements)).toHaveLength(1)
    } finally {
      await db.destroy()
    }
  })
})

describe('estimatedCountQuery (compiled shape, postgres compiler)', () => {
  const pgDb = new Kysely<CountDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: db => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  })

  it('compiles to a reltuples lookup on the base table with all clauses cleared', () => {
    const query = pgDb
      .selectFrom('items')
      .selectAll()
      .where('id', '>', 5)
      .orderBy('id', 'desc')
      .limit(7)
      .offset(14)

    const estimate = estimatedCountQuery(query)
    expect(estimate).not.toBeNull()
    const compiled = estimate!.compile()

    expect(compiled.sql).toContain('select reltuples::bigint from pg_class')
    expect(compiled.sql).toContain('to_regclass($1)')
    expect(compiled.sql).toContain('as "estimate" from "items"')
    // The user query's own clauses must be gone (only the LIMIT 1 remains)
    expect(compiled.sql).not.toContain('"id" >')
    expect(compiled.sql).not.toContain('order by')
    expect(compiled.sql).not.toContain('offset')
    // to_regclass receives the quoted identifier as a bind parameter, the
    // trailing parameter is the LIMIT 1
    expect(compiled.parameters).toEqual(['"items"', 1])
  })

  it('resolves aliased tables to their base table', () => {
    const estimate = estimatedCountQuery(
      pgDb.selectFrom('items as i').select('i.id' as never)
    )
    expect(estimate).not.toBeNull()
    expect(estimate!.compile().parameters[0]).toBe('"items"')
  })

  it('qualifies schema-prefixed tables', () => {
    const estimate = estimatedCountQuery(
      (pgDb as unknown as Kysely<Record<string, CountDB['items']>>)
        .selectFrom('analytics.items')
        .selectAll()
    )
    expect(estimate).not.toBeNull()
    expect(estimate!.compile().parameters[0]).toBe('"analytics"."items"')
  })

  it('returns null for multi-table FROM and subquery FROM', () => {
    const multi = (pgDb as unknown as Kysely<Record<string, CountDB['items']>>).selectFrom([
      'items',
      'other_items'
    ])
    expect(estimatedCountQuery(multi.selectAll())).toBeNull()

    const sub = pgDb.selectFrom(pgDb.selectFrom('items').selectAll().as('sub')).selectAll()
    expect(estimatedCountQuery(sub)).toBeNull()
  })
})

// Real-PostgreSQL path: TEST_POSTGRES forces on/off, otherwise a TCP probe
// finds the docker stack (same detection as test/multi-db.test.ts)
const dbs = await resolveTestDatabases()
const describePostgres = dbs.postgres.available ? describe : describe.skip

// Shared-database suites serialize across files/packages via the multi-db lock
let releaseMultiDbLock: MultiDbLockRelease | undefined
beforeAll(async () => {
  if (dbs.postgres.available) releaseMultiDbLock = await acquireMultiDbLock()
}, 660_000)
afterAll(() => {
  releaseMultiDbLock?.()
})

interface EstimateDB {
  pagination_estimate_p15: { id: Generated<number>; name: string }
  pagination_estimate_p15_fresh: { id: Generated<number>; name: string }
}

describePostgres(`paginate count: estimated (${explainAvailability(dbs.postgres)})`, () => {
  let db: Kysely<EstimateDB>

  beforeAll(async () => {
    db = new Kysely<EstimateDB>({
      dialect: new PostgresDialect({
        pool: new Pool({
          host: 'localhost',
          port: parseInt(process.env['DB_PORT'] || '5432'),
          database: 'kysera_test',
          user: 'test',
          password: 'test'
        })
      })
    })
    await db.schema.dropTable('pagination_estimate_p15').ifExists().execute()
    await db.schema.dropTable('pagination_estimate_p15_fresh').ifExists().execute()
    await db.schema
      .createTable('pagination_estimate_p15')
      .addColumn('id', 'serial', c => c.primaryKey())
      .addColumn('name', 'text')
      .execute()
    await db
      .insertInto('pagination_estimate_p15')
      .values(Array.from({ length: 57 }, (_, i) => ({ name: `row-${i + 1}` })))
      .execute()
    // Small tables are fully scanned by ANALYZE, so reltuples is exact here
    await sql`analyze pagination_estimate_p15`.execute(db)
  }, 30000)

  afterAll(async () => {
    await db.schema.dropTable('pagination_estimate_p15').ifExists().execute()
    await db.schema.dropTable('pagination_estimate_p15_fresh').ifExists().execute()
    await db.destroy()
  })

  it('uses reltuples for the total and a probe for hasNext', async () => {
    const result = await paginate(
      db.selectFrom('pagination_estimate_p15').selectAll().orderBy('id'),
      { page: 1, limit: 10, dialect: 'postgres', count: 'estimated' }
    )

    expect(result.pagination.countMode).toBe('estimated')
    expect(result.pagination.total).toBe(57)
    expect(result.pagination.totalPages).toBe(6)
    expect(result.data).toHaveLength(10)
    expect(result.pagination.hasNext).toBe(true)

    const lastPage = await paginate(
      db.selectFrom('pagination_estimate_p15').selectAll().orderBy('id'),
      { page: 6, limit: 10, dialect: 'postgres', count: 'estimated' }
    )
    expect(lastPage.data).toHaveLength(7)
    expect(lastPage.pagination.hasNext).toBe(false)
  })

  it('falls back to exact for never-analyzed tables (reltuples = -1)', async () => {
    await db.schema
      .createTable('pagination_estimate_p15_fresh')
      .addColumn('id', 'serial', c => c.primaryKey())
      .addColumn('name', 'text')
      .execute()
    await db
      .insertInto('pagination_estimate_p15_fresh')
      .values([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
      .execute()

    const result = await paginate(
      db.selectFrom('pagination_estimate_p15_fresh').selectAll().orderBy('id'),
      { page: 1, limit: 2, dialect: 'postgres', count: 'estimated' }
    )

    expect(result.pagination.countMode).toBe('exact')
    expect(result.pagination.total).toBe(3)
    expect(result.pagination.hasNext).toBe(true)
  })
})
