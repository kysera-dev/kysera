import { Command } from 'commander';
import { verbose } from './global-options.js';

/**
 * Command loader configuration
 */
export interface LazyCommand {
  name: string;
  description: string;
  loader: () => Promise<Command>;
}

/**
 * Performance metrics for command loading
 */
export class LoadMetrics {
  private static metrics = new Map<
    string,
    {
      loadTime: number;
      executionCount: number;
      lastAccess: Date;
    }
  >();

  /**
   * Record command load time
   */
  static recordLoad(command: string, loadTime: number): void {
    const existing = this.metrics.get(command);
    this.metrics.set(command, {
      loadTime,
      executionCount: (existing?.executionCount || 0) + 1,
      lastAccess: new Date(),
    });
  }

  /**
   * Get metrics for a command
   */
  static getMetrics(command: string) {
    return this.metrics.get(command);
  }

  /**
   * Get all metrics
   */
  static getAllMetrics() {
    return Array.from(this.metrics.entries()).map(([name, data]) => ({
      name,
      ...data,
    }));
  }

  /**
   * Report performance metrics
   */
  static report(): void {
    const metrics = this.getAllMetrics();
    if (metrics.length === 0) return;

    verbose('Command Load Performance:');
    metrics.forEach((m) => {
      verbose(`  ${m.name}: ${m.loadTime}ms (used ${m.executionCount} times)`);
    });
  }
}

/**
 * Create a lazy-loaded command
 */
export function lazyCommand(config: LazyCommand): Command {
  const placeholderCommand = new Command(config.name)
    .description(config.description)
    .allowUnknownOption(true)
    .action(async function (this: Command, ...args: any[]) {
      const startTime = Date.now();

      // Load the actual command
      verbose(`Loading command: ${config.name}`);
      const actualCommand = await config.loader();

      const loadTime = Date.now() - startTime;
      LoadMetrics.recordLoad(config.name, loadTime);
      verbose(`Command loaded in ${loadTime}ms`);

      // Note: We cannot replace the placeholder command in the parent's command list
      // because it's a readonly array. Instead, the actualCommand will be used directly
      // when we re-parse below.

      // Re-parse with the actual command
      const commandArgs = [config.name, ...process.argv.slice(3)];
      await actualCommand.parseAsync(commandArgs, { from: 'user' });
    });

  return placeholderCommand;
}

/**
 * Command cache for frequently used commands
 */
export class CommandCache {
  private static cache = new Map<string, Command>();
  private static loadPromises = new Map<string, Promise<Command>>();

  /**
   * Get or load a command
   */
  static async getOrLoad(name: string, loader: () => Promise<Command>): Promise<Command> {
    // Check cache
    const cached = this.cache.get(name);
    if (cached) {
      verbose(`Command ${name} loaded from cache`);
      return cached;
    }

    // Check if already loading
    const loading = this.loadPromises.get(name);
    if (loading) {
      verbose(`Waiting for command ${name} to load`);
      return loading;
    }

    // Start loading
    const loadPromise = loader()
      .then((command) => {
        this.cache.set(name, command);
        this.loadPromises.delete(name);
        return command;
      })
      .catch((error) => {
        this.loadPromises.delete(name);
        throw error;
      });

    this.loadPromises.set(name, loadPromise);
    return loadPromise;
  }

  /**
   * Preload frequently used commands
   */
  static async preload(commands: Array<{ name: string; loader: () => Promise<Command> }>): Promise<void> {
    const preloadPromises = commands.map((cmd) =>
      this.getOrLoad(cmd.name, cmd.loader).catch((err) => {
        console.error(`Failed to preload command ${cmd.name}:`, err);
      })
    );

    await Promise.all(preloadPromises);
  }

  /**
   * Clear cache
   */
  static clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  static getSize(): number {
    return this.cache.size;
  }
}

/**
 * Batch command loader for related commands
 */
export class BatchCommandLoader {
  private commands: LazyCommand[] = [];

  /**
   * Add a command to the batch
   */
  add(command: LazyCommand): this {
    this.commands.push(command);
    return this;
  }

