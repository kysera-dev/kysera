/**
 * Tests for M-5: Standardized error message extraction
 *
 * Verifies that error message extraction is consistent across all dialects
 * using nullish coalescing operator.
 */

import { describe, it, expect } from 'vitest'
import { parseDatabaseError } from '../src/errors.js'

describe('M-5: Standardized error message extraction', () => {
  describe('MySQL error message extraction', () => {
    it('should use nullish coalescing for unknown errors', () => {
      const error = parseDatabaseError(
        {
          code: 'UNKNOWN_ERROR',
          sqlMessage: 'SQL message',
          message: 'Generic message'
        },
        'mysql'
      )

      expect(error.message).toBe('SQL message')
    })

    it('should fallback to message if sqlMessage is missing', () => {
      const error = parseDatabaseError(
        {
          code: 'UNKNOWN_ERROR',
          message: 'Generic message'
        },
        'mysql'
      )

      expect(error.message).toBe('Generic message')
    })

    it('should fallback to default if both are missing', () => {
      const error = parseDatabaseError(
        {
          code: 'UNKNOWN_ERROR'
        },
        'mysql'
      )

      expect(error.message).toBe('Database error')
    })
  })

  describe('MSSQL error message extraction', () => {
    it('should use nullish coalescing for unknown errors', () => {
      const error = parseDatabaseError(
        {
          code: 'UNKNOWN_ERROR',
          message: 'MSSQL message'
        },
        'mssql'
      )

      expect(error.message).toBe('MSSQL message')
    })

    it('should fallback to default if message is missing', () => {
      const error = parseDatabaseError(
        {
          code: 'UNKNOWN_ERROR'
        },
        'mssql'
      )

      expect(error.message).toBe('Database error')
    })

    it('should handle empty string message', () => {
      const error = parseDatabaseError(
        {
          code: 'UNKNOWN_ERROR',
          message: ''
        },
        'mssql'
      )

      // Nullish coalescing (??) only handles null/undefined, not empty strings
      // Empty string is a valid value and will be used as-is
      expect(error.message).toBe('')
    })
  })

  describe('PostgreSQL error message extraction', () => {
    it('should use nullish coalescing for unknown errors', () => {
      const error = parseDatabaseError(
        {
          code: 'UNKNOWN_CODE',
          message: 'Postgres message'
        },
        'postgres'
      )

      expect(error.message).toBe('Postgres message')
    })

    it('should fallback to default if message is missing', () => {
      const error = parseDatabaseError(
        {
          code: 'UNKNOWN_CODE'
        },
        'postgres'
      )

      expect(error.message).toBe('Database error')
    })
  })

  describe('SQLite error message extraction', () => {
    it('should use message for unknown errors', () => {
      const error = parseDatabaseError(
        {
          message: 'SQLite error message'
        },
        'sqlite'
      )

      expect(error.message).toBe('SQLite error message')
    })

    it('should fallback to default if message is missing', () => {
      const error = parseDatabaseError({}, 'sqlite')

      expect(error.message).toBe('')
    })
  })

  describe('Consistency across dialects', () => {
    it('should handle null and undefined consistently', () => {
      const mysqlError1 = parseDatabaseError({ code: 'TEST', message: null }, 'mysql')
      const mysqlError2 = parseDatabaseError({ code: 'TEST', message: undefined }, 'mysql')

      const mssqlError1 = parseDatabaseError({ code: 'TEST', message: null }, 'mssql')
      const mssqlError2 = parseDatabaseError({ code: 'TEST', message: undefined }, 'mssql')

      const postgresError1 = parseDatabaseError({ code: 'TEST', message: null }, 'postgres')
      const postgresError2 = parseDatabaseError({ code: 'TEST', message: undefined }, 'postgres')

      // All should fallback to "Database error" consistently
      expect(mysqlError1.message).toBe('Database error')
      expect(mysqlError2.message).toBe('Database error')
      expect(mssqlError1.message).toBe('Database error')
      expect(mssqlError2.message).toBe('Database error')
      expect(postgresError1.message).toBe('Database error')
      expect(postgresError2.message).toBe('Database error')
    })

    it('should prefer specific message fields in correct order', () => {
      // MySQL: sqlMessage ?? message ?? default
      const mysqlError = parseDatabaseError(
        {
          code: 'TEST',
          sqlMessage: 'SQL specific',
          message: 'Generic'
        },
        'mysql'
      )
      expect(mysqlError.message).toBe('SQL specific')

      // MSSQL: message ?? default
      const mssqlError = parseDatabaseError(
        {
          code: 'TEST',
          message: 'MSSQL specific'
        },
        'mssql'
      )
      expect(mssqlError.message).toBe('MSSQL specific')

      // Postgres: message ?? default
      const postgresError = parseDatabaseError(
        {
          code: 'TEST',
          message: 'Postgres specific'
        },
        'postgres'
      )
      expect(postgresError.message).toBe('Postgres specific')
    })

    it('should handle empty strings consistently', () => {
      const mysqlError = parseDatabaseError({ code: 'TEST', sqlMessage: '', message: '' }, 'mysql')
      const mssqlError = parseDatabaseError({ code: 'TEST', message: '' }, 'mssql')
      const postgresError = parseDatabaseError({ code: 'TEST', message: '' }, 'postgres')

      // Nullish coalescing (??) only handles null/undefined, NOT empty strings
      // Empty string is a valid value and preserved (this is intentional)
      // Use validation at the application layer if empty strings should be rejected
      expect(mysqlError.message).toBe('')
      expect(mssqlError.message).toBe('')
      expect(postgresError.message).toBe('')
    })
  })

  describe('Known constraint errors preserve specific messages', () => {
    it('should preserve unique constraint error messages', () => {
      const postgresError = parseDatabaseError(
        {
          code: '23505',
          detail: 'Key (email)=(test@example.com) already exists.',
          constraint: 'users_email_unique',
          table: 'users',
          message: 'duplicate key value violates unique constraint'
        },
        'postgres'
      )

      expect(postgresError.message).toBe('UNIQUE constraint violation on users')
    })

    it('should preserve foreign key error messages', () => {
      const mssqlError = parseDatabaseError(
        {
          code: '547',
          message:
            'The INSERT statement conflicted with the FOREIGN KEY constraint "FK_posts_user_id".'
        },
        'mssql'
      )

      expect(mssqlError.message).toBe('FOREIGN KEY constraint violation')
    })

    it('should preserve not null error messages', () => {
      const mysqlError = parseDatabaseError(
        {
          code: 'ER_BAD_NULL_ERROR',
          sqlMessage: "Column 'email' cannot be null"
        },
        'mysql'
      )

      expect(mysqlError.message).toContain('NOT NULL constraint violation')
    })
  })
})
