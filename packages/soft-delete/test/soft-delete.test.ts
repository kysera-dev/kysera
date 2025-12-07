import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, seedTestData } from './setup/database.js';
import { softDeletePlugin } from '../src/index.js';
import { createORM } from '../../kysera-repository/dist/index.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';

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
  deleted_at: string | null;
}

describe('Soft Delete Plugin - Basic Functionality', () => {
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

  it('should filter out soft-deleted records by default', async () => {
    const plugin = softDeletePlugin();
    const orm = await createORM(db, [plugin]);

    // Soft delete Bob
    await db
      .updateTable('users')
      .set({ deleted_at: new Date().toISOString() }) // SQLite uses strings for dates
      .where('name', '=', 'Bob')
      .execute();

    // Query should filter out Bob
    const result = await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

    expect(result).toHaveLength(2);
    const users = result as TestUser[];
    expect(users.find((u) => u.name === 'Bob')).toBeUndefined();
  });

  it('should include deleted records when specified', async () => {
    const plugin = softDeletePlugin();
    const orm = await createORM(db, [plugin]);

    // Soft delete Bob
    await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).where('name', '=', 'Bob').execute();

    // Query with includeDeleted should include Bob
    const result = await orm
      .applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', { includeDeleted: true })
      .execute();

    expect(result).toHaveLength(3);
    const users = result as TestUser[];
    expect(users.find((u) => u.name === 'Bob')).toBeDefined();
  });

  it('should work with custom deleted column name', async () => {
    const plugin = softDeletePlugin({
      deletedAtColumn: 'deleted_at',
    });
    const orm = await createORM(db, [plugin]);

    // Soft delete a post using the custom column
    await db
      .updateTable('posts')
      .set({ deleted_at: new Date().toISOString() })
      .where('title', '=', 'First Post')
      .execute();

    // Query should filter out deleted post
    const result = await orm.applyPlugins(db.selectFrom('posts').selectAll(), 'select', 'posts', {}).execute();

    expect(result).toHaveLength(2); // Only non-deleted posts
    const posts = result as TestPost[];
    expect(posts.find((p) => p.title === 'First Post')).toBeUndefined();
  });

  it('should handle includeDeleted option in constructor', async () => {
    const plugin = softDeletePlugin({
      includeDeleted: true, // Include by default
    });
    const orm = await createORM(db, [plugin]);

    // Soft delete Bob
    await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).where('name', '=', 'Bob').execute();

    // Query should include Bob because includeDeleted is true by default
    const result = await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

    expect(result).toHaveLength(3); // All users including deleted
  });

  it('should only apply to specified tables', async () => {
    const plugin = softDeletePlugin({
      tables: ['users'], // Only apply to users table
    });
    const orm = await createORM(db, [plugin]);

    // Soft delete Bob
    await db.updateTable('users').set({ deleted_at: new Date().toISOString() }).where('name', '=', 'Bob').execute();

    // Soft delete a post
    await db
      .updateTable('posts')
      .set({ deleted_at: new Date().toISOString() })
      .where('title', '=', 'First Post')
      .execute();

    // Users query should filter out Bob
    const userResult = await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

    expect(userResult).toHaveLength(2);

    // Posts query should NOT filter (plugin doesn't apply to posts)
    const postResult = await orm.applyPlugins(db.selectFrom('posts').selectAll(), 'select', 'posts', {}).execute();

    expect(postResult).toHaveLength(3); // All posts including deleted
  });
});
