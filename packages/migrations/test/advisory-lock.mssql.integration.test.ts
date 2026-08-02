/**
 * Advisory-lock correctness against real SQL Server (TEST_MSSQL=true).
 *
 * MSSQL serializes concurrent runners with a session-owned sp_getapplock.
 * Two runners sharing one database must execute each migration exactly once,
 * and a runner that cannot get the lock within lockTimeoutMs must fail
 * cleanly with MigrationLockError — leaving the database untouched.
 *
 * Requires the docker-compose.test.yml mssql service (SQL Server 2022):
 *   pnpm docker:up && TEST_MSSQL=true vitest run test/advisory-lock.mssql.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Kysely, MssqlDialect, sql } from 'kysely'
import * as tarn from 'tarn'
import * as tedious from 'tedious'
import { createMigrationRunner, MigrationLockError, type Migration } from '../src/index.js'
import { safeDbDestroy } from './helpers/cleanup.js'

import {
  resolveTestDatabases,
  acquireMultiDbLock,
  explainAvailability,
  type MultiDbLockRelease
} from '../../testing/src/detection.js'

// Runs when TEST_MSSQL forces it on, or when a TCP probe finds the docker
// stack running (skip reason appears in the suite title)
const dbs = await resolveTestDatabases()
const MSSQL = dbs.mssql.available

// Suites touching the shared docker databases serialize across files and
// packages via a cross-process lock
let releaseMultiDbLock: MultiDbLockRelease | undefined
beforeAll(async () => {
  if (MSSQL) releaseMultiDbLock = await acquireMultiDbLock()
}, 660_000)
afterAll(() => {
  releaseMultiDbLock?.()
})

const HOST = process.env['MSSQL_HOST'] ?? 'localhost'
const PORT = Number(process.env['MSSQL_PORT'] ?? 1433)
const USER = process.env['MSSQL_USER'] ?? 'sa'
const PASSWORD = process.env['MSSQL_PASSWORD'] ?? 'Test@12345'
const DATABASE = process.env['MSSQL_DB'] ?? 'kysera_test'

type DB = Record<string, Record<string, unknown>>

const connect = (database: string): Kysely<DB> =>
  new Kysely<DB>({
    dialect: new MssqlDialect({
      tarn: { ...tarn, options: { min: 0, max: 5 } },
      tedious: {
        ...tedious,
        connectionFactory: () =>
          new tedious.Connection({
            server: HOST,
            authentication: {
              type: 'default',
              options: { userName: USER, password: PASSWORD }
            },
            options: {
              database,
              port: PORT,
              trustServerCertificate: true,
              // fail fast when the container is down instead of hanging
              connectTimeout: 15000
            }
          })
      }
    })
  })

describe.skipIf(!MSSQL)(
  `advisory lock on real MSSQL via sp_getapplock (${explainAvailability(dbs.mssql)})`,
  { timeout: 60000 },
  () => {
  let dbA: Kysely<DB>
  let dbB: Kysely<DB>
  let insertCount = 0

  const migrations = (): Migration<DB>[] => [
    {
      name: '001_lock_probe',
      up: async db => {
        // Non-idempotent effect: double execution is observable
        await sql`INSERT INTO lock_probe (marker) VALUES ('ran')`.execute(db)
        insertCount++
      },
      down: async db => {
        await sql`DELETE FROM lock_probe`.execute(db)
      }
    }
  ]

  beforeAll(async () => {
    // The container ships only master — create the test database once
    const master = connect('master')
    try {
      await sql`IF DB_ID(N'kysera_test') IS NULL CREATE DATABASE kysera_test`.execute(master)
    } finally {
      await safeDbDestroy(master)
    }
  }, 120000)

  beforeEach(async () => {
    dbA = connect(DATABASE)
    dbB = connect(DATABASE)
    insertCount = 0
    await sql`DROP TABLE IF EXISTS lock_probe`.execute(dbA)
    await sql`DROP TABLE IF EXISTS migrations`.execute(dbA)
    await sql`CREATE TABLE lock_probe (id int identity(1,1) PRIMARY KEY, marker nvarchar(50) NOT NULL)`.execute(
      dbA
    )
  }, 60000)

  afterEach(async () => {
    await sql`DROP TABLE IF EXISTS lock_probe`.execute(dbA)
    await sql`DROP TABLE IF EXISTS migrations`.execute(dbA)
    await safeDbDestroy(dbA)
    await safeDbDestroy(dbB)
  }, 60000)

  afterAll(async () => {
    // nothing to tear down — the test database is reused across runs
  })

  it('two concurrent runners execute each migration exactly once', async () => {
    const runnerA = createMigrationRunner(dbA, migrations())
    const runnerB = createMigrationRunner(dbB, migrations())

    const [resultA, resultB] = await Promise.all([runnerA.up(), runnerB.up()])

    // One runner executed, the other saw it as already done (or vice versa)
    const executedTotal = resultA.executed.length + resultB.executed.length
    expect(executedTotal).toBe(1)

    const rows = await sql<{ count: number }>`SELECT COUNT(*) as count FROM lock_probe`.execute(
      dbA
    )
    expect(Number(rows.rows[0]?.count)).toBe(1)
    expect(insertCount).toBe(1)
  })

  it('times out cleanly with MigrationLockError while another session holds the lock', async () => {
    let openGate!: () => void
    const gate = new Promise<void>(resolve => {
      openGate = resolve
    })
    let signalReady!: () => void
    const ready = new Promise<void>(resolve => {
      signalReady = resolve
    })

    // Foreign lock holder: same resource name, pinned session on dbB
    const holder = dbB.connection().execute(async conn => {
      await sql`
        declare @r int;
        exec @r = sp_getapplock
          @Resource = ${'kysera_migrations'},
          @LockMode = 'Exclusive',
          @LockOwner = 'Session',
          @LockTimeout = 10000;
        select @r as r;
      `.execute(conn)
      signalReady()
      await gate
      await sql`exec sp_releaseapplock @Resource = ${'kysera_migrations'}, @LockOwner = 'Session'`.execute(
        conn
      )
    })

    await ready

    const runner = createMigrationRunner(dbA, migrations(), { lockTimeoutMs: 1500 })
    const failure = await runner.up().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(MigrationLockError)
    expect(insertCount).toBe(0)

    openGate()
    await holder

    // Once the lock is free the same migrations apply cleanly
    const retry = await createMigrationRunner(dbA, migrations()).up()
    expect(retry.executed).toEqual(['001_lock_probe'])
    expect(insertCount).toBe(1)
  })
})
