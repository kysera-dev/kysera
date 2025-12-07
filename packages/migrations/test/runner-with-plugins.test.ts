import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import {
  MigrationRunnerWithPlugins,
  createMigrationRunnerWithPlugins,
  createMigration,
  createLoggingPlugin,
  createMetricsPlugin,
  MigrationError,
  type Migration,
  type MigrationPlugin,
  type KyseraLogger,
} from '../src/index.js';
import { safeDbDestroy, safeSqliteClose } from './helpers/cleanup.js';

// Helper to create a test logger that captures output
function createTestLogger(logs: string[]): KyseraLogger {
  return {
    debug: (msg: string) => logs.push(`[debug] ${msg}`),
    info: (msg: string) => logs.push(`[info] ${msg}`),
    warn: (msg: string) => logs.push(`[warn] ${msg}`),
    error: (msg: string) => logs.push(`[error] ${msg}`),
  };
}

describe('MigrationRunnerWithPlugins', () => {
  let db: Kysely<any>;
  let database: Database.Database;

  beforeEach(() => {
    database = new Database(':memory:');
    db = new Kysely({
      dialect: new SqliteDialect({
        database,
      }),
    });
  });

  afterEach(async () => {
    await safeDbDestroy(db);
    safeSqliteClose(database);
  });

  // Helper to create test migrations
  const createTestMigrations = (): Migration[] => [
    createMigration(
      '001_create_users',
      async (db) => {
        await db.schema
          .createTable('users')
          .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
          .addColumn('email', 'text', (col) => col.notNull().unique())
          .execute();
      },
      async (db) => {
        await db.schema.dropTable('users').execute();
      }
    ),
    createMigration(
      '002_create_posts',
      async (db) => {
        await db.schema
          .createTable('posts')
          .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
          .addColumn('title', 'text', (col) => col.notNull())
          .execute();
      },
      async (db) => {
        await db.schema.dropTable('posts').execute();
      }
    ),
  ];

  describe('createMigrationRunnerWithPlugins', () => {
    it('should create a runner with plugins', async () => {
      const migrations = createTestMigrations();
      const plugin = createLoggingPlugin();

      const runner = await createMigrationRunnerWithPlugins(db, migrations, {
        plugins: [plugin],
      });

      expect(runner).toBeInstanceOf(MigrationRunnerWithPlugins);
      expect(runner.getPlugins()).toHaveLength(1);
      expect(runner.getPlugins()[0]?.name).toBe('@kysera/migrations/logging');
    });

    it('should call onInit for all plugins', async () => {
      const migrations = createTestMigrations();
      const onInitCalls: string[] = [];

      const plugin1: MigrationPlugin = {
        name: 'test-plugin-1',
        version: '1.0.0',
        onInit: async () => {
          onInitCalls.push('plugin1');
        },
      };

      const plugin2: MigrationPlugin = {
        name: 'test-plugin-2',
        version: '1.0.0',
        onInit: () => {
          onInitCalls.push('plugin2');
        },
      };

      await createMigrationRunnerWithPlugins(db, migrations, {
        plugins: [plugin1, plugin2],
      });

      expect(onInitCalls).toEqual(['plugin1', 'plugin2']);
    });

    it('should work without plugins', async () => {
      const migrations = createTestMigrations();

      const runner = await createMigrationRunnerWithPlugins(db, migrations);

      expect(runner).toBeInstanceOf(MigrationRunnerWithPlugins);
      expect(runner.getPlugins()).toHaveLength(0);
    });
  });

  describe('Plugin Hooks', () => {
    describe('beforeMigration hook', () => {
      it('should call beforeMigration before each migration', async () => {
        const migrations = createTestMigrations();
        const hookCalls: Array<{ name: string; operation: string }> = [];

        const plugin: MigrationPlugin = {
          name: 'test-plugin',
          version: '1.0.0',
          beforeMigration: async (migration, operation) => {
            hookCalls.push({ name: migration.name, operation });
          },
        };

        const runner = await createMigrationRunnerWithPlugins(db, migrations, {
          plugins: [plugin],
        });

        // Access protected method via subclass
        await (runner as any).runBeforeHooks(migrations[0], 'up');
        await (runner as any).runBeforeHooks(migrations[1], 'up');

        expect(hookCalls).toEqual([
          { name: '001_create_users', operation: 'up' },
          { name: '002_create_posts', operation: 'up' },
        ]);
      });

      it('should call beforeMigration for down operations', async () => {
        const migrations = createTestMigrations();
        const hookCalls: Array<{ name: string; operation: string }> = [];

        const plugin: MigrationPlugin = {
          name: 'test-plugin',
          version: '1.0.0',
          beforeMigration: (migration, operation) => {
            hookCalls.push({ name: migration.name, operation });
          },
        };

        const runner = await createMigrationRunnerWithPlugins(db, migrations, {
          plugins: [plugin],
        });

        await (runner as any).runBeforeHooks(migrations[0], 'down');

        expect(hookCalls).toEqual([{ name: '001_create_users', operation: 'down' }]);
      });
    });

    describe('afterMigration hook', () => {
      it('should call afterMigration with duration after each migration', async () => {
        const migrations = createTestMigrations();
        const hookCalls: Array<{ name: string; operation: string; duration: number }> = [];

        const plugin: MigrationPlugin = {
          name: 'test-plugin',
          version: '1.0.0',
          afterMigration: async (migration, operation, duration) => {
            hookCalls.push({ name: migration.name, operation, duration });
          },
        };

        const runner = await createMigrationRunnerWithPlugins(db, migrations, {
          plugins: [plugin],
        });

        await (runner as any).runAfterHooks(migrations[0], 'up', 100);
        await (runner as any).runAfterHooks(migrations[1], 'up', 200);

        expect(hookCalls).toHaveLength(2);
        expect(hookCalls[0]).toEqual({ name: '001_create_users', operation: 'up', duration: 100 });
        expect(hookCalls[1]).toEqual({ name: '002_create_posts', operation: 'up', duration: 200 });
      });
    });

    describe('onMigrationError hook', () => {
      it('should call onMigrationError when migration fails', async () => {
        const migrations = createTestMigrations();
        const errorCalls: Array<{ name: string; operation: string; error: string }> = [];

        const plugin: MigrationPlugin = {
          name: 'test-plugin',
          version: '1.0.0',
          onMigrationError: async (migration, operation, error) => {
            const message = error instanceof Error ? error.message : String(error);
            errorCalls.push({ name: migration.name, operation, error: message });
          },
        };

        const runner = await createMigrationRunnerWithPlugins(db, migrations, {
          plugins: [plugin],
        });

        const testError = new Error('Test migration error');
        await (runner as any).runErrorHooks(migrations[0], 'up', testError);

        expect(errorCalls).toHaveLength(1);
        expect(errorCalls[0]).toEqual({
          name: '001_create_users',
          operation: 'up',
          error: 'Test migration error',
        });
      });
    });

    describe('Multiple plugins', () => {
      it('should call hooks for all plugins in order', async () => {
        const migrations = createTestMigrations();
        const callOrder: string[] = [];

        const plugin1: MigrationPlugin = {
          name: 'plugin-1',
          version: '1.0.0',
          beforeMigration: () => {
            callOrder.push('plugin1-before');
          },
          afterMigration: () => {
            callOrder.push('plugin1-after');
          },
        };

        const plugin2: MigrationPlugin = {
          name: 'plugin-2',
          version: '1.0.0',
          beforeMigration: () => {
            callOrder.push('plugin2-before');
          },
          afterMigration: () => {
            callOrder.push('plugin2-after');
          },
        };

        const runner = await createMigrationRunnerWithPlugins(db, migrations, {
          plugins: [plugin1, plugin2],
        });

        await (runner as any).runBeforeHooks(migrations[0], 'up');
        await (runner as any).runAfterHooks(migrations[0], 'up', 100);

        expect(callOrder).toEqual(['plugin1-before', 'plugin2-before', 'plugin1-after', 'plugin2-after']);
      });
    });
  });

  describe('Built-in Plugins', () => {
    describe('LoggingPlugin', () => {
      it('should log migration lifecycle events', () => {
        const logs: string[] = [];
        const logger = createTestLogger(logs);
        const plugin = createLoggingPlugin(logger);

        const migration: Migration = { name: 'test_migration', up: async () => {} };

        plugin.beforeMigration?.(migration, 'up');
        plugin.afterMigration?.(migration, 'up', 150);

        expect(logs).toContain('[info] Starting up for test_migration');
        expect(logs).toContain('[info] Completed up for test_migration in 150ms');
      });

      it('should log errors', () => {
        const logs: string[] = [];
        const logger = createTestLogger(logs);
        const plugin = createLoggingPlugin(logger);

        const migration: Migration = { name: 'test_migration', up: async () => {} };
        const error = new Error('Migration failed');

        plugin.onMigrationError?.(migration, 'up', error);

        expect(logs.some((l) => l.includes('Error during up for test_migration'))).toBe(true);
        expect(logs.some((l) => l.includes('Migration failed'))).toBe(true);
      });

      it('should handle non-Error objects in onMigrationError', () => {
        const logs: string[] = [];
        const logger = createTestLogger(logs);
        const plugin = createLoggingPlugin(logger);

        const migration: Migration = { name: 'test_migration', up: async () => {} };

        plugin.onMigrationError?.(migration, 'up', 'string error');

        expect(logs.some((l) => l.includes('string error'))).toBe(true);
      });
    });

    describe('MetricsPlugin', () => {
      it('should collect metrics for successful migrations', () => {
        const plugin = createMetricsPlugin();

        const migration1: Migration = { name: 'migration_1', up: async () => {} };
        const migration2: Migration = { name: 'migration_2', up: async () => {} };

        plugin.afterMigration?.(migration1, 'up', 100);
        plugin.afterMigration?.(migration2, 'up', 200);
        plugin.afterMigration?.(migration1, 'down', 50);

        const metrics = plugin.getMetrics();

        expect(metrics.migrations).toHaveLength(3);
        expect(metrics.migrations).toContainEqual({
          name: 'migration_1',
          operation: 'up',
          duration: 100,
          success: true,
        });
        expect(metrics.migrations).toContainEqual({
          name: 'migration_2',
          operation: 'up',
          duration: 200,
          success: true,
        });
        expect(metrics.migrations).toContainEqual({
          name: 'migration_1',
          operation: 'down',
          duration: 50,
          success: true,
        });
      });

      it('should track failed migrations', () => {
        const plugin = createMetricsPlugin();

        const migration: Migration = { name: 'failed_migration', up: async () => {} };

        plugin.onMigrationError?.(migration, 'up', new Error('Failed'));

        const metrics = plugin.getMetrics();

        expect(metrics.migrations).toHaveLength(1);
        expect(metrics.migrations[0]).toEqual({
          name: 'failed_migration',
          operation: 'up',
          duration: 0,
          success: false,
        });
      });

      it('should return a copy of metrics array', () => {
        const plugin = createMetricsPlugin();

        const migration: Migration = { name: 'test', up: async () => {} };
        plugin.afterMigration?.(migration, 'up', 100);

        const metrics1 = plugin.getMetrics();
        const metrics2 = plugin.getMetrics();

        expect(metrics1.migrations).not.toBe(metrics2.migrations);
        expect(metrics1.migrations).toEqual(metrics2.migrations);
      });
    });
  });

  describe('Transaction Support', () => {
    it('should execute migration in transaction when useTransactions is true', async () => {
      const migrations: Migration[] = [
        createMigration(
          '001_transactional',
          async (db) => {
            await db.schema
              .createTable('test_table')
              .addColumn('id', 'integer', (col) => col.primaryKey())
              .execute();
          },
          async (db) => {
            await db.schema.dropTable('test_table').execute();
          }
        ),
      ];

      const runner = await createMigrationRunnerWithPlugins(db, migrations, {
        useTransactions: true,
      });

      const result = await runner.up();

      expect(result.executed).toHaveLength(1);

      // Verify table was created
      const tables = await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, '=', 'test_table')
        .execute();

      expect(tables).toHaveLength(1);
    });

    it('should rollback transaction on error when useTransactions is true', async () => {
      // First create a table so we can test partial migration failure
      await db.schema
        .createTable('existing_table')
        .addColumn('id', 'integer', (col) => col.primaryKey())
        .execute();

      const migrations: Migration[] = [
        createMigration('001_partial_fail', async (db) => {
          // This will fail because the table already exists
          await db.schema
            .createTable('existing_table')
            .addColumn('id', 'integer', (col) => col.primaryKey())
            .execute();
        }),
      ];

      const runner = await createMigrationRunnerWithPlugins(db, migrations, {
        useTransactions: true,
      });

      await expect(runner.up()).rejects.toThrow();
    });
  });

  describe('stopOnError option', () => {
    it('should stop on first error when stopOnError is true (default)', async () => {
      const migrations: Migration[] = [
        createMigration('001_success', async () => {}),
        createMigration('002_fail', async () => {
          throw new Error('Migration failed');
        }),
        createMigration('003_never_runs', async () => {}),
      ];

      const runner = await createMigrationRunnerWithPlugins(db, migrations, {
        stopOnError: true,
      });

      await expect(runner.up()).rejects.toThrow(MigrationError);

      const executed = await runner.getExecutedMigrations();
      expect(executed).toHaveLength(1);
      expect(executed).toContain('001_success');
    });

    it('should continue on error when stopOnError is false', async () => {
      const executedMigrations: string[] = [];

      const migrations: Migration[] = [
        createMigration('001_success', async () => {
          executedMigrations.push('001');
        }),
        createMigration('002_fail', async () => {
          executedMigrations.push('002_attempted');
          throw new Error('Migration failed');
        }),
        createMigration('003_also_runs', async () => {
          executedMigrations.push('003');
        }),
      ];

      const runner = await createMigrationRunnerWithPlugins(db, migrations, {
        stopOnError: false,
      });

      const result = await runner.up();

      expect(result.failed).toContain('002_fail');
      expect(result.executed).toContain('001_success');
      expect(result.executed).toContain('003_also_runs');
      expect(executedMigrations).toEqual(['001', '002_attempted', '003']);
    });
  });

  describe('getPlugins', () => {
    it('should return a copy of plugins array', async () => {
      const plugin = createLoggingPlugin();
      const runner = await createMigrationRunnerWithPlugins(db, [], {
        plugins: [plugin],
      });

      const plugins1 = runner.getPlugins();
      const plugins2 = runner.getPlugins();

      expect(plugins1).not.toBe(plugins2);
      expect(plugins1).toHaveLength(1);
      expect(plugins1[0]).toBe(plugins2[0]); // Same plugin instance
    });
  });

  describe('Edge Cases', () => {
    it('should handle plugin without any hooks', async () => {
      const plugin: MigrationPlugin = {
        name: 'empty-plugin',
        version: '1.0.0',
      };

      const migrations = createTestMigrations();
      const runner = await createMigrationRunnerWithPlugins(db, migrations, {
        plugins: [plugin],
      });

      // Should not throw
      await (runner as any).runBeforeHooks(migrations[0], 'up');
      await (runner as any).runAfterHooks(migrations[0], 'up', 100);
      await (runner as any).runErrorHooks(migrations[0], 'up', new Error('test'));
    });

    it('should handle async and sync hooks mixed', async () => {
      const callOrder: string[] = [];

      const asyncPlugin: MigrationPlugin = {
        name: 'async-plugin',
        version: '1.0.0',
        beforeMigration: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          callOrder.push('async');
        },
      };

      const syncPlugin: MigrationPlugin = {
        name: 'sync-plugin',
        version: '1.0.0',
        beforeMigration: () => {
          callOrder.push('sync');
        },
      };

      const migrations = createTestMigrations();
      const runner = await createMigrationRunnerWithPlugins(db, migrations, {
        plugins: [asyncPlugin, syncPlugin],
      });

      await (runner as any).runBeforeHooks(migrations[0], 'up');

      expect(callOrder).toEqual(['async', 'sync']);
    });

    it('should handle onInit returning void vs Promise<void>', async () => {
      const initResults: string[] = [];

      const syncInitPlugin: MigrationPlugin = {
        name: 'sync-init',
        version: '1.0.0',
        onInit: () => {
          initResults.push('sync');
        },
      };

      const asyncInitPlugin: MigrationPlugin = {
        name: 'async-init',
        version: '1.0.0',
        onInit: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          initResults.push('async');
        },
      };

      await createMigrationRunnerWithPlugins(db, [], {
        plugins: [syncInitPlugin, asyncInitPlugin],
      });

      expect(initResults).toEqual(['sync', 'async']);
    });
  });
});
