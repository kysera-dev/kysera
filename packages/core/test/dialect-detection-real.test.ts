/**
 * detectDialect against a REAL Kysely dialect instance (not fabricated mocks).
 *
 * The existing dialect-detection.test.ts builds mock compile() outputs by
 * hand, so a regression in real quoting behavior would never be caught.
 * SQLite is the only driver available in-process; postgres/mysql are covered
 * by the multi-db suites.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import { detectDialect } from '../src/dialect-detection.js'

describe('detectDialect with real dialects', () => {
  const db = new Kysely<{ t: { id: number } }>({
    dialect: new SqliteDialect({ database: new Database(':memory:') })
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('detects sqlite from a real SqliteDialect instance', () => {
    expect(detectDialect(db)).toBe('sqlite')
  })

  it('detects sqlite from a real transaction', async () => {
    await db.transaction().execute(async trx => {
      expect(detectDialect<{ t: { id: number } }>(trx)).toBe('sqlite')
    })
  })
})
