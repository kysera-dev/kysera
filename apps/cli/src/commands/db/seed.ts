import { Command } from 'commander';
import { prism, spinner } from '@xec-sh/kit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CLIError } from '../../utils/errors.js';
import { getDatabaseConnection } from '../../utils/database.js';
import { loadConfig } from '../../config/loader.js';
import { logger } from '../../utils/logger.js';
import { SeedRunner, type SeedRunnerOptions, type SeedHooks } from './seed-runner.js';
import { sql } from 'kysely';

export interface SeedOptions {
  file?: string;
  directory?: string;
  fresh?: boolean;
  dryRun?: boolean;
  transaction?: boolean;
  config?: string;
  verbose?: boolean;
}

export function seedCommand(): Command {
  const cmd = new Command('seed')
    .description('Run database seeders')
    .option('-f, --file <path>', 'Specific seed file to run')
    .option('-d, --directory <path>', 'Seed files directory', './seeds')
    .option('--fresh', 'Truncate tables before seeding', false)
    .option('--dry-run', 'Show what would be executed without making changes', false)
    .option('--transaction', 'Run all seeds in a single transaction', false)
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (options: SeedOptions) => {
      try {
        await runSeeds(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to run seeds: ${error instanceof Error ? error.message : String(error)}`,
          'SEED_ERROR'
        );
      }
    });

  return cmd;
}

async function runSeeds(options: SeedOptions): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config);

  if (!config?.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', undefined, [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option',
    ]);
  }

  // Get database connection
  const db = await getDatabaseConnection(config.database);

  if (!db) {
    throw new CLIError('Failed to connect to database', 'DATABASE_ERROR', undefined, [
      'Check your database configuration',
      'Ensure the database server is running',
    ]);
  }

  const seedSpinner = spinner() as any;

  try {
    // Determine seeds directory
    const seedDir = options.directory || config.testing?.seeds || './seeds';

    // Fresh option - truncate tables
    if (options.fresh && !options.dryRun) {
      seedSpinner.start('Truncating tables...');

      try {
        // Get all tables
        let tables: string[] = [];

        if (config.database.dialect === 'postgres') {
          const result = (await db
            .selectFrom('information_schema.tables')
            .select('table_name')
            .where('table_schema', '=', 'public')
            .where('table_type', '=', 'BASE TABLE')
            .execute()) as any[];
          tables = result.map((r) => r.table_name);
        } else if (config.database.dialect === 'mysql') {
          const result = (await db
            .selectFrom('information_schema.tables')
            .select('table_name')
            .where('table_schema', '=', db.fn('DATABASE'))
            .execute()) as any[];
          tables = result.map((r) => r.table_name || r.TABLE_NAME);
        } else if (config.database.dialect === 'sqlite') {
          const result = (await db
            .selectFrom('sqlite_master')
            .select('name')
            .where('type', '=', 'table')
            .where('name', 'not like', 'sqlite_%')
            .where('name', 'not like', 'kysera_%') // Skip migration tables
            .execute()) as any[];
          tables = result.map((r) => r.name);
        }

        // Truncate each table
        for (const table of tables) {
          if (options.verbose) {
            logger.debug(`Truncating table: ${table}`);
          }

          if (config.database.dialect === 'sqlite') {
            await db.deleteFrom(table).execute();
          } else {
            await sql`TRUNCATE TABLE ${sql.id(table)} CASCADE`.execute(db);
          }
        }

        seedSpinner.succeed(`Truncated ${tables.length} table${tables.length !== 1 ? 's' : ''}`);
      } catch (error) {
        seedSpinner.fail('Failed to truncate tables');
        throw error;
      }
    } else if (options.fresh && options.dryRun) {
      logger.info('[DRY RUN] Would truncate all tables before seeding');
    }

    // Create seed hooks for logging
    const hooks: SeedHooks = {
      beforeAll: async () => {
        if (options.verbose) {
          logger.debug('Starting seed execution...');
        }
      },
      afterAll: async (_, result) => {
        if (options.verbose && result.executed.length > 0) {
          logger.debug(`Seeds completed: ${result.executed.join(', ')}`);
        }
      },
    };

    // Create seed runner
    const seedRunner = new SeedRunner(db, seedDir, hooks);

    // Prepare runner options
    const runnerOptions: SeedRunnerOptions = {
      file: options.file,
      directory: options.directory,
      dryRun: options.dryRun,
      verbose: options.verbose,
      transaction: options.transaction,
      fresh: options.fresh,
    };

    // Run seeds
    seedSpinner.start('Running seeds...');
    const result = await seedRunner.run(runnerOptions);

    // Display results
    if (result.executed.length > 0 || result.skipped.length > 0) {
      seedSpinner.succeed(`Seeding completed (${result.duration}ms)`);
    } else if (result.failed.length > 0) {
      seedSpinner.fail('Seeding completed with errors');
    } else {
      seedSpinner.warn('No seed files found');
    }

    // Summary
    logger.info('');

    if (result.executed.length > 0) {
      logger.info(prism.green(`Executed ${result.executed.length} seed${result.executed.length !== 1 ? 's' : ''} successfully`));
    }

    if (result.skipped.length > 0) {
      logger.info(prism.yellow(`Skipped ${result.skipped.length} seed${result.skipped.length !== 1 ? 's' : ''} (dry-run)`));
    }

    if (result.failed.length > 0) {
      logger.warn(`Failed ${result.failed.length} seed${result.failed.length !== 1 ? 's' : ''}:`);
      for (const failed of result.failed) {
        logger.error(`  - ${failed.name}: ${failed.error}`);
      }
    }

  } finally {
    // Close database connection
    await db.destroy();
  }
}

/**
 * Example seed file structure:
 *
 * // seeds/01_users.ts
 * import { Kysely } from 'kysely';
 * import type { SeedContext } from '@kysera/cli';
 *
 * export async function seed(db: Kysely<any>, context?: SeedContext): Promise<void> {
 *   const { factory, verbose, logger } = context || {};
 *
 *   // Using factory pattern
 *   const users = factory?.createMany(10, (i) => ({
 *     name: `User ${i + 1}`,
 *     email: `user${i + 1}@example.com`,
 *   })) || [];
 *
 *   await db.insertInto('users').values(users).execute();
 *
 *   if (verbose) {
 *     logger?.debug(`Created ${users.length} users`);
 *   }
 * }
 *
 * // Optional: Set explicit order (default is based on filename)
 * export const order = 1;
 *
 * // Optional: Declare dependencies
 * export const dependencies = [];
 */
