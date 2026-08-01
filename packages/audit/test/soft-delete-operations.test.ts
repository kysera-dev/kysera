import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated, type Selectable } from 'kysely'
import betterSqlite3 from 'better-sqlite3'
import { auditPlugin } from '../src/index.js'
import { softDeletePlugin } from '../../soft-delete/src/index.js'
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
  deleted_at: string | null
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

describe('Audit coverage of soft-delete plugin operations', () => {
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
      .addColumn('deleted_at', 'text')
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
  })

  async function createRepo(options: { skipSystemOperations?: boolean } = {}) {
    const audit = auditPlugin({
      getUserId: () => 'sd-user',
      tables: ['users'],
      ...options
    })
    // tables restricted so the soft-delete filter never touches audit_logs
    const softDelete = softDeletePlugin({ tables: ['users'] })
    const orm = await createORM(db, [audit, softDelete])
    return orm.createRepository((executor: Kysely<TestDatabase>) => {
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

  async function auditLogs() {
    return db.selectFrom('audit_logs').selectAll().orderBy('id', 'asc').execute()
  }

  async function clearAuditLogs() {
    await db.deleteFrom('audit_logs').execute()
  }

  describe('bulkDelete phantom entries (result-gated audit)', () => {
    it('should write no audit entries when bulkDelete matches only soft-deleted rows', async () => {
      const repo = await createRepo()
      const user = await repo.create({ email: 'phantom@test.com', name: 'Phantom' })
      await repo.softDelete(user.id)
      await clearAuditLogs()

      // The soft-delete plugin narrows the DELETE with deleted_at IS NULL,
      // so this bulkDelete removes nothing
      const deleted = await repo.bulkDelete([user.id])
      expect(deleted).toBe(0)

      // No phantom DELETE audit entry for a deletion that never happened
      expect(await auditLogs()).toHaveLength(0)

      // The row still exists (soft-deleted)
      const rows = await db.selectFrom('users').selectAll().execute()
      expect(rows).toHaveLength(1)
    })

    it('should write no audit entries when bulkDelete matches no rows at all', async () => {
      const repo = await createRepo()

      const deleted = await repo.bulkDelete([987, 654])
      expect(deleted).toBe(0)

      expect(await auditLogs()).toHaveLength(0)
    })

    it('should still audit bulkDelete of live rows', async () => {
      const repo = await createRepo()
      const a = await repo.create({ email: 'live-a@test.com', name: 'Live A' })
      const b = await repo.create({ email: 'live-b@test.com', name: 'Live B' })
      await clearAuditLogs()

      const deleted = await repo.bulkDelete([a.id, b.id])
      expect(deleted).toBe(2)

      const logs = await auditLogs()
      expect(logs).toHaveLength(2)
      expect(logs.every(l => l.operation === 'DELETE')).toBe(true)
    })
  })

  describe('bulk soft-delete operations are audited', () => {
    it('should write UPDATE entries for softDeleteMany', async () => {
      const repo = await createRepo()
      const a = await repo.create({ email: 'many-a@test.com', name: 'Many A' })
      const b = await repo.create({ email: 'many-b@test.com', name: 'Many B' })
      await clearAuditLogs()

      const results = await repo.softDeleteMany([a.id, b.id])
      expect(results).toHaveLength(2)

      const logs = await auditLogs()
      expect(logs).toHaveLength(2)
      for (const log of logs) {
        expect(log.operation).toBe('UPDATE')
        expect(log.changed_by).toBe('sd-user')
        // Old state was live, new state is soft-deleted
        expect(JSON.parse(log.old_values!).deleted_at).toBeNull()
        expect(JSON.parse(log.new_values!).deleted_at).not.toBeNull()
      }
    })

    it('should write UPDATE entries for restoreMany with soft-deleted old values', async () => {
      const repo = await createRepo()
      const a = await repo.create({ email: 'rmany-a@test.com', name: 'RMany A' })
      const b = await repo.create({ email: 'rmany-b@test.com', name: 'RMany B' })
      await repo.softDeleteMany([a.id, b.id])
      await clearAuditLogs()

      const results = await repo.restoreMany([a.id, b.id])
      expect(results).toHaveLength(2)

      const logs = await auditLogs()
      expect(logs).toHaveLength(2)
      for (const log of logs) {
        expect(log.operation).toBe('UPDATE')
        // Old values were fetched through the includeDeleted scope: the rows
        // were invisible to the narrowed executor but must still be captured
        expect(JSON.parse(log.old_values!).deleted_at).not.toBeNull()
        expect(JSON.parse(log.new_values!).deleted_at).toBeNull()
      }
    })

    it('should handle empty id lists without audit entries', async () => {
      const repo = await createRepo()
      await clearAuditLogs()

      expect(await repo.softDeleteMany([])).toEqual([])
      expect(await repo.restoreMany([])).toEqual([])
      await repo.hardDeleteMany([])

      expect(await auditLogs()).toHaveLength(0)
    })
  })

  describe('hardDelete operations are audited with existence gating', () => {
    it('should write a DELETE entry with old values when hard-deleting a soft-deleted row', async () => {
      const repo = await createRepo()
      const user = await repo.create({ email: 'purge@test.com', name: 'Purge Me' })
      await repo.softDelete(user.id)
      await clearAuditLogs()

      await repo.hardDelete(user.id)

      const logs = await auditLogs()
      expect(logs).toHaveLength(1)
      expect(logs[0]!.operation).toBe('DELETE')
      expect(logs[0]!.new_values).toBeNull()

      // Old values captured through the includeDeleted scope
      const oldValues = JSON.parse(logs[0]!.old_values!)
      expect(oldValues.email).toBe('purge@test.com')
      expect(oldValues.deleted_at).not.toBeNull()

      expect(await db.selectFrom('users').selectAll().execute()).toHaveLength(0)
    })

    it('should write no entry when hard-deleting a nonexistent row', async () => {
      const repo = await createRepo()
      await clearAuditLogs()

      await repo.hardDelete(12345)

      expect(await auditLogs()).toHaveLength(0)
    })

    it('should audit hardDeleteMany only for rows that existed', async () => {
      const repo = await createRepo()
      const live = await repo.create({ email: 'hd-live@test.com', name: 'HD Live' })
      const soft = await repo.create({ email: 'hd-soft@test.com', name: 'HD Soft' })
      await repo.softDelete(soft.id)
      await clearAuditLogs()

      await repo.hardDeleteMany([live.id, soft.id, 99999])

      const logs = await auditLogs()
      // The nonexistent id produces no phantom entry
      expect(logs).toHaveLength(2)
      expect(logs.every(l => l.operation === 'DELETE')).toBe(true)

      const auditedIds = logs.map(l => l.entity_id).sort()
      expect(auditedIds).toEqual([String(live.id), String(soft.id)].sort())

      expect(await db.selectFrom('users').selectAll().execute()).toHaveLength(0)
    })
  })

  describe('atomicity and configuration of soft-delete operation auditing', () => {
    it('should roll back the soft delete when the audit insert fails', async () => {
      const repo = await createRepo()
      const user = await repo.create({ email: 'atomic-sd@test.com', name: 'Atomic SD' })

      await db.schema.dropTable('audit_logs').execute()

      await expect(repo.softDelete(user.id)).rejects.toThrow()

      // The deleted_at flip must have been rolled back with the failed audit write
      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .executeTakeFirst()
      expect(row!.deleted_at).toBeNull()
    })

    it('should skip auditing soft-delete operations when skipSystemOperations is set', async () => {
      const repo = await createRepo({ skipSystemOperations: true })
      const user = await repo.create({ email: 'skip-sd@test.com', name: 'Skip SD' })
      await clearAuditLogs()

      await repo.softDelete(user.id)
      await repo.restore(user.id)
      await repo.hardDelete(user.id)

      expect(await auditLogs()).toHaveLength(0)
    })
  })

  describe('restoreFromAudit on soft-deleted rows', () => {
    it('should revert an audited UPDATE even after the row was soft-deleted', async () => {
      const repo = await createRepo()

      const user = await repo.create({ email: 'revert@test.com', name: 'Original' })
      await repo.update(user.id, { name: 'Modified' })
      await repo.softDelete(user.id)

      // Logs in order: INSERT, UPDATE (name change), UPDATE (soft delete)
      const logs = await auditLogs()
      expect(logs.map(l => l.operation)).toEqual(['INSERT', 'UPDATE', 'UPDATE'])
      const updateLog = logs[1]!
      expect(JSON.parse(updateLog.new_values!).name).toBe('Modified')

      // Reverting the name-change UPDATE must work although the row is now
      // invisible to the narrowed executor (previously: NotFoundError)
      const restored = await repo.restoreFromAudit(updateLog.id)
      expect(restored.name).toBe('Original')

      // Values reverted, soft-deleted state untouched (the update schema
      // strips deleted_at from the restored old_values)
      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .executeTakeFirst()
      expect(row!.name).toBe('Original')
      expect(row!.deleted_at).not.toBeNull()
    })

    it('should record the rollback itself as an audited UPDATE', async () => {
      const repo = await createRepo()

      const user = await repo.create({ email: 'rollback-log@test.com', name: 'First' })
      await repo.update(user.id, { name: 'Second' })
      await repo.softDelete(user.id)

      const before = await auditLogs()
      const updateLog = before[1]!

      await repo.restoreFromAudit(updateLog.id)

      const after = await auditLogs()
      expect(after).toHaveLength(before.length + 1)
      const rollbackLog = after[after.length - 1]!
      expect(rollbackLog.operation).toBe('UPDATE')
      expect(JSON.parse(rollbackLog.new_values!).name).toBe('First')
      // Old values of the rollback show the soft-deleted pre-rollback state
      expect(JSON.parse(rollbackLog.old_values!).deleted_at).not.toBeNull()
    })

    it('should revert inside an existing transaction without opening a new one', async () => {
      const repo = await createRepo()

      const user = await repo.create({ email: 'tx-revert@test.com', name: 'Before Tx' })
      await repo.update(user.id, { name: 'Changed In Between' })
      await repo.softDelete(user.id)

      const logs = await auditLogs()
      const updateLog = logs[1]!

      await db.transaction().execute(async trx => {
        const txRepo = repo.withTransaction(trx)
        const restored = await txRepo.restoreFromAudit(updateLog.id)
        expect(restored.name).toBe('Before Tx')
      })

      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .executeTakeFirst()
      expect(row!.name).toBe('Before Tx')
      expect(row!.deleted_at).not.toBeNull()
    })

    it('should still restore DELETE operations by re-creating the entity', async () => {
      const repo = await createRepo()

      const user = await repo.create({ email: 'recreate@test.com', name: 'Recreate' })
      await repo.delete(user.id)

      const logs = await auditLogs()
      const deleteLog = logs.find(l => l.operation === 'DELETE')!

      const recreated = await repo.restoreFromAudit(deleteLog.id)
      expect(recreated.email).toBe('recreate@test.com')

      const rows = await db.selectFrom('users').selectAll().execute()
      expect(rows).toHaveLength(1)
    })
  })
})
