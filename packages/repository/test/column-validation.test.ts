/**
 * Tests for column validation utilities (H-7 fix).
 *
 * @module @kysera/repository
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  validateColumnNames,
  getAllowedColumnsFromPkConfig,
  validateConditions
} from '../src/column-validation.js'

describe('validateColumnNames', () => {
  it('should pass validation for allowed columns', () => {
    const conditions = { id: 1, name: 'Alice', email: 'alice@example.com' }
    const allowedColumns = new Set(['id', 'name', 'email', 'createdAt'])

    expect(() => validateColumnNames(conditions, allowedColumns)).not.toThrow()
  })

  it('should throw error for single invalid column', () => {
    const conditions = { id: 1, malicious: 'DROP TABLE users' }
    const allowedColumns = new Set(['id', 'name', 'email'])

    expect(() => validateColumnNames(conditions, allowedColumns)).toThrow(
      'Invalid column name(s): malicious'
    )
  })

  it('should throw error for multiple invalid columns', () => {
    const conditions = { id: 1, bad1: 'value', bad2: 'value' }
    const allowedColumns = new Set(['id', 'name'])

    expect(() => validateColumnNames(conditions, allowedColumns)).toThrow(/bad1, bad2/)
  })

  it('should list all allowed columns in error message', () => {
    const conditions = { invalid: 'value' }
    const allowedColumns = new Set(['id', 'name', 'email'])

    expect(() => validateColumnNames(conditions, allowedColumns)).toThrow(
      /Allowed columns: id, name, email/
    )
  })

  it('should handle empty conditions object', () => {
    const conditions = {}
    const allowedColumns = new Set(['id', 'name'])

    expect(() => validateColumnNames(conditions, allowedColumns)).not.toThrow()
  })

  it('should validate column names with special characters', () => {
    const conditions = { user_id: 1, created_at: new Date() }
    const allowedColumns = new Set(['user_id', 'created_at', 'updated_at'])

    expect(() => validateColumnNames(conditions, allowedColumns)).not.toThrow()
  })

  it('should reject SQL injection attempts', () => {
    const conditions = { "id = 1 OR '1'='1": 'value' }
    const allowedColumns = new Set(['id', 'name'])

    expect(() => validateColumnNames(conditions, allowedColumns)).toThrow()
  })

  it('should be case-sensitive', () => {
    const conditions = { ID: 1 } // uppercase
    const allowedColumns = new Set(['id']) // lowercase

    expect(() => validateColumnNames(conditions, allowedColumns)).toThrow(/Invalid column name/)
  })
})

describe('getAllowedColumnsFromPkConfig', () => {
  it('should extract single column from config', () => {
    const pkConfig = { columns: 'id', type: 'number' as const }

    const result = getAllowedColumnsFromPkConfig(pkConfig)

    expect(result).toEqual(new Set(['id']))
  })

  it('should extract multiple columns from config', () => {
    const pkConfig = { columns: ['userId', 'roleId'], type: 'number' as const }

    const result = getAllowedColumnsFromPkConfig(pkConfig)

    expect(result).toEqual(new Set(['userId', 'roleId']))
  })

  it('should extract three columns from config', () => {
    const pkConfig = { columns: ['orgId', 'projectId', 'taskId'], type: 'number' as const }

    const result = getAllowedColumnsFromPkConfig(pkConfig)

    expect(result).toEqual(new Set(['orgId', 'projectId', 'taskId']))
  })

  it('should return ReadonlySet', () => {
    const pkConfig = { columns: 'id', type: 'number' as const }

    const result = getAllowedColumnsFromPkConfig(pkConfig)

    expect(result).toBeInstanceOf(Set)
    expect(result.has('id')).toBe(true)
  })
})

describe('validateConditions', () => {
  describe('development mode', () => {
    let originalEnv: string | undefined

    beforeEach(() => {
      originalEnv = process.env['NODE_ENV']
      process.env['NODE_ENV'] = 'development'
    })

    afterEach(() => {
      process.env['NODE_ENV'] = originalEnv
    })

    it('should validate in development mode by default', () => {
      const conditions = { invalid: 'value' }
      const pkConfig = { columns: 'id', type: 'number' as const }

      // Should throw because 'invalid' is not in allowedColumns (only 'id' from pkConfig)
      expect(() => validateConditions(conditions, pkConfig)).toThrow(/Invalid column name/)
    })

    it('should use custom allowedColumns when provided', () => {
      const conditions = { name: 'Alice', email: 'alice@example.com' }
      const pkConfig = { columns: 'id', type: 'number' as const }
      const options = { allowedColumns: new Set(['id', 'name', 'email']) }

      const result = validateConditions(conditions, pkConfig, options)

      expect(result).toEqual(conditions)
    })

    it('should throw for invalid columns even with custom whitelist', () => {
      const conditions = { malicious: 'DROP TABLE' }
      const pkConfig = { columns: 'id', type: 'number' as const }
      const options = { allowedColumns: new Set(['id', 'name']) }

      expect(() => validateConditions(conditions, pkConfig, options)).toThrow(/malicious/)
    })
  })

  describe('production mode', () => {
    let originalEnv: string | undefined

    beforeEach(() => {
      originalEnv = process.env['NODE_ENV']
      process.env['NODE_ENV'] = 'production'
    })

    afterEach(() => {
      process.env['NODE_ENV'] = originalEnv
    })

    it('should skip validation in production mode by default', () => {
      const conditions = { invalid: 'value', malicious: 'DROP TABLE' }
      const pkConfig = { columns: 'id', type: 'number' as const }

      // Should not throw in production
      const result = validateConditions(conditions, pkConfig)

      expect(result).toEqual(conditions)
    })

    it('should validate when explicitly enabled in production', () => {
      const conditions = { invalid: 'value' }
      const pkConfig = { columns: 'id', type: 'number' as const }
      const options = { enabled: true, allowedColumns: new Set(['id', 'name']) }

      expect(() => validateConditions(conditions, pkConfig, options)).toThrow(/invalid/)
    })
  })

  describe('explicit enabled flag', () => {
    it('should skip validation when explicitly disabled', () => {
      const conditions = { invalid: 'value' }
      const pkConfig = { columns: 'id', type: 'number' as const }
      const options = { enabled: false }

      const result = validateConditions(conditions, pkConfig, options)

      expect(result).toEqual(conditions)
    })

    it('should validate when explicitly enabled', () => {
      const conditions = { invalid: 'value' }
      const pkConfig = { columns: 'id', type: 'number' as const }
      const options = { enabled: true, allowedColumns: new Set(['id']) }

      expect(() => validateConditions(conditions, pkConfig, options)).toThrow(/invalid/)
    })
  })

  describe('integration with primary key config', () => {
    it('should allow primary key columns by default', () => {
      const conditions = { id: 123 }
      const pkConfig = { columns: 'id', type: 'number' as const }
      const options = { enabled: true }

      const result = validateConditions(conditions, pkConfig, options)

      expect(result).toEqual(conditions)
    })

    it('should allow composite primary key columns by default', () => {
      const conditions = { userId: 1, roleId: 2 }
      const pkConfig = { columns: ['userId', 'roleId'], type: 'number' as const }
      const options = { enabled: true }

      const result = validateConditions(conditions, pkConfig, options)

      expect(result).toEqual(conditions)
    })

    it('should reject non-primary-key columns without custom whitelist', () => {
      const conditions = { name: 'Alice' } // Not a primary key
      const pkConfig = { columns: 'id', type: 'number' as const }
      const options = { enabled: true }

      expect(() => validateConditions(conditions, pkConfig, options)).toThrow(/name/)
    })
  })

  describe('edge cases', () => {
    it('should handle empty conditions', () => {
      const conditions = {}
      const pkConfig = { columns: 'id', type: 'number' as const }
      const options = { enabled: true }

      const result = validateConditions(conditions, pkConfig, options)

      expect(result).toEqual({})
    })

    it('should handle special character column names', () => {
      const conditions = { user_id: 1, created_at: new Date() }
      const pkConfig = { columns: 'user_id', type: 'number' as const }
      const options = {
        enabled: true,
        allowedColumns: new Set(['user_id', 'created_at'])
      }

      const result = validateConditions(conditions, pkConfig, options)

      expect(result).toEqual(conditions)
    })

    it('should return same object reference when validation passes', () => {
      const conditions = { id: 1 }
      const pkConfig = { columns: 'id', type: 'number' as const }
      const options = { enabled: true }

      const result = validateConditions(conditions, pkConfig, options)

      expect(result).toBe(conditions) // Same reference
    })
  })
})

describe('SQL injection prevention', () => {
  it('should reject common SQL injection patterns', () => {
    const maliciousInputs = [
      { "id OR '1'='1": 1 },
      { 'id; DROP TABLE users--': 1 },
      { "id' OR 1=1--": 1 },
      { 'id UNION SELECT * FROM passwords': 1 },
      { 'id/**/OR/**/1=1': 1 }
    ]

    const allowedColumns = new Set(['id', 'name', 'email'])

    maliciousInputs.forEach(input => {
      expect(() => validateColumnNames(input, allowedColumns)).toThrow(/Invalid column name/)
    })
  })

  it('should allow legitimate column names with underscores', () => {
    const conditions = { user_id: 1, created_at: new Date(), is_active: true }
    const allowedColumns = new Set(['user_id', 'created_at', 'is_active'])

    expect(() => validateColumnNames(conditions, allowedColumns)).not.toThrow()
  })

  it('should allow legitimate column names with numbers', () => {
    const conditions = { column1: 'value', field2: 'value' }
    const allowedColumns = new Set(['column1', 'field2'])

    expect(() => validateColumnNames(conditions, allowedColumns)).not.toThrow()
  })
})
