/**
 * Migration runner edge cases that had no coverage:
 * - upTo() with dryRun
 * - upTo() where a migration in range fails
 * - rollback of a migration missing from the codebase
 * - partial (dirty) state when useTransactions: false and a migration fails mid-way
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, sql } from 'kysely'
import Database from 'better-sqlite3'
import { createMigrationRunner, type Migration } from '../src/index.js'

type DB = Record<string, Record<string, unknown>>

const mkdb = (): Kysely<DB> =>
  new Kysely<DB>({ dialect: new SqliteDialect({ database: new Database(':memory:') }) })

const createTableMigration = (name: string, table: string): Migration<DB> => ({
  name,
  up: async db => {
    await db.schema.createTable(table).addColumn('id', 'integer', c => c.primaryKey()).execute()
  },
  down: async db => {
    await db.schema.dropTable(table).execute()
  }
})

describe('MigrationRunner edge cases', () => {
  let db: Kysely<DB>

  beforeEach(() => {
    db = mkdb()
  })

  afterEach(async () => {
    await db.destroy()
  })

  const tableNames = async (): Promise<string[]> => {
    const tables = await db.introspection.getTables()
    return tables.map(t => t.name).sort()
  }

  describe('upTo + dryRun', () => {
    it('reports would-be executions without touching the database', async () => {
      const migrations = [
        createTableMigration('001_a', 'a'),
        createTableMigration('002_b', 'b'),
        createTableMigration('003_c', 'c')
      ]
      const runner = createMigrationRunner(db, migrations, { dryRun: true })

      const result = await runner.upTo('002_b')

      expect(result.dryRun).toBe(true)
      expect(result.executed).toEqual(['001_a', '002_b'])
      expect(result.failed).toEqual([])
      // Nothing actually created (only the runner's own bookkeeping table)
      expect(await tableNames()).toEqual(['migrations'])
    })
  })

  describe('upTo with failing migration in range', () => {
    it('records the failure and stops with stopOnError (default)', async () => {
      const failing: Migration<DB> = {
        name: '002_boom',
        up: async () => {
          throw new Error('deliberate failure')
        }
      }
      const migrations = [createTableMigration('001_a', 'a'), failing, createTableMigration('003_c', 'c')]
      const runner = createMigrationRunner(db, migrations)

      await expect(runner.upTo('003_c')).rejects.toThrow(/002_boom failed/)

      // 001 executed and recorded; 002 failed; 003 never ran
      const status = await runner.status()
      expect(status.executed).toEqual(['001_a'])
      expect(await tableNames()).toContain('a')
      expect(await tableNames()).not.toContain('c')
    })

    it('continues past failures when stopOnError is false', async () => {
      const failing: Migration<DB> = {
        name: '002_boom',
        up: async () => {
          throw new Error('deliberate failure')
        }
      }
      const migrations = [createTableMigration('001_a', 'a'), failing, createTableMigration('003_c', 'c')]
      const runner = createMigrationRunner(db, migrations, { stopOnError: false })

      const result = await runner.upTo('003_c')
      expect(result.executed).toEqual(['001_a', '003_c'])
      expect(result.failed).toEqual(['002_boom'])
    })
  })

  describe('rollback of migrations missing from the codebase', () => {
    it('skips unknown recorded migrations and keeps rolling the rest back', async () => {
      const known = [createTableMigration('001_a', 'a'), createTableMigration('002_b', 'b')]
      const runner = createMigrationRunner(db, known)
      await runner.up()

      // Simulate a migration recorded by another branch/version of the app
      await sql`INSERT INTO migrations (name, executed_at) VALUES ('999_ghost', datetime('now'))`.execute(db)

      const result = await runner.down(2) // rolls back: 999_ghost (missing), 002_b
      expect(result.skipped).toContain('999_ghost')
      expect(result.executed).toEqual(['002_b'])
      expect(await tableNames()).toContain('a')
      expect(await tableNames()).not.toContain('b')
    })
  })

  describe('dirty state with useTransactions: false', () => {
    it('leaves partial DDL applied but does NOT mark the migration as executed', async () => {
      const halfway: Migration<DB> = {
        name: '001_partial',
        up: async database => {
          await database.schema
            .createTable('partial_table')
            .addColumn('id', 'integer', c => c.primaryKey())
            .execute()
          throw new Error('failure after first DDL statement')
        }
      }
      const runner = createMigrationRunner(db, [halfway], { useTransactions: false })

      await expect(runner.up()).rejects.toThrow(/001_partial failed/)

      // Dirty state: table exists, but the migration is not recorded —
      // re-running would fail again on CREATE TABLE (documented behavior)
      expect(await tableNames()).toContain('partial_table')
      const status = await runner.status()
      expect(status.executed).toEqual([])
    })
  })
})
