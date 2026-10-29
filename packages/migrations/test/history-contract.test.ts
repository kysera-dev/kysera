import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Kysely, SqliteDialect, sql } from 'kysely'
import Database from 'better-sqlite3'
import {
  createMigrationHistory,
  MigrationRunner,
  MigrationLockError,
  createMigrationRunnerWithPlugins,
  createMigrationWithMeta,
  defineMigrations,
  type Migration
} from '../src/index.js'

describe('history adoption and failure contracts', () => {
  let db: Kysely<unknown>
  beforeEach(() => {
    db = new Kysely({ dialect: new SqliteDialect({ database: new Database(':memory:') }) })
  })
  afterEach(async () => {
    await db.destroy()
  })
  const migration: Migration = {
    name: '001',
    checksum: 'a'.repeat(64),
    up: async () => {},
    down: async () => {}
  }

  it('baselines known migrations atomically, skips duplicates and rejects unknown names', async () => {
    const history = createMigrationHistory({ checksumColumn: 'checksum' })
    const runner = new MigrationRunner(db, [migration], { history })
    await expect(runner.baseline(['unknown'])).rejects.toThrow()
    expect(await db.introspection.getTables()).toEqual([])
    expect(await runner.baseline(['001', '001'])).toEqual({ marked: ['001'], skipped: ['001'] })
    expect(await runner.baseline(['001'])).toEqual({ marked: [], skipped: ['001'] })
    expect((await runner.inspect()).unknownChecksums).toEqual([])
    const preview = new MigrationRunner(db, [migration], { history, dryRun: true })
    await expect(preview.baseline(['001'])).rejects.toThrow('dry-run')
    await expect(preview.adoptChecksums()).rejects.toThrow('dry-run')
  })

  it('can baseline and adopt within an externally owned transaction without committing it', async () => {
    const history = createMigrationHistory({ checksumTable: 'digests' })
    await history.setup(db)
    await history.insert(db, {
      name: migration.name,
      checksum: null,
      executedAt: '2026-01-01T00:00:00Z'
    })
    await expect(
      db.transaction().execute(async tx => {
        const runner = new MigrationRunner(tx, [migration, { ...migration, name: '002' }], {
          history,
          advisoryLock: false
        })
        expect(await runner.adoptChecksums()).toEqual(['001'])
        await runner.baseline(['002'])
        throw new Error('owner rolls back')
      })
    ).rejects.toThrow('owner rolls back')
    expect((await history.read(db)).map(r => [r.name, r.checksum])).toEqual([['001', null]])
    const compatible = new MigrationRunner(db, [migration], {
      history,
      backfillMissingChecksums: true
    })
    await compatible.up()
    expect((await compatible.inspect()).unknownChecksums).toEqual([])
    await history.setChecksum(db, '001', 'b'.repeat(64))
    expect((await history.read(db))[0]?.checksum).toBe(migration.checksum)
    await compatible.down()
    expect((await sql`select * from digests`.execute(db)).rows).toEqual([])
  })

  it('preserves legacy metadata and upgrades only the explicitly requested checksum column', async () => {
    await sql`create table migrations (name text primary key, executed_at text default CURRENT_TIMESTAMP, batch integer not null)`.execute(
      db
    )
    const history = createMigrationHistory({
      checksumColumn: 'checksum',
      recordValues: async (_db, _record, columns) => {
        expect(columns.has('batch')).toBe(true)
        return { batch: 7 }
      }
    })
    await history.setup(db)
    await history.insert(db, { name: '001', checksum: null, executedAt: '2026-01-01T00:00:00Z' })
    await history.setChecksum(db, '001', 'a'.repeat(64))
    await history.setChecksum(db, '001', 'b'.repeat(64))
    expect((await history.read(db))[0]).toMatchObject({
      name: '001',
      checksum: 'a'.repeat(64),
      executedAt: '2026-01-01T00:00:00Z'
    })
    expect(
      (await sql<{ batch: number }>`select batch from migrations`.execute(db)).rows[0]?.batch
    ).toBe(7)
  })

  it('refuses incompatible history, invalid identifiers and noncanonical integer keys', async () => {
    expect(() =>
      createMigrationHistory({ checksumColumn: 'hash', checksumTable: 'hashes' })
    ).toThrow()
    expect(() => createMigrationHistory({ tableName: 'schema;drop' })).toThrow()
    await sql`create table migrations (version integer primary key)`.execute(db)
    const incompatible = createMigrationHistory()
    await expect(incompatible.setup(db)).rejects.toThrow('incompatible columns')
    await expect(incompatible.read(db)).rejects.toThrow('Incompatible migration history')
    const versioned = createMigrationHistory({
      keyColumn: 'version',
      keyType: 'integer',
      executedAtColumn: null
    })
    await expect(
      versioned.insert(db, { name: '01', checksum: null, executedAt: null })
    ).rejects.toThrow('canonical')
    await expect(versioned.setChecksum(db, '1', 'a')).rejects.toThrow('no checksum storage')
    const ordered = createMigrationHistory({
      keyColumn: 'version',
      keyType: 'integer',
      executedAtColumn: null,
      orderColumn: 'position'
    })
    await expect(ordered.read(db)).rejects.toThrow('has no position')
  })

  it('preflights strict rollback and stops on missing applied definitions', async () => {
    const runner = new MigrationRunner(db, [migration, { name: '002', up: async () => {} }], {
      strictRollback: true
    })
    await runner.up()
    await expect(runner.down(2)).rejects.toThrow('No migrations were reverted')
    expect((await runner.status()).executed).toEqual(['001', '002'])
    await expect(
      new MigrationRunner(db, [], { missingMigrationPolicy: 'error' }).up()
    ).rejects.toThrow('not in this build')
  })

  it('permits legacy drift warnings only when the recovery policy is explicit', async () => {
    const history = createMigrationHistory({ checksumColumn: 'checksum' })
    await new MigrationRunner(db, [migration], { history }).up()
    const changed = new MigrationRunner(db, [{ ...migration, checksum: 'b'.repeat(64) }], {
      history,
      rollbackChecksumPolicy: 'warn'
    })
    expect((await changed.down()).executed).toEqual(['001'])
  })

  it('honors custom lock ownership and rejects invalid numeric identities', async () => {
    expect(() => new MigrationRunner(db, [], { advisoryLockKey: 0.5 })).toThrow()
    expect(() => new MigrationRunner(db, [], { advisoryLockKey: 2n ** 64n })).toThrow()
    let releases = 0
    const blocked = new MigrationRunner(db, [], {
      lockProvider: {
        acquire: async () => false,
        release: async () => {
          releases++
        }
      }
    })
    await expect(blocked.up()).rejects.toThrow(MigrationLockError)
    expect(releases).toBe(0)
    const runner = new MigrationRunner(db, [migration], {
      lockProvider: {
        acquire: async () => true,
        release: async () => {
          releases++
        }
      }
    })
    await runner.up()
    expect(releases).toBe(1)
  })

  it('retains the original error when its error hook also fails', async () => {
    const runner = await createMigrationRunnerWithPlugins(
      db,
      [
        {
          name: '001',
          up: async () => {
            throw new Error('original database failure')
          }
        }
      ],
      {
        plugins: [
          {
            name: 'broken-reporter',
            version: '1.0.0',
            onMigrationError: () => {
              throw new Error('observer failure')
            }
          }
        ]
      }
    )
    await expect(runner.up()).rejects.toThrow('original database failure')
    expect(createMigrationWithMeta('001', migration).checksum).toBe(migration.checksum)
    expect(defineMigrations({ '001': migration })[0]?.checksum).toBe(migration.checksum)
  })
})
