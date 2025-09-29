import type { Kysely } from 'kysely'
import type { Pool } from 'pg'

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: {
    database: {
      connected: boolean
      latency: number
      error?: string
    }
    pool?: {
      size: number
      active: number
      idle: number
      waiting: number
    }
  }
  timestamp: Date
}

/**
 * Pool metrics interface for different database drivers
 */
export interface PoolMetrics {
  total: number
  idle: number
  active: number
  waiting: number
}

/**
 * Extended Pool with metrics access
 */
export interface MetricsPool extends Pool {
  getMetrics(): PoolMetrics
}

/**
 * Type definitions for Pool internals
 */
interface PoolInternals {
  readonly totalCount: number
  readonly idleCount: number
  readonly waitingCount: number
  readonly options?: {
    max?: number
  }
}

/**
 * Create pool with metrics capabilities
 */
export function createMetricsPool(pool: Pool): MetricsPool {
  const metricsPool = pool as MetricsPool

  metricsPool.getMetrics = function() {
    const internals = this as unknown as PoolInternals

    return {
      total: internals.totalCount || internals.options?.max || 10,
      idle: internals.idleCount || 0,
      waiting: internals.waitingCount || 0,
      active: (internals.totalCount || 0) - (internals.idleCount || 0)
    }
  }

  return metricsPool
}

/**
 * Check database health
 */
export async function checkDatabaseHealth<DB>(
  db: Kysely<DB>,
  pool?: MetricsPool
): Promise<HealthCheckResult> {
  const start = Date.now()

  try {
    // Simple query to check connection
    await db.selectNoFrom(eb => eb.val(1).as('ping')).execute()

    const latency = Date.now() - start
    const status = latency < 100 ? 'healthy' : latency < 500 ? 'degraded' : 'unhealthy'

    const result: HealthCheckResult = {
      status,
      checks: {
        database: {
          connected: true,
          latency
        }
      },
      timestamp: new Date()
    }

    // Add pool metrics if available
    if (pool?.getMetrics) {
      const metrics = pool.getMetrics()
      result.checks.pool = {
        size: metrics.total,
        active: metrics.active,
        idle: metrics.idle,
        waiting: metrics.waiting
      }
    }

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const result: HealthCheckResult = {
      status: 'unhealthy',
      checks: {
        database: {
          connected: false,
          latency: -1,
          error: errorMessage
        }
      },
      timestamp: new Date()
    }

    // Add pool metrics if available
    if (pool?.getMetrics) {
      const metrics = pool.getMetrics()
      result.checks.pool = {
        size: metrics.total,
        active: metrics.active,
        idle: metrics.idle,
        waiting: metrics.waiting
      }
    }

    return result
  }
}

/**
 * Monitor database health continuously
 */
export class HealthMonitor {
  private intervalId?: NodeJS.Timeout
  private lastCheck?: HealthCheckResult

  constructor(
    private db: Kysely<any>,
    private pool?: MetricsPool,
    private intervalMs: number = 30000
  ) {}

  start(onCheck?: (result: HealthCheckResult) => void): void {
    if (this.intervalId) {
      return
    }

    const check = async () => {
      this.lastCheck = await checkDatabaseHealth(this.db, this.pool)
      onCheck?.(this.lastCheck)
    }

    // Initial check
    check()

    // Schedule periodic checks
    this.intervalId = setInterval(check, this.intervalMs)
  }

  stop(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId)
      delete (this as any).intervalId
    }
  }

  getLastCheck(): HealthCheckResult | undefined {
    return this.lastCheck
  }
}