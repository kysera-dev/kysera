/**
 * Unit tests for the advisory-lock behavior documented on
 * MigrationRunnerOptions.advisoryLock: PostgreSQL serializes via
 * pg_try_advisory_lock (polled), MySQL via GET_LOCK, dry runs and
 * advisoryLock:false skip locking entirely.
 *
 * Uses the fake-kysely driver (real query compilers, canned rows) so the
 * lock/unlock SQL and its connection-scoped ordering can be asserted without
 * docker. The live PostgreSQL behavior is additionally verified by
 * test/advisory-lock.integration.test.ts (pnpm test:multi-db).
 */

import { describe, it, expect } from 'vitest'
import {
  MigrationRunner,
  MigrationLockError,
  createMigration,
  type KyseraLogger
} from '../src/index.js'
import { createFakeDb, type ExecutedQuery } from './helpers/fake-kysely.js'

const noopMigration = createMigration('001_noop', () => Promise.resolve())

function capturingLogger(logs: { level: string; message: string }[]): KyseraLogger {
  const record = (level: string) => (message: string) => logs.push({ level, message })
  return {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal')
  }
}

describe('PostgreSQL advisory lock (unit)', () => {
  it('acquires pg_try_advisory_lock before migrating and unlocks afterwards', async () => {
    const { db, executed } = createFakeDb('postgres', query =>
      query.sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : []
    )

    const runner = new MigrationRunner(db, [noopMigration])
    const result = await runner.up()

    expect(result.executed).toEqual(['001_noop'])
    expect(executed[0]?.sql).toContain('pg_try_advisory_lock')
    expect(executed.at(-1)?.sql).toContain('pg_advisory_unlock')
    // All bookkeeping happens strictly between lock and unlock
    const insertIndex = executed.findIndex(q => q.sql.startsWith('insert into'))
    expect(insertIndex).toBeGreaterThan(0)
    expect(insertIndex).toBeLessThan(executed.length - 1)
  })

  it('polls until the lock becomes available', async () => {
    let attempts = 0
    const { db, executed } = createFakeDb('postgres', query => {
      if (query.sql.includes('pg_try_advisory_lock')) {
        attempts += 1
        return [{ locked: attempts >= 2 }]
      }
      return []
    })

    const runner = new MigrationRunner(db, [noopMigration], { lockTimeoutMs: 10_000 })
    const result = await runner.up()

    expect(result.executed).toEqual(['001_noop'])
    expect(attempts).toBe(2)
    expect(executed.filter(q => q.sql.includes('pg_try_advisory_lock'))).toHaveLength(2)
  })

  it('throws MigrationLockError when the lock is not acquired within lockTimeoutMs', async () => {
    const { db } = createFakeDb('postgres', query =>
      query.sql.includes('pg_try_advisory_lock') ? [{ locked: false }] : []
    )

    const runner = new MigrationRunner(db, [noopMigration], { lockTimeoutMs: 1 })

    await expect(runner.up()).rejects.toThrow(MigrationLockError)
  })

  it('warns but does not fail the run when releasing the lock fails', async () => {
    const logs: { level: string; message: string }[] = []
    const { db } = createFakeDb('postgres', query => {
      if (query.sql.includes('pg_try_advisory_lock')) return [{ locked: true }]
      if (query.sql.includes('pg_advisory_unlock')) throw new Error('connection reset')
      return []
    })

    const runner = new MigrationRunner(db, [noopMigration], { logger: capturingLogger(logs) })
    const result = await runner.up()

    expect(result.executed).toEqual(['001_noop'])
    expect(
      logs.some(
        l => l.level === 'warn' && l.message.includes('Failed to release migration advisory lock')
      )
    ).toBe(true)
  })

  it('skips locking for dry runs and when advisoryLock is disabled', async () => {
    const lockQueries = (executed: ExecutedQuery[]): ExecutedQuery[] =>
      executed.filter(q => q.sql.includes('advisory'))

    const dry = createFakeDb('postgres')
    await new MigrationRunner(dry.db, [noopMigration], { dryRun: true }).up()
    expect(lockQueries(dry.executed)).toHaveLength(0)

    const disabled = createFakeDb('postgres')
    await new MigrationRunner(disabled.db, [noopMigration], { advisoryLock: false }).up()
    expect(lockQueries(disabled.executed)).toHaveLength(0)
  })
})

describe('MySQL advisory lock (unit)', () => {
  it('acquires GET_LOCK with the shared lock name and releases it', async () => {
    const { db, executed } = createFakeDb('mysql', query =>
      query.sql.includes('get_lock') ? [{ locked: 1 }] : []
    )

    const runner = new MigrationRunner(db, [noopMigration])
    const result = await runner.up()

    expect(result.executed).toEqual(['001_noop'])
    expect(executed[0]?.sql).toContain('get_lock')
    expect(executed[0]?.parameters).toEqual(['kysera_migrations'])
    expect(executed.at(-1)?.sql).toContain('release_lock')
    expect(executed.at(-1)?.parameters).toEqual(['kysera_migrations'])
  })

  it('converts lockTimeoutMs to whole seconds for GET_LOCK (minimum 1s, rounded up)', async () => {
    const { db, executed } = createFakeDb('mysql', query =>
      query.sql.includes('get_lock') ? [{ locked: 1 }] : []
    )

    await new MigrationRunner(db, [noopMigration], { lockTimeoutMs: 1500 }).up()

    expect(executed[0]?.sql).toContain('get_lock(?, 2)')
  })

  it('throws MigrationLockError when GET_LOCK times out or returns no row', async () => {
    const denied = createFakeDb('mysql', query =>
      query.sql.includes('get_lock') ? [{ locked: 0 }] : []
    )
    await expect(
      new MigrationRunner(denied.db, [noopMigration], { lockTimeoutMs: 1000 }).up()
    ).rejects.toThrow(MigrationLockError)

    const empty = createFakeDb('mysql', query => (query.sql.includes('get_lock') ? [] : []))
    await expect(new MigrationRunner(empty.db, [noopMigration]).up()).rejects.toThrow(
      MigrationLockError
    )
  })
})

describe('MigrationLockError', () => {
  it('describes the timeout and the escape hatches', () => {
    const error = new MigrationLockError(5000)

    expect(error.name).toBe('MigrationLockError')
    expect(error.message).toContain('5000ms')
    expect(error.message).toContain('advisoryLock: false')
  })
})
