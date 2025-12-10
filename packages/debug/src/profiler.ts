/**
 * Query profiler for performance analysis.
 *
 * @module @kysera/debug
 */

import type { QueryMetrics } from './plugin.js';

/**
 * Query profiler summary.
 */
export interface ProfilerSummary {
  /** Total number of recorded queries */
  totalQueries: number;
  /** Sum of all query durations */
  totalDuration: number;
  /** Average query duration */
  averageDuration: number;
  /** Slowest recorded query */
  slowestQuery: QueryMetrics | null;
  /** Fastest recorded query */
  fastestQuery: QueryMetrics | null;
  /** All recorded queries */
  queries: QueryMetrics[];
}

/**
 * Options for QueryProfiler.
 */
export interface ProfilerOptions {
  /**
   * Maximum number of queries to keep in memory.
   * @default 1000
   */
  maxQueries?: number;
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
 * console.log(`Total queries: ${summary.totalQueries}`);
 * console.log(`Average duration: ${summary.averageDuration.toFixed(2)}ms`);
 *
 * // Clear recorded queries
 * profiler.clear();
 * ```
 */
export class QueryProfiler {
  private queries: QueryMetrics[] = [];
  private readonly maxQueries: number;

  /**
   * Create a new query profiler.
   *
   * @param options - Profiler options
   */
  constructor(options: ProfilerOptions = {}) {
    this.maxQueries = options.maxQueries ?? 1000;
  }

  /**
   * Record a query metric.
   *
   * @param metric - Query metrics to record
   */
  record(metric: QueryMetrics): void {
    this.queries.push(metric);
    // Circular buffer: keep only last N queries
    if (this.queries.length > this.maxQueries) {
      this.queries.shift();
    }
  }

  /**
   * Get profiling summary.
   *
   * @returns Summary of all recorded queries
   */
  getSummary(): ProfilerSummary {
    if (this.queries.length === 0) {
      return {
        totalQueries: 0,
        totalDuration: 0,
        averageDuration: 0,
        slowestQuery: null,
        fastestQuery: null,
        queries: [],
      };
    }

    const totalDuration = this.queries.reduce((sum, q) => sum + q.duration, 0);
    const sorted = [...this.queries].sort((a, b) => b.duration - a.duration);

    return {
      totalQueries: this.queries.length,
      totalDuration,
      averageDuration: totalDuration / this.queries.length,
      slowestQuery: sorted[0] ?? null,
      fastestQuery: sorted[sorted.length - 1] ?? null,
      queries: [...this.queries],
    };
  }

  /**
   * Get the slowest N queries.
   *
   * @param count - Number of queries to return
   * @returns Array of slowest queries
   */
  getSlowestQueries(count: number): QueryMetrics[] {
    return [...this.queries]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, count);
  }

  /**
   * Get queries slower than a threshold.
   *
   * @param thresholdMs - Duration threshold in milliseconds
   * @returns Array of slow queries
   */
  getSlowQueries(thresholdMs: number): QueryMetrics[] {
    return this.queries.filter((q) => q.duration > thresholdMs);
  }

  /**
   * Clear all recorded queries.
   */
  clear(): void {
    this.queries = [];
  }

  /**
   * Get the number of recorded queries.
   */
  get count(): number {
    return this.queries.length;
  }
}
