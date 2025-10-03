import { Command } from 'commander'
import { prism, spinner, table } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface LogsOptions {
  table?: string
  user?: string
  action?: 'INSERT' | 'UPDATE' | 'DELETE'
  limit?: string
  since?: string
  until?: string
  entityId?: string
  json?: boolean
  verbose?: boolean
  config?: string
}

export function logsCommand(): Command {
  const cmd = new Command('logs')
    .description('Query audit logs with filters')
    .option('-t, --table <name>', 'Filter by table name')
    .option('-u, --user <id>', 'Filter by user ID')
    .option('-a, --action <type>', 'Filter by action (INSERT/UPDATE/DELETE)')
    .option('-l, --limit <n>', 'Limit number of results', '50')
    .option('-s, --since <datetime>', 'Show logs since datetime (ISO 8601)')
    .option('--until <datetime>', 'Show logs until datetime (ISO 8601)')
    .option('-e, --entity-id <id>', 'Filter by entity ID')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed information including changes')
    .option('-c, --config <path>', 'Path to configuration file')
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

  const querySpinner = spinner() as any
  querySpinner.start('Querying audit logs...')

  try {
    // Check if audit_logs table exists
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
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
    let query = db
      .selectFrom('audit_logs')
      .selectAll()
      .orderBy('created_at', 'desc')

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
    query = query.limit(limit)

    // Execute query
    const logs = await query.execute()

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
        console.log(prism.bold(`📝 Audit Log #${log['id']}`))
        console.log(prism.gray('─'.repeat(50)))
        console.log(`  Timestamp: ${formatDate(log['created_at'])}`)
        console.log(`  Table: ${prism.cyan(log['table_name'])}`)
        console.log(`  Action: ${formatAction(log['action'])}`)
        console.log(`  Entity ID: ${log['entity_id']}`)
        console.log(`  User: ${log['user_id'] || prism.gray('system')}`)

        if (log['metadata']) {
          console.log(`  Metadata: ${prism.gray(JSON.stringify(log['metadata']))}`)
        }

        if (log['old_values'] || log['new_values']) {
          console.log('')
          console.log(prism.cyan('  Changes:'))

          if (log['action'] === 'INSERT') {
            console.log(prism.green('    + Created with:'))
            if (log['new_values']) {
              const values = typeof log['new_values'] === 'string'
                ? JSON.parse(log['new_values'])
                : log['new_values']
              for (const [key, value] of Object.entries(values)) {
                console.log(`      ${key}: ${formatValue(value)}`)
              }
            }
          } else if (log['action'] === 'UPDATE') {
            const oldValues = log['old_values']
              ? (typeof log['old_values'] === 'string' ? JSON.parse(log['old_values']) : log['old_values'])
              : {}
            const newValues = log['new_values']
              ? (typeof log['new_values'] === 'string' ? JSON.parse(log['new_values']) : log['new_values'])
              : {}

            for (const key of new Set([...Object.keys(oldValues), ...Object.keys(newValues)])) {
              if (oldValues[key] !== newValues[key]) {
                console.log(`      ${key}: ${formatValue(oldValues[key])} → ${formatValue(newValues[key])}`)
              }
            }
          } else if (log['action'] === 'DELETE') {
            console.log(prism.red('    - Deleted with:'))
            if (log['old_values']) {
              const values = typeof log['old_values'] === 'string'
                ? JSON.parse(log['old_values'])
                : log['old_values']
              for (const [key, value] of Object.entries(values)) {
                console.log(`      ${key}: ${formatValue(value)}`)
              }
            }
          }
        }
      }
    } else {
      // Table view
      const tableData = logs.map((log: any) => ({
        ID: log['id'],
        Time: formatDate(log['created_at'], true),
        Table: log['table_name'],
        Action: formatAction(log['action'], true),
        Entity: log['entity_id'],
        User: log['user_id'] || 'system',
        Changes: log['changes_count'] || '-'
      }))

      console.log('')
      console.log(table(tableData))
    }

    // Show summary
    if (!options.json) {
      console.log('')
      console.log(prism.gray(`Showing ${logs.length} of ${logs.length >= limit ? 'possibly more' : 'all'} audit logs`))

      if (logs.length >= limit) {
        console.log(prism.gray(`Use --limit to show more results`))
      }
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

function formatDate(date: any, compact: boolean = false): string {
  const d = new Date(date)
  if (compact) {
    // Format: 2025-01-01 10:00
    return d.toISOString().slice(0, 16).replace('T', ' ')
  } else {
    // Format: 2025-01-01 10:00:00
    return d.toISOString().slice(0, 19).replace('T', ' ')
  }
}

function formatAction(action: string, compact: boolean = false): string {
  const colors: Record<string, (text: string) => string> = {
    INSERT: prism.green,
    UPDATE: prism.yellow,
    DELETE: prism.red
  }

  const color = colors[action] || prism.white

  if (compact) {
    // Use symbols for compact view
    const symbols: Record<string, string> = {
      INSERT: '+',
      UPDATE: '~',
      DELETE: '-'
    }
    return color(symbols[action] || action)
  }

  return color(action)
}

function formatValue(value: any): string {
  if (value === null) {
    return prism.gray('NULL')
  } else if (value === undefined) {
    return prism.gray('undefined')
  } else if (typeof value === 'string') {
    return `"${value}"`
  } else if (typeof value === 'boolean') {
    return value ? prism.green('true') : prism.red('false')
  } else if (value instanceof Date) {
    return value.toISOString()
  } else if (typeof value === 'object') {
    return prism.gray(JSON.stringify(value))
  } else {
    return String(value)
  }
}