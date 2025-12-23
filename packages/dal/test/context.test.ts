/**
 * Tests for context utilities.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Kysely, Transaction } from 'kysely'
import type { DbContext } from '../src/types.js'
import { DB_CONTEXT_SYMBOL, IN_TRANSACTION_SYMBOL } from '../src/types.js'
import { createContext, isInTransaction, withTransaction, withContext } from '../src/context.js'

// Mock database type
interface TestDB {
  users: { id: number; name: string }
}

/**
 * Type-safe mock factory for Kysely instances.
 * Uses `unknown` intermediate cast for safety while maintaining type information.
 */
function createMockKysely(overrides: Record<string, unknown> = {}): Kysely<TestDB> {
  return {
    selectFrom: vi.fn(),
    ...overrides
  } as unknown as Kysely<TestDB>
}

/**
 * Type-safe mock factory for Transaction instances.
 */
function createMockTransaction(overrides: Record<string, unknown> = {}): Transaction<TestDB> {
  // Mock the executeQuery method required by sql template literals
  const mockExecuteQuery = vi.fn().mockResolvedValue({ rows: [] })

  return {
    selectFrom: vi.fn(),
    isTransaction: true,
    executeQuery: mockExecuteQuery,
    ...overrides
  } as unknown as Transaction<TestDB>
}

/**
 * Helper to create a DbContext with the required symbol.
 */
function createMockDbContext(
  db: Kysely<TestDB> | Transaction<TestDB>,
  isTransaction: boolean
): DbContext<TestDB> {
  return {
    [DB_CONTEXT_SYMBOL]: true,
    db,
    isTransaction
  }
}

describe('createContext', () => {
  it('should create context from database instance', () => {
    const mockDb = createMockKysely()
    const ctx = createContext(mockDb)

    expect(ctx.db).toBe(mockDb)
    expect(ctx.isTransaction).toBe(false)
    expect(ctx[DB_CONTEXT_SYMBOL]).toBe(true)
  })

  it('should detect transaction context', () => {
    const mockTrx = createMockTransaction()
    const ctx = createContext(mockTrx)

    expect(ctx.db).toBe(mockTrx)
    expect(ctx.isTransaction).toBe(true)
  })

  it('should handle false isTransaction value', () => {
    const mockDb = createMockKysely({ isTransaction: false })
    const ctx = createContext(mockDb)

    expect(ctx.isTransaction).toBe(false)
  })

  it('should allow overriding isTransaction', () => {
    const mockDb = createMockKysely()
    const ctx = createContext(mockDb, true)

    expect(ctx.isTransaction).toBe(true)
  })
})

describe('isInTransaction', () => {
  it('should return true for transaction context', () => {
    const ctx = createMockDbContext(createMockTransaction(), true)
    expect(isInTransaction(ctx)).toBe(true)
  })

  it('should return false for non-transaction context', () => {
    const ctx = createMockDbContext(createMockKysely(), false)
    expect(isInTransaction(ctx)).toBe(false)
  })
})

