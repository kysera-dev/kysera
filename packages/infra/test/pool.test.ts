/**
 * Tests for pool metrics utilities.
 */

import { describe, it, expect } from 'vitest'
import { createMetricsPool, isMetricsPool, type DatabasePool } from '../src/pool/index.js'

describe('createMetricsPool', () => {
  describe('PostgreSQL pool detection', () => {
    it('should detect pg pool and extract metrics', () => {
      // Mock pg.Pool structure
      const pgPool = {
        totalCount: 10,
        idleCount: 7,
        waitingCount: 2,
        options: { max: 15 },
        end: async () => {}
      }

      const metricsPool = createMetricsPool(pgPool as unknown as DatabasePool)
      const metrics = metricsPool.getMetrics()

      expect(metrics.total).toBe(10)
      expect(metrics.idle).toBe(7)
      expect(metrics.active).toBe(3) // 10 - 7
      expect(metrics.waiting).toBe(2)
    })

    it('should use options.max as fallback for total', () => {
      const pgPool = {
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
        options: { max: 20 },
        end: async () => {}
      }

      const metricsPool = createMetricsPool(pgPool as unknown as DatabasePool)
      const metrics = metricsPool.getMetrics()

      expect(metrics.total).toBe(20)
    })
  })

  describe('MySQL pool detection', () => {
    it('should detect mysql2 pool and extract metrics', () => {
      // Mock mysql2.Pool structure
      const mysqlPool = {
        pool: {
          _allConnections: { length: 8 },
          _freeConnections: { length: 5 }
        },
        config: {
          connectionLimit: 10
        },
        end: async () => {}
      }

      const metricsPool = createMetricsPool(mysqlPool as unknown as DatabasePool)
      const metrics = metricsPool.getMetrics()

      expect(metrics.total).toBe(10)
      expect(metrics.idle).toBe(5)
      expect(metrics.active).toBe(3) // 8 - 5
      expect(metrics.waiting).toBe(0)
    })

    it('should use default connectionLimit when not specified', () => {
      const mysqlPool = {
        pool: {
          _allConnections: { length: 3 },
          _freeConnections: { length: 2 }
        },
        config: {},
        end: async () => {}
      }

      const metricsPool = createMetricsPool(mysqlPool as unknown as DatabasePool)
      const metrics = metricsPool.getMetrics()

      expect(metrics.total).toBe(10) // default
    })
  })

  describe('SQLite detection', () => {
    it('should detect better-sqlite3 database and return static metrics', () => {
      // Mock better-sqlite3.Database structure
      const sqliteDb = {
        open: true,
        memory: true,
        name: ':memory:',
        close: () => {},
        end: () => {}
      }

      const metricsPool = createMetricsPool(sqliteDb as unknown as DatabasePool)
      const metrics = metricsPool.getMetrics()

      expect(metrics.total).toBe(1)
      expect(metrics.idle).toBe(0)
      expect(metrics.active).toBe(1)
      expect(metrics.waiting).toBe(0)
    })

    it('should return inactive metrics when database is closed', () => {
      const sqliteDb = {
        open: false,
        memory: true,
        name: ':memory:',
        close: () => {},
        end: () => {}
      }

      const metricsPool = createMetricsPool(sqliteDb as unknown as DatabasePool)
      const metrics = metricsPool.getMetrics()

      expect(metrics.active).toBe(0)
    })
  })

  describe('tarn pool detection (kysely MssqlDialect / knex)', () => {
    it('should detect a tarn pool via its counter methods', () => {
      // Mock tarn.Pool structure (numUsed/numFree/numPendingAcquires are public API)
      const tarnPool = {
        numUsed: () => 3,
        numFree: () => 2,
        numPendingAcquires: () => 1,
        max: 10,
        destroy: async () => {}
      }

      const metricsPool = createMetricsPool(tarnPool as unknown as DatabasePool)
      const metrics = metricsPool.getMetrics()

      expect(metrics.total).toBe(10)
      expect(metrics.active).toBe(3)
      expect(metrics.idle).toBe(2)
      expect(metrics.waiting).toBe(1)
      expect(metrics.detected).toBe(true)
    })

    it('should fall back to used+free when max is not exposed', () => {
      const tarnPool = {
        numUsed: () => 4,
        numFree: () => 1,
        numPendingAcquires: () => 0,
        destroy: async () => {}
      }

      const metricsPool = createMetricsPool(tarnPool as unknown as DatabasePool)
      const metrics = metricsPool.getMetrics()

      expect(metrics.total).toBe(5)
      expect(metrics.detected).toBe(true)
    })
  })

  describe('detected flag', () => {
    it('should mark recognized pools with detected: true', () => {
      const pgPool = {
        totalCount: 2,
        idleCount: 1,
        waitingCount: 0,
        end: async () => {}
      }
      const mysqlPool = {
        pool: {
          _allConnections: { length: 1 },
          _freeConnections: { length: 1 }
        },
        config: { connectionLimit: 4 },
        end: async () => {}
      }
      const sqliteDb = {
        open: true,
        memory: true,
        name: ':memory:',
        end: () => {}
      }

      for (const pool of [pgPool, mysqlPool, sqliteDb]) {
        const metrics = createMetricsPool(pool as unknown as DatabasePool).getMetrics()
        expect(metrics.detected).toBe(true)
      }
    })
  })

  describe('Unknown pool fallback', () => {
    it('should return default metrics for unknown pool types', () => {
      const unknownPool = {
        end: async () => {}
      }

      const metricsPool = createMetricsPool(unknownPool as unknown as DatabasePool)
      const metrics = metricsPool.getMetrics()

      expect(metrics.total).toBe(10)
      expect(metrics.idle).toBe(0)
      expect(metrics.active).toBe(0)
      expect(metrics.waiting).toBe(0)
    })

    it('should mark placeholder numbers with detected: false', () => {
      const unknownPool = {
        end: async () => {}
      }

      const metrics = createMetricsPool(unknownPool as unknown as DatabasePool).getMetrics()
      expect(metrics.detected).toBe(false)
    })
  })
})

describe('isMetricsPool', () => {
  it('should return true for pool with getMetrics', () => {
    const pool = {
      end: async () => {},
      getMetrics: () => ({ total: 1, idle: 0, active: 1, waiting: 0 })
    }

    expect(isMetricsPool(pool as unknown as DatabasePool)).toBe(true)
  })

  it('should return false for pool without getMetrics', () => {
    const pool = {
      end: async () => {}
    }

    expect(isMetricsPool(pool as unknown as DatabasePool)).toBe(false)
  })
})
