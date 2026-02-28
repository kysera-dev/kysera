/**
 * M-11: Tests for getEnv utility and comprehensive error code coverage
 *
 * Covers:
 * - getEnv with valid/invalid/missing environment variables
 * - All error codes in the error hierarchy
 * - Edge cases for error parsing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getEnv } from '../src/helpers.js'
import {
  ErrorCodes,
  DatabaseErrorCodes,
  ValidationErrorCodes,
  ResourceErrorCodes,
  MigrationErrorCodes,
  PluginErrorCodes,
  AuditErrorCodes,
  ConfigErrorCodes,
  FileSystemErrorCodes,
  NetworkErrorCodes,
  isValidErrorCode,
  getErrorCategory,
  mapLegacyCode,
  LegacyCodeMapping
} from '../src/error-codes.js'
import {
  DatabaseError,
  UniqueConstraintError,
  ForeignKeyError,
  NotFoundError,
  BadRequestError,
  NotNullError,
  CheckConstraintError,
  SoftDeleteError,
  RecordNotDeletedError,
  AuditError,
  AuditRestoreError,
  AuditMissingValuesError,
  TimestampsError,
  TimestampColumnMissingError,
  parseDatabaseError
} from '../src/errors.js'

// ============================================================================
// getEnv tests
// ============================================================================

describe('getEnv utility', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should return value for an existing environment variable', () => {
    process.env['KYSERA_TEST_VAR'] = 'test_value'
    const result = getEnv('KYSERA_TEST_VAR')
    expect(result).toBe('test_value')
  })

  it('should return undefined for a missing environment variable', () => {
    delete process.env['KYSERA_NONEXISTENT_VAR']
    const result = getEnv('KYSERA_NONEXISTENT_VAR')
    expect(result).toBeUndefined()
  })

  it('should return empty string for an empty environment variable', () => {
    process.env['KYSERA_EMPTY_VAR'] = ''
    const result = getEnv('KYSERA_EMPTY_VAR')
    expect(result).toBe('')
  })

  it('should handle environment variables with special characters', () => {
    process.env['KYSERA_SPECIAL_VAR'] = 'value with spaces & special=chars!'
    const result = getEnv('KYSERA_SPECIAL_VAR')
    expect(result).toBe('value with spaces & special=chars!')
  })

  it('should handle NODE_ENV variable', () => {
    const nodeEnv = getEnv('NODE_ENV')
    // NODE_ENV is typically set in test environments
    expect(typeof nodeEnv === 'string' || nodeEnv === undefined).toBe(true)
  })

  it('should handle PATH-like variables with colons', () => {
    process.env['KYSERA_PATH_VAR'] = '/usr/local/bin:/usr/bin:/bin'
    const result = getEnv('KYSERA_PATH_VAR')
    expect(result).toBe('/usr/local/bin:/usr/bin:/bin')
  })

  it('should handle numeric string values', () => {
    process.env['KYSERA_PORT'] = '5432'
    const result = getEnv('KYSERA_PORT')
    expect(result).toBe('5432')
  })

  it('should handle variable names with underscores', () => {
    process.env['KYSERA__DOUBLE__UNDERSCORE'] = 'value'
    const result = getEnv('KYSERA__DOUBLE__UNDERSCORE')
    expect(result).toBe('value')
  })

  it('should return undefined when globalThis.process.env does not contain the key', () => {
    // Key that definitely does not exist
    const result = getEnv('THIS_VARIABLE_SHOULD_NOT_EXIST_EVER_12345')
    expect(result).toBeUndefined()
  })
})

// ============================================================================
// Comprehensive error code coverage
// ============================================================================

describe('Error Code Categories - Complete Coverage', () => {
  describe('DatabaseErrorCodes', () => {
    it('should have all expected database error codes', () => {
      expect(DatabaseErrorCodes.DB_CONNECTION_FAILED).toBe('DB_CONNECTION_FAILED')
      expect(DatabaseErrorCodes.DB_QUERY_FAILED).toBe('DB_QUERY_FAILED')
      expect(DatabaseErrorCodes.DB_TRANSACTION_FAILED).toBe('DB_TRANSACTION_FAILED')
      expect(DatabaseErrorCodes.DB_TIMEOUT).toBe('DB_TIMEOUT')
      expect(DatabaseErrorCodes.DB_POOL_EXHAUSTED).toBe('DB_POOL_EXHAUSTED')
      expect(DatabaseErrorCodes.DB_UNKNOWN).toBe('DB_UNKNOWN')
    })

    it('should have exactly 6 database error codes', () => {
      expect(Object.keys(DatabaseErrorCodes)).toHaveLength(6)
    })
  })

  describe('ValidationErrorCodes', () => {
    it('should have all expected validation error codes', () => {
      expect(ValidationErrorCodes.VALIDATION_UNIQUE_VIOLATION).toBe('VALIDATION_UNIQUE_VIOLATION')
      expect(ValidationErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION).toBe(
        'VALIDATION_FOREIGN_KEY_VIOLATION'
      )
      expect(ValidationErrorCodes.VALIDATION_NOT_NULL_VIOLATION).toBe(
        'VALIDATION_NOT_NULL_VIOLATION'
      )
      expect(ValidationErrorCodes.VALIDATION_CHECK_VIOLATION).toBe('VALIDATION_CHECK_VIOLATION')
      expect(ValidationErrorCodes.VALIDATION_INVALID_INPUT).toBe('VALIDATION_INVALID_INPUT')
      expect(ValidationErrorCodes.VALIDATION_REQUIRED_FIELD).toBe('VALIDATION_REQUIRED_FIELD')
      expect(ValidationErrorCodes.VALIDATION_INVALID_TYPE).toBe('VALIDATION_INVALID_TYPE')
    })

    it('should have exactly 7 validation error codes', () => {
      expect(Object.keys(ValidationErrorCodes)).toHaveLength(7)
    })
  })

  describe('ResourceErrorCodes', () => {
    it('should have all expected resource error codes', () => {
      expect(ResourceErrorCodes.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND')
      expect(ResourceErrorCodes.RESOURCE_ALREADY_EXISTS).toBe('RESOURCE_ALREADY_EXISTS')
      expect(ResourceErrorCodes.RESOURCE_CONFLICT).toBe('RESOURCE_CONFLICT')
      expect(ResourceErrorCodes.RESOURCE_BAD_REQUEST).toBe('RESOURCE_BAD_REQUEST')
    })

    it('should have exactly 4 resource error codes', () => {
      expect(Object.keys(ResourceErrorCodes)).toHaveLength(4)
    })
  })

  describe('MigrationErrorCodes', () => {
    it('should have all expected migration error codes', () => {
      expect(MigrationErrorCodes.MIGRATION_UP_FAILED).toBe('MIGRATION_UP_FAILED')
      expect(MigrationErrorCodes.MIGRATION_DOWN_FAILED).toBe('MIGRATION_DOWN_FAILED')
      expect(MigrationErrorCodes.MIGRATION_VALIDATION_FAILED).toBe('MIGRATION_VALIDATION_FAILED')
      expect(MigrationErrorCodes.MIGRATION_NOT_FOUND).toBe('MIGRATION_NOT_FOUND')
      expect(MigrationErrorCodes.MIGRATION_DUPLICATE_NAME).toBe('MIGRATION_DUPLICATE_NAME')
      expect(MigrationErrorCodes.MIGRATION_LOCK_FAILED).toBe('MIGRATION_LOCK_FAILED')
      expect(MigrationErrorCodes.MIGRATION_ALREADY_EXECUTED).toBe('MIGRATION_ALREADY_EXECUTED')
    })

    it('should have exactly 7 migration error codes', () => {
      expect(Object.keys(MigrationErrorCodes)).toHaveLength(7)
    })
  })

  describe('PluginErrorCodes', () => {
    it('should have all expected plugin error codes', () => {
      expect(PluginErrorCodes.PLUGIN_VALIDATION_FAILED).toBe('PLUGIN_VALIDATION_FAILED')
      expect(PluginErrorCodes.PLUGIN_INIT_FAILED).toBe('PLUGIN_INIT_FAILED')
      expect(PluginErrorCodes.PLUGIN_CONFLICT).toBe('PLUGIN_CONFLICT')
      expect(PluginErrorCodes.PLUGIN_DEPENDENCY_MISSING).toBe('PLUGIN_DEPENDENCY_MISSING')
      expect(PluginErrorCodes.PLUGIN_DUPLICATE).toBe('PLUGIN_DUPLICATE')
      expect(PluginErrorCodes.PLUGIN_NOT_FOUND).toBe('PLUGIN_NOT_FOUND')
      expect(PluginErrorCodes.SOFT_DELETE_ERROR).toBe('SOFT_DELETE_ERROR')
      expect(PluginErrorCodes.RECORD_NOT_DELETED).toBe('RECORD_NOT_DELETED')
      expect(PluginErrorCodes.TIMESTAMPS_ERROR).toBe('TIMESTAMPS_ERROR')
      expect(PluginErrorCodes.TIMESTAMP_COLUMN_MISSING).toBe('TIMESTAMP_COLUMN_MISSING')
    })

    it('should have exactly 10 plugin error codes', () => {
      expect(Object.keys(PluginErrorCodes)).toHaveLength(10)
    })
  })

  describe('AuditErrorCodes', () => {
    it('should have all expected audit error codes', () => {
      expect(AuditErrorCodes.AUDIT_LOG_NOT_FOUND).toBe('AUDIT_LOG_NOT_FOUND')
      expect(AuditErrorCodes.AUDIT_RESTORE_NOT_SUPPORTED).toBe('AUDIT_RESTORE_NOT_SUPPORTED')
      expect(AuditErrorCodes.AUDIT_OLD_VALUES_MISSING).toBe('AUDIT_OLD_VALUES_MISSING')
      expect(AuditErrorCodes.AUDIT_TABLE_CREATION_FAILED).toBe('AUDIT_TABLE_CREATION_FAILED')
      expect(AuditErrorCodes.AUDIT_ERROR).toBe('AUDIT_ERROR')
      expect(AuditErrorCodes.AUDIT_RESTORE_ERROR).toBe('AUDIT_RESTORE_ERROR')
      expect(AuditErrorCodes.AUDIT_MISSING_VALUES).toBe('AUDIT_MISSING_VALUES')
    })

    it('should have exactly 7 audit error codes', () => {
      expect(Object.keys(AuditErrorCodes)).toHaveLength(7)
    })
  })

  describe('ConfigErrorCodes', () => {
    it('should have all expected config error codes', () => {
      expect(ConfigErrorCodes.CONFIG_NOT_FOUND).toBe('CONFIG_NOT_FOUND')
      expect(ConfigErrorCodes.CONFIG_VALIDATION_FAILED).toBe('CONFIG_VALIDATION_FAILED')
      expect(ConfigErrorCodes.CONFIG_PARSE_ERROR).toBe('CONFIG_PARSE_ERROR')
      expect(ConfigErrorCodes.CONFIG_REQUIRED_MISSING).toBe('CONFIG_REQUIRED_MISSING')
      expect(ConfigErrorCodes.CONFIG_INVALID_VALUE).toBe('CONFIG_INVALID_VALUE')
    })

    it('should have exactly 5 config error codes', () => {
      expect(Object.keys(ConfigErrorCodes)).toHaveLength(5)
    })
  })

  describe('FileSystemErrorCodes', () => {
    it('should have all expected file system error codes', () => {
      expect(FileSystemErrorCodes.FS_FILE_NOT_FOUND).toBe('FS_FILE_NOT_FOUND')
      expect(FileSystemErrorCodes.FS_PERMISSION_DENIED).toBe('FS_PERMISSION_DENIED')
      expect(FileSystemErrorCodes.FS_DIRECTORY_NOT_FOUND).toBe('FS_DIRECTORY_NOT_FOUND')
      expect(FileSystemErrorCodes.FS_FILE_EXISTS).toBe('FS_FILE_EXISTS')
      expect(FileSystemErrorCodes.FS_WRITE_FAILED).toBe('FS_WRITE_FAILED')
      expect(FileSystemErrorCodes.FS_READ_FAILED).toBe('FS_READ_FAILED')
    })

    it('should have exactly 6 file system error codes', () => {
      expect(Object.keys(FileSystemErrorCodes)).toHaveLength(6)
    })
  })

  describe('NetworkErrorCodes', () => {
    it('should have all expected network error codes', () => {
      expect(NetworkErrorCodes.NETWORK_CONNECTION_REFUSED).toBe('NETWORK_CONNECTION_REFUSED')
      expect(NetworkErrorCodes.NETWORK_TIMEOUT).toBe('NETWORK_TIMEOUT')
      expect(NetworkErrorCodes.NETWORK_DNS_FAILED).toBe('NETWORK_DNS_FAILED')
      expect(NetworkErrorCodes.NETWORK_SSL_ERROR).toBe('NETWORK_SSL_ERROR')
    })

    it('should have exactly 4 network error codes', () => {
      expect(Object.keys(NetworkErrorCodes)).toHaveLength(4)
    })
  })

  describe('Combined ErrorCodes', () => {
    it('should contain all individual category codes', () => {
      // Verify each category is merged into ErrorCodes
      for (const [key, value] of Object.entries(DatabaseErrorCodes)) {
        expect(ErrorCodes[key as keyof typeof ErrorCodes]).toBe(value)
      }
      for (const [key, value] of Object.entries(ValidationErrorCodes)) {
        expect(ErrorCodes[key as keyof typeof ErrorCodes]).toBe(value)
      }
      for (const [key, value] of Object.entries(ResourceErrorCodes)) {
        expect(ErrorCodes[key as keyof typeof ErrorCodes]).toBe(value)
      }
      for (const [key, value] of Object.entries(MigrationErrorCodes)) {
        expect(ErrorCodes[key as keyof typeof ErrorCodes]).toBe(value)
      }
      for (const [key, value] of Object.entries(PluginErrorCodes)) {
        expect(ErrorCodes[key as keyof typeof ErrorCodes]).toBe(value)
      }
      for (const [key, value] of Object.entries(AuditErrorCodes)) {
        expect(ErrorCodes[key as keyof typeof ErrorCodes]).toBe(value)
      }
      for (const [key, value] of Object.entries(ConfigErrorCodes)) {
        expect(ErrorCodes[key as keyof typeof ErrorCodes]).toBe(value)
      }
      for (const [key, value] of Object.entries(FileSystemErrorCodes)) {
        expect(ErrorCodes[key as keyof typeof ErrorCodes]).toBe(value)
      }
      for (const [key, value] of Object.entries(NetworkErrorCodes)) {
        expect(ErrorCodes[key as keyof typeof ErrorCodes]).toBe(value)
      }
    })

    it('should have no duplicate error code values across categories', () => {
      const allValues = Object.values(ErrorCodes)
      const uniqueValues = new Set(allValues)
      expect(uniqueValues.size).toBe(allValues.length)
    })

    it('should have the correct total number of error codes', () => {
      const expectedTotal =
        Object.keys(DatabaseErrorCodes).length +
        Object.keys(ValidationErrorCodes).length +
        Object.keys(ResourceErrorCodes).length +
        Object.keys(MigrationErrorCodes).length +
        Object.keys(PluginErrorCodes).length +
        Object.keys(AuditErrorCodes).length +
        Object.keys(ConfigErrorCodes).length +
        Object.keys(FileSystemErrorCodes).length +
        Object.keys(NetworkErrorCodes).length
      expect(Object.keys(ErrorCodes).length).toBe(expectedTotal)
    })
  })
})

// ============================================================================
// isValidErrorCode - additional coverage
// ============================================================================

describe('isValidErrorCode - additional coverage', () => {
  it('should validate all plugin error codes', () => {
    expect(isValidErrorCode('PLUGIN_VALIDATION_FAILED')).toBe(true)
    expect(isValidErrorCode('PLUGIN_INIT_FAILED')).toBe(true)
    expect(isValidErrorCode('PLUGIN_CONFLICT')).toBe(true)
    expect(isValidErrorCode('PLUGIN_DEPENDENCY_MISSING')).toBe(true)
    expect(isValidErrorCode('PLUGIN_DUPLICATE')).toBe(true)
    expect(isValidErrorCode('PLUGIN_NOT_FOUND')).toBe(true)
    expect(isValidErrorCode('SOFT_DELETE_ERROR')).toBe(true)
    expect(isValidErrorCode('RECORD_NOT_DELETED')).toBe(true)
    expect(isValidErrorCode('TIMESTAMPS_ERROR')).toBe(true)
    expect(isValidErrorCode('TIMESTAMP_COLUMN_MISSING')).toBe(true)
  })

  it('should validate all audit error codes', () => {
    expect(isValidErrorCode('AUDIT_LOG_NOT_FOUND')).toBe(true)
    expect(isValidErrorCode('AUDIT_RESTORE_NOT_SUPPORTED')).toBe(true)
    expect(isValidErrorCode('AUDIT_OLD_VALUES_MISSING')).toBe(true)
    expect(isValidErrorCode('AUDIT_TABLE_CREATION_FAILED')).toBe(true)
    expect(isValidErrorCode('AUDIT_ERROR')).toBe(true)
    expect(isValidErrorCode('AUDIT_RESTORE_ERROR')).toBe(true)
    expect(isValidErrorCode('AUDIT_MISSING_VALUES')).toBe(true)
  })

  it('should validate all config error codes', () => {
    expect(isValidErrorCode('CONFIG_NOT_FOUND')).toBe(true)
    expect(isValidErrorCode('CONFIG_VALIDATION_FAILED')).toBe(true)
    expect(isValidErrorCode('CONFIG_PARSE_ERROR')).toBe(true)
    expect(isValidErrorCode('CONFIG_REQUIRED_MISSING')).toBe(true)
    expect(isValidErrorCode('CONFIG_INVALID_VALUE')).toBe(true)
  })

  it('should validate all file system error codes', () => {
    expect(isValidErrorCode('FS_FILE_NOT_FOUND')).toBe(true)
    expect(isValidErrorCode('FS_PERMISSION_DENIED')).toBe(true)
    expect(isValidErrorCode('FS_DIRECTORY_NOT_FOUND')).toBe(true)
    expect(isValidErrorCode('FS_FILE_EXISTS')).toBe(true)
    expect(isValidErrorCode('FS_WRITE_FAILED')).toBe(true)
    expect(isValidErrorCode('FS_READ_FAILED')).toBe(true)
  })

  it('should validate all network error codes', () => {
    expect(isValidErrorCode('NETWORK_CONNECTION_REFUSED')).toBe(true)
    expect(isValidErrorCode('NETWORK_TIMEOUT')).toBe(true)
    expect(isValidErrorCode('NETWORK_DNS_FAILED')).toBe(true)
    expect(isValidErrorCode('NETWORK_SSL_ERROR')).toBe(true)
  })

  it('should reject codes that are close but not exact matches', () => {
    expect(isValidErrorCode('DB_CONNECTION_FAILED ')).toBe(false) // trailing space
    expect(isValidErrorCode(' DB_CONNECTION_FAILED')).toBe(false) // leading space
    expect(isValidErrorCode('db_connection_failed')).toBe(false) // lowercase
    expect(isValidErrorCode('DB-CONNECTION-FAILED')).toBe(false) // dashes instead of underscores
  })
})

// ============================================================================
// getErrorCategory - additional coverage
// ============================================================================

describe('getErrorCategory - additional coverage', () => {
  it('should extract PLUGIN category', () => {
    expect(getErrorCategory('PLUGIN_VALIDATION_FAILED')).toBe('PLUGIN')
    expect(getErrorCategory('PLUGIN_INIT_FAILED')).toBe('PLUGIN')
  })

  it('should extract AUDIT category', () => {
    expect(getErrorCategory('AUDIT_LOG_NOT_FOUND')).toBe('AUDIT')
    expect(getErrorCategory('AUDIT_ERROR')).toBe('AUDIT')
  })

  it('should extract CONFIG category', () => {
    expect(getErrorCategory('CONFIG_NOT_FOUND')).toBe('CONFIG')
    expect(getErrorCategory('CONFIG_PARSE_ERROR')).toBe('CONFIG')
  })

  it('should extract FS category', () => {
    expect(getErrorCategory('FS_FILE_NOT_FOUND')).toBe('FS')
    expect(getErrorCategory('FS_WRITE_FAILED')).toBe('FS')
  })

  it('should extract NETWORK category', () => {
    expect(getErrorCategory('NETWORK_CONNECTION_REFUSED')).toBe('NETWORK')
    expect(getErrorCategory('NETWORK_TIMEOUT')).toBe('NETWORK')
  })

  it('should extract SOFT category from SOFT_DELETE_ERROR', () => {
    expect(getErrorCategory('SOFT_DELETE_ERROR')).toBe('SOFT')
  })

  it('should extract RECORD category from RECORD_NOT_DELETED', () => {
    expect(getErrorCategory('RECORD_NOT_DELETED')).toBe('RECORD')
  })

  it('should extract TIMESTAMP category from TIMESTAMP_COLUMN_MISSING', () => {
    expect(getErrorCategory('TIMESTAMP_COLUMN_MISSING')).toBe('TIMESTAMP')
  })

  it('should extract TIMESTAMPS category from TIMESTAMPS_ERROR', () => {
    expect(getErrorCategory('TIMESTAMPS_ERROR')).toBe('TIMESTAMPS')
  })

  it('should handle single word without underscore', () => {
    expect(getErrorCategory('UNKNOWN')).toBe('UNKNOWN')
  })

  it('should handle numbers at start', () => {
    // The regex expects uppercase letters at start, so digits fail
    expect(getErrorCategory('23505')).toBe('UNKNOWN')
  })
})

// ============================================================================
// Error hierarchy with correct error codes
// ============================================================================

describe('Error hierarchy - error code mapping to error classes', () => {
  it('should map each error class to the correct ErrorCode', () => {
    // Core database errors
    const dbError = new DatabaseError('test', ErrorCodes.DB_CONNECTION_FAILED)
    expect(dbError.code).toBe('DB_CONNECTION_FAILED')

    // Constraint errors
    const uniqueError = new UniqueConstraintError('constraint', 'table', ['col'])
    expect(uniqueError.code).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION)

    const fkError = new ForeignKeyError('constraint', 'table', 'refTable')
    expect(fkError.code).toBe(ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION)

    const notNullError = new NotNullError('column', 'table')
    expect(notNullError.code).toBe(ErrorCodes.VALIDATION_NOT_NULL_VIOLATION)

    const checkError = new CheckConstraintError('constraint', 'table')
    expect(checkError.code).toBe(ErrorCodes.VALIDATION_CHECK_VIOLATION)

    // Resource errors
    const notFoundError = new NotFoundError('Entity')
    expect(notFoundError.code).toBe(ErrorCodes.RESOURCE_NOT_FOUND)

    const badRequestError = new BadRequestError('bad input')
    expect(badRequestError.code).toBe(ErrorCodes.RESOURCE_BAD_REQUEST)

    // Plugin errors
    const softDeleteError = new SoftDeleteError('test')
    expect(softDeleteError.code).toBe(ErrorCodes.SOFT_DELETE_ERROR)

    const recordNotDeletedError = new RecordNotDeletedError(1)
    expect(recordNotDeletedError.code).toBe(ErrorCodes.RECORD_NOT_DELETED)

    // Audit errors
    const auditError = new AuditError('test')
    expect(auditError.code).toBe(ErrorCodes.AUDIT_ERROR)

    const auditRestoreError = new AuditRestoreError(1, 'UPDATE', 'reason')
    expect(auditRestoreError.code).toBe(ErrorCodes.AUDIT_RESTORE_ERROR)

    const auditMissingValuesError = new AuditMissingValuesError(1)
    expect(auditMissingValuesError.code).toBe(ErrorCodes.AUDIT_MISSING_VALUES)

    // Timestamps errors
    const timestampsError = new TimestampsError('test')
    expect(timestampsError.code).toBe(ErrorCodes.TIMESTAMPS_ERROR)

    const timestampColumnMissingError = new TimestampColumnMissingError('table', 'column')
    expect(timestampColumnMissingError.code).toBe(ErrorCodes.TIMESTAMP_COLUMN_MISSING)
  })

  it('all error class codes should be valid ErrorCodes', () => {
    const errorCodes = [
      new DatabaseError('test', ErrorCodes.DB_UNKNOWN).code,
      new UniqueConstraintError('c', 't', []).code,
      new ForeignKeyError('c', 't', 'r').code,
      new NotNullError('c').code,
      new CheckConstraintError('c').code,
      new NotFoundError('E').code,
      new BadRequestError('m').code,
      new SoftDeleteError('m').code,
      new RecordNotDeletedError(1).code,
      new AuditError('m').code,
      new AuditRestoreError(1, 'UPDATE', 'r').code,
      new AuditMissingValuesError(1).code,
      new TimestampsError('m').code,
      new TimestampColumnMissingError('t', 'c').code
    ]

    for (const code of errorCodes) {
      expect(isValidErrorCode(code)).toBe(true)
    }
  })
})

// ============================================================================
// LegacyCodeMapping - additional coverage
// ============================================================================

describe('LegacyCodeMapping - additional coverage', () => {
  it('should map BAD_REQUEST legacy code', () => {
    expect(mapLegacyCode('BAD_REQUEST')).toBe(ErrorCodes.RESOURCE_BAD_REQUEST)
  })

  it('should map PostgreSQL 23514 (check constraint)', () => {
    expect(mapLegacyCode('23514')).toBe(ErrorCodes.VALIDATION_CHECK_VIOLATION)
  })

  it('should map ER_DUP_KEY to unique violation', () => {
    expect(mapLegacyCode('ER_DUP_KEY')).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION)
  })

  it('should map ER_NO_REFERENCED_ROW_2 to foreign key violation', () => {
    expect(mapLegacyCode('ER_NO_REFERENCED_ROW_2')).toBe(
      ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION
    )
  })

  it('should map SQLITE_CONSTRAINT to check violation', () => {
    expect(mapLegacyCode('SQLITE_CONSTRAINT')).toBe(ErrorCodes.VALIDATION_CHECK_VIOLATION)
  })

  it('should map CLI legacy codes E004 and E005', () => {
    expect(mapLegacyCode('E004')).toBe(ErrorCodes.PLUGIN_VALIDATION_FAILED)
    expect(mapLegacyCode('E005')).toBe(ErrorCodes.FS_WRITE_FAILED)
  })

  it('should map migration legacy codes', () => {
    expect(mapLegacyCode('MIGRATION_UP_FAILED')).toBe(ErrorCodes.MIGRATION_UP_FAILED)
    expect(mapLegacyCode('MIGRATION_DOWN_FAILED')).toBe(ErrorCodes.MIGRATION_DOWN_FAILED)
    expect(mapLegacyCode('MIGRATION_VALIDATION_FAILED')).toBe(
      ErrorCodes.MIGRATION_VALIDATION_FAILED
    )
  })

  it('should have correct number of legacy mappings', () => {
    // Count all legacy mappings defined in the source
    expect(Object.keys(LegacyCodeMapping).length).toBeGreaterThanOrEqual(18)
  })

  it('should have all mapped values be valid error codes', () => {
    for (const value of Object.values(LegacyCodeMapping)) {
      expect(isValidErrorCode(value)).toBe(true)
    }
  })
})

// ============================================================================
// Error parsing edge cases
// ============================================================================

describe('parseDatabaseError - edge cases', () => {
  it('should handle array input', () => {
    const parsed = parseDatabaseError([1, 2, 3])
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    expect(parsed.message).toBe('Unknown database error')
  })

  it('should handle number input', () => {
    const parsed = parseDatabaseError(42)
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
  })

  it('should handle boolean input', () => {
    const parsed = parseDatabaseError(false)
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
  })

  it('should handle 0 (falsy) input', () => {
    const parsed = parseDatabaseError(0)
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
  })

  it('should handle empty string input', () => {
    const parsed = parseDatabaseError('')
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
  })

  it('should handle object with no recognized database error properties', () => {
    const obj = { foo: 'bar', baz: 42 }
    const parsed = parseDatabaseError(obj, 'postgres')
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    expect(parsed.message).toBe('Unknown database error')
  })

  it('should handle postgres dialect with no code field on the error', () => {
    // Has message (so passes isRawDatabaseError) but no code
    const error = { message: 'Some postgres error without code' }
    const parsed = parseDatabaseError(error, 'postgres')
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
  })

  it('should handle mysql dialect with no code field on the error', () => {
    // Has message (so passes isRawDatabaseError) but no code
    const error = { message: 'Some mysql error without code' }
    const parsed = parseDatabaseError(error, 'mysql')
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
  })

  it('should handle mssql dialect with empty object that has recognized properties', () => {
    const error = { message: '' }
    const parsed = parseDatabaseError(error, 'mssql')
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
  })

  it('should handle postgres unique constraint with detail containing compound key', () => {
    const pgError = {
      code: '23505',
      constraint: 'users_email_org_key',
      table: 'users',
      detail: 'Key (email, org_id)=(test@example.com, 1) already exists.'
    }

    const parsed = parseDatabaseError(pgError, 'postgres')
    expect(parsed).toBeInstanceOf(UniqueConstraintError)
    const uniqueError = parsed as UniqueConstraintError
    expect(uniqueError.columns).toEqual(['email', 'org_id'])
  })

  it('should handle postgres foreign key error without detail', () => {
    const pgError = {
      code: '23503',
      constraint: 'posts_user_id_fkey',
      table: 'posts'
    }

    const parsed = parseDatabaseError(pgError, 'postgres')
    expect(parsed).toBeInstanceOf(ForeignKeyError)
    const fkError = parsed as ForeignKeyError
    expect(fkError.referencedTable).toBe('unknown')
  })

  it('should handle postgres not null error without column', () => {
    const pgError = {
      code: '23502'
      // missing column
    }

    const parsed = parseDatabaseError(pgError, 'postgres')
    expect(parsed).toBeInstanceOf(NotNullError)
    const notNullError = parsed as NotNullError
    expect(notNullError.column).toBe('unknown')
  })

  it('should handle postgres check constraint without constraint name', () => {
    const pgError = {
      code: '23514'
      // missing constraint
    }

    const parsed = parseDatabaseError(pgError, 'postgres')
    expect(parsed).toBeInstanceOf(CheckConstraintError)
    const checkError = parsed as CheckConstraintError
    expect(checkError.constraint).toBe('unknown')
  })

  it('should handle postgres error with code but no message', () => {
    const pgError = {
      code: '42P01'
      // missing message
    }

    const parsed = parseDatabaseError(pgError, 'postgres')
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.message).toBe('Database error')
    expect(parsed.code).toBe('42P01')
  })

  it('should handle MySQL DUP_ENTRY with dotted constraint name', () => {
    const mysqlError = {
      code: 'ER_DUP_ENTRY',
      sqlMessage: "Duplicate entry 'test@example.com' for key 'users.email_unique'"
    }

    const parsed = parseDatabaseError(mysqlError, 'mysql')
    expect(parsed).toBeInstanceOf(UniqueConstraintError)
    const uniqueError = parsed as UniqueConstraintError
    expect(uniqueError.constraint).toBe('users.email_unique')
    expect(uniqueError.columns).toEqual(['email_unique'])
  })

  it('should handle MySQL DUP_ENTRY without sqlMessage', () => {
    const mysqlError = {
      code: 'ER_DUP_ENTRY'
    }

    const parsed = parseDatabaseError(mysqlError, 'mysql')
    expect(parsed).toBeInstanceOf(UniqueConstraintError)
    const uniqueError = parsed as UniqueConstraintError
    expect(uniqueError.constraint).toBe('unique')
    // When there's no sqlMessage, dupMatch is null, constraintName is 'unique',
    // MYSQL_COL_REGEX matches 'unique' itself, so columns is ['unique']
    expect(uniqueError.columns).toEqual(['unique'])
  })

  it('should handle MySQL unknown error with neither sqlMessage nor message', () => {
    const mysqlError = {
      code: 'ER_SOMETHING_UNKNOWN'
    }

    const parsed = parseDatabaseError(mysqlError, 'mysql')
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.message).toBe('Database error')
  })

  it('should handle SQLite NOT NULL constraint without matching pattern', () => {
    const sqliteError = {
      message: 'NOT NULL constraint failed'
      // Missing table.column pattern
    }

    const parsed = parseDatabaseError(sqliteError, 'sqlite')
    expect(parsed).toBeInstanceOf(NotNullError)
    const notNullError = parsed as NotNullError
    expect(notNullError.column).toBe('unknown')
  })

  it('should handle SQLite error with no message property', () => {
    const sqliteError = { code: 'SQLITE_CONSTRAINT' }
    const parsed = parseDatabaseError(sqliteError, 'sqlite')
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
    // Without a message, parseSQLiteError gets empty string
    expect(parsed.message).toBe('')
  })

  it('should handle MSSQL unique constraint by error code 2627', () => {
    const mssqlError = {
      code: '2627',
      message: 'Violation of UNIQUE KEY constraint'
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(UniqueConstraintError)
  })

  it('should handle MSSQL unique constraint by error code 2601', () => {
    const mssqlError = {
      code: '2601',
      message: 'Cannot insert duplicate key row'
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(UniqueConstraintError)
  })

  it('should handle MSSQL unique constraint by message pattern', () => {
    const mssqlError = {
      message: "Cannot insert duplicate key row in object 'dbo.users'"
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(UniqueConstraintError)
  })

  it('should handle MSSQL unique key constraint message pattern', () => {
    const mssqlError = {
      message: "Violation of UNIQUE KEY constraint 'UQ_email'. Cannot insert duplicate key"
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(UniqueConstraintError)
  })

  it('should handle MSSQL foreign key by error code 547', () => {
    const mssqlError = {
      code: '547',
      message: 'The statement has been terminated.'
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(ForeignKeyError)
  })

  it('should handle MSSQL foreign key by message pattern', () => {
    const mssqlError = {
      message:
        'The DELETE statement conflicted with the FOREIGN KEY constraint "FK_posts_users". The conflict occurred in database "mydb".'
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(ForeignKeyError)
    const fkError = parsed as ForeignKeyError
    expect(fkError.constraint).toBe('FK_posts_users')
  })

  it('should handle MSSQL not null by error code 515', () => {
    const mssqlError = {
      code: '515',
      message: "Cannot insert the value NULL into column 'name', table 'dbo.users'"
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(NotNullError)
    const notNullError = parsed as NotNullError
    expect(notNullError.column).toBe('name')
  })

  it('should handle MSSQL not null by message pattern without code', () => {
    const mssqlError = {
      message: "Cannot insert the value NULL into column 'email'"
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(NotNullError)
    const notNullError = parsed as NotNullError
    expect(notNullError.column).toBe('email')
  })

  it('should handle MSSQL "does not allow nulls" message', () => {
    const mssqlError = {
      message: "Column 'name' does not allow nulls. INSERT fails."
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(NotNullError)
  })

  it('should handle MSSQL unknown error', () => {
    const mssqlError = {
      message: 'Some unrecognized MSSQL error'
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.message).toBe('Some unrecognized MSSQL error')
    expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN)
  })

  it('should handle MSSQL error with no message', () => {
    const mssqlError = {
      code: '999'
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(DatabaseError)
    expect(parsed.message).toBe('Database error')
    expect(parsed.code).toBe('999')
  })

  it('should handle MSSQL not null without matching column pattern', () => {
    const mssqlError = {
      code: '515',
      message: 'Cannot insert null value'
      // Does not match the regex for column extraction
    }

    const parsed = parseDatabaseError(mssqlError, 'mssql')
    expect(parsed).toBeInstanceOf(NotNullError)
    const notNullError = parsed as NotNullError
    expect(notNullError.column).toBe('unknown')
  })
})
