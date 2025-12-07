import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Kysely, sql } from 'kysely';
import {
  getMysqlInfo,
  getTableSize,
  getIndexSize,
  getActiveConnections,
  getSlowQueries,
  killConnection,
  optimizeTable,
  analyzeTable,
  checkTable,
  repairTable,
  databaseExists,
  createDatabase,
  dropDatabase,
  getTableStatistics,
  type MysqlInfo,
} from '@/utils/dialects/mysql';
import { CLIDatabaseError } from '@/utils/errors';

// Create mock Kysely instance helper
function createMockDb(overrides: any = {}) {
  const mockDb = {
    selectNoFrom: vi.fn().mockReturnThis(),
    selectFrom: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    $if: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    execute: vi.fn(),
    executeTakeFirst: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  };
  return mockDb as unknown as Kysely<any>;
}

describe('MySQL Dialect Utilities', () => {
  describe('getMysqlInfo', () => {
    it('should return MySQL server info', async () => {
      const mockInfo: MysqlInfo = {
        version: '8.0.35',
        currentDatabase: 'testdb',
        currentUser: 'testuser@localhost',
        characterSet: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
        timezone: 'SYSTEM',
      };

      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(mockInfo),
        }),
      });

      const result = await getMysqlInfo(mockDb);

      expect(result).toEqual(mockInfo);
      expect(mockDb.selectNoFrom).toHaveBeenCalled();
    });

    it('should throw CLIDatabaseError when query fails', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockRejectedValue(new Error('Connection refused')),
        }),
      });

      await expect(getMysqlInfo(mockDb)).rejects.toThrow(CLIDatabaseError);
      await expect(getMysqlInfo(mockDb)).rejects.toThrow('Failed to get MySQL info');
    });

    it('should throw CLIDatabaseError when result is null', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        }),
      });

      await expect(getMysqlInfo(mockDb)).rejects.toThrow(CLIDatabaseError);
    });
  });

  describe('getTableSize', () => {
    it('should return table size in MB', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              $if: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({ sizeBytes: 1048576 }), // 1 MB
              }),
            }),
          }),
        }),
      });

      const result = await getTableSize(mockDb, 'users');

      expect(result).toBe('1.00 MB');
    });

    it('should return "Unknown" when query fails', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              $if: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockRejectedValue(new Error('Table not found')),
              }),
            }),
          }),
        }),
      });

      const result = await getTableSize(mockDb, 'nonexistent');

      expect(result).toBe('Unknown');
    });

    it('should return "Unknown" when result is null', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              $if: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue(null),
              }),
            }),
          }),
        }),
      });

      const result = await getTableSize(mockDb, 'users');

      expect(result).toBe('Unknown');
    });

    it('should return "Unknown" when sizeBytes is 0', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              $if: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({ sizeBytes: 0 }),
              }),
            }),
          }),
        }),
      });

      const result = await getTableSize(mockDb, 'empty_table');

      expect(result).toBe('Unknown');
    });

    it('should accept optional schema parameter', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              $if: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({ sizeBytes: 2097152 }), // 2 MB
              }),
            }),
          }),
        }),
      });

      const result = await getTableSize(mockDb, 'users', 'myschema');

      expect(result).toBe('2.00 MB');
      expect(mockDb.selectFrom).toHaveBeenCalledWith('information_schema.tables');
    });
  });

  describe('getIndexSize', () => {
    it('should return index size in KB', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                $if: vi.fn().mockReturnValue({
                  executeTakeFirst: vi.fn().mockResolvedValue({ sizePages: 64 }), // 64 pages * 16KB = 1024 KB
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getIndexSize(mockDb, 'idx_users_email', 'users');

      expect(result).toBe('1024.00 KB');
    });

    it('should return "Unknown" when query fails', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                $if: vi.fn().mockReturnValue({
                  executeTakeFirst: vi.fn().mockRejectedValue(new Error('Index not found')),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getIndexSize(mockDb, 'nonexistent_idx', 'users');

      expect(result).toBe('Unknown');
    });

    it('should return "Unknown" when sizePages is 0', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                $if: vi.fn().mockReturnValue({
                  executeTakeFirst: vi.fn().mockResolvedValue({ sizePages: 0 }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getIndexSize(mockDb, 'empty_idx', 'users');

      expect(result).toBe('Unknown');
    });
  });

  describe('getActiveConnections', () => {
    it('should return active connection count', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue({ count: 10 }),
            }),
          }),
        }),
      });

      const result = await getActiveConnections(mockDb);

      expect(result).toBe(10);
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
    it('should return slow queries with duration in milliseconds', async () => {
      const mockRows = [
        { query: 'SELECT * FROM large_table', duration: 5, state: 'executing' },
        { query: 'UPDATE users SET name = ...', duration: 2, state: 'sending data' },
      ];

      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue(mockRows),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getSlowQueries(mockDb, 100);

      expect(result).toHaveLength(2);
      expect(result[0].duration).toBe(5000); // Converted to ms
      expect(result[1].duration).toBe(2000);
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

    it('should handle null query and state values', async () => {
      const mockRows = [{ query: null, duration: null, state: null }];

      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue(mockRows),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getSlowQueries(mockDb);

      expect(result[0].query).toBe('');
      expect(result[0].duration).toBe(0);
      expect(result[0].state).toBe('');
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
  });

  describe('killConnection', () => {
    it('should successfully kill connection', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      const result = await killConnection(mockDb, 12345);

      expect(result).toBe(true);
      expect(sql.raw).toHaveBeenCalledWith('KILL 12345');
    });

    it('should return false on error', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Permission denied')),
      } as any);

      const mockDb = createMockDb();

      const result = await killConnection(mockDb, 12345);

      expect(result).toBe(false);
    });

    it('should reject invalid process ID (negative)', async () => {
      const mockDb = createMockDb();

      const result = await killConnection(mockDb, -1);

      expect(result).toBe(false);
    });

    it('should reject invalid process ID (non-integer)', async () => {
      const mockDb = createMockDb();

      const result = await killConnection(mockDb, 12.5);

      expect(result).toBe(false);
    });
  });

  describe('optimizeTable', () => {
    it('should optimize table successfully', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await optimizeTable(mockDb, 'users');

      expect(sql.raw).toHaveBeenCalledWith('OPTIMIZE TABLE `users`');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Table locked')),
      } as any);

      const mockDb = createMockDb();

      await expect(optimizeTable(mockDb, 'users')).rejects.toThrow(CLIDatabaseError);
      await expect(optimizeTable(mockDb, 'users')).rejects.toThrow('Failed to optimize table');
    });

    it('should reject invalid table names', async () => {
      const mockDb = createMockDb();

      await expect(optimizeTable(mockDb, "users'; DROP TABLE")).rejects.toThrow();
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

      expect(sql.raw).toHaveBeenCalledWith('ANALYZE TABLE `users`');
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

  describe('checkTable', () => {
    it('should return true when table is OK', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          rows: [{ Msg_text: 'OK' }],
        }),
      } as any);

      const mockDb = createMockDb();

      const result = await checkTable(mockDb, 'users');

      expect(result).toBe(true);
      expect(sql.raw).toHaveBeenCalledWith('CHECK TABLE `users`');
    });

    it('should return false when table has errors', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          rows: [{ Msg_text: 'Corrupt' }],
        }),
      } as any);

      const mockDb = createMockDb();

      const result = await checkTable(mockDb, 'users');

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Query failed')),
      } as any);

      const mockDb = createMockDb();

      const result = await checkTable(mockDb, 'users');

      expect(result).toBe(false);
    });
  });

  describe('repairTable', () => {
    it('should repair table successfully', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await repairTable(mockDb, 'users');

      expect(sql.raw).toHaveBeenCalledWith('REPAIR TABLE `users`');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Repair failed')),
      } as any);

      const mockDb = createMockDb();

      await expect(repairTable(mockDb, 'users')).rejects.toThrow(CLIDatabaseError);
      await expect(repairTable(mockDb, 'users')).rejects.toThrow('Failed to repair table');
    });
  });

  describe('databaseExists', () => {
    it('should return true when database exists', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue({ schema_name: 'testdb' }),
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
    it('should create database with default charset and collation', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await createDatabase(mockDb, 'newdb');

      expect(sql.raw).toHaveBeenCalledWith('CREATE DATABASE `newdb` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    });

    it('should create database with custom charset and collation', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await createDatabase(mockDb, 'newdb', 'latin1', 'latin1_swedish_ci');

      expect(sql.raw).toHaveBeenCalledWith('CREATE DATABASE `newdb` CHARACTER SET latin1 COLLATE latin1_swedish_ci');
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

    it('should reject invalid charset', async () => {
      const mockDb = createMockDb();

      await expect(createDatabase(mockDb, 'newdb', "utf8'; DROP TABLE", 'utf8_general_ci')).rejects.toThrow();
    });

    it('should reject invalid collation', async () => {
      const mockDb = createMockDb();

      await expect(createDatabase(mockDb, 'newdb', 'utf8', "utf8_general_ci'; DROP")).rejects.toThrow();
    });
  });

  describe('dropDatabase', () => {
    it('should drop database successfully', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await dropDatabase(mockDb, 'olddb');

      expect(sql.raw).toHaveBeenCalledWith('DROP DATABASE IF EXISTS `olddb`');
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

  describe('getTableStatistics', () => {
    it('should return table statistics', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              $if: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({
                  rows: 1000,
                  dataLength: 102400,
                  indexLength: 51200,
                  avgRowLength: 102,
                  autoIncrement: 1001,
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getTableStatistics(mockDb, 'users');

      expect(result.rows).toBe(1000);
      expect(result.avgRowLength).toBe(102);
      expect(result.autoIncrement).toBe(1001);
      expect(result.dataSize).toBe('100.00 KB');
      expect(result.indexSize).toBe('50.00 KB');
      expect(result.totalSize).toBe('150.00 KB');
    });

    it('should throw CLIDatabaseError when table not found', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              $if: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue(null),
              }),
            }),
          }),
        }),
      });

      await expect(getTableStatistics(mockDb, 'nonexistent')).rejects.toThrow(CLIDatabaseError);
      await expect(getTableStatistics(mockDb, 'nonexistent')).rejects.toThrow('Failed to get table statistics');
    });

    it('should handle null values gracefully', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              $if: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({
                  rows: null,
                  dataLength: null,
                  indexLength: null,
                  avgRowLength: null,
                  autoIncrement: null,
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getTableStatistics(mockDb, 'empty_table');

      expect(result.rows).toBe(0);
      expect(result.avgRowLength).toBe(0);
      expect(result.autoIncrement).toBeNull();
      expect(result.dataSize).toBe('0 B');
      expect(result.indexSize).toBe('0 B');
      expect(result.totalSize).toBe('0 B');
    });

    it('should format large sizes correctly', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              $if: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({
                  rows: 1000000,
                  dataLength: 1073741824, // 1 GB
                  indexLength: 536870912, // 512 MB
                  avgRowLength: 1024,
                  autoIncrement: 1000001,
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getTableStatistics(mockDb, 'large_table');

      expect(result.dataSize).toBe('1024.00 MB');
      expect(result.indexSize).toBe('512.00 MB');
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
      ];

      for (const name of maliciousNames) {
        await expect(optimizeTable(mockDb, name)).rejects.toThrow();
        await expect(analyzeTable(mockDb, name)).rejects.toThrow();
        await expect(repairTable(mockDb, name)).rejects.toThrow();
      }
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

      await expect(optimizeTable(mockDb, '')).rejects.toThrow();
    });

    it('should handle very long table names', async () => {
      const mockDb = createMockDb();
      const longName = 'a'.repeat(200);

      await expect(optimizeTable(mockDb, longName)).rejects.toThrow();
    });

    it('should handle process ID of 0', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      const result = await killConnection(mockDb, 0);

      expect(result).toBe(true);
    });

    it('should handle table names with underscores', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await optimizeTable(mockDb, 'user_accounts');

      expect(sql.raw).toHaveBeenCalledWith('OPTIMIZE TABLE `user_accounts`');
    });

    it('should handle table names starting with underscore', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await optimizeTable(mockDb, '_migrations');

      expect(sql.raw).toHaveBeenCalledWith('OPTIMIZE TABLE `_migrations`');
    });
  });
});
