import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import { formatBytes } from '../../utils/formatting.js'
import { displayTable } from '../../utils/table-helper.js'
import { getTableStatistics as getSharedTableStatistics } from '../../utils/table-stats.js'
import type { DatabaseDialect } from '../../utils/database.js'
import type {
  DatabaseInstance,
  QueryResult,
  MySQLPlan,
  PostgresExplainOutput,
  PostgresPlan,
  SQLitePlan
} from '../../types/index.js'

export interface AnalyzeOptions {
  query?: string
  file?: string
  format?: 'simple' | 'detailed' | 'json'
  showIndexes?: boolean
  showStatistics?: boolean
  suggestions?: boolean
  benchmark?: string
  config?: string
}

interface QueryAnalysis {
  query: string
  executionTime?: number
  rowsExamined?: number
  rowsReturned?: number
  cost?: number
  queryType: string
  tablesUsed: string[]
  indexesUsed: string[]
  missingIndexes: string[]
  warnings: string[]
  suggestions: string[]
  statistics?: TableStatistics[]
}

interface TableStatistics {
  table: string
  rowCount: number
  averageRowLength?: number
  dataLength?: number
  indexLength?: number
  lastAnalyzed?: Date
}

interface PostgresExplainJsonRow {
  'QUERY PLAN': string | PostgresExplainOutput[]
}

async function executeRaw(db: DatabaseInstance, sql: string): Promise<QueryResult> {
  const { CompiledQuery } = await import('kysely')
  return db.executeQuery(CompiledQuery.raw(sql, []))
}

