import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated, type Selectable } from 'kysely'
import betterSqlite3 from 'better-sqlite3'
import { auditPlugin } from '../src/index.js'
import { createRepositoryFactory, createORM, zodAdapter } from '@kysera/repository'
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

describe('Audit JSON serialization (tagged round-trip)', () => {
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

  // Repository whose mapRow enriches entities with values JSON cannot
  // represent natively (as PostgreSQL drivers do with Date/BigInt columns)
  async function createRepoWithMapRow(mapRow: (row: any) => any) {
    const audit = auditPlugin({ tables: ['users'] })
    const orm = await createORM(db, [audit])
    return orm.createRepository(executor => {
      const factory = createRepositoryFactory(executor)
      return factory.create({
        tableName: 'users' as const,
        mapRow,
        schemas: {
          create: zodAdapter(z.object({ email: z.string(), name: z.string() }))
        }
      })
    }) as any
  }

  describe('BigInt and Date tagging', () => {
    it('should store BigInt and Date columns as tagged values instead of destroying the payload', async () => {
      const userRepo = await createRepoWithMapRow((row: any) => ({
        ...(row as User),
        big: BigInt(42),
        when: new Date('2024-01-15T10:30:00.000Z')
      }))

      // Previously this threw inside JSON.stringify (BigInt) and the whole
      // payload degraded to the string '[Circular]'
      await userRepo.create({ email: 'tagged@example.com', name: 'Tagged' })

      const logs = await db.selectFrom('audit_logs').selectAll().execute()
      expect(logs).toHaveLength(1)

      const newValues = JSON.parse(logs[0]!.new_values!)
      expect(newValues.big).toEqual({ $kysera: 'bigint', value: '42' })
      expect(newValues.when).toEqual({ $kysera: 'date', value: '2024-01-15T10:30:00.000Z' })
      // Sibling columns stay untouched
      expect(newValues.email).toBe('tagged@example.com')
      expect(newValues.name).toBe('Tagged')
    })
  })

  describe('circular structures', () => {
    it('should replace only the offending column, preserving all sibling columns', async () => {
      const circular: any = { label: 'loop' }
      circular.self = circular

      const userRepo = await createRepoWithMapRow((row: any) => ({
        ...(row as User),
        weird: circular
      }))

      await userRepo.create({ email: 'circular@example.com', name: 'Circular' })

      const logs = await db.selectFrom('audit_logs').selectAll().execute()
      expect(logs).toHaveLength(1)

      const newValues = JSON.parse(logs[0]!.new_values!)
      expect(newValues.weird).toEqual({ $kysera: 'unserializable' })
      // The rest of the row survives instead of the whole payload being '[Circular]'
      expect(newValues.email).toBe('circular@example.com')
      expect(newValues.name).toBe('Circular')
      expect(typeof newValues.id).toBe('number')
    })
  })

  describe('restore path revival', () => {
    // A repository stub captures what create/update receive so the test can
    // verify the revived types without binding Date/BigInt to SQLite
    function createCapturingRepo() {
      const captured: { op?: string; id?: unknown; input?: any } = {}
      const repo = {
        tableName: 'users',
        executor: db as Kysely<any>,
        create: async (input: unknown) => {
          captured.op = 'create'
          captured.input = input
          return { id: 99, ...(input as object) }
        },
        update: async (id: unknown, input: unknown) => {
          captured.op = 'update'
          captured.id = id
          captured.input = input
          return { id, ...(input as object) }
        }
      }
      return { repo, captured }
    }

    async function insertAuditRow(operation: string, oldValues: unknown): Promise<number> {
      const inserted = await db
        .insertInto('audit_logs')
        .values({
          table_name: 'users',
          entity_id: '7',
          operation,
          old_values: JSON.stringify(oldValues),
          new_values: null,
          changed_by: null,
          changed_at: new Date().toISOString(),
          metadata: null
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      return inserted.id
    }

    const taggedOldValues = {
      id: 7,
      big: { $kysera: 'bigint', value: '123' },
      when: { $kysera: 'date', value: '2024-01-15T10:30:00.000Z' },
      plain: 'text'
    }

    it('should revive tagged BigInt and Date values when restoring an UPDATE', async () => {
      const audit = auditPlugin({ captureOldValues: false, tables: ['users'] })
      await audit.onInit!(db)

      const { repo, captured } = createCapturingRepo()
      const extended = audit.extendRepository!(repo) as any

      const auditId = await insertAuditRow('UPDATE', taggedOldValues)
      await extended.restoreFromAudit(auditId)

      expect(captured.op).toBe('update')
      expect(captured.id).toBe(7)
      expect(captured.input.big).toBe(123n)
      expect(typeof captured.input.big).toBe('bigint')
      expect(captured.input.when).toBeInstanceOf(Date)
      expect((captured.input.when as Date).toISOString()).toBe('2024-01-15T10:30:00.000Z')
      expect(captured.input.plain).toBe('text')
    })

    it('should revive tagged BigInt and Date values when restoring a DELETE', async () => {
      const audit = auditPlugin({ captureOldValues: false, tables: ['users'] })
      await audit.onInit!(db)

      const { repo, captured } = createCapturingRepo()
      const extended = audit.extendRepository!(repo) as any

      const auditId = await insertAuditRow('DELETE', taggedOldValues)
      await extended.restoreFromAudit(auditId)

      expect(captured.op).toBe('create')
      expect(captured.input.big).toBe(123n)
      expect(captured.input.when).toBeInstanceOf(Date)
      expect(captured.input.plain).toBe('text')
    })

    it('should round-trip BigInt through audit and restore end to end', async () => {
      const audit = auditPlugin({ captureOldValues: false, tables: ['users'] })
      await audit.onInit!(db)

      const { repo, captured } = createCapturingRepo()
      const extended = audit.extendRepository!(repo) as any

      // The audited create serializes the BigInt/Date-bearing entity...
      await extended.create({ big: BigInt(555), when: new Date('2025-02-02T02:02:02.000Z') })

      const log = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('operation', '=', 'INSERT')
        .executeTakeFirstOrThrow()

      // ...as tagged JSON (no throw, no '[Circular]' placeholder)
      const stored = JSON.parse(log.new_values!)
      expect(stored.big).toEqual({ $kysera: 'bigint', value: '555' })
      expect(stored.when).toEqual({ $kysera: 'date', value: '2025-02-02T02:02:02.000Z' })

      // ...and restoring an UPDATE row carrying those stored values yields
      // the original types again
      const auditId = await insertAuditRow('UPDATE', { id: 99, ...stored })
      await extended.restoreFromAudit(auditId)

      expect(captured.input.big).toBe(555n)
      expect(captured.input.when).toBeInstanceOf(Date)
    })
  })
})
