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
    white: (s: string) => s,
  },
  table: vi.fn(() => ''),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    stop: vi.fn(),
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

import { logsCommand } from '../../../../src/commands/audit/logs.js';
import { getDatabaseConnection } from '../../../../src/utils/database.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('audit logs command', () => {
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
    
    command = logsCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('logs');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Query audit logs');
    });

    it('should have --table option', () => {
      const options = command.options;
      const tableOpt = options.find((o) => o.long === '--table');
      expect(tableOpt).toBeDefined();
    });

    it('should have --user option', () => {
      const options = command.options;
      const userOpt = options.find((o) => o.long === '--user');
      expect(userOpt).toBeDefined();
    });

    it('should have --action option', () => {
      const options = command.options;
      const actionOpt = options.find((o) => o.long === '--action');
      expect(actionOpt).toBeDefined();
    });

    it('should have --limit option with default 50', () => {
      const options = command.options;
      const limitOpt = options.find((o) => o.long === '--limit');
      expect(limitOpt).toBeDefined();
      expect(limitOpt?.defaultValue).toBe('50');
    });

    it('should have --since option', () => {
      const options = command.options;
      const sinceOpt = options.find((o) => o.long === '--since');
      expect(sinceOpt).toBeDefined();
    });

    it('should have --until option', () => {
      const options = command.options;
      const untilOpt = options.find((o) => o.long === '--until');
      expect(untilOpt).toBeDefined();
    });

    it('should have --entity-id option', () => {
      const options = command.options;
      const entityIdOpt = options.find((o) => o.long === '--entity-id');
      expect(entityIdOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const options = command.options;
      const jsonOpt = options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });

    it('should have --verbose option', () => {
      const options = command.options;
      const verboseOpt = options.find((o) => o.long === '--verbose');
      expect(verboseOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should query audit logs successfully', async () => {
      // Mock audit_logs table exists and return empty audit logs
      mockDb.execute.mockResolvedValue([]);

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
      expect(mockDb.selectFrom).toHaveBeenCalled();
    });

    it('should filter by table name', async () => {
      mockDb.execute.mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--table', 'users']);
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should filter by user id', async () => {
      mockDb.execute.mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--user', 'user123']);
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should filter by action type', async () => {
      mockDb.execute.mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--action', 'INSERT']);
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should apply limit', async () => {
      // Mock that table exists
      mockDb.execute
        .mockResolvedValueOnce([{ table_name: 'audit_logs' }])  // First call: check table exists
        .mockResolvedValueOnce([]);  // Second call: query results

      await command.parseAsync(['node', 'test', '--limit', '100']);
      expect(mockDb.limit).toHaveBeenCalledWith(100);
    });

    it('should output JSON when --json is used', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'audit_logs' }]);

      await command.parseAsync(['node', 'test', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
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

    it('should handle invalid since date', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'audit_logs' }]);

      await expect(command.parseAsync(['node', 'test', '--since', 'invalid-date']))
        .rejects.toThrow(CLIError);
    });

    it('should handle invalid until date', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'audit_logs' }]);

      await expect(command.parseAsync(['node', 'test', '--until', 'invalid-date']))
        .rejects.toThrow(CLIError);
    });

    it('should handle invalid limit value', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'audit_logs' }]);

      await expect(command.parseAsync(['node', 'test', '--limit', 'abc']))
        .rejects.toThrow(CLIError);
    });
  });

  describe('edge cases', () => {
    it('should handle missing audit_logs table', async () => {
      mockDb.execute.mockResolvedValue([]);

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should close database connection after execution', async () => {
      // First call returns table exists, second call returns empty logs
      mockDb.execute.mockResolvedValue([]);

      await command.parseAsync(['node', 'test']);
      expect(mockDb.destroy).toHaveBeenCalled();
    });

    it('should filter by entity-id', async () => {
      mockDb.execute.mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--entity-id', '123']);
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should handle empty results', async () => {
      mockDb.execute.mockResolvedValue([]);

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should display verbose output when --verbose is used', async () => {
      // First call for table check returns a row, second call for logs returns audit entries
      let callCount = 0;
      mockDb.execute.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Table exists check
          return Promise.resolve([{ table_name: 'audit_logs' }]);
        }
        // Return audit logs
        return Promise.resolve([
          {
            id: 1,
            table_name: 'users',
            action: 'INSERT',
            entity_id: '1',
            user_id: 'user1',
            created_at: new Date(),
            old_values: null,
            new_values: '{"name":"test"}',
          },
        ]);
      });

      await command.parseAsync(['node', 'test', '--verbose']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });
});
