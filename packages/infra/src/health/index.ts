/**
 * Health check and monitoring utilities.
 *
 * @module @kysera/infra/health
 */

// Types
export type {
  HealthStatus,
  HealthCheck,
  HealthCheckResult,
  HealthMetrics,
  DatabaseWithMetrics,
} from './types.js';

// Health check
export {
  type HealthCheckOptions,
  checkDatabaseHealth,
  performHealthCheck,
} from './check.js';

// Health monitor
export {
  type HealthMonitorOptions,
  type HealthCheckCallback,
  HealthMonitor,
} from './monitor.js';

// Metrics
export {
  type GetMetricsOptions,
  type MetricsResult,
  getMetrics,
  hasDatabaseMetrics,
} from './metrics.js';
