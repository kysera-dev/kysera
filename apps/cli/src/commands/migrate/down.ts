import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { guardDestructive } from '../../utils/guard.js'
import { isDryRun } from '../../utils/global-options.js'
import { diag, isJsonMode, output } from '../../utils/output.js'
import { withDatabase } from '../../utils/with-database.js'
import { createRunner, migrateSettings } from './settings.js'
import { parsePositiveInt } from './up.js'

export interface DownCommandOptions {
  to?: string
  steps?: number
  count?: number
  all?: boolean
  dryRun?: boolean
  verbose?: boolean
  config?: string
  force?: boolean
  json?: boolean
  schema?: string
}

export function downCommand(): Command {
  const cmd = new Command('down')
    .description('Rollback migrations')
    .option('--steps <number>', 'Number of migrations to rollback', parsePositiveInt)
    .option(
      '--count <number>',
      'Number of migrations to rollback (alias for --steps)',
      parsePositiveInt
    )
    .option('-t, --to <migration>', 'Rollback everything after the given migration')
    .option('--all', 'Rollback all migrations')
    .option('--dry-run', 'Show the rollback plan without touching the database')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--force', 'Skip confirmation prompt')
    .option('--json', 'Output results as JSON')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .action(async (options: DownCommandOptions) => {
      try {
        await rollbackMigrations(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to rollback migrations: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_DOWN_ERROR'
        )
      }
    })

  return cmd
}

async function rollbackMigrations(options: DownCommandOptions): Promise<void> {
  const dryRun = options.dryRun === true || isDryRun()

  // Rolling back everything destroys schema and data: require explicit
  // confirmation (--force in non-interactive environments).
  if (options.all && !dryRun) {
    const proceed = await guardDestructive('This will rollback ALL migrations. Are you sure?', {
      force: options.force
    })
    if (!proceed) {
      diag('Rollback cancelled')
      return
    }
  }

  await withDatabase(
    { config: options.config, verbose: options.verbose, schema: options.schema },
    async (db, config, resolvedSchema) => {
      const settings = migrateSettings(config, resolvedSchema, options.schema)
      const runner = createRunner(db, settings)
      const json = options.json === true || isJsonMode()
      const steps = options.steps ?? options.count

      const targets = await runner.planDown({ to: options.to, steps, all: options.all })

      if (targets.length === 0) {
        if (json) {
          output({ rolledBack: [], count: 0, duration: 0, dryRun }, { format: 'json' })
        } else {
          diag('No migrations to rollback')
        }
        return
      }

      if (dryRun) {
        if (json) {
          output(
            {
              dryRun: true,
              count: targets.length,
              plan: targets.map(t => ({ name: t.name, path: t.path })),
              table: settings.tableName,
              dialect: settings.dialect
            },
            { format: 'json' }
          )
          return
        }
        diag(prism.yellow('DRY RUN - no changes will be made'))
        for (const target of targets) {
          diag(`  ${prism.yellow('↓')} ${target.name}`)
        }
        diag(`${targets.length} migration${targets.length === 1 ? '' : 's'} would be rolled back`)
        return
      }

      if (settings.schema !== 'public') {
        diag(`Using schema: ${settings.schema}`)
      }
      diag(`Rolling back ${targets.length} migration${targets.length === 1 ? '' : 's'}`)

      const result = await runner.down({ to: options.to, steps, all: options.all })

      if (json) {
        output(
          {
            rolledBack: result.executed,
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
          `[OK] ${result.executed.length} migration${result.executed.length === 1 ? '' : 's'} rolled back successfully (${result.duration}ms)`
        )
      )
    }
  )
}
