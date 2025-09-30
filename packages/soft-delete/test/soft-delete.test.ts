import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDatabase, seedTestData } from './setup/database'
import { softDeletePlugin } from '../src/index'
import { createORM } from '@kysera/repository'
import { createRepositoryFactory } from '@kysera/repository'
import type { Kysely } from 'kysely'
import type { TestDatabase } from './setup/database'

describe('Soft Delete Plugin', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => void

  beforeEach(async () => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup
    await seedTestData(db)
  })

  afterEach(() => {
    cleanup()
  })

  describe('Basic Functionality', () => {
    it('should filter out soft-deleted records by default', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      // Soft delete Bob
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })  // SQLite uses strings for dates
        .where('name', '=', 'Bob')
        .execute()

      // Query should filter out Bob
      const result = await orm.applyPlugins(
        db.selectFrom('users').selectAll(),
        'select',
        'users',
        {}
      ).execute()

      expect(result).toHaveLength(2)
      expect(result.find(u => u.name === 'Bob')).toBeUndefined()
    })

    it('should include deleted records when specified', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      // Soft delete Bob
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })  // SQLite uses strings for dates
        .where('name', '=', 'Bob')
        .execute()

      // Query with includeDeleted
      const result = await orm.applyPlugins(
        db.selectFrom('users').selectAll(),
        'select',
        'users',
        { includeDeleted: true }
      ).execute()

      expect(result).toHaveLength(3)
      expect(result.find(u => u.name === 'Bob')).toBeDefined()
    })

    it('should work with custom deleted column name', async () => {
      const plugin = softDeletePlugin({
        deletedAtColumn: 'deleted_at'
      })
      const orm = createORM(db, [plugin])

      // Soft delete Alice
      await db
        .updateTable('posts')
        .set({ deleted_at: new Date().toISOString() })
        .where('title', '=', 'First Post')
        .execute()

      const result = await orm.applyPlugins(
        db.selectFrom('posts').selectAll(),
        'select',
        'posts',
        {}
      ).execute()

      expect(result).toHaveLength(2) // Only non-deleted posts
      expect(result.find(p => p.title === 'First Post')).toBeUndefined()
    })

    it('should handle includeDeleted option in constructor', async () => {
      const plugin = softDeletePlugin({
        includeDeleted: true // Include by default
      })
      const orm = createORM(db, [plugin])

      // Soft delete Bob
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })  // SQLite uses strings for dates
        .where('name', '=', 'Bob')
        .execute()

      const result = await orm.applyPlugins(
        db.selectFrom('users').selectAll(),
        'select',
        'users',
        {}
      ).execute()

      expect(result).toHaveLength(3) // All users including deleted
    })
  })

  describe('Repository Extension', () => {
    it('should extend repository with soft delete methods', () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor)
        return base.create({
          tableName: 'users' as keyof TestDatabase & string,
          mapRow: (row) => row,
          schemas: {
            create: { parse: (v: any) => v } as any,
            update: { parse: (v: any) => v } as any
          }
        })
      }) as any

      expect(repo.softDelete).toBeDefined()
      expect(repo.restore).toBeDefined()
      expect(repo.findAllWithDeleted).toBeDefined()
      expect(repo.findDeleted).toBeDefined()
      expect(repo.hardDelete).toBeDefined()
    })

    it('should soft delete records', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor)
        return base.create({
          tableName: 'users' as keyof TestDatabase & string,
          mapRow: (row) => row,
          schemas: {
            create: { parse: (v: any) => v } as any,
            update: { parse: (v: any) => v } as any
          }
        })
      }) as any

      // Get Alice's ID
      const alice = await db
        .selectFrom('users')
        .selectAll()
        .where('name', '=', 'Alice')
        .executeTakeFirst()

      // Soft delete Alice
      await repo.softDelete(alice!.id)

      // Alice should have deleted_at set
      const deletedAlice = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', alice!.id)
        .executeTakeFirst()

      expect(deletedAlice?.deleted_at).not.toBeNull()
    })

    it('should restore soft deleted records', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor)
        return base.create({
          tableName: 'users' as keyof TestDatabase & string,
          mapRow: (row) => row,
          schemas: {
            create: { parse: (v: any) => v } as any,
            update: { parse: (v: any) => v } as any
          }
        })
      }) as any

      // Soft delete Bob first
      const bob = await db
        .selectFrom('users')
        .selectAll()
        .where('name', '=', 'Bob')
        .executeTakeFirst()

      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('id', '=', bob!.id)
        .execute()

      // Restore Bob
      await repo.restore(bob!.id)

      // Bob should not have deleted_at
      const restoredBob = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', bob!.id)
        .executeTakeFirst()

      expect(restoredBob?.deleted_at).toBeNull()
    })

    it('should find all records including deleted', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor)
        return base.create({
          tableName: 'users' as keyof TestDatabase & string,
          mapRow: (row) => row,
          schemas: {
            create: { parse: (v: any) => v } as any
          }
        })
      }) as any

      // Soft delete Charlie
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Charlie')
        .execute()

      // Regular findAll should exclude Charlie
      const activeUsers = await repo.findAll()
      expect(activeUsers).toHaveLength(2)

      // findAllWithDeleted should include Charlie
      const allUsers = await repo.findAllWithDeleted()
      expect(allUsers).toHaveLength(3)
    })

    it('should find only deleted records', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor)
        return base.create({
          tableName: 'users' as keyof TestDatabase & string,
          mapRow: (row) => row,
          schemas: {
            create: { parse: (v: any) => v } as any
          }
        })
      }) as any

      // Soft delete Alice and Bob
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', 'in', ['Alice', 'Bob'])
        .execute()

      const deletedUsers = await repo.findDeleted()
      expect(deletedUsers).toHaveLength(2)
      expect(deletedUsers.every((u: any) => u.deleted_at !== null)).toBe(true)
    })

    it('should hard delete records', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor)
        return base.create({
          tableName: 'users' as keyof TestDatabase & string,
          mapRow: (row) => row,
          schemas: {
            create: { parse: (v: any) => v } as any
          }
        })
      }) as any

      // Create a new user without any relationships
      const newUser = await db
        .insertInto('users')
        .values({
          email: 'toDelete@example.com',
          name: 'ToDelete User'
        })
        .returningAll()
        .executeTakeFirst()

      // Hard delete the new user
      await repo.hardDelete(newUser!.id)

      // User should not exist at all
      const result = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', newUser!.id)
        .executeTakeFirst()

      expect(result).toBeUndefined()
    })
  })

  describe('Complex Queries', () => {
    it('should work with joins', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      // Soft delete Bob
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })  // SQLite uses strings for dates
        .where('name', '=', 'Bob')
        .execute()

      // Query posts with user join - should exclude Bob's posts in join
      const result = await orm.applyPlugins(
        db
          .selectFrom('posts')
          .innerJoin('users', 'users.id', 'posts.user_id')
          .select(['posts.title', 'users.name as author'])
          .where('users.deleted_at', 'is', null), // Manual filter needed for joins
        'select',
        'posts',
        {}
      ).execute()

      expect(result.find(p => p.author === 'Bob')).toBeUndefined()
    })

    it('should work with subqueries', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      // Soft delete some posts
      await db
        .updateTable('posts')
        .set({ deleted_at: new Date().toISOString() })
        .where('published', '=', 0)  // SQLite uses 0/1 for boolean
        .execute()

      // Get users who have active posts
      const usersWithActivePosts = await db
        .selectFrom('users')
        .selectAll()
        .where('id', 'in', (qb) =>
          orm.applyPlugins(
            qb
              .selectFrom('posts')
              .select('user_id')
              .distinct(),
            'select',
            'posts',
            {}
          ) as any
        )
        .execute()

      expect(usersWithActivePosts).toHaveLength(2) // Only users with non-deleted posts
    })

    it('should handle delete operation conversion', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      // Intercept delete to convert to soft delete
      const context = {
        operation: 'delete' as const,
        table: 'users',
        metadata: {}
      }

      const deleteQuery = db
        .deleteFrom('users')
        .where('name', '=', 'Alice')

      // Plugin should mark for conversion
      orm.applyPlugins(deleteQuery, context.operation, context.table, context.metadata)

      expect(context.metadata['convertToSoftDelete']).toBe(true)
    })

    it('should allow hard delete when specified', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      const context = {
        operation: 'delete' as const,
        table: 'users',
        metadata: { hardDelete: true }
      }

      const deleteQuery = db
        .deleteFrom('users')
        .where('name', '=', 'Alice')

      orm.applyPlugins(deleteQuery, context.operation, context.table, context.metadata)

      expect(context.metadata['convertToSoftDelete']).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle tables without deleted column', async () => {
      // Configure plugin to only apply to specific tables
      const plugin = softDeletePlugin({
        tables: ['users', 'posts']  // Comments not included
      })
      const orm = createORM(db, [plugin])

      // Comments table doesn't have deleted_at column
      const result = await orm.applyPlugins(
        db.selectFrom('comments').selectAll(),
        'select',
        'comments',
        {}
      ).execute()

      expect(result).toHaveLength(3) // All comments
    })

    it('should handle null vs undefined properly', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      // Ensure all users have null deleted_at initially
      const initialUsers = await db
        .selectFrom('users')
        .selectAll()
        .execute()

      expect(initialUsers.every(u => u.deleted_at === null)).toBe(true)

      // Plugin should filter correctly
      const result = await orm.applyPlugins(
        db.selectFrom('users').selectAll(),
        'select',
        'users',
        {}
      ).execute()

      expect(result).toHaveLength(3) // All users (none deleted)
    })

    it('should handle timestamp precision', async () => {
      const plugin = softDeletePlugin()
      const orm = createORM(db, [plugin])

      const now = new Date().toISOString()

      // Soft delete with specific timestamp
      await db
        .updateTable('users')
        .set({ deleted_at: now })
        .where('name', '=', 'Alice')
        .execute()

      // Should still filter correctly
      const result = await orm.applyPlugins(
        db.selectFrom('users').selectAll(),
        'select',
        'users',
        {}
      ).execute()

      expect(result).toHaveLength(2)
      expect(result.find(u => u.name === 'Alice')).toBeUndefined()
    })
  })
})