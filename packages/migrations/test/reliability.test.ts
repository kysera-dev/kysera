import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect, sql } from 'kysely'
import {
  MigrationRunner,
  MigrationChecksumError,
  MigrationHookError,
  createMigrationHistory,
  createMigrationRunnerWithPlugins,
  type Migration,
  type MigrationHistory
} from '../src/index.js'

describe('migration reliability contract', () => {
  let db: Kysely<unknown>
  beforeEach(() => {
    db = new Kysely({ dialect: new SqliteDialect({ database: new Database(':memory:') }) })
  })
  afterEach(async () => {
    await db.destroy()
  })
  const migration: Migration = {
    name: '001_widgets',
    checksum: 'a'.repeat(64),
    up: async tx => {
      await sql`create table widgets (id integer primary key)`.execute(tx)
    },
    down: async tx => {
      await sql`drop table widgets`.execute(tx)
    }
  }
  const tables = async () => (await db.introspection.getTables()).map(t => t.name).sort()

  it('rolls back the schema, history and checksum when the history write fails, then recovers on retry', async () => {
    const history = createMigrationHistory({ checksumTable: 'migration_checksums' })
    let fail = true
    const fault: MigrationHistory = {
      ...history,
      async insert(tx, record) {
        await history.insert(tx, record)
        if (fail) throw new Error('injected journal failure')
      }
    }
    const runner = new MigrationRunner(db, [migration], { history: fault, useTransactions: true })
    await expect(runner.up()).rejects.toThrow('injected journal failure')
    expect(await tables()).not.toContain('widgets')
    expect(await history.read(db)).toEqual([])
    expect((await sql`select * from migration_checksums`.execute(db)).rows).toEqual([])
    fail = false
    expect((await runner.up()).executed).toEqual([migration.name])
    expect((await runner.up()).skipped).toEqual([migration.name])
  })

  it('rolls back down DDL when removal from the journal fails', async () => {
    const history = createMigrationHistory({ checksumColumn: 'checksum' })
    await new MigrationRunner(db, [migration], { history, useTransactions: true }).up()
    const fault: MigrationHistory = {
      ...history,
      async remove(tx, name) {
        await history.remove(tx, name)
        throw new Error('injected delete failure')
      }
    }
    await expect(
      new MigrationRunner(db, [migration], { history: fault, useTransactions: true }).down()
    ).rejects.toThrow('injected delete failure')
    expect(await tables()).toContain('widgets')
    expect((await history.read(db)).map(r => r.name)).toEqual([migration.name])
  })

  it('keeps status, inspect and dry run strictly read-only on an empty database', async () => {
    const runner = new MigrationRunner(db, [migration], { dryRun: true })
    expect((await runner.status()).pending).toEqual([migration.name])
    expect((await runner.inspect()).executed).toEqual([])
    expect((await runner.up()).executed).toEqual([migration.name])
    await runner.reset()
    expect(await tables()).toEqual([])
  })

  it('preserves integer version journals without introducing another migration ledger', async () => {
    await sql`create table schema_migrations (version integer primary key, applied_at timestamp default CURRENT_TIMESTAMP)`.execute(
      db
    )
    await sql`insert into schema_migrations (version) values (1)`.execute(db)
    const history = createMigrationHistory({
      tableName: 'schema_migrations',
      keyColumn: 'version',
      keyType: 'integer',
      executedAtColumn: 'applied_at'
    })
    const runner = new MigrationRunner(
      db,
      [
        { ...migration, name: '1' },
        { ...migration, name: '2' }
      ],
      { history, useTransactions: true }
    )
    expect((await runner.up()).executed).toEqual(['2'])
    expect((await runner.up()).skipped).toEqual(['1', '2'])
    expect(await tables()).toEqual(['schema_migrations', 'widgets'])
  })

  it('refuses drift in both directions and only adopts checksums on explicit request', async () => {
    const history = createMigrationHistory({ checksumColumn: 'checksum' })
    await history.setup(db)
    await migration.up(db)
    await history.insert(db, { name: migration.name, checksum: null, executedAt: null })
    const runner = new MigrationRunner(db, [migration], { history, useTransactions: true })
    await runner.up()
    expect((await runner.inspect()).unknownChecksums).toEqual([migration.name])
    expect(await runner.adoptChecksums()).toEqual([migration.name])
    const changed = new MigrationRunner(db, [{ ...migration, checksum: 'b'.repeat(64) }], {
      history,
      useTransactions: true
    })
    await expect(changed.up()).rejects.toThrow(MigrationChecksumError)
    await expect(changed.down()).rejects.toThrow(MigrationChecksumError)
    expect(await changed.adoptChecksums()).toEqual([])
    expect((await changed.inspect()).drift).toHaveLength(1)
  })

  it('rejects concurrent operations on one runner without bypassing its lock', async () => {
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>(resolve => {
      started = resolve
    })
    const barrier = new Promise<void>(resolve => {
      release = resolve
    })
    let calls = 0
    const runner = new MigrationRunner(
      db,
      [
        {
          name: '001',
          up: async () => {
            calls++
            started()
            await barrier
          }
        }
      ],
      { useTransactions: true }
    )
    const first = runner.up()
    await entered
    await expect(runner.up()).rejects.toThrow('active operation')
    release()
    await first
    expect(calls).toBe(1)
  })

  it('uses explicit execution order when names and timestamps cannot encode it', async () => {
    const history = createMigrationHistory({ orderColumn: 'execution_order' })
    const runner = new MigrationRunner(
      db,
      [
        { ...migration, name: 'z_first' },
        { name: 'a_second', up: async () => {}, down: async () => {} }
      ],
      { history, useTransactions: true }
    )
    await runner.up()
    expect((await runner.down()).executed).toEqual(['a_second'])
    expect(await tables()).toContain('widgets')
  })

  it('refuses an ordering option absent from an existing journal without altering it', async () => {
    const original = createMigrationHistory()
    await original.setup(db)
    const history = createMigrationHistory({ orderColumn: 'execution_order' })
    await expect(history.setup(db)).rejects.toThrow('separately reviewed schema change')
    const columns = (await db.introspection.getTables())
      .find(t => t.name === 'migrations')!
      .columns.map(c => c.name)
    expect(columns).toEqual(['name', 'executed_at'])
  })

  it('validates rollback counts and treats zero as no rollback', async () => {
    const runner = new MigrationRunner(db, [migration], { useTransactions: true })
    await runner.up()
    expect((await runner.down(0)).executed).toEqual([])
    for (const count of [-1, 0.5, Infinity, NaN])
      await expect(runner.down(count)).rejects.toThrow('nonnegative safe integer')
    expect(await tables()).toContain('widgets')
  })

  it('runs hooks for upTo and reset, and identifies failures after commit', async () => {
    const events: string[] = []
    const runner = await createMigrationRunnerWithPlugins(db, [migration], {
      useTransactions: true,
      plugins: [
        {
          name: 'recorder',
          afterMigration: (m, op) => {
            events.push(`${op}:${m.name}`)
          }
        }
      ]
    })
    await runner.upTo(migration.name)
    await runner.reset()
    expect(events).toEqual([`up:${migration.name}`, `down:${migration.name}`])
    const faulty = await createMigrationRunnerWithPlugins(db, [migration], {
      useTransactions: true,
      plugins: [
        {
          name: 'broken-observer',
          afterMigration: () => {
            throw new Error('observer unavailable')
          }
        }
      ]
    })
    await expect(faulty.up()).rejects.toThrow(MigrationHookError)
    expect((await faulty.status()).executed).toEqual([migration.name])
  })
})
