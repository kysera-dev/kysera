import { Command } from 'commander'
import { prism, table } from '@xec-sh/kit'
import { readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { MigrationRunner } from './runner.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface ListOptions {
  pending?: boolean
  executed?: boolean
  json?: boolean
  config?: string
}

export function listCommand(): Command {
  const cmd = new Command('list')
    .description('List all migrations')
    .option('--pending', 'Show only pending migrations')
    .option('--executed', 'Show only executed migrations')
    .option('--json', 'Output as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: ListOptions) => {
      try {
        await listMigrations(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to list migrations: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_LIST_ERROR'
        )
      }
    })

  return cmd
}

async function listMigrations(options: ListOptions): Promise<void> {
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

  const migrationsDir = config.migrations?.directory || './migrations'

  // Check if migrations directory exists
  if (!existsSync(migrationsDir)) {
    if (options.json) {
      console.log(JSON.stringify({ migrations: [] }, null, 2))
    } else {
      logger.info('No migrations directory found')
      logger.info(`  Expected location: ${migrationsDir}`)
      logger.info('')
      logger.info(`Run ${prism.cyan('kysera migrate create <name>')} to create your first migration`)
    }
    return
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

  try {
    const tableName = config.migrations?.tableName || 'kysera_migrations'

    // Create migration runner
    const runner = new MigrationRunner(db, migrationsDir, tableName)

    // Get migration status
    const status = await runner.getMigrationStatus()

    // Filter based on options
    let migrations = status
    if (options.pending) {
      migrations = migrations.filter(m => m.status === 'pending')
    } else if (options.executed) {
      migrations = migrations.filter(m => m.status === 'executed')
    }

    if (options.json) {
      // Output as JSON
      const output = migrations.map(m => ({
        name: m.name,
        timestamp: m.timestamp,
        status: m.status,
        executedAt: m.executedAt?.toISOString() || null
      }))
      console.log(JSON.stringify(output, null, 2))
      return
    }

    // Display as table or list
    if (migrations.length === 0) {
      const filter = options.pending ? 'pending' : options.executed ? 'executed' : ''
      logger.info(`No ${filter} migrations found`)
      return
    }

    console.log('')
    const title = options.pending
      ? 'Pending Migrations'
      : options.executed
      ? 'Executed Migrations'
      : 'All Migrations'

    console.log(prism.bold(title))
    console.log('')

    // Prepare table data
    const tableData = migrations.map(m => {
      const row: any = {
        Status: m.status === 'executed' ? prism.green('✓') : prism.yellow('○'),
        Name: m.name,
        Timestamp: m.timestamp
      }

      if (m.status === 'executed' && m.executedAt) {
        row['Executed At'] = formatDate(m.executedAt)
      }

      return row
    })

    // Display table
    console.log(table(tableData))
    console.log('')

    // Show summary
    const executed = migrations.filter(m => m.status === 'executed').length
    const pending = migrations.filter(m => m.status === 'pending').length

    console.log(prism.gray('Summary:'))
    console.log(`  Total: ${migrations.length}`)
    console.log(`  Executed: ${executed}`)
    console.log(`  Pending: ${pending}`)
    console.log('')

  } finally {
    // Close database connection
    await db.destroy()
  }
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}