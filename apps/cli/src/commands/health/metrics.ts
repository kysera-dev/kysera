import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { displayTable as table } from '../../utils/table-helper.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import type { MetricsResult } from '@kysera/infra'

export interface MetricsOptions {
  json?: boolean
  /** Always set: commander applies a '1h' default. */
  period: string
  config?: string
}

interface TableMetrics {
  name: string
  rowCount?: number
  size?: number
  indexSize?: number
}

interface PostgresMetrics {
  cacheHitRatio: number
  indexHitRatio: number
  deadlocks?: number
  tempFiles?: number
  tempBytes?: number
  transactionRate?: number
  rollbackRate?: number
}

interface MysqlMetrics {
  bufferPoolHitRatio: number
  queryCacheHitRatio: number
  threadsConnected?: number
  threadsRunning?: number
  tableLocksWaited?: number
  slowQueries?: number
  questionsRate?: number
}

interface SlowQueryEntry {
  query: string
  duration: number
  timestamp: string
}

/**
 * Metrics shape rendered by this command. `getMetrics()` currently returns
 * only the base MetricsResult sections; the extra sections are rendered
 * when a richer collector provides them.
 */
interface DisplayMetrics extends MetricsResult {
  connections?: NonNullable<MetricsResult['connections']> & { errors?: number }
  queries?: NonNullable<MetricsResult['queries']> & { errorCount?: number }
  tables?: TableMetrics[]
  postgres?: PostgresMetrics
  mysql?: MysqlMetrics
  slowQueries?: SlowQueryEntry[]
}

