import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDatabase } from './setup/database'
import { checkDatabaseHealth, gracefulShutdown, registerShutdownHandlers } from '../src/health'
import type { Kysely } from 'kysely'
import type { TestDatabase } from './setup/database'

describe('Health Check', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => void

  beforeEach(() => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup
  })

  afterEach(() => {
    cleanup()
  })

  describe('checkDatabaseHealth', () => {
    it('should return healthy status for working database', async () => {
      const health = await checkDatabaseHealth(db)

      expect(health.status).toBe('healthy')
      expect(health.checks.database.connected).toBe(true)
      expect(health.checks.database.latency).toBeGreaterThanOrEqual(0)
      expect(health.checks.database.error).toBeUndefined()
      expect(health.timestamp).toBeInstanceOf(Date)
    })

    it('should measure query latency accurately', async () => {
      const health = await checkDatabaseHealth(db)

      expect(health.checks.database.latency).toBeGreaterThanOrEqual(0)  // May be 0 for very fast queries
      expect(health.checks.database.latency).toBeLessThan(100) // Should be fast for SQLite
    })

    it('should handle database errors gracefully', async () => {
      // Create a broken database connection
      const brokenDb = {
        selectNoFrom: () => {
          throw new Error('Connection failed')
        }
      } as any

      const health = await checkDatabaseHealth(brokenDb)

      expect(health.status).toBe('unhealthy')
      expect(health.checks.database.connected).toBe(false)
      expect(health.checks.database.error).toBe('Connection failed')
      expect(health.checks.database.latency).toBe(-1)  // -1 indicates error
    })

    it('should include pool metrics when provided', async () => {
      const mockPool = {
        getMetrics: () => ({
          total: 10,
          active: 3,
          idle: 7,
          waiting: 0
        })
      }

      const health = await checkDatabaseHealth(db, mockPool as any)

      expect(health.checks.pool).toEqual({
        size: 10,
        active: 3,
        idle: 7,
        waiting: 0
      })
    })
  })

  describe('gracefulShutdown', () => {
    it('should close database connection on shutdown', async () => {
      let destroyed = false
      const mockDb = {
        destroy: async () => {
          destroyed = true
        }
      } as any

      await gracefulShutdown(mockDb)
      expect(destroyed).toBe(true)
    })

    it('should handle shutdown errors gracefully', async () => {
      const mockDb = {
        destroy: async () => {
          throw new Error('Shutdown failed')
        }
      } as any

      // Should propagate the error
      await expect(gracefulShutdown(mockDb)).rejects.toThrow('Shutdown failed')
    })

    it('should register process handlers', () => {
      const listeners: { [key: string]: Function[] } = {}
      const mockProcess = {
        on: (event: string, handler: Function) => {
          if (!listeners[event]) listeners[event] = []
          listeners[event]!.push(handler)
        },
        exit: (code: number) => {}
      }

      // Mock global process
      const originalProcess = global.process
      global.process = mockProcess as any

      const mockDb = {
        destroy: async () => {}
      } as any

      registerShutdownHandlers(mockDb)

      // Check that handlers were registered
      expect(listeners['SIGTERM']).toBeDefined()
      expect(listeners['SIGINT']).toBeDefined()

      // Restore original process
      global.process = originalProcess
    })
  })

  describe('Health Check Integration', () => {
    it('should work with real database operations', async () => {
      // Perform some operations
      await db
        .insertInto('users')
        .values({ email: 'health@test.com', name: 'Health Test' })
        .execute()

      const health = await checkDatabaseHealth(db)
      expect(health.status).toBe('healthy')

      // Verify database is still working after health check
      const user = await db
        .selectFrom('users')
        .where('email', '=', 'health@test.com')
        .selectAll()
        .executeTakeFirst()

      expect(user).toBeDefined()
      expect(user?.name).toBe('Health Test')
    })

    // Note: Removed transaction test as health checks should not be performed
    // within transactions, as they need their own connection for proper monitoring
  })
})