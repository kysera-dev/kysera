import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDatabase } from './setup/database.js'
import { ContextAwareRepository } from '../src/index.js'
import type { Kysely } from 'kysely'
import type { TestDatabase } from './setup/database.js'

// Test repositories using ContextAwareRepository
interface User {
  id: number
  email: string
  name: string
  created_at: Date | string
  deleted_at: Date | string | null
}

interface Post {
  id: number
  user_id: number
  title: string
  content: string
  published: number
  created_at: Date | string
  updated_at: Date | string | null
  deleted_at: Date | string | null
}

// User repository implementation
class UserRepository extends ContextAwareRepository<TestDatabase, 'users'> {
  async create(data: { email: string; name: string }): Promise<User> {
    const result = await this.db
      .insertInto(this.tableName)
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow()

    return result as User
  }

  async findById(id: number): Promise<User | null> {
    const result = await this.db
      .selectFrom(this.tableName)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return result ? (result as User) : null
  }

  async findAll(): Promise<User[]> {
    const results = await this.db.selectFrom(this.tableName).selectAll().execute()

    return results as User[]
  }

  async update(id: number, data: Partial<{ email: string; name: string }>): Promise<User> {
    const result = await this.db
      .updateTable(this.tableName)
      .set(data)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()

    return result as User
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.deleteFrom(this.tableName).where('id', '=', id).execute()

    return result[0]?.numDeletedRows === 1n
  }
}

// Post repository implementation
class PostRepository extends ContextAwareRepository<TestDatabase, 'posts'> {
  async create(data: {
    user_id: number
    title: string
    content: string
    published?: number
  }): Promise<Post> {
    const result = await this.db
      .insertInto(this.tableName)
      .values({ published: 0, ...data })
      .returningAll()
      .executeTakeFirstOrThrow()

    return result as Post
  }

  async findById(id: number): Promise<Post | null> {
    const result = await this.db
      .selectFrom(this.tableName)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return result ? (result as Post) : null
  }

  async findByUserId(userId: number): Promise<Post[]> {
    const results = await this.db
      .selectFrom(this.tableName)
      .selectAll()
      .where('user_id', '=', userId)
      .execute()

    return results as Post[]
  }
}