export function metricsCommand(): Command {
  const cmd = new Command('metrics')
    .description('Show detailed database metrics')
    .option('--json', 'Output as JSON')
    .option('--period <period>', 'Time period (1h, 24h, 7d)', '1h')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: MetricsOptions) => {
      try {
        await showMetrics(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to get metrics: ${error instanceof Error ? error.message : String(error)}`,
          'HEALTH_METRICS_ERROR'
        )
      }
    })

  return cmd
}

async function showMetrics(options: MetricsOptions): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config)

  if (!config.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option'
    ])
  }

  // Get database connection
  const db = await getDatabaseConnection(config.database)

  if (!db) {
    throw new CLIError('Failed to connect to database', 'DATABASE_ERROR', [
      'Check your database configuration',
      'Ensure the database server is running'
    ])
  }

  try {
    // Get metrics from the database. getMetrics is synchronous, but unit
    // tests stub it with a promise, so tolerate both.
    const { getMetrics } = await import('@kysera/infra')
    const metrics: DisplayMetrics = await Promise.resolve(
      getMetrics(db, {
        period: options.period || '1h'
      })
    )

    if (options.json) {
      console.log(JSON.stringify(metrics, null, 2))
      return
    }

    // Display metrics
    displayMetrics(metrics, config.database.dialect)
  } finally {
    // Close database connection
    await db.destroy()
  }
}

function displayMetrics(metrics: DisplayMetrics, dialect: string): void {
  console.log('')
  console.log(prism.bold('📊 Database Metrics'))
  console.log(prism.gray(`Period: ${metrics.period || 'Last hour'}`))
  console.log(prism.gray('─'.repeat(60)))
  console.log('')

  // Connection Metrics
  if (metrics.connections) {
    console.log(prism.cyan('Connection Metrics:'))
    table([
      ['Metric', 'Value'],
      ['Total Connections', metrics.connections.total || 'N/A'],
      ['Active Connections', metrics.connections.active || 'N/A'],
      ['Idle Connections', metrics.connections.idle || 'N/A'],
      ['Max Connections', metrics.connections.max || 'N/A'],
      ['Connection Errors', metrics.connections.errors ?? '0']
    ])
    console.log('')
  }

  // Query Performance
  if (metrics.queries) {
    console.log(prism.cyan('Query Performance:'))
    table([
      ['Metric', 'Value'],
      ['Total Queries', formatNumber(metrics.queries.total || 0)],
      ['Average Duration', `${metrics.queries.avgDuration || 0}ms`],
      ['Min Duration', `${metrics.queries.minDuration || 0}ms`],
      ['Max Duration', `${metrics.queries.maxDuration || 0}ms`],
      ['95th Percentile', `${metrics.queries.p95Duration || 0}ms`],
      ['99th Percentile', `${metrics.queries.p99Duration || 0}ms`],
      ['Slow Queries (>100ms)', formatNumber(metrics.queries.slowCount || 0)],
      ['Failed Queries', formatNumber(metrics.queries.errorCount ?? 0)]
    ])
    console.log('')
  }

  // Table Statistics
  if (metrics.tables && metrics.tables.length > 0) {
    console.log(prism.cyan('Table Statistics:'))
    const tableData = metrics.tables
      .sort((a, b) => (b.rowCount ?? 0) - (a.rowCount ?? 0))
      .slice(0, 10) // Top 10 tables
      .map(t => ({
        Table: t.name,
        'Row Count': formatNumber(t.rowCount ?? 0),
        Size: formatBytes(t.size ?? 0),
        'Index Size': formatBytes(t.indexSize ?? 0)
      }))

    table(tableData)
    console.log('')
  }

  // Database specific metrics
  if (dialect === 'postgres' && metrics.postgres) {
    console.log(prism.cyan('PostgreSQL Specific:'))
    table([
      ['Metric', 'Value'],
      ['Cache Hit Ratio', `${(metrics.postgres.cacheHitRatio * 100).toFixed(2)}%`],
      ['Index Hit Ratio', `${(metrics.postgres.indexHitRatio * 100).toFixed(2)}%`],
      ['Deadlocks', metrics.postgres.deadlocks ?? '0'],
      ['Temp Files', formatNumber(metrics.postgres.tempFiles ?? 0)],
      ['Temp Size', formatBytes(metrics.postgres.tempBytes ?? 0)],
      ['Transaction Rate', `${metrics.postgres.transactionRate ?? 0}/s`],
      ['Rollback Rate', `${metrics.postgres.rollbackRate ?? 0}/s`]
    ])
    console.log('')
  } else if (dialect === 'mysql' && metrics.mysql) {
    console.log(prism.cyan('MySQL Specific:'))
    table([
      ['Metric', 'Value'],
      ['Buffer Pool Hit Ratio', `${(metrics.mysql.bufferPoolHitRatio * 100).toFixed(2)}%`],
      ['Query Cache Hit Ratio', `${(metrics.mysql.queryCacheHitRatio * 100).toFixed(2)}%`],
      ['Threads Connected', metrics.mysql.threadsConnected ?? '0'],
      ['Threads Running', metrics.mysql.threadsRunning ?? '0'],
      ['Table Locks Waited', metrics.mysql.tableLocksWaited ?? '0'],
      ['Slow Queries', formatNumber(metrics.mysql.slowQueries ?? 0)],
      ['Questions Rate', `${metrics.mysql.questionsRate ?? 0}/s`]
    ])
    console.log('')
  }

  // Slow Query Log
  if (metrics.slowQueries && metrics.slowQueries.length > 0) {
    console.log(prism.cyan('Recent Slow Queries:'))
    const slowTable = metrics.slowQueries
      .slice(0, 5) // Top 5 slow queries
      .map(q => ({
        Query: truncateQuery(q.query, 50),
        Duration: `${q.duration}ms`,
        Time: new Date(q.timestamp).toLocaleTimeString()
      }))

    table(slowTable)
    console.log('')
  }

  // Recommendations
  if (metrics.recommendations && metrics.recommendations.length > 0) {
    console.log(prism.yellow('⚠️  Recommendations:'))
    for (const rec of metrics.recommendations) {
      console.log(`  • ${rec}`)
    }
    console.log('')
  }

  console.log(prism.gray('─'.repeat(60)))
  console.log(prism.gray(`Last updated: ${new Date().toLocaleString()}`))
}

function formatNumber(num: number): string {
  return num.toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`
}

function truncateQuery(query: string, maxLength: number): string {
  if (!query) return ''
  if (query.length <= maxLength) return query

  return query.substring(0, maxLength - 3) + '...'
}
