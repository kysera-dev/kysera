import { describe, it, expect } from 'vitest';
import {
  createEvaluationContext,
  isAsyncFunction,
  safeEvaluate,
  deepMerge,
  hashString,
  normalizeOperations,
} from '../../src/utils/index.js';
import type { RLSContext } from '../../src/policy/types.js';

describe('Utils', () => {
  describe('createEvaluationContext', () => {
    const baseRLSContext: RLSContext = {
      auth: {
        userId: 'user-123',
        roles: ['user', 'editor'],
        tenantId: 'tenant-456',
      },
      timestamp: new Date(),
    };

    it('should create context with auth from RLS context', () => {
      const ctx = createEvaluationContext(baseRLSContext);

      expect(ctx.auth.userId).toBe('user-123');
      expect(ctx.auth.roles).toEqual(['user', 'editor']);
      expect(ctx.auth.tenantId).toBe('tenant-456');
    });

    it('should include row when provided', () => {
      const row = { id: 1, name: 'Test', owner_id: 123 };
      const ctx = createEvaluationContext(baseRLSContext, { row });

      expect(ctx.row).toBe(row);
    });

    it('should include data when provided', () => {
      const data = { title: 'New Post', content: 'Hello' };
      const ctx = createEvaluationContext(baseRLSContext, { data });

      expect(ctx.data).toBe(data);
    });

    it('should include request context when present', () => {
      const rlsCtx: RLSContext = {
        ...baseRLSContext,
        request: {
          requestId: 'req-123',
          ipAddress: '192.168.1.1',
          timestamp: new Date(),
        },
      };

      const ctx = createEvaluationContext(rlsCtx);

      expect(ctx.request?.requestId).toBe('req-123');
      expect(ctx.request?.ipAddress).toBe('192.168.1.1');
    });

    it('should include meta when present', () => {
      const rlsCtx: RLSContext = {
        ...baseRLSContext,
        meta: { featureFlags: ['beta'], region: 'eu' },
      };

      const ctx = createEvaluationContext(rlsCtx);

      expect(ctx.meta).toEqual({ featureFlags: ['beta'], region: 'eu' });
    });

    it('should not include row/data/request/meta when not provided', () => {
      const ctx = createEvaluationContext(baseRLSContext);

      expect(ctx.row).toBeUndefined();
      expect(ctx.data).toBeUndefined();
      expect(ctx.request).toBeUndefined();
      expect(ctx.meta).toBeUndefined();
    });
  });

  describe('isAsyncFunction', () => {
    it('should return true for async functions', () => {
      const asyncFn = async () => {};
      expect(isAsyncFunction(asyncFn)).toBe(true);
    });

    it('should return false for sync functions', () => {
      const syncFn = () => {};
      expect(isAsyncFunction(syncFn)).toBe(false);
    });

    it('should return false for arrow functions', () => {
      const arrowFn = () => {};
      expect(isAsyncFunction(arrowFn)).toBe(false);
    });

    it('should return false for non-functions', () => {
      expect(isAsyncFunction('string')).toBe(false);
      expect(isAsyncFunction(123)).toBe(false);
      expect(isAsyncFunction(null)).toBe(false);
      expect(isAsyncFunction(undefined)).toBe(false);
      expect(isAsyncFunction({})).toBe(false);
    });

    it('should return true for async arrow functions', () => {
      const asyncArrow = async () => 'result';
      expect(isAsyncFunction(asyncArrow)).toBe(true);
    });

    it('should return true for async method', () => {
      const obj = {
        async method() {
          return 'result';
        },
      };
      expect(isAsyncFunction(obj.method)).toBe(true);
    });
  });

  describe('safeEvaluate', () => {
    it('should return result for sync function', async () => {
      const result = await safeEvaluate(() => 'success', 'default');
      expect(result).toBe('success');
    });

    it('should return result for async function', async () => {
      const result = await safeEvaluate(async () => 'async success', 'default');
      expect(result).toBe('async success');
    });

    it('should return default value on sync error', async () => {
      const result = await safeEvaluate(() => {
        throw new Error('Test error');
      }, 'default');
      expect(result).toBe('default');
    });

    it('should return default value on async error', async () => {
      const result = await safeEvaluate(async () => {
        throw new Error('Async error');
      }, 'default');
      expect(result).toBe('default');
    });

    it('should handle false return value', async () => {
      const result = await safeEvaluate(() => false, true);
      expect(result).toBe(false);
    });

    it('should handle null return value', async () => {
      const result = await safeEvaluate(() => null, 'default');
      expect(result).toBeNull();
    });

    it('should handle 0 return value', async () => {
      const result = await safeEvaluate(() => 0, 99);
      expect(result).toBe(0);
    });
  });

  describe('deepMerge', () => {
    it('should merge flat objects', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };
      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should deep merge nested objects', () => {
      const target = { a: 1, nested: { x: 1, y: 2 } };
      const source = { nested: { y: 3, z: 4 } };
      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1, nested: { x: 1, y: 3, z: 4 } });
    });

    it('should not modify original objects', () => {
      const target = { a: 1, nested: { x: 1 } };
      const source = { nested: { y: 2 } };
      const result = deepMerge(target, source);

      expect(target).toEqual({ a: 1, nested: { x: 1 } });
      expect(source).toEqual({ nested: { y: 2 } });
      expect(result).toEqual({ a: 1, nested: { x: 1, y: 2 } });
    });

    it('should replace arrays (not merge)', () => {
      const target = { arr: [1, 2, 3] };
      const source = { arr: [4, 5] };
      const result = deepMerge(target, source);

      expect(result).toEqual({ arr: [4, 5] });
    });

    it('should handle null values in source', () => {
      const target = { a: 1, b: { x: 1 } };
      const source = { b: null as unknown as { x: number } };
      const result = deepMerge(target, source);

      expect(result.b).toBeNull();
    });

    it('should ignore undefined values in source', () => {
      const target = { a: 1, b: 2 };
      const source = { b: undefined };
      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should handle empty objects', () => {
      const target = { a: 1 };
      const source = {};
      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1 });
    });

    it('should deeply merge multiple levels', () => {
      const target = {
        level1: {
          level2: {
            level3: { a: 1, b: 2 },
          },
        },
      };
      const source = {
        level1: {
          level2: {
            level3: { b: 3, c: 4 },
          },
        },
      };
      const result = deepMerge(target, source);

      expect(result.level1.level2.level3).toEqual({ a: 1, b: 3, c: 4 });
    });
  });

  describe('hashString', () => {
    it('should return consistent hash for same string', () => {
      const hash1 = hashString('test');
      const hash2 = hashString('test');

      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different strings', () => {
      const hash1 = hashString('test1');
      const hash2 = hashString('test2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = hashString('');
      expect(hash).toBe('0');
    });

    it('should handle long strings', () => {
      const longString = 'a'.repeat(10000);
      const hash = hashString(longString);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle special characters', () => {
      const hash = hashString('test-with-special_chars!@#$%');
      expect(typeof hash).toBe('string');
    });

    it('should handle unicode characters', () => {
      const hash = hashString('тест 你好 🎉');
      expect(typeof hash).toBe('string');
    });
  });

  describe('normalizeOperations', () => {
    it('should return array for single operation', () => {
      expect(normalizeOperations('read')).toEqual(['read']);
      expect(normalizeOperations('create')).toEqual(['create']);
      expect(normalizeOperations('update')).toEqual(['update']);
      expect(normalizeOperations('delete')).toEqual(['delete']);
    });

    it('should expand "all" to all operations', () => {
      expect(normalizeOperations('all')).toEqual(['read', 'create', 'update', 'delete']);
    });

    it('should return array as-is for array input', () => {
      expect(normalizeOperations(['read', 'update'])).toEqual(['read', 'update']);
    });

    it('should expand "all" in array', () => {
      expect(normalizeOperations(['all'])).toEqual(['read', 'create', 'update', 'delete']);
    });

    it('should expand "all" when mixed with other operations', () => {
      // When 'all' is in the array, should return all operations
      expect(normalizeOperations(['read', 'all'])).toEqual(['read', 'create', 'update', 'delete']);
    });

    it('should handle empty array', () => {
      expect(normalizeOperations([])).toEqual([]);
    });

    it('should preserve order for array input', () => {
      expect(normalizeOperations(['delete', 'read'])).toEqual(['delete', 'read']);
    });
  });
});
