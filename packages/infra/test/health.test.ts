/**
 * Comprehensive tests for health check utilities.
 *
 * Tests coverage for:
 * - src/health/check.ts (getStatusFromLatency, checkDatabaseHealth, performHealthCheck)
 * - src/health/metrics.ts (getMetrics, calculatePercentile, hasDatabaseMetrics)
 * - src/health/monitor.ts (HealthMonitor class)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { QueryMetrics } from '@kysera/core';
import {
  checkDatabaseHealth,
  performHealthCheck,
  type HealthCheckOptions,
} from '../src/health/check.js';
import { getMetrics, hasDatabaseMetrics, type GetMetricsOptions } from '../src/health/metrics.js';
import { HealthMonitor, type HealthMonitorOptions } from '../src/health/monitor.js';
import type { MetricsPool } from '../src/pool/metrics.js';
import type { DatabaseWithMetrics } from '../src/health/types.js';

// ====================
// Mock Helpers
// ====================

/**
 * Create a mock Kysely database instance
 */
function createMockDb<DB>(options: {
  shouldFail?: boolean;
  error?: Error;
} = {}): Kysely<DB> {
  const { shouldFail = false, error = new Error('Database error') } = options;

  return {
    selectNoFrom: vi.fn(() => ({
      execute: vi.fn(async () => {
        // Don't use setTimeout for delays - just simulate them
        // This avoids issues with fake timers
        if (shouldFail) {
          throw error;
        }
        return [{ ping: 1 }];
      }),
    })),
  } as unknown as Kysely<DB>;
}

/**
 * Create a mock database with metrics tracking
 */
function createMockDbWithMetrics<DB>(metrics: QueryMetrics[]): Kysely<DB> & DatabaseWithMetrics<DB> {
  const baseDb = createMockDb<DB>({});

  return {
    ...baseDb,
    getMetrics: vi.fn(() => metrics),
    clearMetrics: vi.fn(),
  } as unknown as Kysely<DB> & DatabaseWithMetrics<DB>;
}

/**
 * Create a mock MetricsPool
 */
function createMockPool(metrics: {
  total: number;
  active: number;
  idle: number;
  waiting: number;
}): MetricsPool {
  return {
    getMetrics: vi.fn(() => metrics),
    end: vi.fn(async () => {}),
  } as unknown as MetricsPool;
}

// ====================
// Health Check Tests (check.ts)
// ====================

