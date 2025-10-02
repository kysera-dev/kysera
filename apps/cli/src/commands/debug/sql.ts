import { Command } from 'commander'
import { prism, spinner, table } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

export interface SqlDebugOptions {
  watch?: boolean
  filter?: string
  highlight?: string
  showParams?: boolean
  showDuration?: boolean
  limit?: string
  config?: string
}

interface QueryLog {
  id: number
  timestamp: Date
  query: string
  params?: any[]
  duration?: number
  error?: string
  rowCount?: number
}

export function sqlCommand(): Command {
  const cmd = new Command('sql')
    .description('Real-time SQL query monitoring and debugging')
    .option('-w, --watch', 'Watch mode - monitor queries in real-time')
    .option('-f, --filter <pattern>', 'Filter queries by pattern (regex)')
    .option('-h, --highlight <keyword>', 'Highlight specific keywords')
    .option('--show-params', 'Show query parameters')
    .option('--show-duration', 'Show query execution time')
    .option('-l, --limit <n>', 'Limit number of queries to show', '50')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: SqlDebugOptions) => {
      try {
        await debugSql(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to debug SQL: ${error instanceof Error ? error.message : String(error)}`,
          'SQL_DEBUG_ERROR'
        )
      }
    })

  return cmd
}

async function debugSql(options: SqlDebugOptions): Promise<void> {
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

  const queryLogs: QueryLog[] = []
  let queryCounter = 0

  try {
    if (options.watch) {
      // Watch mode - monitor queries in real-time
      console.log(prism.cyan('🔍 SQL Debug Monitor'))
      console.log(prism.gray(`Connected to: ${config.database.dialect}`))
      console.log(prism.gray('Press Ctrl+C to exit'))
      console.log('')

      // Hook into Kysely's query execution
      const originalExecuteQuery = db.executeQuery.bind(db)

      // Override executeQuery to log queries
      ;(db as any).executeQuery = async function(compiledQuery: any) {
        const startTime = Date.now()
        const queryId = ++queryCounter

        const queryLog: QueryLog = {
          id: queryId,
          timestamp: new Date(),
          query: compiledQuery.sql,
          params: compiledQuery.parameters
        }

        // Apply filter if specified
        if (options.filter) {
          const regex = new RegExp(options.filter, 'i')
          if (!regex.test(queryLog.query)) {
            return originalExecuteQuery(compiledQuery)
          }
        }

        try {
          const result = await originalExecuteQuery(compiledQuery)

          queryLog.duration = Date.now() - startTime
          queryLog.rowCount = result.rows?.length || 0

          displayQuery(queryLog, options)
          queryLogs.push(queryLog)

          return result
        } catch (error) {
          queryLog.duration = Date.now() - startTime
          queryLog.error = error instanceof Error ? error.message : String(error)

          displayQuery(queryLog, options)
          queryLogs.push(queryLog)

          throw error
        }
      }

      // Keep the process running
      await new Promise((resolve) => {
        process.on('SIGINT', () => {
          console.log('')
          console.log(prism.gray('SQL monitoring stopped'))
          resolve(undefined)
        })
      })

      // Show summary
      showSummary(queryLogs)

    } else {
      // Analyze recent queries from logs/history
      await analyzeRecentQueries(db, options)
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

function displayQuery(queryLog: QueryLog, options: SqlDebugOptions): void {
  const timestamp = queryLog.timestamp.toLocaleTimeString()

  // Format query
  let formattedQuery = queryLog.query

  // Apply syntax highlighting
  formattedQuery = highlightSql(formattedQuery, options.highlight)

  // Truncate long queries
  if (formattedQuery.length > 200 && !options.showParams) {
    formattedQuery = formattedQuery.substring(0, 197) + '...'
  }

  // Build output line
  let output = `[${prism.gray(timestamp)}] `

  if (queryLog.error) {
    output += prism.red(`✗ #${queryLog.id} `)
  } else {
    output += prism.green(`✓ #${queryLog.id} `)
  }

  if (options.showDuration && queryLog.duration !== undefined) {
    const durationColor = queryLog.duration > 1000 ? prism.red
                        : queryLog.duration > 100 ? prism.yellow
                        : prism.green
    output += durationColor(`(${queryLog.duration}ms) `)
  }

  if (queryLog.rowCount !== undefined && !queryLog.error) {
    output += prism.cyan(`[${queryLog.rowCount} rows] `)
  }

  console.log(output)
  console.log(`  ${formattedQuery}`)

  if (options.showParams && queryLog.params && queryLog.params.length > 0) {
    console.log(prism.gray(`  Params: ${JSON.stringify(queryLog.params)}`))
  }

  if (queryLog.error) {
    console.log(prism.red(`  Error: ${queryLog.error}`))
  }

  console.log('')
}

function highlightSql(sql: string, highlightKeyword?: string): string {
  // Highlight SQL keywords
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX',
    'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
    'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'AS'
  ]

  let highlighted = sql

  // Highlight SQL keywords
  keywords.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi')
    highlighted = highlighted.replace(regex, prism.cyan(keyword))
  })

  // Highlight specific keyword if provided
  if (highlightKeyword) {
    const regex = new RegExp(highlightKeyword, 'gi')
    highlighted = highlighted.replace(regex, prism.yellow(highlightKeyword))
  }

  return highlighted
}

