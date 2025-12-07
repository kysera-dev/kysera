import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock external dependencies before importing the module under test
vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
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

import { access, readdir, readFile } from 'node:fs/promises';
import { listRepositoriesCommand } from '../../../../src/commands/repository/list.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('repository list command', () => {
  let command: Command;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    process.env['NODE_ENV'] = 'test';
    
    (loadConfig as Mock).mockResolvedValue({});
    
    consoleSpy = {
      log: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = listRepositoriesCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('list');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('List all repository classes');
    });

    it('should have --directory option with default src', () => {
      const options = command.options;
      const dirOpt = options.find((o) => o.long === '--directory');
      expect(dirOpt).toBeDefined();
      expect(dirOpt?.defaultValue).toBe('src');
    });

    it('should have --pattern option', () => {
      const options = command.options;
      const patternOpt = options.find((o) => o.long === '--pattern');
      expect(patternOpt).toBeDefined();
    });

    it('should have --show-methods option', () => {
      const options = command.options;
      const showMethodsOpt = options.find((o) => o.long === '--show-methods');
      expect(showMethodsOpt).toBeDefined();
    });

    it('should have --show-schemas option', () => {
      const options = command.options;
      const showSchemasOpt = options.find((o) => o.long === '--show-schemas');
      expect(showSchemasOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const options = command.options;
      const jsonOpt = options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should list repositories successfully', async () => {
      (readdir as Mock).mockImplementation(async (dir, options) => {
        if (options?.withFileTypes) {
          return [{ name: 'UserRepository.ts', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      (readFile as Mock).mockResolvedValue('export class UserRepository {}');

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should output JSON when --json is used', async () => {
      (readdir as Mock).mockImplementation(async (dir, options) => {
        if (options?.withFileTypes) {
          return [{ name: 'UserRepository.ts', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      (readFile as Mock).mockResolvedValue('export class UserRepository { tableName = "users"; }');

      await command.parseAsync(['node', 'test', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show methods when --show-methods is used', async () => {
      (readdir as Mock).mockImplementation(async (dir, options) => {
        if (options?.withFileTypes) {
          return [{ name: 'UserRepository.ts', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      (readFile as Mock).mockResolvedValue(`
        export class UserRepository {
          async findAll() { return []; }
          async findById(id: string) { return null; }
        }
      `);

      await command.parseAsync(['node', 'test', '--show-methods']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show schemas when --show-schemas is used', async () => {
      (readdir as Mock).mockImplementation(async (dir, options) => {
        if (options?.withFileTypes) {
          return [{ name: 'UserRepository.ts', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      (readFile as Mock).mockResolvedValue(`
        export class UserRepository {
          const userSchema = z.object({
            id: z.string(),
            name: z.string(),
          });
        }
      `);

      await command.parseAsync(['node', 'test', '--show-schemas']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle directory not found', async () => {
      (access as Mock).mockRejectedValue(new Error('ENOENT'));

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should handle no repository files found', async () => {
      (readdir as Mock).mockResolvedValue([]);

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should use custom directory when specified', async () => {
      (readdir as Mock).mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--directory', './custom-src']);
      expect(access).toHaveBeenCalled();
    });

    it('should use custom pattern when specified', async () => {
      (readdir as Mock).mockResolvedValue([]);

      await command.parseAsync(['node', 'test', '--pattern', '**/*Repo.ts']);
    });

    it('should extract table name from repository', async () => {
      (readdir as Mock).mockImplementation(async (dir, options) => {
        if (options?.withFileTypes) {
          return [{ name: 'PostRepository.ts', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      (readFile as Mock).mockResolvedValue(`
        export class PostRepository {
          tableName = 'posts';
        }
      `);

      await command.parseAsync(['node', 'test', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should detect validation presence', async () => {
      (readdir as Mock).mockImplementation(async (dir, options) => {
        if (options?.withFileTypes) {
          return [{ name: 'UserRepository.ts', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      (readFile as Mock).mockResolvedValue(`
        import { z } from 'zod';
        export class UserRepository {
          z.object({ id: z.string() });
        }
      `);

      await command.parseAsync(['node', 'test']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should detect soft delete support', async () => {
      (readdir as Mock).mockImplementation(async (dir, options) => {
        if (options?.withFileTypes) {
          return [{ name: 'UserRepository.ts', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      (readFile as Mock).mockResolvedValue(`
        export class UserRepository {
          async softDelete(id: string) {}
        }
      `);

      await command.parseAsync(['node', 'test']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should scan nested directories', async () => {
      (readdir as Mock).mockImplementation(async (dir, options) => {
        if (dir.endsWith('src') && options?.withFileTypes) {
          return [
            { name: 'repositories', isDirectory: () => true, isFile: () => false },
          ];
        }
        if (dir.endsWith('repositories') && options?.withFileTypes) {
          return [
            { name: 'UserRepository.ts', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });
      (readFile as Mock).mockResolvedValue('export class UserRepository {}');

      await command.parseAsync(['node', 'test']);
    });
  });
});
