import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect, sql } from 'kysely';
import Database from 'better-sqlite3';
import {
  setupMigrations,
  MigrationRunner,
  createMigrationRunner,
  createMigration,
  createMigrationWithMeta,
  defineMigrations,
  runMigrations,
  rollbackMigrations,
  getMigrationStatus,
  MigrationError,
  createLoggingPlugin,
  createMetricsPlugin,
  
  type Migration,
  type MigrationWithMeta,
  type KyseraLogger,
} from '../src/index.js';

// Helper to create a test logger that captures output
function createTestLogger(logs: string[]): KyseraLogger {
  return {
    debug: (msg: string) => logs.push(msg),
    info: (msg: string) => logs.push(msg),
    warn: (msg: string) => logs.push(msg),
    error: (msg: string) => logs.push(msg),
  };
}
import { safeDbDestroy, safeSqliteClose } from './helpers/cleanup.js';

describe('Migration System', () => {
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
          .addColumn('name', 'text', (col) => col.notNull())
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
          .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id').onDelete('cascade'))
          .addColumn('title', 'text', (col) => col.notNull())
          .addColumn('content', 'text')
          .execute();
      },
      async (db) => {
        await db.schema.dropTable('posts').execute();
      }
    ),
    createMigration(
      '003_add_users_created_at',
      async (db) => {
        await db.schema
          .alterTable('users')
          .addColumn('created_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
          .execute();
      }
      // Note: SQLite doesn't support dropping columns easily
    ),
  ];

  describe('setupMigrations', () => {
    it('should create migrations table', async () => {
      await setupMigrations(db);

      // Verify table exists
      const tables = (await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, '=', 'migrations')
        .execute()) as Array<{ name: string }>;

      expect(tables).toHaveLength(1);
      expect(tables[0]?.name).toBe('migrations');
    });

    it('should be idempotent (can run multiple times)', async () => {
      await setupMigrations(db);
      await setupMigrations(db);
      await setupMigrations(db);

      // Should still have exactly one migrations table
      const tables = await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, '=', 'migrations')
        .execute();

      expect(tables).toHaveLength(1);
    });

    it('should have correct schema', async () => {
      await setupMigrations(db);

      // Insert and retrieve a migration record
      await db
        .insertInto('migrations' as any)
        .values({ name: 'test_migration' } as any)
        .execute();

      const migrations = await db
        .selectFrom('migrations' as any)
        .selectAll()
        .execute();

      expect(migrations).toHaveLength(1);
      expect(migrations[0]).toHaveProperty('name', 'test_migration');
      expect(migrations[0]).toHaveProperty('executed_at');
    });
  });

  describe('MigrationRunner', () => {
    describe('up', () => {
      it('should run all pending migrations', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        const result = await runner.up();

        // Verify migrations were executed
        const executed = await runner.getExecutedMigrations();
        expect(executed).toHaveLength(3);
        expect(executed).toEqual(['001_create_users', '002_create_posts', '003_add_users_created_at']);

        // Verify result object
        expect(result.executed).toHaveLength(3);
        expect(result.dryRun).toBe(false);
        expect(result.duration).toBeGreaterThan(0);

        // Verify tables were created
        const tables = await db
          .selectFrom('sqlite_master' as any)
          .select('name' as any)
          .where('type' as any, '=', 'table')
          .execute();

        const tableNames = tables.map((t: any) => t.name);
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('posts');
      });

      it('should skip already executed migrations', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        // Run migrations first time
        await runner.up();

        // Run again - should skip all
        const result = await runner.up();

        // Should still have exactly 3 migrations
        const executed = await runner.getExecutedMigrations();
        expect(executed).toHaveLength(3);
        expect(result.skipped.length).toBeGreaterThan(0);
      });

      it('should stop on migration failure', async () => {
        const migrations: Migration[] = [
          createMigration('001_success', async () => {}),
          createMigration('002_fail', async () => {
            throw new Error('Migration failed');
          }),
          createMigration('003_never_runs', async () => {}),
        ];

        const runner = new MigrationRunner(db, migrations, { });

        await expect(runner.up()).rejects.toThrow(MigrationError);

        // Only first migration should be executed
        const executed = await runner.getExecutedMigrations();
        expect(executed).toHaveLength(1);
        expect(executed).toEqual(['001_success']);
      });

      it('should work with dry run mode', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, {
          dryRun: true,
          
        });

        const result = await runner.up();

        // Verify result indicates dry run
        expect(result.dryRun).toBe(true);

        // No migrations should actually be executed
        const executed = await runner.getExecutedMigrations();
        expect(executed).toHaveLength(0);

        // Tables should not exist
        const tables = await db
          .selectFrom('sqlite_master' as any)
          .select('name' as any)
          .where('type' as any, '=', 'table')
          .where('name' as any, '=', 'users')
          .execute();

        expect(tables).toHaveLength(0);
      });

      it('should handle empty migration list', async () => {
        const runner = new MigrationRunner(db, [], { });

        const result = await runner.up();

        const executed = await runner.getExecutedMigrations();
        expect(executed).toHaveLength(0);
        expect(result.executed).toHaveLength(0);
      });

      it('should validate duplicate migration names', () => {
        const migrations: Migration[] = [
          createMigration('001_duplicate', async () => {}),
          createMigration('001_duplicate', async () => {}),
        ];

        expect(() => new MigrationRunner(db, migrations)).toThrow('Duplicate migration name: 001_duplicate');
      });
    });

    describe('down', () => {
      it('should rollback last migration', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        // Run all migrations
        await runner.up();

        // Rollback last one - note: 003 has no down(), so it won't be rolled back
        const result = await runner.down(1);

        const executed = await runner.getExecutedMigrations();
        // 003 cannot be rolled back (no down method), so all 3 remain
        expect(executed).toHaveLength(3);
        expect(result.skipped).toContain('003_add_users_created_at');
      });

      it('should rollback multiple migrations', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        await runner.up();
        // Try to rollback 2, but 003 has no down(), so only 002 will be rolled back
        await runner.down(2);

        const executed = await runner.getExecutedMigrations();
        // 003 remains (no down), 002 rolled back successfully, 001 remains
        expect(executed).toHaveLength(2);
        expect(executed).toEqual(['001_create_users', '003_add_users_created_at']);

        // Verify posts table was dropped
        const tables = await db
          .selectFrom('sqlite_master' as any)
          .select('name' as any)
          .where('type' as any, '=', 'table')
          .where('name' as any, '=', 'posts')
          .execute();

        expect(tables).toHaveLength(0);
      });

      it('should handle migration without down method', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        await runner.up();

        // Try to rollback migration without down method (003)
        const result = await runner.down(1);

        // Should still have all 3 migrations (003 can't be rolled back)
        const executed = await runner.getExecutedMigrations();
        expect(executed).toHaveLength(3);
        expect(result.skipped).toContain('003_add_users_created_at');
      });

      it('should work with dry run mode', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        await runner.up();

        // Dry run rollback
        const dryRunner = new MigrationRunner(db, migrations, {
          dryRun: true,
          
        });
        const result = await dryRunner.down(1);

        // All migrations should still be executed
        const executed = await runner.getExecutedMigrations();
        expect(executed).toHaveLength(3);
        expect(result.dryRun).toBe(true);
      });

      it('should handle empty executed migrations', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        // Setup migrations table first
        await setupMigrations(db);

        // Try to rollback without any executed migrations
        const result = await runner.down(1);

        // Should not throw error
        const executed = await runner.getExecutedMigrations();
        expect(executed).toHaveLength(0);
        expect(result.executed).toHaveLength(0);
      });
    });

    describe('status', () => {
      it('should show correct migration status', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        // Before any migrations
        let status = await runner.status();
        expect(status.executed).toHaveLength(0);
        expect(status.pending).toHaveLength(3);
        expect(status.total).toBe(3);

        // After running one migration manually
        await migrations[0]?.up(db);
        await runner.markAsExecuted('001_create_users');

        status = await runner.status();
        expect(status.executed).toHaveLength(1);
        expect(status.pending).toHaveLength(2);
        expect(status.total).toBe(3);
        expect(status.executed).toEqual(['001_create_users']);
        expect(status.pending).toEqual(['002_create_posts', '003_add_users_created_at']);

        // After running all
        await runner.up();

        status = await runner.status();
        expect(status.executed).toHaveLength(3);
        expect(status.pending).toHaveLength(0);
        expect(status.total).toBe(3);
      });
    });

    describe('reset', () => {
      it('should rollback all migrations', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        await runner.up();
        await runner.reset();

        const executed = await runner.getExecutedMigrations();
        // 003 cannot be rolled back (no down method), so 1 remains
        expect(executed).toHaveLength(1);
        expect(executed).toEqual(['003_add_users_created_at']);
      });

      it('should work with dry run', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        await runner.up();

        const dryRunner = new MigrationRunner(db, migrations, {
          dryRun: true,
          
        });
        const result = await dryRunner.reset();

        // Migrations should still be there
        const executed = await runner.getExecutedMigrations();
        expect(executed).toHaveLength(3);
        expect(result.dryRun).toBe(true);
      });
    });

    describe('upTo', () => {
      it('should migrate up to specific migration', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        const result = await runner.upTo('002_create_posts');

        const executed = await runner.getExecutedMigrations();
        expect(executed).toHaveLength(2);
        expect(executed).toEqual(['001_create_users', '002_create_posts']);
        expect(result.executed).toHaveLength(2);
      });

      it('should throw NotFoundError for unknown migration', async () => {
        const migrations = createTestMigrations();
        const runner = new MigrationRunner(db, migrations, { });

        await expect(runner.upTo('999_unknown')).rejects.toThrow('Migration not found');
      });
    });
  });

  describe('createMigrationRunner', () => {
    it('should create a migration runner instance', () => {
      const migrations: Migration[] = [];
      const runner = createMigrationRunner(db, migrations);

      expect(runner).toBeInstanceOf(MigrationRunner);
    });

    it('should accept options', () => {
      const migrations: Migration[] = [];
      const runner = createMigrationRunner(db, migrations, {
        dryRun: true,
        
      });

      expect(runner).toBeInstanceOf(MigrationRunner);
    });
  });

  describe('createMigration', () => {
    it('should create a migration object', () => {
      const up = async () => {};
      const down = async () => {};

      const migration = createMigration('test', up, down);

      expect(migration).toHaveProperty('name', 'test');
      expect(migration).toHaveProperty('up', up);
      expect(migration).toHaveProperty('down', down);
    });

    it('should work without down method', () => {
      const up = async () => {};

      const migration = createMigration('test', up);

      expect(migration).toHaveProperty('name', 'test');
      expect(migration).toHaveProperty('up', up);
      expect(migration.down).toBeUndefined();
    });
  });

  describe('createMigrationWithMeta', () => {
    it('should create a migration with metadata', () => {
      const migration = createMigrationWithMeta('001_test', {
        up: async () => {},
        down: async () => {},
        description: 'Test migration',
        breaking: true,
        estimatedDuration: 5000,
        tags: ['schema', 'test'],
      });

      expect(migration.name).toBe('001_test');
      expect(migration.description).toBe('Test migration');
      expect(migration.breaking).toBe(true);
      expect(migration.estimatedDuration).toBe(5000);
      expect(migration.tags).toEqual(['schema', 'test']);
    });
  });

  describe('defineMigrations (Level 2 API)', () => {
    it('should convert object definitions to migration array', () => {
      const migrations = defineMigrations({
        '001_users': {
          description: 'Create users table',
          up: async () => {},
          down: async () => {},
        },
        '002_posts': {
          description: 'Create posts table',
          breaking: true,
          up: async () => {},
        },
      });

      expect(migrations).toHaveLength(2);
      expect(migrations[0]?.name).toBe('001_users');
      expect(migrations[0]?.description).toBe('Create users table');
      expect(migrations[1]?.name).toBe('002_posts');
      expect(migrations[1]?.breaking).toBe(true);
    });

    it('should work with runMigrations', async () => {
      const migrations = defineMigrations({
        '001_test': {
          up: async (db) => {
            await db.schema
              .createTable('test_table')
              .addColumn('id', 'integer', (col) => col.primaryKey())
              .execute();
          },
        },
      });

      const result = await runMigrations(db, migrations, { });

      expect(result.executed).toHaveLength(1);
      expect(result.executed[0]).toBe('001_test');
    });
  });

  describe('runMigrations (Level 2 API)', () => {
    it('should run all pending migrations', async () => {
      const migrations = createTestMigrations();
      const result = await runMigrations(db, migrations, { });

      expect(result.executed).toHaveLength(3);
      expect(result.dryRun).toBe(false);
    });

    it('should support dry run', async () => {
      const migrations = createTestMigrations();
      const result = await runMigrations(db, migrations, { dryRun: true });

      expect(result.dryRun).toBe(true);
    });
  });

  describe('rollbackMigrations (Level 2 API)', () => {
    it('should rollback migrations', async () => {
      const migrations = createTestMigrations();
      await runMigrations(db, migrations, { });

      const result = await rollbackMigrations(db, migrations, 2, { });

      // 003 has no down, 002 has down
      expect(result.executed.length + result.skipped.length).toBe(2);
    });
  });

  describe('getMigrationStatus (Level 2 API)', () => {
    it('should get migration status', async () => {
      const migrations = createTestMigrations();
      await runMigrations(db, migrations, { });

      const status = await getMigrationStatus(db, migrations, { });

      expect(status.executed).toHaveLength(3);
      expect(status.pending).toHaveLength(0);
      expect(status.total).toBe(3);
    });
  });

  describe('Plugin System (Level 3 API)', () => {
    describe('createLoggingPlugin', () => {
      it('should log migration events', () => {
        const logs: string[] = [];
        const plugin = createLoggingPlugin(createTestLogger(logs));

        expect(plugin.name).toBe('@kysera/migrations/logging');

        // Test beforeMigration
        plugin.beforeMigration?.({ name: 'test', up: async () => {} }, 'up');
        expect(logs).toContain('Starting up for test');
      });
    });

    describe('createMetricsPlugin', () => {
      it('should collect migration metrics', () => {
        const plugin = createMetricsPlugin();

        plugin.afterMigration?.({ name: 'test', up: async () => {} }, 'up', 100);
        plugin.afterMigration?.({ name: 'test2', up: async () => {} }, 'up', 200);

        const metrics = plugin.getMetrics();
        expect(metrics.migrations).toHaveLength(2);
        expect(metrics.migrations[0]).toEqual({
          name: 'test',
          operation: 'up',
          duration: 100,
          success: true,
        });
      });
    });
  });

  describe('Integration', () => {
    it('should handle full migration lifecycle', async () => {
      const migrations = createTestMigrations();
      const runner = new MigrationRunner(db, migrations, { });

      // 1. Check initial status
      let status = await runner.status();
      expect(status.pending).toHaveLength(3);

      // 2. Run all migrations
      await runner.up();

      // 3. Verify all executed
      status = await runner.status();
      expect(status.executed).toHaveLength(3);
      expect(status.pending).toHaveLength(0);

      // 4. Rollback one (003 has no down, so can't be rolled back)
      await runner.down(1);

      // 5. Verify status (003 still executed because no down method)
      status = await runner.status();
      expect(status.executed).toHaveLength(3);
      expect(status.pending).toHaveLength(0);

      // 6. All migrations still executed
      expect(status.executed).toEqual(['001_create_users', '002_create_posts', '003_add_users_created_at']);
    });

    it('should handle complex schema changes', async () => {
      const migrations: Migration[] = [
        createMigration(
          '001_initial',
          async (db) => {
            await db.schema
              .createTable('products')
              .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
              .addColumn('name', 'text', (col) => col.notNull())
              .addColumn('price', 'integer', (col) => col.notNull())
              .execute();
          },
          async (db) => {
            await db.schema.dropTable('products').execute();
          }
        ),
        createMigration(
          '002_add_index',
          async (db) => {
            await db.schema.createIndex('products_name_idx').on('products').column('name').execute();
          },
          async (db) => {
            await db.schema.dropIndex('products_name_idx').execute();
          }
        ),
      ];

      const runner = new MigrationRunner(db, migrations, { });

      await runner.up();

      // Insert test data
      await db
        .insertInto('products' as any)
        .values({ name: 'Test Product', price: 100 } as any)
        .execute();

      // Query should work with index
      const products = await db
        .selectFrom('products' as any)
        .selectAll()
        .where('name' as any, '=', 'Test Product')
        .execute();

      expect(products).toHaveLength(1);
      expect(products[0]).toHaveProperty('name', 'Test Product');

      // Rollback should work
      await runner.down(2);

      // Table should not exist
      const tables = await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, '=', 'products')
        .execute();

      expect(tables).toHaveLength(0);
    });

    it('should show metadata in logs when verbose', async () => {
      const logs: string[] = [];
      const migrations: MigrationWithMeta[] = [
        createMigrationWithMeta('001_test', {
          description: 'Creates test table',
          breaking: true,
          tags: ['schema'],
          estimatedDuration: 1000,
          up: async (db) => {
            await db.schema
              .createTable('test')
              .addColumn('id', 'integer', (col) => col.primaryKey())
              .execute();
          },
        }),
      ];

      const runner = new MigrationRunner(db, migrations, {
        logger: createTestLogger(logs),
        verbose: true,
      });

      await runner.up();

      // Check that metadata was logged
      expect(logs.some((l) => l.includes('Creates test table'))).toBe(true);
      expect(logs.some((l) => l.includes('BREAKING CHANGE'))).toBe(true);
      expect(logs.some((l) => l.includes('Tags: schema'))).toBe(true);
    });
  });
});
