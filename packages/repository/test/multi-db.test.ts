import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, type Selectable } from 'kysely';
import { z } from 'zod';
import {
  type DatabaseType,
  type MultiDbTestDatabase,
  createTestDb,
  initializeSchema,
  seedDatabase,
  clearDatabase,
  // @ts-ignore - Cross-package test utility import (monorepo)
} from '../../kysera-core/test/utils/multi-db';
import { createRepositoryFactory } from '../src/repository.js';
import { parseDatabaseError } from '../../kysera-core/dist/index.js';

// Test schemas
const UserCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().nullable().optional(),
});

const UserUpdateSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().nullable().optional(),
});

// Function to create post schemas based on database type
const createPostSchemas = (dbType: DatabaseType) => {
  // SQLite and MySQL use integers (0/1) for booleans
  const booleanField =
    dbType === 'sqlite' || dbType === 'mysql'
      ? z.union([z.boolean().transform((val) => (val ? 1 : 0)), z.number()])
      : z.boolean();

  const booleanFieldWithDefault =
    dbType === 'sqlite' || dbType === 'mysql'
      ? z.union([z.boolean().transform((val) => (val ? 1 : 0)), z.number()]).default(0)
      : z.boolean().default(false);

  const PostCreateSchema = z.object({
    user_id: z.number(),
    title: z.string(),
    content: z.string().nullable().optional(),
    published: booleanFieldWithDefault,
  });

  const PostUpdateSchema = z.object({
    title: z.string().optional(),
    content: z.string().nullable().optional(),
    published: booleanField.optional(),
  });

  return { PostCreateSchema, PostUpdateSchema };
};

type User = Selectable<MultiDbTestDatabase['users']>;
type Post = Selectable<MultiDbTestDatabase['posts']>;

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

