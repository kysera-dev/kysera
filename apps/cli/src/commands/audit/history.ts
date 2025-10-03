import { Command } from 'commander'
import { prism, spinner } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface HistoryOptions {
  limit?: string
  showValues?: boolean
  json?: boolean
  reverse?: boolean
  config?: string
}

export function historyCommand(): Command {
  const cmd = new Command('history')
    .description('Show entity history timeline')
    .argument('<table>', 'Table name')
    .argument('<id>', 'Entity ID')
    .option('-l, --limit <n>', 'Limit number of results', '20')
    .option('--show-values', 'Show changed values')
    .option('--json', 'Output as JSON')
    .option('--reverse', 'Show oldest first (default: newest first)')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (table: string, entityId: string, options: HistoryOptions) => {
      try {
        await showEntityHistory(table, entityId, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to show entity history: ${error instanceof Error ? error.message : String(error)}`,
          'HISTORY_ERROR'
        )
      }
    })

  return cmd
}

async function showEntityHistory(tableName: string, entityId: string, options: HistoryOptions): Promise<void> {
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

  const historySpinner = spinner() as any
  historySpinner.start(`Fetching history for ${tableName} #${entityId}...`)

  try {
    // Check if audit_logs table exists
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_name', '=', 'audit_logs')
      .execute()

    if (tables.length === 0) {
      historySpinner.fail('Audit logs table not found')
      console.log('')
      console.log(prism.yellow('The audit_logs table does not exist.'))
      console.log(prism.gray('Audit logging is not enabled for this database.'))
      return
    }

    // Get history for the entity
    const limit = parseInt(options.limit || '20', 10)
    let query = db
      .selectFrom('audit_logs')
      .selectAll()
      .where('table_name', '=', tableName)
      .where('entity_id', '=', entityId)
      .orderBy('created_at', options.reverse ? 'asc' : 'desc')
      .limit(limit)

    const history = await query.execute()

    if (history.length === 0) {
      historySpinner.warn(`No history found for ${tableName} #${entityId}`)
      return
    }

    historySpinner.succeed(`Found ${history.length} history record${history.length !== 1 ? 's' : ''}`)

    // Output results
    if (options.json) {
      console.log(JSON.stringify(history, null, 2))
    } else {
      // Timeline view
      console.log('')
      console.log(prism.bold(`📜 Entity History: ${tableName} #${entityId}`))
      console.log('')

      // Get current state if entity still exists
      try {
        const currentEntity = await db
          .selectFrom(tableName)
          .selectAll()
          .where('id', '=', entityId)
          .executeTakeFirst()

        if (currentEntity) {
          console.log(prism.green('● Current State'))
          if (options.showValues) {
            console.log(prism.gray('  ' + JSON.stringify(currentEntity, null, 2).split('\n').join('\n  ')))
          }
          console.log('')
        }
      } catch (error) {
        // Entity might not exist anymore
        // Could not fetch current state, entity might not exist anymore
      }

      // Show history timeline
      for (let i = 0; i < history.length; i++) {
        const log = history[i] as any
        const isLast = i === history.length - 1
        const connector = isLast ? '└─' : '├─'
        const line = isLast ? '  ' : '│ '

        // Format timestamp
        const timestamp = new Date(log.created_at).toLocaleString()

        // Format action with color
        let actionColor = prism.white
        switch (log.action) {
          case 'INSERT':
            actionColor = prism.green
            break
          case 'UPDATE':
            actionColor = prism.yellow
            break
          case 'DELETE':
            actionColor = prism.red
            break
        }

        // Main timeline entry
        console.log(`${connector} ${prism.gray(timestamp)} | ${actionColor(log.action)} | ${log.user_id || prism.gray('system')}`)

        // Show audit ID if verbose
        if (log.id) {
          console.log(`${line}   ${prism.gray(`Audit #${log.id}`)}`)
        }

        // Show changes if requested
        if (options.showValues) {
          if (log.action === 'INSERT') {
            console.log(`${line}   ${prism.green('Created with:')}`)
            if (log.new_values) {
              const values = parseJson(log.new_values)
              for (const [key, value] of Object.entries(values)) {
                console.log(`${line}     ${key}: ${formatValue(value)}`)
              }
            }
          } else if (log.action === 'UPDATE') {
            console.log(`${line}   ${prism.yellow('Changed fields:')}`)
            const oldValues = parseJson(log.old_values) || {}
            const newValues = parseJson(log.new_values) || {}

            for (const key of new Set([...Object.keys(oldValues), ...Object.keys(newValues)])) {
              if (oldValues[key] !== newValues[key]) {
                console.log(`${line}     ${key}: ${formatValue(oldValues[key])} → ${formatValue(newValues[key])}`)
              }
            }
          } else if (log.action === 'DELETE') {
            console.log(`${line}   ${prism.red('Deleted with:')}`)
            if (log.old_values) {
              const values = parseJson(log.old_values)
              for (const [key, value] of Object.entries(values)) {
                console.log(`${line}     ${key}: ${formatValue(value)}`)
              }
            }
          }

          // Show metadata if available
          if (log.metadata) {
            const metadata = parseJson(log.metadata)
            if (metadata && Object.keys(metadata).length > 0) {
              console.log(`${line}   ${prism.gray('Metadata:')}`)
              for (const [key, value] of Object.entries(metadata)) {
                console.log(`${line}     ${key}: ${formatValue(value)}`)
              }
            }
          }
        }

        // Add spacing between entries
        if (!isLast) {
          console.log('│')
        }
      }

      // Show summary
      console.log('')
      console.log(prism.gray('─'.repeat(50)))

      // Calculate time span
      const firstEntry = history[history.length - 1] as any
      const lastEntry = history[0] as any
      const timeSpan = new Date(lastEntry.created_at).getTime() - new Date(firstEntry.created_at).getTime()
      const days = Math.floor(timeSpan / (1000 * 60 * 60 * 24))
      const hours = Math.floor((timeSpan % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

      console.log(prism.gray('Summary:'))
      console.log(`  Total Changes: ${history.length}`)
      console.log(`  Time Span: ${days} days, ${hours} hours`)

      // Count by action type
      const actionCounts: Record<string, number> = {}
      for (const log of history) {
        const action = (log as any).action
        actionCounts[action] = (actionCounts[action] || 0) + 1
      }
      console.log(`  Actions: ${Object.entries(actionCounts).map(([a, c]) => `${a} (${c})`).join(', ')}`)

      // Count by user
      const userCounts: Record<string, number> = {}
      for (const log of history) {
        const userId = (log as any).user_id || 'system'
        userCounts[userId] = (userCounts[userId] || 0) + 1
      }
      const topUsers = Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
      console.log(`  Top Users: ${topUsers.map(([u, c]) => `${u} (${c})`).join(', ')}`)

      if (history.length >= limit) {
        console.log('')
        console.log(prism.gray(`Showing ${history.length} of possibly more entries. Use --limit to show more.`))
      }
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

function parseJson(value: any): any {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value || {}
}

function formatValue(value: any): string {
  if (value === null) {
    return prism.gray('NULL')
  } else if (value === undefined) {
    return prism.gray('undefined')
  } else if (typeof value === 'string') {
    // Truncate long strings
    if (value.length > 50) {
      return `"${value.substring(0, 47)}..."`;
    }
    return `"${value}"`
  } else if (typeof value === 'boolean') {
    return value ? prism.green('true') : prism.red('false')
  } else if (value instanceof Date || (typeof value === 'string' && !isNaN(Date.parse(value)) && value.includes('-'))) {
    return new Date(value).toLocaleString()
  } else if (typeof value === 'object') {
    return prism.gray(JSON.stringify(value))
  } else {
    return String(value)
  }
}