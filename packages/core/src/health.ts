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
  private intervalId: NodeJS.Timeout | undefined
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
      this.intervalId = undefined
    }
  }

  getLastCheck(): HealthCheckResult | undefined {
    return this.lastCheck
  }
}

/**
 * @deprecated Use shutdownDatabase from './shutdown' instead
 * Re-exported for backward compatibility
 */
export async function gracefulShutdown<DB>(
  db: Kysely<DB>,
  options: {
    timeoutMs?: number
    onShutdown?: () => void | Promise<void>
  } = {}
): Promise<void> {
  const { timeoutMs = 30000, onShutdown } = options

  const shutdownPromise = async () => {
    try {
      if (onShutdown) {
        await onShutdown()
      }
      await db.destroy()
    } catch (error) {
      console.error('Error during database shutdown:', error)
      throw error
    }
  }

  return Promise.race([
    shutdownPromise(),
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Shutdown timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    )
  ])
}

/**
 * @deprecated Use createGracefulShutdown from './shutdown' instead
 * Re-exported for backward compatibility
 */
export function registerShutdownHandlers<DB>(
  db: Kysely<DB>,
  options: {
    signals?: string[]
    timeoutMs?: number
    onShutdown?: () => void | Promise<void>
  } = {}
): void {
  const { signals = ['SIGTERM', 'SIGINT'], ...shutdownOptions } = options
  let isShuttingDown = false

  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true

    console.log(`Received ${signal}, starting graceful shutdown...`)

    try {
      await gracefulShutdown(db, shutdownOptions)
      console.log('Database connections closed successfully')
      process.exit(0)
    } catch (error) {
      console.error('Error during shutdown:', error)
      process.exit(1)
    }
  }

  signals.forEach(signal => {
    process.on(signal, () => handleShutdown(signal))
  })
}