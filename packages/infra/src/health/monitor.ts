/**
 * Health monitoring utilities.
 *
 * @module @kysera/infra/health
 */

import type { Kysely } from 'kysely';
import { consoleLogger, type KyseraLogger } from '@kysera/core';
import type { MetricsPool } from '../pool/metrics.js';
import type { HealthCheckResult } from './types.js';
import { checkDatabaseHealth } from './check.js';

/**
 * Options for HealthMonitor.
 */
export interface HealthMonitorOptions {
  /** Connection pool for metrics */
  pool?: MetricsPool;
  /** Interval between health checks in milliseconds (default: 30000) */
  intervalMs?: number;
  /** Logger for health check messages */
  logger?: KyseraLogger;
}

/**
 * Callback for health check events.
 */
export type HealthCheckCallback = (result: HealthCheckResult) => void;

/**
 * Continuous health monitor for database connections.
 *
 * Performs periodic health checks and reports status changes.
 *
 * @example Basic usage
 * ```typescript
 * import { HealthMonitor } from '@kysera/infra/health';
 *
 * const monitor = new HealthMonitor(db, {
 *   intervalMs: 30000,
 *   pool: metricsPool,
 * });
 *
 * monitor.start((result) => {
 *   if (result.status !== 'healthy') {
 *     console.warn('Database health degraded:', result.status);
 *   }
 * });
 *
 * // Later, stop monitoring
 * monitor.stop();
 * ```
 *
 * @example With custom logger
 * ```typescript
 * import { HealthMonitor } from '@kysera/infra/health';
 * import { createPrefixedLogger } from '@kysera/core';
 *
 * const logger = createPrefixedLogger('health-monitor');
 * const monitor = new HealthMonitor(db, { logger });
 *
 * monitor.start();
 * ```
 */
export class HealthMonitor<DB = unknown> {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private lastCheck?: HealthCheckResult;
  private readonly pool: MetricsPool | undefined;
  private readonly intervalMs: number;
  private readonly logger: KyseraLogger;

  /**
   * Create a new health monitor.
   *
   * @param db - Kysely database instance
   * @param options - Monitor options
   */
  constructor(
    private readonly db: Kysely<DB>,
    options: HealthMonitorOptions = {}
  ) {
    this.pool = options.pool;
    this.intervalMs = options.intervalMs ?? 30000;
    this.logger = options.logger ?? consoleLogger;
  }

  /**
   * Start the health monitor.
   *
   * Begins periodic health checks. If already started, does nothing.
   *
   * @param onCheck - Optional callback for each health check result
   */
  start(onCheck?: HealthCheckCallback): void {
    if (this.intervalId) {
      return; // Already running
    }

    this.logger.debug(`Starting health monitor with ${this.intervalMs.toString()}ms interval`);

    const check = async (): Promise<void> => {
      this.lastCheck = await checkDatabaseHealth(this.db, this.pool);

      if (this.lastCheck.status !== 'healthy') {
        this.logger.warn(`Health check status: ${this.lastCheck.status}`);
      }

      onCheck?.(this.lastCheck);
    };

    // Initial check
    void check();

    // Schedule periodic checks
    this.intervalId = setInterval(() => void check(), this.intervalMs);
  }

  /**
   * Stop the health monitor.
   *
   * Stops periodic health checks. Safe to call multiple times.
   */
  stop(): void {
    if (this.intervalId !== undefined) {
      this.logger.debug('Stopping health monitor');
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Get the last health check result.
   *
   * @returns Last health check result or undefined if no check has been performed
   */
  getLastCheck(): HealthCheckResult | undefined {
    return this.lastCheck;
  }

  /**
   * Check if the monitor is currently running.
   *
   * @returns True if monitor is active
   */
  isRunning(): boolean {
    return this.intervalId !== undefined;
  }

  /**
   * Perform an immediate health check.
   *
   * Runs a health check outside the regular interval.
   *
   * @returns Health check result
   */
  async checkNow(): Promise<HealthCheckResult> {
    this.lastCheck = await checkDatabaseHealth(this.db, this.pool);
    return this.lastCheck;
  }
}