describe('ContextAwareRepository', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup as () => Promise<void>
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('Basic Operations', () => {
    it('should create repository with executor and tableName', () => {
      const userRepo = new UserRepository(db, 'users')

      expect(userRepo).toBeInstanceOf(ContextAwareRepository)
      expect(userRepo.tableName).toBe('users')
    })

    it('should perform CRUD operations with base executor', async () => {
      const userRepo = new UserRepository(db, 'users')

      // Create
      const user = await userRepo.create({
        email: 'test@example.com',
        name: 'Test User'
      })

      expect(user).toBeDefined()
      expect(user.email).toBe('test@example.com')
      expect(user.id).toBeGreaterThan(0)

      // Read
      const foundUser = await userRepo.findById(user.id)
      expect(foundUser).toBeDefined()
      expect(foundUser?.email).toBe('test@example.com')

      // Update
      const updatedUser = await userRepo.update(user.id, { name: 'Updated Name' })
      expect(updatedUser.name).toBe('Updated Name')

      // Delete
      const deleted = await userRepo.delete(user.id)
      expect(deleted).toBe(true)

      const deletedUser = await userRepo.findById(user.id)
      expect(deletedUser).toBeNull()
    })
  })

  describe('withExecutor Pattern', () => {
    it('should create new instance with different executor', async () => {
      const baseUserRepo = new UserRepository(db, 'users')

      await db.transaction().execute(async trx => {
        const txUserRepo = baseUserRepo.withExecutor(trx)

        // Should be different instance
        expect(txUserRepo).not.toBe(baseUserRepo)

        // Should have same tableName
        expect(txUserRepo.tableName).toBe(baseUserRepo.tableName)

        // Should work with transaction executor
        const user = await txUserRepo.create({
          email: 'tx@example.com',
          name: 'Transaction User'
        })

        expect(user).toBeDefined()
        expect(user.email).toBe('tx@example.com')
      })

      // User should be committed
      const users = await baseUserRepo.findAll()
      expect(users).toHaveLength(1)
      expect(users[0]?.email).toBe('tx@example.com')
    })

    it('should support multiple repositories in same transaction', async () => {
      const baseUserRepo = new UserRepository(db, 'users')
      const basePostRepo = new PostRepository(db, 'posts')

      await db.transaction().execute(async trx => {
        const userRepo = baseUserRepo.withExecutor(trx)
        const postRepo = basePostRepo.withExecutor(trx)

        // Create user
        const user = await userRepo.create({
          email: 'author@example.com',
          name: 'Author'
        })

        // Create post for user
        const post = await postRepo.create({
          user_id: user.id,
          title: 'First Post',
          content: 'Hello World'
        })

        expect(post).toBeDefined()
        expect(post.user_id).toBe(user.id)
      })

      // Both should be committed
      const users = await baseUserRepo.findAll()
      expect(users).toHaveLength(1)

      const posts = await basePostRepo.findByUserId(users[0]!.id)
      expect(posts).toHaveLength(1)
      expect(posts[0]?.title).toBe('First Post')
    })

    it('should rollback transaction on error', async () => {
      const baseUserRepo = new UserRepository(db, 'users')
      const basePostRepo = new PostRepository(db, 'posts')

      try {
        await db.transaction().execute(async trx => {
          const userRepo = baseUserRepo.withExecutor(trx)
          const postRepo = basePostRepo.withExecutor(trx)

          // Create user
          await userRepo.create({
            email: 'user@example.com',
            name: 'User'
          })

          // Create post
          await postRepo.create({
            user_id: 999, // Invalid user_id (foreign key constraint)
            title: 'Bad Post',
            content: 'This will fail'
          })
        })
      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined()
      }

      // User should NOT be committed
      const users = await baseUserRepo.findAll()
      expect(users).toHaveLength(0)
    })

    it('should preserve instance type with withExecutor', async () => {
      const baseUserRepo = new UserRepository(db, 'users')

      await db.transaction().execute(async trx => {
        const txUserRepo = baseUserRepo.withExecutor(trx)

        // Should still be instance of UserRepository
        expect(txUserRepo).toBeInstanceOf(UserRepository)
        expect(txUserRepo).toBeInstanceOf(ContextAwareRepository)

        // Should have all methods
        expect(typeof txUserRepo.create).toBe('function')
        expect(typeof txUserRepo.findById).toBe('function')
        expect(typeof txUserRepo.withExecutor).toBe('function')
      })
    })

    it('should work with multiple sequential transactions', async () => {
      const baseUserRepo = new UserRepository(db, 'users')

      // First transaction
      await db.transaction().execute(async trx1 => {
        const repo1 = baseUserRepo.withExecutor(trx1)

        const user1 = await repo1.create({
          email: 'user1@example.com',
          name: 'User 1'
        })

        expect(user1).toBeDefined()
      })

      // Second transaction (not nested, but sequential)
      await db.transaction().execute(async trx2 => {
        const repo2 = baseUserRepo.withExecutor(trx2)

        const user2 = await repo2.create({
          email: 'user2@example.com',
          name: 'User 2'
        })

        expect(user2).toBeDefined()
      })

      const users = await baseUserRepo.findAll()
      expect(users).toHaveLength(2)
    })

    it('should allow switching executor multiple times', async () => {
      const baseUserRepo = new UserRepository(db, 'users')

      // First transaction
      await db.transaction().execute(async trx1 => {
        const txRepo1 = baseUserRepo.withExecutor(trx1)

        await txRepo1.create({
          email: 'tx1@example.com',
          name: 'TX1 User'
        })
      })

      // Second transaction with different executor
      await db.transaction().execute(async trx2 => {
        const txRepo2 = baseUserRepo.withExecutor(trx2)

        await txRepo2.create({
          email: 'tx2@example.com',
          name: 'TX2 User'
        })
      })

      // Use base executor to verify both were committed
      const users = await baseUserRepo.findAll()
      expect(users).toHaveLength(2)
    })
  })

  describe('Complex Transaction Scenarios', () => {
    it('should handle multiple sequential operations in transaction', async () => {
      const baseUserRepo = new UserRepository(db, 'users')
      const basePostRepo = new PostRepository(db, 'posts')

      const result = await db.transaction().execute(async trx => {
        const userRepo = baseUserRepo.withExecutor(trx)
        const postRepo = basePostRepo.withExecutor(trx)

        // Create user
        const user = await userRepo.create({
          email: 'blogger@example.com',
          name: 'Blogger'
        })

        // Create multiple posts
        const post1 = await postRepo.create({
          user_id: user.id,
          title: 'First Post',
          content: 'Content 1'
        })

        const post2 = await postRepo.create({
          user_id: user.id,
          title: 'Second Post',
          content: 'Content 2'
        })

        // Update user
        await userRepo.update(user.id, { name: 'Updated Blogger' })

        return { user, posts: [post1, post2] }
      })

      expect(result.user).toBeDefined()
      expect(result.posts).toHaveLength(2)

      // Verify all operations were committed
      const user = await baseUserRepo.findById(result.user.id)
      expect(user?.name).toBe('Updated Blogger')

      const posts = await basePostRepo.findByUserId(result.user.id)
      expect(posts).toHaveLength(2)
    })

    it('should maintain isolation between concurrent repositories', async () => {
      const baseUserRepo = new UserRepository(db, 'users')

      // Create user outside transaction
      const outsideUser = await baseUserRepo.create({
        email: 'outside@example.com',
        name: 'Outside'
      })

      await db.transaction().execute(async trx => {
        const txUserRepo = baseUserRepo.withExecutor(trx)

        // Create user inside transaction
        const insideUser = await txUserRepo.create({
          email: 'inside@example.com',
          name: 'Inside'
        })

        // Both should be visible within transaction
        const users = await txUserRepo.findAll()
        expect(users.length).toBeGreaterThanOrEqual(2)

        // Update should only affect transaction scope
        await txUserRepo.update(insideUser.id, { name: 'Updated Inside' })
      })

      // Outside user should be unchanged
      const outsideUserCheck = await baseUserRepo.findById(outsideUser.id)
      expect(outsideUserCheck?.name).toBe('Outside')

      // Inside user should be committed with update
      const allUsers = await baseUserRepo.findAll()
      const insideUser = allUsers.find(u => u.email === 'inside@example.com')
      expect(insideUser?.name).toBe('Updated Inside')
    })

    it('should support partial rollback scenarios', async () => {
      const baseUserRepo = new UserRepository(db, 'users')
      const basePostRepo = new PostRepository(db, 'posts')

      // Create user outside transaction (committed)
      const user = await baseUserRepo.create({
        email: 'permanent@example.com',
        name: 'Permanent'
      })

      // Try to create posts in transaction that will fail
      try {
        await db.transaction().execute(async trx => {
          const postRepo = basePostRepo.withExecutor(trx)

          // This will succeed
          await postRepo.create({
            user_id: user.id,
            title: 'Good Post',
            content: 'Content'
          })

          // This will fail (invalid user_id)
          await postRepo.create({
            user_id: 999,
            title: 'Bad Post',
            content: 'Content'
          })
        })
      } catch (error) {
        // Expected to fail
      }

      // User should still exist (created outside transaction)
      const existingUser = await baseUserRepo.findById(user.id)
      expect(existingUser).toBeDefined()

      // But posts should be rolled back
      const posts = await basePostRepo.findByUserId(user.id)
      expect(posts).toHaveLength(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty operations in transaction', async () => {
      const baseUserRepo = new UserRepository(db, 'users')

      await db.transaction().execute(async trx => {
        const txUserRepo = baseUserRepo.withExecutor(trx)

        // Just read, no writes
        const users = await txUserRepo.findAll()
        expect(users).toHaveLength(0)
      })

      // Should complete without error
      const users = await baseUserRepo.findAll()
      expect(users).toHaveLength(0)
    })

    it('should preserve custom repository properties', async () => {
      class ExtendedUserRepository extends UserRepository {
        customProperty = 'test-value'

        getCustomProperty(): string {
          return this.customProperty
        }
      }

      const baseRepo = new ExtendedUserRepository(db, 'users')
      baseRepo.customProperty = 'custom-value'

      await db.transaction().execute(async trx => {
        const txRepo = baseRepo.withExecutor(trx)

        // Custom property should be preserved
        expect(txRepo.customProperty).toBe('custom-value')
        expect(txRepo.getCustomProperty()).toBe('custom-value')
      })
    })

    it('should work with chained withExecutor calls', async () => {
      const baseUserRepo = new UserRepository(db, 'users')

      await db.transaction().execute(async trx => {
        // Chain withExecutor calls
        const txRepo1 = baseUserRepo.withExecutor(trx)
        const txRepo2 = txRepo1.withExecutor(trx)
        const txRepo3 = txRepo2.withExecutor(trx)

        const user = await txRepo3.create({
          email: 'chained@example.com',
          name: 'Chained'
        })

        expect(user).toBeDefined()
      })

      const users = await baseUserRepo.findAll()
      expect(users).toHaveLength(1)
    })
  })

  describe('findOneBy and findManyBy', () => {
    // Test repository that exposes protected methods for testing
    class TestUserRepository extends ContextAwareRepository<TestDatabase, 'users'> {
      async create(data: { email: string; name: string }): Promise<User> {
        const result = await this.db
          .insertInto(this.tableName)
          .values(data)
          .returningAll()
          .executeTakeFirstOrThrow()

        return result as User
      }

      async findAll(): Promise<User[]> {
        const results = await this.db.selectFrom(this.tableName).selectAll().execute()

        return results as User[]
      }

      // Expose protected findOneBy for testing
      async testFindOneBy<K extends keyof User>(field: K, value: User[K]): Promise<User | null> {
        return this.findOneBy(field, value) as Promise<User | null>
      }

      // Expose protected findManyBy for testing
      async testFindManyBy<K extends keyof User>(
        field: K,
        value: User[K],
        options?: { limit?: number; offset?: number; orderBy?: string; direction?: 'asc' | 'desc' }
      ): Promise<User[]> {
        return this.findManyBy(field, value, options) as Promise<User[]>
      }
    }

    class TestPostRepository extends ContextAwareRepository<TestDatabase, 'posts'> {
      async create(data: {
        user_id: number
        title: string
        content: string
        published?: number
      }): Promise<Post> {
        const result = await this.db
          .insertInto(this.tableName)
          .values({ published: 0, ...data })
          .returningAll()
          .executeTakeFirstOrThrow()

        return result as Post
      }

      // Expose protected findOneBy for testing
      async testFindOneBy<K extends keyof Post>(field: K, value: Post[K]): Promise<Post | null> {
        return this.findOneBy(field, value) as Promise<Post | null>
      }

      // Expose protected findManyBy for testing
      async testFindManyBy<K extends keyof Post>(
        field: K,
        value: Post[K],
        options?: { limit?: number; offset?: number; orderBy?: string; direction?: 'asc' | 'desc' }
      ): Promise<Post[]> {
        return this.findManyBy(field, value, options) as Promise<Post[]>
      }
    }

    describe('findOneBy', () => {
      it('should find entity by primary key', async () => {
        const userRepo = new TestUserRepository(db, 'users')

        const createdUser = await userRepo.create({
          email: 'findone@example.com',
          name: 'FindOne User'
        })

        const foundUser = await userRepo.testFindOneBy('id', createdUser.id)

        expect(foundUser).toBeDefined()
        expect(foundUser?.id).toBe(createdUser.id)
        expect(foundUser?.email).toBe('findone@example.com')
        expect(foundUser?.name).toBe('FindOne User')
      })

      it('should find entity by unique field (email)', async () => {
        const userRepo = new TestUserRepository(db, 'users')

        await userRepo.create({
          email: 'unique@example.com',
          name: 'Unique User'
        })

        const foundUser = await userRepo.testFindOneBy('email', 'unique@example.com')

        expect(foundUser).toBeDefined()
        expect(foundUser?.email).toBe('unique@example.com')
        expect(foundUser?.name).toBe('Unique User')
      })

      it('should find entity by foreign key', async () => {
        const userRepo = new TestUserRepository(db, 'users')
        const postRepo = new TestPostRepository(db, 'posts')

        const user = await userRepo.create({
          email: 'fk-test@example.com',
          name: 'FK Test User'
        })

        const post = await postRepo.create({
          user_id: user.id,
          title: 'FK Test Post',
          content: 'Foreign key test content'
        })

        const foundPost = await postRepo.testFindOneBy('user_id', user.id)

        expect(foundPost).toBeDefined()
        expect(foundPost?.id).toBe(post.id)
        expect(foundPost?.user_id).toBe(user.id)
        expect(foundPost?.title).toBe('FK Test Post')
      })

      it('should return null when entity not found', async () => {
        const userRepo = new TestUserRepository(db, 'users')

        const notFoundById = await userRepo.testFindOneBy('id', 99999)
        expect(notFoundById).toBeNull()

        const notFoundByEmail = await userRepo.testFindOneBy('email', 'nonexistent@example.com')
        expect(notFoundByEmail).toBeNull()
      })

      it('should work with transactions via withExecutor', async () => {
        const baseUserRepo = new TestUserRepository(db, 'users')

        await db.transaction().execute(async trx => {
          const txUserRepo = baseUserRepo.withExecutor(trx)

          // Create user inside transaction
          const createdUser = await txUserRepo.create({
            email: 'tx-findone@example.com',
            name: 'TX FindOne User'
          })

          // Find inside same transaction (should work)
          const foundUser = await txUserRepo.testFindOneBy('id', createdUser.id)
          expect(foundUser).toBeDefined()
          expect(foundUser?.email).toBe('tx-findone@example.com')
        })

        // Verify committed
        const committedUser = await baseUserRepo.testFindOneBy('email', 'tx-findone@example.com')
        expect(committedUser).toBeDefined()
      })
    })

    describe('findManyBy', () => {
      it('should find all entities by foreign key', async () => {
        const userRepo = new TestUserRepository(db, 'users')
        const postRepo = new TestPostRepository(db, 'posts')

        const user = await userRepo.create({
          email: 'many-posts@example.com',
          name: 'Many Posts User'
        })

        // Create multiple posts for the same user
        await postRepo.create({
          user_id: user.id,
          title: 'Post 1',
          content: 'Content 1'
        })

        await postRepo.create({
          user_id: user.id,
          title: 'Post 2',
          content: 'Content 2'
        })

        await postRepo.create({
          user_id: user.id,
          title: 'Post 3',
          content: 'Content 3'
        })

        const posts = await postRepo.testFindManyBy('user_id', user.id)

        expect(posts).toHaveLength(3)
        expect(posts.every(p => p.user_id === user.id)).toBe(true)
      })

      it('should find with limit option', async () => {
        const userRepo = new TestUserRepository(db, 'users')
        const postRepo = new TestPostRepository(db, 'posts')

        const user = await userRepo.create({
          email: 'limit-test@example.com',
          name: 'Limit Test User'
        })

        // Create 5 posts
        for (let i = 1; i <= 5; i++) {
          await postRepo.create({
            user_id: user.id,
            title: `Post ${i}`,
            content: `Content ${i}`
          })
        }

        const limitedPosts = await postRepo.testFindManyBy('user_id', user.id, { limit: 3 })

        expect(limitedPosts).toHaveLength(3)
      })

      it('should find with offset option', async () => {
        const userRepo = new TestUserRepository(db, 'users')
        const postRepo = new TestPostRepository(db, 'posts')

        const user = await userRepo.create({
          email: 'offset-test@example.com',
          name: 'Offset Test User'
        })

        // Create 5 posts with identifiable titles
        for (let i = 1; i <= 5; i++) {
          await postRepo.create({
            user_id: user.id,
            title: `Offset Post ${i}`,
            content: `Content ${i}`
          })
        }

        // Get all posts first to verify total count
        const allPosts = await postRepo.testFindManyBy('user_id', user.id)
        expect(allPosts).toHaveLength(5)

        // Get posts with offset
        const offsetPosts = await postRepo.testFindManyBy('user_id', user.id, { offset: 2 })
        expect(offsetPosts).toHaveLength(3)
      })

      it('should find with limit and offset combined', async () => {
        const userRepo = new TestUserRepository(db, 'users')
        const postRepo = new TestPostRepository(db, 'posts')

        const user = await userRepo.create({
          email: 'pagination@example.com',
          name: 'Pagination User'
        })

        // Create 10 posts
        for (let i = 1; i <= 10; i++) {
          await postRepo.create({
            user_id: user.id,
            title: `Pagination Post ${i}`,
            content: `Content ${i}`
          })
        }

        // Page 2 of size 3 (offset 3, limit 3)
        const page2Posts = await postRepo.testFindManyBy('user_id', user.id, {
          limit: 3,
          offset: 3
        })

        expect(page2Posts).toHaveLength(3)
      })

      it('should find with orderBy and direction (descending)', async () => {
        const userRepo = new TestUserRepository(db, 'users')
        const postRepo = new TestPostRepository(db, 'posts')

        const user = await userRepo.create({
          email: 'orderby-test@example.com',
          name: 'OrderBy Test User'
        })

        // Create posts with different titles (will be ordered by id or title)
        await postRepo.create({
          user_id: user.id,
          title: 'AAA First',
          content: 'Content A'
        })

        await postRepo.create({
          user_id: user.id,
          title: 'ZZZ Last',
          content: 'Content Z'
        })

        await postRepo.create({
          user_id: user.id,
          title: 'MMM Middle',
          content: 'Content M'
        })

        // Order by title descending
        const descPosts = await postRepo.testFindManyBy('user_id', user.id, {
          orderBy: 'title',
          direction: 'desc'
        })

        expect(descPosts).toHaveLength(3)
        expect(descPosts[0]?.title).toBe('ZZZ Last')
        expect(descPosts[1]?.title).toBe('MMM Middle')
        expect(descPosts[2]?.title).toBe('AAA First')
      })

      it('should find with orderBy and direction (ascending)', async () => {
        const userRepo = new TestUserRepository(db, 'users')
        const postRepo = new TestPostRepository(db, 'posts')

        const user = await userRepo.create({
          email: 'orderby-asc@example.com',
          name: 'OrderBy Asc User'
        })

        await postRepo.create({
          user_id: user.id,
          title: 'ZZZ First in order',
          content: 'Content Z'
        })

        await postRepo.create({
          user_id: user.id,
          title: 'AAA Last in order',
          content: 'Content A'
        })

        // Order by title ascending
        const ascPosts = await postRepo.testFindManyBy('user_id', user.id, {
          orderBy: 'title',
          direction: 'asc'
        })

        expect(ascPosts).toHaveLength(2)
        expect(ascPosts[0]?.title).toBe('AAA Last in order')
        expect(ascPosts[1]?.title).toBe('ZZZ First in order')
      })

      it('should default to descending order when direction is omitted', async () => {
        const userRepo = new TestUserRepository(db, 'users')
        const postRepo = new TestPostRepository(db, 'posts')

        const user = await userRepo.create({
          email: 'default-order@example.com',
          name: 'Default Order User'
        })

        await postRepo.create({
          user_id: user.id,
          title: 'AAA Post',
          content: 'Content A'
        })

        await postRepo.create({
          user_id: user.id,
          title: 'ZZZ Post',
          content: 'Content Z'
        })

        // Order by title without direction (should default to desc)
        const posts = await postRepo.testFindManyBy('user_id', user.id, {
          orderBy: 'title'
        })

        expect(posts).toHaveLength(2)
        expect(posts[0]?.title).toBe('ZZZ Post')
        expect(posts[1]?.title).toBe('AAA Post')
      })

      it('should return empty array when none found', async () => {
        const postRepo = new TestPostRepository(db, 'posts')

        const posts = await postRepo.testFindManyBy('user_id', 99999)

        expect(posts).toHaveLength(0)
        expect(posts).toEqual([])
      })

      it('should work with transactions via withExecutor', async () => {
        const baseUserRepo = new TestUserRepository(db, 'users')
        const basePostRepo = new TestPostRepository(db, 'posts')

        await db.transaction().execute(async trx => {
          const txUserRepo = baseUserRepo.withExecutor(trx)
          const txPostRepo = basePostRepo.withExecutor(trx)

          // Create user and posts inside transaction
          const user = await txUserRepo.create({
            email: 'tx-findmany@example.com',
            name: 'TX FindMany User'
          })

          await txPostRepo.create({
            user_id: user.id,
            title: 'TX Post 1',
            content: 'Content 1'
          })

          await txPostRepo.create({
            user_id: user.id,
            title: 'TX Post 2',
            content: 'Content 2'
          })

          // Find inside same transaction (should work)
          const posts = await txPostRepo.testFindManyBy('user_id', user.id)
          expect(posts).toHaveLength(2)
          expect(posts.every(p => p.user_id === user.id)).toBe(true)
        })

        // Verify committed
        const committedUser = await baseUserRepo.testFindOneBy('email', 'tx-findmany@example.com')
        expect(committedUser).toBeDefined()

        const committedPosts = await basePostRepo.testFindManyBy('user_id', committedUser!.id)
        expect(committedPosts).toHaveLength(2)
      })

      it('should combine orderBy with limit for top-N queries', async () => {
        const userRepo = new TestUserRepository(db, 'users')
        const postRepo = new TestPostRepository(db, 'posts')

        const user = await userRepo.create({
          email: 'topn@example.com',
          name: 'TopN User'
        })

        // Create posts with different IDs (will have sequential IDs)
        for (let i = 1; i <= 5; i++) {
          await postRepo.create({
            user_id: user.id,
            title: `TopN Post ${i}`,
            content: `Content ${i}`
          })
        }

        // Get top 2 latest posts (ordered by id desc, limit 2)
        const topPosts = await postRepo.testFindManyBy('user_id', user.id, {
          orderBy: 'id',
          direction: 'desc',
          limit: 2
        })

        expect(topPosts).toHaveLength(2)
        // The last created posts should have higher IDs
        expect(topPosts[0]?.title).toBe('TopN Post 5')
        expect(topPosts[1]?.title).toBe('TopN Post 4')
      })
    })
  })
})
