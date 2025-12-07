import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  testInTransaction,
  testWithSavepoints,
  cleanDatabase,
  createFactory,
  waitFor,
  seedDatabase,
  snapshotTable,
  countRows,
} from '../src/testing.js';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';

// Test database interface
interface TestDB {
  users: {
    id: number;
    name: string;
    email: string;
  };
  posts: {
    id: number;
    title: string;
    user_id: number;
  };
}

describe('testing', () => {
  let db: Kysely<TestDB>;

  beforeEach(async () => {
    const sqliteDb = new Database(':memory:');
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({
        database: sqliteDb,
      }),
    });

    // Create test tables
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('name', 'varchar(255)')
      .addColumn('email', 'varchar(255)')
      .execute();

    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('title', 'varchar(255)')
      .addColumn('user_id', 'integer')
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('testInTransaction', () => {
    it('should execute test function within transaction', async () => {
      let executedInTransaction = false;

      await testInTransaction(db, async (trx) => {
        await trx.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();
        executedInTransaction = true;
      });

      expect(executedInTransaction).toBe(true);
    });

    it('should rollback transaction after test', async () => {
      await testInTransaction(db, async (trx) => {
        await trx.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();

        // Verify data exists within transaction
        const users = await trx.selectFrom('users').selectAll().execute();
        expect(users.length).toBe(1);
      });

      // Verify data is rolled back
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users.length).toBe(0);
    });

    it('should rethrow non-rollback errors', async () => {
      const testError = new Error('Test error');

      await expect(
        testInTransaction(db, async () => {
          throw testError;
        })
      ).rejects.toThrow('Test error');
    });

    it('should allow assertions on inserted data', async () => {
      await testInTransaction(db, async (trx) => {
        await trx.insertInto('users').values({ name: 'John', email: 'john@example.com' }).execute();

        const user = await trx
          .selectFrom('users')
          .where('email', '=', 'john@example.com')
          .selectAll()
          .executeTakeFirst();

        expect(user).toBeDefined();
        expect(user?.name).toBe('John');
      });
    });

    it('should handle multiple inserts', async () => {
      await testInTransaction(db, async (trx) => {
        await trx
          .insertInto('users')
          .values([
            { name: 'User1', email: 'u1@test.com' },
            { name: 'User2', email: 'u2@test.com' },
          ])
          .execute();

        const count = await trx
          .selectFrom('users')
          .select((eb) => eb.fn.countAll().as('count'))
          .executeTakeFirst();

        expect(Number(count?.count)).toBe(2);
      });

      // Verify all data is rolled back
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users.length).toBe(0);
    });
  });

  describe('testWithSavepoints', () => {
    it('should create savepoint and rollback', async () => {
      await testWithSavepoints(db, async (trx) => {
        await trx.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();

        // Verify data exists
        const users = await trx.selectFrom('users').selectAll().execute();
        expect(users.length).toBe(1);
      });

      // Verify data is rolled back
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users.length).toBe(0);
    });

    it('should rethrow non-rollback errors', async () => {
      const testError = new Error('Test error');

      await expect(
        testWithSavepoints(db, async () => {
          throw testError;
        })
      ).rejects.toThrow('Test error');
    });

    it('should handle test function that completes successfully', async () => {
      let completed = false;

      await testWithSavepoints(db, async (trx) => {
        await trx.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();
        completed = true;
      });

      expect(completed).toBe(true);
    });
  });

  describe('cleanDatabase', () => {
    it('should do nothing when strategy is transaction', async () => {
      // Insert data
      await db.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();

      await cleanDatabase(db, 'transaction');

      // Data should still exist
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users.length).toBe(1);
    });

    it('should delete all rows when strategy is delete', async () => {
      // Insert data
      await db.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();
      await db.insertInto('posts').values({ title: 'Post 1', user_id: 1 }).execute();

      await cleanDatabase(db, 'delete', ['posts', 'users']);

      // Data should be deleted
      const users = await db.selectFrom('users').selectAll().execute();
      const posts = await db.selectFrom('posts').selectAll().execute();
      expect(users.length).toBe(0);
      expect(posts.length).toBe(0);
    });

    it('should throw error when tables not provided for delete strategy', async () => {
      await expect(cleanDatabase(db, 'delete')).rejects.toThrow(
        'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
      );
    });

    it('should throw error when tables not provided for truncate strategy', async () => {
      await expect(cleanDatabase(db, 'truncate')).rejects.toThrow(
        'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
      );
    });

    it('should throw error when empty tables array provided', async () => {
      await expect(cleanDatabase(db, 'delete', [])).rejects.toThrow(
        'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
      );
    });

    it('should delete in specified order', async () => {
      // Insert data with FK relationship
      await db.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();
      await db.insertInto('posts').values({ title: 'Post 1', user_id: 1 }).execute();

      // Delete posts first (dependent table), then users
      await cleanDatabase(db, 'delete', ['posts', 'users']);

      const users = await db.selectFrom('users').selectAll().execute();
      const posts = await db.selectFrom('posts').selectAll().execute();
      expect(users.length).toBe(0);
      expect(posts.length).toBe(0);
    });

    it('should use default transaction strategy', async () => {
      await db.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();

      await cleanDatabase(db);

      // Data should still exist (transaction strategy is no-op)
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users.length).toBe(1);
    });
  });

  describe('createFactory', () => {
    it('should create factory with static defaults', () => {
      const createUser = createFactory<{ id: number; name: string }>({
        id: 1,
        name: 'Default User',
      });

      const user = createUser();

      expect(user.id).toBe(1);
      expect(user.name).toBe('Default User');
    });

    it('should create factory with function defaults', () => {
      let counter = 0;
      const createUser = createFactory<{ id: number; name: string }>({
        id: () => ++counter,
        name: 'User',
      });

      const user1 = createUser();
      const user2 = createUser();

      expect(user1.id).toBe(1);
      expect(user2.id).toBe(2);
    });

    it('should allow overrides', () => {
      const createUser = createFactory<{ id: number; name: string; email: string }>({
        id: 1,
        name: 'Default',
        email: 'default@example.com',
      });

      const user = createUser({ name: 'Custom Name' });

      expect(user.id).toBe(1);
      expect(user.name).toBe('Custom Name');
      expect(user.email).toBe('default@example.com');
    });

    it('should handle dynamic email generation', () => {
      const createUser = createFactory<{ email: string }>({
        email: () => 'test' + Math.random() + '@example.com',
      });

      const user1 = createUser();
      const user2 = createUser();

      expect(user1.email).toContain('@example.com');
      expect(user1.email).not.toBe(user2.email);
    });

    it('should handle date defaults', () => {
      const createUser = createFactory<{ createdAt: Date }>({
        createdAt: () => new Date(),
      });

      const user = createUser();

      expect(user.createdAt).toBeInstanceOf(Date);
    });

    it('should override function defaults with values', () => {
      const createUser = createFactory<{ id: number }>({
        id: () => Math.random(),
      });

      const user = createUser({ id: 42 });

      expect(user.id).toBe(42);
    });

    it('should return new object each time', () => {
      const createUser = createFactory<{ name: string }>({
        name: 'Test',
      });

      const user1 = createUser();
      const user2 = createUser();

      expect(user1).not.toBe(user2);
    });

    it('should handle empty overrides', () => {
      const createUser = createFactory<{ name: string }>({
        name: 'Test',
      });

      const user = createUser({});

      expect(user.name).toBe('Test');
    });
  });

  describe('waitFor', () => {
    it('should resolve immediately if condition is true', async () => {
      const condition = vi.fn().mockResolvedValue(true);

      await waitFor(condition, { timeout: 100, interval: 10 });

      expect(condition).toHaveBeenCalledTimes(1);
    });

    it('should poll until condition is true', async () => {
      let callCount = 0;
      const condition = vi.fn().mockImplementation(async () => {
        callCount++;
        return callCount >= 3;
      });

      await waitFor(condition, { timeout: 500, interval: 10 });

      expect(callCount).toBe(3);
    });

    it('should throw on timeout', async () => {
      const condition = vi.fn().mockResolvedValue(false);

      await expect(
        waitFor(condition, { timeout: 50, interval: 10 })
      ).rejects.toThrow('Condition not met within timeout');
    });

    it('should use custom timeout message', async () => {
      const condition = vi.fn().mockResolvedValue(false);

      await expect(
        waitFor(condition, {
          timeout: 50,
          interval: 10,
          timeoutMessage: 'Custom timeout message',
        })
      ).rejects.toThrow('Custom timeout message');
    });

    it('should handle synchronous condition', async () => {
      let callCount = 0;
      const condition = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount >= 2;
      });

      await waitFor(condition, { timeout: 500, interval: 10 });

      expect(condition).toHaveBeenCalled();
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('should call condition multiple times before timeout', async () => {
      const condition = vi.fn().mockResolvedValue(false);

      try {
        await waitFor(condition, { timeout: 100, interval: 20 });
      } catch {
        // Expected to throw
      }

      // Should have been called multiple times (at least 2-3 times in 100ms with 20ms interval)
      expect(condition.mock.calls.length).toBeGreaterThan(1);
    });

    it('should support async conditions', async () => {
      let resolved = false;
      setTimeout(() => {
        resolved = true;
      }, 30);

      const condition = vi.fn().mockImplementation(async () => resolved);

      await waitFor(condition, { timeout: 500, interval: 10 });

      expect(resolved).toBe(true);
    });

    it('should stop polling once condition returns true', async () => {
      let callCount = 0;
      const condition = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 2;
      });

      await waitFor(condition, { timeout: 500, interval: 10 });

      // Wait a bit to ensure no more calls happen
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callCount).toBe(2);
    });
  });

  describe('seedDatabase', () => {
    it('should execute seeding function in transaction', async () => {
      await seedDatabase(db, async (trx) => {
        await trx.insertInto('users').values({ name: 'Seed User', email: 'seed@example.com' }).execute();
      });

      const users = await db.selectFrom('users').selectAll().execute();
      expect(users.length).toBe(1);
      expect(users[0].name).toBe('Seed User');
    });

    it('should commit transaction on success', async () => {
      await seedDatabase(db, async (trx) => {
        await trx.insertInto('users').values({ name: 'User 1', email: 'u1@test.com' }).execute();
        await trx.insertInto('users').values({ name: 'User 2', email: 'u2@test.com' }).execute();
      });

      const users = await db.selectFrom('users').selectAll().execute();
      expect(users.length).toBe(2);
    });

    it('should rollback on error', async () => {
      await expect(
        seedDatabase(db, async (trx) => {
          await trx.insertInto('users').values({ name: 'User', email: 'u@test.com' }).execute();
          throw new Error('Seeding error');
        })
      ).rejects.toThrow('Seeding error');

      // Data should be rolled back
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users.length).toBe(0);
    });

    it('should allow seeding multiple tables', async () => {
      await seedDatabase(db, async (trx) => {
        await trx.insertInto('users').values({ name: 'User 1', email: 'u1@test.com' }).execute();
        await trx.insertInto('posts').values({ title: 'Post 1', user_id: 1 }).execute();
      });

      const users = await db.selectFrom('users').selectAll().execute();
      const posts = await db.selectFrom('posts').selectAll().execute();
      expect(users.length).toBe(1);
      expect(posts.length).toBe(1);
    });
  });

  describe('snapshotTable', () => {
    it('should return all rows from table', async () => {
      await db
        .insertInto('users')
        .values([
          { name: 'User 1', email: 'u1@test.com' },
          { name: 'User 2', email: 'u2@test.com' },
        ])
        .execute();

      const snapshot = await snapshotTable(db, 'users');

      expect(snapshot.length).toBe(2);
      expect(snapshot[0].name).toBe('User 1');
      expect(snapshot[1].name).toBe('User 2');
    });

    it('should return empty array for empty table', async () => {
      const snapshot = await snapshotTable(db, 'users');

      expect(snapshot).toEqual([]);
    });

    it('should capture all columns', async () => {
      await db.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();

      const snapshot = await snapshotTable(db, 'users');

      expect(snapshot[0]).toHaveProperty('id');
      expect(snapshot[0]).toHaveProperty('name');
      expect(snapshot[0]).toHaveProperty('email');
    });

    it('should allow comparison between snapshots', async () => {
      const before = await snapshotTable(db, 'users');

      await db.insertInto('users').values({ name: 'New User', email: 'new@test.com' }).execute();

      const after = await snapshotTable(db, 'users');

      expect(before.length).toBe(0);
      expect(after.length).toBe(1);
    });
  });

  describe('countRows', () => {
    it('should return 0 for empty table', async () => {
      const count = await countRows(db, 'users');

      expect(count).toBe(0);
    });

    it('should return correct count', async () => {
      await db
        .insertInto('users')
        .values([
          { name: 'User 1', email: 'u1@test.com' },
          { name: 'User 2', email: 'u2@test.com' },
          { name: 'User 3', email: 'u3@test.com' },
        ])
        .execute();

      const count = await countRows(db, 'users');

      expect(count).toBe(3);
    });

    it('should count different tables independently', async () => {
      await db.insertInto('users').values({ name: 'User 1', email: 'u1@test.com' }).execute();
      await db
        .insertInto('posts')
        .values([
          { title: 'Post 1', user_id: 1 },
          { title: 'Post 2', user_id: 1 },
        ])
        .execute();

      const usersCount = await countRows(db, 'users');
      const postsCount = await countRows(db, 'posts');

      expect(usersCount).toBe(1);
      expect(postsCount).toBe(2);
    });

    it('should return number type', async () => {
      const count = await countRows(db, 'users');

      expect(typeof count).toBe('number');
    });
  });
});
