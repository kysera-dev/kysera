// @ts-nocheck - Test file with dynamic plugin interactions
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import sqliteConstructor from 'better-sqlite3'
import type { Database as SQLiteDatabase } from 'better-sqlite3'
import { softDeletePlugin } from '../src/index.js'
import { timestampsPlugin } from '../../timestamps/src/index.js'
import { createORM, createRepositoryFactory } from '../../repository/src/index.js'

// ============================================================================
// Test Database Schema
// ============================================================================

interface TestDatabase {
  users: {
    id: Generated<number>
    email: string
    name: string
    created_at: string | null
    updated_at: string | null
    deleted_at: string | null
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    content: string
    created_at: string | null
    updated_at: string | null
    deleted_at: string | null
  }
}

interface TestUser {
  id: number
  email: string
  name: string
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

interface TestPost {
  id: number
  user_id: number
  title: string
  content: string
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

// Passthrough schema that does not strip unknown keys.
// Unlike zodAdapter(z.object({...})), this preserves timestamp fields injected by plugins.
const passthrough = { parse: (v: any) => v } as any

// ============================================================================
// Test Utilities
// ============================================================================

function createTestDatabase(): {
  db: Kysely<TestDatabase>
  sqlite: SQLiteDatabase
  cleanup: () => void
} {
  const sqlite = new sqliteConstructor(':memory:')
  const db = new Kysely<TestDatabase>({
    dialect: new SqliteDialect({ database: sqlite })
  })
  sqlite.exec('PRAGMA foreign_keys = OFF')
  return {
    db,
    sqlite,
    cleanup: () => {
      void db.destroy()
      sqlite.close()
    }
  }
}

async function initializeTestSchema(db: Kysely<TestDatabase>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('email', 'text', col => col.notNull().unique())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('created_at', 'text')
    .addColumn('updated_at', 'text')
    .addColumn('deleted_at', 'text')
    .execute()

  await db.schema
    .createTable('posts')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', col => col.notNull())
    .addColumn('title', 'text', col => col.notNull())
    .addColumn('content', 'text', col => col.notNull())
    .addColumn('created_at', 'text')
    .addColumn('updated_at', 'text')
    .addColumn('deleted_at', 'text')
    .execute()
}

// ============================================================================
// M-17: Soft-delete + Timestamps Interaction Tests
// ============================================================================

describe('M-17: Soft-delete + Timestamps Plugin Interaction', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => void

  beforeEach(async () => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup
    await initializeTestSchema(db)
  })

  afterEach(() => {
    cleanup()
  })

