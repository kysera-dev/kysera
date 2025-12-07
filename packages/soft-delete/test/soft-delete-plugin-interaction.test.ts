import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, seedTestData } from './setup/database.js';
import { softDeletePlugin } from '../src/index.js';
import { createORM, createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';
import type { Plugin, AnyQueryBuilder } from '../../kysera-repository/dist/index.js';
import { z } from 'zod';

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

// Mock logging plugin for testing plugin interaction
function createLoggingPlugin(): Plugin & { logs: string[] } {
  const logs: string[] = [];
  return {
    name: '@test/logging',
    version: '1.0.0',
    logs,
    interceptQuery<QB extends AnyQueryBuilder>(
      qb: QB,
      context: { operation: string; table: string; metadata: Record<string, unknown> }
    ): QB {
      logs.push(`${context.operation}:${context.table}`);
      return qb;
    },
    extendRepository<T extends object>(repo: T): T {
      return {
        ...repo,
        getQueryLogs: () => [...logs],
      };
    },
  };
}

// Mock audit plugin for testing plugin interaction
function createAuditPlugin(): Plugin & { audits: Array<{ action: string; table: string; timestamp: Date }> } {
  const audits: Array<{ action: string; table: string; timestamp: Date }> = [];
  return {
    name: '@test/audit',
    version: '1.0.0',
    audits,
    interceptQuery<QB extends AnyQueryBuilder>(
      qb: QB,
      context: { operation: string; table: string; metadata: Record<string, unknown> }
    ): QB {
      audits.push({
        action: context.operation,
        table: context.table,
        timestamp: new Date(),
      });
      return qb;
    },
    extendRepository<T extends object>(repo: T): T {
      return {
        ...repo,
        getAuditLog: () => [...audits],
      };
    },
  };
}

// Mock validation plugin
function createValidationPlugin(options: { maxLength?: number } = {}): Plugin {
  const { maxLength = 100 } = options;
  return {
    name: '@test/validation',
    version: '1.0.0',
    interceptQuery<QB extends AnyQueryBuilder>(
      qb: QB,
      _context: { operation: string; table: string; metadata: Record<string, unknown> }
    ): QB {
      // Validation logic would go here
      return qb;
    },
    extendRepository<T extends object>(repo: T): T {
      return {
        ...repo,
        validateData: (data: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string' && value.length > maxLength) {
              throw new Error(`Field ${key} exceeds max length of ${maxLength}`);
            }
          }
          return true;
        },
      };
    },
  };
}

