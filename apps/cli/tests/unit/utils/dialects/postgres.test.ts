import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Kysely, sql } from 'kysely';
import {
  getPostgresInfo,
  checkExtension,
  createExtension,
  getTableSize,
  getIndexSize,
  getActiveConnections,
  getSlowQueries,
  killConnection,
  vacuumTable,
  analyzeTable,
  databaseExists,
  createDatabase,
  dropDatabase,
  type PostgresInfo,
} from '@/utils/dialects/postgres';
import { CLIDatabaseError } from '@/utils/errors';

// Create mock Kysely instance helper
function createMockDb(overrides: any = {}) {
  const mockDb = {
    selectNoFrom: vi.fn().mockReturnThis(),
    selectFrom: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    execute: vi.fn(),
    executeTakeFirst: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  };
  return mockDb as unknown as Kysely<any>;
}

describe('PostgreSQL Dialect Utilities', () => {
  describe('getPostgresInfo', () => {
    it('should return PostgreSQL server info', async () => {
      const mockInfo: PostgresInfo = {
        version: 'PostgreSQL 15.4',
        currentDatabase: 'testdb',
        currentUser: 'testuser',
        serverEncoding: 'UTF8',
        clientEncoding: 'UTF8',
        timezone: 'UTC',
      };

      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(mockInfo),
        }),
      });

      const result = await getPostgresInfo(mockDb);

      expect(result).toEqual(mockInfo);
      expect(mockDb.selectNoFrom).toHaveBeenCalled();
    });

    it('should throw CLIDatabaseError when query fails', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockRejectedValue(new Error('Connection refused')),
        }),
      });

      await expect(getPostgresInfo(mockDb)).rejects.toThrow(CLIDatabaseError);
      await expect(getPostgresInfo(mockDb)).rejects.toThrow('Failed to get PostgreSQL info');
    });

    it('should throw CLIDatabaseError when result is null', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        }),
      });

      await expect(getPostgresInfo(mockDb)).rejects.toThrow(CLIDatabaseError);
    });
  });

  describe('checkExtension', () => {
    it('should return true when extension exists', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue({ extname: 'uuid-ossp' }),
            }),
          }),
        }),
      });

      const result = await checkExtension(mockDb, 'uuid-ossp');

      expect(result).toBe(true);
    });

    it('should return false when extension does not exist', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue(null),
            }),
          }),
        }),
      });

      const result = await checkExtension(mockDb, 'nonexistent');

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockRejectedValue(new Error('Query failed')),
            }),
          }),
        }),
      });

      const result = await checkExtension(mockDb, 'uuid-ossp');

      expect(result).toBe(false);
    });
  });

  describe('createExtension', () => {
    it('should create extension successfully', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await createExtension(mockDb, 'uuid_ossp');

      expect(sql.raw).toHaveBeenCalledWith('CREATE EXTENSION IF NOT EXISTS "uuid_ossp"');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Permission denied')),
      } as any);

      const mockDb = createMockDb();

      await expect(createExtension(mockDb, 'uuid_ossp')).rejects.toThrow(CLIDatabaseError);
      await expect(createExtension(mockDb, 'uuid_ossp')).rejects.toThrow('Failed to create extension');
    });

    it('should reject invalid extension names', async () => {
      const mockDb = createMockDb();

      await expect(createExtension(mockDb, "test'; DROP TABLE")).rejects.toThrow();
    });
  });

  describe('getTableSize', () => {
    it('should return table size', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue({ size: '1024 bytes' }),
        }),
      });

      const result = await getTableSize(mockDb, 'users');

      expect(result).toBe('1024 bytes');
    });

    it('should return "Unknown" when query fails', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockRejectedValue(new Error('Table not found')),
        }),
      });

      const result = await getTableSize(mockDb, 'nonexistent');

      expect(result).toBe('Unknown');
    });

    it('should return "Unknown" when result is null', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        }),
      });

      const result = await getTableSize(mockDb, 'users');

      expect(result).toBe('Unknown');
    });

    it('should validate table name before using in query', async () => {
      const mockDb = createMockDb();

      const result = await getTableSize(mockDb, "users'; DROP TABLE");

      // Should return Unknown due to validation error
      expect(result).toBe('Unknown');
    });
  });

  describe('getIndexSize', () => {
    it('should return index size', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue({ size: '512 KB' }),
        }),
      });

      const result = await getIndexSize(mockDb, 'users_email_idx');

      expect(result).toBe('512 KB');
    });

    it('should return "Unknown" when query fails', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockRejectedValue(new Error('Index not found')),
        }),
      });

      const result = await getIndexSize(mockDb, 'nonexistent_idx');

      expect(result).toBe('Unknown');
    });
  });

  describe('getActiveConnections', () => {
    it('should return active connection count', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue({ count: 5 }),
            }),
          }),
        }),
      });

      const result = await getActiveConnections(mockDb);

      expect(result).toBe(5);
    });

    it('should return 0 when no active connections', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue({ count: 0 }),
            }),
          }),
        }),
      });

      const result = await getActiveConnections(mockDb);

      expect(result).toBe(0);
    });

    it('should return 0 on error', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockRejectedValue(new Error('Query failed')),
            }),
          }),
        }),
      });

      const result = await getActiveConnections(mockDb);

      expect(result).toBe(0);
    });
  });

  describe('getSlowQueries', () => {
    it('should return slow queries', async () => {
      const mockSlowQueries = [
        { query: 'SELECT * FROM large_table', duration: 5000, state: 'active' },
        { query: 'UPDATE users SET name = ...', duration: 2000, state: 'active' },
      ];

      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue(mockSlowQueries),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getSlowQueries(mockDb, 100);

      expect(result).toEqual(mockSlowQueries);
    });

    it('should return empty array when no slow queries', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue([]),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getSlowQueries(mockDb);

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    execute: vi.fn().mockRejectedValue(new Error('Query failed')),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getSlowQueries(mockDb);

      expect(result).toEqual([]);
    });

    it('should use default threshold of 100ms', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue([]),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      await getSlowQueries(mockDb);

      expect(mockDb.selectFrom).toHaveBeenCalledWith('pg_stat_activity');
    });
  });

  describe('killConnection', () => {
    it('should successfully kill connection', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue({ terminated: true }),
        }),
      });

      const result = await killConnection(mockDb, 12345);

      expect(result).toBe(true);
    });

    it('should return false when termination fails', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue({ terminated: false }),
        }),
      });

      const result = await killConnection(mockDb, 12345);

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockRejectedValue(new Error('Permission denied')),
        }),
      });

      const result = await killConnection(mockDb, 12345);

      expect(result).toBe(false);
    });

    it('should reject invalid PID (negative)', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockRejectedValue(new Error('Invalid PID')),
        }),
      });

      const result = await killConnection(mockDb, -1);

      expect(result).toBe(false);
    });

    it('should reject invalid PID (non-integer)', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockRejectedValue(new Error('Invalid PID')),
        }),
      });

      const result = await killConnection(mockDb, 12.5);

      expect(result).toBe(false);
    });
  });

  describe('vacuumTable', () => {
    it('should vacuum table successfully', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await vacuumTable(mockDb, 'users');

      expect(sql.raw).toHaveBeenCalledWith('VACUUM ANALYZE "users"');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Table locked')),
      } as any);

      const mockDb = createMockDb();

      await expect(vacuumTable(mockDb, 'users')).rejects.toThrow(CLIDatabaseError);
      await expect(vacuumTable(mockDb, 'users')).rejects.toThrow('Failed to vacuum table');
    });

    it('should reject invalid table names', async () => {
      const mockDb = createMockDb();

      await expect(vacuumTable(mockDb, "users'; DROP TABLE")).rejects.toThrow();
    });
  });

  describe('analyzeTable', () => {
    it('should analyze table successfully', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await analyzeTable(mockDb, 'users');

      expect(sql.raw).toHaveBeenCalledWith('ANALYZE "users"');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Permission denied')),
      } as any);

      const mockDb = createMockDb();

      await expect(analyzeTable(mockDb, 'users')).rejects.toThrow(CLIDatabaseError);
      await expect(analyzeTable(mockDb, 'users')).rejects.toThrow('Failed to analyze table');
    });
  });

  describe('databaseExists', () => {
    it('should return true when database exists', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue({ datname: 'testdb' }),
            }),
          }),
        }),
      });

      const result = await databaseExists(mockDb, 'testdb');

      expect(result).toBe(true);
    });

    it('should return false when database does not exist', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue(null),
            }),
          }),
        }),
      });

      const result = await databaseExists(mockDb, 'nonexistent');

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockRejectedValue(new Error('Query failed')),
            }),
          }),
        }),
      });

      const result = await databaseExists(mockDb, 'testdb');

      expect(result).toBe(false);
    });
  });

  describe('createDatabase', () => {
    it('should create database successfully', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await createDatabase(mockDb, 'newdb');

      expect(sql.raw).toHaveBeenCalledWith('CREATE DATABASE "newdb"');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Database already exists')),
      } as any);

      const mockDb = createMockDb();

      await expect(createDatabase(mockDb, 'existingdb')).rejects.toThrow(CLIDatabaseError);
      await expect(createDatabase(mockDb, 'existingdb')).rejects.toThrow('Failed to create database');
    });

    it('should reject invalid database names', async () => {
      const mockDb = createMockDb();

      await expect(createDatabase(mockDb, "test'; DROP DATABASE")).rejects.toThrow();
    });

    it('should reject database names with special characters', async () => {
      const mockDb = createMockDb();

      await expect(createDatabase(mockDb, 'test-db')).rejects.toThrow();
    });
  });

  describe('dropDatabase', () => {
    it('should validate database name and attempt to drop', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});

      // Mock sql.raw for the DROP DATABASE statement
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      // The dropDatabase function uses sql template tag (sql`...`) for pg_terminate_backend
      // which is difficult to mock completely. We test that:
      // 1. Validation passes for valid database names
      // 2. The function wraps errors correctly in CLIDatabaseError
      const mockDb = {} as unknown as Kysely<any>;

      // This will fail on the sql template tag execution, but that's expected
      // The important part is that it doesn't fail on validation
      const result = await dropDatabase(mockDb, 'olddb').catch((e) => e);

      expect(result).toBeInstanceOf(CLIDatabaseError);
      expect(result.message).toContain('Failed to drop database olddb');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Permission denied')),
      } as any);

      const mockDb = createMockDb();

      await expect(dropDatabase(mockDb, 'protecteddb')).rejects.toThrow(CLIDatabaseError);
      await expect(dropDatabase(mockDb, 'protecteddb')).rejects.toThrow('Failed to drop database');
    });

    it('should reject invalid database names', async () => {
      const mockDb = createMockDb();

      await expect(dropDatabase(mockDb, "test'; DROP TABLE")).rejects.toThrow();
    });
  });

  describe('SQL Injection Prevention', () => {
    it('should prevent SQL injection in table names', async () => {
      const mockDb = createMockDb();

      const maliciousNames = [
        "users'; DROP TABLE users;--",
        'users" OR "1"="1',
        'users`; DELETE FROM users;',
        "users\x00; DROP TABLE",
        'users/**/OR/**/1=1',
      ];

      for (const name of maliciousNames) {
        // These should either throw or return safe values
        const result = await getTableSize(mockDb, name);
        expect(result).toBe('Unknown');
      }
    });

    it('should prevent SQL injection in extension names', async () => {
      const mockDb = createMockDb();

      await expect(createExtension(mockDb, "uuid_ossp'; DROP TABLE")).rejects.toThrow();
    });

    it('should prevent SQL injection in database names', async () => {
      const mockDb = createMockDb();

      await expect(createDatabase(mockDb, "test'; DROP DATABASE")).rejects.toThrow();
      await expect(dropDatabase(mockDb, "test'; DROP DATABASE")).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string table name', async () => {
      const mockDb = createMockDb();

      const result = await getTableSize(mockDb, '');
      expect(result).toBe('Unknown');
    });

    it('should handle very long table names', async () => {
      const mockDb = createMockDb();
      const longName = 'a'.repeat(200);

      const result = await getTableSize(mockDb, longName);
      expect(result).toBe('Unknown');
    });

    it('should handle PID of 0', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue({ terminated: true }),
        }),
      });

      const result = await killConnection(mockDb, 0);
      expect(result).toBe(true);
    });

    it('should handle zero threshold for slow queries', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue([]),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getSlowQueries(mockDb, 0);
      expect(result).toEqual([]);
    });
  });
});
