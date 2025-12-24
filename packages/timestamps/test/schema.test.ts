/**
 * Tests for Zod schema in @kysera/timestamps package.
 *
 * Tests cover:
 * - Valid configuration parsing with all options
 * - Valid configuration with minimal options
 * - Invalid configurations (wrong types, invalid values)
 * - Default values behavior
 * - Edge cases (empty strings, empty arrays, boundary values)
 * - dateFormat enum validation
 * - Type inference correctness
 */

import { describe, it, expect } from 'vitest'
import { TimestampsOptionsSchema, type TimestampsOptionsSchemaType } from '../src/schema.js'
import type { z } from 'zod'

describe('TimestampsOptionsSchema', () => {
  describe('Valid Configuration - All Options', () => {
    it('should accept valid configuration with all options', () => {
      const validConfig = {
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at',
        setUpdatedAtOnInsert: true,
        tables: ['users', 'posts', 'comments'],
        excludeTables: ['audit_logs', 'migrations'],
        getTimestamp: () => new Date().toISOString(),
        dateFormat: 'iso' as const,
        primaryKeyColumn: 'id'
      }

      const result = TimestampsOptionsSchema.safeParse(validConfig)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.createdAtColumn).toBe('created_at')
        expect(result.data.updatedAtColumn).toBe('updated_at')
        expect(result.data.setUpdatedAtOnInsert).toBe(true)
        expect(result.data.tables).toEqual(['users', 'posts', 'comments'])
        expect(result.data.excludeTables).toEqual(['audit_logs', 'migrations'])
        expect(typeof result.data.getTimestamp).toBe('function')
        expect(result.data.dateFormat).toBe('iso')
        expect(result.data.primaryKeyColumn).toBe('id')
      }
    })

    it('should accept valid configuration with all dateFormat variants', () => {
      const formats = ['iso', 'unix', 'date'] as const

      formats.forEach(format => {
        const result = TimestampsOptionsSchema.safeParse({
          dateFormat: format
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.dateFormat).toBe(format)
        }
      })
    })
  })

  describe('Valid Configuration - Minimal Options', () => {
    it('should accept empty configuration object', () => {
      const result = TimestampsOptionsSchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.createdAtColumn).toBeUndefined()
        expect(result.data.updatedAtColumn).toBeUndefined()
        expect(result.data.setUpdatedAtOnInsert).toBeUndefined()
        expect(result.data.tables).toBeUndefined()
        expect(result.data.excludeTables).toBeUndefined()
        expect(result.data.getTimestamp).toBeUndefined()
        expect(result.data.dateFormat).toBeUndefined()
        expect(result.data.primaryKeyColumn).toBeUndefined()
      }
    })

    it('should accept configuration with only createdAtColumn', () => {
      const result = TimestampsOptionsSchema.safeParse({
        createdAtColumn: 'created'
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.createdAtColumn).toBe('created')
      }
    })

    it('should accept configuration with only updatedAtColumn', () => {
      const result = TimestampsOptionsSchema.safeParse({
        updatedAtColumn: 'modified'
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.updatedAtColumn).toBe('modified')
      }
    })

    it('should accept configuration with only setUpdatedAtOnInsert', () => {
      const result = TimestampsOptionsSchema.safeParse({
        setUpdatedAtOnInsert: false
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.setUpdatedAtOnInsert).toBe(false)
      }
    })

    it('should accept configuration with only tables array', () => {
      const result = TimestampsOptionsSchema.safeParse({
        tables: ['users']
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual(['users'])
      }
    })

    it('should accept configuration with only excludeTables array', () => {
      const result = TimestampsOptionsSchema.safeParse({
        excludeTables: ['audit_logs']
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.excludeTables).toEqual(['audit_logs'])
      }
    })

    it('should accept configuration with only getTimestamp function', () => {
      const customTimestamp = () => Date.now()
      const result = TimestampsOptionsSchema.safeParse({
        getTimestamp: customTimestamp
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data.getTimestamp).toBe('function')
      }
    })

    it('should accept configuration with only dateFormat', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 'unix'
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.dateFormat).toBe('unix')
      }
    })

    it('should accept configuration with only primaryKeyColumn', () => {
      const result = TimestampsOptionsSchema.safeParse({
        primaryKeyColumn: 'uuid'
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.primaryKeyColumn).toBe('uuid')
      }
    })
  })

  describe('Invalid Configurations - Wrong Types', () => {
    it('should reject non-string createdAtColumn', () => {
      const result = TimestampsOptionsSchema.safeParse({
        createdAtColumn: 123
      })

      expect(result.success).toBe(false)
    })

    it('should reject non-string updatedAtColumn', () => {
      const result = TimestampsOptionsSchema.safeParse({
        updatedAtColumn: true
      })

      expect(result.success).toBe(false)
    })

    it('should reject non-boolean setUpdatedAtOnInsert', () => {
      const result = TimestampsOptionsSchema.safeParse({
        setUpdatedAtOnInsert: 'yes'
      })

      expect(result.success).toBe(false)
    })

    it('should reject non-array tables', () => {
      const result = TimestampsOptionsSchema.safeParse({
        tables: 'users'
      })

      expect(result.success).toBe(false)
    })

    it('should reject tables array with non-string elements', () => {
      const result = TimestampsOptionsSchema.safeParse({
        tables: [1, 2, 3]
      })

      expect(result.success).toBe(false)
    })

    it('should reject non-array excludeTables', () => {
      const result = TimestampsOptionsSchema.safeParse({
        excludeTables: { table: 'users' }
      })

      expect(result.success).toBe(false)
    })

    it('should reject excludeTables array with non-string elements', () => {
      const result = TimestampsOptionsSchema.safeParse({
        excludeTables: [null, undefined]
      })

      expect(result.success).toBe(false)
    })

    it('should reject non-function getTimestamp', () => {
      const result = TimestampsOptionsSchema.safeParse({
        getTimestamp: '2024-01-01T00:00:00.000Z'
      })

      expect(result.success).toBe(false)
    })

    it('should reject invalid dateFormat enum value', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 'invalid'
      })

      expect(result.success).toBe(false)
    })

    it('should reject non-string primaryKeyColumn', () => {
      const result = TimestampsOptionsSchema.safeParse({
        primaryKeyColumn: ['id', 'uuid']
      })

      expect(result.success).toBe(false)
    })

    it('should reject null values for string fields', () => {
      const result = TimestampsOptionsSchema.safeParse({
        createdAtColumn: null
      })

      expect(result.success).toBe(false)
    })

    it('should reject undefined in arrays', () => {
      const result = TimestampsOptionsSchema.safeParse({
        tables: ['users', undefined, 'posts']
      })

      expect(result.success).toBe(false)
    })
  })

  describe('dateFormat Enum Validation', () => {
    it('should accept iso format', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 'iso'
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.dateFormat).toBe('iso')
      }
    })

    it('should accept unix format', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 'unix'
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.dateFormat).toBe('unix')
      }
    })

    it('should accept date format', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 'date'
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.dateFormat).toBe('date')
      }
    })

    it('should reject uppercase ISO', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 'ISO'
      })

      expect(result.success).toBe(false)
    })

    it('should reject uppercase UNIX', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 'UNIX'
      })

      expect(result.success).toBe(false)
    })

    it('should reject uppercase DATE', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 'DATE'
      })

      expect(result.success).toBe(false)
    })

    it('should reject timestamp as dateFormat', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 'timestamp'
      })

      expect(result.success).toBe(false)
    })

    it('should reject numeric dateFormat', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 0
      })

      expect(result.success).toBe(false)
    })

    it('should reject empty string as dateFormat', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: ''
      })

      expect(result.success).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('should accept empty string for createdAtColumn', () => {
      const result = TimestampsOptionsSchema.safeParse({
        createdAtColumn: ''
      })

      // Empty string is technically a valid string
      expect(result.success).toBe(true)
    })

    it('should accept empty string for updatedAtColumn', () => {
      const result = TimestampsOptionsSchema.safeParse({
        updatedAtColumn: ''
      })

      expect(result.success).toBe(true)
    })

    it('should accept empty string for primaryKeyColumn', () => {
      const result = TimestampsOptionsSchema.safeParse({
        primaryKeyColumn: ''
      })

      expect(result.success).toBe(true)
    })

    it('should accept empty tables array', () => {
      const result = TimestampsOptionsSchema.safeParse({
        tables: []
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual([])
      }
    })

    it('should accept empty excludeTables array', () => {
      const result = TimestampsOptionsSchema.safeParse({
        excludeTables: []
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.excludeTables).toEqual([])
      }
    })

    it('should accept tables array with empty strings', () => {
      const result = TimestampsOptionsSchema.safeParse({
        tables: ['', 'users', '']
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual(['', 'users', ''])
      }
    })

    it('should accept tables array with whitespace strings', () => {
      const result = TimestampsOptionsSchema.safeParse({
        tables: ['  ', 'users', '\t']
      })

      expect(result.success).toBe(true)
    })

    it('should accept very long column names', () => {
      const longColumnName = 'a'.repeat(1000)
      const result = TimestampsOptionsSchema.safeParse({
        createdAtColumn: longColumnName,
        updatedAtColumn: longColumnName
      })

      expect(result.success).toBe(true)
    })

    it('should accept column names with special characters', () => {
      const result = TimestampsOptionsSchema.safeParse({
        createdAtColumn: 'created_at_$special!',
        updatedAtColumn: 'updated-at-column'
      })

      expect(result.success).toBe(true)
    })

    it('should accept column names with unicode characters', () => {
      const result = TimestampsOptionsSchema.safeParse({
        createdAtColumn: 'created_at_',
        updatedAtColumn: 'actualizado_el'
      })

      expect(result.success).toBe(true)
    })

    it('should accept large tables array', () => {
      const manyTables = Array.from({ length: 1000 }, (_, i) => `table_${i}`)
      const result = TimestampsOptionsSchema.safeParse({
        tables: manyTables
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toHaveLength(1000)
      }
    })

    it('should accept duplicate table names in arrays', () => {
      const result = TimestampsOptionsSchema.safeParse({
        tables: ['users', 'users', 'posts', 'users']
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual(['users', 'users', 'posts', 'users'])
      }
    })

    it('should accept various function signatures for getTimestamp', () => {
      // Arrow function
      const arrowFn = () => new Date().toISOString()
      const result1 = TimestampsOptionsSchema.safeParse({
        getTimestamp: arrowFn
      })
      expect(result1.success).toBe(true)

      // Regular function
      const result2 = TimestampsOptionsSchema.safeParse({
        getTimestamp: function () {
          return Date.now()
        }
      })
      expect(result2.success).toBe(true)

      // Async function
      const result3 = TimestampsOptionsSchema.safeParse({
        getTimestamp: async () => new Date()
      })
      expect(result3.success).toBe(true)
    })
  })

  describe('Default Values Behavior', () => {
    it('should not apply default values (all fields are optional)', () => {
      const result = TimestampsOptionsSchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        // All values should be undefined since schema has no defaults
        expect(Object.keys(result.data).length).toBe(0)
      }
    })

    it('should preserve explicit undefined values as undefined', () => {
      const result = TimestampsOptionsSchema.safeParse({
        createdAtColumn: undefined,
        updatedAtColumn: undefined
      })

      expect(result.success).toBe(true)
    })
  })

  describe('Type Inference', () => {
    it('should infer correct TypeScript types', () => {
      // This test verifies compile-time type inference
      type InferredType = z.infer<typeof TimestampsOptionsSchema>

      // Create a type-checking function
      const assertType = <T>(_value: T): void => {}

      // Test that the inferred type matches expected structure
      const validData: InferredType = {
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at',
        setUpdatedAtOnInsert: true,
        tables: ['users'],
        excludeTables: ['audit'],
        getTimestamp: () => new Date().toISOString(),
        dateFormat: 'iso',
        primaryKeyColumn: 'id'
      }

      assertType<InferredType>(validData)

      // Empty object should also be valid
      const emptyData: InferredType = {}
      assertType<InferredType>(emptyData)

      // Partial data should be valid
      const partialData: InferredType = {
        createdAtColumn: 'created_at',
        dateFormat: 'unix'
      }
      assertType<InferredType>(partialData)

      expect(true).toBe(true) // Confirm test ran
    })

    it('should export TimestampsOptionsSchemaType correctly', () => {
      // Verify the exported type alias works
      const options: TimestampsOptionsSchemaType = {
        createdAtColumn: 'created_at',
        dateFormat: 'date'
      }

      expect(options.createdAtColumn).toBe('created_at')
      expect(options.dateFormat).toBe('date')
    })

    it('should allow dateFormat to be one of three valid values', () => {
      // Type-level test - should compile without errors
      const isoOptions: TimestampsOptionsSchemaType = { dateFormat: 'iso' }
      const unixOptions: TimestampsOptionsSchemaType = { dateFormat: 'unix' }
      const dateOptions: TimestampsOptionsSchemaType = { dateFormat: 'date' }

      expect(isoOptions.dateFormat).toBe('iso')
      expect(unixOptions.dateFormat).toBe('unix')
      expect(dateOptions.dateFormat).toBe('date')
    })
  })

  describe('safeParse and parse Behavior', () => {
    it('should return success: true for valid input', () => {
      const result = TimestampsOptionsSchema.safeParse({
        createdAtColumn: 'created_at'
      })

      expect(result.success).toBe(true)
    })

    it('should return success: false for invalid input', () => {
      const result = TimestampsOptionsSchema.safeParse({
        createdAtColumn: 123
      })

      expect(result.success).toBe(false)
    })

    it('should include error details for invalid input', () => {
      const result = TimestampsOptionsSchema.safeParse({
        dateFormat: 'invalid',
        setUpdatedAtOnInsert: 'not a boolean'
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('should throw on parse with invalid input', () => {
      expect(() => {
        TimestampsOptionsSchema.parse({
          createdAtColumn: 123
        })
      }).toThrow()
    })

    it('should return parsed data on parse with valid input', () => {
      const parsed = TimestampsOptionsSchema.parse({
        createdAtColumn: 'created_at',
        dateFormat: 'iso'
      })

      expect(parsed.createdAtColumn).toBe('created_at')
      expect(parsed.dateFormat).toBe('iso')
    })
  })

  describe('Complex Validation Scenarios', () => {
    it('should validate realistic production configuration', () => {
      const productionConfig = {
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at',
        setUpdatedAtOnInsert: true,
        tables: ['users', 'posts', 'comments', 'likes', 'follows'],
        excludeTables: ['migrations', 'audit_logs', 'sessions'],
        getTimestamp: () => new Date().toISOString(),
        dateFormat: 'iso' as const,
        primaryKeyColumn: 'id'
      }

      const result = TimestampsOptionsSchema.safeParse(productionConfig)

      expect(result.success).toBe(true)
    })

    it('should validate configuration for Unix timestamp format', () => {
      const unixConfig = {
        createdAtColumn: 'created_ts',
        updatedAtColumn: 'updated_ts',
        dateFormat: 'unix' as const,
        getTimestamp: () => Math.floor(Date.now() / 1000)
      }

      const result = TimestampsOptionsSchema.safeParse(unixConfig)

      expect(result.success).toBe(true)
    })

    it('should validate configuration with custom primary key', () => {
      const uuidConfig = {
        primaryKeyColumn: 'uuid',
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at'
      }

      const result = TimestampsOptionsSchema.safeParse(uuidConfig)

      expect(result.success).toBe(true)
    })

    it('should validate configuration with both tables and excludeTables', () => {
      const config = {
        tables: ['users', 'posts'],
        excludeTables: ['audit_logs']
      }

      const result = TimestampsOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
    })

    it('should handle configuration with overlapping tables and excludeTables', () => {
      // The schema allows this; business logic handles precedence
      const config = {
        tables: ['users', 'posts', 'audit'],
        excludeTables: ['audit', 'migrations']
      }

      const result = TimestampsOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
    })
  })

  describe('Schema Properties', () => {
    it('should have all expected keys', () => {
      const shape = TimestampsOptionsSchema.shape

      expect(shape).toHaveProperty('createdAtColumn')
      expect(shape).toHaveProperty('updatedAtColumn')
      expect(shape).toHaveProperty('setUpdatedAtOnInsert')
      expect(shape).toHaveProperty('tables')
      expect(shape).toHaveProperty('excludeTables')
      expect(shape).toHaveProperty('getTimestamp')
      expect(shape).toHaveProperty('dateFormat')
      expect(shape).toHaveProperty('primaryKeyColumn')
    })

    it('should have exactly 8 keys', () => {
      const shape = TimestampsOptionsSchema.shape
      const keys = Object.keys(shape)

      expect(keys).toHaveLength(8)
      expect(keys).toEqual([
        'createdAtColumn',
        'updatedAtColumn',
        'setUpdatedAtOnInsert',
        'tables',
        'excludeTables',
        'getTimestamp',
        'dateFormat',
        'primaryKeyColumn'
      ])
    })
  })
})
