/**
 * Tests for pool metrics utilities.
 */

import { describe, it, expect } from 'vitest';
import { createMetricsPool, isMetricsPool, type DatabasePool } from '../src/pool/index.js';

describe('createMetricsPool', () => {
  describe('PostgreSQL pool detection', () => {
    it('should detect pg pool and extract metrics', () => {
      // Mock pg.Pool structure
      const pgPool = {
        totalCount: 10,
        idleCount: 7,
        waitingCount: 2,
        options: { max: 15 },
        end: async () => {},
      };

      const metricsPool = createMetricsPool(pgPool as unknown as DatabasePool);
      const metrics = metricsPool.getMetrics();

      expect(metrics.total).toBe(10);
      expect(metrics.idle).toBe(7);
      expect(metrics.active).toBe(3); // 10 - 7
      expect(metrics.waiting).toBe(2);
    });

    it('should use options.max as fallback for total', () => {
      const pgPool = {
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
        options: { max: 20 },
        end: async () => {},
      };

      const metricsPool = createMetricsPool(pgPool as unknown as DatabasePool);
      const metrics = metricsPool.getMetrics();

      expect(metrics.total).toBe(20);
    });
  });

  describe('MySQL pool detection', () => {
    it('should detect mysql2 pool and extract metrics', () => {
      // Mock mysql2.Pool structure
      const mysqlPool = {
        pool: {
          _allConnections: { length: 8 },
          _freeConnections: { length: 5 },
        },
        config: {
          connectionLimit: 10,
        },
        end: async () => {},
      };

      const metricsPool = createMetricsPool(mysqlPool as unknown as DatabasePool);
      const metrics = metricsPool.getMetrics();

      expect(metrics.total).toBe(10);
      expect(metrics.idle).toBe(5);
      expect(metrics.active).toBe(3); // 8 - 5
      expect(metrics.waiting).toBe(0);
    });

    it('should use default connectionLimit when not specified', () => {
      const mysqlPool = {
        pool: {
          _allConnections: { length: 3 },
          _freeConnections: { length: 2 },
        },
        config: {},
        end: async () => {},
      };

      const metricsPool = createMetricsPool(mysqlPool as unknown as DatabasePool);
      const metrics = metricsPool.getMetrics();

      expect(metrics.total).toBe(10); // default
    });
  });

  describe('SQLite detection', () => {
    it('should detect better-sqlite3 database and return static metrics', () => {
      // Mock better-sqlite3.Database structure
      const sqliteDb = {
        open: true,
        memory: true,
        name: ':memory:',
        close: () => {},
        end: () => {},
      };

      const metricsPool = createMetricsPool(sqliteDb as unknown as DatabasePool);
      const metrics = metricsPool.getMetrics();

      expect(metrics.total).toBe(1);
      expect(metrics.idle).toBe(0);
      expect(metrics.active).toBe(1);
      expect(metrics.waiting).toBe(0);
    });

    it('should return inactive metrics when database is closed', () => {
      const sqliteDb = {
        open: false,
        memory: true,
        name: ':memory:',
        close: () => {},
        end: () => {},
      };

      const metricsPool = createMetricsPool(sqliteDb as unknown as DatabasePool);
      const metrics = metricsPool.getMetrics();

      expect(metrics.active).toBe(0);
    });
  });

  describe('Unknown pool fallback', () => {
    it('should return default metrics for unknown pool types', () => {
      const unknownPool = {
        end: async () => {},
      };

      const metricsPool = createMetricsPool(unknownPool as unknown as DatabasePool);
      const metrics = metricsPool.getMetrics();

      expect(metrics.total).toBe(10);
      expect(metrics.idle).toBe(0);
      expect(metrics.active).toBe(0);
      expect(metrics.waiting).toBe(0);
    });
  });
});

describe('isMetricsPool', () => {
  it('should return true for pool with getMetrics', () => {
    const pool = {
      end: async () => {},
      getMetrics: () => ({ total: 1, idle: 0, active: 1, waiting: 0 }),
    };

    expect(isMetricsPool(pool as unknown as DatabasePool)).toBe(true);
  });

  it('should return false for pool without getMetrics', () => {
    const pool = {
      end: async () => {},
    };

    expect(isMetricsPool(pool as unknown as DatabasePool)).toBe(false);
  });
});