  describe('Both plugins combined via createORM', () => {
    it('should extend repository with both soft-delete and timestamp methods', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()

      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      // Soft-delete methods should be present
      expect(repo.softDelete).toBeDefined()
      expect(repo.restore).toBeDefined()
      expect(repo.hardDelete).toBeDefined()
      expect(repo.findAllWithDeleted).toBeDefined()
      expect(repo.findDeleted).toBeDefined()
      expect(repo.findWithDeleted).toBeDefined()

      // Timestamp methods should be present
      expect(repo.findCreatedAfter).toBeDefined()
      expect(repo.findRecentlyCreated).toBeDefined()
      expect(repo.touch).toBeDefined()
      expect(repo.getTimestampColumns).toBeDefined()
    })

    it('should auto-set created_at when creating a record', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      const beforeCreate = new Date()
      const user = await repo.create({ email: 'alice@test.com', name: 'Alice' })

      expect(user.created_at).toBeDefined()
      expect(user.created_at).not.toBeNull()
      const createdAt = new Date(user.created_at)
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime() - 1000)
      expect(user.deleted_at).toBeNull()
    })
  })

  describe('softDelete() preserves timestamps', () => {
    it('should set deleted_at while preserving created_at', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      // Create a user with timestamps
      const user = await repo.create({ email: 'bob@test.com', name: 'Bob' })
      const originalCreatedAt = user.created_at

      expect(originalCreatedAt).toBeDefined()
      expect(originalCreatedAt).not.toBeNull()

      // Wait a small amount to get a different timestamp
      await new Promise(resolve => setTimeout(resolve, 10))

      // Soft delete the user
      const deletedUser = await repo.softDelete(user.id)

      // deleted_at should be set
      expect(deletedUser.deleted_at).not.toBeNull()
      expect(deletedUser.deleted_at).toBeDefined()

      // created_at should be preserved (unchanged)
      expect(deletedUser.created_at).toBe(originalCreatedAt)

      // Verify deleted_at is a valid timestamp
      const deletedAt = new Date(deletedUser.deleted_at)
      expect(deletedAt.getTime()).toBeGreaterThan(new Date(originalCreatedAt).getTime())
    })

    it('should set deleted_at while preserving updated_at', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      // Create and update a user
      const user = await repo.create({ email: 'carol@test.com', name: 'Carol' })
      await new Promise(resolve => setTimeout(resolve, 10))
      const updatedUser = await repo.update(user.id, { name: 'Carol Updated' })
      const originalUpdatedAt = updatedUser.updated_at

      expect(originalUpdatedAt).toBeDefined()
      expect(originalUpdatedAt).not.toBeNull()

      await new Promise(resolve => setTimeout(resolve, 10))

      // Soft delete the user
      const deletedUser = await repo.softDelete(user.id)

      // deleted_at should be set
      expect(deletedUser.deleted_at).not.toBeNull()

      // updated_at should be preserved (soft-delete only modifies deleted_at)
      expect(deletedUser.updated_at).toBe(originalUpdatedAt)
    })
  })

  describe('restore() clears deleted_at', () => {
    it('should clear deleted_at and preserve created_at on restore', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      // Create a user
      const user = await repo.create({ email: 'dave@test.com', name: 'Dave' })
      const originalCreatedAt = user.created_at

      // Soft delete
      await repo.softDelete(user.id)

      // Verify it is soft-deleted
      const deletedRecord = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .executeTakeFirst()
      expect(deletedRecord?.deleted_at).not.toBeNull()

      // Restore
      const restoredUser = await repo.restore(user.id)

      // deleted_at should be null after restore
      expect(restoredUser.deleted_at).toBeNull()

      // created_at should be preserved
      expect(restoredUser.created_at).toBe(originalCreatedAt)
    })

    it('should clear deleted_at and preserve updated_at on restore', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      // Create and update a user
      const user = await repo.create({ email: 'eve@test.com', name: 'Eve' })
      await new Promise(resolve => setTimeout(resolve, 10))
      const updatedUser = await repo.update(user.id, { name: 'Eve Updated' })
      const originalUpdatedAt = updatedUser.updated_at

      // Soft delete
      await repo.softDelete(user.id)

      // Restore
      const restoredUser = await repo.restore(user.id)

      // deleted_at should be cleared
      expect(restoredUser.deleted_at).toBeNull()

      // updated_at from before soft delete should be preserved
      expect(restoredUser.updated_at).toBe(originalUpdatedAt)
    })

    it('should allow normal queries to find restored records', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      // Create, soft-delete, restore
      const user = await repo.create({ email: 'frank@test.com', name: 'Frank' })
      await repo.softDelete(user.id)

      // After soft-delete, findAll should not include it
      const afterDelete = await repo.findAll()
      expect(afterDelete.find((u: any) => u.id === user.id)).toBeUndefined()

      // Restore
      await repo.restore(user.id)

      // After restore, findAll should include it again
      const afterRestore = await repo.findAll()
      const found = afterRestore.find((u: any) => u.id === user.id)
      expect(found).toBeDefined()
      expect(found.deleted_at).toBeNull()
      expect(found.created_at).not.toBeNull()
    })
  })

  describe('Timestamp operations after soft-delete cycle', () => {
    it('should preserve created_at through a full soft-delete and restore cycle', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      // Create
      const user = await repo.create({ email: 'grace@test.com', name: 'Grace' })
      const originalCreatedAt = user.created_at

      // Update
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.update(user.id, { name: 'Grace Updated' })

      // Soft delete
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.softDelete(user.id)

      // Restore
      await new Promise(resolve => setTimeout(resolve, 10))
      const restoredUser = await repo.restore(user.id)

      // created_at should survive the entire cycle unchanged
      expect(restoredUser.created_at).toBe(originalCreatedAt)
    })

    it('should allow updates with new updated_at after restore', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      // Create
      const user = await repo.create({ email: 'helen@test.com', name: 'Helen' })
      const originalCreatedAt = user.created_at

      // Soft delete and restore
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.softDelete(user.id)
      await repo.restore(user.id)

      // Update after restore should set a new updated_at
      await new Promise(resolve => setTimeout(resolve, 10))
      const afterRestore = await repo.update(user.id, { name: 'Helen Post-Restore' })

      expect(afterRestore.name).toBe('Helen Post-Restore')
      expect(afterRestore.updated_at).toBeDefined()
      expect(afterRestore.updated_at).not.toBeNull()
      expect(afterRestore.created_at).toBe(originalCreatedAt)

      // updated_at should be newer than created_at
      const updatedAt = new Date(afterRestore.updated_at)
      const createdAt = new Date(afterRestore.created_at)
      expect(updatedAt.getTime()).toBeGreaterThan(createdAt.getTime())
    })

    it('should support multiple soft-delete and restore cycles preserving created_at', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      const user = await repo.create({ email: 'ivan@test.com', name: 'Ivan' })
      const originalCreatedAt = user.created_at

      // Cycle 1
      await repo.softDelete(user.id)
      const restored1 = await repo.restore(user.id)
      expect(restored1.created_at).toBe(originalCreatedAt)
      expect(restored1.deleted_at).toBeNull()

      // Cycle 2
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.softDelete(user.id)
      const restored2 = await repo.restore(user.id)
      expect(restored2.created_at).toBe(originalCreatedAt)
      expect(restored2.deleted_at).toBeNull()

      // Cycle 3
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.softDelete(user.id)
      const restored3 = await repo.restore(user.id)
      expect(restored3.created_at).toBe(originalCreatedAt)
      expect(restored3.deleted_at).toBeNull()
    })
  })

  describe('findAll with both plugins', () => {
    it('should exclude soft-deleted records from findAll even with timestamps', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      // Create three users
      const alice = await repo.create({ email: 'alice@test.com', name: 'Alice' })
      const bob = await repo.create({ email: 'bob@test.com', name: 'Bob' })
      const carol = await repo.create({ email: 'carol@test.com', name: 'Carol' })

      // Soft delete Bob
      await repo.softDelete(bob.id)

      // findAll should exclude Bob
      const active = await repo.findAll()
      expect(active).toHaveLength(2)
      expect(active.map((u: any) => u.name)).toContain('Alice')
      expect(active.map((u: any) => u.name)).toContain('Carol')
      expect(active.map((u: any) => u.name)).not.toContain('Bob')

      // All active records should have created_at set
      for (const user of active) {
        expect(user.created_at).not.toBeNull()
      }
    })

    it('should include soft-deleted records in findAllWithDeleted with timestamps intact', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      const alice = await repo.create({ email: 'alice2@test.com', name: 'Alice' })
      const bob = await repo.create({ email: 'bob2@test.com', name: 'Bob' })
      await repo.softDelete(bob.id)

      const all = await repo.findAllWithDeleted()
      expect(all).toHaveLength(2)

      // All records should have created_at
      for (const user of all) {
        expect(user.created_at).not.toBeNull()
      }

      // The soft-deleted record should have deleted_at set
      const deletedBob = all.find((u: any) => u.name === 'Bob')
      expect(deletedBob).toBeDefined()
      expect(deletedBob.deleted_at).not.toBeNull()
    })
  })

  describe('Plugin order independence', () => {
    it('should work with timestamps plugin before soft-delete', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      // Timestamps first, then soft-delete
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      const user = await repo.create({ email: 'order1@test.com', name: 'Order Test 1' })
      expect(user.created_at).not.toBeNull()

      const deleted = await repo.softDelete(user.id)
      expect(deleted.deleted_at).not.toBeNull()
      expect(deleted.created_at).toBe(user.created_at)

      const restored = await repo.restore(user.id)
      expect(restored.deleted_at).toBeNull()
      expect(restored.created_at).toBe(user.created_at)
    })

    it('should work with soft-delete plugin before timestamps', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      // Soft-delete first, then timestamps
      const orm = await createORM(db, [softDelete, timestamps])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      const user = await repo.create({ email: 'order2@test.com', name: 'Order Test 2' })
      expect(user.created_at).not.toBeNull()

      const deleted = await repo.softDelete(user.id)
      expect(deleted.deleted_at).not.toBeNull()
      expect(deleted.created_at).toBe(user.created_at)

      const restored = await repo.restore(user.id)
      expect(restored.deleted_at).toBeNull()
      expect(restored.created_at).toBe(user.created_at)
    })
  })

  describe('Bulk operations with both plugins', () => {
    it('should preserve timestamps during softDeleteMany', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      const user1 = await repo.create({ email: 'bulk1@test.com', name: 'Bulk 1' })
      const user2 = await repo.create({ email: 'bulk2@test.com', name: 'Bulk 2' })
      const user3 = await repo.create({ email: 'bulk3@test.com', name: 'Bulk 3' })

      await new Promise(resolve => setTimeout(resolve, 10))

      // Soft delete multiple records
      const deleted = await repo.softDeleteMany([user1.id, user2.id])

      expect(deleted).toHaveLength(2)
      for (const record of deleted) {
        expect(record.deleted_at).not.toBeNull()
        expect(record.created_at).not.toBeNull()
      }

      // Remaining active records
      const active = await repo.findAll()
      expect(active).toHaveLength(1)
      expect(active[0].name).toBe('Bulk 3')
    })

    it('should preserve timestamps during restoreMany', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      const user1 = await repo.create({ email: 'restore1@test.com', name: 'Restore 1' })
      const user2 = await repo.create({ email: 'restore2@test.com', name: 'Restore 2' })
      const originalCreatedAt1 = user1.created_at
      const originalCreatedAt2 = user2.created_at

      // Soft delete both
      await repo.softDeleteMany([user1.id, user2.id])

      // Restore both
      const restored = await repo.restoreMany([user1.id, user2.id])

      expect(restored).toHaveLength(2)
      for (const record of restored) {
        expect(record.deleted_at).toBeNull()
        expect(record.created_at).not.toBeNull()
      }

      // created_at values should be preserved
      const r1 = restored.find((r: any) => r.id === user1.id)
      const r2 = restored.find((r: any) => r.id === user2.id)
      expect(r1.created_at).toBe(originalCreatedAt1)
      expect(r2.created_at).toBe(originalCreatedAt2)
    })
  })

  describe('Edge cases', () => {
    it('should handle soft-delete on a record that was just created (no update)', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      const user = await repo.create({ email: 'fresh@test.com', name: 'Fresh' })
      expect(user.updated_at).toBeNull() // No update yet

      const deleted = await repo.softDelete(user.id)
      expect(deleted.deleted_at).not.toBeNull()
      expect(deleted.created_at).toBe(user.created_at)
      // updated_at should still be null since soft-delete only sets deleted_at
      expect(deleted.updated_at).toBeNull()
    })

    it('should work with custom timestamp format', async () => {
      const customTimestamp = '2025-06-15T12:00:00.000Z'
      const timestamps = timestampsPlugin({ getTimestamp: () => customTimestamp })
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      const user = await repo.create({ email: 'custom@test.com', name: 'Custom' })
      expect(user.created_at).toBe(customTimestamp)

      const deleted = await repo.softDelete(user.id)
      expect(deleted.created_at).toBe(customTimestamp)
      expect(deleted.deleted_at).not.toBeNull()
    })

    it('should handle findDeleted with timestamps intact', async () => {
      const timestamps = timestampsPlugin()
      const softDelete = softDeletePlugin()
      const orm = await createORM(db, [timestamps, softDelete])

      const repo = orm.createRepository(executor => {
        const factory = createRepositoryFactory(executor)
        return factory.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: row => row as TestUser,
          schemas: {
            create: passthrough,
            update: passthrough
          }
        })
      }) as any

      const user1 = await repo.create({ email: 'del1@test.com', name: 'Del 1' })
      const user2 = await repo.create({ email: 'del2@test.com', name: 'Del 2' })
      await repo.create({ email: 'active@test.com', name: 'Active' })

      await repo.softDelete(user1.id)
      await repo.softDelete(user2.id)

      const deleted = await repo.findDeleted()
      expect(deleted).toHaveLength(2)

      for (const record of deleted) {
        expect(record.deleted_at).not.toBeNull()
        expect(record.created_at).not.toBeNull()
      }
    })
  })
})
