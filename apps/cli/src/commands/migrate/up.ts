import { existsSync } from 'node:fs'
import { Command, InvalidArgumentError } from 'commander'
import { prism } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { isDryRun } from '../../utils/global-options.js'
import { diag, isJsonMode, output } from '../../utils/output.js'
import { withDatabase } from '../../utils/with-database.js'
import { createRunner, migrateSettings } from './settings.js'

export interface UpCommandOptions {
  to?: string
  steps?: number
  count?: number
  dryRun?: boolean
  verbose?: boolean
  config?: string
  json?: boolean
  schema?: string
}

export function parsePositiveInt(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('must be a positive integer')
  }
  return parsed
}

export function upCommand(): Command {
  const cmd = new Command('up')
    .description('Run pending migrations')
    .option('-t, --to <migration>', 'Migrate up to a specific migration (inclusive)')
    .option('--steps <number>', 'Number of migrations to run', parsePositiveInt)
    .option('--count <number>', 'Number of migrations to run (alias for --steps)', parsePositiveInt)
    .option('--dry-run', 'Show the execution plan without touching the database')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--json', 'Output results as JSON')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .action(async (options: UpCommandOptions) => {
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

async function runMigrationsUp(options: UpCommandOptions): Promise<void> {
  await withDatabase(
    { config: options.config, verbose: options.verbose, schema: options.schema },
    async (db, config, resolvedSchema) => {
      const settings = migrateSettings(config, resolvedSchema, options.schema)

      if (!existsSync(settings.migrationsDir)) {
        throw new CLIError(
          `Migrations directory not found: ${settings.migrationsDir}`,
          'MIGRATIONS_DIR_NOT_FOUND',
          undefined,
          [
            `Create the migrations directory: mkdir -p ${settings.migrationsDir}`,
            'Or run: kysera migrate create <name> to create your first migration'
          ]
        )
      }

      const runner = createRunner(db, settings)
      const json = options.json === true || isJsonMode()
      const dryRun = options.dryRun === true || isDryRun()
      const steps = options.steps ?? options.count
      const plan = await runner.planUp({ to: options.to, steps })

      if (dryRun) {
        if (json) {
          output(
            {
              dryRun: true,
              count: plan.length,
              plan: plan.map(f => ({ name: f.name, path: f.path })),
              table: settings.tableName,
              dialect: settings.dialect
            },
            { format: 'json' }
          )
          return
        }
        if (plan.length === 0) {
          diag('No pending migrations')
          return
        }
        diag(prism.yellow('DRY RUN - no changes will be made'))
        for (const file of plan) {
          diag(`  ${prism.green('↑')} ${file.name} ${prism.gray(`(${file.path})`)}`)
        }
        diag(`${plan.length} migration${plan.length === 1 ? '' : 's'} would run`)
        return
      }

      if (plan.length === 0) {
        if (json) {
          output({ executed: [], count: 0, duration: 0, dryRun: false }, { format: 'json' })
        } else {
          diag('No pending migrations to run')
        }
        return
      }

      if (settings.schema !== 'public') {
        diag(`Using schema: ${settings.schema}`)
      }
      diag('Running migrations')

      const result = await runner.up({ to: options.to, steps })

      if (json) {
        output(
          {
            executed: result.executed,
            count: result.executed.length,
            duration: result.duration,
            dryRun: false
          },
          { format: 'json' }
        )
        return
      }

      diag('')
      diag(
        prism.green(
          `[OK] ${result.executed.length} migration${result.executed.length === 1 ? '' : 's'} completed successfully (${result.duration}ms)`
        )
      )
    }
  )
}
