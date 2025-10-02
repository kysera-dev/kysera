import Table from 'cli-table3'
import chalk from 'chalk'
import stripAnsi from 'strip-ansi'
import wrapAnsi from 'wrap-ansi'

export interface TableOptions {
  head?: string[]
  colWidths?: number[]
  colAligns?: Array<'left' | 'center' | 'right'>
  style?: {
    head?: string[]
    border?: string[]
    compact?: boolean
  }
  wordWrap?: boolean
  wrapOptions?: {
    width?: number
    hard?: boolean
    trim?: boolean
  }
}

export interface TableRow {
  [key: string]: any
}

/**
 * Create a formatted table
 */
export function createTable(options: TableOptions = {}): Table.Table {
  const tableOptions: Table.TableConstructorOptions = {
    head: options.head?.map(h => chalk.bold(h)) || [],
    colWidths: options.colWidths,
    style: {
      head: options.style?.head || ['cyan'],
      border: options.style?.border || ['gray'],
      compact: options.style?.compact || false
    },
    wordWrap: options.wordWrap !== false,
    wrapOnWordBoundary: true
  }

  if (options.colAligns) {
    tableOptions.colAligns = options.colAligns
  }

  return new Table(tableOptions)
}

/**
 * Format data as a table
 */
export function formatTable(
  data: TableRow[],
  columns?: string[],
  options: TableOptions = {}
): string {
  if (!data || data.length === 0) {
    return 'No data available'
  }

  // Auto-detect columns if not provided
  if (!columns) {
    columns = Object.keys(data[0])
  }

  // Create table with headers
  const table = createTable({
    ...options,
    head: options.head || columns.map(col =>
      col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    )
  })

  // Add rows
  for (const row of data) {
    const values = columns.map(col => formatValue(row[col]))
    table.push(values)
  }

  return table.toString()
}

/**
 * Format a single value for table display
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return chalk.gray('—')
  }

  if (typeof value === 'boolean') {
    return value ? chalk.green('✓') : chalk.red('✗')
  }

  if (typeof value === 'number') {
    // Format large numbers with commas
    if (value >= 1000) {
      return value.toLocaleString()
    }
    return String(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.join(', ')
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }

  return String(value)
}

/**
 * Create a vertical table (key-value pairs)
 */
export function createVerticalTable(
  data: Record<string, any>,
  options: TableOptions = {}
): string {
  const table = createTable({
    ...options,
    colWidths: options.colWidths || [30, 50],
    colAligns: options.colAligns || ['right', 'left']
  })

  for (const [key, value] of Object.entries(data)) {
    const formattedKey = chalk.bold(
      key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    )
    table.push([formattedKey, formatValue(value)])
  }

  return table.toString()
}

/**
 * Create a comparison table
 */
export function createComparisonTable(
  items: Array<{ name: string; data: Record<string, any> }>,
  options: TableOptions = {}
): string {
  if (items.length === 0) {
    return 'No items to compare'
  }

  // Get all unique keys
  const allKeys = new Set<string>()
  for (const item of items) {
    Object.keys(item.data).forEach(key => allKeys.add(key))
  }

  // Create headers
  const headers = ['Property', ...items.map(item => item.name)]

  const table = createTable({
    ...options,
    head: headers,
    colWidths: options.colWidths || [30, ...items.map(() => Math.floor(70 / items.length))]
  })

  // Add rows
  for (const key of allKeys) {
    const row = [
      chalk.bold(key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())),
      ...items.map(item => formatValue(item.data[key]))
    ]
    table.push(row)
  }

  return table.toString()
}

/**
 * Create a summary table with totals
 */
export function createSummaryTable(
  data: TableRow[],
  summaryFields: string[],
  options: TableOptions = {}
): string {
  const table = formatTable(data, undefined, options)

  // Calculate summaries
  const summaries: Record<string, number> = {}
  for (const field of summaryFields) {
    summaries[field] = data.reduce((sum, row) => {
      const value = row[field]
      return sum + (typeof value === 'number' ? value : 0)
    }, 0)
  }

  // Add summary row
  const summaryTable = createTable({
    ...options,
    style: { ...options.style, compact: true }
  })

  const summaryRow = ['Total']
  const columns = Object.keys(data[0])
  for (const col of columns.slice(1)) {
    if (summaryFields.includes(col)) {
      summaryRow.push(chalk.bold(formatValue(summaries[col])))
    } else {
      summaryRow.push('')
    }
  }

  summaryTable.push(summaryRow)

  return table + '\n' + summaryTable.toString()
}

/**
 * Format a list as a table
 */
export function formatList(
  items: string[],
  columns: number = 1,
  options: { numbered?: boolean; bullet?: string } = {}
): string {
  if (items.length === 0) {
    return 'No items'
  }

  const itemsPerColumn = Math.ceil(items.length / columns)
  const table = createTable({
    style: { border: [], compact: true },
    colWidths: Array(columns).fill(Math.floor(80 / columns))
  })

  for (let i = 0; i < itemsPerColumn; i++) {
    const row: string[] = []
    for (let j = 0; j < columns; j++) {
      const index = i + j * itemsPerColumn
      if (index < items.length) {
        if (options.numbered) {
          row.push(`${index + 1}. ${items[index]}`)
        } else if (options.bullet) {
          row.push(`${options.bullet} ${items[index]}`)
        } else {
          row.push(items[index])
        }
      } else {
        row.push('')
      }
    }
    table.push(row)
  }

  return table.toString()
}

/**
 * Truncate text to fit within a specific width
 */
export function truncate(text: string, width: number, suffix: string = '...'): string {
  const stripped = stripAnsi(text)
  if (stripped.length <= width) {
    return text
  }

  const truncated = stripped.slice(0, width - suffix.length) + suffix

  // Preserve color codes if present
  if (text !== stripped) {
    // Simple approach: just add colors back at the beginning
    const colorMatch = text.match(/^(\x1b\[[0-9;]*m)+/)
    if (colorMatch) {
      return colorMatch[0] + truncated + '\x1b[0m'
    }
  }

  return truncated
}

/**
 * Wrap text to fit within a specific width
 */
export function wrap(text: string, width: number): string {
  return wrapAnsi(text, width, {
    hard: false,
    trim: true
  })
}