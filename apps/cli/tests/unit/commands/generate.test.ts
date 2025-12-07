import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
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
  spinner: vi.fn(() => ({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    text: '',
  })),
  confirm: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../../src/utils/database.js', () => ({
  getDatabaseConnection: vi.fn(),
}));

// Mock DatabaseIntrospector as a class constructor
vi.mock('../../../src/commands/generate/introspector.js', () => {
  const mockConstructor: any = vi.fn().mockImplementation(function(this: any) {
    this.getTables = vi.fn();
    this.getTableInfo = vi.fn();
    this.introspect = vi.fn();
    return this;
  });

  // Add static methods
  mockConstructor.mapDataTypeToTypeScript = vi.fn((dataType: string, isNullable: boolean) => {
    const typeMap: Record<string, string> = {
      integer: 'number',
      varchar: 'string',
      text: 'string',
      timestamp: 'Date',
      boolean: 'boolean',
    };
    const type = typeMap[dataType] || 'unknown';
    return isNullable ? `${type} | null` : type;
  });

  mockConstructor.mapDataTypeToZod = vi.fn((dataType: string, isNullable: boolean) => {
    const zodMap: Record<string, string> = {
      integer: 'z.number()',
      varchar: 'z.string()',
      text: 'z.string()',
      timestamp: 'z.date()',
      boolean: 'z.boolean()',
    };
    const zodType = zodMap[dataType] || 'z.unknown()';
    return isNullable ? `${zodType}.nullable()` : zodType;
  });

  return {
    DatabaseIntrospector: mockConstructor,
  };
});

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../../../src/config/loader.js';
import { getDatabaseConnection } from '../../../src/utils/database.js';
import { DatabaseIntrospector } from '../../../src/commands/generate/introspector.js';
import { generateCommand } from '../../../src/commands/generate/index.js';
import { modelCommand } from '../../../src/commands/generate/model.js';
import { repositoryCommand } from '../../../src/commands/generate/repository.js';
import { schemaCommand } from '../../../src/commands/generate/schema.js';
import { crudCommand } from '../../../src/commands/generate/crud.js';

// Mock table info for testing
const mockTableInfo = {
  name: 'users',
  columns: [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: 'autoincrement' },
    { name: 'email', dataType: 'varchar', isNullable: false, isPrimaryKey: false, isForeignKey: false, maxLength: 255 },
    { name: 'name', dataType: 'varchar', isNullable: true, isPrimaryKey: false, isForeignKey: false, maxLength: 255 },
    { name: 'created_at', dataType: 'timestamp', isNullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: 'CURRENT_TIMESTAMP' },
  ],
  indexes: [
    { name: 'users_pkey', columns: ['id'], isUnique: true, isPrimary: true },
    { name: 'users_email_idx', columns: ['email'], isUnique: true, isPrimary: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
};

const mockPostsTable = {
  name: 'posts',
  columns: [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: 'autoincrement' },
    { name: 'user_id', dataType: 'integer', isNullable: false, isPrimaryKey: false, isForeignKey: true, referencedTable: 'users', referencedColumn: 'id' },
    { name: 'title', dataType: 'varchar', isNullable: false, isPrimaryKey: false, isForeignKey: false, maxLength: 255 },
    { name: 'content', dataType: 'text', isNullable: true, isPrimaryKey: false, isForeignKey: false },
  ],
  indexes: [],
  primaryKey: ['id'],
  foreignKeys: [{ column: 'user_id', referencedTable: 'users', referencedColumn: 'id' }],
};

// Mock database connection
const mockDb = {
  destroy: vi.fn(),
};

describe('generate command', () => {
  let command: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    command = generateCommand();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('generate');
    });

    it('should have alias "g"', () => {
      expect(command.alias()).toBe('g');
    });

    it('should have subcommands', () => {
      const subcommands = command.commands.map((c) => c.name());
      expect(subcommands).toContain('model');
      expect(subcommands).toContain('repository');
      expect(subcommands).toContain('schema');
      expect(subcommands).toContain('crud');
    });
  });
});

