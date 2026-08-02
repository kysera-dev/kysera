import { describe, it, expect, vi } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import SqliteDatabase from 'better-sqlite3'
import {
  getTableStatistics,
  getDatabaseStatistics,
  PG_TABLE_SIZE_SQL,
  MYSQL_TABLE_SIZE_SQL
} from '../../../src/utils/table-stats.js'
import type { Database } from '../../../src/utils/database.js'
import type { DatabaseInstance } from '../../../src/types/index.js'

function makeSqliteDb(): Kysely<Database> {
  const database = new SqliteDatabase(':memory:')
  return new Kysely<Database>({ dialect: new SqliteDialect({ database }) })
}

describe('getTableStatistics (real sqlite)', () => {
  it('returns real row counts instead of zeros', async () => {
    const db = makeSqliteDb()
    try {
      await db.schema
        .createTable('users')
        .addColumn('id', 'integer', col => col.primaryKey())
        .addColumn('name', 'text')
        .execute()
      await db
        .insertInto('users')
        .values([
          { id: 1, name: 'a' },
          { id: 2, name: 'b' },
          { id: 3, name: 'c' }
        ])
        .execute()

      const stats = await getTableStatistics(db, 'users', 'sqlite')
      expect(stats.rows).toBe(3)
      // sqlite sizes are estimates but must be non-zero for non-empty tables
      expect(stats.size).toBeGreaterThan(0)

      const totals = await getDatabaseStatistics(db, ['users'], 'sqlite')
      expect(totals.totalRows).toBe(3)
    } finally {
      await db.destroy()
    }
  })

  it('rejects unsafe table names without touching the database', async () => {
    const db = makeSqliteDb()
    try {
      const stats = await getTableStatistics(db, 'users; DROP TABLE users', 'sqlite')
      expect(stats).toEqual({ rows: 0, size: 0, indexSize: 0 })
    } finally {
      await db.destroy()
    }
  })
})

describe('getTableStatistics (postgres/mysql probe SQL)', () => {
  it('sends a parameterized pg_class size probe for postgres', async () => {
    const executeQuery = vi.fn().mockResolvedValue({
      rows: [{ table_size: '8192', index_size: '16384' }]
    })
    const fakeDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ count: 42 }),
      fn: { countAll: () => ({ as: () => 'count' }) },
      executeQuery
    } as unknown as DatabaseInstance

    const stats = await getTableStatistics(fakeDb, 'users', 'postgres')

    expect(stats).toEqual({ rows: 42, size: 8192, indexSize: 16384 })
    const compiled = executeQuery.mock.calls[0][0] as { sql: string; parameters: unknown[] }
    expect(compiled.sql).toBe(PG_TABLE_SIZE_SQL)
    expect(compiled.sql).toContain('pg_relation_size')
    expect(compiled.sql).toContain('pg_indexes_size')
    expect(compiled.parameters).toEqual(['users'])
  })

  it('sends an information_schema size probe for mysql', async () => {
    const executeQuery = vi.fn().mockResolvedValue({
      rows: [{ table_size: 4096, index_size: 1024 }]
    })
    const fakeDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ count: 7 }),
      fn: { countAll: () => ({ as: () => 'count' }) },
      executeQuery
    } as unknown as DatabaseInstance

    const stats = await getTableStatistics(fakeDb, 'orders', 'mysql')

    expect(stats).toEqual({ rows: 7, size: 4096, indexSize: 1024 })
    const compiled = executeQuery.mock.calls[0][0] as { sql: string; parameters: unknown[] }
    expect(compiled.sql).toBe(MYSQL_TABLE_SIZE_SQL)
    expect(compiled.sql).toContain('DATABASE()')
    expect(compiled.parameters).toEqual(['orders'])
  })
})