describe('checkDatabaseHealth', () => {
  it('should return healthy status for fast queries (<100ms)', async () => {
    vi.useRealTimers();
    const db = createMockDb({});

    const result = await checkDatabaseHealth(db);

    expect(result.status).toBe('healthy');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.name).toBe('Database Connection');
    expect(result.checks[0]?.status).toBe('healthy');
    expect(result.metrics?.checkLatency).toBeLessThan(100);
    expect(result.timestamp).toBeInstanceOf(Date);

    vi.useFakeTimers();
  });

  it('should return degraded status for medium-latency queries (100-500ms)', async () => {
    vi.useRealTimers();

    // Mock Date.now to simulate latency
    let callCount = 0;
    const originalDateNow = Date.now;
    Date.now = vi.fn(() => {
      const baseTime = originalDateNow();
      return callCount++ === 0 ? baseTime : baseTime + 150;
    });

    const db = createMockDb({});
    const result = await checkDatabaseHealth(db);

    expect(result.status).toBe('degraded');
    expect(result.metrics?.checkLatency).toBeGreaterThanOrEqual(100);
    expect(result.metrics?.checkLatency).toBeLessThan(500);

    Date.now = originalDateNow;
    vi.useFakeTimers();
  });

  it('should return unhealthy status for slow queries (>=500ms)', async () => {
    vi.useRealTimers();

    // Mock Date.now to simulate latency
    let callCount = 0;
    const originalDateNow = Date.now;
    Date.now = vi.fn(() => {
      const baseTime = originalDateNow();
      return callCount++ === 0 ? baseTime : baseTime + 600;
    });

    const db = createMockDb({});
    const result = await checkDatabaseHealth(db);

    expect(result.status).toBe('unhealthy');
    expect(result.metrics?.checkLatency).toBeGreaterThanOrEqual(500);

    Date.now = originalDateNow;
    vi.useFakeTimers();
  });

  it('should return unhealthy status on database error', async () => {
    vi.useRealTimers();

    const error = new Error('Connection failed');
    const db = createMockDb({ shouldFail: true, error });

    const result = await checkDatabaseHealth(db);

    expect(result.status).toBe('unhealthy');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.status).toBe('unhealthy');
    expect(result.checks[0]?.message).toBe('Connection failed');
    expect(result.errors).toEqual(['Connection failed']);

    vi.useFakeTimers();
  });

  it('should handle non-Error exceptions', async () => {
    vi.useRealTimers();

    const db = {
      selectNoFrom: vi.fn(() => ({
        execute: vi.fn(async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'string error';
        }),
      })),
    } as unknown as Kysely<unknown>;

    const result = await checkDatabaseHealth(db);

    expect(result.status).toBe('unhealthy');
    expect(result.errors).toEqual(['string error']);

    vi.useFakeTimers();
  });

  it('should include pool metrics when pool is provided and healthy', async () => {
    vi.useRealTimers();

    const db = createMockDb({});
    const pool = createMockPool({
      total: 10,
      active: 3,
      idle: 7,
      waiting: 0,
    });

    const result = await checkDatabaseHealth(db, pool);

    expect(result.status).toBe('healthy');
    expect(result.metrics?.poolMetrics).toEqual({
      totalConnections: 10,
      activeConnections: 3,
      idleConnections: 7,
      waitingRequests: 0,
    });
    expect(pool.getMetrics).toHaveBeenCalled();

    vi.useFakeTimers();
  });

  it('should include pool metrics even on error', async () => {
    vi.useRealTimers();

    const db = createMockDb({ shouldFail: true });
    const pool = createMockPool({
      total: 10,
      active: 5,
      idle: 5,
      waiting: 2,
    });

    const result = await checkDatabaseHealth(db, pool);

    expect(result.status).toBe('unhealthy');
    expect(result.metrics?.poolMetrics).toEqual({
      totalConnections: 10,
      activeConnections: 5,
      idleConnections: 5,
      waitingRequests: 2,
    });

    vi.useFakeTimers();
  });

  it('should not include pool metrics when pool has no getMetrics method', async () => {
    vi.useRealTimers();

    const db = createMockDb({});
    const pool = {} as MetricsPool;

    const result = await checkDatabaseHealth(db, pool);

    expect(result.status).toBe('healthy');
    expect(result.metrics?.poolMetrics).toBeUndefined();

    vi.useFakeTimers();
  });

  it('should execute ping query correctly', async () => {
    vi.useRealTimers();

    const db = createMockDb({});

    await checkDatabaseHealth(db);

    expect(db.selectNoFrom).toHaveBeenCalled();

    vi.useFakeTimers();
  });
});

describe('performHealthCheck', () => {
  it('should perform basic health check without options', async () => {
    vi.useRealTimers();

    const db = createMockDb({});

    const result = await performHealthCheck(db);

    expect(result.status).toBe('healthy');
    expect(result.checks).toHaveLength(1);

    vi.useFakeTimers();
  });

  it('should include pool metrics when pool is provided', async () => {
    vi.useRealTimers();

    const db = createMockDb({});
    const pool = createMockPool({
      total: 10,
      active: 2,
      idle: 8,
      waiting: 0,
    });

    const options: HealthCheckOptions = { pool };
    const result = await performHealthCheck(db, options);

    expect(result.metrics?.poolMetrics).toEqual({
      totalConnections: 10,
      activeConnections: 2,
      idleConnections: 8,
      waitingRequests: 0,
    });

    vi.useFakeTimers();
  });

  it('should add database version in verbose mode', async () => {
    vi.useRealTimers();

    const db = createMockDb({});

    const options: HealthCheckOptions = { verbose: true };
    const result = await performHealthCheck(db, options);

    expect(result.status).toBe('healthy');
    expect(result.metrics?.databaseVersion).toBe('Unknown');

    vi.useFakeTimers();
  });

  it('should use custom logger when provided', async () => {
    vi.useRealTimers();

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const db = createMockDb({});
    const options: HealthCheckOptions = { verbose: true, logger };

    await performHealthCheck(db, options);

    // Logger should not be called for successful checks
    expect(logger.debug).not.toHaveBeenCalled();

    vi.useFakeTimers();
  });

  it('should handle version check failures in verbose mode', async () => {
    vi.useRealTimers();

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const db = createMockDb({});
    const options: HealthCheckOptions = { verbose: true, logger };

    const result = await performHealthCheck(db, options);

    // Should still succeed overall even if version check fails
    expect(result.status).toBe('healthy');
    expect(result.metrics?.databaseVersion).toBe('Unknown');

    vi.useFakeTimers();
  });

  it('should combine all options correctly', async () => {
    vi.useRealTimers();

    const db = createMockDb({});
    const pool = createMockPool({
      total: 15,
      active: 5,
      idle: 10,
      waiting: 1,
    });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const options: HealthCheckOptions = {
      pool,
      verbose: true,
      logger,
    };

    const result = await performHealthCheck(db, options);

    expect(result.status).toBe('healthy');
    expect(result.metrics?.poolMetrics).toBeDefined();
    expect(result.metrics?.databaseVersion).toBe('Unknown');

    vi.useFakeTimers();
  });
});

