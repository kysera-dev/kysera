/**
 * Tests for resilience utilities (retry, circuit breaker).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isTransientError,
  withRetry,
  createRetryWrapper,
  CircuitBreaker
} from '../src/resilience/index.js'

describe('isTransientError', () => {
  it('should return true for transient error codes', () => {
    const transientCodes = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNRESET',
      'EPIPE',
      '57P03',
      '08006',
      '40001',
      '40P01',
      'ER_LOCK_DEADLOCK',
      'ER_LOCK_WAIT_TIMEOUT',
      'SQLITE_BUSY',
      'SQLITE_LOCKED'
    ]

    for (const code of transientCodes) {
      expect(isTransientError({ code })).toBe(true)
    }
  })

  it('should return false for non-transient error codes', () => {
    expect(isTransientError({ code: 'UNKNOWN_ERROR' })).toBe(false)
    expect(isTransientError({ code: '23505' })).toBe(false) // unique violation
    expect(isTransientError({ code: '23503' })).toBe(false) // foreign key
  })

  it('should return false for errors without code', () => {
    expect(isTransientError(new Error('some error'))).toBe(false)
    expect(isTransientError({})).toBe(false)
    expect(isTransientError(null)).toBe(false)
    expect(isTransientError(undefined)).toBe(false)
  })
})

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    const promise = withRetry(fn)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should retry on transient error', async () => {
    const transientError = Object.assign(new Error('Connection refused'), {
      code: 'ECONNREFUSED'
    })

    const fn = vi.fn().mockRejectedValueOnce(transientError).mockResolvedValue('success')

    const promise = withRetry(fn, { delayMs: 100, jitterFactor: 0 })

    // First call fails
    await vi.advanceTimersByTimeAsync(0)

    // Wait for retry delay
    await vi.advanceTimersByTimeAsync(100)

    const result = await promise

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('should throw after max attempts', async () => {
    vi.useRealTimers() // Use real timers for this test

    const transientError = Object.assign(new Error('Connection refused'), {
      code: 'ECONNREFUSED'
    })

    const fn = vi.fn().mockRejectedValue(transientError)

    // Use very short delays for testing
    await expect(withRetry(fn, { maxAttempts: 3, delayMs: 10, backoff: false })).rejects.toThrow(
      'Connection refused'
    )

    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should not retry non-transient errors', async () => {
    const nonTransientError = Object.assign(new Error('Unique violation'), {
      code: '23505'
    })

    const fn = vi.fn().mockRejectedValue(nonTransientError)

    // Non-transient errors should fail immediately without retries
    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow('Unique violation')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should call onRetry callback', async () => {
    const transientError = Object.assign(new Error('Timeout'), {
      code: 'ETIMEDOUT'
    })

    const fn = vi.fn().mockRejectedValueOnce(transientError).mockResolvedValue('success')

    const onRetry = vi.fn()

    const promise = withRetry(fn, { delayMs: 100, onRetry, jitterFactor: 0 })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    await promise

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, transientError)
  })

  it('should use exponential backoff when enabled', async () => {
    const transientError = Object.assign(new Error('Timeout'), {
      code: 'ETIMEDOUT'
    })

    const fn = vi
      .fn()
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('success')

    const promise = withRetry(fn, { delayMs: 100, backoff: true, jitterFactor: 0 })

    await vi.advanceTimersByTimeAsync(0) // First call
    await vi.advanceTimersByTimeAsync(100) // First retry (100ms)
    await vi.advanceTimersByTimeAsync(200) // Second retry (200ms with backoff)

    await promise
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should cap exponential backoff delay at maxDelayMs', async () => {
    vi.useRealTimers() // Use real timers to measure actual delays

    const transientError = Object.assign(new Error('Timeout'), {
      code: 'ETIMEDOUT'
    })

    const callTimes: number[] = []
    const fn = vi.fn().mockImplementation(() => {
      callTimes.push(Date.now())
      return Promise.reject(transientError)
    })

    // With exponential backoff and no cap:
    // delayMs=100, attempts 1-5 would be: 100, 200, 400, 800ms delays
    // With maxDelayMs=500, the 800ms delay should be capped at 500ms

    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        delayMs: 100,
        maxDelayMs: 500,
        backoff: true,
        jitterFactor: 0
      })
    ).rejects.toThrow('Timeout')

    // Calculate actual delays between calls
    const delays = []
    for (let i = 1; i < callTimes.length; i++) {
      delays.push(callTimes[i]! - callTimes[i - 1]!)
    }

    // Check that delays are capped at maxDelayMs
    // Delay 1: 100ms (100 * 2^0)
    // Delay 2: 200ms (100 * 2^1)
    // Delay 3: 400ms (100 * 2^2)
    // Delay 4: 500ms (100 * 2^3 = 800, capped at 500)
    expect(delays[0]).toBeGreaterThanOrEqual(95)
    expect(delays[0]).toBeLessThan(150)
    expect(delays[1]).toBeGreaterThanOrEqual(195)
    expect(delays[1]).toBeLessThan(250)
    expect(delays[2]).toBeGreaterThanOrEqual(395)
    expect(delays[2]).toBeLessThan(450)
    expect(delays[3]).toBeGreaterThanOrEqual(495)
    expect(delays[3]).toBeLessThan(550) // Should be capped at ~500ms, not 800ms
  })

  it('should throw error when maxDelayMs is less than delayMs', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    await expect(
      withRetry(fn, {
        delayMs: 1000,
        maxDelayMs: 500
      })
    ).rejects.toThrow('maxDelayMs (500) must be greater than or equal to delayMs (1000)')

    // Function should not be called if validation fails
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('createRetryWrapper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should create a wrapped function with retry', async () => {
    const transientError = Object.assign(new Error('Busy'), {
      code: 'SQLITE_BUSY'
    })

    const fn = vi.fn().mockRejectedValueOnce(transientError).mockResolvedValue('result')

    const wrappedFn = createRetryWrapper(fn, { delayMs: 50, jitterFactor: 0 })

    const promise = wrappedFn('arg1', 'arg2')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(50)

    const result = await promise

    expect(result).toBe('result')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
  })
})

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should pass through on success (closed state)', async () => {
    const breaker = new CircuitBreaker(3, 60000)
    const fn = vi.fn().mockResolvedValue('result')

    const result = await breaker.execute(fn)

    expect(result).toBe('result')
    expect((await breaker.getState()).state).toBe('closed')
    expect(await breaker.isClosed()).toBe(true)
  })

  it('should track failures', async () => {
    const breaker = new CircuitBreaker(3, 60000)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    try {
      await breaker.execute(fn)
    } catch {
      // Expected
    }

    expect((await breaker.getState()).failures).toBe(1)
    expect((await breaker.getState()).state).toBe('closed')
  })

  it('should open after threshold failures', async () => {
    const breaker = new CircuitBreaker(3, 60000)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(fn)
      } catch {
        // Expected
      }
    }

    expect((await breaker.getState()).state).toBe('open')
    expect(await breaker.isOpen()).toBe(true)
  })

  it('should fail fast when open', async () => {
    const breaker = new CircuitBreaker(1, 60000)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    // Open the circuit
    try {
      await breaker.execute(fn)
    } catch {
      // Expected
    }

    // Should fail fast without calling fn
    fn.mockClear()
    await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is open')
    expect(fn).not.toHaveBeenCalled()
  })

  it('should transition to half-open after reset time', async () => {
    const breaker = new CircuitBreaker(1, 1000)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    // Open the circuit
    try {
      await breaker.execute(fn)
    } catch {
      // Expected
    }

    expect((await breaker.getState()).state).toBe('open')

    // Advance time past reset
    vi.advanceTimersByTime(1001)

    // Next call should transition to half-open and attempt
    fn.mockResolvedValue('success')
    const result = await breaker.execute(fn)

    expect(result).toBe('success')
    expect((await breaker.getState()).state).toBe('closed')
  })

  it('should reset on manual reset()', async () => {
    const breaker = new CircuitBreaker(1, 60000)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    // Open the circuit
    try {
      await breaker.execute(fn)
    } catch {
      // Expected
    }

    expect((await breaker.getState()).state).toBe('open')

    await breaker.reset()

    expect((await breaker.getState()).state).toBe('closed')
    expect((await breaker.getState()).failures).toBe(0)
  })

  it('should call onStateChange callback', async () => {
    const onStateChange = vi.fn()
    const breaker = new CircuitBreaker({
      threshold: 1,
      resetTimeMs: 60000,
      onStateChange
    })

    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    try {
      await breaker.execute(fn)
    } catch {
      // Expected
    }

    expect(onStateChange).toHaveBeenCalledWith('open', 'closed')
  })

  it('should forceOpen the circuit', async () => {
    const breaker = new CircuitBreaker(5, 60000)

    expect(await breaker.isClosed()).toBe(true)

    await breaker.forceOpen()

    expect(await breaker.isOpen()).toBe(true)
    expect((await breaker.getState()).failures).toBe(5)
  })

  it('should prevent race condition in half-open state', async () => {
    vi.useRealTimers() // Use real timers for concurrency test

    const breaker = new CircuitBreaker(1, 100)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    // Open the circuit
    try {
      await breaker.execute(fn)
    } catch {
      // Expected
    }

    expect((await breaker.getState()).state).toBe('open')

    // Wait for reset time to allow transition to half-open
    await new Promise(resolve => setTimeout(resolve, 101))

    // Create two concurrent calls that arrive at the same time
    fn.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50)) // Simulate slow operation
      return 'success'
    })

    const results = await Promise.allSettled([breaker.execute(fn), breaker.execute(fn)])

    // One should succeed, one should be rejected
    const successful = results.filter(r => r.status === 'fulfilled').length
    const rejected = results.filter(r => r.status === 'rejected').length

    expect(successful).toBe(1)
    expect(rejected).toBe(1)

    // The rejected one should have the correct error message
    const rejectedResult = results.find(r => r.status === 'rejected')!
    expect((rejectedResult as PromiseRejectedResult).reason.message).toBe(
      'Circuit breaker is testing recovery'
    )
  })

  it('should prevent race conditions in concurrent state reads and writes', async () => {
    vi.useRealTimers() // Use real timers for concurrency test

    const breaker = new CircuitBreaker(5, 1000)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    // Simulate concurrent operations: failures, state reads, and resets
    const operations = [
      // Execute failures
      breaker.execute(fn).catch(() => {}),
      breaker.execute(fn).catch(() => {}),
      breaker.execute(fn).catch(() => {}),
      // Read state concurrently
      breaker.getState(),
      breaker.isOpen(),
      breaker.isClosed(),
      // More failures
      breaker.execute(fn).catch(() => {}),
      breaker.execute(fn).catch(() => {})
    ]

    await Promise.allSettled(operations)

    // State should be consistent after all operations
    const finalState = await breaker.getState()
    expect(finalState.failures).toBeGreaterThanOrEqual(0)
    expect(finalState.failures).toBeLessThanOrEqual(5)
    expect(['closed', 'open', 'half-open']).toContain(finalState.state)

    // If threshold reached, should be open
    if (finalState.failures >= 5) {
      expect(finalState.state).toBe('open')
      expect(await breaker.isOpen()).toBe(true)
    }
  })

  it('should prevent race conditions between reset and execute', async () => {
    vi.useRealTimers() // Use real timers for concurrency test

    const breaker = new CircuitBreaker(1, 1000)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    // Open the circuit
    try {
      await breaker.execute(fn)
    } catch {
      // Expected
    }

    expect((await breaker.getState()).state).toBe('open')

    // Execute concurrent reset and execute operations
    fn.mockResolvedValue('success')
    const results = await Promise.allSettled([
      breaker.reset(),
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.getState()
    ])

    // All operations should complete without crashes
    const errors = results.filter(r => r.status === 'rejected')
    // Some may fail due to circuit being open, but shouldn't crash
    errors.forEach(e => {
      const reason = (e as PromiseRejectedResult).reason
      // Only CircuitBreakerError is acceptable
      if (reason.name !== 'CircuitBreakerError') {
        throw reason
      }
    })

    // Final state should be consistent
    const finalState = await breaker.getState()
    expect(['closed', 'open', 'half-open']).toContain(finalState.state)
  })

  it('should prevent race conditions in concurrent forceOpen calls', async () => {
    vi.useRealTimers() // Use real timers for concurrency test

    const breaker = new CircuitBreaker(5, 1000)

    // Execute concurrent forceOpen operations
    await Promise.all([breaker.forceOpen(), breaker.forceOpen(), breaker.forceOpen()])

    // State should be consistently open
    const state = await breaker.getState()
    expect(state.state).toBe('open')
    expect(state.failures).toBe(5)
    expect(await breaker.isOpen()).toBe(true)
  })
})
