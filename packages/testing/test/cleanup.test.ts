/**
 * Tests for database cleanup utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { cleanDatabase, type CleanupStrategy } from '../src/cleanup.js';

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
 * Create a mock Kysely database instance with dialect support
 */
function createMockDb(dialectName = 'PostgresDialect'): Kysely<TestDB> {
  const rawMock = vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue(undefined),
  });

  const deleteFromMock = vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n }),
  });

  const mockDb = {
    deleteFrom: deleteFromMock,
    raw: rawMock,
    getExecutor: vi.fn(() => ({
      adapter: {
        dialect: {
          constructor: {
            name: dialectName,
          },
        },
      },
    })),
  } as unknown as Kysely<TestDB>;

  return mockDb;
}

describe('cleanDatabase - transaction strategy', () => {
  it('should do nothing when strategy is transaction', async () => {
    const mockDb = createMockDb();

    await cleanDatabase(mockDb, 'transaction');

    // No database operations should be performed
    expect(mockDb.deleteFrom).not.toHaveBeenCalled();
    // Note: raw is not a direct property in type-safe Kysely, but exists at runtime
  });

  it('should not require tables parameter with transaction strategy', async () => {
    const mockDb = createMockDb();

    await expect(cleanDatabase(mockDb, 'transaction')).resolves.toBeUndefined();
  });

  it('should ignore tables parameter when using transaction strategy', async () => {
    const mockDb = createMockDb();

    await cleanDatabase(mockDb, 'transaction', ['users', 'posts']);

    expect(mockDb.deleteFrom).not.toHaveBeenCalled();
  });
});

