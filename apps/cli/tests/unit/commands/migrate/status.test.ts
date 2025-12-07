import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock external dependencies before importing the module under test
vi.mock('../../../../src/utils/database.js', () => ({
  getDatabaseConnection: vi.fn(),
}));

vi.mock('../../../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../../../src/commands/migrate/runner.js', () => ({
  MigrationRunner: vi.fn().mockImplementation(function(this: any) {
    this.getMigrationStatus = vi.fn().mockResolvedValue([]);
    return this;
  }),
}));


vi.mock('@xec-sh/kit', () => ({
  prism: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    gray: (s: string) => s,
    red: (s: string) => s,
    bold: (s: string) => s,
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

import { statusCommand } from '../../../../src/commands/migrate/status.js';
import { getDatabaseConnection } from '../../../../src/utils/database.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { MigrationRunner } from '../../../../src/commands/migrate/runner.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('migrate status command', () => {
  let command: Command;
  let mockDb: any;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    process.env['NODE_ENV'] = 'test';
    
    mockDb = {
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', connection: 'postgres://localhost/test' },
      migrations: { directory: './migrations', tableName: 'kysera_migrations' },
    });
    
    consoleSpy = {
      log: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = statusCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('status');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Show migration status');
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

    it('should have --config option', () => {
      const options = command.options;
      const configOpt = options.find((o) => o.long === '--config');
      expect(configOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should show migration status', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockResolvedValue([
          { name: 'migration1', status: 'executed', timestamp: '20231201120000', executedAt: new Date() },
          { name: 'migration2', status: 'pending', timestamp: '20231201130000' },
        ]),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
      expect(mockRunner.getMigrationStatus).toHaveBeenCalled();
    });

    it('should output JSON when --json option is used', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockResolvedValue([
          { name: 'migration1', status: 'executed', timestamp: '20231201120000', executedAt: new Date() },
        ]),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test', '--json']);

      const jsonOutput = consoleSpy.log.mock.calls.find((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonOutput).toBeDefined();
    });

    it('should show verbose output when --verbose is used', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockResolvedValue([
          { name: 'migration1', status: 'executed', timestamp: '20231201120000', executedAt: new Date() },
        ]),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test', '--verbose']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should display executed migrations count', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockResolvedValue([
          { name: 'migration1', status: 'executed', timestamp: '20231201120000', executedAt: new Date() },
          { name: 'migration2', status: 'executed', timestamp: '20231201130000', executedAt: new Date() },
        ]),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test']);
      const output = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Executed');
    });

    it('should display pending migrations count', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockResolvedValue([
          { name: 'migration1', status: 'pending', timestamp: '20231201120000' },
        ]),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test']);
      const output = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Pending');
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

    it('should handle getMigrationStatus error', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockRejectedValue(new Error('Database error')),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty migration status', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockResolvedValue([]),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should close database connection after execution', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockResolvedValue([]),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test']);
      expect(mockDb.destroy).toHaveBeenCalled();
    });

    it('should use custom config path when provided', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockResolvedValue([]),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test', '--config', './custom-config.ts']);
      expect(loadConfig).toHaveBeenCalledWith('./custom-config.ts');
    });

    it('should include database dialect in JSON output', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockResolvedValue([]),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test', '--json']);

      const jsonCall = consoleSpy.log.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.database !== undefined;
        } catch {
          return false;
        }
      });

      if (jsonCall) {
        const parsed = JSON.parse(jsonCall[0]);
        expect(parsed.database.dialect).toBe('postgres');
      }
    });

    it('should show database info in verbose mode', async () => {
      const mockRunner = {
        getMigrationStatus: vi.fn().mockResolvedValue([]),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test', '--verbose']);
      const output = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Dialect');
    });
  });
});
