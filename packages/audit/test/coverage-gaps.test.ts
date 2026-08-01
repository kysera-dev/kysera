import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

describe('Audit edge and error paths', () => {
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

  async function createAuditedUserRepo(getUserId?: () => string | null) {
    const audit = auditPlugin({ tables: ['users'], ...(getUserId ? { getUserId } : {}) })
    const orm = await createORM(db, [audit])
    return orm.createRepository(executor => {
      const factory = createRepositoryFactory(executor)
      return factory.create({
        tableName: 'users' as const,
        mapRow: (row: any) => row as User,
        schemas: {
          create: zodAdapter(z.object({ email: z.string(), name: z.string() })),
          update: zodAdapter(z.object({ email: z.string().optional(), name: z.string().optional() }))
        }
      })
    }) as any
  }

  async function insertAuditRow(
    operation: string,
    oldValues: string | null,
    entityId = '7'
  ): Promise<number> {
    const inserted = await db
      .insertInto('audit_logs')
      .values({
        table_name: 'users',
        entity_id: entityId,
        operation,
        old_values: oldValues,
        new_values: null,
        changed_by: null,
        changed_at: new Date().toISOString(),
        metadata: null
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return inserted.id
  }

  describe('restoreFromAudit guard errors', () => {
    it('should throw AuditMissingValuesError when DELETE log has no old_values', async () => {
      const userRepo = await createAuditedUserRepo()
      const auditId = await insertAuditRow('DELETE', null)

      await expect(userRepo.restoreFromAudit(auditId)).rejects.toThrow(/old_values/)
    })

    it('should throw AuditMissingValuesError when DELETE log has corrupted JSON', async () => {
      const userRepo = await createAuditedUserRepo()
      const auditId = await insertAuditRow('DELETE', '{not valid json')

      await expect(userRepo.restoreFromAudit(auditId)).rejects.toThrow(/old_values/)
    })

    it('should throw AuditMissingValuesError when UPDATE log has no old_values', async () => {
      const userRepo = await createAuditedUserRepo()
      const auditId = await insertAuditRow('UPDATE', null)

      await expect(userRepo.restoreFromAudit(auditId)).rejects.toThrow(/old_values/)
    })

    it('should throw AuditRestoreError when UPDATE old_values lack the primary key', async () => {
      const userRepo = await createAuditedUserRepo()
      const auditId = await insertAuditRow('UPDATE', JSON.stringify({ name: 'No PK Here' }))

      await expect(userRepo.restoreFromAudit(auditId)).rejects.toThrow(
        /Primary key 'id' not found/
      )
    })

    it('should throw AuditRestoreError when the repository lacks create/update', async () => {
      const audit = auditPlugin({ tables: ['users'] })
      await audit.onInit!(db)

      // Repository with no mutation methods at all
      const bareRepo = { tableName: 'users', executor: db as Kysely<any> }
      const extended = audit.extendRepository!(bareRepo) as any

      expect(extended.create).toBeUndefined()
      expect(extended.update).toBeUndefined()
      expect(extended.delete).toBeUndefined()
      expect(extended.bulkCreate).toBeUndefined()
      expect(extended.bulkUpdate).toBeUndefined()
      expect(extended.bulkDelete).toBeUndefined()

      const deleteLogId = await insertAuditRow('DELETE', JSON.stringify({ id: 7, name: 'X' }))
      await expect(extended.restoreFromAudit(deleteLogId)).rejects.toThrow(
        /does not support create/
      )

      const updateLogId = await insertAuditRow('UPDATE', JSON.stringify({ id: 7, name: 'X' }))
      await expect(extended.restoreFromAudit(updateLogId)).rejects.toThrow(
        /does not support update/
      )
    })
  })

  describe('audit query filters and pagination', () => {
    it('should support numeric and string date filters plus limit/offset', async () => {
      const userRepo = await createAuditedUserRepo(() => 'filter-user')

      await userRepo.create({ email: 'f1@example.com', name: 'F1' })
      await userRepo.create({ email: 'f2@example.com', name: 'F2' })
      await userRepo.create({ email: 'f3@example.com', name: 'F3' })

      // startDate as unix milliseconds (number), endDate as ISO string
      const logs = await userRepo.getTableAuditLogs({
        operation: 'INSERT',
        userId: 'filter-user',
        startDate: Date.now() - 60_000,
        endDate: new Date(Date.now() + 60_000).toISOString(),
        limit: 2,
        offset: 1
      })

      expect(logs).toHaveLength(2)
      expect(logs.every((l: any) => l.operation === 'INSERT')).toBe(true)
    })

    it('should paginate getAuditHistory and getUserChanges', async () => {
      const userRepo = await createAuditedUserRepo(() => 'pager')

      const user = await userRepo.create({ email: 'page@example.com', name: 'V1' })
      await userRepo.update(user.id, { name: 'V2' })
      await userRepo.update(user.id, { name: 'V3' })

      const history = await userRepo.getAuditHistory(user.id, { limit: 2, offset: 1 })
      expect(history).toHaveLength(2)

      const changes = await userRepo.getUserChanges('pager', { limit: 1, offset: 0 })
      expect(changes).toHaveLength(1)
    })
  })

  describe('resilience when old values cannot be fetched', () => {
    it('should audit updates with null old_values when the table cannot be queried', async () => {
      const audit = auditPlugin({ tables: ['ghosts'] })
      await audit.onInit!(db)

      // Repository for a table that does not exist: fetching old values fails,
      // but the mutation and its audit entry must still go through
      const fakeRepo = {
        tableName: 'ghosts',
        executor: db as Kysely<any>,
        update: async (id: unknown, input: unknown) => ({ id, ...(input as object) })
      }
      const extended = audit.extendRepository!(fakeRepo) as any

      const result = await extended.update(5, { name: 'Ghost' })
      expect(result.name).toBe('Ghost')

      const logs = await db.selectFrom('audit_logs').selectAll().execute()
      expect(logs).toHaveLength(1)
      expect(logs[0]!.operation).toBe('UPDATE')
      expect(logs[0]!.old_values).toBeNull()
    })

    it('should audit bulk deletes with null old_values when the bulk fetch fails', async () => {
      const audit = auditPlugin({ tables: ['ghosts'] })
      await audit.onInit!(db)

      const fakeRepo = {
        tableName: 'ghosts',
        executor: db as Kysely<any>,
        bulkDelete: async (ids: unknown[]) => ids.length
      }
      const extended = audit.extendRepository!(fakeRepo) as any

      const deleted = await extended.bulkDelete([1, 2])
      expect(deleted).toBe(2)

      const logs = await db.selectFrom('audit_logs').selectAll().execute()
      expect(logs).toHaveLength(2)
      expect(logs.every(l => l.operation === 'DELETE' && l.old_values === null)).toBe(true)
    })
  })

  describe('entity shape edge cases', () => {
    it('should reject creates whose result lacks the primary key', async () => {
      const audit = auditPlugin({ tables: ['users'] })
      await audit.onInit!(db)

      const fakeRepo = {
        tableName: 'users',
        executor: db as Kysely<any>,
        create: async () => ({ email: 'nopk@example.com' })
      }
      const extended = audit.extendRepository!(fakeRepo) as any

      await expect(extended.create({ email: 'nopk@example.com' })).rejects.toThrow(
        /Primary key 'id' not found in entity/
      )
    })

    it('should store non-object circular payloads as a single unserializable tag', async () => {
      const audit = auditPlugin({ tables: ['users'] })
      await audit.onInit!(db)

      const circularArray: unknown[] = ['x']
      circularArray.push(circularArray)

      const fakeRepo = {
        tableName: 'users',
        executor: db as Kysely<any>,
        update: async () => circularArray
      }
      const extended = audit.extendRepository!(fakeRepo) as any

      await extended.update(1, { name: 'irrelevant' })

      const logs = await db.selectFrom('audit_logs').selectAll().execute()
      expect(logs).toHaveLength(1)
      expect(JSON.parse(logs[0]!.new_values!)).toEqual({ $kysera: 'unserializable' })
    })
  })

  describe('extendRepository guards', () => {
    it('should return the repository unchanged when it has no executor', () => {
      const audit = auditPlugin()
      const repo = { tableName: 'users', executor: undefined }

      expect(audit.extendRepository!(repo)).toBe(repo)
    })
  })

  describe('atomic path eligibility', () => {
    it('should fall back to sequential auditing when the repository has no withTransaction', async () => {
      const audit = auditPlugin({ tables: ['users'] })
      const orm = await createORM(db, [audit])

      // Plugin-aware executor, but a repository that cannot be rebound
      const fakeRepo = {
        tableName: 'users',
        executor: orm.executor as Kysely<any>,
        create: async (input: unknown) => ({ id: 1, ...(input as object) })
      }
      const extended = audit.extendRepository!(fakeRepo) as any

      const created = await extended.create({ email: 'seq@example.com', name: 'Seq' })
      expect(created.id).toBe(1)

      const logs = await db.selectFrom('audit_logs').selectAll().execute()
      expect(logs).toHaveLength(1)
    })

    it('should fall back to sequential auditing when the plugin is not in the executor chain', async () => {
      const registeredAudit = auditPlugin({ tables: ['users'] })
      const orm = await createORM(db, [registeredAudit])

      // A different audit plugin instance extends a repository bound to an
      // executor whose chain does not include it: rebinding would silently
      // skip its audit logging, so it must use the sequential path
      const foreignAudit = auditPlugin({ tables: ['users'] })
      const withTransactionSpy = vi.fn()
      const fakeRepo = {
        tableName: 'users',
        executor: orm.executor as Kysely<any>,
        create: async (input: unknown) => ({ id: 2, ...(input as object) }),
        withTransaction: withTransactionSpy
      }
      const extended = foreignAudit.extendRepository!(fakeRepo) as any

      await extended.create({ email: 'foreign@example.com', name: 'Foreign' })

      expect(withTransactionSpy).not.toHaveBeenCalled()
      const logs = await db.selectFrom('audit_logs').selectAll().execute()
      expect(logs).toHaveLength(1)
    })
  })
})
