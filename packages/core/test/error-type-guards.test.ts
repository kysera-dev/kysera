/**
 * M-12: Tests for error type guards added in H-5
 *
 * The H-5 fix added `hasMessageProperty` and `isRawDatabaseError` type guards
 * in packages/core/src/errors.ts. These are internal (not exported) functions,
 * so they are tested indirectly through parseDatabaseError.
 *
 * Covers:
 * - hasMessageProperty with objects that do/don't have message
 * - isRawDatabaseError with various invalid inputs
 * - parseDatabaseError with malformed error objects
 */

import { describe, it, expect } from 'vitest'
import {
  parseDatabaseError,
  DatabaseError,
  UniqueConstraintError,
  ForeignKeyError,
  NotNullError,
  CheckConstraintError
} from '../src/errors.js'
import { ErrorCodes } from '../src/error-codes.js'

// ============================================================================
// hasMessageProperty - tested indirectly through parseDatabaseError
// ============================================================================

describe('hasMessageProperty type guard (via parseDatabaseError)', () => {
  describe('objects WITH message property', () => {
    it('should use message from Error objects for SQLite parsing', () => {
      const error = new Error('UNIQUE constraint failed: users.email')
      const parsed = parseDatabaseError(error, 'sqlite')

      expect(parsed).toBeInstanceOf(UniqueConstraintError)
      expect(parsed.message).toContain('UNIQUE')
    })

    it('should use message from plain objects for SQLite parsing', () => {
      const error = { message: 'FOREIGN KEY constraint failed' }
      const parsed = parseDatabaseError(error, 'sqlite')

      expect(parsed).toBeInstanceOf(ForeignKeyError)
    })

    it('should use message from objects with additional properties', () => {
      const error = { message: 'NOT NULL constraint failed: users.name', extra: 'data' }
      const parsed = parseDatabaseError(error, 'sqlite')

      expect(parsed).toBeInstanceOf(NotNullError)
    })

    it('should handle empty string message for SQLite', () => {
      const error = { message: '' }
      const parsed = parseDatabaseError(error, 'sqlite')

      // Empty message does not match any constraint pattern
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
      expect(parsed.message).toBe('')
    })
  })

  describe('objects WITHOUT message property', () => {
    it('should use empty string for SQLite when object has no message', () => {
      // This object has 'code' (passes as object) but no 'message'
      // For SQLite, hasMessageProperty returns false, so empty string is used
      const error = { code: 'SQLITE_CONSTRAINT' }
      const parsed = parseDatabaseError(error, 'sqlite')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should use empty string for SQLite when object only has random properties', () => {
      const error = { someProperty: 'value', anotherProperty: 123 }
      const parsed = parseDatabaseError(error, 'sqlite')

      // hasMessageProperty returns false -> empty string -> no pattern match
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should throw for SQLite with nested message object (non-string)', () => {
      // hasMessageProperty returns true because 'message' in error is true,
      // but the value is an object, not a string. parseSQLiteError receives
      // the non-string value and message.includes() throws a TypeError.
      const error = { message: { nested: 'value' } }
      expect(() => parseDatabaseError(error, 'sqlite')).toThrow(TypeError)
    })

    it('should throw for SQLite with message set to null', () => {
      // hasMessageProperty returns true (key exists), but value is null.
      // parseSQLiteError receives null and message.includes() throws.
      const error = { message: null }
      expect(() => parseDatabaseError(error, 'sqlite')).toThrow(TypeError)
    })

    it('should throw for SQLite with message set to undefined', () => {
      // hasMessageProperty returns true (key exists), but value is undefined.
      // parseSQLiteError receives undefined and message.includes() throws.
      const error = { message: undefined }
      expect(() => parseDatabaseError(error, 'sqlite')).toThrow(TypeError)
    })

    it('should throw for SQLite with message set to a number', () => {
      // hasMessageProperty returns true (key exists), but value is a number.
      // parseSQLiteError receives a number and message.includes() throws.
      const error = { message: 42 }
      expect(() => parseDatabaseError(error, 'sqlite')).toThrow(TypeError)
    })
  })
})

