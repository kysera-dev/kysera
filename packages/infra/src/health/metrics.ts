/**
 * Database metrics collection utilities.
 *
 * @module @kysera/infra/health
 */

import type { Kysely } from 'kysely';
import type { QueryMetrics } from '@kysera/core';
import type { MetricsPool } from '../pool/metrics.js';
import type { DatabaseWithMetrics } from './types.js';

/**
 * Options for getMetrics function.
 */
export interface GetMetricsOptions {
  /**
   * Time period for metrics (informational, not used for filtering).
   * @default '1h'
   */
  period?: string;

  /**
   * Optional pool to extract connection metrics from.
   */
  pool?: MetricsPool;

  /**
   * Duration threshold (in ms) to consider a query as slow.
   * @default 100
   */
  slowQueryThreshold?: number;
}

/**
 * Metrics result interface.
 */
export interface MetricsResult {
  /** Time period for metrics */
  period: string;
  /** ISO timestamp of metrics collection */
  timestamp: string;
  /** Connection pool metrics */
  connections?: {
    total: number;
    active: number;
    idle: number;
    max: number;
  };
  /** Query performance metrics */
  queries?: {
    total: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    p95Duration: number;
    p99Duration: number;
    slowCount: number;
  };
  /** Performance recommendations */
  recommendations?: string[];
}

/**
 * Calculate percentile from sorted array of numbers.
 *
 * @param sortedValues - Pre-sorted array of numbers
 * @param percentile - Percentile to calculate (0-100)
 * @returns Percentile value
 */
function calculatePercentile(sortedValues: readonly number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;

  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)] ?? 0;
}

/**
 * Check if database has metrics tracking enabled.
 *
 * @param db - Database instance to check
 * @returns True if database has getMetrics method
 */
export function hasDatabaseMetrics<DB>(
  db: Kysely<DB>
): db is Kysely<DB> & DatabaseWithMetrics<DB> {
  return typeof (db as unknown as DatabaseWithMetrics<DB>).getMetrics === 'function';
}

/**
 * Get database metrics from real query execution data.
 *
 * **Important:** This function requires the database to be wrapped with
 * the debug plugin to track query metrics. Use `withDebug()` from
 * '@kysera/debug' to enable metrics collection.
 *
 * @param db - Kysely database instance with metrics tracking (created using withDebug)
 * @param options - Options for metrics collection
 * @returns Real metrics data collected from actual query execution
 * @throws {Error} If the database is not wrapped with the debug plugin
 *
 * @example
 * ```typescript
 * import { withDebug } from '@kysera/debug';
 * import { getMetrics } from '@kysera/infra/health';
 *
 * // Create a database with metrics tracking
 * const debugDb = withDebug(db, { maxMetrics: 1000 });
 *
 * // Perform some queries...
 * await debugDb.selectFrom('users').selectAll().execute();
 *
 * // Get real metrics
 * const metrics = await getMetrics(debugDb, {
 *   slowQueryThreshold: 100,
 *   pool: metricsPool,
 * });
 *
 * console.log(metrics.queries?.avgDuration); // Real average from tracked queries
 * console.log(metrics.queries?.slowCount); // Real count of slow queries
 * ```
 */
export function getMetrics<DB>(
  db: Kysely<DB> | (Kysely<DB> & DatabaseWithMetrics<DB>),
  options: GetMetricsOptions = {}
): MetricsResult {
  const { period = '1h', pool, slowQueryThreshold = 100 } = options;

  // Check if database has metrics tracking enabled
  if (!hasDatabaseMetrics(db)) {
    throw new Error(
      'Database metrics are not available. ' +
        'To collect query metrics, wrap your database with the debug plugin using withDebug() from @kysera/debug. ' +
        'Example: const debugDb = withDebug(db, { maxMetrics: 1000 });'
    );
  }

  const result: MetricsResult = {
    period,
    timestamp: new Date().toISOString(),
  };

  // Get pool metrics if available
  if (pool?.getMetrics) {
    const poolMetrics = pool.getMetrics();
    result.connections = {
      total: poolMetrics.total,
      active: poolMetrics.active,
      idle: poolMetrics.idle,
      max: poolMetrics.total,
    };
  }

  // Get real query metrics from debug plugin
  const queryMetrics: QueryMetrics[] = db.getMetrics();

  if (queryMetrics.length > 0) {
    // Calculate real statistics from collected metrics
    const durations = queryMetrics.map((m) => m.duration);
    const sortedDurations = [...durations].sort((a, b) => a - b);

    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const avgDuration = totalDuration / durations.length;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);
    const p95Duration = calculatePercentile(sortedDurations, 95);
    const p99Duration = calculatePercentile(sortedDurations, 99);
    const slowCount = durations.filter((d) => d > slowQueryThreshold).length;

    result.queries = {
      total: queryMetrics.length,
      avgDuration: Math.round(avgDuration * 100) / 100,
      minDuration: Math.round(minDuration * 100) / 100,
      maxDuration: Math.round(maxDuration * 100) / 100,
      p95Duration: Math.round(p95Duration * 100) / 100,
      p99Duration: Math.round(p99Duration * 100) / 100,
      slowCount,
    };

    // Generate recommendations based on real data
    result.recommendations = [];

    if (slowCount > queryMetrics.length * 0.1) {
      result.recommendations.push(
        `High number of slow queries detected (${slowCount.toString()}/${queryMetrics.length.toString()}). ` +
          `Consider query optimization or indexing.`
      );
    }

    if (avgDuration > slowQueryThreshold * 0.5) {
      result.recommendations.push(
        `Average query duration (${avgDuration.toFixed(2)}ms) is approaching slow query threshold. ` +
          `Monitor performance closely.`
      );
    }
  }

  // Add connection pool recommendations if applicable
  if (result.connections) {
    const utilizationRate = result.connections.active / result.connections.total;
    if (utilizationRate > 0.8) {
      result.recommendations = result.recommendations ?? [];
      result.recommendations.push(
        `Connection pool utilization is high (${(utilizationRate * 100).toFixed(1)}%). ` +
          `Consider increasing pool size.`
      );
    }
  }

  return result;
}
