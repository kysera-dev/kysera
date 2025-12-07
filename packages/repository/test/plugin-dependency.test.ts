import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, seedTestData } from './setup/database.js';
import {
  createORM,
  validatePlugins,
  resolvePluginOrder,
  PluginValidationError,
  type Plugin,
} from '../src/plugin.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';

describe('Plugin Dependency Resolution', () => {
  let db: Kysely<TestDatabase>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = createTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup as () => Promise<void>;
    await seedTestData(db);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('validatePlugins', () => {
    it('should pass validation for plugins with no dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'plugin-a', version: '1.0.0' },
        { name: 'plugin-b', version: '1.0.0' },
        { name: 'plugin-c', version: '1.0.0' },
      ];

      expect(() => validatePlugins(plugins)).not.toThrow();
    });

    it('should pass validation for plugins with satisfied dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'base', version: '1.0.0' },
        { name: 'dependent', version: '1.0.0', dependencies: ['base'] },
      ];

      expect(() => validatePlugins(plugins)).not.toThrow();
    });

    it('should throw for duplicate plugin names', () => {
      const plugins: Plugin[] = [
        { name: 'duplicate', version: '1.0.0' },
        { name: 'duplicate', version: '2.0.0' },
      ];

      expect(() => validatePlugins(plugins)).toThrow(PluginValidationError);
      
      try {
        validatePlugins(plugins);
      } catch (e) {
        const error = e as PluginValidationError;
        expect(error.code).toBe('DUPLICATE_NAME');
        expect(error.details.pluginName).toBe('duplicate');
      }
    });

    it('should throw for missing dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'dependent', version: '1.0.0', dependencies: ['missing-plugin'] },
      ];

      expect(() => validatePlugins(plugins)).toThrow(PluginValidationError);
      
      try {
        validatePlugins(plugins);
      } catch (e) {
        const error = e as PluginValidationError;
        expect(error.code).toBe('MISSING_DEPENDENCY');
        expect(error.details.pluginName).toBe('dependent');
        expect(error.details.missingDependency).toBe('missing-plugin');
      }
    });

    it('should throw for conflicting plugins', () => {
      const plugins: Plugin[] = [
        { name: 'plugin-a', version: '1.0.0' },
        { name: 'plugin-b', version: '1.0.0', conflictsWith: ['plugin-a'] },
      ];

      expect(() => validatePlugins(plugins)).toThrow(PluginValidationError);
      
      try {
        validatePlugins(plugins);
      } catch (e) {
        const error = e as PluginValidationError;
        expect(error.code).toBe('CONFLICT');
        expect(error.details.pluginName).toBe('plugin-b');
        expect(error.details.conflictingPlugin).toBe('plugin-a');
      }
    });

    it('should throw for direct circular dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'plugin-a', version: '1.0.0', dependencies: ['plugin-b'] },
        { name: 'plugin-b', version: '1.0.0', dependencies: ['plugin-a'] },
      ];

      expect(() => validatePlugins(plugins)).toThrow(PluginValidationError);
      
      try {
        validatePlugins(plugins);
      } catch (e) {
        const error = e as PluginValidationError;
        expect(error.code).toBe('CIRCULAR_DEPENDENCY');
        expect(error.details.cycle).toBeDefined();
      }
    });

    it('should throw for indirect circular dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'plugin-a', version: '1.0.0', dependencies: ['plugin-b'] },
        { name: 'plugin-b', version: '1.0.0', dependencies: ['plugin-c'] },
        { name: 'plugin-c', version: '1.0.0', dependencies: ['plugin-a'] },
      ];

      expect(() => validatePlugins(plugins)).toThrow(PluginValidationError);
      
      try {
        validatePlugins(plugins);
      } catch (e) {
        const error = e as PluginValidationError;
        expect(error.code).toBe('CIRCULAR_DEPENDENCY');
      }
    });

    it('should not throw for conflict with unregistered plugin', () => {
      const plugins: Plugin[] = [
        { name: 'plugin-a', version: '1.0.0', conflictsWith: ['not-registered'] },
      ];

      // Should not throw because the conflicting plugin is not registered
      expect(() => validatePlugins(plugins)).not.toThrow();
    });
  });

  describe('resolvePluginOrder', () => {
    it('should return empty array for empty input', () => {
      expect(resolvePluginOrder([])).toEqual([]);
    });

    it('should preserve order for plugins without dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'plugin-a', version: '1.0.0' },
        { name: 'plugin-b', version: '1.0.0' },
        { name: 'plugin-c', version: '1.0.0' },
      ];

      const result = resolvePluginOrder(plugins);
      expect(result).toHaveLength(3);
      // All should be present
      expect(result.map(p => p.name)).toContain('plugin-a');
      expect(result.map(p => p.name)).toContain('plugin-b');
      expect(result.map(p => p.name)).toContain('plugin-c');
    });

    it('should order dependencies before dependents', () => {
      const plugins: Plugin[] = [
        { name: 'dependent', version: '1.0.0', dependencies: ['base'] },
        { name: 'base', version: '1.0.0' },
      ];

      const result = resolvePluginOrder(plugins);
      const baseIndex = result.findIndex(p => p.name === 'base');
      const dependentIndex = result.findIndex(p => p.name === 'dependent');

      expect(baseIndex).toBeLessThan(dependentIndex);
    });

    it('should handle complex dependency chains', () => {
      const plugins: Plugin[] = [
        { name: 'level-3', version: '1.0.0', dependencies: ['level-2'] },
        { name: 'level-2', version: '1.0.0', dependencies: ['level-1'] },
        { name: 'level-1', version: '1.0.0', dependencies: ['base'] },
        { name: 'base', version: '1.0.0' },
      ];

      const result = resolvePluginOrder(plugins);
      const order = result.map(p => p.name);

      expect(order.indexOf('base')).toBeLessThan(order.indexOf('level-1'));
      expect(order.indexOf('level-1')).toBeLessThan(order.indexOf('level-2'));
      expect(order.indexOf('level-2')).toBeLessThan(order.indexOf('level-3'));
    });

    it('should handle diamond dependencies', () => {
      // Diamond: base -> [left, right] -> top
      const plugins: Plugin[] = [
        { name: 'top', version: '1.0.0', dependencies: ['left', 'right'] },
        { name: 'left', version: '1.0.0', dependencies: ['base'] },
        { name: 'right', version: '1.0.0', dependencies: ['base'] },
        { name: 'base', version: '1.0.0' },
      ];

      const result = resolvePluginOrder(plugins);
      const order = result.map(p => p.name);

      // base must come before left and right
      expect(order.indexOf('base')).toBeLessThan(order.indexOf('left'));
      expect(order.indexOf('base')).toBeLessThan(order.indexOf('right'));
      // left and right must come before top
      expect(order.indexOf('left')).toBeLessThan(order.indexOf('top'));
      expect(order.indexOf('right')).toBeLessThan(order.indexOf('top'));
    });

    it('should respect priority within dependency groups', () => {
      const plugins: Plugin[] = [
        { name: 'low-priority', version: '1.0.0', priority: 1 },
        { name: 'high-priority', version: '1.0.0', priority: 10 },
        { name: 'medium-priority', version: '1.0.0', priority: 5 },
      ];

      const result = resolvePluginOrder(plugins);
      const order = result.map(p => p.name);

      // Higher priority should come first
      expect(order.indexOf('high-priority')).toBeLessThan(order.indexOf('medium-priority'));
      expect(order.indexOf('medium-priority')).toBeLessThan(order.indexOf('low-priority'));
    });

    it('should respect priority while honoring dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'high-but-dependent', version: '1.0.0', priority: 100, dependencies: ['low-base'] },
        { name: 'low-base', version: '1.0.0', priority: 1 },
        { name: 'medium-independent', version: '1.0.0', priority: 50 },
      ];

      const result = resolvePluginOrder(plugins);
      const order = result.map(p => p.name);

      // medium-independent has no dependencies and priority 50, should come first among independents
      // low-base has priority 1 but high-but-dependent depends on it
      // Regardless of priority, low-base must come before high-but-dependent
      expect(order.indexOf('low-base')).toBeLessThan(order.indexOf('high-but-dependent'));
      
      // Among independent plugins (low-base and medium-independent), priority matters
      // medium-independent (50) > low-base (1)
      expect(order.indexOf('medium-independent')).toBeLessThan(order.indexOf('low-base'));
    });

    it('should use alphabetical order as tiebreaker', () => {
      const plugins: Plugin[] = [
        { name: 'zebra', version: '1.0.0', priority: 5 },
        { name: 'alpha', version: '1.0.0', priority: 5 },
        { name: 'beta', version: '1.0.0', priority: 5 },
      ];

      const result = resolvePluginOrder(plugins);
      const order = result.map(p => p.name);

      // Same priority, should be alphabetical
      expect(order).toEqual(['alpha', 'beta', 'zebra']);
    });

    it('should handle multiple dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'consumer', version: '1.0.0', dependencies: ['dep-a', 'dep-b', 'dep-c'] },
        { name: 'dep-a', version: '1.0.0' },
        { name: 'dep-b', version: '1.0.0' },
        { name: 'dep-c', version: '1.0.0' },
      ];

      const result = resolvePluginOrder(plugins);
      const consumerIndex = result.findIndex(p => p.name === 'consumer');

      // All dependencies must come before consumer
      expect(result.findIndex(p => p.name === 'dep-a')).toBeLessThan(consumerIndex);
      expect(result.findIndex(p => p.name === 'dep-b')).toBeLessThan(consumerIndex);
      expect(result.findIndex(p => p.name === 'dep-c')).toBeLessThan(consumerIndex);
    });
  });

  describe('createORM with dependency resolution', () => {
    it('should initialize plugins in correct order', async () => {
      const initOrder: string[] = [];

      const plugins: Plugin[] = [
        {
          name: 'dependent',
          version: '1.0.0',
          dependencies: ['base'],
          onInit: () => {
            initOrder.push('dependent');
          },
        },
        {
          name: 'base',
          version: '1.0.0',
          onInit: () => {
            initOrder.push('base');
          },
        },
      ];

      await createORM(db, plugins);

      expect(initOrder).toEqual(['base', 'dependent']);
    });

    it('should reject invalid plugin configurations', async () => {
      const plugins: Plugin[] = [
        { name: 'dependent', version: '1.0.0', dependencies: ['missing'] },
      ];

      await expect(createORM(db, plugins)).rejects.toThrow(PluginValidationError);
    });

    it('should apply interceptors in resolved order', async () => {
      const interceptOrder: string[] = [];

      const plugins: Plugin[] = [
        {
          name: 'second',
          version: '1.0.0',
          dependencies: ['first'],
          interceptQuery: (qb, _ctx) => {
            interceptOrder.push('second');
            return qb;
          },
        },
        {
          name: 'first',
          version: '1.0.0',
          interceptQuery: (qb, _ctx) => {
            interceptOrder.push('first');
            return qb;
          },
        },
      ];

      const orm = await createORM(db, plugins);
      orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {});

      expect(interceptOrder).toEqual(['first', 'second']);
    });

    it('should extend repositories in resolved order', async () => {
      const extendOrder: string[] = [];

      const plugins: Plugin[] = [
        {
          name: 'extension-b',
          version: '1.0.0',
          dependencies: ['extension-a'],
          extendRepository: (repo) => {
            extendOrder.push('extension-b');
            return { ...repo, methodB: () => 'B' };
          },
        },
        {
          name: 'extension-a',
          version: '1.0.0',
          extendRepository: (repo) => {
            extendOrder.push('extension-a');
            return { ...repo, methodA: () => 'A' };
          },
        },
      ];

      const orm = await createORM(db, plugins);
      orm.createRepository(() => ({ base: () => 'base' }));

      expect(extendOrder).toEqual(['extension-a', 'extension-b']);
    });

    it('should expose resolved plugins array', async () => {
      const plugins: Plugin[] = [
        { name: 'z-plugin', version: '1.0.0', priority: 1 },
        { name: 'a-plugin', version: '1.0.0', priority: 10 },
      ];

      const orm = await createORM(db, plugins);

      // Higher priority first
      expect(orm.plugins[0].name).toBe('a-plugin');
      expect(orm.plugins[1].name).toBe('z-plugin');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle logging plugin that must run first', async () => {
      const logs: string[] = [];

      const loggingPlugin: Plugin = {
        name: 'logging',
        version: '1.0.0',
        priority: 100, // High priority to run first
        interceptQuery: (qb, ctx) => {
          logs.push(`[LOG] ${ctx.operation} on ${ctx.table}`);
          return qb;
        },
      };

      const filterPlugin: Plugin = {
        name: 'soft-delete-filter',
        version: '1.0.0',
        priority: 50,
        interceptQuery: (qb, ctx) => {
          logs.push(`[FILTER] Applied soft delete filter`);
          if (ctx.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null);
          }
          return qb;
        },
      };

      const orm = await createORM(db, [filterPlugin, loggingPlugin]);
      await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      // Logging should run first (higher priority)
      expect(logs[0]).toContain('[LOG]');
      expect(logs[1]).toContain('[FILTER]');
    });

    it('should handle auth plugin depending on session plugin', async () => {
      const initOrder: string[] = [];
      let sessionData: { userId?: number } = {};

      const sessionPlugin: Plugin = {
        name: 'session',
        version: '1.0.0',
        onInit: () => {
          initOrder.push('session');
          sessionData = { userId: 1 };
        },
      };

      const authPlugin: Plugin = {
        name: 'auth',
        version: '1.0.0',
        dependencies: ['session'],
        onInit: () => {
          initOrder.push('auth');
          // Auth plugin can now access session data
          expect(sessionData.userId).toBe(1);
        },
        interceptQuery: (qb, ctx) => {
          if (ctx.operation === 'select' && sessionData.userId) {
            ctx.metadata['userId'] = sessionData.userId;
          }
          return qb;
        },
      };

      await createORM(db, [authPlugin, sessionPlugin]);

      expect(initOrder).toEqual(['session', 'auth']);
    });

    it('should prevent conflicting cache implementations', async () => {
      const redisCache: Plugin = {
        name: 'redis-cache',
        version: '1.0.0',
        conflictsWith: ['memory-cache'],
      };

      const memoryCache: Plugin = {
        name: 'memory-cache',
        version: '1.0.0',
        conflictsWith: ['redis-cache'],
      };

      await expect(createORM(db, [redisCache, memoryCache])).rejects.toThrow(PluginValidationError);
    });
  });

  describe('Edge cases', () => {
    it('should handle self-dependency gracefully', async () => {
      const plugins: Plugin[] = [
        { name: 'self-ref', version: '1.0.0', dependencies: ['self-ref'] },
      ];

      await expect(createORM(db, plugins)).rejects.toThrow(PluginValidationError);
    });

    it('should handle empty dependencies array', async () => {
      const plugins: Plugin[] = [
        { name: 'plugin', version: '1.0.0', dependencies: [] },
      ];

      const orm = await createORM(db, plugins);
      expect(orm.plugins).toHaveLength(1);
    });

    it('should handle undefined priority as 0', async () => {
      const plugins: Plugin[] = [
        { name: 'explicit-zero', version: '1.0.0', priority: 0 },
        { name: 'undefined-priority', version: '1.0.0' }, // priority undefined
        { name: 'positive', version: '1.0.0', priority: 1 },
      ];

      const result = resolvePluginOrder(plugins);
      const order = result.map(p => p.name);

      // positive (1) > explicit-zero (0) = undefined-priority (0, alphabetically after e)
      expect(order[0]).toBe('positive');
      // For equal priority, alphabetical: 'explicit-zero' < 'undefined-priority'
      expect(order[1]).toBe('explicit-zero');
      expect(order[2]).toBe('undefined-priority');
    });

    it('should handle negative priorities', async () => {
      const plugins: Plugin[] = [
        { name: 'last', version: '1.0.0', priority: -100 },
        { name: 'normal', version: '1.0.0', priority: 0 },
        { name: 'first', version: '1.0.0', priority: 100 },
      ];

      const result = resolvePluginOrder(plugins);
      const order = result.map(p => p.name);

      expect(order).toEqual(['first', 'normal', 'last']);
    });
  });
});
