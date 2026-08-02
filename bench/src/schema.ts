/**
 * Shared database fixtures for all benchmark suites.
 *
 * Every suite gets its own in-memory SQLite database so that table growth
 * caused by one suite (or one variant) never skews another. Seeding is fully
 * deterministic: fixed emails, fixed tenant, fixed timestamps.
 */
import SQLite from 'better-sqlite3'
import { Kysely, SqliteDialect, type Dialect, type Generated, type Selectable } from 'kysely'

export interface UsersTable {
  id: Generated<number>
  email: string
  name: string
  tenant_id: number
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

export interface AuditLogsTable {
  id: Generated<number>
  table_name: string
  entity_id: string
  operation: string
  old_values: string | null
  new_values: string | null
  changed_by: string | null
  changed_at: string
  metadata: string | null
}

export interface BenchDb {
  users: UsersTable
  audit_logs: AuditLogsTable
}

export type UserRow = Selectable<UsersTable>

export interface BenchDbHandle {
  db: Kysely<BenchDb>
  destroy: () => Promise<void>
}

const SCHEMA_DDL = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  old_values TEXT,
  new_values TEXT,
  changed_by TEXT,
  changed_at TEXT NOT NULL,
  metadata TEXT
);
`

/**
 * Create a fresh in-memory SQLite database with the bench schema applied.
 * `wrapDialect` lets the query-count suite interpose its counting driver.
 */
export function createBenchDb(wrapDialect?: (inner: Dialect) => Dialect): BenchDbHandle {
  const sqlite = new SQLite(':memory:')
  sqlite.exec(SCHEMA_DDL)
  const inner: Dialect = new SqliteDialect({ database: sqlite })
  const db = new Kysely<BenchDb>({ dialect: wrapDialect ? wrapDialect(inner) : inner })
  return {
    db,
    destroy: async () => {
      // Kysely's SqliteDriver closes the better-sqlite3 handle on destroy.
      await db.destroy()
    }
  }
}

/** Fixed timestamp so seeded data is byte-identical between runs. */
export const SEED_TIMESTAMP = '2026-01-01T00:00:00.000Z'

export const SEED_TENANT_ID = 1

/**
 * Insert `count` deterministic users (ids 1..count, tenant 1, not deleted).
 */
export async function seedUsers(
  db: Kysely<BenchDb>,
  count: number,
  prefix = 'user'
): Promise<void> {
  const chunkSize = 500
  for (let offset = 0; offset < count; offset += chunkSize) {
    const rows = []
    for (let i = offset; i < Math.min(offset + chunkSize, count); i++) {
      rows.push({
        email: `${prefix}-${i}@bench.invalid`,
        name: `User ${i}`,
        tenant_id: SEED_TENANT_ID,
        created_at: SEED_TIMESTAMP,
        updated_at: SEED_TIMESTAMP,
        deleted_at: null
      })
    }
    await db.insertInto('users').values(rows).execute()
  }
}
