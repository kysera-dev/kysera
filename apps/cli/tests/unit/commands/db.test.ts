import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    resolve: vi.fn((...args: string[]) => args[args.length - 1]),
  };
});

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
    stop: vi.fn(),
    text: '',
  })),
  table: vi.fn((data: any[]) => JSON.stringify(data)),
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

vi.mock('../../../src/commands/generate/introspector.js', () => {
  const mockClass = vi.fn().mockImplementation(function(this: any) {
    this.getTables = vi.fn().mockResolvedValue(['users', 'posts']);
    this.getTableInfo = vi.fn().mockResolvedValue({
      name: 'users',
      columns: [
        { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true },
        { name: 'email', dataType: 'varchar', isNullable: false, isPrimaryKey: false },
      ],
      indexes: [],
      primaryKey: ['id'],
      foreignKeys: [],
    });
    this.introspect = vi.fn().mockResolvedValue({
      tables: [{
        name: 'users',
        columns: [
          { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true },
          { name: 'email', dataType: 'varchar', isNullable: false, isPrimaryKey: false },
        ],
        indexes: [],
        primaryKey: ['id'],
        foreignKeys: [],
      }],
    });
    this.getAllRows = vi.fn().mockResolvedValue([{ id: 1, email: 'test@example.com' }]);
    return this;
  });

  // Add static method
  mockClass.mapDataTypeToTypeScript = vi.fn((dataType: string, isNullable: boolean) => {
    return isNullable ? 'string | null' : 'string';
  });

  return {
    DatabaseIntrospector: mockClass,
  };
});

import { existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../../../src/config/loader.js';
import { getDatabaseConnection } from '../../../src/utils/database.js';
import { DatabaseIntrospector } from '../../../src/commands/generate/introspector.js';
import { dbCommand } from '../../../src/commands/db/index.js';
import { tablesCommand } from '../../../src/commands/db/tables.js';
import { introspectCommand } from '../../../src/commands/db/introspect.js';
import { seedCommand } from '../../../src/commands/db/seed.js';
import { dumpCommand } from '../../../src/commands/db/dump.js';
import { restoreCommand } from '../../../src/commands/db/restore.js';

// Mock table info
const mockTableInfo = {
  name: 'users',
  columns: [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true },
    { name: 'email', dataType: 'varchar', isNullable: false, isPrimaryKey: false },
    { name: 'name', dataType: 'varchar', isNullable: true, isPrimaryKey: false },
  ],
  indexes: [
    { name: 'users_pkey', columns: ['id'], isUnique: true, isPrimary: true },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
};

// Mock transaction object
const mockTrx = {
  executeQuery: vi.fn().mockResolvedValue(undefined),
  raw: vi.fn((sql: string) => ({ sql })),
  commit: vi.fn().mockResolvedValue(undefined),
  rollback: vi.fn().mockResolvedValue(undefined),
  deleteFrom: vi.fn(() => ({
    execute: vi.fn().mockResolvedValue(undefined),
  })),
  insertInto: vi.fn(() => ({
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  })),
  schema: {
    dropTable: vi.fn(() => ({
      ifExists: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    })),
    createTable: vi.fn(() => ({
      addColumn: vi.fn().mockReturnThis(),
      addForeignKeyConstraint: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    })),
    createIndex: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      columns: vi.fn().mockReturnThis(),
      unique: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    })),
  },
  fn: {
    now: vi.fn(() => 'NOW()'),
  },
};

// Mock database connection
const mockDb = {
  destroy: vi.fn(),
  selectFrom: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([{ id: 1, email: 'test@test.com', name: 'Test' }]),
    executeTakeFirst: vi.fn().mockResolvedValue({ count: 10 }),
  })),
  selectNoFrom: vi.fn(() => ({
    executeTakeFirst: vi.fn().mockResolvedValue({ table_size: 1000, index_size: 500 }),
  })),
  fn: {
    countAll: vi.fn(() => ({ as: vi.fn() })),
  },
  deleteFrom: vi.fn(() => ({
    execute: vi.fn().mockResolvedValue(undefined),
  })),
  insertInto: vi.fn(() => ({
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  })),
  transaction: vi.fn(() => ({
    execute: vi.fn(async (callback: (trx: any) => Promise<void>) => {
      await callback(mockTrx);
    }),
  })),
  raw: vi.fn(),
  schema: {
    createTable: vi.fn().mockReturnThis(),
    dropTable: vi.fn().mockReturnThis(),
  },
};