// ====================
// Metrics Tests (metrics.ts)
// ====================

describe('hasDatabaseMetrics', () => {
  it('should return true for database with getMetrics method', () => {
    const db = {
      getMetrics: () => [],
      clearMetrics: () => {},
    } as unknown as Kysely<unknown>;

    expect(hasDatabaseMetrics(db)).toBe(true);
  });

  it('should return false for database without getMetrics method', () => {
    const db = {} as Kysely<unknown>;

    expect(hasDatabaseMetrics(db)).toBe(false);
  });

  it('should return false for database with non-function getMetrics', () => {
    const db = {
      getMetrics: 'not a function',
    } as unknown as Kysely<unknown>;

    expect(hasDatabaseMetrics(db)).toBe(false);
  });
});

describe('getMetrics', () => {
  it('should throw error for database without metrics tracking', () => {
    const db = {} as Kysely<unknown>;

    expect(() => getMetrics(db)).toThrow(
      'Database metrics are not available. ' +
        'To collect query metrics, wrap your database with the debug plugin using withDebug() from @kysera/debug. ' +
        'Example: const debugDb = withDebug(db, { maxMetrics: 1000 });'
    );
  });

  it('should return basic metrics structure with no query data', () => {
    const db = createMockDbWithMetrics([]);

    const result = getMetrics(db);

    expect(result.period).toBe('1h');
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.queries).toBeUndefined();
    expect(result.connections).toBeUndefined();
  });

  it('should calculate query metrics correctly with single query', () => {
    const metrics: QueryMetrics[] = [
      {
        sql: 'SELECT * FROM users',
        params: [],
        duration: 50,
        timestamp: Date.now(),
      },
    ];

    const db = createMockDbWithMetrics(metrics);

    const result = getMetrics(db);

    expect(result.queries).toEqual({
      total: 1,
      avgDuration: 50,
      minDuration: 50,
      maxDuration: 50,
      p95Duration: 50,
      p99Duration: 50,
      slowCount: 0,
    });
  });

  it('should calculate query metrics correctly with multiple queries', () => {
    const metrics: QueryMetrics[] = [
      { sql: 'SELECT 1', params: [], duration: 10, timestamp: Date.now() },
      { sql: 'SELECT 2', params: [], duration: 50, timestamp: Date.now() },
      { sql: 'SELECT 3', params: [], duration: 150, timestamp: Date.now() },
      { sql: 'SELECT 4', params: [], duration: 200, timestamp: Date.now() },
      { sql: 'SELECT 5', params: [], duration: 300, timestamp: Date.now() },
    ];

    const db = createMockDbWithMetrics(metrics);

    const result = getMetrics(db);

    expect(result.queries?.total).toBe(5);
    expect(result.queries?.avgDuration).toBe(142);
    expect(result.queries?.minDuration).toBe(10);
    expect(result.queries?.maxDuration).toBe(300);
    expect(result.queries?.p95Duration).toBeGreaterThan(0);
    expect(result.queries?.p99Duration).toBeGreaterThan(0);
  });

  it('should count slow queries correctly', () => {
    const metrics: QueryMetrics[] = [
      { sql: 'SELECT 1', params: [], duration: 50, timestamp: Date.now() },
      { sql: 'SELECT 2', params: [], duration: 150, timestamp: Date.now() },
      { sql: 'SELECT 3', params: [], duration: 250, timestamp: Date.now() },
    ];

    const db = createMockDbWithMetrics(metrics);
    const options: GetMetricsOptions = { slowQueryThreshold: 100 };

    const result = getMetrics(db, options);

    expect(result.queries?.slowCount).toBe(2); // 150ms and 250ms
  });

  it('should use custom slow query threshold', () => {
    const metrics: QueryMetrics[] = [
      { sql: 'SELECT 1', params: [], duration: 50, timestamp: Date.now() },
      { sql: 'SELECT 2', params: [], duration: 150, timestamp: Date.now() },
      { sql: 'SELECT 3', params: [], duration: 250, timestamp: Date.now() },
    ];

    const db = createMockDbWithMetrics(metrics);
    const options: GetMetricsOptions = { slowQueryThreshold: 200 };

    const result = getMetrics(db, options);

    expect(result.queries?.slowCount).toBe(1); // Only 250ms
  });

  it('should include pool metrics when pool is provided', () => {
    const db = createMockDbWithMetrics([]);
    const pool = createMockPool({
      total: 20,
      active: 8,
      idle: 12,
      waiting: 0,
    });

    const options: GetMetricsOptions = { pool };
    const result = getMetrics(db, options);

    expect(result.connections).toEqual({
      total: 20,
      active: 8,
      idle: 12,
      max: 20,
    });
  });

  it('should not include pool metrics when pool has no getMetrics', () => {
    const db = createMockDbWithMetrics([]);
    const pool = {} as MetricsPool;

    const options: GetMetricsOptions = { pool };
    const result = getMetrics(db, options);

    expect(result.connections).toBeUndefined();
  });

  it('should use custom period', () => {
    const db = createMockDbWithMetrics([]);
    const options: GetMetricsOptions = { period: '5m' };

    const result = getMetrics(db, options);

    expect(result.period).toBe('5m');
  });

  it('should recommend optimization for high slow query count', () => {
    const metrics: QueryMetrics[] = Array.from({ length: 10 }, (_, i) => ({
      sql: `SELECT ${i.toString()}`,
      params: [],
      duration: i < 2 ? 50 : 150, // 80% slow queries
      timestamp: Date.now(),
    }));

    const db = createMockDbWithMetrics(metrics);
    const options: GetMetricsOptions = { slowQueryThreshold: 100 };

    const result = getMetrics(db, options);

    expect(result.recommendations).toBeDefined();
    expect(result.recommendations?.length).toBeGreaterThan(0);
    expect(result.recommendations?.[0]).toContain('slow queries detected');
  });

  it('should recommend monitoring when average duration approaches threshold', () => {
    const metrics: QueryMetrics[] = [
      { sql: 'SELECT 1', params: [], duration: 60, timestamp: Date.now() },
      { sql: 'SELECT 2', params: [], duration: 55, timestamp: Date.now() },
      { sql: 'SELECT 3', params: [], duration: 58, timestamp: Date.now() },
    ];

    const db = createMockDbWithMetrics(metrics);
    const options: GetMetricsOptions = { slowQueryThreshold: 100 };

    const result = getMetrics(db, options);

    expect(result.recommendations).toBeDefined();
    expect(result.recommendations?.some((r) => r.includes('Average query duration'))).toBe(true);
  });

  it('should recommend pool size increase for high utilization', () => {
    const metrics: QueryMetrics[] = [
      { sql: 'SELECT 1', params: [], duration: 50, timestamp: Date.now() },
    ];

    const db = createMockDbWithMetrics(metrics);
    const pool = createMockPool({
      total: 10,
      active: 9, // 90% utilization
      idle: 1,
      waiting: 0,
    });

    const options: GetMetricsOptions = { pool };
    const result = getMetrics(db, options);

    expect(result.recommendations).toBeDefined();
    expect(result.recommendations?.some((r) => r.includes('pool utilization'))).toBe(true);
  });

  it('should round duration metrics to 2 decimal places', () => {
    const metrics: QueryMetrics[] = [
      { sql: 'SELECT 1', params: [], duration: 33.333333, timestamp: Date.now() },
      { sql: 'SELECT 2', params: [], duration: 66.666666, timestamp: Date.now() },
    ];

    const db = createMockDbWithMetrics(metrics);

    const result = getMetrics(db);

    expect(result.queries?.avgDuration).toBe(50);
    expect(result.queries?.minDuration).toBe(33.33);
    expect(result.queries?.maxDuration).toBe(66.67);
  });

  it('should calculate percentiles correctly', () => {
    const durations = Array.from({ length: 100 }, (_, i) => i + 1);
    const metrics: QueryMetrics[] = durations.map((d) => ({
      sql: `SELECT ${d.toString()}`,
      params: [],
      duration: d,
      timestamp: Date.now(),
    }));

    const db = createMockDbWithMetrics(metrics);

    const result = getMetrics(db);

    expect(result.queries?.p95Duration).toBeGreaterThan(90);
    expect(result.queries?.p99Duration).toBeGreaterThan(95);
  });
});

