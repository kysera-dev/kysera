import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock external dependencies before importing the module under test
vi.mock('../../../../src/utils/database.js', () => ({
  getDatabaseConnection: vi.fn(),
}));

vi.mock('../../../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));


vi.mock('@xec-sh/kit', () => ({
  prism: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    gray: (s: string) => s,
    red: (s: string) => s,
    bold: (s: string) => s,
    blue: (s: string) => s,
  },
  table: vi.fn(() => ''),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    stop: vi.fn(),
    text: '',
  })),
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { sqlCommand } from '../../../../src/commands/debug/sql.js';
import { getDatabaseConnection } from '../../../../src/utils/database.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('debug sql command', () => {
  let command: Command;
  let mockDb: any;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    process.env['NODE_ENV'] = 'test';
    
    mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
      executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
      raw: vi.fn((sql) => sql),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', connection: 'postgres://localhost/test' },
    });
    
    consoleSpy = {
      log: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = sqlCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('sql');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('SQL query monitoring');
    });

    it('should have --watch option', () => {
      const options = command.options;
      const watchOpt = options.find((o) => o.long === '--watch');
      expect(watchOpt).toBeDefined();
    });

    it('should have --filter option', () => {
      const options = command.options;
      const filterOpt = options.find((o) => o.long === '--filter');
      expect(filterOpt).toBeDefined();
    });

    it('should have --highlight option', () => {
      const options = command.options;
      const highlightOpt = options.find((o) => o.long === '--highlight');
      expect(highlightOpt).toBeDefined();
    });

    it('should have --show-params option', () => {
      const options = command.options;
      const showParamsOpt = options.find((o) => o.long === '--show-params');
      expect(showParamsOpt).toBeDefined();
    });

    it('should have --show-duration option', () => {
      const options = command.options;
      const showDurationOpt = options.find((o) => o.long === '--show-duration');
      expect(showDurationOpt).toBeDefined();
    });

    it('should have --limit option with default 50', () => {
      const options = command.options;
      const limitOpt = options.find((o) => o.long === '--limit');
      expect(limitOpt).toBeDefined();
      expect(limitOpt?.defaultValue).toBe('50');
    });
  });

  describe('success scenarios', () => {
    it('should analyze recent queries successfully', async () => {
      // First call checks for table existence, second call gets the actual query logs
      mockDb.execute
        .mockResolvedValueOnce([{ table_name: 'query_logs' }])
        .mockResolvedValueOnce([
          {
            query_text: 'SELECT * FROM users',
            duration_ms: 50,
            error: null,
            executed_at: new Date(),
          },
        ]);

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should filter queries by pattern', async () => {
      mockDb.execute
        .mockResolvedValueOnce([{ table_name: 'query_logs' }])
        .mockResolvedValueOnce([
          {
            query_text: 'SELECT * FROM users',
            duration_ms: 50,
            error: null,
            executed_at: new Date(),
          },
        ]);

      await command.parseAsync(['node', 'test', '--filter', 'SELECT']);
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should apply limit to query results', async () => {
      mockDb.execute
        .mockResolvedValueOnce([{ table_name: 'query_logs' }])
        .mockResolvedValueOnce([
          {
            query_text: 'SELECT * FROM users',
            duration_ms: 50,
            error: null,
            executed_at: new Date(),
          },
        ]);

      await command.parseAsync(['node', 'test', '--limit', '100']);
      expect(mockDb.limit).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error when database config is not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError);
    });

    it('should throw error when database connection fails', async () => {
      (getDatabaseConnection as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError);
    });

    it('should handle invalid limit value', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'query_logs' }]);

      await expect(command.parseAsync(['node', 'test', '--limit', 'abc']))
        .rejects.toThrow(CLIError);
    });
  });

  describe('edge cases', () => {
    it('should handle missing query_logs table', async () => {
      mockDb.execute.mockResolvedValue([]);

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should close database connection after execution', async () => {
      mockDb.execute
        .mockResolvedValueOnce([{ table_name: 'query_logs' }])
        .mockResolvedValueOnce([
          {
            query_text: 'SELECT * FROM users',
            duration_ms: 50,
            error: null,
            executed_at: new Date(),
          },
        ]);

      await command.parseAsync(['node', 'test']);
      expect(mockDb.destroy).toHaveBeenCalled();
    });

    it('should highlight SQL keywords', async () => {
      mockDb.execute
        .mockResolvedValueOnce([{ table_name: 'query_logs' }])
        .mockResolvedValueOnce([
          {
            query_text: 'SELECT * FROM users',
            duration_ms: 50,
            error: null,
            executed_at: new Date(),
          },
        ]);

      await command.parseAsync(['node', 'test']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should detect slow queries', async () => {
      mockDb.execute
        .mockResolvedValueOnce([{ table_name: 'query_logs' }])
        .mockResolvedValueOnce([
          {
            query_text: 'SELECT * FROM large_table',
            duration_ms: 5000,
            error: null,
            executed_at: new Date(),
          },
        ]);

      await command.parseAsync(['node', 'test']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show error queries', async () => {
      mockDb.execute
        .mockResolvedValueOnce([{ table_name: 'query_logs' }])
        .mockResolvedValueOnce([
          {
            query_text: 'SELECT * FROM nonexistent',
            duration_ms: null,
            error: 'relation does not exist',
            executed_at: new Date(),
          },
        ]);

      await command.parseAsync(['node', 'test']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });
});
