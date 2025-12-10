/**
 * Tests for query function creation utilities.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Kysely } from 'kysely';
import type { DbContext } from '../src/types.js';
import { createQuery, createTransactionalQuery } from '../src/query.js';

// Mock database type
interface TestDB {
  users: {
    id: number;
    email: string;
    name: string;
  };
}

// Helper to create a mock Kysely instance
function createMockDb(): Kysely<TestDB> {
  return {
    selectFrom: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue({ id: 1, email: 'test@example.com', name: 'Test' }),
  } as unknown as Kysely<TestDB>;
}

// Helper to create a mock context
function createMockContext(isTransaction = false): DbContext<TestDB> {
  return {
    db: createMockDb(),
    isTransaction,
  };
}

describe('createQuery', () => {
  describe('when called with DbContext', () => {
    it('should execute the query function with context', async () => {
      const queryFn = vi.fn().mockResolvedValue({ id: 1, name: 'Test' });
      const query = createQuery<TestDB, [number], { id: number; name: string }>(queryFn);

      const ctx = createMockContext();
      const result = await query(ctx, 1);

      expect(queryFn).toHaveBeenCalledWith(ctx, 1);
      expect(result).toEqual({ id: 1, name: 'Test' });
    });

    it('should pass multiple arguments correctly', async () => {
      const queryFn = vi.fn().mockResolvedValue([]);
      const query = createQuery<TestDB, [string, number], unknown[]>(queryFn);

      const ctx = createMockContext();
      await query(ctx, 'search', 10);

      expect(queryFn).toHaveBeenCalledWith(ctx, 'search', 10);
    });

    it('should preserve context transaction state', async () => {
      const queryFn = vi.fn().mockImplementation((ctx) => {
        return Promise.resolve(ctx.isTransaction);
      });
      const query = createQuery<TestDB, [], boolean>(queryFn);

      const regularCtx = createMockContext(false);
      const txCtx = createMockContext(true);

      expect(await query(regularCtx)).toBe(false);
      expect(await query(txCtx)).toBe(true);
    });
  });

  describe('when called with Kysely instance', () => {
    it('should create context automatically', async () => {
      let capturedCtx: DbContext<TestDB> | null = null;
      const queryFn = vi.fn().mockImplementation((ctx) => {
        capturedCtx = ctx;
        return Promise.resolve({ id: 1 });
      });
      const query = createQuery<TestDB, [number], { id: number }>(queryFn);

      const db = createMockDb();
      await query(db, 1);

      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx!.db).toBe(db);
      expect(capturedCtx!.isTransaction).toBe(false);
    });

    it('should work with zero arguments', async () => {
      const queryFn = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const query = createQuery<TestDB, [], Array<{ id: number }>>(queryFn);

      const db = createMockDb();
      const result = await query(db);

      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe('type inference', () => {
    it('should correctly infer result type', async () => {
      const query = createQuery<TestDB, [number], { id: number; email: string } | undefined>(
        (_ctx, _id: number) => Promise.resolve({ id: 1, email: 'test@example.com' })
      );

      const ctx = createMockContext();
      const result = await query(ctx, 1);

      // TypeScript would catch type errors here at compile time
      expect(result?.id).toBe(1);
      expect(result?.email).toBe('test@example.com');
    });

    it('should correctly handle undefined return type', async () => {
      const query = createQuery<TestDB, [number], undefined>((_ctx, _id: number) => Promise.resolve(undefined));

      const ctx = createMockContext();
      const result = await query(ctx, 1);

      expect(result).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should propagate errors from query function', async () => {
      const error = new Error('Query failed');
      const queryFn = vi.fn().mockRejectedValue(error);
      const query = createQuery<TestDB, [], never>(queryFn);

      const ctx = createMockContext();

      await expect(query(ctx)).rejects.toThrow('Query failed');
    });
  });
});

describe('createTransactionalQuery', () => {
  describe('when called within transaction', () => {
    it('should execute normally when in transaction', async () => {
      const queryFn = vi.fn().mockResolvedValue({ success: true });
      const query = createTransactionalQuery<TestDB, [], { success: boolean }>(queryFn);

      const ctx = createMockContext(true); // isTransaction = true
      const result = await query(ctx);

      expect(queryFn).toHaveBeenCalledWith(ctx);
      expect(result).toEqual({ success: true });
    });

    it('should pass arguments correctly within transaction', async () => {
      const queryFn = vi.fn().mockResolvedValue({ transferred: true });
      const query = createTransactionalQuery<TestDB, [number, number, number], { transferred: boolean }>(
        queryFn
      );

      const ctx = createMockContext(true);
      const result = await query(ctx, 1, 2, 100);

      expect(queryFn).toHaveBeenCalledWith(ctx, 1, 2, 100);
      expect(result).toEqual({ transferred: true });
    });
  });

  describe('when called outside transaction', () => {
    it('should throw error when not in transaction with context', async () => {
      const queryFn = vi.fn().mockResolvedValue({ success: true });
      const query = createTransactionalQuery<TestDB, [], { success: boolean }>(queryFn);

      const ctx = createMockContext(false); // isTransaction = false

      await expect(query(ctx)).rejects.toThrow(
        'Query requires a transaction. Use withTransaction() to execute this query.'
      );
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('should throw error when called with Kysely directly', async () => {
      const queryFn = vi.fn().mockResolvedValue({ success: true });
      const query = createTransactionalQuery<TestDB, [number], { success: boolean }>(queryFn);

      const db = createMockDb();

      // When called with Kysely, createContext creates isTransaction = false
      // The query internally uses createQuery which accepts both Kysely and DbContext
      // QueryFunction signature allows both Kysely<DB> and DbContext<DB> as first argument
      await expect(query(db, 1)).rejects.toThrow(
        'Query requires a transaction. Use withTransaction() to execute this query.'
      );
      expect(queryFn).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should propagate errors from query function within transaction', async () => {
      const error = new Error('Transfer failed');
      const queryFn = vi.fn().mockRejectedValue(error);
      const query = createTransactionalQuery<TestDB, [], never>(queryFn);

      const ctx = createMockContext(true);

      await expect(query(ctx)).rejects.toThrow('Transfer failed');
    });
  });
});
