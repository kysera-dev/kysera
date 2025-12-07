import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { paginate, paginateCursor, paginateCursorSimple } from '../src/pagination.js';
import { createTestDatabase, initializeTestSchema, clearTestDatabase, testFactories } from './setup/test-database.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/test-database.js';

describe('Pagination with Real SQLite Database', () => {
  let db: Kysely<TestDatabase>;

  beforeAll(async () => {
    db = createTestDatabase();
    await initializeTestSchema(db);
  });

  beforeEach(async () => {
    await clearTestDatabase(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('Offset-based Pagination', () => {
    beforeEach(async () => {
      // Create 25 users for pagination tests
      const users = Array.from({ length: 25 }, (_, i) =>
        testFactories.user({
          email: `user${i + 1}@example.com`,
          name: `User ${i + 1}`,
        })
      );

      await db.insertInto('users').values(users).execute();
    });

    it('should paginate with default settings', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id', 'asc');

      const result = await paginate(query);

      expect(result.data).toHaveLength(20); // Default limit
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.totalPages).toBe(2);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it('should paginate with custom page and limit', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id', 'asc');

      const result = await paginate(query, { page: 2, limit: 10 });

      expect(result.data).toHaveLength(10);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrev).toBe(true);

      // Verify we got the right users (11-20)
      const firstUser = result.data[0]!;
      expect(firstUser.email).toBe('user11@example.com');
    });

    it('should handle last page correctly', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id', 'asc');

      const result = await paginate(query, { page: 3, limit: 10 });

      expect(result.data).toHaveLength(5); // Only 5 users left
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

    it('should handle page beyond available data', async () => {
      const query = db.selectFrom('users').selectAll().orderBy('id', 'asc');

      const result = await paginate(query, { page: 10, limit: 10 });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.page).toBe(10);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(true);
    });

    it('should handle complex queries with joins', async () => {
      // Create users with posts
      const user1 = await db
        .insertInto('users')
        .values(testFactories.user({ email: 'author1@example.com' }))
        .returningAll()
        .executeTakeFirstOrThrow();

      const user2 = await db
        .insertInto('users')
        .values(testFactories.user({ email: 'author2@example.com' }))
        .returningAll()
        .executeTakeFirstOrThrow();

      // Create multiple posts for each user
      for (let i = 0; i < 15; i++) {
        await db
          .insertInto('posts')
          .values(
            testFactories.post(i % 2 === 0 ? user1.id : user2.id, {
              title: `Post ${i + 1}`,
            })
          )
          .execute();
      }

      const query = db
        .selectFrom('posts')
        .innerJoin('users', 'users.id', 'posts.user_id')
        .select(['posts.id', 'posts.title', 'users.name as author_name'])
        .orderBy('posts.id', 'asc');

      const result = await paginate(query, { page: 1, limit: 5 });

      expect(result.data).toHaveLength(5);
      expect(result.pagination.total).toBe(15);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.data[0]).toHaveProperty('author_name');
    });
  });

  describe('Cursor-based Pagination', () => {
    beforeEach(async () => {
      // Create users with specific IDs for predictable testing
      const users = Array.from({ length: 20 }, (_, i) =>
        testFactories.user({
          email: `cursor${i + 1}@example.com`,
          name: `Cursor User ${i + 1}`,
        })
      );

      await db.insertInto('users').values(users).execute();
    });

    it('should paginate with cursor - first page', async () => {
      const query = db.selectFrom('users').selectAll();

      const result = await paginateCursor(query, {
        orderBy: [{ column: 'id', direction: 'asc' }],
        limit: 5,
      });

      expect(result.data).toHaveLength(5);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.nextCursor).toBeDefined();

      // Verify first user
      expect(result.data[0]!.email).toBe('cursor1@example.com');
    });

    it('should paginate with cursor - subsequent page', async () => {
      const query = db.selectFrom('users').selectAll();

      // Get first page
      const firstPage = await paginateCursor(query, {
        orderBy: [{ column: 'id', direction: 'asc' }],
        limit: 5,
      });

      // Get second page using cursor
      const secondPage = await paginateCursor(query, {
        orderBy: [{ column: 'id', direction: 'asc' }],
        cursor: firstPage.pagination.nextCursor,
        limit: 5,
      });

      expect(secondPage.data).toHaveLength(5);
      expect(secondPage.pagination.hasNext).toBe(true);

      // Verify we got different users
      expect(secondPage.data[0]!.email).toBe('cursor6@example.com');

      // Verify no overlap
      const firstIds = firstPage.data.map((u) => u.id);
      const secondIds = secondPage.data.map((u) => u.id);
      const overlap = firstIds.filter((id) => secondIds.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it('should handle last page with cursor', async () => {
      const query = db.selectFrom('users').selectAll();

      let cursor: string | undefined;
      let pageCount = 0;
      let allUsers: any[] = [];

      // Paginate through all pages
      while (pageCount < 10) {
        // Safety limit
        const result = await paginateCursor(query, {
          orderBy: [{ column: 'id', direction: 'asc' }],
          cursor,
          limit: 7,
        });

        pageCount++;
        allUsers = [...allUsers, ...result.data];

        if (!result.pagination.hasNext) {
          break;
        }

        cursor = result.pagination.nextCursor;
      }

      expect(pageCount).toBe(3); // 20 users / 7 per page = 3 pages
      expect(allUsers).toHaveLength(20);

      // Verify all users are unique
      const uniqueIds = new Set(allUsers.map((u) => u.id));
      expect(uniqueIds.size).toBe(20);
    });

    it('should handle descending order cursor pagination', async () => {
      const query = db.selectFrom('users').selectAll();

      const result = await paginateCursor(query, {
        orderBy: [{ column: 'id', direction: 'desc' }],
        limit: 5,
      });

      expect(result.data).toHaveLength(5);

      // Should get users in descending order
      const ids = result.data.map((u) => u.id);
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]).toBeLessThan(ids[i - 1]!);
      }
    });

    it('should handle multi-column ordering', async () => {
      // Create users with same names for multi-column sorting
      await clearTestDatabase(db);

      const users = [];
      for (let i = 0; i < 10; i++) {
        users.push(
          testFactories.user({
            email: `multi${i}@example.com`,
            name: `Name ${Math.floor(i / 3)}`, // Groups of 3 with same name
          })
        );
      }

      await db.insertInto('users').values(users).execute();

      const query = db.selectFrom('users').selectAll();

      const result = await paginateCursor(query, {
        orderBy: [
          { column: 'name', direction: 'asc' },
          { column: 'id', direction: 'asc' },
        ],
        limit: 4,
      });

      expect(result.data).toHaveLength(4);

      // Verify ordering by name first, then by id
      for (let i = 1; i < result.data.length; i++) {
        const prev = result.data[i - 1]!;
        const curr = result.data[i]!;

        if (prev.name === curr.name) {
          expect(curr.id).toBeGreaterThan(prev.id);
        } else {
          expect(curr.name >= prev.name).toBe(true);
        }
      }
    });
  });

  describe('Simple Cursor Pagination', () => {
    beforeEach(async () => {
      const users = Array.from({ length: 10 }, (_, i) =>
        testFactories.user({
          email: `simple${i + 1}@example.com`,
          name: `Simple User ${i + 1}`,
        })
      );

      await db.insertInto('users').values(users).execute();
    });

    it('should use simple cursor with id ordering', async () => {
      const query = db.selectFrom('users').selectAll();

      const firstPage = await paginateCursorSimple(query, { limit: 3 });

      expect(firstPage.data).toHaveLength(3);
      expect(firstPage.pagination.hasNext).toBe(true);
      expect(firstPage.pagination.nextCursor).toBeDefined();

      // Get second page
      const secondPage = await paginateCursorSimple(query, {
        cursor: firstPage.pagination.nextCursor,
        limit: 3,
      });

      expect(secondPage.data).toHaveLength(3);

      // Verify different users
      const firstIds = firstPage.data.map((u) => u.id);
      const secondIds = secondPage.data.map((u) => u.id);
      expect(firstIds).not.toEqual(secondIds);
    });
  });

  describe('Edge Cases', () => {
    it('should handle limit of 0', async () => {
      await db.insertInto('users').values(testFactories.user()).execute();

      const query = db.selectFrom('users').selectAll();
      const result = await paginate(query, { limit: 0 });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.limit).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('should handle very large page numbers', async () => {
      await db.insertInto('users').values(testFactories.user()).execute();

      const query = db.selectFrom('users').selectAll();
      const result = await paginate(query, { page: 999999 });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.page).toBe(999999);
    });

    it('should handle queries with WHERE clauses', async () => {
      const users = Array.from({ length: 20 }, (_, i) =>
        testFactories.user({
          email: `filter${i + 1}@example.com`,
          name: i < 10 ? 'Group A' : 'Group B',
        })
      );

      await db.insertInto('users').values(users).execute();

      const query = db.selectFrom('users').selectAll().where('name', '=', 'Group A').orderBy('id', 'asc');

      const result = await paginate(query, { limit: 5 });

      expect(result.data).toHaveLength(5);
      expect(result.pagination.total).toBe(10);
      expect(result.data.every((u) => u.name === 'Group A')).toBe(true);
    });
  });
});
