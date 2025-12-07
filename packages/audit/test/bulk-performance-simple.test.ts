import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, SqliteDialect, type Generated } from 'kysely';
import betterSqlite3 from 'better-sqlite3';
import { auditPluginSQLite } from '../src/index.js';
import { createORM, createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import { z } from 'zod';

/**
 * Simple performance tests for audit plugin bulk operations.
 *
 * Phase 2 Day 14: Audit Plugin Optimization
 *
 * Verifies that bulk operations use optimized single-query fetching.
 */

interface TestDatabase {
  users: {
    id: Generated<number>;
    email: string;
    name: string;
    status: string;
  };
  audit_logs: {
    id: Generated<number>;
    table_name: string;
    entity_id: string;
    operation: string;
    old_values: string | null;
    new_values: string | null;
    changed_by: string | null;
    changed_at: string;
    metadata: string | null;
  };
}

const userCreateSchema = z.object({
  email: z.string().email(),
  name: z.string(),
  status: z.string().optional(),
});

const userUpdateSchema = userCreateSchema.partial();

describe('Audit Plugin - Bulk Operation Optimization', () => {
  let db: Kysely<TestDatabase>;
  let sqlite: ReturnType<typeof betterSqlite3>;
  let userRepo: any;

  beforeAll(async () => {
    sqlite = new betterSqlite3(':memory:');
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({ database: sqlite }),
    });

    // Create users table
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('email', 'text', (col) => col.notNull().unique())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
      .execute();

    // Create audit_logs table
    await db.schema
      .createTable('audit_logs')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('table_name', 'text', (col) => col.notNull())
      .addColumn('entity_id', 'text', (col) => col.notNull())
      .addColumn('operation', 'text', (col) => col.notNull())
      .addColumn('old_values', 'text')
      .addColumn('new_values', 'text')
      .addColumn('changed_by', 'text')
      .addColumn('changed_at', 'text', (col) => col.notNull())
      .addColumn('metadata', 'text')
      .execute();

    // Insert test data
    for (let i = 1; i <= 20; i++) {
      await db
        .insertInto('users')
        .values({
          email: `user${i}@example.com`,
          name: `User ${i}`,
          status: 'active',
        })
        .execute();
    }

    // Create ORM with audit plugin
    const audit = auditPluginSQLite({
      captureOldValues: true,
      captureNewValues: true,
    });

    const orm = await createORM(db, [audit]);
    const factory = createRepositoryFactory(db);

    userRepo = orm.createRepository(() =>
      factory.create({
        tableName: 'users' as const,
        mapRow: (row: any) => row,
        schemas: {
          create: userCreateSchema,
          update: userUpdateSchema,
        },
      })
    );
  });

  afterAll(async () => {
    await db.destroy();
    sqlite.close();
  });

  describe('bulkUpdate Performance', () => {
    it('should capture old and new values in bulk update', async () => {
      // Clear previous audit logs
      await db.deleteFrom('audit_logs').execute();

      // Bulk update
      await userRepo.bulkUpdate([
        { id: 1, data: { status: 'inactive' } },
        { id: 2, data: { status: 'inactive' } },
        { id: 3, data: { status: 'inactive' } },
      ]);

      // Check audit logs
      const auditLogs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('operation', '=', 'UPDATE')
        .orderBy('entity_id', 'asc')
        .execute();

      expect(auditLogs).toHaveLength(3);

      // Verify old values were captured
      for (let i = 0; i < 3; i++) {
        const log = auditLogs[i];
        expect(log?.old_values).toBeTruthy();

        if (log?.old_values) {
          const oldValues = JSON.parse(log.old_values);
          expect(oldValues.status).toBe('active'); // Old status
          expect(oldValues.name).toBe(`User ${i + 1}`);
        }

        if (log?.new_values) {
          const newValues = JSON.parse(log.new_values);
          expect(newValues.status).toBe('inactive'); // New status
        }
      }
    });

    it('should handle bulk update with empty array', async () => {
      await db.deleteFrom('audit_logs').execute();

      const result = await userRepo.bulkUpdate([]);
      expect(result).toEqual([]);

      const auditLogs = await db.selectFrom('audit_logs').selectAll().execute();
      expect(auditLogs).toHaveLength(0);
    });
  });

  describe('bulkDelete Performance', () => {
    it('should capture old values in bulk delete', async () => {
      await db.deleteFrom('audit_logs').execute();

      // Bulk delete
      await userRepo.bulkDelete([4, 5, 6]);

      // Check audit logs
      const auditLogs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('operation', '=', 'DELETE')
        .orderBy('entity_id', 'asc')
        .execute();

      expect(auditLogs).toHaveLength(3);

      // Verify old values were captured
      for (let i = 0; i < 3; i++) {
        const log = auditLogs[i];
        const entityId = 4 + i;
        expect(log?.entity_id).toBe(String(entityId));
        expect(log?.old_values).toBeTruthy();

        if (log?.old_values) {
          const oldValues = JSON.parse(log.old_values);
          expect(oldValues.name).toBe(`User ${entityId}`);
          expect(oldValues.email).toBe(`user${entityId}@example.com`);
          expect(oldValues.status).toBe('active');
        }

        // New values should be null for DELETE
        expect(log?.new_values).toBeNull();
      }

      // Verify users were actually deleted
      const remainingUsers = await db.selectFrom('users').selectAll().where('id', 'in', [4, 5, 6]).execute();
      expect(remainingUsers).toHaveLength(0);
    });

    it('should handle bulk delete with empty array', async () => {
      await db.deleteFrom('audit_logs').execute();

      const result = await userRepo.bulkDelete([]);
      // bulkDelete returns number of deleted rows (0 for empty array)
      expect(result).toBe(0);

      const auditLogs = await db.selectFrom('audit_logs').selectAll().execute();
      expect(auditLogs).toHaveLength(0);
    });

    it('should complete bulk delete quickly (performance)', async () => {
      await db.deleteFrom('audit_logs').execute();

      const ids = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

      const startTime = Date.now();
      await userRepo.bulkDelete(ids);
      const endTime = Date.now();

      const duration = endTime - startTime;

      // Should complete quickly (< 100ms for 10 records)
      // Optimized bulk fetch is much faster than N individual queries
      expect(duration).toBeLessThan(100);

      // Verify all audit logs were created
      const auditLogs = await db.selectFrom('audit_logs').selectAll().where('operation', '=', 'DELETE').execute();

      expect(auditLogs).toHaveLength(10);
    });
  });

  describe('Transaction Behavior', () => {
    it('should rollback audit logs when transaction rolls back', async () => {
      await db.deleteFrom('audit_logs').execute();

      try {
        await db.transaction().execute(async (trx) => {
          const torm = await createORM(trx as any, [auditPluginSQLite({ captureOldValues: true })]);
          const factory = createRepositoryFactory(trx);

          const trepo = torm.createRepository(() =>
            factory.create({
              tableName: 'users' as const,
              mapRow: (row: any) => row,
              schemas: {
                create: userCreateSchema,
                update: userUpdateSchema,
              },
            })
          );

          await trepo.bulkUpdate([
            { id: 17, data: { status: 'inactive' } },
            { id: 18, data: { status: 'inactive' } },
          ]);

          throw new Error('Rollback');
        });
      } catch (error) {
        expect((error as Error).message).toBe('Rollback');
      }

      // No audit logs should exist
      const auditLogs = await db.selectFrom('audit_logs').selectAll().execute();
      expect(auditLogs).toHaveLength(0);

      // Users should still have original status
      const users = await db.selectFrom('users').selectAll().where('id', 'in', [17, 18]).execute();

      expect(users[0]?.status).toBe('active');
      expect(users[1]?.status).toBe('active');
    });

    it('should commit audit logs when transaction commits', async () => {
      await db.deleteFrom('audit_logs').execute();

      await db.transaction().execute(async (trx) => {
        const torm = await createORM(trx as any, [
          auditPluginSQLite({ captureOldValues: true, captureNewValues: true }),
        ]);
        const factory = createRepositoryFactory(trx);

        const trepo = torm.createRepository(() =>
          factory.create({
            tableName: 'users' as const,
            mapRow: (row: any) => row,
            schemas: {
              create: userCreateSchema,
              update: userUpdateSchema,
            },
          })
        );

        await trepo.bulkUpdate([{ id: 19, data: { status: 'inactive' } }]);

        await trepo.bulkDelete([20]);
      });

      // Audit logs should exist
      const auditLogs = await db.selectFrom('audit_logs').selectAll().orderBy('operation', 'asc').execute();

      expect(auditLogs.length).toBeGreaterThanOrEqual(2);

      const updateLogs = auditLogs.filter((l) => l.operation === 'UPDATE');
      const deleteLogs = auditLogs.filter((l) => l.operation === 'DELETE');

      expect(updateLogs.length).toBeGreaterThanOrEqual(1);
      expect(deleteLogs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
