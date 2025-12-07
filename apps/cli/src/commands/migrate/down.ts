import { Command } from 'commander';
import { prism, confirm } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { MigrationRunner } from './runner.js';
import { withDatabase } from '../../utils/with-database.js';

export interface DownOptions {
  to?: string;
  steps?: number;
  count?: number; // Alias for steps
  all?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  config?: string;
  force?: boolean;
}

export function downCommand(): Command {
  const cmd = new Command('down')
    .description('Rollback migrations')
    .option('-s, --steps <number>', 'Number of migrations to rollback', parseInt)
    .option('--count <number>', 'Number of migrations to rollback (alias for --steps)', parseInt)
    .option('-t, --to <migration>', 'Rollback to specific migration')
    .option('--all', 'Rollback all migrations')
    .option('--dry-run', 'Preview rollback without executing')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options: DownOptions) => {
      try {
        await rollbackMigrations(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to rollback migrations: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_DOWN_ERROR'
        );
      }
    });

  return cmd;
}

async function rollbackMigrations(options: DownOptions): Promise<void> {
  // Warn if rolling back all
  if (options.all && !options.force && !options.dryRun) {
    // In test environment or when stdin is not available, auto-confirm
    if (process.env.NODE_ENV === 'test' || !process.stdin.isTTY) {
      logger.debug('Auto-confirming rollback all in test/non-TTY environment');
    } else {
      const confirmed = await confirm({
        message: '[WARN] WARNING: This will rollback ALL migrations! Are you sure?',
        initialValue: false,
      });

      if (!confirmed) {
        logger.info('Rollback cancelled');
        return;
      }
    }
  }

  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    const migrationsDir = config.migrations?.directory || './migrations';
    const tableName = config.migrations?.tableName || 'kysera_migrations';

    // Create migration runner
    const runner = new MigrationRunner(db, migrationsDir, tableName);

    // Acquire lock to prevent concurrent migrations
    let releaseLock: (() => Promise<void>) | null = null;

    try {
      if (!options.dryRun) {
        try {
          releaseLock = await runner.acquireLock();
        } catch (error: any) {
          if (error.code === 'MIGRATION_LOCKED') {
            throw new CLIError('Migrations are already running in another process', 'MIGRATION_LOCKED', undefined, [
              'Wait for the other process to complete',
              'Or check for stuck locks in the database',
            ]);
          }
          // Lock mechanism might not be set up yet, continue without it
          logger.debug('Could not acquire migration lock, continuing without lock');
        }
      }

      // Get migration status before rolling back
      const statusBefore = await runner.getMigrationStatus();
      const executedCount = statusBefore.filter((m: any) => m.status === 'executed').length;

      if (executedCount === 0) {
        logger.info('No migrations to rollback');
        return;
      }

      // Show what will be rolled back in dry-run mode
      if (options.dryRun) {
        logger.info(prism.yellow('DRY RUN MODE - No changes will be made'));
        logger.info('');
      }

      // Rollback migrations
      const startTime = Date.now();
      const { rolledBack, duration } = await runner.down({
        to: options.to,
        steps: options.steps || options.count, // Use count as alias for steps
        all: options.all,
        dryRun: options.dryRun,
        verbose: options.verbose,
      });

      // Show summary
      if (rolledBack.length > 0) {
        logger.info('');
        if (options.dryRun) {
          logger.info(
            prism.yellow(
              `Would have rolled back ${rolledBack.length} migration${rolledBack.length > 1 ? 's' : ''} (${duration}ms)`
            )
          );
        } else {
          logger.info(
            prism.green(
              `[OK] ${rolledBack.length} migration${rolledBack.length > 1 ? 's' : ''} rolled back successfully (${duration}ms)`
            )
          );
        }
      }
    } finally {
      // Release lock
      if (releaseLock) {
        await releaseLock();
      }
    }
  });
}
