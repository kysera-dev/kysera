import { Kysely } from 'kysely';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prism } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';

/**
 * Seed file interface - defines the contract for seed files
 */
export interface SeedFile {
  /** Name of the seed (derived from filename) */
  name: string;
  /** Full path to the seed file */
  path: string;
  /** Order priority (extracted from filename or explicit) */
  order: number;
}

/**
 * Seed module interface - defines what a seed file must export
 */
export interface SeedModule {
  /** Main seed function */
  seed: (db: Kysely<any>, context?: SeedContext) => Promise<void>;
  /** Optional order override */
  order?: number;
  /** Optional dependencies (other seed names that must run first) */
  dependencies?: string[];
}

/**
 * Context passed to seed functions
 */
export interface SeedContext {
  /** Whether this is a dry run */
  dryRun: boolean;
  /** Verbose logging enabled */
  verbose: boolean;
  /** Factory helper for generating test data */
  factory: SeedFactory;
  /** Logger instance */
  logger: typeof logger;
}

/**
 * Factory helper for generating seed data
 */
export interface SeedFactory {
  /** Create multiple records */
  createMany: <T>(count: number, generator: (index: number) => T) => T[];
  /** Create a single record */
  create: <T>(generator: () => T) => T;
  /** Generate a sequence of values */
  sequence: (start?: number) => () => number;
  /** Pick random item from array */
  pick: <T>(items: T[]) => T;
  /** Pick multiple random items from array */
  pickMany: <T>(items: T[], count: number) => T[];
}

/**
 * Seed runner options
 */
export interface SeedRunnerOptions {
  /** Directory containing seed files */
  directory?: string;
  /** Specific seed file to run */
  file?: string;
  /** Run in dry-run mode (no actual changes) */
  dryRun?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Run seeds in a transaction */
  transaction?: boolean;
  /** Truncate tables before seeding */
  fresh?: boolean;
}

/**
 * Seed execution result
 */
export interface SeedResult {
  /** Seeds that were executed */
  executed: string[];
  /** Seeds that were skipped */
  skipped: string[];
  /** Seeds that failed */
  failed: Array<{ name: string; error: string }>;
  /** Total execution time in milliseconds */
  duration: number;
}

/**
 * Seed hooks
 */
export interface SeedHooks {
  /** Called before each seed runs */
  beforeSeed?: (name: string, db: Kysely<any>) => Promise<void>;
  /** Called after each seed completes */
  afterSeed?: (name: string, db: Kysely<any>, success: boolean) => Promise<void>;
  /** Called before all seeds run */
  beforeAll?: (db: Kysely<any>) => Promise<void>;
  /** Called after all seeds complete */
  afterAll?: (db: Kysely<any>, result: SeedResult) => Promise<void>;
}

/**
 * SeedRunner - Executes database seed files
 *
 * Supports:
 * - TypeScript and JavaScript seed files
 * - Transaction support for atomic seeding
 * - Dry-run mode for testing
 * - Verbose logging
 * - Factory patterns for test data generation
 * - Hooks for extensibility
 */
export class SeedRunner {
  private db: Kysely<any>;
  private seedsDir: string;
  private hooks: SeedHooks;

  constructor(db: Kysely<any>, seedsDir: string = './seeds', hooks: SeedHooks = {}) {
    this.db = db;
    this.seedsDir = resolve(process.cwd(), seedsDir);
    this.hooks = hooks;
  }

