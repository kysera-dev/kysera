import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import BetterSqlite3 from 'better-sqlite3';
import {
  createExecutor,
  createExecutorSync,
  isKyseraExecutor,
  getPlugins,
  getRawDb,
  validatePlugins,
  resolvePluginOrder,
  PluginValidationError,
  applyPlugins,
  wrapTransaction,
  type Plugin,
  type QueryBuilderContext,
  type KyseraExecutor,
} from '../src/index.js';

interface TestDatabase {
  users: {
    id: number;
    name: string;
    tenant_id: number;
    deleted_at: string | null;
  };
  posts: {
    id: number;
    title: string;
    user_id: number;
  };
}

describe('@kysera/executor', () => {
  let db: Kysely<TestDatabase>;

  beforeEach(() => {
    const sqlite = new BetterSqlite3(':memory:');
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({ database: sqlite }),
    });

    // Create tables
    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        tenant_id INTEGER NOT NULL,
        deleted_at TEXT
      )
    `);
    sqlite.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        user_id INTEGER NOT NULL
      )
    `);

    // Insert test data
    sqlite.exec(`INSERT INTO users (id, name, tenant_id, deleted_at) VALUES (1, 'Alice', 1, NULL)`);
    sqlite.exec(`INSERT INTO users (id, name, tenant_id, deleted_at) VALUES (2, 'Bob', 1, '2024-01-01')`);
    sqlite.exec(`INSERT INTO users (id, name, tenant_id, deleted_at) VALUES (3, 'Charlie', 2, NULL)`);
  });

  describe('createExecutor', () => {
    it('creates executor without plugins (zero overhead)', async () => {
      const executor = await createExecutor(db, []);

      expect(isKyseraExecutor(executor)).toBe(true);
      expect(getPlugins(executor)).toEqual([]);

      // Should work normally
      const users = await executor.selectFrom('users').selectAll().execute();
      expect(users).toHaveLength(3);
    });

    it('creates executor with interceptor plugin', async () => {
      const softDeletePlugin: Plugin = {
        name: 'soft-delete',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB;
          }
          return qb;
        },
      };

      const executor = await createExecutor(db, [softDeletePlugin]);

      expect(isKyseraExecutor(executor)).toBe(true);
      expect(getPlugins(executor)).toHaveLength(1);

      // Should filter deleted records
      const users = await executor.selectFrom('users').selectAll().execute();
      expect(users).toHaveLength(2);
      expect(users.every((u) => u.deleted_at === null)).toBe(true);
    });

    it('calls onInit for each plugin', async () => {
      const onInit = vi.fn();
      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        onInit,
      };

      await createExecutor(db, [plugin]);

      expect(onInit).toHaveBeenCalledTimes(1);
      expect(onInit).toHaveBeenCalledWith(db);
    });

    it('applies multiple plugins in order', async () => {
      const calls: string[] = [];

      const plugin1: Plugin = {
        name: 'plugin1',
        version: '1.0.0',
        priority: 10,
        interceptQuery<QB>(qb: QB): QB {
          calls.push('plugin1');
          return qb;
        },
      };

      const plugin2: Plugin = {
        name: 'plugin2',
        version: '1.0.0',
        priority: 5,
        interceptQuery<QB>(qb: QB): QB {
          calls.push('plugin2');
          return qb;
        },
      };

      const executor = await createExecutor(db, [plugin2, plugin1]);

      await executor.selectFrom('users').selectAll().execute();

      // Higher priority runs first
      expect(calls).toEqual(['plugin1', 'plugin2']);
    });
  });

  describe('createExecutorSync', () => {
    it('creates executor synchronously', () => {
      const executor = createExecutorSync(db, []);

      expect(isKyseraExecutor(executor)).toBe(true);
    });
  });

  describe('transactions', () => {
    it('wraps transactions with plugins', async () => {
      let interceptCalled = false;

      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          interceptCalled = true;
          return qb;
        },
      };

      const executor = await createExecutor(db, [plugin]);

      await executor.transaction().execute(async (trx) => {
        interceptCalled = false;
        await trx.selectFrom('users').selectAll().execute();
        expect(interceptCalled).toBe(true);
      });
    });
  });

  describe('validatePlugins', () => {
    it('throws on duplicate plugin names', () => {
      const plugins: Plugin[] = [
        { name: 'test', version: '1.0.0' },
        { name: 'test', version: '2.0.0' },
      ];

      expect(() => validatePlugins(plugins)).toThrow(PluginValidationError);
      expect(() => validatePlugins(plugins)).toThrow('Duplicate plugin');
    });

    it('throws on missing dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'test', version: '1.0.0', dependencies: ['missing'] },
      ];

      expect(() => validatePlugins(plugins)).toThrow(PluginValidationError);
      expect(() => validatePlugins(plugins)).toThrow('requires "missing"');
    });

    it('throws on conflicts', () => {
      const plugins: Plugin[] = [
        { name: 'plugin1', version: '1.0.0', conflictsWith: ['plugin2'] },
        { name: 'plugin2', version: '1.0.0' },
      ];

      expect(() => validatePlugins(plugins)).toThrow(PluginValidationError);
      expect(() => validatePlugins(plugins)).toThrow('conflicts with');
    });

    it('throws on circular dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'a', version: '1.0.0', dependencies: ['b'] },
        { name: 'b', version: '1.0.0', dependencies: ['c'] },
        { name: 'c', version: '1.0.0', dependencies: ['a'] },
      ];

      expect(() => validatePlugins(plugins)).toThrow(PluginValidationError);
      expect(() => validatePlugins(plugins)).toThrow('Circular dependency');
    });
  });

  describe('resolvePluginOrder', () => {
    it('sorts by priority (higher first)', () => {
      const plugins: Plugin[] = [
        { name: 'low', version: '1.0.0', priority: 0 },
        { name: 'high', version: '1.0.0', priority: 100 },
        { name: 'medium', version: '1.0.0', priority: 50 },
      ];

      const sorted = resolvePluginOrder(plugins);

      expect(sorted.map((p) => p.name)).toEqual(['high', 'medium', 'low']);
    });

    it('respects dependencies', () => {
      const plugins: Plugin[] = [
        { name: 'child', version: '1.0.0', dependencies: ['parent'] },
        { name: 'parent', version: '1.0.0' },
      ];

      const sorted = resolvePluginOrder(plugins);

      expect(sorted.map((p) => p.name)).toEqual(['parent', 'child']);
    });

    it('sorts alphabetically when priority is equal', () => {
      const plugins: Plugin[] = [
        { name: 'zebra', version: '1.0.0' },
        { name: 'alpha', version: '1.0.0' },
        { name: 'beta', version: '1.0.0' },
      ];

      const sorted = resolvePluginOrder(plugins);

      expect(sorted.map((p) => p.name)).toEqual(['alpha', 'beta', 'zebra']);
    });
  });

  describe('isKyseraExecutor', () => {
    it('returns true for KyseraExecutor', async () => {
      const executor = await createExecutor(db, []);
      expect(isKyseraExecutor(executor)).toBe(true);
    });

    it('returns false for plain Kysely', () => {
      expect(isKyseraExecutor(db)).toBe(false);
    });
  });

  describe('disabled executor', () => {
    it('returns plain db when disabled', async () => {
      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery: vi.fn((qb) => qb),
      };

      const executor = await createExecutor(db, [plugin], { enabled: false });

      await executor.selectFrom('users').selectAll().execute();

      // Plugin should not be called
      expect(plugin.interceptQuery).not.toHaveBeenCalled();
    });
  });

  describe('getRawDb', () => {
    it('returns raw db from KyseraExecutor', async () => {
      const softDeletePlugin: Plugin = {
        name: 'soft-delete',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB;
          }
          return qb;
        },
      };

      const executor = await createExecutor(db, [softDeletePlugin]);

      // Through executor - plugin filters (2 non-deleted)
      const filteredUsers = await executor.selectFrom('users').selectAll().execute();
      expect(filteredUsers).toHaveLength(2);

      // Through rawDb - bypasses plugins (all 3 users)
      const rawDb = getRawDb(executor as unknown as Kysely<TestDatabase>) as unknown as Kysely<TestDatabase>;
      const allUsers = await rawDb.selectFrom('users').selectAll().execute();
      expect(allUsers).toHaveLength(3);
    });

    it('returns same db for plain Kysely', () => {
      const rawDb = getRawDb(db as unknown as Kysely<TestDatabase>) as unknown as Kysely<TestDatabase>;
      expect(rawDb).toBe(db);
    });

    it('returns same db for executor without plugins', async () => {
      const executor = await createExecutor(db, []);
      const rawDb = getRawDb(executor as unknown as Kysely<TestDatabase>) as unknown as Kysely<TestDatabase>;
      expect(rawDb).toBe(db);
    });
  });

  describe('applyPlugins', () => {
    it('applies plugins to query builder manually', () => {
      const calls: string[] = [];

      const plugin1: Plugin = {
        name: 'plugin1',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          calls.push(`plugin1:${context.operation}:${context.table}`);
          return qb;
        },
      };

      const plugin2: Plugin = {
        name: 'plugin2',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          calls.push(`plugin2:${context.operation}:${context.table}`);
          return qb;
        },
      };

      const qb = db.selectFrom('users').selectAll();
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {},
      };

      // Manually apply plugins
      const result = applyPlugins(qb, [plugin1, plugin2], context);

      expect(result).toBe(qb); // Same reference if no modifications
      expect(calls).toEqual(['plugin1:select:users', 'plugin2:select:users']);
    });

    it('applies soft-delete plugin to query builder', async () => {
      const softDeletePlugin: Plugin = {
        name: 'soft-delete',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB;
          }
          return qb;
        },
      };

      const qb = db.selectFrom('users').selectAll();
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {},
      };

      const filteredQb = applyPlugins(qb, [softDeletePlugin], context);
      const users = await filteredQb.execute();

      expect(users).toHaveLength(2);
      expect(users.every((u) => u.deleted_at === null)).toBe(true);
    });

    it('skips plugins without interceptQuery', () => {
      const calls: string[] = [];

      const plugin1: Plugin = {
        name: 'no-intercept',
        version: '1.0.0',
        // No interceptQuery
      };

      const plugin2: Plugin = {
        name: 'with-intercept',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          calls.push('intercepted');
          return qb;
        },
      };

      const qb = db.selectFrom('users').selectAll();
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {},
      };

      applyPlugins(qb, [plugin1, plugin2], context);

      expect(calls).toEqual(['intercepted']);
    });

    it('passes context metadata through plugins', () => {
      let capturedContext: QueryBuilderContext | undefined;

      const plugin: Plugin = {
        name: 'metadata-reader',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          capturedContext = context;
          return qb;
        },
      };

      const qb = db.selectFrom('posts').selectAll();
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'posts',
        metadata: { userId: 123, includeDeleted: false },
      };

      applyPlugins(qb, [plugin], context);

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.operation).toBe('select');
      expect(capturedContext?.table).toBe('posts');
      expect(capturedContext?.metadata).toEqual({ userId: 123, includeDeleted: false });
    });
  });

  describe('method caching', () => {
    it('caches intercepted methods on repeated access', async () => {
      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb;
        },
      };

      const executor = await createExecutor(db, [plugin]);

      // Access selectFrom multiple times - should use cached intercepted method
      const selectFrom1 = executor.selectFrom;
      const selectFrom2 = executor.selectFrom;
      const selectFrom3 = executor.selectFrom;

      // All should be the same function reference (cached)
      expect(selectFrom1).toBe(selectFrom2);
      expect(selectFrom2).toBe(selectFrom3);

      // Same for insertInto
      const insertInto1 = executor.insertInto;
      const insertInto2 = executor.insertInto;
      expect(insertInto1).toBe(insertInto2);

      // Same for updateTable
      const updateTable1 = executor.updateTable;
      const updateTable2 = executor.updateTable;
      expect(updateTable1).toBe(updateTable2);

      // Same for deleteFrom
      const deleteFrom1 = executor.deleteFrom;
      const deleteFrom2 = executor.deleteFrom;
      expect(deleteFrom1).toBe(deleteFrom2);

      // Should still work correctly
      const users = await executor.selectFrom('users').selectAll().execute();
      expect(users).toHaveLength(3);
    });

    it('caches query builder methods on repeated access', async () => {
      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb;
        },
      };

      const executor = await createExecutor(db, [plugin]);

      // Access selectFrom multiple times - should use cached method
      const selectFrom1 = executor.selectFrom;
      const selectFrom2 = executor.selectFrom;

      // Both should be the same function reference (cached)
      expect(selectFrom1).toBe(selectFrom2);

      // Should still work correctly
      const users = await executor.selectFrom('users').selectAll().execute();
      expect(users).toHaveLength(3);
    });

    it('caches transaction method', async () => {
      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb;
        },
      };

      const executor = await createExecutor(db, [plugin]);

      // Access transaction multiple times - should use cached wrapper
      const transaction1 = executor.transaction;
      const transaction2 = executor.transaction;

      expect(transaction1).toBe(transaction2);
    });

    it('caches non-query methods (bound functions)', async () => {
      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb;
        },
      };

      const executor = await createExecutor(db, [plugin]);

      // Access insertInto multiple times
      const insertInto1 = executor.insertInto;
      const insertInto2 = executor.insertInto;

      expect(insertInto1).toBe(insertInto2);

      // Access updateTable multiple times
      const updateTable1 = executor.updateTable;
      const updateTable2 = executor.updateTable;

      expect(updateTable1).toBe(updateTable2);

      // Access deleteFrom multiple times
      const deleteFrom1 = executor.deleteFrom;
      const deleteFrom2 = executor.deleteFrom;

      expect(deleteFrom1).toBe(deleteFrom2);
    });
  });

  describe('proxy has trap', () => {
    it('supports "in" operator for marker properties', async () => {
      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb;
        },
      };

      const executor = await createExecutor(db, [plugin]);

      // Marker properties should be detected
      expect('__kysera' in executor).toBe(true);
      expect('__plugins' in executor).toBe(true);
      expect('__rawDb' in executor).toBe(true);
    });

    it('supports "in" operator for regular properties', async () => {
      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb;
        },
      };

      const executor = await createExecutor(db, [plugin]);

      // Regular Kysely methods should be detected via Reflect.has
      expect('selectFrom' in executor).toBe(true);
      expect('insertInto' in executor).toBe(true);
      expect('transaction' in executor).toBe(true);
      expect('destroy' in executor).toBe(true);

      // Non-existent properties should return false
      expect('nonExistent' in executor).toBe(false);
    });
  });

  describe('non-query method access', () => {
    it('accesses and caches bound function methods through methodCache', async () => {
      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb;
        },
      };

      const executor = await createExecutor(db, [plugin]);

      // Access with method - should be cached (it's a function, not a getter)
      const with1 = executor.with;
      const with2 = executor.with;
      expect(with1).toBe(with2);

      // Access withRecursive method - should be cached
      const withRecursive1 = executor.withRecursive;
      const withRecursive2 = executor.withRecursive;
      expect(withRecursive1).toBe(withRecursive2);

      // Verify they work (they are functions)
      expect(typeof executor.with).toBe('function');
      expect(typeof executor.withRecursive).toBe('function');
    });

    it('returns non-function properties without caching', async () => {
      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          return qb;
        },
      };

      const executor = await createExecutor(db, [plugin]);

      // dynamic is a getter that returns a new object each time
      // It should still be accessible via the proxy
      expect(executor.dynamic).toBeDefined();
      expect(typeof executor.dynamic).toBe('object');
    });
  });

  describe('createExecutorSync with validation', () => {
    it('validates plugins synchronously', () => {
      const plugins: Plugin[] = [
        { name: 'plugin1', version: '1.0.0' },
        { name: 'plugin2', version: '1.0.0' },
      ];

      const executor = createExecutorSync(db, plugins);

      expect(isKyseraExecutor(executor)).toBe(true);
      expect(getPlugins(executor)).toHaveLength(2);
    });

    it('throws on duplicate plugins synchronously', () => {
      const plugins: Plugin[] = [
        { name: 'test', version: '1.0.0' },
        { name: 'test', version: '2.0.0' },
      ];

      expect(() => createExecutorSync(db, plugins)).toThrow(PluginValidationError);
    });

    it('creates executor with plugins without interceptQuery (fast path)', () => {
      const plugins: Plugin[] = [
        { name: 'no-intercept-1', version: '1.0.0' },
        { name: 'no-intercept-2', version: '1.0.0' },
      ];

      const executor = createExecutorSync(db, plugins);

      expect(isKyseraExecutor(executor)).toBe(true);
      expect(getPlugins(executor)).toHaveLength(2);
    });
  });

  describe('wrapTransaction', () => {
    it('wraps transaction with plugins explicitly', async () => {
      const interceptCalls: string[] = [];

      const plugin: Plugin = {
        name: 'test',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          interceptCalls.push(`${context.operation}:${context.table}`);
          return qb;
        },
      };

      await db.transaction().execute(async (trx) => {
        const wrappedTrx = wrapTransaction(trx, [plugin]);

        // Verify it's marked as kysera executor
        expect(isKyseraExecutor(wrappedTrx as unknown as Kysely<TestDatabase>)).toBe(true);
        expect(getPlugins(wrappedTrx as unknown as KyseraExecutor<TestDatabase>)).toEqual([plugin]);

        // Execute queries - should trigger interceptor
        await wrappedTrx.selectFrom('users').selectAll().execute();
        await wrappedTrx.selectFrom('posts').selectAll().execute();
      });

      expect(interceptCalls).toEqual(['select:users', 'select:posts']);
    });

    it('wraps transaction without interceptors (optimization)', async () => {
      const plugin: Plugin = {
        name: 'no-intercept',
        version: '1.0.0',
        // No interceptQuery hook
        onInit: vi.fn(),
      };

      await db.transaction().execute(async (trx) => {
        const wrappedTrx = wrapTransaction(trx, [plugin]);

        expect(isKyseraExecutor(wrappedTrx as unknown as Kysely<TestDatabase>)).toBe(true);
        expect(getPlugins(wrappedTrx as unknown as KyseraExecutor<TestDatabase>)).toEqual([plugin]);

        // Should work without proxy overhead
        const users = await wrappedTrx.selectFrom('users').selectAll().execute();
        expect(users).toHaveLength(3);
      });
    });

    it('applies soft-delete plugin in wrapped transaction', async () => {
      const softDeletePlugin: Plugin = {
        name: 'soft-delete',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null) as QB;
          }
          return qb;
        },
      };

      await db.transaction().execute(async (trx) => {
        const wrappedTrx = wrapTransaction(trx, [softDeletePlugin]);

        // Should filter deleted records
        const users = await wrappedTrx.selectFrom('users').selectAll().execute();
        expect(users).toHaveLength(2);
        expect(users.every((u) => u.deleted_at === null)).toBe(true);

        // getRawDb should bypass filter
        const rawDb = getRawDb(wrappedTrx as unknown as Kysely<TestDatabase>) as unknown as Kysely<TestDatabase>;
        const allUsers = await rawDb.selectFrom('users').selectAll().execute();
        expect(allUsers).toHaveLength(3);
      });
    });

    it('wraps nested transactions', async () => {
      const calls: string[] = [];

      const plugin: Plugin = {
        name: 'tracker',
        version: '1.0.0',
        interceptQuery<QB>(qb: QB): QB {
          calls.push('intercepted');
          return qb;
        },
      };

      await db.transaction().execute(async (outerTrx) => {
        const wrappedOuter = wrapTransaction(outerTrx, [plugin]);

        await wrappedOuter.selectFrom('users').selectAll().execute();
        expect(calls).toHaveLength(1);

        // Note: Kysely doesn't support nested transactions in SQLite
        // This just demonstrates that the wrapper can be applied at any level
      });
    });
  });

});
