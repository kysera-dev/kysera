import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, seedTestData } from './setup/database.js';
import { softDeletePlugin, type SoftDeleteRepository } from '../src/index.js';
import { createORM, createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';
import { z } from 'zod';

// Type definitions for test data
interface TestUser {
  id: number;
  email: string;
  name: string;
  created_at: string;
  deleted_at: string | null;
}

describe('Soft Delete Plugin - Batch Operations', () => {
  let db: Kysely<TestDatabase>;
  let cleanup: () => void;
  let userRepo: SoftDeleteRepository<TestUser, TestDatabase>;

  beforeEach(async () => {
    const setup = createTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    await seedTestData(db);

    // Create repository with soft delete plugin
    const plugin = softDeletePlugin();
    const orm = await createORM(db, [plugin]);

    userRepo = orm.createRepository((executor) => {
      const factory = createRepositoryFactory(executor);
      return factory.create<'users', TestUser>({
        tableName: 'users',
        mapRow: (row) => row as TestUser,
        schemas: {
          create: z.object({
            email: z.string().email(),
            name: z.string(),
          }),
          update: z.object({
            email: z.string().email().optional(),
            name: z.string().optional(),
            deleted_at: z.string().nullable().optional(),
          }),
        },
      });
    }) as SoftDeleteRepository<TestUser, TestDatabase>;
  });

  afterEach(() => {
    cleanup();
  });

  describe('softDeleteMany', () => {
    it('should soft delete multiple records efficiently', async () => {
      // Get user IDs
      const allUsers = await userRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id).slice(0, 2); // Alice and Bob

      // Soft delete multiple users
      const deletedUsers = await userRepo.softDeleteMany(userIds);

      // Verify return value
      expect(deletedUsers).toHaveLength(2);
      expect(deletedUsers.every((u: TestUser) => u.deleted_at !== null)).toBe(true);

      // Verify records are filtered from normal queries
      const remainingUsers = await userRepo.findAll();
      expect(remainingUsers).toHaveLength(1); // Only Charlie
      expect(remainingUsers[0]?.name).toBe('Charlie');

      // Verify records still exist with deleted_at set
      const allUsersWithDeleted = await userRepo.findAllWithDeleted();
      expect(allUsersWithDeleted).toHaveLength(3);

      // Verify only soft-deleted records
      const deletedOnly = await userRepo.findDeleted();
      expect(deletedOnly).toHaveLength(2);
      expect(deletedOnly.map((u: TestUser) => u.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should handle empty array gracefully', async () => {
      const result = await userRepo.softDeleteMany([]);
      expect(result).toEqual([]);

      // Verify no records were affected
      const allUsers = await userRepo.findAll();
      expect(allUsers).toHaveLength(3);
    });

    it('should throw error if any record not found', async () => {
      const allUsers = await userRepo.findAll();
      const validId = allUsers[0]!.id;
      const invalidId = 99999;

      await expect(userRepo.softDeleteMany([validId, invalidId])).rejects.toThrow(
        'Records not found'
      );
    });

    it('should support both numeric and string IDs', async () => {
      const allUsers = await userRepo.findAll();
      const numericIds = allUsers.map((u: TestUser) => u.id).slice(0, 2);
      const stringIds = numericIds.map(String);

      // Soft delete with string IDs
      const deletedUsers = await userRepo.softDeleteMany(stringIds);

      expect(deletedUsers).toHaveLength(2);
      expect(deletedUsers.every((u: TestUser) => u.deleted_at !== null)).toBe(true);
    });

    it('should handle single ID in array', async () => {
      const allUsers = await userRepo.findAll();
      const aliceId = allUsers.find((u: TestUser) => u.name === 'Alice')!.id;

      const deletedUsers = await userRepo.softDeleteMany([aliceId]);

      expect(deletedUsers).toHaveLength(1);
      expect(deletedUsers[0]!.name).toBe('Alice');
      expect(deletedUsers[0]!.deleted_at).not.toBeNull();
    });

    it('should handle all records in table', async () => {
      const allUsers = await userRepo.findAll();
      const allIds = allUsers.map((u: TestUser) => u.id);

      const deletedUsers = await userRepo.softDeleteMany(allIds);

      expect(deletedUsers).toHaveLength(3);

      // All records should be filtered
      const remainingUsers = await userRepo.findAll();
      expect(remainingUsers).toHaveLength(0);

      // But still accessible with findAllWithDeleted
      const withDeleted = await userRepo.findAllWithDeleted();
      expect(withDeleted).toHaveLength(3);
    });

    it('should set timestamps correctly on all records', async () => {
      const allUsers = await userRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id);

      const deletedUsers = await userRepo.softDeleteMany(userIds);

      // All records should have deleted_at timestamp set (not null)
      for (const user of deletedUsers) {
        expect(user.deleted_at).not.toBeNull();
        expect(typeof user.deleted_at).toBe('string');
        // Just verify it's a valid timestamp string
        expect(user.deleted_at!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('restoreMany', () => {
    it('should restore multiple soft-deleted records efficiently', async () => {
      // First, soft delete some users
      const allUsers = await userRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id).slice(0, 2);
      await userRepo.softDeleteMany(userIds);

      // Verify they're deleted
      const afterDelete = await userRepo.findAll();
      expect(afterDelete).toHaveLength(1);

      // Restore them
      const restoredUsers = await userRepo.restoreMany(userIds);

      // Verify return value
      expect(restoredUsers).toHaveLength(2);
      expect(restoredUsers.every((u: TestUser) => u.deleted_at === null)).toBe(true);

      // Verify they're back in normal queries
      const afterRestore = await userRepo.findAll();
      expect(afterRestore).toHaveLength(3);

      // Verify no deleted records remain
      const deleted = await userRepo.findDeleted();
      expect(deleted).toHaveLength(0);
    });

    it('should handle empty array gracefully', async () => {
      const result = await userRepo.restoreMany([]);
      expect(result).toEqual([]);
    });

    it('should restore records even if not deleted', async () => {
      const allUsers = await userRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id).slice(0, 2);

      // Restore without soft deleting first
      const restoredUsers = await userRepo.restoreMany(userIds);

      expect(restoredUsers).toHaveLength(2);
      expect(restoredUsers.every((u: TestUser) => u.deleted_at === null)).toBe(true);
    });

    it('should support both numeric and string IDs', async () => {
      const allUsers = await userRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id).slice(0, 2);
      await userRepo.softDeleteMany(userIds);

      // Restore with string IDs
      const stringIds = userIds.map(String);
      const restoredUsers = await userRepo.restoreMany(stringIds);

      expect(restoredUsers).toHaveLength(2);
      expect(restoredUsers.every((u: TestUser) => u.deleted_at === null)).toBe(true);
    });

    it('should restore mix of deleted and non-deleted records', async () => {
      const allUsers = await userRepo.findAll();
      const aliceId = allUsers.find((u: TestUser) => u.name === 'Alice')!.id;
      const bobId = allUsers.find((u: TestUser) => u.name === 'Bob')!.id;
      const charlieId = allUsers.find((u: TestUser) => u.name === 'Charlie')!.id;

      // Only soft delete Alice and Bob
      await userRepo.softDeleteMany([aliceId, bobId]);

      // Restore all three (Charlie was never deleted)
      const restoredUsers = await userRepo.restoreMany([aliceId, bobId, charlieId]);

      expect(restoredUsers).toHaveLength(3);
      expect(restoredUsers.every((u: TestUser) => u.deleted_at === null)).toBe(true);

      // All should be in normal queries
      const allUsersAfter = await userRepo.findAll();
      expect(allUsersAfter).toHaveLength(3);
    });
  });

  describe('hardDeleteMany', () => {
    it('should permanently delete multiple records efficiently', async () => {
      const allUsers = await userRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id).slice(0, 2);

      // Hard delete
      await userRepo.hardDeleteMany(userIds);

      // Verify they're gone from normal queries
      const afterDelete = await userRepo.findAll();
      expect(afterDelete).toHaveLength(1);
      expect(afterDelete[0]!.name).toBe('Charlie');

      // Verify they're also gone from findAllWithDeleted
      const allWithDeleted = await userRepo.findAllWithDeleted();
      expect(allWithDeleted).toHaveLength(1);

      // Direct query to verify they're really gone
      const directQuery = await db.selectFrom('users').selectAll().execute();
      expect(directQuery).toHaveLength(1);
    });

    it('should handle empty array gracefully', async () => {
      await userRepo.hardDeleteMany([]);

      const allUsers = await userRepo.findAll();
      expect(allUsers).toHaveLength(3);
    });

    it('should support both numeric and string IDs', async () => {
      const allUsers = await userRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id).slice(0, 2);
      const stringIds = userIds.map(String);

      await userRepo.hardDeleteMany(stringIds);

      const afterDelete = await userRepo.findAll();
      expect(afterDelete).toHaveLength(1);
    });

    it('should delete soft-deleted records permanently', async () => {
      const allUsers = await userRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id).slice(0, 2);

      // First soft delete
      await userRepo.softDeleteMany(userIds);

      // Verify soft deleted
      const deleted = await userRepo.findDeleted();
      expect(deleted).toHaveLength(2);

      // Hard delete the soft-deleted records
      await userRepo.hardDeleteMany(userIds);

      // Verify they're completely gone
      const afterHardDelete = await userRepo.findAllWithDeleted();
      expect(afterHardDelete).toHaveLength(1);

      const stillDeleted = await userRepo.findDeleted();
      expect(stillDeleted).toHaveLength(0);
    });

    it('should delete all records in table', async () => {
      const allUsers = await userRepo.findAll();
      const allIds = allUsers.map((u: TestUser) => u.id);

      await userRepo.hardDeleteMany(allIds);

      const remaining = await userRepo.findAllWithDeleted();
      expect(remaining).toHaveLength(0);

      // Direct query
      const directQuery = await db.selectFrom('users').selectAll().execute();
      expect(directQuery).toHaveLength(0);
    });

    it('should not throw error for non-existent IDs', async () => {
      // Hard delete with mix of valid and invalid IDs
      const allUsers = await userRepo.findAll();
      const validId = allUsers[0]!.id;
      const invalidId = 99999;

      // Should not throw, just delete what exists
      await expect(userRepo.hardDeleteMany([validId, invalidId])).resolves.not.toThrow();

      // Verify valid ID was deleted
      const remaining = await userRepo.findAll();
      expect(remaining).toHaveLength(2);
    });
  });

  describe('Batch Operations - Edge Cases', () => {
    it('should handle duplicate IDs in array', async () => {
      const allUsers = await userRepo.findAll();
      const aliceId = allUsers.find((u: TestUser) => u.name === 'Alice')!.id;

      // Soft delete with duplicate IDs - IN clause handles duplicates automatically
      // This will only match one record even though ID appears multiple times
      // We expect this to fail because softDeleteMany verifies count matches
      await expect(userRepo.softDeleteMany([aliceId, aliceId, aliceId])).rejects.toThrow(
        'Records not found'
      );

      // Better approach: deduplicate before calling
      const uniqueIds = Array.from(new Set([aliceId, aliceId, aliceId]));
      const deletedUsers = await userRepo.softDeleteMany(uniqueIds);

      expect(deletedUsers).toHaveLength(1);
      expect(deletedUsers[0]!.name).toBe('Alice');
    });

    it('should work with different table configurations', async () => {
      // Create repository with custom deleted_at column
      const customPlugin = softDeletePlugin({
        deletedAtColumn: 'deleted_at',
        tables: ['users'],
      });

      const customOrm = await createORM(db, [customPlugin]);
      const customRepo = customOrm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'users', TestUser>({
          tableName: 'users',
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.object({
              email: z.string().email(),
              name: z.string(),
            }),
            update: z.object({
              email: z.string().email().optional(),
              name: z.string().optional(),
              deleted_at: z.string().nullable().optional(),
            }),
          },
        });
      }) as SoftDeleteRepository<TestUser, TestDatabase>;

      const allUsers = await customRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id).slice(0, 2);

      const deletedUsers = await customRepo.softDeleteMany(userIds);
      expect(deletedUsers).toHaveLength(2);
    });

    it('should handle large batches', async () => {
      // Insert many more users
      const manyUsers = Array.from({ length: 100 }, (_, i) => ({
        email: `user${i}@example.com`,
        name: `User ${i}`,
      }));

      for (const user of manyUsers) {
        await db.insertInto('users').values(user).execute();
      }

      const allUsers = await userRepo.findAll();
      expect(allUsers.length).toBeGreaterThan(100);

      const idsToDelete = allUsers.map((u: TestUser) => u.id).slice(0, 50);

      // Soft delete 50 records at once
      const deletedUsers = await userRepo.softDeleteMany(idsToDelete);
      expect(deletedUsers).toHaveLength(50);

      const remaining = await userRepo.findAll();
      expect(remaining.length).toBe(allUsers.length - 50);
    });
  });

  describe('Batch Operations - Combined Workflows', () => {
    it('should support soft delete then restore workflow', async () => {
      const allUsers = await userRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id);

      // Soft delete all
      await userRepo.softDeleteMany(userIds);
      expect(await userRepo.findAll()).toHaveLength(0);

      // Restore all
      await userRepo.restoreMany(userIds);
      expect(await userRepo.findAll()).toHaveLength(3);
    });

    it('should support soft delete then hard delete workflow', async () => {
      const allUsers = await userRepo.findAll();
      const userIds = allUsers.map((u: TestUser) => u.id);

      // Soft delete all
      await userRepo.softDeleteMany(userIds);
      expect(await userRepo.findDeleted()).toHaveLength(3);

      // Hard delete the soft-deleted ones
      await userRepo.hardDeleteMany(userIds);
      expect(await userRepo.findAllWithDeleted()).toHaveLength(0);
    });

    it('should mix single and batch operations', async () => {
      const allUsers = await userRepo.findAll();
      const alice = allUsers.find((u: TestUser) => u.name === 'Alice')!;
      const bobAndCharlie = allUsers.filter((u: TestUser) => u.name !== 'Alice').map((u: TestUser) => u.id);

      // Single soft delete
      await userRepo.softDelete(alice.id);

      // Batch soft delete
      await userRepo.softDeleteMany(bobAndCharlie);

      // All should be deleted
      expect(await userRepo.findAll()).toHaveLength(0);
      expect(await userRepo.findDeleted()).toHaveLength(3);
    });
  });
});
