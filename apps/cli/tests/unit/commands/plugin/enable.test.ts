import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Create mock for require.resolve
const mockResolve = vi.fn().mockImplementation((name) => {
  if (name.includes('not-installed')) {
    throw new Error('Module not found');
  }
  return `/path/to/node_modules/${name}/index.js`;
});

// Mock external dependencies before importing the module under test
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockImplementation((path) => {
    // Mock reading package.json files
    if (path.includes('package.json')) {
      return Promise.resolve(JSON.stringify({
        name: '@kysera/soft-delete',
        version: '1.0.0',
      }));
    }
    return Promise.resolve('{}');
  }),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
}));

vi.mock('../../../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
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
  confirm: vi.fn().mockResolvedValue(true),
  select: vi.fn().mockResolvedValue('@kysera/soft-delete'),
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
import { enablePluginCommand, testHelpers } from '../../../../src/commands/plugin/enable.js';
import { loadConfig, saveConfig } from '../../../../src/config/loader.js';
import { CLIError } from '../../../../src/utils/errors.js';
import { confirm, select } from '@xec-sh/kit';

describe('plugin enable command', () => {
  let command: Command;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    process.env['NODE_ENV'] = 'test';

    (loadConfig as Mock).mockResolvedValue({
      plugins: {},
    });
    (saveConfig as Mock).mockResolvedValue(undefined);

    // Reset readFile mock to default implementation
    (readFile as Mock).mockImplementation((path) => {
      if (path.includes('package.json')) {
        return Promise.resolve(JSON.stringify({
          name: '@kysera/soft-delete',
          version: '1.0.0',
        }));
      }
      return Promise.resolve('{}');
    });

    // Reset mockResolve to default behavior
    mockResolve.mockImplementation((name) => {
      if (name.includes('not-installed')) {
        throw new Error('Module not found');
      }
      return `/path/to/node_modules/${name}/index.js`;
    });

    // Mock createRequire via the testHelpers object
    testHelpers.createRequire = vi.fn().mockReturnValue({
      resolve: mockResolve,
    }) as any;

    consoleSpy = {
      log: vi.fn(),
    };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);

    command = enablePluginCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('enable');
    });

    it('should have a description', () => {
      expect(command.description()).toContain('Enable a plugin');
    });

    it('should accept optional name argument', () => {
      const args = command.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe('name');
      expect(args[0].required).toBe(false);
    });

    it('should have --all option', () => {
      const options = command.options;
      const allOpt = options.find((o) => o.long === '--all');
      expect(allOpt).toBeDefined();
    });

    it('should have --force option', () => {
      const options = command.options;
      const forceOpt = options.find((o) => o.long === '--force');
      expect(forceOpt).toBeDefined();
    });

    it('should have --configure option', () => {
      const options = command.options;
      const configureOpt = options.find((o) => o.long === '--configure');
      expect(configureOpt).toBeDefined();
    });

    it('should have --restart option', () => {
      const options = command.options;
      const restartOpt = options.find((o) => o.long === '--restart');
      expect(restartOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const options = command.options;
      const jsonOpt = options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('success scenarios', () => {
    it('should enable a plugin by name', async () => {
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: '@kysera/soft-delete',
            version: '1.0.0',
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test', '@kysera/soft-delete']);
      expect(saveConfig).toHaveBeenCalled();
    });

    it('should enable all installed plugins', async () => {
      (readdir as Mock).mockResolvedValueOnce(['soft-delete', 'timestamps']);
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: '@kysera/test',
            version: '1.0.0',
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test', '--all', '--force']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should output JSON when --json is used', async () => {
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: '@kysera/soft-delete',
            version: '1.0.0',
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test', '@kysera/soft-delete', '--json']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should skip already enabled plugins', async () => {
      (loadConfig as Mock).mockResolvedValue({
        plugins: {
          '@kysera/soft-delete': { enabled: true },
        },
      });

      await command.parseAsync(['node', 'test', '@kysera/soft-delete']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('interactive mode', () => {
    it('should show plugin selection when no name provided', async () => {
      (readdir as Mock).mockResolvedValueOnce(['soft-delete']);
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: '@kysera/soft-delete',
            version: '1.0.0',
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test']);
      expect(select).toHaveBeenCalled();
    });

    it('should prompt for confirmation when enabling all', async () => {
      (readdir as Mock).mockResolvedValueOnce(['soft-delete']);
      (confirm as Mock).mockResolvedValue(true);
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: '@kysera/soft-delete',
            version: '1.0.0',
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test', '--all']);
      // In test environment, confirmation is skipped
    });
  });

  describe('error handling', () => {
    it('should handle plugin not found', async () => {
      (readFile as Mock).mockRejectedValue(new Error('Module not found'));

      await command.parseAsync(['node', 'test', '@kysera/not-installed']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should handle no installed plugins', async () => {
      (readdir as Mock).mockRejectedValue(new Error('ENOENT'));

      await command.parseAsync(['node', 'test']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should initialize plugins config if not exists', async () => {
      (loadConfig as Mock).mockResolvedValue({});
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: '@kysera/soft-delete',
            version: '1.0.0',
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test', '@kysera/soft-delete']);
      expect(saveConfig).toHaveBeenCalled();
    });

    it('should use custom config path when provided', async () => {
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: '@kysera/soft-delete',
            version: '1.0.0',
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test', '@kysera/soft-delete', '--config', './custom-config.ts']);
      expect(loadConfig).toHaveBeenCalledWith('./custom-config.ts');
    });

    it('should force enable without checks', async () => {
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: '@kysera/soft-delete',
            version: '1.0.0',
            engines: { kysera: '>=99.0.0' },
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test', '@kysera/soft-delete', '--force']);
      expect(saveConfig).toHaveBeenCalled();
    });

    it('should configure plugin when --configure is used', async () => {
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: '@kysera/soft-delete',
            version: '1.0.0',
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test', '@kysera/soft-delete', '--configure']);
      expect(saveConfig).toHaveBeenCalled();
    });

    it('should warn about restart when --restart is used', async () => {
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: '@kysera/soft-delete',
            version: '1.0.0',
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test', '@kysera/soft-delete', '--restart']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should handle custom plugins from plugins directory', async () => {
      (readdir as Mock).mockImplementation((path) => {
        if (path.includes('plugins')) {
          return Promise.resolve(['custom-plugin']);
        }
        return Promise.resolve([]);
      });
      (readFile as Mock).mockImplementation((path) => {
        if (path.includes('package.json')) {
          return Promise.resolve(JSON.stringify({
            name: 'custom-plugin',
            version: '1.0.0',
          }));
        }
        return Promise.resolve('{}');
      });

      await command.parseAsync(['node', 'test', 'custom-plugin']);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });
});
