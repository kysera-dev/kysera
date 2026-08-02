import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { sql } from 'kysely'
import { CLIError } from '../../utils/errors.js'
import { guardDestructive } from '../../utils/guard.js'
import { diag, diagVerbose, isJsonMode, output } from '../../utils/output.js'
import { withDatabase, type KyseraConfigWithDatabase } from '../../utils/with-database.js'
import type { DatabaseInstance } from '../../types/index.js'
import { createRunner, migrateSettings } from './settings.js'

export interface ResetCommandOptions {
  force?: boolean
  /** Re-run migrations after reset */
  run?: boolean
  seed?: boolean
  config?: string
  verbose?: boolean
  json?: boolean
  schema?: string
}

export function resetCommand(): Command {
  const cmd = new Command('reset')
    .description('Rollback all migrations (dangerous!)')
    .option('--force', 'Skip confirmation prompt')
    .option('--run', 'Re-run migrations after reset')
    .option('--seed', 'Run seeds after reset')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-v, --verbose', 'Show detailed output')
    .option('--json', 'Output results as JSON')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .action(async (options: ResetCommandOptions) => {
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
    .option('--json', 'Output results as JSON')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .action(async (options: ResetCommandOptions) => {
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

async function resetMigrations(options: ResetCommandOptions): Promise<void> {
  const warning = options.run
    ? 'This will rollback ALL migrations and re-run them. All data in migrated tables may be lost. Continue?'
    : 'This will rollback ALL migrations. All data in migrated tables may be lost. Continue?'
  const proceed = await guardDestructive(warning, { force: options.force })
  if (!proceed) {
    diag('Reset cancelled')
    return
  }

  await withDatabase(
    { config: options.config, verbose: options.verbose, schema: options.schema },
    async (db, config, resolvedSchema) => {
      const settings = migrateSettings(config, resolvedSchema, options.schema)
      const runner = createRunner(db, settings)
      const json = options.json === true || isJsonMode()

      if (settings.schema !== 'public') {
        diag(`Using schema: ${settings.schema}`)
      }
      diag('Resetting all migrations...')

      const result = await runner.down({ all: true })
      const rolledBack = result.executed

      if (rolledBack.length > 0) {
        diag('')
        diag(
          prism.green(
            `Reset complete: ${rolledBack.length} migration${rolledBack.length === 1 ? '' : 's'} rolled back (${result.duration}ms)`
          )
        )
      } else {
        diag('No migrations to reset')
      }

      let executed: string[] = []
      if (options.run) {
        diag('')
        diag('Running migrations')
        const upResult = await runner.up()
        executed = upResult.executed
        if (executed.length > 0) {
          diag(
            prism.green(
              `${executed.length} migration${executed.length === 1 ? '' : 's'} completed successfully`
            )
          )
        }
      }

      let seeded = 0
      if (options.seed) {
        seeded = await runSeeds(db, config, options.verbose === true)
      }

      if (json) {
        output(
          {
            rolledBack,
            count: rolledBack.length,
            duration: result.duration,
            executed: options.run ? executed : undefined,
            seeded: options.seed ? seeded : undefined
          },
          { format: 'json' }
        )
      }
    }
  )
}

async function freshMigrations(options: ResetCommandOptions): Promise<void> {
  const proceed = await guardDestructive(
    'This will DROP ALL TABLES and re-run migrations. ALL DATA WILL BE LOST. Continue?',
    { force: options.force }
  )
  if (!proceed) {
    diag('Fresh cancelled')
    return
  }

  await withDatabase(
    { config: options.config, verbose: options.verbose, schema: options.schema },
    async (db, config, resolvedSchema) => {
      const settings = migrateSettings(config, resolvedSchema, options.schema)
      const json = options.json === true || isJsonMode()

      if (settings.schema !== 'public') {
        diag(`Using schema: ${settings.schema}`)
      }
      diag('Dropping all tables...')

      const tables = await listTables(db, config, settings.schema)
      const dropped = await dropTables(db, tables, settings.dialect)
      diag(`Dropped ${dropped} table${dropped === 1 ? '' : 's'}`)

      const runner = createRunner(db, settings)

      diag('')
      diag('Running all migrations...')
      const result = await runner.up()

      diag('')
      diag(
        prism.green(
          `Fresh complete: ${result.executed.length} migration${result.executed.length === 1 ? '' : 's'} executed (${result.duration}ms)`
        )
      )

      let seeded = 0
      if (options.seed) {
        seeded = await runSeeds(db, config, options.verbose === true)
      }

      if (json) {
        output(
          {
            dropped,
            executed: result.executed,
            count: result.executed.length,
            duration: result.duration,
            seeded: options.seed ? seeded : undefined
          },
          { format: 'json' }
        )
      }
    }
  )
}

async function listTables(
  db: DatabaseInstance,
  config: KyseraConfigWithDatabase,
  schema: string
): Promise<string[]> {
  const dialect = config.database.dialect

  if (dialect === 'postgres') {
    const rows = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_schema', '=', schema)
      .where('table_type', '=', 'BASE TABLE')
      .execute()
    return rows.map(r => String(r.table_name))
  }

  if (dialect === 'mysql') {
    const rows = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_schema', '=', sql<string>`database()`)
      .execute()
    return rows.map(r => String(r.table_name))
  }

  const rows = await db
    .selectFrom('sqlite_master')
    .select('name')
    .where('type', '=', 'table')
    .where('name', 'not like', 'sqlite_%')
    .execute()
  return rows.map(r => String(r.name))
}

/**
 * Drop tables with a retry pass: dependency order is unknown, so tables
 * that fail on the first pass (foreign keys) get a second chance after
 * their dependents are gone. CASCADE is postgres-only.
 */
async function dropTables(
  db: DatabaseInstance,
  tables: string[],
  dialect: string
): Promise<number> {
  let dropped = 0
  let queue = tables

  for (let pass = 0; pass < 2 && queue.length > 0; pass++) {
    const failures: string[] = []
    for (const table of queue) {
      try {
        const builder = db.schema.dropTable(table).ifExists()
        await (dialect === 'postgres' ? builder.cascade() : builder).execute()
        dropped++
        diagVerbose(`Dropped table: ${table}`)
      } catch (error) {
        failures.push(table)
        diagVerbose(
          `Could not drop ${table}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    queue = failures
  }

  if (queue.length > 0) {
    throw new CLIError(
      `Failed to drop table(s): ${queue.join(', ')}`,
      'DB_RESET_ERROR',
      { tables: queue },
      ['Check for objects (views, foreign keys) referencing these tables']
    )
  }

  return dropped
}

async function runSeeds(
  db: DatabaseInstance,
  config: KyseraConfigWithDatabase,
  verbose: boolean
): Promise<number> {
  diag('')
  diag('Running seeds...')

  try {
    const { SeedRunner } = await import('../db/seed-runner.js')
    const seedsDir = config.testing?.seeds ?? './seeds'
    const seedRunner = new SeedRunner(db, seedsDir)
    const seedResult = await seedRunner.run({ verbose, transaction: false })

    if (seedResult.executed.length > 0) {
      diag(
        prism.green(
          `${seedResult.executed.length} seed${seedResult.executed.length === 1 ? '' : 's'} completed successfully (${seedResult.duration}ms)`
        )
      )
    } else if (seedResult.failed.length > 0) {
      diag(
        prism.yellow(
          `${seedResult.failed.length} seed${seedResult.failed.length === 1 ? '' : 's'} failed`
        )
      )
      for (const failed of seedResult.failed) {
        diag(prism.red(`  - ${failed.name}: ${failed.error}`))
      }
    } else {
      diag('No seeds found to run')
    }
    return seedResult.executed.length
  } catch (error) {
    diag(prism.red(`Failed to run seeds: ${error instanceof Error ? error.message : String(error)}`))
    diag(prism.yellow('Migrations completed, but seeding failed'))
    return 0
  }
}
