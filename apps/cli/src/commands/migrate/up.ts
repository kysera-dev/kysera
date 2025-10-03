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
  count?: number  // Alias for steps
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
    .option('--count <number>', 'Number of migrations to run (alias for --steps)', parseInt)
    .option('--dry-run', 'Preview migrations without executing')
    .option('--force', 'Force migration even if already executed')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: UpOptions) => {
      try {
        await runMigrationsUp(options)
      } catch (error) {
        logger.error('Error in migrate up command:', error)
        if (error instanceof Error) {
          logger.error('Error stack:', error.stack)
        }
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
  logger.debug('Starting runMigrationsUp with options:', options)

  // Load configuration
  const config = await loadConfig(options.config)
  logger.debug('Config loaded:', config ? 'yes' : 'no')

  if (!config?.database) {
    throw new CLIError(
      'Database configuration not found',
      'CONFIG_ERROR',
      undefined,
      [
        'Create a kysera.config.ts file with database configuration',
        'Or specify a config file with --config option'
      ]
    )
  }

  // Get database connection
  logger.debug('Getting database connection...')
  const db = await getDatabaseConnection(config.database)
  logger.debug('Database connection obtained:', db ? 'yes' : 'no')

  if (!db) {
    throw new CLIError(
      'Failed to establish database connection',
      'DATABASE_ERROR',
      undefined,
      ['Check your database connection configuration', 'Ensure the database server is running']
    )
  }

  const migrationsDir = config.migrations?.directory || './migrations'
  const tableName = config.migrations?.tableName || 'kysera_migrations'

  // Check if migrations directory exists
  const { existsSync } = await import('node:fs')
  if (!existsSync(migrationsDir)) {
    throw new CLIError(
      `Migrations directory not found: ${migrationsDir}`,
      'MIGRATIONS_DIR_NOT_FOUND',
      undefined,
      [
        `Create the migrations directory: mkdir -p ${migrationsDir}`,
        `Or run: kysera migrate create <name> to create your first migration`
      ]
    )
  }

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
            undefined,
            ['Wait for the other process to complete', 'Or check for stuck locks in the database']
          )
        }
        // Lock mechanism might not be set up yet, continue without it
        logger.debug('Could not acquire migration lock, continuing without lock')
      }
    }

    // Get migration status before running
    let statusBefore: any
    try {
      statusBefore = await runner.getMigrationStatus()
    } catch (error) {
      logger.error('Failed to get migration status:', error)
      throw error
    }

    if (!statusBefore || !Array.isArray(statusBefore)) {
      logger.debug('Migration status is not an array:', statusBefore)
      statusBefore = []
    }

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
      steps: options.steps || options.count,  // Use count as alias for steps
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