// ============================================================================
// isRawDatabaseError - tested indirectly through parseDatabaseError
// ============================================================================

describe('isRawDatabaseError type guard (via parseDatabaseError)', () => {
  describe('objects that ARE recognized as RawDatabaseError', () => {
    it('should recognize object with message property', () => {
      const error = { message: 'Some error' }
      const parsed = parseDatabaseError(error, 'postgres')

      // Has message but no code, so falls through to 'Unknown database error'
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should recognize object with code property', () => {
      const error = { code: '23505' }
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(UniqueConstraintError)
    })

    it('should recognize object with sqlMessage property', () => {
      const error = { sqlMessage: 'Some SQL error', code: 'ER_UNKNOWN' }
      const parsed = parseDatabaseError(error, 'mysql')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.message).toBe('Some SQL error')
    })

    it('should recognize object with detail property', () => {
      const error = { detail: 'Key (email)=(test@example.com) already exists.' }
      const parsed = parseDatabaseError(error, 'postgres')

      // Has detail but no code, so no specific parsing
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should recognize object with constraint property', () => {
      const error = { constraint: 'users_email_key' }
      const parsed = parseDatabaseError(error, 'postgres')

      // Has constraint but no code, so no specific parsing
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should recognize object with only sqlMessage property for MySQL', () => {
      const error = { sqlMessage: "Duplicate entry 'test' for key 'email'" }
      const parsed = parseDatabaseError(error, 'mysql')

      // isRawDatabaseError passes (has sqlMessage) but no code for specific MySQL parsing
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })
  })

  describe('objects that are NOT recognized as RawDatabaseError', () => {
    it('should return unknown error for object with no recognized properties', () => {
      const error = { foo: 'bar', baz: 123 }
      const parsed = parseDatabaseError(error, 'postgres')

      // isRawDatabaseError returns false
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
      expect(parsed.message).toBe('Unknown database error')
    })

    it('should return unknown error for empty object', () => {
      const error = {}
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
      expect(parsed.message).toBe('Unknown database error')
    })

    it('should return unknown error for object with only numeric keys', () => {
      const error = { 0: 'a', 1: 'b' }
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should return unknown error for object with symbol keys', () => {
      const sym = Symbol('test')
      const error = { [sym]: 'value' }
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should return unknown error for object with toString but no recognized keys', () => {
      const error = { toString: () => 'custom string' }
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should return unknown error for Date object', () => {
      const error = new Date()
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should return unknown error for RegExp object', () => {
      const error = /test/
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should return unknown error for Map object', () => {
      const error = new Map([['key', 'value']])
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should return unknown error for Set object', () => {
      const error = new Set([1, 2, 3])
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })
  })

  describe('isRawDatabaseError with MySQL dialect', () => {
    it('should fail for objects without recognized properties (MySQL)', () => {
      const error = { randomProp: 'value' }
      const parsed = parseDatabaseError(error, 'mysql')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
      expect(parsed.message).toBe('Unknown database error')
    })

    it('should pass for objects with code property (MySQL)', () => {
      const error = { code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry '1' for key 'PRIMARY'" }
      const parsed = parseDatabaseError(error, 'mysql')

      expect(parsed).toBeInstanceOf(UniqueConstraintError)
    })
  })

  describe('isRawDatabaseError with MSSQL dialect', () => {
    it('should fail for objects without recognized properties (MSSQL)', () => {
      const error = { randomProp: 'value' }
      const parsed = parseDatabaseError(error, 'mssql')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
      expect(parsed.message).toBe('Unknown database error')
    })

    it('should pass for objects with only message property (MSSQL)', () => {
      const error = { message: 'Cannot insert duplicate key row' }
      const parsed = parseDatabaseError(error, 'mssql')

      expect(parsed).toBeInstanceOf(UniqueConstraintError)
    })
  })
})

// ============================================================================
// parseDatabaseError with malformed error objects
// ============================================================================