describe('cleanDatabase - delete strategy', () => {
  let mockDb: Kysely<TestDB>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('should throw error if tables parameter is missing', async () => {
    await expect(cleanDatabase(mockDb, 'delete')).rejects.toThrow(
      'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
    );
  });

  it('should throw error if tables array is empty', async () => {
    await expect(cleanDatabase(mockDb, 'delete', [])).rejects.toThrow(
      'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
    );
  });

  it('should delete from each table in order', async () => {
    const deleteFromCalls: string[] = [];
    const deleteFromMock = vi.fn((table: string) => {
      deleteFromCalls.push(table);
      return {
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n }),
      };
    });

    mockDb = {
      deleteFrom: deleteFromMock,
      raw: vi.fn(),
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'delete', ['comments', 'posts', 'users']);

    expect(deleteFromCalls).toEqual(['comments', 'posts', 'users']);
  });

  it('should delete tables in FK-safe order (children first)', async () => {
    const deleteFromCalls: string[] = [];
    const deleteFromMock = vi.fn((table: string) => {
      deleteFromCalls.push(table);
      return {
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n }),
      };
    });

    mockDb = {
      deleteFrom: deleteFromMock,
      raw: vi.fn(),
    } as unknown as Kysely<TestDB>;

    // Children first: comments -> posts -> users
    await cleanDatabase(mockDb, 'delete', ['comments', 'posts', 'users']);

    expect(deleteFromCalls[0]).toBe('comments');
    expect(deleteFromCalls[1]).toBe('posts');
    expect(deleteFromCalls[2]).toBe('users');
  });

  it('should handle single table deletion', async () => {
    const deleteFromMock = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n }),
    });

    mockDb = {
      deleteFrom: deleteFromMock,
      raw: vi.fn(),
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'delete', ['users']);

    expect(deleteFromMock).toHaveBeenCalledTimes(1);
    expect(deleteFromMock).toHaveBeenCalledWith('users');
  });

  it('should propagate errors from delete operations', async () => {
    const deleteError = new Error('Delete failed');
    const deleteFromMock = vi.fn().mockReturnValue({
      execute: vi.fn().mockRejectedValue(deleteError),
    });

    mockDb = {
      deleteFrom: deleteFromMock,
      raw: vi.fn(),
    } as unknown as Kysely<TestDB>;

    await expect(cleanDatabase(mockDb, 'delete', ['users'])).rejects.toThrow('Delete failed');
  });

  it('should await each delete operation', async () => {
    const executionOrder: string[] = [];
    const deleteFromMock = vi.fn((table: string) => ({
      execute: vi.fn(async () => {
        executionOrder.push(`delete-${table}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }),
    }));

    mockDb = {
      deleteFrom: deleteFromMock,
      raw: vi.fn(),
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'delete', ['users', 'posts']);

    expect(executionOrder).toEqual(['delete-users', 'delete-posts']);
  });
});

describe('cleanDatabase - truncate strategy - PostgreSQL', () => {
  let mockDb: Kysely<TestDB>;

  beforeEach(() => {
    mockDb = createMockDb('PostgresDialect');
  });

  it('should throw error if tables parameter is missing', async () => {
    await expect(cleanDatabase(mockDb, 'truncate')).rejects.toThrow(
      'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
    );
  });

  it('should disable FK checks before truncating', async () => {
    const rawCalls: string[] = [];
    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users']);

    expect(rawCalls).toContain('SET session_replication_role = replica');
  });

  it('should re-enable FK checks after truncating', async () => {
    const rawCalls: string[] = [];
    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users']);

    expect(rawCalls).toContain('SET session_replication_role = DEFAULT');
  });

  it('should truncate tables with CASCADE', async () => {
    const rawCalls: string[] = [];
    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users', 'posts']);

    expect(rawCalls.some((sql) => sql.includes('TRUNCATE TABLE users CASCADE'))).toBe(true);
    expect(rawCalls.some((sql) => sql.includes('TRUNCATE TABLE posts CASCADE'))).toBe(true);
  });

  it('should execute operations in correct order', async () => {
    const rawCalls: string[] = [];
    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users']);

    // Order: disable FK -> truncate -> enable FK
    expect(rawCalls[0]).toContain('SET session_replication_role = replica');
    expect(rawCalls[1]).toContain('TRUNCATE TABLE users CASCADE');
    expect(rawCalls[2]).toContain('SET session_replication_role = DEFAULT');
  });

  it('should handle multiple tables', async () => {
    const rawCalls: string[] = [];
    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users', 'posts', 'comments']);

    const truncateCalls = rawCalls.filter((sql) => sql.includes('TRUNCATE TABLE'));
    expect(truncateCalls).toHaveLength(3);
  });
});

describe('cleanDatabase - truncate strategy - MySQL', () => {
  let mockDb: Kysely<TestDB>;

  beforeEach(() => {
    mockDb = createMockDb('MysqlDialect');
  });

  it('should disable FK checks before truncating', async () => {
    const rawCalls: string[] = [];
    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users']);

    expect(rawCalls).toContain('SET FOREIGN_KEY_CHECKS = 0');
  });

  it('should re-enable FK checks after truncating', async () => {
    const rawCalls: string[] = [];
    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users']);

    expect(rawCalls).toContain('SET FOREIGN_KEY_CHECKS = 1');
  });

  it('should truncate tables with backtick escaping', async () => {
    const rawCalls: string[] = [];
    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users']);

    expect(rawCalls.some((sql) => sql.includes('TRUNCATE TABLE `users`'))).toBe(true);
  });

  it('should execute operations in correct order', async () => {
    const rawCalls: string[] = [];
    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users']);

    expect(rawCalls[0]).toContain('SET FOREIGN_KEY_CHECKS = 0');
    expect(rawCalls[1]).toContain('TRUNCATE TABLE `users`');
    expect(rawCalls[2]).toContain('SET FOREIGN_KEY_CHECKS = 1');
  });
});

describe('cleanDatabase - truncate strategy - SQLite', () => {
  let mockDb: Kysely<TestDB>;

  beforeEach(() => {
    mockDb = createMockDb('SqliteDialect');
  });

  it('should use DELETE instead of TRUNCATE', async () => {
    const deleteFromCalls: string[] = [];
    const rawCalls: string[] = [];

    const deleteFromMock = vi.fn((table: string) => {
      deleteFromCalls.push(table);
      return {
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n }),
      };
    });

    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      deleteFrom: deleteFromMock,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users']);

    expect(deleteFromCalls).toContain('users');
    expect(rawCalls.some((sql) => sql.includes('TRUNCATE'))).toBe(false);
  });

  it('should reset auto-increment sequences', async () => {
    const rawCalls: string[] = [];
    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      deleteFrom: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n }),
      }),
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users']);

    expect(
      rawCalls.some((sql) => sql.includes("DELETE FROM sqlite_sequence WHERE name='users'"))
    ).toBe(true);
  });

  it('should handle multiple tables', async () => {
    const deleteFromCalls: string[] = [];
    const rawCalls: string[] = [];

    const deleteFromMock = vi.fn((table: string) => {
      deleteFromCalls.push(table);
      return {
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n }),
      };
    });

    const rawMock = vi.fn((sql: string) => {
      rawCalls.push(sql);
      return {
        execute: vi.fn().mockResolvedValue(undefined),
      };
    });

    mockDb = {
      ...mockDb,
      deleteFrom: deleteFromMock,
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await cleanDatabase(mockDb, 'truncate', ['users', 'posts']);

    expect(deleteFromCalls).toEqual(['users', 'posts']);
    expect(
      rawCalls.some((sql) => sql.includes("DELETE FROM sqlite_sequence WHERE name='users'"))
    ).toBe(true);
    expect(
      rawCalls.some((sql) => sql.includes("DELETE FROM sqlite_sequence WHERE name='posts'"))
    ).toBe(true);
  });
});

describe('cleanDatabase - SQL injection prevention', () => {
  it('should reject invalid table names with special characters', async () => {
    const mockDb = createMockDb();

    await expect(
      cleanDatabase(mockDb, 'truncate', ['users; DROP TABLE users;--'])
    ).rejects.toThrow(/Invalid identifier/);
  });

  it('should reject table names with SQL keywords', async () => {
    const mockDb = createMockDb();

    await expect(cleanDatabase(mockDb, 'truncate', ['users OR 1=1'])).rejects.toThrow(
      /Invalid identifier/
    );
  });

  it('should reject empty table names', async () => {
    const mockDb = createMockDb();

    await expect(cleanDatabase(mockDb, 'truncate', [''])).rejects.toThrow(/Invalid identifier/);
  });

  it('should reject table names that are too long', async () => {
    const mockDb = createMockDb();
    const longName = 'a'.repeat(129);

    await expect(cleanDatabase(mockDb, 'truncate', [longName])).rejects.toThrow(
      /Invalid identifier.*length/
    );
  });

  it('should accept valid table names', async () => {
    const mockDb = createMockDb();

    await expect(
      cleanDatabase(mockDb, 'truncate', ['users', 'user_posts', 'UserTable123', '_table'])
    ).resolves.toBeUndefined();
  });

  it('should reject table names starting with numbers', async () => {
    const mockDb = createMockDb();

    await expect(cleanDatabase(mockDb, 'truncate', ['123users'])).rejects.toThrow(
      /Invalid identifier/
    );
  });

  it('should reject table names with hyphens', async () => {
    const mockDb = createMockDb();

    await expect(cleanDatabase(mockDb, 'truncate', ['user-table'])).rejects.toThrow(
      /Invalid identifier/
    );
  });

  it('should reject table names with spaces', async () => {
    const mockDb = createMockDb();

    await expect(cleanDatabase(mockDb, 'truncate', ['user table'])).rejects.toThrow(
      /Invalid identifier/
    );
  });

  it('should reject null or undefined table names', async () => {
    const mockDb = createMockDb();

    await expect(
      cleanDatabase(mockDb, 'truncate', [null as unknown as string])
    ).rejects.toThrow(/Invalid identifier/);
  });

  it('should handle whitespace trimming', async () => {
    const mockDb = createMockDb();

    // Should work after trimming
    await expect(cleanDatabase(mockDb, 'truncate', ['  users  '])).resolves.toBeUndefined();
  });
});

describe('cleanDatabase - edge cases', () => {
  it('should handle database with unknown dialect', async () => {
    const mockDb = createMockDb('UnknownDialect');

    // Should fall back to SQLite behavior (DELETE + sequence reset)
    await expect(cleanDatabase(mockDb, 'truncate', ['users'])).resolves.toBeUndefined();
  });

  it('should handle errors during FK disable', async () => {
    const rawMock = vi.fn((_sql: string) => ({
      execute: vi.fn().mockRejectedValue(new Error('FK disable failed')),
    }));

    const mockDb = {
      ...createMockDb('PostgresDialect'),
      raw: rawMock,
    } as unknown as Kysely<TestDB>;

    await expect(cleanDatabase(mockDb, 'truncate', ['users'])).rejects.toThrow(
      'FK disable failed'
    );
  });

  it('should accept all valid cleanup strategies', async () => {
    const mockDb = createMockDb();
    const strategies: CleanupStrategy[] = ['transaction', 'delete', 'truncate'];

    for (const strategy of strategies) {
      if (strategy === 'transaction') {
        await expect(cleanDatabase(mockDb, strategy)).resolves.toBeUndefined();
      } else {
        await expect(cleanDatabase(mockDb, strategy, ['users'])).resolves.toBeUndefined();
      }
    }
  });

  it('should handle very long table lists', async () => {
    const mockDb = createMockDb();
    const tables = Array.from({ length: 100 }, (_, i) => `table_${i}`);

    await expect(cleanDatabase(mockDb, 'delete', tables)).resolves.toBeUndefined();
  });
});

describe('CleanupStrategy type', () => {
  it('should accept valid cleanup strategy strings', () => {
    const validStrategies: CleanupStrategy[] = ['transaction', 'delete', 'truncate'];

    expect(validStrategies).toHaveLength(3);
  });
});
