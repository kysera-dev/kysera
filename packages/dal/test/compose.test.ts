/**
 * Tests for composition utilities.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Kysely } from 'kysely'
import type { DbContext, QueryFunction } from '../src/types.js'
import { DB_CONTEXT_SYMBOL } from '../src/types.js'
import { compose, chain, parallel, conditional, mapResult } from '../src/compose.js'

// Mock database type for type-safe testing
interface TestDB {
  users: { id: number; name: string }
}

// Helper to create a mock context
function createMockContext(): DbContext {
  return {
    [DB_CONTEXT_SYMBOL]: true,
    db: {} as never,
    isTransaction: false
  }
}

/**
 * Type-safe mock factory for Kysely instances.
 * Uses `unknown` intermediate cast for safety.
 */
function createMockKysely(): Kysely<TestDB> {
  return {
    selectFrom: vi.fn()
  } as unknown as Kysely<TestDB>
}

describe('compose', () => {
  it('should compose two query functions', async () => {
    const ctx = createMockContext()

    const first: QueryFunction<Record<string, unknown>, [number], { id: number; name: string }> = vi
      .fn()
      .mockResolvedValue({ id: 1, name: 'Test' })

    const second = vi.fn().mockImplementation(async (_, result) => ({
      ...result,
      posts: ['post1', 'post2']
    }))

    const composed = compose(first, second)
    const result = await composed(ctx, 1)

    expect(first).toHaveBeenCalledWith(ctx, 1)
    expect(second).toHaveBeenCalledWith(ctx, { id: 1, name: 'Test' })
    expect(result).toEqual({ id: 1, name: 'Test', posts: ['post1', 'post2'] })
  })

  it('should create context from raw Kysely instance (covers toContext line 19)', async () => {
    // This test ensures that when a raw Kysely instance is passed (not a DbContext),
    // the toContext() function creates a new context via createContext()
    const db = createMockKysely()

    let capturedCtx: DbContext<TestDB> | null = null

    const first: QueryFunction<TestDB, [number], { id: number }> = vi
      .fn()
      .mockImplementation(ctx => {
        capturedCtx = ctx
        return Promise.resolve({ id: 1 })
      })

    const second = vi.fn().mockImplementation(async (ctx, result) => {
      // Verify same context is passed to second function
      expect(ctx).toBe(capturedCtx)
      return { ...result, enhanced: true }
    })

    const composed = compose(first, second)
    // Pass raw Kysely, not DbContext - this triggers toContext() to create context
    const result = await composed(db, 1)

    expect(capturedCtx).not.toBeNull()
    expect(capturedCtx!.db).toBe(db)
    expect(capturedCtx!.isTransaction).toBe(false)
    expect(capturedCtx![DB_CONTEXT_SYMBOL]).toBe(true)
    expect(result).toEqual({ id: 1, enhanced: true })
  })
})

describe('chain', () => {
  it('should chain multiple transforms', async () => {
    const ctx = createMockContext()

    const query: QueryFunction<Record<string, unknown>, [], number> = vi.fn().mockResolvedValue(1)
    const t1 = vi.fn().mockImplementation(async (_: DbContext, n: number) => n * 2)
    const t2 = vi.fn().mockImplementation(async (_: DbContext, n: number) => n + 10)

    const chained = chain(query, t1, t2)
    const result = await chained(ctx)

    expect(result).toBe(12) // (1 * 2) + 10 = 12
  })
})

describe('parallel', () => {
  it('should execute queries in parallel', async () => {
    const ctx = createMockContext()

    type TestDB = Record<string, unknown>
    const queries: Record<string, QueryFunction<TestDB, [], unknown>> = {
      user: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
      posts: vi.fn().mockResolvedValue(['post1', 'post2']),
      count: vi.fn().mockResolvedValue(42)
    }

    const combined = parallel<TestDB, [], typeof queries>(queries)
    const result = await combined(ctx)

    expect(result).toEqual({
      user: { id: 1, name: 'Test' },
      posts: ['post1', 'post2'],
      count: 42
    })
  })

  it('should pass same args to all queries', async () => {
    const ctx = createMockContext()

    type TestDB = Record<string, unknown>
    const q1: QueryFunction<TestDB, [string, string], string> = vi.fn().mockResolvedValue('a')
    const q2: QueryFunction<TestDB, [string, string], string> = vi.fn().mockResolvedValue('b')

    const combined = parallel<TestDB, [string, string], { q1: typeof q1; q2: typeof q2 }>({
      q1,
      q2
    })
    await combined(ctx, 'arg1', 'arg2')

    expect(q1).toHaveBeenCalledWith(ctx, 'arg1', 'arg2')
    expect(q2).toHaveBeenCalledWith(ctx, 'arg1', 'arg2')
  })
})

describe('conditional', () => {
  it('should execute query when condition is true', async () => {
    const ctx = createMockContext()

    const query: QueryFunction<Record<string, unknown>, [number], string> = vi
      .fn()
      .mockResolvedValue('result')

    const condQuery = conditional((_ctx: DbContext, _id: number) => true, query, 'fallback')
    const result = await condQuery(ctx, 1)

    expect(result).toBe('result')
    expect(query).toHaveBeenCalled()
  })

  it('should return fallback when condition is false', async () => {
    const ctx = createMockContext()

    const query: QueryFunction<Record<string, unknown>, [number], string> = vi
      .fn()
      .mockResolvedValue('result')

    const condQuery = conditional((_ctx: DbContext, _id: number) => false, query, 'fallback')
    const result = await condQuery(ctx, 1)

    expect(result).toBe('fallback')
    expect(query).not.toHaveBeenCalled()
  })

  it('should support async condition', async () => {
    const ctx = createMockContext()

    const query: QueryFunction<Record<string, unknown>, [], string> = vi
      .fn()
      .mockResolvedValue('result')

    const condQuery = conditional(async (_ctx: DbContext) => true, query, 'fallback')
    const result = await condQuery(ctx)

    expect(result).toBe('result')
  })
})

describe('mapResult', () => {
  it('should map over query results', async () => {
    const ctx = createMockContext()

    const query: QueryFunction<Record<string, unknown>, [], { id: number; name: string }[]> = vi
      .fn()
      .mockResolvedValue([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
      ])

    const mapped = mapResult(query, item => item.name)
    const result = await mapped(ctx)

    expect(result).toEqual(['Alice', 'Bob'])
  })

  it('should provide index to mapper', async () => {
    const ctx = createMockContext()

    const query: QueryFunction<Record<string, unknown>, [], string[]> = vi
      .fn()
      .mockResolvedValue(['a', 'b', 'c'])

    const mapped = mapResult(query, (item, i) => `${i}: ${item}`)
    const result = await mapped(ctx)

    expect(result).toEqual(['0: a', '1: b', '2: c'])
  })
})