describe('generate model command', () => {
  let command: Command;
  let mockIntrospector: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock introspector instance
    mockIntrospector = {
      getTables: vi.fn().mockResolvedValue(['users', 'posts']),
      getTableInfo: vi.fn().mockResolvedValue(mockTableInfo),
      introspect: vi.fn().mockResolvedValue([mockTableInfo, mockPostsTable]),
    };

    // Make DatabaseIntrospector constructor return the mock instance
    (DatabaseIntrospector as Mock).mockImplementation(function(this: any) {
      Object.assign(this, mockIntrospector);
      return this;
    });

    (existsSync as Mock).mockReturnValue(false);
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);

    command = modelCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('model');
    });

    it('should accept optional table argument', () => {
      const args = command.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe('table');
      expect(args[0].required).toBe(false);
    });

    it('should have output option with default', () => {
      const opt = command.options.find((o) => o.long === '--output');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe('./src/models');
    });

    it('should have overwrite option', () => {
      const opt = command.options.find((o) => o.long === '--overwrite');
      expect(opt).toBeDefined();
    });

    it('should have timestamps option', () => {
      const opt = command.options.find((o) => o.long === '--timestamps');
      expect(opt).toBeDefined();
    });

    it('should have soft-delete option', () => {
      const opt = command.options.find((o) => o.long === '--soft-delete');
      expect(opt).toBeDefined();
    });
  });

  describe('model generation', () => {
    it('should generate model for specific table', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      expect(mockIntrospector.getTableInfo).toHaveBeenCalledWith('users');
      expect(writeFileSync).toHaveBeenCalled();
    });

    it('should generate models for all tables when no table specified', async () => {
      await command.parseAsync(['node', 'test']);

      expect(mockIntrospector.introspect).toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalled();
    });

    it('should create output directory if it does not exist', async () => {
      (existsSync as Mock).mockReturnValue(false);

      await command.parseAsync(['node', 'test', 'users']);

      expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('should skip existing files without overwrite flag', async () => {
      (existsSync as Mock).mockImplementation((path: string) => {
        return path.includes('users.ts');
      });

      await command.parseAsync(['node', 'test', 'users']);

      // File should not be written
      const writeCalls = (writeFileSync as Mock).mock.calls;
      const userModelCall = writeCalls.find((c) => c[0].includes('users.ts'));
      expect(userModelCall).toBeUndefined();
    });

    it('should overwrite existing files with overwrite flag', async () => {
      (existsSync as Mock).mockImplementation((path: string) => {
        return path.includes('users.ts');
      });

      await command.parseAsync(['node', 'test', 'users', '--overwrite']);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('users.ts'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should generate TypeScript interface', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const modelCall = writeCalls.find((c) => c[0].includes('users.ts'));
      
      expect(modelCall).toBeDefined();
      expect(modelCall[1]).toContain('export interface Users');
    });

    it('should generate table interface for Kysely', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const modelCall = writeCalls.find((c) => c[0].includes('users.ts'));
      
      expect(modelCall[1]).toContain('UsersTable');
    });

    it('should generate NewModel interface', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const modelCall = writeCalls.find((c) => c[0].includes('users.ts'));
      
      expect(modelCall[1]).toContain('NewUsers');
    });

    it('should generate Update interface', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const modelCall = writeCalls.find((c) => c[0].includes('users.ts'));
      
      expect(modelCall[1]).toContain('UsersUpdate');
    });

    it('should use kebab-case for filename', async () => {
      mockIntrospector.getTableInfo.mockResolvedValue({
        ...mockTableInfo,
        name: 'user_profiles',
      });

      await command.parseAsync(['node', 'test', 'user_profiles']);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('user-profiles.ts'),
        expect.any(String),
        'utf-8'
      );
    });
  });

  describe('error handling', () => {
    it('should throw error if config not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test', 'users']))
        .rejects.toThrow();
    });

    it('should throw error if database connection fails', async () => {
      (getDatabaseConnection as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test', 'users']))
        .rejects.toThrow();
    });

    it('should close database connection on error', async () => {
      mockIntrospector.getTableInfo.mockRejectedValue(new Error('Table not found'));

      try {
        await command.parseAsync(['node', 'test', 'nonexistent']);
      } catch {
        // Expected to throw
      }

      expect(mockDb.destroy).toHaveBeenCalled();
    });
  });
});

