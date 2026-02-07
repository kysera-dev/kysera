/**
 * Comprehensive tests for Query Operators
 *
 * Tests MongoDB-style query operators for the enhanced find() method.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { createTestDatabase, seedTestData } from './setup/database.js'
import { createRepositoryFactory, zodAdapter } from '../src/index.js'
import {
  isOperatorObject,
  isValidOperator,
  isLogicalOperator,
  hasOperators,
  validateOperators,
  extractColumns,
  InvalidOperatorError,
  ALL_OPERATORS,
  COMPARISON_OPERATORS,
  ARRAY_OPERATORS,
  STRING_OPERATORS,
  NULL_OPERATORS,
  RANGE_OPERATORS,
  LOGICAL_OPERATORS
} from '../src/operators.js'
import type { Kysely, Selectable } from 'kysely'
import type { TestDatabase } from './setup/database.js'

// Test schemas
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  created_at: z.coerce.date(),
  deleted_at: z.coerce.date().nullable()
})

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
})

const PostSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  title: z.string(),
  content: z.string(),
  published: z.number(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date().nullable(),
  deleted_at: z.coerce.date().nullable()
})

const CreatePostSchema = z.object({
  user_id: z.number(),
  title: z.string(),
  content: z.string(),
  published: z.number().default(0)
})

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

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('Type Guards', () => {
  describe('isOperatorObject', () => {
    it('should return true for objects with $ prefixed keys', () => {
      expect(isOperatorObject({ $eq: 5 })).toBe(true)
      expect(isOperatorObject({ $gte: 10, $lte: 20 })).toBe(true)
      expect(isOperatorObject({ $in: [1, 2, 3] })).toBe(true)
    })

    it('should return false for primitive values', () => {
      expect(isOperatorObject(5)).toBe(false)
      expect(isOperatorObject('active')).toBe(false)
      expect(isOperatorObject(true)).toBe(false)
      expect(isOperatorObject(null)).toBe(false)
      expect(isOperatorObject(undefined)).toBe(false)
    })

    it('should return false for arrays', () => {
      expect(isOperatorObject([1, 2, 3])).toBe(false)
      expect(isOperatorObject(['$eq', 5])).toBe(false)
    })

    it('should return false for objects without $ prefixed keys', () => {
      expect(isOperatorObject({ name: 'test' })).toBe(false)
      expect(isOperatorObject({ status: 'active' })).toBe(false)
      expect(isOperatorObject({})).toBe(false)
    })
  })

  describe('isValidOperator', () => {
    it('should return true for all valid operators', () => {
      for (const op of ALL_OPERATORS) {
        expect(isValidOperator(op)).toBe(true)
      }
    })

    it('should return false for invalid operators', () => {
      expect(isValidOperator('$invalid')).toBe(false)
      expect(isValidOperator('$regex')).toBe(false)
      expect(isValidOperator('eq')).toBe(false)
      expect(isValidOperator('')).toBe(false)
    })
  })

  describe('isLogicalOperator', () => {
    it('should return true for $or and $and', () => {
      expect(isLogicalOperator('$or')).toBe(true)
      expect(isLogicalOperator('$and')).toBe(true)
    })

    it('should return false for other operators', () => {
      expect(isLogicalOperator('$eq')).toBe(false)
      expect(isLogicalOperator('$in')).toBe(false)
      expect(isLogicalOperator('$like')).toBe(false)
    })
  })
})

// ============================================================================
// Operator Constants Tests
// ============================================================================

describe('Operator Constants', () => {
  it('should have all comparison operators', () => {
    expect(COMPARISON_OPERATORS).toContain('$eq')
    expect(COMPARISON_OPERATORS).toContain('$ne')
    expect(COMPARISON_OPERATORS).toContain('$gt')
    expect(COMPARISON_OPERATORS).toContain('$gte')
    expect(COMPARISON_OPERATORS).toContain('$lt')
    expect(COMPARISON_OPERATORS).toContain('$lte')
  })

  it('should have all array operators', () => {
    expect(ARRAY_OPERATORS).toContain('$in')
    expect(ARRAY_OPERATORS).toContain('$nin')
  })

  it('should have all string operators', () => {
    expect(STRING_OPERATORS).toContain('$like')
    expect(STRING_OPERATORS).toContain('$ilike')
    expect(STRING_OPERATORS).toContain('$contains')
    expect(STRING_OPERATORS).toContain('$startsWith')
    expect(STRING_OPERATORS).toContain('$endsWith')
  })

  it('should have all null operators', () => {
    expect(NULL_OPERATORS).toContain('$isNull')
    expect(NULL_OPERATORS).toContain('$isNotNull')
  })

  it('should have range operator', () => {
    expect(RANGE_OPERATORS).toContain('$between')
  })

  it('should have logical operators', () => {
    expect(LOGICAL_OPERATORS).toContain('$or')
    expect(LOGICAL_OPERATORS).toContain('$and')
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

describe('Validation', () => {
  describe('hasOperators', () => {
    it('should detect operators in where clause', () => {
      expect(hasOperators({ age: { $gte: 18 } })).toBe(true)
      expect(hasOperators({ $or: [{ status: 'active' }] })).toBe(true)
      expect(hasOperators({ $and: [{ status: 'active' }] })).toBe(true)
    })

    it('should return false for simple equality conditions', () => {
      expect(hasOperators({ status: 'active' })).toBe(false)
      expect(hasOperators({ age: 25 })).toBe(false)
      expect(hasOperators({ id: 1, name: 'test' })).toBe(false)
    })
  })

  describe('validateOperators', () => {
    it('should validate valid operator objects', () => {
      expect(() => validateOperators({ age: { $gte: 18 } })).not.toThrow()
      expect(() => validateOperators({ status: { $in: ['active', 'pending'] } })).not.toThrow()
      expect(() =>
        validateOperators({ $or: [{ status: 'active' }, { status: 'pending' }] })
      ).not.toThrow()
    })

    it('should throw for invalid operators', () => {
      expect(() => validateOperators({ age: { $invalid: 18 } })).toThrow(InvalidOperatorError)
      expect(() => validateOperators({ name: { $regex: '.*' } })).toThrow(InvalidOperatorError)
    })

    it('should validate nested logical operators', () => {
      expect(() =>
        validateOperators({
          $or: [{ status: { $eq: 'active' } }, { age: { $gte: 18 } }]
        })
      ).not.toThrow()
    })

    it('should throw when $or/$and is not an array', () => {
      expect(() => validateOperators({ $or: { status: 'active' } })).toThrow(InvalidOperatorError)
      expect(() => validateOperators({ $and: 'invalid' })).toThrow(InvalidOperatorError)
    })
  })

  describe('extractColumns', () => {
    it('should extract column names from simple conditions', () => {
      const columns = extractColumns({ status: 'active', age: 25 })
      expect(columns).toContain('status')
      expect(columns).toContain('age')
    })

    it('should extract column names from operator conditions', () => {
      const columns = extractColumns({ age: { $gte: 18 }, email: { $like: '%@example.com' } })
      expect(columns).toContain('age')
      expect(columns).toContain('email')
    })

    it('should extract column names from nested $or/$and conditions', () => {
      const columns = extractColumns({
        $or: [{ status: 'active' }, { priority: { $gte: 5 } }],
        $and: [{ name: 'test' }]
      })
      expect(columns).toContain('status')
      expect(columns).toContain('priority')
      expect(columns).toContain('name')
    })

    it('should deduplicate column names', () => {
      const columns = extractColumns({
        status: 'active',
        $or: [{ status: 'pending' }, { status: 'archived' }]
      })
      expect(columns.filter(c => c === 'status')).toHaveLength(1)
    })
  })

  describe('InvalidOperatorError', () => {
    it('should include operator and field information', () => {
      const error = new InvalidOperatorError('$invalid', 'age')
      expect(error.message).toContain('$invalid')
      expect(error.message).toContain('age')
      expect(error.operator).toBe('$invalid')
      expect(error.field).toBe('age')
    })

    it('should work without field information', () => {
      const error = new InvalidOperatorError('$invalid')
      expect(error.message).toContain('$invalid')
      expect(error.operator).toBe('$invalid')
      expect(error.field).toBeUndefined()
    })
  })
})

// ============================================================================
// Integration Tests with Repository
// ============================================================================

describe('Repository find() with Operators', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup as () => Promise<void>
    await seedTestData(db)
  })

  afterEach(async () => {
    await cleanup()
  })

  function createUserRepo() {
    const factory = createRepositoryFactory(db)
    return factory.create<'users', User>({
      tableName: 'users',
      mapRow: (row: Selectable<TestDatabase['users']>) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        created_at: row.created_at,
        deleted_at: row.deleted_at
      }),
      schemas: {
        entity: zodAdapter(UserSchema),
        create: zodAdapter(CreateUserSchema)
      }
    })
  }

  function createPostRepo() {
    const factory = createRepositoryFactory(db)
    return factory.create<'posts', Post>({
      tableName: 'posts',
      mapRow: (row: Selectable<TestDatabase['posts']>) => ({
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        content: row.content,
        published: row.published,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at
      }),
      schemas: {
        entity: zodAdapter(PostSchema),
        create: zodAdapter(CreatePostSchema)
      }
    })
  }

  describe('Backwards Compatibility', () => {
    it('should work with simple equality conditions', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({ where: { name: 'Alice' } })
      expect(users).toHaveLength(1)
      expect(users[0]!.name).toBe('Alice')
    })

    it('should work without any options', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find()
      expect(users).toHaveLength(3)
    })

    it('should work with empty where clause', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({ where: {} })
      expect(users).toHaveLength(3)
    })
  })

  describe('Comparison Operators', () => {
    it('should filter with $eq operator', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        where: { name: { $eq: 'Bob' } }
      })
      expect(users).toHaveLength(1)
      expect(users[0]!.name).toBe('Bob')
    })

    it('should filter with $ne operator', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        where: { name: { $ne: 'Alice' } }
      })
      expect(users).toHaveLength(2)
      expect(users.every(u => u.name !== 'Alice')).toBe(true)
    })

    it('should filter with $gt operator', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { user_id: { $gt: 1 } }
      })
      expect(posts).toHaveLength(1)
      expect(posts.every(p => p.user_id > 1)).toBe(true)
    })

    it('should filter with $gte operator', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { user_id: { $gte: 2 } }
      })
      expect(posts).toHaveLength(1)
      expect(posts.every(p => p.user_id >= 2)).toBe(true)
    })

    it('should filter with $lt operator', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { user_id: { $lt: 2 } }
      })
      expect(posts).toHaveLength(2)
      expect(posts.every(p => p.user_id < 2)).toBe(true)
    })

    it('should filter with $lte operator', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { user_id: { $lte: 1 } }
      })
      expect(posts).toHaveLength(2)
      expect(posts.every(p => p.user_id <= 1)).toBe(true)
    })

    it('should combine multiple comparison operators on same field', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { id: { $gte: 1, $lte: 2 } }
      })
      expect(posts).toHaveLength(2)
      expect(posts.every(p => p.id >= 1 && p.id <= 2)).toBe(true)
    })
  })

  describe('Array Operators', () => {
    it('should filter with $in operator', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        where: { name: { $in: ['Alice', 'Bob'] } }
      })
      expect(users).toHaveLength(2)
      expect(users.map(u => u.name).sort()).toEqual(['Alice', 'Bob'])
    })

    it('should filter with $nin operator', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        where: { name: { $nin: ['Alice', 'Bob'] } }
      })
      expect(users).toHaveLength(1)
      expect(users[0]!.name).toBe('Charlie')
    })

    it('should handle empty $in array (match nothing)', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        where: { name: { $in: [] } }
      })
      expect(users).toHaveLength(0)
    })

    it('should handle empty $nin array (match everything)', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        where: { name: { $nin: [] } }
      })
      expect(users).toHaveLength(3)
    })
  })

  describe('String Operators', () => {
    it('should filter with $like operator', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        where: { email: { $like: '%@example.com' } }
      })
      expect(users).toHaveLength(3)
    })

    it('should filter with $contains operator', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { title: { $contains: 'Post' } }
      })
      expect(posts).toHaveLength(3)
    })

    it('should filter with $startsWith operator', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { title: { $startsWith: 'First' } }
      })
      expect(posts).toHaveLength(1)
      expect(posts[0]!.title).toBe('First Post')
    })

    it('should filter with $endsWith operator', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { title: { $endsWith: 'Post' } }
      })
      expect(posts).toHaveLength(3)
    })
  })

  describe('Null Operators', () => {
    it('should filter with $isNull: true', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { updated_at: { $isNull: true } }
      })
      expect(posts).toHaveLength(3)
    })

    it('should filter with $isNull: false', async () => {
      const postRepo = createPostRepo()
      // First update a post to set updated_at (SQLite needs ISO string format)
      await db.updateTable('posts').set({ updated_at: new Date().toISOString() as unknown as Date }).where('id', '=', 1).execute()

      const posts = await postRepo.find({
        where: { updated_at: { $isNull: false } }
      })
      expect(posts).toHaveLength(1)
    })

    it('should filter with $isNotNull: true', async () => {
      const postRepo = createPostRepo()
      // First update a post to set updated_at (SQLite needs ISO string format)
      await db.updateTable('posts').set({ updated_at: new Date().toISOString() as unknown as Date }).where('id', '=', 1).execute()

      const posts = await postRepo.find({
        where: { updated_at: { $isNotNull: true } }
      })
      expect(posts).toHaveLength(1)
    })
  })

  describe('Range Operator', () => {
    it('should filter with $between operator', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { id: { $between: [1, 2] } }
      })
      expect(posts).toHaveLength(2)
      expect(posts.every(p => p.id >= 1 && p.id <= 2)).toBe(true)
    })
  })

  describe('Logical Operators', () => {
    it('should filter with $or operator', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        where: {
          $or: [{ name: 'Alice' }, { name: 'Bob' }]
        }
      })
      expect(users).toHaveLength(2)
      expect(users.map(u => u.name).sort()).toEqual(['Alice', 'Bob'])
    })

    it('should filter with $and operator', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: {
          $and: [{ user_id: 1 }, { published: 1 }]
        }
      })
      expect(posts).toHaveLength(1)
      expect(posts[0]!.title).toBe('First Post')
    })

    it('should combine $or with other conditions', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: {
          published: 1,
          $or: [{ title: { $contains: 'First' } }, { title: { $contains: 'Bob' } }]
        }
      })
      expect(posts).toHaveLength(2)
    })

    it('should handle nested logical operators', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: {
          $or: [
            { $and: [{ user_id: 1 }, { published: 1 }] },
            { $and: [{ user_id: 2 }, { published: 1 }] }
          ]
        }
      })
      expect(posts).toHaveLength(2)
    })
  })

  describe('Sorting', () => {
    it('should sort with orderBy ascending', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        orderBy: 'name',
        orderDirection: 'asc'
      })
      expect(users.map(u => u.name)).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('should sort with orderBy descending', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        orderBy: 'name',
        orderDirection: 'desc'
      })
      expect(users.map(u => u.name)).toEqual(['Charlie', 'Bob', 'Alice'])
    })

    it('should sort with multiple columns', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        sort: [
          { column: 'published', direction: 'desc' },
          { column: 'id', direction: 'asc' }
        ]
      })
      // Published posts first (1), then unpublished (0)
      expect(posts[0]!.published).toBe(1)
      expect(posts[posts.length - 1]!.published).toBe(0)
    })

    it('should combine sorting with filtering', async () => {
      const postRepo = createPostRepo()
      const posts = await postRepo.find({
        where: { published: 1 },
        orderBy: 'title',
        orderDirection: 'asc'
      })
      expect(posts).toHaveLength(2)
      expect(posts[0]!.title < posts[1]!.title).toBe(true)
    })
  })

  describe('Pagination', () => {
    it('should apply limit', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        limit: 2
      })
      expect(users).toHaveLength(2)
    })

    it('should apply offset', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        orderBy: 'id',
        orderDirection: 'asc',
        offset: 1,
        limit: 10
      })
      expect(users).toHaveLength(2)
      expect(users[0]!.id).toBe(2)
    })

    it('should combine limit and offset', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        orderBy: 'id',
        orderDirection: 'asc',
        limit: 1,
        offset: 1
      })
      expect(users).toHaveLength(1)
      expect(users[0]!.id).toBe(2)
    })
  })

  describe('Column Selection', () => {
    it('should select specific columns', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        select: ['id', 'name']
      })
      expect(users).toHaveLength(3)
      // Note: Column selection at SQL level, but mapRow still returns full entity
      // The type system should narrow the return type
      expect(users[0]).toHaveProperty('id')
      expect(users[0]).toHaveProperty('name')
    })

    it('should combine column selection with filtering', async () => {
      const userRepo = createUserRepo()
      const users = await userRepo.find({
        where: { name: 'Alice' },
        select: ['id', 'email']
      })
      expect(users).toHaveLength(1)
    })
  })
})

describe('Repository findOne() with Operators', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup as () => Promise<void>
    await seedTestData(db)
  })

  afterEach(async () => {
    await cleanup()
  })

  function createUserRepo() {
    const factory = createRepositoryFactory(db)
    return factory.create<'users', User>({
      tableName: 'users',
      mapRow: (row: Selectable<TestDatabase['users']>) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        created_at: row.created_at,
        deleted_at: row.deleted_at
      }),
      schemas: {
        entity: zodAdapter(UserSchema),
        create: zodAdapter(CreateUserSchema)
      }
    })
  }

  it('should find one with operators', async () => {
    const userRepo = createUserRepo()
    const user = await userRepo.findOne({
      where: { name: { $eq: 'Alice' } }
    })
    expect(user).not.toBeNull()
    expect(user!.name).toBe('Alice')
  })

  it('should return null when no match', async () => {
    const userRepo = createUserRepo()
    const user = await userRepo.findOne({
      where: { name: { $eq: 'NonExistent' } }
    })
    expect(user).toBeNull()
  })

  it('should respect orderBy when finding one', async () => {
    const userRepo = createUserRepo()
    const user = await userRepo.findOne({
      orderBy: 'name',
      orderDirection: 'desc'
    })
    expect(user!.name).toBe('Charlie')
  })
})

describe('Repository count() with Operators', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup as () => Promise<void>
    await seedTestData(db)
  })

  afterEach(async () => {
    await cleanup()
  })

  function createPostRepo() {
    const factory = createRepositoryFactory(db)
    return factory.create<'posts', Post>({
      tableName: 'posts',
      mapRow: (row: Selectable<TestDatabase['posts']>) => ({
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        content: row.content,
        published: row.published,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at
      }),
      schemas: {
        entity: zodAdapter(PostSchema),
        create: zodAdapter(CreatePostSchema)
      }
    })
  }

  it('should count with operators', async () => {
    const postRepo = createPostRepo()
    const count = await postRepo.count({
      where: { published: { $eq: 1 } }
    })
    expect(count).toBe(2)
  })

  it('should count with $in operator', async () => {
    const postRepo = createPostRepo()
    const count = await postRepo.count({
      where: { id: { $in: [1, 2] } }
    })
    expect(count).toBe(2)
  })

  it('should count with $or operator', async () => {
    const postRepo = createPostRepo()
    const count = await postRepo.count({
      where: {
        $or: [{ user_id: 1 }, { user_id: 2 }]
      }
    })
    expect(count).toBe(3)
  })
})

describe('Repository findAndCount()', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup as () => Promise<void>
    await seedTestData(db)
  })

  afterEach(async () => {
    await cleanup()
  })

  function createUserRepo() {
    const factory = createRepositoryFactory(db)
    return factory.create<'users', User>({
      tableName: 'users',
      mapRow: (row: Selectable<TestDatabase['users']>) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        created_at: row.created_at,
        deleted_at: row.deleted_at
      }),
      schemas: {
        entity: zodAdapter(UserSchema),
        create: zodAdapter(CreateUserSchema)
      }
    })
  }

  it('should return items and total count', async () => {
    const userRepo = createUserRepo()
    const { items, total } = await userRepo.findAndCount({
      limit: 2
    })
    expect(items).toHaveLength(2)
    expect(total).toBe(3)
  })

  it('should work with operators', async () => {
    const userRepo = createUserRepo()
    const { items, total } = await userRepo.findAndCount({
      where: { name: { $in: ['Alice', 'Bob'] } },
      limit: 1
    })
    expect(items).toHaveLength(1)
    expect(total).toBe(2)
  })

  it('should work with sorting and pagination', async () => {
    const userRepo = createUserRepo()
    const { items, total } = await userRepo.findAndCount({
      orderBy: 'name',
      orderDirection: 'asc',
      limit: 2,
      offset: 1
    })
    expect(items).toHaveLength(2)
    expect(items[0]!.name).toBe('Bob')
    expect(total).toBe(3)
  })
})

describe('Repository exists() with Operators', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup as () => Promise<void>
    await seedTestData(db)
  })

  afterEach(async () => {
    await cleanup()
  })

  function createUserRepo() {
    const factory = createRepositoryFactory(db)
    return factory.create<'users', User>({
      tableName: 'users',
      mapRow: (row: Selectable<TestDatabase['users']>) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        created_at: row.created_at,
        deleted_at: row.deleted_at
      }),
      schemas: {
        entity: zodAdapter(UserSchema),
        create: zodAdapter(CreateUserSchema)
      }
    })
  }

  it('should check existence with operators', async () => {
    const userRepo = createUserRepo()
    const exists = await userRepo.exists({
      where: { email: { $like: '%@example.com' } }
    })
    expect(exists).toBe(true)
  })

  it('should return false when no match', async () => {
    const userRepo = createUserRepo()
    const exists = await userRepo.exists({
      where: { name: { $eq: 'NonExistent' } }
    })
    expect(exists).toBe(false)
  })
})
