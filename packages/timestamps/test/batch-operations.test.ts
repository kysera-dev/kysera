import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely } from 'kysely';
import Database from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { createORM, createRepositoryFactory, type Plugin } from '../../kysera-repository/dist/index.js';
import { timestampsPlugin } from '../src';

// Test database schema
interface TestDatabase {
  users: {
    id: number;
    name: string;
    email: string;
    created_at?: Date | string | null;
    updated_at?: Date | string | null;
  };
}

// Helper function to create a repository with plugins
async function createTestRepository<TableName extends keyof TestDatabase & string>(
  db: Kysely<TestDatabase>,
  tableName: TableName,
  plugins: Plugin[] = []
): Promise<any> {
  const orm = await createORM<TestDatabase>(db, plugins);
  return orm.createRepository((executor) => {
    const factory = createRepositoryFactory<TestDatabase>(executor);
    return factory.create<TableName, any>({
      tableName,
      mapRow: (row) => row,
      schemas: {
        create: { parse: (v: any) => v } as any,
        update: { parse: (v: any) => v } as any,
      },
    });
  });
}

describe('Batch Operations', () => {
  let db: Kysely<TestDatabase>;
  let sqlite: Database.Database;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({ database: sqlite }),
    });

    // Create test table
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('email', 'text', (col) => col.notNull().unique())
      .addColumn('created_at', 'text')
      .addColumn('updated_at', 'text')
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
    sqlite.close();
  });

  describe('createMany', () => {
    it('should create multiple records with timestamps', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      const beforeDate = new Date();
      const users = await userRepo.createMany([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' },
      ]);
      const afterDate = new Date();

      expect(users).toHaveLength(3);

      users.forEach((user: any) => {
        expect(user.created_at).toBeDefined();
        const createdAt = new Date(user.created_at);
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeDate.getTime());
        expect(createdAt.getTime()).toBeLessThanOrEqual(afterDate.getTime());
      });

      // Verify all users have the same timestamp
      const timestamps = users.map((u: any) => u.created_at);
      expect(new Set(timestamps).size).toBe(1); // All should be the same
    });

    it('should handle empty array gracefully', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      const users = await userRepo.createMany([]);
      expect(users).toHaveLength(0);
    });

    it('should respect setUpdatedAtOnInsert for batch creates', async () => {
      const plugin = timestampsPlugin({
        setUpdatedAtOnInsert: true,
      });
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      const users = await userRepo.createMany([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
      ]);

      users.forEach((user: any) => {
        expect(user.created_at).toBeDefined();
        expect(user.updated_at).toBeDefined();
        expect(user.created_at).toBe(user.updated_at);
      });
    });

    it('should use custom timestamp generator for batch creates', async () => {
      const customTimestamp = '2024-01-01T00:00:00.000Z';
      const plugin = timestampsPlugin({
        getTimestamp: () => customTimestamp,
      });
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      const users = await userRepo.createMany([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
      ]);

      users.forEach((user: any) => {
        expect(user.created_at).toBe(customTimestamp);
      });
    });

    it('should handle large batches efficiently', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      const batchSize = 100;
      const inputs = Array.from({ length: batchSize }, (_, i) => ({
        name: `User ${i}`,
        email: `user${i}@example.com`,
      }));

      const startTime = Date.now();
      const users = await userRepo.createMany(inputs);
      const duration = Date.now() - startTime;

      expect(users).toHaveLength(batchSize);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second

      users.forEach((user: any) => {
        expect(user.created_at).toBeDefined();
      });
    });

    it('should check for createMany method existence', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      expect(typeof userRepo.createMany).toBe('function');
    });
  });

  describe('updateMany', () => {
    it('should update multiple records with timestamp', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      // Create test users
      const created = await userRepo.createMany([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' },
      ]);

      const ids = created.map((u: any) => u.id);

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const beforeUpdate = new Date();
      const updated = await userRepo.updateMany(ids, { name: 'Updated Name' });
      const afterUpdate = new Date();

      expect(updated).toHaveLength(3);

      updated.forEach((user: any) => {
        expect(user.name).toBe('Updated Name');
        expect(user.updated_at).toBeDefined();

        const updatedAt = new Date(user.updated_at);
        expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
        expect(updatedAt.getTime()).toBeLessThanOrEqual(afterUpdate.getTime());
      });
    });

    it('should handle empty ids array gracefully', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      const updated = await userRepo.updateMany([], { name: 'Updated' });
      expect(updated).toHaveLength(0);
    });

    it('should update only specified records', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      // Create 5 users
      const created = await userRepo.createMany([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' },
        { name: 'User 4', email: 'user4@example.com' },
        { name: 'User 5', email: 'user5@example.com' },
      ]);

      // Update only first 3
      const idsToUpdate = created.slice(0, 3).map((u: any) => u.id);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await userRepo.updateMany(idsToUpdate, { name: 'Updated' });

      expect(updated).toHaveLength(3);
      updated.forEach((user: any) => {
        expect(user.name).toBe('Updated');
        expect(user.updated_at).toBeDefined();
      });

      // Verify others weren't updated
      const allUsers = await db.selectFrom('users').selectAll().execute();
      const notUpdated = allUsers.filter((u: any) => !idsToUpdate.includes(u.id));

      notUpdated.forEach((user: any) => {
        expect(user.name).not.toBe('Updated');
      });
    });

    it('should handle string ids', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      const created = await userRepo.createMany([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
      ]);

      const stringIds = created.map((u: any) => String(u.id));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await userRepo.updateMany(stringIds, { name: 'Updated' });

      expect(updated).toHaveLength(2);
      updated.forEach((user: any) => {
        expect(user.name).toBe('Updated');
      });
    });

    it('should check for updateMany method existence', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      expect(typeof userRepo.updateMany).toBe('function');
    });
  });

  describe('touchMany', () => {
    it('should touch multiple records (update timestamps only)', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      // Create test users
      const created = await userRepo.createMany([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' },
      ]);

      const ids = created.map((u: any) => u.id);
      const originalNames = created.map((u: any) => u.name);

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const beforeTouch = new Date();
      await userRepo.touchMany(ids);
      const afterTouch = new Date();

      // Fetch updated records
      const touched = await db.selectFrom('users').selectAll().where('id', 'in', ids).execute();

      expect(touched).toHaveLength(3);

      touched.forEach((user: any, index: number) => {
        // Names should be unchanged
        expect(user.name).toBe(originalNames[index]);

        // updated_at should be set
        expect(user.updated_at).toBeDefined();

        const updatedAt = new Date(user.updated_at);
        expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeTouch.getTime());
        expect(updatedAt.getTime()).toBeLessThanOrEqual(afterTouch.getTime());
      });
    });

    it('should handle empty ids array gracefully', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      await expect(userRepo.touchMany([])).resolves.toBeUndefined();
    });

    it('should update all touched records with same timestamp', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      const created = await userRepo.createMany([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' },
      ]);

      const ids = created.map((u: any) => u.id);
      await new Promise((resolve) => setTimeout(resolve, 10));

      await userRepo.touchMany(ids);

      // Fetch and verify all have same timestamp
      const touched = await db.selectFrom('users').selectAll().where('id', 'in', ids).execute();

      const timestamps = touched.map((u: any) => u.updated_at);
      expect(new Set(timestamps).size).toBe(1); // All should be the same
    });

    it('should work with large batches', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      const batchSize = 50;
      const inputs = Array.from({ length: batchSize }, (_, i) => ({
        name: `User ${i}`,
        email: `user${i}@example.com`,
      }));

      const created = await userRepo.createMany(inputs);
      const ids = created.map((u: any) => u.id);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const startTime = Date.now();
      await userRepo.touchMany(ids);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500); // Should be fast

      // Verify all were touched
      const touched = await db.selectFrom('users').selectAll().where('id', 'in', ids).execute();

      touched.forEach((user: any) => {
        expect(user.updated_at).toBeDefined();
      });
    });

    it('should check for touchMany method existence', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      expect(typeof userRepo.touchMany).toBe('function');
    });
  });

  describe('Combined batch operations', () => {
    it('should work seamlessly together', async () => {
      const plugin = timestampsPlugin();
      const userRepo = await createTestRepository(db, 'users', [plugin]);

      // Create batch
      const created = await userRepo.createMany([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' },
        { name: 'User 4', email: 'user4@example.com' },
      ]);

      expect(created).toHaveLength(4);
      created.forEach((user: any) => {
        expect(user.created_at).toBeDefined();
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update some
      const idsToUpdate = created.slice(0, 2).map((u: any) => u.id);
      const updated = await userRepo.updateMany(idsToUpdate, { name: 'Updated' });

      expect(updated).toHaveLength(2);
      updated.forEach((user: any) => {
        expect(user.name).toBe('Updated');
        expect(user.updated_at).toBeDefined();
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Touch others
      const idsToTouch = created.slice(2).map((u: any) => u.id);
      await userRepo.touchMany(idsToTouch);

      // Verify final state
      const allUsers = await db.selectFrom('users').selectAll().execute();
      expect(allUsers).toHaveLength(4);

      // First 2 should be updated with new name and timestamp
      const updatedUsers = allUsers.filter((u: any) => idsToUpdate.includes(u.id));
      updatedUsers.forEach((user: any) => {
        expect(user.name).toBe('Updated');
        expect(user.updated_at).toBeDefined();
      });

      // Last 2 should have original names but touched timestamps
      const touchedUsers = allUsers.filter((u: any) => idsToTouch.includes(u.id));
      touchedUsers.forEach((user: any) => {
        expect(user.name).toMatch(/^User [34]$/);
        expect(user.updated_at).toBeDefined();
      });
    });
  });
});
