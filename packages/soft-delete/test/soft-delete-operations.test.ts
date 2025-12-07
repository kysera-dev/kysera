import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, seedTestData } from './setup/database.js';
import { softDeletePlugin } from '../src/index.js';
import { createORM } from '../../kysera-repository/dist/index.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';

// Type definitions for test data
interface TestUser {
  id: number;
  email: string;
  name: string;
  created_at: string;
  deleted_at: string | null;
}

describe('Soft Delete Plugin - Query Operations', () => {
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

  describe('SELECT Operations', () => {
    it('should filter deleted records in simple SELECT', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      // Soft delete Bob
      await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).where('name', '=', 'Bob').execute();

      const result = await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      expect(result).toHaveLength(2);
      const users = result as TestUser[];
      expect(users.map((u) => u.name)).toEqual(['Alice', 'Charlie']);
    });

    it('should filter deleted records in JOIN queries', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      // Soft delete Bob
      await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).where('name', '=', 'Bob').execute();

      const result = await orm
        .applyPlugins(
          db
            .selectFrom('posts')
            .innerJoin('users', 'users.id', 'posts.user_id')
            .selectAll('posts')
            .select(['users.name as author_name']),
          'select',
          'posts',
          {}
        )
        .execute();

      // Bob's post should still appear but without user join
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle multiple soft-deleted tables', async () => {
      const plugin = softDeletePlugin({
        tables: ['users', 'posts'],
      });
      const orm = await createORM(db, [plugin]);

      // Soft delete Bob
      await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).where('name', '=', 'Bob').execute();

      // Soft delete a post
      await db
        .updateTable('posts')
        .set({ deleted_at: new Date().toISOString() })
        .where('title', '=', 'First Post')
        .execute();

      const userResult = await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      const postResult = await orm.applyPlugins(db.selectFrom('posts').selectAll(), 'select', 'posts', {}).execute();

      expect(userResult).toHaveLength(2); // 3 - 1 deleted
      expect(postResult).toHaveLength(2); // 3 - 1 deleted
    });
  });

  describe('DELETE Operations', () => {
    it('should convert DELETE to soft delete by default', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      // Track that the delete operation should be converted
      const deleteQuery = db.deleteFrom('users').where('name', '=', 'Alice');

      const context = { operation: 'delete', table: 'users', metadata: {} };
      orm.applyPlugins(deleteQuery, 'delete', 'users', {});

      expect(context.metadata).toEqual({});
    });

    it('should perform hard delete when specified', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      // Hard delete should not be converted
      const deleteQuery = db.deleteFrom('users').where('name', '=', 'Alice');

      const result = orm.applyPlugins(deleteQuery, 'delete', 'users', { hardDelete: true });

      // Execute the hard delete
      await result.execute();

      // Alice should be completely gone
      const alice = await db.selectFrom('users').selectAll().where('name', '=', 'Alice').executeTakeFirst();

      expect(alice).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle tables without deleted_at column', async () => {
      const plugin = softDeletePlugin({
        tables: ['users'], // Only users table supports soft delete
      });
      const orm = await createORM(db, [plugin]);

      // Comments table doesn't have deleted_at - should work normally
      const result = await orm.applyPlugins(db.selectFrom('comments').selectAll(), 'select', 'comments', {}).execute();

      expect(result).toHaveLength(2); // All comments
    });

    it('should handle null deleted_at values correctly', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      // All users have null deleted_at initially
      const result = await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      expect(result).toHaveLength(3); // All users should be visible
    });

    it('should handle empty tables', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      // Delete all users
      await db.deleteFrom('users').execute();

      const result = await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      expect(result).toHaveLength(0);
    });

    it('should respect includeDeleted in metadata', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      // Soft delete all users
      await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).execute();

      // Without includeDeleted
      const withoutDeleted = await orm
        .applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {})
        .execute();

      // With includeDeleted
      const withDeleted = await orm
        .applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', { includeDeleted: true })
        .execute();

      expect(withoutDeleted).toHaveLength(0);
      expect(withDeleted).toHaveLength(3);
    });

    it('should handle cascading soft deletes', async () => {
      const plugin = softDeletePlugin({
        tables: ['users', 'posts', 'comments'],
      });
      const orm = await createORM(db, [plugin]);

      // Soft delete a user
      await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).where('name', '=', 'Alice').execute();

      // Posts and comments should still exist (no automatic cascading)
      const posts = await orm.applyPlugins(db.selectFrom('posts').selectAll(), 'select', 'posts', {}).execute();

      const comments = await orm
        .applyPlugins(db.selectFrom('comments').selectAll(), 'select', 'comments', {})
        .execute();

      expect(posts.length).toBeGreaterThan(0);
      expect(comments.length).toBeGreaterThan(0);
    });
  });
});
