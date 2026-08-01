/**
 * HealthMonitor in-flight guard: a slow check must not stack overlapping
 * checks when the interval fires faster than the check completes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Kysely } from 'kysely'
import { HealthMonitor } from '../src/health/monitor.js'
import { silentLogger } from '@kysera/core'

describe('HealthMonitor overlap guard', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips interval ticks while a check is still in flight', async () => {
    vi.useFakeTimers()

    let inFlight = 0
    let maxInFlight = 0
    let started = 0

    // A DB whose probe query (selectNoFrom(...).execute()) hangs for 5 intervals
    const slowDb = {
      selectNoFrom: vi.fn().mockReturnValue({
        execute: vi.fn().mockImplementation(async () => {
          started++
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          await new Promise(resolve => setTimeout(resolve, 500))
          inFlight--
          return [{ ping: 1 }]
        })
      })
    } as unknown as Kysely<Record<string, never>>

    const monitor = new HealthMonitor(slowDb, { intervalMs: 100, logger: silentLogger })
    monitor.start()

    // Let 4 intervals elapse while the first check is still running
    await vi.advanceTimersByTimeAsync(450)
    expect(maxInFlight).toBe(1)

    // First check finishes at t=500; next tick may start a new one
    await vi.advanceTimersByTimeAsync(200)
    expect(maxInFlight).toBe(1)
    expect(started).toBeGreaterThanOrEqual(2)

    monitor.stop()
  })
})
