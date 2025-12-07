import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock external dependencies before importing the module under test
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
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
    white: (s: string) => s,
    magenta: (s: string) => s,
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

import { readFileSync } from 'fs';
import { explainCommand } from '../../../../src/commands/query/explain.js';
import { getDatabaseConnection } from '../../../../src/utils/database.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('query explain command', () => {
  let command: Command;
  let mockDb: any;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    process.env['NODE_ENV'] = 'test';
    
    mockDb = {
      executeQuery: vi.fn().mockResolvedValue({ rows: [{ 'QUERY PLAN': '{}' }] }),
      raw: vi.fn((sql) => sql),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', connection: 'postgres://localhost/test' },
    });
    
    consoleSpy = {
      log: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = explainCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('explain');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Show and analyze query execution plans');
    });

    it('should have --query option', () => {
      const options = command.options;
      const queryOpt = options.find((o) => o.long === '--query');
      expect(queryOpt).toBeDefined();
    });

    it('should have --file option', () => {
      const options = command.options;
      const fileOpt = options.find((o) => o.long === '--file');
      expect(fileOpt).toBeDefined();
    });

    it('should have --analyze option', () => {
      const options = command.options;
      const analyzeOpt = options.find((o) => o.long === '--analyze');
      expect(analyzeOpt).toBeDefined();
    });

    it('should have --verbose option', () => {
      const options = command.options;
      const verboseOpt = options.find((o) => o.long === '--verbose');
      expect(verboseOpt).toBeDefined();
    });

    it('should have --format option with default text', () => {
      const options = command.options;
      const formatOpt = options.find((o) => o.long === '--format');
      expect(formatOpt).toBeDefined();
      expect(formatOpt?.defaultValue).toBe('text');
    });

    it('should have --buffers option', () => {
      const options = command.options;
      const buffersOpt = options.find((o) => o.long === '--buffers');
      expect(buffersOpt).toBeDefined();
    });

    it('should have --costs option', () => {
      const options = command.options;
      const costsOpt = options.find((o) => o.long === '--costs');
      expect(costsOpt).toBeDefined();
    });

    it('should have --timing option', () => {
      const options = command.options;
      const timingOpt = options.find((o) => o.long === '--timing');
      expect(timingOpt).toBeDefined();
    });

    it('should have --summary option', () => {
      const options = command.options;
      const summaryOpt = options.find((o) => o.long === '--summary');
      expect(summaryOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should explain a query successfully', async () => {
      mockDb.executeQuery.mockResolvedValue({
        rows: [{ 'QUERY PLAN': JSON.stringify([{ Plan: { 'Node Type': 'Seq Scan' } }]) }],
      });

      await expect(command.parseAsync(['node', 'test', '--query', 'SELECT * FROM users'])).resolves.not.toThrow();
      expect(mockDb.executeQuery).toHaveBeenCalled();
    });

    it('should explain query from file', async () => {
      (readFileSync as Mock).mockReturnValue('SELECT * FROM posts');
      mockDb.executeQuery.mockResolvedValue({
        rows: [{ 'QUERY PLAN': JSON.stringify([{ Plan: { 'Node Type': 'Seq Scan' } }]) }],
      });

      await command.parseAsync(['node', 'test', '--file', './query.sql']);
      expect(readFileSync).toHaveBeenCalledWith('./query.sql', 'utf-8');
    });

    it('should run EXPLAIN ANALYZE when --analyze is used', async () => {
      mockDb.executeQuery.mockResolvedValue({
        rows: [{ 'QUERY PLAN': JSON.stringify([{ Plan: { 'Node Type': 'Seq Scan' } }]) }],
      });

      await command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--analyze']);
      expect(mockDb.raw).toHaveBeenCalledWith(expect.stringContaining('ANALYZE'));
    });

    it('should output verbose information', async () => {
      mockDb.executeQuery.mockResolvedValue({
        rows: [{ 'QUERY PLAN': JSON.stringify([{ Plan: { 'Node Type': 'Seq Scan' } }]) }],
      });

      await command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--verbose']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error when no query is specified', async () => {
      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError);
    });

    it('should throw error when database config is not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test', '--query', 'SELECT 1'])).rejects.toThrow(CLIError);
    });

    it('should throw error when database connection fails', async () => {
      (getDatabaseConnection as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test', '--query', 'SELECT 1'])).rejects.toThrow(CLIError);
    });

    it('should throw error when query file cannot be read', async () => {
      (readFileSync as Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      await expect(command.parseAsync(['node', 'test', '--file', './nonexistent.sql'])).rejects.toThrow(CLIError);
    });

    it('should throw error for unsupported dialect', async () => {
      (loadConfig as Mock).mockResolvedValue({
        database: { dialect: 'oracle' },
      });

      await expect(command.parseAsync(['node', 'test', '--query', 'SELECT 1'])).rejects.toThrow(CLIError);
    });
  });

  describe('dialect support', () => {
    it('should handle PostgreSQL dialect', async () => {
      mockDb.executeQuery.mockResolvedValue({
        rows: [{ 'QUERY PLAN': JSON.stringify([{ Plan: { 'Node Type': 'Seq Scan' } }]) }],
      });

      await command.parseAsync(['node', 'test', '--query', 'SELECT 1']);
      expect(mockDb.raw).toHaveBeenCalledWith(expect.stringContaining('EXPLAIN'));
    });

    it('should handle MySQL dialect', async () => {
      (loadConfig as Mock).mockResolvedValue({
        database: { dialect: 'mysql' },
      });
      mockDb.executeQuery.mockResolvedValue({ rows: [{ EXPLAIN: '{}' }] });

      await command.parseAsync(['node', 'test', '--query', 'SELECT 1']);
      expect(mockDb.raw).toHaveBeenCalledWith(expect.stringContaining('EXPLAIN'));
    });

    it('should handle SQLite dialect', async () => {
      (loadConfig as Mock).mockResolvedValue({
        database: { dialect: 'sqlite' },
      });
      mockDb.executeQuery.mockResolvedValue({ rows: [{ detail: 'SCAN TABLE users' }] });

      await command.parseAsync(['node', 'test', '--query', 'SELECT 1']);
      expect(mockDb.raw).toHaveBeenCalledWith(expect.stringContaining('EXPLAIN QUERY PLAN'));
    });
  });

  describe('edge cases', () => {
    it('should close database connection after execution', async () => {
      mockDb.executeQuery.mockResolvedValue({
        rows: [{ 'QUERY PLAN': JSON.stringify([{ Plan: { 'Node Type': 'Seq Scan' } }]) }],
      });

      await command.parseAsync(['node', 'test', '--query', 'SELECT 1']);
      expect(mockDb.destroy).toHaveBeenCalled();
    });

    it('should handle JSON format output', async () => {
      mockDb.executeQuery.mockResolvedValue({
        rows: [{ 'QUERY PLAN': JSON.stringify([{ Plan: { 'Node Type': 'Seq Scan' } }]) }],
      });

      await command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--format', 'json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should handle tree format output', async () => {
      mockDb.executeQuery.mockResolvedValue({
        rows: [{ 'QUERY PLAN': 'Index Scan using ...' }],
      });

      await command.parseAsync(['node', 'test', '--query', 'SELECT 1', '--format', 'tree']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });
});
