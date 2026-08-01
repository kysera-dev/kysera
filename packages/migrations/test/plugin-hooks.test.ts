/**
 * MigrationRunnerWithPlugins lifecycle hooks + advisory-lock option surface +
 * schema parse helpers (previously uncovered paths).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import {
  createMigrationRunnerWithPlugins,
  createMigrationRunner,
  createLoggingPlugin,
  createMetricsPlugin,
  parseMigrationDefinition,
  safeParseMigrationDefinition,
  type Migration,
  type MigrationPlugin
} from '../src/index.js'
import { silentLogger } from '@kysera/core'

type DB = Record<string, Record<string, unknown>>

const mkdb = (): Kysely<DB> =>
  new Kysely<DB>({ dialect: new SqliteDialect({ database: new Database(':memory:') }) })

const tableMigration = (name: string, table: string): Migration<DB> => ({
  name,
  up: async db => {
    await db.schema.createTable(table).addColumn('id', 'integer', c => c.primaryKey()).execute()
  },
  down: async db => {
    await db.schema.dropTable(table).execute()
  }
})

describe('MigrationRunnerWithPlugins lifecycle hooks', () => {
  let db: Kysely<DB>
  let events: string[]

  const recordingPlugin = (): MigrationPlugin<DB> => ({
    name: 'recorder',
    version: '1.0.0',
    beforeMigration(migration, operation) {
      events.push(`before:${operation}:${migration.name}`)
    },
    afterMigration(migration, operation, duration) {
      expect(duration).toBeGreaterThanOrEqual(0)
      events.push(`after:${operation}:${migration.name}`)
    },
    onMigrationError(migration, operation) {
      events.push(`error:${operation}:${migration.name}`)
    }
  })

  beforeEach(() => {
    db = mkdb()
    events = []
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('fires before/after hooks around up() and down()', async () => {
    const runner = await createMigrationRunnerWithPlugins(
      db,
      [tableMigration('001_a', 'a'), tableMigration('002_b', 'b')],
      { plugins: [recordingPlugin()], logger: silentLogger }
    )

    await runner.up()
    expect(events).toEqual([
      'before:up:001_a',
      'after:up:001_a',
      'before:up:002_b',
      'after:up:002_b'
    ])

    events = []
    await runner.down(1)
    expect(events).toEqual(['before:down:002_b', 'after:down:002_b'])
  })

  it('fires onMigrationError when a migration fails', async () => {
    const failing: Migration<DB> = {
      name: '001_boom',
      up: async () => {
        throw new Error('boom')
      }
    }
    const runner = await createMigrationRunnerWithPlugins(db, [failing], {
      plugins: [recordingPlugin()],
      logger: silentLogger
    })

    await expect(runner.up()).rejects.toThrow(/001_boom failed/)
    expect(events).toEqual(['before:up:001_boom', 'error:up:001_boom'])
  })

  it('getPlugins returns a defensive copy', async () => {
    const plugin = recordingPlugin()
    const runner = await createMigrationRunnerWithPlugins(db, [], {
      plugins: [plugin],
      logger: silentLogger
    })
    const list = runner.getPlugins()
    expect(list).toEqual([plugin])
    list.pop()
    expect(runner.getPlugins()).toEqual([plugin])
  })

  it('built-in logging and metrics plugins observe migrations', async () => {
    const logs: string[] = []
    const logger = {
      ...silentLogger,
      info: (msg: string) => logs.push(msg)
    }
    const metrics = createMetricsPlugin<DB>()
    const runner = await createMigrationRunnerWithPlugins(db, [tableMigration('001_a', 'a')], {
      plugins: [createLoggingPlugin<DB>(logger), metrics],
      logger: silentLogger
    })

    await runner.up()

    expect(logs.some(l => l.includes('001_a'))).toBe(true)
    const collected = metrics.getMetrics()
    expect(collected.migrations).toHaveLength(1)
    expect(collected.migrations[0]).toMatchObject({
      name: '001_a',
      operation: 'up',
      success: true
    })
  })
})

describe('advisory lock option surface (sqlite no-op path)', () => {
  it('runs with advisoryLock enabled (default) on sqlite', async () => {
    const db = mkdb()
    try {
      const runner = createMigrationRunner(db, [tableMigration('001_a', 'a')], {
        logger: silentLogger
      })
      const result = await runner.up()
      expect(result.executed).toEqual(['001_a'])
    } finally {
      await db.destroy()
    }
  })

  it('runs with advisoryLock disabled', async () => {
    const db = mkdb()
    try {
      const runner = createMigrationRunner(db, [tableMigration('001_a', 'a')], {
        logger: silentLogger,
        advisoryLock: false
      })
      const result = await runner.up()
      expect(result.executed).toEqual(['001_a'])
    } finally {
      await db.destroy()
    }
  })

  it('rejects invalid lockTimeoutMs', () => {
    const db = mkdb()
    expect(() =>
      createMigrationRunner(db, [], { lockTimeoutMs: -5 })
    ).toThrow(/Invalid migration runner options/)
  })
})

describe('schema parse helpers', () => {
  it('parseMigrationDefinition applies defaults', () => {
    const parsed = parseMigrationDefinition({ name: 'x' })
    expect(parsed).toMatchObject({ name: 'x', breaking: false, tags: [] })
  })

  it('parseMigrationDefinition throws on invalid input', () => {
    expect(() => parseMigrationDefinition({ name: '' })).toThrow()
  })

  it('safeParseMigrationDefinition returns success/failure objects', () => {
    expect(safeParseMigrationDefinition({ name: 'ok' }).success).toBe(true)
    expect(safeParseMigrationDefinition({ name: '' }).success).toBe(false)
    expect(safeParseMigrationDefinition(null).success).toBe(false)
  })
})
