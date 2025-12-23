/**
 * Tests for context transaction detection (H-6 fix).
 *
 * @module @kysera/dal
 */

import { describe, it, expect, vi } from 'vitest'
import type { Kysely, Transaction } from 'kysely'
import { createExecutor, wrapTransaction } from '@kysera/executor'
import { createContext } from '../src/context.js'
import { DB_CONTEXT_SYMBOL } from '../src/types.js'

// Mock database type
interface TestDB {
  users: { id: number; name: string }
}

/**
 * Type-safe mock factory for Kysely instances.
 */
function createMockKysely(overrides: Record<string, unknown> = {}): Kysely<TestDB> {
  return {
    selectFrom: vi.fn(),
    transaction: vi.fn(),
    ...overrides
  } as unknown as Kysely<TestDB>
}

/**
 * Type-safe mock factory for Transaction instances.
 */
function createMockTransaction(overrides: Record<string, unknown> = {}): Transaction<TestDB> {
  const mockExecuteQuery = vi.fn().mockResolvedValue({ rows: [] })

  return {
    selectFrom: vi.fn(),
    isTransaction: true,
    executeQuery: mockExecuteQuery,
    ...overrides
  } as unknown as Transaction<TestDB>
}

describe('Context transaction detection (H-6)', () => {
  describe('raw Kysely instances', () => {
    it('should detect raw Kysely instance as non-transaction', () => {
      const db = createMockKysely()
      const ctx = createContext(db)

      expect(ctx.isTransaction).toBe(false)
      expect(ctx[DB_CONTEXT_SYMBOL]).toBe(true)
    })

    it('should detect raw Transaction instance', () => {
      const trx = createMockTransaction()
      const ctx = createContext(trx)

      expect(ctx.isTransaction).toBe(true)
      expect(ctx[DB_CONTEXT_SYMBOL]).toBe(true)
    })

    it('should override detection with explicit flag', () => {
      const db = createMockKysely()
      const ctx = createContext(db, true)

      expect(ctx.isTransaction).toBe(true) // Overridden
    })
  })

  describe('KyseraExecutor instances', () => {
    it('should detect KyseraExecutor as non-transaction', async () => {
      const db = createMockKysely()
      const executor = await createExecutor(db, [])
      const ctx = createContext(executor)

      expect(ctx.isTransaction).toBe(false)
      expect(ctx[DB_CONTEXT_SYMBOL]).toBe(true)
    })

    it('should detect KyseraExecutor with plugins as non-transaction', async () => {
      const db = createMockKysely()
      const testPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        onInit: async () => {
          // No-op
        }
      }

      const executor = await createExecutor(db, [testPlugin])
      const ctx = createContext(executor)

      expect(ctx.isTransaction).toBe(false)
      expect(executor.__kysera).toBe(true)
    })
  })

  describe('KyseraTransaction instances (H-6 fix)', () => {
    it('should detect KyseraTransaction from wrapTransaction', () => {
      const trx = createMockTransaction()
      const wrappedTrx = wrapTransaction(trx, [])
      const ctx = createContext(wrappedTrx)

      expect(ctx.isTransaction).toBe(true)
      expect(wrappedTrx.__kysera).toBe(true)
      expect(wrappedTrx.__rawDb).toBe(trx)
    })

    it('should detect KyseraTransaction with plugins', () => {
      const testPlugin = {
        name: 'test-plugin',
        version: '1.0.0'
      }

      const trx = createMockTransaction()
      const wrappedTrx = wrapTransaction(trx, [testPlugin])
      const ctx = createContext(wrappedTrx)

      expect(ctx.isTransaction).toBe(true)
      expect(wrappedTrx.__kysera).toBe(true)
      expect(wrappedTrx.__plugins).toEqual([testPlugin])
    })

    it('should not confuse KyseraExecutor with KyseraTransaction', async () => {
      const db = createMockKysely()
      const executor = await createExecutor(db, [])

      // Executor should NOT be detected as transaction
      const executorCtx = createContext(executor)
      expect(executorCtx.isTransaction).toBe(false)

      // But wrapped transaction should be detected
      const trx = createMockTransaction()
      const wrappedTrx = wrapTransaction(trx, [])
      const trxCtx = createContext(wrappedTrx)
      expect(trxCtx.isTransaction).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle createContext with DbContext input', () => {
      const db = createMockKysely()
      const ctx1 = createContext(db)
      const ctx2 = createContext(ctx1.db)

      expect(ctx1.isTransaction).toBe(ctx2.isTransaction)
    })

    it('should handle KyseraTransaction wrapped multiple times', () => {
      const trx = createMockTransaction()
      const wrappedOnce = wrapTransaction(trx, [])
      const ctx1 = createContext(wrappedOnce)
      expect(ctx1.isTransaction).toBe(true)

      // Wrapping again should still detect as transaction
      const wrappedTwice = wrapTransaction(trx, [])
      const ctx2 = createContext(wrappedTwice)
      expect(ctx2.isTransaction).toBe(true)
    })
  })

  describe('backward compatibility', () => {
    it('should maintain compatibility with old behavior', () => {
      // Old behavior: raw Transaction detected via isTransaction property
      const trx = createMockTransaction()
      expect('isTransaction' in trx).toBe(true)
      expect(trx.isTransaction).toBe(true)

      const ctx = createContext(trx)
      expect(ctx.isTransaction).toBe(true)
    })

    it('should work with both old and new detection methods', () => {
      // Old: raw Transaction
      const trx = createMockTransaction()
      const ctx1 = createContext(trx)
      expect(ctx1.isTransaction).toBe(true)

      // New: KyseraTransaction
      const wrappedTrx = wrapTransaction(trx, [])
      const ctx2 = createContext(wrappedTrx)
      expect(ctx2.isTransaction).toBe(true)
    })
  })

  describe('security: no assumption on Kysely internals', () => {
    it('should check __kysera marker before accessing __rawDb', () => {
      // Create object that looks like executor but isn't
      const fakeExecutor = {
        __kysera: false,
        isTransaction: true,
        selectFrom: vi.fn(),
        transaction: vi.fn()
      }

      const ctx = createContext(fakeExecutor as never)

      // Should still work, falling back to isTransaction property
      expect(ctx.isTransaction).toBe(true)
    })

    it('should handle executor without __rawDb gracefully', () => {
      const partialExecutor = {
        __kysera: true,
        __plugins: [],
        // Missing __rawDb intentionally
        selectFrom: vi.fn()
      }

      const ctx = createContext(partialExecutor as never)

      // Should not throw, should handle gracefully
      expect(ctx[DB_CONTEXT_SYMBOL]).toBe(true)
    })

    it('should not access isTransaction on wrapped executors without checking', async () => {
      const db = createMockKysely()
      const executor = await createExecutor(db, [])

      // Executor should be detected WITHOUT accessing isTransaction property
      const ctx = createContext(executor)
      expect(ctx.isTransaction).toBe(false)

      // Verify executor doesn't have isTransaction property (it's on __rawDb)
      expect('isTransaction' in executor).toBe(false)
    })
  })
})
