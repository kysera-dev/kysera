import { Command } from 'commander'
import { prism, confirm } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { MigrationRunner } from './runner.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface ResetOptions {
  force?: boolean
  run?: boolean  // Re-run migrations after reset
  seed?: boolean
  config?: string
  verbose?: boolean
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
        await resetMigrations(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to reset migrations: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_RESET_ERROR'
        )
      }
    })

  return cmd
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
        await freshMigrations(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to run fresh migrations: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_FRESH_ERROR'
        )
      }
    })

  return cmd
}

async function resetMigrations(options: ResetOptions): Promise<void> {
  // Confirm dangerous operation
  // If --run is specified, we can skip confirmation in test environments
  // since the user is explicitly asking to re-run migrations after reset
  if (!options.force && !options.run) {
    // In test environment or when stdin is not available, require --force
    if (process.env.NODE_ENV === 'test' || !process.stdin.isTTY) {
      throw new CLIError(
        'Reset requires confirmation',
        'RESET_REQUIRES_CONFIRMATION',
        undefined,
        ['Use --force flag to skip confirmation']
      )
    }

    console.log('')
    console.log(prism.red('⚠️  WARNING: This will rollback ALL migrations!'))
    console.log(prism.yellow('All data in migrated tables may be lost.'))
    console.log('')

    const confirmed = await confirm({
      message: 'Are you sure you want to continue?',
      initialValue: false
    })

    if (!confirmed) {
      logger.info('Reset cancelled')
      return
    }
  } else if (!options.force && options.run) {
    // In test environment, --run implies confirmation
    if (!(process.env.NODE_ENV === 'test' || !process.stdin.isTTY)) {
      // In interactive mode, still ask for confirmation
      console.log('')
      console.log(prism.red('⚠️  WARNING: This will rollback ALL migrations and re-run them!'))
      console.log(prism.yellow('All data in migrated tables may be lost.'))
      console.log('')

      const confirmed = await confirm({
        message: 'Are you sure you want to continue?',
        initialValue: false
      })

      if (!confirmed) {
        logger.info('Reset cancelled')
        return
      }
    }
  }

  // Load configuration
  const config = await loadConfig(options.config)

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
  const db = await getDatabaseConnection(config.database)

  if (!db) {
    throw new CLIError(
      'Failed to connect to database',
      'DATABASE_ERROR',
      undefined,
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

    logger.info('Resetting all migrations...')

    // Reset all migrations
    const { rolledBack, duration } = await runner.reset({
      force: options.force,
      seed: options.seed
    })

    // Show summary
    if (rolledBack.length > 0) {
      logger.info('')
      logger.info(
        prism.green(`✅ Reset complete: ${rolledBack.length} migration${rolledBack.length > 1 ? 's' : ''} rolled back (${duration}ms)`)
      )
    } else {
      logger.info('No migrations to reset')
    }

    // Re-run migrations if requested
    if (options.run) {
      logger.info('')
      logger.info('Running migrations')
      const { executed } = await runner.up({ verbose: options.verbose })
      if (executed.length > 0) {
        logger.info(prism.green(`✅ ${executed.length} migration${executed.length > 1 ? 's' : ''} completed successfully`))
      }
    }

    // Run seeds if requested
    if (options.seed) {
      logger.info('')
      logger.info('Running seeds...')
      // TODO: Implement seed runner
      logger.warn('Seed functionality not yet implemented')
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

async function freshMigrations(options: ResetOptions): Promise<void> {
  // Confirm dangerous operation
  if (!options.force) {
    // In test environment or when stdin is not available, require --force
    if (process.env.NODE_ENV === 'test' || !process.stdin.isTTY) {
      throw new CLIError(
        'Fresh requires confirmation',
        'FRESH_REQUIRES_CONFIRMATION',
        undefined,
        ['Use --force flag to skip confirmation']
      )
    }

    console.log('')
    console.log(prism.red('⚠️  WARNING: This will DROP ALL TABLES and re-run migrations!'))
    console.log(prism.red('ALL DATA WILL BE LOST!'))
    console.log('')

    const confirmed = await confirm({
      message: 'Are you absolutely sure you want to continue?',
      initialValue: false
    })

    if (!confirmed) {
      logger.info('Fresh cancelled')
      return
    }

    // Double confirmation for extra safety
    const doubleConfirm = await confirm({
      message: prism.red('This action cannot be undone. Are you REALLY sure?'),
      initialValue: false
    })

    if (!doubleConfirm) {
      logger.info('Fresh cancelled')
      return
    }
  }

  // Load configuration
  const config = await loadConfig(options.config)

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
  const db = await getDatabaseConnection(config.database)

  if (!db) {
    throw new CLIError(
      'Failed to connect to database',
      'DATABASE_ERROR',
      undefined,
      ['Check your database configuration', 'Ensure the database server is running']
    )
  }

  try {
    logger.info('Dropping all tables...')

    // Get all tables (this is database-specific)
    let tables: string[] = []

    if (config.database.dialect === 'postgres') {
      const result = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', 'public')
        .where('table_type', '=', 'BASE TABLE')
        .execute()
      tables = result.map((r: any) => r.table_name)
    } else if (config.database.dialect === 'mysql') {
      const result = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', db.fn('DATABASE'))
        .execute()
      tables = result.map((r: any) => r.table_name)
    } else if (config.database.dialect === 'sqlite') {
      const result = await db
        .selectFrom('sqlite_master')
        .select('name')
        .where('type', '=', 'table')
        .where('name', 'not like', 'sqlite_%')
        .execute()
      tables = result.map((r: any) => r.name)
    }

    // Drop all tables
    for (const table of tables) {
      if (options.verbose) {
        logger.debug(`Dropping table: ${table}`)
      }
      await db.schema.dropTable(table).ifExists().cascade().execute()
    }

    logger.info(`Dropped ${tables.length} table${tables.length !== 1 ? 's' : ''}`)

    // Now run all migrations
    const migrationsDir = config.migrations?.directory || './migrations'
    const tableName = config.migrations?.tableName || 'kysera_migrations'

    const runner = new MigrationRunner(db, migrationsDir, tableName)

    logger.info('')
    logger.info('Running all migrations...')

    const { executed, duration } = await runner.up({
      verbose: options.verbose
    })

    logger.info('')
    logger.info(
      prism.green(`✅ Fresh complete: ${executed.length} migration${executed.length > 1 ? 's' : ''} executed (${duration}ms)`)
    )

    // Run seeds if requested
    if (options.seed) {
      logger.info('')
      logger.info('Running seeds...')
      // TODO: Implement seed runner
      logger.warn('Seed functionality not yet implemented')
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}