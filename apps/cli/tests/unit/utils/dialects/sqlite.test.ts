import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Kysely, sql } from 'kysely';
import {
  getSqliteInfo,
  getTableInfo,
  getIndexInfo,
  getForeignKeys,
  checkIntegrity,
  checkForeignKeyViolations,
  vacuum,
  analyze,
  optimize,
  getDatabaseFileSize,
  getTableStatistics,
  enableWalMode,
  createBackup,
  getAllTables,
  getAllIndexes,
  type SqliteInfo,
} from '@/utils/dialects/sqlite';
import { CLIDatabaseError } from '@/utils/errors';
import * as fsExtra from 'fs-extra';

// Mock fs-extra
vi.mock('fs-extra', () => ({
  stat: vi.fn(),
}));

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

describe('SQLite Dialect Utilities', () => {
  describe('getSqliteInfo', () => {
    it('should return SQLite info', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue({ version: '3.42.0' }),
        }),
      });

      vi.spyOn(sql, 'raw').mockImplementation((query: string) => {
        if (query === 'PRAGMA page_size') {
          return { execute: vi.fn().mockResolvedValue({ rows: [{ page_size: 4096 }] }) } as any;
        }
        if (query === 'PRAGMA page_count') {
          return { execute: vi.fn().mockResolvedValue({ rows: [{ page_count: 100 }] }) } as any;
        }
        if (query === 'PRAGMA freelist_count') {
          return { execute: vi.fn().mockResolvedValue({ rows: [{ freelist_count: 5 }] }) } as any;
        }
        if (query === 'PRAGMA compile_options') {
          return {
            execute: vi.fn().mockResolvedValue({
              rows: [{ compile_option: 'ENABLE_FTS5' }, { compile_option: 'ENABLE_JSON1' }],
            }),
          } as any;
        }
        return { execute: vi.fn().mockResolvedValue({ rows: [] }) } as any;
      });

      const result = await getSqliteInfo(mockDb);

      expect(result.version).toBe('3.42.0');
      expect(result.pageSize).toBe(4096);
      expect(result.pageCount).toBe(100);
      expect(result.freePages).toBe(5);
      expect(result.compiledOptions).toContain('ENABLE_FTS5');
      expect(result.compiledOptions).toContain('ENABLE_JSON1');
    });

    it('should throw CLIDatabaseError when query fails', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockRejectedValue(new Error('Database not found')),
        }),
      });

      await expect(getSqliteInfo(mockDb)).rejects.toThrow(CLIDatabaseError);
      await expect(getSqliteInfo(mockDb)).rejects.toThrow('Failed to get SQLite info');
    });

    it('should handle default values when PRAGMA returns empty', async () => {
      const mockDb = createMockDb({
        selectNoFrom: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue({ version: '3.42.0' }),
        }),
      });

      vi.spyOn(sql, 'raw').mockImplementation(() => {
        return { execute: vi.fn().mockResolvedValue({ rows: [{}] }) } as any;
      });

      const result = await getSqliteInfo(mockDb);

      expect(result.pageSize).toBe(4096); // default
      expect(result.pageCount).toBe(0);
      expect(result.freePages).toBe(0);
    });
  });

  describe('getTableInfo', () => {
    it('should return table column info', async () => {
      const mockColumns = [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { cid: 2, name: 'email', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      ];

      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({ rows: mockColumns }),
      } as any);

      const mockDb = createMockDb();

      const result = await getTableInfo(mockDb, 'users');

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('id');
      expect(result[0].pk).toBe(1);
      expect(result[1].name).toBe('name');
      expect(result[2].notnull).toBe(1);
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Table not found')),
      } as any);

      const mockDb = createMockDb();

      await expect(getTableInfo(mockDb, 'nonexistent')).rejects.toThrow(CLIDatabaseError);
      await expect(getTableInfo(mockDb, 'nonexistent')).rejects.toThrow('Failed to get table info');
    });

    it('should reject invalid table names', async () => {
      const mockDb = createMockDb();

      await expect(getTableInfo(mockDb, "users'; DROP TABLE")).rejects.toThrow();
    });
  });

  describe('getIndexInfo', () => {
    it('should return index column info', async () => {
      const mockIndexColumns = [
        { seqno: 0, cid: 1, name: 'email' },
        { seqno: 1, cid: 2, name: 'created_at' },
      ];

      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({ rows: mockIndexColumns }),
      } as any);

      const mockDb = createMockDb();

      const result = await getIndexInfo(mockDb, 'idx_users_email');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('email');
      expect(result[1].name).toBe('created_at');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Index not found')),
      } as any);

      const mockDb = createMockDb();

      await expect(getIndexInfo(mockDb, 'nonexistent_idx')).rejects.toThrow(CLIDatabaseError);
      await expect(getIndexInfo(mockDb, 'nonexistent_idx')).rejects.toThrow('Failed to get index info');
    });
  });

  describe('getForeignKeys', () => {
    it('should return foreign key info', async () => {
      const mockForeignKeys = [
        {
          id: 0,
          seq: 0,
          table: 'users',
          from: 'user_id',
          to: 'id',
          on_update: 'NO ACTION',
          on_delete: 'CASCADE',
          match: 'NONE',
        },
      ];

      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({ rows: mockForeignKeys }),
      } as any);

      const mockDb = createMockDb();

      const result = await getForeignKeys(mockDb, 'posts');

      expect(result).toHaveLength(1);
      expect(result[0].table).toBe('users');
      expect(result[0].from).toBe('user_id');
      expect(result[0].to).toBe('id');
      expect(result[0].on_delete).toBe('CASCADE');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Table not found')),
      } as any);

      const mockDb = createMockDb();

      await expect(getForeignKeys(mockDb, 'nonexistent')).rejects.toThrow(CLIDatabaseError);
      await expect(getForeignKeys(mockDb, 'nonexistent')).rejects.toThrow('Failed to get foreign keys');
    });
  });

  describe('checkIntegrity', () => {
    it('should return true when database is OK', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          rows: [{ integrity_check: 'ok' }],
        }),
      } as any);

      const mockDb = createMockDb();

      const result = await checkIntegrity(mockDb);

      expect(result).toBe(true);
    });

    it('should return false when database has errors', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          rows: [{ integrity_check: 'row 1 missing from index idx_users_email' }],
        }),
      } as any);

      const mockDb = createMockDb();

      const result = await checkIntegrity(mockDb);

      expect(result).toBe(false);
    });

    it('should return false when multiple errors found', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          rows: [
            { integrity_check: 'row 1 missing from index' },
            { integrity_check: 'row 2 missing from index' },
          ],
        }),
      } as any);

      const mockDb = createMockDb();

      const result = await checkIntegrity(mockDb);

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Query failed')),
      } as any);

      const mockDb = createMockDb();

      const result = await checkIntegrity(mockDb);

      expect(result).toBe(false);
    });
  });

  describe('checkForeignKeyViolations', () => {
    it('should return empty array when no violations', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      } as any);

      const mockDb = createMockDb();

      const result = await checkForeignKeyViolations(mockDb);

      expect(result).toEqual([]);
    });

    it('should return violations when found', async () => {
      const mockViolations = [
        { table: 'posts', rowid: 5, parent: 'users', fkid: 0 },
        { table: 'posts', rowid: 10, parent: 'users', fkid: 0 },
      ];

      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({ rows: mockViolations }),
      } as any);

      const mockDb = createMockDb();

      const result = await checkForeignKeyViolations(mockDb);

      expect(result).toHaveLength(2);
      expect(result[0].table).toBe('posts');
      expect(result[0].rowid).toBe(5);
    });

    it('should return empty array on error', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Query failed')),
      } as any);

      const mockDb = createMockDb();

      const result = await checkForeignKeyViolations(mockDb);

      expect(result).toEqual([]);
    });
  });

  describe('vacuum', () => {
    it('should vacuum database successfully', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await vacuum(mockDb);

      expect(sql.raw).toHaveBeenCalledWith('VACUUM');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Database locked')),
      } as any);

      const mockDb = createMockDb();

      await expect(vacuum(mockDb)).rejects.toThrow(CLIDatabaseError);
      await expect(vacuum(mockDb)).rejects.toThrow('Failed to vacuum database');
    });
  });

  describe('analyze', () => {
    it('should analyze entire database when no table specified', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await analyze(mockDb);

      expect(sql.raw).toHaveBeenCalledWith('ANALYZE');
    });

    it('should analyze specific table when specified', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await analyze(mockDb, 'users');

      expect(sql.raw).toHaveBeenCalledWith("ANALYZE 'users'");
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Table not found')),
      } as any);

      const mockDb = createMockDb();

      await expect(analyze(mockDb, 'nonexistent')).rejects.toThrow(CLIDatabaseError);
      await expect(analyze(mockDb, 'nonexistent')).rejects.toThrow('Failed to analyze database');
    });

    it('should reject invalid table names', async () => {
      const mockDb = createMockDb();

      await expect(analyze(mockDb, "users'; DROP TABLE")).rejects.toThrow();
    });
  });

  describe('optimize', () => {
    it('should run optimize, vacuum, and analyze', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await optimize(mockDb);

      expect(sql.raw).toHaveBeenCalledWith('PRAGMA optimize');
      expect(sql.raw).toHaveBeenCalledWith('VACUUM');
      expect(sql.raw).toHaveBeenCalledWith('ANALYZE');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Database locked')),
      } as any);

      const mockDb = createMockDb();

      await expect(optimize(mockDb)).rejects.toThrow(CLIDatabaseError);
      await expect(optimize(mockDb)).rejects.toThrow('Failed to optimize database');
    });
  });

  describe('getDatabaseFileSize', () => {
    it('should return formatted file size', async () => {
      vi.mocked(fsExtra.stat).mockResolvedValue({ size: 1048576 } as any); // 1 MB

      const result = await getDatabaseFileSize('/path/to/database.db');

      expect(result).toBe('1.00 MB');
    });

    it('should return size in bytes for small files', async () => {
      vi.mocked(fsExtra.stat).mockResolvedValue({ size: 512 } as any);

      const result = await getDatabaseFileSize('/path/to/database.db');

      expect(result).toBe('512 B');
    });

    it('should return size in KB for medium files', async () => {
      vi.mocked(fsExtra.stat).mockResolvedValue({ size: 51200 } as any); // 50 KB

      const result = await getDatabaseFileSize('/path/to/database.db');

      expect(result).toBe('50.00 KB');
    });

    it('should return size in GB for large files', async () => {
      vi.mocked(fsExtra.stat).mockResolvedValue({ size: 1073741824 } as any); // 1 GB

      const result = await getDatabaseFileSize('/path/to/database.db');

      expect(result).toBe('1.00 GB');
    });

    it('should return "Unknown" on error', async () => {
      vi.mocked(fsExtra.stat).mockRejectedValue(new Error('File not found'));

      const result = await getDatabaseFileSize('/path/to/nonexistent.db');

      expect(result).toBe('Unknown');
    });
  });

  describe('getTableStatistics', () => {
    it('should return table statistics', async () => {
      const mockTableInfo = [
        { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      ];

      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({ rows: mockTableInfo }),
      } as any);

      // Create a more sophisticated mock that handles the different query patterns:
      // 1. COUNT(*) query - returns { count: 100 } via executeTakeFirst
      // 2. indexes query - returns array via execute
      // 3. triggers query - returns array via execute
      let callCount = 0;
      const mockDb = {
        selectFrom: vi.fn().mockImplementation((table: string) => {
          return {
            select: vi.fn().mockImplementation((arg: any) => {
              // For COUNT(*) query (first call)
              if (callCount === 0) {
                callCount++;
                return {
                  executeTakeFirst: vi.fn().mockResolvedValue({ count: 100 }),
                };
              }
              // For subsequent queries (indexes and triggers)
              return {
                where: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue([{ name: 'idx_users_name' }]),
                  }),
                }),
              };
            }),
          };
        }),
      } as unknown as Kysely<any>;

      const result = await getTableStatistics(mockDb, 'users');

      expect(result.rows).toBe(100);
      expect(result.columns).toBe(2);
      expect(result.primaryKey).toBe('id');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Table not found')),
      } as any);

      const mockDb = createMockDb();

      await expect(getTableStatistics(mockDb, 'nonexistent')).rejects.toThrow(CLIDatabaseError);
      await expect(getTableStatistics(mockDb, 'nonexistent')).rejects.toThrow('Failed to get table statistics');
    });

    it('should handle tables without primary key', async () => {
      const mockTableInfo = [
        { cid: 0, name: 'col1', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { cid: 1, name: 'col2', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      ];

      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({ rows: mockTableInfo }),
      } as any);

      // Track which call we're on to return appropriate mock data
      let callCount = 0;
      const mockDb = {
        selectFrom: vi.fn().mockImplementation((table: string) => {
          return {
            select: vi.fn().mockImplementation((arg: any) => {
              // For COUNT(*) query (first call)
              if (callCount === 0) {
                callCount++;
                return {
                  executeTakeFirst: vi.fn().mockResolvedValue({ count: 50 }),
                };
              }
              // For subsequent queries (indexes and triggers)
              return {
                where: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue([]),
                  }),
                }),
              };
            }),
          };
        }),
      } as unknown as Kysely<any>;

      const result = await getTableStatistics(mockDb, 'no_pk_table');

      expect(result.primaryKey).toBeNull();
    });
  });

  describe('enableWalMode', () => {
    it('should enable WAL mode', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await enableWalMode(mockDb);

      expect(sql.raw).toHaveBeenCalledWith('PRAGMA journal_mode=WAL');
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Cannot change mode')),
      } as any);

      const mockDb = createMockDb();

      await expect(enableWalMode(mockDb)).rejects.toThrow(CLIDatabaseError);
      await expect(enableWalMode(mockDb)).rejects.toThrow('Failed to enable WAL mode');
    });
  });

  describe('createBackup', () => {
    it('should create backup using VACUUM INTO', async () => {
      const mockExecute = vi.fn().mockResolvedValue({});
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: mockExecute,
      } as any);

      const mockDb = createMockDb();

      await createBackup(mockDb, '/path/to/backup.db');

      expect(sql.raw).toHaveBeenCalledWith("VACUUM INTO '/path/to/backup.db'");
    });

    it('should throw CLIDatabaseError on failure', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('Permission denied')),
      } as any);

      const mockDb = createMockDb();

      await expect(createBackup(mockDb, '/path/to/backup.db')).rejects.toThrow(CLIDatabaseError);
      await expect(createBackup(mockDb, '/path/to/backup.db')).rejects.toThrow('Failed to create backup');
    });

    it('should reject paths with SQL injection characters', async () => {
      const mockDb = createMockDb();

      await expect(createBackup(mockDb, "/path/to/backup'; DROP TABLE users;--")).rejects.toThrow();
    });

    it('should reject paths with semicolons', async () => {
      const mockDb = createMockDb();

      await expect(createBackup(mockDb, '/path/to/backup;evil.db')).rejects.toThrow();
    });
  });

  describe('getAllTables', () => {
    it('should return all user tables', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue([{ name: 'users' }, { name: 'posts' }, { name: 'comments' }]),
              }),
            }),
          }),
        }),
      });

      const result = await getAllTables(mockDb);

      expect(result).toHaveLength(3);
      expect(result).toContain('users');
      expect(result).toContain('posts');
      expect(result).toContain('comments');
    });

    it('should exclude sqlite internal tables', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue([{ name: 'users' }]),
              }),
            }),
          }),
        }),
      });

      const result = await getAllTables(mockDb);

      expect(result).not.toContain('sqlite_master');
      expect(result).not.toContain('sqlite_sequence');
    });

    it('should return empty array on error', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                execute: vi.fn().mockRejectedValue(new Error('Query failed')),
              }),
            }),
          }),
        }),
      });

      const result = await getAllTables(mockDb);

      expect(result).toEqual([]);
    });
  });

  describe('getAllIndexes', () => {
    it('should return all user indexes with uniqueness info', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue([
                  { name: 'idx_users_email', table: 'users', sql: 'CREATE UNIQUE INDEX idx_users_email ON users(email)' },
                  { name: 'idx_posts_user_id', table: 'posts', sql: 'CREATE INDEX idx_posts_user_id ON posts(user_id)' },
                ]),
              }),
            }),
          }),
        }),
      });

      const result = await getAllIndexes(mockDb);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('idx_users_email');
      expect(result[0].unique).toBe(true);
      expect(result[1].name).toBe('idx_posts_user_id');
      expect(result[1].unique).toBe(false);
    });

    it('should handle indexes without SQL', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue([{ name: 'idx_implicit', table: 'users', sql: null }]),
              }),
            }),
          }),
        }),
      });

      const result = await getAllIndexes(mockDb);

      expect(result[0].unique).toBe(false);
    });

    it('should return empty array on error', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                execute: vi.fn().mockRejectedValue(new Error('Query failed')),
              }),
            }),
          }),
        }),
      });

      const result = await getAllIndexes(mockDb);

      expect(result).toEqual([]);
    });
  });

  describe('SQL Injection Prevention', () => {
    it('should prevent SQL injection in table names for getTableInfo', async () => {
      const mockDb = createMockDb();

      await expect(getTableInfo(mockDb, "users'; DROP TABLE users;--")).rejects.toThrow();
    });

    it('should prevent SQL injection in index names for getIndexInfo', async () => {
      const mockDb = createMockDb();

      await expect(getIndexInfo(mockDb, "idx'; DROP INDEX;--")).rejects.toThrow();
    });

    it('should prevent SQL injection in table names for getForeignKeys', async () => {
      const mockDb = createMockDb();

      await expect(getForeignKeys(mockDb, "posts'; DROP TABLE;--")).rejects.toThrow();
    });

    it('should prevent SQL injection in backup paths', async () => {
      const mockDb = createMockDb();

      await expect(createBackup(mockDb, "backup'; DROP TABLE users;--")).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty database (no tables)', async () => {
      const mockDb = createMockDb({
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

      const tables = await getAllTables(mockDb);
      const indexes = await getAllIndexes(mockDb);

      expect(tables).toEqual([]);
      expect(indexes).toEqual([]);
    });

    it('should handle table names with underscores', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      } as any);

      const mockDb = createMockDb();

      await getTableInfo(mockDb, 'user_accounts');

      expect(sql.raw).toHaveBeenCalledWith("PRAGMA table_info('user_accounts')");
    });

    it('should handle table names starting with underscore', async () => {
      vi.spyOn(sql, 'raw').mockReturnValue({
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      } as any);

      const mockDb = createMockDb();

      await getTableInfo(mockDb, '_migrations');

      expect(sql.raw).toHaveBeenCalledWith("PRAGMA table_info('_migrations')");
    });

    it('should handle empty string table name', async () => {
      const mockDb = createMockDb();

      await expect(getTableInfo(mockDb, '')).rejects.toThrow();
    });

    it('should handle very long table names', async () => {
      const mockDb = createMockDb();
      const longName = 'a'.repeat(200);

      await expect(getTableInfo(mockDb, longName)).rejects.toThrow();
    });
  });
});
