import { Command } from 'commander'
import { prism, spinner, table, select } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface TimestampQueryOptions {
  table: string
  column?: string
  since?: string
  until?: string
  between?: string
  today?: boolean
  yesterday?: boolean
  thisWeek?: boolean
  thisMonth?: boolean
  lastDays?: string
  limit?: string
  orderBy?: 'asc' | 'desc'
  select?: string
  count?: boolean
  json?: boolean
  config?: string
}

interface TimestampQueryResult {
  table: string
  column: string
  query: string
  rowCount: number
  rows?: any[]
  timeRange: {
    start: Date
    end: Date
  }
}

export function byTimestampCommand(): Command {
  const cmd = new Command('by-timestamp')
    .description('Query records by timestamp ranges')
    .argument('<table>', 'Table name to query')
    .option('-c, --column <name>', 'Timestamp column name', 'created_at')
    .option('-s, --since <datetime>', 'Records since datetime (ISO 8601)')
    .option('-u, --until <datetime>', 'Records until datetime (ISO 8601)')
    .option('-b, --between <range>', 'Between date range (e.g., "2025-01-01,2025-01-31")')
    .option('--today', 'Records from today')
    .option('--yesterday', 'Records from yesterday')
    .option('--this-week', 'Records from this week')
    .option('--this-month', 'Records from this month')
    .option('--last-days <n>', 'Records from last N days')
    .option('-l, --limit <n>', 'Limit number of results', '100')
    .option('-o, --order-by <dir>', 'Order by timestamp (asc/desc)', 'desc')
    .option('--select <columns>', 'Columns to select (comma-separated)')
    .option('--count', 'Return count only')
    .option('--json', 'Output as JSON')
    .option('--config <path>', 'Path to configuration file')
    .action(async (tableName: string, options: TimestampQueryOptions) => {
      try {
        await queryByTimestamp(tableName, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to query by timestamp: ${error instanceof Error ? error.message : String(error)}`,
          'TIMESTAMP_QUERY_ERROR'
        )
      }
    })

  return cmd
}

async function queryByTimestamp(tableName: string, options: TimestampQueryOptions): Promise<void> {
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

  const querySpinner = spinner()
  querySpinner.start('Querying records by timestamp...')

  try {
    // Verify table exists
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_name', '=', tableName)
      .execute()

    if (tables.length === 0) {
      querySpinner.fail(`Table '${tableName}' not found`)
      return
    }

    // Determine timestamp column
    const timestampColumn = options.column || 'created_at'

    // Verify column exists
    const columns = await db
      .selectFrom('information_schema.columns')
      .select('column_name')
      .where('table_name', '=', tableName)
      .where('column_name', '=', timestampColumn)
      .execute()

    if (columns.length === 0) {
      querySpinner.fail(`Column '${timestampColumn}' not found in table '${tableName}'`)
      console.log('')
      console.log(prism.yellow('Available timestamp columns might include:'))
      console.log('  - created_at')
      console.log('  - updated_at')
      console.log('  - timestamp')
      console.log('  - date_created')
      console.log('')
      console.log('Use --column to specify the correct timestamp column')
      return
    }

    // Determine time range
    const timeRange = getTimeRange(options)

    if (!timeRange) {
      querySpinner.fail('No time range specified')
      console.log('')
      console.log(prism.yellow('Please specify a time range using one of:'))
      console.log('  --since <datetime>    Records since a specific date')
      console.log('  --until <datetime>    Records until a specific date')
      console.log('  --between <range>     Records between two dates')
      console.log('  --today              Records from today')
      console.log('  --yesterday          Records from yesterday')
      console.log('  --this-week          Records from this week')
      console.log('  --this-month         Records from this month')
      console.log('  --last-days <n>      Records from last N days')
      return
    }

    // Build query
    let query = db.selectFrom(tableName)

    // Select columns
    if (options.select) {
      const columns = options.select.split(',').map(c => c.trim())
      query = query.select(columns as any)
    } else if (!options.count) {
      query = query.selectAll()
    }

    // Add timestamp conditions
    query = query
      .where(timestampColumn, '>=', timeRange.start)
      .where(timestampColumn, '<=', timeRange.end)

    // Add ordering
    query = query.orderBy(timestampColumn, options.orderBy || 'desc')

    // Add limit
    const limit = parseInt(options.limit || '100', 10)
    if (!options.count) {
      query = query.limit(limit)
    }

    // Execute query
    let result: TimestampQueryResult

    if (options.count) {
      const countResult = await db
        .selectFrom(tableName)
        .select(db.fn.countAll().as('count'))
        .where(timestampColumn, '>=', timeRange.start)
        .where(timestampColumn, '<=', timeRange.end)
        .executeTakeFirst()

      result = {
        table: tableName,
        column: timestampColumn,
        query: query.compile().sql,
        rowCount: Number(countResult?.count || 0),
        timeRange
      }
    } else {
      const rows = await query.execute()

      result = {
        table: tableName,
        column: timestampColumn,
        query: query.compile().sql,
        rowCount: rows.length,
        rows,
        timeRange
      }
    }

    querySpinner.succeed(`Found ${result.rowCount} record${result.rowCount !== 1 ? 's' : ''}`)

    // Display results
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      displayTimestampQueryResults(result, options)
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

function getTimeRange(options: TimestampQueryOptions): { start: Date; end: Date } | null {
  const now = new Date()

  // Specific date range options
  if (options.since && options.until) {
    return {
      start: new Date(options.since),
      end: new Date(options.until)
    }
  }

  if (options.since) {
    return {
      start: new Date(options.since),
      end: now
    }
  }

  if (options.until) {
    return {
      start: new Date(0), // Unix epoch
      end: new Date(options.until)
    }
  }

  if (options.between) {
    const [startStr, endStr] = options.between.split(',').map(s => s.trim())
    if (startStr && endStr) {
      return {
        start: new Date(startStr),
        end: new Date(endStr)
      }
    }
  }

  // Preset ranges
  if (options.today) {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (options.yesterday) {
    const start = new Date(now)
    start.setDate(start.getDate() - 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setDate(end.getDate() - 1)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (options.thisWeek) {
    const start = new Date(now)
    const dayOfWeek = start.getDay()
    const diff = start.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1) // Monday
    start.setDate(diff)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    return { start, end }
  }

  if (options.thisMonth) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return { start, end }
  }

  if (options.lastDays) {
    const days = parseInt(options.lastDays, 10)
    const start = new Date(now)
    start.setDate(start.getDate() - days)
    start.setHours(0, 0, 0, 0)
    return { start, end: now }
  }

  return null
}

function displayTimestampQueryResults(result: TimestampQueryResult, options: TimestampQueryOptions): void {
  console.log('')
  console.log(prism.bold(`📅 Timestamp Query Results`))
  console.log(prism.gray('─'.repeat(60)))

  // Query info
  console.log('')
  console.log(prism.cyan('Query Details:'))
  console.log(`  Table: ${result.table}`)
  console.log(`  Column: ${result.column}`)
  console.log(`  Time Range: ${formatDateRange(result.timeRange.start, result.timeRange.end)}`)
  console.log(`  Records Found: ${result.rowCount}`)

  if (options.count) {
    // Count only - already displayed above
    return
  }

  // Display rows
  if (result.rows && result.rows.length > 0) {
    console.log('')
    console.log(prism.cyan('Records:'))

    // Format rows for display
    const displayRows = result.rows.map((row: any) => {
      const formatted: any = {}

      for (const [key, value] of Object.entries(row)) {
        if (value === null) {
          formatted[key] = prism.gray('NULL')
        } else if (value instanceof Date) {
          formatted[key] = value.toISOString()
        } else if (key === result.column && isDateString(value)) {
          formatted[key] = new Date(value as string).toISOString()
        } else if (typeof value === 'boolean') {
          formatted[key] = value ? prism.green('true') : prism.red('false')
        } else if (typeof value === 'string' && value.length > 50) {
          formatted[key] = value.substring(0, 47) + '...'
        } else {
          formatted[key] = String(value)
        }
      }

      return formatted
    })

    console.log(table(displayRows))

    // Time distribution
    if (result.rows.length > 1) {
      console.log('')
      console.log(prism.cyan('Time Distribution:'))
      displayTimeDistribution(result.rows, result.column)
    }

    // Show limit info
    const limit = parseInt(options.limit || '100', 10)
    if (result.rowCount >= limit) {
      console.log('')
      console.log(prism.gray(`Showing first ${limit} records. Use --limit to show more.`))
    }
  } else {
    console.log('')
    console.log(prism.gray('No records found in the specified time range'))
  }

  // Show SQL query
  console.log('')
  console.log(prism.gray('SQL Query:'))
  console.log(prism.gray(`  ${result.query}`))
}

function displayTimeDistribution(rows: any[], timestampColumn: string): void {
  // Group by day/hour depending on range
  const timestamps = rows.map(r => new Date(r[timestampColumn]))
  const minTime = Math.min(...timestamps.map(t => t.getTime()))
  const maxTime = Math.max(...timestamps.map(t => t.getTime()))
  const rangeHours = (maxTime - minTime) / (1000 * 60 * 60)

  let buckets: Map<string, number>

  if (rangeHours <= 24) {
    // Group by hour
    buckets = new Map()
    for (const timestamp of timestamps) {
      const key = timestamp.toISOString().slice(0, 13) + ':00'
      buckets.set(key, (buckets.get(key) || 0) + 1)
    }
  } else if (rangeHours <= 24 * 7) {
    // Group by day
    buckets = new Map()
    for (const timestamp of timestamps) {
      const key = timestamp.toISOString().slice(0, 10)
      buckets.set(key, (buckets.get(key) || 0) + 1)
    }
  } else {
    // Group by week
    buckets = new Map()
    for (const timestamp of timestamps) {
      const weekStart = new Date(timestamp)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      const key = 'Week of ' + weekStart.toISOString().slice(0, 10)
      buckets.set(key, (buckets.get(key) || 0) + 1)
    }
  }

  // Display distribution
  const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  const maxCount = Math.max(...sortedBuckets.map(([, count]) => count))

  for (const [period, count] of sortedBuckets) {
    const barLength = Math.round((count / maxCount) * 30)
    const bar = '█'.repeat(barLength) + '░'.repeat(30 - barLength)
    console.log(`  ${period.padEnd(20)}: ${bar} ${count}`)
  }
}

function formatDateRange(start: Date, end: Date): string {
  const now = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  // Check for common ranges
  if (start.toDateString() === today.toDateString() && end.toDateString() === today.toDateString()) {
    return 'Today'
  }

  if (start.toDateString() === yesterday.toDateString() && end.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  }

  // Format custom range
  const startStr = start.toLocaleDateString()
  const endStr = end.toLocaleDateString()

  if (startStr === endStr) {
    return startStr
  }

  return `${startStr} to ${endStr}`
}

function isDateString(value: any): boolean {
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return !isNaN(date.getTime()) && value.includes('-')
}