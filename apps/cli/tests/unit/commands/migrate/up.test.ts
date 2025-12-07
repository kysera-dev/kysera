import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock external dependencies before importing the module under test
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('../../../../src/utils/database.js', () => ({
  getDatabaseConnection: vi.fn(),
}));

vi.mock('../../../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../../../src/commands/migrate/runner.js', () => ({
  MigrationRunner: vi.fn().mockImplementation(function(this: any) {
    this.acquireLock = vi.fn().mockResolvedValue(() => Promise.resolve());
    this.getMigrationStatus = vi.fn().mockResolvedValue([]);
    this.up = vi.fn().mockResolvedValue({ executed: [], duration: 0 });
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

import { existsSync } from 'node:fs';
import { upCommand } from '../../../../src/commands/migrate/up.js';
import { getDatabaseConnection } from '../../../../src/utils/database.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { MigrationRunner } from '../../../../src/commands/migrate/runner.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('migrate up command', () => {
  let command: Command;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    process.env['NODE_ENV'] = 'test';
    
    mockDb = {
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    
    (existsSync as Mock).mockReturnValue(true);
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', connection: 'postgres://localhost/test' },
      migrations: { directory: './migrations', tableName: 'kysera_migrations' },
    });
    
    command = upCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('up');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Run pending migrations');
    });

    it('should have --to option', () => {
      const options = command.options;
      const toOpt = options.find((o) => o.long === '--to');
      expect(toOpt).toBeDefined();
    });

    it('should have --steps option', () => {
      const options = command.options;
      const stepsOpt = options.find((o) => o.long === '--steps');
      expect(stepsOpt).toBeDefined();
    });

    it('should have --count option as alias', () => {
      const options = command.options;
      const countOpt = options.find((o) => o.long === '--count');
      expect(countOpt).toBeDefined();
    });

    it('should have --dry-run option', () => {
      const options = command.options;
      const dryRunOpt = options.find((o) => o.long === '--dry-run');
      expect(dryRunOpt).toBeDefined();
    });

    it('should have --force option', () => {
      const options = command.options;
      const forceOpt = options.find((o) => o.long === '--force');
      expect(forceOpt).toBeDefined();
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
    it('should run migrations successfully', async () => {
      const mockRunner = {
        acquireLock: vi.fn().mockResolvedValue(() => Promise.resolve()),
        getMigrationStatus: vi.fn().mockResolvedValue([{ status: 'pending', name: 'test_migration' }]),
        up: vi.fn().mockResolvedValue({ executed: ['test_migration'], duration: 100 }),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
      expect(mockRunner.up).toHaveBeenCalled();
    });

    it('should handle dry-run mode', async () => {
      const mockRunner = {
        acquireLock: vi.fn().mockResolvedValue(() => Promise.resolve()),
        getMigrationStatus: vi.fn().mockResolvedValue([{ status: 'pending', name: 'test_migration' }]),
        up: vi.fn().mockResolvedValue({ executed: ['test_migration'], duration: 100 }),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test', '--dry-run']);
      expect(mockRunner.up).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    });

    it('should run specific number of migrations with --steps', async () => {
      const mockRunner = {
        acquireLock: vi.fn().mockResolvedValue(() => Promise.resolve()),
        getMigrationStatus: vi.fn().mockResolvedValue([
          { status: 'pending', name: 'migration1' },
          { status: 'pending', name: 'migration2' },
        ]),
        up: vi.fn().mockResolvedValue({ executed: ['migration1'], duration: 50 }),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test', '--steps', '1']);
      expect(mockRunner.up).toHaveBeenCalledWith(expect.objectContaining({ steps: 1 }));
    });

    it('should run migrations up to specific migration with --to', async () => {
      const mockRunner = {
        acquireLock: vi.fn().mockResolvedValue(() => Promise.resolve()),
        getMigrationStatus: vi.fn().mockResolvedValue([{ status: 'pending', name: 'target_migration' }]),
        up: vi.fn().mockResolvedValue({ executed: ['target_migration'], duration: 50 }),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test', '--to', 'target_migration']);
      expect(mockRunner.up).toHaveBeenCalledWith(expect.objectContaining({ to: 'target_migration' }));
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

    it('should throw error when migrations directory does not exist', async () => {
      (existsSync as Mock).mockReturnValue(false);

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError);
    });

    it('should handle migration lock error', async () => {
      const lockError = new Error('Lock error');
      (lockError as any).code = 'MIGRATION_LOCKED';

      const mockRunner = {
        acquireLock: vi.fn().mockRejectedValue(lockError),
        getMigrationStatus: vi.fn().mockResolvedValue([{ status: 'pending', name: 'test' }]),
        up: vi.fn().mockResolvedValue({ executed: [], duration: 0 }),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError);
    });
  });

  describe('edge cases', () => {
    it('should handle no pending migrations', async () => {
      const mockRunner = {
        acquireLock: vi.fn().mockResolvedValue(() => Promise.resolve()),
        getMigrationStatus: vi.fn().mockResolvedValue([{ status: 'executed', name: 'done' }]),
        up: vi.fn().mockResolvedValue({ executed: [], duration: 0 }),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should use --count as alias for --steps', async () => {
      const mockRunner = {
        acquireLock: vi.fn().mockResolvedValue(() => Promise.resolve()),
        getMigrationStatus: vi.fn().mockResolvedValue([{ status: 'pending', name: 'test' }]),
        up: vi.fn().mockResolvedValue({ executed: ['test'], duration: 50 }),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test', '--count', '2']);
      expect(mockRunner.up).toHaveBeenCalledWith(expect.objectContaining({ steps: 2 }));
    });

    it('should close database connection after execution', async () => {
      const mockRunner = {
        acquireLock: vi.fn().mockResolvedValue(() => Promise.resolve()),
        getMigrationStatus: vi.fn().mockResolvedValue([]),
        up: vi.fn().mockResolvedValue({ executed: [], duration: 0 }),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test']);
      expect(mockDb.destroy).toHaveBeenCalled();
    });

    it('should release lock after execution', async () => {
      const releaseLock = vi.fn().mockResolvedValue(undefined);
      const mockRunner = {
        acquireLock: vi.fn().mockResolvedValue(releaseLock),
        getMigrationStatus: vi.fn().mockResolvedValue([{ status: 'pending', name: 'test' }]),
        up: vi.fn().mockResolvedValue({ executed: ['test'], duration: 50 }),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test']);
      expect(releaseLock).toHaveBeenCalled();
    });

    it('should handle force option', async () => {
      const mockRunner = {
        acquireLock: vi.fn().mockResolvedValue(() => Promise.resolve()),
        getMigrationStatus: vi.fn().mockResolvedValue([]),
        up: vi.fn().mockResolvedValue({ executed: [], duration: 0 }),
      };
      (MigrationRunner as unknown as Mock).mockImplementation(function(this: any) {
        Object.assign(this, mockRunner);
        return this;
      });

      await command.parseAsync(['node', 'test', '--force']);
      expect(mockRunner.up).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    });
  });
});
