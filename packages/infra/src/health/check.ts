/**
 * Database health check utilities.
 *
 * @module @kysera/infra/health
 */

import type { Kysely } from 'kysely'
import { consoleLogger, type KyseraLogger } from '@kysera/core'
import type { MetricsPool } from '../pool/metrics.js'
import type { HealthCheckResult, HealthStatus } from './types.js'

/**
 * Options for health check.
 */
export interface HealthCheckOptions {
  /** Connection pool for metrics extraction */
  pool?: MetricsPool
  /** Include verbose information */
  verbose?: boolean
  /** Custom logger */
  logger?: KyseraLogger
}

/**
 * Determine health status based on latency.
 *
 * @param latencyMs - Response latency in milliseconds
 * @returns Health status
 */
function getStatusFromLatency(latencyMs: number): HealthStatus {
  if (latencyMs < 100) return 'healthy'
  if (latencyMs < 500) return 'degraded'
  return 'unhealthy'
}

/**
 * Check database health by executing a simple query.
 *
 * Performs a lightweight ping query to verify database connectivity
 * and measures response latency.
 *
 * @param db - Kysely database instance
 * @param pool - Optional metrics pool for connection metrics
 * @returns Health check result with status and metrics
 *
 * @example Basic health check
 * ```typescript
 * import { Kysely } from 'kysely';
 * import { checkDatabaseHealth } from '@kysera/infra/health';
 *
 * const result = await checkDatabaseHealth(db);
 * console.log(result.status); // 'healthy' | 'degraded' | 'unhealthy'
 * console.log(result.metrics?.checkLatency); // Response time in ms
 * ```
 *
 * @example With pool metrics
 * ```typescript
 * import { checkDatabaseHealth } from '@kysera/infra/health';
 * import { createMetricsPool } from '@kysera/infra/pool';
 *
 * const metricsPool = createMetricsPool(pgPool);
 * const result = await checkDatabaseHealth(db, metricsPool);
 * console.log(result.metrics?.poolMetrics);
 * // { totalConnections: 10, activeConnections: 2, idleConnections: 8, waitingRequests: 0 }
 * ```
 */
export async function checkDatabaseHealth<DB>(
  db: Kysely<DB>,
  pool?: MetricsPool
): Promise<HealthCheckResult> {
  const start = Date.now()

  try {
    // Simple query to check connection with timeout
    const timeoutMs = 5000 // 5 second timeout for health checks
    const queryPromise = db.selectNoFrom(eb => eb.val(1).as('ping')).execute()

    await Promise.race([
      queryPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Health check timed out after ${String(timeoutMs)}ms`))
        }, timeoutMs)
      })
    ])

    const latency = Date.now() - start
    const status = getStatusFromLatency(latency)

    const result: HealthCheckResult = {
      status,
      checks: [
        {
          name: 'Database Connection',
          status: 'healthy',
          message: `Connected successfully (${latency.toString()}ms)`
        }
      ],
      metrics: {
        checkLatency: latency
      },
      timestamp: new Date()
    }

    // Add pool metrics if available
    if (pool?.getMetrics && result.metrics) {
      const metrics = pool.getMetrics()
      result.metrics.poolMetrics = {
        totalConnections: metrics.total,
        activeConnections: metrics.active,
        idleConnections: metrics.idle,
        waitingRequests: metrics.waiting
      }
    }

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    const result: HealthCheckResult = {
      status: 'unhealthy',
      checks: [
        {
          name: 'Database Connection',
          status: 'unhealthy',
          message: errorMessage
        }
      ],
      errors: [errorMessage],
      timestamp: new Date()
    }

    // Add pool metrics if available (even on error)
    if (pool?.getMetrics) {
      const metrics = pool.getMetrics()
      result.metrics = {
        poolMetrics: {
          totalConnections: metrics.total,
          activeConnections: metrics.active,
          idleConnections: metrics.idle,
          waitingRequests: metrics.waiting
        }
      }
    }

    return result
  }
}

/**
 * Perform comprehensive health check with additional options.
 *
 * Extended version of checkDatabaseHealth with verbose mode
 * and additional diagnostics.
 *
 * @param db - Kysely database instance
 * @param options - Health check options
 * @returns Health check result
 *
 * @example
 * ```typescript
 * import { performHealthCheck } from '@kysera/infra/health';
 *
 * const result = await performHealthCheck(db, {
 *   verbose: true,
 *   pool: metricsPool,
 * });
 * console.log(result.metrics?.databaseVersion);
 * ```
 */
export async function performHealthCheck<DB>(
  db: Kysely<DB>,
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult> {
  const { pool, verbose = false, logger = consoleLogger } = options

  const baseResult = await checkDatabaseHealth(db, pool)

  if (verbose) {
    // Add additional checks in verbose mode
    try {
      baseResult.metrics = {
        ...baseResult.metrics,
        databaseVersion: 'Unknown' // Dialect-specific implementation needed
      }
    } catch (error) {
      logger.debug('Version check failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return baseResult
}
