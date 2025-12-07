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

import { historyCommand } from '../../../../src/commands/audit/history.js';
import { getDatabaseConnection } from '../../../../src/utils/database.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('audit history command', () => {
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
      executeTakeFirst: vi.fn().mockResolvedValue(null),
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
    
    command = historyCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('history');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Show entity history');
    });

    it('should require table argument', () => {
      const args = command.registeredArguments;
      expect(args.length).toBeGreaterThanOrEqual(2);
      expect(args[0].name()).toBe('table');
      expect(args[0].required).toBe(true);
    });

    it('should require id argument', () => {
      const args = command.registeredArguments;
      expect(args[1].name()).toBe('id');
      expect(args[1].required).toBe(true);
    });

    it('should have --limit option with default 20', () => {
      const options = command.options;
      const limitOpt = options.find((o) => o.long === '--limit');
      expect(limitOpt).toBeDefined();
      expect(limitOpt?.defaultValue).toBe('20');
    });

    it('should have --show-values option', () => {
      const options = command.options;
      const showValuesOpt = options.find((o) => o.long === '--show-values');
      expect(showValuesOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const options = command.options;
      const jsonOpt = options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });

    it('should have --reverse option', () => {
      const options = command.options;
      const reverseOpt = options.find((o) => o.long === '--reverse');
      expect(reverseOpt).toBeDefined();
    });

    it('should have --config option', () => {
      const options = command.options;
      const configOpt = options.find((o) => o.long === '--config');
      expect(configOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should show entity history', async () => {
      // Mock audit_logs table exists
      mockDb.execute.mockImplementation(() => {
        return Promise.resolve([{ table_name: 'audit_logs' }]);
      });

      await expect(command.parseAsync(['node', 'test', 'users', '123'])).resolves.not.toThrow();
      expect(mockDb.selectFrom).toHaveBeenCalled();
    });

    it('should filter by table and entity id', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'audit_logs' }]);

      await command.parseAsync(['node', 'test', 'posts', '456']);
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should apply limit', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'audit_logs' }]);

      await command.parseAsync(['node', 'test', 'users', '123', '--limit', '50']);
      expect(mockDb.limit).toHaveBeenCalled();
    });

    it('should output JSON when --json is used', async () => {
      mockDb.execute.mockResolvedValue([
        { table_name: 'audit_logs' },
        {
          id: 1,
          table_name: 'users',
          action: 'INSERT',
          entity_id: '123',
          user_id: 'user1',
          created_at: new Date(),
        },
      ]);

      await command.parseAsync(['node', 'test', 'users', '123', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should reverse order when --reverse is used', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'audit_logs' }]);

      await command.parseAsync(['node', 'test', 'users', '123', '--reverse']);
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error when database config is not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test', 'users', '123'])).rejects.toThrow(CLIError);
    });

    it('should throw error when database connection fails', async () => {
      (getDatabaseConnection as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test', 'users', '123'])).rejects.toThrow(CLIError);
    });

    it('should handle invalid limit value', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'audit_logs' }]);

      await expect(command.parseAsync(['node', 'test', 'users', '123', '--limit', 'abc']))
        .rejects.toThrow(CLIError);
    });
  });

  describe('edge cases', () => {
    it('should handle missing audit_logs table', async () => {
      mockDb.execute.mockResolvedValue([]);

      await expect(command.parseAsync(['node', 'test', 'users', '123'])).resolves.not.toThrow();
    });

    it('should close database connection after execution', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'audit_logs' }]);

      await command.parseAsync(['node', 'test', 'users', '123']);
      expect(mockDb.destroy).toHaveBeenCalled();
    });

    it('should handle empty history', async () => {
      mockDb.execute.mockImplementation(() => {
        return Promise.resolve([{ table_name: 'audit_logs' }]);
      });

      await expect(command.parseAsync(['node', 'test', 'users', '999'])).resolves.not.toThrow();
    });

    it('should show values when --show-values is used', async () => {
      mockDb.execute.mockImplementation(() => {
        return Promise.resolve([
          { table_name: 'audit_logs' },
          {
            id: 1,
            table_name: 'users',
            action: 'INSERT',
            entity_id: '123',
            user_id: 'user1',
            created_at: new Date(),
            old_values: null,
            new_values: '{"name":"test"}',
          },
        ]);
      });

      await command.parseAsync(['node', 'test', 'users', '123', '--show-values']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should use custom config path when provided', async () => {
      mockDb.execute.mockResolvedValue([{ table_name: 'audit_logs' }]);

      await command.parseAsync(['node', 'test', 'users', '123', '--config', './custom-config.ts']);
      expect(loadConfig).toHaveBeenCalledWith('./custom-config.ts');
    });

    it('should handle history with UPDATE actions', async () => {
      mockDb.execute.mockImplementation(() => {
        return Promise.resolve([
          { table_name: 'audit_logs' },
          {
            id: 1,
            table_name: 'users',
            action: 'UPDATE',
            entity_id: '123',
            user_id: 'user1',
            created_at: new Date(),
            old_values: '{"name":"old"}',
            new_values: '{"name":"new"}',
          },
        ]);
      });

      await command.parseAsync(['node', 'test', 'users', '123', '--show-values']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should handle history with DELETE actions', async () => {
      mockDb.execute.mockImplementation(() => {
        return Promise.resolve([
          { table_name: 'audit_logs' },
          {
            id: 1,
            table_name: 'users',
            action: 'DELETE',
            entity_id: '123',
            user_id: 'user1',
            created_at: new Date(),
            old_values: '{"name":"deleted"}',
            new_values: null,
          },
        ]);
      });

      await command.parseAsync(['node', 'test', 'users', '123', '--show-values']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });
});
