import { Command } from 'commander'
import { prism, spinner, table as displayTable } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface ExplainOptions {
  query?: string
  file?: string
  analyze?: boolean
  verbose?: boolean
  format?: 'text' | 'json' | 'tree' | 'yaml'
  buffers?: boolean
  costs?: boolean
  settings?: boolean
  timing?: boolean
  summary?: boolean
  config?: string
}

interface ExplainResult {
  query: string
  plan: any
  executionTime?: number
  planningTime?: number
  totalTime?: number
  triggers?: any[]
  jit?: any
}

export function explainCommand(): Command {
  const cmd = new Command('explain')
    .description('Show and analyze query execution plans')
    .option('-q, --query <sql>', 'SQL query to explain')
    .option('-f, --file <path>', 'Read query from file')
    .option('-a, --analyze', 'Execute query and show actual times')
    .option('-v, --verbose', 'Show verbose output')
    .option('--format <type>', 'Output format (text/json/tree/yaml)', 'text')
    .option('--buffers', 'Show buffer usage (PostgreSQL)')
    .option('--costs', 'Show cost estimates', true)
    .option('--settings', 'Show planner settings (PostgreSQL)')
    .option('--timing', 'Show timing information', true)
    .option('--summary', 'Show summary at the end', true)
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: ExplainOptions) => {
      try {
        await explainQuery(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to explain query: ${error instanceof Error ? error.message : String(error)}`,
          'EXPLAIN_ERROR'
        )
      }
    })

  return cmd
}

async function explainQuery(options: ExplainOptions): Promise<void> {
  // Get query to explain
  let queryToExplain: string

  if (options.query) {
    queryToExplain = options.query
  } else if (options.file) {
    const { readFileSync } = await import('fs')
    try {
      queryToExplain = readFileSync(options.file, 'utf-8')
    } catch (error) {
      throw new CLIError(
        `Failed to read query file: ${error instanceof Error ? error.message : String(error)}`,
        'FILE_ERROR'
      )
    }
  } else {
    throw new CLIError(
      'No query specified',
      'MISSING_QUERY',
      ['Use --query to specify a SQL query', 'Or use --file to read from a file']
    )
  }

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

  const explainSpinner = spinner()
  explainSpinner.start('Generating execution plan...')

  try {
    // Get execution plan based on dialect
    let result: ExplainResult

    switch (config.database.dialect) {
      case 'postgres':
        result = await explainPostgres(db, queryToExplain, options)
        break
      case 'mysql':
        result = await explainMysql(db, queryToExplain, options)
        break
      case 'sqlite':
        result = await explainSqlite(db, queryToExplain, options)
        break
      default:
        throw new CLIError(
          `Unsupported database dialect: ${config.database.dialect}`,
          'UNSUPPORTED_DIALECT'
        )
    }

    explainSpinner.succeed('Execution plan generated')

    // Display results
    displayExplainResults(result, options, config.database.dialect)

  } finally {
    // Close database connection
    await db.destroy()
  }
}

async function explainPostgres(
  db: any,
  query: string,
  options: ExplainOptions
): Promise<ExplainResult> {
  // Build EXPLAIN command
  const explainParts: string[] = ['EXPLAIN']
  const explainOptions: string[] = []

  if (options.analyze) {
    explainOptions.push('ANALYZE')
  }

  if (options.verbose) {
    explainOptions.push('VERBOSE')
  }

  if (options.buffers && options.analyze) {
    explainOptions.push('BUFFERS')
  }

  if (options.costs !== false) {
    explainOptions.push('COSTS')
  }

  if (options.settings) {
    explainOptions.push('SETTINGS')
  }

  if (options.timing !== false && options.analyze) {
    explainOptions.push('TIMING')
  }

  if (options.summary !== false && options.analyze) {
    explainOptions.push('SUMMARY')
  }

  // Add format
  const format = options.format === 'tree' ? 'TEXT' : options.format?.toUpperCase() || 'JSON'
  explainOptions.push(`FORMAT ${format}`)

  if (explainOptions.length > 0) {
    explainParts.push(`(${explainOptions.join(', ')})`)
  }

  explainParts.push(query)

  const explainQuery = explainParts.join(' ')

  try {
    const result = await db.executeQuery(db.raw(explainQuery))

    if (format === 'JSON' && result.rows && result.rows[0]) {
      const plan = result.rows[0]['QUERY PLAN']
      const planData = typeof plan === 'string' ? JSON.parse(plan) : plan

      return {
        query,
        plan: planData,
        executionTime: planData[0]?.['Execution Time'],
        planningTime: planData[0]?.['Planning Time'],
        totalTime: planData[0]?.['Total Runtime'],
        triggers: planData[0]?.Triggers,
        jit: planData[0]?.JIT
      }
    } else {
      return {
        query,
        plan: result.rows
      }
    }
  } catch (error) {
    throw new CLIError(
      `Failed to explain query: ${error instanceof Error ? error.message : String(error)}`,
      'EXPLAIN_ERROR'
    )
  }
}

async function explainMysql(
  db: any,
  query: string,
  options: ExplainOptions
): Promise<ExplainResult> {
  // MySQL EXPLAIN syntax
  let explainQuery = `EXPLAIN `

  if (options.analyze) {
    explainQuery += 'ANALYZE '
  }

  if (options.format === 'json') {
    explainQuery += 'FORMAT=JSON '
  } else if (options.format === 'tree' && options.analyze) {
    explainQuery += 'FORMAT=TREE '
  }

  explainQuery += query

  try {
    const result = await db.executeQuery(db.raw(explainQuery))

    if (options.format === 'json' && result.rows && result.rows[0]) {
      const plan = result.rows[0]['EXPLAIN']
      const planData = typeof plan === 'string' ? JSON.parse(plan) : plan

      return {
        query,
        plan: planData
      }
    } else {
      return {
        query,
        plan: result.rows
      }
    }
  } catch (error) {
    throw new CLIError(
      `Failed to explain query: ${error instanceof Error ? error.message : String(error)}`,
      'EXPLAIN_ERROR'
    )
  }
}

async function explainSqlite(
  db: any,
  query: string,
  options: ExplainOptions
): Promise<ExplainResult> {
  // SQLite EXPLAIN QUERY PLAN
  const explainQuery = `EXPLAIN QUERY PLAN ${query}`

  try {
    const result = await db.executeQuery(db.raw(explainQuery))

    return {
      query,
      plan: result.rows
    }
  } catch (error) {
    throw new CLIError(
      `Failed to explain query: ${error instanceof Error ? error.message : String(error)}`,
      'EXPLAIN_ERROR'
    )
  }
}

function displayExplainResults(result: ExplainResult, options: ExplainOptions, dialect: string): void {
  console.log('')
  console.log(prism.bold('📋 Query Execution Plan'))
  console.log(prism.gray('─'.repeat(60)))

  // Display query
  console.log('')
  console.log(prism.cyan('Query:'))
  console.log(`  ${highlightSql(result.query)}`)

  // Display plan based on format and dialect
  console.log('')
  console.log(prism.cyan('Execution Plan:'))

  if (dialect === 'postgres' && options.format === 'json' && result.plan) {
    displayPostgresPlan(result.plan, options)
  } else if (dialect === 'mysql' && options.format === 'json' && result.plan) {
    displayMysqlJsonPlan(result.plan, options)
  } else if (Array.isArray(result.plan)) {
    // Table format
    if (dialect === 'sqlite') {
      displaySqlitePlan(result.plan)
    } else {
      console.log(displayTable(result.plan))
    }
  } else if (options.format === 'json') {
    console.log(JSON.stringify(result.plan, null, 2))
  } else {
    // Text format
    for (const row of result.plan) {
      if (typeof row === 'object' && row['QUERY PLAN']) {
        console.log(row['QUERY PLAN'])
      } else {
        console.log(row)
      }
    }
  }

  // Display timing information
  if (options.analyze && (result.executionTime || result.planningTime)) {
    console.log('')
    console.log(prism.cyan('Timing:'))

    if (result.planningTime !== undefined) {
      console.log(`  Planning Time: ${result.planningTime.toFixed(3)}ms`)
    }

    if (result.executionTime !== undefined) {
      console.log(`  Execution Time: ${result.executionTime.toFixed(3)}ms`)
    }

    if (result.totalTime !== undefined) {
      console.log(`  Total Time: ${result.totalTime.toFixed(3)}ms`)
    }
  }

  // Display JIT information (PostgreSQL)
  if (result.jit && options.verbose) {
    console.log('')
    console.log(prism.cyan('JIT:'))
    console.log(`  Functions: ${result.jit.Functions}`)
    console.log(`  Options: Inlining ${result.jit.Options.Inlining}, Optimization ${result.jit.Options.Optimization}`)
    console.log(`  Timing:`)
    console.log(`    Generation: ${result.jit.Timing.Generation.toFixed(3)}ms`)
    console.log(`    Inlining: ${result.jit.Timing.Inlining.toFixed(3)}ms`)
    console.log(`    Optimization: ${result.jit.Timing.Optimization.toFixed(3)}ms`)
    console.log(`    Emission: ${result.jit.Timing.Emission.toFixed(3)}ms`)
    console.log(`    Total: ${result.jit.Timing.Total.toFixed(3)}ms`)
  }

  // Display triggers (PostgreSQL)
  if (result.triggers && result.triggers.length > 0) {
    console.log('')
    console.log(prism.cyan('Triggers:'))
    for (const trigger of result.triggers) {
      console.log(`  ${trigger['Trigger Name']}: ${trigger['Time'].toFixed(3)}ms (${trigger['Calls']} calls)`)
    }
  }

  // Analysis and suggestions
  if (options.summary !== false) {
    console.log('')
    console.log(prism.gray('─'.repeat(60)))
    console.log(prism.gray('Analysis:'))
    analyzePlan(result.plan, dialect)
  }
}

function displayPostgresPlan(planData: any, options: ExplainOptions): void {
  if (!planData || !planData[0]) return

  const plan = planData[0].Plan || planData[0]

  function displayNode(node: any, indent: number = 0): void {
    const prefix = '  '.repeat(indent + 1)

    // Node type and details
    let nodeInfo = node['Node Type']
    if (node['Relation Name']) {
      nodeInfo += ` on ${node['Relation Name']}`
    }
    if (node['Index Name']) {
      nodeInfo += ` using ${node['Index Name']}`
    }

    console.log(`${prefix}→ ${prism.bold(nodeInfo)}`)

    // Cost and rows
    if (options.costs !== false) {
      const cost = `cost=${node['Startup Cost']?.toFixed(2)}..${node['Total Cost']?.toFixed(2)}`
      const rows = `rows=${node['Plan Rows']}`
      const width = `width=${node['Plan Width']}`
      console.log(`${prefix}  ${prism.gray(cost + ' ' + rows + ' ' + width)}`)
    }

    // Actual time and rows (if analyze)
    if (options.analyze && node['Actual Startup Time'] !== undefined) {
      const actualTime = `actual time=${node['Actual Startup Time'].toFixed(3)}..${node['Actual Total Time'].toFixed(3)}`
      const actualRows = `rows=${node['Actual Rows']}`
      const loops = `loops=${node['Actual Loops']}`
      console.log(`${prefix}  ${prism.green(actualTime + ' ' + actualRows + ' ' + loops)}`)
    }

    // Buffers (if analyze with buffers)
    if (options.buffers && node['Shared Hit Blocks'] !== undefined) {
      const buffers = []
      if (node['Shared Hit Blocks']) buffers.push(`shared hit=${node['Shared Hit Blocks']}`)
      if (node['Shared Read Blocks']) buffers.push(`read=${node['Shared Read Blocks']}`)
      if (node['Shared Dirtied Blocks']) buffers.push(`dirtied=${node['Shared Dirtied Blocks']}`)
      if (node['Shared Written Blocks']) buffers.push(`written=${node['Shared Written Blocks']}`)
      if (buffers.length > 0) {
        console.log(`${prefix}  ${prism.blue('Buffers: ' + buffers.join(' '))}`)
      }
    }

    // Filter condition
    if (node['Filter']) {
      console.log(`${prefix}  ${prism.yellow('Filter: ' + node['Filter'])}`)
      if (node['Rows Removed by Filter'] !== undefined) {
        console.log(`${prefix}  ${prism.yellow('Rows Removed: ' + node['Rows Removed by Filter'])}`)
      }
    }

    // Join filter
    if (node['Join Filter']) {
      console.log(`${prefix}  ${prism.yellow('Join Filter: ' + node['Join Filter'])}`)
      if (node['Rows Removed by Join Filter'] !== undefined) {
        console.log(`${prefix}  ${prism.yellow('Rows Removed: ' + node['Rows Removed by Join Filter'])}`)
      }
    }

    // Hash condition
    if (node['Hash Cond']) {
      console.log(`${prefix}  ${prism.cyan('Hash Cond: ' + node['Hash Cond'])}`)
    }

    // Index condition
    if (node['Index Cond']) {
      console.log(`${prefix}  ${prism.cyan('Index Cond: ' + node['Index Cond'])}`)
    }

    // Sort details
    if (node['Sort Key']) {
      const sortKeys = Array.isArray(node['Sort Key']) ? node['Sort Key'].join(', ') : node['Sort Key']
      console.log(`${prefix}  ${prism.magenta('Sort Key: ' + sortKeys)}`)
      if (node['Sort Method']) {
        console.log(`${prefix}  ${prism.magenta('Sort Method: ' + node['Sort Method'] + ' Memory: ' + node['Sort Space Used'] + 'kB')}`)
      }
    }

    // Verbose output
    if (options.verbose) {
      if (node['Output']) {
        const output = Array.isArray(node['Output']) ? node['Output'].join(', ') : node['Output']
        console.log(`${prefix}  ${prism.gray('Output: ' + output)}`)
      }
    }

    // Recursively display child nodes
    if (node.Plans && Array.isArray(node.Plans)) {
      for (const child of node.Plans) {
        displayNode(child, indent + 1)
      }
    }
  }

  displayNode(plan)
}

function displayMysqlJsonPlan(planData: any, options: ExplainOptions): void {
  if (!planData || !planData.query_block) return

  function displayQueryBlock(block: any, indent: number = 0): void {
    const prefix = '  '.repeat(indent + 1)

    if (block.select_id) {
      console.log(`${prefix}→ ${prism.bold('SELECT #' + block.select_id)}`)
    }

    if (block.cost_info) {
      console.log(`${prefix}  ${prism.gray('Query cost: ' + block.cost_info.query_cost)}`)
    }

    if (block.table) {
      displayTable(block.table, indent + 1)
    }

    if (block.nested_loop && Array.isArray(block.nested_loop)) {
      for (const table of block.nested_loop) {
        displayTable(table.table, indent + 1)
      }
    }

    if (block.ordering_operation) {
      console.log(`${prefix}  ${prism.magenta('Using filesort')}`)
      if (block.ordering_operation.using_temporary_table) {
        console.log(`${prefix}  ${prism.magenta('Using temporary table')}`)
      }
    }

    if (block.grouping_operation) {
      console.log(`${prefix}  ${prism.magenta('Using temporary table for GROUP BY')}`)
    }
  }

  function displayTable(table: any, indent: number): void {
    if (!table) return
    const prefix = '  '.repeat(indent + 1)

    let tableInfo = `${table.table_name}`
    if (table.access_type) {
      tableInfo += ` (${table.access_type})`
    }

    console.log(`${prefix}→ ${prism.bold('Table: ' + tableInfo)}`)

    if (table.key) {
      console.log(`${prefix}  ${prism.cyan('Key: ' + table.key)}`)
      if (table.key_length) {
        console.log(`${prefix}  ${prism.cyan('Key length: ' + table.key_length)}`)
      }
    }

    if (table.rows_examined_per_scan) {
      console.log(`${prefix}  ${prism.gray('Rows examined per scan: ' + table.rows_examined_per_scan)}`)
    }

    if (table.rows_produced_per_join) {
      console.log(`${prefix}  ${prism.gray('Rows produced per join: ' + table.rows_produced_per_join)}`)
    }

    if (table.filtered) {
      console.log(`${prefix}  ${prism.gray('Filtered: ' + table.filtered + '%')}`)
    }

    if (table.cost_info) {
      console.log(`${prefix}  ${prism.gray('Cost:')}`)
      console.log(`${prefix}    Read: ${table.cost_info.read_cost}`)
      console.log(`${prefix}    Eval: ${table.cost_info.eval_cost}`)
      console.log(`${prefix}    Prefix: ${table.cost_info.prefix_cost}`)
    }

    if (table.used_columns && options.verbose) {
      console.log(`${prefix}  ${prism.gray('Used columns: ' + table.used_columns.join(', '))}`)
    }

    if (table.attached_condition) {
      console.log(`${prefix}  ${prism.yellow('Condition: ' + table.attached_condition)}`)
    }
  }

  displayQueryBlock(planData.query_block)
}

function displaySqlitePlan(rows: any[]): void {
  // SQLite plan is simpler, display as tree
  const tree: Map<number, any[]> = new Map()

  // Group by parent
  for (const row of rows) {
    const parent = row.parent || 0
    if (!tree.has(parent)) {
      tree.set(parent, [])
    }
    tree.get(parent)!.push(row)
  }

  function displayNodes(parentId: number, indent: number = 0): void {
    const children = tree.get(parentId) || []
    for (const node of children) {
      const prefix = '  '.repeat(indent + 1)
      console.log(`${prefix}→ ${node.detail}`)

      // Display children
      displayNodes(node.id, indent + 1)
    }
  }

  displayNodes(0)
}

function analyzePlan(plan: any, dialect: string): void {
  const issues: string[] = []
  const suggestions: string[] = []

  if (dialect === 'postgres' && plan && plan[0]) {
    const rootPlan = plan[0].Plan || plan[0]
    analyzePostgresNode(rootPlan, issues, suggestions)
  } else if (Array.isArray(plan)) {
    // Check for common issues in table format
    for (const row of plan) {
      if (dialect === 'mysql') {
        if (row.type === 'ALL') {
          issues.push(`Full table scan on ${row.table}`)
        }
        if (row.Extra && row.Extra.includes('Using filesort')) {
          issues.push('Using filesort - may impact performance')
        }
        if (row.Extra && row.Extra.includes('Using temporary')) {
          issues.push('Using temporary table - may impact performance')
        }
      } else if (dialect === 'sqlite') {
        if (row.detail && row.detail.includes('SCAN TABLE')) {
          issues.push(`Full table scan detected: ${row.detail}`)
        }
      }
    }
  }

  // Display issues and suggestions
  if (issues.length > 0) {
    console.log('')
    console.log(prism.yellow('⚠ Potential Issues:'))
    for (const issue of issues) {
      console.log(`  • ${issue}`)
    }
  }

  if (suggestions.length > 0) {
    console.log('')
    console.log(prism.cyan('💡 Suggestions:'))
    for (const suggestion of suggestions) {
      console.log(`  • ${suggestion}`)
    }
  }

  // Overall assessment
  if (issues.length === 0) {
    console.log(prism.green('  ✅ Query plan looks optimized'))
  } else if (issues.length <= 2) {
    console.log(prism.yellow('  ⚠ Some optimization opportunities detected'))
  } else {
    console.log(prism.red('  ❌ Multiple performance issues detected'))
  }
}

function analyzePostgresNode(node: any, issues: string[], suggestions: string[]): void {
  if (!node) return

  // Check for sequential scans
  if (node['Node Type'] === 'Seq Scan') {
    issues.push(`Sequential scan on ${node['Relation Name']}`)
    suggestions.push(`Consider adding an index on ${node['Relation Name']}`)
  }

  // Check for nested loops with high row counts
  if (node['Node Type'] === 'Nested Loop' && node['Plan Rows'] > 1000) {
    issues.push('Nested loop with high row count - may be inefficient')
    suggestions.push('Consider using hash join or merge join for large datasets')
  }

  // Check for sort operations
  if (node['Sort Method'] === 'external merge') {
    issues.push('External sort detected - using disk for sorting')
    suggestions.push('Consider increasing work_mem to avoid disk sorts')
  }

  // Check for hash operations with multiple batches
  if (node['Hash Batches'] && node['Hash Batches'] > 1) {
    issues.push(`Hash operation using ${node['Hash Batches']} batches`)
    suggestions.push('Consider increasing work_mem for hash operations')
  }

  // Check row estimates vs actual
  if (node['Plan Rows'] && node['Actual Rows']) {
    const estimateError = Math.abs(node['Plan Rows'] - node['Actual Rows']) / node['Plan Rows']
    if (estimateError > 10) {
      issues.push(`Large estimation error on ${node['Node Type']} (estimated ${node['Plan Rows']}, actual ${node['Actual Rows']})`)
      suggestions.push('Consider running ANALYZE to update table statistics')
    }
  }

  // Recursively check child nodes
  if (node.Plans && Array.isArray(node.Plans)) {
    for (const child of node.Plans) {
      analyzePostgresNode(child, issues, suggestions)
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