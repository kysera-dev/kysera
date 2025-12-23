/**
 * L-10 Implementation Verification Test
 *
 * Verifies that all plugin-specific error classes are properly implemented:
 * 1. Error codes exist in ErrorCodes enum
 * 2. Error classes extend the correct base classes
 * 3. Error classes have proper properties
 * 4. All errors are exported from @kysera/core
 */

import { describe, it, expect } from 'vitest'
import {
  ErrorCodes,
  DatabaseError,
  SoftDeleteError,
  RecordNotDeletedError,
  AuditError,
  AuditRestoreError,
  AuditMissingValuesError,
  TimestampsError,
  TimestampColumnMissingError
} from '../src/index.js'

describe('L-10: Plugin-Specific Error Classes Verification', () => {
  describe('Error Codes Registration', () => {
    it('should have all required error codes in ErrorCodes enum', () => {
      // Verify all required error codes exist
      expect(ErrorCodes.SOFT_DELETE_ERROR).toBe('SOFT_DELETE_ERROR')
      expect(ErrorCodes.RECORD_NOT_DELETED).toBe('RECORD_NOT_DELETED')
      expect(ErrorCodes.AUDIT_ERROR).toBe('AUDIT_ERROR')
      expect(ErrorCodes.AUDIT_RESTORE_ERROR).toBe('AUDIT_RESTORE_ERROR')
      expect(ErrorCodes.AUDIT_MISSING_VALUES).toBe('AUDIT_MISSING_VALUES')
      expect(ErrorCodes.TIMESTAMPS_ERROR).toBe('TIMESTAMPS_ERROR')
      expect(ErrorCodes.TIMESTAMP_COLUMN_MISSING).toBe('TIMESTAMP_COLUMN_MISSING')
    })
  })

  describe('Soft Delete Error Classes', () => {
    it('SoftDeleteError extends DatabaseError', () => {
      const error = new SoftDeleteError('test')
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.code).toBe(ErrorCodes.SOFT_DELETE_ERROR)
      expect(error.name).toBe('SoftDeleteError')
    })

    it('RecordNotDeletedError extends SoftDeleteError and has required properties', () => {
      const error = new RecordNotDeletedError(123, 'users')
      expect(error).toBeInstanceOf(SoftDeleteError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.code).toBe(ErrorCodes.RECORD_NOT_DELETED)
      expect(error.name).toBe('RecordNotDeletedError')
      expect(error.recordId).toBe(123)
      expect(error.tableName).toBe('users')
    })

    it('RecordNotDeletedError supports string recordId', () => {
      const error = new RecordNotDeletedError('uuid-123', 'posts')
      expect(error.recordId).toBe('uuid-123')
      expect(error.tableName).toBe('posts')
    })
  })

  describe('Audit Error Classes', () => {
    it('AuditError extends DatabaseError', () => {
      const error = new AuditError('test')
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.code).toBe(ErrorCodes.AUDIT_ERROR)
      expect(error.name).toBe('AuditError')
    })

    it('AuditRestoreError extends AuditError and has required properties', () => {
      const error = new AuditRestoreError(456, 'UPDATE', 'reason')
      expect(error).toBeInstanceOf(AuditError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.code).toBe(ErrorCodes.AUDIT_RESTORE_ERROR)
      expect(error.name).toBe('AuditRestoreError')
      expect(error.auditId).toBe(456)
      expect(error.operation).toBe('UPDATE')
      expect(error.reason).toBe('reason')
    })

    it('AuditMissingValuesError extends AuditError and has required properties', () => {
      const error = new AuditMissingValuesError(789)
      expect(error).toBeInstanceOf(AuditError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.code).toBe(ErrorCodes.AUDIT_MISSING_VALUES)
      expect(error.name).toBe('AuditMissingValuesError')
      expect(error.auditId).toBe(789)
    })
  })

  describe('Timestamps Error Classes', () => {
    it('TimestampsError extends DatabaseError', () => {
      const error = new TimestampsError('test')
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.code).toBe(ErrorCodes.TIMESTAMPS_ERROR)
      expect(error.name).toBe('TimestampsError')
    })

    it('TimestampColumnMissingError extends TimestampsError and has required properties', () => {
      const error = new TimestampColumnMissingError('users', 'created_at')
      expect(error).toBeInstanceOf(TimestampsError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.code).toBe(ErrorCodes.TIMESTAMP_COLUMN_MISSING)
      expect(error.name).toBe('TimestampColumnMissingError')
      expect(error.tableName).toBe('users')
      expect(error.columnName).toBe('created_at')
    })
  })

  describe('Error Serialization', () => {
    it('all error classes should serialize to JSON correctly', () => {
      const errors = [
        new SoftDeleteError('test', 'detail'),
        new RecordNotDeletedError(1, 'users'),
        new AuditError('test', 'detail'),
        new AuditRestoreError(1, 'UPDATE', 'reason'),
        new AuditMissingValuesError(1),
        new TimestampsError('test', 'detail'),
        new TimestampColumnMissingError('users', 'created_at')
      ]

      errors.forEach(error => {
        const json = error.toJSON()
        expect(json).toHaveProperty('name')
        expect(json).toHaveProperty('message')
        expect(json).toHaveProperty('code')
        expect(json['name']).toBe(error.name)
        expect(json['message']).toBe(error.message)
        expect(json['code']).toBe(error.code)
      })
    })
  })

  describe('Error Instanceof Checks', () => {
    it('should support instanceof checks for all error classes', () => {
      const softDeleteError = new SoftDeleteError('test')
      const recordNotDeletedError = new RecordNotDeletedError(1)
      const auditError = new AuditError('test')
      const auditRestoreError = new AuditRestoreError(1, 'UPDATE', 'reason')
      const auditMissingValuesError = new AuditMissingValuesError(1)
      const timestampsError = new TimestampsError('test')
      const timestampColumnMissingError = new TimestampColumnMissingError('users', 'created_at')

      // Soft Delete
      expect(softDeleteError instanceof SoftDeleteError).toBe(true)
      expect(softDeleteError instanceof DatabaseError).toBe(true)
      expect(recordNotDeletedError instanceof RecordNotDeletedError).toBe(true)
      expect(recordNotDeletedError instanceof SoftDeleteError).toBe(true)

      // Audit
      expect(auditError instanceof AuditError).toBe(true)
      expect(auditError instanceof DatabaseError).toBe(true)
      expect(auditRestoreError instanceof AuditRestoreError).toBe(true)
      expect(auditRestoreError instanceof AuditError).toBe(true)
      expect(auditMissingValuesError instanceof AuditMissingValuesError).toBe(true)
      expect(auditMissingValuesError instanceof AuditError).toBe(true)

      // Timestamps
      expect(timestampsError instanceof TimestampsError).toBe(true)
      expect(timestampsError instanceof DatabaseError).toBe(true)
      expect(timestampColumnMissingError instanceof TimestampColumnMissingError).toBe(true)
      expect(timestampColumnMissingError instanceof TimestampsError).toBe(true)
    })
  })

  describe('Type Safety', () => {
    it('should have correct TypeScript types', () => {
      // This test verifies compile-time type safety
      const handleSoftDeleteError = (error: SoftDeleteError) => {
        expect(error.code).toBeTruthy()
        expect(error.message).toBeTruthy()
      }

      const handleRecordNotDeletedError = (error: RecordNotDeletedError) => {
        expect(error.recordId).toBeDefined()
        expect(typeof error.recordId === 'string' || typeof error.recordId === 'number').toBe(true)
      }

      const handleAuditRestoreError = (error: AuditRestoreError) => {
        expect(error.auditId).toBeDefined()
        expect(error.operation).toBeDefined()
        expect(error.reason).toBeDefined()
      }

      const handleTimestampColumnMissingError = (error: TimestampColumnMissingError) => {
        expect(error.tableName).toBeDefined()
        expect(error.columnName).toBeDefined()
      }

      // Execute type checks
      handleSoftDeleteError(new SoftDeleteError('test'))
      handleRecordNotDeletedError(new RecordNotDeletedError(1))
      handleAuditRestoreError(new AuditRestoreError(1, 'UPDATE', 'reason'))
      handleTimestampColumnMissingError(new TimestampColumnMissingError('users', 'created_at'))
    })
  })

  describe('Practical Usage Scenarios', () => {
    it('should support catching specific error types', () => {
      const throwSoftDeleteError = () => {
        throw new RecordNotDeletedError(123, 'users')
      }

      try {
        throwSoftDeleteError()
      } catch (error) {
        if (error instanceof RecordNotDeletedError) {
          expect(error.recordId).toBe(123)
          expect(error.tableName).toBe('users')
        } else {
          throw new Error('Expected RecordNotDeletedError')
        }
      }
    })

    it('should support catching base error types', () => {
      const throwError = () => {
        throw new RecordNotDeletedError(123, 'users')
      }

      try {
        throwError()
      } catch (error) {
        if (error instanceof SoftDeleteError) {
          expect(error.code).toBe(ErrorCodes.RECORD_NOT_DELETED)
        } else {
          throw new Error('Expected SoftDeleteError')
        }
      }
    })

    it('should support error code based handling', () => {
      const errors = [
        new SoftDeleteError('test'),
        new RecordNotDeletedError(1),
        new AuditError('test'),
        new AuditRestoreError(1, 'UPDATE', 'reason'),
        new AuditMissingValuesError(1),
        new TimestampsError('test'),
        new TimestampColumnMissingError('users', 'created_at')
      ]

      errors.forEach(error => {
        switch (error.code) {
          case ErrorCodes.SOFT_DELETE_ERROR:
          case ErrorCodes.RECORD_NOT_DELETED:
          case ErrorCodes.AUDIT_ERROR:
          case ErrorCodes.AUDIT_RESTORE_ERROR:
          case ErrorCodes.AUDIT_MISSING_VALUES:
          case ErrorCodes.TIMESTAMPS_ERROR:
          case ErrorCodes.TIMESTAMP_COLUMN_MISSING:
            expect(error.code).toBeTruthy()
            break
          default:
            throw new Error(`Unexpected error code: ${error.code}`)
        }
      })
    })
  })
})
