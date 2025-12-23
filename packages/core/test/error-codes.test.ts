/**
 * Tests for error-codes.ts utility functions
 */

import { describe, it, expect } from 'vitest'
import {
  ErrorCodes,
  isValidErrorCode,
  getErrorCategory,
  mapLegacyCode,
  LegacyCodeMapping
} from '../src/error-codes.js'

describe('Error Codes', () => {
  describe('ErrorCodes constant', () => {
    it('should have database error codes', () => {
      expect(ErrorCodes.DB_CONNECTION_FAILED).toBe('DB_CONNECTION_FAILED')
      expect(ErrorCodes.DB_QUERY_FAILED).toBe('DB_QUERY_FAILED')
    })

    it('should have validation error codes', () => {
      expect(ErrorCodes.VALIDATION_UNIQUE_VIOLATION).toBe('VALIDATION_UNIQUE_VIOLATION')
      expect(ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION).toBe('VALIDATION_FOREIGN_KEY_VIOLATION')
    })

    it('should have migration error codes', () => {
      expect(ErrorCodes.MIGRATION_UP_FAILED).toBe('MIGRATION_UP_FAILED')
      expect(ErrorCodes.MIGRATION_DOWN_FAILED).toBe('MIGRATION_DOWN_FAILED')
    })
  })

  describe('isValidErrorCode', () => {
    it('should return true for valid error codes', () => {
      expect(isValidErrorCode('DB_CONNECTION_FAILED')).toBe(true)
      expect(isValidErrorCode('VALIDATION_UNIQUE_VIOLATION')).toBe(true)
      expect(isValidErrorCode('MIGRATION_UP_FAILED')).toBe(true)
      expect(isValidErrorCode('RESOURCE_NOT_FOUND')).toBe(true)
    })

    it('should return false for invalid error codes', () => {
      expect(isValidErrorCode('INVALID_CODE')).toBe(false)
      expect(isValidErrorCode('')).toBe(false)
      expect(isValidErrorCode('random_string')).toBe(false)
      expect(isValidErrorCode('23505')).toBe(false) // PostgreSQL code, not our error code
    })
  })

  describe('getErrorCategory', () => {
    it('should extract DB category', () => {
      expect(getErrorCategory('DB_CONNECTION_FAILED')).toBe('DB')
      expect(getErrorCategory('DB_QUERY_FAILED')).toBe('DB')
    })

    it('should extract VALIDATION category', () => {
      expect(getErrorCategory('VALIDATION_UNIQUE_VIOLATION')).toBe('VALIDATION')
      expect(getErrorCategory('VALIDATION_FOREIGN_KEY_VIOLATION')).toBe('VALIDATION')
    })

    it('should extract MIGRATION category', () => {
      expect(getErrorCategory('MIGRATION_UP_FAILED')).toBe('MIGRATION')
      expect(getErrorCategory('MIGRATION_DOWN_FAILED')).toBe('MIGRATION')
    })

    it('should extract RESOURCE category', () => {
      expect(getErrorCategory('RESOURCE_NOT_FOUND')).toBe('RESOURCE')
    })

    it('should return UNKNOWN for invalid format', () => {
      expect(getErrorCategory('invalidformat')).toBe('UNKNOWN')
      expect(getErrorCategory('')).toBe('UNKNOWN')
      expect(getErrorCategory('no_underscore_prefix')).toBe('UNKNOWN')
    })
  })

  describe('mapLegacyCode', () => {
    it('should map database legacy codes', () => {
      expect(mapLegacyCode('UNIQUE_VIOLATION')).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION)
      expect(mapLegacyCode('FOREIGN_KEY_VIOLATION')).toBe(ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION)
      expect(mapLegacyCode('NOT_FOUND')).toBe(ErrorCodes.RESOURCE_NOT_FOUND)
    })

    it('should map PostgreSQL error codes', () => {
      expect(mapLegacyCode('23505')).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION)
      expect(mapLegacyCode('23503')).toBe(ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION)
      expect(mapLegacyCode('23502')).toBe(ErrorCodes.VALIDATION_NOT_NULL_VIOLATION)
    })

    it('should map MySQL error codes', () => {
      expect(mapLegacyCode('ER_DUP_ENTRY')).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION)
      expect(mapLegacyCode('ER_NO_REFERENCED_ROW')).toBe(ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION)
      expect(mapLegacyCode('ER_BAD_NULL_ERROR')).toBe(ErrorCodes.VALIDATION_NOT_NULL_VIOLATION)
    })

    it('should map CLI legacy codes', () => {
      expect(mapLegacyCode('E001')).toBe(ErrorCodes.DB_CONNECTION_FAILED)
      expect(mapLegacyCode('E002')).toBe(ErrorCodes.MIGRATION_UP_FAILED)
      expect(mapLegacyCode('E003')).toBe(ErrorCodes.CONFIG_VALIDATION_FAILED)
    })

    it('should return original code if no mapping exists', () => {
      expect(mapLegacyCode('UNKNOWN_CODE')).toBe('UNKNOWN_CODE')
      expect(mapLegacyCode('random')).toBe('random')
      expect(mapLegacyCode('')).toBe('')
    })
  })

  describe('LegacyCodeMapping', () => {
    it('should have expected mappings', () => {
      expect(LegacyCodeMapping['UNIQUE_VIOLATION']).toBeDefined()
      expect(LegacyCodeMapping['23505']).toBeDefined()
      expect(LegacyCodeMapping['ER_DUP_ENTRY']).toBeDefined()
    })
  })
})
