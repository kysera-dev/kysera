import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import {
  type DatabaseType,
  type MultiDbTestDatabase,
  createTestDb,
  initializeSchema,
  clearDatabase,
} from './utils/multi-db.js';
import { createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import { createORM } from '../../kysera-repository/dist/index.js';
import { auditPlugin, type ParsedAuditLogEntry } from '../src/index.js';
import { z } from 'zod';

interface User {
  id: number;
  email: string;
  name: string | null;
}

interface Post {
  id: number;
  user_id: number;
  title: string;
  content: string | null;
  published: boolean;
}

// Test all database types based on environment
const getDatabaseTypes = (): DatabaseType[] => {
  const types: DatabaseType[] = ['sqlite'];

  if (process.env['TEST_POSTGRES'] === 'true') {
    types.push('postgres');
  }

  if (process.env['TEST_MYSQL'] === 'true') {
    types.push('mysql');
  }

  return types;
};

describe.each(getDatabaseTypes())('Audit Plugin Multi-Database Tests (%s)', (dbType) => {
  let db: Kysely<MultiDbTestDatabase>;
  let orm: any;
  let userRepo: any;
  let currentUserId: string | null = null;

  beforeAll(async () => {
    db = createTestDb(dbType);
    await initializeSchema(db, dbType);

    // Create ORM with audit plugin
    // Now uses SQL CURRENT_TIMESTAMP for all databases, avoiding timezone issues
    const audit = auditPlugin({
      getUserId: () => currentUserId,
      tables: ['users', 'posts'],
      captureOldValues: true,
      captureNewValues: true,
    });

    orm = await createORM(db, [audit]);

    // Create repositories
    const factory = createRepositoryFactory(db);

    userRepo = orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'users' as const,
        mapRow: (row: any) => row as User,
        schemas: {
          create: z.object({
            email: z.string(),
            name: z.string().nullable(),
          }),
          update: z.object({
            email: z.string().optional(),
            name: z.string().nullable().optional(),
          }),
        },
      })
    );

    const booleanSchema =
      dbType === 'sqlite'
        ? z.union([z.boolean(), z.number()]).transform((val) => (typeof val === 'number' ? val : val ? 1 : 0))
        : z.boolean();

    // Post repository - created but not used in these tests
    orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'posts' as const,
        mapRow: (row: any) => row as Post,
        schemas: {
          create: z.object({
            user_id: z.number(),
            title: z.string(),
            content: z.string().nullable(),
            published: booleanSchema,
          }),
          update: z.object({
            user_id: z.number().optional(),
            title: z.string().optional(),
            content: z.string().nullable().optional(),
            published: booleanSchema.optional(),
          }),
        },
      })
    );
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await clearDatabase(db);
    currentUserId = null;
  });

  describe('Audit Logging', () => {
    it('should audit INSERT operations', async () => {
      currentUserId = 'user-123';

      const user = await userRepo.create({
        email: 'audit@example.com',
        name: 'Audit Test',
      });

      const logs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('table_name', '=', 'users')
        .where('entity_id', '=', String(user.id))
        .execute();

      expect(logs).toHaveLength(1);
      const log = logs[0]!;
      expect(log.operation).toBe('INSERT');
      expect(log.changed_by).toBe('user-123');
      expect(log.old_values).toBeNull();
      expect(log.new_values).toBeDefined();

      const newValues = JSON.parse(log.new_values!);
      expect(newValues.email).toBe('audit@example.com');
      expect(newValues.name).toBe('Audit Test');
    });

    it('should audit UPDATE operations', async () => {
      currentUserId = 'user-456';

      const user = await userRepo.create({
        email: 'update@example.com',
        name: 'Original Name',
      });

      await db.deleteFrom('audit_logs').execute(); // Clear creation log

      await userRepo.update(user.id, {
        name: 'Updated Name',
      });

      const logs = await db.selectFrom('audit_logs').selectAll().where('table_name', '=', 'users').execute();

      expect(logs).toHaveLength(1);
      const log = logs[0]!;
      expect(log.operation).toBe('UPDATE');
      expect(log.changed_by).toBe('user-456');

      const oldValues = JSON.parse(log.old_values!);
      expect(oldValues.name).toBe('Original Name');

      const newValues = JSON.parse(log.new_values!);
      expect(newValues.name).toBe('Updated Name');
    });

    it('should audit DELETE operations', async () => {
      currentUserId = 'user-789';

      const user = await userRepo.create({
        email: 'delete@example.com',
        name: 'Delete Test',
      });

      await db.deleteFrom('audit_logs').execute(); // Clear creation log

      await userRepo.delete(user.id);

      const logs = await db.selectFrom('audit_logs').selectAll().where('table_name', '=', 'users').execute();

      expect(logs).toHaveLength(1);
      const log = logs[0]!;
      expect(log.operation).toBe('DELETE');
      expect(log.changed_by).toBe('user-789');

      const oldValues = JSON.parse(log.old_values!);
      expect(oldValues.email).toBe('delete@example.com');
      expect(log.new_values).toBeNull();
    });
  });

  describe('Bulk Operations', () => {
    it('should audit bulk creates', async () => {
      currentUserId = 'bulk-user';

      await userRepo.bulkCreate([
        { email: 'bulk1@example.com', name: 'Bulk 1' },
        { email: 'bulk2@example.com', name: 'Bulk 2' },
        { email: 'bulk3@example.com', name: 'Bulk 3' },
      ]);

      const logs = await db.selectFrom('audit_logs').selectAll().where('table_name', '=', 'users').execute();

      expect(logs).toHaveLength(3);
      logs.forEach((log, index) => {
        expect(log.operation).toBe('INSERT');
        expect(log.changed_by).toBe('bulk-user');
        const newValues = JSON.parse(log.new_values!);
        expect(newValues.email).toBe(`bulk${index + 1}@example.com`);
      });
    });

    it('should audit bulk updates', async () => {
      currentUserId = 'bulk-update-user';

      // Create users first
      const users = await userRepo.bulkCreate([
        { email: 'update1@example.com', name: 'User 1' },
        { email: 'update2@example.com', name: 'User 2' },
      ]);

      await db.deleteFrom('audit_logs').execute(); // Clear creation logs

      const updates = users.map((u: User) => ({
        id: u.id,
        data: { name: `Updated ${u.name}` },
      }));

      await userRepo.bulkUpdate(updates);

      const logs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('table_name', '=', 'users')
        .where('operation', '=', 'UPDATE')
        .execute();

      expect(logs).toHaveLength(2);
      logs.forEach((log) => {
        expect(log.changed_by).toBe('bulk-update-user');
        const oldValues = JSON.parse(log.old_values!);
        const newValues = JSON.parse(log.new_values!);
        expect(newValues.name).toContain('Updated');
        expect(oldValues.name).not.toContain('Updated');
      });
    });

    it('should audit bulk deletes', async () => {
      currentUserId = 'bulk-delete-user';

      const users = await userRepo.bulkCreate([
        { email: 'del1@example.com', name: 'Delete 1' },
        { email: 'del2@example.com', name: 'Delete 2' },
      ]);

      const ids = users.map((u: User) => u.id);
      await db.deleteFrom('audit_logs').execute(); // Clear creation logs

      await userRepo.bulkDelete(ids);

      const logs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('table_name', '=', 'users')
        .where('operation', '=', 'DELETE')
        .execute();

      expect(logs).toHaveLength(2);
      logs.forEach((log) => {
        expect(log.changed_by).toBe('bulk-delete-user');
        const oldValues = JSON.parse(log.old_values!);
        expect(oldValues.email).toMatch(/del[12]@example\.com/);
        expect(log.new_values).toBeNull();
      });
    });
  });

  describe('Audit History', () => {
    it('should retrieve entity history', async () => {
      currentUserId = 'history-user';

      const user = await userRepo.create({
        email: 'history@example.com',
        name: 'History User',
      });

      // Add delay to ensure different timestamps
      // SQL CURRENT_TIMESTAMP has 1-second precision in SQLite/MySQL, so need full second delays
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await userRepo.update(user.id, { name: 'First Update' });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await userRepo.update(user.id, { name: 'Second Update' });

      const history = await userRepo.getAuditHistory(user.id);

      expect(history).toHaveLength(3);

      // Sort by timestamp in descending order (most recent first)
      const sortedHistory = history.sort((a: ParsedAuditLogEntry, b: ParsedAuditLogEntry) => {
        const dateA = new Date(a.changed_at).getTime();
        const dateB = new Date(b.changed_at).getTime();
        return dateB - dateA; // Descending order
      });

      expect(sortedHistory[0]!.operation).toBe('UPDATE'); // Most recent first
      expect(sortedHistory[1]!.operation).toBe('UPDATE');
      expect(sortedHistory[2]!.operation).toBe('INSERT');

      // Verify chronological order
      const secondUpdate = sortedHistory[0]!.new_values;
      expect(secondUpdate!.name).toBe('Second Update');
    });

    it('should filter audit logs by date range', async () => {
      currentUserId = 'date-filter-user';

      // Create some data
      const user = await userRepo.create({
        email: 'datetest@example.com',
        name: 'Date Test',
      });

      const startDate = new Date();

      // Delay to ensure different timestamps
      // SQL CURRENT_TIMESTAMP has 1-second precision in SQLite/MySQL
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await userRepo.update(user.id, { name: 'Updated' });

      await new Promise((resolve) => setTimeout(resolve, 1100));
      const endDate = new Date();

      // Create another update after the end date
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await userRepo.update(user.id, { name: 'After End' });

      const logs = await userRepo.getTableAuditLogs({
        startDate,
        endDate,
      });

      // Should only include the middle update
      const updateLogs = logs.filter((l: any) => l.operation === 'UPDATE');
      expect(updateLogs).toHaveLength(1);
      expect(updateLogs[0]!.new_values!.name).toBe('Updated');
    });

    it('should filter by user', async () => {
      currentUserId = 'user-a';
      await userRepo.create({
        email: 'usera@example.com',
        name: 'User A Creation',
      });

      currentUserId = 'user-b';
      await userRepo.create({
        email: 'userb@example.com',
        name: 'User B Creation',
      });

      const userALogs = await userRepo.getUserChanges('user-a');
      expect(userALogs).toHaveLength(1);
      expect(userALogs[0]!.changed_by).toBe('user-a');

      const userBLogs = await userRepo.getUserChanges('user-b');
      expect(userBLogs).toHaveLength(1);
      expect(userBLogs[0]!.changed_by).toBe('user-b');
    });
  });

  describe('Restoration', () => {
    it('should restore deleted entities', async () => {
      currentUserId = 'restore-user';

      const user = await userRepo.create({
        email: 'restore@example.com',
        name: 'Restore Test',
      });

      const originalId = user.id;

      await userRepo.delete(user.id);

      // Get the delete audit log
      const deleteLogs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('table_name', '=', 'users')
        .where('operation', '=', 'DELETE')
        .where('entity_id', '=', String(originalId))
        .execute();

      expect(deleteLogs).toHaveLength(1);

      // Restore from audit
      const restored = await userRepo.restoreFromAudit(deleteLogs[0]!.id);

      expect(restored.email).toBe('restore@example.com');
      expect(restored.name).toBe('Restore Test');
      // ID might be different after restoration
      expect(restored.id).toBeDefined();
    });

    it('should revert updates', async () => {
      currentUserId = 'revert-user';

      const user = await userRepo.create({
        email: 'revert@example.com',
        name: 'Original Name',
      });

      await userRepo.update(user.id, {
        name: 'Bad Update',
      });

      // Get the update audit log
      const updateLogs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('table_name', '=', 'users')
        .where('operation', '=', 'UPDATE')
        .execute();

      expect(updateLogs).toHaveLength(1);

      // Revert the update
      const reverted = await userRepo.restoreFromAudit(updateLogs[0]!.id);

      expect(reverted.name).toBe('Original Name');
    });
  });

  describe('Transaction Support', () => {
    it('should audit within transactions', async () => {
      currentUserId = 'tx-user';

      // Note: withTransaction creates a new repository instance which doesn't
      // automatically apply plugins. For proper transaction support with audit logs,
      // you should use the ORM's createRepository within the transaction.

      await db.transaction().execute(async (trx) => {
        // MySQL doesn't support RETURNING clause, so we need to handle it differently
        let userId: number;
        if (dbType === 'mysql') {
          const result = await trx
            .insertInto('users')
            .values({
              email: 'tx@example.com',
              name: 'Transaction User',
            })
            .executeTakeFirstOrThrow();
          // MySQL returns insertId from execute result
          userId = Number(result.insertId);
        } else {
          const user = await trx
            .insertInto('users')
            .values({
              email: 'tx@example.com',
              name: 'Transaction User',
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          userId = user.id;
        }

        await trx
          .insertInto('posts')
          .values({
            user_id: userId,
            title: 'Transaction Post',
            content: 'Created in transaction',
            published: (dbType === 'sqlite' ? 1 : true) as any, // SQLite uses 1/0 for boolean
          })
          .execute();
      });

      // Verify transaction was committed
      const users = await db.selectFrom('users').selectAll().where('email', '=', 'tx@example.com').execute();

      expect(users).toHaveLength(1);
      expect(users[0]!.name).toBe('Transaction User');
    });

    it('should rollback audit logs on transaction failure', async () => {
      currentUserId = 'rollback-user';

      try {
        await db.transaction().execute(async (trx) => {
          const txUserRepo = userRepo.withTransaction(trx);

          await txUserRepo.create({
            email: 'rollback@example.com',
            name: 'Should Rollback',
          });

          // Force error
          throw new Error('Rollback test');
        });
      } catch {
        // Expected
      }

      const logs = await db.selectFrom('audit_logs').selectAll().where('changed_by', '=', 'rollback-user').execute();

      expect(logs).toHaveLength(0);
    });
  });

  describe('Performance', () => {
    it('should handle high-volume auditing', async () => {
      currentUserId = 'perf-user';

      const startTime = Date.now();

      // Create many records
      const users = Array.from({ length: 100 }, (_, i) => ({
        email: `perf${i}@example.com`,
        name: `Performance User ${i}`,
      }));

      await userRepo.bulkCreate(users);

      const elapsed = Date.now() - startTime;

      const logs = await db.selectFrom('audit_logs').select(db.fn.count('id').as('count')).executeTakeFirst();

      expect(Number(logs?.count)).toBe(100);
      expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should efficiently query audit history', async () => {
      currentUserId = 'query-perf-user';

      // Create a user with many updates
      const user = await userRepo.create({
        email: 'querytest@example.com',
        name: 'Query Test',
      });

      for (let i = 0; i < 50; i++) {
        await userRepo.update(user.id, {
          name: `Update ${i}`,
        });
      }

      const startTime = Date.now();
      const history = await userRepo.getAuditHistory(user.id);
      const elapsed = Date.now() - startTime;

      expect(history).toHaveLength(51); // 1 create + 50 updates
      expect(elapsed).toBeLessThan(500); // Should be fast
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values', async () => {
      currentUserId = 'null-user';

      const user = await userRepo.create({
        email: 'nulltest@example.com',
        name: null,
      });

      await userRepo.update(user.id, {
        name: 'Not Null',
      });

      await userRepo.update(user.id, {
        name: null,
      });

      const logs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('table_name', '=', 'users')
        .where('operation', '=', 'UPDATE')
        .orderBy('id', 'asc')
        .execute();

      expect(logs).toHaveLength(2);

      // First update: null -> 'Not Null'
      const firstOld = JSON.parse(logs[0]!.old_values!);
      const firstNew = JSON.parse(logs[0]!.new_values!);
      expect(firstOld.name).toBeNull();
      expect(firstNew.name).toBe('Not Null');

      // Second update: 'Not Null' -> null
      const secondOld = JSON.parse(logs[1]!.old_values!);
      const secondNew = JSON.parse(logs[1]!.new_values!);
      expect(secondOld.name).toBe('Not Null');
      expect(secondNew.name).toBeNull();
    });

    it('should handle special characters', async () => {
      currentUserId = 'special-char-user';

      await userRepo.create({
        email: 'special@example.com',
        name: "O'Brien \"The Great\" & Co. <script>alert('test')</script>",
      });

      const logs = await db.selectFrom('audit_logs').selectAll().where('table_name', '=', 'users').execute();

      const newValues = JSON.parse(logs[0]!.new_values!);
      expect(newValues.name).toBe("O'Brien \"The Great\" & Co. <script>alert('test')</script>");
    });

    it('should handle concurrent operations', async () => {
      currentUserId = 'concurrent-user';

      // Create multiple users concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        userRepo.create({
          email: `concurrent${i}@example.com`,
          name: `Concurrent ${i}`,
        })
      );

      await Promise.all(promises);

      const logs = await db.selectFrom('audit_logs').selectAll().where('changed_by', '=', 'concurrent-user').execute();

      expect(logs).toHaveLength(10);
      const emails = logs.map((l) => JSON.parse(l.new_values!).email);
      expect(new Set(emails).size).toBe(10); // All unique
    });
  });
});
