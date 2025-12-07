import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from './setup/database.js';
import { getMetrics, createMetricsPool } from '../src/health.js';
import { withDebug } from '../src/debug.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';

describe('getMetrics with Real Data', () => {
  let db: Kysely<TestDatabase>;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = createTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  describe('Error Handling', () => {
    it('should throw error when database is not wrapped with debug plugin', async () => {
      await expect(getMetrics(db)).rejects.toThrow('Database metrics are not available');

      await expect(getMetrics(db)).rejects.toThrow('wrap your database with the debug plugin using withDebug()');
    });

    it('should provide helpful error message with example', async () => {
      try {
        await getMetrics(db);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('withDebug()');
        expect((error as Error).message).toContain('@omnitron-dev/kysera-core/debug');
      }
    });
  });

  describe('Real Query Metrics Collection', () => {
    it('should collect real metrics from executed queries', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      // Execute some queries
      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();
      await debugDb.selectNoFrom((eb) => eb.val(2).as('ping')).execute();
      await debugDb.selectNoFrom((eb) => eb.val(3).as('ping')).execute();

      const metrics = await getMetrics(debugDb as any);

      expect(metrics.queries).toBeDefined();
      expect(metrics.queries!.total).toBe(3);
      expect(metrics.queries!.avgDuration).toBeGreaterThanOrEqual(0);
      expect(metrics.queries!.minDuration).toBeGreaterThanOrEqual(0);
      expect(metrics.queries!.maxDuration).toBeGreaterThanOrEqual(0);
    });

    it('should calculate accurate statistics from query durations', async () => {
      const debugDb = withDebug(db, { logQuery: false, maxMetrics: 100 });

      // Execute multiple queries
      for (let i = 0; i < 10; i++) {
        await debugDb.selectNoFrom((eb) => eb.val(i).as('value')).execute();
      }

      const metrics = await getMetrics(debugDb as any);

      expect(metrics.queries!.total).toBe(10);
      expect(metrics.queries!.avgDuration).toBeGreaterThanOrEqual(0);
      expect(metrics.queries!.minDuration).toBeLessThanOrEqual(metrics.queries!.avgDuration);
      expect(metrics.queries!.maxDuration).toBeGreaterThanOrEqual(metrics.queries!.avgDuration);
      expect(metrics.queries!.p95Duration).toBeGreaterThanOrEqual(metrics.queries!.avgDuration);
      expect(metrics.queries!.p99Duration).toBeGreaterThanOrEqual(metrics.queries!.p95Duration);
    });

    it('should track real slow queries based on threshold', async () => {
      const debugDb = withDebug(db, {
        logQuery: false,
        slowQueryThreshold: 0, // All queries will be considered slow
      });

      // Execute queries
      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();
      await debugDb.selectNoFrom((eb) => eb.val(2).as('ping')).execute();

      const metrics = await getMetrics(debugDb as any, { slowQueryThreshold: 0 });

      expect(metrics.queries!.slowCount).toBeGreaterThan(0);
      expect(metrics.queries!.slowCount).toBeLessThanOrEqual(metrics.queries!.total);
    });

    it('should round durations to 2 decimal places', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();

      const metrics = await getMetrics(debugDb as any);

      // Check that all durations are rounded to max 2 decimal places
      expect(metrics.queries!.avgDuration.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
      expect(metrics.queries!.minDuration.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
      expect(metrics.queries!.maxDuration.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
    });
  });

  describe('Pool Metrics Integration', () => {
    it('should include pool metrics when provided', async () => {
      const debugDb = withDebug(db, { logQuery: false });
      const mockPool = createMetricsPool({
        end: async () => {},
        totalCount: 10,
        idleCount: 7,
        waitingCount: 1,
      } as any);

      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();

      const metrics = await getMetrics(debugDb as any, { pool: mockPool });

      expect(metrics.connections).toBeDefined();
      expect(metrics.connections!.total).toBe(10);
      expect(metrics.connections!.active).toBe(3);
      expect(metrics.connections!.idle).toBe(7);
      expect(metrics.connections!.max).toBe(10);
    });

    it('should work without pool metrics', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();

      const metrics = await getMetrics(debugDb as any);

      expect(metrics.connections).toBeUndefined();
      expect(metrics.queries).toBeDefined();
    });
  });

  describe('Recommendations Generation', () => {
    it('should recommend optimization when more than 10% queries are slow', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      // Execute 10 queries
      for (let i = 0; i < 10; i++) {
        await debugDb.selectNoFrom((eb) => eb.val(i).as('value')).execute();
      }

      // Use threshold of 0 so all queries are slow
      const metrics = await getMetrics(debugDb as any, { slowQueryThreshold: 0 });

      expect(metrics.recommendations).toBeDefined();
      expect(metrics.recommendations!.length).toBeGreaterThan(0);
      expect(metrics.recommendations!.some((r) => r.includes('slow queries'))).toBe(true);
      expect(metrics.recommendations!.some((r) => r.includes('optimization'))).toBe(true);
    });

    it('should recommend monitoring when avg duration approaches threshold', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();

      // Use very low threshold so avg duration is close to it
      const metrics = await getMetrics(debugDb as any, { slowQueryThreshold: 1 });

      if (metrics.queries!.avgDuration > 0.5) {
        expect(metrics.recommendations).toBeDefined();
        const hasMonitoringRecommendation = metrics.recommendations!.some((r) =>
          r.includes('approaching slow query threshold')
        );
        expect(hasMonitoringRecommendation).toBe(true);
      }
    });

    it('should recommend increasing pool size when utilization is high', async () => {
      const debugDb = withDebug(db, { logQuery: false });
      const mockPool = createMetricsPool({
        end: async () => {},
        totalCount: 10,
        idleCount: 1, // Only 1 idle = 90% utilization
        waitingCount: 0,
      } as any);

      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();

      const metrics = await getMetrics(debugDb as any, { pool: mockPool });

      expect(metrics.recommendations).toBeDefined();
      const hasPoolRecommendation = metrics.recommendations!.some((r) =>
        r.includes('Connection pool utilization is high')
      );
      expect(hasPoolRecommendation).toBe(true);
    });

    it('should not generate recommendations for healthy metrics', async () => {
      const debugDb = withDebug(db, { logQuery: false });
      const mockPool = createMetricsPool({
        end: async () => {},
        totalCount: 10,
        idleCount: 8, // Low utilization
        waitingCount: 0,
      } as any);

      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();

      const metrics = await getMetrics(debugDb as any, {
        pool: mockPool,
        slowQueryThreshold: 1000, // High threshold
      });

      // Should have no or minimal recommendations
      expect(!metrics.recommendations || metrics.recommendations.length === 0).toBe(true);
    });
  });

  describe('Period and Timestamp', () => {
    it('should use default period of 1h', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();

      const metrics = await getMetrics(debugDb as any);

      expect(metrics.period).toBe('1h');
    });

    it('should use custom period when provided', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();

      const metrics = await getMetrics(debugDb as any, { period: '24h' });

      expect(metrics.period).toBe('24h');
    });

    it('should include current timestamp', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectNoFrom((eb) => eb.val(1).as('ping')).execute();

      const before = new Date();
      const metrics = await getMetrics(debugDb as any);
      const after = new Date();

      const timestamp = new Date(metrics.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Empty Metrics Handling', () => {
    it('should handle database with no executed queries gracefully', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      // Don't execute any queries
      const metrics = await getMetrics(debugDb as any);

      expect(metrics.timestamp).toBeDefined();
      expect(metrics.period).toBe('1h');
      expect(metrics.queries).toBeUndefined(); // No queries executed
    });
  });

  describe('Real-world Usage Scenarios', () => {
    it('should track metrics from complex query operations', async () => {
      const debugDb = withDebug(db, { logQuery: false, maxMetrics: 1000 });

      // Insert data
      await debugDb
        .insertInto('users')
        .values([
          { email: 'user1@test.com', name: 'User 1' },
          { email: 'user2@test.com', name: 'User 2' },
          { email: 'user3@test.com', name: 'User 3' },
        ])
        .execute();

      // Select queries
      await debugDb.selectFrom('users').selectAll().execute();
      await debugDb.selectFrom('users').where('email', 'like', '%@test.com').selectAll().execute();

      // Update query
      await debugDb.updateTable('users').set({ name: 'Updated User' }).where('email', '=', 'user1@test.com').execute();

      const metrics = await getMetrics(debugDb as any);

      // Should track all queries
      expect(metrics.queries!.total).toBeGreaterThanOrEqual(4);
      expect(metrics.queries!.avgDuration).toBeGreaterThanOrEqual(0);
      expect(metrics.queries!.maxDuration).toBeGreaterThanOrEqual(metrics.queries!.minDuration);
    });

    it('should respect maxMetrics limit from debug plugin', async () => {
      const debugDb = withDebug(db, { logQuery: false, maxMetrics: 5 });

      // Execute more queries than maxMetrics
      for (let i = 0; i < 10; i++) {
        await debugDb.selectNoFrom((eb) => eb.val(i).as('value')).execute();
      }

      const metrics = await getMetrics(debugDb as any);

      // Should only track last 5 queries due to circular buffer
      expect(metrics.queries!.total).toBe(5);
    });

    it('should provide production-ready metrics data', async () => {
      const debugDb = withDebug(db, {
        logQuery: false,
        slowQueryThreshold: 100,
        maxMetrics: 1000,
      });
      const mockPool = createMetricsPool({
        end: async () => {},
        totalCount: 20,
        idleCount: 15,
        waitingCount: 0,
      } as any);

      // Simulate production workload
      for (let i = 0; i < 50; i++) {
        await debugDb.selectNoFrom((eb) => eb.val(i).as('value')).execute();
      }

      const metrics = await getMetrics(debugDb as any, {
        pool: mockPool,
        slowQueryThreshold: 100,
        period: '5m',
      });

      // Verify all expected fields
      expect(metrics.period).toBe('5m');
      expect(metrics.timestamp).toBeDefined();
      expect(metrics.connections).toBeDefined();
      expect(metrics.queries).toBeDefined();
      expect(metrics.queries!.total).toBe(50);
      expect(metrics.queries!.avgDuration).toBeGreaterThanOrEqual(0);
      expect(metrics.queries!.p95Duration).toBeDefined();
      expect(metrics.queries!.p99Duration).toBeDefined();
      expect(metrics.recommendations).toBeDefined();
    });
  });
});
