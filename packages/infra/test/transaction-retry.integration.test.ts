/**
 * withTransactionRetry against real PostgreSQL failures (TEST_POSTGRES=true).
 *
 * Two live scenarios:
 * - a real deadlock (40P01): two transactions locking rows in opposite
 *   order — the victim is retried and both eventually commit fully
 * - a real serialization failure (40001) under REPEATABLE READ: the loser
 *   of a concurrent row update is retried against fresh data
 *
 * Both pin the core guarantee: the WHOLE callback re-runs, so no partial
 * writes from aborted attempts ever land.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { isSerializationError, withTransactionRetry } from '../src/resilience/index.js'
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
  `withTransactionRetry on real PostgreSQL (${explainAvailability(dbs.postgres)})`,
  { timeout: 30000 },
  () => {
  let db: Kysely<DB>

  beforeAll(async () => {
    db = await connect()
    await sql`DROP TABLE IF EXISTS txn_retry_probe`.execute(db)
    await sql`CREATE TABLE txn_retry_probe (id int PRIMARY KEY, v int NOT NULL)`.execute(db)
  })

  beforeEach(async () => {
    await sql`TRUNCATE txn_retry_probe`.execute(db)
    await sql`INSERT INTO txn_retry_probe (id, v) VALUES (1, 0), (2, 0)`.execute(db)
  })

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS txn_retry_probe`.execute(db)
    await db.destroy()
  })

  it('recovers from a real deadlock (40P01) with both transactions fully applied', async () => {
    const retryErrors: unknown[] = []
    // Cross-lock only on the FIRST attempt of each side; retries run clean
    const firstAttempt = { t1: true, t2: true }
    let signalT1!: () => void
    let signalT2!: () => void
    const t1Locked = new Promise<void>(resolve => {
      signalT1 = resolve
    })
    const t2Locked = new Promise<void>(resolve => {
      signalT2 = resolve
    })

    const task1 = withTransactionRetry(
      db,
      async trx => {
        await sql`UPDATE txn_retry_probe SET v = v + 1 WHERE id = 1`.execute(trx)
        if (firstAttempt.t1) {
          firstAttempt.t1 = false
          signalT1()
          await t2Locked
        }
        await sql`UPDATE txn_retry_probe SET v = v + 1 WHERE id = 2`.execute(trx)
      },
      { delayMs: 20, onRetry: (_attempt, error) => retryErrors.push(error) }
    )

    const task2 = withTransactionRetry(
      db,
      async trx => {
        await sql`UPDATE txn_retry_probe SET v = v + 1 WHERE id = 2`.execute(trx)
        if (firstAttempt.t2) {
          firstAttempt.t2 = false
          signalT2()
          await t1Locked
        }
        await sql`UPDATE txn_retry_probe SET v = v + 1 WHERE id = 1`.execute(trx)
      },
      { delayMs: 20, onRetry: (_attempt, error) => retryErrors.push(error) }
    )

    await Promise.all([task1, task2])

    // At least one side was chosen as deadlock victim and retried
    expect(retryErrors.length).toBeGreaterThanOrEqual(1)
    expect(retryErrors.some(error => isSerializationError(error))).toBe(true)

    // Whole-callback retry: every increment landed exactly once per side
    const rows = await sql<{ id: number; v: number }>`
      SELECT id, v FROM txn_retry_probe ORDER BY id
    `.execute(db)
    expect(rows.rows).toEqual([
      { id: 1, v: 2 },
      { id: 2, v: 2 }
    ])
  })

  it('recovers from a serialization failure (40001) under REPEATABLE READ', async () => {
    const retryErrors: unknown[] = []
    let signalHolderUpdated!: () => void
    const holderUpdated = new Promise<void>(resolve => {
      signalHolderUpdated = resolve
    })
    let releaseHolder!: () => void
    const holderGate = new Promise<void>(resolve => {
      releaseHolder = resolve
    })

    // Plain transaction that updates row 1 and holds the lock
    const holder = db.transaction().execute(async trx => {
      await sql`UPDATE txn_retry_probe SET v = v + 1 WHERE id = 1`.execute(trx)
      signalHolderUpdated()
      await holderGate
    })

    await holderUpdated

    const contender = withTransactionRetry(
      db,
      async trx => {
        // First statement of the transaction — REPEATABLE READ takes a snapshot
        await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(trx)
        // Blocks on the holder's row lock; when the holder commits, this
        // fails with 40001 (could not serialize access due to concurrent update)
        await sql`UPDATE txn_retry_probe SET v = v + 1 WHERE id = 1`.execute(trx)
      },
      { delayMs: 20, onRetry: (_attempt, error) => retryErrors.push(error) }
    )

    // Let the contender reach the blocked UPDATE, then commit the holder
    await sleep(300)
    releaseHolder()
    await Promise.all([holder, contender])

    expect(retryErrors.length).toBe(1)
    expect(isSerializationError(retryErrors[0])).toBe(true)

    // Both increments applied: holder +1, contender +1 (on its clean retry)
    const row = await sql<{ v: number }>`
      SELECT v FROM txn_retry_probe WHERE id = 1
    `.execute(db)
    expect(row.rows[0]?.v).toBe(2)
  })
})
