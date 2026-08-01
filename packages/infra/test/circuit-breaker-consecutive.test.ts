/**
 * Consecutive-failure semantics + half-open probe failure path.
 *
 * `CircuitBreakerState.failures` is documented as "Number of consecutive
 * failures" — a success while CLOSED must reset the failure run, otherwise
 * sporadic failures spread over hours would eventually trip the breaker.
 */
import { describe, it, expect, vi } from 'vitest'
import { CircuitBreaker, CircuitBreakerError } from '../src/resilience/circuit-breaker.js'

const failing = () => Promise.reject(new Error('boom'))
const succeeding = () => Promise.resolve('ok')

describe('CircuitBreaker consecutive-failure semantics', () => {
  it('success while closed resets the failure counter', async () => {
    const breaker = new CircuitBreaker({ threshold: 3, resetTimeMs: 60000 })

    // Two failures (below threshold)
    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    expect(breaker.getState().failures).toBe(2)

    // Success ends the run
    await expect(breaker.execute(succeeding)).resolves.toBe('ok')
    expect(breaker.getState().failures).toBe(0)
    expect(breaker.getState().state).toBe('closed')

    // Two more failures still do NOT trip the breaker (run restarted)
    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    expect(breaker.getState().state).toBe('closed')

    // Third consecutive failure trips it
    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    expect(breaker.getState().state).toBe('open')
  })

  it('sporadic failures interleaved with successes never open the circuit', async () => {
    const breaker = new CircuitBreaker({ threshold: 3, resetTimeMs: 60000 })

    for (let i = 0; i < 10; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('boom')
      await expect(breaker.execute(succeeding)).resolves.toBe('ok')
    }

    expect(breaker.getState().state).toBe('closed')
    expect(breaker.getState().failures).toBe(0)
  })
})

describe('CircuitBreaker half-open probe failure', () => {
  it('re-opens the circuit when the half-open probe fails', async () => {
    vi.useFakeTimers()
    try {
      const transitions: string[] = []
      const breaker = new CircuitBreaker({
        threshold: 1,
        resetTimeMs: 1000,
        onStateChange: next => transitions.push(next)
      })

      // Trip the breaker
      await expect(breaker.execute(failing)).rejects.toThrow('boom')
      expect(breaker.getState().state).toBe('open')

      // Wait past resetTimeMs → half-open on next attempt
      vi.advanceTimersByTime(1500)

      // Probe fails → circuit must re-open and clear the testing flag
      await expect(breaker.execute(failing)).rejects.toThrow('boom')
      const state = breaker.getState()
      expect(state.state).toBe('open')
      expect(state.isTestingHalfOpen).toBe(false)
      expect(transitions).toEqual(['open', 'half-open', 'open'])

      // Fast-fail while open again
      await expect(breaker.execute(succeeding)).rejects.toThrow(CircuitBreakerError)
    } finally {
      vi.useRealTimers()
    }
  })
})
