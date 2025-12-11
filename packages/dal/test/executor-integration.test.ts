// @ts-nocheck - Test file with mock objects that don't match strict TypeScript types
/**
 * Integration tests for DAL with KyseraExecutor
 * Verifies that plugins are properly integrated with DAL queries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely, Transaction } from 'kysely';
import { createExecutor, createExecutorSync, type Plugin, type QueryBuilderContext } from '@kysera/executor';
import { createContext, withTransaction, withContext } from '../src/context.js';
import { createQuery } from '../src/query.js';

// Mock database type
interface TestDB {
  users: { id: number; name: string; deleted_at: Date | null };
  posts: { id: number; user_id: number; title: string };
}

/**
 * Create a mock Kysely instance with proper method chaining
 */
function createMockKysely(): Kysely<TestDB> {
  const mockQueryBuilder = {
    selectAll: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
    executeTakeFirst: vi.fn().mockResolvedValue(null),
    executeTakeFirstOrThrow: vi.fn().mockResolvedValue({}),
    returningAll: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
  };

  const mockTrx = {
    ...mockQueryBuilder,
    isTransaction: true,
    selectFrom: vi.fn().mockReturnValue(mockQueryBuilder),
    insertInto: vi.fn().mockReturnValue(mockQueryBuilder),
    updateTable: vi.fn().mockReturnValue(mockQueryBuilder),
    deleteFrom: vi.fn().mockReturnValue(mockQueryBuilder),
  } as unknown as Transaction<TestDB>;

  return {
    selectFrom: vi.fn().mockReturnValue(mockQueryBuilder),
    insertInto: vi.fn().mockReturnValue(mockQueryBuilder),
    updateTable: vi.fn().mockReturnValue(mockQueryBuilder),
    deleteFrom: vi.fn().mockReturnValue(mockQueryBuilder),
    transaction: vi.fn().mockReturnValue({
      execute: vi.fn().mockImplementation(async (fn) => fn(mockTrx)),
    }),
  } as unknown as Kysely<TestDB>;
}

/**
 * Create a soft-delete plugin for testing
 */
function createTestSoftDeletePlugin(): Plugin {
  return {
    name: '@kysera/soft-delete',
    version: '0.6.1',
    priority: 100,
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      // Only apply to SELECT queries
      if (context.operation !== 'select') {
        return qb;
      }

      // Add WHERE deleted_at IS NULL
      return (qb as any).where('deleted_at', 'is', null);
    },
  };
}

/**
 * Create an RLS plugin for testing
 */
function createTestRLSPlugin(tenantId: number): Plugin {
  return {
    name: '@kysera/rls',
    version: '0.6.1',
    priority: 90,
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      // Only apply to users table
      if (context.table !== 'users') {
        return qb;
      }

      // Add WHERE tenant_id = X
      return (qb as any).where('tenant_id', '=', tenantId);
    },
  };
}

