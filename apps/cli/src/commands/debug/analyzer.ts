import { Command } from 'commander'
import { prism, spinner, table } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface AnalyzerOptions {
  query?: string
  table?: string
  explain?: boolean
  suggestions?: boolean
  indexes?: boolean
  statistics?: boolean
  json?: boolean
  config?: string
}

interface QueryAnalysis {
  query: string
  executionPlan: any[]
  estimatedCost?: number
  actualTime?: number
  rowsExamined?: number
  rowsReturned?: number
  indexesUsed: string[]
  indexesMissing: string[]
  suggestions: string[]
  warnings: string[]
  tableStats?: TableStatistics[]
}

interface TableStatistics {
  tableName: string
  rowCount: number
  dataSize: number
  indexSize: number
  indexes: IndexInfo[]
}

interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  cardinality?: number
  usage?: number
}

export function analyzerCommand(): Command {
  const cmd = new Command('analyzer')
    .description('Query analyzer with optimization suggestions')
    .option('-q, --query <sql>', 'SQL query to analyze')
    .option('-t, --table <name>', 'Analyze queries for specific table')
    .option('-e, --explain', 'Show execution plan')
    .option('-s, --suggestions', 'Show optimization suggestions', true)
    .option('-i, --indexes', 'Analyze index usage')
    .option('--statistics', 'Show table statistics')
    .option('--json', 'Output as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: AnalyzerOptions) => {
      try {
        await analyzeQuery(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to analyze query: ${error instanceof Error ? error.message : String(error)}`,
          'ANALYZER_ERROR'
        )
      }
    })

  return cmd
}

async function analyzeQuery(options: AnalyzerOptions): Promise<void> {
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

  const analyzeSpinner = spinner()
  analyzeSpinner.start('Analyzing query...')

  try {
    let queryToAnalyze: string

    if (options.query) {
      queryToAnalyze = options.query
    } else if (options.table) {
      // Generate a sample query for the table
      queryToAnalyze = `SELECT * FROM ${options.table} LIMIT 100`
    } else {
      throw new CLIError(
        'No query specified',
        'MISSING_QUERY',
        ['Use --query to specify a SQL query', 'Or use --table to analyze a table']
      )
    }

    // Run analysis
    const analysis = await performQueryAnalysis(db, queryToAnalyze, config.database.dialect, options)

    analyzeSpinner.succeed('Analysis complete')

    // Display results
    if (options.json) {
      console.log(JSON.stringify(analysis, null, 2))
    } else {
      displayAnalysisResults(analysis, options)
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

async function performQueryAnalysis(
  db: any,
  query: string,
  dialect: string,
  options: AnalyzerOptions
): Promise<QueryAnalysis> {
  const analysis: QueryAnalysis = {
    query,
    executionPlan: [],
    indexesUsed: [],
    indexesMissing: [],
    suggestions: [],
    warnings: []
  }

  // Get execution plan
  if (dialect === 'postgres') {
    await analyzePostgresQuery(db, query, analysis, options)
  } else if (dialect === 'mysql') {
    await analyzeMysqlQuery(db, query, analysis, options)
  } else if (dialect === 'sqlite') {
    await analyzeSqliteQuery(db, query, analysis, options)
  }

  // Analyze query structure
  analyzeQueryStructure(query, analysis)

  // Get table statistics if requested
  if (options.statistics) {
    const tables = extractTableNames(query)
    analysis.tableStats = await getTableStatistics(db, tables, dialect)
  }

  // Generate optimization suggestions
  generateOptimizationSuggestions(analysis)

  return analysis
}

async function analyzePostgresQuery(
  db: any,
  query: string,
  analysis: QueryAnalysis,
  options: AnalyzerOptions
): Promise<void> {
  try {
    // Get EXPLAIN ANALYZE output
    const explainQuery = options.explain
      ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`
      : `EXPLAIN (FORMAT JSON) ${query}`

    const result = await db.executeQuery(db.raw(explainQuery))

    if (result.rows && result.rows.length > 0) {
      const plan = result.rows[0]['QUERY PLAN']
      if (typeof plan === 'string') {
        analysis.executionPlan = JSON.parse(plan)
      } else {
        analysis.executionPlan = plan
      }

      // Extract metrics from plan
      if (analysis.executionPlan && analysis.executionPlan[0]) {
        const planData = analysis.executionPlan[0]

        if (planData.Plan) {
          analysis.estimatedCost = planData.Plan['Total Cost']
          analysis.rowsReturned = planData.Plan['Plan Rows']

          if (planData['Execution Time']) {
            analysis.actualTime = planData['Execution Time']
          }

          // Extract index usage
          extractPostgresIndexUsage(planData.Plan, analysis)
        }
      }
    }
  } catch (error) {
    logger.debug(`Failed to analyze PostgreSQL query: ${error}`)
    analysis.warnings.push('Failed to generate execution plan')
  }
}

async function analyzeMysqlQuery(
  db: any,
  query: string,
  analysis: QueryAnalysis,
  options: AnalyzerOptions
): Promise<void> {
  try {
    // Get EXPLAIN output
    const explainResult = await db.executeQuery(db.raw(`EXPLAIN ${query}`))

    if (explainResult.rows && explainResult.rows.length > 0) {
      analysis.executionPlan = explainResult.rows

      // Extract metrics from plan
      for (const row of explainResult.rows) {
        if (row.key) {
          analysis.indexesUsed.push(row.key)
        }

        if (row.rows) {
          analysis.rowsExamined = (analysis.rowsExamined || 0) + Number(row.rows)
        }

        // Check for warnings
        if (row.Extra) {
          if (row.Extra.includes('Using filesort')) {
            analysis.warnings.push('Query uses filesort (consider adding index)')
          }
          if (row.Extra.includes('Using temporary')) {
            analysis.warnings.push('Query uses temporary table (may impact performance)')
          }
          if (row.Extra.includes('Using where')) {
            analysis.warnings.push('Using WHERE without index')
          }
        }
      }
    }
  } catch (error) {
    logger.debug(`Failed to analyze MySQL query: ${error}`)
    analysis.warnings.push('Failed to generate execution plan')
  }
}

async function analyzeSqliteQuery(
  db: any,
  query: string,
  analysis: QueryAnalysis,
  options: AnalyzerOptions
): Promise<void> {
  try {
    // Get EXPLAIN QUERY PLAN output
    const explainResult = await db.executeQuery(db.raw(`EXPLAIN QUERY PLAN ${query}`))

    if (explainResult.rows && explainResult.rows.length > 0) {
      analysis.executionPlan = explainResult.rows

      // Extract index usage from plan
      for (const row of explainResult.rows) {
        const detail = row.detail || ''

        if (detail.includes('USING INDEX')) {
          const indexMatch = detail.match(/USING INDEX (\w+)/)
          if (indexMatch) {
            analysis.indexesUsed.push(indexMatch[1])
          }
        }

        if (detail.includes('SCAN TABLE')) {
          analysis.warnings.push(`Full table scan detected: ${detail}`)
        }
      }
    }
  } catch (error) {
    logger.debug(`Failed to analyze SQLite query: ${error}`)
    analysis.warnings.push('Failed to generate execution plan')
  }
}

function extractPostgresIndexUsage(plan: any, analysis: QueryAnalysis): void {
  if (!plan) return

  // Check node type for index usage
  if (plan['Node Type']) {
    if (plan['Node Type'].includes('Index')) {
      if (plan['Index Name']) {
        analysis.indexesUsed.push(plan['Index Name'])
      }
    }

    if (plan['Node Type'] === 'Seq Scan') {
      analysis.warnings.push(`Sequential scan on table ${plan['Relation Name']}`)
    }
  }

  // Recursively check child plans
  if (plan.Plans && Array.isArray(plan.Plans)) {
    for (const childPlan of plan.Plans) {
      extractPostgresIndexUsage(childPlan, analysis)
    }
  }
}

function analyzeQueryStructure(query: string, analysis: QueryAnalysis): void {
  const queryUpper = query.toUpperCase()

  // Check for potential issues
  if (queryUpper.includes('SELECT *')) {
    analysis.suggestions.push('Avoid SELECT * - specify only required columns')
  }

  if (!queryUpper.includes('LIMIT') && queryUpper.startsWith('SELECT')) {
    analysis.suggestions.push('Consider adding LIMIT clause to prevent fetching too many rows')
  }

  if (queryUpper.includes('LIKE \'%')) {
    analysis.warnings.push('Leading wildcard in LIKE pattern prevents index usage')
  }

  if (queryUpper.includes('OR')) {
    analysis.suggestions.push('OR conditions may prevent index usage - consider using UNION')
  }

  if (queryUpper.includes('NOT IN') || queryUpper.includes('NOT EXISTS')) {
    analysis.suggestions.push('NOT IN/NOT EXISTS can be slow - consider using LEFT JOIN')
  }

  if (queryUpper.includes('DISTINCT')) {
    analysis.suggestions.push('DISTINCT can be expensive - ensure it\'s necessary')
  }

  // Check for missing JOIN conditions
  const joinCount = (queryUpper.match(/JOIN/g) || []).length
  const onCount = (queryUpper.match(/\bON\b/g) || []).length
  if (joinCount > onCount) {
    analysis.warnings.push('Possible missing JOIN condition')
  }
}

function extractTableNames(query: string): string[] {
  const tables: string[] = []

  // Simple regex to extract table names (this is a basic implementation)
  const fromMatch = query.match(/FROM\s+([^\s,]+)/gi)
  if (fromMatch) {
    for (const match of fromMatch) {
      const tableName = match.replace(/FROM\s+/i, '').trim()
      if (tableName && !tableName.startsWith('(')) {
        tables.push(tableName)
      }
    }
  }

  const joinMatch = query.match(/JOIN\s+([^\s]+)/gi)
  if (joinMatch) {
    for (const match of joinMatch) {
      const tableName = match.replace(/JOIN\s+/i, '').trim()
      if (tableName && !tables.includes(tableName)) {
        tables.push(tableName)
      }
    }
  }

  return tables
}

async function getTableStatistics(
  db: any,
  tables: string[],
  dialect: string
): Promise<TableStatistics[]> {
  const stats: TableStatistics[] = []

  for (const tableName of tables) {
    try {
      const tableStats: TableStatistics = {
        tableName,
        rowCount: 0,
        dataSize: 0,
        indexSize: 0,
        indexes: []
      }

      // Get row count
      const countResult = await db
        .selectFrom(tableName)
        .select(db.fn.countAll().as('count'))
        .executeTakeFirst()
      tableStats.rowCount = Number(countResult?.count || 0)

      // Get indexes
      if (dialect === 'postgres') {
        const indexResult = await db.executeQuery(db.raw(`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE tablename = '${tableName}'
        `))

        for (const idx of indexResult.rows) {
          tableStats.indexes.push({
            name: idx.indexname,
            columns: extractColumnsFromIndexDef(idx.indexdef),
            unique: idx.indexdef.includes('UNIQUE')
          })
        }
      }

      stats.push(tableStats)
    } catch (error) {
      logger.debug(`Failed to get statistics for table ${tableName}: ${error}`)
    }
  }

  return stats
}

function extractColumnsFromIndexDef(indexDef: string): string[] {
  const match = indexDef.match(/\(([^)]+)\)/)
  if (match) {
    return match[1].split(',').map(c => c.trim())
  }
  return []
}

function generateOptimizationSuggestions(analysis: QueryAnalysis): void {
  // Check for missing indexes
  if (analysis.warnings.some(w => w.includes('Sequential scan') || w.includes('SCAN TABLE'))) {
    analysis.suggestions.push('Consider adding indexes on filtered/joined columns')
  }

  // Check for too many rows examined
  if (analysis.rowsExamined && analysis.rowsReturned) {
    const efficiency = analysis.rowsReturned / analysis.rowsExamined
    if (efficiency < 0.1) {
      analysis.suggestions.push(
        `Low query efficiency (${(efficiency * 100).toFixed(1)}%) - ` +
        'consider adding more selective indexes'
      )
    }
  }

  // Check execution time
  if (analysis.actualTime && analysis.actualTime > 1000) {
    analysis.suggestions.push('Query takes >1s - consider optimization')
  }

  // Check for index usage
  if (analysis.indexesUsed.length === 0 && analysis.executionPlan.length > 0) {
    analysis.suggestions.push('No indexes used - query may benefit from indexing')
  }
}

function displayAnalysisResults(analysis: QueryAnalysis, options: AnalyzerOptions): void {
  console.log('')
  console.log(prism.bold('🔍 Query Analysis'))
  console.log(prism.gray('─'.repeat(60)))

  // Display query
  console.log('')
  console.log(prism.cyan('Query:'))
  console.log(`  ${highlightSql(analysis.query)}`)

  // Display execution plan if requested
  if (options.explain && analysis.executionPlan.length > 0) {
    console.log('')
    console.log(prism.cyan('Execution Plan:'))

    if (typeof analysis.executionPlan[0] === 'object' && 'Plan' in analysis.executionPlan[0]) {
      // PostgreSQL JSON format
      displayPostgresPlan(analysis.executionPlan[0].Plan)
    } else {
      // Table format
      console.log(table(analysis.executionPlan))
    }
  }

  // Display metrics
  if (analysis.estimatedCost || analysis.actualTime || analysis.rowsExamined) {
    console.log('')
    console.log(prism.cyan('Metrics:'))

    if (analysis.estimatedCost) {
      console.log(`  Estimated Cost: ${analysis.estimatedCost}`)
    }
    if (analysis.actualTime) {
      console.log(`  Actual Time: ${analysis.actualTime.toFixed(2)}ms`)
    }
    if (analysis.rowsExamined) {
      console.log(`  Rows Examined: ${analysis.rowsExamined.toLocaleString()}`)
    }
    if (analysis.rowsReturned) {
      console.log(`  Rows Returned: ${analysis.rowsReturned.toLocaleString()}`)
    }

    if (analysis.rowsExamined && analysis.rowsReturned) {
      const efficiency = (analysis.rowsReturned / analysis.rowsExamined * 100).toFixed(1)
      console.log(`  Query Efficiency: ${efficiency}%`)
    }
  }

  // Display index usage
  if (options.indexes || analysis.indexesUsed.length > 0) {
    console.log('')
    console.log(prism.cyan('Index Usage:'))

    if (analysis.indexesUsed.length > 0) {
      for (const index of analysis.indexesUsed) {
        console.log(`  ✅ ${index}`)
      }
    } else {
      console.log(prism.yellow('  ⚠ No indexes used'))
    }

    if (analysis.indexesMissing.length > 0) {
      console.log('')
      console.log(prism.cyan('Missing Indexes:'))
      for (const index of analysis.indexesMissing) {
        console.log(`  ❌ ${index}`)
      }
    }
  }

  // Display warnings
  if (analysis.warnings.length > 0) {
    console.log('')
    console.log(prism.cyan('Warnings:'))
    for (const warning of analysis.warnings) {
      console.log(`  ${prism.yellow('⚠')} ${warning}`)
    }
  }

  // Display suggestions
  if (options.suggestions !== false && analysis.suggestions.length > 0) {
    console.log('')
    console.log(prism.cyan('Optimization Suggestions:'))
    for (let i = 0; i < analysis.suggestions.length; i++) {
      console.log(`  ${i + 1}. ${analysis.suggestions[i]}`)
    }
  }

  // Display table statistics
  if (options.statistics && analysis.tableStats) {
    console.log('')
    console.log(prism.cyan('Table Statistics:'))

    for (const stats of analysis.tableStats) {
      console.log('')
      console.log(`  ${prism.bold(stats.tableName)}:`)
      console.log(`    Rows: ${stats.rowCount.toLocaleString()}`)

      if (stats.indexes.length > 0) {
        console.log(`    Indexes (${stats.indexes.length}):`)
        for (const idx of stats.indexes) {
          const uniqueLabel = idx.unique ? ' (unique)' : ''
          console.log(`      - ${idx.name}${uniqueLabel}: ${idx.columns.join(', ')}`)
        }
      }
    }
  }

  // Overall assessment
  console.log('')
  console.log(prism.gray('─'.repeat(60)))
  console.log(prism.gray('Assessment:'))

  const hasIssues = analysis.warnings.length > 0 || analysis.suggestions.length > 0

  if (!hasIssues) {
    console.log(prism.green('  ✅ Query appears to be well-optimized'))
  } else {
    const issueCount = analysis.warnings.length + analysis.suggestions.length
    console.log(prism.yellow(`  ⚠ Found ${issueCount} potential issue(s)`))
    console.log('  Review the warnings and suggestions above')
  }
}

function displayPostgresPlan(plan: any, indent: number = 0): void {
  const prefix = '  ' + '  '.repeat(indent)

  console.log(`${prefix}${plan['Node Type']}`)

  if (plan['Relation Name']) {
    console.log(`${prefix}  Table: ${plan['Relation Name']}`)
  }

  if (plan['Index Name']) {
    console.log(`${prefix}  Index: ${plan['Index Name']}`)
  }

  if (plan['Total Cost']) {
    console.log(`${prefix}  Cost: ${plan['Total Cost']}`)
  }

  if (plan['Actual Total Time']) {
    console.log(`${prefix}  Time: ${plan['Actual Total Time']}ms`)
  }

  if (plan.Plans && Array.isArray(plan.Plans)) {
    for (const childPlan of plan.Plans) {
      displayPostgresPlan(childPlan, indent + 1)
    }
  }
}

function highlightSql(sql: string): string {
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
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