import { Command } from 'commander';
import { prism, confirm, spinner } from '@xec-sh/kit';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';
import { MigrationRunner } from '../migrate/runner.js';
import { execa } from 'execa';
import { logger } from '../../utils/logger.js';

export interface ResetOptions {
  force?: boolean;
  seed?: boolean;
  config?: string;
  verbose?: boolean;
}

export function resetCommand(): Command {
  const cmd = new Command('reset')
    .description('Reset database (drop all tables and re-run migrations)')
    .option('--force', 'Skip confirmation prompt')
    .option('--seed', 'Run seeds after reset')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (options: ResetOptions) => {
      try {
        await resetDatabase(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to reset database: ${error instanceof Error ? error.message : String(error)}`,
          'DB_RESET_ERROR'
        );
      }
    });

  return cmd;
}

async function resetDatabase(options: ResetOptions): Promise<void> {
  // Confirm dangerous operation
  if (!options.force) {
    console.log('');
    console.log(prism.red('⚠️  WARNING: This will DROP ALL TABLES and destroy all data!'));
    console.log(prism.red('This action cannot be undone.'));
    console.log('');

    const confirmed = await confirm({
      message: 'Are you absolutely sure you want to continue?',
      initialValue: false,
    });

    if (!confirmed) {
      console.log('Reset cancelled');
      return;
    }
  }

  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    const resetSpinner = spinner() as any;

    // Step 1: Drop all tables
    resetSpinner.start('Dropping all tables...');

    let tables: string[] = [];

    // Get all tables based on dialect
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
        .execute()) as any[];
      tables = result.map((r) => r.name);
    }

    // Drop each table
    for (const table of tables) {
      if (options.verbose) {
        console.log(`Dropping table: ${table}`);
      }

      try {
        await db.schema.dropTable(table).ifExists().cascade().execute();
      } catch (error) {
        // Some tables might have dependencies, continue anyway
        if (options.verbose) {
          console.log(`Failed to drop ${table}: ${error}`);
        }
      }
    }

    resetSpinner.succeed(`Dropped ${tables.length} table${tables.length !== 1 ? 's' : ''}`);

    // Step 2: Run migrations
    resetSpinner.start('Running migrations...');

    const migrationsDir = config.migrations?.directory || './migrations';
    const tableName = config.migrations?.tableName || 'kysera_migrations';

    const runner = new MigrationRunner(db, migrationsDir, tableName);

    const { executed, duration } = await runner.up({
      verbose: options.verbose,
    });

    resetSpinner.succeed(`Ran ${executed.length} migration${executed.length !== 1 ? 's' : ''} (${duration}ms)`);

    // Step 3: Run seeds if requested
    if (options.seed) {
      resetSpinner.start('Running seeds...');

      try {
        await execa('npx', ['kysera', 'db', 'seed'], { stdio: options.verbose ? 'inherit' : 'ignore' });
        resetSpinner.succeed('Seeds ran successfully');
      } catch (error) {
        resetSpinner.warn('Failed to run seeds');
        logger.info(`Run ${prism.cyan('kysera db seed')} manually to seed the database`);
      }
    }

    // Success
    console.log('');
    console.log(prism.green('✅ Database reset successfully!'));
    console.log('');
    console.log('Summary:');
    console.log(`  • Dropped ${tables.length} table${tables.length !== 1 ? 's' : ''}`);
    console.log(`  • Ran ${executed.length} migration${executed.length !== 1 ? 's' : ''}`);
    if (options.seed) {
      console.log(`  • Ran database seeds`);
    }
    console.log('');
  });
}