describe('withTransaction', () => {
  /**
   * Creates a mock Kysely instance with transaction support.
   * The transaction().execute() pattern matches Kysely's API.
   */
  function createMockDbWithTransaction(mockTrx: Transaction<TestDB>): Kysely<TestDB> {
    return {
      transaction: vi.fn().mockReturnValue({
        setIsolationLevel: vi.fn().mockReturnThis(),
        execute: vi
          .fn()
          .mockImplementation(async <T>(fn: (trx: Transaction<TestDB>) => Promise<T>) =>
            fn(mockTrx)
          )
      })
    } as unknown as Kysely<TestDB>
  }

  it('should execute function within transaction and return result', async () => {
    const mockTrx = createMockTransaction()
    const mockDb = createMockDbWithTransaction(mockTrx)

    const result = await withTransaction(mockDb, async ctx => {
      expect(ctx.db).toBe(mockTrx)
      expect(ctx.isTransaction).toBe(true)
      return { success: true }
    })

    expect(result).toEqual({ success: true })
    expect(mockDb.transaction).toHaveBeenCalled()
  })

  it('should create transaction context with isTransaction true', async () => {
    let capturedIsTransaction = false

    const mockTrx = createMockTransaction()
    const mockDb = createMockDbWithTransaction(mockTrx)

    await withTransaction(mockDb, async ctx => {
      capturedIsTransaction = ctx.isTransaction
    })

    expect(capturedIsTransaction).toBe(true)
  })

  it('should propagate errors from function', async () => {
    const mockTrx = createMockTransaction()
    const mockDb = createMockDbWithTransaction(mockTrx)

    const error = new Error('Transaction failed')

    await expect(
      withTransaction(mockDb, async () => {
        throw error
      })
    ).rejects.toThrow('Transaction failed')
  })

  it('should apply isolation level when specified', async () => {
    const mockTrx = createMockTransaction()
    const setIsolationLevelMock = vi.fn().mockReturnThis()
    const mockDb = {
      transaction: vi.fn().mockReturnValue({
        setIsolationLevel: setIsolationLevelMock,
        execute: vi
          .fn()
          .mockImplementation(async <T>(fn: (trx: Transaction<TestDB>) => Promise<T>) =>
            fn(mockTrx)
          )
      })
    } as unknown as Kysely<TestDB>

    await withTransaction(mockDb, async () => ({ done: true }), { isolationLevel: 'serializable' })

    expect(setIsolationLevelMock).toHaveBeenCalledWith('serializable')
  })

  it.skip('should handle nested transactions with savepoints (requires real DB)', async () => {
    // Note: Nested transaction support with savepoints requires real database connection
    // because sql template literals need an executor provider.
    // This is tested in integration tests with actual database instances.
    const mockTrx = createMockTransaction()
    // Mark as already in transaction
    ;(mockTrx as unknown as Record<symbol, boolean>)[IN_TRANSACTION_SYMBOL] = true
    const mockDb = createMockDbWithTransaction(mockTrx)

    let nestedCalled = false
    let nestedIsTransaction = false

    await withTransaction(mockDb, async ctx => {
      // Simulate a nested withTransaction call
      await withTransaction(ctx.db, async nestedCtx => {
        nestedCalled = true
        nestedIsTransaction = nestedCtx.isTransaction
      })
    })

    expect(nestedCalled).toBe(true)
    expect(nestedIsTransaction).toBe(true)
  })

  it('should accept DbContext as first argument', async () => {
    const mockTrx = createMockTransaction()
    const mockDb = createMockDbWithTransaction(mockTrx)
    const ctx = createMockDbContext(mockDb, false)

    const result = await withTransaction(ctx, async txCtx => {
      expect(txCtx.isTransaction).toBe(true)
      return 'from context'
    })

    expect(result).toBe('from context')
  })
})

describe('withContext', () => {
  it('should execute function with context and return result', async () => {
    const mockDb = createMockKysely()

    const result = await withContext(mockDb, async ctx => {
      expect(ctx.db).toBe(mockDb)
      return { users: [{ id: 1 }] }
    })

    expect(result).toEqual({ users: [{ id: 1 }] })
  })

  it('should create non-transaction context', async () => {
    let capturedIsTransaction = true // Start with true to verify it gets set to false

    const mockDb = createMockKysely()

    await withContext(mockDb, async ctx => {
      capturedIsTransaction = ctx.isTransaction
    })

    expect(capturedIsTransaction).toBe(false)
  })

  it('should propagate errors from function', async () => {
    const mockDb = createMockKysely()

    await expect(
      withContext(mockDb, async () => {
        throw new Error('Context operation failed')
      })
    ).rejects.toThrow('Context operation failed')
  })

  it('should pass the same db instance to context', async () => {
    const selectFromFn = vi.fn()
    const insertIntoFn = vi.fn()
    const mockDb = createMockKysely({
      selectFrom: selectFromFn,
      insertInto: insertIntoFn
    })

    await withContext(mockDb, async ctx => {
      expect(ctx.db).toBe(mockDb)
      // Verify it's the exact same reference
      expect(ctx.db.selectFrom).toBe(selectFromFn)
    })
  })
})
