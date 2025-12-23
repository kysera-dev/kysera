/**
 * Test for M-6: Health check timeout cleanup fix
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkDatabaseHealth } from '../src/health/check.js'
import { Kysely } from 'kysely'

describe('M-6: Health check timeout cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('should clean up timeout when query completes successfully', async () => {
    // Mock database that responds quickly
    const mockDb = {
      selectNoFrom: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue([{ ping: 1 }])
      }))
    } as unknown as Kysely<any>

    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

    const resultPromise = checkDatabaseHealth(mockDb)

    // Fast-forward time slightly to ensure query completes
    await vi.advanceTimersByTimeAsync(10)

    const result = await resultPromise

    expect(result.status).toBe('healthy')
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })

  it('should clean up timeout when query times out', async () => {
    // Mock database that never responds
    const mockDb = {
      selectNoFrom: vi.fn(() => ({
        execute: vi.fn(() => new Promise(() => {})) // Never resolves
      }))
    } as unknown as Kysely<any>

    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

    const resultPromise = checkDatabaseHealth(mockDb)

    // Fast-forward past timeout
    await vi.advanceTimersByTimeAsync(6000)

    const result = await resultPromise

    expect(result.status).toBe('unhealthy')
    expect(result.errors).toBeDefined()
    expect(result.errors?.[0]).toContain('timed out')
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })

  it('should not leak memory with multiple concurrent health checks', async () => {
    const mockDb = {
      selectNoFrom: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue([{ ping: 1 }])
      }))
    } as unknown as Kysely<any>

    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

    // Start multiple health checks
    const promises = Array.from({ length: 10 }, () => checkDatabaseHealth(mockDb))

    await vi.advanceTimersByTimeAsync(10)

    const results = await Promise.all(promises)

    // All should succeed
    expect(results.every(r => r.status === 'healthy')).toBe(true)

    // All timeouts should be cleaned up
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(10)
  })
})