  /**
   * Run all seeds or a specific seed file
   */
  async run(options: SeedRunnerOptions = {}): Promise<SeedResult> {
    const startTime = Date.now();
    const result: SeedResult = {
      executed: [],
      skipped: [],
      failed: [],
      duration: 0,
    };

    try {
      // Get seed files to run
      const seedFiles = await this.getSeedFiles(options);

      if (seedFiles.length === 0) {
        logger.info('No seed files found');
        result.duration = Date.now() - startTime;
        return result;
      }

      // Call beforeAll hook
      if (this.hooks.beforeAll) {
        await this.hooks.beforeAll(this.db);
      }

      // Create factory helper
      const factory = this.createFactory();

      // Create seed context
      const context: SeedContext = {
        dryRun: options.dryRun || false,
        verbose: options.verbose || false,
        factory,
        logger,
      };

      // Run seeds
      if (options.transaction) {
        // Run all seeds in a single transaction
        await this.runInTransaction(seedFiles, context, result, options);
      } else {
        // Run each seed in its own transaction
        await this.runIndividually(seedFiles, context, result, options);
      }

      // Call afterAll hook
      if (this.hooks.afterAll) {
        await this.hooks.afterAll(this.db, result);
      }
    } catch (error: any) {
      logger.error('Seed runner error: ' + error.message);
      throw error;
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Get seed files to execute
   */
  async getSeedFiles(options: SeedRunnerOptions): Promise<SeedFile[]> {
    const seedFiles: SeedFile[] = [];

    if (options.file) {
      // Run specific seed file
      const filePath = resolve(process.cwd(), options.file);
      if (!existsSync(filePath)) {
        throw new CLIError('Seed file not found: ' + options.file, 'FILE_NOT_FOUND');
      }
      seedFiles.push({
        name: basename(filePath).replace(/\.(ts|js|mjs)$/, ''),
        path: filePath,
        order: 0,
      });
    } else {
      // Get all seed files from directory
      const dir = options.directory ? resolve(process.cwd(), options.directory) : this.seedsDir;

      if (!existsSync(dir)) {
        throw new CLIError('Seeds directory not found: ' + dir, 'DIRECTORY_NOT_FOUND', undefined, [
          'Create a seeds directory: mkdir ' + dir,
          'Or specify a different directory with --directory',
        ]);
      }

      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mjs'))
        .sort();

      for (const file of files) {
        const order = this.extractOrder(file);
        seedFiles.push({
          name: file.replace(/\.(ts|js|mjs)$/, ''),
          path: join(dir, file),
          order,
        });
      }
    }

    // Sort by order
    return seedFiles.sort((a, b) => a.order - b.order);
  }

  /**
   * Extract order from filename (e.g., "01_users.ts" -> 1)
   */
  private extractOrder(filename: string): number {
    const match = filename.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 999;
  }

  /**
   * Load a seed module
   */
  async loadSeedModule(file: SeedFile): Promise<SeedModule> {
    try {
      const fileUrl = pathToFileURL(file.path).href;
      const module = await import(fileUrl);

      if (!module.seed || typeof module.seed !== 'function') {
        throw new Error("Seed file must export a 'seed' function");
      }

      return {
        seed: module.seed,
        order: module.order,
        dependencies: module.dependencies,
      };
    } catch (error: any) {
      throw new CLIError('Failed to load seed ' + file.name + ': ' + error.message, 'SEED_LOAD_ERROR');
    }
  }

  /**
   * Run seeds in a single transaction
   */
  private async runInTransaction(
    seedFiles: SeedFile[],
    context: SeedContext,
    result: SeedResult,
    options: SeedRunnerOptions
  ): Promise<void> {
    if (options.dryRun) {
      logger.info('[DRY RUN] Would run seeds in transaction:');
      for (const file of seedFiles) {
        logger.info('  ' + prism.cyan('->') + ' ' + file.name);
        result.skipped.push(file.name);
      }
      return;
    }

    try {
      await this.db.transaction().execute(async (trx) => {
        for (const file of seedFiles) {
          await this.executeSeed(file, trx, context, result, options);
        }
      });
    } catch (error: any) {
      logger.error('Transaction rolled back: ' + error.message);
      throw error;
    }
  }

  /**
   * Run each seed individually (with its own transaction)
   */
  private async runIndividually(
    seedFiles: SeedFile[],
    context: SeedContext,
    result: SeedResult,
    options: SeedRunnerOptions
  ): Promise<void> {
    for (const file of seedFiles) {
      if (options.dryRun) {
        logger.info('[DRY RUN] Would run: ' + file.name);
        result.skipped.push(file.name);
        continue;
      }

      try {
        await this.db.transaction().execute(async (trx) => {
          await this.executeSeed(file, trx, context, result, options);
        });
      } catch (error: any) {
        result.failed.push({ name: file.name, error: error.message });
        logger.error(prism.red('x') + ' ' + file.name + ': ' + error.message);

        // Continue with other seeds unless in strict mode
        if (options.verbose) {
          logger.error(error.stack);
        }
      }
    }
  }

  /**
   * Execute a single seed
   */
  private async executeSeed(
    file: SeedFile,
    db: Kysely<any>,
    context: SeedContext,
    result: SeedResult,
    options: SeedRunnerOptions
  ): Promise<void> {
    const seedStart = Date.now();

    // Call beforeSeed hook
    if (this.hooks.beforeSeed) {
      await this.hooks.beforeSeed(file.name, db);
    }

    let success = false;

    try {
      if (options.verbose) {
        logger.debug('Running seed: ' + file.name);
      }

      const module = await this.loadSeedModule(file);
      await module.seed(db, context);

      const duration = Date.now() - seedStart;
      logger.info(prism.green('v') + ' ' + file.name + ' (' + duration + 'ms)');
      result.executed.push(file.name);
      success = true;
    } catch (error: any) {
      const duration = Date.now() - seedStart;
      logger.error(prism.red('x') + ' ' + file.name + ' (' + duration + 'ms)');
      throw error;
    } finally {
      // Call afterSeed hook
      if (this.hooks.afterSeed) {
        await this.hooks.afterSeed(file.name, db, success);
      }
    }
  }

  /**
   * Create factory helper for generating test data
   */
  private createFactory(): SeedFactory {
    return {
      createMany: <T>(count: number, generator: (index: number) => T): T[] => {
        return Array.from({ length: count }, (_, i) => generator(i));
      },

      create: <T>(generator: () => T): T => {
        return generator();
      },

      sequence: (start = 1) => {
        let current = start;
        return () => current++;
      },

      pick: <T>(items: T[]): T => {
        return items[Math.floor(Math.random() * items.length)];
      },

      pickMany: <T>(items: T[], count: number): T[] => {
        const shuffled = [...items].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.min(count, items.length));
      },
    };
  }

  /**
   * Get seed status (which seeds have been run)
   * This is a placeholder - in a real implementation, you might track
   * seed execution in a database table similar to migrations
   */
  async getSeedStatus(): Promise<Array<{ name: string; executedAt?: Date }>> {
    const files = await this.getSeedFiles({});
    return files.map((f) => ({ name: f.name }));
  }
}

/**
 * Create a seed runner instance
 */
export function createSeedRunner(db: Kysely<any>, seedsDir?: string, hooks?: SeedHooks): SeedRunner {
  return new SeedRunner(db, seedsDir, hooks);
}

/**
 * Helper to define seed with type checking
 */
export function defineSeed(
  seedFn: (db: Kysely<any>, context?: SeedContext) => Promise<void>,
  options?: { order?: number; dependencies?: string[] }
): SeedModule {
  return {
    seed: seedFn,
    order: options?.order,
    dependencies: options?.dependencies,
  };
}
