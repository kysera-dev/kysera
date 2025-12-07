import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Cache, ConfigCache, QueryCache, SchemaCache, ConnectionPool, CacheManager } from '@/utils/cache';

// Mock the global-options module
vi.mock('@/utils/global-options', () => ({
  verbose: vi.fn(),
}));

// Use real crypto module - we need actual hash computation for cache key tests

describe('Cache', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    cache = new Cache<string>({ maxSize: 3, defaultTTL: 1000 });
  });

  describe('constructor', () => {
    it('should use default options when none provided', () => {
      const defaultCache = new Cache<string>();
      const stats = defaultCache.getStats();
      expect(stats.maxSize).toBe(100);
    });

    it('should accept custom maxSize and defaultTTL', () => {
      const customCache = new Cache<string>({ maxSize: 50, defaultTTL: 10000 });
      const stats = customCache.getStats();
      expect(stats.maxSize).toBe(50);
    });
  });

  describe('get/set', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should return undefined for expired entries', async () => {
      // Create cache with very short TTL
      const shortTTLCache = new Cache<string>({ defaultTTL: 1 });
      shortTTLCache.set('key1', 'value1');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(shortTTLCache.get('key1')).toBeUndefined();
    });

    it('should allow custom TTL per entry', async () => {
      cache.set('key1', 'value1', 1); // 1ms TTL
      cache.set('key2', 'value2', 10000); // 10s TTL

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe('value2');
    });

    it('should update existing entries', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'updated');
      expect(cache.get('key1')).toBe('updated');
    });

    it('should track hits correctly', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key1');
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(3);
    });

    it('should track misses correctly', () => {
      cache.get('nonexistent1');
      cache.get('nonexistent2');

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when at capacity', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1 to make it recently used
      cache.get('key1');
      cache.get('key1');

      // Adding new entry should evict least recently used (key2 or key3)
      cache.set('key4', 'value4');

      const stats = cache.getStats();
      expect(stats.size).toBe(3);

      // key1 should still exist (was accessed)
      expect(cache.get('key1')).toBe('value1');
    });

    it('should not evict when updating existing key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Update existing key should not trigger eviction
      cache.set('key1', 'updated');

      expect(cache.getStats().size).toBe(3);
      expect(cache.get('key1')).toBe('updated');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });
  });

  describe('delete', () => {
    it('should delete existing entries', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should return false for non-existent entries', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();

      expect(cache.getStats().size).toBe(0);
      expect(cache.get('key1')).toBeUndefined();
    });
  });

  describe('getOrCompute', () => {
    it('should return cached value on hit', async () => {
      cache.set('key1', 'cached');
      const compute = vi.fn(() => Promise.resolve('computed'));

      const result = await cache.getOrCompute('key1', compute);

      expect(result).toBe('cached');
      expect(compute).not.toHaveBeenCalled();
    });

    it('should compute and cache value on miss', async () => {
      const compute = vi.fn(() => Promise.resolve('computed'));

      const result = await cache.getOrCompute('key1', compute);

      expect(result).toBe('computed');
      expect(compute).toHaveBeenCalledTimes(1);
      expect(cache.get('key1')).toBe('computed');
    });

    it('should use custom TTL when provided', async () => {
      const compute = vi.fn(() => Promise.resolve('computed'));

      await cache.getOrCompute('key1', compute, 1); // 1ms TTL
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(cache.get('key1')).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.get('key1');
      cache.get('nonexistent');

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(3);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.entries).toHaveLength(2);
    });

    it('should return 0 hit rate when no accesses', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('should include entry details', () => {
      cache.set('key1', 'value1');

      const stats = cache.getStats();
      const entry = stats.entries[0];

      expect(entry.key).toBe('key1');
      expect(entry.hits).toBe(0);
      expect(entry.age).toBeGreaterThanOrEqual(0);
      expect(entry.ttl).toBeGreaterThan(0);
    });
  });
});

