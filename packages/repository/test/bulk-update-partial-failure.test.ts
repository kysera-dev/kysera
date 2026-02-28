/**
 * M-15: Bulk Update Partial Failure Tests
 *
 * Verifies that bulkUpdate (changed from Promise.all to sequential for-loop in CRIT-4):
 * 1. Stops on first error (NotFoundError for missing record)
 * 2. Results array only contains successfully updated records before the failure
 * 3. Transaction rollback behavior when used inside a transaction
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { createTestDatabase } from './setup/database.js'
import { createRepositoryFactory, zodAdapter } from '../src/index.js'
import type { Kysely, Selectable } from 'kysely'
import type { TestDatabase } from './setup/database.js'
import { NotFoundError } from '@kysera/core'

// Define schemas for validation
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

const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional()
})

interface User {
  id: number
  email: string
  name: string
  created_at: Date | string
  deleted_at: Date | string | null
}

function createUserRepo(db: Kysely<TestDatabase>) {
  const factory = createRepositoryFactory(db)
  return factory.create<'users', User>({
    tableName: 'users',
    mapRow: (row: Selectable<TestDatabase['users']>): User => ({
      id: row.id,
      email: row.email,
      name: row.name,
      created_at: row.created_at,
      deleted_at: row.deleted_at
    }),
    schemas: {
      entity: zodAdapter(UserSchema),
      create: zodAdapter(CreateUserSchema),
      update: zodAdapter(UpdateUserSchema)
    }
  })
}

describe('Bulk Update - Partial Failure (M-15)', () => {
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

  describe('Sequential execution - stops on first error', () => {
    it('should throw NotFoundError when a record does not exist', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })

      await expect(
        userRepo.bulkUpdate([
          { id: user1.id, data: { name: 'Updated 1' } },
          { id: 99999, data: { name: 'Non-existent' } }
        ])
      ).rejects.toThrow(NotFoundError)
    })

    it('should throw NotFoundError with correct message', async () => {
      const userRepo = createUserRepo(db)

      await userRepo.create({ email: 'user1@test.com', name: 'User 1' })

      await expect(
        userRepo.bulkUpdate([{ id: 99999, data: { name: 'Non-existent' } }])
      ).rejects.toThrow('Record not found')
    })

    it('should stop processing after first missing record', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' })
      const user3 = await userRepo.create({ email: 'user3@test.com', name: 'User 3' })

      // The missing record (99999) is the second item.
      // user1 should be updated, user3 should NOT be updated (sequential stops at failure).
      try {
        await userRepo.bulkUpdate([
          { id: user1.id, data: { name: 'Updated 1' } },
          { id: 99999, data: { name: 'Ghost' } },
          { id: user3.id, data: { name: 'Updated 3' } }
        ])
      } catch {
        // Expected NotFoundError
      }

      // user1 WAS updated (processed before the error)
      const fetchedUser1 = await userRepo.findById(user1.id)
      expect(fetchedUser1?.name).toBe('Updated 1')

      // user2 was NOT in the update list, should be unchanged
      const fetchedUser2 = await userRepo.findById(user2.id)
      expect(fetchedUser2?.name).toBe('User 2')

      // user3 was AFTER the error, should NOT be updated
      const fetchedUser3 = await userRepo.findById(user3.id)
      expect(fetchedUser3?.name).toBe('User 3')
    })

    it('should handle first item being the missing record', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' })

      try {
        await userRepo.bulkUpdate([
          { id: 99999, data: { name: 'Ghost' } },
          { id: user1.id, data: { name: 'Updated 1' } },
          { id: user2.id, data: { name: 'Updated 2' } }
        ])
      } catch {
        // Expected
      }

      // Neither user should be updated since the error was on the first item
      const fetchedUser1 = await userRepo.findById(user1.id)
      expect(fetchedUser1?.name).toBe('User 1')

      const fetchedUser2 = await userRepo.findById(user2.id)
      expect(fetchedUser2?.name).toBe('User 2')
    })

    it('should handle last item being the missing record', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' })

      try {
        await userRepo.bulkUpdate([
          { id: user1.id, data: { name: 'Updated 1' } },
          { id: user2.id, data: { name: 'Updated 2' } },
          { id: 99999, data: { name: 'Ghost' } }
        ])
      } catch {
        // Expected
      }

      // Both users WERE updated since the error was on the last item
      const fetchedUser1 = await userRepo.findById(user1.id)
      expect(fetchedUser1?.name).toBe('Updated 1')

      const fetchedUser2 = await userRepo.findById(user2.id)
      expect(fetchedUser2?.name).toBe('Updated 2')
    })
  })

  describe('Results array contains only successful updates', () => {
    it('should return all results on full success', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' })
      const user3 = await userRepo.create({ email: 'user3@test.com', name: 'User 3' })

      const results = await userRepo.bulkUpdate([
        { id: user1.id, data: { name: 'Updated 1' } },
        { id: user2.id, data: { name: 'Updated 2' } },
        { id: user3.id, data: { name: 'Updated 3' } }
      ])

      expect(results).toHaveLength(3)
      expect(results[0]?.name).toBe('Updated 1')
      expect(results[1]?.name).toBe('Updated 2')
      expect(results[2]?.name).toBe('Updated 3')
    })

    it('should not return partial results on failure (thrown error prevents return)', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' })

      // Since the error is thrown and the function never returns,
      // we verify the error is thrown and no results are returned
      let results: User[] | undefined
      try {
        results = await userRepo.bulkUpdate([
          { id: user1.id, data: { name: 'Updated 1' } },
          { id: 99999, data: { name: 'Ghost' } },
          { id: user2.id, data: { name: 'Updated 2' } }
        ])
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError)
      }

      // results should be undefined because the function threw
      expect(results).toBeUndefined()
    })

    it('should maintain order of successfully updated records', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'a@test.com', name: 'Alpha' })
      const user2 = await userRepo.create({ email: 'b@test.com', name: 'Beta' })
      const user3 = await userRepo.create({ email: 'c@test.com', name: 'Gamma' })

      const results = await userRepo.bulkUpdate([
        { id: user3.id, data: { name: 'Updated Gamma' } },
        { id: user1.id, data: { name: 'Updated Alpha' } },
        { id: user2.id, data: { name: 'Updated Beta' } }
      ])

      // Results should be in the same order as the input array
      expect(results[0]?.name).toBe('Updated Gamma')
      expect(results[1]?.name).toBe('Updated Alpha')
      expect(results[2]?.name).toBe('Updated Beta')
    })
  })

  describe('Transaction rollback behavior', () => {
    it('should rollback all updates when used inside a transaction that fails', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' })
      const user3 = await userRepo.create({ email: 'user3@test.com', name: 'User 3' })

      // Use a raw Kysely transaction to wrap the bulkUpdate.
      // When the bulkUpdate fails on the missing record, the transaction should rollback.
      try {
        await db.transaction().execute(async trx => {
          const txRepo = createUserRepo(trx as unknown as Kysely<TestDatabase>)

          await txRepo.bulkUpdate([
            { id: user1.id, data: { name: 'TX Updated 1' } },
            { id: user2.id, data: { name: 'TX Updated 2' } },
            { id: 99999, data: { name: 'Ghost' } }, // This will fail
            { id: user3.id, data: { name: 'TX Updated 3' } }
          ])
        })
      } catch {
        // Expected
      }

      // All updates should be rolled back since they were in a transaction
      const fetchedUser1 = await userRepo.findById(user1.id)
      expect(fetchedUser1?.name).toBe('User 1')

      const fetchedUser2 = await userRepo.findById(user2.id)
      expect(fetchedUser2?.name).toBe('User 2')

      const fetchedUser3 = await userRepo.findById(user3.id)
      expect(fetchedUser3?.name).toBe('User 3')
    })

    it('should commit all updates when transaction succeeds', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' })

      await db.transaction().execute(async trx => {
        const txRepo = createUserRepo(trx as unknown as Kysely<TestDatabase>)

        await txRepo.bulkUpdate([
          { id: user1.id, data: { name: 'TX Updated 1' } },
          { id: user2.id, data: { name: 'TX Updated 2' } }
        ])
      })

      // Updates should persist after the transaction commits
      const fetchedUser1 = await userRepo.findById(user1.id)
      expect(fetchedUser1?.name).toBe('TX Updated 1')

      const fetchedUser2 = await userRepo.findById(user2.id)
      expect(fetchedUser2?.name).toBe('TX Updated 2')
    })

    it('should rollback when transaction throws after successful bulkUpdate', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' })

      try {
        await db.transaction().execute(async trx => {
          const txRepo = createUserRepo(trx as unknown as Kysely<TestDatabase>)

          // bulkUpdate succeeds
          await txRepo.bulkUpdate([
            { id: user1.id, data: { name: 'TX Updated 1' } },
            { id: user2.id, data: { name: 'TX Updated 2' } }
          ])

          // But then something else in the transaction fails
          throw new Error('Something went wrong after bulkUpdate')
        })
      } catch {
        // Expected
      }

      // All bulkUpdate changes should be rolled back
      const fetchedUser1 = await userRepo.findById(user1.id)
      expect(fetchedUser1?.name).toBe('User 1')

      const fetchedUser2 = await userRepo.findById(user2.id)
      expect(fetchedUser2?.name).toBe('User 2')
    })

    it('should handle multiple bulkUpdates in a single transaction', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' })

      try {
        await db.transaction().execute(async trx => {
          const txRepo = createUserRepo(trx as unknown as Kysely<TestDatabase>)

          // First bulkUpdate succeeds
          await txRepo.bulkUpdate([
            { id: user1.id, data: { name: 'First Update' } }
          ])

          // Second bulkUpdate fails
          await txRepo.bulkUpdate([
            { id: user2.id, data: { name: 'Second Update' } },
            { id: 99999, data: { name: 'Ghost' } }
          ])
        })
      } catch {
        // Expected
      }

      // Both updates should be rolled back
      const fetchedUser1 = await userRepo.findById(user1.id)
      expect(fetchedUser1?.name).toBe('User 1')

      const fetchedUser2 = await userRepo.findById(user2.id)
      expect(fetchedUser2?.name).toBe('User 2')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty update array', async () => {
      const userRepo = createUserRepo(db)

      const results = await userRepo.bulkUpdate([])
      expect(results).toEqual([])
    })

    it('should handle single item success', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })

      const results = await userRepo.bulkUpdate([
        { id: user1.id, data: { name: 'Updated' } }
      ])

      expect(results).toHaveLength(1)
      expect(results[0]?.name).toBe('Updated')
    })

    it('should handle single item failure', async () => {
      const userRepo = createUserRepo(db)

      await expect(
        userRepo.bulkUpdate([{ id: 99999, data: { name: 'Ghost' } }])
      ).rejects.toThrow(NotFoundError)
    })

    it('should propagate validation errors before any updates', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })

      // Invalid email should fail validation on the first item
      await expect(
        userRepo.bulkUpdate([
          { id: user1.id, data: { email: 'invalid-email' } }
        ])
      ).rejects.toThrow()

      // user1 should be unchanged because validation failed before the DB update
      const fetchedUser1 = await userRepo.findById(user1.id)
      expect(fetchedUser1?.name).toBe('User 1')
      expect(fetchedUser1?.email).toBe('user1@test.com')
    })

    it('should fail on second item validation while first is already committed', async () => {
      const userRepo = createUserRepo(db)

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' })
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' })

      try {
        await userRepo.bulkUpdate([
          { id: user1.id, data: { name: 'Updated 1' } },
          { id: user2.id, data: { email: 'invalid-email' } } // Validation error
        ])
      } catch {
        // Expected validation error
      }

      // user1 was updated before the validation error on user2
      const fetchedUser1 = await userRepo.findById(user1.id)
      expect(fetchedUser1?.name).toBe('Updated 1')

      // user2 should be unchanged
      const fetchedUser2 = await userRepo.findById(user2.id)
      expect(fetchedUser2?.name).toBe('User 2')
    })
  })
})
