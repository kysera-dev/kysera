import { Command } from 'commander'
import { prism, spinner } from '@xec-sh/kit'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { sql } from 'kysely'

export interface SeedOptions {
  file?: string
  directory?: string
  fresh?: boolean
  config?: string
  verbose?: boolean
}

export function seedCommand(): Command {
  const cmd = new Command('seed')
    .description('Run database seeders')
    .option('-f, --file <path>', 'Specific seed file to run')
    .option('-d, --directory <path>', 'Seed files directory', './seeds')
    .option('--fresh', 'Truncate tables before seeding', false)
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (options: SeedOptions) => {
      try {
        await runSeeds(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to run seeds: ${error instanceof Error ? error.message : String(error)}`,
          'SEED_ERROR'
        )
      }
    })

  return cmd
}

async function runSeeds(options: SeedOptions): Promise<void> {
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

  const seedSpinner = spinner() as any

  try {
    // Determine which seeds to run
    let seedFiles: string[] = []
    const seedDir = options.directory || './seeds'

    if (options.file) {
      // Run specific seed file
      if (!existsSync(options.file)) {
        throw new CLIError(
          `Seed file not found: ${options.file}`,
          'FILE_NOT_FOUND'
        )
      }
      seedFiles = [options.file]
    } else {
      // Run all seeds in directory
      if (!existsSync(seedDir)) {
        throw new CLIError(
          `Seeds directory not found: ${seedDir}`,
          'DIRECTORY_NOT_FOUND',
          [
            `Create a seeds directory: mkdir ${seedDir}`,
            'Or specify a different directory with --directory'
          ]
        )
      }

      const fs = await import('fs')
      const files = fs.readdirSync(seedDir)
        .filter(f => f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mjs'))
        .sort()
        .map(f => join(seedDir, f))

      if (files.length === 0) {
        console.log(prism.yellow(`No seed files found in ${seedDir}`))
        return
      }

      seedFiles = files
    }

    // Fresh option - truncate tables
    if (options.fresh) {
      seedSpinner.start('Truncating tables...')

      try {
        // Get all tables
        let tables: string[] = []

        if (config.database.dialect === 'postgres') {
          const result = await db
            .selectFrom('information_schema.tables')
            .select('table_name')
            .where('table_schema', '=', 'public')
            .where('table_type', '=', 'BASE TABLE')
            .execute() as any[]
          tables = result.map(r => r.table_name)
        } else if (config.database.dialect === 'mysql') {
          const result = await db
            .selectFrom('information_schema.tables')
            .select('table_name')
            .where('table_schema', '=', db.fn('DATABASE'))
            .execute() as any[]
          tables = result.map(r => r.table_name || r.TABLE_NAME)
        } else if (config.database.dialect === 'sqlite') {
          const result = await db
            .selectFrom('sqlite_master')
            .select('name')
            .where('type', '=', 'table')
            .where('name', 'not like', 'sqlite_%')
            .where('name', 'not like', 'kysera_%') // Skip migration tables
            .execute() as any[]
          tables = result.map(r => r.name)
        }

        // Truncate each table
        for (const table of tables) {
          if (options.verbose) {
            console.log(`Truncating table: ${table}`)
          }

          if (config.database.dialect === 'sqlite') {
            await db.deleteFrom(table).execute()
          } else {
            await sql`TRUNCATE TABLE ${sql.id(table)} CASCADE`.execute(db)
          }
        }

        seedSpinner.succeed(`Truncated ${tables.length} table${tables.length !== 1 ? 's' : ''}`)
      } catch (error) {
        seedSpinner.fail('Failed to truncate tables')
        throw error
      }
    }

    // Run seed files
    seedSpinner.start(`Running ${seedFiles.length} seed file${seedFiles.length !== 1 ? 's' : ''}...`)

    let successCount = 0
    const startTime = Date.now()

    for (const seedFile of seedFiles) {
      const seedName = seedFile.split('/').pop() || seedFile

      try {
        if (options.verbose) {
          logger.debug(`Running seed: ${seedName}`)
        }

        // Import and run seed file
        const fileUrl = pathToFileURL(seedFile).href
        const module = await import(fileUrl)

        if (!module.seed || typeof module.seed !== 'function') {
          throw new Error(`Seed file must export a 'seed' function`)
        }

        // Run seed in transaction
        await db.transaction().execute(async (trx) => {
          await module.seed(trx)
        })

        successCount++
        logger.info(`  ${prism.green('✓')} ${seedName}`)

      } catch (error: any) {
        logger.error(`  ${prism.red('✗')} ${seedName}: ${error.message}`)

        if (!options.verbose) {
          logger.info(`    Run with --verbose for more details`)
        } else {
          logger.error(error.stack)
        }
      }
    }

    const duration = Date.now() - startTime
    seedSpinner.succeed(`Seeding completed (${duration}ms)`)

    // Summary
    if (successCount === seedFiles.length) {
      logger.info('')
      logger.info(prism.green(`✅ All ${successCount} seed${successCount !== 1 ? 's' : ''} ran successfully`))
    } else {
      const failedCount = seedFiles.length - successCount
      logger.info('')
      logger.warn(`⚠️  ${successCount} seed${successCount !== 1 ? 's' : ''} succeeded, ${failedCount} failed`)
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

/**
 * Example seed file structure:
 *
 * export async function seed(db: Kysely<any>) {
 *   await db.insertInto('users').values([
 *     { name: 'John Doe', email: 'john@example.com' },
 *     { name: 'Jane Doe', email: 'jane@example.com' }
 *   ]).execute()
 * }
 */