  /**
   * Load all commands in the batch
   */
  async loadAll(): Promise<Command[]> {
    const startTime = Date.now();
    verbose(`Loading batch of ${this.commands.length} commands`);

    const loadPromises = this.commands.map(async (cmd) => {
      const command = await cmd.loader();
      LoadMetrics.recordLoad(cmd.name, Date.now() - startTime);
      return command;
    });

    const commands = await Promise.all(loadPromises);
    verbose(`Batch loaded in ${Date.now() - startTime}ms`);

    return commands;
  }

  /**
   * Create placeholder commands for the batch
   */
  createPlaceholders(): Command[] {
    return this.commands.map((cmd) => lazyCommand(cmd));
  }
}

/**
 * Optimize command loading based on usage patterns
 */
export class CommandOptimizer {
  private static readonly USAGE_FILE = '.kysera-usage-stats.json';
  private static usageStats: Map<string, number> = new Map();

  /**
   * Track command usage
   */
  static trackUsage(command: string): void {
    const count = this.usageStats.get(command) || 0;
    this.usageStats.set(command, count + 1);
    this.saveStats();
  }

  /**
   * Get frequently used commands
   */
  static getFrequentCommands(threshold = 3): string[] {
    return Array.from(this.usageStats.entries())
      .filter(([_, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }

  /**
   * Load usage statistics
   */
  static async loadStats(): Promise<void> {
    try {
      const { readFile } = await import('node:fs/promises');
      const data = await readFile(this.USAGE_FILE, 'utf-8');
      const stats = JSON.parse(data);
      this.usageStats = new Map(Object.entries(stats));
    } catch (error) {
      const { logger } = await import('./logger.js');
      logger.debug('Failed to load command usage stats:', error);
    }
  }

  /**
   * Save usage statistics
   */
  private static async saveStats(): Promise<void> {
    try {
      const { writeFile } = await import('node:fs/promises');
      const stats = Object.fromEntries(this.usageStats);
      await writeFile(this.USAGE_FILE, JSON.stringify(stats, null, 2));
    } catch (error) {
      const { logger } = await import('./logger.js');
      logger.debug('Failed to save command usage stats:', error);
    }
  }

  /**
   * Get preload recommendations
   */
  static getPreloadRecommendations(): string[] {
    const frequent = this.getFrequentCommands();
    // Preload top 3 most frequently used commands
    return frequent.slice(0, 3);
  }
}

/**
 * Create optimized command loaders
 */
export function createCommandLoaders(): Map<string, LazyCommand> {
  return new Map([
    [
      'init',
      {
        name: 'init',
        description: 'Initialize a new Kysera project',
        loader: async () => (await import('../commands/init/index.js')).initCommand(),
      },
    ],
    [
      'migrate',
      {
        name: 'migrate',
        description: 'Database migration management',
        loader: async () => (await import('../commands/migrate/index.js')).migrateCommand(),
      },
    ],
    [
      'health',
      {
        name: 'health',
        description: 'Database health monitoring',
        loader: async () => (await import('../commands/health/index.js')).healthCommand(),
      },
    ],
    [
      'audit',
      {
        name: 'audit',
        description: 'Audit logging and history',
        loader: async () => (await import('../commands/audit/index.js')).auditCommand(),
      },
    ],
    [
      'generate',
      {
        name: 'generate',
        description: 'Code generation utilities',
        loader: async () => (await import('../commands/generate/index.js')).generateCommand(),
      },
    ],
    [
      'db',
      {
        name: 'db',
        description: 'Database management utilities',
        loader: async () => (await import('../commands/db/index.js')).dbCommand(),
      },
    ],
    [
      'debug',
      {
        name: 'debug',
        description: 'Debug and diagnostic utilities',
        loader: async () => (await import('../commands/debug/index.js')).debugCommand(),
      },
    ],
    [
      'query',
      {
        name: 'query',
        description: 'Query utilities and analysis',
        loader: async () => (await import('../commands/query/index.js')).queryCommand(),
      },
    ],
    [
      'repository',
      {
        name: 'repository',
        description: 'Repository pattern utilities',
        loader: async () => (await import('../commands/repository/index.js')).repositoryCommand(),
      },
    ],
    [
      'test',
      {
        name: 'test',
        description: 'Test environment management',
        loader: async () => (await import('../commands/test/index.js')).testCommand(),
      },
    ],
    [
      'plugin',
      {
        name: 'plugin',
        description: 'Plugin management',
        loader: async () => (await import('../commands/plugin/index.js')).pluginCommand(),
      },
    ],
  ]);
}
