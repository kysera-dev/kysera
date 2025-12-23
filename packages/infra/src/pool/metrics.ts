/**
 * Pool metrics utilities for database connection pools.
 *
 * Provides unified metrics extraction for PostgreSQL, MySQL, and SQLite.
 *
 * @module @kysera/infra/pool
 */

/**
 * Pool metrics interface for different database drivers.
 */
export interface PoolMetrics {
  /** Total number of connections in the pool */
  total: number
  /** Number of idle (available) connections */
  idle: number
  /** Number of active (in-use) connections */
  active: number
  /** Number of requests waiting for a connection */
  waiting: number
}

/**
 * Generic database pool interface.
 *
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
   *
   * For PostgreSQL: pool.end()
   * For MySQL: pool.end()
   * For SQLite: database.close()
   */
  end(): Promise<void> | void

  /**
   * Optional: Execute a query on the pool.
   * Not all pool types support this method directly.
   */
  query?(sql: string, values?: unknown[]): Promise<unknown>
}

/**
 * Extended Pool with metrics access.
 * This interface works with any DatabasePool type.
 */
export interface MetricsPool extends DatabasePool {
  /** Get current pool metrics */
  getMetrics(): PoolMetrics
}

/**
 * Type definitions for PostgreSQL Pool internals (pg package).
 * @internal
 */
interface PostgreSQLPoolInternals {
  readonly totalCount: number
  readonly idleCount: number
  readonly waitingCount: number
  readonly options?: {
    max?: number
  }
}

/**
 * Type definitions for MySQL Pool (mysql2/promise package).
 * @internal
 */
interface MySQLPoolInternals {
  pool?: {
    _allConnections?: { length: number }
    _freeConnections?: { length: number }
  }
  config?: {
    connectionLimit?: number
  }
}

/**
 * Type definitions for SQLite Database (better-sqlite3 package).
 * SQLite doesn't have connection pooling, so we return static metrics.
 * @internal
 */
interface SQLiteDatabase {
  open: boolean
  readonly?: boolean
  memory: boolean
  name: string
}

/**
 * Create pool with metrics capabilities for any database type.
 *
 * Automatically detects the pool type and extracts metrics accordingly.
 *
 * Supported pool types:
 * - **PostgreSQL** (pg.Pool) - Uses totalCount, idleCount, waitingCount
 * - **MySQL** (mysql2.Pool) - Uses _allConnections, _freeConnections
 * - **SQLite** (better-sqlite3.Database) - No pooling, returns static metrics
 *
 * @param pool - Database connection pool (PostgreSQL, MySQL, or SQLite)
 * @returns Pool with getMetrics() method
 *
 * @example PostgreSQL
 * ```typescript
 * import pg from 'pg';
 * import { createMetricsPool } from '@kysera/infra/pool';
 *
 * const pgPool = new pg.Pool({ max: 10 });
 * const metricsPool = createMetricsPool(pgPool);
 * console.log(metricsPool.getMetrics());
 * // { total: 10, idle: 8, active: 2, waiting: 0 }
 * ```
 *
 * @example MySQL
 * ```typescript
 * import mysql from 'mysql2/promise';
 * import { createMetricsPool } from '@kysera/infra/pool';
 *
 * const mysqlPool = mysql.createPool({ connectionLimit: 10 });
 * const metricsPool = createMetricsPool(mysqlPool);
 * console.log(metricsPool.getMetrics());
 * // { total: 10, idle: 8, active: 2, waiting: 0 }
 * ```
 *
 * @example SQLite (no pooling)
 * ```typescript
 * import Database from 'better-sqlite3';
 * import { createMetricsPool } from '@kysera/infra/pool';
 *
 * const db = new Database(':memory:');
 * const metricsPool = createMetricsPool(db as unknown as DatabasePool);
 * console.log(metricsPool.getMetrics());
 * // { total: 1, idle: 0, active: 1, waiting: 0 }
 * ```
 */
/**
 * Extract PostgreSQL pool metrics.
 * @internal
 */
function getPostgreSQLMetrics(pool: PostgreSQLPoolInternals): PoolMetrics {
  const total = pool.totalCount
  const idle = pool.idleCount
  const waiting = pool.waitingCount
  return {
    total: total > 0 ? total : (pool.options?.max ?? 10),
    idle,
    waiting,
    active: total - idle
  }
}

/**
 * Extract MySQL pool metrics.
 * @internal
 */
function getMySQLMetrics(pool: MySQLPoolInternals): PoolMetrics {
  const allConnections = pool.pool?._allConnections?.length ?? 0
  const freeConnections = pool.pool?._freeConnections?.length ?? 0
  const connectionLimit = pool.config?.connectionLimit ?? 10
  return {
    total: connectionLimit,
    idle: freeConnections,
    waiting: 0, // MySQL doesn't expose waiting connections count
    active: allConnections - freeConnections
  }
}

/**
 * Extract SQLite metrics (single connection, no pooling).
 * @internal
 */
function getSQLiteMetrics(db: SQLiteDatabase): PoolMetrics {
  return {
    total: 1, // SQLite is single-connection
    idle: 0,
    waiting: 0,
    active: db.open ? 1 : 0
  }
}

/**
 * Default metrics for unknown pool types.
 * @internal
 */
function getDefaultMetrics(): PoolMetrics {
  return {
    total: 10,
    idle: 0,
    waiting: 0,
    active: 0
  }
}

export function createMetricsPool(pool: DatabasePool): MetricsPool {
  const metricsPool = pool as MetricsPool

  metricsPool.getMetrics = function (): PoolMetrics {
    // Runtime type detection requires unsafe type assertions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyPool: unknown = this as any

    // PostgreSQL (pg) Pool detection
    if (
      typeof anyPool === 'object' &&
      anyPool !== null &&
      'totalCount' in anyPool &&
      'idleCount' in anyPool
    ) {
      return getPostgreSQLMetrics(anyPool as PostgreSQLPoolInternals)
    }

    // MySQL (mysql2) Pool detection
    if (typeof anyPool === 'object' && anyPool !== null && 'pool' in anyPool) {
      const mysqlPool = anyPool as MySQLPoolInternals
      if (mysqlPool.pool?._allConnections) {
        return getMySQLMetrics(mysqlPool)
      }
    }

    // SQLite (better-sqlite3) Database detection
    if (
      typeof anyPool === 'object' &&
      anyPool !== null &&
      'open' in anyPool &&
      'memory' in anyPool
    ) {
      return getSQLiteMetrics(anyPool as SQLiteDatabase)
    }

    // Fallback for unknown pool types
    return getDefaultMetrics()
  }

  return metricsPool
}

/**
 * Type guard to check if a pool has metrics capabilities.
 *
 * @param pool - Pool to check
 * @returns True if pool has getMetrics method
 */
export function isMetricsPool(pool: DatabasePool): pool is MetricsPool {
  return typeof (pool as MetricsPool).getMetrics === 'function'
}
