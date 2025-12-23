/**
 * Test for M-7: Circuit breaker mutex race condition fix
 */

import { describe, it, expect } from 'vitest'
import { CircuitBreaker } from '../src/resilience/circuit-breaker.js'

describe('M-7: Circuit breaker mutex race conditions', () => {
  it('should handle concurrent execute calls without race conditions', async () => {
    const breaker = new CircuitBreaker({ threshold: 3, resetTimeMs: 1000 })

    let successCount = 0
    let callCount = 0

    const operation = async () => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, 10))
      successCount++
      return 'success'
    }

    // Execute 10 operations concurrently
    const promises = Array.from({ length: 10 }, () => breaker.execute(operation))

    const results = await Promise.all(promises)

    expect(results).toHaveLength(10)
    expect(results.every(r => r === 'success')).toBe(true)
    expect(successCount).toBe(10)
    expect(callCount).toBe(10)

    const state = await breaker.getState()
    expect(state.state).toBe('closed')
    expect(state.failures).toBe(0)
  })

  it('should handle half-open state with concurrent requests correctly', async () => {
    const breaker = new CircuitBreaker({ threshold: 2, resetTimeMs: 100 })

    let attemptCount = 0

    // Fail twice to open the circuit
    await expect(
      breaker.execute(async () => {
        throw new Error('fail')
      })
    ).rejects.toThrow('fail')

    await expect(
      breaker.execute(async () => {
        throw new Error('fail')
      })
    ).rejects.toThrow('fail')

    // Circuit should be open
    let state = await breaker.getState()
    expect(state.state).toBe('open')

    // Wait for reset time
    await new Promise(resolve => setTimeout(resolve, 150))

    // Make multiple concurrent requests in half-open state
    // Only one should proceed, others should reject
    const operation = async () => {
      attemptCount++
      await new Promise(resolve => setTimeout(resolve, 10))
      return 'success'
    }

    const promises = [
      breaker.execute(operation),
      breaker.execute(operation),
      breaker.execute(operation)
    ]

    const results = await Promise.allSettled(promises)

    // First request should succeed, opening the circuit
    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter(r => r.status === 'rejected')

    // Exactly one should succeed (the test request in half-open)
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(2)

    // Only one attempt should have been made
    expect(attemptCount).toBe(1)

    // Circuit should be closed after successful test
    state = await breaker.getState()
    expect(state.state).toBe('closed')
  })

  it('should maintain state consistency under concurrent failures', async () => {
    const breaker = new CircuitBreaker({ threshold: 5, resetTimeMs: 1000 })

    const operation = async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      throw new Error('fail')
    }

    // Execute 10 failing operations concurrently
    const promises = Array.from({ length: 10 }, () =>
      breaker.execute(operation).catch(() => 'caught')
    )

    await Promise.all(promises)

    const state = await breaker.getState()

    // Should be open (threshold is 5)
    expect(state.state).toBe('open')

    // Failure count should be accurate
    expect(state.failures).toBeGreaterThanOrEqual(5)
  })

  it('should handle reset() during concurrent operations', async () => {
    const breaker = new CircuitBreaker({ threshold: 3, resetTimeMs: 1000 })

    const slowOperation = async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
      return 'success'
    }

    // Start multiple operations
    const promises = Array.from({ length: 5 }, () => breaker.execute(slowOperation))

    // Reset while operations are in progress
    await new Promise(resolve => setTimeout(resolve, 10))
    await breaker.reset()

    // All operations should complete successfully
    const results = await Promise.all(promises)
    expect(results.every(r => r === 'success')).toBe(true)

    const state = await breaker.getState()
    expect(state.state).toBe('closed')
    expect(state.failures).toBe(0)
  })
})
