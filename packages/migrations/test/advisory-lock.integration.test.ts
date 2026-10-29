/**
 * Advisory-lock correctness against real PostgreSQL (TEST_POSTGRES=true).
 *
 * Two concurrent runners sharing one database must execute each migration
 * exactly once — without the lock both would see the same pending list.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { createMigrationRunner, MigrationLockError, type Migration } from '../src/index.js'
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

const connectionErrors: Error[] = []

const connect = async (): Promise<Kysely<DB>> => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({
    host: process.env['POSTGRES_HOST'] ?? 'localhost',
    port: Number(process.env['POSTGRES_PORT'] ?? 5432),
    user: process.env['POSTGRES_USER'] ?? 'test',
    password: process.env['POSTGRES_PASSWORD'] ?? 'test',
    database: process.env['POSTGRES_DB'] ?? 'kysera_test',
    max: 1,
    connectionTimeoutMillis: 2000
  })
  // The pool owner must observe asynchronous driver errors as well as query
  // rejections. The core library receives Kysely, not a pg event emitter.
  pool.on('error', error => {
    connectionErrors.push(error)
  })
  pool.on('connect', client => {
    client.on('error', error => {
      connectionErrors.push(error)
    })
  })
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })
}

describe.skipIf(!POSTGRES)(
  `advisory lock on real PostgreSQL (${explainAvailability(dbs.postgres)})`,
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

    beforeEach(async () => {
      dbA = await connect()
      dbB = await connect()
      insertCount = 0
      connectionErrors.length = 0
      await sql`DROP TABLE IF EXISTS lock_probe`.execute(dbA)
      await sql`DROP TABLE IF EXISTS migrations`.execute(dbA)
      await sql`CREATE TABLE lock_probe (id serial primary key, marker text)`.execute(dbA)
    })

    afterEach(async () => {
      await sql`DROP TABLE IF EXISTS lock_probe`.execute(dbA)
      await sql`DROP TABLE IF EXISTS migrations`.execute(dbA)
      await dbA.destroy()
      await dbB.destroy()
      expect(connectionErrors).toEqual([])
    })

    it('resolves a history table through search_path, including fallback to public', async () => {
      await sql`create schema migration_history_search_path`.execute(dbA)
      try {
        await sql`create table public.migrations (name text primary key, executed_at timestamp not null default now())`.execute(
          dbA
        )
        await sql`insert into public.migrations (name) values ('public_marker')`.execute(dbA)
        await sql`create table migration_history_search_path.migrations (like public.migrations including all)`.execute(
          dbA
        )
        await sql`insert into migration_history_search_path.migrations (name) values ('tenant_marker')`.execute(
          dbA
        )
        await sql`set search_path to migration_history_search_path, public`.execute(dbA)
        const runner = createMigrationRunner(dbA, [
          {
            name: 'tenant_marker',
            up: async () => {
              throw new Error('tenant migration must not execute twice')
            }
          }
        ])
        expect((await runner.status()).executed).toEqual(['tenant_marker'])
        expect((await runner.up()).executed).toEqual([])
        await sql`drop table migration_history_search_path.migrations`.execute(dbA)
        // A table further down search_path must also match normal SQL resolution.
        expect((await runner.status()).executed).toEqual(['public_marker'])
      } finally {
        await sql`reset search_path`.execute(dbA)
        await sql`drop schema migration_history_search_path cascade`.execute(dbA)
      }
    })

    it('two concurrent runners execute each migration exactly once', async () => {
      const runnerA = createMigrationRunner(dbA, migrations())
      const runnerB = createMigrationRunner(dbB, migrations())

      const [resultA, resultB] = await Promise.all([runnerA.up(), runnerB.up()])

      // One runner executed, the other saw it as already done (or vice versa)
      const executedTotal = resultA.executed.length + resultB.executed.length
      expect(executedTotal).toBe(1)

      const rows = await sql<{
        count: string
      }>`SELECT count(*)::text as count FROM lock_probe`.execute(dbA)
      expect(rows.rows[0]?.count).toBe('1')
      expect(insertCount).toBe(1)
    })

    it('times out cleanly with MigrationLockError while another session holds the lock', async () => {
      // Shared app-wide key used by every Kysera migration runner
      const MIGRATION_LOCK_KEY = 8982422971203

      let openGate!: () => void
      const gate = new Promise<void>(resolve => {
        openGate = resolve
      })
      let signalReady!: () => void
      const ready = new Promise<void>(resolve => {
        signalReady = resolve
      })

      // Foreign lock holder pinned to one session on dbB
      const holder = dbB.connection().execute(async conn => {
        await sql`select pg_advisory_lock(${sql.lit(MIGRATION_LOCK_KEY)})`.execute(conn)
        signalReady()
        await gate
        await sql`select pg_advisory_unlock(${sql.lit(MIGRATION_LOCK_KEY)})`.execute(conn)
      })
      await ready

      const runner = createMigrationRunner(dbA, migrations(), { lockTimeoutMs: 800 })
      const failure = await runner.up().catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(MigrationLockError)
      // The lock is acquired before any bookkeeping — nothing ran, nothing written
      expect(insertCount).toBe(0)

      openGate()
      await holder

      // Once the lock is free the same migrations apply cleanly
      const retry = await createMigrationRunner(dbA, migrations()).up()
      expect(retry.executed).toEqual(['001_lock_probe'])
      expect(insertCount).toBe(1)
    })

    it('uses one connection for transactional work and recovers after its backend is terminated', async () => {
      let terminate = true
      const migration: Migration<DB> = {
        name: '001_connection_loss',
        up: async db => {
          await sql`insert into lock_probe (marker) values ('committed once')`.execute(db)
          if (terminate) {
            terminate = false
            const identity = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db)
            await sql`select pg_terminate_backend(${identity.rows[0]!.pid})`.execute(dbB)
            await sql`select 1`.execute(db)
          }
        }
      }
      const runner = createMigrationRunner(dbA, [migration], { useTransactions: true })
      await expect(runner.up()).rejects.toThrow()
      expect((await sql`select * from lock_probe`.execute(dbA)).rows).toEqual([])
      expect((await runner.status()).executed).toEqual([])
      expect((await runner.up()).executed).toEqual([migration.name])
      expect((await sql`select * from lock_probe`.execute(dbA)).rows).toHaveLength(1)
      expect(connectionErrors.every(error => /terminat/i.test(error.message))).toBe(true)
      connectionErrors.length = 0
    })

    it('advisoryLock: false loses the exactly-once guarantee (documents the hazard)', async () => {
      // Not asserting double-execution (it's a race), just that the option is
      // accepted and a single unlocked runner still works end-to-end
      const runner = createMigrationRunner(dbA, migrations(), { advisoryLock: false })
      const result = await runner.up()
      expect(result.executed).toEqual(['001_lock_probe'])
    })
  }
)
