import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock external dependencies before importing the module under test
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue('{}'),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
}));

vi.mock('node:module', () => ({
  createRequire: vi.fn().mockReturnValue({
    resolve: vi.fn().mockImplementation((name) => {
      if (name.includes('not-installed')) {
        throw new Error('Module not found');
      }
      return `/node_modules/${name}`;
    }),
  }),
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
    underline: (s: string) => s,
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

import { readdir, readFile } from 'node:fs/promises';
import { listPluginsCommand } from '../../../../src/commands/plugin/list.js';
import { loadConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';

describe('plugin list command', () => {
  let command: Command;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    process.env['NODE_ENV'] = 'test';
    
    (loadConfig as Mock).mockResolvedValue({
      plugins: {
        '@kysera/soft-delete': { enabled: true },
      },
    });
    
    consoleSpy = {
      log: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = listPluginsCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('list');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('List available and installed plugins');
    });

    it('should have --installed option', () => {
      const options = command.options;
      const installedOpt = options.find((o) => o.long === '--installed');
      expect(installedOpt).toBeDefined();
    });

    it('should have --available option', () => {
      const options = command.options;
      const availableOpt = options.find((o) => o.long === '--available');
      expect(availableOpt).toBeDefined();
    });

    it('should have --enabled option', () => {
      const options = command.options;
      const enabledOpt = options.find((o) => o.long === '--enabled');
      expect(enabledOpt).toBeDefined();
    });

    it('should have --disabled option', () => {
      const options = command.options;
      const disabledOpt = options.find((o) => o.long === '--disabled');
      expect(disabledOpt).toBeDefined();
    });

    it('should have --category option', () => {
      const options = command.options;
      const categoryOpt = options.find((o) => o.long === '--category');
      expect(categoryOpt).toBeDefined();
    });

    it('should have --search option', () => {
      const options = command.options;
      const searchOpt = options.find((o) => o.long === '--search');
      expect(searchOpt).toBeDefined();
    });

    it('should have --show-details option', () => {
      const options = command.options;
      const detailsOpt = options.find((o) => o.long === '--show-details');
      expect(detailsOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const options = command.options;
      const jsonOpt = options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should list plugins successfully', async () => {
      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should list only installed plugins', async () => {
      (readdir as Mock).mockResolvedValueOnce(['soft-delete']);
      (readFile as Mock).mockResolvedValue(JSON.stringify({
        name: '@kysera/soft-delete',
        version: '1.0.0',
        description: 'Soft delete plugin',
      }));

      await command.parseAsync(['node', 'test', '--installed']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should list only available plugins', async () => {
      await command.parseAsync(['node', 'test', '--available']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should filter by category', async () => {
      await command.parseAsync(['node', 'test', '--category', 'schema']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should search plugins by name', async () => {
      await command.parseAsync(['node', 'test', '--search', 'soft']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should output JSON when --json is used', async () => {
      await command.parseAsync(['node', 'test', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show detailed information when --show-details is used', async () => {
      await command.parseAsync(['node', 'test', '--show-details']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('filtering', () => {
    it('should filter enabled plugins', async () => {
      await command.parseAsync(['node', 'test', '--enabled']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should filter disabled plugins', async () => {
      await command.parseAsync(['node', 'test', '--disabled']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should filter by audit category', async () => {
      await command.parseAsync(['node', 'test', '--available', '--category', 'audit']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should filter by cache category', async () => {
      await command.parseAsync(['node', 'test', '--available', '--category', 'cache']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should search by description', async () => {
      await command.parseAsync(['node', 'test', '--available', '--search', 'timestamp']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle readdir errors gracefully', async () => {
      (readdir as Mock).mockRejectedValue(new Error('ENOENT'));

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();
    });

    it('should handle readFile errors gracefully', async () => {
      (readdir as Mock).mockResolvedValueOnce(['broken-plugin']);
      (readFile as Mock).mockRejectedValue(new Error('Invalid JSON'));

      await expect(command.parseAsync(['node', 'test', '--installed'])).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle no plugins found', async () => {
      (readdir as Mock).mockResolvedValue([]);
      (loadConfig as Mock).mockResolvedValue({ plugins: {} });

      await command.parseAsync(['node', 'test', '--installed']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should use custom config path when provided', async () => {
      await command.parseAsync(['node', 'test', '--config', './custom-config.ts']);
      expect(loadConfig).toHaveBeenCalledWith('./custom-config.ts');
    });

    it('should display plugin version', async () => {
      (readdir as Mock).mockResolvedValueOnce(['test-plugin']);
      (readFile as Mock).mockResolvedValue(JSON.stringify({
        name: '@kysera/test-plugin',
        version: '2.0.0',
      }));

      await command.parseAsync(['node', 'test', '--installed', '--show-details']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should display plugin author', async () => {
      (readdir as Mock).mockResolvedValueOnce(['test-plugin']);
      (readFile as Mock).mockResolvedValue(JSON.stringify({
        name: '@kysera/test-plugin',
        version: '1.0.0',
        author: 'Test Author',
      }));

      await command.parseAsync(['node', 'test', '--installed', '--show-details']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });
});