describe('generate repository command', () => {
  let command: Command;
  let mockIntrospector: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock introspector instance
    mockIntrospector = {
      getTables: vi.fn().mockResolvedValue(['users']),
      getTableInfo: vi.fn().mockResolvedValue(mockTableInfo),
      introspect: vi.fn().mockResolvedValue([mockTableInfo]),
    };

    // Make DatabaseIntrospector constructor return the mock instance
    (DatabaseIntrospector as Mock).mockImplementation(function(this: any) {
      Object.assign(this, mockIntrospector);
      return this;
    });

    (existsSync as Mock).mockReturnValue(false);
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);

    command = repositoryCommand();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('repository');
    });

    it('should have output option with default', () => {
      const opt = command.options.find((o) => o.long === '--output');
      expect(opt?.defaultValue).toBe('./src/repositories');
    });

    it('should have validation option', () => {
      const opt = command.options.find((o) => o.long === '--with-validation');
      expect(opt).toBeDefined();
    });

    it('should have pagination option', () => {
      const opt = command.options.find((o) => o.long === '--with-pagination');
      expect(opt).toBeDefined();
    });

    it('should have soft-delete option', () => {
      const opt = command.options.find((o) => o.long === '--with-soft-delete');
      expect(opt).toBeDefined();
    });
  });

  describe('repository generation', () => {
    it('should generate repository for specific table', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('users.repository.ts'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should generate repository class', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const repoCall = writeCalls.find((c) => c[0].includes('.repository.ts'));
      
      expect(repoCall[1]).toContain('UsersRepository');
      expect(repoCall[1]).toContain('class');
    });

    it('should include CRUD methods', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const repoCall = writeCalls.find((c) => c[0].includes('.repository.ts'));
      
      expect(repoCall[1]).toContain('findById');
      expect(repoCall[1]).toContain('findAll');
      expect(repoCall[1]).toContain('create');
      expect(repoCall[1]).toContain('update');
      expect(repoCall[1]).toContain('delete');
    });

    it('should include pagination when enabled', async () => {
      await command.parseAsync(['node', 'test', 'users', '--with-pagination']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const repoCall = writeCalls.find((c) => c[0].includes('.repository.ts'));
      
      expect(repoCall[1]).toContain('paginate');
      expect(repoCall[1]).toContain('PaginatedResult');
    });

    it('should include soft-delete methods when enabled', async () => {
      await command.parseAsync(['node', 'test', 'users', '--with-soft-delete']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const repoCall = writeCalls.find((c) => c[0].includes('.repository.ts'));
      
      expect(repoCall[1]).toContain('restore');
      expect(repoCall[1]).toContain('findDeleted');
      expect(repoCall[1]).toContain('forceDelete');
    });

    it('should include validation when enabled', async () => {
      await command.parseAsync(['node', 'test', 'users', '--with-validation']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const repoCall = writeCalls.find((c) => c[0].includes('.repository.ts'));
      
      expect(repoCall[1]).toContain('Schema.parse');
    });

    it('should generate count method', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const repoCall = writeCalls.find((c) => c[0].includes('.repository.ts'));
      
      expect(repoCall[1]).toContain('count');
    });

    it('should generate exists method', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const repoCall = writeCalls.find((c) => c[0].includes('.repository.ts'));
      
      expect(repoCall[1]).toContain('exists');
    });
  });
});

describe('generate schema command', () => {
  let command: Command;
  let mockIntrospector: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock introspector instance
    mockIntrospector = {
      getTables: vi.fn().mockResolvedValue(['users']),
      getTableInfo: vi.fn().mockResolvedValue(mockTableInfo),
      introspect: vi.fn().mockResolvedValue([mockTableInfo]),
    };

    // Make DatabaseIntrospector constructor return the mock instance
    (DatabaseIntrospector as Mock).mockImplementation(function(this: any) {
      Object.assign(this, mockIntrospector);
      return this;
    });

    (existsSync as Mock).mockReturnValue(false);
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);

    command = schemaCommand();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('schema');
    });

    it('should have output option with default', () => {
      const opt = command.options.find((o) => o.long === '--output');
      expect(opt?.defaultValue).toBe('./src/schemas');
    });

    it('should have strict option', () => {
      const opt = command.options.find((o) => o.long === '--strict');
      expect(opt).toBeDefined();
    });
  });

  describe('schema generation', () => {
    it('should generate Zod schema for table', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('users.schema.ts'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should import zod', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const schemaCall = writeCalls.find((c) => c[0].includes('.schema.ts'));
      
      expect(schemaCall[1]).toContain("import { z } from 'zod'");
    });

    it('should generate base schema', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const schemaCall = writeCalls.find((c) => c[0].includes('.schema.ts'));
      
      expect(schemaCall[1]).toContain('UsersSchema');
      expect(schemaCall[1]).toContain('z.object');
    });

    it('should generate new record schema', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const schemaCall = writeCalls.find((c) => c[0].includes('.schema.ts'));
      
      expect(schemaCall[1]).toContain('NewUsersSchema');
    });

    it('should generate update schema', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const schemaCall = writeCalls.find((c) => c[0].includes('.schema.ts'));
      
      expect(schemaCall[1]).toContain('UpdateUsersSchema');
    });

    it('should generate filter schema', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const schemaCall = writeCalls.find((c) => c[0].includes('.schema.ts'));
      
      expect(schemaCall[1]).toContain('FilterSchema');
    });

    it('should include strict mode when enabled', async () => {
      await command.parseAsync(['node', 'test', 'users', '--strict']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const schemaCall = writeCalls.find((c) => c[0].includes('.schema.ts'));
      
      expect(schemaCall[1]).toContain('.strict()');
    });

    it('should generate validation helpers', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const schemaCall = writeCalls.find((c) => c[0].includes('.schema.ts'));
      
      expect(schemaCall[1]).toContain('validateUsers');
      expect(schemaCall[1]).toContain('safeParse');
    });
  });
});

