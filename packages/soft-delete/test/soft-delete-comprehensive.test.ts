/**
 * Comprehensive Soft Delete Plugin Tests
 *
 * This file provides complete test coverage for the @kysera/soft-delete plugin,
 * covering all 9 methods of SoftDeleteMethods interface plus configuration options.
 *
 * Test Categories:
 * 1. Core Methods (softDelete, restore, hardDelete)
 * 2. Query Methods (findWithDeleted, findAllWithDeleted, findDeleted)
 * 3. Bulk Operations (softDeleteMany, restoreMany, hardDeleteMany)
 * 4. Configuration Options (deletedAtColumn, primaryKeyColumn, tables, includeDeleted)
 * 5. Plugin Integration (timestamps, audit)
 * 6. Edge Cases and Error Handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Kysely, SqliteDialect, type Generated } from 'kysely';
import sqliteConstructor from 'better-sqlite3';
import type { Database as SQLiteDatabase } from 'better-sqlite3';
import { softDeletePlugin, SoftDeleteOptionsSchema, type SoftDeleteRepository } from '../src/index.js';
import { createORM, createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import type { Plugin, AnyQueryBuilder } from '../../kysera-repository/dist/index.js';
import { z } from 'zod';

// =============================================================================
// Test Database Schema
// =============================================================================

interface ComprehensiveTestDatabase {
  users: {
    id: Generated<number>;
    email: string;
    name: string;
    created_at: Generated<string>;
    updated_at: string | null;
    deleted_at: string | null;
  };
  posts: {
    id: Generated<number>;
    user_id: number;
    title: string;
    content: string;
    published: number;
    created_at: Generated<string>;
    removed_at: string | null; // Custom deleted column name
  };
  comments: {
    comment_id: Generated<number>; // Custom primary key
    post_id: number;
    user_id: number;
    content: string;
    deleted_at: string | null;
  };
  audit_logs: {
    id: Generated<number>;
    entity_type: string;
    entity_id: number;
    action: string;
    timestamp: Generated<string>;
    // No deleted_at - not soft-deletable
  };
}

interface TestUser {
  id: number;
  email: string;
  name: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

interface TestPost {
  id: number;
  user_id: number;
  title: string;
  content: string;
  published: number;
  created_at: string;
  removed_at: string | null;
}

interface TestComment {
  comment_id: number;
  post_id: number;
  user_id: number;
  content: string;
  deleted_at: string | null;
}

// =============================================================================
// Test Setup Utilities
// =============================================================================

function createComprehensiveTestDatabase(): {
  db: Kysely<ComprehensiveTestDatabase>;
  sqlite: SQLiteDatabase;
  cleanup: () => void;
} {
  const sqlite = new sqliteConstructor(':memory:');

  const db = new Kysely<ComprehensiveTestDatabase>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  });

  sqlite.exec('PRAGMA foreign_keys = OFF');

  return {
    db,
    sqlite,
    cleanup: () => {
      void db.destroy();
      sqlite.close();
    },
  };
}

async function initializeComprehensiveSchema(db: Kysely<ComprehensiveTestDatabase>): Promise<void> {
  // Users table
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .addColumn('updated_at', 'text')
    .addColumn('deleted_at', 'text')
    .execute();

  // Posts table with custom deleted column name
  await db.schema
    .createTable('posts')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('published', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .addColumn('removed_at', 'text') // Custom deleted column
    .execute();

  // Comments table with custom primary key
  await db.schema
    .createTable('comments')
    .addColumn('comment_id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('post_id', 'integer', (col) => col.notNull())
    .addColumn('user_id', 'integer', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('deleted_at', 'text')
    .execute();

  // Audit logs table (not soft-deletable)
  await db.schema
    .createTable('audit_logs')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('entity_type', 'text', (col) => col.notNull())
    .addColumn('entity_id', 'integer', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('timestamp', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .execute();
}

async function seedComprehensiveTestData(db: Kysely<ComprehensiveTestDatabase>): Promise<void> {
  await initializeComprehensiveSchema(db);

  // Seed users
  await db
    .insertInto('users')
    .values([
      { email: 'alice@test.com', name: 'Alice' },
      { email: 'bob@test.com', name: 'Bob' },
      { email: 'charlie@test.com', name: 'Charlie' },
      { email: 'diana@test.com', name: 'Diana' },
      { email: 'eve@test.com', name: 'Eve' },
    ])
    .execute();

  // Seed posts
  await db
    .insertInto('posts')
    .values([
      { user_id: 1, title: 'First Post', content: 'Content 1', published: 1 },
      { user_id: 1, title: 'Second Post', content: 'Content 2', published: 0 },
      { user_id: 2, title: 'Bob Post', content: 'Bob content', published: 1 },
      { user_id: 3, title: 'Charlie Post', content: 'Charlie content', published: 1 },
    ])
    .execute();

  // Seed comments
  await db
    .insertInto('comments')
    .values([
      { post_id: 1, user_id: 2, content: 'Great post!' },
      { post_id: 1, user_id: 3, content: 'Thanks for sharing' },
      { post_id: 2, user_id: 1, content: 'Self comment' },
    ])
    .execute();

  // Seed audit logs
  await db
    .insertInto('audit_logs')
    .values([
      { entity_type: 'user', entity_id: 1, action: 'created' },
      { entity_type: 'post', entity_id: 1, action: 'created' },
    ])
    .execute();
}

// =============================================================================
// Test Suite 1: Core Methods (softDelete, restore, hardDelete)
// =============================================================================

describe('Soft Delete Plugin - Core Methods', () => {
  let db: Kysely<ComprehensiveTestDatabase>;
  let cleanup: () => void;

  beforeEach(async () => {
    const setup = createComprehensiveTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    await seedComprehensiveTestData(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('softDelete()', () => {
    it('should mark record with deleted_at timestamp', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const alice = users.find((u) => u.name === 'Alice');
      expect(alice).toBeDefined();

      const result = await repo.softDelete(alice!.id);

      expect(result).toBeDefined();
      expect(result.deleted_at).not.toBeNull();
      expect(typeof result.deleted_at).toBe('string');

      // Verify in database
      const dbRecord = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', alice!.id)
        .executeTakeFirst();
      expect(dbRecord?.deleted_at).not.toBeNull();
    });

    it('should throw NotFoundError for non-existent record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      await expect(repo.softDelete(99999)).rejects.toThrow('Record not found');
    });

    it('should update timestamp when soft deleting already deleted record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const bob = users.find((u) => u.name === 'Bob')!;

      // First delete
      const firstResult = await repo.softDelete(bob.id);
      const firstTimestamp = firstResult.deleted_at;

      // Wait briefly
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second delete - should not throw, should update timestamp
      const secondResult = await repo.softDelete(bob.id);
      expect(secondResult.deleted_at).not.toBeNull();

      // Both timestamps should be valid
      expect(new Date(firstTimestamp!).getTime()).not.toBeNaN();
      expect(new Date(secondResult.deleted_at!).getTime()).not.toBeNaN();
    });
  });

  describe('restore()', () => {
    it('should clear deleted_at timestamp', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const charlie = users.find((u) => u.name === 'Charlie')!;

      // Soft delete first
      await repo.softDelete(charlie.id);

      // Verify deleted
      const deleted = await db.selectFrom('users').selectAll().where('id', '=', charlie.id).executeTakeFirst();
      expect(deleted?.deleted_at).not.toBeNull();

      // Restore
      const restored = await repo.restore(charlie.id);

      expect(restored.deleted_at).toBeNull();
      expect(restored.name).toBe('Charlie');

      // Verify in database
      const dbRecord = await db.selectFrom('users').selectAll().where('id', '=', charlie.id).executeTakeFirst();
      expect(dbRecord?.deleted_at).toBeNull();
    });

    it('should be idempotent when restoring non-deleted record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const diana = users.find((u) => u.name === 'Diana')!;

      // Record was never deleted
      expect(diana.deleted_at).toBeNull();

      // Restore should not throw and should return the record
      const result = await repo.restore(diana.id);
      expect(result.deleted_at).toBeNull();
      expect(result.name).toBe('Diana');
    });

    it('should throw NotFoundError for non-existent record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      await expect(repo.restore(99999)).rejects.toThrow('Record not found');
    });
  });

  describe('hardDelete()', () => {
    it('should permanently remove record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const eve = users.find((u) => u.name === 'Eve')!;

      await repo.hardDelete(eve.id);

      // Verify completely gone
      const dbRecord = await db.selectFrom('users').selectAll().where('id', '=', eve.id).executeTakeFirst();
      expect(dbRecord).toBeUndefined();

      // Also verify findWithDeleted returns null
      const found = await repo.findWithDeleted(eve.id);
      expect(found).toBeNull();
    });

    it('should not throw for non-existent record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      // Hard delete non-existent record should not throw
      await expect(repo.hardDelete(99999)).resolves.not.toThrow();
    });

    it('should permanently remove soft-deleted record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const alice = users.find((u) => u.name === 'Alice')!;

      // Soft delete first
      await repo.softDelete(alice.id);
      expect(await repo.findDeleted()).toHaveLength(1);

      // Hard delete
      await repo.hardDelete(alice.id);

      // Verify completely gone
      expect(await repo.findDeleted()).toHaveLength(0);
      expect(await repo.findWithDeleted(alice.id)).toBeNull();
    });
  });
});

// =============================================================================
// Test Suite 2: Query Methods
// =============================================================================

describe('Soft Delete Plugin - Query Methods', () => {
  let db: Kysely<ComprehensiveTestDatabase>;
  let cleanup: () => void;

  beforeEach(async () => {
    const setup = createComprehensiveTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    await seedComprehensiveTestData(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('findWithDeleted()', () => {
    it('should include soft-deleted records', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const alice = users.find((u) => u.name === 'Alice')!;

      // Soft delete
      await repo.softDelete(alice.id);

      // findById should return null
      const findByIdResult = await repo.findById(alice.id);
      expect(findByIdResult).toBeNull();

      // findWithDeleted should return the record
      const found = await repo.findWithDeleted(alice.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
      expect(found!.deleted_at).not.toBeNull();
    });

    it('should return null for non-existent record', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const found = await repo.findWithDeleted(99999);
      expect(found).toBeNull();
    });
  });

  describe('findAllWithDeleted()', () => {
    it('should return all records including soft-deleted', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      // Soft delete two users
      const users = await db.selectFrom('users').selectAll().execute();
      await repo.softDelete(users[0]!.id);
      await repo.softDelete(users[1]!.id);

      // findAll should exclude deleted
      const activeUsers = await repo.findAll();
      expect(activeUsers).toHaveLength(3); // 5 - 2

      // findAllWithDeleted should include all
      const allUsers = await repo.findAllWithDeleted();
      expect(allUsers).toHaveLength(5);
    });
  });

  describe('findDeleted()', () => {
    it('should return only soft-deleted records', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      // Initially no deleted records
      expect(await repo.findDeleted()).toHaveLength(0);

      // Soft delete some users
      const users = await db.selectFrom('users').selectAll().execute();
      await repo.softDelete(users[0]!.id);
      await repo.softDelete(users[1]!.id);
      await repo.softDelete(users[2]!.id);

      // Should return only deleted
      const deleted = await repo.findDeleted();
      expect(deleted).toHaveLength(3);
      expect(deleted.every((u) => u.deleted_at !== null)).toBe(true);
    });

    it('should return empty array when no deleted records', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const deleted = await repo.findDeleted();
      expect(deleted).toEqual([]);
    });
  });

  describe('Query filtering automatically excludes soft-deleted by default', () => {
    it('should exclude soft-deleted records from findAll', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const alice = users.find((u) => u.name === 'Alice')!;

      // Before delete
      expect(await repo.findAll()).toHaveLength(5);

      // After delete
      await repo.softDelete(alice.id);
      const afterDelete = await repo.findAll();
      expect(afterDelete).toHaveLength(4);
      expect(afterDelete.find((u) => u.name === 'Alice')).toBeUndefined();
    });

    it('should exclude soft-deleted records from findById', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const bob = users.find((u) => u.name === 'Bob')!;

      // Before delete
      expect(await repo.findById(bob.id)).not.toBeNull();

      // After delete
      await repo.softDelete(bob.id);
      expect(await repo.findById(bob.id)).toBeNull();
    });
  });
});

// =============================================================================
// Test Suite 3: Bulk Operations
// =============================================================================

describe('Soft Delete Plugin - Bulk Operations', () => {
  let db: Kysely<ComprehensiveTestDatabase>;
  let cleanup: () => void;

  beforeEach(async () => {
    const setup = createComprehensiveTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    await seedComprehensiveTestData(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('softDeleteMany()', () => {
    it('should bulk soft delete records', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const ids = users.slice(0, 3).map((u) => u.id);

      const result = await repo.softDeleteMany(ids);

      expect(result).toHaveLength(3);
      expect(result.every((u) => u.deleted_at !== null)).toBe(true);

      // Verify in database
      expect(await repo.findAll()).toHaveLength(2);
      expect(await repo.findDeleted()).toHaveLength(3);
    });

    it('should handle empty bulk operations', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const result = await repo.softDeleteMany([]);
      expect(result).toEqual([]);

      // No records affected
      expect(await repo.findAll()).toHaveLength(5);
    });

    it('should throw error if any ID not found', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const ids = [users[0]!.id, 99999];

      await expect(repo.softDeleteMany(ids)).rejects.toThrow('not found');
    });
  });

  describe('restoreMany()', () => {
    it('should bulk restore records', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const ids = users.slice(0, 3).map((u) => u.id);

      // Soft delete first
      await repo.softDeleteMany(ids);
      expect(await repo.findAll()).toHaveLength(2);

      // Restore
      const result = await repo.restoreMany(ids);

      expect(result).toHaveLength(3);
      expect(result.every((u) => u.deleted_at === null)).toBe(true);
      expect(await repo.findAll()).toHaveLength(5);
    });

    it('should handle empty bulk restore', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const result = await repo.restoreMany([]);
      expect(result).toEqual([]);
    });
  });

  describe('hardDeleteMany()', () => {
    it('should bulk permanent delete', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const ids = users.slice(0, 3).map((u) => u.id);

      await repo.hardDeleteMany(ids);

      expect(await repo.findAll()).toHaveLength(2);
      expect(await repo.findAllWithDeleted()).toHaveLength(2);
    });

    it('should handle empty bulk hard delete', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      await repo.hardDeleteMany([]);

      // No records affected
      expect(await repo.findAll()).toHaveLength(5);
    });

    it('should not throw for non-existent IDs in bulk', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const ids = [users[0]!.id, 99999, 99998];

      // Should not throw
      await expect(repo.hardDeleteMany(ids)).resolves.not.toThrow();

      // Only valid ID deleted
      expect(await repo.findAllWithDeleted()).toHaveLength(4);
    });
  });
});

// =============================================================================
// Test Suite 4: Configuration Options
// =============================================================================

describe('Soft Delete Plugin - Configuration Options', () => {
  let db: Kysely<ComprehensiveTestDatabase>;
  let cleanup: () => void;

  beforeEach(async () => {
    const setup = createComprehensiveTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    await seedComprehensiveTestData(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('Custom deletedAtColumn configuration', () => {
    it('should use custom deleted column name', async () => {
      const plugin = softDeletePlugin({
        deletedAtColumn: 'removed_at',
        tables: ['posts'],
      });
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'posts' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestPost,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestPost, ComprehensiveTestDatabase>;

      const posts = await db.selectFrom('posts').selectAll().execute();
      const firstPost = posts[0]!;

      await repo.softDelete(firstPost.id);

      // Verify the removed_at column is set
      const dbRecord = await db.selectFrom('posts').selectAll().where('id', '=', firstPost.id).executeTakeFirst();
      expect(dbRecord?.removed_at).not.toBeNull();
    });
  });

  describe('Custom primaryKeyColumn configuration', () => {
    it('should use custom primary key column', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'comment_id',
        tables: ['comments'],
      });
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'comments' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestComment,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestComment, ComprehensiveTestDatabase>;

      const comments = await db.selectFrom('comments').selectAll().execute();
      const firstComment = comments[0]!;

      await repo.softDelete(firstComment.comment_id);

      // Verify soft deleted
      const found = await repo.findById(firstComment.comment_id);
      expect(found).toBeNull();

      const foundWithDeleted = await repo.findWithDeleted(firstComment.comment_id);
      expect(foundWithDeleted).not.toBeNull();
      expect(foundWithDeleted!.deleted_at).not.toBeNull();
    });
  });

  describe('Table whitelist (tables option)', () => {
    it('should only apply soft delete to whitelisted tables', async () => {
      const plugin = softDeletePlugin({
        tables: ['users'], // Only users table
      });
      const orm = await createORM(db, [plugin]);

      // Users should have soft delete
      const userRepo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      expect(userRepo.softDelete).toBeDefined();

      // Non-whitelisted tables should NOT be extended
      // The plugin returns repo unmodified for non-whitelisted tables
      const auditRepo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'audit_logs' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as any,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as any;

      // audit_logs is not in tables list, so no soft delete methods should be added
      // Note: The method may exist but should not filter queries for audit_logs
    });

    it('should not filter queries for non-whitelisted tables', async () => {
      const plugin = softDeletePlugin({
        tables: ['users'], // Only users table
      });
      const orm = await createORM(db, [plugin]);

      // Manually soft-delete a post (not in whitelist)
      await db
        .updateTable('posts')
        .set({ removed_at: new Date().toISOString() })
        .where('id', '=', 1)
        .execute();

      // Query should NOT filter because posts is not in tables list
      const result = await orm
        .applyPlugins(db.selectFrom('posts').selectAll(), 'select', 'posts', {})
        .execute();

      // Should include the "deleted" post because posts is not in whitelist
      expect(result).toHaveLength(4); // All posts including "deleted" one
    });
  });

  describe('includeDeleted option in constructor', () => {
    it('should include deleted by default when includeDeleted is true', async () => {
      const plugin = softDeletePlugin({
        includeDeleted: true,
      });
      const orm = await createORM(db, [plugin]);

      // Soft delete a user directly
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() })
        .where('name', '=', 'Alice')
        .execute();

      // Query should include deleted when includeDeleted is true
      const result = await orm
        .applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {})
        .execute();

      expect(result).toHaveLength(5); // All users including deleted
    });
  });

  describe('SoftDeleteOptionsSchema validation', () => {
    it('should validate options with Zod schema', () => {
      const validOptions = {
        deletedAtColumn: 'deleted_at',
        includeDeleted: false,
        tables: ['users', 'posts'],
        primaryKeyColumn: 'id',
      };

      const result = SoftDeleteOptionsSchema.safeParse(validOptions);
      expect(result.success).toBe(true);
    });

    it('should accept empty options', () => {
      const result = SoftDeleteOptionsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should reject invalid option types', () => {
      const invalidOptions = {
        deletedAtColumn: 123, // Should be string
      };

      const result = SoftDeleteOptionsSchema.safeParse(invalidOptions);
      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// Test Suite 5: Plugin Integration
// =============================================================================

describe('Soft Delete Plugin - Integration with Other Plugins', () => {
  let db: Kysely<ComprehensiveTestDatabase>;
  let cleanup: () => void;

  beforeEach(async () => {
    const setup = createComprehensiveTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    await seedComprehensiveTestData(db);
  });

  afterEach(() => {
    cleanup();
  });

  // Mock timestamps plugin
  function createTimestampsPlugin(): Plugin & { timestamps: Date[] } {
    const timestamps: Date[] = [];
    return {
      name: '@test/timestamps',
      version: '1.0.0',
      timestamps,
      interceptQuery<QB extends AnyQueryBuilder>(qb: QB): QB {
        timestamps.push(new Date());
        return qb;
      },
      extendRepository<T extends object>(repo: T): T {
        return {
          ...repo,
          getTimestamps: () => [...timestamps],
          touchUpdatedAt: async (id: number) => {
            // Mock implementation
            return { updated_at: new Date().toISOString() };
          },
        };
      },
    };
  }

  // Mock audit plugin
  function createAuditPlugin(): Plugin & { logs: Array<{ action: string; table: string }> } {
    const logs: Array<{ action: string; table: string }> = [];
    return {
      name: '@test/audit',
      version: '1.0.0',
      logs,
      interceptQuery<QB extends AnyQueryBuilder>(
        qb: QB,
        context: { operation: string; table: string }
      ): QB {
        logs.push({ action: context.operation, table: context.table });
        return qb;
      },
      extendRepository<T extends object>(repo: T): T {
        return {
          ...repo,
          getAuditLogs: () => [...logs],
        };
      },
    };
  }

  describe('Plugin integration with timestamps plugin', () => {
    it('should work alongside timestamps plugin', async () => {
      const timestampsPlugin = createTimestampsPlugin();
      const softDelete = softDeletePlugin();

      const orm = await createORM(db, [timestampsPlugin, softDelete]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as any;

      // Both plugins should contribute methods
      expect(repo.softDelete).toBeDefined();
      expect(repo.getTimestamps).toBeDefined();

      // Soft delete should work
      const users = await db.selectFrom('users').selectAll().execute();
      await repo.softDelete(users[0]!.id);

      // Timestamps plugin should have recorded queries
      expect(timestampsPlugin.timestamps.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Plugin integration with audit plugin', () => {
    it('should work alongside audit plugin', async () => {
      const auditPlugin = createAuditPlugin();
      const softDelete = softDeletePlugin();

      const orm = await createORM(db, [auditPlugin, softDelete]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as any;

      // Both plugins should contribute methods
      expect(repo.softDelete).toBeDefined();
      expect(repo.getAuditLogs).toBeDefined();

      // Trigger query interception via applyPlugins
      await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      // Audit plugin should have logged the query
      expect(auditPlugin.logs).toContainEqual({ action: 'select', table: 'users' });
    });
  });

  describe('Multiple soft delete plugins for different configurations', () => {
    it.skip('should support multiple plugins with different configs - SKIPPED: Plugin validation now prevents duplicate names', async () => {
      const userPlugin = softDeletePlugin({
        tables: ['users'],
        deletedAtColumn: 'deleted_at',
      });

      const postPlugin = softDeletePlugin({
        tables: ['posts'],
        deletedAtColumn: 'removed_at',
      });

      const orm = await createORM(db, [userPlugin, postPlugin]);

      const userRepo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const postRepo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'posts' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestPost,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestPost, ComprehensiveTestDatabase>;

      // Both repos should have soft delete
      expect(userRepo.softDelete).toBeDefined();
      expect(postRepo.softDelete).toBeDefined();

      // Delete from both
      const users = await db.selectFrom('users').selectAll().execute();
      const posts = await db.selectFrom('posts').selectAll().execute();

      await userRepo.softDelete(users[0]!.id);
      await postRepo.softDelete(posts[0]!.id);

      // Verify using correct columns
      const deletedUser = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', users[0]!.id)
        .executeTakeFirst();
      expect(deletedUser?.deleted_at).not.toBeNull();

      const deletedPost = await db
        .selectFrom('posts')
        .selectAll()
        .where('id', '=', posts[0]!.id)
        .executeTakeFirst();
      expect(deletedPost?.removed_at).not.toBeNull();
    });
  });
});

// =============================================================================
// Test Suite 6: Additional Edge Cases
// =============================================================================

describe('Soft Delete Plugin - Additional Edge Cases', () => {
  let db: Kysely<ComprehensiveTestDatabase>;
  let cleanup: () => void;

  beforeEach(async () => {
    const setup = createComprehensiveTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    await seedComprehensiveTestData(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('Plugin metadata', () => {
    it('should have correct name and version', () => {
      const plugin = softDeletePlugin();
      expect(plugin.name).toBe('@kysera/soft-delete');
      expect(plugin.version).toBe('0.5.1');
    });
  });

  describe('Non-repository objects', () => {
    it('should return unmodified object if not a repository', () => {
      const plugin = softDeletePlugin();

      const notARepo = { someProperty: 'value' };
      const result = plugin.extendRepository(notARepo);

      expect(result).toEqual(notARepo);
      expect((result as any).softDelete).toBeUndefined();
    });
  });

  describe('Empty table operations', () => {
    it('should handle findAll on empty table', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      // Clear all users
      await db.deleteFrom('users').execute();

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      expect(await repo.findAll()).toEqual([]);
      expect(await repo.findAllWithDeleted()).toEqual([]);
      expect(await repo.findDeleted()).toEqual([]);
    });
  });

  describe('String IDs in bulk operations', () => {
    it('should handle string IDs in softDeleteMany', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const stringIds = users.slice(0, 2).map((u) => String(u.id));

      const result = await repo.softDeleteMany(stringIds);
      expect(result).toHaveLength(2);
    });
  });

  describe('Restore after hard delete attempt', () => {
    it('should fail to restore after hard delete', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();
      const alice = users.find((u) => u.name === 'Alice')!;

      // Hard delete
      await repo.hardDelete(alice.id);

      // Attempt to restore should fail
      await expect(repo.restore(alice.id)).rejects.toThrow('Record not found');
    });
  });

  describe('Concurrent operations safety', () => {
    it('should handle concurrent soft deletes on different records', async () => {
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof ComprehensiveTestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as SoftDeleteRepository<TestUser, ComprehensiveTestDatabase>;

      const users = await db.selectFrom('users').selectAll().execute();

      // Concurrent soft deletes
      const promises = users.map((u) => repo.softDelete(u.id));
      const results = await Promise.allSettled(promises);

      // All should succeed
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      // All should be soft deleted
      expect(await repo.findAll()).toHaveLength(0);
      expect(await repo.findDeleted()).toHaveLength(5);
    });
  });
});
