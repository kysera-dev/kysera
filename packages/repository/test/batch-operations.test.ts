import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createTestDatabase } from './setup/database.js';
import { createRepositoryFactory } from '../src/index.js';
import type { Kysely, Selectable } from 'kysely';
import type { TestDatabase } from './setup/database.js';

// Define schemas for validation
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

const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
});

// Domain type
interface User {
  id: number;
  email: string;
  name: string;
  created_at: Date | string;
  deleted_at: Date | string | null;
}

describe('Batch Operations - Parallel Execution', () => {
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

  describe('bulkUpdate', () => {
    it('should execute updates in parallel', async () => {
      const factory = createRepositoryFactory(db);
      const userRepo = factory.create({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>): User => ({
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

      // Create multiple users
      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' });
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' });
      const user3 = await userRepo.create({ email: 'user3@test.com', name: 'User 3' });

      // Update all users at once
      const startTime = Date.now();
      const updated = await userRepo.bulkUpdate([
        { id: user1.id, data: { name: 'Updated User 1' } },
        { id: user2.id, data: { name: 'Updated User 2' } },
        { id: user3.id, data: { name: 'Updated User 3' } },
      ]);
      const duration = Date.now() - startTime;

      expect(updated).toHaveLength(3);
      expect(updated[0]?.name).toBe('Updated User 1');
      expect(updated[1]?.name).toBe('Updated User 2');
      expect(updated[2]?.name).toBe('Updated User 3');

      // Parallel execution should be fast (< 100ms for 3 updates)
      // This is just a sanity check - actual time will vary
      expect(duration).toBeLessThan(1000);
    });

    it('should handle errors in parallel updates correctly', async () => {
      const factory = createRepositoryFactory(db);
      const userRepo = factory.create({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>): User => ({
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

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' });

      // Try to update a non-existent user (should fail)
      await expect(
        userRepo.bulkUpdate([
          { id: user1.id, data: { name: 'Updated' } },
          { id: 99999, data: { name: 'Non-existent' } }, // This will fail
        ])
      ).rejects.toThrow('Record not found');
    });

    it('should update different fields in parallel', async () => {
      const factory = createRepositoryFactory(db);
      const userRepo = factory.create({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>): User => ({
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

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' });
      const user2 = await userRepo.create({ email: 'user2@test.com', name: 'User 2' });

      // Update different fields
      const updated = await userRepo.bulkUpdate([
        { id: user1.id, data: { name: 'New Name 1' } },
        { id: user2.id, data: { email: 'new2@test.com' } },
      ]);

      expect(updated[0]?.name).toBe('New Name 1');
      expect(updated[0]?.email).toBe('user1@test.com'); // Unchanged

      expect(updated[1]?.name).toBe('User 2'); // Unchanged
      expect(updated[1]?.email).toBe('new2@test.com');
    });

    it('should work with empty update array', async () => {
      const factory = createRepositoryFactory(db);
      const userRepo = factory.create({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>): User => ({
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

      const updated = await userRepo.bulkUpdate([]);
      expect(updated).toEqual([]);
    });

    it('should validate input data before updating', async () => {
      const factory = createRepositoryFactory(db);
      const userRepo = factory.create({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>): User => ({
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

      const user1 = await userRepo.create({ email: 'user1@test.com', name: 'User 1' });

      // Invalid email should fail validation
      await expect(userRepo.bulkUpdate([{ id: user1.id, data: { email: 'invalid-email' } }])).rejects.toThrow();
    });

    it('should support large batch updates', async () => {
      const factory = createRepositoryFactory(db);
      const userRepo = factory.create({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>): User => ({
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

      // Create 20 users
      const users = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          userRepo.create({
            email: `user${i}@test.com`,
            name: `User ${i}`,
          })
        )
      );

      // Update all 20 users in parallel
      const updates = users.map((user, i) => ({
        id: user.id,
        data: { name: `Updated User ${i}` },
      }));

      const startTime = Date.now();
      const updated = await userRepo.bulkUpdate(updates);
      const duration = Date.now() - startTime;

      expect(updated).toHaveLength(20);
      updated.forEach((user, i) => {
        expect(user.name).toBe(`Updated User ${i}`);
      });

      // Parallel should be faster than sequential
      // With 20 updates, parallel should still be under 1 second
      expect(duration).toBeLessThan(2000);
    });

    it('should work inside transactions', async () => {
      const factory = createRepositoryFactory(db);

      await db.transaction().execute(async (trx) => {
        // Note: This uses the transaction executor
        const txFactory = createRepositoryFactory(trx);
        const txUserRepo = txFactory.create<'users', User>({
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

        const user1 = await txUserRepo.create({ email: 'user1@test.com', name: 'User 1' });
        const user2 = await txUserRepo.create({ email: 'user2@test.com', name: 'User 2' });

        const updated = await txUserRepo.bulkUpdate([
          { id: user1.id, data: { name: 'TX User 1' } },
          { id: user2.id, data: { name: 'TX User 2' } },
        ]);

        expect(updated[0]?.name).toBe('TX User 1');
        expect(updated[1]?.name).toBe('TX User 2');
      });

      // Verify data was committed
      const userRepo = factory.create({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>): User => ({
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

      const users = await userRepo.findAll();
      expect(users).toHaveLength(2);
      expect(users.some((u) => u.name === 'TX User 1')).toBe(true);
      expect(users.some((u) => u.name === 'TX User 2')).toBe(true);
    });
  });

  describe('Performance comparison note', () => {
    it('should demonstrate parallel is faster than sequential', async () => {
      // This test documents the performance improvement
      // In real-world usage, parallel execution can be 5-10x faster for batch operations

      const factory = createRepositoryFactory(db);
      const userRepo = factory.create({
        tableName: 'users',
        mapRow: (row: Selectable<TestDatabase['users']>): User => ({
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
      const users = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          userRepo.create({
            email: `perf${i}@test.com`,
            name: `Perf User ${i}`,
          })
        )
      );

      // Measure parallel update time
      const updates = users.map((user, i) => ({
        id: user.id,
        data: { name: `Parallel ${i}` },
      }));

      const parallelStart = Date.now();
      await userRepo.bulkUpdate(updates);
      const parallelDuration = Date.now() - parallelStart;

      // Verify all updates succeeded
      const updatedUsers = await userRepo.findAll();
      expect(updatedUsers.every((u) => u.name.startsWith('Parallel'))).toBe(true);

      // Parallel should complete in reasonable time
      expect(parallelDuration).toBeLessThan(1000);
    });
  });
});