describe('db command', () => {
  let command: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    command = dbCommand();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('db');
    });

    it('should have all subcommands', () => {
      const subcommands = command.commands.map((c) => c.name());
      expect(subcommands).toContain('seed');
      expect(subcommands).toContain('reset');
      expect(subcommands).toContain('tables');
      expect(subcommands).toContain('dump');
      expect(subcommands).toContain('restore');
      expect(subcommands).toContain('introspect');
      expect(subcommands).toContain('console');
    });
  });
});

describe('db tables command', () => {
  let command: Command;
  let mockIntrospector: any;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    
    mockIntrospector = {
      getTables: vi.fn().mockResolvedValue(['users', 'posts']),
      getTableInfo: vi.fn().mockResolvedValue(mockTableInfo),
      introspect: vi.fn().mockResolvedValue([mockTableInfo]),
    };
    (DatabaseIntrospector as Mock).mockImplementation(function(this: any) {
      Object.assign(this, mockIntrospector);
      return this;
    });
    
    consoleSpy = { log: vi.fn() };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = tablesCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('tables');
    });

    it('should have json option', () => {
      const opt = command.options.find((o) => o.long === '--json');
      expect(opt).toBeDefined();
    });

    it('should have verbose option', () => {
      const opt = command.options.find((o) => o.short === '-v');
      expect(opt).toBeDefined();
    });
  });

  describe('listing tables', () => {
    it('should list all tables', async () => {
      await command.parseAsync(['node', 'test']);

      expect(mockIntrospector.getTables).toHaveBeenCalled();
    });

    it('should display table information', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toBeTruthy();
    });

    it('should output JSON when --json flag is set', async () => {
      await command.parseAsync(['node', 'test', '--json']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      // Should contain valid JSON
      expect(() => JSON.parse(logOutput)).not.toThrow();
    });

    it('should show detailed info with --verbose', async () => {
      await command.parseAsync(['node', 'test', '--verbose']);

      expect(mockIntrospector.getTableInfo).toHaveBeenCalled();
    });

    it('should handle empty database', async () => {
      mockIntrospector.getTables.mockResolvedValue([]);

      await command.parseAsync(['node', 'test']);

      // Should not throw, just warn
      expect(mockIntrospector.getTables).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error if config not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test']))
        .rejects.toThrow();
    });

    it('should throw error if database connection fails', async () => {
      (getDatabaseConnection as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test']))
        .rejects.toThrow();
    });

    it('should close database connection', async () => {
      await command.parseAsync(['node', 'test']);

      expect(mockDb.destroy).toHaveBeenCalled();
    });
  });
});

describe('db introspect command', () => {
  let command: Command;
  let mockIntrospector: any;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    
    mockIntrospector = {
      getTables: vi.fn().mockResolvedValue(['users', 'posts']),
      getTableInfo: vi.fn().mockResolvedValue(mockTableInfo),
      introspect: vi.fn().mockResolvedValue([mockTableInfo]),
    };
    (DatabaseIntrospector as Mock).mockImplementation(function(this: any) {
      Object.assign(this, mockIntrospector);
      return this;
    });
    
    consoleSpy = { log: vi.fn() };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = introspectCommand();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('introspect');
    });

    it('should accept optional table argument', () => {
      const args = command.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].required).toBe(false);
    });

    it('should have json option', () => {
      const opt = command.options.find((o) => o.long === '--json');
      expect(opt).toBeDefined();
    });

    it('should have detailed option', () => {
      const opt = command.options.find((o) => o.long === '--detailed');
      expect(opt).toBeDefined();
    });
  });

  describe('introspection', () => {
    it('should introspect specific table when provided', async () => {
      await command.parseAsync(['node', 'test', 'users']);

      expect(mockIntrospector.getTableInfo).toHaveBeenCalledWith('users');
    });

    it('should introspect all tables when no table specified', async () => {
      await command.parseAsync(['node', 'test']);

      expect(mockIntrospector.getTables).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      await command.parseAsync(['node', 'test', '--json']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(() => JSON.parse(logOutput)).not.toThrow();
    });

    it('should show detailed info with --detailed', async () => {
      await command.parseAsync(['node', 'test', '--detailed']);

      expect(mockIntrospector.getTableInfo).toHaveBeenCalled();
    });

    it('should show TypeScript types in detailed mode', async () => {
      await command.parseAsync(['node', 'test', 'users', '--detailed']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('TypeScript');
    });
  });
});

