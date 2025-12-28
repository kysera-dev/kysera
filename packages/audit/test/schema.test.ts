import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { AuditOptionsSchema, type AuditOptionsSchemaType } from '../src/schema.js'

// ============================================================================
// Valid Configuration Tests
// ============================================================================

describe('AuditOptionsSchema - Valid Configurations', () => {
  describe('Full configuration with all options', () => {
    it('should parse valid configuration with all string/boolean options', () => {
      const config = {
        auditTable: 'custom_audit_logs',
        primaryKeyColumn: 'uuid',
        captureOldValues: true,
        captureNewValues: false,
        skipSystemOperations: true,
        tables: ['users', 'posts', 'comments'],
        excludeTables: ['sessions', 'cache']
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.auditTable).toBe('custom_audit_logs')
        expect(result.data.primaryKeyColumn).toBe('uuid')
        expect(result.data.captureOldValues).toBe(true)
        expect(result.data.captureNewValues).toBe(false)
        expect(result.data.skipSystemOperations).toBe(true)
        expect(result.data.tables).toEqual(['users', 'posts', 'comments'])
        expect(result.data.excludeTables).toEqual(['sessions', 'cache'])
      }
    })

    it('should parse valid configuration with function options', () => {
      const getUserId = () => 'user-123'
      const getTimestamp = () => new Date()
      const metadata = () => ({ ip: '127.0.0.1', userAgent: 'test' })

      const config = {
        auditTable: 'audit_logs',
        getUserId,
        getTimestamp,
        metadata
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.auditTable).toBe('audit_logs')
        expect(typeof result.data.getUserId).toBe('function')
        expect(typeof result.data.getTimestamp).toBe('function')
        expect(typeof result.data.metadata).toBe('function')
      }
    })

    it('should parse configuration with all options including functions', () => {
      const config = {
        auditTable: 'audit_history',
        primaryKeyColumn: 'id',
        captureOldValues: true,
        captureNewValues: true,
        skipSystemOperations: false,
        tables: ['users'],
        excludeTables: ['temp'],
        getUserId: () => 'admin',
        getTimestamp: () => '2024-01-15T12:00:00Z',
        metadata: () => ({ source: 'api' })
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toMatchObject({
          auditTable: 'audit_history',
          primaryKeyColumn: 'id',
          captureOldValues: true,
          captureNewValues: true,
          skipSystemOperations: false,
          tables: ['users'],
          excludeTables: ['temp']
        })
      }
    })
  })

  describe('Minimal configuration', () => {
    it('should parse empty object (all optional)', () => {
      const config = {}

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({})
      }
    })

    it('should parse with only auditTable', () => {
      const config = { auditTable: 'my_audit_table' }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.auditTable).toBe('my_audit_table')
        expect(result.data.primaryKeyColumn).toBeUndefined()
        expect(result.data.captureOldValues).toBeUndefined()
      }
    })

    it('should parse with only boolean flags', () => {
      const config = {
        captureOldValues: false,
        captureNewValues: false,
        skipSystemOperations: true
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.captureOldValues).toBe(false)
        expect(result.data.captureNewValues).toBe(false)
        expect(result.data.skipSystemOperations).toBe(true)
      }
    })

    it('should parse with only tables array', () => {
      const config = { tables: ['users', 'orders'] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual(['users', 'orders'])
      }
    })

    it('should parse with only function options', () => {
      const config = {
        getUserId: () => null
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data.getUserId).toBe('function')
      }
    })
  })
})

// ============================================================================
// Invalid Configuration Tests
// ============================================================================

