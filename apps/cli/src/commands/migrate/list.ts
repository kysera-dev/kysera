import { existsSync } from 'node:fs'
import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { loadConfig } from '../../config/loader.js'
import { CLIError } from '../../utils/errors.js'
import { diag, isJsonMode, output, toIsoDate } from '../../utils/output.js'
import { withDatabase } from '../../utils/with-database.js'
import type { MigrationStatusEntry } from './runner.js'
import { createRunner, migrateSettings } from './settings.js'

export interface ListCommandOptions {
  pending?: boolean
  executed?: boolean
  json?: boolean
  config?: string
  schema?: string
}

export function listCommand(): Command {
  const cmd = new Command('list')
    .description('List all migrations')
    .option('--pending', 'Show only pending migrations')
    .option('--executed', 'Show only executed migrations')
    .option('--json', 'Output as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .action(async (options: ListCommandOptions) => {
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

async function listMigrations(options: ListCommandOptions): Promise<void> {
  const json = options.json === true || isJsonMode()

  // Check the directory before connecting: listing an empty project should
  // not require a reachable database.
  const config = await loadConfig(options.config)
  const migrationsDir = config.migrations?.directory ?? './migrations'

  if (!existsSync(migrationsDir)) {
    if (json) {
      output([], { format: 'json' })
    } else {
      diag('No migrations directory found')
      diag(`  Expected location: ${migrationsDir}`)
      diag(`Run ${prism.cyan('kysera migrate create <name>')} to create your first migration`)
    }
    return
  }

  await withDatabase(
    { config: options.config, schema: options.schema },
    async (db, dbConfig, resolvedSchema) => {
      const settings = migrateSettings(dbConfig, resolvedSchema, options.schema)
      const runner = createRunner(db, settings)

      let entries = await runner.getStatusEntries()
      if (options.pending) {
        entries = entries.filter(e => e.status === 'pending')
      } else if (options.executed) {
        entries = entries.filter(e => e.status === 'executed')
      }

      if (json) {
        output(
          entries.map(e => ({
            name: e.name,
            timestamp: e.timestamp,
            status: e.status,
            executedAt: toIsoDate(e.executedAt),
            path: e.path
          })),
          { format: 'json' }
        )
        return
      }

      if (entries.length === 0) {
        const filter = options.pending ? 'pending ' : options.executed ? 'executed ' : ''
        diag(`No ${filter}migrations found`)
        return
      }

      const title = options.pending
        ? 'Pending Migrations'
        : options.executed
          ? 'Executed Migrations'
          : 'Available Migrations'

      output(renderListText(title, entries))
    }
  )
}

function renderListText(title: string, entries: MigrationStatusEntry[]): string {
  const lines: string[] = []
  lines.push('')
  lines.push(prism.bold(title))
  lines.push('')

  for (const entry of entries) {
    const marker = entry.status === 'executed' ? prism.green('✓') : prism.yellow('○')
    const executedInfo = entry.executedAt ? ` ${prism.gray(`(${formatDate(entry.executedAt)})`)}` : ''
    const missing = entry.status === 'executed' && entry.path === null ? ` ${prism.red('(file missing)')}` : ''
    lines.push(`  ${marker} ${entry.name}${executedInfo}${missing}`)
  }

  const executed = entries.filter(e => e.status === 'executed').length
  const pending = entries.filter(e => e.status === 'pending').length
  lines.push('')
  lines.push(prism.gray('Summary:'))
  lines.push(`  Total: ${entries.length}`)
  lines.push(`  Executed: ${executed}`)
  lines.push(`  Pending: ${pending}`)

  return lines.join('\n')
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
