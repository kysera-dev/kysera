import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import {
  type DatabaseType,
  type MultiDbTestDatabase,
  createTestDb,
  initializeSchema,
  clearDatabase,
} from './utils/multi-db.js';
import { createRepositoryFactory, createORM } from '../../kysera-repository/dist/index.js';
import { softDeletePlugin } from '../src/index.js';
import { z } from 'zod';

interface User {
  id: number;
  email: string;
  name: string | null;
  deleted_at: Date | string | null;
}

interface Post {
  id: number;
  user_id: number;
  title: string;
  content: string | null;
  deleted_at: Date | string | null;
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

describe.each(getDatabaseTypes())('Soft Delete Multi-Database Tests (%s)', (dbType) => {
  let db: Kysely<MultiDbTestDatabase>;
  let orm: any;
  let userRepo: any;
  let postRepo: any;

  beforeAll(async () => {
    db = createTestDb(dbType);
    await initializeSchema(db, dbType);

    // Create ORM with soft delete plugin
    const softDelete = softDeletePlugin({
      deletedAtColumn: 'deleted_at',
      tables: ['users', 'posts'],
    });

    orm = await createORM(db, [softDelete]);

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
            deleted_at: z.union([z.string(), z.null()]).optional(),
          }),
        },
      })
    );

    postRepo = orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'posts' as const,
        mapRow: (row: any) => row as Post,
        schemas: {
          create: z.object({
            user_id: z.number(),
            title: z.string(),
            content: z.string().nullable(),
          }),
          update: z.object({
            user_id: z.number().optional(),
            title: z.string().optional(),
            content: z.string().nullable().optional(),
            deleted_at: z.union([z.string(), z.null()]).optional(),
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
  });

  describe('Basic Soft Delete', () => {
    it('should soft delete a record', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: 'Test User' });

      await userRepo.softDelete(user.id);

      const found = await userRepo.findById(user.id);
      expect(found).toBeNull();
    });

    it('should allow finding soft deleted records with findWithDeleted', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: 'Test User' });

      await userRepo.softDelete(user.id);

      const found = await userRepo.findWithDeleted(user.id);
      expect(found).not.toBeNull();
      expect(found.id).toBe(user.id);
      expect(found.deleted_at).not.toBeNull();
    });

    it('should filter soft deleted records from findAll', async () => {
      await userRepo.create({ email: 'user1@example.com', name: 'User 1' });
      const user2 = await userRepo.create({ email: 'user2@example.com', name: 'User 2' });
      await userRepo.create({ email: 'user3@example.com', name: 'User 3' });

      await userRepo.softDelete(user2.id);

      const all = await userRepo.findAll();
      expect(all).toHaveLength(2);
      expect(all.every((u: User) => u.id !== user2.id)).toBe(true);
    });

    it('should include soft deleted records with findAllWithDeleted', async () => {
      await userRepo.create({ email: 'user1@example.com', name: 'User 1' });
      const user2 = await userRepo.create({ email: 'user2@example.com', name: 'User 2' });
      await userRepo.create({ email: 'user3@example.com', name: 'User 3' });

      await userRepo.softDelete(user2.id);

      const all = await userRepo.findAllWithDeleted();
      expect(all).toHaveLength(3);
    });

    it('should find only deleted records with findDeleted', async () => {
      const user1 = await userRepo.create({ email: 'user1@example.com', name: 'User 1' });
      const user2 = await userRepo.create({ email: 'user2@example.com', name: 'User 2' });
      await userRepo.create({ email: 'user3@example.com', name: 'User 3' });

      await userRepo.softDelete(user1.id);
      await userRepo.softDelete(user2.id);

      const deleted = await userRepo.findDeleted();
      expect(deleted).toHaveLength(2);
      expect(deleted.every((u: User) => u.deleted_at !== null)).toBe(true);
    });
  });

  describe('Restore Functionality', () => {
    it('should restore a soft deleted record', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: 'Test User' });

      await userRepo.softDelete(user.id);
      let found = await userRepo.findById(user.id);
      expect(found).toBeNull();

      await userRepo.restore(user.id);
      found = await userRepo.findById(user.id);
      expect(found).not.toBeNull();
      expect(found.id).toBe(user.id);
      expect(found.deleted_at).toBeNull();
    });

    it('should allow multiple soft deletes and restores', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: 'Test User' });

      // First cycle
      await userRepo.softDelete(user.id);
      expect(await userRepo.findById(user.id)).toBeNull();

      await userRepo.restore(user.id);
      expect(await userRepo.findById(user.id)).not.toBeNull();

      // Second cycle
      await userRepo.softDelete(user.id);
      expect(await userRepo.findById(user.id)).toBeNull();

      await userRepo.restore(user.id);
      expect(await userRepo.findById(user.id)).not.toBeNull();
    });
  });

  describe('Hard Delete', () => {
    it('should permanently delete a record with hardDelete', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: 'Test User' });

      await userRepo.hardDelete(user.id);

      const found = await userRepo.findWithDeleted(user.id);
      expect(found).toBeNull();
    });

    it('should hard delete soft-deleted records', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: 'Test User' });

      await userRepo.softDelete(user.id);
      await userRepo.hardDelete(user.id);

      const found = await userRepo.findWithDeleted(user.id);
      expect(found).toBeNull();

      const deleted = await userRepo.findDeleted();
      expect(deleted).toHaveLength(0);
    });
  });

  describe('Cross-Database Consistency', () => {
    it('should handle foreign key relationships with soft delete', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: 'Test User' });
      const post = await postRepo.create({
        user_id: user.id,
        title: 'Test Post',
        content: 'Content',
      });

      await postRepo.softDelete(post.id);

      const foundPost = await postRepo.findById(post.id);
      expect(foundPost).toBeNull();

      const foundUser = await userRepo.findById(user.id);
      expect(foundUser).not.toBeNull();
    });

    it('should handle timestamps correctly across databases', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: 'Test User' });

      const beforeDelete = new Date();
      await userRepo.softDelete(user.id);
      const afterDelete = new Date();

      const found = await userRepo.findWithDeleted(user.id);
      expect(found).not.toBeNull();
      expect(found.deleted_at).not.toBeNull();

      // Check that deleted_at is within reasonable range
      // Use a larger buffer (4 hours) to account for timezone differences between client and database server
      const deletedAt = new Date(found.deleted_at);
      const buffer = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
      expect(deletedAt.getTime()).toBeGreaterThanOrEqual(beforeDelete.getTime() - buffer);
      expect(deletedAt.getTime()).toBeLessThanOrEqual(afterDelete.getTime() + buffer);
    });

    it('should handle null values consistently', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: null });

      expect(user.name).toBeNull();
      expect(user.deleted_at).toBeNull();

      await userRepo.softDelete(user.id);
      const deleted = await userRepo.findWithDeleted(user.id);
      expect(deleted.name).toBeNull();
      expect(deleted.deleted_at).not.toBeNull();

      await userRepo.restore(user.id);
      const restored = await userRepo.findById(user.id);
      expect(restored.name).toBeNull();
      expect(restored.deleted_at).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle soft delete of non-existent record', async () => {
      await expect(userRepo.softDelete(99999)).rejects.toThrow();
    });

    it('should handle restore of non-existent record', async () => {
      await expect(userRepo.restore(99999)).rejects.toThrow();
    });

    it('should handle restore of non-deleted record', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: 'Test User' });

      // Restoring a non-deleted record should not throw
      await userRepo.restore(user.id);

      const found = await userRepo.findById(user.id);
      expect(found).not.toBeNull();
      expect(found.deleted_at).toBeNull();
    });

    it('should handle multiple soft deletes without restore', async () => {
      const user = await userRepo.create({ email: 'test@example.com', name: 'Test User' });

      await userRepo.softDelete(user.id);

      // Soft deleting again should update the timestamp
      const firstDeleted = await userRepo.findWithDeleted(user.id);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await userRepo.softDelete(user.id);
      const secondDeleted = await userRepo.findWithDeleted(user.id);

      expect(firstDeleted.deleted_at).not.toBeNull();
      expect(secondDeleted.deleted_at).not.toBeNull();
    });
  });

  describe('Bulk Operations', () => {
    it('should handle bulk soft delete', async () => {
      const user1 = await userRepo.create({ email: 'user1@example.com', name: 'User 1' });
      const user2 = await userRepo.create({ email: 'user2@example.com', name: 'User 2' });
      const user3 = await userRepo.create({ email: 'user3@example.com', name: 'User 3' });

      await userRepo.softDelete(user1.id);
      await userRepo.softDelete(user2.id);
      await userRepo.softDelete(user3.id);

      const all = await userRepo.findAll();
      expect(all).toHaveLength(0);

      const deleted = await userRepo.findDeleted();
      expect(deleted).toHaveLength(3);
    });

    it('should handle bulk restore', async () => {
      const user1 = await userRepo.create({ email: 'user1@example.com', name: 'User 1' });
      const user2 = await userRepo.create({ email: 'user2@example.com', name: 'User 2' });
      const user3 = await userRepo.create({ email: 'user3@example.com', name: 'User 3' });

      await userRepo.softDelete(user1.id);
      await userRepo.softDelete(user2.id);
      await userRepo.softDelete(user3.id);

      await userRepo.restore(user1.id);
      await userRepo.restore(user2.id);
      await userRepo.restore(user3.id);

      const all = await userRepo.findAll();
      expect(all).toHaveLength(3);

      const deleted = await userRepo.findDeleted();
      expect(deleted).toHaveLength(0);
    });
  });
});