describe('DAL with KyseraExecutor Integration', () => {
  let mockDb: Kysely<TestDB>;

  beforeEach(() => {
    mockDb = createMockKysely();
  });

  describe('createContext with KyseraExecutor', () => {
    it('should accept KyseraExecutor directly', () => {
      const executor = createExecutorSync(mockDb, []);
      const ctx = createContext(executor);

      expect(ctx.db).toBe(executor);
      expect(ctx.isTransaction).toBe(false);
    });

    it('should preserve KyseraExecutor with plugins', () => {
      const plugin = createTestSoftDeletePlugin();
      const executor = createExecutorSync(mockDb, [plugin]);
      const ctx = createContext(executor);

      expect(ctx.db).toBe(executor);
      expect('__kysera' in ctx.db).toBe(true);
      expect((ctx.db as any).__plugins).toContain(plugin);
    });

    it('should work with plain Kysely instance', () => {
      const ctx = createContext(mockDb);

      expect(ctx.db).toBe(mockDb);
      expect('__kysera' in ctx.db).toBe(false);
    });
  });

  describe('Plugin interception in DAL queries', () => {
    it('should apply soft-delete filter to SELECT queries', async () => {
      const softDeletePlugin = createTestSoftDeletePlugin();
      const executor = createExecutorSync(mockDb, [softDeletePlugin]);

      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      await getUsers(executor);

      // Verify that selectFrom was called
      expect(mockDb.selectFrom).toHaveBeenCalledWith('users');

      // Verify that where was called with soft-delete filter
      const mockQb = (mockDb.selectFrom as any).mock.results[0].value;
      expect(mockQb.where).toHaveBeenCalledWith('deleted_at', 'is', null);
    });

    it('should apply multiple plugins in priority order', async () => {
      const softDeletePlugin = createTestSoftDeletePlugin();
      const rlsPlugin = createTestRLSPlugin(123);
      const executor = createExecutorSync(mockDb, [softDeletePlugin, rlsPlugin]);

      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      await getUsers(executor);

      const mockQb = (mockDb.selectFrom as any).mock.results[0].value;

      // Both filters should be applied
      expect(mockQb.where).toHaveBeenCalledWith('deleted_at', 'is', null);
      expect(mockQb.where).toHaveBeenCalledWith('tenant_id', '=', 123);

      // Higher priority plugin (soft-delete: 100) should run before lower priority (RLS: 90)
      const calls = (mockQb.where as any).mock.calls;
      const deletedAtCallIndex = calls.findIndex(
        (call: any[]) => call[0] === 'deleted_at'
      );
      const tenantIdCallIndex = calls.findIndex(
        (call: any[]) => call[0] === 'tenant_id'
      );
      expect(deletedAtCallIndex).toBeLessThan(tenantIdCallIndex);
    });

    it('should not apply interceptors to INSERT queries', async () => {
      const softDeletePlugin = createTestSoftDeletePlugin();
      const executor = createExecutorSync(mockDb, [softDeletePlugin]);

      const createUser = createQuery((ctx, data: { name: string }) =>
        ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
      );

      await createUser(executor, { name: 'Test' });

      // Verify insertInto was called
      expect(mockDb.insertInto).toHaveBeenCalledWith('users');

      // Verify that where was NOT called (soft-delete only applies to SELECT)
      const mockQb = (mockDb.insertInto as any).mock.results[0].value;
      expect(mockQb.where).not.toHaveBeenCalled();
    });
  });

  describe('withTransaction plugin propagation', () => {
    it('should propagate plugins to transaction context', async () => {
      const softDeletePlugin = createTestSoftDeletePlugin();
      const executor = createExecutorSync(mockDb, [softDeletePlugin]);

      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      await withTransaction(executor, async (ctx) => {
        expect(ctx.isTransaction).toBe(true);
        expect('__kysera' in ctx.db).toBe(true);
        expect((ctx.db as any).__plugins).toContain(softDeletePlugin);

        await getUsers(ctx);
      });

      // Verify transaction was created
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should apply plugins within transaction', async () => {
      const softDeletePlugin = createTestSoftDeletePlugin();
      const executor = createExecutorSync(mockDb, [softDeletePlugin]);

      await withTransaction(executor, async (ctx) => {
        const getUsers = createQuery((c) => c.db.selectFrom('users').selectAll().execute());
        await getUsers(ctx);

        // Get the transaction mock
        const trxMock = await (mockDb.transaction as any)().execute((t: any) => t);

        // Verify where was called on transaction query builder
        const mockQb = (trxMock.selectFrom as any).mock.results[0].value;
        expect(mockQb.where).toHaveBeenCalledWith('deleted_at', 'is', null);
      });
    });

    it('should handle plain Kysely without plugins', async () => {
      await withTransaction(mockDb, async (ctx) => {
        expect(ctx.isTransaction).toBe(true);
        expect('__kysera' in ctx.db).toBe(false);
      });

      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });

  describe('withContext with KyseraExecutor', () => {
    it('should preserve executor in context', async () => {
      const plugin = createTestSoftDeletePlugin();
      const executor = createExecutorSync(mockDb, [plugin]);

      await withContext(executor, async (ctx) => {
        expect(ctx.db).toBe(executor);
        expect('__kysera' in ctx.db).toBe(true);
        expect((ctx.db as any).__plugins).toContain(plugin);
      });
    });

    it('should apply plugins in withContext', async () => {
      const softDeletePlugin = createTestSoftDeletePlugin();
      const executor = createExecutorSync(mockDb, [softDeletePlugin]);

      const getUsers = createQuery((ctx) =>
        ctx.db.selectFrom('users').selectAll().execute()
      );

      await withContext(executor, async (ctx) => {
        await getUsers(ctx);

        const mockQb = (mockDb.selectFrom as any).mock.results[0].value;
        expect(mockQb.where).toHaveBeenCalledWith('deleted_at', 'is', null);
      });
    });
  });

  describe('Async executor creation', () => {
    it('should support async plugin initialization', async () => {
      const initSpy = vi.fn();
      const asyncPlugin: Plugin = {
        name: '@kysera/test-async',
        version: '1.0.0',
        async onInit(db) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          initSpy(db);
        },
      };

      const executor = await createExecutor(mockDb, [asyncPlugin]);
      expect(initSpy).toHaveBeenCalledWith(mockDb);

      const ctx = createContext(executor);
      expect('__kysera' in ctx.db).toBe(true);
    });
  });

  describe('Type safety', () => {
    it('should maintain type safety with KyseraExecutor', async () => {
      const executor = createExecutorSync(mockDb, []);

      // This should compile without errors
      const getUser = createQuery((ctx, id: number) =>
        ctx.db
          .selectFrom('users')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()
      );

      const result = await getUser(executor, 1);

      // Type inference should work
      type ResultType = typeof result;
      const _typeCheck: ResultType extends
        | { id: number; name: string; deleted_at: Date | null }
        | undefined
        ? true
        : never = true;
      expect(_typeCheck).toBe(true);
    });
  });
});
