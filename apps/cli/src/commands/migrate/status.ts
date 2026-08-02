import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { isJsonMode, output, redactConnection, toIsoDate } from '../../utils/output.js'
import { withDatabase } from '../../utils/with-database.js'
import type { MigrationStatusEntry } from './runner.js'
import { createRunner, migrateSettings, type MigrateSettings } from './settings.js'

export interface StatusCommandOptions {
  json?: boolean
  verbose?: boolean
  config?: string
  schema?: string
}

export function statusCommand(): Command {
  const cmd = new Command('status')
    .description('Show migration status')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed information')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .action(async (options: StatusCommandOptions) => {
      try {
        await showMigrationStatus(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to get migration status: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_STATUS_ERROR'
        )
      }
    })

  return cmd
}

async function showMigrationStatus(options: StatusCommandOptions): Promise<void> {
  await withDatabase(
    { config: options.config, verbose: options.verbose, schema: options.schema },
    async (db, config, resolvedSchema) => {
      const settings = migrateSettings(config, resolvedSchema, options.schema)
      const runner = createRunner(db, settings)
      const entries = await runner.getStatusEntries()
      const executed = entries.filter(e => e.status === 'executed')
      const pending = entries.filter(e => e.status === 'pending')

      if (options.json === true || isJsonMode()) {
        // Stable shape for CI consumers. Connection info only with
        // --verbose, and always credential-redacted.
        output(
          {
            total: entries.length,
            executed: executed.map(e => ({
              name: e.name,
              executedAt: e.executedAt ? toIsoDate(e.executedAt) : null,
              checksum: e.checksum
            })),
            pending: pending.map(e => ({ name: e.name, path: e.path })),
            table: settings.tableName,
            dialect: settings.dialect,
            database: options.verbose
              ? {
                  dialect: settings.dialect,
                  schema: settings.schema,
                  connection: redactConnection(config.database.connection)
                }
              : undefined
          },
          { format: 'json' }
        )
        return
      }

      output(renderStatusText(entries, executed, pending, settings, options.verbose === true))
    }
  )
}

function renderStatusText(
  entries: MigrationStatusEntry[],
  executed: MigrationStatusEntry[],
  pending: MigrationStatusEntry[],
  settings: MigrateSettings,
  verbose: boolean
): string {
  const lines: string[] = []
  lines.push('')
  lines.push(prism.bold('Migration Status'))
  lines.push('')

  if (executed.length > 0) {
    lines.push(prism.green(`Executed (${executed.length}):`))
    for (const entry of executed) {
      const when = entry.executedAt ? ` ${prism.gray(`(${formatDate(entry.executedAt)})`)}` : ''
      const missing = entry.path === null ? ` ${prism.red('(file missing)')}` : ''
      lines.push(`  ${prism.green('[OK]')} ${entry.name} ${prism.green('(executed)')}${when}${missing}`)
    }
  } else {
    lines.push(prism.gray('No executed migrations'))
  }
  lines.push('')

  if (pending.length > 0) {
    lines.push(prism.yellow(`Pending (${pending.length}):`))
    for (const entry of pending) {
      lines.push(`  ${prism.gray('-')} ${entry.name} ${prism.gray('(pending)')}`)
    }
  } else {
    lines.push(prism.gray('No pending migrations'))
  }
  lines.push('')

  lines.push(prism.gray(`Total: ${entries.length}`))

  if (verbose) {
    lines.push('')
    lines.push(prism.gray('Database Information:'))
    lines.push(`  Dialect: ${settings.dialect}`)
    lines.push(`  Schema: ${settings.schema}`)
    lines.push(`  Migrations Directory: ${settings.migrationsDir}`)
    lines.push(`  Migrations Table: ${settings.tableName}`)
  }

  return lines.join('\n')
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}
