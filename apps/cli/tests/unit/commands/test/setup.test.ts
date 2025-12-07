import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock external dependencies before importing the module under test
vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

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
  },
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

// Mock fs module for file operations
vi.mock('../../../../src/utils/fs.js', () => ({
  safePath: vi.fn((p) => p),
  isPathSafe: vi.fn(() => true),
}));

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { testSetupCommand } from '../../../../src/commands/test/setup.js';
import { getDatabaseConnection } from '../../../../src/utils/database.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('test setup command', () => {
  let command: Command;
  let mockDb: any;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    process.env['NODE_ENV'] = 'test';
    
    mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
      insertInto: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      schema: {
        createDatabase: vi.fn().mockReturnThis(),
        dropDatabase: vi.fn().mockReturnThis(),
        createSchema: vi.fn().mockReturnThis(),
        ifNotExists: vi.fn().mockReturnThis(),
        ifExists: vi.fn().mockReturnThis(),
      },
      raw: vi.fn().mockResolvedValue([]),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    (loadConfig as Mock).mockResolvedValue({
      database: { 
        dialect: 'postgres', 
        database: 'myapp',
        host: 'localhost',
        port: 5432,
      },
    });
    
    consoleSpy = {
      log: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = testSetupCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('setup');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Set up test database');
    });

    it('should have --environment option with default test', () => {
      const options = command.options;
      const envOpt = options.find((o) => o.long === '--environment');
      expect(envOpt).toBeDefined();
      expect(envOpt?.defaultValue).toBe('test');
    });

    it('should have --database option', () => {
      const options = command.options;
      const dbOpt = options.find((o) => o.long === '--database');
      expect(dbOpt).toBeDefined();
    });

    it('should have --clean option', () => {
      const options = command.options;
      const cleanOpt = options.find((o) => o.long === '--clean');
      expect(cleanOpt).toBeDefined();
    });

    it('should have --migrate option', () => {
      const options = command.options;
      const migrateOpt = options.find((o) => o.long === '--migrate');
      expect(migrateOpt).toBeDefined();
    });

    it('should have --seed option', () => {
      const options = command.options;
      const seedOpt = options.find((o) => o.long === '--seed');
      expect(seedOpt).toBeDefined();
    });

    it('should have --fixtures option', () => {
      const options = command.options;
      const fixturesOpt = options.find((o) => o.long === '--fixtures');
      expect(fixturesOpt).toBeDefined();
    });

    it('should have --parallel option', () => {
      const options = command.options;
      const parallelOpt = options.find((o) => o.long === '--parallel');
      expect(parallelOpt).toBeDefined();
    });

    it('should have --isolation option with default transaction', () => {
      const options = command.options;
      const isolationOpt = options.find((o) => o.long === '--isolation');
      expect(isolationOpt).toBeDefined();
      expect(isolationOpt?.defaultValue).toBe('transaction');
    });

    it('should have --json option', () => {
      const options = command.options;
      const jsonOpt = options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should set up test environment successfully', async () => {
      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should create test database if not exists', async () => {
      (getDatabaseConnection as Mock).mockImplementation((config) => {
        if (config.database === 'postgres') {
          return mockDb;
        }
        return mockDb;
      });

      await command.parseAsync(['node', 'test']);
      expect(writeFile).toHaveBeenCalled();
    });

    it('should output JSON when --json is used', async () => {
      await command.parseAsync(['node', 'test', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should run migrations when --migrate is used', async () => {
      // Mock migration directory to be empty so it doesn't try to load files
      (readdir as Mock).mockImplementation(async (dir: string) => {
        if (dir.includes('migrations')) {
          return [];
        }
        return [];
      });

      await command.parseAsync(['node', 'test', '--migrate']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should use custom database name', async () => {
      await command.parseAsync(['node', 'test', '--database', 'custom_test_db']);
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
  });

  describe('edge cases', () => {
    it('should close database connection after setup', async () => {
      await command.parseAsync(['node', 'test']);
      expect(mockDb.destroy).toHaveBeenCalled();
    });

    it('should create test helper files', async () => {
      await command.parseAsync(['node', 'test']);
      expect(writeFile).toHaveBeenCalled();
    });

    it('should generate CI-specific database name', async () => {
      process.env['CI_BUILD_ID'] = '12345';

      await command.parseAsync(['node', 'test', '--environment', 'ci']);
      expect(consoleSpy.log).toHaveBeenCalled();

      delete process.env['CI_BUILD_ID'];
    });

    it('should handle parallel execution setup', async () => {
      await command.parseAsync(['node', 'test', '--parallel']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should use schema isolation when specified', async () => {
      await command.parseAsync(['node', 'test', '--isolation', 'schema']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });
});
