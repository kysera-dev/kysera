/**
 * Health check types and interfaces.
 *
 * @module @kysera/infra/health
 */

import type { QueryMetrics } from '@kysera/core';

/**
 * Health status levels.
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Individual health check result.
 */
export interface HealthCheck {
  /** Name of the health check */
  name: string;
  /** Current status */
  status: HealthStatus;
  /** Human-readable message */
  message?: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Complete health check result.
 */
export interface HealthCheckResult {
  /** Overall health status (worst of all checks) */
  status: HealthStatus;
  /** Individual health checks */
  checks: HealthCheck[];
  /** Error messages if any */
  errors?: string[];
  /** Collected metrics */
  metrics?: HealthMetrics;
  /** Timestamp of the health check */
  timestamp: Date;
}

/**
 * Health metrics data.
 */
export interface HealthMetrics {
  /** Database version string */
  databaseVersion?: string;
  /** Connection pool metrics */
  poolMetrics?: {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingRequests: number;
  };
  /** Query performance metrics */
  queryMetrics?: {
    totalQueries?: number;
    avgResponseTime?: number;
    slowQueries?: number;
    errors?: number;
  };
  /** Health check latency in milliseconds */
  checkLatency?: number;
}

/**
 * Extended database with metrics tracking capability.
 *
 * This type represents a Kysely database instance that has been wrapped
 * with the debug plugin (using withDebug function from '@kysera/debug').
 *
 * @typeParam _DB - Database type (used for type inference with Kysely, underscore prefix indicates intentionally unused)
 */
export interface DatabaseWithMetrics<_DB = unknown> {
  /** Get collected query metrics */
  getMetrics(): QueryMetrics[];
  /** Clear all collected metrics */
  clearMetrics(): void;
}
