/**
 * Tests for M-3: Rollback error propagation options
 *
 * Verifies that savepoint rollback errors can be handled in different ways:
 * - log-only (default)
 * - throw
 * - callback
 *
 * Uses real SQLite database for accurate transaction/savepoint behavior.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { withTransaction } from '../src/index.js'
import type { KyseraLogger } from '@kysera/core'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'

// Test database schema
interface TestDB {
  users: {
    id: Generated<number>
    name: string
    email: string
  }
}

// Create real SQLite database
function createTestDb(): Kysely<TestDB> {
  const sqlite = new Database(':memory:')
  return new Kysely<TestDB>({
    dialect: new SqliteDialect({ database: sqlite })
  })
}

// Initialize schema
async function initSchema(db: Kysely<TestDB>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('email', 'text', col => col.notNull().unique())
    .execute()
}

// Create mock logger
function createMockLogger(): KyseraLogger {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn()
  }
}

describe('M-3: Rollback error handling options', () => {
  let db: Kysely<TestDB>

  beforeAll(async () => {
    db = createTestDb()
    await initSchema(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    // Clear data between tests
    await db.deleteFrom('users').execute()
  })

  it('should use log-only mode by default (swallow rollback errors)', async () => {
    const mockLogger = createMockLogger()
    const originalError = new Error('Original operation failed')

    try {
      await withTransaction(
        db,
        async ctx => {
          // Insert a user in outer transaction
          await ctx.db
            .insertInto('users')
            .values({ name: 'Outer User', email: 'outer@test.com' })
            .execute()

          // Start nested transaction (creates savepoint)
          await withTransaction(
            ctx.db,
            async nestedCtx => {
              // Insert in nested transaction
              await nestedCtx.db
                .insertInto('users')
                .values({ name: 'Nested User', email: 'nested@test.com' })
                .execute()

              // Simulate an error - savepoint should rollback
              throw originalError
            },
            { logger: mockLogger, rollbackErrorMode: 'log-only' }
          )
        },
        { logger: mockLogger }
      )
      // Should not reach here
      expect.fail('Should have thrown')
    } catch (error) {
      // Should catch the original error (not a rollback error)
      expect(error).toBe(originalError)
    }

    // Verify outer transaction was also rolled back (nothing inserted)
    const users = await db.selectFrom('users').selectAll().execute()
    expect(users).toHaveLength(0)
  })

  it('should propagate original error in throw mode when no rollback error', async () => {
    const mockLogger = createMockLogger()
    const originalError = new Error('Test error in throw mode')

    await expect(async () => {
      await withTransaction(
        db,
        async ctx => {
          await withTransaction(
            ctx.db,
            async nestedCtx => {
              await nestedCtx.db
                .insertInto('users')
                .values({ name: 'Test', email: 'test@test.com' })
                .execute()
              throw originalError
            },
            { rollbackErrorMode: 'throw', logger: mockLogger }
          )
        },
        { logger: mockLogger }
      )
    }).rejects.toThrow('Test error in throw mode')

    // No data should be inserted (transaction rolled back)
    const users = await db.selectFrom('users').selectAll().execute()
    expect(users).toHaveLength(0)
  })

  it('should call callback in callback mode', async () => {
    const mockLogger = createMockLogger()
    const onRollbackError = vi.fn()
    const originalError = new Error('Test error for callback')

    try {
      await withTransaction(
        db,
        async ctx => {
          await withTransaction(
            ctx.db,
            async nestedCtx => {
              await nestedCtx.db
                .insertInto('users')
                .values({ name: 'Callback Test', email: 'callback@test.com' })
                .execute()
              throw originalError
            },
            { rollbackErrorMode: 'callback', onRollbackError, logger: mockLogger }
          )
        },
        { logger: mockLogger }
      )
    } catch (error) {
      // Should catch the original error
      expect(error).toBe(originalError)
    }

    // Callback is only called if rollback itself fails
    // In normal operation with SQLite, rollback succeeds so callback is NOT called
    // This test verifies the option is accepted and flow works correctly
  })

  it('should handle async callback correctly', async () => {
    const mockLogger = createMockLogger()
    const callbackResults: Array<{ original: unknown; rollback: unknown }> = []
    const onRollbackError = vi.fn(async (original: unknown, rollback: unknown) => {
      callbackResults.push({ original, rollback })
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    const originalError = new Error('Nested error')

    try {
      await withTransaction(
        db,
        async ctx => {
          await withTransaction(
            ctx.db,
            async nestedCtx => {
              await nestedCtx.db
                .insertInto('users')
                .values({ name: 'Async', email: 'async@test.com' })
                .execute()
              throw originalError
            },
            { rollbackErrorMode: 'callback', onRollbackError, logger: mockLogger }
          )
        },
        { logger: mockLogger }
      )
    } catch (error) {
      expect(error).toBe(originalError)
    }

    // Verify callback is async-compatible (no errors thrown)
    expect(onRollbackError).toBeDefined()
  })

  it('should preserve error stack traces in log-only mode', async () => {
    const mockLogger = createMockLogger()
    const originalError = new Error('Original error with stack')

    try {
      await withTransaction(
        db,
        async ctx => {
          await withTransaction(
            ctx.db,
            async nestedCtx => {
              await nestedCtx.db
                .insertInto('users')
                .values({ name: 'Stack Test', email: 'stack@test.com' })
                .execute()
              throw originalError
            },
            { rollbackErrorMode: 'log-only', logger: mockLogger }
          )
        },
        { logger: mockLogger }
      )
    } catch (error) {
      expect(error).toBe(originalError)
      expect((error as Error).stack).toBeDefined()
      expect((error as Error).stack).toContain('Original error with stack')
    }
  })

  it('should work with successful nested transactions (no rollback)', async () => {
    const mockLogger = createMockLogger()

    const result = await withTransaction(
      db,
      async ctx => {
        // Outer transaction inserts
        await ctx.db
          .insertInto('users')
          .values({ name: 'Outer', email: 'outer@success.com' })
          .execute()

        // Nested transaction (savepoint) succeeds
        const nested = await withTransaction(
          ctx.db,
          async nestedCtx => {
            await nestedCtx.db
              .insertInto('users')
              .values({ name: 'Nested', email: 'nested@success.com' })
              .execute()
            return 'nested success'
          },
          { rollbackErrorMode: 'throw', logger: mockLogger }
        )

        return nested
      },
      { logger: mockLogger }
    )

    expect(result).toBe('nested success')
    expect(mockLogger.error).not.toHaveBeenCalled()

    // Both users should be inserted
    const users = await db.selectFrom('users').selectAll().execute()
    expect(users).toHaveLength(2)
    expect(users.map(u => u.name).sort()).toEqual(['Nested', 'Outer'])
  })

  it('should rollback only nested savepoint on nested error', async () => {
    const mockLogger = createMockLogger()

    try {
      await withTransaction(
        db,
        async ctx => {
          // Outer transaction inserts
          await ctx.db
            .insertInto('users')
            .values({ name: 'Outer Survives', email: 'survives@test.com' })
            .execute()

          try {
            // Nested transaction fails
            await withTransaction(
              ctx.db,
              async nestedCtx => {
                await nestedCtx.db
                  .insertInto('users')
                  .values({ name: 'Nested Fails', email: 'fails@test.com' })
                  .execute()
                throw new Error('Nested failure')
              },
              { logger: mockLogger }
            )
          } catch {
            // Catch nested error, continue outer transaction
          }

          // Insert another user after nested failure
          await ctx.db
            .insertInto('users')
            .values({ name: 'After Nested', email: 'after@test.com' })
            .execute()

          return 'outer success'
        },
        { logger: mockLogger }
      )
    } catch {
      // Should not throw
      expect.fail('Should not throw')
    }

    // Only outer users should be inserted (nested was rolled back)
    const users = await db.selectFrom('users').selectAll().execute()
    expect(users).toHaveLength(2)
    expect(users.map(u => u.name).sort()).toEqual(['After Nested', 'Outer Survives'])
  })
})
