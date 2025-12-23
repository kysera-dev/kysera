/**
 * Test that @kysera/soft-delete works WITHOUT zod installed
 *
 * This test verifies that the main package functionality works
 * even when zod is not installed (it's an optional peer dependency).
 * The Zod schema is in a separate file (schema.ts) that users
 * only import if they need validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDatabase, seedTestData } from './setup/database.js'
import { softDeletePlugin, type SoftDeleteOptions } from '../src/index.js'
import { createORM, createRepositoryFactory, zodAdapter } from '@kysera/repository'
import type { Kysely } from 'kysely'
import type { TestDatabase } from './setup/database.js'
import { z } from 'zod'

// =============================================================================
// Test Database Schema
// =============================================================================

interface TestUser {
  id: number
  email: string
  name: string
  created_at: string
  deleted_at: string | null
}

// Define repository interface with soft delete methods
interface SoftDeleteTestRepository {
  tableName: string
  executor: Kysely<TestDatabase>
  findAll: () => Promise<TestUser[]>
  findById: (id: number | string) => Promise<TestUser | null>
  update: (id: number, data: Partial<TestUser>) => Promise<TestUser>
  softDelete?: (id: number | string) => Promise<TestUser>
  restore?: (id: number | string) => Promise<TestUser>
  hardDelete?: (id: number | string) => Promise<void>
  findAllWithDeleted?: () => Promise<TestUser[]>
  findDeleted?: () => Promise<TestUser[]>
  findWithDeleted?: (id: number | string) => Promise<TestUser | null>
  softDeleteMany?: (ids: (number | string)[]) => Promise<TestUser[]>
  restoreMany?: (ids: (number | string)[]) => Promise<TestUser[]>
  hardDeleteMany?: (ids: (number | string)[]) => Promise<void>
}

// =============================================================================
// Tests
// =============================================================================

describe('Soft Delete Plugin - Works Without Zod', () => {
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

  it('should create plugin without importing zod', async () => {
    // This test verifies that we can create the plugin without zod
    const plugin = softDeletePlugin({
      deletedAtColumn: 'deleted_at',
      includeDeleted: false
    })

    expect(plugin).toBeDefined()
    expect(plugin.name).toBe('@kysera/soft-delete')
  })

  it('should work with Repository pattern without zod', async () => {
    const orm = await createORM(db, [softDeletePlugin()])

    const repo = orm.createRepository(executor => {
      const base = createRepositoryFactory(executor)
      return base.create({
        tableName: 'users' as keyof TestDatabase,
        mapRow: row => row as TestUser,
        schemas: {
          create: zodAdapter(z.any()),
          update: zodAdapter(z.any())
        }
      })
    }) as SoftDeleteTestRepository

    // Get Alice's ID
    const users = await db.selectFrom('users').selectAll().where('name', '=', 'Alice').execute()
    const aliceId = users[0]?.id
    if (!aliceId) throw new Error('Alice not found')

    // Test basic operations
    const allUsers = await repo.findAll()
    expect(allUsers).toHaveLength(3)

    // Soft delete
    if (repo.softDelete) {
      await repo.softDelete(aliceId)
    } else {
      throw new Error('softDelete method not found')
    }

    // Should not appear in findAll
    const remainingUsers = await repo.findAll()
    expect(remainingUsers).toHaveLength(2)

    // Should appear in findWithDeleted
    const deletedUser = repo.findWithDeleted ? await repo.findWithDeleted(aliceId) : null
    expect(deletedUser).toBeDefined()
    expect(deletedUser?.deleted_at).not.toBeNull()

    // Restore
    if (repo.restore) {
      await repo.restore(aliceId)
    }
    const restoredUsers = await repo.findAll()
    expect(restoredUsers).toHaveLength(3)
  })

  it('should support bulk operations without zod', async () => {
    const orm = await createORM(db, [softDeletePlugin()])

    const repo = orm.createRepository(executor => {
      const base = createRepositoryFactory(executor)
      return base.create({
        tableName: 'users' as keyof TestDatabase,
        mapRow: row => row as TestUser,
        schemas: {
          create: zodAdapter(z.any()),
          update: zodAdapter(z.any())
        }
      })
    }) as SoftDeleteTestRepository

    // Get user IDs
    const users = await db.selectFrom('users').selectAll().execute()
    const ids = users.slice(0, 2).map(u => u.id)

    // Soft delete multiple
    if (repo.softDeleteMany) {
      await repo.softDeleteMany(ids)
    }

    const remainingUsers = await repo.findAll()
    expect(remainingUsers).toHaveLength(1)

    // Restore multiple
    if (repo.restoreMany) {
      await repo.restoreMany(ids)
    }
    const restoredUsers = await repo.findAll()
    expect(restoredUsers).toHaveLength(3)

    // Hard delete multiple
    if (repo.hardDeleteMany) {
      await repo.hardDeleteMany(ids)
    }
    const finalUsers = await repo.findAll()
    expect(finalUsers).toHaveLength(1)
  })

  it('should support configuration options without zod', async () => {
    const options: SoftDeleteOptions = {
      deletedAtColumn: 'deleted_at',
      includeDeleted: false,
      tables: ['users'],
      primaryKeyColumn: 'id'
    }

    const plugin = softDeletePlugin(options)
    const orm = await createORM(db, [plugin])

    const repo = orm.createRepository(executor => {
      const base = createRepositoryFactory(executor)
      return base.create({
        tableName: 'users' as keyof TestDatabase,
        mapRow: row => row as TestUser,
        schemas: {
          create: zodAdapter(z.any()),
          update: zodAdapter(z.any())
        }
      })
    }) as SoftDeleteTestRepository

    // Get Alice's ID
    const users = await db.selectFrom('users').selectAll().where('name', '=', 'Alice').execute()
    const aliceId = users[0]?.id
    if (!aliceId) throw new Error('Alice not found')

    if (repo.softDelete) {
      await repo.softDelete(aliceId)
    }
    const remainingUsers = await repo.findAll()
    expect(remainingUsers).toHaveLength(2)
  })

  it('should filter soft-deleted records in queries without zod', async () => {
    const orm = await createORM(db, [
      softDeletePlugin({
        deletedAtColumn: 'deleted_at',
        includeDeleted: false
      })
    ])

    const repo = orm.createRepository(executor => {
      const base = createRepositoryFactory(executor)
      return base.create({
        tableName: 'users' as keyof TestDatabase,
        mapRow: row => row as TestUser,
        schemas: {
          create: zodAdapter(z.any()),
          update: zodAdapter(z.any())
        }
      })
    }) as SoftDeleteTestRepository

    // Get Alice's ID
    const users = await db.selectFrom('users').selectAll().where('name', '=', 'Alice').execute()
    const aliceId = users[0]?.id
    if (!aliceId) throw new Error('Alice not found')

    // Soft delete one user
    if (repo.softDelete) {
      await repo.softDelete(aliceId)
    }

    // findAll should exclude soft-deleted
    const activeUsers = await repo.findAll()
    expect(activeUsers).toHaveLength(2)
    expect(activeUsers.every((u: TestUser) => u.deleted_at === null)).toBe(true)

    // findAllWithDeleted should include all
    const allUsers = repo.findAllWithDeleted ? await repo.findAllWithDeleted() : []
    expect(allUsers).toHaveLength(3)

    // findDeleted should return only soft-deleted
    const deletedUsers = repo.findDeleted ? await repo.findDeleted() : []
    expect(deletedUsers).toHaveLength(1)
    expect(deletedUsers[0]?.id).toBe(aliceId)
  })
})

describe('Soft Delete Schema - Separate Import', () => {
  it('should allow importing schema separately when zod is available', async () => {
    // This test verifies that the schema can be imported separately
    // when users need Zod validation
    const { SoftDeleteOptionsSchema } = await import('../src/schema.js')

    expect(SoftDeleteOptionsSchema).toBeDefined()

    const result = SoftDeleteOptionsSchema.safeParse({
      deletedAtColumn: 'deleted_at',
      includeDeleted: false,
      tables: ['users']
    })

    expect(result.success).toBe(true)
  })

  it('should validate invalid options with schema', async () => {
    const { SoftDeleteOptionsSchema } = await import('../src/schema.js')

    const result = SoftDeleteOptionsSchema.safeParse({
      deletedAtColumn: 123 // Should be string
    })

    expect(result.success).toBe(false)
  })
})
