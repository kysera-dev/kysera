/**
 * Audit Trail Tests
 *
 * Tests for policy decision logging and audit infrastructure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  AuditLogger,
  createAuditLogger,
  ConsoleAuditAdapter,
  InMemoryAuditAdapter,
  type RLSAuditEvent
} from '../../src/audit/index.js'
import type { RLSContext } from '../../src/policy/types.js'
import { rlsContext } from '../../src/context/manager.js'

// ============================================================================
// Helper Functions
// ============================================================================

function createCtx(overrides: Partial<RLSContext> = {}): RLSContext {
  return {
    auth: {
      userId: '123',
      tenantId: 'tenant-1',
      roles: ['user'],
      isSystem: false
    },
    ...overrides
  }
}

function createEvent(overrides: Partial<RLSAuditEvent> = {}): RLSAuditEvent {
  return {
    timestamp: new Date(),
    userId: '123',
    operation: 'read',
    table: 'users',
    decision: 'allow',
    ...overrides
  }
}

// ============================================================================
// ConsoleAuditAdapter Tests
// ============================================================================

describe('ConsoleAuditAdapter', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe('log', () => {
    it('should write events to console', async () => {
      const adapter = new ConsoleAuditAdapter()
      const event = createEvent()

      await adapter.log(event)

      expect(consoleSpy).toHaveBeenCalled()
    })

    it('should format events as JSON when configured', async () => {
      const adapter = new ConsoleAuditAdapter({ format: 'json' })
      const event = createEvent()

      await adapter.log(event)

      const call = consoleSpy.mock.calls[0]?.[0] as string
      expect(() => JSON.parse(call)).not.toThrow()
    })

    it('should format events as text when configured', async () => {
      const adapter = new ConsoleAuditAdapter({ format: 'text' })
      const event = createEvent({ decision: 'deny', reason: 'No permission' })

      await adapter.log(event)

      const call = consoleSpy.mock.calls[0]?.[0] as string
      expect(call).toContain('DENY')
      expect(call).toContain('No permission')
    })
  })

  describe('logBatch', () => {
    it('should write multiple events', async () => {
      const adapter = new ConsoleAuditAdapter()
      const events = [createEvent(), createEvent({ decision: 'deny' })]

      await adapter.logBatch(events)

      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })
  })
})

// ============================================================================
// InMemoryAuditAdapter Tests
// ============================================================================

describe('InMemoryAuditAdapter', () => {
  let adapter: InMemoryAuditAdapter

  beforeEach(() => {
    adapter = new InMemoryAuditAdapter()
  })

  describe('log', () => {
    it('should store events in memory', async () => {
      await adapter.log(createEvent())
      await adapter.log(createEvent({ decision: 'deny' }))

      expect(adapter.getEvents()).toHaveLength(2)
    })
  })

  describe('logBatch', () => {
    it('should store multiple events', async () => {
      await adapter.logBatch([createEvent(), createEvent()])

      expect(adapter.getEvents()).toHaveLength(2)
    })

    it('should respect maxSize limit', async () => {
      const limitedAdapter = new InMemoryAuditAdapter(3)

      await limitedAdapter.logBatch([
        createEvent({ userId: '1' }),
        createEvent({ userId: '2' }),
        createEvent({ userId: '3' }),
        createEvent({ userId: '4' }),
        createEvent({ userId: '5' })
      ])

      const events = limitedAdapter.getEvents()
      expect(events).toHaveLength(3)
      // Should keep most recent
      expect(events[0]?.userId).toBe('3')
    })
  })

  describe('query', () => {
    beforeEach(async () => {
      await adapter.logBatch([
        createEvent({ userId: '1', decision: 'allow', table: 'users', operation: 'read' }),
        createEvent({ userId: '2', decision: 'deny', table: 'users', operation: 'update' }),
        createEvent({ userId: '1', decision: 'allow', table: 'posts', operation: 'read' }),
        createEvent({ userId: '3', decision: 'deny', table: 'users', operation: 'delete' })
      ])
    })

    it('should filter by userId', () => {
      const events = adapter.query({ userId: '1' })

      expect(events).toHaveLength(2)
      expect(events.every(e => e.userId === '1')).toBe(true)
    })

    it('should filter by decision', () => {
      const events = adapter.query({ decision: 'deny' })

      expect(events).toHaveLength(2)
      expect(events.every(e => e.decision === 'deny')).toBe(true)
    })

    it('should filter by table', () => {
      const events = adapter.query({ table: 'users' })

      expect(events).toHaveLength(3)
    })

    it('should filter by operation', () => {
      const events = adapter.query({ operation: 'read' })

      expect(events).toHaveLength(2)
    })

    it('should support multiple filters', () => {
      const events = adapter.query({
        userId: '1',
        decision: 'allow',
        table: 'users'
      })

      expect(events).toHaveLength(1)
    })

    it('should support pagination', () => {
      const page1 = adapter.query({ limit: 2 })
      const page2 = adapter.query({ limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
      // The events are: ['1', '2', '1', '3'] by userId
      // page1 = ['1', '2'], page2 = ['1', '3']
      // Check that we got different slices
      expect(page1.map(e => e.userId).join(',')).not.toBe(page2.map(e => e.userId).join(','))
    })
  })

  describe('getStats', () => {
    beforeEach(async () => {
      await adapter.logBatch([
        createEvent({ decision: 'allow' }),
        createEvent({ decision: 'allow' }),
        createEvent({ decision: 'deny' }),
        createEvent({ decision: 'filter' })
      ])
    })

    it('should return correct stats', () => {
      const stats = adapter.getStats()

      expect(stats.totalEvents).toBe(4)
      expect(stats.byDecision.allow).toBe(2)
      expect(stats.byDecision.deny).toBe(1)
      expect(stats.byDecision.filter).toBe(1)
    })
  })

  describe('clear', () => {
    it('should remove all events', async () => {
      await adapter.logBatch([createEvent(), createEvent()])
      adapter.clear()

      expect(adapter.getEvents()).toHaveLength(0)
    })
  })
})

// ============================================================================
// AuditLogger Tests
// ============================================================================

describe('AuditLogger', () => {
  let adapter: InMemoryAuditAdapter
  let logger: AuditLogger

  beforeEach(() => {
    adapter = new InMemoryAuditAdapter()
    logger = createAuditLogger({
      adapter,
      bufferSize: 10,
      flushInterval: 0, // disable auto-flush for tests
      async: false,
      defaults: {
        logAllowed: true,  // Enable logging allow events for tests
        logDenied: true,
        logFilters: true   // Enable logging filter events for tests
      }
    })
  })

  afterEach(async () => {
    await logger.close()
  })

  describe('logAllow', () => {
    it('should log allow decisions', async () => {
      const ctx = createCtx()

      // Logger gets context from rlsContext internally
      await rlsContext.run(ctx, async () => {
        await logger.logAllow('read', 'users', 'ownership-allow')
        await logger.flush()
      })

      const events = adapter.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.decision).toBe('allow')
      expect(events[0]?.policyName).toBe('ownership-allow')
    })
  })

  describe('logDeny', () => {
    it('should log deny decisions with reason', async () => {
      const ctx = createCtx()

      // Logger gets context from rlsContext internally
      await rlsContext.run(ctx, async () => {
        await logger.logDeny('delete', 'users', 'ownership-deny', { reason: 'No permission' })
        await logger.flush()
      })

      const events = adapter.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.decision).toBe('deny')
      expect(events[0]?.reason).toBe('No permission')
    })
  })

  describe('logFilter', () => {
    it('should log filter applications', async () => {
      const ctx = createCtx()

      // Logger gets context from rlsContext internally
      await rlsContext.run(ctx, async () => {
        await logger.logFilter('users', 'tenant-filter')
        await logger.flush()
      })

      const events = adapter.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.decision).toBe('filter')
    })
  })

  describe('buffering', () => {
    it('should buffer events until threshold', async () => {
      const smallBufferLogger = createAuditLogger({
        adapter,
        bufferSize: 3,
        flushInterval: 0,
        async: true, // Buffering only works with async: true
        defaults: {
          logAllowed: true,
          logDenied: true,
          logFilters: true
        }
      })

      const ctx = createCtx()

      await rlsContext.run(ctx, async () => {
        await smallBufferLogger.logAllow('read', 'users', 'test')
        await smallBufferLogger.logAllow('read', 'users', 'test')

        // Not flushed yet (buffer size is 3)
        expect(adapter.getEvents()).toHaveLength(0)

        // Third event triggers flush (reaches buffer size)
        await smallBufferLogger.logAllow('read', 'users', 'test')
      })

      expect(adapter.getEvents()).toHaveLength(3)

      await smallBufferLogger.close()
    })

    it('should flush on close', async () => {
      // Create a separate logger for this test to avoid double-close
      const testAdapter = new InMemoryAuditAdapter()
      const testLogger = createAuditLogger({
        adapter: testAdapter,
        bufferSize: 10, // Buffer can hold 10 events
        flushInterval: 0,
        async: true, // Buffering only works with async: true
        defaults: {
          logAllowed: true,
          logDenied: true,
          logFilters: true
        }
      })
      const ctx = createCtx()

      await rlsContext.run(ctx, async () => {
        await testLogger.logAllow('read', 'users', 'test')
      })

      // Events are in buffer (buffer not full)
      expect(testAdapter.getEvents()).toHaveLength(0)

      // close() should flush the buffer
      await testLogger.close()

      expect(testAdapter.getEvents()).toHaveLength(1)
    })
  })

  describe('context enrichment', () => {
    it('should include tenant ID', async () => {
      const ctx = createCtx({
        auth: {
          userId: '123',
          tenantId: 'my-tenant',
          roles: [],
          isSystem: false
        }
      })

      await rlsContext.run(ctx, async () => {
        await logger.logAllow('read', 'users', 'test')
        await logger.flush()
      })

      const events = adapter.getEvents()
      expect(events[0]?.tenantId).toBe('my-tenant')
    })

    it('should include request context when available', async () => {
      const ctx = createCtx({
        request: {
          requestId: 'req-123',
          ipAddress: '192.168.1.1',
          userAgent: 'test-agent'
        }
      })

      await rlsContext.run(ctx, async () => {
        await logger.logAllow('read', 'users', 'test')
        await logger.flush()
      })

      const events = adapter.getEvents()
      expect(events[0]?.requestId).toBe('req-123')
      expect(events[0]?.ipAddress).toBe('192.168.1.1')
      expect(events[0]?.userAgent).toBe('test-agent')
    })
  })
})
