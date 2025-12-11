// @ts-nocheck - Test file with mock objects
/**
 * DAL Integration tests for Soft Delete Plugin
 *
 * Verifies that the soft-delete plugin works correctly with the DAL pattern (@kysera/dal).
 * Tests automatic soft-delete filtering in createQuery functions and proper plugin propagation
 * through transactions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, seedTestData, type TestDatabase } from './setup/database.js';
import { softDeletePlugin } from '../src/index.js';
import { createExecutor, createExecutorSync } from '@kysera/executor';
import { createContext, withTransaction, createQuery, withContext } from '@kysera/dal';
import type { Kysely } from 'kysely';

// Type definitions for test data
interface TestUser {
  id: number;
  email: string;
  name: string;
  created_at: string;
  deleted_at: string | null;
}

interface TestPost {
  id: number;
  user_id: number;
  title: string;
  content: string;
  published: number;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

interface TestComment {
  id: number;
  post_id: number;
  user_id: number;
  content: string;
  created_at: string;
  deleted_at: string | null;
}

describe('Soft Delete Plugin - DAL Integration', () => {
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

  describe('createContext with KyseraExecutor', () => {
    it('should create context with soft-delete enabled executor', () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);
      const ctx = createContext(executor);

      expect(ctx.db).toBe(executor);
      expect(ctx.isTransaction).toBe(false);
      expect('__kysera' in ctx.db).toBe(true);
      expect((ctx.db as any).__plugins).toContain(plugin);
    });

    it('should preserve executor configuration in context', () => {
      const plugin = softDeletePlugin({
        deletedAtColumn: 'deleted_at',
        includeDeleted: false,
        tables: ['users', 'posts'],
      });
      const executor = createExecutorSync(db, [plugin]);
      const ctx = createContext(executor);

      expect((ctx.db as any).__plugins).toHaveLength(1);
      expect((ctx.db as any).__plugins[0].name).toBe('@kysera/soft-delete');
    });

    it('should work with async executor creation', async () => {
      const plugin = softDeletePlugin();
      const executor = await createExecutor(db, [plugin]);
      const ctx = createContext(executor);

      expect(ctx.db).toBe(executor);
      expect('__kysera' in ctx.db).toBe(true);
    });
  });

  describe('createQuery with automatic soft-delete filtering', () => {
    it('should automatically filter soft-deleted records in SELECT queries', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      // Soft delete Bob
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Bob')
        .execute();

      // Create query function
      const getAllUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      // Execute query with executor
      const users = await getAllUsers(executor) as TestUser[];

      // Bob should be filtered out
      expect(users).toHaveLength(2);
      expect(users.find((u) => u.name === 'Bob')).toBeUndefined();
      expect(users.find((u) => u.name === 'Alice')).toBeDefined();
      expect(users.find((u) => u.name === 'Charlie')).toBeDefined();
    });

    it('should apply soft-delete filter to queries with WHERE clauses', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      // Soft delete Alice
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('email', '=', 'alice@example.com')
        .execute();

      // Query with additional WHERE clause
      const getUserByEmail = createQuery((ctx, email: string) =>
        ctx.db
          .selectFrom('users')
          .selectAll()
          .where('email', '=', email)
          .executeTakeFirst()
      );

      // Try to find Alice (soft-deleted)
      const alice = await getUserByEmail(executor, 'alice@example.com') as TestUser | undefined;
      expect(alice).toBeUndefined();

      // Find Bob (not deleted)
      const bob = await getUserByEmail(executor, 'bob@example.com') as TestUser | undefined;
      expect(bob).toBeDefined();
      expect(bob?.name).toBe('Bob');
    });

    it('should not interfere with INSERT queries', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      const createUser = createQuery((ctx, data: { email: string; name: string }) =>
        ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
      );

      const newUser = await createUser(executor, {
        email: 'david@example.com',
        name: 'David',
      }) as TestUser;

      expect(newUser).toBeDefined();
      expect(newUser.name).toBe('David');
      expect(newUser.deleted_at).toBeNull();
    });

    it('should not interfere with UPDATE queries', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      const updateUser = createQuery((ctx, id: number, name: string) =>
        ctx.db
          .updateTable('users')
          .set({ name })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow()
      );

      const users = await db.selectFrom('users').selectAll().execute();
      const firstUser = users[0];
      if (!firstUser) throw new Error('No users found');

      const updated = await updateUser(executor, firstUser.id, 'Updated Name') as TestUser;
      expect(updated.name).toBe('Updated Name');
    });

    it('should work with complex queries (joins, aggregations)', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      // Soft delete one post
      await db
        .updateTable('posts')
        .set({ deleted_at: new Date().toISOString() })
        .where('title', '=', 'First Post')
        .execute();

      // Query posts with user join
      const getPostsWithUser = createQuery((ctx) =>
        ctx.db
          .selectFrom('posts')
          .innerJoin('users', 'users.id', 'posts.user_id')
          .select([
            'posts.id',
            'posts.title',
            'posts.content',
            'users.name as author_name',
          ])
          .execute()
      );

      const posts = await getPostsWithUser(executor);

      // Should exclude soft-deleted post
      expect(posts).toHaveLength(2);
      expect(posts.find((p: any) => p.title === 'First Post')).toBeUndefined();
    });

    it('should filter records from specified tables only', async () => {
      // Plugin only applies to users table
      const plugin = softDeletePlugin({
        tables: ['users'],
      });
      const executor = createExecutorSync(db, [plugin]);

      // Soft delete a user and a post
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Bob')
        .execute();

      await db
        .updateTable('posts')
        .set({ deleted_at: new Date().toISOString() })
        .where('title', '=', 'First Post')
        .execute();

      // Query users (should filter)
      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      // Query posts (should NOT filter)
      const getPosts = createQuery((ctx) =>
        ctx.db.selectFrom('posts').selectAll().execute()
      );

      const users = await getUsers(executor) as TestUser[];
      const posts = await getPosts(executor) as TestPost[];

      // Bob should be filtered
      expect(users).toHaveLength(2);
      expect(users.find((u) => u.name === 'Bob')).toBeUndefined();

      // Post should NOT be filtered (plugin doesn't apply to posts)
      expect(posts).toHaveLength(3);
      expect(posts.find((p) => p.title === 'First Post')).toBeDefined();
    });
  });

  describe('withTransaction with soft-delete plugin propagation', () => {
    it('should propagate soft-delete plugin to transaction context', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      await withTransaction(executor, async (ctx) => {
        expect(ctx.isTransaction).toBe(true);
        expect('__kysera' in ctx.db).toBe(true);
        expect((ctx.db as any).__plugins).toContain(plugin);
      });
    });

    it('should apply soft-delete filter within transactions', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      // Soft delete Bob before transaction
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Bob')
        .execute();

      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      await withTransaction(executor, async (ctx) => {
        const users = await getUsers(ctx) as TestUser[];

        // Bob should be filtered even in transaction
        expect(users).toHaveLength(2);
        expect(users.find((u) => u.name === 'Bob')).toBeUndefined();
      });
    });

    it('should allow soft-deletes within transaction', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      const softDeleteUser = createQuery((ctx, id: number) =>
        ctx.db
          .updateTable('users')
          .set({ deleted_at: new Date().toISOString() })
          .where('id', '=', id)
          .execute()
      );

      await withTransaction(executor, async (ctx) => {
        // Get initial users
        const usersBefore = await getUsers(ctx) as TestUser[];
        expect(usersBefore).toHaveLength(3);

        // Soft delete Bob
        const bob = usersBefore.find((u) => u.name === 'Bob');
        if (!bob) throw new Error('Bob not found');

        await softDeleteUser(ctx, bob.id);

        // Query again - Bob should be filtered
        const usersAfter = await getUsers(ctx) as TestUser[];
        expect(usersAfter).toHaveLength(2);
        expect(usersAfter.find((u) => u.name === 'Bob')).toBeUndefined();
      });

      // Verify soft-delete persisted after transaction
      const usersOutside = await db.selectFrom('users').selectAll().execute();
      const bob = usersOutside.find((u) => u.name === 'Bob');
      expect(bob).toBeDefined();
      expect(bob?.deleted_at).not.toBeNull();
    });

    it('should handle transaction rollback correctly', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      const softDeleteUser = createQuery((ctx, id: number) =>
        ctx.db
          .updateTable('users')
          .set({ deleted_at: new Date().toISOString() })
          .where('id', '=', id)
          .execute()
      );

      const users = await db.selectFrom('users').selectAll().execute();
      const bob = users.find((u) => u.name === 'Bob');
      if (!bob) throw new Error('Bob not found');

      try {
        await withTransaction(executor, async (ctx) => {
          await softDeleteUser(ctx, bob.id);
          throw new Error('Force rollback');
        });
      } catch (error) {
        expect((error as Error).message).toBe('Force rollback');
      }

      // Verify soft-delete was rolled back
      const bobAfter = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', bob.id)
        .executeTakeFirst();
      expect(bobAfter?.deleted_at).toBeNull();
    });

    it('should maintain soft-delete state within transaction', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      const softDeleteUser = createQuery((ctx, id: number) =>
        ctx.db
          .updateTable('users')
          .set({ deleted_at: new Date().toISOString() })
          .where('id', '=', id)
          .execute()
      );

      const createPost = createQuery((ctx, data: { user_id: number; title: string; content: string }) =>
        ctx.db.insertInto('posts').values(data).returningAll().executeTakeFirstOrThrow()
      );

      await withTransaction(executor, async (ctx) => {
        const usersBefore = await getUsers(ctx) as TestUser[];
        expect(usersBefore).toHaveLength(3);

        const bob = usersBefore.find((u) => u.name === 'Bob');
        if (!bob) throw new Error('Bob not found');

        // Soft delete Bob in transaction
        await softDeleteUser(ctx, bob.id);

        // Bob should be filtered immediately within same transaction
        const usersAfterDelete = await getUsers(ctx) as TestUser[];
        expect(usersAfterDelete).toHaveLength(2);
        expect(usersAfterDelete.find((u) => u.name === 'Bob')).toBeUndefined();

        // Can still create posts for Bob (soft-delete doesn't affect writes)
        const post = await createPost(ctx, {
          user_id: bob.id,
          title: 'Post after soft-delete',
          content: 'This should work',
        }) as TestPost;

        expect(post.user_id).toBe(bob.id);
      });

      // Verify soft-delete persisted
      const bobAfter = await db
        .selectFrom('users')
        .selectAll()
        .where('name', '=', 'Bob')
        .executeTakeFirst();
      expect(bobAfter?.deleted_at).not.toBeNull();
    });
  });

  describe('Multiple queries with soft-delete filter', () => {
    it('should apply filter consistently across multiple queries', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      // Soft delete multiple records
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Bob')
        .execute();

      await db
        .updateTable('posts')
        .set({ deleted_at: new Date().toISOString() })
        .where('title', '=', 'First Post')
        .execute();

      // Define multiple queries
      const getAllUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      const getAllPosts = createQuery((ctx) =>
        ctx.db.selectFrom('posts').selectAll().execute()
      );

      const getUserById = createQuery((ctx, id: number) =>
        ctx.db
          .selectFrom('users')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()
      );

      // Execute queries
      const users = await getAllUsers(executor) as TestUser[];
      const posts = await getAllPosts(executor) as TestPost[];

      // Get Bob's ID from raw query
      const bob = await db.selectFrom('users').selectAll().where('name', '=', 'Bob').executeTakeFirst();
      const bobFromQuery = await getUserById(executor, bob?.id ?? 0);

      // Verify filters applied
      expect(users).toHaveLength(2);
      expect(users.find((u) => u.name === 'Bob')).toBeUndefined();

      expect(posts).toHaveLength(2);
      expect(posts.find((p) => p.title === 'First Post')).toBeUndefined();

      expect(bobFromQuery).toBeUndefined();
    });

    it('should work with query composition', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      // Soft delete Bob
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Bob')
        .execute();

      // Soft delete Bob's post
      await db
        .updateTable('posts')
        .set({ deleted_at: new Date().toISOString() })
        .where('title', '=', "Bob's Post")
        .execute();

      const getUser = createQuery((ctx, id: number) =>
        ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
      );

      const getUserPosts = createQuery((ctx, userId: number) =>
        ctx.db.selectFrom('posts').selectAll().where('user_id', '=', userId).execute()
      );

      const getUserWithPosts = createQuery(async (ctx, id: number) => {
        const user = await getUser(ctx, id) as TestUser | undefined;
        if (!user) return null;

        const posts = await getUserPosts(ctx, user.id) as TestPost[];
        return { ...user, posts };
      });

      // Get all users and their posts
      const users = await db.selectFrom('users').selectAll().execute();

      for (const user of users) {
        const userWithPosts = await getUserWithPosts(executor, user.id);

        if (user.name === 'Bob') {
          // Bob should be filtered
          expect(userWithPosts).toBeNull();
        } else {
          expect(userWithPosts).not.toBeNull();
          // Soft-deleted posts should be filtered
          expect(userWithPosts?.posts.every((p: TestPost) => p.deleted_at === null)).toBe(true);
        }
      }
    });

    it('should handle queries across multiple tables', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      // Soft delete across all tables
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Charlie')
        .execute();

      await db
        .updateTable('posts')
        .set({ deleted_at: new Date().toISOString() })
        .where('title', '=', 'Second Post')
        .execute();

      await db
        .updateTable('comments')
        .set({ deleted_at: new Date().toISOString() })
        .where('content', '=', 'Great post!')
        .execute();

      const getAllUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      const getAllPosts = createQuery((ctx) =>
        ctx.db.selectFrom('posts').selectAll().execute()
      );

      const getAllComments = createQuery((ctx) =>
        ctx.db.selectFrom('comments').selectAll().execute()
      );

      const [users, posts, comments] = await Promise.all([
        getAllUsers(executor) as Promise<TestUser[]>,
        getAllPosts(executor) as Promise<TestPost[]>,
        getAllComments(executor) as Promise<TestComment[]>,
      ]);

      // Verify all soft-deleted records are filtered
      expect(users.find((u) => u.name === 'Charlie')).toBeUndefined();
      expect(posts.find((p) => p.title === 'Second Post')).toBeUndefined();
      expect(comments.find((c) => c.content === 'Great post!')).toBeUndefined();

      // Verify counts
      expect(users).toHaveLength(2); // Alice, Bob
      expect(posts).toHaveLength(2); // First Post, Bob's Post
      expect(comments).toHaveLength(1); // Thanks for sharing
    });
  });

  describe('withContext with soft-delete plugin', () => {
    it('should preserve soft-delete plugin in withContext', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      await withContext(executor, async (ctx) => {
        expect(ctx.db).toBe(executor);
        expect('__kysera' in ctx.db).toBe(true);
        expect((ctx.db as any).__plugins).toContain(plugin);
      });
    });

    it('should apply soft-delete filter in withContext', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      // Soft delete Bob
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Bob')
        .execute();

      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      await withContext(executor, async (ctx) => {
        const users = await getUsers(ctx) as TestUser[];
        expect(users).toHaveLength(2);
        expect(users.find((u) => u.name === 'Bob')).toBeUndefined();
      });
    });
  });

  describe('Custom soft-delete column configuration', () => {
    it('should work with custom deleted column name', async () => {
      const plugin = softDeletePlugin({
        deletedAtColumn: 'deleted_at', // Explicit but same as default
      });
      const executor = createExecutorSync(db, [plugin]);

      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Bob')
        .execute();

      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      const users = await getUsers(executor) as TestUser[];
      expect(users).toHaveLength(2);
      expect(users.find((u) => u.name === 'Bob')).toBeUndefined();
    });

    it('should respect includeDeleted option', async () => {
      const plugin = softDeletePlugin({
        includeDeleted: true, // Include deleted by default
      });
      const executor = createExecutorSync(db, [plugin]);

      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Bob')
        .execute();

      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      const users = await getUsers(executor) as TestUser[];

      // Should include Bob because includeDeleted is true
      expect(users).toHaveLength(3);
      expect(users.find((u) => u.name === 'Bob')).toBeDefined();
    });
  });

  describe('Type safety with DAL queries', () => {
    it('should maintain type safety with query functions', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      const getUserById = createQuery((ctx, id: number) =>
        ctx.db
          .selectFrom('users')
          .select(['id', 'email', 'name', 'deleted_at'])
          .where('id', '=', id)
          .executeTakeFirst()
      );

      const user = await getUserById(executor, 1);

      // TypeScript should infer correct types
      if (user) {
        const _idCheck: number = user.id;
        const _emailCheck: string = user.email;
        const _nameCheck: string = user.name;
        const _deletedAtCheck: string | null = user.deleted_at;

        expect(_idCheck).toBeDefined();
        expect(_emailCheck).toBeDefined();
        expect(_nameCheck).toBeDefined();
        expect(_deletedAtCheck).toBeDefined();
      }
    });

    it('should work with complex return types', async () => {
      const plugin = softDeletePlugin();
      const executor = createExecutorSync(db, [plugin]);

      const getPostWithAuthor = createQuery((ctx, postId: number) =>
        ctx.db
          .selectFrom('posts')
          .innerJoin('users', 'users.id', 'posts.user_id')
          .select([
            'posts.id',
            'posts.title',
            'posts.content',
            'users.name as author_name',
            'users.email as author_email',
          ])
          .where('posts.id', '=', postId)
          .executeTakeFirst()
      );

      const post = await getPostWithAuthor(executor, 1);

      if (post) {
        const _idCheck: number = post.id;
        const _titleCheck: string = post.title;
        const _authorNameCheck: string = post.author_name;
        const _authorEmailCheck: string = post.author_email;

        expect(_idCheck).toBeDefined();
        expect(_titleCheck).toBeDefined();
        expect(_authorNameCheck).toBeDefined();
        expect(_authorEmailCheck).toBeDefined();
      }
    });
  });
});
