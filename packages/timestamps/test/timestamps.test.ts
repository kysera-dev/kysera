import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, sql } from 'kysely'
import Database from 'better-sqlite3'
import { SqliteDialect } from 'kysely'
import { createORM, createRepositoryFactory, type Plugin } from '@kysera/repository'
import {
  timestampsPlugin,
  timestampsPluginSQLite,
  timestampsPluginUnix,
  type TimestampsOptions
} from '../src'

// Test database schema
interface TestDatabase {
  users: {
    id: number
    name: string
    email: string
    created_at?: Date | string | null
    updated_at?: Date | string | null
  }
  posts: {
    id: number
    title: string
    content: string
    created?: Date | string | null  // Custom column name
    modified?: Date | string | null  // Custom column name
  }
  config: {
    id: number
    key: string
    value: string
  }
}

// Helper function to create a repository with plugins
function createTestRepository(
  db: Kysely<TestDatabase>,
  tableName: keyof TestDatabase & string,
  plugins: Plugin[] = []
) {
  const orm = createORM(db, plugins)
  return orm.createRepository((executor) => {
    const factory = createRepositoryFactory(executor)
    return factory.create({
      tableName,
      mapRow: (row) => row,
      schemas: {
        create: { parse: (v: any) => v } as any,
        update: { parse: (v: any) => v } as any
      }
    })
  })
}

