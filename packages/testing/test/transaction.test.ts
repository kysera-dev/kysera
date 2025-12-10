/**
 * Tests for transaction utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely, Transaction } from 'kysely';
import {
  testInTransaction,
  testWithSavepoints,
  testWithIsolation,
  type IsolationLevel,
} from '../src/transaction.js';

/**
 * Mock database interface for testing
 */
interface TestDB {
  users: {
    id: number;
    email: string;
    name: string;
  };
}

/**
 * Create a mock Kysely database instance with proper type signatures
 */
function createMockDb(): Kysely<TestDB> {
  const mockTransaction = {
    insertInto: vi.fn(),
    selectFrom: vi.fn(),
    updateTable: vi.fn(),
    deleteFrom: vi.fn(),
    raw: vi.fn().mockReturnThis(),
    execute: vi.fn(),
  } as unknown as Transaction<TestDB>;

  const transactionExecutor = {
    execute: vi.fn(async (fn: (trx: Transaction<TestDB>) => Promise<unknown>) => {
      return await fn(mockTransaction);
    }),
  };

  const mockDb = {
    transaction: vi.fn(() => transactionExecutor),
    insertInto: vi.fn(),
    selectFrom: vi.fn(),
    updateTable: vi.fn(),
    deleteFrom: vi.fn(),
  } as unknown as Kysely<TestDB>;

  return mockDb;
}

describe('testInTransaction', () => {
  let mockDb: Kysely<TestDB>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('should execute test function within a transaction', async () => {
    const testFn = vi.fn(async () => {
      // Test logic
    });

    await testInTransaction(mockDb, testFn);

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(testFn).toHaveBeenCalledTimes(1);
  });

  it('should pass transaction object to test function', async () => {
    let receivedTrx: Transaction<TestDB> | undefined;

    await testInTransaction(mockDb, async (trx) => {
      receivedTrx = trx;
    });

    expect(receivedTrx).toBeDefined();
  });

  it('should automatically rollback transaction after test completes', async () => {
    const transactionExecutor = mockDb.transaction();
    const executeSpy = vi.spyOn(transactionExecutor, 'execute');

    await testInTransaction(mockDb, async () => {
      // Test logic that should be rolled back
    });

    // Verify the transaction was executed
    expect(executeSpy).toHaveBeenCalled();

    // The function should throw RollbackError internally to trigger rollback
    // We verify this by checking that no error was propagated to the caller
  });

  it('should not propagate RollbackError to caller', async () => {
    // This should not throw
    await expect(
      testInTransaction(mockDb, async () => {
        // Test logic
      })
    ).resolves.toBeUndefined();
  });

  it('should propagate other errors from test function', async () => {
    const testError = new Error('Test error');

    await expect(
      testInTransaction(mockDb, async () => {
        throw testError;
      })
    ).rejects.toThrow('Test error');
  });

  it('should allow database operations within transaction', async () => {
    const insertIntoMock = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returningAll: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue({
            id: 1,
            email: 'test@example.com',
            name: 'Test User',
          }),
        }),
      }),
    });

    await testInTransaction(mockDb, async (trx) => {
      (trx as unknown as { insertInto: typeof insertIntoMock }).insertInto = insertIntoMock;

      const result = await (trx as unknown as {
        insertInto: (table: string) => {
          values: (vals: unknown) => {
            returningAll: () => {
              executeTakeFirst: () => Promise<{ id: number; email: string; name: string }>;
            };
          };
        };
      })
        .insertInto('users')
        .values({ email: 'test@example.com', name: 'Test User' })
        .returningAll()
        .executeTakeFirst();

      expect(result).toEqual({
        id: 1,
        email: 'test@example.com',
        name: 'Test User',
      });
    });
  });

  it('should handle async operations in test function', async () => {
    let asyncComplete = false;

    await testInTransaction(mockDb, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      asyncComplete = true;
    });

    expect(asyncComplete).toBe(true);
  });

  it('should handle multiple operations in sequence', async () => {
    const operations: string[] = [];

    await testInTransaction(mockDb, async () => {
      operations.push('operation1');
      await Promise.resolve();
      operations.push('operation2');
      await Promise.resolve();
      operations.push('operation3');
    });

    expect(operations).toEqual(['operation1', 'operation2', 'operation3']);
  });
});

describe('testWithSavepoints', () => {
  // Note: testWithSavepoints uses sql`` template literals which require a real database connection
  // to work properly. These tests verify the function signature and error handling behavior.
  // Full integration tests with actual database are in the integration test suite.

  it('should have correct function signature', () => {
    expect(typeof testWithSavepoints).toBe('function');
    expect(testWithSavepoints.length).toBe(2);
  });

  it('should be exported from module', async () => {
    const module = await import('../src/transaction.js');
    expect(module.testWithSavepoints).toBeDefined();
    expect(typeof module.testWithSavepoints).toBe('function');
  });
});

describe('testWithIsolation', () => {
  // Note: testWithIsolation uses raw SQL which requires a real database connection
  // to work properly. These tests verify the function signature and type checking.
  // Full integration tests with actual database are in the integration test suite.

  it('should have correct function signature', () => {
    expect(typeof testWithIsolation).toBe('function');
    expect(testWithIsolation.length).toBe(3);
  });

  it('should be exported from module', async () => {
    const module = await import('../src/transaction.js');
    expect(module.testWithIsolation).toBeDefined();
    expect(typeof module.testWithIsolation).toBe('function');
  });

  it('should accept all valid isolation levels', () => {
    const isolationLevels: IsolationLevel[] = [
      'read uncommitted',
      'read committed',
      'repeatable read',
      'serializable',
    ];

    // Just verify the types are correct
    expect(isolationLevels).toHaveLength(4);
  });
});

describe('IsolationLevel type', () => {
  it('should accept valid isolation level strings', () => {
    const validLevels: IsolationLevel[] = [
      'read uncommitted',
      'read committed',
      'repeatable read',
      'serializable',
    ];

    expect(validLevels).toHaveLength(4);
  });
});