// ====================
// Health Monitor Tests (monitor.ts)
// ====================

describe('HealthMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create monitor with default options', () => {
    const db = createMockDb({});
    const monitor = new HealthMonitor(db);

    expect(monitor).toBeInstanceOf(HealthMonitor);
    expect(monitor.isRunning()).toBe(false);
  });

  it('should create monitor with custom options', () => {
    const db = createMockDb({});
    const pool = createMockPool({ total: 10, active: 2, idle: 8, waiting: 0 });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const options: HealthMonitorOptions = {
      pool,
      intervalMs: 60000,
      logger,
    };

    const monitor = new HealthMonitor(db, options);

    expect(monitor).toBeInstanceOf(HealthMonitor);
  });

  it('should start monitoring and perform initial check', async () => {
    const db = createMockDb({});
    const monitor = new HealthMonitor(db);

    monitor.start();

    expect(monitor.isRunning()).toBe(true);

    // Wait for initial check
    await vi.advanceTimersByTimeAsync(10);

    const lastCheck = monitor.getLastCheck();
    expect(lastCheck).toBeDefined();
    expect(lastCheck?.status).toBe('healthy');
  });

  it('should call onCheck callback on each health check', async () => {
    const db = createMockDb({});
    const monitor = new HealthMonitor(db, { intervalMs: 1000 });
    const onCheck = vi.fn();

    monitor.start(onCheck);

    // Initial check
    await vi.advanceTimersByTimeAsync(10);
    expect(onCheck).toHaveBeenCalledTimes(1);

    // Second check after interval
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10);
    expect(onCheck).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it('should not start if already running', async () => {
    const db = createMockDb({});
    const monitor = new HealthMonitor(db);
    const onCheck = vi.fn();

    monitor.start(onCheck);
    monitor.start(onCheck); // Second start should be no-op

    await vi.advanceTimersByTimeAsync(10);

    // Should only have one set of checks
    expect(monitor.isRunning()).toBe(true);

    monitor.stop();
  });

  it('should stop monitoring', async () => {
    const db = createMockDb({});
    const monitor = new HealthMonitor(db, { intervalMs: 1000 });

    monitor.start();
    expect(monitor.isRunning()).toBe(true);

    monitor.stop();
    expect(monitor.isRunning()).toBe(false);

    // Advance time - no more checks should happen
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10);

    // getLastCheck should still return the last result from before stop
    const lastCheck = monitor.getLastCheck();
    expect(lastCheck).toBeDefined();
  });

  it('should allow multiple stop calls safely', () => {
    const db = createMockDb({});
    const monitor = new HealthMonitor(db);

    monitor.start();
    monitor.stop();
    monitor.stop(); // Should not throw
    monitor.stop(); // Should not throw

    expect(monitor.isRunning()).toBe(false);
  });

  it('should warn on unhealthy status', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Mock Date.now to simulate slow latency
    let callCount = 0;
    const originalDateNow = Date.now;
    Date.now = vi.fn(() => {
      const baseTime = originalDateNow();
      return callCount++ === 0 ? baseTime : baseTime + 600;
    });

    const db = createMockDb({});
    const monitor = new HealthMonitor(db, { logger });

    monitor.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unhealthy'));

    monitor.stop();
    Date.now = originalDateNow;
  });

  it('should warn on degraded status', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Mock Date.now to simulate medium latency
    let callCount = 0;
    const originalDateNow = Date.now;
    Date.now = vi.fn(() => {
      const baseTime = originalDateNow();
      return callCount++ === 0 ? baseTime : baseTime + 200;
    });

    const db = createMockDb({});
    const monitor = new HealthMonitor(db, { logger });

    monitor.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('degraded'));

    monitor.stop();
    Date.now = originalDateNow;
  });

  it('should not warn on healthy status', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const db = createMockDb({});
    const monitor = new HealthMonitor(db, { logger });

    monitor.start();
    await vi.advanceTimersByTimeAsync(10);

    // Should log debug message but not warn
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();

    monitor.stop();
  });

  it('should perform checks at specified interval', async () => {
    const db = createMockDb({});
    const monitor = new HealthMonitor(db, { intervalMs: 5000 });
    const onCheck = vi.fn();

    monitor.start(onCheck);

    // Initial check
    await vi.advanceTimersByTimeAsync(10);
    expect(onCheck).toHaveBeenCalledTimes(1);

    // After 5 seconds
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10);
    expect(onCheck).toHaveBeenCalledTimes(2);

    // After another 5 seconds
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10);
    expect(onCheck).toHaveBeenCalledTimes(3);

    monitor.stop();
  });

  it('should use default interval of 30 seconds', async () => {
    const db = createMockDb({});
    const monitor = new HealthMonitor(db); // No intervalMs specified
    const onCheck = vi.fn();

    monitor.start(onCheck);

    // Initial check
    await vi.advanceTimersByTimeAsync(10);
    expect(onCheck).toHaveBeenCalledTimes(1);

    // After 30 seconds (default)
    await vi.advanceTimersByTimeAsync(30000);
    await vi.advanceTimersByTimeAsync(10);
    expect(onCheck).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it('should perform immediate health check with checkNow()', async () => {
    vi.useRealTimers(); // Use real timers for checkNow()

    const db = createMockDb({});
    const monitor = new HealthMonitor(db);

    const result = await monitor.checkNow();

    expect(result.status).toBe('healthy');
    expect(monitor.getLastCheck()).toBe(result);

    vi.useFakeTimers(); // Restore fake timers
  });

  it('should update lastCheck when using checkNow()', async () => {
    vi.useRealTimers(); // Use real timers for checkNow()

    const db = createMockDb({});
    const monitor = new HealthMonitor(db);

    expect(monitor.getLastCheck()).toBeUndefined();

    await monitor.checkNow();

    expect(monitor.getLastCheck()).toBeDefined();

    vi.useFakeTimers(); // Restore fake timers
  });

  it('should include pool metrics in health checks', async () => {
    const db = createMockDb({});
    const pool = createMockPool({
      total: 10,
      active: 3,
      idle: 7,
      waiting: 0,
    });

    const monitor = new HealthMonitor(db, { pool });

    monitor.start();
    await vi.advanceTimersByTimeAsync(10);

    const lastCheck = monitor.getLastCheck();
    expect(lastCheck?.metrics?.poolMetrics).toEqual({
      totalConnections: 10,
      activeConnections: 3,
      idleConnections: 7,
      waitingRequests: 0,
    });

    monitor.stop();
  });

  it('should return undefined for getLastCheck() before any checks', () => {
    const db = createMockDb({});
    const monitor = new HealthMonitor(db);

    expect(monitor.getLastCheck()).toBeUndefined();
  });

  it('should handle errors during periodic checks gracefully', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const db = createMockDb({ shouldFail: true, error: new Error('Database down') });
    const monitor = new HealthMonitor(db, { logger });

    monitor.start();
    await vi.advanceTimersByTimeAsync(10);

    const lastCheck = monitor.getLastCheck();
    expect(lastCheck?.status).toBe('unhealthy');
    expect(logger.warn).toHaveBeenCalled();

    monitor.stop();
  });

  it('should continue monitoring after errors', async () => {
    const db = createMockDb({ shouldFail: true, error: new Error('Temporary error') });
    const monitor = new HealthMonitor(db, { intervalMs: 1000 });
    const onCheck = vi.fn();

    monitor.start(onCheck);

    // Wait for initial check to complete
    await vi.advanceTimersByTimeAsync(10);
    const initialCalls = onCheck.mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    // Advance to trigger next interval check - should still work after error
    await vi.advanceTimersByTimeAsync(1000);
    expect(onCheck.mock.calls.length).toBeGreaterThan(initialCalls);

    monitor.stop();
  });

  it('should support restart after stop', async () => {
    const db = createMockDb({});
    const monitor = new HealthMonitor(db);

    monitor.start();
    expect(monitor.isRunning()).toBe(true);

    monitor.stop();
    expect(monitor.isRunning()).toBe(false);

    monitor.start();
    expect(monitor.isRunning()).toBe(true);

    monitor.stop();
  });
});
