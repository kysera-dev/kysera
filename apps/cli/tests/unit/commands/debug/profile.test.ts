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
  confirm: vi.fn().mockResolvedValue(true),
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

import { profileCommand } from '../../../../src/commands/debug/profile.js';
import { getDatabaseConnection } from '../../../../src/utils/database.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('debug profile command', () => {
  let command: Command;
  let mockDb: any;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    process.env['NODE_ENV'] = 'test';
    
    mockDb = {
      executeQuery: vi.fn().mockResolvedValue({ rows: [{ count: 1 }] }),
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
    
    command = profileCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('profile');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Query profiling');
    });

    it('should have --query option', () => {
      const options = command.options;
      const queryOpt = options.find((o) => o.long === '--query');
      expect(queryOpt).toBeDefined();
    });

    it('should have --table option', () => {
      const options = command.options;
      const tableOpt = options.find((o) => o.long === '--table');
      expect(tableOpt).toBeDefined();
    });

    it('should have --operation option', () => {
      const options = command.options;
      const operationOpt = options.find((o) => o.long === '--operation');
      expect(operationOpt).toBeDefined();
    });

    it('should have --iterations option with default 100', () => {
      const options = command.options;
      const iterationsOpt = options.find((o) => o.long === '--iterations');
      expect(iterationsOpt).toBeDefined();
      expect(iterationsOpt?.defaultValue).toBe('100');
    });

    it('should have --warmup option with default 10', () => {
      const options = command.options;
      const warmupOpt = options.find((o) => o.long === '--warmup');
      expect(warmupOpt).toBeDefined();
      expect(warmupOpt?.defaultValue).toBe('10');
    });

    it('should have --show-plan option', () => {
      const options = command.options;
      const showPlanOpt = options.find((o) => o.long === '--show-plan');
      expect(showPlanOpt).toBeDefined();
    });

    it('should have --compare option', () => {
      const options = command.options;
      const compareOpt = options.find((o) => o.long === '--compare');
      expect(compareOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const options = command.options;
      const jsonOpt = options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should profile a query successfully', async () => {
      await expect(command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--iterations', '5', '--warmup', '1']))
        .resolves.not.toThrow();
      expect(mockDb.executeQuery).toHaveBeenCalled();
    });

    it('should profile table operations', async () => {
      await command.parseAsync(['node', 'test', '--table', 'users', '--operation', 'select', '--iterations', '5', '--warmup', '1']);
      expect(mockDb.executeQuery).toHaveBeenCalled();
    });

    it('should output JSON when --json is used', async () => {
      await command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--json', '--iterations', '5', '--warmup', '1']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show execution plan when --show-plan is used', async () => {
      await command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--show-plan', '--iterations', '5', '--warmup', '1']);
      expect(mockDb.executeQuery).toHaveBeenCalled();
    });

    it('should compare two queries', async () => {
      await command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--compare', 'SELECT 2', '--iterations', '5', '--warmup', '1']);
      expect(mockDb.executeQuery).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error when no query is specified', async () => {
      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError);
    });

    it('should throw error when database config is not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test', '--query', 'SELECT 1'])).rejects.toThrow(CLIError);
    });

    it('should throw error when database connection fails', async () => {
      (getDatabaseConnection as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test', '--query', 'SELECT 1'])).rejects.toThrow(CLIError);
    });

    it('should throw error when query fails', async () => {
      mockDb.executeQuery.mockRejectedValue(new Error('Query failed'));

      await expect(command.parseAsync(['node', 'test', '--query', 'SELECT * FROM nonexistent', '--iterations', '1', '--warmup', '0']))
        .rejects.toThrow(CLIError);
    });

    it('should handle invalid iterations value', async () => {
      await expect(command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--iterations', 'abc']))
        .rejects.toThrow(CLIError);
    });

    it('should handle invalid warmup value', async () => {
      await expect(command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--warmup', 'abc']))
        .rejects.toThrow(CLIError);
    });
  });

  describe('edge cases', () => {
    it('should close database connection after execution', async () => {
      await command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--iterations', '5', '--warmup', '1']);
      expect(mockDb.destroy).toHaveBeenCalled();
    });

    it('should generate query for table with different operations', async () => {
      await command.parseAsync(['node', 'test', '--table', 'users', '--operation', 'insert', '--iterations', '5', '--warmup', '1']);
      expect(mockDb.executeQuery).toHaveBeenCalled();
    });

    it('should calculate performance metrics', async () => {
      await command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--iterations', '10', '--warmup', '2']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should display histogram of response times', async () => {
      await command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--iterations', '10', '--warmup', '2']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });
});
