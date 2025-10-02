import { Command } from 'commander'
import { prism, spinner } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { MigrationRunner } from './runner.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface UpOptions {
  to?: string
  steps?: number
  dryRun?: boolean
  force?: boolean
  verbose?: boolean
  config?: string
}

export function upCommand(): Command {
  const cmd = new Command('up')
    .description('Run pending migrations')
    .option('-t, --to <migration>', 'Migrate up to specific migration')
    .option('-s, --steps <number>', 'Number of migrations to run', parseInt)
    .option('--dry-run', 'Preview migrations without executing')
    .option('--force', 'Force migration even if already executed')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: UpOptions) => {
      try {
        await runMigrationsUp(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to run migrations: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_UP_ERROR'
        )
      }
    })

  return cmd
}

async function runMigrationsUp(options: UpOptions): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config)

  if (!config?.database) {
    throw new CLIError(
      'Database configuration not found',
      'CONFIG_ERROR',
      [
        'Create a kysera.config.ts file with database configuration',
        'Or specify a config file with --config option'
      ]
    )
  }

  // Get database connection
  const db = await getDatabaseConnection(config.database)

  if (!db) {
    throw new CLIError(
      'Failed to connect to database',
      'DATABASE_ERROR',
      ['Check your database configuration', 'Ensure the database server is running']
    )
  }

  const migrationsDir = config.migrations?.directory || './migrations'
  const tableName = config.migrations?.tableName || 'kysera_migrations'

  // Create migration runner
  const runner = new MigrationRunner(db, migrationsDir, tableName)

  // Acquire lock to prevent concurrent migrations
  let releaseLock: (() => Promise<void>) | null = null

  try {
    if (!options.dryRun) {
      try {
        releaseLock = await runner.acquireLock()
      } catch (error: any) {
        if (error.code === 'MIGRATION_LOCKED') {
          throw new CLIError(
            'Migrations are already running in another process',
            'MIGRATION_LOCKED',
            ['Wait for the other process to complete', 'Or check for stuck locks in the database']
          )
        }
        // Lock mechanism might not be set up yet, continue without it
        logger.debug('Could not acquire migration lock, continuing without lock')
      }
    }

    // Get migration status before running
    const statusBefore = await runner.getMigrationStatus()
    const pendingCount = statusBefore.filter(m => m.status === 'pending').length

    if (pendingCount === 0 && !options.force) {
      logger.info('No pending migrations to run')
      return
    }

    // Show what will be run in dry-run mode
    if (options.dryRun) {
      logger.info(prism.yellow('DRY RUN MODE - No changes will be made'))
      logger.info('')
    }

    // Run migrations
    const startTime = Date.now()
    const { executed, duration } = await runner.up({
      to: options.to,
      steps: options.steps,
      dryRun: options.dryRun,
      force: options.force,
      verbose: options.verbose
    })

    // Show summary
    if (executed.length > 0) {
      logger.info('')
      if (options.dryRun) {
        logger.info(
          prism.yellow(`Would have run ${executed.length} migration${executed.length > 1 ? 's' : ''} (${duration}ms)`)
        )
      } else {
        logger.info(
          prism.green(`✅ ${executed.length} migration${executed.length > 1 ? 's' : ''} completed successfully (${duration}ms)`)
        )
      }
    }

  } finally {
    // Release lock
    if (releaseLock) {
      await releaseLock()
    }

    // Close database connection
    await db.destroy()
  }
}