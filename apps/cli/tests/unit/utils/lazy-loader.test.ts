import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import {
  LoadMetrics,
  lazyCommand,
  CommandCache,
  BatchCommandLoader,
  CommandOptimizer,
  createCommandLoaders,
} from '@/utils/lazy-loader';

// Mock global-options
vi.mock('@/utils/global-options', () => ({
  verbose: vi.fn(),
}));

// Mock fs/promises for CommandOptimizer
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

describe('LoadMetrics', () => {
  beforeEach(() => {
    // Clear metrics between tests (access private static map)
    (LoadMetrics as any).metrics.clear();
  });

  describe('recordLoad', () => {
    it('should record load time for a command', () => {
      LoadMetrics.recordLoad('test-command', 100);

      const metrics = LoadMetrics.getMetrics('test-command');
      expect(metrics).toBeDefined();
      expect(metrics?.loadTime).toBe(100);
      expect(metrics?.executionCount).toBe(1);
    });

    it('should increment execution count on subsequent loads', () => {
      LoadMetrics.recordLoad('test-command', 100);
      LoadMetrics.recordLoad('test-command', 150);

      const metrics = LoadMetrics.getMetrics('test-command');
      expect(metrics?.executionCount).toBe(2);
      expect(metrics?.loadTime).toBe(150); // Last load time
    });

    it('should track lastAccess time', () => {
      const before = new Date();
      LoadMetrics.recordLoad('test-command', 100);
      const after = new Date();

      const metrics = LoadMetrics.getMetrics('test-command');
      expect(metrics?.lastAccess.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(metrics?.lastAccess.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('getMetrics', () => {
    it('should return undefined for non-existent command', () => {
      const metrics = LoadMetrics.getMetrics('non-existent');
      expect(metrics).toBeUndefined();
    });

    it('should return metrics for recorded command', () => {
      LoadMetrics.recordLoad('my-command', 200);

      const metrics = LoadMetrics.getMetrics('my-command');
      expect(metrics).toEqual({
        loadTime: 200,
        executionCount: 1,
        lastAccess: expect.any(Date),
      });
    });
  });

  describe('getAllMetrics', () => {
    it('should return empty array when no metrics recorded', () => {
      const all = LoadMetrics.getAllMetrics();
      expect(all).toEqual([]);
    });

    it('should return all recorded metrics', () => {
      LoadMetrics.recordLoad('cmd1', 100);
      LoadMetrics.recordLoad('cmd2', 200);
      LoadMetrics.recordLoad('cmd3', 300);

      const all = LoadMetrics.getAllMetrics();
      expect(all).toHaveLength(3);
      expect(all.map((m) => m.name)).toContain('cmd1');
      expect(all.map((m) => m.name)).toContain('cmd2');
      expect(all.map((m) => m.name)).toContain('cmd3');
    });

    it('should include all metric properties', () => {
      LoadMetrics.recordLoad('test', 150);

      const all = LoadMetrics.getAllMetrics();
      const metric = all[0];

      expect(metric).toHaveProperty('name', 'test');
      expect(metric).toHaveProperty('loadTime', 150);
      expect(metric).toHaveProperty('executionCount', 1);
      expect(metric).toHaveProperty('lastAccess');
    });
  });

  describe('report', () => {
    it('should not throw when no metrics', () => {
      expect(() => LoadMetrics.report()).not.toThrow();
    });

    it('should report metrics via verbose', async () => {
      const { verbose } = await import('@/utils/global-options');
      LoadMetrics.recordLoad('cmd1', 100);
      LoadMetrics.recordLoad('cmd2', 200);

      LoadMetrics.report();

      expect(verbose).toHaveBeenCalled();
    });
  });
});

describe('lazyCommand', () => {
  it('should create a placeholder command with correct name and description', () => {
    const cmd = lazyCommand({
      name: 'test',
      description: 'Test command',
      loader: async () => new Command('test'),
    });

    expect(cmd.name()).toBe('test');
    expect(cmd.description()).toBe('Test command');
  });

  it('should allow unknown options', () => {
    const cmd = lazyCommand({
      name: 'test',
      description: 'Test command',
      loader: async () => new Command('test'),
    });

    // allowUnknownOption should be enabled
    expect((cmd as any)._allowUnknownOption).toBe(true);
  });
});

describe('CommandCache', () => {
  beforeEach(() => {
    CommandCache.clear();
  });

  describe('getOrLoad', () => {
    it('should load command on first call', async () => {
      const mockCommand = new Command('test');
      const loader = vi.fn().mockResolvedValue(mockCommand);

      const result = await CommandCache.getOrLoad('test', loader);

      expect(result).toBe(mockCommand);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should return cached command on subsequent calls', async () => {
      const mockCommand = new Command('test');
      const loader = vi.fn().mockResolvedValue(mockCommand);

      await CommandCache.getOrLoad('test', loader);
      const result = await CommandCache.getOrLoad('test', loader);

      expect(result).toBe(mockCommand);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should not duplicate loading when called concurrently', async () => {
      const mockCommand = new Command('test');
      const loader = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockCommand), 50))
      );

      // Call concurrently
      const [result1, result2] = await Promise.all([
        CommandCache.getOrLoad('test', loader),
        CommandCache.getOrLoad('test', loader),
      ]);

      expect(result1).toBe(mockCommand);
      expect(result2).toBe(mockCommand);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should handle loader errors', async () => {
      const loader = vi.fn().mockRejectedValue(new Error('Load failed'));

      await expect(CommandCache.getOrLoad('test', loader)).rejects.toThrow('Load failed');
    });

    it('should clear loading promise on error', async () => {
      const loader = vi.fn()
        .mockRejectedValueOnce(new Error('First load failed'))
        .mockResolvedValueOnce(new Command('test'));

      // First call fails
      await expect(CommandCache.getOrLoad('test', loader)).rejects.toThrow();

      // Second call should retry
      const result = await CommandCache.getOrLoad('test', loader);
      expect(result).toBeDefined();
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe('preload', () => {
    it('should preload multiple commands', async () => {
      const cmd1 = new Command('cmd1');
      const cmd2 = new Command('cmd2');
      const loader1 = vi.fn().mockResolvedValue(cmd1);
      const loader2 = vi.fn().mockResolvedValue(cmd2);

      await CommandCache.preload([
        { name: 'cmd1', loader: loader1 },
        { name: 'cmd2', loader: loader2 },
      ]);

      expect(loader1).toHaveBeenCalled();
      expect(loader2).toHaveBeenCalled();
      expect(CommandCache.getSize()).toBe(2);
    });

    it('should handle errors during preload gracefully', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cmd1 = new Command('cmd1');
      const loader1 = vi.fn().mockResolvedValue(cmd1);
      const loader2 = vi.fn().mockRejectedValue(new Error('Preload failed'));

      await CommandCache.preload([
        { name: 'cmd1', loader: loader1 },
        { name: 'cmd2', loader: loader2 },
      ]);

      // Should not throw, but log error
      expect(errorSpy).toHaveBeenCalled();
      expect(CommandCache.getSize()).toBe(1);
      errorSpy.mockRestore();
    });
  });

  describe('clear', () => {
    it('should clear all cached commands', async () => {
      await CommandCache.getOrLoad('cmd1', async () => new Command('cmd1'));
      await CommandCache.getOrLoad('cmd2', async () => new Command('cmd2'));

      CommandCache.clear();

      expect(CommandCache.getSize()).toBe(0);
    });
  });

  describe('getSize', () => {
    it('should return 0 when empty', () => {
      expect(CommandCache.getSize()).toBe(0);
    });

    it('should return correct count', async () => {
      await CommandCache.getOrLoad('cmd1', async () => new Command('cmd1'));
      await CommandCache.getOrLoad('cmd2', async () => new Command('cmd2'));

      expect(CommandCache.getSize()).toBe(2);
    });
  });
});

describe('BatchCommandLoader', () => {
  describe('add', () => {
    it('should return this for chaining', () => {
      const loader = new BatchCommandLoader();
      const result = loader.add({
        name: 'test',
        description: 'Test',
        loader: async () => new Command('test'),
      });

      expect(result).toBe(loader);
    });

    it('should allow adding multiple commands', () => {
      const loader = new BatchCommandLoader();
      loader
        .add({ name: 'cmd1', description: 'Cmd 1', loader: async () => new Command('cmd1') })
        .add({ name: 'cmd2', description: 'Cmd 2', loader: async () => new Command('cmd2') })
        .add({ name: 'cmd3', description: 'Cmd 3', loader: async () => new Command('cmd3') });

      const placeholders = loader.createPlaceholders();
      expect(placeholders).toHaveLength(3);
    });
  });

  describe('loadAll', () => {
    it('should load all commands in batch', async () => {
      const loader = new BatchCommandLoader();
      const cmd1 = new Command('cmd1');
      const cmd2 = new Command('cmd2');

      loader
        .add({ name: 'cmd1', description: 'Cmd 1', loader: async () => cmd1 })
        .add({ name: 'cmd2', description: 'Cmd 2', loader: async () => cmd2 });

      const commands = await loader.loadAll();

      expect(commands).toHaveLength(2);
      expect(commands).toContain(cmd1);
      expect(commands).toContain(cmd2);
    });

    it('should record load metrics for each command', async () => {
      (LoadMetrics as any).metrics.clear();

      const loader = new BatchCommandLoader();
      loader.add({ name: 'batch-cmd', description: 'Batch', loader: async () => new Command('batch-cmd') });

      await loader.loadAll();

      const metrics = LoadMetrics.getMetrics('batch-cmd');
      expect(metrics).toBeDefined();
    });
  });

  describe('createPlaceholders', () => {
    it('should create lazy command placeholders', () => {
      const loader = new BatchCommandLoader();
      loader
        .add({ name: 'cmd1', description: 'Command 1', loader: async () => new Command('cmd1') })
        .add({ name: 'cmd2', description: 'Command 2', loader: async () => new Command('cmd2') });

      const placeholders = loader.createPlaceholders();

      expect(placeholders).toHaveLength(2);
      expect(placeholders[0].name()).toBe('cmd1');
      expect(placeholders[0].description()).toBe('Command 1');
      expect(placeholders[1].name()).toBe('cmd2');
      expect(placeholders[1].description()).toBe('Command 2');
    });
  });
});

describe('CommandOptimizer', () => {
  beforeEach(async () => {
    // Clear usage stats
    (CommandOptimizer as any).usageStats.clear();

    // Reset mocks
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readFile).mockReset();
    vi.mocked(fs.writeFile).mockReset();
  });

  describe('trackUsage', () => {
    it('should track command usage', () => {
      CommandOptimizer.trackUsage('test-cmd');

      const frequent = CommandOptimizer.getFrequentCommands(1);
      expect(frequent).toContain('test-cmd');
    });

    it('should increment usage count', () => {
      CommandOptimizer.trackUsage('test-cmd');
      CommandOptimizer.trackUsage('test-cmd');
      CommandOptimizer.trackUsage('test-cmd');

      const frequent = CommandOptimizer.getFrequentCommands(3);
      expect(frequent).toContain('test-cmd');
    });

    it('should save stats after tracking', async () => {
      const fs = await import('node:fs/promises');
      CommandOptimizer.trackUsage('test-cmd');

      // Give time for async save
      await new Promise((r) => setTimeout(r, 10));

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('getFrequentCommands', () => {
    it('should return commands above threshold', () => {
      CommandOptimizer.trackUsage('frequent');
      CommandOptimizer.trackUsage('frequent');
      CommandOptimizer.trackUsage('frequent');
      CommandOptimizer.trackUsage('rare');

      const frequent = CommandOptimizer.getFrequentCommands(3);
      expect(frequent).toContain('frequent');
      expect(frequent).not.toContain('rare');
    });

    it('should sort by usage count descending', () => {
      CommandOptimizer.trackUsage('low');
      CommandOptimizer.trackUsage('low');
      CommandOptimizer.trackUsage('low');
      CommandOptimizer.trackUsage('high');
      CommandOptimizer.trackUsage('high');
      CommandOptimizer.trackUsage('high');
      CommandOptimizer.trackUsage('high');
      CommandOptimizer.trackUsage('high');

      const frequent = CommandOptimizer.getFrequentCommands(3);
      expect(frequent[0]).toBe('high');
      expect(frequent[1]).toBe('low');
    });

    it('should return empty array when no commands meet threshold', () => {
      CommandOptimizer.trackUsage('cmd');

      const frequent = CommandOptimizer.getFrequentCommands(5);
      expect(frequent).toEqual([]);
    });
  });

  describe('loadStats', () => {
    it('should load stats from file', async () => {
      const fs = await import('node:fs/promises');
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'loaded-cmd': 5 }));

      await CommandOptimizer.loadStats();

      const frequent = CommandOptimizer.getFrequentCommands(1);
      expect(frequent).toContain('loaded-cmd');
    });

    it('should handle missing stats file gracefully', async () => {
      const fs = await import('node:fs/promises');
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      await expect(CommandOptimizer.loadStats()).resolves.not.toThrow();
    });

    it('should handle invalid JSON gracefully', async () => {
      const fs = await import('node:fs/promises');
      vi.mocked(fs.readFile).mockResolvedValue('invalid json');

      await expect(CommandOptimizer.loadStats()).resolves.not.toThrow();
    });
  });

  describe('getPreloadRecommendations', () => {
    it('should return top 3 frequent commands', () => {
      // Add commands with different frequencies
      for (let i = 0; i < 10; i++) CommandOptimizer.trackUsage('cmd1');
      for (let i = 0; i < 8; i++) CommandOptimizer.trackUsage('cmd2');
      for (let i = 0; i < 6; i++) CommandOptimizer.trackUsage('cmd3');
      for (let i = 0; i < 4; i++) CommandOptimizer.trackUsage('cmd4');
      for (let i = 0; i < 2; i++) CommandOptimizer.trackUsage('cmd5');

      const recommendations = CommandOptimizer.getPreloadRecommendations();

      expect(recommendations).toHaveLength(3);
      expect(recommendations[0]).toBe('cmd1');
      expect(recommendations[1]).toBe('cmd2');
      expect(recommendations[2]).toBe('cmd3');
    });

    it('should return fewer if less commands are frequent', () => {
      for (let i = 0; i < 5; i++) CommandOptimizer.trackUsage('cmd1');

      const recommendations = CommandOptimizer.getPreloadRecommendations();

      expect(recommendations.length).toBeLessThanOrEqual(3);
    });
  });
});

describe('createCommandLoaders', () => {
  it('should return a Map of command loaders', () => {
    const loaders = createCommandLoaders();

    expect(loaders).toBeInstanceOf(Map);
    expect(loaders.size).toBeGreaterThan(0);
  });

  it('should include init command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('init')).toBe(true);
    const init = loaders.get('init');
    expect(init?.name).toBe('init');
    expect(init?.description).toBeDefined();
    expect(init?.loader).toBeInstanceOf(Function);
  });

  it('should include migrate command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('migrate')).toBe(true);
  });

  it('should include health command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('health')).toBe(true);
  });

  it('should include audit command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('audit')).toBe(true);
  });

  it('should include generate command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('generate')).toBe(true);
  });

  it('should include db command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('db')).toBe(true);
  });

  it('should include debug command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('debug')).toBe(true);
  });

  it('should include query command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('query')).toBe(true);
  });

  it('should include repository command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('repository')).toBe(true);
  });

  it('should include test command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('test')).toBe(true);
  });

  it('should include plugin command', () => {
    const loaders = createCommandLoaders();

    expect(loaders.has('plugin')).toBe(true);
  });

  it('should have valid loader functions', () => {
    const loaders = createCommandLoaders();

    for (const [name, config] of loaders) {
      expect(config.name).toBe(name);
      expect(typeof config.description).toBe('string');
      expect(typeof config.loader).toBe('function');
    }
  });
});
