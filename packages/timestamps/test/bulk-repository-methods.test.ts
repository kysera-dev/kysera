import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely } from 'kysely'
import Database from 'better-sqlite3'
import { SqliteDialect } from 'kysely'
import { createORM, createRepositoryFactory, type Plugin } from '@kysera/repository'
import { timestampsPlugin } from '../src/index.js'

// Test database schema
interface TestDatabase {
  users: {
    id: number
    name: string
    email: string
    created_at?: Date | string | null
    updated_at?: Date | string | null
  }
}

// Helper function to create a repository with plugins
async function createTestRepository<TableName extends keyof TestDatabase & string>(
  db: Kysely<TestDatabase>,
  tableName: TableName,
  plugins: Plugin[] = []
): Promise<any> {
  const orm = await createORM<TestDatabase>(db, plugins)
  return orm.createRepository(executor => {
    const factory = createRepositoryFactory<TestDatabase>(executor)
    return factory.create<TableName, any>({
      tableName,
      mapRow: row => row,
      schemas: {
        create: { parse: (v: any) => v } as any,
        update: { parse: (v: any) => v } as any
      }
    })
  })
}

describe('Base Repository Bulk Methods (bulkCreate / bulkUpdate)', () => {
  let db: Kysely<TestDatabase>
  let sqlite: Database.Database

  beforeEach(async () => {
    sqlite = new Database(':memory:')
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({ database: sqlite })
    })

    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('name', 'text', col => col.notNull())
      .addColumn('email', 'text', col => col.notNull().unique())
      .addColumn('created_at', 'text')
      .addColumn('updated_at', 'text')
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
    sqlite.close()
  })

  describe('bulkCreate', () => {
    it('should set created_at on all rows created via bulkCreate', async () => {
      const plugin = timestampsPlugin()
      const userRepo = await createTestRepository(db, 'users', [plugin])

      const beforeDate = new Date()
      const users = await userRepo.bulkCreate([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' }
      ])
      const afterDate = new Date()

      expect(users).toHaveLength(3)
      for (const user of users) {
        expect(user.created_at).toBeDefined()
        expect(user.created_at).not.toBeNull()
        const createdAt = new Date(user.created_at)
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeDate.getTime())
        expect(createdAt.getTime()).toBeLessThanOrEqual(afterDate.getTime())
        // setUpdatedAtOnInsert defaults to false
        expect(user.updated_at ?? null).toBeNull()
      }

      // Verify persisted rows, not just the returned entities
      const rows = await db.selectFrom('users').selectAll().execute()
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row.created_at).not.toBeNull()
      }
    })

    it('should use one shared timestamp for the whole batch', async () => {
      const plugin = timestampsPlugin()
      const userRepo = await createTestRepository(db, 'users', [plugin])

      const users = await userRepo.bulkCreate([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' }
      ])

      expect(users[0].created_at).toBe(users[1].created_at)
    })

    it('should set updated_at on bulkCreate when setUpdatedAtOnInsert is true', async () => {
      const plugin = timestampsPlugin({ setUpdatedAtOnInsert: true })
      const userRepo = await createTestRepository(db, 'users', [plugin])

      const users = await userRepo.bulkCreate([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' }
      ])

      for (const user of users) {
        expect(user.created_at).not.toBeNull()
        expect(user.updated_at).not.toBeNull()
        expect(user.updated_at).toBe(user.created_at)
      }
    })

    it('should preserve explicitly provided created_at in bulkCreate', async () => {
      const plugin = timestampsPlugin()
      const userRepo = await createTestRepository(db, 'users', [plugin])

      const explicitDate = '2020-01-01T00:00:00.000Z'
      const users = await userRepo.bulkCreate([
        { name: 'Explicit', email: 'explicit@example.com', created_at: explicitDate },
        { name: 'Auto', email: 'auto@example.com' }
      ])

      expect(users[0].created_at).toBe(explicitDate)
      expect(users[1].created_at).not.toBe(explicitDate)
    })

    it('should handle empty array in bulkCreate', async () => {
      const plugin = timestampsPlugin()
      const userRepo = await createTestRepository(db, 'users', [plugin])

      const result = await userRepo.bulkCreate([])
      expect(result).toEqual([])
    })

    it('should apply the same timestamp logic as create and createMany', async () => {
      const fixed = '2024-06-15T12:00:00.000Z'
      const plugin = timestampsPlugin({ getTimestamp: () => fixed })
      const userRepo = await createTestRepository(db, 'users', [plugin])

      const single = await userRepo.create({ name: 'Single', email: 'single@example.com' })
      const [many] = await userRepo.createMany([{ name: 'Many', email: 'many@example.com' }])
      const [bulk] = await userRepo.bulkCreate([{ name: 'Bulk', email: 'bulk@example.com' }])

      expect(single.created_at).toBe(fixed)
      expect(many.created_at).toBe(fixed)
      expect(bulk.created_at).toBe(fixed)
    })
  })

  describe('bulkUpdate', () => {
    it('should set updated_at on all rows updated via bulkUpdate', async () => {
      const plugin = timestampsPlugin()
      const userRepo = await createTestRepository(db, 'users', [plugin])

      const created = await userRepo.bulkCreate([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' }
      ])

      const beforeDate = new Date()
      const updated = await userRepo.bulkUpdate([
        { id: created[0].id, data: { name: 'Updated 1' } },
        { id: created[1].id, data: { name: 'Updated 2' } }
      ])
      const afterDate = new Date()

      expect(updated).toHaveLength(2)
      for (const user of updated) {
        expect(user.updated_at).toBeDefined()
        expect(user.updated_at).not.toBeNull()
        const updatedAt = new Date(user.updated_at)
        expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeDate.getTime())
        expect(updatedAt.getTime()).toBeLessThanOrEqual(afterDate.getTime())
      }
      expect(updated[0].name).toBe('Updated 1')
      expect(updated[1].name).toBe('Updated 2')

      // Verify persisted rows
      const rows = await db.selectFrom('users').selectAll().execute()
      for (const row of rows) {
        expect(row.updated_at).not.toBeNull()
      }
    })

    it('should preserve explicitly provided updated_at in bulkUpdate', async () => {
      const plugin = timestampsPlugin()
      const userRepo = await createTestRepository(db, 'users', [plugin])

      const created = await userRepo.bulkCreate([
        { name: 'User 1', email: 'user1@example.com' }
      ])

      const explicitDate = '2020-01-01T00:00:00.000Z'
      const updated = await userRepo.bulkUpdate([
        { id: created[0].id, data: { name: 'Updated', updated_at: explicitDate } }
      ])

      expect(updated[0].updated_at).toBe(explicitDate)
    })

    it('should handle empty array in bulkUpdate', async () => {
      const plugin = timestampsPlugin()
      const userRepo = await createTestRepository(db, 'users', [plugin])

      const result = await userRepo.bulkUpdate([])
      expect(result).toEqual([])
    })

    it('should apply the same timestamp logic as update and updateMany', async () => {
      const fixed = '2024-06-15T12:00:00.000Z'
      const plugin = timestampsPlugin({ getTimestamp: () => fixed })
      const userRepo = await createTestRepository(db, 'users', [plugin])

      const created = await userRepo.bulkCreate([
        { name: 'A', email: 'a@example.com' },
        { name: 'B', email: 'b@example.com' },
        { name: 'C', email: 'c@example.com' }
      ])

      const viaUpdate = await userRepo.update(created[0].id, { name: 'A2' })
      const [viaUpdateMany] = await userRepo.updateMany([created[1].id], { name: 'B2' })
      const [viaBulkUpdate] = await userRepo.bulkUpdate([
        { id: created[2].id, data: { name: 'C2' } }
      ])

      expect(viaUpdate.updated_at).toBe(fixed)
      expect(viaUpdateMany.updated_at).toBe(fixed)
      expect(viaBulkUpdate.updated_at).toBe(fixed)
    })
  })

  describe('repositories without bulk methods', () => {
    it('should not add bulkCreate/bulkUpdate when the base repository lacks them', () => {
      const plugin = timestampsPlugin()
      const minimalRepo = {
        tableName: 'users',
        executor: db as Kysely<any>,
        create: async (input: unknown) => input,
        update: async (_id: unknown, input: unknown) => input
      }

      const extended = plugin.extendRepository!(minimalRepo) as Record<string, unknown>

      expect(extended['bulkCreate']).toBeUndefined()
      expect(extended['bulkUpdate']).toBeUndefined()
      expect(typeof extended['create']).toBe('function')
    })
  })
})

