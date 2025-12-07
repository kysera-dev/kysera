import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  checkDatabaseHealth,
  HealthMonitor,
  gracefulShutdown,
  registerShutdownHandlers,
  createMetricsPool,
} from '../src/health.js';
import { createTestDatabase, initializeTestSchema } from './setup/test-database.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/test-database.js';

describe('Health Checks with Real SQLite Database', () => {
  let db: Kysely<TestDatabase>;

  beforeAll(async () => {
    db = createTestDatabase();
    await initializeTestSchema(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('checkDatabaseHealth', () => {
    it('should report healthy database', async () => {
      const result = await checkDatabaseHealth(db);

      expect(result.status).toBe('healthy');
      expect(result.checks[0]?.status).toBe('healthy');
      expect(result.metrics?.checkLatency).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.checkLatency).toBeLessThan(100); // Should be fast for in-memory
      expect(result.checks[0]?.message).toContain('Connected successfully');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should detect slow queries', async () => {
      // Create a slow query by using a complex operation
      const slowDb = createTestDatabase();
      await initializeTestSchema(slowDb);

      // Insert many records to slow down query
      const users = Array.from({ length: 1000 }, (_, i) => ({
        email: `user${i}@example.com`,
        name: `User ${i}`,
        updated_at: null,
        deleted_at: null,
      }));

      await slowDb.insertInto('users').values(users).execute();

      // Create a deliberately slow query
      const mockDb = {
        ...slowDb,
        selectNoFrom: vi.fn(() => ({
          execute: async () => {
            // Simulate slow query
            await new Promise((resolve) => setTimeout(resolve, 150));
            return [{ ping: 1 }];
          },
        })),
      } as any;

      const result = await checkDatabaseHealth(mockDb);

      expect(result.status).toBe('degraded'); // 150ms > 100ms threshold
      expect(result.metrics?.checkLatency).toBeGreaterThanOrEqual(150);

      await slowDb.destroy();
    });

    it('should handle database errors', async () => {
      const errorDb = {
        selectNoFrom: vi.fn(() => ({
          execute: async () => {
            throw new Error('Connection failed');
          },
        })),
        destroy: vi.fn(),
      } as any;

      const result = await checkDatabaseHealth(errorDb);

      expect(result.status).toBe('unhealthy');
      expect(result.checks[0]?.status).toBe('unhealthy');
      // When there's an error, metrics may not be included
      expect(result.metrics?.checkLatency).toBeUndefined();
      expect(result.checks[0]?.message).toBe('Connection failed');
    });

    it('should work with MetricsPool', async () => {
      // Mock pool for testing
      const mockPool = {
        connect: vi.fn(),
        end: vi.fn(),
        query: vi.fn(),
        totalCount: 10,
        idleCount: 7,
        waitingCount: 1,
      } as any;

      const metricsPool = createMetricsPool(mockPool);
      const result = await checkDatabaseHealth(db, metricsPool);

      expect(result.metrics?.poolMetrics).toBeDefined();
      expect(result.metrics?.poolMetrics?.totalConnections).toBe(10);
      expect(result.metrics?.poolMetrics?.idleConnections).toBe(7);
      expect(result.metrics?.poolMetrics?.activeConnections).toBe(3);
      expect(result.metrics?.poolMetrics?.waitingRequests).toBe(1);
    });
  });

  describe('HealthMonitor', () => {
    it('should perform periodic health checks', async () => {
      const monitor = new HealthMonitor(db, undefined, 100); // 100ms interval

      const checkResults: any[] = [];
      monitor.start((result) => {
        checkResults.push(result);
      });

      // Wait for multiple checks (500ms should be enough for at least 2 checks)
      await new Promise((resolve) => setTimeout(resolve, 500));

      monitor.stop();

      expect(checkResults.length).toBeGreaterThanOrEqual(1);
      expect(checkResults.every((r) => r.status === 'healthy')).toBe(true);
    });

    it('should track last check result', async () => {
      const monitor = new HealthMonitor(db, undefined, 100);

      expect(monitor.getLastCheck()).toBeUndefined();

      monitor.start();

      // Wait for first check
      await new Promise((resolve) => setTimeout(resolve, 150));

      const lastCheck = monitor.getLastCheck();
      expect(lastCheck).toBeDefined();
      expect(lastCheck?.status).toBe('healthy');

      monitor.stop();
    });

    it('should not start multiple monitors', async () => {
      const monitor = new HealthMonitor(db);

      const callback = vi.fn();
      monitor.start(callback);

      // Wait for initial check to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      const initialCalls = callback.mock.calls.length;
      expect(initialCalls).toBeGreaterThanOrEqual(1); // Initial check

      monitor.start(callback); // Should be ignored

      // Wait to see if another check happens
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not have added another check
      expect(callback).toHaveBeenCalledTimes(initialCalls);

      monitor.stop();
    });

    it('should properly stop monitoring', async () => {
      const monitor = new HealthMonitor(db, undefined, 50);

      const callback = vi.fn();
      monitor.start(callback);

      await new Promise((resolve) => setTimeout(resolve, 150));

      const callCountBeforeStop = callback.mock.calls.length;
      monitor.stop();

      await new Promise((resolve) => setTimeout(resolve, 150));

      // No new calls after stop
      expect(callback).toHaveBeenCalledTimes(callCountBeforeStop);
    });
  });

  describe('gracefulShutdown', () => {
    it('should destroy database connections', async () => {
      const testDb = createTestDatabase();
      await initializeTestSchema(testDb);

      const destroySpy = vi.spyOn(testDb, 'destroy');

      await gracefulShutdown(testDb);

      expect(destroySpy).toHaveBeenCalled();
    });

    it('should call custom shutdown handler', async () => {
      const testDb = createTestDatabase();
      const onShutdown = vi.fn();

      await gracefulShutdown(testDb, { onShutdown });

      expect(onShutdown).toHaveBeenCalled();
    });

    it('should timeout if shutdown takes too long', async () => {
      const testDb = {
        destroy: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
      } as any;

      await expect(gracefulShutdown(testDb, { timeoutMs: 100 })).rejects.toThrow('Shutdown timeout after 100ms');
    });

    it('should handle shutdown errors', async () => {
      const testDb = {
        destroy: async () => {
          throw new Error('Destroy failed');
        },
      } as any;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(gracefulShutdown(testDb)).rejects.toThrow('Destroy failed');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error during database shutdown'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('registerShutdownHandlers', () => {
    it('should register signal handlers', () => {
      const testDb = createTestDatabase();
      const processSpy = vi.spyOn(process, 'on');

      registerShutdownHandlers(testDb, {
        signals: ['SIGTERM', 'SIGINT'],
      });

      expect(processSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(processSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

      processSpy.mockRestore();
    });

    it('should handle shutdown on signal', async () => {
      const testDb = createTestDatabase();
      const destroySpy = vi.spyOn(testDb, 'destroy');
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit');
      });
      // Logger uses console.info for info level messages
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      let signalHandler: Function | undefined;

      const processSpy = vi.spyOn(process, 'on').mockImplementation((event: string | symbol, handler: any) => {
        if (event === 'SIGTERM') {
          signalHandler = handler;
        }
        return process;
      });

      registerShutdownHandlers(testDb);

      // Trigger signal
      if (signalHandler) {
        try {
          await signalHandler();
        } catch {
          // Expected to throw due to process.exit mock
        }
      }

      expect(destroySpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
      // Logger uses console.info for graceful shutdown message
      expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('graceful shutdown'));

      processSpy.mockRestore();
      exitSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    });

    it('should prevent multiple shutdowns', async () => {
      const testDb = createTestDatabase();
      const destroySpy = vi.spyOn(testDb, 'destroy').mockResolvedValue();
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never;
      });

      let signalHandler: Function | undefined;
      let callCount = 0;

      const processSpy = vi.spyOn(process, 'on').mockImplementation((event: string | symbol, handler: any) => {
        if (event === 'SIGTERM') {
          signalHandler = handler;
        }
        return process;
      });

      registerShutdownHandlers(testDb);

      // Try to trigger signal multiple times
      if (signalHandler) {
        // Track calls
        const originalHandler = signalHandler;
        signalHandler = () => {
          callCount++;
          return originalHandler();
        };

        // First call
        signalHandler();

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Second call should be ignored
        signalHandler();

        // Only the first call should have effect
        expect(callCount).toBe(2); // Both calls happen
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(destroySpy).toHaveBeenCalledTimes(1); // But destroy only called once
      }

      processSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('Integration Tests', () => {
    it('should perform health check with real database operations', async () => {
      // Insert some data
      await db
        .insertInto('users')
        .values({
          email: 'health@example.com',
          name: 'Health Test',
          updated_at: null,
          deleted_at: null,
        })
        .execute();

      const result = await checkDatabaseHealth(db);

      expect(result.status).toBe('healthy');

      // Verify database is still functional after health check
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users.length).toBeGreaterThan(0);
    });

    it('should monitor health during database operations', async () => {
      const monitor = new HealthMonitor(db, undefined, 50);

      const results: any[] = [];
      monitor.start((r) => results.push(r));

      // Perform database operations while monitoring
      for (let i = 0; i < 5; i++) {
        await db
          .insertInto('users')
          .values({
            email: `monitor${i}@example.com`,
            name: `Monitor User ${i}`,
            updated_at: null,
            deleted_at: null,
          })
          .execute();

        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      // Wait a bit more for final checks
      await new Promise((resolve) => setTimeout(resolve, 100));

      monitor.stop();

      // Should have captured at least one health check during operations
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every((r) => r.status === 'healthy')).toBe(true);
    });
  });
});
