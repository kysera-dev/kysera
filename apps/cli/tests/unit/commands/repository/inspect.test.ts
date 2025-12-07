import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock external dependencies before importing the module under test
vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
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
    blue: (s: string) => s,
  },
  table: vi.fn(() => ''),
  select: vi.fn().mockResolvedValue('src/UserRepository.ts'),
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
import { inspectRepositoryCommand } from '../../../../src/commands/repository/inspect.js';
import { getDatabaseConnection } from '../../../../src/utils/database.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';
import { select } from '@xec-sh/kit';

describe('repository inspect command', () => {
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
      distinct: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
      executeTakeFirst: vi.fn().mockResolvedValue({ count: 100 }),
      fn: { countAll: vi.fn().mockReturnValue({ as: vi.fn() }) },
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres' },
    });
    
    consoleSpy = {
      log: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = inspectRepositoryCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('inspect');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Inspect a repository class');
    });

    it('should have --file option', () => {
      const options = command.options;
      const fileOpt = options.find((o) => o.long === '--file');
      expect(fileOpt).toBeDefined();
    });

    it('should have --className option', () => {
      const options = command.options;
      const classNameOpt = options.find((o) => o.long === '--className');
      expect(classNameOpt).toBeDefined();
    });

    it('should have --show-ast option', () => {
      const options = command.options;
      const showAstOpt = options.find((o) => o.long === '--show-ast');
      expect(showAstOpt).toBeDefined();
    });

    it('should have --show-dependencies option', () => {
      const options = command.options;
      const showDepsOpt = options.find((o) => o.long === '--show-dependencies');
      expect(showDepsOpt).toBeDefined();
    });

    it('should have --show-complexity option', () => {
      const options = command.options;
      const showComplexityOpt = options.find((o) => o.long === '--show-complexity');
      expect(showComplexityOpt).toBeDefined();
    });

    it('should have --show-database option', () => {
      const options = command.options;
      const showDbOpt = options.find((o) => o.long === '--show-database');
      expect(showDbOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const options = command.options;
      const jsonOpt = options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should inspect repository by file path', async () => {
      (readFile as Mock).mockResolvedValue(`
        export class UserRepository {
          tableName = 'users';
          async findById(id: string) { return null; }
        }
      `);

      await command.parseAsync(['node', 'test', '--file', 'src/UserRepository.ts']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should output JSON when --json is used', async () => {
      (readFile as Mock).mockResolvedValue(`
        export class UserRepository {
          tableName = 'users';
        }
      `);

      await command.parseAsync(['node', 'test', '--file', 'src/UserRepository.ts', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show complexity metrics when --show-complexity is used', async () => {
      (readFile as Mock).mockResolvedValue(`
        export class UserRepository {
          async complexMethod(id: string) {
            if (id) {
              if (id.length > 0) {
                return true;
              }
            }
            return false;
          }
        }
      `);

      await command.parseAsync(['node', 'test', '--file', 'src/UserRepository.ts', '--show-complexity']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show dependencies when --show-dependencies is used', async () => {
      (readFile as Mock).mockResolvedValue(`
        import { Kysely } from 'kysely';
        import { z } from 'zod';
        export class UserRepository {}
      `);

      await command.parseAsync(['node', 'test', '--file', 'src/UserRepository.ts', '--show-dependencies']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show database info when --show-database is used', async () => {
      (readFile as Mock).mockResolvedValue(`
        export class UserRepository {
          tableName = 'users';
        }
      `);
      mockDb.execute.mockResolvedValue([{ table_name: 'users' }]);

      await command.parseAsync(['node', 'test', '--file', 'src/UserRepository.ts', '--show-database']);
      expect(mockDb.selectFrom).toHaveBeenCalled();
    });
  });

  describe('interactive mode', () => {
    it('should show file selection when no file specified', async () => {
      const mockFile = 'src/UserRepository.ts';
      (readdir as Mock).mockImplementation(async (dir, options) => {
        if (options?.withFileTypes) {
          return [{ name: 'UserRepository.ts', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      (readFile as Mock).mockResolvedValue('export class UserRepository {}');
      (select as Mock).mockResolvedValue(mockFile);

      await command.parseAsync(['node', 'test']);
      expect(select).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle file not found', async () => {
      (access as Mock).mockRejectedValue(new Error('ENOENT'));

      await command.parseAsync(['node', 'test', '--file', 'nonexistent.ts']);
      // Should not throw, just display error
    });

    it('should handle repository class not found in file', async () => {
      (readFile as Mock).mockResolvedValue('export class SomeOtherClass {}');

      await command.parseAsync(['node', 'test', '--file', 'src/SomeFile.ts']);
      // Should handle gracefully
    });

    it('should handle class name not found', async () => {
      (access as Mock).mockRejectedValue(new Error('ENOENT'));

      await command.parseAsync(['node', 'test', '--className', 'NonExistentRepository']);
      // Should handle gracefully
    });
  });

  describe('edge cases', () => {
    it('should parse entity interface', async () => {
      (readFile as Mock).mockResolvedValue(`
        interface UserEntity {
          id: string;
          name?: string;
          email: string;
        }
        export class UserRepository {}
      `);

      await command.parseAsync(['node', 'test', '--file', 'src/UserRepository.ts', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should parse Zod schema', async () => {
      (readFile as Mock).mockResolvedValue(`
        const userSchema = z.object({
          id: z.string().uuid(),
          name: z.string().min(1),
          email: z.string().email().optional(),
        });
        export class UserRepository {}
      `);

      await command.parseAsync(['node', 'test', '--file', 'src/UserRepository.ts', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should calculate cyclomatic complexity', async () => {
      (readFile as Mock).mockResolvedValue(`
        export class UserRepository {
          async findByCondition(cond: string) {
            if (cond === 'a') return 1;
            else if (cond === 'b') return 2;
            for (let i = 0; i < 10; i++) {
              while (true) break;
            }
            return cond === 'c' ? 3 : 0;
          }
        }
      `);

      await command.parseAsync(['node', 'test', '--file', 'src/UserRepository.ts', '--show-complexity']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should parse method parameters', async () => {
      (readFile as Mock).mockResolvedValue(`
        export class UserRepository {
          async create(data: CreateUserInput, options?: Options) {
            return null;
          }
        }
      `);

      await command.parseAsync(['node', 'test', '--file', 'src/UserRepository.ts', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should close database connection after showing database info', async () => {
      (readFile as Mock).mockResolvedValue(`
        export class UserRepository {
          tableName = 'users';
        }
      `);
      mockDb.execute.mockResolvedValue([{ table_name: 'users' }]);

      await command.parseAsync(['node', 'test', '--file', 'src/UserRepository.ts', '--show-database']);
      expect(mockDb.destroy).toHaveBeenCalled();
    });
  });
});
