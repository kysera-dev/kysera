import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated, type Selectable } from 'kysely'
import betterSqlite3 from 'better-sqlite3'
import { auditPlugin } from '../src/index.js'
import { createRepositoryFactory, zodAdapter } from '@kysera/repository'
import { z } from 'zod'

interface TestDatabase {
  users: UsersTable
  audit_logs: AuditLogsTable
}

interface UsersTable {
  id: Generated<number>
  email: string
  name: string
}

interface AuditLogsTable {
  id: Generated<number>
  table_name: string
  operation: string
  entity_id: string
  old_values: string | null
  new_values: string | null
  changed_by: string | null
  changed_at: string
  metadata: string | null
}

type User = Selectable<UsersTable>

const AUDIT_EXTENDED = Symbol.for('kysera.audit.extended')

function createUserRepo(db: Kysely<TestDatabase>) {
  const factory = createRepositoryFactory(db)
  return factory.create({
    tableName: 'users' as const,
    mapRow: (row: any) => row as User,
    schemas: {
      create: zodAdapter(
        z.object({
          email: z.string(),
          name: z.string()
        })
      )
    }
  })
}

describe('extendRepository idempotence and immutability', () => {
  let db: Kysely<TestDatabase>

  beforeEach(async () => {
    const sqlite = new betterSqlite3(':memory:')
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({ database: sqlite })
    })

    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('email', 'text', col => col.notNull().unique())
      .addColumn('name', 'text', col => col.notNull())
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('should write exactly one audit row per create when extendRepository is applied twice', async () => {
    const plugin = auditPlugin({ tables: ['users'] })
    await plugin.onInit!(db)

    const baseRepo = createUserRepo(db)
    const extendedOnce = plugin.extendRepository!(baseRepo)
    const extendedTwice = plugin.extendRepository!(extendedOnce)

    // Second application must be a no-op returning the same object
    expect(extendedTwice).toBe(extendedOnce)

    await (extendedTwice as any).create({
      email: 'once@example.com',
      name: 'Once Only'
    })

    const auditLogs = await db.selectFrom('audit_logs').selectAll().execute()
    expect(auditLogs).toHaveLength(1)
  })

  it('should be idempotent across different audit plugin instances', async () => {
    const pluginA = auditPlugin({ tables: ['users'] })
    const pluginB = auditPlugin({ tables: ['users'] })
    await pluginA.onInit!(db)

    const baseRepo = createUserRepo(db)
    const extendedOnce = pluginA.extendRepository!(baseRepo)
    const extendedTwice = pluginB.extendRepository!(extendedOnce)

    expect(extendedTwice).toBe(extendedOnce)

    await (extendedTwice as any).create({
      email: 'cross@example.com',
      name: 'Cross Instance'
    })

    const auditLogs = await db.selectFrom('audit_logs').selectAll().execute()
    expect(auditLogs).toHaveLength(1)
  })

  it('should not mutate the original repository object', async () => {
    const plugin = auditPlugin({ tables: ['users'] })
    await plugin.onInit!(db)

    const baseRepo = createUserRepo(db)
    const originalCreate = baseRepo.create
    const extended = plugin.extendRepository!(baseRepo) as any

    // The extension must produce a new object with new methods
    expect(extended).not.toBe(baseRepo)
    expect(extended.create).not.toBe(originalCreate)
    expect(baseRepo.create).toBe(originalCreate)
    expect((baseRepo as any).getAuditHistory).toBeUndefined()
    expect((baseRepo as any).restoreFromAudit).toBeUndefined()

    // The unextended repository must not write audit rows
    await baseRepo.create({ email: 'raw@example.com', name: 'Raw Create' })
    const auditLogs = await db.selectFrom('audit_logs').selectAll().execute()
    expect(auditLogs).toHaveLength(0)
  })

  it('should mark the extended repository with a non-enumerable symbol', async () => {
    const plugin = auditPlugin({ tables: ['users'] })
    await plugin.onInit!(db)

    const extended = plugin.extendRepository!(createUserRepo(db))

    const descriptor = Object.getOwnPropertyDescriptor(extended, AUDIT_EXTENDED)
    expect(descriptor).toBeDefined()
    expect(descriptor!.value).toBe(true)
    expect(descriptor!.enumerable).toBe(false)
    // The marker must not leak into spreads or JSON
    expect(Object.keys(extended)).not.toContain(AUDIT_EXTENDED)
  })

  it('should skip extension entirely for excluded tables without marking', async () => {
    const plugin = auditPlugin({ excludeTables: ['users'] })
    await plugin.onInit!(db)

    const baseRepo = createUserRepo(db)
    const result = plugin.extendRepository!(baseRepo)

    expect(result).toBe(baseRepo)
    expect(Object.getOwnPropertyDescriptor(result, AUDIT_EXTENDED)).toBeUndefined()
  })
})
