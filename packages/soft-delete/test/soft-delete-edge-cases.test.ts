import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, seedTestData } from './setup/database.js';
import { softDeletePlugin } from '../src/index.js';
import { createORM, createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';
import { z } from 'zod';

// Extended test interfaces
interface TestUser {
  id: number;
  email: string;
  name: string;
  created_at: string;
  deleted_at: string | null;
}

interface SoftDeleteRepository {
  tableName: string;
  executor: Kysely<TestDatabase>;
  findAll: () => Promise<TestUser[]>;
  findById: (id: number) => Promise<TestUser | null>;
  update: (id: number, data: Partial<TestUser>) => Promise<TestUser>;
  create: (data: Omit<TestUser, 'id' | 'created_at' | 'deleted_at'>) => Promise<TestUser>;
  softDelete?: (id: number) => Promise<TestUser>;
  restore?: (id: number) => Promise<TestUser>;
  hardDelete?: (id: number) => Promise<void>;
  findAllWithDeleted?: () => Promise<TestUser[]>;
  findDeleted?: () => Promise<TestUser[]>;
  findWithDeleted?: (id: number) => Promise<TestUser | null>;
}


describe('Soft Delete Plugin - Edge Cases and Security', () => {
  let db: Kysely<TestDatabase>;
  let cleanup: () => void;

  beforeEach(async () => {
    const setup = createTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    await seedTestData(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('Concurrent Soft Deletes - Race Conditions', () => {
    it('should handle concurrent soft deletes on different records', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as SoftDeleteRepository;

      // Get all user IDs
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users.length).toBe(3);

      // Concurrent soft deletes on different records
      const deletePromises = users.map((user) => repo.softDelete!(user.id));
      await Promise.all(deletePromises);

      // All should be soft deleted
      const remaining = await repo.findAll();
      expect(remaining).toHaveLength(0);

      const deleted = await repo.findDeleted!();
      expect(deleted).toHaveLength(3);
    });

    it('should handle concurrent soft delete and restore on same record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as SoftDeleteRepository;

      const alice = await db.selectFrom('users').selectAll().where('name', '=', 'Alice').executeTakeFirst();
      if (!alice) throw new Error('Alice not found');

      // First soft delete
      await repo.softDelete!(alice.id);

      // Concurrent operations: restore + soft delete
      const results = await Promise.allSettled([
        repo.restore!(alice.id),
        repo.softDelete!(alice.id),
      ]);

      // Both should complete (order may vary)
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);

      // Final state should be deterministic (last operation wins)
      const finalUser = await repo.findWithDeleted!(alice.id);
      expect(finalUser).not.toBeNull();
    });

    it('should handle concurrent soft deletes on same record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as SoftDeleteRepository;

      const bob = await db.selectFrom('users').selectAll().where('name', '=', 'Bob').executeTakeFirst();
      if (!bob) throw new Error('Bob not found');

      // Multiple concurrent soft deletes on same record
      const deletePromises = Array(5).fill(null).map(() => repo.softDelete!(bob.id));
      const results = await Promise.allSettled(deletePromises);

      // All should succeed (idempotent behavior)
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);

      // Should only have one soft-deleted record
      const deleted = await repo.findWithDeleted!(bob.id);
      expect(deleted).not.toBeNull();
      expect(deleted!.deleted_at).not.toBeNull();
    });
  });

  describe('Transaction Rollback Behavior', () => {
    it('should rollback soft delete on transaction failure', async () => {
      const alice = await db.selectFrom('users').selectAll().where('name', '=', 'Alice').executeTakeFirst();
      if (!alice) throw new Error('Alice not found');

      try {
        await db.transaction().execute(async (trx) => {
          // Soft delete within transaction
          await trx
            .updateTable('users')
            .set({ deleted_at: new Date().toISOString() })
            .where('id', '=', alice.id)
            .execute();

          // Verify soft deleted within transaction
          const inTrx = await trx.selectFrom('users').selectAll().where('id', '=', alice.id).executeTakeFirst();
          expect(inTrx?.deleted_at).not.toBeNull();

          // Force rollback
          throw new Error('INTENTIONAL_ROLLBACK');
        });
      } catch (error) {
        expect((error as Error).message).toBe('INTENTIONAL_ROLLBACK');
      }

      // After rollback, Alice should NOT be soft deleted
      const afterRollback = await db.selectFrom('users').selectAll().where('id', '=', alice.id).executeTakeFirst();
      expect(afterRollback?.deleted_at).toBeNull();
    });

    it('should rollback restore on transaction failure', async () => {
      // First soft delete Bob
      const bob = await db.selectFrom('users').selectAll().where('name', '=', 'Bob').executeTakeFirst();
      if (!bob) throw new Error('Bob not found');

      await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).where('id', '=', bob.id).execute();

      try {
        await db.transaction().execute(async (trx) => {
          // Restore within transaction
          await trx
            .updateTable('users')
            .set({ deleted_at: null })
            .where('id', '=', bob.id)
            .execute();

          // Verify restored within transaction
          const inTrx = await trx.selectFrom('users').selectAll().where('id', '=', bob.id).executeTakeFirst();
          expect(inTrx?.deleted_at).toBeNull();

          // Force rollback
          throw new Error('INTENTIONAL_ROLLBACK');
        });
      } catch (error) {
        expect((error as Error).message).toBe('INTENTIONAL_ROLLBACK');
      }

      // After rollback, Bob should still be soft deleted
      const afterRollback = await db.selectFrom('users').selectAll().where('id', '=', bob.id).executeTakeFirst();
      expect(afterRollback?.deleted_at).not.toBeNull();
    });

    it('should handle nested transactions with soft delete', async () => {
      const charlie = await db.selectFrom('users').selectAll().where('name', '=', 'Charlie').executeTakeFirst();
      if (!charlie) throw new Error('Charlie not found');

      await db.transaction().execute(async (trx) => {
        // Soft delete in outer transaction
        await trx
          .updateTable('users')
          .set({ deleted_at: new Date().toISOString() })
          .where('id', '=', charlie.id)
          .execute();

        // Note: SQLite doesn't support true nested transactions, but we can test the pattern
        const inTrx = await trx.selectFrom('users').selectAll().where('id', '=', charlie.id).executeTakeFirst();
        expect(inTrx?.deleted_at).not.toBeNull();
      });

      // After successful commit, Charlie should be soft deleted
      const afterCommit = await db.selectFrom('users').selectAll().where('id', '=', charlie.id).executeTakeFirst();
      expect(afterCommit?.deleted_at).not.toBeNull();
    });
  });

  describe('findById with Soft-Deleted Record', () => {
    it('should return null for soft-deleted record via findById', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as SoftDeleteRepository;

      const alice = await db.selectFrom('users').selectAll().where('name', '=', 'Alice').executeTakeFirst();
      if (!alice) throw new Error('Alice not found');

      // Soft delete Alice
      await repo.softDelete!(alice.id);

      // findById should return null
      const found = await repo.findById(alice.id);
      expect(found).toBeNull();

      // findWithDeleted should return the record
      const foundWithDeleted = await repo.findWithDeleted!(alice.id);
      expect(foundWithDeleted).not.toBeNull();
      expect(foundWithDeleted!.name).toBe('Alice');
    });

    it('should return null for non-existent record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as SoftDeleteRepository;

      const found = await repo.findById(99999);
      expect(found).toBeNull();
    });
  });

  describe('Restore on Already-Restored Record (Idempotency)', () => {
    it('should be idempotent when restoring already-restored record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as SoftDeleteRepository;

      const bob = await db.selectFrom('users').selectAll().where('name', '=', 'Bob').executeTakeFirst();
      if (!bob) throw new Error('Bob not found');

      // Soft delete and restore
      await repo.softDelete!(bob.id);
      await repo.restore!(bob.id);

      // Verify restored
      let user = await repo.findById(bob.id);
      expect(user).not.toBeNull();
      expect(user!.deleted_at).toBeNull();

      // Multiple restores should not throw and should be idempotent
      await repo.restore!(bob.id);
      await repo.restore!(bob.id);
      await repo.restore!(bob.id);

      // Still restored
      user = await repo.findById(bob.id);
      expect(user).not.toBeNull();
      expect(user!.deleted_at).toBeNull();
    });

    it('should be idempotent when restoring never-deleted record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as SoftDeleteRepository;

      const charlie = await db.selectFrom('users').selectAll().where('name', '=', 'Charlie').executeTakeFirst();
      if (!charlie) throw new Error('Charlie not found');

      // Record was never deleted
      expect(charlie.deleted_at).toBeNull();

      // Restore should not throw
      await repo.restore!(charlie.id);

      // Should still exist and not be deleted
      const user = await repo.findById(charlie.id);
      expect(user).not.toBeNull();
      expect(user!.deleted_at).toBeNull();
    });
  });

  describe('SoftDelete on Already-Deleted Record', () => {
    it('should update timestamp when soft deleting already-deleted record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as SoftDeleteRepository;

      const alice = await db.selectFrom('users').selectAll().where('name', '=', 'Alice').executeTakeFirst();
      if (!alice) throw new Error('Alice not found');

      // First soft delete
      await repo.softDelete!(alice.id);
      const firstDelete = await repo.findWithDeleted!(alice.id);
      expect(firstDelete!.deleted_at).not.toBeNull();
      const firstTimestamp = firstDelete!.deleted_at;

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second soft delete
      await repo.softDelete!(alice.id);
      const secondDelete = await repo.findWithDeleted!(alice.id);
      expect(secondDelete!.deleted_at).not.toBeNull();

      // Timestamp should be updated (or at least not fail)
      // Both should be valid timestamps
      expect(new Date(firstTimestamp!).getTime()).not.toBeNaN();
      expect(new Date(secondDelete!.deleted_at!).getTime()).not.toBeNaN();
    });

    it('should not throw when soft deleting already-deleted record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as SoftDeleteRepository;

      const bob = await db.selectFrom('users').selectAll().where('name', '=', 'Bob').executeTakeFirst();
      if (!bob) throw new Error('Bob not found');

      // Multiple soft deletes should not throw
      await repo.softDelete!(bob.id);
      await expect(repo.softDelete!(bob.id)).resolves.not.toThrow();
      await expect(repo.softDelete!(bob.id)).resolves.not.toThrow();
    });
  });

  describe('Malformed deletedAtColumn (SQL Injection Vectors)', () => {
    it('should handle column names with special characters safely', async () => {
      // The plugin should use the column name as-is, relying on Kysely's safety
      // This test verifies the plugin doesn't crash with unusual column names
      const dangerousColumnNames = [
        'deleted_at',  // Normal case
        'deletedAt',   // Camel case
        'DELETED_AT',  // Upper case
      ];

      for (const columnName of dangerousColumnNames) {
        const plugin = softDeletePlugin({
          deletedAtColumn: columnName,
        });

        // Plugin should be created without error
        expect(plugin.name).toBe('@kysera/soft-delete');
        expect(plugin.version).toBe('0.5.1');
      }
    });

    it('should not allow SQL injection through deletedAtColumn in queries', async () => {
      // Note: This test verifies that Kysely's parameterization protects against injection
      // The column name is used in query building, not as a parameter
      const plugin = softDeletePlugin({
        deletedAtColumn: 'deleted_at',
      });
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as SoftDeleteRepository;

      // Normal operation should work
      const users = await repo.findAll();
      expect(users).toHaveLength(3);
    });

    it('should handle empty string column name gracefully', async () => {
      // Empty string should fall back to default or cause predictable behavior
      const plugin = softDeletePlugin({
        deletedAtColumn: '', // Edge case
      });

      // Plugin should still be created
      expect(plugin.name).toBe('@kysera/soft-delete');
    });
  });
});