describe('MySQL fallback path (no RETURNING support)', () => {
  interface FakeExecutorOptions {
    /** When true, INSERT results carry an auto-increment insertId */
    withInsertId: boolean
  }

  // Minimal executor that compiles MySQL-flavoured SQL (backtick identifiers)
  // so detectDialect() reports 'mysql', which forces the insert-then-select
  // fallback in createMany. Rows live in an in-memory map.
  function createFakeMysqlExecutor(options: FakeExecutorOptions) {
    const storage = new Map<number, Record<string, unknown>>()
    let nextId = 1
    const insertedValues: Record<string, unknown>[] = []

    const executor = {
      selectFrom(_table: string) {
        let whereValue: unknown
        const builder = {
          select: () => builder,
          selectAll: () => builder,
          limit: () => builder,
          where: (_col: string, _op: string, value: unknown) => {
            whereValue = value
            return builder
          },
          compile: () => ({
            sql: 'select 1 as `test` from `_kysera_test` limit ?',
            parameters: [0]
          }),
          execute: async () => [...storage.values()],
          executeTakeFirst: async () => storage.get(Number(whereValue))
        }
        return builder
      },
      insertInto(_table: string) {
        let values: Record<string, unknown> = {}
        const builder = {
          values: (v: Record<string, unknown>) => {
            values = v
            return builder
          },
          executeTakeFirst: async () => {
            insertedValues.push(values)
            const id = options.withInsertId ? nextId++ : Number(values['id'])
            storage.set(id, { id, ...values })
            return options.withInsertId ? { insertId: BigInt(id) } : {}
          }
        }
        return builder
      }
    }

    return { executor, storage, insertedValues }
  }

  function createFakeRepo(executor: unknown) {
    return {
      tableName: 'users',
      executor: executor as Kysely<any>,
      create: async (input: unknown) => input,
      update: async (_id: unknown, input: unknown) => input
    }
  }

  it('should insert individually and fetch by insertId on MySQL', async () => {
    const { executor, insertedValues } = createFakeMysqlExecutor({ withInsertId: true })
    const plugin = timestampsPlugin()
    const repo = plugin.extendRepository!(createFakeRepo(executor)) as any

    const results = await repo.createMany([
      { name: 'User 1', email: 'user1@example.com' },
      { name: 'User 2', email: 'user2@example.com' }
    ])

    expect(results).toHaveLength(2)
    expect(results[0].id).toBe(1)
    expect(results[1].id).toBe(2)
    for (const inserted of insertedValues) {
      expect(inserted['created_at']).toBeDefined()
    }
  })

  it('should fetch by provided primary key when insertId is absent on MySQL', async () => {
    const { executor } = createFakeMysqlExecutor({ withInsertId: false })
    const plugin = timestampsPlugin()
    const repo = plugin.extendRepository!(createFakeRepo(executor)) as any

    const results = await repo.createMany([
      { id: 10, name: 'User 10', email: 'user10@example.com' },
      { id: 20, name: 'User 20', email: 'user20@example.com' }
    ])

    expect(results).toHaveLength(2)
    expect(results[0].id).toBe(10)
    expect(results[1].id).toBe(20)
  })

  it('should support the "date" dateFormat (Date object timestamps)', async () => {
    const { executor, insertedValues } = createFakeMysqlExecutor({ withInsertId: true })
    const plugin = timestampsPlugin({ dateFormat: 'date' })
    const repo = plugin.extendRepository!(createFakeRepo(executor)) as any

    await repo.createMany([{ name: 'User 1', email: 'user1@example.com' }])

    expect(insertedValues[0]!['created_at']).toBeInstanceOf(Date)
  })
})

describe('Plugin lifecycle', () => {
  it('should support onDestroy without errors', () => {
    const plugin = timestampsPlugin()
    expect(() => plugin.onDestroy?.()).not.toThrow()
  })
})