describe.each(getDatabaseTypes())('Repository Multi-Database Tests (%s)', (dbType) => {
  let db: Kysely<MultiDbTestDatabase>;
  let userRepository: any;
  let postRepository: any;

  beforeAll(async () => {
    db = createTestDb(dbType);
    await initializeSchema(db, dbType);

    // Create repositories
    const factory = createRepositoryFactory(db);

    userRepository = factory.create({
      tableName: 'users' as const,
      schemas: {
        create: UserCreateSchema,
        update: UserUpdateSchema,
      },
      mapRow: (row: any) => row as User,
    });

    // Create post schemas based on database type
    const { PostCreateSchema, PostUpdateSchema } = createPostSchemas(dbType);

    postRepository = factory.create({
      tableName: 'posts' as const,
      schemas: {
        create: PostCreateSchema,
        update: PostUpdateSchema,
      },
      mapRow: (row: any) => {
        // Convert SQLite integers back to booleans for the entity
        if (dbType === 'sqlite' && typeof row.published === 'number') {
          return { ...row, published: row.published === 1 } as Post;
        }
        return row as Post;
      },
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await clearDatabase(db);
    await seedDatabase(db, dbType);
  });

  describe('CRUD Operations', () => {
    it('should create records', async () => {
      const user = await userRepository.create({
        email: 'new@example.com',
        name: 'New User',
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('new@example.com');
      expect(user.name).toBe('New User');
    });

    it('should find by id', async () => {
      const created = await userRepository.create({
        email: 'findme@example.com',
        name: 'Find Me',
      });

      const found = await userRepository.findById(created.id);
      expect(found).toBeDefined();
      expect(found?.email).toBe('findme@example.com');
    });

    it('should update records', async () => {
      const user = await userRepository.create({
        email: 'update@example.com',
        name: 'Original Name',
      });

      const updated = await userRepository.update(user.id, {
        name: 'Updated Name',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.email).toBe('update@example.com');
    });

    it('should delete records', async () => {
      const user = await userRepository.create({
        email: 'delete@example.com',
        name: 'Delete Me',
      });

      const deleted = await userRepository.delete(user.id);
      expect(deleted).toBe(true);

      const notFound = await userRepository.findById(user.id);
      expect(notFound).toBeNull();
    });
  });

  describe('Batch Operations', () => {
    it('should find multiple by ids', async () => {
      const users = await userRepository.find();
      const ids = users.slice(0, 3).map((u: User) => u.id);

      const found = await userRepository.findByIds(ids);
      expect(found).toHaveLength(3);
      expect(found.map((u: User) => u.id).sort()).toEqual(ids.sort());
    });

    it('should bulk create', async () => {
      const newUsers = [
        { email: 'bulk1@example.com', name: 'Bulk 1' },
        { email: 'bulk2@example.com', name: 'Bulk 2' },
        { email: 'bulk3@example.com', name: 'Bulk 3' },
      ];

      const created = await userRepository.bulkCreate(newUsers);
      expect(created).toHaveLength(3);
      expect(created[0].email).toBe('bulk1@example.com');
    });

    it('should bulk update', async () => {
      const users = await userRepository.find();
      const updates = users.slice(0, 2).map((u: User) => ({
        id: u.id,
        data: {
          name: `Updated ${u.name}`,
        },
      }));

      const updated = await userRepository.bulkUpdate(updates);
      expect(updated).toHaveLength(2);
      updated.forEach((u: User) => {
        expect(u.name).toContain('Updated');
      });
    });

    it('should bulk delete', async () => {
      const users = await userRepository.find();
      const ids = users.slice(0, 2).map((u: User) => u.id);

      const deleted = await userRepository.bulkDelete(ids);
      expect(deleted).toBe(ids.length);

      const remaining = await userRepository.findByIds(ids);
      expect(remaining).toHaveLength(0);
    });
  });

  describe('Query Methods', () => {
    it('should find with filters', async () => {
      // SQLite and MySQL use integers (0/1) for booleans
      const posts = await postRepository.find({
        where: { published: dbType === 'sqlite' || dbType === 'mysql' ? 1 : true },
      });

      expect(posts.length).toBeGreaterThan(0);
      posts.forEach((p: Post) => {
        // Different databases return different values for booleans:
        // - PostgreSQL: true/false
        // - MySQL: 1/0
        // - SQLite: can be true/false or 1/0 depending on driver version
        // Check for truthy value instead of exact match
        expect(p.published).toBeTruthy();
      });
    });

    it('should find one with filters', async () => {
      const post = await postRepository.findOne({
        where: { title: 'Introduction to TypeScript' },
      });

      expect(post).toBeDefined();
      expect(post?.title).toBe('Introduction to TypeScript');
    });

    it('should count records', async () => {
      const totalUsers = await userRepository.count();
      expect(totalUsers).toBe(5);

      const publishedPosts = await postRepository.count({
        where: { published: dbType === 'sqlite' || dbType === 'mysql' ? 1 : true },
      });
      expect(publishedPosts).toBe(4);
    });

    it('should check existence', async () => {
      const exists = await userRepository.exists({
        where: { email: 'alice@example.com' },
      });
      expect(exists).toBe(true);

      const notExists = await userRepository.exists({
        where: { email: 'nonexistent@example.com' },
      });
      expect(notExists).toBe(false);
    });
  });

  describe('Transactions', () => {
    it('should handle transactions', async () => {
      const result = await userRepository.transaction(async (trx: any) => {
        const txUserRepo = userRepository.withTransaction(trx);
        const txPostRepo = postRepository.withTransaction(trx);

        const user = await txUserRepo.create({
          email: 'tx@example.com',
          name: 'Transaction User',
        });

        const post = await txPostRepo.create({
          user_id: user.id,
          title: 'Transaction Post',
          content: 'Created in transaction',
          published: true,
        });

        return { user, post };
      });

      expect(result.user.email).toBe('tx@example.com');
      expect(result.post.title).toBe('Transaction Post');

      // Verify data was committed
      const user = await userRepository.findOne({
        where: { email: 'tx@example.com' },
      });
      expect(user).toBeDefined();
    });

    it('should rollback on error', async () => {
      try {
        await userRepository.transaction(async (trx: any) => {
          const txUserRepo = userRepository.withTransaction(trx);

          await txUserRepo.create({
            email: 'rollback@example.com',
            name: 'Should Rollback',
          });

          // Force an error
          throw new Error('Forced rollback');
        });
      } catch (error: any) {
        expect(error.message).toBe('Forced rollback');
      }

      // Verify data was not committed
      const user = await userRepository.findOne({
        where: { email: 'rollback@example.com' },
      });
      expect(user).toBeNull();
    });
  });

  describe('Pagination', () => {
    it('should paginate with offset', async () => {
      const page1 = await userRepository.paginate({
        limit: 2,
        offset: 0,
        orderBy: 'email',
        orderDirection: 'asc',
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = await userRepository.paginate({
        limit: 2,
        offset: 2,
        orderBy: 'email',
        orderDirection: 'asc',
      });

      expect(page2.items).toHaveLength(2);
      expect(page2.items[0].id).not.toBe(page1.items[0].id);
    });

    it('should paginate with cursor', async () => {
      const page1 = await postRepository.paginateCursor({
        orderBy: 'title',
        limit: 2,
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await postRepository.paginateCursor({
        orderBy: 'title',
        limit: 2,
        cursor: page1.nextCursor,
      });

      expect(page2.items).toHaveLength(2);
      expect(page2.items[0].id).not.toBe(page1.items[0].id);
    });
  });

  describe('Validation', () => {
    it('should validate create input', async () => {
      await expect(
        userRepository.create({
          email: 'invalid-email',
          name: 'Invalid',
        })
      ).rejects.toThrow();
    });

    it('should validate update input', async () => {
      const user = await userRepository.create({
        email: 'valid@example.com',
        name: 'Valid',
      });

      await expect(
        userRepository.update(user.id, {
          email: 'invalid-email',
        })
      ).rejects.toThrow();
    });

    it('should skip validation when disabled', async () => {
      const noValidationRepo = createRepositoryFactory(db).create({
        tableName: 'users' as const,
        schemas: {
          create: UserCreateSchema,
          update: UserUpdateSchema,
        },
        mapRow: (row: any) => row as User,
        validationStrategy: 'none',
      });

      // This would normally fail validation
      const user = await noValidationRepo.create({
        email: 'invalid-email',
        name: 'No Validation',
      });

      expect(user.email).toBe('invalid-email');
    });
  });

  describe('Complex Queries', () => {
    it('should handle joins in custom queries', async () => {
      // Use db directly for complex queries
      const results = await db
        .selectFrom('posts')
        .innerJoin('users', 'users.id', 'posts.user_id')
        .select(['posts.id', 'posts.title', 'users.name as author_name'])
        .where('posts.published', '=', dbType === 'sqlite' || dbType === 'mysql' ? (1 as any) : (true as any))
        .execute();

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.author_name).toBeDefined();
    });

    it('should handle aggregations', async () => {
      // Count total posts
      const totalResult = await db.selectFrom('posts').select(db.fn.count('id').as('total')).executeTakeFirst();

      // Count published posts
      const publishedResult = await db
        .selectFrom('posts')
        .select(db.fn.count('id').as('published_count'))
        .where('published', '=', dbType === 'sqlite' || dbType === 'mysql' ? (1 as any) : (true as any))
        .executeTakeFirst();

      expect(Number(totalResult?.total || 0)).toBeGreaterThan(0);
      expect(Number(publishedResult?.published_count || 0)).toBeGreaterThan(0);
    });

    it('should handle subqueries', async () => {
      const usersWithPosts = await db
        .selectFrom('users')
        .select([
          'users.id',
          'users.name',
          db
            .selectFrom('posts')
            .select(db.fn.count('id').as('count'))
            .whereRef('posts.user_id', '=', 'users.id' as any)
            .as('post_count'),
        ])
        .execute();

      expect(usersWithPosts.length).toBeGreaterThan(0);
      usersWithPosts.forEach((user) => {
        expect(user.post_count).toBeDefined();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle constraint violations', async () => {
      try {
        await userRepository.create({
          email: 'alice@example.com', // Already exists
          name: 'Duplicate',
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        const parsed = parseDatabaseError(error, dbType);
        expect(parsed.code).toBeDefined();
        expect(parsed.message.toLowerCase()).toContain('unique');
      }
    });

    it('should handle foreign key violations', async () => {
      try {
        await postRepository.create({
          user_id: 999999,
          title: 'Invalid User',
          content: 'Should fail',
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        const parsed = parseDatabaseError(error, dbType);
        expect(parsed.code).toBeDefined();
      }
    });

    it('should handle not found errors', async () => {
      const notFound = await userRepository.findById(999999);
      expect(notFound).toBeNull();

      // Update should throw when record not found
      await expect(userRepository.update(999999, { name: 'New' })).rejects.toThrow();

      const deleted = await userRepository.delete(999999);
      expect(deleted).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should handle large datasets', async () => {
      // Create many records
      const users = Array.from({ length: 1000 }, (_, i) => ({
        email: `perf${i}@example.com`,
        name: `Performance User ${i}`,
      }));

      // Bulk insert in chunks
      const chunkSize = 100;
      for (let i = 0; i < users.length; i += chunkSize) {
        await userRepository.bulkCreate(users.slice(i, i + chunkSize));
      }

      // Test pagination performance
      const start = Date.now();
      const page = await userRepository.paginate({
        limit: 50,
        offset: 500,
        orderBy: 'email',
        orderDirection: 'asc',
      });
      const elapsed = Date.now() - start;

      expect(page.items).toHaveLength(50);
      expect(elapsed).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should efficiently count large datasets', async () => {
      const count = await userRepository.count();
      expect(count).toBeGreaterThan(0);
    });
  });
});
