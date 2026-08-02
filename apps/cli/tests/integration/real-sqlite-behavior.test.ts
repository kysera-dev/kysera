/**
 * Behavior tests against a REAL better-sqlite3 database (no mocks).
 *
 * Every surface here used to "work" only against test doubles: the audit
 * commands queried legacy columns, db tables showed zero stats, dumps could
 * not be restored, and query analyze missed modern SQLite scan output.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Kysely, SqliteDialect } from 'kysely'
import SqliteDatabase from 'better-sqlite3'

import { tablesCommand } from '../../src/commands/db/tables.js'
import { dumpCommand } from '../../src/commands/db/dump.js'
import { restoreCommand } from '../../src/commands/db/restore.js'
import { analyzeCommand } from '../../src/commands/query/analyze.js'
import { profileCommand } from '../../src/commands/debug/profile.js'
import { logsCommand } from '../../src/commands/audit/logs.js'
import { historyCommand } from '../../src/commands/audit/history.js'
import { statsCommand } from '../../src/commands/audit/stats.js'
import { cleanupCommand } from '../../src/commands/audit/cleanup.js'
import { testSetupCommand } from '../../src/commands/test/setup.js'
import { testSeedCommand } from '../../src/commands/test/seed.js'
import { testTeardownCommand } from '../../src/commands/test/teardown.js'
import type { Database } from '../../src/utils/database.js'

let tmp: string
let dbPath: string
let configPath: string
let originalCwd: string

function openDb(path: string): Kysely<Database> {
  return new Kysely<Database>({ dialect: new SqliteDialect({ database: new SqliteDatabase(path) }) })
}

async function createAuditTable(db: Kysely<Database>): Promise<void> {
  // Column-for-column the portable schema @kysera/audit creates on first use
  await db.schema
    .createTable('audit_logs')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('table_name', 'text', col => col.notNull())
    .addColumn('entity_id', 'text', col => col.notNull())
    .addColumn('operation', 'text', col => col.notNull())
    .addColumn('old_values', 'text')
    .addColumn('new_values', 'text')
    .addColumn('changed_by', 'text')
    .addColumn('changed_at', 'text', col => col.notNull())
    .addColumn('metadata', 'text')
    .execute()
}

function jsonFromLogs(spy: ReturnType<typeof vi.spyOn>): unknown {
  for (const call of spy.mock.calls) {
    const text = String(call[0])
    if (text.startsWith('{') || text.startsWith('[')) {
      return JSON.parse(text)
    }
  }
  throw new Error('no JSON output captured')
}

beforeAll(async () => {
  originalCwd = process.cwd()
  tmp = mkdtempSync(join(tmpdir(), 'kysera-cli-behavior-'))
  dbPath = join(tmp, 'app.db')
  configPath = join(tmp, 'kysera.config.json')
  writeFileSync(
    configPath,
    JSON.stringify({ database: { dialect: 'sqlite', database: dbPath } })
  )

  const db = openDb(dbPath)
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull())
    .execute()
  await db
    .insertInto('users')
    .values([
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob' },
      { id: 3, name: 'carol' }
    ])
    .execute()

  await createAuditTable(db)
  const now = new Date().toISOString()
  const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  await db
    .insertInto('audit_logs')
    .values([
      {
        table_name: 'users',
        entity_id: '1',
        operation: 'INSERT',
        old_values: null,
        new_values: JSON.stringify({ id: 1, name: 'alice' }),
        changed_by: 'seed-user',
        changed_at: now,
        metadata: null
      },
      {
        table_name: 'users',
        entity_id: '1',
        operation: 'UPDATE',
        old_values: JSON.stringify({ name: 'alicia' }),
        new_values: JSON.stringify({ name: 'alice' }),
        changed_by: 'seed-user',
        changed_at: now,
        metadata: null
      },
      {
        table_name: 'users',
        entity_id: '99',
        operation: 'DELETE',
        old_values: JSON.stringify({ id: 99, name: 'gone' }),
        new_values: null,
        changed_by: null,
        changed_at: old,
        metadata: null
      }
    ])
    .execute()
  await db.destroy()
})

afterAll(() => {
  process.chdir(originalCwd)
  rmSync(tmp, { recursive: true, force: true })
})

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  process.chdir(tmp)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  process.chdir(originalCwd)
})

describe('db tables against a real database', () => {
  it('reports real row counts and non-zero size estimates', async () => {
    await tablesCommand().parseAsync(['node', 'x', '--json', '--config', configPath])

    const tables = jsonFromLogs(logSpy) as { name: string; rows: number; size: number }[]
    const users = tables.find(t => t.name === 'users')
    expect(users).toBeDefined()
    expect(users!.rows).toBe(3)
    expect(users!.size).toBeGreaterThan(0)
  })
})

describe('audit commands against the plugin schema', () => {
  it('audit logs reads operation/changed_by/changed_at rows', async () => {
    await logsCommand().parseAsync(['node', 'x', '--json', '--config', configPath])

    const logs = jsonFromLogs(logSpy) as {
      operation: string
      changed_by: string | null
      changed_at: string
    }[]
    expect(logs.length).toBe(3)
    expect(logs.map(l => l.operation).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE'])
  })

  it('audit logs filters by --user and --action through plugin columns', async () => {
    await logsCommand().parseAsync([
      'node',
      'x',
      '--json',
      '--user',
      'seed-user',
      '--action',
      'UPDATE',
      '--config',
      configPath
    ])

    const logs = jsonFromLogs(logSpy) as { operation: string; changed_by: string }[]
    expect(logs.length).toBe(1)
    expect(logs[0].operation).toBe('UPDATE')
    expect(logs[0].changed_by).toBe('seed-user')
  })

  it('audit history renders a timeline for an entity', async () => {
    await historyCommand().parseAsync(['node', 'x', 'users', '1', '--json', '--config', configPath])

    const history = jsonFromLogs(logSpy) as { operation: string }[]
    expect(history.length).toBe(2)
    expect(history.map(h => h.operation)).toContain('INSERT')
  })

  it('audit stats aggregates by operation within the period', async () => {
    await statsCommand().parseAsync([
      'node',
      'x',
      '--period',
      '1d',
      '--format',
      'json',
      '--config',
      configPath
    ])

    const stats = jsonFromLogs(logSpy) as {
      totalCount: number
      actionStats: { operation: string; count: unknown }[]
    }
    // the DELETE row is 90 days old and must fall outside the 1d window
    expect(stats.totalCount).toBe(2)
    expect(stats.actionStats.map(s => s.operation).sort()).toEqual(['INSERT', 'UPDATE'])
  })

  it('audit cleanup deletes only rows older than the cutoff', async () => {
    await cleanupCommand().parseAsync([
      'node',
      'x',
      '--older-than',
      '30d',
      '--force',
      '--config',
      configPath
    ])

    const db = openDb(dbPath)
    try {
      const rows = await db.selectFrom('audit_logs').selectAll().execute()
      expect(rows.length).toBe(2)
      expect(rows.every(r => r['operation'] !== 'DELETE')).toBe(true)
    } finally {
      await db.destroy()
    }
  })
})

describe('dump and restore round-trip', () => {
  it('produces a dump without CASCADE for sqlite and restores it into a fresh database', async () => {
    const dumpFile = join(tmp, 'roundtrip.sql')
    await dumpCommand().parseAsync([
      'node',
      'x',
      '--tables',
      'users',
      '-o',
      dumpFile,
      '--config',
      configPath
    ])

    const dumpContent = readFileSync(dumpFile, 'utf-8')
    expect(dumpContent).toContain('DROP TABLE IF EXISTS "users";')
    expect(dumpContent).not.toContain('CASCADE')
    expect(dumpContent).not.toContain('[object Object]')
    expect(dumpContent).toContain(`INSERT INTO "users"`)

    // Restore into a second database via a second config
    const dbPath2 = join(tmp, 'restored.db')
    const configPath2 = join(tmp, 'kysera.restore.config.json')
    writeFileSync(
      configPath2,
      JSON.stringify({ database: { dialect: 'sqlite', database: dbPath2 } })
    )

    await restoreCommand().parseAsync(['node', 'x', dumpFile, '--force', '--config', configPath2])

    const restored = openDb(dbPath2)
    try {
      const rows = await restored.selectFrom('users').selectAll().execute()
      expect(rows.length).toBe(3)
      expect(rows.map(r => r['name']).sort()).toEqual(['alice', 'bob', 'carol'])
    } finally {
      await restored.destroy()
    }
  })
})

describe('query analyze against real sqlite', () => {
  it('detects full table scans in the modern SCAN <table> format', async () => {
    await analyzeCommand().parseAsync([
      'node',
      'x',
      '-q',
      "SELECT * FROM users WHERE name = 'alice'",
      '--format',
      'json',
      '--config',
      configPath
    ])

    const analysis = jsonFromLogs(logSpy) as {
      warnings: string[]
      missingIndexes: string[]
      rowsReturned?: number
    }
    expect(analysis.rowsReturned).toBe(1)
    expect(analysis.warnings.some(w => w.includes('Full table scan on users'))).toBe(true)
    expect(analysis.missingIndexes.length).toBeGreaterThan(0)
  })
})

describe('debug profile against real sqlite', () => {
  it('profiles a raw query end to end', async () => {
    await profileCommand().parseAsync([
      'node',
      'x',
      '-q',
      'SELECT COUNT(*) AS n FROM users',
      '-i',
      '3',
      '-w',
      '1',
      '--json',
      '--config',
      configPath
    ])

    const result = jsonFromLogs(logSpy) as {
      main: { iterations: number; timings: number[]; rowCount?: number }
    }
    expect(result.main.iterations).toBe(3)
    expect(result.main.timings.length).toBe(3)
    expect(result.main.rowCount).toBe(1)
  })
})

describe('test seed against a real schema', () => {
  it('discovers columns via PRAGMA and inserts faker rows (uppercase SQLite types)', async () => {
    const db = openDb(dbPath)
    try {
      await db.schema
        .createTable('seed_targets')
        .addColumn('id', 'integer', col => col.primaryKey())
        .addColumn('title', 'text', col => col.notNull())
        .addColumn('amount', 'integer', col => col.notNull())
        .execute()
    } finally {
      await db.destroy()
    }

    await testSeedCommand().parseAsync([
      'node',
      'x',
      '--tables',
      'seed_targets',
      '--count',
      '4',
      '--seed',
      '7',
      '--config',
      configPath
    ])

    const verify = openDb(dbPath)
    try {
      const rows = await verify.selectFrom('seed_targets').selectAll().execute()
      expect(rows.length).toBe(4)
      // INTEGER (uppercase) columns must receive numbers, not lorem words
      expect(rows.every(r => typeof r['amount'] === 'number' || typeof r['amount'] === 'bigint')).toBe(
        true
      )
      expect(rows.every(r => typeof r['title'] === 'string' && r['title'] !== '')).toBe(true)
    } finally {
      await verify.destroy()
    }
  })
})

describe('test setup/teardown lifecycle on sqlite', () => {
  it('creates, then tears down, a real test database file', async () => {
    const lifecycleDb = join(tmp, 'lifecycle_test.db')

    await testSetupCommand().parseAsync([
      'node',
      'x',
      '--database',
      lifecycleDb,
      '--config',
      configPath
    ])
    expect(existsSync(lifecycleDb)).toBe(true)
    expect(existsSync(join(tmp, 'tests', 'test-config.ts'))).toBe(true)

    await testTeardownCommand().parseAsync([
      'node',
      'x',
      '--database',
      lifecycleDb,
      '--force',
      '--config',
      configPath
    ])
    expect(existsSync(lifecycleDb)).toBe(false)
  })
})
