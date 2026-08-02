import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { displayTable as table } from '../../utils/table-helper.js'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'

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

/** Row shape of the audit_logs table as queried by the audit commands. */
interface AuditLogRow {
  id: number
  table_name: string
  entity_id: string
  action: string
  old_values: unknown
  new_values: unknown
  user_id: string | null
  created_at: string | Date
  metadata: unknown
  changes_count?: number
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
    async (db, _config, schema) => {
      // Use schema-aware db for PostgreSQL
      const schemaDb = schema !== 'public' ? db.withSchema(schema) : db
      const querySpinner = spinner()
      querySpinner.start('Querying audit logs...')

      // Check if audit_logs table exists
      const tables = await schemaDb
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', schema)
        .where('table_name', '=', 'audit_logs')
        .execute()

      if (tables.length === 0) {
        querySpinner.fail('Audit logs table not found')
        console.log('')
        console.log(prism.yellow('The audit_logs table does not exist.'))
        console.log(prism.gray('To enable audit logging:'))
        console.log('  1. Install @kysera/audit package')
        console.log('  2. Run: kysera migrate create create_audit_logs')
        console.log('  3. Add audit plugin to your repositories')
        return
      }

      // Build query
      let query = schemaDb.selectFrom('audit_logs').selectAll().orderBy('created_at', 'desc')

      // Apply filters
      if (options.table) {
        query = query.where('table_name', '=', options.table)
      }

      if (options.user) {
        query = query.where('user_id', '=', options.user)
      }

      if (options.action) {
        query = query.where('action', '=', options.action)
      }

      if (options.entityId) {
        query = query.where('entity_id', '=', options.entityId)
      }

      if (options.since) {
        const sinceDate = new Date(options.since)
        if (isNaN(sinceDate.getTime())) {
          throw new CLIError('Invalid since date format', 'INVALID_DATE')
        }
        query = query.where('created_at', '>=', sinceDate)
      }

      if (options.until) {
        const untilDate = new Date(options.until)
        if (isNaN(untilDate.getTime())) {
          throw new CLIError('Invalid until date format', 'INVALID_DATE')
        }
        query = query.where('created_at', '<=', untilDate)
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
          console.log(`  Timestamp: ${formatDate(log.created_at)}`)
          console.log(`  Table: ${prism.cyan(log.table_name)}`)
          console.log(`  Action: ${formatAction(log.action)}`)
          console.log(`  Entity ID: ${log.entity_id}`)
          console.log(`  User: ${log.user_id ?? prism.gray('system')}`)

          if (log.metadata) {
            console.log(`  Metadata: ${prism.gray(JSON.stringify(log.metadata))}`)
          }

          if (log.old_values || log.new_values) {
            console.log('')
            console.log(prism.cyan('  Changes:'))

            if (log.action === 'INSERT') {
              console.log(prism.green('    + Created with:'))
              if (log.new_values) {
                const values = (
                  typeof log.new_values === 'string' ? JSON.parse(log.new_values) : log.new_values
                ) as Record<string, unknown>
                for (const [key, value] of Object.entries(values)) {
                  console.log(`      ${key}: ${formatValue(value)}`)
                }
              }
            } else if (log.action === 'UPDATE') {
              const oldValues = (
                log.old_values
                  ? typeof log.old_values === 'string'
                    ? JSON.parse(log.old_values)
                    : log.old_values
                  : {}
              ) as Record<string, unknown>
              const newValues = (
                log.new_values
                  ? typeof log.new_values === 'string'
                    ? JSON.parse(log.new_values)
                    : log.new_values
                  : {}
              ) as Record<string, unknown>

              for (const key of new Set([...Object.keys(oldValues), ...Object.keys(newValues)])) {
                if (oldValues[key] !== newValues[key]) {
                  console.log(
                    `      ${key}: ${formatValue(oldValues[key])} -> ${formatValue(newValues[key])}`
                  )
                }
              }
            } else if (log.action === 'DELETE') {
              console.log(prism.red('    - Deleted with:'))
              if (log.old_values) {
                const values = (
                  typeof log.old_values === 'string' ? JSON.parse(log.old_values) : log.old_values
                ) as Record<string, unknown>
                for (const [key, value] of Object.entries(values)) {
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
          Time: formatDate(log.created_at, true),
          Table: log.table_name,
          Action: formatAction(log.action, true),
          Entity: log.entity_id,
          User: log.user_id ?? 'system',
          Changes: log.changes_count ?? '-'
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
