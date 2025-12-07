import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, seedTestData } from './setup/database.js';
import { paginate, paginateCursor } from '../src/pagination.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';

describe('Pagination', () => {
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

  describe('Offset Pagination', () => {
    it('should paginate with default options', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id');
      const result = await paginate(query);

      expect(result.data).toHaveLength(3); // All users
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20); // Default limit
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it('should paginate with custom page and limit', async () => {
      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await paginate(query, { page: 1, limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(2);
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.totalPages).toBe(2);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it('should handle page 2 correctly', async () => {
      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await paginate(query, { page: 2, limit: 2 });

      expect(result.data).toHaveLength(1); // Only 1 post left
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(true);
    });

    it('should handle empty results', async () => {
      const query = db.selectFrom('users').selectAll().where('email', '=', 'nonexistent@example.com');

      const result = await paginate(query);

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it('should work with complex queries', async () => {
      const query = db
        .selectFrom('posts')
        .innerJoin('users', 'users.id', 'posts.user_id')
        .select(['posts.id', 'posts.title', 'users.name as author'])
        .where('posts.published', '=', 1) // SQLite uses 0/1 for boolean
        .orderBy('posts.id');

      const result = await paginate(query, { limit: 10 });

      expect(result.data).toHaveLength(2); // Only published posts
      expect(result.data[0]).toHaveProperty('author');
    });
  });

  describe('Cursor Pagination', () => {
    it('should paginate forward from beginning', async () => {
      const query = db.selectFrom('users').selectAll();
      const result = await paginateCursor(query, {
        limit: 2,
        orderBy: [{ column: 'id', direction: 'asc' }],
      });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.limit).toBe(2);
      expect(result.pagination.hasNext).toBe(true);
      // Note: Cursor pagination doesn't track hasPrev
      expect(result.pagination.nextCursor).toBeDefined();
    });

    it('should paginate forward with cursor', async () => {
      const query = db.selectFrom('users').selectAll();

      // Get first page
      const firstPage = await paginateCursor(query, {
        limit: 1,
        orderBy: [{ column: 'id', direction: 'asc' }],
      });

      expect(firstPage.data).toHaveLength(1);
      expect(firstPage.pagination.nextCursor).toBeDefined();

      // Get second page using cursor
      const secondPage = await paginateCursor(query, {
        limit: 1,
        cursor: firstPage.pagination.nextCursor,
        orderBy: [{ column: 'id', direction: 'asc' }],
      });

      expect(secondPage.data).toHaveLength(1);
      expect(secondPage.data[0]!.id).toBeGreaterThan(firstPage.data[0]!.id);
    });

    it('should paginate with descending order', async () => {
      const query = db.selectFrom('users').selectAll();

      // Get first page with descending order
      const result = await paginateCursor(query, {
        limit: 2,
        orderBy: [{ column: 'id', direction: 'desc' }],
      });

      expect(result.data).toHaveLength(2);
      // Should get users with highest IDs first
      expect(result.data[0]!.id).toBeGreaterThan(result.data[1]!.id);
      expect(result.pagination.hasNext).toBe(true);
    });

    it('should handle multi-column ordering', async () => {
      // Insert posts with same user_id to test multi-column ordering
      const query = db.selectFrom('posts').selectAll();

      const result = await paginateCursor(query, {
        limit: 2,
        orderBy: [
          { column: 'user_id', direction: 'asc' },
          { column: 'id', direction: 'asc' },
        ],
      });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.nextCursor).toBeDefined();

      // Verify ordering
      if (result.data.length > 1) {
        const first = result.data[0]!;
        const second = result.data[1]!;

        if (first.user_id === second.user_id) {
          expect(first.id).toBeLessThan(second.id);
        } else {
          expect(first.user_id).toBeLessThanOrEqual(second.user_id);
        }
      }
    });

    it('should handle empty results', async () => {
      const query = db.selectFrom('users').selectAll().where('email', '=', 'nonexistent@example.com');

      const result = await paginateCursor(query, {
        limit: 10,
        orderBy: [{ column: 'id', direction: 'asc' }],
      });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.nextCursor).toBeUndefined();
    });

    it('should work with complex joins', async () => {
      const query = db
        .selectFrom('posts')
        .innerJoin('users', 'users.id', 'posts.user_id')
        .select(['posts.id', 'posts.title', 'posts.user_id', 'users.name as author'])
        .where('posts.published', '=', 1); // SQLite uses 0/1 for boolean

      const result = await paginateCursor(query, {
        limit: 1,
        orderBy: [{ column: 'title' as any, direction: 'asc' }],
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toHaveProperty('author');
      expect(result.pagination.nextCursor).toBeDefined();
    });

    it('should encode and decode cursors correctly', async () => {
      const query = db.selectFrom('users').selectAll();

      const result = await paginateCursor(query, {
        limit: 1,
        orderBy: [{ column: 'id', direction: 'asc' }],
      });

      const cursor = result.pagination.nextCursor!;
      expect(cursor).toBeDefined();

      // Cursor should be base64 encoded
      expect(() => Buffer.from(cursor, 'base64')).not.toThrow();

      // Should be able to use cursor for next page
      const nextPage = await paginateCursor(query, {
        limit: 1,
        cursor,
        orderBy: [{ column: 'id', direction: 'asc' }],
      });

      expect(nextPage.data).toHaveLength(1);
      expect(nextPage.data[0]!.id).not.toBe(result.data[0]!.id);
    });
  });

  describe('Pagination Edge Cases', () => {
    it('should handle limit of 0', async () => {
      const query = db.selectFrom('users').selectAll();
      const result = await paginate(query, { limit: 0 });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.limit).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('should handle very large page numbers', async () => {
      const query = db.selectFrom('users').selectAll();
      const result = await paginate(query, { page: 1000, limit: 10 });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.page).toBe(1000);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(true);
    });

    it('should handle negative page numbers', async () => {
      const query = db.selectFrom('users').selectAll();
      const result = await paginate(query, { page: -1, limit: 10 });

      // Should default to page 1
      expect(result.pagination.page).toBe(1);
      expect(result.data).toHaveLength(3);
    });

    it('should handle cursor pagination with deleted records', async () => {
      // Soft delete a user
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() as any }) // SQLite stores dates as strings
        .where('email', '=', 'bob@example.com')
        .execute();

      const query = db.selectFrom('users').selectAll().where('deleted_at', 'is', null);

      const result = await paginateCursor(query, {
        limit: 10,
        orderBy: [{ column: 'id', direction: 'asc' }],
      });

      expect(result.data).toHaveLength(2); // Only non-deleted users
    });
  });
});
