import { Command } from 'commander';
import { prism, confirm } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { MigrationRunner } from './runner.js';
import { getDatabaseConnection } from '../../utils/database.js';
import { loadConfig } from '../../config/loader.js';
import { SeedRunner } from '../db/seed-runner.js';

export interface ResetOptions {
  force?: boolean;
  run?: boolean; // Re-run migrations after reset
  seed?: boolean;
  config?: string;
  verbose?: boolean;
}

export function resetCommand(): Command {
  const cmd = new Command('reset')
    .description('Reset all migrations (dangerous!)')
    .option('--force', 'Skip confirmation prompt')
    .option('--run', 'Re-run migrations after reset')
    .option('--seed', 'Run seeds after reset')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (options: ResetOptions) => {
      try {
        await resetMigrations(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to reset migrations: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_RESET_ERROR'
        );
      }
    });

  return cmd;
}

export function freshCommand(): Command {
  const cmd = new Command('fresh')
    .description('Drop all tables and re-run migrations')
    .option('--seed', 'Run seeds after migration')
    .option('--force', 'Skip confirmation prompt')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (options: ResetOptions) => {
      try {
        await freshMigrations(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to run fresh migrations: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_FRESH_ERROR'
        );
      }
    });

  return cmd;
}

async function resetMigrations(options: ResetOptions): Promise<void> {
  if (!options.force && !options.run) {
    if (process.env.NODE_ENV === 'test' || !process.stdin.isTTY) {
      throw new CLIError('Reset requires confirmation', 'RESET_REQUIRES_CONFIRMATION', undefined, [
        'Use --force flag to skip confirmation',
      ]);
    }

    console.log('');
    console.log(prism.red('Warning: This will rollback ALL migrations!'));
    console.log(prism.yellow('All data in migrated tables may be lost.'));
    console.log('');

    const confirmed = await confirm({
      message: 'Are you sure you want to continue?',
      initialValue: false,
    });

    if (!confirmed) {
      logger.info('Reset cancelled');
      return;
    }
  } else if (!options.force && options.run) {
    if (!(process.env.NODE_ENV === 'test' || !process.stdin.isTTY)) {
      console.log('');
      console.log(prism.red('Warning: This will rollback ALL migrations and re-run them!'));
      console.log(prism.yellow('All data in migrated tables may be lost.'));
      console.log('');

      const confirmed = await confirm({
        message: 'Are you sure you want to continue?',
        initialValue: false,
      });

      if (!confirmed) {
        logger.info('Reset cancelled');
        return;
      }
    }
  }

  const config = await loadConfig(options.config);

  if (!config?.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', undefined, [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option',
    ]);
  }

  const db = await getDatabaseConnection(config.database);

  if (!db) {
    throw new CLIError('Failed to connect to database', 'DATABASE_ERROR', undefined, [
      'Check your database configuration',
      'Ensure the database server is running',
    ]);
  }

  const migrationsDir = config.migrations?.directory || './migrations';
  const tableName = config.migrations?.tableName || 'kysera_migrations';

  const runner = new MigrationRunner(db, migrationsDir, tableName);

  let releaseLock: (() => Promise<void>) | null = null;

  try {
    try {
      releaseLock = await runner.acquireLock();
    } catch (error: any) {
      if (error.code === 'MIGRATION_LOCKED') {
        throw new CLIError('Migrations are already running in another process', 'MIGRATION_LOCKED', undefined, [
          'Wait for the other process to complete',
          'Or check for stuck locks in the database',
        ]);
      }
      logger.debug('Could not acquire migration lock, continuing without lock');
    }

    logger.info('Resetting all migrations...');

    const { rolledBack, duration } = await runner.reset({
      force: options.force,
      seed: options.seed,
    });

    if (rolledBack.length > 0) {
      logger.info('');
      logger.info(
        prism.green(
          `Reset complete: ${rolledBack.length} migration${rolledBack.length > 1 ? 's' : ''} rolled back (${duration}ms)`
        )
      );
    } else {
      logger.info('No migrations to reset');
    }

    if (options.run) {
      logger.info('');
      logger.info('Running migrations');
      const { executed } = await runner.up({ verbose: options.verbose });
      if (executed.length > 0) {
        logger.info(
          prism.green(`${executed.length} migration${executed.length > 1 ? 's' : ''} completed successfully`)
        );
      }
    }

    if (options.seed) {
      logger.info('');
      logger.info('Running seeds...');

      try {
        const seedsDir = config.testing?.seeds || './seeds';
        const seedRunner = new SeedRunner(db, seedsDir);

        const seedResult = await seedRunner.run({
          verbose: options.verbose,
          transaction: false,
        });

        if (seedResult.executed.length > 0) {
          logger.info('');
          logger.info(
            prism.green(
              `${seedResult.executed.length} seed${seedResult.executed.length > 1 ? 's' : ''} completed successfully (${seedResult.duration}ms)`
            )
          );
        } else if (seedResult.failed.length > 0) {
          logger.warn(
            `${seedResult.failed.length} seed${seedResult.failed.length > 1 ? 's' : ''} failed`
          );
          for (const failed of seedResult.failed) {
            logger.error(`  - ${failed.name}: ${failed.error}`);
          }
        } else {
          logger.info('No seeds found to run');
        }
      } catch (seedError: any) {
        logger.error(`Failed to run seeds: ${seedError.message}`);
        if (options.verbose) {
          logger.error(seedError.stack);
        }
        logger.warn('Migration reset completed, but seeding failed');
      }
    }
  } finally {
    if (releaseLock) {
      await releaseLock();
    }
    await db.destroy();
  }
}

