import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase, seedTestData } from './setup/database.js';
import { createORM, withPlugins, type Plugin } from '../src/plugin.js';
import { createRepositoryFactory } from '../src/repository.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';

describe('Plugin System', () => {
  let db: Kysely<TestDatabase>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = createTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup as () => Promise<void>;
    await seedTestData(db);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Plugin Interface', () => {
    it('should call plugin lifecycle methods', async () => {
      const mockPlugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        interceptQuery: vi.fn((qb: any, _context: any) => qb),
        extendRepository: vi.fn((repo: any) => repo),
      };

      const orm = await createORM(db, [mockPlugin]);

      expect(mockPlugin.interceptQuery).not.toHaveBeenCalled();
      expect(mockPlugin.extendRepository).not.toHaveBeenCalled();

      // Create a repository with the plugin
      orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase & string,
          mapRow: (row: any) => row,
          schemas: {
            create: {} as any,
          },
        });
      });

      // extendRepository should have been called
      expect(mockPlugin.extendRepository).toHaveBeenCalledWith(
        expect.objectContaining({
          findAll: expect.any(Function),
          findById: expect.any(Function),
          create: expect.any(Function),
          update: expect.any(Function),
          delete: expect.any(Function),
        })
      );
    });

    it('should intercept queries', async () => {
      let interceptedQueries: any[] = [];

      const loggingPlugin: Plugin = {
        name: 'logging-plugin',
        version: '1.0.0',
        interceptQuery: (qb: any, context: any) => {
          interceptedQueries.push({
            operation: context.operation,
            table: context.table,
            metadata: context.metadata,
          });
          return qb;
        },
      };

      const orm = await createORM(db, [loggingPlugin]);

      // Use applyPlugins in queries
      const result = await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      expect(interceptedQueries).toHaveLength(1);
      expect(interceptedQueries[0]).toEqual({
        operation: 'select',
        table: 'users',
        metadata: {},
      });
      expect(result).toHaveLength(3); // 3 seeded users
    });

    it('should allow plugins to modify queries', async () => {
      const filterPlugin: Plugin = {
        name: 'filter-plugin',
        version: '1.0.0',
        interceptQuery: (qb: any, context: any) => {
          if (context.operation === 'select' && context.table === 'users') {
            // Add a filter to only return Alice
            return (qb as any).where('name', '=', 'Alice');
          }
          return qb;
        },
      };

      const orm = await createORM(db, [filterPlugin]);

      const result = await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Alice');
    });

    it('should chain multiple plugins', async () => {
      const plugin1: Plugin = {
        name: 'plugin1',
        version: '1.0.0',
        interceptQuery: (qb: any, context: any) => {
          context.metadata['plugin1'] = true;
          return qb;
        },
      };

      const plugin2: Plugin = {
        name: 'plugin2',
        version: '1.0.0',
        interceptQuery: (qb: any, context: any) => {
          context.metadata['plugin2'] = true;
          expect(context.metadata['plugin1']).toBe(true);
          return qb;
        },
      };

      const orm = await createORM(db, [plugin1, plugin2]);
      const metadata = {};

      await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', metadata).execute();

      expect(metadata).toEqual({ plugin1: true, plugin2: true });
    });
  });

  describe('Repository Extension', () => {
    it('should extend repository with new methods', async () => {
      const extensionPlugin: Plugin = {
        name: 'extension-plugin',
        version: '1.0.0',
        extendRepository: (repo: any) => {
          return {
            ...repo,
            findByEmail: async (email: string) => {
              const users = await repo.findAll();
              return users.find((u: any) => u.email === email);
            },
            countAll: async () => {
              const all = await repo.findAll();
              return all.length;
            },
          };
        },
      };

      const orm = await createORM(db, [extensionPlugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase & string,
          mapRow: (row) => row,
          schemas: {
            create: {} as any,
          },
        });
      }) as any;

      expect(repo.findByEmail).toBeDefined();
      expect(repo.countAll).toBeDefined();
    });

    it('should chain repository extensions', async () => {
      const plugin1: Plugin = {
        name: 'plugin1',
        version: '1.0.0',
        extendRepository: (repo: any) => ({
          ...repo,
          method1: () => 'from plugin1',
        }),
      };

      const plugin2: Plugin = {
        name: 'plugin2',
        version: '1.0.0',
        extendRepository: (repo: any) => ({
          ...repo,
          method2: () => 'from plugin2',
        }),
      };

      const orm = await createORM(db, [plugin1, plugin2]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase & string,
          mapRow: (row) => row,
          schemas: {
            create: {} as any,
          },
        });
      }) as any;

      expect(repo.method1()).toBe('from plugin1');
      expect(repo.method2()).toBe('from plugin2');
    });
  });

  describe('withPlugins Helper', () => {
    it('should simplify plugin usage', async () => {
      let queryCount = 0;

      const countingPlugin: Plugin = {
        name: 'counting-plugin',
        version: '1.0.0',
        interceptQuery: (qb: any, _context: any) => {
          queryCount++;
          return qb;
        },
      };

      const factory = (executor: Kysely<TestDatabase>) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'users' as keyof TestDatabase & string,
          mapRow: (row) => row,
          schemas: {
            create: {} as any,
          },
        });
      };

      const repo = await withPlugins(factory, db, [countingPlugin]);

      await repo.findAll();
      await repo.findById(1);

      expect(queryCount).toBe(0); // withPlugins wraps but doesn't auto-apply to base methods
    });
  });

  describe('Plugin Metadata', () => {
    it('should pass metadata through plugin chain', async () => {
      const metadataPlugin: Plugin = {
        name: 'metadata-plugin',
        version: '1.0.0',
        interceptQuery: (qb: any, context: any) => {
          if (context.metadata['skipFilter']) {
            return qb;
          }
          if (context.operation === 'select') {
            return (qb as any).where('deleted_at', 'is', null);
          }
          return qb;
        },
      };

      const orm = await createORM(db, [metadataPlugin]);

      // First, soft-delete Bob
      await db
        .updateTable('users')
        .set({ deleted_at: new Date().toISOString() as any }) // SQLite uses strings for dates
        .where('name', '=', 'Bob')
        .execute();

      // Query without skipping filter
      const filtered = await orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {}).execute();

      expect(filtered).toHaveLength(2); // Alice and Charlie

      // Query with skip filter
      const unfiltered = await orm
        .applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', { skipFilter: true })
        .execute();

      expect(unfiltered).toHaveLength(3); // All users
    });
  });

  describe('Error Handling', () => {
    it('should handle plugin errors gracefully', async () => {
      const errorPlugin: Plugin = {
        name: 'error-plugin',
        version: '1.0.0',
        interceptQuery: () => {
          throw new Error('Plugin error');
        },
      };

      const orm = await createORM(db, [errorPlugin]);

      // Plugin error should be thrown immediately when applyPlugins is called
      expect(() => orm.applyPlugins(db.selectFrom('users').selectAll(), 'select', 'users', {})).toThrow('Plugin error');
    });

    // Note: Async interceptQuery is not supported in current implementation
    // as interceptQuery must return the query builder synchronously
  });
});
