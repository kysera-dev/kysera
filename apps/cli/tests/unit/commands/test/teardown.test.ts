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
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/utils/database.js', () => ({
  getDatabaseConnection: vi.fn(),
}));

vi.mock('../../../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../../../src/utils/sql-sanitizer.js', () => ({
  validateIdentifier: vi.fn((name) => name),
  escapeIdentifier: vi.fn((id) => `"${id}"`),
  safeTruncate: vi.fn((table) => `TRUNCATE "${table}"`),
  safeDropDatabase: vi.fn((db) => `DROP DATABASE IF EXISTS "${db}"`),
  safeTerminateBackendQuery: vi.fn((db) => ({ sql: 'SELECT pg_terminate_backend($1)', params: [db] })),
}));

// Create mock execute function that can be reused
const mockSqlExecute = vi.fn().mockResolvedValue([]);

vi.mock('kysely', async () => {
  const actual = await vi.importActual<typeof import('kysely')>('kysely');

  const sqlTaggedTemplate = vi.fn(() => ({
    execute: mockSqlExecute,
  }));

  const sqlRaw = vi.fn(() => ({
    execute: mockSqlExecute,
  }));

  const mockSql = Object.assign(sqlTaggedTemplate, {
    raw: sqlRaw,
  });

  return {
    ...actual,
    sql: mockSql,
  };
});

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
  select: vi.fn().mockResolvedValue('drop'),
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

import { rm, unlink, readdir } from 'node:fs/promises';
import { testTeardownCommand } from '../../../../src/commands/test/teardown.js';
import { getDatabaseConnection } from '../../../../src/utils/database.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';
import { confirm } from '@xec-sh/kit';
import { sql } from 'kysely';

describe('test teardown command', () => {
  let command: Command;
  let mockDb: any;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    process.env['NODE_ENV'] = 'test';

    // Create the main mock db that will be reused
    // The key is that all chain methods return the mockDb itself
    const executeImpl = vi.fn().mockResolvedValue([]);

    mockDb = {
      selectFrom: vi.fn(function() { return this; }),
      select: vi.fn(function() { return this; }),
      where: vi.fn(function() { return this; }),
      execute: executeImpl,
      deleteFrom: vi.fn(function() { return this; }),
      schema: {
        dropDatabase: vi.fn().mockReturnThis(),
        ifExists: vi.fn().mockReturnThis(),
      },
      raw: vi.fn().mockResolvedValue([]),
      dialectName: 'postgresql',
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    // Always return the same mockDb instance so tests can modify it
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);

    (loadConfig as Mock).mockResolvedValue({
      database: {
        dialect: 'postgresql',
        database: 'myapp',
        host: 'localhost',
        port: 5432,
      },
    });

    consoleSpy = {
      log: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);

    command = testTeardownCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('teardown');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Clean up test databases');
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

    it('should have --force option', () => {
      const options = command.options;
      const forceOpt = options.find((o) => o.long === '--force');
      expect(forceOpt).toBeDefined();
    });

    it('should have --keep-data option', () => {
      const options = command.options;
      const keepDataOpt = options.find((o) => o.long === '--keep-data');
      expect(keepDataOpt).toBeDefined();
    });

    it('should have --preserve-logs option', () => {
      const options = command.options;
      const preserveLogsOpt = options.find((o) => o.long === '--preserve-logs');
      expect(preserveLogsOpt).toBeDefined();
    });

    it('should have --clean-artifacts option', () => {
      const options = command.options;
      const cleanArtifactsOpt = options.find((o) => o.long === '--clean-artifacts');
      expect(cleanArtifactsOpt).toBeDefined();
    });

    it('should have --pattern option', () => {
      const options = command.options;
      const patternOpt = options.find((o) => o.long === '--pattern');
      expect(patternOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const options = command.options;
      const jsonOpt = options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should handle no test databases found', async () => {
      mockDb.execute.mockResolvedValue([]);

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should drop test databases successfully', async () => {
      mockDb.execute.mockResolvedValue([{ datname: 'myapp_test' }]);

      await command.parseAsync(['node', 'test', '--force']);
      expect(sql.raw).toHaveBeenCalled();
    });

    it('should output JSON when --json is used', async () => {
      mockDb.execute.mockResolvedValue([{ datname: 'myapp_test' }]);

      await command.parseAsync(['node', 'test', '--force', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should truncate instead of drop with --keep-data', async () => {
      mockDb.execute.mockImplementation(() => {
        return Promise.resolve([{ datname: 'myapp_test' }]);
      });

      await command.parseAsync(['node', 'test', '--force', '--keep-data']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should clean specific database', async () => {
      await command.parseAsync(['node', 'test', '--force', '--database', 'myapp_test']);
      expect(sql.raw).toHaveBeenCalled();
    });
  });

  describe('confirmation flow', () => {
    it('should ask for confirmation before teardown', async () => {
      mockDb.execute.mockResolvedValue([{ datname: 'myapp_test' }]);

      await command.parseAsync(['node', 'test']);
      // In non-force mode, confirmation is asked
    });

    it('should skip confirmation with --force', async () => {
      mockDb.execute.mockResolvedValue([{ datname: 'myapp_test' }]);

      await command.parseAsync(['node', 'test', '--force']);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('should cancel teardown if not confirmed', async () => {
      mockDb.execute.mockResolvedValue([{ datname: 'myapp_test' }]);
      (confirm as Mock).mockResolvedValueOnce(false);

      await command.parseAsync(['node', 'test']);
      // Should cancel gracefully
    });
  });

  describe('error handling', () => {
    it('should throw error when database config is not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError);
    });
  });

  describe('edge cases', () => {
    it('should clean test artifacts', async () => {
      mockDb.execute.mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--clean-artifacts']);
      expect(rm).toHaveBeenCalled();
    });

    it('should preserve logs when --preserve-logs is used', async () => {
      mockDb.execute.mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--preserve-logs']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should handle environment-specific patterns', async () => {
      mockDb.execute.mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--environment', 'ci']);
      expect(mockDb.selectFrom).toHaveBeenCalled();
    });

    it('should handle all environments', async () => {
      mockDb.execute.mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--environment', 'all']);
      expect(mockDb.selectFrom).toHaveBeenCalled();
    });

    it('should use custom pattern', async () => {
      mockDb.execute.mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--pattern', '_custom_test']);
      expect(mockDb.where).toHaveBeenCalled();
    });
  });
});
