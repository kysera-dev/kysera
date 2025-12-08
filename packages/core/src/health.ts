import type { Kysely } from 'kysely';
import type { QueryMetrics } from './debug.js';
import type { KyseraLogger } from './logger.js';
import { consoleLogger } from './logger.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Array<{
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
    details?: Record<string, any>;
  }>;
  errors?: string[];
  metrics?: {
    databaseVersion?: string;
    poolMetrics?: {
      totalConnections: number;
      activeConnections: number;
      idleConnections: number;
      waitingRequests: number;
    };
    queryMetrics?: {
      totalQueries?: number;
      avgResponseTime?: number;
      slowQueries?: number;
      errors?: number;
    };
    checkLatency?: number;
  };
  timestamp: Date;
}

/**
 * Pool metrics interface for different database drivers
 */
export interface PoolMetrics {
  total: number;
  idle: number;
  active: number;
  waiting: number;
}

/**
 * Generic database pool interface.
 * Works with connection pools from different database drivers:
 * - PostgreSQL (pg.Pool)
 * - MySQL (mysql2.Pool)
 * - SQLite (better-sqlite3 Database - no pooling, but compatible interface)
 *
 * This interface provides a minimal common API that all pool types support.
 */
export interface DatabasePool {
  /**
   * End/close the pool and release all connections.
   * For PostgreSQL: pool.end()
   * For MySQL: pool.end()
   * For SQLite: database.close()
   */
  end(): Promise<void> | void;

  /**
   * Optional: Execute a query on the pool.
   * Not all pool types support this method directly.
   */
  query?(sql: string, values?: any[]): Promise<any>;
}

/**
 * Extended Pool with metrics access.
 * This interface works with any DatabasePool type.
 */
export interface MetricsPool extends DatabasePool {
  getMetrics(): PoolMetrics;
}

/**
 * Type definitions for PostgreSQL Pool internals (pg package)
 */
interface PostgreSQLPoolInternals {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
  readonly options?: {
    max?: number;
  };
}

/**
 * Type definitions for MySQL Pool (mysql2/promise package)
 */
interface MySQLPoolInternals {
  pool?: {
    _allConnections?: { length: number };
    _freeConnections?: { length: number };
  };
  config?: {
    connectionLimit?: number;
  };
}

/**
 * Type definitions for SQLite Database (better-sqlite3 package)
 * SQLite doesn't have connection pooling, so we return static metrics
 */
interface SQLiteDatabase {
  open: boolean;
  readonly?: boolean;
  memory: boolean;
  name: string;
}

/**
 * Create pool with metrics capabilities for any database type.
 * Automatically detects the pool type and extracts metrics accordingly.
 *
 * Supported pool types:
 * - PostgreSQL (pg.Pool) - Uses totalCount, idleCount, waitingCount
 * - MySQL (mysql2.Pool) - Uses _allConnections, _freeConnections
 * - SQLite (better-sqlite3.Database) - No pooling, returns static metrics
 *
 * @param pool - Database connection pool (PostgreSQL, MySQL, or SQLite)
 * @returns Pool with getMetrics() method
 *
 * @example
 * ```typescript
 * // PostgreSQL
 * import pg from 'pg'
 * const pgPool = new pg.Pool({ max: 10 })
 * const metricsPool = createMetricsPool(pgPool)
 * console.log(metricsPool.getMetrics()) // { total: 10, idle: 8, active: 2, waiting: 0 }
 *
 * // MySQL
 * import mysql from 'mysql2/promise'
 * const mysqlPool = mysql.createPool({ connectionLimit: 10 })
 * const metricsPool = createMetricsPool(mysqlPool)
 * console.log(metricsPool.getMetrics()) // { total: 10, idle: 8, active: 2, waiting: 0 }
 *
 * // SQLite (no pooling)
 * import Database from 'better-sqlite3'
 * const db = new Database(':memory:')
 * const metricsPool = createMetricsPool(db as any)
 * console.log(metricsPool.getMetrics()) // { total: 1, idle: 0, active: 1, waiting: 0 }
 * ```
 */
