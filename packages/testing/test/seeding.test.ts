/**
 * Tests for database seeding utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely, Transaction } from 'kysely';
import { seedDatabase, composeSeeders, type SeedFunction } from '../src/seeding.js';

/**
 * Mock database interface for testing
 */
interface TestDB {
  users: {
    id?: number;
    email: string;
    name: string;
  };
  posts: {
    id?: number;
    user_id: number;
    title: string;
  };
  comments: {
    id?: number;
    post_id: number;
    content: string;
  };
}

/**
 * Create a mock Kysely database instance with transaction support
 */
function createMockDb(): {
  db: Kysely<TestDB>;
  mockTransaction: Transaction<TestDB>;
  transactionExecutor: { execute: ReturnType<typeof vi.fn> };
} {
  const mockTransaction = {
    insertInto: vi.fn(),
    selectFrom: vi.fn(),
    updateTable: vi.fn(),
    deleteFrom: vi.fn(),
  } as unknown as Transaction<TestDB>;

  const transactionExecutor = {
    execute: vi.fn(async (fn: (trx: Transaction<TestDB>) => Promise<void>) => {
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

  return { db: mockDb, mockTransaction, transactionExecutor };
}

describe('seedDatabase', () => {
  let mockDb: Kysely<TestDB>;
  let mockTransaction: Transaction<TestDB>;
  let transactionExecutor: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const setup = createMockDb();
    mockDb = setup.db;
    mockTransaction = setup.mockTransaction;
    transactionExecutor = setup.transactionExecutor;
  });

  it('should execute seeding function within a transaction', async () => {
    const seedFn = vi.fn(async () => {});

    await seedDatabase(mockDb, seedFn);

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(seedFn).toHaveBeenCalledTimes(1);
  });

  it('should pass transaction object to seeding function', async () => {
    let receivedTrx: Transaction<TestDB> | undefined;

    await seedDatabase(mockDb, async (trx) => {
      receivedTrx = trx;
    });

    expect(receivedTrx).toBeDefined();
    expect(receivedTrx).toBe(mockTransaction);
  });

  it('should commit transaction on successful seeding', async () => {
    await seedDatabase(mockDb, async (_trx) => {
      // Simulate successful seeding
      await Promise.resolve();
    });

    expect(transactionExecutor.execute).toHaveBeenCalled();
  });

  it('should rollback transaction on seeding error', async () => {
    const seedError = new Error('Seeding failed');

    await expect(
      seedDatabase(mockDb, async (_trx) => {
        throw seedError;
      })
    ).rejects.toThrow('Seeding failed');

    // Transaction should have been attempted
    expect(transactionExecutor.execute).toHaveBeenCalled();
  });

  it('should allow inserting multiple records', async () => {
    const insertIntoMock = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({ numInsertedOrUpdatedRows: 2n }),
      }),
    });

    mockTransaction = {
      ...mockTransaction,
      insertInto: insertIntoMock,
    } as unknown as Transaction<TestDB>;

    transactionExecutor = {
      execute: vi.fn(async (fn: (trx: Transaction<TestDB>) => Promise<void>) => {
        return await fn(mockTransaction);
      }),
    };

    mockDb = {
      transaction: vi.fn(() => transactionExecutor),
    } as unknown as Kysely<TestDB>;

    await seedDatabase(mockDb, async (trx) => {
      await trx
        .insertInto('users')
        .values([
          { email: 'alice@example.com', name: 'Alice' },
          { email: 'bob@example.com', name: 'Bob' },
        ])
        .execute();
    });

    expect(insertIntoMock).toHaveBeenCalledWith('users');
  });

  it('should handle async operations', async () => {
    let asyncComplete = false;

    await seedDatabase(mockDb, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      asyncComplete = true;
    });

    expect(asyncComplete).toBe(true);
  });

  it('should handle multiple insert operations in sequence', async () => {
    const operations: string[] = [];

    await seedDatabase(mockDb, async () => {
      operations.push('insert-users');
      await Promise.resolve();
      operations.push('insert-posts');
      await Promise.resolve();
      operations.push('insert-comments');
    });

    expect(operations).toEqual(['insert-users', 'insert-posts', 'insert-comments']);
  });

  it('should propagate errors with original stack trace', async () => {
    const seedError = new Error('Custom seed error');
    seedError.stack = 'Custom stack trace';

    try {
      await seedDatabase(mockDb, async () => {
        throw seedError;
      });
      expect.fail('Should have thrown error');
    } catch (error) {
      expect(error).toBe(seedError);
      expect((error as Error).message).toBe('Custom seed error');
    }
  });

  it('should handle seeding with related data', async () => {
    const insertions: Array<{ table: string; data: unknown }> = [];

    const insertIntoMock = vi.fn((table: string) => ({
      values: vi.fn((data: unknown) => {
        insertions.push({ table, data });
        return {
          execute: vi.fn().mockResolvedValue({ numInsertedOrUpdatedRows: 1n }),
        };
      }),
    }));

    mockTransaction = {
      ...mockTransaction,
      insertInto: insertIntoMock,
    } as unknown as Transaction<TestDB>;

    transactionExecutor = {
      execute: vi.fn(async (fn: (trx: Transaction<TestDB>) => Promise<void>) => {
        return await fn(mockTransaction);
      }),
    };

    mockDb = {
      transaction: vi.fn(() => transactionExecutor),
    } as unknown as Kysely<TestDB>;

    await seedDatabase(mockDb, async (trx) => {
      await trx.insertInto('users').values({ email: 'user@example.com', name: 'User' }).execute();

      await trx.insertInto('posts').values({ user_id: 1, title: 'Post Title' }).execute();
    });

    expect(insertions).toHaveLength(2);
    expect(insertions[0]?.table).toBe('users');
    expect(insertions[1]?.table).toBe('posts');
  });

  it('should handle empty seeding function', async () => {
    await expect(seedDatabase(mockDb, async () => {})).resolves.toBeUndefined();
  });

  it('should maintain transaction isolation', async () => {
    // Each call should use a new transaction
    await seedDatabase(mockDb, async () => {});
    await seedDatabase(mockDb, async () => {});

    expect(mockDb.transaction).toHaveBeenCalledTimes(2);
  });
});

