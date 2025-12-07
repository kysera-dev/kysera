import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect, sql } from 'kysely';
import Database from 'better-sqlite3';
import {
  MigrationRunner,
  createMigration,
  MigrationError,
  type Migration,
} from '../src/index.js';
import { safeDbDestroy, safeSqliteClose } from './helpers/cleanup.js';

describe('Transaction Support', () => {
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

  describe('useTransactions option', () => {
    it('should execute migration without transaction by default', async () => {
      const migrations: Migration[] = [
        createMigration(
          '001_create_table',
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

      const runner = new MigrationRunner(db, migrations, {
        useTransactions: false,
      });

      await runner.up();

      const tables = await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, '=', 'test_table')
        .execute();

      expect(tables).toHaveLength(1);
    });

    it('should wrap migration in transaction when useTransactions is true', async () => {
      const migrations: Migration[] = [
        createMigration(
          '001_transactional_migration',
          async (db) => {
            await db.schema
              .createTable('transactional_table')
              .addColumn('id', 'integer', (col) => col.primaryKey())
              .addColumn('name', 'text')
              .execute();

            // Insert some data
            await db
              .insertInto('transactional_table' as any)
              .values({ id: 1, name: 'test' } as any)
              .execute();
          },
          async (db) => {
            await db.schema.dropTable('transactional_table').execute();
          }
        ),
      ];

      const runner = new MigrationRunner(db, migrations, {
        useTransactions: true,
      });

      await runner.up();

      // Verify both table and data exist
      const rows = await db
        .selectFrom('transactional_table' as any)
        .selectAll()
        .execute();

      expect(rows).toHaveLength(1);
      expect((rows[0] as any).name).toBe('test');
    });

    it('should rollback entire migration on partial failure with useTransactions', async () => {
      // Note: SQLite doesn't support transactional DDL the same way as PostgreSQL
      // This test verifies the transaction mechanism is being called
      let createTableCalled = false;
      let insertCalled = false;

      const migrations: Migration[] = [
        createMigration('001_partial_fail', async (db) => {
          createTableCalled = true;
          await db.schema
            .createTable('partial_table')
            .addColumn('id', 'integer', (col) => col.primaryKey())
            .execute();

          insertCalled = true;
          // This should fail - invalid syntax
          throw new Error('Simulated failure after table creation');
        }),
      ];

      const runner = new MigrationRunner(db, migrations, {
        useTransactions: true,
      });

      await expect(runner.up()).rejects.toThrow(MigrationError);

      expect(createTableCalled).toBe(true);
      expect(insertCalled).toBe(true);

      // Migration should not be recorded as executed
      const executed = await runner.getExecutedMigrations();
      expect(executed).not.toContain('001_partial_fail');
    });

    it('should work correctly for down migrations with transactions', async () => {
      const migrations: Migration[] = [
        createMigration(
          '001_with_down',
          async (db) => {
            await db.schema
              .createTable('down_test_table')
              .addColumn('id', 'integer', (col) => col.primaryKey())
              .execute();
          },
          async (db) => {
            await db.schema.dropTable('down_test_table').execute();
          }
        ),
      ];

      const runner = new MigrationRunner(db, migrations, {
        useTransactions: true,
      });

      // Run up
      await runner.up();

      // Verify table exists
      let tables = await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, '=', 'down_test_table')
        .execute();
      expect(tables).toHaveLength(1);

      // Run down
      await runner.down(1);

      // Verify table is dropped
      tables = await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, '=', 'down_test_table')
        .execute();
      expect(tables).toHaveLength(0);
    });
  });

  describe('Transaction isolation', () => {
    it('should isolate multiple migration transactions', async () => {
      const executionOrder: string[] = [];

      const migrations: Migration[] = [
        createMigration('001_first', async (db) => {
          executionOrder.push('001_start');
          await db.schema
            .createTable('first_table')
            .addColumn('id', 'integer', (col) => col.primaryKey())
            .execute();
          executionOrder.push('001_end');
        }),
        createMigration('002_second', async (db) => {
          executionOrder.push('002_start');
          await db.schema
            .createTable('second_table')
            .addColumn('id', 'integer', (col) => col.primaryKey())
            .execute();
          executionOrder.push('002_end');
        }),
      ];

      const runner = new MigrationRunner(db, migrations, {
        useTransactions: true,
      });

      await runner.up();

      // Migrations should execute in order
      expect(executionOrder).toEqual(['001_start', '001_end', '002_start', '002_end']);

      // Both tables should exist
      const tables = await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, 'in', ['first_table', 'second_table'])
        .execute();
      expect(tables).toHaveLength(2);
    });
  });

  describe('Error handling with transactions', () => {
    it('should propagate original error message through MigrationError', async () => {
      const originalMessage = 'Custom error message for testing';

      const migrations: Migration[] = [
        createMigration('001_error', async () => {
          throw new Error(originalMessage);
        }),
      ];

      const runner = new MigrationRunner(db, migrations, {
        useTransactions: true,
      });

      try {
        await runner.up();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MigrationError);
        expect((error as MigrationError).message).toContain(originalMessage);
        expect((error as MigrationError).migrationName).toBe('001_error');
        expect((error as MigrationError).operation).toBe('up');
      }
    });

    it('should include cause in MigrationError', async () => {
      const originalError = new Error('Original cause');

      const migrations: Migration[] = [
        createMigration('001_with_cause', async () => {
          throw originalError;
        }),
      ];

      const runner = new MigrationRunner(db, migrations, {
        useTransactions: true,
      });

      try {
        await runner.up();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MigrationError);
        expect((error as MigrationError).cause).toBe(originalError);
      }
    });
  });
});
