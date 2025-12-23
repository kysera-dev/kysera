/**
 * Query profiler for performance analysis.
 *
 * @module @kysera/debug
 */

import type { QueryMetrics } from '@kysera/core'

/**
 * Query profiler summary.
 */
export interface ProfilerSummary {
  /** Total number of recorded queries */
  totalQueries: number
  /** Sum of all query durations */
  totalDuration: number
  /** Average query duration */
  averageDuration: number
  /** Slowest recorded query */
  slowestQuery: QueryMetrics | null
  /** Fastest recorded query */
  fastestQuery: QueryMetrics | null
  /** All recorded queries */
  queries: QueryMetrics[]
}

/**
 * Options for QueryProfiler.
 */
export interface ProfilerOptions {
  /**
   * Maximum number of queries to keep in memory.
   * @default 1000
   */
  maxQueries?: number
}

/**
 * Query profiler for collecting and analyzing query performance.
 *
 * Provides detailed statistics about query execution times
 * including average, min, max, and query counts.
 *
 * @example
 * ```typescript
 * import { QueryProfiler } from '@kysera/debug';
 *
 * const profiler = new QueryProfiler({ maxQueries: 500 });
 *
 * // Record queries manually
 * profiler.record({
 *   sql: 'SELECT * FROM users',
 *   duration: 10,
 *   timestamp: Date.now(),
 * });
 *
 * // Get summary
 * const summary = profiler.getSummary();
 * console.log('Total queries: ' + summary.totalQueries);
 * console.log('Average duration: ' + summary.averageDuration.toFixed(2) + 'ms');
 *
 * // Clear recorded queries
 * profiler.clear();
 * ```
 */
export class QueryProfiler {
  private queries: QueryMetrics[] = []
  private queriesWriteIndex = 0
  private readonly maxQueries: number

  /**
   * Create a new query profiler.
   *
   * @param options - Profiler options
   */
  constructor(options: ProfilerOptions = {}) {
    this.maxQueries = options.maxQueries ?? 1000
  }

  /**
   * Record a query metric.
   *
   * Uses O(1) circular buffer to maintain bounded memory usage.
   * When the buffer is full, oldest entries are overwritten.
   *
   * @param metric - Query metrics to record
   */
  record(metric: QueryMetrics): void {
    // O(1) circular buffer: overwrite oldest entry when full
    if (this.queries.length < this.maxQueries) {
      this.queries.push(metric)
    } else {
      this.queries[this.queriesWriteIndex % this.maxQueries] = metric
    }
    this.queriesWriteIndex++
  }

  /**
   * Get profiling summary.
   *
   * @returns Summary of all recorded queries
   */
  getSummary(): ProfilerSummary {
    const orderedQueries = this.getOrderedQueries()

    if (orderedQueries.length === 0) {
      return {
        totalQueries: 0,
        totalDuration: 0,
        averageDuration: 0,
        slowestQuery: null,
        fastestQuery: null,
        queries: []
      }
    }

    const totalDuration = orderedQueries.reduce((sum, q) => sum + q.duration, 0)
    const sorted = [...orderedQueries].sort((a, b) => b.duration - a.duration)

    return {
      totalQueries: orderedQueries.length,
      totalDuration,
      averageDuration: totalDuration / orderedQueries.length,
      slowestQuery: sorted[0] ?? null,
      fastestQuery: sorted[sorted.length - 1] ?? null,
      queries: orderedQueries
    }
  }

  /**
   * Get the slowest N queries.
   *
   * @param count - Number of queries to return
   * @returns Array of slowest queries
   */
  getSlowestQueries(count: number): QueryMetrics[] {
    return [...this.getOrderedQueries()].sort((a, b) => b.duration - a.duration).slice(0, count)
  }

  /**
   * Get queries slower than a threshold.
   *
   * @param thresholdMs - Duration threshold in milliseconds
   * @returns Array of slow queries
   */
  getSlowQueries(thresholdMs: number): QueryMetrics[] {
    return this.getOrderedQueries().filter(q => q.duration > thresholdMs)
  }

  /**
   * Clear all recorded queries.
   */
  clear(): void {
    this.queries = []
    this.queriesWriteIndex = 0
  }

  /**
   * Get the number of recorded queries.
   */
  get count(): number {
    return this.queries.length
  }

  /**
   * Get queries in chronological order.
   * Handles circular buffer wrap-around correctly.
   *
   * @returns Array of queries in chronological order
   */
  private getOrderedQueries(): QueryMetrics[] {
    if (this.queries.length < this.maxQueries) {
      return [...this.queries]
    }
    // Buffer is full, reconstruct chronological order
    const start = this.queriesWriteIndex % this.maxQueries
    return [...this.queries.slice(start), ...this.queries.slice(0, start)]
  }
}
