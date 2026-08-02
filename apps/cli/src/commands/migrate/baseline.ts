import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { diag, isJsonMode, output } from '../../utils/output.js'
import { withDatabase } from '../../utils/with-database.js'
import { createRunner, migrateSettings } from './settings.js'

export interface BaselineCommandOptions {
  all?: boolean
  verbose?: boolean
  config?: string
  json?: boolean
  schema?: string
}

export function baselineCommand(): Command {
  const cmd = new Command('baseline')
    .description('Mark migrations as executed without running them (adopt an existing schema)')
    .argument('[names...]', 'Migration names to mark as executed')
    .option('--all', 'Baseline every pending migration')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--json', 'Output results as JSON')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .action(async (names: string[], options: BaselineCommandOptions) => {
      try {
        await baselineMigrations(names, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to baseline migrations: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_BASELINE_ERROR'
        )
      }
    })

  return cmd
}

async function baselineMigrations(
  names: string[],
  options: BaselineCommandOptions
): Promise<void> {
  if (names.length === 0 && options.all !== true) {
    throw new CLIError('Nothing to baseline', 'MIGRATION_BASELINE_ERROR', undefined, [
      'Pass one or more migration names: kysera migrate baseline <name...>',
      'Or baseline every pending migration: kysera migrate baseline --all'
    ])
  }

  await withDatabase(
    { config: options.config, verbose: options.verbose, schema: options.schema },
    async (db, config, resolvedSchema) => {
      const settings = migrateSettings(config, resolvedSchema, options.schema)
      const runner = createRunner(db, settings)
      const json = options.json === true || isJsonMode()

      const targets = options.all ? (await runner.planUp()).map(f => f.name) : names

      const { marked, skipped } = await runner.baseline(targets)

      if (json) {
        output(
          {
            marked,
            skipped,
            count: marked.length,
            table: settings.tableName,
            dialect: settings.dialect
          },
          { format: 'json' }
        )
        return
      }

      for (const name of marked) {
        diag(`${prism.green('✓')} ${name} ${prism.gray('(baselined)')}`)
      }
      for (const name of skipped) {
        diag(`${prism.gray('-')} ${name} ${prism.gray('(already executed)')}`)
      }

      const summary =
        marked.length > 0
          ? `Baselined ${marked.length} migration${marked.length === 1 ? '' : 's'}`
          : 'Nothing to baseline - all requested migrations are already executed'
      output(summary)
    }
  )
}
