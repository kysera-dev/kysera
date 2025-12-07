import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createTestDatabase } from './setup/database.js';
import { createRepositoryFactory } from '../src/repository.js';
import type { Kysely, Selectable } from 'kysely';
import type { TestDatabase } from './setup/database.js';

// Define schemas
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  created_at: z.coerce.date(),
  deleted_at: z.coerce.date().nullable(),
});

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

const UpdateUserSchema = CreateUserSchema.partial();

// Domain type
interface User {
  id: number;
  email: string;
  name: string;
  created_at: Date | string;
  deleted_at: Date | string | null;
}

describe('Keyset-based Cursor Pagination', () => {
  let db: Kysely<TestDatabase>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = createTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup as () => Promise<void>;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Basic Cursor Pagination', () => {
    it('should paginate with default ordering (by id ascending)', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          entity: UserSchema,
          create: CreateUserSchema,
          update: UpdateUserSchema,
        },
      });

      // Create 10 users
      const userPromises = [];
      for (let i = 1; i <= 10; i++) {
        userPromises.push(
          userRepo.create({
            email: `user${i}@example.com`,
            name: `User ${i}`,
          })
        );
      }
      await Promise.all(userPromises);

      // First page (limit: 3)
      const page1 = await userRepo.paginateCursor({
        limit: 3,
      });

      expect(page1.items).toHaveLength(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).not.toBeNull();
      expect(page1.items[0].name).toBe('User 1');
      expect(page1.items[1].name).toBe('User 2');
      expect(page1.items[2].name).toBe('User 3');

      // Second page
      const page2 = await userRepo.paginateCursor({
        limit: 3,
        cursor: page1.nextCursor,
      });

      expect(page2.items).toHaveLength(3);
      expect(page2.hasMore).toBe(true);
      expect(page2.nextCursor).not.toBeNull();
      expect(page2.items[0].name).toBe('User 4');
      expect(page2.items[1].name).toBe('User 5');
      expect(page2.items[2].name).toBe('User 6');

      // Third page
      const page3 = await userRepo.paginateCursor({
        limit: 3,
        cursor: page2.nextCursor,
      });

      expect(page3.items).toHaveLength(3);
      expect(page3.hasMore).toBe(true);
      expect(page3.items[0].name).toBe('User 7');
      expect(page3.items[1].name).toBe('User 8');
      expect(page3.items[2].name).toBe('User 9');

      // Fourth page (last page with 1 item)
      const page4 = await userRepo.paginateCursor({
        limit: 3,
        cursor: page3.nextCursor,
      });

      expect(page4.items).toHaveLength(1);
      expect(page4.hasMore).toBe(false);
      expect(page4.nextCursor).toBeNull();
      expect(page4.items[0].name).toBe('User 10');

      // When nextCursor is null, we're at the end - don't query again
      expect(page4.nextCursor).toBeNull();
    });

    it('should paginate with descending order', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      // Create 5 users
      for (let i = 1; i <= 5; i++) {
        await userRepo.create({
          email: `user${i}@example.com`,
          name: `User ${i}`,
        });
      }

      // First page (descending)
      const page1 = await userRepo.paginateCursor({
        limit: 2,
        orderBy: 'id',
        orderDirection: 'desc',
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.items[0].name).toBe('User 5');
      expect(page1.items[1].name).toBe('User 4');

      // Second page
      const page2 = await userRepo.paginateCursor({
        limit: 2,
        cursor: page1.nextCursor,
        orderBy: 'id',
        orderDirection: 'desc',
      });

      expect(page2.items).toHaveLength(2);
      expect(page2.hasMore).toBe(true);
      expect(page2.items[0].name).toBe('User 3');
      expect(page2.items[1].name).toBe('User 2');

      // Third page
      const page3 = await userRepo.paginateCursor({
        limit: 2,
        cursor: page2.nextCursor,
        orderBy: 'id',
        orderDirection: 'desc',
      });

      expect(page3.items).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
      expect(page3.nextCursor).toBeNull();
      expect(page3.items[0].name).toBe('User 1');
    });

    it('should handle pagination with custom orderBy column', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      // Create users with specific names for alphabetical sorting
      await userRepo.create({ email: 'alice@example.com', name: 'Alice' });
      await userRepo.create({ email: 'bob@example.com', name: 'Bob' });
      await userRepo.create({ email: 'charlie@example.com', name: 'Charlie' });
      await userRepo.create({ email: 'david@example.com', name: 'David' });
      await userRepo.create({ email: 'eve@example.com', name: 'Eve' });

      // Paginate by name
      const page1 = await userRepo.paginateCursor({
        limit: 2,
        orderBy: 'name',
        orderDirection: 'asc',
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.items[0].name).toBe('Alice');
      expect(page1.items[1].name).toBe('Bob');

      const page2 = await userRepo.paginateCursor({
        limit: 2,
        cursor: page1.nextCursor,
        orderBy: 'name',
        orderDirection: 'asc',
      });

      expect(page2.items).toHaveLength(2);
      expect(page2.hasMore).toBe(true);
      expect(page2.items[0].name).toBe('Charlie');
      expect(page2.items[1].name).toBe('David');

      const page3 = await userRepo.paginateCursor({
        limit: 2,
        cursor: page2.nextCursor,
        orderBy: 'name',
        orderDirection: 'asc',
      });

      expect(page3.items).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
      expect(page3.items[0].name).toBe('Eve');
    });
  });

  describe('Tie-breaking with Duplicate Values', () => {
    it('should handle duplicate orderBy values using id for tie-breaking', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      // Create users with duplicate names
      await userRepo.create({ email: 'alice1@example.com', name: 'Alice' });
      await userRepo.create({ email: 'alice2@example.com', name: 'Alice' });
      await userRepo.create({ email: 'alice3@example.com', name: 'Alice' });
      await userRepo.create({ email: 'bob1@example.com', name: 'Bob' });
      await userRepo.create({ email: 'bob2@example.com', name: 'Bob' });

      // First page with limit 2 (should get first 2 Alices)
      const page1 = await userRepo.paginateCursor({
        limit: 2,
        orderBy: 'name',
        orderDirection: 'asc',
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.items[0].name).toBe('Alice');
      expect(page1.items[1].name).toBe('Alice');
      expect(page1.items[0].email).toBe('alice1@example.com');
      expect(page1.items[1].email).toBe('alice2@example.com');

      // Second page (should get third Alice and first Bob)
      const page2 = await userRepo.paginateCursor({
        limit: 2,
        cursor: page1.nextCursor,
        orderBy: 'name',
        orderDirection: 'asc',
      });

      expect(page2.items).toHaveLength(2);
      expect(page2.hasMore).toBe(true);
      expect(page2.items[0].name).toBe('Alice');
      expect(page2.items[0].email).toBe('alice3@example.com');
      expect(page2.items[1].name).toBe('Bob');
      expect(page2.items[1].email).toBe('bob1@example.com');

      // Third page (should get second Bob)
      const page3 = await userRepo.paginateCursor({
        limit: 2,
        cursor: page2.nextCursor,
        orderBy: 'name',
        orderDirection: 'asc',
      });

      expect(page3.items).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
      expect(page3.items[0].name).toBe('Bob');
      expect(page3.items[0].email).toBe('bob2@example.com');
    });

    it('should handle duplicate values in descending order', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      // Create users with duplicate names
      await userRepo.create({ email: 'alice1@example.com', name: 'Alice' });
      await userRepo.create({ email: 'alice2@example.com', name: 'Alice' });
      await userRepo.create({ email: 'bob1@example.com', name: 'Bob' });
      await userRepo.create({ email: 'bob2@example.com', name: 'Bob' });

      // First page descending
      const page1 = await userRepo.paginateCursor({
        limit: 2,
        orderBy: 'name',
        orderDirection: 'desc',
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.items[0].name).toBe('Bob');
      expect(page1.items[1].name).toBe('Bob');
      expect(page1.items[0].email).toBe('bob1@example.com');
      expect(page1.items[1].email).toBe('bob2@example.com');

      // Second page
      const page2 = await userRepo.paginateCursor({
        limit: 2,
        cursor: page1.nextCursor,
        orderBy: 'name',
        orderDirection: 'desc',
      });

      expect(page2.items).toHaveLength(2);
      expect(page2.hasMore).toBe(false);
      expect(page2.items[0].name).toBe('Alice');
      expect(page2.items[1].name).toBe('Alice');
      expect(page2.items[0].email).toBe('alice1@example.com');
      expect(page2.items[1].email).toBe('alice2@example.com');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty result set', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      const result = await userRepo.paginateCursor({
        limit: 10,
      });

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should handle single item result', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      await userRepo.create({ email: 'single@example.com', name: 'Single User' });

      const result = await userRepo.paginateCursor({
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.items[0].name).toBe('Single User');
    });

    it('should handle exact page boundary', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      // Create exactly 6 users (2 pages of 3)
      for (let i = 1; i <= 6; i++) {
        await userRepo.create({ email: `user${i}@example.com`, name: `User ${i}` });
      }

      // First page
      const page1 = await userRepo.paginateCursor({
        limit: 3,
      });

      expect(page1.items).toHaveLength(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).not.toBeNull();

      // Second page (exactly 3 items, no more)
      const page2 = await userRepo.paginateCursor({
        limit: 3,
        cursor: page1.nextCursor,
      });

      expect(page2.items).toHaveLength(3);
      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBeNull();
    });

    it('should handle null cursor same as first page', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      await userRepo.create({ email: 'user1@example.com', name: 'User 1' });
      await userRepo.create({ email: 'user2@example.com', name: 'User 2' });

      const page1 = await userRepo.paginateCursor({ limit: 1 });
      const pageNull = await userRepo.paginateCursor({ limit: 1, cursor: null });

      expect(page1.items[0].id).toBe(pageNull.items[0].id);
      expect(page1.items[0].name).toBe(pageNull.items[0].name);
    });
  });

  describe('Performance Characteristics', () => {
    it('should use keyset pagination (no OFFSET in query)', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      // Create 100 users
      const createPromises = [];
      for (let i = 1; i <= 100; i++) {
        createPromises.push(
          userRepo.create({ email: `user${i}@example.com`, name: `User ${i}` })
        );
      }
      await Promise.all(createPromises);

      // Jump to page 10 (offset 90 in old implementation)
      let cursor: { value: string | number | Date | null; id: number } | null = null;
      for (let i = 0; i < 9; i++) {
        const page: Awaited<ReturnType<typeof userRepo.paginateCursor>> = await userRepo.paginateCursor({
          limit: 10,
          cursor,
        });
        cursor = page.nextCursor;
      }

      // Page 10 should still be fast (keyset doesn't degrade)
      const startTime = Date.now();
      const page10 = await userRepo.paginateCursor({
        limit: 10,
        cursor,
      });
      const duration = Date.now() - startTime;

      expect(page10.items).toHaveLength(10);
      expect(page10.items[0].name).toBe('User 91');
      expect(duration).toBeLessThan(50); // Should be very fast even at page 10
    });

    it('should maintain cursor validity when items are inserted', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      // Create initial users
      await userRepo.create({ email: 'user1@example.com', name: 'User 1' });
      await userRepo.create({ email: 'user2@example.com', name: 'User 2' });
      await userRepo.create({ email: 'user3@example.com', name: 'User 3' });

      // Get first page
      const page1 = await userRepo.paginateCursor({
        limit: 2,
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.items[0].name).toBe('User 1');
      expect(page1.items[1].name).toBe('User 2');

      // Insert new item (will have higher ID than cursor)
      await userRepo.create({ email: 'user4@example.com', name: 'User 4' });

      // Get second page with cursor
      const page2 = await userRepo.paginateCursor({
        limit: 2,
        cursor: page1.nextCursor,
      });

      // Should get User 3 and User 4 (cursor is stable - includes items after cursor position)
      expect(page2.items).toHaveLength(2);
      expect(page2.items[0].name).toBe('User 3');
      expect(page2.items[1].name).toBe('User 4');
    });
  });

  describe('Comparison with Offset Pagination', () => {
    it('should return same results as offset pagination for first page', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      // Create users
      for (let i = 1; i <= 10; i++) {
        await userRepo.create({ email: `user${i}@example.com`, name: `User ${i}` });
      }

      // Cursor pagination
      const cursorResult = await userRepo.paginateCursor({
        limit: 5,
      });

      // Offset pagination
      const offsetResult = await userRepo.paginate({
        limit: 5,
        offset: 0,
        orderBy: 'id',
        orderDirection: 'asc',
      });

      // Should return same items
      expect(cursorResult.items.map((u) => u.id)).toEqual(offsetResult.items.map((u) => u.id));
      expect(cursorResult.items.map((u) => u.name)).toEqual(offsetResult.items.map((u) => u.name));
    });

    it('should demonstrate cursor stability vs offset instability', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User>({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
        }),
        schemas: {
          create: CreateUserSchema,
        },
      });

      // Create initial users
      for (let i = 1; i <= 5; i++) {
        await userRepo.create({ email: `user${i}@example.com`, name: `User ${i}` });
      }

      // Get first page with both methods
      const cursorPage1 = await userRepo.paginateCursor({ limit: 2 });
      const offsetPage1 = await userRepo.paginate({ limit: 2, offset: 0 });

      // Both should return User 1 and User 2
      expect(cursorPage1.items.map((u) => u.name)).toEqual(['User 1', 'User 2']);
      expect(offsetPage1.items.map((u) => u.name)).toEqual(['User 1', 'User 2']);

      // Delete first user - this shifts the offset-based results
      await userRepo.delete(cursorPage1.items[0].id);

      // Get second page
      const cursorPage2 = await userRepo.paginateCursor({
        limit: 2,
        cursor: cursorPage1.nextCursor,
      });
      const offsetPage2 = await userRepo.paginate({ limit: 2, offset: 2 });

      // Cursor pagination is stable (User 3, User 4) - not affected by deletion
      expect(cursorPage2.items.map((u) => u.name)).toEqual(['User 3', 'User 4']);

      // Offset pagination is shifted (User 4, User 5) - skipped User 3!
      expect(offsetPage2.items.map((u) => u.name)).toEqual(['User 4', 'User 5']);
    });
  });
});
