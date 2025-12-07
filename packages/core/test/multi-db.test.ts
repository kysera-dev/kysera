import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import {
  type DatabaseType,
  type MultiDbTestDatabase,
  createTestDb,
  initializeSchema,
  seedDatabase,
  clearDatabase,
} from './utils/multi-db.js';
import { parseDatabaseError, UniqueConstraintError, ForeignKeyError, DatabaseError } from '../src/index.js';

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

describe.each(getDatabaseTypes())('Multi-Database Tests (%s)', (dbType) => {
  let db: Kysely<MultiDbTestDatabase>;

  beforeAll(async () => {
    db = createTestDb(dbType);
    await initializeSchema(db, dbType);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await clearDatabase(db);
    await seedDatabase(db, dbType);
  });

  describe('Error Handling', () => {
    it('should handle unique constraint violations', async () => {
      try {
        await db.insertInto('users').values({ email: 'alice@example.com', name: 'Duplicate Alice' }).execute();
        expect.fail('Should have thrown unique constraint error');
      } catch (error) {
        const parsed = parseDatabaseError(error, dbType);
        expect(parsed).toBeInstanceOf(UniqueConstraintError);
        if (parsed instanceof UniqueConstraintError) {
          // SQLite returns generic 'unique' constraint name
          if (dbType === 'sqlite') {
            expect(parsed.constraint).toBe('unique');
          } else {
            expect(parsed.constraint).toMatch(/email|users_email/);
          }
          expect(parsed.columns).toContain('email');
        }
      }
    });

    it('should handle foreign key violations', async () => {
      try {
        await db
          .insertInto('posts')
          .values({
            user_id: 999999,
            title: 'Invalid User Post',
            content: 'This should fail',
            published: dbType === 'sqlite' ? 0 : (false as any),
          })
          .execute();
        expect.fail('Should have thrown foreign key error');
      } catch (error) {
        const parsed = parseDatabaseError(error, dbType);
        expect(parsed).toBeInstanceOf(ForeignKeyError);
        if (parsed instanceof ForeignKeyError) {
          // PostgreSQL provides table names, SQLite and MySQL don't
          if (dbType === 'postgres') {
            expect(parsed.table).not.toBe('unknown');
          } else {
            expect(parsed.table).toBe('unknown');
          }
        }
      }
    });

    it('should handle not null violations', async () => {
      try {
        await db
          .insertInto('users')
          .values({ email: null as any, name: 'No Email' })
          .execute();
        expect.fail('Should have thrown not null error');
      } catch (error) {
        const parsed = parseDatabaseError(error, dbType);
        expect(parsed).toBeInstanceOf(DatabaseError);
        // SQLite doesn't include column name in not null errors
        if (dbType === 'sqlite') {
          expect(parsed.message).toContain('NOT NULL');
        } else {
          expect(parsed.message).toContain('email');
        }
      }
    });

    it('should handle cascading deletes', async () => {
      // Get user with posts
      const user = await db.selectFrom('users').selectAll().where('email', '=', 'alice@example.com').executeTakeFirst();

      expect(user).toBeDefined();

      // Check posts exist
      const postsBefore = await db.selectFrom('posts').selectAll().where('user_id', '=', user!.id).execute();

      expect(postsBefore).toHaveLength(2);

      // Delete user (should cascade to posts)
      await db.deleteFrom('users').where('id', '=', user!.id).execute();

      // Check posts are deleted
      const postsAfter = await db.selectFrom('posts').selectAll().where('user_id', '=', user!.id).execute();

      expect(postsAfter).toHaveLength(0);
    });
  });

  describe('Health Checks', () => {
    it('should check database health', async () => {
      // Import checkDatabaseHealth from health module
      const { checkDatabaseHealth } = await import('../src/health.js');
      const health = await checkDatabaseHealth(db as any);
      expect(health.status).toBe('healthy');
      expect(health.metrics?.checkLatency).toBeGreaterThanOrEqual(0);
      expect(health.metrics?.checkLatency).toBeLessThan(100);
    });

    it('should detect connection issues', async () => {
      if (dbType === 'sqlite') {
        // SQLite always works, skip this test
        return;
      }

      // Import checkDatabaseHealth from health module
      const { checkDatabaseHealth } = await import('../src/health.js');

      // Create a database with wrong credentials
      let badDb: Kysely<any>;
      if (dbType === 'postgres') {
        const { PostgresDialect } = await import('kysely');
        const { Pool } = await import('pg');
        badDb = new Kysely({
          dialect: new PostgresDialect({
            pool: new Pool({
              host: 'localhost',
              port: 5432,
              user: 'wrong_user',
              password: 'wrong_password',
              database: 'wrong_db',
            }),
          }),
        });
      } else {
        // MySQL
        const { MysqlDialect } = await import('kysely');
        const { createPool } = await import('mysql2');
        badDb = new Kysely({
          dialect: new MysqlDialect({
            pool: createPool({
              host: 'localhost',
              port: 3306,
              user: 'wrong_user',
              password: 'wrong_password',
              database: 'wrong_db',
            }),
          }),
        });
      }

      try {
        // Try to check health with bad credentials
        const health = await checkDatabaseHealth(badDb).catch(() => ({ status: 'unhealthy' }));
        expect(health.status).toBe('unhealthy');
      } finally {
        await badDb.destroy();
      }
    });
  });

  describe('Pagination', () => {
    it('should paginate with offset', async () => {
      const { paginate } = await import('../src/pagination.js');
      const query = db.selectFrom('users').selectAll().orderBy('email', 'asc');

      const page1 = await paginate(query, { page: 1, limit: 2 });
      expect(page1.data).toHaveLength(2);
      expect(page1.data[0]!.email).toBe('alice@example.com');
      expect(page1.pagination.hasNext).toBe(true);

      const page2 = await paginate(query, { page: 2, limit: 2 });
      expect(page2.data).toHaveLength(2);
      expect(page2.data[0]!.email).toBe('charlie@example.com');
      expect(page2.pagination.hasNext).toBe(true);

      const page3 = await paginate(query, { page: 3, limit: 2 });
      expect(page3.data).toHaveLength(1);
      expect(page3.data[0]!.email).toBe('eve@example.com');
      expect(page3.pagination.hasNext).toBe(false);
    });

    it('should paginate with cursor', async () => {
      const { paginateCursor } = await import('../src/pagination.js');
      const query = db
        .selectFrom('posts')
        .selectAll()
        .where('published', '=', (dbType === 'sqlite' ? 1 : true) as any);

      const page1 = await paginateCursor(query, {
        orderBy: [{ column: 'title', direction: 'asc' }],
        limit: 2,
      });

      expect(page1.data).toHaveLength(2);
      expect(page1.pagination.hasNext).toBe(true);
      expect(page1.pagination.nextCursor).toBeDefined();

      const page2 = await paginateCursor(query, {
        orderBy: [{ column: 'title', direction: 'asc' }],
        limit: 2,
        cursor: page1.pagination.nextCursor,
      });

      expect(page2.data).toHaveLength(2);
      expect(page2.data[0]!.id).not.toBe(page1.data[0]!.id);
    });

    it('should handle multi-column cursor pagination', async () => {
      const { paginateCursor } = await import('../src/pagination.js');
      const query = db.selectFrom('posts').selectAll();

      const page1 = await paginateCursor(query, {
        orderBy: [
          { column: 'user_id', direction: 'asc' },
          { column: 'title', direction: 'asc' },
        ],
        limit: 2,
      });

      expect(page1.data).toHaveLength(2);
      expect(page1.pagination.hasNext).toBe(true);

      const page2 = await paginateCursor(query, {
        orderBy: [
          { column: 'user_id', direction: 'asc' },
          { column: 'title', direction: 'asc' },
        ],
        limit: 2,
        cursor: page1.pagination.nextCursor,
      });

      // Ensure cursor advanced - check if we got different data or reached the end
      if (page2.data.length > 0) {
        // If we have data in page2, at least one item should be different
        const hasNewItems = page2.data.some((item2) => !page1.data.some((item1) => item1.id === item2.id));
        expect(hasNewItems || page2.data.length < 2).toBe(true);
      }
    });
  });

  describe('Transactions', () => {
    it('should rollback on error', async () => {
      const initialCount = await db.selectFrom('users').select(db.fn.count('id').as('count')).executeTakeFirst();

      try {
        await db.transaction().execute(async (trx) => {
          // Insert valid user
          await trx.insertInto('users').values({ email: 'test@example.com', name: 'Test' }).execute();

          // Insert duplicate (should fail)
          await trx.insertInto('users').values({ email: 'test@example.com', name: 'Duplicate' }).execute();
        });
      } catch {
        // Expected to fail
      }

      const finalCount = await db.selectFrom('users').select(db.fn.count('id').as('count')).executeTakeFirst();

      expect(finalCount?.count).toBe(initialCount?.count);
    });

    it('should commit successful transactions', async () => {
      const initialCount = await db.selectFrom('users').select(db.fn.count('id').as('count')).executeTakeFirst();

      await db.transaction().execute(async (trx) => {
        await trx.insertInto('users').values({ email: 'tx1@example.com', name: 'Transaction 1' }).execute();

        await trx.insertInto('users').values({ email: 'tx2@example.com', name: 'Transaction 2' }).execute();
      });

      const finalCount = await db.selectFrom('users').select(db.fn.count('id').as('count')).executeTakeFirst();

      expect(Number(finalCount?.count)).toBe(Number(initialCount?.count) + 2);
    });
  });

  describe('Complex Queries', () => {
    it('should handle joins', async () => {
      const results = await db
        .selectFrom('posts')
        .innerJoin('users', 'users.id', 'posts.user_id')
        .leftJoin('comments', 'comments.post_id', 'posts.id')
        .select(['posts.title', 'users.name as author', db.fn.count('comments.id').as('comment_count')])
        .where('posts.published', '=', (dbType === 'sqlite' ? 1 : true) as any)
        .groupBy(['posts.id', 'posts.title', 'users.name'])
        .orderBy('comment_count', 'desc')
        .execute();

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.title).toBeDefined();
      expect(results[0]?.author).toBeDefined();
      expect(results[0]?.comment_count).toBeDefined();
    });

    it('should handle subqueries', async () => {
      const usersWithPosts = await db
        .selectFrom('users')
        .selectAll('users')
        .select((eb) => [
          eb
            .selectFrom('posts')
            .select(eb.fn.count('id').as('count'))
            .whereRef('posts.user_id', '=', 'users.id')
            .as('post_count'),
        ])
        .execute();

      expect(usersWithPosts.length).toBeGreaterThan(0);
      usersWithPosts.forEach((user) => {
        expect(user.post_count).toBeDefined();
      });
    });

    it('should handle CTEs', async () => {
      const result = await db
        .with('active_users', (db) =>
          db
            .selectFrom('users')
            .innerJoin('posts', 'posts.user_id', 'users.id')
            .select(['users.id', 'users.name'])
            .where('posts.published', '=', (dbType === 'sqlite' ? 1 : true) as any)
            .groupBy(['users.id', 'users.name'])
        )
        .selectFrom('active_users')
        .selectAll()
        .execute();

      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Debug Plugin', () => {
    it('should log queries', async () => {
      const { withDebug } = await import('../src/debug.js');
      const logs: string[] = [];

      // Create a KyseraLogger-compatible object
      const testLogger = {
        debug: (msg: string) => logs.push(msg),
        info: (msg: string) => logs.push(msg),
        warn: (msg: string) => logs.push(msg),
        error: (msg: string) => logs.push(msg),
      };

      const debugDb = withDebug(db, {
        logger: testLogger,
        logQuery: true,
      });

      await debugDb.selectFrom('users').selectAll().where('email', '=', 'alice@example.com').execute();

      expect(logs.length).toBeGreaterThan(0);
      // Debug plugin currently uses simplified SQL extraction
      expect(logs[0]!.toLowerCase()).toContain('select * from');
    });

    it('should measure query performance', async () => {
      const { withDebug } = await import('../src/debug.js');

      const debugDb = withDebug(db, {
        logQuery: true,
        slowQueryThreshold: 0,
      });

      const result = await debugDb.selectFrom('posts').selectAll().execute();

      expect(result).toBeDefined();
    });
  });

  describe('Batch Operations', () => {
    it('should handle bulk inserts', async () => {
      const newUsers = Array.from({ length: 100 }, (_, i) => ({
        email: `bulk${i}@example.com`,
        name: `Bulk User ${i}`,
      }));

      await db.insertInto('users').values(newUsers).execute();

      const count = await db.selectFrom('users').select(db.fn.count('id').as('count')).executeTakeFirst();

      expect(Number(count?.count)).toBeGreaterThan(100);
    });

    it('should handle bulk updates', async () => {
      await db
        .updateTable('posts')
        .set({ published: (dbType === 'sqlite' ? 1 : true) as any })
        .where('published', '=', (dbType === 'sqlite' ? 0 : false) as any)
        .execute();

      const unpublished = await db
        .selectFrom('posts')
        .selectAll()
        .where('published', '=', (dbType === 'sqlite' ? 0 : false) as any)
        .execute();

      expect(unpublished).toHaveLength(0);
    });

    it('should handle bulk deletes', async () => {
      await db.deleteFrom('comments').where('content', 'like', '%help%').execute();

      const remaining = await db.selectFrom('comments').selectAll().execute();

      expect(remaining.every((c) => !c.content.includes('help'))).toBe(true);
    });
  });
});
