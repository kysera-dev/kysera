import { Command } from 'commander'
import { prism, spinner, table as displayTable } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface StatsOptions {
  table?: string
  user?: string
  period?: string
  format?: 'table' | 'json' | 'chart'
  config?: string
}

export function statsCommand(): Command {
  const cmd = new Command('stats')
    .description('Show audit statistics')
    .option('-t, --table <name>', 'Filter by table name')
    .option('-u, --user <id>', 'Filter by user ID')
    .option('-p, --period <duration>', 'Time period (1h, 1d, 1w, 1m)', '1d')
    .option('-f, --format <type>', 'Output format (table/json/chart)', 'table')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: StatsOptions) => {
      try {
        await showAuditStats(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to show audit statistics: ${error instanceof Error ? error.message : String(error)}`,
          'STATS_ERROR'
        )
      }
    })

  return cmd
}

async function showAuditStats(options: StatsOptions): Promise<void> {
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

  const statsSpinner = spinner() as any
  statsSpinner.start('Calculating audit statistics...')

  try {
    // Check if audit_logs table exists
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_name', '=', 'audit_logs')
      .execute()

    if (tables.length === 0) {
      statsSpinner.fail('Audit logs table not found')
      console.log('')
      console.log(prism.yellow('The audit_logs table does not exist.'))
      console.log(prism.gray('Audit logging is not enabled for this database.'))
      return
    }

    // Parse period
    const periodMs = parsePeriod(options.period || '1d')
    const startDate = new Date(Date.now() - periodMs)

    // Build base query
    let query = db
      .selectFrom('audit_logs')
      .where('created_at', '>=', startDate)

    // Apply filters
    if (options.table) {
      query = query.where('table_name', '=', options.table)
    }

    if (options.user) {
      query = query.where('user_id', '=', options.user)
    }

    // Get total count
    const totalResult = await query
      .select(db.fn.countAll().as('count'))
      .executeTakeFirst()
    const totalCount = Number(totalResult?.count || 0)

    if (totalCount === 0) {
      statsSpinner.warn('No audit logs found for the specified period')
      return
    }

    // Get statistics by action type
    const actionStats = await query
      .select(['action'])
      .select(db.fn.count('action').as('count'))
      .groupBy('action')
      .execute()

    // Get statistics by table
    const tableStats = await query
      .select(['table_name'])
      .select(db.fn.count('table_name').as('count'))
      .groupBy('table_name')
      .orderBy(db.fn.count('table_name'), 'desc')
      .limit(10)
      .execute()

    // Get statistics by user
    const userStats = await query
      .select(['user_id'])
      .select(db.fn.count('user_id').as('count'))
      .groupBy('user_id')
      .orderBy(db.fn.count('user_id'), 'desc')
      .limit(10)
      .execute()

    // Get time-based statistics
    const timeStats = await getTimeBasedStats(db, query, options.period || '1d')

    statsSpinner.succeed('Statistics calculated successfully')

    // Output results
    if (options.format === 'json') {
      console.log(JSON.stringify({
        period: options.period,
        startDate: startDate.toISOString(),
        totalCount,
        actionStats,
        tableStats,
        userStats,
        timeStats
      }, null, 2))
    } else if (options.format === 'chart') {
      // Chart format
      console.log('')
      console.log(prism.bold(`📊 Audit Statistics (Last ${options.period || '1d'})`))
      console.log('')

      // Action chart
      console.log(prism.cyan('Operations by Type:'))
      const maxActionCount = Math.max(...actionStats.map((s: any) => Number(s.count)))
      for (const stat of actionStats) {
        const count = Number((stat as any).count)
        const percentage = Math.round((count / totalCount) * 100)
        const barLength = Math.round((count / maxActionCount) * 30)
        const bar = '█'.repeat(barLength) + '░'.repeat(30 - barLength)
        const actionColor = getActionColor((stat as any).action)
        console.log(`  ${actionColor(String((stat as any).action).padEnd(8))}: ${count.toString().padStart(6)} (${percentage.toString().padStart(3)}%) ${prism.gray(bar)}`)
      }

      // Table chart
      console.log('')
      console.log(prism.cyan('Top Modified Tables:'))
      const maxTableCount = Math.max(...tableStats.map((s: any) => Number(s.count)))
      for (const stat of tableStats.slice(0, 5)) {
        const count = Number((stat as any).count)
        const barLength = Math.round((count / maxTableCount) * 30)
        const bar = '█'.repeat(barLength) + '░'.repeat(30 - barLength)
        console.log(`  ${String((stat as any).table_name).padEnd(20)}: ${count.toString().padStart(6)} changes ${prism.gray(bar)}`)
      }

      // User chart
      console.log('')
      console.log(prism.cyan('Top Users:'))
      const maxUserCount = Math.max(...userStats.map((s: any) => Number(s.count)))
      for (const stat of userStats.slice(0, 5)) {
        const count = Number((stat as any).count)
        const barLength = Math.round((count / maxUserCount) * 30)
        const bar = '█'.repeat(barLength) + '░'.repeat(30 - barLength)
        const userId = (stat as any).user_id || 'system'
        console.log(`  ${String(userId).padEnd(20)}: ${count.toString().padStart(6)} changes ${prism.gray(bar)}`)
      }

      // Time chart
      console.log('')
      console.log(prism.cyan('Changes Over Time:'))
      const maxTimeCount = Math.max(...timeStats.map((s: any) => s.count))
      for (const stat of timeStats) {
        const barLength = Math.round((stat.count / maxTimeCount) * 30)
        const bar = '█'.repeat(barLength) + '░'.repeat(30 - barLength)
        console.log(`  ${stat.period.padEnd(20)}: ${stat.count.toString().padStart(6)} changes ${prism.gray(bar)}`)
      }

    } else {
      // Table format
      console.log('')
      console.log(prism.bold(`📊 Audit Statistics (Last ${options.period || '1d'})`))
      console.log('')

      // Operations by type
      console.log(prism.cyan('Operations by Type:'))
      const actionData = actionStats.map((stat: any) => ({
        Action: getActionColor(stat.action)(stat.action),
        Count: Number(stat.count).toLocaleString(),
        Percentage: `${Math.round((Number(stat.count) / totalCount) * 100)}%`
      }))
      console.log(displayTable(actionData))

      // Top modified tables
      console.log('')
      console.log(prism.cyan('Top Modified Tables:'))
      const tableData = tableStats.map((stat: any) => ({
        Table: stat.table_name,
        Changes: Number(stat.count).toLocaleString(),
        Percentage: `${Math.round((Number(stat.count) / totalCount) * 100)}%`
      }))
      console.log(displayTable(tableData))

      // Top users
      console.log('')
      console.log(prism.cyan('Top Users:'))
      const userData = userStats.map((stat: any) => ({
        User: stat.user_id || 'system',
        Changes: Number(stat.count).toLocaleString(),
        Percentage: `${Math.round((Number(stat.count) / totalCount) * 100)}%`
      }))
      console.log(displayTable(userData))

      // Summary
      console.log('')
      console.log(prism.gray('─'.repeat(50)))
      console.log(prism.gray('Summary:'))
      console.log(`  Period: Last ${options.period || '1d'}`)
      console.log(`  Total Changes: ${totalCount.toLocaleString()}`)
      console.log(`  Tables Affected: ${tableStats.length}`)
      console.log(`  Active Users: ${userStats.length}`)

      // Calculate average changes per hour
      const hoursInPeriod = periodMs / (1000 * 60 * 60)
      const avgPerHour = Math.round(totalCount / hoursInPeriod)
      console.log(`  Average per Hour: ${avgPerHour.toLocaleString()}`)
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

async function getTimeBasedStats(db: any, baseQuery: any, period: string): Promise<any[]> {
  const periodMs = parsePeriod(period)
  const intervals = getTimeIntervals(periodMs)

  const stats = []
  for (const interval of intervals) {
    const count = await baseQuery
      .where('created_at', '>=', interval.start)
      .where('created_at', '<', interval.end)
      .select(db.fn.countAll().as('count'))
      .executeTakeFirst()

    stats.push({
      period: interval.label,
      count: Number(count?.count || 0)
    })
  }

  return stats
}

function parsePeriod(period: string): number {
  const match = period.match(/^(\d+)([hdwm])$/)
  if (!match) {
    throw new CLIError(`Invalid period format: ${period}`, 'INVALID_PERIOD')
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  const multipliers: Record<string, number> = {
    h: 1000 * 60 * 60,           // hour
    d: 1000 * 60 * 60 * 24,      // day
    w: 1000 * 60 * 60 * 24 * 7,  // week
    m: 1000 * 60 * 60 * 24 * 30  // month (approximate)
  }

  return value * multipliers[unit]
}

function getTimeIntervals(periodMs: number): Array<{ start: Date; end: Date; label: string }> {
  const intervals = []
  const now = new Date()
  const bucketCount = 10

  // Determine bucket size and format based on period
  let bucketMs: number
  let formatFn: (date: Date) => string

  if (periodMs <= 1000 * 60 * 60 * 24) {
    // Up to 1 day: hourly buckets
    bucketMs = periodMs / bucketCount
    formatFn = (date) => date.toISOString().slice(11, 13) + ':00'
  } else if (periodMs <= 1000 * 60 * 60 * 24 * 7) {
    // Up to 1 week: daily buckets
    bucketMs = periodMs / bucketCount
    formatFn = (date) => date.toISOString().slice(0, 10)
  } else {
    // More than 1 week: weekly buckets
    bucketMs = periodMs / bucketCount
    formatFn = (date) => `Week of ${date.toISOString().slice(0, 10)}`
  }

  for (let i = bucketCount - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - (i * bucketMs))
    const start = new Date(end.getTime() - bucketMs)

    intervals.push({
      start,
      end,
      label: formatFn(start)
    })
  }

  return intervals
}

function getActionColor(action: string): (text: string) => string {
  const colors: Record<string, (text: string) => string> = {
    INSERT: prism.green,
    UPDATE: prism.yellow,
    DELETE: prism.red
  }

  return colors[action] || prism.white
}