/**
 * Plugin-specific error classes tests
 * Tests for SoftDeleteError, AuditError, TimestampsError and their subclasses
 */

import { describe, it, expect } from 'vitest'
import {
  DatabaseError,
  SoftDeleteError,
  RecordNotDeletedError,
  AuditError,
  AuditRestoreError,
  AuditMissingValuesError,
  TimestampsError,
  TimestampColumnMissingError,
  ErrorCodes
} from '../src/index.js'

describe('Plugin Error Classes', () => {
  describe('SoftDeleteError', () => {
    it('should create a soft delete error with message and detail', () => {
      const error = new SoftDeleteError('Soft delete failed', 'Invalid column')

      expect(error).toBeInstanceOf(SoftDeleteError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('SoftDeleteError')
      expect(error.message).toBe('Soft delete failed')
      expect(error.code).toBe(ErrorCodes.SOFT_DELETE_ERROR)
      expect(error.detail).toBe('Invalid column')
    })

    it('should create a soft delete error without detail', () => {
      const error = new SoftDeleteError('Soft delete failed')

      expect(error.message).toBe('Soft delete failed')
      expect(error.detail).toBeUndefined()
    })

    it('should serialize to JSON correctly', () => {
      const error = new SoftDeleteError('Soft delete failed', 'Invalid column')
      const json = error.toJSON()

      expect(json).toEqual({
        name: 'SoftDeleteError',
        message: 'Soft delete failed',
        code: ErrorCodes.SOFT_DELETE_ERROR,
        detail: 'Invalid column'
      })
    })

    it('should be catchable with instanceof', () => {
      const error = new SoftDeleteError('Test error')

      try {
        throw error
      } catch (e) {
        expect(e instanceof SoftDeleteError).toBe(true)
        expect(e instanceof DatabaseError).toBe(true)
        expect(e instanceof Error).toBe(true)
      }
    })
  })

  describe('RecordNotDeletedError', () => {
    it('should create error with numeric record id and table name', () => {
      const error = new RecordNotDeletedError(123, 'users')

      expect(error).toBeInstanceOf(RecordNotDeletedError)
      expect(error).toBeInstanceOf(SoftDeleteError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.name).toBe('RecordNotDeletedError')
      expect(error.message).toBe('Record 123 is not deleted in table users')
      expect(error.code).toBe(ErrorCodes.RECORD_NOT_DELETED)
      expect(error.recordId).toBe(123)
      expect(error.tableName).toBe('users')
    })

    it('should create error with string record id and no table name', () => {
      const error = new RecordNotDeletedError('abc-123')

      expect(error.message).toBe('Record abc-123 is not deleted')
      expect(error.recordId).toBe('abc-123')
      expect(error.tableName).toBeUndefined()
    })

    it('should serialize to JSON correctly', () => {
      const error = new RecordNotDeletedError(456, 'posts')
      const json = error.toJSON()

      expect(json).toEqual({
        name: 'RecordNotDeletedError',
        message: 'Record 456 is not deleted in table posts',
        code: ErrorCodes.RECORD_NOT_DELETED,
        detail: undefined,
        recordId: 456,
        tableName: 'posts'
      })
    })

    it('should be catchable with instanceof', () => {
      const error = new RecordNotDeletedError(1, 'users')

      try {
        throw error
      } catch (e) {
        expect(e instanceof RecordNotDeletedError).toBe(true)
        expect(e instanceof SoftDeleteError).toBe(true)
        expect(e instanceof DatabaseError).toBe(true)
      }
    })
  })

  describe('AuditError', () => {
    it('should create an audit error with message and detail', () => {
      const error = new AuditError('Audit operation failed', 'Table not initialized')

      expect(error).toBeInstanceOf(AuditError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.name).toBe('AuditError')
      expect(error.message).toBe('Audit operation failed')
      expect(error.code).toBe(ErrorCodes.AUDIT_ERROR)
      expect(error.detail).toBe('Table not initialized')
    })

    it('should create an audit error without detail', () => {
      const error = new AuditError('Audit operation failed')

      expect(error.message).toBe('Audit operation failed')
      expect(error.detail).toBeUndefined()
    })

    it('should serialize to JSON correctly', () => {
      const error = new AuditError('Audit failed', 'Connection lost')
      const json = error.toJSON()

      expect(json).toEqual({
        name: 'AuditError',
        message: 'Audit failed',
        code: ErrorCodes.AUDIT_ERROR,
        detail: 'Connection lost'
      })
    })

    it('should be catchable with instanceof', () => {
      const error = new AuditError('Test error')

      try {
        throw error
      } catch (e) {
        expect(e instanceof AuditError).toBe(true)
        expect(e instanceof DatabaseError).toBe(true)
      }
    })
  })

  describe('AuditRestoreError', () => {
    it('should create restore error with all parameters', () => {
      const error = new AuditRestoreError(123, 'INSERT', 'Cannot restore INSERT operations')

      expect(error).toBeInstanceOf(AuditRestoreError)
      expect(error).toBeInstanceOf(AuditError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.name).toBe('AuditRestoreError')
      expect(error.message).toBe('Cannot restore audit 123 (INSERT): Cannot restore INSERT operations')
      expect(error.code).toBe(ErrorCodes.AUDIT_RESTORE_ERROR)
      expect(error.auditId).toBe(123)
      expect(error.operation).toBe('INSERT')
      expect(error.reason).toBe('Cannot restore INSERT operations')
    })

    it('should handle UPDATE operation failure', () => {
      const error = new AuditRestoreError(456, 'UPDATE', 'Table no longer exists')

      expect(error.message).toBe('Cannot restore audit 456 (UPDATE): Table no longer exists')
      expect(error.operation).toBe('UPDATE')
    })

    it('should serialize to JSON correctly', () => {
      const error = new AuditRestoreError(789, 'DELETE', 'Missing primary key')
      const json = error.toJSON()

      expect(json).toEqual({
        name: 'AuditRestoreError',
        message: 'Cannot restore audit 789 (DELETE): Missing primary key',
        code: ErrorCodes.AUDIT_RESTORE_ERROR,
        detail: undefined,
        auditId: 789,
        operation: 'DELETE',
        reason: 'Missing primary key'
      })
    })

    it('should be catchable with instanceof', () => {
      const error = new AuditRestoreError(1, 'UPDATE', 'Test')

      try {
        throw error
      } catch (e) {
        expect(e instanceof AuditRestoreError).toBe(true)
        expect(e instanceof AuditError).toBe(true)
        expect(e instanceof DatabaseError).toBe(true)
      }
    })
  })

  describe('AuditMissingValuesError', () => {
    it('should create missing values error', () => {
      const error = new AuditMissingValuesError(123)

      expect(error).toBeInstanceOf(AuditMissingValuesError)
      expect(error).toBeInstanceOf(AuditError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.name).toBe('AuditMissingValuesError')
      expect(error.message).toBe('Audit log 123 is missing old_values required for restoration')
      expect(error.code).toBe(ErrorCodes.AUDIT_MISSING_VALUES)
      expect(error.auditId).toBe(123)
    })

    it('should handle different audit IDs', () => {
      const error1 = new AuditMissingValuesError(1)
      const error2 = new AuditMissingValuesError(999999)

      expect(error1.auditId).toBe(1)
      expect(error2.auditId).toBe(999999)
      expect(error1.message).toContain('Audit log 1')
      expect(error2.message).toContain('Audit log 999999')
    })

    it('should serialize to JSON correctly', () => {
      const error = new AuditMissingValuesError(456)
      const json = error.toJSON()

      expect(json).toEqual({
        name: 'AuditMissingValuesError',
        message: 'Audit log 456 is missing old_values required for restoration',
        code: ErrorCodes.AUDIT_MISSING_VALUES,
        detail: undefined,
        auditId: 456
      })
    })

    it('should be catchable with instanceof', () => {
      const error = new AuditMissingValuesError(1)

      try {
        throw error
      } catch (e) {
        expect(e instanceof AuditMissingValuesError).toBe(true)
        expect(e instanceof AuditError).toBe(true)
        expect(e instanceof DatabaseError).toBe(true)
      }
    })
  })

  describe('TimestampsError', () => {
    it('should create a timestamps error with message and detail', () => {
      const error = new TimestampsError('Timestamp operation failed', 'Invalid column type')

      expect(error).toBeInstanceOf(TimestampsError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.name).toBe('TimestampsError')
      expect(error.message).toBe('Timestamp operation failed')
      expect(error.code).toBe(ErrorCodes.TIMESTAMPS_ERROR)
      expect(error.detail).toBe('Invalid column type')
    })

    it('should create a timestamps error without detail', () => {
      const error = new TimestampsError('Timestamp operation failed')

      expect(error.message).toBe('Timestamp operation failed')
      expect(error.detail).toBeUndefined()
    })

    it('should serialize to JSON correctly', () => {
      const error = new TimestampsError('Failed to apply timestamps', 'Column type mismatch')
      const json = error.toJSON()

      expect(json).toEqual({
        name: 'TimestampsError',
        message: 'Failed to apply timestamps',
        code: ErrorCodes.TIMESTAMPS_ERROR,
        detail: 'Column type mismatch'
      })
    })

    it('should be catchable with instanceof', () => {
      const error = new TimestampsError('Test error')

      try {
        throw error
      } catch (e) {
        expect(e instanceof TimestampsError).toBe(true)
        expect(e instanceof DatabaseError).toBe(true)
      }
    })
  })

  describe('TimestampColumnMissingError', () => {
    it('should create column missing error', () => {
      const error = new TimestampColumnMissingError('users', 'created_at')

      expect(error).toBeInstanceOf(TimestampColumnMissingError)
      expect(error).toBeInstanceOf(TimestampsError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.name).toBe('TimestampColumnMissingError')
      expect(error.message).toBe('Table users is missing required timestamp column: created_at')
      expect(error.code).toBe(ErrorCodes.TIMESTAMP_COLUMN_MISSING)
      expect(error.tableName).toBe('users')
      expect(error.columnName).toBe('created_at')
    })

    it('should handle different table and column names', () => {
      const error1 = new TimestampColumnMissingError('posts', 'updated_at')
      const error2 = new TimestampColumnMissingError('products', 'modified_at')

      expect(error1.tableName).toBe('posts')
      expect(error1.columnName).toBe('updated_at')
      expect(error2.tableName).toBe('products')
      expect(error2.columnName).toBe('modified_at')
    })

    it('should serialize to JSON correctly', () => {
      const error = new TimestampColumnMissingError('orders', 'created_at')
      const json = error.toJSON()

      expect(json).toEqual({
        name: 'TimestampColumnMissingError',
        message: 'Table orders is missing required timestamp column: created_at',
        code: ErrorCodes.TIMESTAMP_COLUMN_MISSING,
        detail: undefined,
        tableName: 'orders',
        columnName: 'created_at'
      })
    })

    it('should be catchable with instanceof', () => {
      const error = new TimestampColumnMissingError('users', 'updated_at')

      try {
        throw error
      } catch (e) {
        expect(e instanceof TimestampColumnMissingError).toBe(true)
        expect(e instanceof TimestampsError).toBe(true)
        expect(e instanceof DatabaseError).toBe(true)
      }
    })
  })

  describe('Error Inheritance and Type Guards', () => {
    it('should correctly identify error types in a hierarchy', () => {
      const errors = [
        new SoftDeleteError('test'),
        new RecordNotDeletedError(1, 'users'),
        new AuditError('test'),
        new AuditRestoreError(1, 'UPDATE', 'test'),
        new AuditMissingValuesError(1),
        new TimestampsError('test'),
        new TimestampColumnMissingError('users', 'created_at')
      ]

      // All should be DatabaseError
      errors.forEach(error => {
        expect(error instanceof DatabaseError).toBe(true)
        expect(error instanceof Error).toBe(true)
      })

      // Check specific hierarchies
      expect(errors[0] instanceof SoftDeleteError).toBe(true)
      expect(errors[1] instanceof SoftDeleteError).toBe(true)
      expect(errors[1] instanceof RecordNotDeletedError).toBe(true)

      expect(errors[2] instanceof AuditError).toBe(true)
      expect(errors[3] instanceof AuditError).toBe(true)
      expect(errors[3] instanceof AuditRestoreError).toBe(true)
      expect(errors[4] instanceof AuditError).toBe(true)
      expect(errors[4] instanceof AuditMissingValuesError).toBe(true)

      expect(errors[5] instanceof TimestampsError).toBe(true)
      expect(errors[6] instanceof TimestampsError).toBe(true)
      expect(errors[6] instanceof TimestampColumnMissingError).toBe(true)
    })

    it('should allow catching by base class', () => {
      const testError = (error: Error) => {
        try {
          throw error
        } catch (e) {
          if (e instanceof SoftDeleteError) {
            return 'soft-delete'
          } else if (e instanceof AuditError) {
            return 'audit'
          } else if (e instanceof TimestampsError) {
            return 'timestamps'
          } else if (e instanceof DatabaseError) {
            return 'database'
          }
          return 'unknown'
        }
      }

      expect(testError(new SoftDeleteError('test'))).toBe('soft-delete')
      expect(testError(new RecordNotDeletedError(1))).toBe('soft-delete')
      expect(testError(new AuditError('test'))).toBe('audit')
      expect(testError(new AuditRestoreError(1, 'UPDATE', 'test'))).toBe('audit')
      expect(testError(new AuditMissingValuesError(1))).toBe('audit')
      expect(testError(new TimestampsError('test'))).toBe('timestamps')
      expect(testError(new TimestampColumnMissingError('t', 'c'))).toBe('timestamps')
    })
  })

  describe('Error Code Assignment', () => {
    it('should have correct error codes assigned', () => {
      expect(new SoftDeleteError('test').code).toBe(ErrorCodes.SOFT_DELETE_ERROR)
      expect(new RecordNotDeletedError(1).code).toBe(ErrorCodes.RECORD_NOT_DELETED)
      expect(new AuditError('test').code).toBe(ErrorCodes.AUDIT_ERROR)
      expect(new AuditRestoreError(1, 'UPDATE', 'test').code).toBe(ErrorCodes.AUDIT_RESTORE_ERROR)
      expect(new AuditMissingValuesError(1).code).toBe(ErrorCodes.AUDIT_MISSING_VALUES)
      expect(new TimestampsError('test').code).toBe(ErrorCodes.TIMESTAMPS_ERROR)
      expect(new TimestampColumnMissingError('t', 'c').code).toBe(ErrorCodes.TIMESTAMP_COLUMN_MISSING)
    })

    it('should have unique error codes', () => {
      const codes = [
        ErrorCodes.SOFT_DELETE_ERROR,
        ErrorCodes.RECORD_NOT_DELETED,
        ErrorCodes.AUDIT_ERROR,
        ErrorCodes.AUDIT_RESTORE_ERROR,
        ErrorCodes.AUDIT_MISSING_VALUES,
        ErrorCodes.TIMESTAMPS_ERROR,
        ErrorCodes.TIMESTAMP_COLUMN_MISSING
      ]

      const uniqueCodes = new Set(codes)
      expect(uniqueCodes.size).toBe(codes.length)
    })
  })

  describe('Error Message Formatting', () => {
    it('should format soft delete error messages correctly', () => {
      const error1 = new RecordNotDeletedError(123, 'users')
      const error2 = new RecordNotDeletedError('abc-123')

      expect(error1.message).toContain('123')
      expect(error1.message).toContain('users')
      expect(error2.message).toContain('abc-123')
      expect(error2.message).not.toContain('in table')
    })

    it('should format audit error messages correctly', () => {
      const error = new AuditRestoreError(123, 'UPDATE', 'Table no longer exists')

      expect(error.message).toContain('123')
      expect(error.message).toContain('UPDATE')
      expect(error.message).toContain('Table no longer exists')
    })

    it('should format timestamp error messages correctly', () => {
      const error = new TimestampColumnMissingError('users', 'created_at')

      expect(error.message).toContain('users')
      expect(error.message).toContain('created_at')
      expect(error.message).toContain('missing')
    })
  })

  describe('Error Name Property', () => {
    it('should have correct name property for each error class', () => {
      expect(new SoftDeleteError('test').name).toBe('SoftDeleteError')
      expect(new RecordNotDeletedError(1).name).toBe('RecordNotDeletedError')
      expect(new AuditError('test').name).toBe('AuditError')
      expect(new AuditRestoreError(1, 'UPDATE', 'test').name).toBe('AuditRestoreError')
      expect(new AuditMissingValuesError(1).name).toBe('AuditMissingValuesError')
      expect(new TimestampsError('test').name).toBe('TimestampsError')
      expect(new TimestampColumnMissingError('t', 'c').name).toBe('TimestampColumnMissingError')
    })
  })
})
