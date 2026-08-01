/**
 * Regression: withTransaction({ isolationLevel }) must actually reach the
 * driver. Kysely builders are immutable — the old code called
 * setIsolationLevel() and discarded the returned builder, so the option was
 * silently dropped (probe B in the repo audit).
 */
import { describe, it, expect } from 'vitest'
import {
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
  type TransactionSettings
} from 'kysely'
import { withTransaction } from '../src/index.js'

interface DB {
  t: { id: number }
}

/** Driver that records the TransactionSettings kysely hands to it */
class RecordingDriver implements Driver {
  public beginSettings: TransactionSettings[] = []

  private connection: DatabaseConnection = {
    executeQuery: (): Promise<QueryResult<never>> => Promise.resolve({ rows: [] }),
    streamQuery: () => {
      throw new Error('not implemented')
    }
  }

  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return this.connection
  }
  async beginTransaction(_conn: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    this.beginSettings.push(settings)
  }
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

const mkdb = (driver: RecordingDriver): Kysely<DB> =>
  new Kysely<DB>({
    dialect: {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => driver,
      createQueryCompiler: () => new SqliteQueryCompiler(),
      createIntrospector: db => new SqliteIntrospector(db)
    }
  })

describe('withTransaction isolationLevel', () => {
  it('passes the isolation level through to driver.beginTransaction', async () => {
    const driver = new RecordingDriver()
    const db = mkdb(driver)
    try {
      const result = await withTransaction(db, async () => 42, {
        isolationLevel: 'serializable'
      })
      expect(result).toBe(42)
      expect(driver.beginSettings).toHaveLength(1)
      // Before the fix this was undefined — the option never left DAL
      expect(driver.beginSettings[0]?.isolationLevel).toBe('serializable')
    } finally {
      await db.destroy()
    }
  })

  it('omits the isolation level when not requested', async () => {
    const driver = new RecordingDriver()
    const db = mkdb(driver)
    try {
      await withTransaction(db, async () => 1)
      expect(driver.beginSettings).toHaveLength(1)
      expect(driver.beginSettings[0]?.isolationLevel).toBeUndefined()
    } finally {
      await db.destroy()
    }
  })
})