describe('generate crud command', () => {
  let command: Command;
  let mockIntrospector: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock introspector instance
    mockIntrospector = {
      getTables: vi.fn().mockResolvedValue(['users']),
      getTableInfo: vi.fn().mockResolvedValue(mockTableInfo),
      introspect: vi.fn().mockResolvedValue([mockTableInfo]),
    };

    // Make DatabaseIntrospector constructor return the mock instance
    (DatabaseIntrospector as Mock).mockImplementation(function(this: any) {
      Object.assign(this, mockIntrospector);
      return this;
    });

    (existsSync as Mock).mockReturnValue(false);
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);

    command = crudCommand();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('crud');
    });

    it('should require table argument', () => {
      const args = command.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe('table');
      expect(args[0].required).toBe(true);
    });

    it('should have output-dir option', () => {
      const opt = command.options.find((o) => o.long === '--output-dir');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe('./src');
    });

    it('should have format option', () => {
      const opt = command.options.find((o) => o.long === '--format');
      expect(opt).toBeDefined();
    });
  });

  describe('crud generation', () => {
    it('should generate model, repository, and schema', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      
      // Should generate model
      expect(writeCalls.some((c) => c[0].includes('models') && c[0].includes('users.ts'))).toBe(true);
      
      // Should generate repository
      expect(writeCalls.some((c) => c[0].includes('repositories') && c[0].includes('.repository.ts'))).toBe(true);
      
      // Should generate schema
      expect(writeCalls.some((c) => c[0].includes('schemas') && c[0].includes('.schema.ts'))).toBe(true);
    });

    it('should create all required directories', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const mkdirCalls = (mkdirSync as Mock).mock.calls;
      
      expect(mkdirCalls.some((c) => c[0].includes('models'))).toBe(true);
      expect(mkdirCalls.some((c) => c[0].includes('repositories'))).toBe(true);
      expect(mkdirCalls.some((c) => c[0].includes('schemas'))).toBe(true);
    });

    it('should create or update index file', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const indexCall = writeCalls.find((c) => c[0].endsWith('index.ts'));
      
      expect(indexCall).toBeDefined();
      expect(indexCall[1]).toContain('export *');
    });

    it('should respect --no-with-validation option', async () => {
      await command.parseAsync(['node', 'test', 'users', '--no-with-validation']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const repoCall = writeCalls.find((c) => c[0].includes('.repository.ts'));
      
      // Should not include validation
      expect(repoCall[1]).not.toContain('Schema.parse');
    });

    it('should include soft-delete support when enabled', async () => {
      await command.parseAsync(['node', 'test', 'users', '--with-soft-delete']);

      const writeCalls = (writeFileSync as Mock).mock.calls;
      const repoCall = writeCalls.find((c) => c[0].includes('.repository.ts'));
      
      // Repository should use soft delete pattern
      expect(repoCall).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should throw error for nonexistent table', async () => {
      mockIntrospector.getTableInfo.mockRejectedValue(new Error('Table not found'));

      await expect(command.parseAsync(['node', 'test', 'nonexistent']))
        .rejects.toThrow();
    });

    it('should close database connection on completion', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      expect(mockDb.destroy).toHaveBeenCalled();
    });
  });
});
