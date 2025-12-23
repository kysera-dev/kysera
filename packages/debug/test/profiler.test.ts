/**
 * Tests for QueryProfiler.
 */

import { describe, it, expect } from 'vitest'
import { QueryProfiler } from '../src/profiler.js'

describe('QueryProfiler', () => {
  it('should record queries', () => {
    const profiler = new QueryProfiler()

    profiler.record({
      sql: 'SELECT * FROM users',
      duration: 10,
      timestamp: Date.now()
    })

    expect(profiler.count).toBe(1)
  })

  it('should provide summary statistics', () => {
    const profiler = new QueryProfiler()

    profiler.record({ sql: 'SELECT 1', duration: 10, timestamp: Date.now() })
    profiler.record({ sql: 'SELECT 2', duration: 20, timestamp: Date.now() })
    profiler.record({ sql: 'SELECT 3', duration: 30, timestamp: Date.now() })

    const summary = profiler.getSummary()

    expect(summary.totalQueries).toBe(3)
    expect(summary.totalDuration).toBe(60)
    expect(summary.averageDuration).toBe(20)
    expect(summary.slowestQuery?.duration).toBe(30)
    expect(summary.fastestQuery?.duration).toBe(10)
  })

  it('should return empty summary when no queries', () => {
    const profiler = new QueryProfiler()
    const summary = profiler.getSummary()

    expect(summary.totalQueries).toBe(0)
    expect(summary.totalDuration).toBe(0)
    expect(summary.averageDuration).toBe(0)
    expect(summary.slowestQuery).toBeNull()
    expect(summary.fastestQuery).toBeNull()
  })

  it('should get slowest queries', () => {
    const profiler = new QueryProfiler()

    profiler.record({ sql: 'fast', duration: 10, timestamp: Date.now() })
    profiler.record({ sql: 'slow', duration: 100, timestamp: Date.now() })
    profiler.record({ sql: 'medium', duration: 50, timestamp: Date.now() })

    const slowest = profiler.getSlowestQueries(2)

    expect(slowest).toHaveLength(2)
    expect(slowest[0]?.sql).toBe('slow')
    expect(slowest[1]?.sql).toBe('medium')
  })

  it('should get queries above threshold', () => {
    const profiler = new QueryProfiler()

    profiler.record({ sql: 'fast', duration: 10, timestamp: Date.now() })
    profiler.record({ sql: 'slow', duration: 100, timestamp: Date.now() })
    profiler.record({ sql: 'medium', duration: 50, timestamp: Date.now() })

    const slow = profiler.getSlowQueries(40)

    expect(slow).toHaveLength(2)
    expect(slow.every(q => q.duration > 40)).toBe(true)
  })

  it('should clear queries', () => {
    const profiler = new QueryProfiler()

    profiler.record({ sql: 'SELECT 1', duration: 10, timestamp: Date.now() })
    expect(profiler.count).toBe(1)

    profiler.clear()
    expect(profiler.count).toBe(0)
  })

  it('should respect maxQueries limit', () => {
    const profiler = new QueryProfiler({ maxQueries: 3 })

    for (let i = 0; i < 5; i++) {
      profiler.record({
        sql: `SELECT ${i}`,
        duration: i * 10,
        timestamp: Date.now()
      })
    }

    expect(profiler.count).toBe(3)

    // Should keep the most recent queries
    const summary = profiler.getSummary()
    expect(summary.queries.map(q => q.sql)).toEqual(['SELECT 2', 'SELECT 3', 'SELECT 4'])
  })
})