describe('db seed command', () => {
  let command: Command;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    (existsSync as Mock).mockReturnValue(true);
    (readdirSync as Mock).mockReturnValue(['001_users.ts', '002_posts.ts']);
    
    consoleSpy = { log: vi.fn() };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = seedCommand();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('seed');
    });

    it('should have file option', () => {
      const opt = command.options.find((o) => o.short === '-f');
      expect(opt).toBeDefined();
    });

    it('should have directory option with default', () => {
      const opt = command.options.find((o) => o.short === '-d');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe('./seeds');
    });

    it('should have fresh option', () => {
      const opt = command.options.find((o) => o.long === '--fresh');
      expect(opt).toBeDefined();
    });

    it('should have verbose option', () => {
      const opt = command.options.find((o) => o.short === '-v');
      expect(opt).toBeDefined();
    });
  });

  describe('seeding', () => {
    it('should throw error if seeds directory not found', async () => {
      (existsSync as Mock).mockReturnValue(false);

      await expect(command.parseAsync(['node', 'test']))
        .rejects.toThrow();
    });

    it('should throw error if specific seed file not found', async () => {
      (existsSync as Mock).mockImplementation((path: string) => {
        return !path.includes('nonexistent');
      });

      await expect(command.parseAsync(['node', 'test', '-f', 'nonexistent.ts']))
        .rejects.toThrow();
    });

    it('should handle no seed files in directory', async () => {
      (readdirSync as Mock).mockReturnValue([]);

      // Should not throw, just warn
      await expect(command.parseAsync(['node', 'test']))
        .resolves.not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should throw error if config not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test']))
        .rejects.toThrow();
    });

    it('should close database connection', async () => {
      (readdirSync as Mock).mockReturnValue([]);
      
      await command.parseAsync(['node', 'test']);

      expect(mockDb.destroy).toHaveBeenCalled();
    });
  });
});

describe('db dump command', () => {
  let command: Command;
  let mockIntrospector: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    
    mockIntrospector = {
      getTables: vi.fn().mockResolvedValue(['users']),
      getTableInfo: vi.fn().mockResolvedValue(mockTableInfo),
      introspect: vi.fn().mockResolvedValue([mockTableInfo]),
    };
    (DatabaseIntrospector as Mock).mockImplementation(function(this: any) {
      Object.assign(this, mockIntrospector);
      return this;
    });
    
    command = dumpCommand();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('dump');
    });

    it('should have output option', () => {
      const opt = command.options.find((o) => o.short === '-o');
      expect(opt).toBeDefined();
    });

    it('should have tables option', () => {
      const opt = command.options.find((o) => o.short === '-t');
      expect(opt).toBeDefined();
    });

    it('should have data-only option', () => {
      const opt = command.options.find((o) => o.long === '--data-only');
      expect(opt).toBeDefined();
    });

    it('should have schema-only option', () => {
      const opt = command.options.find((o) => o.long === '--schema-only');
      expect(opt).toBeDefined();
    });

    it('should have format option with default', () => {
      const opt = command.options.find((o) => o.short === '-f');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe('sql');
    });
  });

  describe('dumping', () => {
    it('should create dump file', async () => {
      await command.parseAsync(['node', 'test']);

      expect(writeFileSync).toHaveBeenCalled();
    });

    it('should use specified output file', async () => {
      await command.parseAsync(['node', 'test', '-o', 'backup.sql']);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('backup.sql'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should dump specific tables when specified', async () => {
      await command.parseAsync(['node', 'test', '-t', 'users']);

      expect(mockIntrospector.getTableInfo).toHaveBeenCalled();
    });

    it('should throw error for invalid table', async () => {
      mockIntrospector.getTables.mockResolvedValue(['users']);

      await expect(command.parseAsync(['node', 'test', '-t', 'nonexistent']))
        .rejects.toThrow();
    });

    it('should throw error if both data-only and schema-only', async () => {
      await expect(command.parseAsync(['node', 'test', '--data-only', '--schema-only']))
        .rejects.toThrow();
    });

    it('should generate JSON dump when format is json', async () => {
      await command.parseAsync(['node', 'test', '-f', 'json']);

      const writeCall = (writeFileSync as Mock).mock.calls[0];
      expect(writeCall[0]).toContain('.json');
    });

    it('should generate SQL dump when format is sql', async () => {
      await command.parseAsync(['node', 'test', '-f', 'sql']);

      const writeCall = (writeFileSync as Mock).mock.calls[0];
      expect(writeCall[0]).toContain('.sql');
      expect(writeCall[1]).toContain('--');
    });

    it('should include schema in dump by default', async () => {
      await command.parseAsync(['node', 'test']);

      const writeCall = (writeFileSync as Mock).mock.calls[0];
      expect(writeCall[1]).toContain('CREATE TABLE');
    });

    it('should skip schema with --data-only', async () => {
      await command.parseAsync(['node', 'test', '--data-only']);

      const writeCall = (writeFileSync as Mock).mock.calls[0];
      expect(writeCall[1]).not.toContain('CREATE TABLE');
    });
  });

  describe('error handling', () => {
    it('should close database connection', async () => {
      await command.parseAsync(['node', 'test']);

      expect(mockDb.destroy).toHaveBeenCalled();
    });
  });
});

