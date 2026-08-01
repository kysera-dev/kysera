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

describe('Audit atomicity (mutation + audit entry commit together)', () => {
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

  // Repository created the documented way: factory bound to the plugin-aware
  // executor, so the audit plugin can rebind mutations to a transaction
  async function createAuditedRepo() {
    const audit = auditPlugin({ getUserId: () => 'atomic-user', tables: ['users'] })
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

  describe('atomic path (plugin-aware executor)', () => {
    it('should roll back the created row when the audit insert fails', async () => {
      const userRepo = await createAuditedRepo()

      // Sanity check: normal create works and writes one audit row
      await userRepo.create({ email: 'ok@example.com', name: 'OK' })
      expect(await db.selectFrom('audit_logs').selectAll().execute()).toHaveLength(1)

      // Break the audit table: the next audit insert must fail
      await db.schema.dropTable('audit_logs').execute()

      await expect(
        userRepo.create({ email: 'doomed@example.com', name: 'Doomed' })
      ).rejects.toThrow()

      // The user INSERT must have been rolled back together with the failed audit write
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(1)
      expect(users[0]!.email).toBe('ok@example.com')
    })

    it('should roll back updates when the audit insert fails', async () => {
      const userRepo = await createAuditedRepo()
      const user = await userRepo.create({ email: 'stable@example.com', name: 'Original' })

      await db.schema.dropTable('audit_logs').execute()

      await expect(userRepo.update(user.id, { name: 'Changed' })).rejects.toThrow()

      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .executeTakeFirst()
      expect(row!.name).toBe('Original')
    })

    it('should roll back deletes when the audit insert fails', async () => {
      const userRepo = await createAuditedRepo()
      const user = await userRepo.create({ email: 'keep@example.com', name: 'Keep Me' })

      await db.schema.dropTable('audit_logs').execute()

      await expect(userRepo.delete(user.id)).rejects.toThrow()

      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .executeTakeFirst()
      expect(row).toBeDefined()
    })

    it('should roll back the whole bulkCreate when the audit insert fails', async () => {
      const userRepo = await createAuditedRepo()

      await db.schema.dropTable('audit_logs').execute()

      await expect(
        userRepo.bulkCreate([
          { email: 'bulk1@example.com', name: 'Bulk 1' },
          { email: 'bulk2@example.com', name: 'Bulk 2' }
        ])
      ).rejects.toThrow()

      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(0)
    })

    it('should write exactly one audit row per create on the atomic path', async () => {
      const userRepo = await createAuditedRepo()

      await userRepo.create({ email: 'single@example.com', name: 'Single' })

      const logs = await db.selectFrom('audit_logs').selectAll().execute()
      expect(logs).toHaveLength(1)
      expect(logs[0]!.operation).toBe('INSERT')
      expect(logs[0]!.changed_by).toBe('atomic-user')
    })
  })

  describe('fallback path (repository not rebindable)', () => {
    it('should keep the mutation and surface the error when audit fails (documented best effort)', async () => {
      const audit = auditPlugin({ tables: ['users'] })
      const orm = await createORM(db, [audit])
      // Factory bound to the raw db: executor carries no plugin metadata, so
      // the audit plugin cannot rebind mutations into a transaction
      const factory = createRepositoryFactory(db)
      const userRepo = orm.createRepository((_executor: any) =>
        factory.create({
          tableName: 'users' as const,
          mapRow: (row: any) => row as User,
          schemas: {
            create: zodAdapter(z.object({ email: z.string(), name: z.string() }))
          }
        })
      ) as any

      await db.schema.dropTable('audit_logs').execute()

      await expect(
        userRepo.create({ email: 'persisted@example.com', name: 'Persisted' })
      ).rejects.toThrow()

      // Best-effort path: the row stays even though the audit write failed
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(1)
    })
  })

  describe('existing transaction path', () => {
    it('should keep mutation and audit row on the caller transaction', async () => {
      const userRepo = await createAuditedRepo()

      await expect(
        db.transaction().execute(async trx => {
          const txRepo = userRepo.withTransaction(trx)
          await txRepo.create({ email: 'tx@example.com', name: 'Tx User' })

          // Both the row and its audit entry must be visible inside the transaction
          const rows = await trx.selectFrom('users').selectAll().execute()
          const logs = await trx.selectFrom('audit_logs').selectAll().execute()
          expect(rows).toHaveLength(1)
          expect(logs).toHaveLength(1)

          throw new Error('rollback everything')
        })
      ).rejects.toThrow('rollback everything')

      // Rollback must remove both the row and the audit entry
      expect(await db.selectFrom('users').selectAll().execute()).toHaveLength(0)
      expect(await db.selectFrom('audit_logs').selectAll().execute()).toHaveLength(0)
    })
  })
})