export function createMetricsPool(pool: DatabasePool): MetricsPool {
  const metricsPool = pool as MetricsPool;

  metricsPool.getMetrics = function () {
    const anyPool = this as any;

    // PostgreSQL (pg) Pool detection
    // Has: totalCount, idleCount, waitingCount properties
    if ('totalCount' in anyPool && 'idleCount' in anyPool) {
      const pgInternals = anyPool as PostgreSQLPoolInternals;
      return {
        total: pgInternals.totalCount || pgInternals.options?.max || 10,
        idle: pgInternals.idleCount || 0,
        waiting: pgInternals.waitingCount || 0,
        active: (pgInternals.totalCount || 0) - (pgInternals.idleCount || 0),
      };
    }

    // MySQL (mysql2) Pool detection
    // Has: pool._allConnections, pool._freeConnections arrays
    if ('pool' in anyPool && anyPool.pool?._allConnections) {
      const mysqlInternals = anyPool as MySQLPoolInternals;
      const allConnections = mysqlInternals.pool?._allConnections?.length || 0;
      const freeConnections = mysqlInternals.pool?._freeConnections?.length || 0;
      const connectionLimit = mysqlInternals.config?.connectionLimit || 10;

      return {
        total: connectionLimit,
        idle: freeConnections,
        waiting: 0, // MySQL doesn't expose waiting connections count
        active: allConnections - freeConnections,
      };
    }

    // SQLite (better-sqlite3) Database detection
    // Has: open, memory, name properties
    // SQLite doesn't have connection pooling, so return static metrics
    if ('open' in anyPool && 'memory' in anyPool) {
      const sqliteDb = anyPool as SQLiteDatabase;
      return {
        total: 1, // SQLite is single-connection
        idle: 0,
        waiting: 0,
        active: sqliteDb.open ? 1 : 0,
      };
    }

    // Fallback for unknown pool types
    // Return safe default metrics
    return {
      total: 10,
      idle: 0,
      waiting: 0,
      active: 0,
    };
  };

  return metricsPool;
}

/**
 * Check database health
 */
export async function checkDatabaseHealth<DB>(db: Kysely<DB>, pool?: MetricsPool): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    // Simple query to check connection
    await db.selectNoFrom((eb) => eb.val(1).as('ping')).execute();

    const latency = Date.now() - start;
    const status = latency < 100 ? 'healthy' : latency < 500 ? 'degraded' : 'unhealthy';

    const checks = [
      {
        name: 'Database Connection',
        status: 'healthy' as const,
        message: `Connected successfully (${latency}ms)`,
      },
    ];

    const result: HealthCheckResult = {
      status,
      checks,
      metrics: {
        checkLatency: latency,
      },
      timestamp: new Date(),
    };

    // Add pool metrics if available
    if (pool?.getMetrics) {
      const metrics = pool.getMetrics();
      result.metrics!.poolMetrics = {
        totalConnections: metrics.total,
        activeConnections: metrics.active,
        idleConnections: metrics.idle,
        waitingRequests: metrics.waiting,
      };
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const result: HealthCheckResult = {
      status: 'unhealthy',
      checks: [
        {
          name: 'Database Connection',
          status: 'unhealthy',
          message: errorMessage,
        },
      ],
      errors: [errorMessage],
      timestamp: new Date(),
    };

    // Add pool metrics if available
    if (pool?.getMetrics) {
      const metrics = pool.getMetrics();
      result.metrics = {
        poolMetrics: {
          totalConnections: metrics.total,
          activeConnections: metrics.active,
          idleConnections: metrics.idle,
          waitingRequests: metrics.waiting,
        },
      };
    }

    return result;
  }
}

/**
 * Perform comprehensive health check
 * Alias for checkDatabaseHealth with additional options
 */
