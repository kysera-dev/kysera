import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { formatTimestampForDb } from '@kysera/core'
import { displayTable as table } from '../../utils/table-helper.js'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import {
  auditTableExists,
  auditTableMissingHint,
  parseJsonColumn,
  resolveAuditTable,
  type AuditLogRow
} from './shared.js'

export interface LogsOptions {
  table?: string
  user?: string
  action?: 'INSERT' | 'UPDATE' | 'DELETE'
  /** Always set: commander applies a '50' default. */
  limit: string
  since?: string
  until?: string
  entityId?: string
  json?: boolean
  verbose?: boolean
  config?: string
  schema?: string
}

export function logsCommand(): Command {
  const cmd = new Command('logs')
    .description('Query audit logs with filters')
    .option('-t, --table <name>', 'Filter by table name')
    .option('-u, --user <id>', 'Filter by user ID')
    .option('-a, --action <type>', 'Filter by action (INSERT/UPDATE/DELETE)')
    .option('-l, --limit <n>', 'Limit number of results', '50')
    .option('--since <datetime>', 'Show logs since datetime (ISO 8601)')
    .option('--until <datetime>', 'Show logs until datetime (ISO 8601)')
    .option('-e, --entity-id <id>', 'Filter by entity ID')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed information including changes')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .action(async (options: LogsOptions) => {
      try {
        await queryAuditLogs(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to query audit logs: ${error instanceof Error ? error.message : String(error)}`,
          'AUDIT_LOGS_ERROR'
        )
      }
    })

  return cmd
}

async function queryAuditLogs(options: LogsOptions): Promise<void> {
  await withDatabase(
    { config: options.config, verbose: options.verbose, schema: options.schema },
    async (db, config, schema) => {
      // Use schema-aware db for PostgreSQL
      const schemaDb = schema !== 'public' ? db.withSchema(schema) : db
      const auditTable = resolveAuditTable(config)
      const dialect = config.database.dialect
      const querySpinner = spinner()
      querySpinner.start('Querying audit logs...')

      if (!(await auditTableExists(db, auditTable, schema))) {
        querySpinner.fail('Audit table not found')
        console.log('')
        for (const line of auditTableMissingHint(auditTable)) {
          console.log(prism.yellow(line))
        }
        return
      }

      // Build query (plugin schema: operation/changed_by/changed_at)
      let query = schemaDb.selectFrom(auditTable).selectAll().orderBy('changed_at', 'desc')

      // Apply filters
      if (options.table) {
        query = query.where('table_name', '=', options.table)
      }

      if (options.user) {
        query = query.where('changed_by', '=', options.user)
      }

      if (options.action) {
        query = query.where('operation', '=', options.action)
      }

      if (options.entityId) {
        query = query.where('entity_id', '=', options.entityId)
      }

      if (options.since) {
        const sinceDate = new Date(options.since)
        if (isNaN(sinceDate.getTime())) {
          throw new CLIError('Invalid since date format', 'INVALID_DATE')
        }
        // changed_at is stored as text; compare in the plugin's own format
        query = query.where('changed_at', '>=', formatTimestampForDb(sinceDate, dialect))
      }

      if (options.until) {
        const untilDate = new Date(options.until)
        if (isNaN(untilDate.getTime())) {
          throw new CLIError('Invalid until date format', 'INVALID_DATE')
        }
        query = query.where('changed_at', '<=', formatTimestampForDb(untilDate, dialect))
      }

      // Apply limit
      const limit = parseInt(options.limit || '50', 10)
      if (isNaN(limit) || limit <= 0) {
        throw new CLIError('Invalid limit value - must be a positive number')
      }
      query = query.limit(limit)

      // Execute query
      const logs = (await query.execute()) as unknown as AuditLogRow[]

      querySpinner.succeed(`Found ${logs.length} audit log${logs.length !== 1 ? 's' : ''}`)

      if (logs.length === 0) {
        console.log(prism.gray('No audit logs found matching the criteria'))
        return
      }

      // Output results
      if (options.json) {
        console.log(JSON.stringify(logs, null, 2))
      } else if (options.verbose) {
        // Detailed view
        for (const log of logs) {
          console.log('')
          console.log(prism.bold(`Audit Log #${log.id}`))
          console.log(prism.gray('-'.repeat(50)))
          console.log(`  Timestamp: ${formatDate(log.changed_at)}`)
          console.log(`  Table: ${prism.cyan(log.table_name)}`)
          console.log(`  Operation: ${formatAction(log.operation)}`)
          console.log(`  Entity ID: ${log.entity_id}`)
          console.log(`  User: ${log.changed_by ?? prism.gray('system')}`)

          if (log.metadata) {
            console.log(`  Metadata: ${prism.gray(JSON.stringify(parseJsonColumn(log.metadata)))}`)
          }

          if (log.old_values || log.new_values) {
            console.log('')
            console.log(prism.cyan('  Changes:'))

            if (log.operation === 'INSERT') {
              console.log(prism.green('    + Created with:'))
              if (log.new_values) {
                for (const [key, value] of Object.entries(parseJsonColumn(log.new_values))) {
                  console.log(`      ${key}: ${formatValue(value)}`)
                }
              }
            } else if (log.operation === 'UPDATE') {
              const oldValues = parseJsonColumn(log.old_values)
              const newValues = parseJsonColumn(log.new_values)

              for (const key of new Set([...Object.keys(oldValues), ...Object.keys(newValues)])) {
                if (oldValues[key] !== newValues[key]) {
                  console.log(
                    `      ${key}: ${formatValue(oldValues[key])} -> ${formatValue(newValues[key])}`
                  )
                }
              }
            } else if (log.operation === 'DELETE') {
              console.log(prism.red('    - Deleted with:'))
              if (log.old_values) {
                for (const [key, value] of Object.entries(parseJsonColumn(log.old_values))) {
                  console.log(`      ${key}: ${formatValue(value)}`)
                }
              }
            }
          }
        }
      } else {
        // Table view
        const tableData = logs.map(log => ({
          ID: log.id,
          Time: formatDate(log.changed_at, true),
          Table: log.table_name,
          Operation: formatAction(log.operation, true),
          Entity: log.entity_id,
          User: log.changed_by ?? 'system',
          Changes: countChangedFields(log)
        }))

        console.log('')
        table(tableData)
      }

      // Show summary
      if (!options.json) {
        console.log('')
        console.log(
          prism.gray(
            `Showing ${logs.length} of ${logs.length >= limit ? 'possibly more' : 'all'} audit logs`
          )
        )

        if (logs.length >= limit) {
          console.log(prism.gray(`Use --limit to show more results`))
        }
      }
    }
  )
}

