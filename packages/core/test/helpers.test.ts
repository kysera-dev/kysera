import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, seedTestData } from './setup/database.js';
import { applyOffset, applyDateRange } from '../src/helpers.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';

describe('Query Helpers', () => {
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

  describe('applyOffset', () => {
    it('should apply default behavior when no options provided', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id');
      const result = await applyOffset(query).execute();

      // Without options, query should be unchanged (no limit/offset)
      expect(result).toHaveLength(3); // All users
    });

    it('should apply limit only', async () => {
      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await applyOffset(query, { limit: 2 }).execute();

      expect(result).toHaveLength(2); // First 2 posts
      expect(result[0]?.title).toBe('First Post');
      expect(result[1]?.title).toBe('Second Post');
    });

    it('should apply offset only', async () => {
      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await applyOffset(query, { offset: 1 }).execute();

      expect(result).toHaveLength(2); // Posts after first one
      expect(result[0]?.title).toBe('Second Post');
      expect(result[1]?.title).toBe("Bob's Post");
    });

    it('should apply both limit and offset', async () => {
      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await applyOffset(query, { limit: 1, offset: 1 }).execute();

      expect(result).toHaveLength(1);
      expect(result[0]?.title).toBe('Second Post');
    });

    it('should enforce maximum limit of 100', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id');

      // Insert many more users to test limit
      const extraUsers = Array.from({ length: 150 }, (_, i) => ({
        email: `user${i}@example.com`,
        name: `User ${i}`,
      }));
      await db.insertInto('users').values(extraUsers).execute();

      const result = await applyOffset(query, { limit: 200 }).execute();

      expect(result).toHaveLength(100); // Should be capped at 100
    });

    it('should enforce minimum limit of 1', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id');
      const result = await applyOffset(query, { limit: 0 }).execute();

      expect(result).toHaveLength(1); // Should be at least 1
    });

    it('should enforce minimum offset of 0', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id');
      const result = await applyOffset(query, { offset: -10 }).execute();

      // Should treat negative offset as 0
      expect(result).toHaveLength(3); // All users
      expect(result[0]?.name).toBe('Alice'); // First user
    });

    it('should work with complex queries', async () => {
      const query = db
        .selectFrom('posts')
        .innerJoin('users', 'users.id', 'posts.user_id')
        .select(['posts.id', 'posts.title', 'users.name as author'])
        .where('posts.published', '=', 1)
        .orderBy('posts.id');

      const result = await applyOffset(query, { limit: 1 }).execute();

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('author');
      expect(result[0]?.title).toBe('First Post');
    });

    it('should return empty array when offset exceeds total rows', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id');
      const result = await applyOffset(query, { offset: 100 }).execute();

      expect(result).toHaveLength(0);
    });

    it('should work with transactions', async () => {
      await db.transaction().execute(async (trx) => {
        const query = trx.selectFrom('users').selectAll().orderBy('id');
        const result = await applyOffset(query, { limit: 2 }).execute();

        expect(result).toHaveLength(2);
      });
    });

    it('should support infinite scroll pattern', async () => {
      // Simulate loading pages
      const page1 = await applyOffset(
        db.selectFrom('posts').selectAll().orderBy('id'),
        { limit: 2, offset: 0 }
      ).execute();

      const page2 = await applyOffset(
        db.selectFrom('posts').selectAll().orderBy('id'),
        { limit: 2, offset: 2 }
      ).execute();

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1); // Last page has only 1 post
      expect(page1[0]?.id).not.toBe(page2[0]?.id); // Different results
    });

    it('should preserve existing WHERE clauses', async () => {
      const query = db
        .selectFrom('posts')
        .selectAll()
        .where('published', '=', 1)
        .orderBy('id');

      const result = await applyOffset(query, { limit: 10 }).execute();

      expect(result).toHaveLength(2); // Only 2 published posts
      expect(result.every((post) => post.published === 1)).toBe(true);
    });
  });

  describe('applyDateRange', () => {
    it('should return unchanged query when no options provided', async () => {
      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await applyDateRange(query, 'created_at').execute();

      expect(result).toHaveLength(3); // All posts
    });

    it('should filter by from date (inclusive)', async () => {
      // Use a date that's definitely before all posts
      const veryOldDate = new Date('2000-01-01');

      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await applyDateRange(query, 'created_at', {
        from: veryOldDate,
      }).execute();

      // Should include all posts (created after 2000-01-01)
      expect(result.length).toBe(3);
    });

    it('should filter by to date (inclusive)', async () => {
      // Use a future date that's definitely after all posts
      const futureDate = new Date('2099-12-31');

      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await applyDateRange(query, 'created_at', {
        to: futureDate,
      }).execute();

      // Should include all posts (created before 2099-12-31)
      expect(result).toHaveLength(3);
    });

    it('should filter by both from and to dates', async () => {
      // Use a wide date range that includes all posts
      const oldDate = new Date('2000-01-01');
      const futureDate = new Date('2099-12-31');

      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await applyDateRange(query, 'created_at', {
        from: oldDate,
        to: futureDate,
      }).execute();

      // Should include all posts in the wide range
      expect(result).toHaveLength(3);
    });

    it('should work with future dates', async () => {
      const futureDate = new Date('2099-12-31');

      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await applyDateRange(query, 'created_at', {
        from: futureDate,
      }).execute();

      expect(result).toHaveLength(0); // No posts in the future
    });

    it('should work with past dates', async () => {
      const pastDate = new Date('2000-01-01');

      const query = db.selectFrom('posts').selectAll().orderBy('id');
      const result = await applyDateRange(query, 'created_at', {
        to: pastDate,
      }).execute();

      expect(result).toHaveLength(0); // No posts that old
    });

    it('should work with complex queries', async () => {
      const posts = await db.selectFrom('posts').selectAll().orderBy('id').execute();

      const query = db
        .selectFrom('posts')
        .innerJoin('users', 'users.id', 'posts.user_id')
        .select(['posts.id', 'posts.title', 'users.name as author', 'posts.created_at'])
        .where('posts.published', '=', 1)
        .orderBy('posts.created_at');

      const result = await applyDateRange(query, 'posts.created_at', {
        from: posts[0]!.created_at,
        to: posts[2]!.created_at,
      }).execute();

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('author');
    });

    it('should work with transactions', async () => {
      await db.transaction().execute(async (trx) => {
        const futureDate = new Date('2099-12-31');

        const query = trx.selectFrom('posts').selectAll().orderBy('id');
        const result = await applyDateRange(query, 'created_at', {
          to: futureDate,
        }).execute();

        expect(result).toHaveLength(3);
      });
    });

    it('should preserve existing WHERE clauses', async () => {
      const posts = await db.selectFrom('posts').selectAll().orderBy('id').execute();

      const query = db
        .selectFrom('posts')
        .selectAll()
        .where('published', '=', 1)
        .orderBy('id');

      const result = await applyDateRange(query, 'created_at', {
        from: posts[0]!.created_at,
        to: posts[2]!.created_at,
      }).execute();

      // Should only get published posts within date range
      expect(result.every((post) => post.published === 1)).toBe(true);
    });

    it('should work with nullable date columns', async () => {
      // Use updated_at which is nullable
      const query = db.selectFrom('posts').selectAll().orderBy('id');

      // Should not throw error with nullable column
      const result = await applyDateRange(query, 'updated_at', {
        from: new Date('2000-01-01'),
      }).execute();

      // Will return empty since updated_at is null for all posts
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Combining applyOffset and applyDateRange', () => {
    it('should work together for paginated date-filtered results', async () => {
      const posts = await db.selectFrom('posts').selectAll().orderBy('id').execute();

      // First, apply date range, then apply offset
      const result = await applyOffset(
        applyDateRange(
          db.selectFrom('posts').selectAll().orderBy('created_at'),
          'created_at',
          {
            from: posts[0]!.created_at,
            to: posts[2]!.created_at,
          }
        ),
        { limit: 2, offset: 0 }
      ).execute();

      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should support analytics query pattern', async () => {
      const posts = await db.selectFrom('posts').selectAll().orderBy('id').execute();

      // Realistic analytics query: published posts in date range, paginated
      const query = applyOffset(
        applyDateRange(
          db
            .selectFrom('posts')
            .select(['id', 'title', 'created_at'])
            .where('published', '=', 1)
            .orderBy('created_at', 'desc'),
          'created_at',
          {
            from: posts[0]!.created_at,
            to: posts[2]!.created_at,
          }
        ),
        { limit: 10, offset: 0 }
      );

      const result = await query.execute();

      expect(result.every((post) => post.id !== undefined)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('should support last N days pattern', async () => {
      // Helper function to get last N days date range
      const getLastNDays = (days: number) => {
        const now = new Date();
        const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        return { from, to: now };
      };

      const query = applyOffset(
        applyDateRange(
          db.selectFrom('posts').selectAll().orderBy('created_at', 'desc'),
          'created_at',
          getLastNDays(365) // Last year
        ),
        { limit: 20 }
      );

      const result = await query.execute();

      expect(Array.isArray(result)).toBe(true);
      // All posts should be within the last year
      expect(result.length).toBeGreaterThan(0);
    });

    it('should preserve order when combining helpers', async () => {
      const posts = await db.selectFrom('posts').selectAll().orderBy('id').execute();

      const result = await applyOffset(
        applyDateRange(
          db.selectFrom('posts').selectAll().orderBy('id', 'asc'),
          'created_at',
          {
            from: posts[0]!.created_at,
          }
        ),
        { limit: 2 }
      ).execute();

      // Results should be ordered by id ascending
      if (result.length === 2) {
        expect(result[0]!.id).toBeLessThan(result[1]!.id);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle applyOffset with limit 1 correctly', async () => {
      const result = await applyOffset(
        db.selectFrom('users').selectAll().orderBy('id'),
        { limit: 1 }
      ).execute();

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Alice');
    });

    it('should handle applyDateRange with same from and to date', async () => {
      const firstPost = await db
        .selectFrom('posts')
        .selectAll()
        .orderBy('id')
        .limit(1)
        .executeTakeFirstOrThrow();

      const result = await applyDateRange(
        db.selectFrom('posts').selectAll().orderBy('id'),
        'created_at',
        {
          from: firstPost.created_at,
          to: firstPost.created_at,
        }
      ).execute();

      // Should return posts created exactly at that timestamp
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]?.created_at).toEqual(firstPost.created_at);
    });

    it('should handle empty table gracefully', async () => {
      // Delete all posts
      await db.deleteFrom('comments').execute();
      await db.deleteFrom('posts').execute();

      const result = await applyOffset(
        applyDateRange(db.selectFrom('posts').selectAll(), 'created_at', {
          from: new Date('2024-01-01'),
        }),
        { limit: 10 }
      ).execute();

      expect(result).toHaveLength(0);
    });

    it('should work with selectAll and specific columns', async () => {
      const result1 = await applyOffset(
        db.selectFrom('posts').selectAll(),
        { limit: 1 }
      ).execute();

      const result2 = await applyOffset(
        db.selectFrom('posts').select(['id', 'title']),
        { limit: 1 }
      ).execute();

      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1);
      expect(result2[0]).toHaveProperty('id');
      expect(result2[0]).toHaveProperty('title');
      expect(result2[0]).not.toHaveProperty('content'); // Not selected
    });
  });
});
