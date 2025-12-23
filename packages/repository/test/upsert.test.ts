import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDatabase } from './setup/database.js'
import { upsert, upsertMany } from '../src/index.js'
import type { Kysely } from 'kysely'
import type { TestDatabase } from './setup/database.js'

describe('Upsert Helpers', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => void

  beforeEach(() => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup
  })

  afterEach(() => {
    cleanup()
  })

  describe('upsert', () => {
    it('should insert a new record when no conflict exists', async () => {
      const result = await upsert(
        db,
        'users',
        {
          email: 'alice@example.com',
          name: 'Alice'
        },
        {
          conflictColumns: ['email'],
          returning: true
        }
      )

      expect(result).toBeDefined()
      expect(result?.email).toBe('alice@example.com')
      expect(result?.name).toBe('Alice')
      expect(result?.id).toBeDefined()
    })

    it('should update existing record on conflict', async () => {
      // First insert
      await db
        .insertInto('users')
        .values({
          email: 'bob@example.com',
          name: 'Bob Original'
        })
        .execute()

      // Upsert with same email
      const result = await upsert(
        db,
        'users',
        {
          email: 'bob@example.com',
          name: 'Bob Updated'
        },
        {
          conflictColumns: ['email'],
          returning: true
        }
      )

      expect(result).toBeDefined()
      expect(result?.email).toBe('bob@example.com')
      expect(result?.name).toBe('Bob Updated')

      // Verify only one record exists
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(1)
      expect(users[0]?.name).toBe('Bob Updated')
    })

    it('should work with single primary key', async () => {
      // Insert initial post
      const user = await db
        .insertInto('users')
        .values({ email: 'charlie@example.com', name: 'Charlie' })
        .returningAll()
        .executeTakeFirstOrThrow()

      const post = await db
        .insertInto('posts')
        .values({
          user_id: user.id,
          title: 'Original Title',
          content: 'Original content',
          published: 0
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      // Upsert using primary key
      const result = await upsert(
        db,
        'posts',
        {
          id: post.id,
          user_id: user.id,
          title: 'Original Title',
          content: 'Updated content',
          published: 1
        },
        {
          conflictColumns: ['id'],
          returning: true
        }
      )

      expect(result).toBeDefined()
      expect(result?.content).toBe('Updated content')
      expect(result?.id).toBe(post.id)
    })

    it('should update only specified columns when updateColumns is provided', async () => {
      // Insert initial user
      await db
        .insertInto('users')
        .values({
          email: 'diana@example.com',
          name: 'Diana'
        })
        .execute()

      // Upsert with updateColumns limiting what gets updated
      const result = await upsert(
        db,
        'users',
        {
          email: 'diana@example.com',
          name: 'Diana Updated'
        },
        {
          conflictColumns: ['email'],
          updateColumns: ['name'], // Only update name
          returning: true
        }
      )

      expect(result).toBeDefined()
      expect(result?.email).toBe('diana@example.com')
      expect(result?.name).toBe('Diana Updated')
    })

    it('should work without returning when returning is false', async () => {
      const result = await upsert(
        db,
        'users',
        {
          email: 'eve@example.com',
          name: 'Eve'
        },
        {
          conflictColumns: ['email'],
          returning: false
        }
      )

      expect(result).toBeUndefined()

      // Verify record was created
      const user = await db
        .selectFrom('users')
        .where('email', '=', 'eve@example.com')
        .selectAll()
        .executeTakeFirst()

      expect(user).toBeDefined()
      expect(user?.name).toBe('Eve')
    })

    it('should work without returning when returning is not specified (defaults to false)', async () => {
      const result = await upsert(
        db,
        'users',
        {
          email: 'frank@example.com',
          name: 'Frank'
        },
        {
          conflictColumns: ['email']
        }
      )

      expect(result).toBeUndefined()

      // Verify record was created
      const user = await db
        .selectFrom('users')
        .where('email', '=', 'frank@example.com')
        .selectAll()
        .executeTakeFirst()

      expect(user).toBeDefined()
      expect(user?.name).toBe('Frank')
    })

    it('should update all columns except conflict columns when updateColumns is not specified', async () => {
      // Insert initial user
      await db
        .insertInto('users')
        .values({
          email: 'grace@example.com',
          name: 'Grace Original'
        })
        .execute()

      // Upsert without specifying updateColumns
      const result = await upsert(
        db,
        'users',
        {
          email: 'grace@example.com',
          name: 'Grace Updated'
        },
        {
          conflictColumns: ['email'],
          returning: true
        }
      )

      expect(result).toBeDefined()
      expect(result?.email).toBe('grace@example.com')
      expect(result?.name).toBe('Grace Updated')
    })
  })

  describe('upsertMany', () => {
    it('should insert multiple new records when no conflicts exist', async () => {
      const data = [
        { email: 'user1@example.com', name: 'User 1' },
        { email: 'user2@example.com', name: 'User 2' },
        { email: 'user3@example.com', name: 'User 3' }
      ]

      const results = await upsertMany(db, 'users', data, {
        conflictColumns: ['email'],
        returning: true
      })

      expect(results).toHaveLength(3)
      expect(results?.map(r => r.email)).toEqual([
        'user1@example.com',
        'user2@example.com',
        'user3@example.com'
      ])
    })

    it('should update existing records on conflict', async () => {
      // Insert initial users
      await db
        .insertInto('users')
        .values([
          { email: 'alice@example.com', name: 'Alice Original' },
          { email: 'bob@example.com', name: 'Bob Original' }
        ])
        .execute()

      // Upsert with same emails
      const data = [
        { email: 'alice@example.com', name: 'Alice Updated' },
        { email: 'bob@example.com', name: 'Bob Updated' },
        { email: 'charlie@example.com', name: 'Charlie New' }
      ]

      const results = await upsertMany(db, 'users', data, {
        conflictColumns: ['email'],
        returning: true
      })

      expect(results).toHaveLength(3)

      // Verify updates
      const alice = results?.find(r => r.email === 'alice@example.com')
      const bob = results?.find(r => r.email === 'bob@example.com')
      const charlie = results?.find(r => r.email === 'charlie@example.com')

      expect(alice?.name).toBe('Alice Updated')
      expect(bob?.name).toBe('Bob Updated')
      expect(charlie?.name).toBe('Charlie New')

      // Verify total count
      const allUsers = await db.selectFrom('users').selectAll().execute()
      expect(allUsers).toHaveLength(3)
    })

    it('should handle empty array', async () => {
      const results = await upsertMany(db, 'users', [], {
        conflictColumns: ['email'],
        returning: true
      })

      expect(results).toEqual([])
    })

    it('should work without returning when returning is false', async () => {
      const data = [
        { email: 'user1@example.com', name: 'User 1' },
        { email: 'user2@example.com', name: 'User 2' }
      ]

      const result = await upsertMany(db, 'users', data, {
        conflictColumns: ['email'],
        returning: false
      })

      expect(result).toBeUndefined()

      // Verify records were created
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(2)
    })

    it('should update only specified columns when updateColumns is provided', async () => {
      // Insert initial users
      await db
        .insertInto('users')
        .values([
          { email: 'diana@example.com', name: 'Diana' },
          { email: 'eve@example.com', name: 'Eve' }
        ])
        .execute()

      // Upsert with updateColumns
      const data = [
        { email: 'diana@example.com', name: 'Diana Updated' },
        { email: 'eve@example.com', name: 'Eve Updated' }
      ]

      const results = await upsertMany(db, 'users', data, {
        conflictColumns: ['email'],
        updateColumns: ['name'],
        returning: true
      })

      expect(results).toHaveLength(2)
      expect(results?.every(r => r.name.includes('Updated'))).toBe(true)
    })

    it('should handle large batch upserts', async () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        email: `user${i}@example.com`,
        name: `User ${i}`
      }))

      const results = await upsertMany(db, 'users', data, {
        conflictColumns: ['email'],
        returning: true
      })

      expect(results).toHaveLength(100)

      // Verify all records exist
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(100)
    })

    it('should work in transactions', async () => {
      await db.transaction().execute(async trx => {
        const data = [
          { email: 'trx1@example.com', name: 'Transaction User 1' },
          { email: 'trx2@example.com', name: 'Transaction User 2' }
        ]

        const results = await upsertMany(trx, 'users', data, {
          conflictColumns: ['email'],
          returning: true
        })

        expect(results).toHaveLength(2)
      })

      // Verify transaction was committed
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(2)
    })

    it('should rollback on transaction failure', async () => {
      try {
        await db.transaction().execute(async trx => {
          const data = [
            { email: 'fail1@example.com', name: 'Fail User 1' },
            { email: 'fail2@example.com', name: 'Fail User 2' }
          ]

          await upsertMany(trx, 'users', data, {
            conflictColumns: ['email']
          })

          // Force rollback
          throw new Error('Rollback test')
        })
      } catch (error: any) {
        expect(error.message).toBe('Rollback test')
      }

      // Verify rollback - no records should exist
      const users = await db.selectFrom('users').selectAll().execute()
      expect(users).toHaveLength(0)
    })

    it('should handle mixed insert and update operations', async () => {
      // Insert some initial users
      await db
        .insertInto('users')
        .values([
          { email: 'existing1@example.com', name: 'Existing 1' },
          { email: 'existing2@example.com', name: 'Existing 2' }
        ])
        .execute()

      // Upsert with mix of existing and new
      const data = [
        { email: 'existing1@example.com', name: 'Updated 1' },
        { email: 'new1@example.com', name: 'New 1' },
        { email: 'existing2@example.com', name: 'Updated 2' },
        { email: 'new2@example.com', name: 'New 2' }
      ]

      const results = await upsertMany(db, 'users', data, {
        conflictColumns: ['email'],
        returning: true
      })

      expect(results).toHaveLength(4)

      // Verify all records
      const allUsers = await db.selectFrom('users').selectAll().execute()
      expect(allUsers).toHaveLength(4)

      // Verify updates
      const updated1 = allUsers.find(u => u.email === 'existing1@example.com')
      const updated2 = allUsers.find(u => u.email === 'existing2@example.com')
      expect(updated1?.name).toBe('Updated 1')
      expect(updated2?.name).toBe('Updated 2')
    })
  })

  describe('edge cases', () => {
    it('should handle null values in data', async () => {
      const result = await upsert(
        db,
        'users',
        {
          email: 'null@example.com',
          name: 'Null Test',
          deleted_at: null
        },
        {
          conflictColumns: ['email'],
          returning: true
        }
      )

      expect(result).toBeDefined()
      expect(result?.deleted_at).toBeNull()
    })

    it('should handle updates with null values', async () => {
      // Insert initial user
      await db
        .insertInto('users')
        .values({
          email: 'nullable@example.com',
          name: 'Original Name',
          deleted_at: null
        })
        .execute()

      // Update with null preserved
      const result = await upsert(
        db,
        'users',
        {
          email: 'nullable@example.com',
          name: 'Updated Name',
          deleted_at: null
        },
        {
          conflictColumns: ['email'],
          returning: true
        }
      )

      expect(result?.name).toBe('Updated Name')
      expect(result?.deleted_at).toBeNull()
    })
  })
})
