/**
 * Field-Level Access Control Tests
 *
 * Tests for column-level permissions with masking.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FieldAccessRegistry,
  createFieldAccessRegistry,
  FieldAccessProcessor,
  createFieldAccessProcessor,
  neverAccessible,
  ownerOnly,
  ownerOrRoles,
  rolesOnly,
  readOnly,
  publicReadRestrictedWrite,
  maskedField,
  type FieldAccessSchema
} from '../../src/field-access/index.js'
import type { PolicyEvaluationContext, RLSContext } from '../../src/policy/types.js'
import { rlsContext } from '../../src/context/manager.js'

// ============================================================================
// Test Database Schema
// ============================================================================

interface User {
  id: number
  email: string
  phone: string
  password_hash: string
  mfa_secret: string
  display_name: string
  bio: string
  internal_notes: string
  created_at: Date
}

interface TestDB {
  users: User
}

// ============================================================================
// Helper Functions
// ============================================================================

function createCtx(overrides: Partial<PolicyEvaluationContext> = {}): PolicyEvaluationContext {
  return {
    auth: {
      userId: '123',
      tenantId: 'tenant-1',
      roles: ['user'],
      isSystem: false
    },
    table: 'users',
    operation: 'read',
    ...overrides
  }
}

function createRLSCtx(overrides: Partial<RLSContext> = {}): RLSContext {
  return {
    auth: {
      userId: '123',
      tenantId: 'tenant-1',
      roles: ['user'],
      isSystem: false
    },
    ...overrides
  }
}

// ============================================================================
// Predefined Field Patterns Tests
// ============================================================================

describe('Predefined Field Patterns', () => {
  describe('neverAccessible', () => {
    it('should always deny read and write', async () => {
      const config = neverAccessible()

      const ctx = createCtx()
      expect(config.read!(ctx)).toBe(false)
      expect(config.write!(ctx)).toBe(false)
    })

    it('should set omitWhenHidden to true', () => {
      const config = neverAccessible()

      expect(config.omitWhenHidden).toBe(true)
    })
  })

  describe('ownerOnly', () => {
    it('should allow access to owner', () => {
      const config = ownerOnly('id')
      const ctx = createCtx({
        row: { id: '123' }
      })

      expect(config.read!(ctx)).toBe(true)
      expect(config.write!(ctx)).toBe(true)
    })

    it('should deny access to non-owner', () => {
      const config = ownerOnly('id')
      const ctx = createCtx({
        row: { id: '456' }
      })

      expect(config.read!(ctx)).toBe(false)
      expect(config.write!(ctx)).toBe(false)
    })

    it('should use default id column', () => {
      const config = ownerOnly()
      const ctx = createCtx({
        row: { id: '123' }
      })

      expect(config.read!(ctx)).toBe(true)
    })
  })

  describe('ownerOrRoles', () => {
    it('should allow access to owner', () => {
      const config = ownerOrRoles(['admin'], 'id')
      const ctx = createCtx({
        row: { id: '123' }
      })

      expect(config.read!(ctx)).toBe(true)
      expect(config.write!(ctx)).toBe(true)
    })

    it('should allow access to users with specified roles', () => {
      const config = ownerOrRoles(['admin', 'support'], 'id')
      const ctx = createCtx({
        auth: {
          userId: '999',
          tenantId: 'tenant-1',
          roles: ['admin'],
          isSystem: false
        },
        row: { id: '123' }
      })

      expect(config.read!(ctx)).toBe(true)
      expect(config.write!(ctx)).toBe(true)
    })

    it('should deny access to non-owner without roles', () => {
      const config = ownerOrRoles(['admin'], 'id')
      const ctx = createCtx({
        row: { id: '456' }
      })

      expect(config.read!(ctx)).toBe(false)
      expect(config.write!(ctx)).toBe(false)
    })
  })

  describe('rolesOnly', () => {
    it('should allow access to users with specified roles', () => {
      const config = rolesOnly(['admin', 'moderator'])
      const ctx = createCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['admin'],
          isSystem: false
        }
      })

      expect(config.read!(ctx)).toBe(true)
      expect(config.write!(ctx)).toBe(true)
    })

    it('should deny access to users without specified roles', () => {
      const config = rolesOnly(['admin'])
      const ctx = createCtx()

      expect(config.read!(ctx)).toBe(false)
      expect(config.write!(ctx)).toBe(false)
    })
  })

  describe('readOnly', () => {
    it('should allow read but deny write', () => {
      const config = readOnly()
      const ctx = createCtx()

      expect(config.read!(ctx)).toBe(true)
      expect(config.write!(ctx)).toBe(false)
    })

    it('should support custom read condition', () => {
      const config = readOnly(ctx => ctx.auth.roles.includes('viewer'))
      const ctx = createCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['viewer'],
          isSystem: false
        }
      })

      expect(config.read!(ctx)).toBe(true)

      const ctxWithoutRole = createCtx()
      expect(config.read!(ctxWithoutRole)).toBe(false)
    })
  })

  describe('publicReadRestrictedWrite', () => {
    it('should allow public read', () => {
      const config = publicReadRestrictedWrite(() => false)
      const ctx = createCtx()

      expect(config.read!(ctx)).toBe(true)
    })

    it('should apply write condition', () => {
      const config = publicReadRestrictedWrite(ctx => ctx.auth.userId === (ctx.row as Record<string, unknown>)?.id)

      const ownerCtx = createCtx({ row: { id: '123' } })
      expect(config.write!(ownerCtx)).toBe(true)

      const nonOwnerCtx = createCtx({ row: { id: '456' } })
      expect(config.write!(nonOwnerCtx)).toBe(false)
    })
  })

  describe('maskedField', () => {
    it('should return mask function', () => {
      const config = maskedField(
        (value) => (value as string).replace(/./g, '*'),
        () => false
      )

      expect(config.maskFn).toBeDefined()
      expect(config.maskFn('secret')).toBe('******')
    })

    it('should apply read condition', () => {
      const config = maskedField(
        (value) => (value as string).replace(/./g, '*'),
        ctx => ctx.auth.roles.includes('admin')
      )

      const adminCtx = createCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['admin'],
          isSystem: false
        }
      })
      expect(config.read!(adminCtx)).toBe(true)

      const userCtx = createCtx()
      expect(config.read!(userCtx)).toBe(false)
    })
  })
})

// ============================================================================
// FieldAccessRegistry Tests
// ============================================================================

describe('FieldAccessRegistry', () => {
  let registry: FieldAccessRegistry<TestDB>

  const schema: FieldAccessSchema<TestDB> = {
    users: {
      default: 'allow',
      fields: {
        email: ownerOnly('id'),
        phone: ownerOnly('id'),
        password_hash: neverAccessible(),
        mfa_secret: neverAccessible(),
        internal_notes: rolesOnly(['admin'])
      }
    }
  }

  beforeEach(() => {
    registry = createFieldAccessRegistry(schema)
  })

  describe('getTableConfig', () => {
    it('should return compiled table config', () => {
      const config = registry.getTableConfig('users')

      expect(config).toBeDefined()
      expect(config?.table).toBe('users')
      expect(config?.defaultAccess).toBe('allow')
    })

    it('should return undefined for unconfigured tables', () => {
      const config = registry.getTableConfig('unknown' as keyof TestDB)

      expect(config).toBeUndefined()
    })
  })

  describe('getFieldConfig', () => {
    it('should return compiled field config', () => {
      const config = registry.getFieldConfig('users', 'email')

      expect(config).toBeDefined()
      expect(config?.field).toBe('email')
    })

    it('should return undefined for unconfigured fields', () => {
      const config = registry.getFieldConfig('users', 'created_at')

      expect(config).toBeUndefined()
    })
  })

  describe('hasTable / getConfiguredFields', () => {
    it('should check if table has config', () => {
      expect(registry.hasTable('users')).toBe(true)
      expect(registry.hasTable('unknown' as keyof TestDB)).toBe(false)
    })

    it('should return configured field names', () => {
      const fields = registry.getConfiguredFields('users')

      expect(fields).toContain('email')
      expect(fields).toContain('password_hash')
      expect(fields).not.toContain('created_at')
    })
  })

  describe('canReadField', () => {
    it('should allow reading owned fields', async () => {
      const ctx = createCtx({ row: { id: '123' } })

      const canRead = await registry.canReadField('users', 'email', ctx)

      expect(canRead).toBe(true)
    })

    it('should deny reading non-owned fields', async () => {
      const ctx = createCtx({ row: { id: '456' } })

      const canRead = await registry.canReadField('users', 'email', ctx)

      expect(canRead).toBe(false)
    })

    it('should deny reading never accessible fields', async () => {
      const ctx = createCtx({ row: { id: '123' } })

      const canRead = await registry.canReadField('users', 'password_hash', ctx)

      expect(canRead).toBe(false)
    })

    it('should allow reading unconfigured fields when default is allow', async () => {
      const ctx = createCtx()

      const canRead = await registry.canReadField('users', 'bio', ctx)

      expect(canRead).toBe(true)
    })
  })

  describe('canWriteField', () => {
    it('should allow writing owned fields', async () => {
      const ctx = createCtx({
        operation: 'update',
        row: { id: '123' }
      })

      const canWrite = await registry.canWriteField('users', 'email', ctx)

      expect(canWrite).toBe(true)
    })

    it('should deny writing never accessible fields', async () => {
      const ctx = createCtx({ row: { id: '123' } })

      const canWrite = await registry.canWriteField('users', 'password_hash', ctx)

      expect(canWrite).toBe(false)
    })
  })

  describe('skipFor', () => {
    it('should support skipFor roles', async () => {
      const schemaWithSkip: FieldAccessSchema<TestDB> = {
        users: {
          default: 'deny',
          skipFor: ['super_admin'],
          fields: {
            email: ownerOnly('id')
          }
        }
      }

      const registryWithSkip = createFieldAccessRegistry(schemaWithSkip)
      const config = registryWithSkip.getTableConfig('users')

      expect(config?.skipFor).toContain('super_admin')

      // skipFor role should bypass checks
      const ctx = createCtx({
        auth: {
          userId: '999',
          tenantId: 'tenant-1',
          roles: ['super_admin'],
          isSystem: false
        },
        row: { id: '123' }
      })

      const canRead = await registryWithSkip.canReadField('users', 'email', ctx)
      expect(canRead).toBe(true)
    })
  })
})

// ============================================================================
// FieldAccessProcessor Tests
// ============================================================================

describe('FieldAccessProcessor', () => {
  let registry: FieldAccessRegistry<TestDB>
  let processor: FieldAccessProcessor<TestDB>

  const schema: FieldAccessSchema<TestDB> = {
    users: {
      default: 'allow',
      skipFor: ['super_admin'],
      fields: {
        email: ownerOnly('id'),
        phone: ownerOnly('id'),
        password_hash: neverAccessible(),
        mfa_secret: {
          read: () => false,
          omitWhenHidden: true
        },
        internal_notes: rolesOnly(['admin']),
        display_name: publicReadRestrictedWrite(ctx => ctx.auth.userId === (ctx.row as Record<string, unknown>)?.id)
      }
    }
  }

  beforeEach(() => {
    registry = createFieldAccessRegistry(schema)
    processor = createFieldAccessProcessor(registry)
  })

  describe('maskRow', () => {
    it('should mask inaccessible fields', async () => {
      const rlsCtx = createRLSCtx()
      const row: Partial<User> = {
        id: 456 as unknown as number,
        email: 'user@example.com',
        phone: '123-456-7890',
        display_name: 'Test User',
        bio: 'A test user'
      }

      const result = await rlsContext.run(rlsCtx, async () => {
        return processor.maskRow('users', row)
      })

      expect(result.data.id).toBe(456)
      expect(result.data.email).toBeNull() // masked
      expect(result.data.phone).toBeNull() // masked
      expect(result.data.display_name).toBe('Test User')
      expect(result.data.bio).toBe('A test user')
      expect(result.maskedFields).toContain('email')
      expect(result.maskedFields).toContain('phone')
    })

    it('should omit fields when omitWhenHidden is true', async () => {
      const rlsCtx = createRLSCtx()
      const row: Partial<User> = {
        id: 456 as unknown as number,
        mfa_secret: 'ABCDEF123456',
        display_name: 'Test User'
      }

      const result = await rlsContext.run(rlsCtx, async () => {
        return processor.maskRow('users', row)
      })

      expect(result.data.mfa_secret).toBeUndefined()
      expect(result.omittedFields).toContain('mfa_secret')
    })

    it('should not mask for owner', async () => {
      const rlsCtx = createRLSCtx({
        auth: {
          userId: '123', // String userId
          tenantId: 'tenant-1',
          roles: ['user'],
          isSystem: false
        }
      })
      // Use string id to match string userId for owner comparison
      const row = {
        id: '123', // String to match ctx.auth.userId
        email: 'user@example.com',
        phone: '123-456-7890',
        display_name: 'Test User'
      }

      const result = await rlsContext.run(rlsCtx, async () => {
        return processor.maskRow('users', row)
      })

      // Owner check compares ctx.auth.userId === row.id
      expect(result.data.email).toBe('user@example.com')
      expect(result.data.phone).toBe('123-456-7890')
      expect(result.maskedFields).toHaveLength(0)
    })

    it('should bypass processing for skipFor roles', async () => {
      const rlsCtx = createRLSCtx({
        auth: {
          userId: '999',
          tenantId: 'tenant-1',
          roles: ['super_admin'],
          isSystem: false
        }
      })
      const row: Partial<User> = {
        id: 456 as unknown as number,
        email: 'user@example.com',
        password_hash: 'hashed_password',
        mfa_secret: 'ABCDEF123456'
      }

      const result = await rlsContext.run(rlsCtx, async () => {
        return processor.maskRow('users', row)
      })

      expect(result.data.email).toBe('user@example.com')
      expect(result.data.password_hash).toBe('hashed_password')
      expect(result.data.mfa_secret).toBe('ABCDEF123456')
      expect(result.maskedFields).toHaveLength(0)
      expect(result.omittedFields).toHaveLength(0)
    })

    it('should bypass processing for system users', async () => {
      const rlsCtx = createRLSCtx({
        auth: {
          userId: 'system',
          tenantId: 'tenant-1',
          roles: [],
          isSystem: true
        }
      })
      const row: Partial<User> = {
        id: 456 as unknown as number,
        email: 'user@example.com',
        password_hash: 'hashed_password',
        mfa_secret: 'ABCDEF123456'
      }

      const result = await rlsContext.run(rlsCtx, async () => {
        return processor.maskRow('users', row)
      })

      expect(result.data.email).toBe('user@example.com')
      expect(result.data.password_hash).toBe('hashed_password')
      expect(result.data.mfa_secret).toBe('ABCDEF123456')
      expect(result.maskedFields).toHaveLength(0)
    })
  })

  describe('maskRows', () => {
    it('should process multiple rows', async () => {
      const rlsCtx = createRLSCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['user'],
          isSystem: false
        }
      })
      // Use string ids to match string userId for owner comparison
      const rows = [
        { id: '123', email: 'user1@example.com' },
        { id: '456', email: 'user2@example.com' }
      ]

      const results = await rlsContext.run(rlsCtx, async () => {
        return processor.maskRows('users', rows)
      })

      expect(results).toHaveLength(2)
      // First row is owned by user 123
      expect(results[0]?.data.email).toBe('user1@example.com')
      // Second row is not owned
      expect(results[1]?.data.email).toBeNull()
    })
  })

  describe('validateWrite', () => {
    it('should validate writable fields', async () => {
      const rlsCtx = createRLSCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['user'],
          isSystem: false
        }
      })

      // Writing to an owned field should work
      await expect(
        rlsContext.run(rlsCtx, async () => {
          return processor.validateWrite('users', { display_name: 'New Name' }, { id: '123' })
        })
      ).resolves.toBeUndefined()
    })

    it('should throw on unwritable fields', async () => {
      const rlsCtx = createRLSCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['user'],
          isSystem: false
        }
      })

      // Writing to password_hash should fail
      await expect(
        rlsContext.run(rlsCtx, async () => {
          return processor.validateWrite('users', { password_hash: 'new_hash' }, { id: '123' })
        })
      ).rejects.toThrow()
    })
  })

  describe('options', () => {
    it('should respect includeFields option', async () => {
      const rlsCtx = createRLSCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['user'],
          isSystem: false
        }
      })
      const row: Partial<User> = {
        id: 123 as unknown as number,
        email: 'user@example.com',
        phone: '123-456-7890',
        bio: 'Test bio'
      }

      const result = await rlsContext.run(rlsCtx, async () => {
        return processor.maskRow('users', row, {
          includeFields: ['id', 'email']
        })
      })

      expect(Object.keys(result.data)).toEqual(['id', 'email'])
    })

    it('should respect excludeFields option', async () => {
      const rlsCtx = createRLSCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['user'],
          isSystem: false
        }
      })
      const row: Partial<User> = {
        id: 123 as unknown as number,
        email: 'user@example.com',
        phone: '123-456-7890',
        bio: 'Test bio'
      }

      const result = await rlsContext.run(rlsCtx, async () => {
        return processor.maskRow('users', row, {
          excludeFields: ['bio']
        })
      })

      expect(result.data.bio).toBeUndefined()
    })
  })

  describe('getReadableFields / getWritableFields', () => {
    it('should return readable fields for owner', async () => {
      const rlsCtx = createRLSCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['user'],
          isSystem: false
        }
      })
      // Use string id to match string userId for owner comparison
      const row = {
        id: '123',
        email: 'user@example.com',
        bio: 'Test bio'
      }

      const readableFields = await rlsContext.run(rlsCtx, async () => {
        return processor.getReadableFields('users', row as Record<string, unknown>)
      })

      expect(readableFields).toContain('id')
      expect(readableFields).toContain('email')
      expect(readableFields).toContain('bio')
    })

    it('should return writable fields', async () => {
      const rlsCtx = createRLSCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['user'],
          isSystem: false
        }
      })
      // Use string id to match string userId for owner comparison
      const row = {
        id: '123',
        email: 'user@example.com',
        password_hash: 'hash',
        bio: 'Test bio'
      }

      const writableFields = await rlsContext.run(rlsCtx, async () => {
        return processor.getWritableFields('users', row as Record<string, unknown>)
      })

      expect(writableFields).toContain('email') // owner can write
      expect(writableFields).toContain('bio') // default allow
      expect(writableFields).not.toContain('password_hash') // never accessible
    })
  })
})