describe('Timestamps Plugin', () => {
  let db: Kysely<TestDatabase>
  let sqlite: Database.Database

  beforeEach(async () => {
    sqlite = new Database(':memory:')
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({ database: sqlite })
    })

    // Create test tables
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('name', 'text', col => col.notNull())
      .addColumn('email', 'text', col => col.notNull().unique())
      .addColumn('created_at', 'text')
      .addColumn('updated_at', 'text')
      .execute()

    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('title', 'text', col => col.notNull())
      .addColumn('content', 'text', col => col.notNull())
      .addColumn('created', 'text')
      .addColumn('modified', 'text')
      .execute()

    await db.schema
      .createTable('config')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('key', 'text', col => col.notNull())
      .addColumn('value', 'text', col => col.notNull())
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
    sqlite.close()
  })

  describe('Repository Method Overrides', () => {
    it('should add created_at on create', async () => {
      const plugin = timestampsPluginSQLite()
      const userRepo = createTestRepository(db, 'users', [plugin])

      const beforeDate = new Date()
      const user = await userRepo.create({
        name: 'John Doe',
        email: 'john@example.com'
      })
      const afterDate = new Date()

      expect(user.created_at).toBeDefined()
      const createdAt = new Date(user.created_at!)
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeDate.getTime())
      expect(createdAt.getTime()).toBeLessThanOrEqual(afterDate.getTime())
    })

    it('should add updated_at on update', async () => {
      const plugin = timestampsPluginSQLite()
      const userRepo = createTestRepository(db, 'users', [plugin])

      // Create a user
      const user = await userRepo.create({
        name: 'John Doe',
        email: 'john@example.com'
      })

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10))

      // Update the user
      const updated = await userRepo.update(user.id, {
        name: 'Jane Doe'
      })

      expect(updated.updated_at).toBeDefined()
      expect(updated.updated_at).not.toBe(user.created_at)

      // Verify updated_at is newer than created_at
      const createdAt = new Date(user.created_at!)
      const updatedAt = new Date(updated.updated_at!)
      expect(updatedAt.getTime()).toBeGreaterThan(createdAt.getTime())
    })

    it('should respect setUpdatedAtOnInsert option', async () => {
      const plugin = timestampsPluginSQLite({
        setUpdatedAtOnInsert: true
      })
      const userRepo = createTestRepository(db, 'users', [plugin])

      const user = await userRepo.create({
        name: 'John Doe',
        email: 'john@example.com'
      })

      expect(user.created_at).toBeDefined()
      expect(user.updated_at).toBeDefined()
      expect(user.created_at).toBe(user.updated_at)
    })

    it('should skip timestamps when metadata skipTimestamps is true', async () => {
      const plugin = timestampsPluginSQLite()
      const userRepo = createTestRepository(db, 'users', [plugin])

      const user = await userRepo.createWithoutTimestamps({
        name: 'John Doe',
        email: 'john@example.com'
      })

      expect(user.created_at).toBeNull()
      expect(user.updated_at).toBeNull()
    })

    it('should respect table whitelist', async () => {
      const plugin = timestampsPluginSQLite({
        tables: ['users']
      })

      const userRepo = createTestRepository(db, 'users', [plugin])
      const configRepo = createTestRepository(db, 'config', [plugin])

      const user = await userRepo.create({
        name: 'John Doe',
        email: 'john@example.com'
      })

      const config = await configRepo.create({
        key: 'setting',
        value: 'value'
      })

      expect(user.created_at).toBeDefined()
      expect(config.created_at).toBeUndefined()
    })

    it('should respect table exclusions', async () => {
      const plugin = timestampsPluginSQLite({
        excludeTables: ['config']
      })

      const userRepo = createTestRepository(db, 'users', [plugin])
      const configRepo = createTestRepository(db, 'config', [plugin])

      const user = await userRepo.create({
        name: 'John Doe',
        email: 'john@example.com'
      })

      const config = await configRepo.create({
        key: 'setting',
        value: 'value'
      })

      expect(user.created_at).toBeDefined()
      expect(config.created_at).toBeUndefined()
    })

    it('should use custom timestamp generator', async () => {
      const customTimestamp = '2024-01-01T00:00:00.000Z'
      const plugin = timestampsPlugin({
        timestampGenerator: () => customTimestamp
      })
      const userRepo = createTestRepository(db, 'users', [plugin])

      const user = await userRepo.create({
        name: 'John Doe',
        email: 'john@example.com'
      })

      expect(user.created_at).toBe(customTimestamp)
    })

    it('should use custom column names', async () => {
      const plugin = timestampsPluginSQLite({
        createdAtColumn: 'created',
        updatedAtColumn: 'modified'
      })
      const postRepo = createTestRepository(db, 'posts', [plugin])

      const post = await postRepo.create({
        title: 'Test Post',
        content: 'Lorem ipsum'
      })

      expect(post.created).toBeDefined()
      expect(post.modified).toBeNull() // Only set on update

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10))

      const updated = await postRepo.update(post.id, {
        title: 'Updated Post'
      })

      expect(updated.modified).toBeDefined()
      expect(updated.modified).not.toBe(post.created)
    })
  })

  describe('Repository Extensions', () => {
    it('should add timestamp helper methods to repository', async () => {
      const plugin = timestampsPluginSQLite()
      const userRepo = createTestRepository(db, 'users', [plugin]) as any

      // Check that all methods exist
      expect(typeof userRepo.findCreatedAfter).toBe('function')
      expect(typeof userRepo.findCreatedBefore).toBe('function')
      expect(typeof userRepo.findCreatedBetween).toBe('function')
      expect(typeof userRepo.findUpdatedAfter).toBe('function')
      expect(typeof userRepo.findRecentlyUpdated).toBe('function')
      expect(typeof userRepo.findRecentlyCreated).toBe('function')
      expect(typeof userRepo.createWithoutTimestamps).toBe('function')
      expect(typeof userRepo.updateWithoutTimestamp).toBe('function')
      expect(typeof userRepo.touch).toBe('function')
      expect(typeof userRepo.getTimestampColumns).toBe('function')
    })

    it('should find records by creation date', async () => {
      const plugin = timestampsPluginSQLite()
      const userRepo = createTestRepository(db, 'users', [plugin]) as any

      // Create users with different timestamps
      const customPlugin = timestampsPlugin({
        timestampGenerator: () => '2024-01-01T00:00:00.000Z'
      })
      const repo1 = createTestRepository(db, 'users', [customPlugin])
      await repo1.create({ name: 'User 1', email: 'user1@example.com' })

      const customPlugin2 = timestampsPlugin({
        timestampGenerator: () => '2024-02-01T00:00:00.000Z'
      })
      const repo2 = createTestRepository(db, 'users', [customPlugin2])
      await repo2.create({ name: 'User 2', email: 'user2@example.com' })

      const customPlugin3 = timestampsPlugin({
        timestampGenerator: () => '2024-03-01T00:00:00.000Z'
      })
      const repo3 = createTestRepository(db, 'users', [customPlugin3])
      await repo3.create({ name: 'User 3', email: 'user3@example.com' })

      // Test findCreatedAfter
      const after = await userRepo.findCreatedAfter('2024-01-15T00:00:00.000Z')
      expect(after).toHaveLength(2)
      expect(after.map((u: any) => u.name)).toContain('User 2')
      expect(after.map((u: any) => u.name)).toContain('User 3')

      // Test findCreatedBefore
      const before = await userRepo.findCreatedBefore('2024-02-15T00:00:00.000Z')
      expect(before).toHaveLength(2)
      expect(before.map((u: any) => u.name)).toContain('User 1')
      expect(before.map((u: any) => u.name)).toContain('User 2')

      // Test findCreatedBetween
      const between = await userRepo.findCreatedBetween(
        '2024-01-15T00:00:00.000Z',
        '2024-02-15T00:00:00.000Z'
      )
      expect(between).toHaveLength(1)
      expect(between[0].name).toBe('User 2')
    })

    it('should find recently created/updated records', async () => {
      const plugin = timestampsPluginSQLite()
      const userRepo = createTestRepository(db, 'users', [plugin]) as any

      // Create multiple users
      for (let i = 0; i < 15; i++) {
        await userRepo.create({
          name: `User ${i}`,
          email: `user${i}@example.com`
        })
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 2))
      }

      // Test findRecentlyCreated
      const recent = await userRepo.findRecentlyCreated(5)
      expect(recent).toHaveLength(5)
      expect(recent[0].name).toBe('User 14') // Most recent
      expect(recent[4].name).toBe('User 10') // 5th most recent

      // Update some users
      for (let i = 0; i < 5; i++) {
        await userRepo.update(i + 1, { name: `Updated User ${i}` })
        await new Promise(resolve => setTimeout(resolve, 2))
      }

      // Test findRecentlyUpdated
      const recentlyUpdated = await userRepo.findRecentlyUpdated(3)
      expect(recentlyUpdated).toHaveLength(3)
      expect(recentlyUpdated[0].name).toBe('Updated User 4') // Most recently updated
    })

    it('should touch a record (update only timestamp)', async () => {
      const plugin = timestampsPluginSQLite()
      const userRepo = createTestRepository(db, 'users', [plugin]) as any

      const user = await userRepo.create({
        name: 'John Doe',
        email: 'john@example.com'
      })

      const originalName = user.name
      const originalCreatedAt = user.created_at

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10))

      // Touch the record
      await userRepo.touch(user.id)

      // Fetch updated record
      const touched = await userRepo.findById(user.id)

      expect(touched.name).toBe(originalName) // Name unchanged
      expect(touched.created_at).toBe(originalCreatedAt) // created_at unchanged
      expect(touched.updated_at).toBeDefined()
      expect(touched.updated_at).not.toBe(originalCreatedAt) // updated_at changed
    })

    it('should get timestamp column configuration', async () => {
      const plugin = timestampsPluginSQLite({
        createdAtColumn: 'created',
        updatedAtColumn: 'modified'
      })
      const postRepo = createTestRepository(db, 'posts', [plugin]) as any

      const config = postRepo.getTimestampColumns()
      expect(config).toEqual({
        createdAt: 'created',
        updatedAt: 'modified'
      })
    })

    it('should not extend repository for excluded tables', async () => {
      const plugin = timestampsPluginSQLite({
        excludeTables: ['config']
      })
      const configRepo = createTestRepository(db, 'config', [plugin]) as any

      // Extensions should not exist for excluded table
      expect(configRepo.findCreatedAfter).toBeUndefined()
      expect(configRepo.findRecentlyCreated).toBeUndefined()
      expect(configRepo.touch).toBeUndefined()
    })
  })

  describe('Integration', () => {
    it('should work with repository pattern and ORM', async () => {
      const plugin = timestampsPluginSQLite()

      // Create a base repository without plugins
      const factory = createRepositoryFactory(db)
      const userRepo = factory.create({
        tableName: 'users',
        mapRow: (row) => row,
        schemas: {
          create: { parse: (v: any) => v } as any,
          update: { parse: (v: any) => v } as any
        }
      })

      // Apply plugin extensions manually
      const extendedRepo = plugin.extendRepository!(userRepo)

      // Create a user
      const user = await extendedRepo.create({
        name: 'John Doe',
        email: 'john@example.com'
      })

      expect(user.created_at).toBeDefined()
      expect(user.updated_at).toBeNull() // Only set on update

      // Update the user
      await new Promise(resolve => setTimeout(resolve, 10))
      const updated = await extendedRepo.update(user.id, {
        name: 'Jane Doe'
      })

      expect(updated.updated_at).toBeDefined()
      expect(updated.updated_at).not.toBe(user.created_at)
    })

    it('should handle multiple plugins together', async () => {
      // Mock audit plugin that tracks but doesn't insert audit info
      let auditCalled = false
      const auditPlugin: Plugin = {
        name: '@test/audit',
        version: '1.0.0',
        extendRepository(repo) {
          const originalCreate = repo.create.bind(repo)
          return {
            ...repo,
            async create(input: any, metadata: Record<string, any> = {}) {
              auditCalled = true
              // Don't add audit_user to the input since the column doesn't exist
              return originalCreate(input, metadata)
            }
          }
        }
      }

      const timestampsPluginInstance = timestampsPluginSQLite()
      const userRepo = createTestRepository(db, 'users', [auditPlugin, timestampsPluginInstance])

      const user = await userRepo.create({
        name: 'John Doe',
        email: 'john@example.com'
      })

      // Both plugins should have been called
      expect(auditCalled).toBe(true)
      expect(user.created_at).toBeDefined()
    })

    it('should work with Unix timestamp generator', async () => {
      const plugin = timestampsPluginUnix()
      const userRepo = createTestRepository(db, 'users', [plugin])

      const beforeTime = Math.floor(Date.now() / 1000)
      const user = await userRepo.create({
        name: 'John Doe',
        email: 'john@example.com'
      })
      const afterTime = Math.floor(Date.now() / 1000)

      // SQLite stores numbers as strings when returned
      const createdAtNum = typeof user.created_at === 'string'
        ? parseInt(user.created_at as string, 10)
        : user.created_at
      expect(createdAtNum).toBeGreaterThanOrEqual(beforeTime)
      expect(createdAtNum).toBeLessThanOrEqual(afterTime)
    })
  })
})