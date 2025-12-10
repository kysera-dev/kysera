/**
 * Tests for context utilities.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Kysely, Transaction } from 'kysely';
import type { DbContext } from '../src/types.js';
import { createContext, isInTransaction, withTransaction, withContext } from '../src/context.js';

// Mock database type
interface TestDB {
  users: { id: number; name: string };
}

/**
 * Type-safe mock factory for Kysely instances.
 * Uses `unknown` intermediate cast for safety while maintaining type information.
 */
function createMockKysely(overrides: Record<string, unknown> = {}): Kysely<TestDB> {
  return {
    selectFrom: vi.fn(),
    ...overrides,
  } as unknown as Kysely<TestDB>;
}

/**
 * Type-safe mock factory for Transaction instances.
 */
function createMockTransaction(overrides: Record<string, unknown> = {}): Transaction<TestDB> {
  return {
    selectFrom: vi.fn(),
    isTransaction: true,
    ...overrides,
  } as unknown as Transaction<TestDB>;
}

describe('createContext', () => {
  it('should create context from database instance', () => {
    const mockDb = createMockKysely();
    const ctx = createContext(mockDb);

    expect(ctx.db).toBe(mockDb);
    expect(ctx.isTransaction).toBe(false);
  });

  it('should detect transaction context', () => {
    const mockTrx = createMockTransaction();
    const ctx = createContext(mockTrx);

    expect(ctx.db).toBe(mockTrx);
    expect(ctx.isTransaction).toBe(true);
  });

  it('should handle false isTransaction value', () => {
    const mockDb = createMockKysely({ isTransaction: false });
    const ctx = createContext(mockDb);

    expect(ctx.isTransaction).toBe(false);
  });
});

describe('isInTransaction', () => {
  it('should return true for transaction context', () => {
    const ctx: DbContext<TestDB> = {
      db: createMockTransaction(),
      isTransaction: true,
    };

    expect(isInTransaction(ctx)).toBe(true);
  });

  it('should return false for non-transaction context', () => {
    const ctx: DbContext<TestDB> = {
      db: createMockKysely(),
      isTransaction: false,
    };

    expect(isInTransaction(ctx)).toBe(false);
  });
});

describe('withTransaction', () => {
  /**
   * Creates a mock Kysely instance with transaction support.
   * The transaction().execute() pattern matches Kysely's API.
   */
  function createMockDbWithTransaction(mockTrx: Transaction<TestDB>): Kysely<TestDB> {
    return {
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn().mockImplementation(async <T>(fn: (trx: Transaction<TestDB>) => Promise<T>) => fn(mockTrx)),
      }),
    } as unknown as Kysely<TestDB>;
  }

  it('should execute function within transaction and return result', async () => {
    const mockTrx = createMockTransaction();
    const mockDb = createMockDbWithTransaction(mockTrx);

    const result = await withTransaction(mockDb, async (ctx) => {
      expect(ctx.db).toBe(mockTrx);
      expect(ctx.isTransaction).toBe(true);
      return { success: true };
    });

    expect(result).toEqual({ success: true });
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it('should create transaction context with isTransaction true', async () => {
    let capturedIsTransaction = false;

    const mockTrx = createMockTransaction();
    const mockDb = createMockDbWithTransaction(mockTrx);

    await withTransaction(mockDb, async (ctx) => {
      capturedIsTransaction = ctx.isTransaction;
    });

    expect(capturedIsTransaction).toBe(true);
  });

  it('should propagate errors from function', async () => {
    const mockTrx = createMockTransaction();
    const mockDb = createMockDbWithTransaction(mockTrx);

    const error = new Error('Transaction failed');

    await expect(
      withTransaction(mockDb, async () => {
        throw error;
      })
    ).rejects.toThrow('Transaction failed');
  });

  it('should warn when isolation level is specified', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockTrx = createMockTransaction();
    const mockDb = createMockDbWithTransaction(mockTrx);

    await withTransaction(
      mockDb,
      async () => ({ done: true }),
      { isolationLevel: 'serializable' }
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('serializable')
    );
    warnSpy.mockRestore();
  });

  it('should not warn when isolation level is not specified', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockTrx = createMockTransaction();
    const mockDb = createMockDbWithTransaction(mockTrx);

    await withTransaction(mockDb, async () => ({ done: true }));

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('withContext', () => {
  it('should execute function with context and return result', async () => {
    const mockDb = createMockKysely();

    const result = await withContext(mockDb, async (ctx) => {
      expect(ctx.db).toBe(mockDb);
      return { users: [{ id: 1 }] };
    });

    expect(result).toEqual({ users: [{ id: 1 }] });
  });

  it('should create non-transaction context', async () => {
    let capturedIsTransaction = true; // Start with true to verify it gets set to false

    const mockDb = createMockKysely();

    await withContext(mockDb, async (ctx) => {
      capturedIsTransaction = ctx.isTransaction;
    });

    expect(capturedIsTransaction).toBe(false);
  });

  it('should propagate errors from function', async () => {
    const mockDb = createMockKysely();

    await expect(
      withContext(mockDb, async () => {
        throw new Error('Context operation failed');
      })
    ).rejects.toThrow('Context operation failed');
  });

  it('should pass the same db instance to context', async () => {
    const selectFromFn = vi.fn();
    const insertIntoFn = vi.fn();
    const mockDb = createMockKysely({
      selectFrom: selectFromFn,
      insertInto: insertIntoFn,
    });

    await withContext(mockDb, async (ctx) => {
      expect(ctx.db).toBe(mockDb);
      // Verify it's the exact same reference
      expect(ctx.db.selectFrom).toBe(selectFromFn);
    });
  });
});