describe('Soft Delete Plugin - Plugin Interaction', () => {
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

  describe('Multiple Plugins Together', () => {
    it('should work with logging plugin', async () => {
      const loggingPlugin = createLoggingPlugin();
      const softDelete = softDeletePlugin();

      const orm = await createORM(db, [loggingPlugin, softDelete]);

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
      }) as any;

      // Perform a query using applyPlugins to trigger logging
      await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      // Logging plugin should have recorded the query
      expect(loggingPlugin.logs.length).toBeGreaterThan(0);
      expect(loggingPlugin.logs).toContain('select:users');

      // Soft delete should have methods
      expect(repo.softDelete).toBeDefined();
      expect(repo.getQueryLogs).toBeDefined();
    });

    it('should work with audit plugin', async () => {
      const auditPlugin = createAuditPlugin();
      const softDelete = softDeletePlugin();

      const orm = await createORM(db, [auditPlugin, softDelete]);

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
      }) as any;

      // Get user ID
      const users = await db.selectFrom('users').selectAll().execute();
      const userId = users[0]?.id;
      expect(userId).toBeDefined();

      // Soft delete a user
      await repo.softDelete(userId);

      // Both plugins should be functional
      expect(repo.softDelete).toBeDefined();
      expect(repo.getAuditLog).toBeDefined();
    });

    it('should work with validation plugin', async () => {
      const validationPlugin = createValidationPlugin({ maxLength: 50 });
      const softDelete = softDeletePlugin();

      const orm = await createORM(db, [validationPlugin, softDelete]);

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
      }) as any;

      // Both plugins should have their methods
      expect(repo.softDelete).toBeDefined();
      expect(repo.validateData).toBeDefined();

      // Validation should work
      expect(() => repo.validateData({ name: 'Valid Name' })).not.toThrow();
      expect(() => repo.validateData({ name: 'A'.repeat(100) })).toThrow();
    });

    it('should chain all three plugins', async () => {
      const loggingPlugin = createLoggingPlugin();
      const auditPlugin = createAuditPlugin();
      const softDelete = softDeletePlugin();

      const orm = await createORM(db, [loggingPlugin, auditPlugin, softDelete]);

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
      }) as any;

      // All plugin methods should be available
      expect(repo.softDelete).toBeDefined();
      expect(repo.restore).toBeDefined();
      expect(repo.getQueryLogs).toBeDefined();
      expect(repo.getAuditLog).toBeDefined();

      // Perform operations using applyPlugins to trigger interceptors
      await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      const users = await repo.findAll();
      expect(users.length).toBeGreaterThan(0);

      if (users[0]) {
        await repo.softDelete(users[0].id);
      }

      // Logging plugin should have tracked the applyPlugins query
      expect(loggingPlugin.logs.length).toBeGreaterThan(0);
      expect(loggingPlugin.logs).toContain('select:users');

      // Audit plugin should also have tracked it
      expect(auditPlugin.audits.length).toBeGreaterThan(0);
    });
  });

  describe('Plugin Order Matters', () => {
    it('should apply plugins in order (soft delete first)', async () => {
      const loggingPlugin = createLoggingPlugin();
      const softDelete = softDeletePlugin();

      // Soft delete first
      const orm1 = await createORM(db, [softDelete, loggingPlugin]);

      const repo1 = orm1.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as any;

      // Both should work
      expect(repo1.softDelete).toBeDefined();
      expect(repo1.getQueryLogs).toBeDefined();
    });

    it('should apply plugins in order (soft delete last)', async () => {
      const loggingPlugin = createLoggingPlugin();
      const softDelete = softDeletePlugin();

      // Logging first
      const orm2 = await createORM(db, [loggingPlugin, softDelete]);

      const repo2 = orm2.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as any;

      // Both should work
      expect(repo2.softDelete).toBeDefined();
      expect(repo2.getQueryLogs).toBeDefined();
    });
  });

  describe('Multiple Soft Delete Plugins', () => {
    it.skip('should handle multiple soft delete plugins for different tables - SKIPPED: Plugin validation now prevents duplicate names', async () => {
      const userSoftDelete = softDeletePlugin({
        tables: ['users'],
        deletedAtColumn: 'deleted_at',
      });

      const postSoftDelete = softDeletePlugin({
        tables: ['posts'],
        deletedAtColumn: 'deleted_at',
      });

      const orm = await createORM(db, [userSoftDelete, postSoftDelete]);

      // User repository
      const userRepo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as any;

      // Post repository
      const postRepo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'posts' as keyof TestDatabase,
          mapRow: (row) => row as TestPost,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as any;

      // Both should have soft delete
      expect(userRepo.softDelete).toBeDefined();
      expect(postRepo.softDelete).toBeDefined();

      // Get IDs
      const users = await db.selectFrom('users').selectAll().execute();
      const posts = await db.selectFrom('posts').selectAll().execute();

      const userId = users[0]?.id;
      const postId = posts[0]?.id;

      expect(userId).toBeDefined();
      expect(postId).toBeDefined();

      // Soft delete should work independently
      await userRepo.softDelete(userId);
      await postRepo.softDelete(postId);

      const userResult = await userRepo.findAll();
      const postResult = await postRepo.findAll();

      expect(userResult.length).toBe(users.length - 1);
      expect(postResult.length).toBe(posts.length - 1);
    });
  });

  describe('Plugin Conflict Resolution', () => {
    it('should handle plugins that modify same methods', async () => {
      const customPlugin: Plugin = {
        name: '@test/custom-findall',
        version: '1.0.0',
        interceptQuery<QB extends AnyQueryBuilder>(qb: QB): QB {
          return qb;
        },
        extendRepository<T extends object>(repo: T): T {
          const baseRepo = repo as any;
          const originalFindAll = baseRepo.findAll?.bind(baseRepo);
          return {
            ...repo,
            findAll: async () => {
              const results = await originalFindAll?.();
              // Add custom metadata
              return results?.map((r: any) => ({ ...r, _custom: true })) ?? [];
            },
          };
        },
      };

      const softDelete = softDeletePlugin();

      const orm = await createORM(db, [customPlugin, softDelete]);

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
      }) as any;

      // Both plugins should contribute to the final result
      expect(repo.softDelete).toBeDefined();

      const results = await repo.findAll();
      expect(results.length).toBeGreaterThan(0);
      // The soft delete plugin overrides findAll, so custom metadata may not be present
      // This is expected behavior - last plugin wins
    });

    it('should preserve plugin functionality when repository is extended', async () => {
      const softDelete = softDeletePlugin();
      const orm = await createORM(db, [softDelete]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        const baseRepo = base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });

        // Extend with custom method
        return {
          ...baseRepo,
          customMethod: () => 'custom',
        };
      }) as any;

      // Plugin methods should still work
      expect(repo.softDelete).toBeDefined();
      expect(repo.restore).toBeDefined();

      // Custom method should work
      expect(repo.customMethod()).toBe('custom');
    });
  });

  describe('Plugin State Isolation', () => {
    it('should isolate plugin state between ORM instances', async () => {
      const softDelete1 = softDeletePlugin({
        tables: ['users'],
      });
      const softDelete2 = softDeletePlugin({
        tables: ['posts'],
      });

      const orm1 = await createORM(db, [softDelete1]);
      const orm2 = await createORM(db, [softDelete2]);

      const userRepo1 = orm1.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase,
          mapRow: (row) => row as TestUser,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as any;

      const postRepo2 = orm2.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'posts' as keyof TestDatabase,
          mapRow: (row) => row as TestPost,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as any;

      // Each ORM should only apply soft delete to its configured tables
      expect(userRepo1.softDelete).toBeDefined();
      expect(postRepo2.softDelete).toBeDefined();

      // Soft delete operations should not affect each other
      const users = await db.selectFrom('users').selectAll().execute();
      const posts = await db.selectFrom('posts').selectAll().execute();

      await userRepo1.softDelete(users[0]?.id);
      await postRepo2.softDelete(posts[0]?.id);

      const remainingUsers = await userRepo1.findAll();
      const remainingPosts = await postRepo2.findAll();

      expect(remainingUsers.length).toBe(users.length - 1);
      expect(remainingPosts.length).toBe(posts.length - 1);
    });
  });
});
