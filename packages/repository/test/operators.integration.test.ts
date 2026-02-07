/**
 * Integration Tests for Query Operators with Real Databases
 *
 * Tests operators against SQLite (always), PostgreSQL and MySQL (when available via Docker).
 *
 * Run with Docker databases:
 *   TEST_POSTGRES=true TEST_MYSQL=true pnpm test:multi-db
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Kysely, type Selectable } from 'kysely'
import { z } from 'zod'
import {
  type DatabaseType,
  type MultiDbTestDatabase,
  createTestDb,
  initializeSchema,
  seedDatabase,
  clearDatabase
} from '../../core/test/utils/multi-db.js'
import { createRepositoryFactory, zodAdapter, type FindOptions } from '../src/index.js'

// Test schemas
const UserCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().nullable().optional()
})

const UserUpdateSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().nullable().optional()
})

// Post schemas based on database type
const createPostSchemas = (dbType: DatabaseType) => {
  const booleanField =
    dbType === 'sqlite' || dbType === 'mysql'
      ? z.union([z.boolean().transform(val => (val ? 1 : 0)), z.number()])
      : z.boolean()

  const booleanFieldWithDefault =
    dbType === 'sqlite' || dbType === 'mysql'
      ? z.union([z.boolean().transform(val => (val ? 1 : 0)), z.number()]).default(0)
      : z.boolean().default(false)

  const PostCreateSchema = z.object({
    user_id: z.number(),
    title: z.string(),
    content: z.string().nullable().optional(),
    published: booleanFieldWithDefault
  })

  const PostUpdateSchema = z.object({
    title: z.string().optional(),
    content: z.string().nullable().optional(),
    published: booleanField.optional()
  })

  return { PostCreateSchema, PostUpdateSchema }
}

type User = Selectable<MultiDbTestDatabase['users']>
type Post = Selectable<MultiDbTestDatabase['posts']>

// Test all database types based on environment
const getDatabaseTypes = (): DatabaseType[] => {
  const types: DatabaseType[] = ['sqlite']

  if (process.env['TEST_POSTGRES'] === 'true') {
    types.push('postgres')
  }

  if (process.env['TEST_MYSQL'] === 'true') {
    types.push('mysql')
  }

  return types
}

describe.each(getDatabaseTypes())('Query Operators Integration Tests (%s)', dbType => {
  let db: Kysely<MultiDbTestDatabase>
  let userRepository: ReturnType<
    ReturnType<typeof createRepositoryFactory<MultiDbTestDatabase>>['create']
  >
  let postRepository: ReturnType<
    ReturnType<typeof createRepositoryFactory<MultiDbTestDatabase>>['create']
  >

  beforeAll(async () => {
    db = createTestDb(dbType)
    await initializeSchema(db, dbType)

    // Create repositories
    const factory = createRepositoryFactory(db)

    userRepository = factory.create({
      tableName: 'users' as const,
      schemas: {
        create: zodAdapter(UserCreateSchema),
        update: zodAdapter(UserUpdateSchema)
      },
      mapRow: (row: any) => row as User
    })

    const { PostCreateSchema, PostUpdateSchema } = createPostSchemas(dbType)

    postRepository = factory.create({
      tableName: 'posts' as const,
      schemas: {
        create: zodAdapter(PostCreateSchema),
        update: zodAdapter(PostUpdateSchema)
      },
      mapRow: (row: any) => {
        if (dbType === 'sqlite' && typeof row.published === 'number') {
          return { ...row, published: row.published === 1 } as Post
        }
        return row as Post
      }
    })
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await clearDatabase(db)
    await seedDatabase(db, dbType)
  })

  // ============================================================================
  // Comparison Operators
  // ============================================================================

  describe('Comparison Operators', () => {
    it('$eq - should find records with explicit equality', async () => {
      const users = await userRepository.find({
        where: { email: { $eq: 'alice@example.com' } }
      })

      expect(users).toHaveLength(1)
      expect(users[0]?.email).toBe('alice@example.com')
    })

    it('$ne - should find records not equal to value', async () => {
      const users = await userRepository.find({
        where: { name: { $ne: 'Alice' } }
      })

      expect(users.length).toBeGreaterThan(0)
      users.forEach((u: User) => expect(u.name).not.toBe('Alice'))
    })

    it('$gt - should find records greater than value', async () => {
      // Create users with specific IDs for testing
      const allUsers = await userRepository.find({ orderBy: 'id' })
      const midId = allUsers[Math.floor(allUsers.length / 2)]?.id

      const users = await userRepository.find({
        where: { id: { $gt: midId } }
      })

      users.forEach((u: User) => expect(u.id).toBeGreaterThan(midId))
    })

    it('$gte - should find records greater than or equal to value', async () => {
      const allUsers = await userRepository.find({ orderBy: 'id' })
      const midId = allUsers[Math.floor(allUsers.length / 2)]?.id

      const users = await userRepository.find({
        where: { id: { $gte: midId } }
      })

      users.forEach((u: User) => expect(u.id).toBeGreaterThanOrEqual(midId))
    })

    it('$lt - should find records less than value', async () => {
      const allUsers = await userRepository.find({ orderBy: 'id' })
      const midId = allUsers[Math.floor(allUsers.length / 2)]?.id

      const users = await userRepository.find({
        where: { id: { $lt: midId } }
      })

      users.forEach((u: User) => expect(u.id).toBeLessThan(midId))
    })

    it('$lte - should find records less than or equal to value', async () => {
      const allUsers = await userRepository.find({ orderBy: 'id' })
      const midId = allUsers[Math.floor(allUsers.length / 2)]?.id

      const users = await userRepository.find({
        where: { id: { $lte: midId } }
      })

      users.forEach((u: User) => expect(u.id).toBeLessThanOrEqual(midId))
    })

    it('combined comparisons - should find records within range', async () => {
      const allUsers = await userRepository.find({ orderBy: 'id' })
      const minId = allUsers[0]?.id
      const maxId = allUsers[allUsers.length - 1]?.id

      const users = await userRepository.find({
        where: {
          id: { $gte: minId, $lte: maxId }
        }
      })

      expect(users).toHaveLength(allUsers.length)
    })
  })

  // ============================================================================
  // Array Operators
  // ============================================================================

  describe('Array Operators', () => {
    it('$in - should find records with values in array', async () => {
      const users = await userRepository.find({
        where: {
          email: { $in: ['alice@example.com', 'bob@example.com'] }
        }
      })

      expect(users).toHaveLength(2)
      const emails = users.map((u: User) => u.email)
      expect(emails).toContain('alice@example.com')
      expect(emails).toContain('bob@example.com')
    })

    it('$in - empty array should return no results', async () => {
      const users = await userRepository.find({
        where: {
          email: { $in: [] }
        }
      })

      expect(users).toHaveLength(0)
    })

    it('$nin - should find records with values not in array', async () => {
      const users = await userRepository.find({
        where: {
          email: { $nin: ['alice@example.com', 'bob@example.com'] }
        }
      })

      expect(users.length).toBeGreaterThan(0)
      users.forEach((u: User) => {
        expect(u.email).not.toBe('alice@example.com')
        expect(u.email).not.toBe('bob@example.com')
      })
    })

    it('$nin - empty array should return all results', async () => {
      const allUsers = await userRepository.find()
      const users = await userRepository.find({
        where: {
          email: { $nin: [] }
        }
      })

      expect(users).toHaveLength(allUsers.length)
    })
  })

  // ============================================================================
  // String Operators
  // ============================================================================

  describe('String Operators', () => {
    it('$like - should find records matching pattern', async () => {
      const users = await userRepository.find({
        where: {
          email: { $like: '%@example.com' }
        }
      })

      expect(users.length).toBeGreaterThan(0)
      users.forEach((u: User) => expect(u.email).toMatch(/@example\.com$/))
    })

    it('$contains - should find records containing substring', async () => {
      const users = await userRepository.find({
        where: {
          name: { $contains: 'li' } // Alice, Charlie
        }
      })

      expect(users.length).toBeGreaterThan(0)
      users.forEach((u: User) => expect(u.name?.toLowerCase()).toContain('li'))
    })

    it('$startsWith - should find records starting with value', async () => {
      const users = await userRepository.find({
        where: {
          name: { $startsWith: 'A' }
        }
      })

      expect(users.length).toBeGreaterThan(0)
      users.forEach((u: User) => expect(u.name).toMatch(/^A/))
    })

    it('$endsWith - should find records ending with value', async () => {
      const users = await userRepository.find({
        where: {
          name: { $endsWith: 'e' } // Alice, Charlie, Eve
        }
      })

      expect(users.length).toBeGreaterThan(0)
      users.forEach((u: User) => expect(u.name).toMatch(/e$/))
    })

    // PostgreSQL-specific test
    if (dbType === 'postgres') {
      it('$ilike - should find records with case-insensitive match (PostgreSQL only)', async () => {
        const users = await userRepository.find({
          where: {
            name: { $ilike: 'ALICE' }
          }
        })

        expect(users).toHaveLength(1)
        expect(users[0]?.name).toBe('Alice')
      })
    }
  })

  // ============================================================================
  // Null Operators
  // ============================================================================

  describe('Null Operators', () => {
    beforeEach(async () => {
      // Create a user with null name
      await userRepository.create({
        email: 'nullname@example.com',
        name: null
      })
    })

    it('$isNull - should find records with null values', async () => {
      const users = await userRepository.find({
        where: {
          name: { $isNull: true }
        }
      })

      expect(users.length).toBeGreaterThan(0)
      users.forEach((u: User) => expect(u.name).toBeNull())
    })

    it('$isNull: false - should find records with non-null values', async () => {
      const users = await userRepository.find({
        where: {
          name: { $isNull: false }
        }
      })

      expect(users.length).toBeGreaterThan(0)
      users.forEach((u: User) => expect(u.name).not.toBeNull())
    })

    it('$isNotNull - should find records with non-null values', async () => {
      const users = await userRepository.find({
        where: {
          name: { $isNotNull: true }
        }
      })

      expect(users.length).toBeGreaterThan(0)
      users.forEach((u: User) => expect(u.name).not.toBeNull())
    })
  })

  // ============================================================================
  // Range Operator
  // ============================================================================

  describe('Range Operator', () => {
    it('$between - should find records within range', async () => {
      const allUsers = await userRepository.find({ orderBy: 'id' })
      const minId = allUsers[0]?.id
      const maxId = allUsers[2]?.id // First 3 users

      const users = await userRepository.find({
        where: {
          id: { $between: [minId, maxId] }
        }
      })

      expect(users).toHaveLength(3)
      users.forEach((u: User) => {
        expect(u.id).toBeGreaterThanOrEqual(minId)
        expect(u.id).toBeLessThanOrEqual(maxId)
      })
    })
  })

  // ============================================================================
  // Logical Operators
  // ============================================================================

  describe('Logical Operators', () => {
    it('$or - should find records matching any condition', async () => {
      const users = await userRepository.find({
        where: {
          $or: [{ name: 'Alice' }, { name: 'Bob' }]
        }
      })

      expect(users).toHaveLength(2)
      const names = users.map((u: User) => u.name)
      expect(names).toContain('Alice')
      expect(names).toContain('Bob')
    })

    it('$and - should find records matching all conditions', async () => {
      const users = await userRepository.find({
        where: {
          $and: [{ name: { $startsWith: 'A' } }, { email: { $contains: 'alice' } }]
        }
      })

      expect(users).toHaveLength(1)
      expect(users[0]?.name).toBe('Alice')
    })

    it('nested $or within $and - should handle complex queries', async () => {
      const users = await userRepository.find({
        where: {
          $and: [
            { email: { $like: '%@example.com' } },
            {
              $or: [{ name: 'Alice' }, { name: 'Bob' }]
            }
          ]
        }
      })

      expect(users).toHaveLength(2)
    })

    it('implicit AND between fields', async () => {
      const users = await userRepository.find({
        where: {
          name: { $startsWith: 'A' },
          email: { $contains: 'alice' }
        }
      })

      expect(users).toHaveLength(1)
      expect(users[0]?.name).toBe('Alice')
    })
  })

  // ============================================================================
  // Sorting
  // ============================================================================

  describe('Sorting', () => {
    it('orderBy with direction - should sort results', async () => {
      const users = await userRepository.find({
        orderBy: 'name',
        orderDirection: 'asc'
      })

      const names = users.map((u: User) => u.name)
      const sortedNames = [...names].sort()
      expect(names).toEqual(sortedNames)
    })

    it('orderBy descending', async () => {
      const users = await userRepository.find({
        orderBy: 'name',
        orderDirection: 'desc'
      })

      const names = users.map((u: User) => u.name)
      const sortedNames = [...names].sort().reverse()
      expect(names).toEqual(sortedNames)
    })

    it('sort array - multiple columns', async () => {
      // Create posts with same title to test secondary sort
      const user = await userRepository.findOne({ where: { email: 'alice@example.com' } })

      const posts = await postRepository.find({
        sort: [
          { column: 'published', direction: 'desc' as const },
          { column: 'title', direction: 'asc' as const }
        ]
      })

      expect(posts.length).toBeGreaterThan(0)
    })

    it('sorting with operators', async () => {
      const users = await userRepository.find({
        where: {
          name: { $isNotNull: true }
        },
        orderBy: 'email',
        orderDirection: 'asc'
      })

      const emails = users.map((u: User) => u.email)
      const sortedEmails = [...emails].sort()
      expect(emails).toEqual(sortedEmails)
    })
  })

  // ============================================================================
  // Pagination
  // ============================================================================

  describe('Pagination', () => {
    it('limit - should restrict number of results', async () => {
      const users = await userRepository.find({
        limit: 2
      })

      expect(users).toHaveLength(2)
    })

    it('offset - should skip results', async () => {
      const allUsers = await userRepository.find({ orderBy: 'id' })
      // SQLite requires LIMIT when using OFFSET
      const offsetUsers = await userRepository.find({
        orderBy: 'id',
        limit: 100, // Large limit to get remaining records
        offset: 2
      })

      expect(offsetUsers[0]?.id).toBe(allUsers[2]?.id)
    })

    it('limit with offset - pagination pattern', async () => {
      const pageSize = 2

      // Page 1
      const page1 = await userRepository.find({
        orderBy: 'id',
        limit: pageSize,
        offset: 0
      })

      // Page 2
      const page2 = await userRepository.find({
        orderBy: 'id',
        limit: pageSize,
        offset: pageSize
      })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
      expect(page1[0]?.id).not.toBe(page2[0]?.id)
    })

    it('pagination with operators', async () => {
      const users = await userRepository.find({
        where: {
          email: { $like: '%@example.com' }
        },
        orderBy: 'email',
        limit: 2,
        offset: 1
      })

      expect(users).toHaveLength(2)
    })
  })

  // ============================================================================
  // Column Selection
  // ============================================================================

  describe('Column Selection', () => {
    it('select - should return only specified columns', async () => {
      const users = await userRepository.find({
        select: ['id', 'email']
      })

      expect(users.length).toBeGreaterThan(0)
      users.forEach((u: any) => {
        expect(u.id).toBeDefined()
        expect(u.email).toBeDefined()
        // Note: Other columns may still be present but undefined
      })
    })

    it('select with operators', async () => {
      const users = await userRepository.find({
        where: {
          name: { $startsWith: 'A' }
        },
        select: ['email', 'name']
      })

      expect(users).toHaveLength(1)
      expect(users[0]?.email).toBe('alice@example.com')
      expect(users[0]?.name).toBe('Alice')
    })
  })

  // ============================================================================
  // findOne with operators
  // ============================================================================

  describe('findOne with Operators', () => {
    it('should find single record with operators', async () => {
      const user = await userRepository.findOne({
        where: {
          email: { $like: 'alice%' }
        }
      })

      expect(user).toBeDefined()
      expect(user?.email).toBe('alice@example.com')
    })

    it('should return null when not found', async () => {
      const user = await userRepository.findOne({
        where: {
          email: { $like: 'nonexistent%' }
        }
      })

      expect(user).toBeNull()
    })

    it('should respect ordering when multiple match', async () => {
      const user = await userRepository.findOne({
        where: {
          email: { $like: '%@example.com' }
        },
        orderBy: 'email',
        orderDirection: 'asc'
      })

      expect(user?.email).toBe('alice@example.com')
    })
  })

  // ============================================================================
  // count with operators
  // ============================================================================

  describe('count with Operators', () => {
    it('should count records matching operators', async () => {
      const count = await userRepository.count({
        where: {
          email: { $like: '%@example.com' }
        }
      })

      expect(count).toBe(5) // All seeded users
    })

    it('should count with complex operators', async () => {
      const count = await userRepository.count({
        where: {
          $or: [{ name: 'Alice' }, { name: 'Bob' }]
        }
      })

      expect(count).toBe(2)
    })
  })

  // ============================================================================
  // exists with operators
  // ============================================================================

  describe('exists with Operators', () => {
    it('should return true when records match', async () => {
      const exists = await userRepository.exists({
        where: {
          email: { $like: 'alice%' }
        }
      })

      expect(exists).toBe(true)
    })

    it('should return false when no records match', async () => {
      const exists = await userRepository.exists({
        where: {
          email: { $like: 'nonexistent%' }
        }
      })

      expect(exists).toBe(false)
    })
  })

  // ============================================================================
  // findAndCount with operators
  // ============================================================================

  describe('findAndCount with Operators', () => {
    it('should return both items and total count', async () => {
      const result = await userRepository.findAndCount({
        where: {
          email: { $like: '%@example.com' }
        },
        limit: 2,
        offset: 0
      })

      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(5)
    })

    it('should work with sorting and pagination', async () => {
      const result = await userRepository.findAndCount({
        where: {
          name: { $isNotNull: true }
        },
        orderBy: 'name',
        orderDirection: 'asc',
        limit: 3,
        offset: 1
      })

      expect(result.items).toHaveLength(3)
      expect(result.total).toBeGreaterThanOrEqual(3)
    })
  })

  // ============================================================================
  // Transactions with Operators
  // ============================================================================

  describe('Transactions with Operators', () => {
    it('should support operators within transactions', async () => {
      await userRepository.transaction(async (trx: any) => {
        const txRepo = userRepository.withTransaction(trx)

        // Find with operators in transaction
        const users = await txRepo.find({
          where: {
            email: { $like: 'alice%' }
          }
        })

        expect(users).toHaveLength(1)

        // Update user
        await txRepo.update(users[0].id, { name: 'Alice Updated' })

        // Verify with operators
        const updated = await txRepo.findOne({
          where: {
            name: { $eq: 'Alice Updated' }
          }
        })

        expect(updated).toBeDefined()
        expect(updated?.name).toBe('Alice Updated')
      })
    })

    it('should rollback transaction on error', async () => {
      const originalUser = await userRepository.findOne({
        where: { email: 'alice@example.com' }
      })

      try {
        await userRepository.transaction(async (trx: any) => {
          const txRepo = userRepository.withTransaction(trx)

          await txRepo.update(originalUser!.id, { name: 'Should Rollback' })

          // Force error
          throw new Error('Rollback test')
        })
      } catch {
        // Expected
      }

      // Verify original value preserved
      const user = await userRepository.findOne({
        where: { email: 'alice@example.com' }
      })
      expect(user?.name).toBe(originalUser?.name)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle multiple operators on same field', async () => {
      const allUsers = await userRepository.find({ orderBy: 'id' })
      const minId = allUsers[1]?.id
      const maxId = allUsers[3]?.id

      const users = await userRepository.find({
        where: {
          id: { $gte: minId, $lte: maxId }
        }
      })

      expect(users).toHaveLength(3)
    })

    it('should handle special characters in LIKE patterns', async () => {
      // Create user with special characters
      await userRepository.create({
        email: 'test+special@example.com',
        name: 'Test%User'
      })

      // Search for the % character (should work with proper escaping in pattern)
      const users = await userRepository.find({
        where: {
          name: { $contains: '%' }
        }
      })

      expect(users.length).toBeGreaterThan(0)
    })

    it('should handle empty where clause', async () => {
      const users = await userRepository.find({
        where: {}
      })

      expect(users.length).toBeGreaterThan(0)
    })

    it('should handle undefined operator values', async () => {
      const users = await userRepository.find({
        where: {
          name: { $eq: 'Alice', $gt: undefined }
        }
      })

      expect(users).toHaveLength(1)
      expect(users[0]?.name).toBe('Alice')
    })

    it('should combine operators with simple equality', async () => {
      const users = await userRepository.find({
        where: {
          name: 'Alice',
          email: { $like: '%@example.com' }
        }
      })

      expect(users).toHaveLength(1)
    })
  })

  // ============================================================================
  // Performance Tests
  // ============================================================================

  describe('Performance', () => {
    it('should efficiently query with operators on indexed columns', async () => {
      // Email column is indexed
      const start = Date.now()

      for (let i = 0; i < 100; i++) {
        await userRepository.find({
          where: {
            email: { $like: 'alice%' }
          }
        })
      }

      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(5000) // 100 queries in under 5s
    })

    it('should efficiently use $in with many values', async () => {
      const emails = Array.from({ length: 100 }, (_, i) => `user${i}@example.com`)
      emails.push('alice@example.com') // Add one that exists

      const users = await userRepository.find({
        where: {
          email: { $in: emails }
        }
      })

      expect(users.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // Backwards Compatibility
  // ============================================================================

  describe('Backwards Compatibility', () => {
    it('should support simple equality (original API)', async () => {
      const users = await userRepository.find({
        where: { email: 'alice@example.com' }
      })

      expect(users).toHaveLength(1)
      expect(users[0]?.email).toBe('alice@example.com')
    })

    it('should support mixed simple and operator conditions', async () => {
      const users = await userRepository.find({
        where: {
          name: 'Alice',
          email: { $like: '%@example.com' }
        }
      })

      expect(users).toHaveLength(1)
    })

    it('should support original pagination API', async () => {
      const users = await userRepository.paginate({
        limit: 2,
        offset: 0,
        orderBy: 'email',
        orderDirection: 'asc'
      })

      expect(users.items).toHaveLength(2)
      expect(users.total).toBeGreaterThan(0)
    })
  })
})
