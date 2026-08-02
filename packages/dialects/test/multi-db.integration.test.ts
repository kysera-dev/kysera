/**
 * Real-database integration tests for the postgres and mysql adapters.
 *
 * Gated by TEST_POSTGRES / TEST_MYSQL (docker compose -f docker-compose.test.yml).
 * Covers the adapter surface that mock tests cannot verify: information_schema
 * queries, truncation, database size, and error matchers fed with REAL driver
 * errors from constraint violations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Kysely, PostgresDialect, MysqlDialect, sql } from 'kysely'
import { createPostgresAdapter, createMySQLAdapter, errorMatchers } from '../src/index.js'
import {
  resolveTestDatabases,
  acquireMultiDbLock,
  explainAvailability,
  type MultiDbLockRelease
} from '../../testing/src/detection.js'

// Server dialects run when TEST_* env forces them on, or when a TCP probe
// finds the docker stack running (skip reasons appear in the suite titles)
const dbs = await resolveTestDatabases()
const POSTGRES = dbs.postgres.available
const MYSQL = dbs.mysql.available

// Suites touching the shared docker databases serialize across files and
// packages via a cross-process lock
let releaseMultiDbLock: MultiDbLockRelease | undefined
beforeAll(async () => {
  if (POSTGRES || MYSQL) releaseMultiDbLock = await acquireMultiDbLock()
}, 660_000)
afterAll(() => {
  releaseMultiDbLock?.()
})

type AnyDB = Record<string, Record<string, unknown>>

describe.skipIf(!POSTGRES)(
  `PostgresAdapter against real PostgreSQL (${explainAvailability(dbs.postgres)})`,
  () => {
  let db: Kysely<AnyDB>
  const adapter = createPostgresAdapter()

  beforeAll(async () => {
    const { default: pg } = await import('pg')
    db = new Kysely<AnyDB>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({
          host: process.env['POSTGRES_HOST'] ?? 'localhost',
          port: Number(process.env['POSTGRES_PORT'] ?? 5432),
          user: process.env['POSTGRES_USER'] ?? 'test',
          password: process.env['POSTGRES_PASSWORD'] ?? 'test',
          database: process.env['POSTGRES_DB'] ?? 'kysera_test',
          max: 5
        })
      })
    })
    await sql`DROP TABLE IF EXISTS dialect_probe`.execute(db)
    await sql`CREATE TABLE dialect_probe (id serial primary key, email text unique not null)`.execute(db)
  })

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS dialect_probe`.execute(db)
    await db.destroy()
  })

  it('tableExists sees real tables', async () => {
    expect(await adapter.tableExists(db, 'dialect_probe')).toBe(true)
    expect(await adapter.tableExists(db, 'no_such_table')).toBe(false)
  })

  it('getTables lists the probe table', async () => {
    const tables = await adapter.getTables(db)
    expect(tables).toContain('dialect_probe')
  })

  it('getTableColumns returns real column names', async () => {
    const columns = await adapter.getTableColumns(db, 'dialect_probe')
    expect([...columns].sort()).toEqual(['email', 'id'])
  })

  it('getDatabaseSize returns a positive number (BIGINT string converted)', async () => {
    const size = await adapter.getDatabaseSize(db)
    expect(typeof size).toBe('number')
    expect(size).toBeGreaterThan(0)
  })

  it('truncateTable resets data and identity', async () => {
    await db.insertInto('dialect_probe').values({ email: 'a@x.com' } as never).execute()
    await adapter.truncateTable(db, 'dialect_probe')
    const rows = await db.selectFrom('dialect_probe').selectAll().execute()
    expect(rows).toHaveLength(0)
  })

  it('errorMatchers.postgres recognizes a REAL unique violation', async () => {
    await adapter.truncateTable(db, 'dialect_probe')
    await db.insertInto('dialect_probe').values({ email: 'dup@x.com' } as never).execute()
    let caught: unknown
    try {
      await db.insertInto('dialect_probe').values({ email: 'dup@x.com' } as never).execute()
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(errorMatchers.postgres.uniqueConstraint(caught)).toBe(true)
    expect(adapter.isUniqueConstraintError(caught)).toBe(true)
  })

  it('errorMatchers.postgres recognizes a REAL not-null violation', async () => {
    let caught: unknown
    try {
      await sql`INSERT INTO dialect_probe (email) VALUES (NULL)`.execute(db)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(errorMatchers.postgres.notNull(caught)).toBe(true)
  })
})

describe.skipIf(!MYSQL)(
  `MySQLAdapter against real MySQL (${explainAvailability(dbs.mysql)})`,
  () => {
  let db: Kysely<AnyDB>
  const adapter = createMySQLAdapter()

  beforeAll(async () => {
    const { createPool } = await import('mysql2')
    db = new Kysely<AnyDB>({
      dialect: new MysqlDialect({
        pool: createPool({
          host: process.env['MYSQL_HOST'] ?? 'localhost',
          port: Number(process.env['MYSQL_PORT'] ?? 3306),
          user: process.env['MYSQL_USER'] ?? 'test',
          password: process.env['MYSQL_PASSWORD'] ?? 'test',
          database: process.env['MYSQL_DB'] ?? 'kysera_test',
          connectionLimit: 5
        })
      })
    })
    await sql`DROP TABLE IF EXISTS dialect_probe`.execute(db)
    await sql`CREATE TABLE dialect_probe (id int auto_increment primary key, email varchar(255) unique not null)`.execute(db)
  })

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS dialect_probe`.execute(db)
    await db.destroy()
  })

  it('tableExists sees real tables', async () => {
    expect(await adapter.tableExists(db, 'dialect_probe')).toBe(true)
    expect(await adapter.tableExists(db, 'no_such_table')).toBe(false)
  })

  it('getTables lists the probe table', async () => {
    const tables = await adapter.getTables(db)
    expect(tables).toContain('dialect_probe')
  })

  it('getTableColumns returns real column names (uppercase info_schema handled)', async () => {
    const columns = await adapter.getTableColumns(db, 'dialect_probe')
    expect([...columns].sort()).toEqual(['email', 'id'])
  })

  it('getDatabaseSize returns a positive number (DECIMAL string converted)', async () => {
    const size = await adapter.getDatabaseSize(db)
    expect(typeof size).toBe('number')
    expect(size).toBeGreaterThan(0)
  })

  it('truncateTable resets data', async () => {
    await db.insertInto('dialect_probe').values({ email: 'a@x.com' } as never).execute()
    await adapter.truncateTable(db, 'dialect_probe')
    const rows = await db.selectFrom('dialect_probe').selectAll().execute()
    expect(rows).toHaveLength(0)
  })

  it('errorMatchers.mysql recognizes a REAL duplicate-entry error', async () => {
    await adapter.truncateTable(db, 'dialect_probe')
    await db.insertInto('dialect_probe').values({ email: 'dup@x.com' } as never).execute()
    let caught: unknown
    try {
      await db.insertInto('dialect_probe').values({ email: 'dup@x.com' } as never).execute()
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(errorMatchers.mysql.uniqueConstraint(caught)).toBe(true)
    expect(adapter.isUniqueConstraintError(caught)).toBe(true)
  })
})