async function analyzeRecentQueries(db: any, options: SqlDebugOptions): Promise<void> {
  const analyzeSpinner = spinner()
  analyzeSpinner.start('Analyzing query logs...')

  try {
    // Check if we have a query_logs table (if using query logging)
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_name', '=', 'query_logs')
      .execute()

    if (tables.length === 0) {
      analyzeSpinner.warn('Query logs table not found')
      console.log('')
      console.log(prism.yellow('Query logging is not enabled.'))
      console.log(prism.gray('To enable query logging:'))
      console.log('  1. Create a query_logs table')
      console.log('  2. Configure Kysely to log queries')
      console.log('  3. Or use --watch mode for real-time monitoring')
      return
    }

    // Get recent queries
    const limit = parseInt(options.limit || '50', 10)
    let query = db
      .selectFrom('query_logs')
      .selectAll()
      .orderBy('executed_at', 'desc')
      .limit(limit)

    // Apply filter if specified
    if (options.filter) {
      query = query.where('query_text', 'like', `%${options.filter}%`)
    }

    const queries = await query.execute()

    if (queries.length === 0) {
      analyzeSpinner.warn('No queries found in logs')
      return
    }

    analyzeSpinner.succeed(`Found ${queries.length} recent queries`)

    // Display queries
    console.log('')
    console.log(prism.bold('📊 Recent Query Analysis'))
    console.log('')

    // Group queries by pattern
    const patterns = analyzeQueryPatterns(queries)

    // Show top patterns
    console.log(prism.cyan('Top Query Patterns:'))
    const topPatterns = Array.from(patterns.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)

    const patternData = topPatterns.map(([pattern, data]) => ({
      Pattern: pattern.length > 50 ? pattern.substring(0, 47) + '...' : pattern,
      Count: data.count,
      'Avg Duration': `${Math.round(data.totalDuration / data.count)}ms`,
      'Max Duration': `${data.maxDuration}ms`
    }))

    console.log(table(patternData))

    // Show slow queries
    const slowQueries = queries
      .filter((q: any) => q.duration_ms > 1000)
      .slice(0, 5)

    if (slowQueries.length > 0) {
      console.log('')
      console.log(prism.cyan('Slow Queries (>1s):'))

      for (const query of slowQueries) {
        const q = query as any
        console.log('')
        console.log(prism.red(`  ⚠ ${q.duration_ms}ms`))
        console.log(`  ${highlightSql(q.query_text, options.highlight)}`)
      }
    }

    // Show error queries
    const errorQueries = queries
      .filter((q: any) => q.error !== null)
      .slice(0, 5)

    if (errorQueries.length > 0) {
      console.log('')
      console.log(prism.cyan('Failed Queries:'))

      for (const query of errorQueries) {
        const q = query as any
        console.log('')
        console.log(prism.red(`  ✗ Error: ${q.error}`))
        console.log(`  ${highlightSql(q.query_text, options.highlight)}`)
      }
    }

    // Summary statistics
    const stats = calculateQueryStats(queries)
    console.log('')
    console.log(prism.gray('─'.repeat(50)))
    console.log(prism.gray('Summary:'))
    console.log(`  Total Queries: ${stats.total}`)
    console.log(`  Success Rate: ${stats.successRate.toFixed(1)}%`)
    console.log(`  Avg Duration: ${stats.avgDuration.toFixed(0)}ms`)
    console.log(`  P95 Duration: ${stats.p95Duration.toFixed(0)}ms`)
    console.log(`  Queries/min: ${stats.queriesPerMinute.toFixed(1)}`)

  } catch (error) {
    analyzeSpinner.fail('Failed to analyze queries')
    throw error
  }
}