describe('ConfigCache', () => {
  beforeEach(() => {
    ConfigCache.clear();
  });

  describe('get/set', () => {
    it('should store and retrieve configurations', () => {
      const config = { database: 'postgres', host: 'localhost' };
      ConfigCache.set('/path/to/config', config);
      expect(ConfigCache.get('/path/to/config')).toEqual(config);
    });

    it('should return undefined for non-existent paths', () => {
      expect(ConfigCache.get('/nonexistent')).toBeUndefined();
    });
  });

  describe('load', () => {
    it('should load and cache configuration', async () => {
      const loader = vi.fn(() => Promise.resolve({ key: 'value' }));

      const result = await ConfigCache.load('/path/to/config', loader);

      expect(result).toEqual({ key: 'value' });
      expect(loader).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2 = await ConfigCache.load('/path/to/config', loader);
      expect(result2).toEqual({ key: 'value' });
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('should clear all cached configurations', () => {
      ConfigCache.set('/path1', { a: 1 });
      ConfigCache.set('/path2', { b: 2 });
      ConfigCache.clear();

      expect(ConfigCache.get('/path1')).toBeUndefined();
      expect(ConfigCache.get('/path2')).toBeUndefined();
    });
  });
});

describe('QueryCache', () => {
  beforeEach(() => {
    QueryCache.clear();
  });

  describe('createKey', () => {
    it('should create consistent hash keys', () => {
      const key1 = QueryCache.createKey('SELECT * FROM users', [1, 2]);
      const key2 = QueryCache.createKey('SELECT * FROM users', [1, 2]);
      expect(key1).toBe(key2);
    });

    it('should handle queries without params', () => {
      const key = QueryCache.createKey('SELECT * FROM users');
      expect(key).toBeDefined();
    });
  });

  describe('get/set', () => {
    it('should store and retrieve query results', () => {
      const result = [{ id: 1, name: 'Test' }];
      QueryCache.set('SELECT * FROM users', result);
      expect(QueryCache.get('SELECT * FROM users')).toEqual(result);
    });

    it('should handle queries with params', () => {
      const result = [{ id: 1 }];
      QueryCache.set('SELECT * FROM users WHERE id = ?', result, [1]);
      expect(QueryCache.get('SELECT * FROM users WHERE id = ?', [1])).toEqual(result);
    });

    it('should allow custom TTL', async () => {
      const result = [{ id: 1 }];
      QueryCache.set('SELECT 1', result, undefined, 1); // 1ms TTL

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(QueryCache.get('SELECT 1')).toBeUndefined();
    });
  });

  describe('execute', () => {
    it('should cache query results', async () => {
      const executor = vi.fn(() => Promise.resolve([{ id: 1 }]));

      const result1 = await QueryCache.execute('SELECT * FROM users', executor);
      const result2 = await QueryCache.execute('SELECT * FROM users', executor);

      expect(result1).toEqual([{ id: 1 }]);
      expect(result2).toEqual([{ id: 1 }]);
      expect(executor).toHaveBeenCalledTimes(1);
    });

    it('should skip cache when requested', async () => {
      const executor = vi.fn(() => Promise.resolve([{ id: 1 }]));

      await QueryCache.execute('SELECT * FROM users', executor, { skipCache: true });
      await QueryCache.execute('SELECT * FROM users', executor, { skipCache: true });

      expect(executor).toHaveBeenCalledTimes(2);
    });

    it('should use custom TTL', async () => {
      const executor = vi.fn(() => Promise.resolve([{ id: 1 }]));

      await QueryCache.execute('SELECT 1', executor, { ttl: 1 });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await QueryCache.execute('SELECT 1', executor);

      expect(executor).toHaveBeenCalledTimes(2);
    });

    it('should handle params in cache key', async () => {
      const executor1 = vi.fn(() => Promise.resolve([{ id: 1 }]));
      const executor2 = vi.fn(() => Promise.resolve([{ id: 2 }]));

      await QueryCache.execute('SELECT * FROM users WHERE id = ?', executor1, { params: [1] });
      await QueryCache.execute('SELECT * FROM users WHERE id = ?', executor2, { params: [2] });

      expect(executor1).toHaveBeenCalledTimes(1);
      expect(executor2).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      // Note: Stats accumulate across tests due to static cache
      // We test the structure and relative changes instead
      const statsBefore = QueryCache.getStats();
      const hitsBefore = statsBefore.hits;
      const missesBefore = statsBefore.misses;

      QueryCache.set('query-stats-test', []);
      QueryCache.get('query-stats-test');
      QueryCache.get('nonexistent-stats-test');

      const statsAfter = QueryCache.getStats();
      expect(statsAfter.hits).toBe(hitsBefore + 1);
      expect(statsAfter.misses).toBe(missesBefore + 1);
    });
  });
});

describe('SchemaCache', () => {
  beforeEach(() => {
    SchemaCache.clear();
  });

  describe('get/set', () => {
    it('should store and retrieve schemas', () => {
      const schema = { tables: ['users', 'posts'] };
      SchemaCache.set('mydb', schema);
      expect(SchemaCache.get('mydb')).toEqual(schema);
    });
  });

  describe('load', () => {
    it('should load and cache schema', async () => {
      const loader = vi.fn(() => Promise.resolve({ tables: ['users'] }));

      const result = await SchemaCache.load('mydb', loader);

      expect(result).toEqual({ tables: ['users'] });
      expect(loader).toHaveBeenCalledTimes(1);

      // Second call uses cache
      await SchemaCache.load('mydb', loader);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidate', () => {
    it('should invalidate specific database schema', () => {
      SchemaCache.set('db1', { tables: ['a'] });
      SchemaCache.set('db2', { tables: ['b'] });

      SchemaCache.invalidate('db1');

      expect(SchemaCache.get('db1')).toBeUndefined();
      expect(SchemaCache.get('db2')).toEqual({ tables: ['b'] });
    });
  });

  describe('clear', () => {
    it('should clear all schemas', () => {
      SchemaCache.set('db1', {});
      SchemaCache.set('db2', {});
      SchemaCache.clear();

      expect(SchemaCache.get('db1')).toBeUndefined();
      expect(SchemaCache.get('db2')).toBeUndefined();
    });
  });
});

describe('ConnectionPool', () => {
  let mockDb: any;

  beforeEach(async () => {
    await ConnectionPool.closeAll();
    mockDb = {
      destroy: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(async () => {
    await ConnectionPool.closeAll();
  });

  describe('get', () => {
    it('should create new connection', async () => {
      const factory = vi.fn().mockResolvedValue(mockDb);

      const result = await ConnectionPool.get('test-conn', factory);

      expect(result).toBe(mockDb);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should reuse existing connection', async () => {
      const factory = vi.fn().mockResolvedValue(mockDb);

      await ConnectionPool.get('test-conn', factory);
      await ConnectionPool.get('test-conn', factory);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should increment refs on reuse', async () => {
      const factory = vi.fn().mockResolvedValue(mockDb);

      await ConnectionPool.get('test-conn', factory);
      await ConnectionPool.get('test-conn', factory);

      const stats = ConnectionPool.getStats();
      const conn = stats.connections.find((c) => c.key === 'test-conn');
      expect(conn?.refs).toBe(2);
    });
  });

  describe('release', () => {
    it('should decrement refs', async () => {
      const factory = vi.fn().mockResolvedValue(mockDb);

      await ConnectionPool.get('test-conn', factory);
      await ConnectionPool.get('test-conn', factory);

      ConnectionPool.release('test-conn');

      const stats = ConnectionPool.getStats();
      const conn = stats.connections.find((c) => c.key === 'test-conn');
      expect(conn?.refs).toBe(1);
    });

    it('should handle release of non-existent connection', () => {
      // Should not throw
      expect(() => ConnectionPool.release('nonexistent')).not.toThrow();
    });
  });

  describe('close', () => {
    it('should close specific connection', async () => {
      const factory = vi.fn().mockResolvedValue(mockDb);

      await ConnectionPool.get('test-conn', factory);
      await ConnectionPool.close('test-conn');

      expect(mockDb.destroy).toHaveBeenCalled();
      expect(ConnectionPool.getStats().size).toBe(0);
    });

    it('should handle closing non-existent connection', async () => {
      // Should not throw
      await expect(ConnectionPool.close('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('closeAll', () => {
    it('should close all connections', async () => {
      const mockDb2 = { destroy: vi.fn().mockResolvedValue(undefined) };

      await ConnectionPool.get('conn1', vi.fn().mockResolvedValue(mockDb));
      await ConnectionPool.get('conn2', vi.fn().mockResolvedValue(mockDb2));

      await ConnectionPool.closeAll();

      expect(mockDb.destroy).toHaveBeenCalled();
      expect(mockDb2.destroy).toHaveBeenCalled();
      expect(ConnectionPool.getStats().size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return pool statistics', async () => {
      const factory = vi.fn().mockResolvedValue(mockDb);

      await ConnectionPool.get('test-conn', factory);

      const stats = ConnectionPool.getStats();

      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(10);
      expect(stats.connections).toHaveLength(1);
      expect(stats.connections[0].key).toBe('test-conn');
      expect(stats.connections[0].refs).toBe(1);
    });
  });
});

describe('CacheManager', () => {
  beforeEach(() => {
    ConfigCache.clear();
    QueryCache.clear();
    SchemaCache.clear();
  });

  describe('clearAll', () => {
    it('should clear all caches', () => {
      ConfigCache.set('/path', { key: 'value' });
      QueryCache.set('SELECT 1', []);
      SchemaCache.set('db', { tables: [] });

      CacheManager.clearAll();

      expect(ConfigCache.get('/path')).toBeUndefined();
      expect(QueryCache.get('SELECT 1')).toBeUndefined();
      expect(SchemaCache.get('db')).toBeUndefined();
    });
  });

  describe('getAllStats', () => {
    it('should return statistics for all caches', () => {
      const stats = CacheManager.getAllStats();

      expect(stats).toHaveProperty('config');
      expect(stats).toHaveProperty('query');
      expect(stats).toHaveProperty('schema');
      expect(stats).toHaveProperty('connections');
    });
  });

  describe('printStats', () => {
    it('should print cache statistics', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      CacheManager.printStats();

      expect(consoleSpy).toHaveBeenCalled();
      const allCalls = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allCalls).toContain('Cache Statistics');
      expect(allCalls).toContain('Config Cache');
      expect(allCalls).toContain('Query Cache');
      expect(allCalls).toContain('Schema Cache');
      expect(allCalls).toContain('Connection Pool');

      consoleSpy.mockRestore();
    });
  });

  describe('setupCleanup', () => {
    it('should setup process event handlers', () => {
      const onSpy = vi.spyOn(process, 'on');

      CacheManager.setupCleanup();

      expect(onSpy).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

      onSpy.mockRestore();
    });
  });
});
