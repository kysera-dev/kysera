import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDatabase, seedTestData } from './setup/database.js'
import { executeCount, executeGroupedCount } from '../src/helpers.js'
import type { Kysely } from 'kysely'
import type { TestDatabase } from './setup/database.js'

describe('Count Helpers', () => {
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

  describe('executeCount', () => {
    it('should count all rows in a table', async () => {
      const count = await executeCount(db.selectFrom('users').selectAll())

      expect(count).toBe(3)
    })

    it('should count all posts', async () => {
      const count = await executeCount(db.selectFrom('posts').selectAll())

      expect(count).toBe(3)
    })

    it('should count all comments', async () => {
      const count = await executeCount(db.selectFrom('comments').selectAll())

      expect(count).toBe(3)
    })

    it('should count with simple WHERE clause filter', async () => {
      const count = await executeCount(
        db.selectFrom('posts').selectAll().where('published', '=', 1)
      )

      expect(count).toBe(2) // Only 2 published posts
    })

    it('should count with multiple WHERE clause filters', async () => {
      const count = await executeCount(
        db.selectFrom('posts').selectAll().where('published', '=', 1).where('user_id', '=', 1) // Alice's posts
      )

      expect(count).toBe(1) // Only 1 published post by Alice
    })

    it('should count with equality filter', async () => {
      const count = await executeCount(
        db.selectFrom('users').selectAll().where('email', '=', 'alice@example.com')
      )

      expect(count).toBe(1)
    })

    it('should count with LIKE filter', async () => {
      const count = await executeCount(
        db.selectFrom('users').selectAll().where('name', 'like', '%o%')
      )

      expect(count).toBe(1) // Only Bob has 'o' in name
    })

    it('should count with comparison operators', async () => {
      const count = await executeCount(db.selectFrom('posts').selectAll().where('id', '>', 1))

      expect(count).toBe(2) // Posts with id > 1
    })

    it('should count with JOIN', async () => {
      const count = await executeCount(
        db.selectFrom('posts').innerJoin('users', 'users.id', 'posts.user_id').selectAll('posts')
      )

      expect(count).toBe(3) // All posts joined with users
    })

    it('should count with JOIN and filter on joined table', async () => {
      const count = await executeCount(
        db
          .selectFrom('posts')
          .innerJoin('users', 'users.id', 'posts.user_id')
          .selectAll('posts')
          .where('users.name', '=', 'Alice')
      )

      expect(count).toBe(2) // Alice has 2 posts
    })

    it('should count with multiple JOINs', async () => {
      const count = await executeCount(
        db
          .selectFrom('comments')
          .innerJoin('posts', 'posts.id', 'comments.post_id')
          .innerJoin('users', 'users.id', 'comments.user_id')
          .selectAll('comments')
      )

      expect(count).toBe(3) // All comments with their posts and users
    })

    it('should return 0 for empty table', async () => {
      // Clear all data
      await db.deleteFrom('comments').execute()
      await db.deleteFrom('posts').execute()
      await db.deleteFrom('users').execute()

      const count = await executeCount(db.selectFrom('users').selectAll())

      expect(count).toBe(0)
    })

    it('should return 0 when WHERE clause matches no rows', async () => {
      const count = await executeCount(
        db.selectFrom('users').selectAll().where('email', '=', 'nonexistent@example.com')
      )

      expect(count).toBe(0)
    })

    it('should return 0 for JOIN with no matches', async () => {
      const count = await executeCount(
        db
          .selectFrom('posts')
          .innerJoin('users', 'users.id', 'posts.user_id')
          .selectAll('posts')
          .where('users.name', '=', 'Nonexistent')
      )

      expect(count).toBe(0)
    })

    it('should count with complex nested conditions', async () => {
      const count = await executeCount(
        db
          .selectFrom('posts')
          .selectAll()
          .where(eb => eb.or([eb('published', '=', 1), eb('title', 'like', '%Second%')]))
      )

      expect(count).toBe(3) // 2 published + 1 with "Second" in title (but one is both)
    })

    it('should count with IN clause', async () => {
      const count = await executeCount(
        db.selectFrom('users').selectAll().where('name', 'in', ['Alice', 'Bob'])
      )

      expect(count).toBe(2)
    })

    it('should count with NOT condition', async () => {
      const count = await executeCount(
        db.selectFrom('posts').selectAll().where('published', '!=', 1)
      )

      expect(count).toBe(1) // Only 1 unpublished post
    })

    it('should count with null check', async () => {
      const count = await executeCount(
        db.selectFrom('users').selectAll().where('deleted_at', 'is', null)
      )

      expect(count).toBe(3) // All users have null deleted_at
    })

    it('should work with LEFT JOIN', async () => {
      // Add a user without posts first
      await db.insertInto('users').values({ email: 'lonely@example.com', name: 'Lonely' }).execute()

      const count = await executeCount(
        db.selectFrom('users').leftJoin('posts', 'posts.user_id', 'users.id').select(['users.id'])
      )

      expect(count).toBe(5) // 4 users, but Alice has 2 posts = 5 rows (3 original + 1 new user + Alice's extra post)
    })

    it('should count all rows (note: distinct is cleared by clearSelect)', async () => {
      // Note: executeCount uses clearSelect() which clears the distinct modifier
      // If you need to count distinct values, use a subquery instead
      const count = await executeCount(db.selectFrom('posts').select('user_id').distinct())

      // Returns 3 (all rows) because clearSelect() removes the distinct
      expect(count).toBe(3)
    })

    it('should count distinct values using subquery pattern', async () => {
      // To count distinct values, wrap in a subquery
      const count = await executeCount(
        db
          .selectFrom(db.selectFrom('posts').select('user_id').distinct().as('distinct_users'))
          .selectAll()
      )

      expect(count).toBe(2) // Only Alice and Bob have posts
    })

    it('should work within a transaction', async () => {
      await db.transaction().execute(async trx => {
        // Add a user within transaction
        await trx
          .insertInto('users')
          .values({ email: 'trx@example.com', name: 'TrxUser' })
          .execute()

        const count = await executeCount(trx.selectFrom('users').selectAll())

        expect(count).toBe(4) // Original 3 + 1 new
      })
    })

    it('should handle existing select columns (clearSelect)', async () => {
      // The function should clear existing selects and add count
      const count = await executeCount(db.selectFrom('users').select(['id', 'email', 'name']))

      expect(count).toBe(3)
    })

    it('should return correct type (number, not string)', async () => {
      const count = await executeCount(db.selectFrom('users').selectAll())

      expect(typeof count).toBe('number')
      expect(Number.isInteger(count)).toBe(true)
    })

    it('should count with date range filter', async () => {
      const futureDate = new Date('2099-12-31')

      const count = await executeCount(
        db
          .selectFrom('posts')
          .selectAll()
          .where('created_at', '<=', futureDate.toISOString() as never)
      )

      expect(count).toBe(3) // All posts created before 2099
    })
  })

  describe('executeGroupedCount', () => {
    it('should group by single column', async () => {
      const byPublished = await executeGroupedCount(db.selectFrom('posts').selectAll(), 'published')

      expect(byPublished).toEqual({
        '0': 1, // 1 unpublished
        '1': 2 // 2 published
      })
    })

    it('should group by user_id', async () => {
      const byUser = await executeGroupedCount(db.selectFrom('posts').selectAll(), 'user_id')

      // Alice (id 1) has 2 posts, Bob (id 2) has 1 post
      expect(Object.keys(byUser)).toHaveLength(2)
      expect(Object.values(byUser).reduce((a, b) => a + b, 0)).toBe(3)
    })

    it('should group comments by post_id', async () => {
      const byPost = await executeGroupedCount(db.selectFrom('comments').selectAll(), 'post_id')

      // Post 1 has 2 comments, Post 3 has 1 comment
      expect(Object.values(byPost).reduce((a, b) => a + b, 0)).toBe(3)
    })

    it('should group with WHERE filter', async () => {
      const byPublished = await executeGroupedCount(
        db.selectFrom('posts').selectAll().where('published', '=', 1),
        'user_id'
      )

      // Only published posts by user
      const totalCount = Object.values(byPublished).reduce((a, b) => a + b, 0)
      expect(totalCount).toBe(2) // 2 published posts
    })

    it('should group with multiple WHERE filters', async () => {
      // First add more posts to test more complex filtering
      await db
        .insertInto('posts')
        .values([
          { user_id: 1, title: 'Alice Draft', content: 'Draft content', published: 0 },
          { user_id: 2, title: 'Bob Draft', content: 'Draft content', published: 0 }
        ])
        .execute()

      const byUser = await executeGroupedCount(
        db
          .selectFrom('posts')
          .selectAll()
          .where('published', '=', 0)
          .where('title', 'like', '%Draft%'),
        'user_id'
      )

      expect(byUser['1']).toBe(1) // Alice has 1 draft
      expect(byUser['2']).toBe(1) // Bob has 1 draft
    })

    it('should return empty object when no rows match', async () => {
      const result = await executeGroupedCount(
        db.selectFrom('posts').selectAll().where('published', '=', 999), // No match
        'user_id'
      )

      expect(result).toEqual({})
      expect(Object.keys(result)).toHaveLength(0)
    })

    it('should return empty object for empty table', async () => {
      // Clear all data
      await db.deleteFrom('comments').execute()
      await db.deleteFrom('posts').execute()
      await db.deleteFrom('users').execute()

      const result = await executeGroupedCount(db.selectFrom('users').selectAll(), 'name')

      expect(result).toEqual({})
    })

    it('should group with multiple categories', async () => {
      // Add more users with diverse data
      await db
        .insertInto('users')
        .values([
          { email: 'dave@example.com', name: 'Alice' }, // Duplicate name
          { email: 'eve@example.com', name: 'Eve' }
        ])
        .execute()

      const byName = await executeGroupedCount(db.selectFrom('users').selectAll(), 'name')

      expect(byName['Alice']).toBe(2) // 2 Alices now
      expect(byName['Bob']).toBe(1)
      expect(byName['Charlie']).toBe(1)
      expect(byName['Eve']).toBe(1)
    })

    it('should handle JOIN and group by joined table column', async () => {
      const byAuthor = await executeGroupedCount(
        db
          .selectFrom('posts')
          .innerJoin('users', 'users.id', 'posts.user_id')
          .select(['posts.id', 'users.name']),
        'name'
      )

      expect(byAuthor['Alice']).toBe(2) // Alice has 2 posts
      expect(byAuthor['Bob']).toBe(1) // Bob has 1 post
    })

    it('should group by with complex filter using OR', async () => {
      const byPublished = await executeGroupedCount(
        db
          .selectFrom('posts')
          .selectAll()
          .where(eb => eb.or([eb('title', 'like', '%First%'), eb('title', 'like', '%Second%')])),
        'published'
      )

      // First Post is published (1), Second Post is unpublished (0)
      expect(byPublished['0']).toBe(1)
      expect(byPublished['1']).toBe(1)
    })

    it('should work within a transaction', async () => {
      await db.transaction().execute(async trx => {
        // Add data within transaction
        await trx
          .insertInto('posts')
          .values({
            user_id: 3, // Charlie
            title: 'Charlie Post',
            content: 'Content',
            published: 1
          })
          .execute()

        const byUser = await executeGroupedCount(trx.selectFrom('posts').selectAll(), 'user_id')

        expect(byUser['3']).toBe(1) // Charlie now has a post
        expect(Object.values(byUser).reduce((a, b) => a + b, 0)).toBe(4)
      })
    })

    it('should handle existing select columns (clearSelect)', async () => {
      // The function should clear existing selects
      const byPublished = await executeGroupedCount(
        db.selectFrom('posts').select(['id', 'title', 'content']),
        'published'
      )

      expect(byPublished).toEqual({
        '0': 1,
        '1': 2
      })
    })

    it('should return numeric counts (not strings)', async () => {
      const byPublished = await executeGroupedCount(db.selectFrom('posts').selectAll(), 'published')

      Object.values(byPublished).forEach(count => {
        expect(typeof count).toBe('number')
        expect(Number.isInteger(count)).toBe(true)
      })
    })

    it('should handle string column grouping', async () => {
      const byName = await executeGroupedCount(db.selectFrom('users').selectAll(), 'name')

      expect(byName['Alice']).toBe(1)
      expect(byName['Bob']).toBe(1)
      expect(byName['Charlie']).toBe(1)
    })

    it('should handle null values in group column', async () => {
      // All users have deleted_at as null, so they should all be grouped under 'null'
      const byDeletedAt = await executeGroupedCount(
        db.selectFrom('users').selectAll(),
        'deleted_at'
      )

      expect(byDeletedAt['null']).toBe(3)
    })

    it('should group with date range filter', async () => {
      const byPublished = await executeGroupedCount(
        db
          .selectFrom('posts')
          .selectAll()
          .where('created_at', '<=', new Date('2099-12-31').toISOString() as never),
        'published'
      )

      expect(byPublished['0']).toBe(1)
      expect(byPublished['1']).toBe(2)
    })

    it('should handle large number of groups', async () => {
      // Insert many users with unique names
      const users = Array.from({ length: 50 }, (_, i) => ({
        email: `user${i}@example.com`,
        name: `User${i}`
      }))
      await db.insertInto('users').values(users).execute()

      const byName = await executeGroupedCount(db.selectFrom('users').selectAll(), 'name')

      // Should have 53 groups (3 original + 50 new)
      expect(Object.keys(byName).length).toBe(53)
      // Each should have count of 1
      Object.values(byName).forEach(count => {
        expect(count).toBe(1)
      })
    })

    it('should maintain correct counts with JOIN that produces multiple rows', async () => {
      // Comments have multiple entries per user
      const byUserId = await executeGroupedCount(db.selectFrom('comments').selectAll(), 'user_id')

      const totalComments = Object.values(byUserId).reduce((a, b) => a + b, 0)
      expect(totalComments).toBe(3) // Total comments
    })
  })

  describe('executeCount and executeGroupedCount consistency', () => {
    it('should have consistent totals', async () => {
      const totalCount = await executeCount(db.selectFrom('posts').selectAll())

      const groupedCount = await executeGroupedCount(
        db.selectFrom('posts').selectAll(),
        'published'
      )

      const sumOfGroups = Object.values(groupedCount).reduce((a, b) => a + b, 0)

      expect(totalCount).toBe(sumOfGroups)
    })

    it('should have consistent totals with filters', async () => {
      const query = db.selectFrom('posts').selectAll().where('published', '=', 1)

      const totalCount = await executeCount(query)

      const groupedCount = await executeGroupedCount(query, 'user_id')

      const sumOfGroups = Object.values(groupedCount).reduce((a, b) => a + b, 0)

      expect(totalCount).toBe(sumOfGroups)
    })

    it('should have consistent totals with JOINs', async () => {
      const query = db
        .selectFrom('posts')
        .innerJoin('users', 'users.id', 'posts.user_id')
        .select(['posts.id', 'posts.user_id', 'users.name'])

      const totalCount = await executeCount(query)

      const groupedCount = await executeGroupedCount(query, 'name')

      const sumOfGroups = Object.values(groupedCount).reduce((a, b) => a + b, 0)

      expect(totalCount).toBe(sumOfGroups)
    })
  })

  describe('Edge Cases', () => {
    it('executeCount should handle subquery', async () => {
      // Count posts from users who have comments
      const count = await executeCount(
        db
          .selectFrom('posts')
          .selectAll()
          .where('user_id', 'in', db.selectFrom('comments').select('user_id').distinct())
      )

      // Alice (id 1) and Bob (id 2) have comments
      // Alice has 2 posts, Bob has 1 post = 3 posts
      expect(count).toBe(3)
    })

    it('executeGroupedCount should handle subquery filter', async () => {
      const result = await executeGroupedCount(
        db
          .selectFrom('posts')
          .selectAll()
          .where('user_id', 'in', db.selectFrom('comments').select('user_id').distinct()),
        'published'
      )

      expect(result['0']).toBe(1)
      expect(result['1']).toBe(2)
    })

    it('should handle concurrent count queries', async () => {
      const [count1, count2, count3] = await Promise.all([
        executeCount(db.selectFrom('users').selectAll()),
        executeCount(db.selectFrom('posts').selectAll()),
        executeCount(db.selectFrom('comments').selectAll())
      ])

      expect(count1).toBe(3)
      expect(count2).toBe(3)
      expect(count3).toBe(3)
    })

    it('should handle concurrent grouped count queries', async () => {
      const [grouped1, grouped2] = await Promise.all([
        executeGroupedCount(db.selectFrom('posts').selectAll(), 'published'),
        executeGroupedCount(db.selectFrom('posts').selectAll(), 'user_id')
      ])

      expect(grouped1['0']).toBe(1)
      expect(grouped1['1']).toBe(2)
      expect(Object.values(grouped2).reduce((a, b) => a + b, 0)).toBe(3)
    })
  })
})
