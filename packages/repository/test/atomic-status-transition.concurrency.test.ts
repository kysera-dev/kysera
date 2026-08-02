/**
 * Concurrency proof for atomicStatusTransition (P2.13b).
 *
 * N=20 parallel transitions race on ONE row: exactly one caller wins
 * (gets the updated row back), the other 19 get the documented failure
 * (null — the WHERE status guard matched zero rows). Nothing is applied
 * twice, which is the whole point of the helper for payment/state-machine
 * flows.
 *
 * The PostgreSQL variant runs when live PG is available (detection probe /
 * TEST_POSTGRES); the SQLite variant always runs (better-sqlite3 serializes
 * writers, but the WHERE-guard semantics are identical and worth pinning on
 * the fallback path).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Kysely, PostgresDialect, SqliteDialect, sql, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import { atomicStatusTransition } from '../src/index.js'
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

const N = 20

interface ProbeDB {
  status_race_probe: {
    id: number
    status: string
    winner_tag: string | null
  }
}

describe.skipIf(!POSTGRES)(
  `atomicStatusTransition under N=20 contention on real PostgreSQL (${explainAvailability(dbs.postgres)})`,
  () => {
  let db: Kysely<ProbeDB>

  beforeEach(async () => {
    const { default: pg } = await import('pg')
    db = new Kysely<ProbeDB>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({
          host: process.env['POSTGRES_HOST'] ?? 'localhost',
          port: Number(process.env['POSTGRES_PORT'] ?? 5432),
          user: process.env['POSTGRES_USER'] ?? 'test',
          password: process.env['POSTGRES_PASSWORD'] ?? 'test',
          database: process.env['POSTGRES_DB'] ?? 'kysera_test',
          max: N // every contender gets to hold a connection concurrently
        })
      })
    })
    await sql`DROP TABLE IF EXISTS status_race_probe`.execute(db)
    await sql`CREATE TABLE status_race_probe (
      id int PRIMARY KEY,
      status text NOT NULL,
      winner_tag text
    )`.execute(db)
    await sql`INSERT INTO status_race_probe (id, status) VALUES (1, 'pending')`.execute(db)
  })

  afterEach(async () => {
    await sql`DROP TABLE IF EXISTS status_race_probe`.execute(db)
    await db.destroy()
  })

  it('exactly one of 20 parallel transitions wins; 19 get null', async () => {
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        atomicStatusTransition(db, 'status_race_probe', { id: 1 }, {
          fromStatus: 'pending',
          toStatus: 'processing',
          additionalUpdates: { winner_tag: `worker-${String(i)}` }
        })
      )
    )

    const winners = results.filter(result => result !== null)
    const losers = results.filter(result => result === null)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(N - 1)

    // The row reflects exactly the single winner's write
    const row = await db
      .selectFrom('status_race_probe')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('processing')
    expect(row.winner_tag).toBe(winners[0]?.winner_tag)
  })

  it('a second wave from the new status again has exactly one winner', async () => {
    await Promise.all(
      Array.from({ length: N }, () =>
        atomicStatusTransition(db, 'status_race_probe', { id: 1 }, {
          fromStatus: 'pending',
          toStatus: 'processing'
        })
      )
    )

    const secondWave = await Promise.all(
      Array.from({ length: N }, () =>
        atomicStatusTransition(db, 'status_race_probe', { id: 1 }, {
          fromStatus: 'processing',
          toStatus: 'completed'
        })
      )
    )

    expect(secondWave.filter(result => result !== null)).toHaveLength(1)
    const row = await db
      .selectFrom('status_race_probe')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('completed')
  })
  }
)

describe('atomicStatusTransition under N=20 contention (SQLite fallback)', () => {
  interface SqliteProbeDB {
    status_race_probe: {
      id: Generated<number>
      status: string
      winner_tag: string | null
    }
  }

  it('exactly one of 20 concurrent transitions wins on the serialized writer', async () => {
    const db = new Kysely<SqliteProbeDB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') })
    })
    await sql`CREATE TABLE status_race_probe (
      id integer PRIMARY KEY,
      status text NOT NULL,
      winner_tag text
    )`.execute(db)
    await sql`INSERT INTO status_race_probe (id, status) VALUES (1, 'pending')`.execute(db)

    try {
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          atomicStatusTransition(db, 'status_race_probe', { id: 1 }, {
            fromStatus: 'pending',
            toStatus: 'processing',
            additionalUpdates: { winner_tag: `worker-${String(i)}` }
          })
        )
      )

      expect(results.filter(result => result !== null)).toHaveLength(1)
      const row = await db
        .selectFrom('status_race_probe')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirstOrThrow()
      expect(row.status).toBe('processing')
    } finally {
      await db.destroy()
    }
  })
})