export function analyzeCommand(): Command {
  const cmd = new Command('analyze')
    .description('Analyze query performance and provide optimization suggestions')
    .option('-q, --query <sql>', 'SQL query to analyze')
    .option('-f, --file <path>', 'Read query from file')
    .option('--format <type>', 'Output format (simple/detailed/json)', 'simple')
    .option('-i, --show-indexes', 'Show index usage information')
    .option('-s, --show-statistics', 'Show table statistics')
    .option('--suggestions', 'Show optimization suggestions', true)
    .option('-b, --benchmark <n>', 'Benchmark query N times', '1')
    .option('--json', 'Output results as JSON (same as --format json)')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: AnalyzeOptions & { json?: boolean }) => {
      try {
        if (options.json) options.format = 'json'
        await analyzeQueryPerformance(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to analyze query: ${error instanceof Error ? error.message : String(error)}`,
          'ANALYZE_ERROR'
        )
      }
    })

  return cmd
}

async function analyzeQueryPerformance(options: AnalyzeOptions): Promise<void> {
  // Get query to analyze
  let queryToAnalyze: string

  if (options.query) {
    queryToAnalyze = options.query
  } else if (options.file) {
    const { readFileSync } = await import('fs')
    try {
      queryToAnalyze = readFileSync(options.file, 'utf-8')
    } catch (error) {
      throw new CLIError(
        `Failed to read query file: ${error instanceof Error ? error.message : String(error)}`,
        'FILE_ERROR'
      )
    }
  } else {
    throw new CLIError('No query specified', 'MISSING_QUERY', undefined, [
      'Use --query to specify a SQL query',
      'Or use --file to read from a file'
    ])
  }

  await withDatabase({ config: options.config }, async (db, config) => {
    const analyzeSpinner = spinner()
    analyzeSpinner.start('Analyzing query...')

    // Analyze the query
    const analysis = await performAnalysis(db, queryToAnalyze, config.database.dialect, options)

    analyzeSpinner.succeed('Analysis complete')

    // Display results
    if (options.format === 'json') {
      console.log(JSON.stringify(analysis, null, 2))
    } else {
      displayAnalysisResults(analysis, options)
    }
  })
}

async function performAnalysis(
  db: DatabaseInstance,
  query: string,
  dialect: DatabaseDialect,
  options: AnalyzeOptions
): Promise<QueryAnalysis> {
  const analysis: QueryAnalysis = {
    query,
    queryType: detectQueryType(query),
    tablesUsed: extractTables(query),
    indexesUsed: [],
    missingIndexes: [],
    warnings: [],
    suggestions: []
  }

  // Benchmark if requested
  if (options.benchmark && parseInt(options.benchmark) > 1) {
    const iterations = parseInt(options.benchmark)
    if (isNaN(iterations) || iterations <= 0) {
      throw new CLIError('Invalid benchmark iterations - must be a positive number')
    }
    const times: number[] = []

    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now()
      try {
        await executeRaw(db, query)
        times.push(Date.now() - startTime)
      } catch (error) {
        if (i === 0) throw error // Throw on first iteration
      }
    }

    if (times.length > 0) {
      analysis.executionTime = times.reduce((a, b) => a + b, 0) / times.length
    }
  } else {
    // Single execution
    const startTime = Date.now()
    try {
      const result = await executeRaw(db, query)
      analysis.executionTime = Date.now() - startTime
      analysis.rowsReturned = result.rows.length
    } catch (error) {
      analysis.warnings.push(
        `Query execution failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // Get execution plan based on dialect
  if (dialect === 'postgres') {
    await analyzePostgres(db, query, analysis)
  } else if (dialect === 'mysql') {
    await analyzeMysql(db, query, analysis)
  } else {
    await analyzeSqlite(db, query, analysis)
  }

  // Get table statistics if requested
  if (options.showStatistics && analysis.tablesUsed.length > 0) {
    analysis.statistics = await getTableStatistics(db, analysis.tablesUsed, dialect)
  }

  // Generate suggestions
  if (options.suggestions !== false) {
    generateSuggestions(analysis)
  }

  return analysis
}

async function analyzePostgres(
  db: DatabaseInstance,
  query: string,
  analysis: QueryAnalysis
): Promise<void> {
  try {
    // Get EXPLAIN output
    const explainResult = await executeRaw(db, `EXPLAIN (FORMAT JSON, BUFFERS) ${query}`)
    const rows = explainResult.rows as PostgresExplainJsonRow[]

    if (rows.length > 0) {
      const plan = rows[0]['QUERY PLAN']
      const planData = (
        typeof plan === 'string' ? JSON.parse(plan) : plan
      ) as PostgresExplainOutput[]

      const rootPlan = planData[0]?.Plan
      if (rootPlan) {
        // Extract cost
        analysis.cost = rootPlan['Total Cost']

        // Extract index usage recursively
        extractPostgresIndexes(rootPlan, analysis)

        // Check for sequential scans
        checkPostgresWarnings(rootPlan, analysis)
      }
    }
  } catch (error) {
    logger.debug(`Failed to get PostgreSQL execution plan: ${String(error)}`)
  }
}

async function analyzeMysql(
  db: DatabaseInstance,
  query: string,
  analysis: QueryAnalysis
): Promise<void> {
  try {
    // Get EXPLAIN output
    const explainResult = await executeRaw(db, `EXPLAIN ${query}`)
    const rows = explainResult.rows as MySQLPlan[]

    for (const row of rows) {
      // Extract index usage
      if (row.key) {
        analysis.indexesUsed.push(row.key)
      }

      // Extract rows examined
      if (row.rows) {
        analysis.rowsExamined = (analysis.rowsExamined ?? 0) + row.rows
      }

      // Check for warnings
      if (row.Extra) {
        if (row.Extra.includes('Using filesort')) {
          analysis.warnings.push('Using filesort - consider adding an index')
        }
        if (row.Extra.includes('Using temporary')) {
          analysis.warnings.push('Using temporary table - may impact performance')
        }
        if (row.Extra.includes('Using where') && !row.key) {
          analysis.warnings.push('Full table scan with WHERE clause - consider adding an index')
        }
      }

      // Check for full table scans
      if (row.type === 'ALL') {
        analysis.warnings.push(`Full table scan on ${row.table ?? 'unknown'}`)
        analysis.missingIndexes.push(`${row.table ?? 'unknown'} (consider adding index)`)
      }
    }
  } catch (error) {
    logger.debug(`Failed to get MySQL execution plan: ${String(error)}`)
  }
}

async function analyzeSqlite(
  db: DatabaseInstance,
  query: string,
  analysis: QueryAnalysis
): Promise<void> {
  try {
    // Get EXPLAIN QUERY PLAN output
    const explainResult = await executeRaw(db, `EXPLAIN QUERY PLAN ${query}`)
    const rows = explainResult.rows as SQLitePlan[]

    for (const row of rows) {
      const detail = row.detail ?? ''

      // Extract index usage
      if (detail.includes('USING INDEX')) {
        const indexMatch = /USING INDEX (\w+)/.exec(detail)
        if (indexMatch) {
          analysis.indexesUsed.push(indexMatch[1])
        }
      }

      // Check for full table scans.
      // SQLite <3.36 emits 'SCAN TABLE users', newer versions 'SCAN users'.
      const scanMatch = /^SCAN (?:TABLE )?(\w+)/.exec(detail) ?? /SCAN TABLE (\w+)/.exec(detail)
      if (scanMatch) {
        analysis.warnings.push(`Full table scan on ${scanMatch[1]}`)
        analysis.missingIndexes.push(`${scanMatch[1]} (consider adding index)`)
      }
    }
  } catch (error) {
    logger.debug(`Failed to get SQLite execution plan: ${String(error)}`)
  }
}

function extractPostgresIndexes(plan: PostgresPlan, analysis: QueryAnalysis): void {
  // Check for index usage
  const nodeType = plan['Node Type']
  if (nodeType) {
    if (nodeType.includes('Index')) {
      if (plan['Index Name']) {
        analysis.indexesUsed.push(plan['Index Name'])
      }
    }

    // Check for sequential scans
    if (nodeType === 'Seq Scan') {
      const tableName = plan['Relation Name'] ?? 'unknown'
      analysis.warnings.push(`Sequential scan on table ${tableName}`)

      // Try to identify missing indexes from filter conditions
      if (plan.Filter) {
        analysis.missingIndexes.push(`${tableName} (consider index on filtered columns)`)
      }
    }
  }

  // Recursively check child plans
  if (plan.Plans && Array.isArray(plan.Plans)) {
    for (const childPlan of plan.Plans) {
      extractPostgresIndexes(childPlan, analysis)
    }
  }
}

function checkPostgresWarnings(plan: PostgresPlan, analysis: QueryAnalysis): void {
  // Check for performance issues
  if (plan['Node Type'] === 'Sort' && plan['Sort Method'] === 'external merge') {
    analysis.warnings.push('External sort detected - query may use significant memory')
  }

  if (plan['Node Type'] === 'Hash Join' && (plan['Hash Batches'] ?? 0) > 1) {
    analysis.warnings.push('Hash join using multiple batches - consider increasing work_mem')
  }

  // Recursively check child plans
  if (plan.Plans && Array.isArray(plan.Plans)) {
    for (const childPlan of plan.Plans) {
      checkPostgresWarnings(childPlan, analysis)
    }
  }
}

async function getTableStatistics(
  db: DatabaseInstance,
  tables: string[],
  dialect: DatabaseDialect
): Promise<TableStatistics[]> {
  const stats: TableStatistics[] = []

  for (const tableName of tables) {
    try {
      // Shared dialect-aware probes (utils/table-stats) provide row count
      // and data/index sizes for all dialects.
      const shared = await getSharedTableStatistics(db, tableName, dialect)
      stats.push({
        table: tableName,
        rowCount: shared.rows,
        dataLength: shared.size,
        indexLength: shared.indexSize
      })
    } catch (error) {
      logger.debug(`Failed to get statistics for table ${tableName}: ${String(error)}`)
    }
  }

  return stats
}

function generateSuggestions(analysis: QueryAnalysis): void {
  // Check for missing indexes
  if (analysis.missingIndexes.length > 0) {
    analysis.suggestions.push('Consider adding indexes to improve query performance')
  }

  // Check for full table scans
  if (analysis.warnings.some(w => w.includes('scan'))) {
    analysis.suggestions.push('Full table scans detected - ensure appropriate indexes exist')
  }

  // Check query efficiency
  if (analysis.rowsExamined && analysis.rowsReturned) {
    const efficiency = analysis.rowsReturned / analysis.rowsExamined
    if (efficiency < 0.1) {
      analysis.suggestions.push(
        `Low query efficiency (${(efficiency * 100).toFixed(1)}%) - ` +
          'many rows examined but few returned'
      )
    }
  }

  // Check execution time
  if (analysis.executionTime) {
    if (analysis.executionTime > 1000) {
      analysis.suggestions.push('Query takes >1s - consider optimization')
    } else if (analysis.executionTime > 100) {
      analysis.suggestions.push('Query takes >100ms - may need optimization for high-frequency use')
    }
  }

  // Query-specific suggestions
  const queryUpper = analysis.query.toUpperCase()

  if (queryUpper.includes('SELECT *')) {
    analysis.suggestions.push('Avoid SELECT * - specify only required columns')
  }

  if (queryUpper.includes("LIKE '%")) {
    analysis.suggestions.push('Leading wildcard in LIKE prevents index usage')
  }

  if (queryUpper.includes('OR ')) {
    analysis.suggestions.push('OR conditions may prevent index usage - consider using UNION')
  }

  if (queryUpper.includes('DISTINCT')) {
    analysis.suggestions.push("DISTINCT can be expensive - ensure it's necessary")
  }

  if (!queryUpper.includes('LIMIT') && analysis.queryType === 'SELECT') {
    analysis.suggestions.push('Consider adding LIMIT to prevent fetching excessive rows')
  }
}

function displayAnalysisResults(analysis: QueryAnalysis, options: AnalyzeOptions): void {
  console.log('')
  console.log(prism.bold('Query Analysis'))
  console.log(prism.gray('-'.repeat(60)))

  // Query info
  console.log('')
  console.log(prism.cyan('Query:'))
  console.log(`  ${highlightSql(analysis.query)}`)

  console.log('')
  console.log(prism.cyan('Analysis:'))
  console.log(`  Query Type: ${analysis.queryType}`)
  console.log(`  Tables Used: ${analysis.tablesUsed.join(', ') || 'None'}`)

  if (analysis.executionTime !== undefined) {
    const timeColor =
      analysis.executionTime > 1000
        ? prism.red
        : analysis.executionTime > 100
          ? prism.yellow
          : prism.green
    console.log(`  Execution Time: ${timeColor(`${analysis.executionTime}ms`)}`)
  }

  if (analysis.rowsReturned !== undefined) {
    console.log(`  Rows Returned: ${analysis.rowsReturned}`)
  }

  if (analysis.rowsExamined !== undefined) {
    console.log(`  Rows Examined: ${analysis.rowsExamined}`)

    if (analysis.rowsReturned !== undefined && analysis.rowsExamined > 0) {
      const efficiency = ((analysis.rowsReturned / analysis.rowsExamined) * 100).toFixed(1)
      const effColor =
        parseFloat(efficiency) > 50
          ? prism.green
          : parseFloat(efficiency) > 10
            ? prism.yellow
            : prism.red
      console.log(`  Query Efficiency: ${effColor(efficiency + '%')}`)
    }
  }

  if (analysis.cost !== undefined) {
    console.log(`  Estimated Cost: ${analysis.cost}`)
  }

  // Index usage
  if (options.showIndexes || options.format === 'detailed') {
    console.log('')
    console.log(prism.cyan('Index Usage:'))

    if (analysis.indexesUsed.length > 0) {
      for (const index of analysis.indexesUsed) {
        console.log(`  [OK] ${index}`)
      }
    } else {
      console.log(prism.yellow('  [WARN] No indexes used'))
    }

    if (analysis.missingIndexes.length > 0) {
      console.log('')
      console.log(prism.cyan('Missing Indexes:'))
      for (const missing of analysis.missingIndexes) {
        console.log(`  [ERR] ${missing}`)
      }
    }
  }

  // Table statistics
  if (options.showStatistics && analysis.statistics) {
    console.log('')
    console.log(prism.cyan('Table Statistics:'))

    const statsData = analysis.statistics.map(stat => ({
      Table: stat.table,
      Rows: stat.rowCount.toLocaleString(),
      'Data Size': formatBytes(stat.dataLength ?? 0),
      'Index Size': formatBytes(stat.indexLength ?? 0)
    }))

    displayTable(statsData)
  }

  // Warnings
  if (analysis.warnings.length > 0) {
    console.log('')
    console.log(prism.cyan('Warnings:'))
    for (const warning of analysis.warnings) {
      console.log(`  ${prism.yellow('[WARN]')} ${warning}`)
    }
  }

  // Suggestions
  if (options.suggestions !== false && analysis.suggestions.length > 0) {
    console.log('')
    console.log(prism.cyan('Optimization Suggestions:'))
    for (let i = 0; i < analysis.suggestions.length; i++) {
      console.log(`  ${i + 1}. ${analysis.suggestions[i]}`)
    }
  }

  // Overall assessment
  console.log('')
  console.log(prism.gray('-'.repeat(60)))
  console.log(prism.gray('Overall Assessment:'))

  const issues = analysis.warnings.length + analysis.missingIndexes.length
  if (issues === 0 && (analysis.executionTime ?? 0) < 100) {
    console.log(prism.green('  [OK] Query appears well-optimized'))
  } else if (issues <= 2) {
    console.log(prism.yellow('  [WARN] Minor optimization opportunities detected'))
  } else {
    console.log(prism.red('  [ERR] Significant optimization needed'))
  }

  // Benchmark info
  const benchmarkIterations = parseInt(options.benchmark ?? '0')
  if (!isNaN(benchmarkIterations) && benchmarkIterations > 1) {
    console.log('')
    console.log(prism.gray(`Benchmarked with ${benchmarkIterations} iterations`))
  }
}

function detectQueryType(query: string): string {
  const queryUpper = query.trim().toUpperCase()

  if (queryUpper.startsWith('SELECT')) return 'SELECT'
  if (queryUpper.startsWith('INSERT')) return 'INSERT'
  if (queryUpper.startsWith('UPDATE')) return 'UPDATE'
  if (queryUpper.startsWith('DELETE')) return 'DELETE'
  if (queryUpper.startsWith('CREATE')) return 'CREATE'
  if (queryUpper.startsWith('DROP')) return 'DROP'
  if (queryUpper.startsWith('ALTER')) return 'ALTER'

  return 'OTHER'
}

function extractTables(query: string): string[] {
  const tables: string[] = []
  const queryUpper = query.toUpperCase()

  // Extract FROM clause tables
  const fromMatch = query.match(/FROM\s+([^\s,()]+)/gi)
  if (fromMatch) {
    for (const match of fromMatch) {
      const tableName = match.replace(/FROM\s+/i, '').trim()
      if (tableName && !tableName.startsWith('(')) {
        tables.push(tableName)
      }
    }
  }

  // Extract JOIN clause tables
  const joinMatch = query.match(/JOIN\s+([^\s]+)/gi)
  if (joinMatch) {
    for (const match of joinMatch) {
      const tableName = match.replace(/JOIN\s+/i, '').trim()
      if (tableName && !tables.includes(tableName)) {
        tables.push(tableName)
      }
    }
  }

  // Extract UPDATE/INSERT/DELETE tables
  if (queryUpper.startsWith('UPDATE')) {
    const updateMatch = /UPDATE\s+([^\s]+)/i.exec(query)
    if (updateMatch) {
      tables.push(updateMatch[1])
    }
  } else if (queryUpper.startsWith('INSERT')) {
    const insertMatch = /INTO\s+([^\s(]+)/i.exec(query)
    if (insertMatch) {
      tables.push(insertMatch[1])
    }
  } else if (queryUpper.startsWith('DELETE')) {
    const deleteMatch = /FROM\s+([^\s]+)/i.exec(query)
    if (deleteMatch) {
      tables.push(deleteMatch[1])
    }
  }

  return [...new Set(tables)] // Remove duplicates
}

function highlightSql(sql: string): string {
  const keywords = [
    'SELECT',
    'FROM',
    'WHERE',
    'JOIN',
    'LEFT',
    'RIGHT',
    'INNER',
    'OUTER',
    'INSERT',
    'INTO',
    'VALUES',
    'UPDATE',
    'SET',
    'DELETE',
    'GROUP BY',
    'ORDER BY',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'AND',
    'OR',
    'NOT',
    'IN',
    'EXISTS',
    'BETWEEN',
    'LIKE',
    'AS'
  ]

  let highlighted = sql

  keywords.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi')
    highlighted = highlighted.replace(regex, prism.cyan(keyword))
  })

  return highlighted
}