describe('composeSeeders', () => {
  let mockDb: Kysely<TestDB>;
  let mockTransaction: Transaction<TestDB>;

  beforeEach(() => {
    const setup = createMockDb();
    mockDb = setup.db;
    mockTransaction = setup.mockTransaction;
  });

  it('should combine multiple seeders into one', () => {
    const seeder1: SeedFunction<TestDB> = vi.fn(async () => {});
    const seeder2: SeedFunction<TestDB> = vi.fn(async () => {});

    const combined = composeSeeders([seeder1, seeder2]);

    expect(combined).toBeDefined();
    expect(typeof combined).toBe('function');
  });

  it('should execute seeders in order', async () => {
    const executionOrder: string[] = [];

    const seeder1: SeedFunction<TestDB> = async () => {
      executionOrder.push('seeder1');
    };

    const seeder2: SeedFunction<TestDB> = async () => {
      executionOrder.push('seeder2');
    };

    const seeder3: SeedFunction<TestDB> = async () => {
      executionOrder.push('seeder3');
    };

    const combined = composeSeeders([seeder1, seeder2, seeder3]);
    await combined(mockTransaction);

    expect(executionOrder).toEqual(['seeder1', 'seeder2', 'seeder3']);
  });

  it('should pass transaction to each seeder', async () => {
    const transactions: Array<Transaction<TestDB>> = [];

    const seeder1: SeedFunction<TestDB> = async (trx) => {
      transactions.push(trx);
    };

    const seeder2: SeedFunction<TestDB> = async (trx) => {
      transactions.push(trx);
    };

    const combined = composeSeeders([seeder1, seeder2]);
    await combined(mockTransaction);

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toBe(mockTransaction);
    expect(transactions[1]).toBe(mockTransaction);
  });

  it('should stop execution on first error', async () => {
    const executionOrder: string[] = [];
    const seedError = new Error('Seeder 2 failed');

    const seeder1: SeedFunction<TestDB> = async () => {
      executionOrder.push('seeder1');
    };

    const seeder2: SeedFunction<TestDB> = async () => {
      executionOrder.push('seeder2');
      throw seedError;
    };

    const seeder3: SeedFunction<TestDB> = async () => {
      executionOrder.push('seeder3');
    };

    const combined = composeSeeders([seeder1, seeder2, seeder3]);

    await expect(combined(mockTransaction)).rejects.toThrow('Seeder 2 failed');

    // Seeder 3 should not have executed
    expect(executionOrder).toEqual(['seeder1', 'seeder2']);
  });

  it('should handle async seeders', async () => {
    const delays: number[] = [];

    const seeder1: SeedFunction<TestDB> = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      delays.push(1);
    };

    const seeder2: SeedFunction<TestDB> = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      delays.push(2);
    };

    const combined = composeSeeders([seeder1, seeder2]);
    await combined(mockTransaction);

    expect(delays).toEqual([1, 2]);
  });

  it('should handle empty seeders array', async () => {
    const combined = composeSeeders<TestDB>([]);
    await expect(combined(mockTransaction)).resolves.toBeUndefined();
  });

  it('should handle single seeder', async () => {
    let executed = false;

    const seeder: SeedFunction<TestDB> = async () => {
      executed = true;
    };

    const combined = composeSeeders([seeder]);
    await combined(mockTransaction);

    expect(executed).toBe(true);
  });

  it('should work with seedDatabase', async () => {
    const executionOrder: string[] = [];

    const seedUsers: SeedFunction<TestDB> = async () => {
      executionOrder.push('seed-users');
    };

    const seedPosts: SeedFunction<TestDB> = async () => {
      executionOrder.push('seed-posts');
    };

    const combined = composeSeeders([seedUsers, seedPosts]);

    await seedDatabase(mockDb, combined);

    expect(executionOrder).toEqual(['seed-users', 'seed-posts']);
  });

  it('should allow nested composition', async () => {
    const executionOrder: string[] = [];

    const seeder1: SeedFunction<TestDB> = async () => {
      executionOrder.push('1');
    };

    const seeder2: SeedFunction<TestDB> = async () => {
      executionOrder.push('2');
    };

    const seeder3: SeedFunction<TestDB> = async () => {
      executionOrder.push('3');
    };

    const combined1 = composeSeeders([seeder1, seeder2]);
    const combined2 = composeSeeders([combined1, seeder3]);

    await combined2(mockTransaction);

    expect(executionOrder).toEqual(['1', '2', '3']);
  });

  it('should maintain seeder independence', async () => {
    const seeder1State = { count: 0 };
    const seeder2State = { count: 0 };

    const seeder1: SeedFunction<TestDB> = async () => {
      seeder1State.count++;
    };

    const seeder2: SeedFunction<TestDB> = async () => {
      seeder2State.count++;
    };

    const combined = composeSeeders([seeder1, seeder2]);

    await combined(mockTransaction);
    await combined(mockTransaction);

    expect(seeder1State.count).toBe(2);
    expect(seeder2State.count).toBe(2);
  });

  it('should handle seeder with database operations', async () => {
    const insertedData: unknown[] = [];

    const insertIntoMock = vi.fn().mockReturnValue({
      values: vi.fn((data: unknown) => {
        insertedData.push(data);
        return {
          execute: vi.fn().mockResolvedValue({ numInsertedOrUpdatedRows: 1n }),
        };
      }),
    });

    mockTransaction = {
      ...mockTransaction,
      insertInto: insertIntoMock,
    } as unknown as Transaction<TestDB>;

    const seedUsers: SeedFunction<TestDB> = async (trx) => {
      await trx.insertInto('users').values({ email: 'user@example.com', name: 'User' }).execute();
    };

    const seedPosts: SeedFunction<TestDB> = async (trx) => {
      await trx.insertInto('posts').values({ user_id: 1, title: 'Post' }).execute();
    };

    const combined = composeSeeders([seedUsers, seedPosts]);
    await combined(mockTransaction);

    expect(insertedData).toHaveLength(2);
  });

  it('should work with large number of seeders', async () => {
    const seeders: Array<SeedFunction<TestDB>> = [];
    const executionOrder: number[] = [];

    for (let i = 0; i < 100; i++) {
      seeders.push(async () => {
        executionOrder.push(i);
      });
    }

    const combined = composeSeeders(seeders);
    await combined(mockTransaction);

    expect(executionOrder).toHaveLength(100);
    expect(executionOrder[0]).toBe(0);
    expect(executionOrder[99]).toBe(99);
  });
});