function analyzeQueryPatterns(queries: any[]): Map<string, any> {
  const patterns = new Map<string, any>()

  for (const query of queries) {
    // Normalize query to find pattern
    const pattern = normalizeQuery(query.query_text)

    if (!patterns.has(pattern)) {
      patterns.set(pattern, {
        count: 0,
        totalDuration: 0,
        maxDuration: 0
      })
    }

    const data = patterns.get(pattern)!
    data.count++
    data.totalDuration += query.duration_ms || 0
    data.maxDuration = Math.max(data.maxDuration, query.duration_ms || 0)
  }

  return patterns
}

function normalizeQuery(query: string): string {
  // Remove specific values to find query pattern
  return query
    .replace(/\b\d+\b/g, '?')                    // Replace numbers with ?
    .replace(/'[^']*'/g, '?')                    // Replace string literals with ?
    .replace(/\s+/g, ' ')                         // Normalize whitespace
    .trim()
    .substring(0, 100)                           // Take first 100 chars as pattern
}

function calculateQueryStats(queries: any[]): any {
  const durations = queries
    .filter((q: any) => q.duration_ms !== null)
    .map((q: any) => q.duration_ms)
    .sort((a, b) => a - b)

  const total = queries.length
  const successful = queries.filter((q: any) => q.error === null).length

  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0

  const p95Duration = durations.length > 0
    ? durations[Math.floor(durations.length * 0.95)]
    : 0

  // Calculate queries per minute
  if (queries.length > 0) {
    const firstQuery = new Date(queries[queries.length - 1].executed_at)
    const lastQuery = new Date(queries[0].executed_at)
    const timeSpanMinutes = (lastQuery.getTime() - firstQuery.getTime()) / (1000 * 60)
    const queriesPerMinute = timeSpanMinutes > 0 ? total / timeSpanMinutes : 0

    return {
      total,
      successRate: (successful / total) * 100,
      avgDuration,
      p95Duration,
      queriesPerMinute
    }
  }

  return {
    total: 0,
    successRate: 0,
    avgDuration: 0,
    p95Duration: 0,
    queriesPerMinute: 0
  }
}

function showSummary(queryLogs: QueryLog[]): void {
  if (queryLogs.length === 0) {
    return
  }

  console.log('')
  console.log(prism.bold('📊 Monitoring Summary'))
  console.log(prism.gray('─'.repeat(50)))

  const successful = queryLogs.filter(q => !q.error).length
  const failed = queryLogs.filter(q => q.error).length

  console.log(`  Total Queries: ${queryLogs.length}`)
  console.log(`  Successful: ${prism.green(String(successful))}`)
  console.log(`  Failed: ${prism.red(String(failed))}`)

  const durations = queryLogs
    .filter(q => q.duration !== undefined)
    .map(q => q.duration!)
    .sort((a, b) => a - b)

  if (durations.length > 0) {
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
    const minDuration = durations[0]
    const maxDuration = durations[durations.length - 1]
    const p95Duration = durations[Math.floor(durations.length * 0.95)]

    console.log('')
    console.log(prism.cyan('Performance:'))
    console.log(`  Avg Duration: ${avgDuration.toFixed(0)}ms`)
    console.log(`  Min Duration: ${minDuration}ms`)
    console.log(`  Max Duration: ${maxDuration}ms`)
    console.log(`  P95 Duration: ${p95Duration}ms`)
  }

  // Show query types
  const queryTypes = new Map<string, number>()
  for (const log of queryLogs) {
    const type = log.query.split(' ')[0].toUpperCase()
    queryTypes.set(type, (queryTypes.get(type) || 0) + 1)
  }

  console.log('')
  console.log(prism.cyan('Query Types:'))
  for (const [type, count] of queryTypes.entries()) {
    console.log(`  ${type}: ${count}`)
  }
}