export async function performHealthCheck<DB>(
  db: Kysely<DB>,
  options: {
    verbose?: boolean;
    pool?: MetricsPool;
  } = {}
): Promise<HealthCheckResult> {
  const baseResult = await checkDatabaseHealth(db, options.pool);

  if (options.verbose) {
    // Add additional checks in verbose mode
    try {
      // Check database version (simplified - actual implementation would be dialect-specific)
      baseResult.metrics = {
        ...baseResult.metrics,
        databaseVersion: 'Unknown',
      };
    } catch (error) {
      consoleLogger.debug?.('Version check failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return baseResult;
}

/**
 * Extended database with metrics tracking capability.
 * This type represents a Kysely database instance that has been wrapped
 * with the debug plugin (using withDebug function from './debug.js').
 */
export interface DatabaseWithMetrics<DB> extends Kysely<DB> {
  getMetrics(): QueryMetrics[];
  clearMetrics(): void;
}

/**
 * Options for getMetrics function
 */
export interface GetMetricsOptions {
  /**
   * Time period for metrics (informational, not used for filtering)
   * @default '1h'
   */
  period?: string;
  /**
   * Optional pool to extract connection metrics from
   */
  pool?: MetricsPool;
  /**
   * Duration threshold (in ms) to consider a query as slow
   * @default 100
   */
  slowQueryThreshold?: number;
}

/**
 * Metrics result interface
 */
export interface MetricsResult {
  period: string;
  timestamp: string;
  connections?: {
    total: number;
    active: number;
    idle: number;
    max: number;
  };
  queries?: {
    total: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    p95Duration: number;
    p99Duration: number;
    slowCount: number;
  };
  recommendations?: string[];
}

/**
 * Calculate percentile from sorted array of numbers
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)] ?? 0;
}

/**
 * Get database metrics from real query execution data.
 *
 * IMPORTANT: This function requires the database to be wrapped with the debug plugin
 * to track query metrics. Use `withDebug()` from './debug.js' to enable metrics collection.
 *
 * @param db - Kysely database instance with metrics tracking (created using withDebug)
 * @param options - Options for metrics collection
 * @returns Real metrics data collected from actual query execution
 * @throws {Error} If the database is not wrapped with the debug plugin
 *
 * @example
 * ```typescript
 * import { withDebug } from '@omnitron-dev/kysera-core/debug';
 * import { getMetrics } from '@omnitron-dev/kysera-core/health';
 *
 * // Create a database with metrics tracking
 * const db = new Kysely<Database>({ ... });
 * const debugDb = withDebug(db, { maxMetrics: 1000 });
 *
 * // Perform some queries...
 * await debugDb.selectFrom('users').selectAll().execute();
 *
 * // Get real metrics
 * const metrics = await getMetrics(debugDb, {
 *   slowQueryThreshold: 100,
 *   pool: metricsPool
 * });
 *
 * console.log(metrics.queries.avgDuration); // Real average from tracked queries
 * console.log(metrics.queries.slowCount); // Real count of slow queries
 * ```
 */
export async function getMetrics<DB>(
  db: Kysely<DB> | DatabaseWithMetrics<DB>,
  options: GetMetricsOptions = {}
): Promise<MetricsResult> {
  const { period = '1h', pool, slowQueryThreshold = 100 } = options;

  // Check if database has metrics tracking enabled
  const dbWithMetrics = db as DatabaseWithMetrics<DB>;
  if (typeof dbWithMetrics.getMetrics !== 'function') {
    throw new Error(
      'Database metrics are not available. ' +
        'To collect query metrics, wrap your database with the debug plugin using withDebug() from @omnitron-dev/kysera-core/debug. ' +
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
  const queryMetrics = dbWithMetrics.getMetrics();

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
      avgDuration: Math.round(avgDuration * 100) / 100, // Round to 2 decimal places
      minDuration: Math.round(minDuration * 100) / 100,
      maxDuration: Math.round(maxDuration * 100) / 100,
      p95Duration: Math.round(p95Duration * 100) / 100,
      p99Duration: Math.round(p99Duration * 100) / 100,
      slowCount,
    };

    // Generate recommendations based on real data
    result.recommendations = [];

    if (slowCount > queryMetrics.length * 0.1) {
      // More than 10% slow queries
      result.recommendations.push(
        `High number of slow queries detected (${slowCount}/${queryMetrics.length}). ` +
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
      result.recommendations = result.recommendations || [];
      result.recommendations.push(
        `Connection pool utilization is high (${(utilizationRate * 100).toFixed(1)}%). ` +
          `Consider increasing pool size.`
      );
    }
  }

  return result;
}

/**
 * Options for HealthMonitor
 */
export interface HealthMonitorOptions {
  /** Connection pool for metrics */
  pool?: MetricsPool;
  /** Interval between health checks in milliseconds */
  intervalMs?: number;
  /** Logger for health check messages */
  logger?: KyseraLogger;
}

/**
 * Monitor database health continuously
 */
export class HealthMonitor {
  private intervalId: NodeJS.Timeout | undefined;
  private lastCheck?: HealthCheckResult;
  private pool: MetricsPool | undefined;
  private intervalMs: number;
  private logger: KyseraLogger;

  constructor(
    private db: Kysely<any>,
    options: HealthMonitorOptions = {}
  ) {
    this.pool = options.pool;
    this.intervalMs = options.intervalMs ?? 30000;
    this.logger = options.logger ?? consoleLogger;
  }

  start(onCheck?: (result: HealthCheckResult) => void): void {
    if (this.intervalId) {
      return;
    }

    this.logger.debug(`Starting health monitor with ${this.intervalMs}ms interval`);

    const check = async () => {
      this.lastCheck = await checkDatabaseHealth(this.db, this.pool);
      if (this.lastCheck.status !== 'healthy') {
        this.logger.warn(`Health check status: ${this.lastCheck.status}`);
      }
      onCheck?.(this.lastCheck);
    };

    // Initial check
    check();

    // Schedule periodic checks
    this.intervalId = setInterval(check, this.intervalMs);
  }

  stop(): void {
    if (this.intervalId !== undefined) {
      this.logger.debug('Stopping health monitor');
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  getLastCheck(): HealthCheckResult | undefined {
    return this.lastCheck;
  }
}

/**
 * @deprecated Use shutdownDatabase from './shutdown' instead
 * Re-exported for backward compatibility
 */
export async function gracefulShutdown<DB>(
  db: Kysely<DB>,
  options: {
    timeoutMs?: number;
    onShutdown?: () => void | Promise<void>;
    logger?: KyseraLogger;
  } = {}
): Promise<void> {
  const { timeoutMs = 30000, onShutdown, logger = consoleLogger } = options;

  const shutdownPromise = async () => {
    try {
      if (onShutdown) {
        await onShutdown();
      }
      await db.destroy();
    } catch (error) {
      logger.error('Error during database shutdown:', error);
      throw error;
    }
  };

  return Promise.race([
    shutdownPromise(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`Shutdown timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * @deprecated Use createGracefulShutdown from './shutdown' instead
 * Re-exported for backward compatibility
 */
export function registerShutdownHandlers<DB>(
  db: Kysely<DB>,
  options: {
    signals?: string[];
    timeoutMs?: number;
    onShutdown?: () => void | Promise<void>;
    logger?: KyseraLogger;
  } = {}
): void {
  const { signals = ['SIGTERM', 'SIGINT'], logger = consoleLogger, ...shutdownOptions } = options;
  let isShuttingDown = false;

  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal}, starting graceful shutdown...`);

    try {
      await gracefulShutdown(db, { ...shutdownOptions, logger });
      logger.info('Database connections closed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  signals.forEach((signal) => {
    process.on(signal, () => handleShutdown(signal));
  });
}