describe('AuditOptionsSchema - Invalid Configurations', () => {
  describe('Wrong types for string fields', () => {
    it('should reject number for auditTable', () => {
      const config = { auditTable: 123 }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('auditTable')
      }
    })

    it('should reject boolean for primaryKeyColumn', () => {
      const config = { primaryKeyColumn: true }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('primaryKeyColumn')
      }
    })

    it('should reject array for auditTable', () => {
      const config = { auditTable: ['audit_logs'] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })

    it('should reject object for primaryKeyColumn', () => {
      const config = { primaryKeyColumn: { name: 'id' } }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })
  })

  describe('Wrong types for boolean fields', () => {
    it('should reject string for captureOldValues', () => {
      const config = { captureOldValues: 'true' }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('captureOldValues')
      }
    })

    it('should reject number for captureNewValues', () => {
      const config = { captureNewValues: 1 }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('captureNewValues')
      }
    })

    it('should reject string for skipSystemOperations', () => {
      const config = { skipSystemOperations: 'false' }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('skipSystemOperations')
      }
    })

    it('should reject null for boolean fields', () => {
      const config = {
        captureOldValues: null,
        captureNewValues: null,
        skipSystemOperations: null
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })
  })

  describe('Wrong types for array fields', () => {
    it('should reject string for tables', () => {
      const config = { tables: 'users,posts' }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('tables')
      }
    })

    it('should reject object for excludeTables', () => {
      const config = { excludeTables: { users: true } }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('excludeTables')
      }
    })

    it('should reject array with non-string elements in tables', () => {
      const config = { tables: ['users', 123, 'posts'] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })

    it('should reject array with mixed types in excludeTables', () => {
      const config = { excludeTables: [true, 'cache', null] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })

    it('should reject number for tables', () => {
      const config = { tables: 42 }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })
  })

  describe('Wrong types for function fields', () => {
    it('should reject string for getUserId', () => {
      const config = { getUserId: 'user-123' }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('getUserId')
      }
    })

    it('should reject object for getTimestamp', () => {
      const config = { getTimestamp: { time: Date.now() } }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('getTimestamp')
      }
    })

    it('should reject array for metadata', () => {
      const config = { metadata: [{ key: 'value' }] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('metadata')
      }
    })

    it('should reject number for getUserId', () => {
      const config = { getUserId: 12345 }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })

    it('should reject boolean for metadata', () => {
      const config = { metadata: true }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })
  })

  describe('Multiple invalid fields', () => {
    it('should report all errors when multiple fields are invalid', () => {
      const config = {
        auditTable: 123,
        captureOldValues: 'yes',
        tables: 'not-an-array',
        getUserId: 'not-a-function'
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThanOrEqual(4)
      }
    })
  })
})

// ============================================================================
// Default Values Behavior Tests
// ============================================================================

