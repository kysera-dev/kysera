import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect, sql } from 'kysely'
import { MigrationRunner, createMigrationRunnerWithPlugins, type Migration } from '../src/index.js'
import { createFakeDb } from './helpers/fake-kysely.js'

describe('atomic migration batches', () => {
  let db: Kysely<unknown>
  beforeEach(() => {
    db = new Kysely({ dialect: new SqliteDialect({ database: new Database(':memory:') }) })
  })
  afterEach(async () => {
    await db.destroy()
  })
  const first: Migration = {
    name: '001',
    up: async tx => {
      await sql`create table batch_probe (id integer)`.execute(tx)
    },
    down: async tx => {
      await sql`drop table batch_probe`.execute(tx)
    }
  }
  const second: Migration = {
    name: '002',
    up: async tx => {
      await sql`insert into batch_probe values (1)`.execute(tx)
    },
    down: async tx => {
      await sql`delete from batch_probe`.execute(tx)
    }
  }
  const options = { useTransactions: true, transactionMode: 'batch' as const }

  it('rolls all migrations and the new history table back on a late failure, then recovers', async () => {
    let fail = true
    const bad: Migration = {
      ...second,
      up: async tx => {
        await second.up(tx)
        if (fail) throw new Error('late failure')
      }
    }
    const runner = new MigrationRunner(db, [first, bad], options)
    await expect(runner.up()).rejects.toThrow('late failure')
    expect(await db.introspection.getTables()).toEqual([])
    fail = false
    expect((await runner.up()).executed).toEqual(['001', '002'])
    expect((await runner.up()).executed).toEqual([])
    expect((await runner.reset()).executed).toEqual(['002', '001'])
  })

  it('keeps earlier rollback work when a later down fails inside a batch', async () => {
    const runner = new MigrationRunner(
      db,
      [
        {
          ...first,
          down: async () => {
            throw new Error('cannot undo')
          }
        },
        second
      ],
      options
    )
    await runner.up()
    await expect(runner.down(2)).rejects.toThrow('cannot undo')
    expect((await sql`select * from batch_probe`.execute(db)).rows).toHaveLength(1)
    expect((await runner.inspect()).executed.map(row => row.name)).toEqual(['001', '002'])
  })

  it('defers after hooks until commit and reports a committed observer failure', async () => {
    const after = vi.fn(async () => {
      expect((await sql`select * from batch_probe`.execute(db)).rows).toHaveLength(1)
      throw new Error('observer failed')
    })
    const runner = await createMigrationRunnerWithPlugins(db, [first, second], {
      ...options,
      plugins: [{ name: 'observer', version: '1.0.0', afterMigration: after }]
    })
    await expect(runner.up()).rejects.toMatchObject({ name: 'MigrationHookError', applied: true })
    expect((await runner.inspect()).executed).toHaveLength(2)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('does not run after hooks for a rolled-back batch and supports read-only previews', async () => {
    const after = vi.fn()
    const runner = await createMigrationRunnerWithPlugins(
      db,
      [
        first,
        {
          name: '002',
          up: async () => {
            throw new Error('stop')
          }
        }
      ],
      { ...options, plugins: [{ name: 'observer', version: '1.0.0', afterMigration: after }] }
    )
    await expect(runner.up()).rejects.toThrow('stop')
    expect(after).not.toHaveBeenCalled()
    await new MigrationRunner(db, [first, second], { ...options, dryRun: true }).upTo('001')
    expect(await db.introspection.getTables()).toEqual([])
  })

  it('rejects incompatible or misleading transaction settings', async () => {
    expect(() => new MigrationRunner(db, [], { transactionMode: 'batch' })).toThrow('require')
    expect(() => new MigrationRunner(db, [], { ...options, stopOnError: false })).toThrow('require')
    await db.transaction().execute(async tx => {
      expect(() => new MigrationRunner(tx, [], options)).toThrow('own their transaction')
    })
    const mysql = createFakeDb('mysql').db
    expect(() => new MigrationRunner(mysql, [], options)).toThrow('MySQL')
    await mysql.destroy()
  })
})
