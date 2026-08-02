/**
 * Targeted unit tests for runner paths not exercised by the main suites:
 * MigrationError serialization, non-Error failure values, status/reset
 * logging branches, defineMigrations metadata passthrough, and the
 * plugins-runner rollback error hook.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import {
  MigrationRunner,
  MigrationRunnerWithPlugins,
  MigrationError,
  createMigration,
  createMigrationWithMeta,
  defineMigrations,
  type Migration,
  type KyseraLogger
} from '../src/index.js'
import { safeDbDestroy, safeSqliteClose } from './helpers/cleanup.js'

function createTestLogger(logs: string[]): KyseraLogger {
  const record = (msg: string): void => {
    logs.push(msg)
  }
  return { trace: record, debug: record, info: record, warn: record, error: record, fatal: record }
}

describe('MigrationError.toJSON', () => {
  it('serializes migration context and the cause message', () => {
    const cause = new Error('column already exists')
    const error = new MigrationError('Migration 001 failed', '001_create', 'up', cause)

    const json = error.toJSON()

    expect(json['migrationName']).toBe('001_create')
    expect(json['operation']).toBe('up')
    expect(json['cause']).toBe('column already exists')
  })

  it('leaves cause undefined when none was attached', () => {
    const error = new MigrationError('Rollback of 001 failed', '001_create', 'down')

    expect(error.toJSON()['cause']).toBeUndefined()
    expect(error.operation).toBe('down')
  })
})

describe('MigrationRunner edge branches (sqlite)', () => {
  let db: Kysely<unknown>
  let database: Database.Database
  let logs: string[]

  beforeEach(() => {
    database = new Database(':memory:')
    db = new Kysely<unknown>({ dialect: new SqliteDialect({ database }) })
    logs = []
  })

  afterEach(async () => {
    await safeDbDestroy(db)
    safeSqliteClose(database)
  })

  it('reports non-Error throw values in failures (stopOnError: false)', async () => {
    const throwsString: Migration = {
      name: '001_bad',
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      up: () => Promise.reject('kaboom')
    }
    const runner = new MigrationRunner(db, [throwsString], {
      stopOnError: false,
      logger: createTestLogger(logs)
    })

    const result = await runner.up()

    expect(result.failed).toEqual(['001_bad'])
    expect(logs.some(l => l.includes('001_bad failed: kaboom'))).toBe(true)
  })

  it('wraps non-Error throw values without a cause when stopOnError is set', async () => {
    const throwsString: Migration = {
      name: '001_bad',
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      up: () => Promise.reject('kaboom')
    }
    const runner = new MigrationRunner(db, [throwsString])

    const error = await runner.up().then(
      () => null,
      e => e as MigrationError
    )

    expect(error).toBeInstanceOf(MigrationError)
    expect(error?.message).toContain('kaboom')
    expect(error?.cause).toBeUndefined()
  })

  it('warns when a rollback completes with failures (stopOnError: false)', async () => {
    const good = createMigration(
      '001_good',
      () => Promise.resolve(),
      () => Promise.resolve()
    )
    const badDown = createMigration(
      '002_bad_down',
      () => Promise.resolve(),
      () => Promise.reject(new Error('down exploded'))
    )
    const runner = new MigrationRunner(db, [good, badDown], {
      stopOnError: false,
      logger: createTestLogger(logs)
    })
    await runner.up()

    const result = await runner.down(2)

    expect(result.failed).toEqual(['002_bad_down'])
    expect(result.executed).toEqual(['001_good'])
    expect(logs.some(l => l.includes('Rollback completed with 1 failure(s)'))).toBe(true)
  })

  it('prints descriptions for executed and pending migrations in status()', async () => {
    const executedWithMeta = createMigrationWithMeta('001_users', {
      up: () => Promise.resolve(),
      description: 'Creates users'
    })
    const pendingBreaking = createMigrationWithMeta('002_posts', {
      up: () => Promise.resolve(),
      description: 'Adds posts',
      breaking: true
    })
    const pendingPlain = createMigration('003_plain', () => Promise.resolve())

    await new MigrationRunner(db, [executedWithMeta]).up()

    const runner = new MigrationRunner(db, [executedWithMeta, pendingBreaking, pendingPlain], {
      logger: createTestLogger(logs)
    })
    const status = await runner.status()

    expect(status).toEqual({
      executed: ['001_users'],
      pending: ['002_posts', '003_plain'],
      total: 3
    })
    expect(logs).toContain('  001_users - Creates users')
    expect(logs).toContain('  002_posts - Adds posts BREAKING')
    expect(logs).toContain('  003_plain')
  })

  it('reset() short-circuits when nothing was executed', async () => {
    const runner = new MigrationRunner(db, [createMigration('001', () => Promise.resolve())], {
      logger: createTestLogger(logs)
    })

    const result = await runner.reset()

    expect(result).toMatchObject({ executed: [], skipped: [], failed: [], dryRun: false })
    expect(logs).toContain('No migrations to reset')
  })

  it('executeMigration is a no-op for a down operation without a down function', async () => {
    class ExposedRunner extends MigrationRunner<unknown> {
      run(migration: Migration<unknown>, operation: 'up' | 'down'): Promise<void> {
        return this.executeMigration(migration, operation)
      }
    }
    const runner = new ExposedRunner(db, [])

    await expect(
      runner.run(createMigration('001_no_down', () => Promise.resolve()), 'down')
    ).resolves.toBeUndefined()
  })

  it('fires plugin onMigrationError hooks during rollback failures', async () => {
    const seen: { name: string; operation: string; message: string }[] = []
    const badDown = createMigration(
      '001_bad_down',
      () => Promise.resolve(),
      () => Promise.reject(new Error('down exploded'))
    )
    const runner = new MigrationRunnerWithPlugins(db, [badDown], {
      stopOnError: false,
      plugins: [
        {
          name: 'observer',
          version: '1.0.0',
          onMigrationError(migration, operation, error) {
            seen.push({
              name: migration.name,
              operation,
              message: error instanceof Error ? error.message : String(error)
            })
          }
        }
      ]
    })
    await runner.up()

    const result = await runner.down()

    expect(result.failed).toEqual(['001_bad_down'])
    expect(seen).toEqual([{ name: '001_bad_down', operation: 'down', message: 'down exploded' }])
  })
})

describe('defineMigrations metadata passthrough', () => {
  it('copies estimatedDuration and tags onto the migration', () => {
    const [migration] = defineMigrations({
      '001_indexed': {
        up: () => Promise.resolve(),
        estimatedDuration: 1500,
        tags: ['schema', 'index']
      }
    })

    expect(migration?.estimatedDuration).toBe(1500)
    expect(migration?.tags).toEqual(['schema', 'index'])
  })

  it('leaves optional metadata absent when not provided', () => {
    const [migration] = defineMigrations({ '001_plain': { up: () => Promise.resolve() } })

    expect(migration && 'estimatedDuration' in migration).toBe(false)
    expect(migration && 'tags' in migration).toBe(false)
    expect(migration && 'down' in migration).toBe(false)
  })
})
