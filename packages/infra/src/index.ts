/**
 * @kysera/infra - Infrastructure utilities for Kysera
 *
 * Provides health checks, resilience patterns, and graceful shutdown
 * for production database applications.
 *
 * @module @kysera/infra
 *
 * @example
 * ```typescript
 * import {
 *   checkDatabaseHealth,
 *   HealthMonitor,
 *   withRetry,
 *   CircuitBreaker,
 *   gracefulShutdown,
 *   createMetricsPool,
 * } from '@kysera/infra';
 *
 * // Create metrics pool
 * const metricsPool = createMetricsPool(pgPool);
 *
 * // Health monitoring
 * const monitor = new HealthMonitor(db, { pool: metricsPool });
 * monitor.start();
 *
 * // Resilience
 * const breaker = new CircuitBreaker(5, 60000);
 * const result = await breaker.execute(() =>
 *   withRetry(() => db.selectFrom('users').execute())
 * );
 *
 * // Graceful shutdown
 * process.on('SIGTERM', () => gracefulShutdown(db));
 * ```
 */

// Health module
export {
  // Types
  type HealthStatus,
  type HealthCheck,
  type HealthCheckResult,
  type HealthMetrics,
  type DatabaseWithMetrics,
  // Health check
  type HealthCheckOptions,
  checkDatabaseHealth,
  performHealthCheck,
  // Health monitor
  type HealthMonitorOptions,
  type HealthCheckCallback,
  HealthMonitor,
  // Metrics
  type GetMetricsOptions,
  type MetricsResult,
  getMetrics,
  hasDatabaseMetrics
} from './health/index.js'

// Resilience module
export {
  // Retry
  type RetryOptions,
  isTransientError,
  withRetry,
  createRetryWrapper,
  // Circuit Breaker
  type CircuitState,
  type CircuitBreakerState,
  type CircuitBreakerOptions,
  CircuitBreaker
} from './resilience/index.js'

// Pool module
export {
  type PoolMetrics,
  type DatabasePool,
  type MetricsPool,
  createMetricsPool,
  isMetricsPool
} from './pool/index.js'

// Shutdown module
export {
  type ShutdownOptions,
  type RegisterShutdownOptions,
  gracefulShutdown,
  shutdownDatabase,
  registerShutdownHandlers,
  createShutdownController
} from './shutdown.js'