describe('parseDatabaseError with malformed error objects', () => {
  describe('primitive and falsy inputs', () => {
    it('should handle null', () => {
      const parsed = parseDatabaseError(null)
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
      expect(parsed.message).toBe('Unknown database error')
    })

    it('should handle undefined', () => {
      const parsed = parseDatabaseError(undefined)
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle empty string', () => {
      const parsed = parseDatabaseError('')
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle number 0', () => {
      const parsed = parseDatabaseError(0)
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle NaN', () => {
      const parsed = parseDatabaseError(NaN)
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle false', () => {
      const parsed = parseDatabaseError(false)
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle true', () => {
      const parsed = parseDatabaseError(true)
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle a non-empty string', () => {
      const parsed = parseDatabaseError('some string error')
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle a function', () => {
      const parsed = parseDatabaseError(() => 'error')
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle a symbol', () => {
      const parsed = parseDatabaseError(Symbol('error'))
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle bigint', () => {
      const parsed = parseDatabaseError(BigInt(42))
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })
  })

  describe('array inputs', () => {
    it('should handle empty array', () => {
      const parsed = parseDatabaseError([])
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle array with objects', () => {
      const parsed = parseDatabaseError([{ code: '23505' }])
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle nested array', () => {
      const parsed = parseDatabaseError([[1, 2], [3, 4]])
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })
  })

  describe('malformed error objects with wrong types for properties', () => {
    it('should handle code as a number for postgres', () => {
      // The parseDatabaseError checks dbError.code (which could be anything)
      // but parsePostgresError switches on dbError.code string values
      const error = { code: 23505, message: 'some error' } // number instead of string
      const parsed = parseDatabaseError(error, 'postgres')

      // code exists and is truthy, so parsePostgresError is called
      // but switch won't match any string case
      expect(parsed).toBeInstanceOf(DatabaseError)
    })

    it('should handle code as boolean for postgres', () => {
      const error = { code: true, message: 'some error' }
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
    })

    it('should handle message as array for SQLite', () => {
      const error = { message: ['UNIQUE', 'constraint', 'failed'] }
      const parsed = parseDatabaseError(error, 'sqlite')

      // message is an array, coerced to string "UNIQUE,constraint,failed"
      // This might not match the exact patterns
      expect(parsed).toBeInstanceOf(DatabaseError)
    })

    it('should handle error with prototype chain properties', () => {
      class CustomError {
        get message() {
          return 'UNIQUE constraint failed: users.email'
        }
      }
      const error = new CustomError()
      const parsed = parseDatabaseError(error, 'sqlite')

      // hasMessageProperty checks 'message' in error which finds it via prototype
      expect(parsed).toBeInstanceOf(UniqueConstraintError)
    })

    it('should handle error object with null code for postgres', () => {
      const error = { code: null, message: 'test' }
      const parsed = parseDatabaseError(error, 'postgres')

      // code is null (falsy), so the if (dialect === 'postgres' && dbError.code) fails
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle error object with undefined code for mysql', () => {
      const error = { code: undefined, message: 'test', sqlMessage: 'test' }
      const parsed = parseDatabaseError(error, 'mysql')

      // code is undefined (falsy), so the if (dialect === 'mysql' && dbError.code) fails
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })
  })

  describe('objects with inherited/getter message property', () => {
    it('should work with Error subclass', () => {
      class MyError extends Error {
        constructor() {
          super('CHECK constraint failed: price_positive')
        }
      }
      const error = new MyError()
      const parsed = parseDatabaseError(error, 'sqlite')

      expect(parsed).toBeInstanceOf(CheckConstraintError)
    })

    it('should work with plain object having enumerable message', () => {
      const error = Object.create(null)
      error.message = 'UNIQUE constraint failed: users.email'
      const parsed = parseDatabaseError(error, 'sqlite')

      expect(parsed).toBeInstanceOf(UniqueConstraintError)
    })

    it('should work with Error wrapped in object spread', () => {
      const originalError = new Error('NOT NULL constraint failed: posts.title')
      const error = { ...originalError, message: originalError.message }
      const parsed = parseDatabaseError(error, 'sqlite')

      expect(parsed).toBeInstanceOf(NotNullError)
    })
  })

  describe('dialect-specific fallback behavior', () => {
    it('should SQLite parse before isRawDatabaseError check', () => {
      // For SQLite, parseDatabaseError checks hasMessageProperty first,
      // then calls parseSQLiteError with the message (or empty string)
      // This means even objects that would fail isRawDatabaseError get parsed for SQLite
      const error = { randomProp: 'value' } // Would fail isRawDatabaseError
      const parsed = parseDatabaseError(error, 'sqlite')

      // SQLite uses empty string (no message property), returns generic error
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
      expect(parsed.message).toBe('')
    })

    it('should return unknown for unrecognized objects with postgres dialect', () => {
      const error = { random: true }
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
      expect(parsed.message).toBe('Unknown database error')
    })

    it('should return unknown for unrecognized objects with mysql dialect', () => {
      const error = { random: true }
      const parsed = parseDatabaseError(error, 'mysql')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
      expect(parsed.message).toBe('Unknown database error')
    })

    it('should return unknown for unrecognized objects with mssql dialect', () => {
      const error = { random: true }
      const parsed = parseDatabaseError(error, 'mssql')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
      expect(parsed.message).toBe('Unknown database error')
    })

    it('should use default postgres dialect when not specified', () => {
      const error = { code: '23505', constraint: 'test_key', table: 'test_table' }
      const parsed = parseDatabaseError(error)

      expect(parsed).toBeInstanceOf(UniqueConstraintError)
    })
  })

  describe('complex malformed error scenarios', () => {
    it('should handle error with all undefined properties', () => {
      const error = {
        code: undefined,
        message: undefined,
        detail: undefined,
        constraint: undefined,
        sqlMessage: undefined
      }
      const parsed = parseDatabaseError(error, 'postgres')

      // isRawDatabaseError checks 'message' in error -> true (key exists even if undefined)
      // But code is falsy, so no specific parsing
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle error with all null properties', () => {
      const error = {
        code: null,
        message: null,
        detail: null,
        constraint: null
      }
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle postgres error with empty string code', () => {
      const error = { code: '', message: 'test' }
      const parsed = parseDatabaseError(error, 'postgres')

      // Empty string is falsy, so postgres-specific parsing is skipped
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle mysql error with empty string code', () => {
      const error = { code: '', sqlMessage: 'test' }
      const parsed = parseDatabaseError(error, 'mysql')

      // Empty string is falsy, so mysql-specific parsing is skipped
      expect(parsed).toBeInstanceOf(DatabaseError)
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    })

    it('should handle MSSQL error with conflicted with the foreign key message', () => {
      const error = {
        message:
          "The INSERT statement conflicted with the FOREIGN KEY constraint \"FK_order_customer\". The conflict occurred in database \"shop\", table \"dbo.customers\", column 'id'."
      }
      const parsed = parseDatabaseError(error, 'mssql')

      expect(parsed).toBeInstanceOf(ForeignKeyError)
      const fkError = parsed as ForeignKeyError
      expect(fkError.constraint).toBe('FK_order_customer')
    })

    it('should handle Error object with extra properties for postgres', () => {
      const error = new Error('original message') as Error & {
        code: string
        constraint: string
        table: string
        detail: string
      }
      error.code = '23505'
      error.constraint = 'users_email_unique'
      error.table = 'users'
      error.detail = 'Key (email)=(alice@test.com) already exists.'

      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(UniqueConstraintError)
      const uniqueError = parsed as UniqueConstraintError
      expect(uniqueError.constraint).toBe('users_email_unique')
      expect(uniqueError.table).toBe('users')
      expect(uniqueError.columns).toEqual(['email'])
    })

    it('should handle frozen object', () => {
      const error = Object.freeze({ message: 'UNIQUE constraint failed: users.email' })
      const parsed = parseDatabaseError(error, 'sqlite')

      expect(parsed).toBeInstanceOf(UniqueConstraintError)
    })

    it('should handle sealed object', () => {
      const error = Object.seal({ code: '23503', table: 'posts', message: 'FK error' })
      const parsed = parseDatabaseError(error, 'postgres')

      expect(parsed).toBeInstanceOf(ForeignKeyError)
    })
  })
})
