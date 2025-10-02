import { Command } from 'commander'
import { prism, spinner, table } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface ErrorsOptions {
  since?: string
  until?: string
  limit?: string
  pattern?: string
  groupBy?: 'error' | 'table' | 'operation' | 'user'
  showQueries?: boolean
  json?: boolean
  config?: string
}

interface ErrorPattern {
  pattern: string
  count: number
  firstSeen: Date
  lastSeen: Date
  examples: ErrorLog[]
  affectedTables: Set<string>
  affectedUsers: Set<string>
}

interface ErrorLog {
  id?: number
  timestamp: Date
  error: string
  query?: string
  table?: string
  operation?: string
  user?: string
  stackTrace?: string
}

export function errorsCommand(): Command {
  const cmd = new Command('errors')
    .description('Error analysis and pattern detection')
    .option('-s, --since <datetime>', 'Show errors since datetime (ISO 8601)')
    .option('--until <datetime>', 'Show errors until datetime (ISO 8601)')
    .option('-l, --limit <n>', 'Limit number of results', '100')
    .option('-p, --pattern <regex>', 'Filter errors by pattern')
    .option('-g, --group-by <field>', 'Group errors by field (error/table/operation/user)', 'error')
    .option('--show-queries', 'Show failing queries')
    .option('--json', 'Output as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: ErrorsOptions) => {
      try {
        await analyzeErrors(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to analyze errors: ${error instanceof Error ? error.message : String(error)}`,
          'ERROR_ANALYSIS_ERROR'
        )
      }
    })

  return cmd
}

async function analyzeErrors(options: ErrorsOptions): Promise<void> {
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
  analyzeSpinner.start('Analyzing error logs...')

  try {
    // Check if error_logs table exists
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_name', '=', 'error_logs')
      .execute()

    if (tables.length === 0) {
      analyzeSpinner.warn('Error logs table not found')
      console.log('')
      console.log(prism.yellow('The error_logs table does not exist.'))
      console.log(prism.gray('Error logging is not enabled for this database.'))
      console.log('')
      console.log(prism.gray('To enable error logging:'))
      console.log('  1. Create an error_logs table:')
      console.log('     - id, timestamp, error, query, table_name, operation, user_id, stack_trace')
      console.log('  2. Configure error handling in your application')
      console.log('  3. Log database errors to the error_logs table')
      return
    }

    // Build query for error logs
    let query = db
      .selectFrom('error_logs')
      .selectAll()
      .orderBy('timestamp', 'desc')

    // Apply filters
    if (options.since) {
      const sinceDate = new Date(options.since)
      if (isNaN(sinceDate.getTime())) {
        throw new CLIError('Invalid since date format', 'INVALID_DATE')
      }
      query = query.where('timestamp', '>=', sinceDate)
    }

    if (options.until) {
      const untilDate = new Date(options.until)
      if (isNaN(untilDate.getTime())) {
        throw new CLIError('Invalid until date format', 'INVALID_DATE')
      }
      query = query.where('timestamp', '<=', untilDate)
    }

    const limit = parseInt(options.limit || '100', 10)
    query = query.limit(limit * 2) // Get more for pattern analysis

    // Execute query
    const errorLogs = await query.execute()

    if (errorLogs.length === 0) {
      analyzeSpinner.succeed('No errors found in the specified period')
      return
    }

    analyzeSpinner.succeed(`Found ${errorLogs.length} error${errorLogs.length !== 1 ? 's' : ''}`)

    // Convert to ErrorLog format
    const errors: ErrorLog[] = errorLogs.map((log: any) => ({
      id: log.id,
      timestamp: new Date(log.timestamp),
      error: log.error,
      query: log.query,
      table: log.table_name,
      operation: log.operation,
      user: log.user_id,
      stackTrace: log.stack_trace
    }))

    // Apply pattern filter if specified
    if (options.pattern) {
      const regex = new RegExp(options.pattern, 'i')
      const filtered = errors.filter(e => regex.test(e.error) || (e.query && regex.test(e.query)))

      if (filtered.length === 0) {
        console.log(prism.yellow('No errors match the specified pattern'))
        return
      }

      errors.length = 0
      errors.push(...filtered)
    }

    // Analyze error patterns
    const patterns = detectErrorPatterns(errors)

    // Output results
    if (options.json) {
      console.log(JSON.stringify({
        errors: errors.slice(0, limit),
        patterns: Array.from(patterns.values()).map(p => ({
          ...p,
          affectedTables: Array.from(p.affectedTables),
          affectedUsers: Array.from(p.affectedUsers)
        }))
      }, null, 2))
    } else {
      displayErrorAnalysis(errors.slice(0, limit), patterns, options)
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

function detectErrorPatterns(errors: ErrorLog[]): Map<string, ErrorPattern> {
  const patterns = new Map<string, ErrorPattern>()

  for (const error of errors) {
    // Normalize error message to find pattern
    const pattern = normalizeErrorMessage(error.error)

    if (!patterns.has(pattern)) {
      patterns.set(pattern, {
        pattern,
        count: 0,
        firstSeen: error.timestamp,
        lastSeen: error.timestamp,
        examples: [],
        affectedTables: new Set(),
        affectedUsers: new Set()
      })
    }

    const errorPattern = patterns.get(pattern)!
    errorPattern.count++
    errorPattern.lastSeen = error.timestamp

    if (errorPattern.firstSeen > error.timestamp) {
      errorPattern.firstSeen = error.timestamp
    }

    if (errorPattern.examples.length < 3) {
      errorPattern.examples.push(error)
    }

    if (error.table) {
      errorPattern.affectedTables.add(error.table)
    }

    if (error.user) {
      errorPattern.affectedUsers.add(error.user)
    }
  }

  return patterns
}

function normalizeErrorMessage(error: string): string {
  return error
    .replace(/\b\d+\b/g, 'N')                   // Replace numbers with N
    .replace(/'[^']*'/g, 'X')                   // Replace string literals with X
    .replace(/`[^`]*`/g, 'X')                   // Replace quoted identifiers with X
    .replace(/\([^)]*\)/g, '(...)')             // Simplify parentheses content
    .replace(/\s+/g, ' ')                       // Normalize whitespace
    .trim()
    .substring(0, 100)                          // Take first 100 chars as pattern
}

function displayErrorAnalysis(
  errors: ErrorLog[],
  patterns: Map<string, ErrorPattern>,
  options: ErrorsOptions
): void {
  console.log('')
  console.log(prism.bold('🔍 Error Analysis'))
  console.log(prism.gray('─'.repeat(60)))

  // Group errors based on option
  if (options.groupBy === 'table') {
    displayErrorsByTable(errors)
  } else if (options.groupBy === 'operation') {
    displayErrorsByOperation(errors)
  } else if (options.groupBy === 'user') {
    displayErrorsByUser(errors)
  } else {
    displayErrorsByPattern(patterns)
  }

  // Show recent errors
  console.log('')
  console.log(prism.cyan('Recent Errors:'))

  const recentErrors = errors.slice(0, 10)
  for (const error of recentErrors) {
    console.log('')
    console.log(prism.red(`✗ ${formatDate(error.timestamp)}`))
    console.log(`  ${prism.bold('Error:')} ${truncateError(error.error)}`)

    if (error.table) {
      console.log(`  ${prism.gray('Table:')} ${error.table}`)
    }

    if (error.operation) {
      console.log(`  ${prism.gray('Operation:')} ${error.operation}`)
    }

    if (error.user) {
      console.log(`  ${prism.gray('User:')} ${error.user}`)
    }

    if (options.showQueries && error.query) {
      console.log(`  ${prism.gray('Query:')} ${truncateQuery(error.query)}`)
    }
  }

  // Error timeline
  console.log('')
  console.log(prism.cyan('Error Timeline:'))
  displayErrorTimeline(errors)

  // Summary statistics
  console.log('')
  console.log(prism.gray('─'.repeat(60)))
  console.log(prism.gray('Summary:'))

  const uniquePatterns = patterns.size
  const totalErrors = errors.length
  const affectedTables = new Set(errors.map(e => e.table).filter(Boolean)).size
  const affectedUsers = new Set(errors.map(e => e.user).filter(Boolean)).size

  console.log(`  Total Errors: ${totalErrors}`)
  console.log(`  Unique Patterns: ${uniquePatterns}`)
  console.log(`  Affected Tables: ${affectedTables}`)
  console.log(`  Affected Users: ${affectedUsers}`)

  // Top error types
  const errorTypes = new Map<string, number>()
  for (const error of errors) {
    const type = getErrorType(error.error)
    errorTypes.set(type, (errorTypes.get(type) || 0) + 1)
  }

  console.log('')
  console.log(prism.cyan('Error Types:'))
  const sortedTypes = Array.from(errorTypes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  for (const [type, count] of sortedTypes) {
    const percentage = ((count / totalErrors) * 100).toFixed(1)
    console.log(`  ${type}: ${count} (${percentage}%)`)
  }

  // Recommendations
  console.log('')
  console.log(prism.cyan('Recommendations:'))

  const topPattern = Array.from(patterns.values())
    .sort((a, b) => b.count - a.count)[0]

  if (topPattern && topPattern.count > 5) {
    console.log(prism.yellow(`  ⚠ Pattern "${truncateError(topPattern.pattern)}" occurred ${topPattern.count} times`))
    console.log('    Consider investigating and fixing this recurring issue')
  }

  const connectionErrors = Array.from(errorTypes.entries())
    .filter(([type]) => type.includes('connection') || type.includes('timeout'))
    .reduce((sum, [, count]) => sum + count, 0)

  if (connectionErrors > totalErrors * 0.2) {
    console.log(prism.yellow('  ⚠ High number of connection errors detected'))
    console.log('    Consider checking database connection pool settings')
  }

  const constraintErrors = Array.from(errorTypes.entries())
    .filter(([type]) => type.includes('constraint') || type.includes('unique') || type.includes('foreign'))
    .reduce((sum, [, count]) => sum + count, 0)

  if (constraintErrors > totalErrors * 0.3) {
    console.log(prism.yellow('  ⚠ Many constraint violations detected'))
    console.log('    Review data validation logic and database constraints')
  }
}

function displayErrorsByPattern(patterns: Map<string, ErrorPattern>): void {
  const sortedPatterns = Array.from(patterns.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  console.log('')
  console.log(prism.cyan('Top Error Patterns:'))

  const patternData = sortedPatterns.map(p => ({
    Pattern: truncateError(p.pattern),
    Count: p.count,
    'First Seen': formatDate(p.firstSeen, true),
    'Last Seen': formatDate(p.lastSeen, true),
    Tables: p.affectedTables.size,
    Users: p.affectedUsers.size
  }))

  console.log(table(patternData))
}

function displayErrorsByTable(errors: ErrorLog[]): void {
  const tableErrors = new Map<string, number>()

  for (const error of errors) {
    if (error.table) {
      tableErrors.set(error.table, (tableErrors.get(error.table) || 0) + 1)
    }
  }

  const sortedTables = Array.from(tableErrors.entries())
    .sort((a, b) => b[1] - a[1])

  console.log('')
  console.log(prism.cyan('Errors by Table:'))

  const tableData = sortedTables.map(([table, count]) => ({
    Table: table,
    Errors: count,
    Percentage: `${((count / errors.length) * 100).toFixed(1)}%`
  }))

  console.log(table(tableData))
}

function displayErrorsByOperation(errors: ErrorLog[]): void {
  const operationErrors = new Map<string, number>()

  for (const error of errors) {
    const operation = error.operation || 'unknown'
    operationErrors.set(operation, (operationErrors.get(operation) || 0) + 1)
  }

  const sortedOperations = Array.from(operationErrors.entries())
    .sort((a, b) => b[1] - a[1])

  console.log('')
  console.log(prism.cyan('Errors by Operation:'))

  const operationData = sortedOperations.map(([operation, count]) => ({
    Operation: operation,
    Errors: count,
    Percentage: `${((count / errors.length) * 100).toFixed(1)}%`
  }))

  console.log(table(operationData))
}

function displayErrorsByUser(errors: ErrorLog[]): void {
  const userErrors = new Map<string, number>()

  for (const error of errors) {
    const user = error.user || 'system'
    userErrors.set(user, (userErrors.get(user) || 0) + 1)
  }

  const sortedUsers = Array.from(userErrors.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  console.log('')
  console.log(prism.cyan('Errors by User:'))

  const userData = sortedUsers.map(([user, count]) => ({
    User: user,
    Errors: count,
    Percentage: `${((count / errors.length) * 100).toFixed(1)}%`
  }))

  console.log(table(userData))
}

function displayErrorTimeline(errors: ErrorLog[]): void {
  // Group errors by hour
  const hourlyErrors = new Map<string, number>()

  for (const error of errors) {
    const hour = error.timestamp.toISOString().slice(0, 13) + ':00'
    hourlyErrors.set(hour, (hourlyErrors.get(hour) || 0) + 1)
  }

  const sortedHours = Array.from(hourlyErrors.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-24) // Last 24 hours

  if (sortedHours.length === 0) return

  const maxCount = Math.max(...sortedHours.map(([, count]) => count))

  for (const [hour, count] of sortedHours) {
    const barLength = Math.round((count / maxCount) * 30)
    const bar = '█'.repeat(barLength) + '░'.repeat(30 - barLength)
    const displayHour = new Date(hour).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit'
    })
    console.log(`  ${displayHour.padEnd(15)}: ${bar} ${count}`)
  }
}

function getErrorType(error: string): string {
  const errorLower = error.toLowerCase()

  if (errorLower.includes('connection') || errorLower.includes('econnrefused')) {
    return 'Connection Error'
  } else if (errorLower.includes('timeout')) {
    return 'Timeout Error'
  } else if (errorLower.includes('syntax') || errorLower.includes('parse')) {
    return 'Syntax Error'
  } else if (errorLower.includes('constraint') || errorLower.includes('violates')) {
    return 'Constraint Violation'
  } else if (errorLower.includes('unique')) {
    return 'Unique Violation'
  } else if (errorLower.includes('foreign key')) {
    return 'Foreign Key Violation'
  } else if (errorLower.includes('permission') || errorLower.includes('denied')) {
    return 'Permission Error'
  } else if (errorLower.includes('not found') || errorLower.includes('does not exist')) {
    return 'Not Found Error'
  } else if (errorLower.includes('deadlock')) {
    return 'Deadlock Error'
  } else {
    return 'Other Error'
  }
}

function formatDate(date: Date, compact: boolean = false): string {
  if (compact) {
    return date.toISOString().slice(0, 16).replace('T', ' ')
  }
  return date.toLocaleString()
}

function truncateError(error: string, maxLength: number = 60): string {
  if (error.length <= maxLength) return error
  return error.substring(0, maxLength - 3) + '...'
}

function truncateQuery(query: string, maxLength: number = 80): string {
  const normalized = query.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return normalized.substring(0, maxLength - 3) + '...'
}