async function freshMigrations(options: ResetOptions): Promise<void> {
  if (!options.force) {
    if (process.env.NODE_ENV === 'test' || !process.stdin.isTTY) {
      throw new CLIError('Fresh requires confirmation', 'FRESH_REQUIRES_CONFIRMATION', undefined, [
        'Use --force flag to skip confirmation',
      ]);
    }

    console.log('');
    console.log(prism.red('WARNING: This will DROP ALL TABLES and re-run migrations!'));
    console.log(prism.red('ALL DATA WILL BE LOST!'));
    console.log('');

    const confirmed = await confirm({
      message: 'Are you absolutely sure you want to continue?',
      initialValue: false,
    });

    if (!confirmed) {
      logger.info('Fresh cancelled');
      return;
    }

    const doubleConfirm = await confirm({
      message: prism.red('This action cannot be undone. Are you REALLY sure?'),
      initialValue: false,
    });

    if (!doubleConfirm) {
      logger.info('Fresh cancelled');
      return;
    }
  }

  const config = await loadConfig(options.config);

  if (!config?.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', undefined, [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option',
    ]);
  }

  const db = await getDatabaseConnection(config.database);

  if (!db) {
    throw new CLIError('Failed to connect to database', 'DATABASE_ERROR', undefined, [
      'Check your database configuration',
      'Ensure the database server is running',
    ]);
  }

  try {
    logger.info('Dropping all tables...');

    let tables: string[] = [];

    if (config.database.dialect === 'postgres') {
      const result = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', 'public')
        .where('table_type', '=', 'BASE TABLE')
        .execute();
      tables = result.map((r: any) => r.table_name);
    } else if (config.database.dialect === 'mysql') {
      const result = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', db.fn('DATABASE'))
        .execute();
      tables = result.map((r: any) => r.table_name);
    } else if (config.database.dialect === 'sqlite') {
      const result = await db
        .selectFrom('sqlite_master')
        .select('name')
        .where('type', '=', 'table')
        .where('name', 'not like', 'sqlite_%')
        .execute();
      tables = result.map((r: any) => r.name);
    }

    for (const table of tables) {
      if (options.verbose) {
        logger.debug(`Dropping table: ${table}`);
      }
      await db.schema.dropTable(table).ifExists().cascade().execute();
    }

    logger.info(`Dropped ${tables.length} table${tables.length !== 1 ? 's' : ''}`);

    const migrationsDir = config.migrations?.directory || './migrations';
    const tableName = config.migrations?.tableName || 'kysera_migrations';

    const runner = new MigrationRunner(db, migrationsDir, tableName);

    logger.info('');
    logger.info('Running all migrations...');

    const { executed, duration } = await runner.up({
      verbose: options.verbose,
    });

    logger.info('');
    logger.info(
      prism.green(
        `Fresh complete: ${executed.length} migration${executed.length > 1 ? 's' : ''} executed (${duration}ms)`
      )
    );

    if (options.seed) {
      logger.info('');
      logger.info('Running seeds...');

      try {
        const seedsDir = config.testing?.seeds || './seeds';
        const seedRunner = new SeedRunner(db, seedsDir);

        const seedResult = await seedRunner.run({
          verbose: options.verbose,
          transaction: false,
        });

        if (seedResult.executed.length > 0) {
          logger.info('');
          logger.info(
            prism.green(
              `${seedResult.executed.length} seed${seedResult.executed.length > 1 ? 's' : ''} completed successfully (${seedResult.duration}ms)`
            )
          );
        } else if (seedResult.failed.length > 0) {
          logger.warn(
            `${seedResult.failed.length} seed${seedResult.failed.length > 1 ? 's' : ''} failed`
          );
          for (const failed of seedResult.failed) {
            logger.error(`  - ${failed.name}: ${failed.error}`);
          }
        } else {
          logger.info('No seeds found to run');
        }
      } catch (seedError: any) {
        logger.error(`Failed to run seeds: ${seedError.message}`);
        if (options.verbose) {
          logger.error(seedError.stack);
        }
        logger.warn('Fresh migration completed, but seeding failed');
      }
    }
  } finally {
    await db.destroy();
  }
}