/** Number of fields touched by an audit entry (for the table view). */
function countChangedFields(log: AuditLogRow): number {
  if (log.operation === 'INSERT') {
    return Object.keys(parseJsonColumn(log.new_values)).length
  }
  if (log.operation === 'DELETE') {
    return Object.keys(parseJsonColumn(log.old_values)).length
  }
  const oldValues = parseJsonColumn(log.old_values)
  const newValues = parseJsonColumn(log.new_values)
  let changed = 0
  for (const key of new Set([...Object.keys(oldValues), ...Object.keys(newValues)])) {
    if (JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key])) {
      changed++
    }
  }
  return changed
}

function formatDate(date: string | Date, compact = false): string {
  const d = new Date(date)
  if (compact) {
    // Format: 2025-01-01 10:00
    return d.toISOString().slice(0, 16).replace('T', ' ')
  } else {
    // Format: 2025-01-01 10:00:00
    return d.toISOString().slice(0, 19).replace('T', ' ')
  }
}

function formatAction(action: string, compact = false): string {
  const colors: Record<string, ((text: string) => string) | undefined> = {
    INSERT: prism.green,
    UPDATE: prism.yellow,
    DELETE: prism.red
  }

  const color = colors[action] ?? prism.white

  if (compact) {
    // Use symbols for compact view
    const symbols: Record<string, string | undefined> = {
      INSERT: '+',
      UPDATE: '~',
      DELETE: '-'
    }
    return color(symbols[action] ?? action)
  }

  return color(action)
}

function formatValue(value: unknown): string {
  switch (typeof value) {
    case 'undefined':
      return prism.gray('undefined')
    case 'string':
      return `"${value}"`
    case 'boolean':
      return value ? prism.green('true') : prism.red('false')
    case 'object':
      if (value === null) return prism.gray('NULL')
      if (value instanceof Date) return value.toISOString()
      return prism.gray(JSON.stringify(value))
    default:
      return String(value)
  }
}
