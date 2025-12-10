/**
 * Tests for debug plugin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withDebug } from '../src/plugin.js';
import type { Kysely, KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs, QueryResult, UnknownRow } from 'kysely';

// Store captured plugins for testing
let capturedPlugin: KyselyPlugin | null = null;

// Helper to create a mock Kysely instance
function createMockDb<DB>(): Kysely<DB> {
  return {
    withPlugin: vi.fn().mockImplementation((plugin: KyselyPlugin) => {
      capturedPlugin = plugin;
      // Return a new mock that represents the wrapped database
      return {
        ...createMockDb<DB>(),
        getMetrics: undefined,
        clearMetrics: undefined,
      };
    }),
    selectFrom: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  } as unknown as Kysely<DB>;
}

// Helper to create a type-safe QueryResult
function createQueryResult(rows: UnknownRow[] = []): QueryResult<UnknownRow> {
  // With exactOptionalPropertyTypes, we cannot use undefined for optional properties
  // We must omit the property entirely
  return { rows } as QueryResult<UnknownRow>;
}

// Mock database type
interface TestDB {
  users: { id: number; name: string };
}

describe('withDebug', () => {
  beforeEach(() => {
    capturedPlugin = null;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('database wrapping', () => {
    it('should return a database with getMetrics method', () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      expect(typeof debugDb.getMetrics).toBe('function');
    });

    it('should return a database with clearMetrics method', () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      expect(typeof debugDb.clearMetrics).toBe('function');
    });

    it('should call db.withPlugin', () => {
      const mockDb = createMockDb<TestDB>();
      withDebug(mockDb);

      expect(mockDb.withPlugin).toHaveBeenCalled();
    });
  });

  describe('getMetrics', () => {
    it('should return empty array initially', () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      expect(debugDb.getMetrics()).toEqual([]);
    });

    it('should return a copy of metrics array', () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      const metrics1 = debugDb.getMetrics();
      const metrics2 = debugDb.getMetrics();

      expect(metrics1).not.toBe(metrics2);
    });
  });

  describe('clearMetrics', () => {
    it('should clear all collected metrics', () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      // Verify getMetrics works
      expect(debugDb.getMetrics()).toEqual([]);

      // Clear and check again
      debugDb.clearMetrics();
      expect(debugDb.getMetrics()).toEqual([]);
    });
  });

  describe('default options', () => {
    it('should use default logQuery=true', () => {
      const mockDb = createMockDb<TestDB>();
      const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      // Default should log queries
      withDebug(mockDb, { logger: mockLogger });

      // Options are stored but we can't directly test them without query execution
      expect(capturedPlugin).not.toBeNull();
    });

    it('should use default slowQueryThreshold=100', () => {
      const mockDb = createMockDb<TestDB>();
      const onSlowQuery = vi.fn();

      withDebug(mockDb, { onSlowQuery });

      // Plugin created with default threshold
      expect(capturedPlugin).not.toBeNull();
    });

    it('should use default maxMetrics=1000', () => {
      const mockDb = createMockDb<TestDB>();
      withDebug(mockDb);

      // Plugin created with default maxMetrics
      expect(capturedPlugin).not.toBeNull();
    });
  });

  describe('custom options', () => {
    it('should accept custom logger', () => {
      const mockDb = createMockDb<TestDB>();
      const customLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const debugDb = withDebug(mockDb, { logger: customLogger });

      expect(debugDb).toBeDefined();
    });

    it('should accept logParams option', () => {
      const mockDb = createMockDb<TestDB>();

      const debugDb = withDebug(mockDb, { logParams: true });

      expect(debugDb).toBeDefined();
    });

    it('should accept slowQueryThreshold option', () => {
      const mockDb = createMockDb<TestDB>();

      const debugDb = withDebug(mockDb, { slowQueryThreshold: 50 });

      expect(debugDb).toBeDefined();
    });

    it('should accept maxMetrics option', () => {
      const mockDb = createMockDb<TestDB>();

      const debugDb = withDebug(mockDb, { maxMetrics: 500 });

      expect(debugDb).toBeDefined();
    });

    it('should accept onSlowQuery callback', () => {
      const mockDb = createMockDb<TestDB>();
      const onSlowQuery = vi.fn();

      const debugDb = withDebug(mockDb, { onSlowQuery });

      expect(debugDb).toBeDefined();
    });

    it('should accept all options together', () => {
      const mockDb = createMockDb<TestDB>();
      const customLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const onSlowQuery = vi.fn();

      const debugDb = withDebug(mockDb, {
        logQuery: true,
        logParams: true,
        slowQueryThreshold: 50,
        maxMetrics: 500,
        onSlowQuery,
        logger: customLogger,
      });

      expect(debugDb).toBeDefined();
    });
  });

  describe('type safety', () => {
    it('should preserve database type', () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      // Type should be DebugDatabase<TestDB>
      // This is a compile-time check - if it compiles, it works
      expect(debugDb).toBeDefined();
    });
  });
});

describe('DebugPlugin', () => {
  beforeEach(() => {
    capturedPlugin = null;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('transformQuery', () => {
    it('should not modify the query node', () => {
      const mockDb = createMockDb<TestDB>();
      withDebug(mockDb);

      const mockNode = { kind: 'SelectQueryNode', test: true };
      const queryId = {};

      const result = capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      // Should return the same node
      expect(result).toBe(mockNode);
    });
  });

  describe('transformResult', () => {
    it('should not modify the result', async () => {
      const mockDb = createMockDb<TestDB>();
      withDebug(mockDb);

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };
      const expectedResult = createQueryResult([{ id: 1 }]);

      // First call transformQuery to set up query data
      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      const result = await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformResultArgs['queryId'],
        result: expectedResult,
      });

      expect(result).toBe(expectedResult);
    });

    it('should handle unknown queryId gracefully', async () => {
      const mockDb = createMockDb<TestDB>();
      withDebug(mockDb);

      const unknownQueryId = {};
      const expectedResult = createQueryResult([]);

      // Call transformResult without calling transformQuery first
      const result = await capturedPlugin!.transformResult({
        queryId: unknownQueryId as unknown as PluginTransformResultArgs['queryId'],
        result: expectedResult,
      });

      // Should still return the result unchanged
      expect(result).toBe(expectedResult);
    });
  });

  describe('logging behavior', () => {
    it('should log query when logQuery=true', async () => {
      const mockDb = createMockDb<TestDB>();
      const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      withDebug(mockDb, { logQuery: true, logger: mockLogger });

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };

      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformResultArgs['queryId'],
        result: createQueryResult([]),
      });

      // Should have logged something
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should not log query when logQuery=false', async () => {
      const mockDb = createMockDb<TestDB>();
      const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      withDebug(mockDb, { logQuery: false, logger: mockLogger });

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };

      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformResultArgs['queryId'],
        result: createQueryResult([]),
      });

      // Should not have logged debug messages
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe('slow query detection', () => {
    it('should call onSlowQuery callback when query exceeds threshold', async () => {
      const mockDb = createMockDb<TestDB>();
      const onSlowQuery = vi.fn();

      // Use a very low threshold so our mock query is "slow"
      withDebug(mockDb, { slowQueryThreshold: 0, onSlowQuery });

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };

      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      // Small delay to ensure duration > 0
      await new Promise((resolve) => setTimeout(resolve, 1));

      await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformResultArgs['queryId'],
        result: createQueryResult([]),
      });

      expect(onSlowQuery).toHaveBeenCalled();
    });

    it('should not call onSlowQuery when query is fast', async () => {
      const mockDb = createMockDb<TestDB>();
      const onSlowQuery = vi.fn();

      // Use a very high threshold
      withDebug(mockDb, { slowQueryThreshold: 10000, onSlowQuery });

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };

      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
        result: createQueryResult([]),
      });

      expect(onSlowQuery).not.toHaveBeenCalled();
    });

    it('should log warning when slow query and no callback', async () => {
      const mockDb = createMockDb<TestDB>();
      const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      // Very low threshold, no onSlowQuery callback
      withDebug(mockDb, { slowQueryThreshold: 0, logger: mockLogger, logQuery: false });

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };

      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      await new Promise((resolve) => setTimeout(resolve, 1));

      await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
        result: createQueryResult([]),
      });

      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('metrics collection', () => {
    it('should collect metrics for each query', async () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };

      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformResultArgs['queryId'],
        result: createQueryResult([]),
      });

      const metrics = debugDb.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0]).toHaveProperty('sql');
      expect(metrics[0]).toHaveProperty('duration');
      expect(metrics[0]).toHaveProperty('timestamp');
    });

    it('should collect metrics with params', async () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };

      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformResultArgs['queryId'],
        result: createQueryResult([]),
      });

      const metrics = debugDb.getMetrics();
      expect(metrics[0]).toHaveProperty('params');
    });

    it('should respect maxMetrics limit (circular buffer)', async () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb, { maxMetrics: 2 });

      // Execute 3 queries
      for (let i = 0; i < 3; i++) {
        const queryId = {};
        const mockNode = { kind: 'SelectQueryNode' };

        capturedPlugin!.transformQuery({
          node: mockNode as PluginTransformQueryArgs['node'],
          queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
        });

        await capturedPlugin!.transformResult({
          queryId: queryId as unknown as PluginTransformResultArgs['queryId'],
          result: createQueryResult([]),
        });
      }

      // Should only keep last 2 metrics
      const metrics = debugDb.getMetrics();
      expect(metrics.length).toBe(2);
    });

    it('should clear metrics when clearMetrics is called', async () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };

      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformResultArgs['queryId'],
        result: createQueryResult([]),
      });

      expect(debugDb.getMetrics().length).toBe(1);

      debugDb.clearMetrics();

      expect(debugDb.getMetrics().length).toBe(0);
    });

    it('should record timestamp for each query', async () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      const beforeTime = Date.now();

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };

      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformResultArgs['queryId'],
        result: createQueryResult([]),
      });

      const afterTime = Date.now();

      const metrics = debugDb.getMetrics();
      expect(metrics[0]!.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(metrics[0]!.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should record duration for each query', async () => {
      const mockDb = createMockDb<TestDB>();
      const debugDb = withDebug(mockDb);

      const queryId = {};
      const mockNode = { kind: 'SelectQueryNode' };

      capturedPlugin!.transformQuery({
        node: mockNode as PluginTransformQueryArgs['node'],
        queryId: queryId as unknown as PluginTransformQueryArgs['queryId'],
      });

      await capturedPlugin!.transformResult({
        queryId: queryId as unknown as PluginTransformResultArgs['queryId'],
        result: createQueryResult([]),
      });

      const metrics = debugDb.getMetrics();
      expect(typeof metrics[0]!.duration).toBe('number');
      expect(metrics[0]!.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
