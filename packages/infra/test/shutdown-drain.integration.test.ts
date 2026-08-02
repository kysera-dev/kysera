/**
 * Drain semantics of gracefulShutdown against real PostgreSQL (TEST_POSTGRES=true).
 *
 * gracefulShutdown delegates to db.destroy(); with the pg driver that is
 * pool.end(), which WAITS for checked-out connections — an in-flight query
 * finishes normally and is never killed. What gracefulShutdown does NOT do
 * is gate new work: queries issued after shutdown fail. These tests pin
 * exactly that contract (documented in api/infra.md).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { gracefulShutdown } from '../src/shutdown.js'
import {
  resolveTestDatabases,
  acquireMultiDbLock,
  explainAvailability,
  type MultiDbLockRelease
} from '../../testing/src/detection.js'

// Runs when TEST_POSTGRES forces it on, or when a TCP probe finds the docker
// stack running (skip reason appears in the suite title)
const dbs = await resolveTestDatabases()
const POSTGRES = dbs.postgres.available

// Suites touching the shared docker databases serialize across files and
// packages via a cross-process lock
let releaseMultiDbLock: MultiDbLockRelease | undefined
beforeAll(async () => {
  if (POSTGRES) releaseMultiDbLock = await acquireMultiDbLock()
}, 660_000)
afterAll(() => {
  releaseMultiDbLock?.()
})

type DB = Record<string, Record<string, unknown>>

const connect = async (): Promise<Kysely<DB>> => {
  const { default: pg } = await import('pg')
  return new Kysely<DB>({
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
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe.skipIf(!POSTGRES)(
  `gracefulShutdown drain semantics on real PostgreSQL (${explainAvailability(dbs.postgres)})`,
  () => {
  it('waits for an in-flight query to finish (drains, does not kill)', async () => {
    const db = await connect()
    await sql`select 1`.execute(db) // warm the pool

    // In-flight slow query occupying one pooled connection
    const slow = sql`select pg_sleep(0.6) as slept`.execute(db)
    await sleep(100) // ensure it reached the server before shutdown starts

    const start = Date.now()
    await gracefulShutdown(db, { timeout: 15000 })
    const elapsed = Date.now() - start

    // The in-flight query completed normally — destroy waited for it
    await expect(slow).resolves.toBeDefined()
    // ...which is why shutdown took roughly the remaining sleep time
    expect(elapsed).toBeGreaterThanOrEqual(350)
  })

  it('does not gate new work: queries after shutdown fail', async () => {
    const db = await connect()
    await sql`select 1`.execute(db)

    await gracefulShutdown(db, { timeout: 15000 })

    await expect(sql`select 1`.execute(db)).rejects.toThrow(/destroy/i)
  })
})