describe('db restore command', () => {
  let command: Command;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset transaction mock
    mockDb.transaction = vi.fn(() => ({
      execute: vi.fn(async (callback: (trx: any) => Promise<void>) => {
        await callback(mockTrx);
      }),
    }));
    mockTrx.executeQuery = vi.fn().mockResolvedValue(undefined);
    mockTrx.commit = vi.fn().mockResolvedValue(undefined);
    mockTrx.rollback = vi.fn().mockResolvedValue(undefined);

    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    (existsSync as Mock).mockReturnValue(true);
    (readFileSync as Mock).mockReturnValue('CREATE TABLE users (id INT);\nINSERT INTO users VALUES (1);');
    (resolve as Mock).mockImplementation((p: string) => p);

    command = restoreCommand();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('restore');
    });

    it('should require file argument', () => {
      const args = command.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].required).toBe(true);
    });

    it('should have force option', () => {
      const opt = command.options.find((o) => o.long === '--force');
      expect(opt).toBeDefined();
    });
  });

  describe('restoring', () => {
    it('should throw error if dump file not found', async () => {
      (existsSync as Mock).mockReturnValue(false);

      await expect(command.parseAsync(['node', 'test', 'backup.sql', '--force']))
        .rejects.toThrow();
    });

    it('should read and execute SQL dump', async () => {
      await command.parseAsync(['node', 'test', 'backup.sql', '--force']);

      expect(readFileSync).toHaveBeenCalled();
    });

    it('should detect JSON format from file extension', async () => {
      (readFileSync as Mock).mockReturnValue(JSON.stringify({
        version: '1.0.0',
        tables: {
          users: {
            schema: {
              columns: [
                { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true }
              ]
            },
            data: [{ id: 1 }]
          }
        }
      }));

      await command.parseAsync(['node', 'test', 'backup.json', '--force']);

      expect(readFileSync).toHaveBeenCalled();
    });

    it('should detect JSON format from content', async () => {
      (readFileSync as Mock).mockReturnValue(JSON.stringify({
        version: '1.0.0',
        tables: {
          users: {
            schema: {
              columns: [
                { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true }
              ]
            },
            data: [{ id: 1 }]
          }
        }
      }));

      await command.parseAsync(['node', 'test', 'backup.dump', '--force']);

      expect(readFileSync).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error if config not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test', 'backup.sql', '--force']))
        .rejects.toThrow();
    });

    it('should close database connection on success', async () => {
      await command.parseAsync(['node', 'test', 'backup.sql', '--force']);

      expect(mockDb.destroy).toHaveBeenCalled();
    });

    it('should throw error for invalid JSON dump', async () => {
      (readFileSync as Mock).mockReturnValue('{ invalid json }');

      await expect(command.parseAsync(['node', 'test', 'backup.json', '--force']))
        .rejects.toThrow();
    });
  });
});
