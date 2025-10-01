import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, sql, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import {
  testInTransaction,
  testWithSavepoints,
  cleanDatabase,
  createFactory,
  waitFor,
  seedDatabase,
  snapshotTable,
  countRows
} from '../src/testing'

interface TestDatabase {
  users: {
    id: Generated<number>
    email: string
    name: string
    created_at: Generated<string>
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    content: string | null
  }
}

describe('Testing Utilities', () => {
  let db: Kysely<TestDatabase>
  let database: Database.Database

  beforeEach(async () => {
    database = new Database(':memory:')
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({
        database
      })
    })

    // Create test tables
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('email', 'text', col => col.notNull().unique())
      .addColumn('name', 'text', col => col.notNull())
      .addColumn('created_at', 'text', col =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute()

    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('user_id', 'integer', col =>
        col.notNull().references('users.id').onDelete('cascade')
      )
      .addColumn('title', 'text', col => col.notNull())
      .addColumn('content', 'text')
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
    database.close()
  })

  describe('testInTransaction', () => {
    it('should rollback transaction after test', async () => {
      // Test creates user
      await testInTransaction(db, async (trx) => {
        const user = await trx
          .insertInto('users')
          .values({
            email: 'test@example.com',
            name: 'Test User'
          })
          .returningAll()
          .executeTakeFirst()

        expect(user).toBeDefined()
        expect(user?.email).toBe('test@example.com')
      })

      // Verify user was rolled back
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(0)
    })

    it('should handle multiple operations', async () => {
      await testInTransaction(db, async (trx) => {
        // Create user
        const user = await trx
          .insertInto('users')
          .values({
            email: 'author@example.com',
            name: 'Author'
          })
          .returningAll()
          .executeTakeFirst()

        expect(user).toBeDefined()

        // Create post
        const post = await trx
          .insertInto('posts')
          .values({
            user_id: user!.id,
            title: 'Test Post',
            content: 'Content'
          })
          .returningAll()
          .executeTakeFirst()

        expect(post).toBeDefined()
        expect(post?.user_id).toBe(user!.id)
      })

      // Verify everything was rolled back
      const users = await db.selectFrom('users').selectAll().execute()
      const posts = await db.selectFrom('posts').selectAll().execute()

      expect(users).toHaveLength(0)
      expect(posts).toHaveLength(0)
    })

    it('should propagate errors from test function', async () => {
      await expect(
        testInTransaction(db, async (trx) => {
          await trx
            .insertInto('users')
            .values({
              email: 'test@example.com',
              name: 'Test'
            })
            .execute()

          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')

      // Verify rollback still happened
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(0)
    })

    it('should allow reading data within transaction', async () => {
      await testInTransaction(db, async (trx) => {
        // Create user
        await trx
          .insertInto('users')
          .values({
            email: 'test@example.com',
            name: 'Test'
          })
          .execute()

        // Read it back within same transaction
        const users = await trx.selectFrom('users').selectAll().execute()
        expect(users).toHaveLength(1)
        expect(users[0]?.email).toBe('test@example.com')
      })
    })

    it('should handle concurrent test runs', async () => {
      // Run multiple tests in parallel
      await Promise.all([
        testInTransaction(db, async (trx) => {
          await trx
            .insertInto('users')
            .values({
              email: 'user1@example.com',
              name: 'User 1'
            })
            .execute()

          const users = await trx.selectFrom('users').selectAll().execute()
          expect(users).toHaveLength(1)
        }),
        testInTransaction(db, async (trx) => {
          await trx
            .insertInto('users')
            .values({
              email: 'user2@example.com',
              name: 'User 2'
            })
            .execute()

          const users = await trx.selectFrom('users').selectAll().execute()
          expect(users).toHaveLength(1)
        })
      ])

      // Verify all transactions were rolled back
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(0)
    })
  })

  describe('testWithSavepoints', () => {
    it('should support savepoint operations', async () => {
      await testWithSavepoints(db, async (trx) => {
        // Create user
        const user = await trx
          .insertInto('users')
          .values({
            email: 'test@example.com',
            name: 'Test'
          })
          .returningAll()
          .executeTakeFirst()

        expect(user).toBeDefined()

        // User should exist within transaction
        const users = await trx.selectFrom('users').selectAll().execute()
        expect(users).toHaveLength(1)
      })

      // Verify rollback
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(0)
    })

    it('should handle nested savepoints', async () => {
      await testWithSavepoints(db, async (trx) => {
        await trx
          .insertInto('users')
          .values({
            email: 'user1@example.com',
            name: 'User 1'
          })
          .execute()

        // Create nested savepoint
        await sql`SAVEPOINT nested`.execute(trx)

        await trx
          .insertInto('users')
          .values({
            email: 'user2@example.com',
            name: 'User 2'
          })
          .execute()

        // Rollback nested savepoint
        await sql`ROLLBACK TO SAVEPOINT nested`.execute(trx)

        // Only first user should exist
        const users = await trx.selectFrom('users').selectAll().execute()
        expect(users).toHaveLength(1)
        expect(users[0]?.email).toBe('user1@example.com')
      })
    })
  })

  describe('cleanDatabase', () => {
    it('should clean database with delete strategy', async () => {
      // Insert test data
      await db
        .insertInto('users')
        .values([
          { email: 'user1@example.com', name: 'User 1' },
          { email: 'user2@example.com', name: 'User 2' }
        ])
        .execute()

      const user = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', 'user1@example.com')
        .executeTakeFirst()

      await db
        .insertInto('posts')
        .values({
          user_id: user!.id,
          title: 'Post',
          content: null
        })
        .execute()

      // Clean with delete strategy (reverse FK order)
      await cleanDatabase(db, 'delete', ['posts', 'users'])

      // Verify clean
      const users = await db.selectFrom('users').selectAll().execute()
      const posts = await db.selectFrom('posts').selectAll().execute()

      expect(users).toHaveLength(0)
      expect(posts).toHaveLength(0)
    })

    it('should require tables for delete strategy', async () => {
      await expect(cleanDatabase(db, 'delete')).rejects.toThrow()
    })

    it('should be no-op for transaction strategy', async () => {
      await db
        .insertInto('users')
        .values({
          email: 'test@example.com',
          name: 'Test'
        })
        .execute()

      await cleanDatabase(db, 'transaction')

      // Data should still exist
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(1)
    })
  })

  describe('createFactory', () => {
    it('should create factory with default values', () => {
      const createUser = createFactory<{ id: number; email: string; name: string }>({
        id: 1,
        email: 'default@example.com',
        name: 'Default User'
      })

      const user = createUser()
      expect(user).toEqual({
        id: 1,
        email: 'default@example.com',
        name: 'Default User'
      })
    })

    it('should allow overriding defaults', () => {
      const createUser = createFactory<{ id: number; email: string; name: string }>({
        id: 1,
        email: 'default@example.com',
        name: 'Default User'
      })

      const user = createUser({ name: 'Custom Name', id: 999 })
      expect(user).toEqual({
        id: 999,
        email: 'default@example.com',
        name: 'Custom Name'
      })
    })

    it('should support function defaults', () => {
      let counter = 0

      const createUser = createFactory<{ id: number; email: string }>({
        id: () => ++counter,
        email: () => `user${counter}@example.com`
      })

      const user1 = createUser()
      const user2 = createUser()

      expect(user1.id).toBe(1)
      expect(user1.email).toBe('user1@example.com')
      expect(user2.id).toBe(2)
      expect(user2.email).toBe('user2@example.com')
    })

    it('should handle mixed values and functions', () => {
      const createUser = createFactory<{
        id: number
        email: string
        name: string
        created_at: Date
      }>({
        id: 1,
        email: () => `test${Date.now()}@example.com`,
        name: 'Test User',
        created_at: () => new Date()
      })

      const user = createUser()

      expect(user.id).toBe(1)
      expect(user.email).toContain('@example.com')
      expect(user.name).toBe('Test User')
      expect(user.created_at).toBeInstanceOf(Date)
    })
  })

  describe('waitFor', () => {
    it('should wait for condition to be true', async () => {
      let ready = false

      setTimeout(() => {
        ready = true
      }, 100)

      await waitFor(() => ready, { timeout: 1000, interval: 10 })

      expect(ready).toBe(true)
    })

    it('should timeout if condition not met', async () => {
      await expect(
        waitFor(() => false, { timeout: 100, interval: 10 })
      ).rejects.toThrow('Condition not met within timeout')
    })

    it('should support async conditions', async () => {
      setTimeout(async () => {
        await db
          .insertInto('users')
          .values({
            email: 'test@example.com',
            name: 'Test'
          })
          .execute()
      }, 100)

      await waitFor(
        async () => {
          const users = await db.selectFrom('users').selectAll().execute()
          return users.length > 0
        },
        { timeout: 1000, interval: 50 }
      )

      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(1)
    })

    it('should support custom timeout message', async () => {
      await expect(
        waitFor(() => false, {
          timeout: 100,
          timeoutMessage: 'Custom error message'
        })
      ).rejects.toThrow('Custom error message')
    })
  })

  describe('seedDatabase', () => {
    it('should seed database with test data', async () => {
      await seedDatabase(db, async (trx) => {
        await trx
          .insertInto('users')
          .values([
            { email: 'user1@example.com', name: 'User 1' },
            { email: 'user2@example.com', name: 'User 2' },
            { email: 'user3@example.com', name: 'User 3' }
          ])
          .execute()
      })

      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(3)
    })

    it('should rollback on error', async () => {
      await expect(
        seedDatabase(db, async (trx) => {
          await trx
            .insertInto('users')
            .values({
              email: 'test@example.com',
              name: 'Test'
            })
            .execute()

          throw new Error('Seeding failed')
        })
      ).rejects.toThrow('Seeding failed')

      // Verify rollback
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(0)
    })
  })

  describe('snapshotTable', () => {
    it('should snapshot table state', async () => {
      await db
        .insertInto('users')
        .values([
          { email: 'user1@example.com', name: 'User 1' },
          { email: 'user2@example.com', name: 'User 2' }
        ])
        .execute()

      const snapshot = await snapshotTable(db, 'users')

      expect(snapshot).toHaveLength(2)
      expect(snapshot[0]).toHaveProperty('email')
      expect(snapshot[0]).toHaveProperty('name')
    })

    it('should return empty array for empty table', async () => {
      const snapshot = await snapshotTable(db, 'users')
      expect(snapshot).toEqual([])
    })
  })

  describe('countRows', () => {
    it('should count rows in table', async () => {
      await db
        .insertInto('users')
        .values([
          { email: 'user1@example.com', name: 'User 1' },
          { email: 'user2@example.com', name: 'User 2' },
          { email: 'user3@example.com', name: 'User 3' }
        ])
        .execute()

      const count = await countRows(db, 'users')
      expect(count).toBe(3)
    })

    it('should return 0 for empty table', async () => {
      const count = await countRows(db, 'users')
      expect(count).toBe(0)
    })
  })

  describe('Integration: Real-world testing pattern', () => {
    it('should support complex test scenario', async () => {
      // Use factory to create test data
      let emailCounter = 0
      const createUser = createFactory<{
        email: string
        name: string
      }>({
        email: () => `user${Date.now()}_${++emailCounter}@example.com`,
        name: 'Test User'
      })

      await testInTransaction(db, async (trx) => {
        // Create multiple users
        const user1Data = createUser({ name: 'Alice' })
        const user2Data = createUser({ name: 'Bob' })

        const user1 = await trx
          .insertInto('users')
          .values(user1Data)
          .returningAll()
          .executeTakeFirst()

        const user2 = await trx
          .insertInto('users')
          .values(user2Data)
          .returningAll()
          .executeTakeFirst()

        // Create posts
        await trx
          .insertInto('posts')
          .values([
            {
              user_id: user1!.id,
              title: 'Post 1',
              content: 'Content 1'
            },
            {
              user_id: user2!.id,
              title: 'Post 2',
              content: 'Content 2'
            }
          ])
          .execute()

        // Verify within transaction
        const users = await trx.selectFrom('users').selectAll().execute()
        const posts = await trx.selectFrom('posts').selectAll().execute()

        expect(users).toHaveLength(2)
        expect(posts).toHaveLength(2)

        // Verify relationships
        const postsWithUsers = await trx
          .selectFrom('posts')
          .innerJoin('users', 'users.id', 'posts.user_id')
          .selectAll('posts')
          .select(['users.name as author_name'])
          .execute()

        expect(postsWithUsers).toHaveLength(2)
        expect(postsWithUsers.map(p => (p as any).author_name).sort()).toEqual([
          'Alice',
          'Bob'
        ])
      })

      // Everything rolled back automatically
      const users = await db.selectFrom('users').selectAll().execute()
      const posts = await db.selectFrom('posts').selectAll().execute()

      expect(users).toHaveLength(0)
      expect(posts).toHaveLength(0)
    })
  })
})
