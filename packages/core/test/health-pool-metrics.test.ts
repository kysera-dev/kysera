import { describe, it, expect } from 'vitest';
import { createMetricsPool, type DatabasePool } from '../src/health.js';

/**
 * Comprehensive tests for multi-database pool metrics support.
 * Tests createMetricsPool() with PostgreSQL, MySQL, and SQLite pools.
 *
 * Phase 2 Days 12-13: Multi-Database Support
 */

describe('Multi-Database Pool Metrics', () => {
  describe('PostgreSQL Pool (pg)', () => {
    it('should extract metrics from PostgreSQL pool', () => {
      // Mock PostgreSQL pool structure
      const pgPool: DatabasePool & Record<string, any> = {
        totalCount: 10,
        idleCount: 7,
        waitingCount: 2,
        options: { max: 10 },
        end: async () => {},
        query: async () => ({}),
      };

      const metricsPool = createMetricsPool(pgPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 10,
        idle: 7,
        active: 3, // totalCount - idleCount
        waiting: 2,
      });
    });

    it('should handle PostgreSQL pool with zero connections', () => {
      const pgPool: DatabasePool & Record<string, any> = {
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
        options: { max: 10 },
        end: async () => {},
      };

      const metricsPool = createMetricsPool(pgPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 10, // Falls back to options.max
        idle: 0,
        active: 0,
        waiting: 0,
      });
    });

    it('should handle PostgreSQL pool without options', () => {
      const pgPool: DatabasePool & Record<string, any> = {
        totalCount: 5,
        idleCount: 3,
        waitingCount: 1,
        end: async () => {},
      };

      const metricsPool = createMetricsPool(pgPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 5,
        idle: 3,
        active: 2,
        waiting: 1,
      });
    });

    it('should handle PostgreSQL pool at full capacity', () => {
      const pgPool: DatabasePool & Record<string, any> = {
        totalCount: 10,
        idleCount: 0,
        waitingCount: 5,
        options: { max: 10 },
        end: async () => {},
      };

      const metricsPool = createMetricsPool(pgPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 10,
        idle: 0,
        active: 10,
        waiting: 5,
      });
    });
  });

  describe('MySQL Pool (mysql2)', () => {
    it('should extract metrics from MySQL pool', () => {
      // Mock MySQL2 pool structure
      const mysqlPool: DatabasePool & Record<string, any> = {
        pool: {
          _allConnections: new Array(5), // 5 total connections
          _freeConnections: new Array(3), // 3 free connections
        },
        config: {
          connectionLimit: 10,
        },
        end: async () => {},
        query: async () => ({}),
      };

      const metricsPool = createMetricsPool(mysqlPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 10, // connectionLimit
        idle: 3, // _freeConnections.length
        active: 2, // _allConnections.length - _freeConnections.length
        waiting: 0, // MySQL doesn't expose waiting count
      });
    });

    it('should handle MySQL pool with zero connections', () => {
      const mysqlPool: DatabasePool & Record<string, any> = {
        pool: {
          _allConnections: [],
          _freeConnections: [],
        },
        config: {
          connectionLimit: 10,
        },
        end: async () => {},
      };

      const metricsPool = createMetricsPool(mysqlPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 10,
        idle: 0,
        active: 0,
        waiting: 0,
      });
    });

    it('should handle MySQL pool without config', () => {
      const mysqlPool: DatabasePool & Record<string, any> = {
        pool: {
          _allConnections: new Array(3),
          _freeConnections: new Array(1),
        },
        end: async () => {},
      };

      const metricsPool = createMetricsPool(mysqlPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 10, // Default fallback
        idle: 1,
        active: 2,
        waiting: 0,
      });
    });

    it('should handle MySQL pool at full capacity', () => {
      const mysqlPool: DatabasePool & Record<string, any> = {
        pool: {
          _allConnections: new Array(10),
          _freeConnections: [],
        },
        config: {
          connectionLimit: 10,
        },
        end: async () => {},
      };

      const metricsPool = createMetricsPool(mysqlPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 10,
        idle: 0,
        active: 10,
        waiting: 0,
      });
    });
  });

  describe('SQLite Database (better-sqlite3)', () => {
    it('should extract metrics from SQLite database', () => {
      // Mock better-sqlite3 Database structure
      const sqliteDb: DatabasePool & Record<string, any> = {
        open: true,
        memory: false,
        readonly: false,
        name: 'test.db',
        close: () => {},
        end: () => {},
      };

      const metricsPool = createMetricsPool(sqliteDb);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 1, // SQLite is single-connection
        idle: 0,
        active: 1, // Database is open
        waiting: 0,
      });
    });

    it('should handle closed SQLite database', () => {
      const sqliteDb: DatabasePool & Record<string, any> = {
        open: false,
        memory: true,
        name: ':memory:',
        close: () => {},
        end: () => {},
      };

      const metricsPool = createMetricsPool(sqliteDb);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 1,
        idle: 0,
        active: 0, // Database is closed
        waiting: 0,
      });
    });

    it('should handle readonly SQLite database', () => {
      const sqliteDb: DatabasePool & Record<string, any> = {
        open: true,
        memory: false,
        readonly: true,
        name: 'readonly.db',
        close: () => {},
        end: () => {},
      };

      const metricsPool = createMetricsPool(sqliteDb);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 1,
        idle: 0,
        active: 1,
        waiting: 0,
      });
    });

    it('should handle in-memory SQLite database', () => {
      const sqliteDb: DatabasePool & Record<string, any> = {
        open: true,
        memory: true,
        readonly: false,
        name: ':memory:',
        close: () => {},
        end: () => {},
      };

      const metricsPool = createMetricsPool(sqliteDb);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 1,
        idle: 0,
        active: 1,
        waiting: 0,
      });
    });
  });

  describe('Unknown Pool Types', () => {
    it('should return safe defaults for unknown pool type', () => {
      const unknownPool: DatabasePool = {
        end: async () => {},
      };

      const metricsPool = createMetricsPool(unknownPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 10,
        idle: 0,
        active: 0,
        waiting: 0,
      });
    });

    it('should handle empty object as pool', () => {
      const emptyPool: DatabasePool = {
        end: () => {},
      };

      const metricsPool = createMetricsPool(emptyPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics).toEqual({
        total: 10,
        idle: 0,
        active: 0,
        waiting: 0,
      });
    });
  });

  describe('Pool Interface Compatibility', () => {
    it('should preserve original pool methods', () => {
      const mockEnd = async () => {};
      const mockQuery = async () => ({ rows: [] });

      const pgPool: DatabasePool & Record<string, any> = {
        totalCount: 5,
        idleCount: 2,
        waitingCount: 0,
        end: mockEnd,
        query: mockQuery,
      };

      const metricsPool = createMetricsPool(pgPool);

      expect(metricsPool.end).toBe(mockEnd);
      expect(metricsPool.query).toBe(mockQuery);
    });

    it('should add getMetrics method without affecting pool', () => {
      const pgPool: DatabasePool & Record<string, any> = {
        totalCount: 5,
        idleCount: 2,
        waitingCount: 0,
        customMethod: () => 'custom',
        end: async () => {},
      };

      const metricsPool = createMetricsPool(pgPool);

      expect(metricsPool.getMetrics).toBeDefined();
      expect(typeof metricsPool.getMetrics).toBe('function');
      expect((metricsPool as any).customMethod()).toBe('custom');
    });

    it('should work with synchronous end() method', () => {
      const sqliteDb: DatabasePool & Record<string, any> = {
        open: true,
        memory: true,
        name: ':memory:',
        close: () => {},
        end: () => {}, // Synchronous
      };

      const metricsPool = createMetricsPool(sqliteDb);
      const metrics = metricsPool.getMetrics();

      expect(metrics.total).toBe(1);
      expect(typeof metricsPool.end).toBe('function');
    });

    it('should work with async end() method', () => {
      const pgPool: DatabasePool & Record<string, any> = {
        totalCount: 5,
        idleCount: 2,
        waitingCount: 0,
        end: async () => {}, // Async
      };

      const metricsPool = createMetricsPool(pgPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics.total).toBe(5);
      expect(typeof metricsPool.end).toBe('function');
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle PostgreSQL pool under load', () => {
      const pgPool: DatabasePool & Record<string, any> = {
        totalCount: 20,
        idleCount: 5,
        waitingCount: 10,
        options: { max: 20 },
        end: async () => {},
      };

      const metricsPool = createMetricsPool(pgPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics.total).toBe(20);
      expect(metrics.active).toBe(15); // High usage
      expect(metrics.idle).toBe(5);
      expect(metrics.waiting).toBe(10); // Requests waiting
    });

    it('should handle MySQL pool with partial connections', () => {
      const mysqlPool: DatabasePool & Record<string, any> = {
        pool: {
          _allConnections: new Array(7),
          _freeConnections: new Array(7), // All connections idle
        },
        config: {
          connectionLimit: 20,
        },
        end: async () => {},
      };

      const metricsPool = createMetricsPool(mysqlPool);
      const metrics = metricsPool.getMetrics();

      expect(metrics.total).toBe(20);
      expect(metrics.active).toBe(0);
      expect(metrics.idle).toBe(7);
    });

    it('should handle multiple SQLite databases', () => {
      const db1: DatabasePool & Record<string, any> = {
        open: true,
        memory: false,
        name: 'db1.db',
        close: () => {},
        end: () => {},
      };

      const db2: DatabasePool & Record<string, any> = {
        open: true,
        memory: false,
        name: 'db2.db',
        close: () => {},
        end: () => {},
      };

      const metricsPool1 = createMetricsPool(db1);
      const metricsPool2 = createMetricsPool(db2);

      const metrics1 = metricsPool1.getMetrics();
      const metrics2 = metricsPool2.getMetrics();

      // Each SQLite database is independent
      expect(metrics1.total).toBe(1);
      expect(metrics1.active).toBe(1);
      expect(metrics2.total).toBe(1);
      expect(metrics2.active).toBe(1);
    });
  });
});
