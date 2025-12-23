/**
 * SQL formatting utilities.
 *
 * @module @kysera/debug
 */

/**
 * Escape special regex characters in a string.
 * @internal
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * SQL keywords that should start on a new line.
 */
const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'OUTER JOIN',
  'CROSS JOIN',
  'ORDER BY',
  'GROUP BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE FROM',
  'UNION',
  'EXCEPT',
  'INTERSECT',
  'ON',
  'AND',
  'OR',
  'RETURNING'
]

/**
 * Pre-compiled regex patterns for SQL formatting.
 * Cached at module load time for O(1) lookup.
 * @internal
 */
const FORMAT_PATTERNS: RegExp[] = SQL_KEYWORDS.map(
  keyword => new RegExp(`(\\s+)(${escapeRegex(keyword)})\\s+`, 'gi')
)

/**
 * Pre-compiled regex patterns for SQL highlighting.
 * Cached at module load time for O(1) lookup.
 * @internal
 */
const HIGHLIGHT_PATTERNS: { regex: RegExp; keyword: string }[] = SQL_KEYWORDS.map(keyword => ({
  regex: new RegExp(`\\b(${escapeRegex(keyword)})\\b`, 'gi'),
  keyword
}))

/**
 * Format SQL for better readability.
 *
 * Adds newlines before major SQL keywords to make
 * complex queries easier to read.
 *
 * @param sql - SQL string to format
 * @returns Formatted SQL string
 *
 * @example
 * ```typescript
 * import { formatSQL } from '@kysera/debug';
 *
 * const sql = 'SELECT id, name FROM users WHERE active = true ORDER BY name';
 * console.log(formatSQL(sql));
 * // SELECT id, name
 * // FROM users
 * // WHERE active = true
 * // ORDER BY name
 * ```
 */
export function formatSQL(sql: string): string {
  let formatted = sql

  // Add newlines before SQL keywords using pre-compiled patterns
  for (const pattern of FORMAT_PATTERNS) {
    // Reset lastIndex for global regexes to ensure consistent behavior
    pattern.lastIndex = 0
    formatted = formatted.replace(pattern, '\n$2 ')
  }

  return formatted.trim()
}

/**
 * Format SQL with indentation for nested queries.
 *
 * More advanced formatting with proper indentation
 * for subqueries and nested structures.
 *
 * @param sql - SQL string to format
 * @param indentSize - Number of spaces for indentation
 * @returns Formatted SQL string
 *
 * @example
 * ```typescript
 * import { formatSQLPretty } from '@kysera/debug';
 *
 * const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)';
 * console.log(formatSQLPretty(sql));
 * ```
 */
export function formatSQLPretty(sql: string, indentSize = 2): string {
  let formatted = formatSQL(sql)
  const indent = ' '.repeat(indentSize)
  let level = 0

  // Handle parentheses for subqueries
  formatted = formatted.replace(/\(/g, () => {
    level++
    return '(\n' + indent.repeat(level)
  })

  formatted = formatted.replace(/\)/g, () => {
    level = Math.max(0, level - 1)
    return '\n' + indent.repeat(level) + ')'
  })

  // Clean up excessive newlines
  formatted = formatted.replace(/\n\s*\n/g, '\n')

  return formatted.trim()
}

/**
 * Minify SQL by removing unnecessary whitespace.
 *
 * @param sql - SQL string to minify
 * @returns Minified SQL string
 *
 * @example
 * ```typescript
 * import { minifySQL } from '@kysera/debug';
 *
 * const sql = `
 *   SELECT id, name
 *   FROM users
 *   WHERE active = true
 * `;
 * console.log(minifySQL(sql));
 * // SELECT id, name FROM users WHERE active = true
 * ```
 */
export function minifySQL(sql: string): string {
  return sql
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/\s*,\s*/g, ', ') // Normalize commas
    .replace(/\s*\(\s*/g, ' (') // Normalize opening parens
    .replace(/\s*\)\s*/g, ') ') // Normalize closing parens
    .trim()
}

/**
 * Highlight SQL keywords in a query.
 *
 * Returns SQL with ANSI color codes for terminal output.
 *
 * @param sql - SQL string to highlight
 * @returns SQL with ANSI color codes
 *
 * @example
 * ```typescript
 * import { highlightSQL } from '@kysera/debug';
 *
 * console.log(highlightSQL('SELECT * FROM users'));
 * // Keywords will be highlighted in blue
 * ```
 */
export function highlightSQL(sql: string): string {
  const BLUE = '\x1b[34m'
  const RESET = '\x1b[0m'

  let highlighted = sql

  for (const { regex } of HIGHLIGHT_PATTERNS) {
    // Reset lastIndex for global regexes to ensure consistent behavior
    regex.lastIndex = 0
    highlighted = highlighted.replace(regex, BLUE + '$1' + RESET)
  }

  return highlighted
}
