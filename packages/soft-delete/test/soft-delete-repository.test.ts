import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, seedTestData } from './setup/database.js';
import { softDeletePlugin } from '../src/index.js';
import { createORM } from '../../kysera-repository/dist/index.js';
import { createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';
import { z } from 'zod';

// Type definitions for test data
interface TestUser {
  id: number;
  email: string;
  name: string;
  created_at: string;
  deleted_at: string | null;
}

// Define repository interface
interface SoftDeleteRepository {
  tableName: string;
  executor: Kysely<TestDatabase>;
  findAll: () => Promise<TestUser[]>;
  findById: (id: number) => Promise<TestUser | null>;
  update: (id: number, data: Partial<TestUser>) => Promise<TestUser>;
  softDelete?: (id: number) => Promise<TestUser>;
  restore?: (id: number) => Promise<TestUser>;
  hardDelete?: (id: number) => Promise<void>;
  findAllWithDeleted?: () => Promise<TestUser[]>;
  findDeleted?: () => Promise<TestUser[]>;
  findWithDeleted?: (id: number) => Promise<TestUser | null>;
}

describe('Soft Delete Plugin - Repository Extension', () => {
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

  it('should extend repository with soft delete methods', async () => {
    const plugin = softDeletePlugin();
    const orm = await createORM(db, [plugin]);

    const repo = orm.createRepository((executor) => {
      const base = createRepositoryFactory(executor);
      return base.create({
        tableName: 'users' as keyof TestDatabase,
        mapRow: (row) => row as TestUser,
        schemas: {
          create: z.any(),
          update: z.any(),
        },
      });
    }) as SoftDeleteRepository;

    expect(repo.softDelete).toBeDefined();
    expect(repo.restore).toBeDefined();
    expect(repo.findAllWithDeleted).toBeDefined();
    expect(repo.findDeleted).toBeDefined();
    expect(repo.hardDelete).toBeDefined();
  });

  it('should soft delete records', async () => {
    const plugin = softDeletePlugin();
    const orm = await createORM(db, [plugin]);

    const repo = orm.createRepository((executor) => {
      const base = createRepositoryFactory(executor);
      return base.create({
        tableName: 'users' as keyof TestDatabase,
        mapRow: (row) => row as TestUser,
        schemas: {
          create: z.any(),
          update: z.any(),
        },
      });
    }) as SoftDeleteRepository;

    // Get Alice's ID
    const users = await db.selectFrom('users').selectAll().where('name', '=', 'Alice').execute();

    const aliceId = users[0]?.id;
    if (!aliceId) {
      throw new Error('Alice not found');
    }

    // Soft delete Alice
    if (repo.softDelete) {
      await repo.softDelete(aliceId);
    } else {
      throw new Error('softDelete method not found');
    }

    // Alice should be soft deleted
    const deletedAlice = await db.selectFrom('users').selectAll().where('id', '=', aliceId).executeTakeFirst();

    expect(deletedAlice?.deleted_at).not.toBeNull();
  });

  it('should restore soft-deleted records', async () => {
    const plugin = softDeletePlugin();
    const orm = await createORM(db, [plugin]);

    const repo = orm.createRepository((executor) => {
      const base = createRepositoryFactory(executor);
      return base.create({
        tableName: 'users' as keyof TestDatabase,
        mapRow: (row) => row as TestUser,
        schemas: {
          create: z.any(),
          update: z.any(),
        },
      });
    }) as SoftDeleteRepository;

    // Soft delete Bob
    const bob = await db.selectFrom('users').selectAll().where('name', '=', 'Bob').executeTakeFirst();

    const bobId = bob?.id;
    if (!bobId) {
      throw new Error('Bob not found');
    }

    await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).where('id', '=', bobId).execute();

    // Restore Bob
    if (repo.restore) {
      await repo.restore(bobId);
    } else {
      throw new Error('restore method not found');
    }

    // Bob should be restored
    const restoredBob = await db.selectFrom('users').selectAll().where('id', '=', bobId).executeTakeFirst();

    expect(restoredBob?.deleted_at).toBeNull();
  });

  it('should find all records including deleted', async () => {
    const plugin = softDeletePlugin();
    const orm = await createORM(db, [plugin]);

    const repo = orm.createRepository((executor) => {
      const base = createRepositoryFactory(executor);
      return base.create({
        tableName: 'users' as keyof TestDatabase,
        mapRow: (row) => row as TestUser,
        schemas: {
          create: z.any(),
        },
      });
    }) as SoftDeleteRepository;

    // Soft delete Bob
    await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).where('name', '=', 'Bob').execute();

    // Normal findAll should exclude deleted
    const normalResults = await repo.findAll();
    expect(normalResults).toHaveLength(2);

    // findAllWithDeleted should include all
    if (repo.findAllWithDeleted) {
      const allResults = await repo.findAllWithDeleted();
      expect(allResults).toHaveLength(3);
    } else {
      throw new Error('findAllWithDeleted method not found');
    }
  });

  it('should find only deleted records', async () => {
    const plugin = softDeletePlugin();
    const orm = await createORM(db, [plugin]);

    const repo = orm.createRepository((executor) => {
      const base = createRepositoryFactory(executor);
      return base.create({
        tableName: 'users' as keyof TestDatabase,
        mapRow: (row) => row as TestUser,
        schemas: {
          create: z.any(),
        },
      });
    }) as SoftDeleteRepository;

    // Soft delete Bob and Alice
    await db
      .updateTable('users')
      .set({ deleted_at: new Date().toISOString() })
      .where('name', 'in', ['Bob', 'Alice'])
      .execute();

    // Find only deleted records
    if (repo.findDeleted) {
      const deletedResults = await repo.findDeleted();
      expect(deletedResults).toHaveLength(2);
      expect(deletedResults.every((u) => u.deleted_at !== null)).toBe(true);
    } else {
      throw new Error('findDeleted method not found');
    }
  });

  it('should hard delete records', async () => {
    const plugin = softDeletePlugin();
    const orm = await createORM(db, [plugin]);

    const repo = orm.createRepository((executor) => {
      const base = createRepositoryFactory(executor);
      return base.create({
        tableName: 'users' as keyof TestDatabase,
        mapRow: (row) => row as TestUser,
        schemas: {
          create: z.any(),
        },
      });
    }) as SoftDeleteRepository;

    // Get Charlie's ID
    const charlie = await db.selectFrom('users').selectAll().where('name', '=', 'Charlie').executeTakeFirst();

    const charlieId = charlie?.id;
    if (!charlieId) {
      throw new Error('Charlie not found');
    }

    // Hard delete Charlie
    if (repo.hardDelete) {
      await repo.hardDelete(charlieId);
    } else {
      throw new Error('hardDelete method not found');
    }

    // Charlie should be completely gone
    const deletedCharlie = await db.selectFrom('users').selectAll().where('id', '=', charlieId).executeTakeFirst();

    expect(deletedCharlie).toBeUndefined();
  });
});
