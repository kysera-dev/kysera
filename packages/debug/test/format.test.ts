/**
 * Tests for SQL formatting utilities.
 */

import { describe, it, expect } from 'vitest'
import { formatSQL, formatSQLPretty, minifySQL, highlightSQL } from '../src/format.js'

describe('formatSQL', () => {
  it('should add newlines before keywords', () => {
    const sql = 'SELECT id, name FROM users WHERE active = true ORDER BY name'
    const formatted = formatSQL(sql)

    expect(formatted).toContain('\nFROM')
    expect(formatted).toContain('\nWHERE')
    expect(formatted).toContain('\nORDER BY')
  })

  it('should handle simple SELECT', () => {
    const sql = 'SELECT * FROM users'
    const formatted = formatSQL(sql)

    expect(formatted).toBe('SELECT *\nFROM users')
  })

  it('should handle JOIN clauses', () => {
    const sql = 'SELECT u.* FROM users u JOIN orders o ON u.id = o.user_id'
    const formatted = formatSQL(sql)

    expect(formatted).toContain('\nFROM')
    expect(formatted).toContain('\nJOIN')
    expect(formatted).toContain('\nON')
  })

  it('should trim whitespace', () => {
    const sql = '  SELECT * FROM users  '
    const formatted = formatSQL(sql)

    expect(formatted).not.toMatch(/^\s/)
    expect(formatted).not.toMatch(/\s$/)
  })
})

describe('minifySQL', () => {
  it('should collapse whitespace', () => {
    const sql = `
      SELECT id, name
      FROM users
      WHERE active = true
    `
    const minified = minifySQL(sql)

    expect(minified).toBe('SELECT id, name FROM users WHERE active = true')
  })

  it('should normalize commas', () => {
    const sql = 'SELECT id  ,  name  ,  email FROM users'
    const minified = minifySQL(sql)

    expect(minified).toBe('SELECT id, name, email FROM users')
  })

  it('should handle parentheses', () => {
    const sql = 'SELECT * FROM users WHERE id IN ( 1, 2, 3 )'
    const minified = minifySQL(sql)

    expect(minified).toMatch(/IN \(1, 2, 3\)/)
  })
})

describe('highlightSQL', () => {
  it('should add ANSI codes for keywords', () => {
    const sql = 'SELECT * FROM users'
    const highlighted = highlightSQL(sql)

    // Check for ANSI codes
    expect(highlighted).toContain('\x1b[34m') // Blue
    expect(highlighted).toContain('\x1b[0m') // Reset
  })

  it('should highlight SELECT keyword', () => {
    const sql = 'SELECT id FROM users'
    const highlighted = highlightSQL(sql)

    expect(highlighted).toContain('\x1b[34mSELECT\x1b[0m')
  })
})

describe('formatSQLPretty', () => {
  it('should format basic query with newlines', () => {
    const sql = 'SELECT id, name FROM users WHERE active = true'
    const formatted = formatSQLPretty(sql)

    expect(formatted).toContain('\nFROM')
    expect(formatted).toContain('\nWHERE')
  })

  it('should indent subqueries with parentheses', () => {
    const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)'
    const formatted = formatSQLPretty(sql)

    // Should have newline after opening paren
    expect(formatted).toContain('(\n')
    // Should have newline before closing paren
    expect(formatted).toContain('\n)')
  })

  it('should handle nested parentheses', () => {
    const sql =
      'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE status IN (1, 2))'
    const formatted = formatSQLPretty(sql)

    // Multiple levels of indentation
    const lines = formatted.split('\n')
    expect(lines.length).toBeGreaterThan(3)
  })

  it('should use custom indent size', () => {
    const sql = 'SELECT * FROM users WHERE id IN (1)'
    const formatted4 = formatSQLPretty(sql, 4)
    const formatted2 = formatSQLPretty(sql, 2)

    // 4-space indent should have more spaces than 2-space
    const countSpaces = (s: string): number => {
      const match = /\(\n(\s+)/.exec(s)
      return match?.[1]?.length ?? 0
    }

    expect(countSpaces(formatted4)).toBe(4)
    expect(countSpaces(formatted2)).toBe(2)
  })

  it('should clean up excessive newlines', () => {
    const sql = 'SELECT * FROM users'
    const formatted = formatSQLPretty(sql)

    // Should not have consecutive empty lines
    expect(formatted).not.toMatch(/\n\s*\n\s*\n/)
  })

  it('should trim result', () => {
    const sql = '  SELECT * FROM users  '
    const formatted = formatSQLPretty(sql)

    expect(formatted).not.toMatch(/^\s/)
    expect(formatted).not.toMatch(/\s$/)
  })

  it('should handle empty parentheses gracefully', () => {
    const sql = 'SELECT COUNT() FROM users'
    const formatted = formatSQLPretty(sql)

    // Should not crash on empty parens
    expect(formatted).toContain('COUNT')
  })

  it('should handle deeply nested subqueries', () => {
    const sql =
      'SELECT * FROM a WHERE x IN (SELECT * FROM b WHERE y IN (SELECT * FROM c WHERE z IN (1)))'
    const formatted = formatSQLPretty(sql)

    // Should have multiple indentation levels
    const lines = formatted.split('\n')
    const leadingSpaceRegex = /^(\s*)/
    const maxIndent = Math.max(
      ...lines.map(line => {
        const match = leadingSpaceRegex.exec(line)
        return match?.[1]?.length ?? 0
      })
    )
    // With 3 levels of nesting, should have at least 4 spaces (2 * 2) of max indent
    expect(maxIndent).toBeGreaterThanOrEqual(4)
  })
})
