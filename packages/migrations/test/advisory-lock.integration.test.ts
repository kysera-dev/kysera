/**
 * Advisory-lock correctness against real PostgreSQL (TEST_POSTGRES=true).
 *
 * Two concurrent runners sharing one database must execute each migration
 * exactly once — without the lock both would see the same pending list.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { createMigrationRunner, type Migration } from '../src/index.js'

const POSTGRES = process.env['TEST_POSTGRES'] === 'true'

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

describe.skipIf(!POSTGRES)('advisory lock on real PostgreSQL', () => {
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
    await sql`DROP TABLE IF EXISTS lock_probe`.execute(dbA)
    await sql`DROP TABLE IF EXISTS migrations`.execute(dbA)
    await sql`CREATE TABLE lock_probe (id serial primary key, marker text)`.execute(dbA)
  })

  afterEach(async () => {
    await sql`DROP TABLE IF EXISTS lock_probe`.execute(dbA)
    await sql`DROP TABLE IF EXISTS migrations`.execute(dbA)
    await dbA.destroy()
    await dbB.destroy()
  })

  it('two concurrent runners execute each migration exactly once', async () => {
    const runnerA = createMigrationRunner(dbA, migrations())
    const runnerB = createMigrationRunner(dbB, migrations())

    const [resultA, resultB] = await Promise.all([runnerA.up(), runnerB.up()])

    // One runner executed, the other saw it as already done (or vice versa)
    const executedTotal = resultA.executed.length + resultB.executed.length
    expect(executedTotal).toBe(1)

    const rows = await sql<{ count: string }>`SELECT count(*)::text as count FROM lock_probe`.execute(dbA)
    expect(rows.rows[0]?.count).toBe('1')
    expect(insertCount).toBe(1)
  })

  it('advisoryLock: false loses the exactly-once guarantee (documents the hazard)', async () => {
    // Not asserting double-execution (it's a race), just that the option is
    // accepted and a single unlocked runner still works end-to-end
    const runner = createMigrationRunner(dbA, migrations(), { advisoryLock: false })
    const result = await runner.up()
    expect(result.executed).toEqual(['001_lock_probe'])
  })
})