describe('AuditOptionsSchema - Default Values Behavior', () => {
  it('should not add default values (all fields are optional)', () => {
    const config = {}

    const result = AuditOptionsSchema.parse(config)

    // All fields should be undefined since schema has no defaults
    expect(result.auditTable).toBeUndefined()
    expect(result.primaryKeyColumn).toBeUndefined()
    expect(result.captureOldValues).toBeUndefined()
    expect(result.captureNewValues).toBeUndefined()
    expect(result.skipSystemOperations).toBeUndefined()
    expect(result.tables).toBeUndefined()
    expect(result.excludeTables).toBeUndefined()
    expect(result.getUserId).toBeUndefined()
    expect(result.getTimestamp).toBeUndefined()
    expect(result.metadata).toBeUndefined()
  })

  it('should preserve explicitly set undefined values', () => {
    const config = {
      auditTable: undefined,
      captureOldValues: undefined
    }

    const result = AuditOptionsSchema.parse(config)

    expect(result.auditTable).toBeUndefined()
    expect(result.captureOldValues).toBeUndefined()
  })

  it('should preserve explicitly set false boolean values', () => {
    const config = {
      captureOldValues: false,
      captureNewValues: false,
      skipSystemOperations: false
    }

    const result = AuditOptionsSchema.parse(config)

    expect(result.captureOldValues).toBe(false)
    expect(result.captureNewValues).toBe(false)
    expect(result.skipSystemOperations).toBe(false)
  })

  it('should preserve explicitly set true boolean values', () => {
    const config = {
      captureOldValues: true,
      captureNewValues: true,
      skipSystemOperations: true
    }

    const result = AuditOptionsSchema.parse(config)

    expect(result.captureOldValues).toBe(true)
    expect(result.captureNewValues).toBe(true)
    expect(result.skipSystemOperations).toBe(true)
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('AuditOptionsSchema - Edge Cases', () => {
  describe('Empty strings', () => {
    it('should accept empty string for auditTable', () => {
      const config = { auditTable: '' }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.auditTable).toBe('')
      }
    })

    it('should accept empty string for primaryKeyColumn', () => {
      const config = { primaryKeyColumn: '' }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.primaryKeyColumn).toBe('')
      }
    })

    it('should accept array with empty strings in tables', () => {
      const config = { tables: ['', 'users', ''] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual(['', 'users', ''])
      }
    })
  })

  describe('Empty arrays', () => {
    it('should accept empty array for tables', () => {
      const config = { tables: [] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual([])
      }
    })

    it('should accept empty array for excludeTables', () => {
      const config = { excludeTables: [] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.excludeTables).toEqual([])
      }
    })

    it('should accept both empty arrays together', () => {
      const config = { tables: [], excludeTables: [] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual([])
        expect(result.data.excludeTables).toEqual([])
      }
    })
  })

  describe('Large arrays', () => {
    it('should accept large tables array', () => {
      const largeTables = Array.from({ length: 1000 }, (_, i) => `table_${i}`)
      const config = { tables: largeTables }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toHaveLength(1000)
      }
    })

    it('should accept large excludeTables array', () => {
      const largeExclude = Array.from({ length: 500 }, (_, i) => `exclude_${i}`)
      const config = { excludeTables: largeExclude }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.excludeTables).toHaveLength(500)
      }
    })
  })

  describe('Special characters in strings', () => {
    it('should accept special characters in auditTable', () => {
      const config = { auditTable: 'audit_logs_v2.0-beta' }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.auditTable).toBe('audit_logs_v2.0-beta')
      }
    })

    it('should accept unicode characters in table names', () => {
      const config = { tables: ['users_', 'pedidos', 'commandes'] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual(['users_', 'pedidos', 'commandes'])
      }
    })

    it('should accept SQL-like characters (but should be escaped at runtime)', () => {
      const config = {
        auditTable: "audit'; DROP TABLE users;--",
        primaryKeyColumn: "id'); --"
      }

      const result = AuditOptionsSchema.safeParse(config)

      // Schema accepts any string, SQL injection prevention happens at runtime
      expect(result.success).toBe(true)
    })

    it('should accept whitespace in table names', () => {
      const config = { tables: ['  users  ', 'table with spaces'] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual(['  users  ', 'table with spaces'])
      }
    })
  })

  describe('Function edge cases', () => {
    it('should accept arrow functions', () => {
      const config = {
        getUserId: () => 'user-id',
        getTimestamp: () => Date.now(),
        metadata: () => ({})
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
    })

    it('should accept async functions', () => {
      const config = {
        getUserId: async () => 'user-id',
        getTimestamp: async () => new Date(),
        metadata: async () => ({ async: true })
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
    })

    it('should accept regular function expressions', () => {
      const config = {
        getUserId: function () {
          return 'user-id'
        },
        getTimestamp: function () {
          return new Date()
        },
        metadata: function () {
          return { type: 'regular' }
        }
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
    })

    it('should accept functions that return null', () => {
      const config = {
        getUserId: () => null,
        metadata: () => null
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
    })

    it('should accept functions with parameters', () => {
      // These have parameters but schema only checks if its a function
      const config = {
        getUserId: (ctx: unknown) => (ctx as { userId: string })?.userId,
        getTimestamp: (format: string) => format === 'iso' ? new Date().toISOString() : Date.now(),
        metadata: (req: unknown) => ({ path: (req as { path: string })?.path })
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
    })
  })

  describe('Boundary values', () => {
    it('should accept single character strings', () => {
      const config = {
        auditTable: 'a',
        primaryKeyColumn: 'i',
        tables: ['x'],
        excludeTables: ['y']
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
    })

    it('should accept very long table names', () => {
      const longName = 'a'.repeat(10000)
      const config = {
        auditTable: longName,
        primaryKeyColumn: longName,
        tables: [longName],
        excludeTables: [longName]
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.auditTable?.length).toBe(10000)
      }
    })

    it('should accept duplicate table names in arrays', () => {
      const config = {
        tables: ['users', 'users', 'users'],
        excludeTables: ['cache', 'cache']
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tables).toEqual(['users', 'users', 'users'])
      }
    })
  })

  describe('Null vs undefined handling', () => {
    it('should reject null for string fields', () => {
      const config = { auditTable: null }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })

    it('should reject null for array fields', () => {
      const config = { tables: null }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })

    it('should reject null for function fields', () => {
      const config = { getUserId: null }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })

    it('should accept undefined for all optional fields', () => {
      const config = {
        auditTable: undefined,
        primaryKeyColumn: undefined,
        captureOldValues: undefined,
        captureNewValues: undefined,
        skipSystemOperations: undefined,
        tables: undefined,
        excludeTables: undefined,
        getUserId: undefined,
        getTimestamp: undefined,
        metadata: undefined
      }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// Type Inference Tests
// ============================================================================

describe('AuditOptionsSchemaType - Type Inference', () => {
  it('should correctly infer type from schema', () => {
    // This test validates that TypeScript correctly infers the type
    const validConfig: AuditOptionsSchemaType = {
      auditTable: 'audit_logs',
      primaryKeyColumn: 'id',
      captureOldValues: true,
      captureNewValues: true,
      skipSystemOperations: false,
      tables: ['users'],
      excludeTables: ['cache'],
      getUserId: () => 'user-id',
      getTimestamp: () => new Date(),
      metadata: () => ({ key: 'value' })
    }

    // Validate it parses correctly
    const result = AuditOptionsSchema.parse(validConfig)

    // Check non-function fields match exactly
    expect(result.auditTable).toBe(validConfig.auditTable)
    expect(result.primaryKeyColumn).toBe(validConfig.primaryKeyColumn)
    expect(result.captureOldValues).toBe(validConfig.captureOldValues)
    expect(result.captureNewValues).toBe(validConfig.captureNewValues)
    expect(result.skipSystemOperations).toBe(validConfig.skipSystemOperations)
    expect(result.tables).toEqual(validConfig.tables)
    expect(result.excludeTables).toEqual(validConfig.excludeTables)

    // Functions should be present and callable
    expect(typeof result.getUserId).toBe('function')
    expect(typeof result.getTimestamp).toBe('function')
    expect(typeof result.metadata).toBe('function')
  })

  it('should allow partial configuration (all optional)', () => {
    const partialConfig: AuditOptionsSchemaType = {}

    const result = AuditOptionsSchema.parse(partialConfig)
    expect(result).toEqual({})
  })

  it('should allow single field configuration', () => {
    const singleField: AuditOptionsSchemaType = {
      auditTable: 'custom_audit'
    }

    const result = AuditOptionsSchema.parse(singleField)
    expect(result.auditTable).toBe('custom_audit')
  })

  it('should be compatible with z.infer utility', () => {
    // Verify the type matches what z.infer would produce
    type InferredType = z.infer<typeof AuditOptionsSchema>

    const config: InferredType = {
      auditTable: 'test',
      captureOldValues: false
    }

    const result = AuditOptionsSchema.parse(config)
    expect(result.auditTable).toBe('test')
    expect(result.captureOldValues).toBe(false)
  })
})

// ============================================================================
// Schema Structure Tests
// ============================================================================

describe('AuditOptionsSchema - Schema Structure', () => {
  it('should be a Zod object schema', () => {
    expect(AuditOptionsSchema).toBeDefined()
    // Zod 4 uses different internal structure, check for object-like behavior
    expect(AuditOptionsSchema.shape).toBeDefined()
    expect(typeof AuditOptionsSchema.parse).toBe('function')
    expect(typeof AuditOptionsSchema.safeParse).toBe('function')
  })

  it('should have all expected fields defined', () => {
    const shape = AuditOptionsSchema.shape

    expect(shape.auditTable).toBeDefined()
    expect(shape.primaryKeyColumn).toBeDefined()
    expect(shape.captureOldValues).toBeDefined()
    expect(shape.captureNewValues).toBeDefined()
    expect(shape.skipSystemOperations).toBeDefined()
    expect(shape.tables).toBeDefined()
    expect(shape.excludeTables).toBeDefined()
    expect(shape.getUserId).toBeDefined()
    expect(shape.getTimestamp).toBeDefined()
    expect(shape.metadata).toBeDefined()
  })

  it('should have 10 total fields', () => {
    const shape = AuditOptionsSchema.shape
    const fieldCount = Object.keys(shape).length

    expect(fieldCount).toBe(10)
  })

  it('should have all fields as optional', () => {
    const shape = AuditOptionsSchema.shape

    // All fields should be optional (unwrap should succeed)
    Object.entries(shape).forEach(([_key, value]) => {
      expect(value.isOptional()).toBe(true)
    })
  })
})

// ============================================================================
// Integration with parse/safeParse Tests
// ============================================================================

describe('AuditOptionsSchema - parse vs safeParse', () => {
  describe('parse method', () => {
    it('should return parsed data for valid input', () => {
      const config = { auditTable: 'logs', captureOldValues: true }

      const result = AuditOptionsSchema.parse(config)

      expect(result.auditTable).toBe('logs')
      expect(result.captureOldValues).toBe(true)
    })

    it('should throw ZodError for invalid input', () => {
      const config = { auditTable: 123 }

      expect(() => AuditOptionsSchema.parse(config)).toThrow(z.ZodError)
    })

    it('should throw with message for invalid input', () => {
      const config = { captureOldValues: 'not-a-boolean' }

      expect(() => AuditOptionsSchema.parse(config)).toThrow()
    })
  })

  describe('safeParse method', () => {
    it('should return success: true for valid input', () => {
      const config = { tables: ['users', 'posts'] }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(true)
    })

    it('should return success: false for invalid input', () => {
      const config = { tables: 'not-an-array' }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
    })

    it('should provide error details for invalid input', () => {
      const config = { auditTable: [], captureOldValues: 'true' }

      const result = AuditOptionsSchema.safeParse(config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(z.ZodError)
        expect(result.error.issues.length).toBeGreaterThan(0)
      }
    })
  })
})

// ============================================================================
// Real-world Usage Scenarios Tests
// ============================================================================

describe('AuditOptionsSchema - Real-world Scenarios', () => {
  it('should validate typical production configuration', () => {
    let currentUserId: string | null = null

    const productionConfig = {
      auditTable: 'app_audit_logs',
      primaryKeyColumn: 'id',
      captureOldValues: true,
      captureNewValues: true,
      skipSystemOperations: false,
      tables: ['users', 'orders', 'products', 'payments'],
      excludeTables: ['sessions', 'cache_entries', 'job_queues'],
      getUserId: () => currentUserId,
      getTimestamp: () => new Date().toISOString(),
      metadata: () => ({
        service: 'api',
        version: '1.0.0',
        environment: 'production'
      })
    }

    const result = AuditOptionsSchema.safeParse(productionConfig)

    expect(result.success).toBe(true)
  })

  it('should validate minimal development configuration', () => {
    const devConfig = {
      captureOldValues: true,
      captureNewValues: true,
      getUserId: () => 'dev-user'
    }

    const result = AuditOptionsSchema.safeParse(devConfig)

    expect(result.success).toBe(true)
  })

  it('should validate multi-tenant SaaS configuration', () => {
    const getTenantContext = () => ({ tenantId: 'tenant-123', userId: 'user-456' })

    const saasConfig = {
      auditTable: 'tenant_audit_logs',
      primaryKeyColumn: 'uuid',
      captureOldValues: true,
      captureNewValues: true,
      skipSystemOperations: true,
      excludeTables: ['tenant_settings', 'feature_flags'],
      getUserId: () => getTenantContext().userId,
      metadata: () => ({
        tenant_id: getTenantContext().tenantId,
        timestamp: Date.now()
      })
    }

    const result = AuditOptionsSchema.safeParse(saasConfig)

    expect(result.success).toBe(true)
  })

  it('should validate compliance-focused configuration', () => {
    const complianceConfig = {
      auditTable: 'compliance_audit_trail',
      captureOldValues: true,
      captureNewValues: true,
      skipSystemOperations: false, // Audit everything for compliance
      tables: ['pii_data', 'financial_records', 'access_logs', 'consent_records'],
      getUserId: () => 'system',
      getTimestamp: () => new Date(),
      metadata: () => ({
        compliance_standard: 'GDPR',
        data_classification: 'confidential',
        retention_days: 2555 // 7 years
      })
    }

    const result = AuditOptionsSchema.safeParse(complianceConfig)

    expect(result.success).toBe(true)
  })
})