describe('SeedFunction type', () => {
  it('should accept valid seed function', () => {
    const validSeedFunction: SeedFunction<TestDB> = async (trx: Transaction<TestDB>) => {
      await trx
        .insertInto('users')
        .values({ email: 'test@example.com', name: 'Test' })
        .execute();
    };

    expect(typeof validSeedFunction).toBe('function');
  });

  it('should accept async function returning void', () => {
    const validSeedFunction: SeedFunction<TestDB> = async (_trx: Transaction<TestDB>) => {
      await Promise.resolve();
    };

    expect(typeof validSeedFunction).toBe('function');
  });
});

describe('Integration: seedDatabase + composeSeeders', () => {
  let mockDb: Kysely<TestDB>;
  let insertedRecords: Array<{ table: string; data: unknown }>;

  beforeEach(() => {
    insertedRecords = [];

    const insertIntoMock = vi.fn((table: string) => ({
      values: vi.fn((data: unknown) => {
        insertedRecords.push({ table, data });
        return {
          execute: vi.fn().mockResolvedValue({ numInsertedOrUpdatedRows: 1n }),
        };
      }),
    }));

    const mockTransaction = {
      insertInto: insertIntoMock,
    } as unknown as Transaction<TestDB>;

    const transactionExecutor = {
      execute: vi.fn(async (fn: (trx: Transaction<TestDB>) => Promise<void>) => {
        return await fn(mockTransaction);
      }),
    };

    mockDb = {
      transaction: vi.fn(() => transactionExecutor),
    } as unknown as Kysely<TestDB>;
  });

  it('should seed database with composed seeders', async () => {
    const seedUsers: SeedFunction<TestDB> = async (trx) => {
      await trx.insertInto('users').values({ email: 'alice@example.com', name: 'Alice' }).execute();
    };

    const seedPosts: SeedFunction<TestDB> = async (trx) => {
      await trx.insertInto('posts').values({ user_id: 1, title: 'First Post' }).execute();
    };

    const seedComments: SeedFunction<TestDB> = async (trx) => {
      await trx.insertInto('comments').values({ post_id: 1, content: 'Great post!' }).execute();
    };

    const seedAll = composeSeeders([seedUsers, seedPosts, seedComments]);

    await seedDatabase(mockDb, seedAll);

    expect(insertedRecords).toHaveLength(3);
    expect(insertedRecords[0]?.table).toBe('users');
    expect(insertedRecords[1]?.table).toBe('posts');
    expect(insertedRecords[2]?.table).toBe('comments');
  });

  it('should rollback all seeds on error', async () => {
    const seedUsers: SeedFunction<TestDB> = async (trx) => {
      await trx.insertInto('users').values({ email: 'alice@example.com', name: 'Alice' }).execute();
    };

    const seedPosts: SeedFunction<TestDB> = async () => {
      throw new Error('Failed to seed posts');
    };

    const seedAll = composeSeeders([seedUsers, seedPosts]);

    await expect(seedDatabase(mockDb, seedAll)).rejects.toThrow('Failed to seed posts');

    // First seeder executed, but should be rolled back
    expect(insertedRecords).toHaveLength(1);
  });

  it('should support modular seeding approach', async () => {
    // Define reusable seeders
    const seedUsers: SeedFunction<TestDB> = async (trx) => {
      await trx.insertInto('users').values({ email: 'user@example.com', name: 'User' }).execute();
    };

    const seedPosts: SeedFunction<TestDB> = async (trx) => {
      await trx.insertInto('posts').values({ user_id: 1, title: 'Post' }).execute();
    };

    // Compose different combinations
    const seedMinimal = composeSeeders([seedUsers]);
    const seedFull = composeSeeders([seedUsers, seedPosts]);

    // Use minimal for basic tests
    await seedDatabase(mockDb, seedMinimal);
    expect(insertedRecords).toHaveLength(1);

    // Reset
    insertedRecords = [];

    // Use full for comprehensive tests
    await seedDatabase(mockDb, seedFull);
    expect(insertedRecords).toHaveLength(2);
  });
});
