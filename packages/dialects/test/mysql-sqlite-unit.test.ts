/**
 * Unit tests for the MySQL and SQLite adapters' sql-template paths, plus
 * factory/connection edge cases. Uses the fake-kysely driver (real query
 * compilers, canned rows) — the same surface runs against live databases in
 * test/multi-db.integration.test.ts.
 */

import { describe, it, expect } from 'vitest'
import {
  MySQLAdapter,
  SQLiteAdapter,
  createSQLiteAdapter,
  createDialectAdapter,
  buildConnectionUrl
} from '../src/index.js'
import { createFakeDb, createCapturingLogger } from './helpers/fake-kysely.js'

describe('MySQLAdapter.getDatabaseSize (unit)', () => {
  const adapter = new MySQLAdapter()

  it('sums data and index length for an explicit database, coercing DECIMAL strings', async () => {
    const { db, executed } = createFakeDb('mysql', () => [{ size: '4096' }])

    const size = await adapter.getDatabaseSize(db, 'appdb')

    expect(size).toBe(4096)
    expect(executed).toHaveLength(1)
    expect(executed[0]?.sql).toContain('SUM(data_length + index_length)')
    expect(executed[0]?.parameters).toEqual(['appdb'])
  })

  it('falls back to DATABASE() to resolve the current database name', async () => {
    const { db, executed } = createFakeDb('mysql', query =>
      query.sql.includes('DATABASE()') ? [{ name: 'appdb' }] : [{ size: 100 }]
    )

    const size = await adapter.getDatabaseSize(db)

    expect(size).toBe(100)
    expect(executed[0]?.sql).toContain('DATABASE()')
    expect(executed[1]?.parameters).toEqual(['appdb'])
  })

  it('returns 0 when no database is selected, size is NULL, or the query fails', async () => {
    const noDb = createFakeDb('mysql', () => [])
    expect(await adapter.getDatabaseSize(noDb.db)).toBe(0)
    // Without a database name there is nothing to size — no second query
    expect(noDb.executed).toHaveLength(1)

    const nullSum = createFakeDb('mysql', () => [{ size: null }])
    expect(await adapter.getDatabaseSize(nullSum.db, 'appdb')).toBe(0)

    const failing = createFakeDb('mysql', () => {
      throw new Error('connection refused')
    })
    expect(await adapter.getDatabaseSize(failing.db, 'appdb')).toBe(0)
  })
})

describe('MySQLAdapter.truncateTable (unit)', () => {
  const adapter = new MySQLAdapter()

  it('disables FK checks, truncates, then re-enables FK checks', async () => {
    const { db, executed } = createFakeDb('mysql')

    expect(await adapter.truncateTable(db, 'users')).toBe(true)
    expect(executed.map(q => q.sql)).toEqual([
      'SET FOREIGN_KEY_CHECKS = 0',
      'TRUNCATE TABLE `users`',
      'SET FOREIGN_KEY_CHECKS = 1'
    ])
  })

  it('qualifies the table with the schema (database) when provided', async () => {
    const { db, executed } = createFakeDb('mysql')

    await adapter.truncateTable(db, 'users', { schema: 'appdb' })

    expect(executed[1]?.sql).toBe('TRUNCATE TABLE `appdb`.`users`')
  })

  it('returns false for missing tables and still re-enables FK checks', async () => {
    const { db, executed } = createFakeDb('mysql', query => {
      if (query.sql.startsWith('TRUNCATE')) throw new Error("Table 'appdb.users' doesn't exist")
      return []
    })

    expect(await adapter.truncateTable(db, 'users')).toBe(false)
    expect(executed.map(q => q.sql)).toContain('SET FOREIGN_KEY_CHECKS = 1')
  })

  it('logs and rethrows unexpected truncate errors', async () => {
    const { logger, entries } = createCapturingLogger()
    const withLogger = new MySQLAdapter({ logger })
    const { db } = createFakeDb('mysql', query => {
      if (query.sql.startsWith('TRUNCATE')) throw new Error('Lock wait timeout exceeded')
      return []
    })

    await expect(withLogger.truncateTable(db, 'users')).rejects.toThrow('Lock wait timeout')
    expect(entries.some(e => e.level === 'error' && e.message.includes('users'))).toBe(true)
  })

  it('logs when FK checks cannot be re-enabled but keeps the truncate result', async () => {
    const { logger, entries } = createCapturingLogger()
    const withLogger = new MySQLAdapter({ logger })
    const { db } = createFakeDb('mysql', query => {
      if (query.sql === 'SET FOREIGN_KEY_CHECKS = 1') throw new Error('server gone away')
      return []
    })

    expect(await withLogger.truncateTable(db, 'users')).toBe(true)
    expect(
      entries.some(e => e.level === 'error' && e.message.includes('re-enable foreign key checks'))
    ).toBe(true)
  })
})

describe('SQLiteAdapter attached-database paths (unit)', () => {
  const adapter = new SQLiteAdapter()

  it('tableExists queries <schema>.sqlite_master for non-main schemas', async () => {
    const found = createFakeDb('sqlite', () => [{ name: 'users' }])
    expect(await adapter.tableExists(found.db, 'users', { schema: 'aux' })).toBe(true)
    expect(found.executed[0]?.sql).toContain('"aux"."sqlite_master"')
    expect(found.executed[0]?.parameters).toContain('users')

    const missing = createFakeDb('sqlite', () => [])
    expect(await adapter.tableExists(missing.db, 'users', { schema: 'aux' })).toBe(false)
  })

  it('getTables lists tables from an attached schema, excluding sqlite_ internals', async () => {
    const { db, executed } = createFakeDb('sqlite', () => [{ name: 'users' }, { name: 'posts' }])

    expect(await adapter.getTables(db, { schema: 'aux' })).toEqual(['users', 'posts'])
    expect(executed[0]?.sql).toContain('"aux"."sqlite_master"')
    expect(executed[0]?.sql).toContain("NOT LIKE 'sqlite_%'")
  })

  it('getDatabaseSize always reports 0 (no cross-runtime file access)', async () => {
    const { db, executed } = createFakeDb('sqlite')
    expect(await adapter.getDatabaseSize(db)).toBe(0)
    expect(executed).toHaveLength(0)
  })

  it('createSQLiteAdapter applies custom options', () => {
    const custom = createSQLiteAdapter({ defaultSchema: 'aux' })
    expect(custom).toBeInstanceOf(SQLiteAdapter)
    expect(custom.defaultSchema).toBe('aux')
    expect(custom.dialect).toBe('sqlite')
  })
})

describe('factory and connection edge cases (unit)', () => {
  it('createDialectAdapter builds an MSSQL adapter', () => {
    const adapter = createDialectAdapter('mssql')
    expect(adapter.dialect).toBe('mssql')
    expect(adapter.getDefaultPort()).toBe(1433)
  })

  it('buildConnectionUrl renders user credentials without a password', () => {
    expect(
      buildConnectionUrl('postgres', { user: 'svc', host: 'db.local', database: 'app' })
    ).toBe('postgresql://svc@db.local:5432/app')
  })
})
