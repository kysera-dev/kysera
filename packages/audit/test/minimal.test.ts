import { describe, it, expect } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import betterSqlite3 from 'better-sqlite3'
import { auditPluginSQLite } from '../src'
import { createORM, createRepositoryFactory } from '@kysera/repository'
import { z } from 'zod'

interface TestDatabase {
  users: {
    id: Generated<number>
    email: string
    name: string
  }
}

describe('Minimal Audit Test', () => {
  it('should audit create operation', async () => {
    const sqlite = new betterSqlite3(':memory:')
    const db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({ database: sqlite })
    })

    // Create table
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('email', 'text', col => col.notNull())
      .addColumn('name', 'text', col => col.notNull())
      .execute()

    const audit = auditPluginSQLite({
      getUserId: () => 'test-user'
    })
    const orm = await createORM(db, [audit])

    const factory = createRepositoryFactory(db)
    const userRepo = orm.createRepository(() =>
      factory.create({
        tableName: 'users' as const,
        mapRow: (row: any) => row,
        schemas: {
          create: z.object({
            email: z.string(),
            name: z.string()
          })
        }
      })
    )

    await userRepo.create({
      email: 'test@example.com',
      name: 'Test User'
    })

    // Check audit log was created
    const logs = await db.selectFrom('audit_logs').selectAll().execute()
    expect(logs.length).toBeGreaterThan(0)

    await db.destroy()
  })
})
