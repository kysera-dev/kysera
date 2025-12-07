import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createTestDatabase } from './setup/database.js';
import { createRepositoryFactory, createRepositoriesFactory, type Executor } from '../src/index.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';

// Define schemas for validation
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  created_at: z.coerce.date(),
  deleted_at: z.coerce.date().nullable(),
});

const PostSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  title: z.string(),
  content: z.string(),
  created_at: z.coerce.date(),
});

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
});

const CreatePostSchema = z.object({
  user_id: z.number(),
  title: z.string().min(1),
  content: z.string(),
});

const UpdatePostSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
});

// Domain types
interface User {
  id: number;
  email: string;
  name: string;
  created_at: Date | string;
  deleted_at: Date | string | null;
}

interface Post {
  id: number;
  user_id: number;
  title: string;
  content: string;
  created_at: Date | string;
}

describe('Repository Helpers', () => {
  let db: Kysely<TestDatabase>;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = createTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  describe('createRepositoriesFactory', () => {
    it('should create a factory that returns multiple repositories', () => {
      const createUserRepository = (executor: Executor<any>) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'users', User>({
          tableName: 'users',
          mapRow: (row: any): User => ({
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
      };

      const createPostRepository = (executor: Executor<any>) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'posts', Post>({
          tableName: 'posts',
          mapRow: (row: any): Post => ({
            id: row.id,
            user_id: row.user_id,
            title: row.title,
            content: row.content,
            created_at: row.created_at,
          }),
          schemas: {
            entity: PostSchema,
            create: CreatePostSchema,
            update: UpdatePostSchema,
          },
        });
      };

      const createRepositories = createRepositoriesFactory({
        users: createUserRepository,
        posts: createPostRepository,
      });

      const repos = createRepositories(db as any);

      expect(repos).toHaveProperty('users');
      expect(repos).toHaveProperty('posts');
      expect(repos.users.tableName).toBe('users');
      expect(repos.posts.tableName).toBe('posts');
    });

    it('should work with database instance', async () => {
      const createUserRepository = (executor: Executor<any>) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'users', User>({
          tableName: 'users',
          mapRow: (row: any): User => ({
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
      };

      const createRepositories = createRepositoriesFactory({
        users: createUserRepository,
      });

      const repos = createRepositories(db as any);

      // Create user through factory-created repository
      const user = await repos.users.create({
        email: 'factory@example.com',
        name: 'Factory User',
      });

      expect(user.email).toBe('factory@example.com');
      expect(user.name).toBe('Factory User');

      // Find user
      const found = await repos.users.findById(user.id);
      expect(found).toBeDefined();
      expect(found?.email).toBe('factory@example.com');
    });

    it('should work with transactions (one-liner!)', async () => {
      const createUserRepository = (executor: Executor<any>) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'users', User>({
          tableName: 'users',
          mapRow: (row: any): User => ({
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
      };

      const createPostRepository = (executor: Executor<any>) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'posts', Post>({
          tableName: 'posts',
          mapRow: (row: any): Post => ({
            id: row.id,
            user_id: row.user_id,
            title: row.title,
            content: row.content,
            created_at: row.created_at,
          }),
          schemas: {
            entity: PostSchema,
            create: CreatePostSchema,
            update: UpdatePostSchema,
          },
        });
      };

      const createRepositories = createRepositoriesFactory({
        users: createUserRepository,
        posts: createPostRepository,
      });

      // This is the clean one-liner usage!
      await db.transaction().execute(async (trx) => {
        const repos = createRepositories(trx as any);

        const user = await repos.users.create({
          email: 'trx@example.com',
          name: 'Transaction User',
        });

        const post = await repos.posts.create({
          user_id: user.id,
          title: 'Test Post',
          content: 'Post created in transaction',
        });

        expect(post.user_id).toBe(user.id);
        expect(post.title).toBe('Test Post');
      });

      // Verify data was committed
      const repos = createRepositories(db as any);
      const users = await repos.users.findAll();
      const posts = await repos.posts.findAll();

      expect(users).toHaveLength(1);
      expect(posts).toHaveLength(1);
      expect(posts[0]?.user_id).toBe(users[0]?.id);
    });

    it('should support transaction rollback', async () => {
      const createUserRepository = (executor: Executor<any>) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'users', User>({
          tableName: 'users',
          mapRow: (row: any): User => ({
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
      };

      const createRepositories = createRepositoriesFactory({
        users: createUserRepository,
      });

      try {
        await db.transaction().execute(async (trx) => {
          const repos = createRepositories(trx as any);

          await repos.users.create({
            email: 'rollback@example.com',
            name: 'Rollback User',
          });

          // Force rollback
          throw new Error('Rollback test');
        });
      } catch (error: any) {
        expect(error.message).toBe('Rollback test');
      }

      // Verify data was rolled back
      const repos = createRepositories(db as any);
      const users = await repos.users.findAll();
      expect(users).toHaveLength(0);
    });

    it('should support nested repository creation', async () => {
      const createUserRepository = (executor: Executor<any>) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'users', User>({
          tableName: 'users',
          mapRow: (row: any): User => ({
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
      };

      const createRepositories = createRepositoriesFactory({
        users: createUserRepository,
      });

      // Use factory in normal context
      const repos1 = createRepositories(db as any);
      const user1 = await repos1.users.create({
        email: 'user1@example.com',
        name: 'User 1',
      });

      // Use same factory in transaction
      await db.transaction().execute(async (trx) => {
        const repos2 = createRepositories(trx as any);
        const user2 = await repos2.users.create({
          email: 'user2@example.com',
          name: 'User 2',
        });

        expect(user2.id).not.toBe(user1.id);
      });

      // Verify both users exist
      const repos3 = createRepositories(db as any);
      const allUsers = await repos3.users.findAll();
      expect(allUsers).toHaveLength(2);
    });

    it('should support multiple factories with different repository sets', () => {
      const createUserRepository = (executor: Executor<any>) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'users', User>({
          tableName: 'users',
          mapRow: (row: any): User => ({
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
      };

      const createPostRepository = (executor: Executor<any>) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'posts', Post>({
          tableName: 'posts',
          mapRow: (row: any): Post => ({
            id: row.id,
            user_id: row.user_id,
            title: row.title,
            content: row.content,
            created_at: row.created_at,
          }),
          schemas: {
            entity: PostSchema,
            create: CreatePostSchema,
            update: UpdatePostSchema,
          },
        });
      };

      // Create different factory subsets
      const createUserOnlyRepos = createRepositoriesFactory({
        users: createUserRepository,
      });

      const createAllRepos = createRepositoriesFactory({
        users: createUserRepository,
        posts: createPostRepository,
      });

      const userOnlyRepos = createUserOnlyRepos(db as any);
      const allRepos = createAllRepos(db as any);

      expect(userOnlyRepos).toHaveProperty('users');
      expect(userOnlyRepos).not.toHaveProperty('posts');

      expect(allRepos).toHaveProperty('users');
      expect(allRepos).toHaveProperty('posts');
    });
  });
});
