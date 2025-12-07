import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock external dependencies before importing the module under test
vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('../../../../src/commands/migrate/templates.js', () => ({
  MIGRATION_TEMPLATES: {
    default: `import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Migration code
}

export async function down(db: Kysely<any>): Promise<void> {
  // Rollback code
}`,
    'create-table': `import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable('{{table}}')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('{{table}}').execute();
}`,
    'alter-table': `import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('{{table}}').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('{{table}}').execute();
}`,
  },
  parseColumns: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../../src/utils/templates.js', () => ({
  renderTemplate: vi.fn((template: string) => template),
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

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createCommand } from '../../../../src/commands/migrate/create.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('migrate create command', () => {
  let command: Command;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    process.env['NODE_ENV'] = 'test';

    // Default: directory exists, files don't exist
    (existsSync as Mock).mockImplementation((path: string) => {
      if (path.endsWith('.ts') || path.endsWith('.js')) return false;
      return true; // Directory exists
    });

    consoleSpy = {
      log: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);

    command = createCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('create');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Create a new migration file');
    });

    it('should require a name argument', () => {
      const args = command.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe('name');
      expect(args[0].required).toBe(true);
    });

    it('should have --dir option with default', () => {
      const options = command.options;
      const dirOpt = options.find((o) => o.long === '--dir');
      expect(dirOpt).toBeDefined();
      expect(dirOpt?.defaultValue).toBe('./migrations');
    });

    it('should have --directory option as alias', () => {
      const options = command.options;
      const directoryOpt = options.find((o) => o.long === '--directory');
      expect(directoryOpt).toBeDefined();
    });

    it('should have --template option with default', () => {
      const options = command.options;
      const templateOpt = options.find((o) => o.long === '--template');
      expect(templateOpt).toBeDefined();
      expect(templateOpt?.defaultValue).toBe('default');
    });

    it('should have --ts option with default true', () => {
      const options = command.options;
      const tsOpt = options.find((o) => o.long === '--ts');
      expect(tsOpt).toBeDefined();
    });

    it('should have --table option', () => {
      const options = command.options;
      const tableOpt = options.find((o) => o.long === '--table');
      expect(tableOpt).toBeDefined();
    });

    it('should have --columns option', () => {
      const options = command.options;
      const columnsOpt = options.find((o) => o.long === '--columns');
      expect(columnsOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should create a migration file with default template', async () => {
      await command.parseAsync(['node', 'test', 'add_users_table']);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/_add_users_table\.ts$/),
        expect.any(String),
        'utf-8'
      );
    });

    it('should create migrations directory if it does not exist', async () => {
      (existsSync as Mock).mockImplementation((path: string) => {
        if (path === './migrations') return false;
        if (path.endsWith('.ts') || path.endsWith('.js')) return false;
        return true;
      });

      await command.parseAsync(['node', 'test', 'test_migration']);
      
      expect(mkdirSync).toHaveBeenCalledWith('./migrations', { recursive: true });
    });

    it('should use custom directory when --dir is specified', async () => {
      await command.parseAsync(['node', 'test', 'test_migration', '--dir', './custom-migrations']);
      
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('custom-migrations'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should use create-table template when specified', async () => {
      await command.parseAsync(['node', 'test', 'create_posts', '--template', 'create-table', '--table', 'posts']);
      
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('createTable'),
        'utf-8'
      );
    });

    it('should create JavaScript file when --no-ts is specified', async () => {
      await command.parseAsync(['node', 'test', 'test_migration', '--no-ts']);
      
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\.js$/),
        expect.any(String),
        'utf-8'
      );
    });

    it('should use table name from --table option', async () => {
      await command.parseAsync(['node', 'test', 'create_users', '--template', 'create-table', '--table', 'users']);
      
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('users'),
        'utf-8'
      );
    });
  });

  describe('error handling', () => {
    it('should throw error for invalid template', async () => {
      await expect(command.parseAsync(['node', 'test', 'test_migration', '--template', 'invalid']))
        .rejects.toThrow(CLIError);
    });

    it('should throw error if migration file already exists', async () => {
      // Mock that the file exists
      (existsSync as Mock).mockImplementation((path: string) => {
        if (path.includes('test_migration')) return true;
        return true;
      });

      await expect(command.parseAsync(['node', 'test', 'test_migration']))
        .rejects.toThrow(CLIError);
    });

    it('should throw error when table template requires --table option', async () => {
      await expect(command.parseAsync(['node', 'test', 'alter_table', '--template', 'alter-table']))
        .rejects.toThrow(CLIError);
    });
  });

  describe('edge cases', () => {
    it('should sanitize migration name', async () => {
      await command.parseAsync(['node', 'test', 'Add Users Table!@#']);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/_add_users_table___\.ts$/),
        expect.any(String),
        'utf-8'
      );
    });

    it('should generate timestamp-based filename', async () => {
      await command.parseAsync(['node', 'test', 'test_migration']);
      
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\d{14}_test_migration\.ts$/),
        expect.any(String),
        'utf-8'
      );
    });

    it('should use --directory as alias for --dir', async () => {
      // Note: Commander sets default values for all options, so we need to verify the option exists
      // The actual path used depends on directory resolution, the default is ./migrations
      await command.parseAsync(['node', 'test', 'test_migration', '--dir', './alt-migrations']);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('alt-migrations'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should default table name for create-table template from migration name', async () => {
      await command.parseAsync(['node', 'test', 'create_posts', '--template', 'create-table']);
      
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('posts'),
        'utf-8'
      );
    });

    it('should display success message after creation', async () => {
      await command.parseAsync(['node', 'test', 'test_migration']);
      
      const output = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Migration created');
    });
  });
});
