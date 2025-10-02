import { Command } from 'commander'
import { prism, spinner, table, confirm } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface ProfileOptions {
  query?: string
  table?: string
  operation?: 'select' | 'insert' | 'update' | 'delete'
  iterations?: string
  warmup?: string
  showPlan?: boolean
  compare?: string
  json?: boolean
  config?: string
}

interface ProfileResult {
  query: string
  iterations: number
  warmupRuns: number
  timings: number[]
  avgDuration: number
  minDuration: number
  maxDuration: number
  p50Duration: number
  p95Duration: number
  p99Duration: number
  stdDeviation: number
  queryPlan?: any
  rowCount?: number
}

export function profileCommand(): Command {
  const cmd = new Command('profile')
    .description('Query profiling and performance analysis')
    .option('-q, --query <sql>', 'SQL query to profile')
    .option('-t, --table <name>', 'Profile queries on specific table')
    .option('-o, --operation <type>', 'Operation type (select/insert/update/delete)')
    .option('-i, --iterations <n>', 'Number of iterations', '100')
    .option('-w, --warmup <n>', 'Number of warmup runs', '10')
    .option('--show-plan', 'Show query execution plan')
    .option('--compare <query>', 'Compare with another query')
    .option('--json', 'Output as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: ProfileOptions) => {
      try {
        await profileQuery(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to profile query: ${error instanceof Error ? error.message : String(error)}`,
          'PROFILE_ERROR'
        )
      }
    })

  return cmd
}

async function profileQuery(options: ProfileOptions): Promise<void> {
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

  try {
    // Determine query to profile
    let queryToProfile: string

    if (options.query) {
      queryToProfile = options.query
    } else if (options.table) {
      queryToProfile = generateQueryForTable(options.table, options.operation || 'select')
    } else {
      throw new CLIError(
        'No query specified',
        'MISSING_QUERY',
        ['Use --query to specify a SQL query', 'Or use --table to profile a table']
      )
    }

    // Profile the query
    const profileSpinner = spinner()
    profileSpinner.start('Profiling query...')

    const result = await runProfile(db, queryToProfile, options, config.database.dialect)

    profileSpinner.succeed('Profiling complete')

    // Compare with another query if specified
    let compareResult: ProfileResult | undefined
    if (options.compare) {
      const compareSpinner = spinner()
      compareSpinner.start('Profiling comparison query...')

      compareResult = await runProfile(db, options.compare, options, config.database.dialect)

      compareSpinner.succeed('Comparison profiling complete')
    }

    // Display results
    if (options.json) {
      console.log(JSON.stringify({
        main: result,
        comparison: compareResult
      }, null, 2))
    } else {
      displayProfileResults(result, compareResult, config.database.dialect)
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

async function runProfile(
  db: any,
  query: string,
  options: ProfileOptions,
  dialect: string
): Promise<ProfileResult> {
  const iterations = parseInt(options.iterations || '100', 10)
  const warmupRuns = parseInt(options.warmup || '10', 10)
  const timings: number[] = []

  // Warmup runs
  for (let i = 0; i < warmupRuns; i++) {
    try {
      await db.executeQuery(db.raw(query))
    } catch (error) {
      throw new CLIError(
        `Query failed: ${error instanceof Error ? error.message : String(error)}`,
        'QUERY_ERROR'
      )
    }
  }

  // Actual profiling runs
  let rowCount: number | undefined

  for (let i = 0; i < iterations; i++) {
    const startTime = process.hrtime.bigint()

    try {
      const result = await db.executeQuery(db.raw(query))

      const endTime = process.hrtime.bigint()
      const duration = Number(endTime - startTime) / 1000000 // Convert to milliseconds

      timings.push(duration)

      if (i === 0 && result.rows) {
        rowCount = result.rows.length
      }
    } catch (error) {
      throw new CLIError(
        `Query failed during profiling: ${error instanceof Error ? error.message : String(error)}`,
        'QUERY_ERROR'
      )
    }
  }

  // Get query execution plan if requested
  let queryPlan: any

  if (options.showPlan) {
    queryPlan = await getQueryPlan(db, query, dialect)
  }

  // Calculate statistics
  timings.sort((a, b) => a - b)

  const avgDuration = timings.reduce((a, b) => a + b, 0) / timings.length
  const minDuration = timings[0]
  const maxDuration = timings[timings.length - 1]
  const p50Duration = timings[Math.floor(timings.length * 0.50)]
  const p95Duration = timings[Math.floor(timings.length * 0.95)]
  const p99Duration = timings[Math.floor(timings.length * 0.99)]

  // Calculate standard deviation
  const variance = timings.reduce((sum, time) => {
    const diff = time - avgDuration
    return sum + (diff * diff)
  }, 0) / timings.length
  const stdDeviation = Math.sqrt(variance)

  return {
    query,
    iterations,
    warmupRuns,
    timings,
    avgDuration,
    minDuration,
    maxDuration,
    p50Duration,
    p95Duration,
    p99Duration,
    stdDeviation,
    queryPlan,
    rowCount
  }
}

async function getQueryPlan(db: any, query: string, dialect: string): Promise<any> {
  try {
    if (dialect === 'postgres') {
      const result = await db.executeQuery(db.raw(`EXPLAIN ANALYZE ${query}`))
      return result.rows
    } else if (dialect === 'mysql') {
      const result = await db.executeQuery(db.raw(`EXPLAIN ${query}`))
      return result.rows
    } else if (dialect === 'sqlite') {
      const result = await db.executeQuery(db.raw(`EXPLAIN QUERY PLAN ${query}`))
      return result.rows
    }
  } catch (error) {
    logger.debug(`Failed to get query plan: ${error}`)
    return null
  }
}

function generateQueryForTable(tableName: string, operation: string): string {
  switch (operation) {
    case 'select':
      return `SELECT * FROM ${tableName} LIMIT 100`
    case 'insert':
      return `INSERT INTO ${tableName} VALUES (DEFAULT) RETURNING *`
    case 'update':
      return `UPDATE ${tableName} SET updated_at = NOW() WHERE id = 1`
    case 'delete':
      return `DELETE FROM ${tableName} WHERE id = -999999`
    default:
      return `SELECT * FROM ${tableName} LIMIT 100`
  }
}

function displayProfileResults(
  result: ProfileResult,
  compareResult: ProfileResult | undefined,
  dialect: string
): void {
  console.log('')
  console.log(prism.bold('📊 Query Profile Results'))
  console.log(prism.gray('─'.repeat(60)))

  // Display main query
  console.log('')
  console.log(prism.cyan('Query:'))
  console.log(`  ${highlightSql(result.query)}`)

  if (result.rowCount !== undefined) {
    console.log(prism.gray(`  Returned ${result.rowCount} rows`))
  }

  console.log('')
  console.log(prism.cyan('Performance Metrics:'))

  const metricsData = [
    {
      Metric: 'Average',
      Value: `${result.avgDuration.toFixed(2)}ms`,
      Comparison: compareResult ? `${compareResult.avgDuration.toFixed(2)}ms` : ''
    },
    {
      Metric: 'Minimum',
      Value: `${result.minDuration.toFixed(2)}ms`,
      Comparison: compareResult ? `${compareResult.minDuration.toFixed(2)}ms` : ''
    },
    {
      Metric: 'Maximum',
      Value: `${result.maxDuration.toFixed(2)}ms`,
      Comparison: compareResult ? `${compareResult.maxDuration.toFixed(2)}ms` : ''
    },
    {
      Metric: 'P50 (Median)',
      Value: `${result.p50Duration.toFixed(2)}ms`,
      Comparison: compareResult ? `${compareResult.p50Duration.toFixed(2)}ms` : ''
    },
    {
      Metric: 'P95',
      Value: `${result.p95Duration.toFixed(2)}ms`,
      Comparison: compareResult ? `${compareResult.p95Duration.toFixed(2)}ms` : ''
    },
    {
      Metric: 'P99',
      Value: `${result.p99Duration.toFixed(2)}ms`,
      Comparison: compareResult ? `${compareResult.p99Duration.toFixed(2)}ms` : ''
    },
    {
      Metric: 'Std Deviation',
      Value: `${result.stdDeviation.toFixed(2)}ms`,
      Comparison: compareResult ? `${compareResult.stdDeviation.toFixed(2)}ms` : ''
    }
  ]

  if (compareResult) {
    // Add difference column
    metricsData.forEach(row => {
      if (row.Comparison) {
        const mainValue = parseFloat(row.Value)
        const compareValue = parseFloat(row.Comparison)
        const diff = ((mainValue - compareValue) / compareValue * 100).toFixed(1)
        const sign = mainValue > compareValue ? '+' : ''
        const color = mainValue > compareValue ? prism.red : prism.green
        row.Comparison += ` (${color(sign + diff + '%')})`
      }
    })
  }

  console.log(table(metricsData))

  // Display distribution
  console.log('')
  console.log(prism.cyan('Response Time Distribution:'))
  displayHistogram(result.timings)

  // Display query plan if available
  if (result.queryPlan && result.queryPlan.length > 0) {
    console.log('')
    console.log(prism.cyan('Execution Plan:'))

    if (dialect === 'postgres') {
      for (const row of result.queryPlan) {
        console.log(`  ${row['QUERY PLAN'] || JSON.stringify(row)}`)
      }
    } else {
      console.log(table(result.queryPlan))
    }
  }

  // Display comparison query if provided
  if (compareResult) {
    console.log('')
    console.log(prism.gray('─'.repeat(60)))
    console.log(prism.cyan('Comparison Query:'))
    console.log(`  ${highlightSql(compareResult.query)}`)

    if (compareResult.rowCount !== undefined) {
      console.log(prism.gray(`  Returned ${compareResult.rowCount} rows`))
    }

    // Performance comparison
    console.log('')
    console.log(prism.cyan('Performance Comparison:'))

    const improvement = ((compareResult.avgDuration - result.avgDuration) / compareResult.avgDuration * 100).toFixed(1)

    if (result.avgDuration < compareResult.avgDuration) {
      console.log(prism.green(`  ✓ Main query is ${improvement}% faster`))
    } else {
      console.log(prism.red(`  ✗ Main query is ${Math.abs(parseFloat(improvement))}% slower`))
    }

    // Consistency comparison
    if (result.stdDeviation < compareResult.stdDeviation) {
      console.log(prism.green(`  ✓ Main query has more consistent performance`))
    } else {
      console.log(prism.yellow(`  ⚠ Comparison query has more consistent performance`))
    }
  }

  // Summary and recommendations
  console.log('')
  console.log(prism.gray('─'.repeat(60)))
  console.log(prism.gray('Analysis:'))

  // Performance assessment
  if (result.avgDuration < 10) {
    console.log(prism.green('  ✓ Excellent performance (< 10ms average)'))
  } else if (result.avgDuration < 100) {
    console.log(prism.green('  ✓ Good performance (< 100ms average)'))
  } else if (result.avgDuration < 1000) {
    console.log(prism.yellow('  ⚠ Moderate performance (< 1s average)'))
  } else {
    console.log(prism.red('  ✗ Poor performance (> 1s average)'))
  }

  // Consistency assessment
  const variability = (result.stdDeviation / result.avgDuration) * 100
  if (variability < 10) {
    console.log(prism.green('  ✓ Very consistent performance'))
  } else if (variability < 25) {
    console.log(prism.green('  ✓ Consistent performance'))
  } else if (variability < 50) {
    console.log(prism.yellow('  ⚠ Variable performance'))
  } else {
    console.log(prism.red('  ✗ Highly variable performance'))
  }

  // Outlier detection
  const outlierThreshold = result.avgDuration * 2
  const outliers = result.timings.filter(t => t > outlierThreshold).length
  if (outliers > 0) {
    console.log(prism.yellow(`  ⚠ ${outliers} outlier(s) detected (>${outlierThreshold.toFixed(0)}ms)`))
  }

  console.log('')
  console.log(prism.gray(`Profiled with ${result.iterations} iterations after ${result.warmupRuns} warmup runs`))
}

function displayHistogram(timings: number[]): void {
  const buckets = 10
  const min = Math.min(...timings)
  const max = Math.max(...timings)
  const bucketSize = (max - min) / buckets

  const histogram: number[] = new Array(buckets).fill(0)

  for (const time of timings) {
    const bucketIndex = Math.min(Math.floor((time - min) / bucketSize), buckets - 1)
    histogram[bucketIndex]++
  }

  const maxCount = Math.max(...histogram)

  for (let i = 0; i < buckets; i++) {
    const rangeStart = min + (i * bucketSize)
    const rangeEnd = rangeStart + bucketSize
    const count = histogram[i]
    const barLength = Math.round((count / maxCount) * 30)
    const bar = '█'.repeat(barLength) + '░'.repeat(30 - barLength)
    const percentage = ((count / timings.length) * 100).toFixed(1)

    console.log(`  ${rangeStart.toFixed(1).padStart(6)}-${rangeEnd.toFixed(1).padEnd(6)}ms: ${bar} ${count.toString().padStart(3)} (${percentage}%)`)
  }
}

function highlightSql(sql: string): string {
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX',
    'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
    'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'AS'
  ]

  let highlighted = sql

  keywords.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi')
    highlighted = highlighted.replace(regex, prism.cyan(keyword))
  })

  return highlighted
}