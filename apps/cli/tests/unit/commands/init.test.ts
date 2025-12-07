import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock external dependencies before importing the module under test
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('@xec-sh/kit', () => ({
  prism: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    gray: (s: string) => s,
    blue: (s: string) => s,
    red: (s: string) => s,
    bold: (s: string) => s,
  },
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  multiselect: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
  })),
  box: vi.fn((opts: any) => opts.body || ''),
  group: vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execa } from 'execa';
import { initCommand } from '../../../src/commands/init/index.js';
import { CLIError } from '../../../src/utils/errors.js';

describe('init command', () => {
  let command: Command;
  let consoleSpy: { log: Mock; error: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set up environment to be non-interactive
    process.env['NODE_ENV'] = 'test';
    
    // Default mocks
    (existsSync as Mock).mockReturnValue(false);
    (readdirSync as Mock).mockReturnValue([]);
    (execa as Mock).mockResolvedValue({ stdout: '', stderr: '' });
    
    // Capture console output
    consoleSpy = {
      log: vi.fn(),
      error: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    vi.spyOn(console, 'error').mockImplementation(consoleSpy.error);
    
    command = initCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('init');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Initialize');
    });

    it('should accept a project name argument', () => {
      const args = command.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe('project-name');
      expect(args[0].required).toBe(false);
    });

    it('should have template option with default', () => {
      const options = command.options;
      const templateOpt = options.find((o) => o.long === '--template');
      expect(templateOpt).toBeDefined();
      expect(templateOpt?.defaultValue).toBe('basic');
    });

    it('should have database option with default', () => {
      const options = command.options;
      const dbOpt = options.find((o) => o.long === '--database');
      expect(dbOpt).toBeDefined();
      expect(dbOpt?.defaultValue).toBe('postgres');
    });

    it('should have plugins option with default', () => {
      const options = command.options;
      const pluginsOpt = options.find((o) => o.long === '--plugins');
      expect(pluginsOpt).toBeDefined();
      expect(pluginsOpt?.defaultValue).toBe('timestamps,soft-delete');
    });

    it('should have git option with default true', () => {
      const options = command.options;
      const gitOpt = options.find((o) => o.long === '--git');
      expect(gitOpt).toBeDefined();
    });

    it('should have install option with default true', () => {
      const options = command.options;
      const installOpt = options.find((o) => o.long === '--install');
      expect(installOpt).toBeDefined();
    });
  });

  describe('project generation', () => {
    it('should create project directory for new project', async () => {
      await command.parseAsync(['node', 'test', 'my-app', '--no-git', '--no-install']);

      expect(mkdirSync).toHaveBeenCalled();
    });

    it('should create project files', async () => {
      await command.parseAsync(['node', 'test', 'my-project', '--no-git', '--no-install']);

      // Should write package.json
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('package.json'),
        expect.any(String),
        'utf-8'
      );

      // Should write tsconfig.json
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('tsconfig.json'),
        expect.any(String),
        'utf-8'
      );

      // Should write kysera.config.ts
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('kysera.config.ts'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should create source files for basic template', async () => {
      await command.parseAsync(['node', 'test', 'basic-project', '-t', 'basic', '--no-git', '--no-install']);

      // Should write database.ts
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('database.ts'),
        expect.any(String),
        'utf-8'
      );

      // Should write index.ts
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('index.ts'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should create additional directories for api template', async () => {
      await command.parseAsync(['node', 'test', 'api-project', '-t', 'api', '--no-git', '--no-install']);

      // Check that mkdirSync was called with appropriate paths
      const mkdirCalls = (mkdirSync as Mock).mock.calls.map((c) => c[0]);
      
      // Should create src/controllers, src/routes, etc.
      expect(mkdirCalls.some((p: string) => p.includes('controllers') || p.includes('routes'))).toBe(true);
    });

    it('should create graphql directories for graphql template', async () => {
      await command.parseAsync(['node', 'test', 'graphql-project', '-t', 'graphql', '--no-git', '--no-install']);

      const mkdirCalls = (mkdirSync as Mock).mock.calls.map((c) => c[0]);
      
      // Should create src/resolvers, src/schema
      expect(mkdirCalls.some((p: string) => p.includes('resolvers') || p.includes('schema'))).toBe(true);
    });

    it('should create monorepo structure for monorepo template', async () => {
      await command.parseAsync(['node', 'test', 'mono-project', '-t', 'monorepo', '--no-git', '--no-install']);

      const mkdirCalls = (mkdirSync as Mock).mock.calls.map((c) => c[0]);
      
      // Should create apps and packages directories
      expect(mkdirCalls.some((p: string) => p.includes('apps') || p.includes('packages'))).toBe(true);
    });
  });

  describe('database configuration', () => {
    it('should configure postgres database by default', async () => {
      await command.parseAsync(['node', 'test', 'pg-project', '--no-git', '--no-install']);

      const writeFileCalls = (writeFileSync as Mock).mock.calls;
      const kyseraConfigCall = writeFileCalls.find((c) => c[0].includes('kysera.config.ts'));
      
      expect(kyseraConfigCall).toBeDefined();
      expect(kyseraConfigCall[1]).toContain("dialect: 'postgres'");
    });

    it('should configure mysql database when specified', async () => {
      await command.parseAsync(['node', 'test', 'mysql-project', '-d', 'mysql', '--no-git', '--no-install']);

      const writeFileCalls = (writeFileSync as Mock).mock.calls;
      const kyseraConfigCall = writeFileCalls.find((c) => c[0].includes('kysera.config.ts'));
      
      expect(kyseraConfigCall).toBeDefined();
      expect(kyseraConfigCall[1]).toContain("dialect: 'mysql'");
    });

    it('should configure sqlite database when specified', async () => {
      await command.parseAsync(['node', 'test', 'sqlite-project', '-d', 'sqlite', '--no-git', '--no-install']);

      const writeFileCalls = (writeFileSync as Mock).mock.calls;
      const kyseraConfigCall = writeFileCalls.find((c) => c[0].includes('kysera.config.ts'));
      
      expect(kyseraConfigCall).toBeDefined();
      expect(kyseraConfigCall[1]).toContain("dialect: 'sqlite'");
    });

    it('should create SECURITY.md for postgres database', async () => {
      await command.parseAsync(['node', 'test', 'secure-project', '-d', 'postgres', '--no-git', '--no-install']);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY.md'),
        expect.stringContaining('SECURITY WARNING'),
        'utf-8'
      );
    });

    it('should create SECURITY.md for mysql database', async () => {
      await command.parseAsync(['node', 'test', 'mysql-secure', '-d', 'mysql', '--no-git', '--no-install']);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY.md'),
        expect.stringContaining('SECURITY WARNING'),
        'utf-8'
      );
    });

    it('should not create SECURITY.md for sqlite database', async () => {
      await command.parseAsync(['node', 'test', 'sqlite-nosec', '-d', 'sqlite', '--no-git', '--no-install']);

      const writeFileCalls = (writeFileSync as Mock).mock.calls;
      const securityCall = writeFileCalls.find((c) => c[0].includes('SECURITY.md'));
      
      expect(securityCall).toBeUndefined();
    });
  });

  describe('plugin configuration', () => {
    it('should enable timestamps and soft-delete plugins by default', async () => {
      await command.parseAsync(['node', 'test', 'plugin-project', '--no-git', '--no-install']);

      const writeFileCalls = (writeFileSync as Mock).mock.calls;
      const kyseraConfigCall = writeFileCalls.find((c) => c[0].includes('kysera.config.ts'));
      
      expect(kyseraConfigCall[1]).toContain("'timestamps': { enabled: true }");
      expect(kyseraConfigCall[1]).toContain("'soft-delete': { enabled: true }");
    });

    it('should configure specified plugins only', async () => {
      await command.parseAsync(['node', 'test', 'audit-project', '-p', 'audit', '--no-git', '--no-install']);

      const writeFileCalls = (writeFileSync as Mock).mock.calls;
      const kyseraConfigCall = writeFileCalls.find((c) => c[0].includes('kysera.config.ts'));
      
      expect(kyseraConfigCall[1]).toContain("'audit': { enabled: true }");
    });
  });

  describe('directory conflict handling', () => {
    it('should throw error if directory exists and is not empty', async () => {
      (existsSync as Mock).mockReturnValue(true);
      (readdirSync as Mock).mockReturnValue(['existing-file.txt']);

      await expect(command.parseAsync(['node', 'test', 'existing-project', '--no-git', '--no-install']))
        .rejects.toThrow();
    });

    it('should succeed if directory exists but is empty', async () => {
      (existsSync as Mock).mockImplementation((path: string) => {
        // Return true for project dir check but false for file checks
        if (path.includes('empty-project') && !path.includes('.')) {
          return true;
        }
        return false;
      });
      (readdirSync as Mock).mockReturnValue([]);

      await expect(command.parseAsync(['node', 'test', 'empty-project', '--no-git', '--no-install']))
        .resolves.not.toThrow();
    });

    it('should allow using current directory with "."', async () => {
      (existsSync as Mock).mockReturnValue(false);

      await expect(command.parseAsync(['node', 'test', '.', '--no-git', '--no-install']))
        .resolves.not.toThrow();
    });
  });

  describe('git initialization', () => {
    it('should initialize git repository when --git is true', async () => {
      await command.parseAsync(['node', 'test', 'git-project', '--git', '--no-install']);

      expect(execa).toHaveBeenCalledWith('git', ['init'], expect.any(Object));
      expect(execa).toHaveBeenCalledWith('git', ['add', '.'], expect.any(Object));
      expect(execa).toHaveBeenCalledWith('git', ['commit', '-m', 'Initial commit'], expect.any(Object));
    });

    it('should skip git when --no-git is specified', async () => {
      await command.parseAsync(['node', 'test', 'no-git-project', '--no-git', '--no-install']);

      expect(execa).not.toHaveBeenCalledWith('git', ['init'], expect.any(Object));
    });

    it('should handle git init failure gracefully', async () => {
      (execa as Mock).mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git') {
          return Promise.reject(new Error('Git not found'));
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      // Should not throw, just warn
      await expect(command.parseAsync(['node', 'test', 'git-fail-project', '--git', '--no-install']))
        .resolves.not.toThrow();
    });
  });

  describe('dependency installation', () => {
    it('should install dependencies when --install is true', async () => {
      await command.parseAsync(['node', 'test', 'install-project', '--no-git', '--install']);

      expect(execa).toHaveBeenCalledWith(
        expect.any(String),
        ['install'],
        expect.any(Object)
      );
    });

    it('should skip installation when --no-install is specified', async () => {
      await command.parseAsync(['node', 'test', 'no-install-project', '--no-git', '--no-install']);

      const execCalls = (execa as Mock).mock.calls;
      const installCall = execCalls.find((c) => c[1]?.includes('install'));

      expect(installCall).toBeUndefined();
    });

    it('should use pnpm as default package manager', async () => {
      await command.parseAsync(['node', 'test', 'pnpm-project', '--no-git', '--install']);

      expect(execa).toHaveBeenCalledWith('pnpm', ['install'], expect.any(Object));
    });

    it('should use specified package manager', async () => {
      await command.parseAsync(['node', 'test', 'npm-project', '--package-manager', 'npm', '--no-git', '--install']);

      expect(execa).toHaveBeenCalledWith('npm', ['install'], expect.any(Object));
    });
  });

  describe('non-interactive mode', () => {
    it('should require project name in non-interactive mode', async () => {
      // In test environment (NODE_ENV=test), it should be non-interactive
      await expect(command.parseAsync(['node', 'test']))
        .rejects.toThrow();
    });

    it('should accept all options via command line in non-interactive mode', async () => {
      await expect(command.parseAsync([
        'node', 'test', 'full-options-project',
        '-t', 'api',
        '-d', 'mysql',
        '-p', 'timestamps,audit',
        '--package-manager', 'yarn',
        '--no-git',
        '--no-install'
      ])).resolves.not.toThrow();

      // Verify api template directories were created
      const mkdirCalls = (mkdirSync as Mock).mock.calls;
      expect(mkdirCalls.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should throw CLIError for invalid template', async () => {
      await expect(command.parseAsync(['node', 'test', 'invalid-template', '-t', 'invalid', '--no-git', '--no-install']))
        .rejects.toThrow();
    });

    it('should throw CLIError for invalid database', async () => {
      await expect(command.parseAsync(['node', 'test', 'invalid-db', '-d', 'invalid', '--no-git', '--no-install']))
        .rejects.toThrow();
    });

    it('should throw CLIError for invalid plugin', async () => {
      await expect(command.parseAsync(['node', 'test', 'invalid-plugin', '-p', 'invalid-plugin', '--no-git', '--no-install']))
        .rejects.toThrow();
    });
  });

  describe('output messages', () => {
    it('should display project creation success message', async () => {
      await command.parseAsync(['node', 'test', 'success-project', '--no-git', '--no-install']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('success');
    });

    it('should display next steps after creation', async () => {
      await command.parseAsync(['node', 'test', 'steps-project', '--no-git', '--no-install']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Next steps');
    });
  });
});
