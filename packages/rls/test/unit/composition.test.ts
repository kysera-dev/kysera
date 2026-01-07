/**
 * Policy Composition Tests
 *
 * Tests for reusable policy templates and composition functions.
 */

import { describe, it, expect } from 'vitest'
import {
  definePolicy,
  defineFilterPolicy,
  defineAllowPolicy,
  defineDenyPolicy,
  defineValidatePolicy,
  defineCombinedPolicy,
  createTenantIsolationPolicy,
  createOwnershipPolicy,
  createSoftDeletePolicy,
  createStatusAccessPolicy,
  createAdminPolicy,
  composePolicies,
  extendPolicy,
  overridePolicy,
  type ReusablePolicy
} from '../../src/composition/index.js'
import { allow, deny, filter, validate } from '../../src/policy/builder.js'
import type { PolicyEvaluationContext } from '../../src/policy/types.js'

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
    table: 'resources',
    operation: 'read',
    ...overrides
  }
}

// ============================================================================
// Core Policy Builder Tests
// ============================================================================

describe('Core Policy Builders', () => {
  describe('definePolicy', () => {
    it('should create a reusable policy template', () => {
      const policy = definePolicy(
        {
          name: 'testPolicy',
          description: 'A test policy',
          tags: ['test', 'example']
        },
        [
          filter('read', () => ({ status: 'active' })),
          allow('update', () => true)
        ]
      )

      expect(policy.name).toBe('testPolicy')
      expect(policy.description).toBe('A test policy')
      expect(policy.tags).toEqual(['test', 'example'])
      expect(policy.policies).toHaveLength(2)
    })

    it('should support minimal config', () => {
      const policy = definePolicy({ name: 'minimal' }, [])

      expect(policy.name).toBe('minimal')
      expect(policy.description).toBeUndefined()
      expect(policy.tags).toBeUndefined()
    })
  })

  describe('defineFilterPolicy', () => {
    it('should create a filter-only policy', () => {
      const policy = defineFilterPolicy('tenantFilter', ctx => ({
        tenant_id: ctx.auth.tenantId
      }))

      expect(policy.name).toBe('tenantFilter')
      expect(policy.policies).toHaveLength(1)
      expect(policy.policies[0]?.type).toBe('filter')
      expect(policy.policies[0]?.name).toBe('tenantFilter-filter')
    })

    it('should support priority option', () => {
      const policy = defineFilterPolicy('tenantFilter', ctx => ({
        tenant_id: ctx.auth.tenantId
      }), { priority: 100 })

      expect(policy.policies[0]?.priority).toBe(100)
    })
  })

  describe('defineAllowPolicy', () => {
    it('should create an allow-based policy', () => {
      const policy = defineAllowPolicy('ownerAccess', 'read', ctx =>
        ctx.auth.userId === (ctx.row as Record<string, unknown>)?.owner_id
      )

      expect(policy.name).toBe('ownerAccess')
      expect(policy.policies).toHaveLength(1)
      expect(policy.policies[0]?.type).toBe('allow')
      expect(policy.policies[0]?.name).toBe('ownerAccess-allow')
    })

    it('should support multiple operations', () => {
      const policy = defineAllowPolicy('ownerAccess', ['read', 'update'], () => true)

      expect(policy.policies[0]?.operation).toEqual(['read', 'update'])
    })
  })

  describe('defineDenyPolicy', () => {
    it('should create a deny-based policy', () => {
      const policy = defineDenyPolicy('noDelete', 'delete')

      expect(policy.name).toBe('noDelete')
      expect(policy.policies).toHaveLength(1)
      expect(policy.policies[0]?.type).toBe('deny')
      expect(policy.policies[0]?.name).toBe('noDelete-deny')
    })

    it('should support conditional deny', () => {
      const policy = defineDenyPolicy('noDeletePublished', 'delete', ctx =>
        (ctx.row as Record<string, unknown>)?.status === 'published'
      )

      const ctx = createCtx({ row: { status: 'published' } })
      expect(policy.policies[0]?.condition?.(ctx)).toBe(true)
    })

    it('should have default priority of 100', () => {
      const policy = defineDenyPolicy('noDelete', 'delete')

      expect(policy.policies[0]?.priority).toBe(100)
    })
  })

  describe('defineValidatePolicy', () => {
    it('should create a validation policy', () => {
      const policy = defineValidatePolicy('validateCreate', 'create', ctx =>
        (ctx.data as Record<string, unknown>)?.name !== undefined
      )

      expect(policy.name).toBe('validateCreate')
      expect(policy.policies).toHaveLength(1)
      expect(policy.policies[0]?.type).toBe('validate')
      expect(policy.policies[0]?.name).toBe('validateCreate-validate')
    })

    it('should support all operation (expanded to create and update)', () => {
      const policy = defineValidatePolicy('validateAll', 'all', () => true)

      // 'all' expands to ['create', 'update'] for validate policies
      expect(policy.policies[0]?.operation).toEqual(['create', 'update'])
    })
  })

  describe('defineCombinedPolicy', () => {
    it('should create a combined policy with multiple types', () => {
      const policy = defineCombinedPolicy('combined', {
        filter: ctx => ({ tenant_id: ctx.auth.tenantId }),
        allow: {
          read: ctx => ctx.auth.userId === (ctx.row as Record<string, unknown>)?.owner_id
        },
        deny: {
          delete: ctx => (ctx.row as Record<string, unknown>)?.status === 'protected'
        },
        validate: {
          create: ctx => (ctx.data as Record<string, unknown>)?.name !== undefined,
          update: ctx => (ctx.data as Record<string, unknown>)?.id === undefined
        }
      })

      expect(policy.name).toBe('combined')
      expect(policy.policies.length).toBeGreaterThanOrEqual(5)
      expect(policy.policies.some(p => p.type === 'filter')).toBe(true)
      expect(policy.policies.some(p => p.type === 'allow')).toBe(true)
      expect(policy.policies.some(p => p.type === 'deny')).toBe(true)
      expect(policy.policies.some(p => p.type === 'validate')).toBe(true)
    })

    it('should handle partial configs', () => {
      const policy = defineCombinedPolicy('filterOnly', {
        filter: () => ({ active: true })
      })

      expect(policy.policies).toHaveLength(1)
      expect(policy.policies[0]?.type).toBe('filter')
    })
  })
})

// ============================================================================
// Common Policy Patterns Tests
// ============================================================================

describe('Common Policy Patterns', () => {
  describe('createTenantIsolationPolicy', () => {
    it('should create tenant isolation policy with defaults', () => {
      const policy = createTenantIsolationPolicy()

      expect(policy.name).toBe('tenantIsolation')
      expect(policy.tags).toContain('multi-tenant')
      // 1 filter + 2 validate (create, update)
      expect(policy.policies).toHaveLength(3)
    })

    it('should filter by tenant_id', () => {
      const policy = createTenantIsolationPolicy()
      const filterPolicy = policy.policies.find(p => p.type === 'filter')

      expect(filterPolicy).toBeDefined()
      const ctx = createCtx()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const condition = (filterPolicy?.condition as any)(ctx)
      expect(condition).toEqual({ tenant_id: 'tenant-1' })
    })

    it('should support custom tenant column', () => {
      const policy = createTenantIsolationPolicy({ tenantColumn: 'organization_id' })
      const filterPolicy = policy.policies.find(p => p.type === 'filter')

      const ctx = createCtx()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const condition = (filterPolicy?.condition as any)(ctx)
      expect(condition).toEqual({ organization_id: 'tenant-1' })
    })

    it('should skip mutation validation when disabled', () => {
      const policy = createTenantIsolationPolicy({ validateOnMutation: false })

      expect(policy.policies).toHaveLength(1)
      expect(policy.policies[0]?.type).toBe('filter')
    })

    it('should validate tenant on create', () => {
      const policy = createTenantIsolationPolicy()
      // validate() wraps single operations in an array, so look for ['create']
      const validateCreate = policy.policies.find(p =>
        p.type === 'validate' && (
          p.operation === 'create' ||
          (Array.isArray(p.operation) && p.operation.includes('create') && !p.operation.includes('update'))
        )
      )

      expect(validateCreate).toBeDefined()

      const validCtx = createCtx({ data: { tenant_id: 'tenant-1' } })
      expect(validateCreate?.condition?.(validCtx)).toBe(true)

      const invalidCtx = createCtx({ data: { tenant_id: 'other-tenant' } })
      expect(validateCreate?.condition?.(invalidCtx)).toBe(false)
    })
  })

  describe('createOwnershipPolicy', () => {
    it('should create ownership policy with defaults', () => {
      const policy = createOwnershipPolicy()

      expect(policy.name).toBe('ownership')
      expect(policy.tags).toContain('ownership')
    })

    it('should allow owner to perform operations', () => {
      const policy = createOwnershipPolicy()
      const allowPolicy = policy.policies.find(p => p.type === 'allow')

      const ownerCtx = createCtx({ row: { owner_id: '123' } })
      expect(allowPolicy?.condition?.(ownerCtx)).toBe(true)

      const nonOwnerCtx = createCtx({ row: { owner_id: '456' } })
      expect(allowPolicy?.condition?.(nonOwnerCtx)).toBe(false)
    })

    it('should support custom owner column', () => {
      const policy = createOwnershipPolicy({ ownerColumn: 'user_id' })
      const allowPolicy = policy.policies.find(p => p.type === 'allow')

      const ownerCtx = createCtx({ row: { user_id: '123' } })
      expect(allowPolicy?.condition?.(ownerCtx)).toBe(true)
    })

    it('should restrict operations when canDelete is false', () => {
      const policy = createOwnershipPolicy({ canDelete: false })

      const denyPolicy = policy.policies.find(p => p.type === 'deny')
      expect(denyPolicy).toBeDefined()
      expect(denyPolicy?.operation).toBe('delete')
    })
  })

  describe('createSoftDeletePolicy', () => {
    it('should create soft delete policy with defaults', () => {
      const policy = createSoftDeletePolicy()

      expect(policy.name).toBe('softDelete')
      expect(policy.tags).toContain('soft-delete')
      expect(policy.policies).toHaveLength(2) // filter + deny delete
    })

    it('should filter out soft-deleted rows', () => {
      const policy = createSoftDeletePolicy()
      const filterPolicy = policy.policies.find(p => p.type === 'filter')

      const ctx = createCtx()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const condition = (filterPolicy?.condition as any)(ctx)
      expect(condition).toEqual({ deleted_at: null })
    })

    it('should prevent hard deletes', () => {
      const policy = createSoftDeletePolicy()
      const denyPolicy = policy.policies.find(p => p.type === 'deny')

      expect(denyPolicy?.operation).toBe('delete')
    })

    it('should support custom deleted column', () => {
      const policy = createSoftDeletePolicy({ deletedColumn: 'is_deleted' })
      const filterPolicy = policy.policies.find(p => p.type === 'filter')

      const ctx = createCtx()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const condition = (filterPolicy?.condition as any)(ctx)
      expect(condition).toEqual({ is_deleted: null })
    })

    it('should skip filter when filterOnRead is false', () => {
      const policy = createSoftDeletePolicy({ filterOnRead: false })

      expect(policy.policies).toHaveLength(1)
      expect(policy.policies[0]?.type).toBe('deny')
    })

    it('should allow hard delete when preventHardDelete is false', () => {
      const policy = createSoftDeletePolicy({ preventHardDelete: false })

      expect(policy.policies).toHaveLength(1)
      expect(policy.policies[0]?.type).toBe('filter')
    })
  })

  describe('createStatusAccessPolicy', () => {
    it('should create status-based access policy', () => {
      const policy = createStatusAccessPolicy({
        publicStatuses: ['published'],
        editableStatuses: ['draft'],
        deletableStatuses: ['draft', 'archived']
      })

      expect(policy.name).toBe('statusAccess')
      expect(policy.tags).toContain('status')
    })

    it('should allow public read for specified statuses', () => {
      const policy = createStatusAccessPolicy({
        publicStatuses: ['published', 'featured']
      })
      const allowPolicy = policy.policies.find(p => p.type === 'allow')

      const publishedCtx = createCtx({ row: { status: 'published' } })
      expect(allowPolicy?.condition?.(publishedCtx)).toBe(true)

      const draftCtx = createCtx({ row: { status: 'draft' } })
      expect(allowPolicy?.condition?.(draftCtx)).toBe(false)
    })

    it('should restrict updates to editable statuses', () => {
      const policy = createStatusAccessPolicy({
        editableStatuses: ['draft']
      })
      const denyPolicy = policy.policies.find(p => p.type === 'deny' && p.operation === 'update')

      const draftCtx = createCtx({ row: { status: 'draft' } })
      expect(denyPolicy?.condition?.(draftCtx)).toBe(false) // not denied

      const publishedCtx = createCtx({ row: { status: 'published' } })
      expect(denyPolicy?.condition?.(publishedCtx)).toBe(true) // denied
    })
  })

  describe('createAdminPolicy', () => {
    it('should create admin bypass policy', () => {
      const policy = createAdminPolicy(['admin', 'super_admin'])

      expect(policy.name).toBe('adminBypass')
      expect(policy.tags).toContain('admin')
    })

    it('should allow all operations for admin roles', () => {
      const policy = createAdminPolicy(['admin'])
      const allowPolicy = policy.policies[0]

      const adminCtx = createCtx({
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: ['admin'],
          isSystem: false
        }
      })
      expect(allowPolicy?.condition?.(adminCtx)).toBe(true)

      const userCtx = createCtx()
      expect(allowPolicy?.condition?.(userCtx)).toBe(false)
    })

    it('should apply to all operations', () => {
      const policy = createAdminPolicy(['admin'])

      expect(policy.policies[0]?.operation).toBe('all')
    })

    it('should have high priority', () => {
      const policy = createAdminPolicy(['admin'])

      expect(policy.policies[0]?.priority).toBe(500)
    })
  })
})

// ============================================================================
// Policy Composition Functions Tests
// ============================================================================

describe('Policy Composition Functions', () => {
  describe('composePolicies', () => {
    it('should combine multiple policies into one', () => {
      const tenantPolicy = createTenantIsolationPolicy()
      const ownerPolicy = createOwnershipPolicy()
      const softDeletePolicy = createSoftDeletePolicy()

      const composed = composePolicies('multiTenantOwnership', [
        tenantPolicy,
        ownerPolicy,
        softDeletePolicy
      ])

      expect(composed.name).toBe('multiTenantOwnership')
      expect(composed.description).toContain('tenantIsolation')
      expect(composed.description).toContain('ownership')
      expect(composed.description).toContain('softDelete')

      const totalPolicies =
        tenantPolicy.policies.length +
        ownerPolicy.policies.length +
        softDeletePolicy.policies.length
      expect(composed.policies).toHaveLength(totalPolicies)
    })

    it('should merge tags from all policies', () => {
      const policy1 = definePolicy({ name: 'p1', tags: ['a', 'b'] }, [])
      const policy2 = definePolicy({ name: 'p2', tags: ['b', 'c'] }, [])

      const composed = composePolicies('merged', [policy1, policy2])

      expect(composed.tags).toContain('a')
      expect(composed.tags).toContain('b')
      expect(composed.tags).toContain('c')
      expect(new Set(composed.tags).size).toBe(composed.tags?.length) // no duplicates
    })
  })

  describe('extendPolicy', () => {
    it('should extend a policy with additional rules', () => {
      const basePolicy = createTenantIsolationPolicy()
      const additionalPolicies = [
        deny('delete', () => true, { name: 'no-delete', priority: 200 })
      ]

      const extended = extendPolicy(basePolicy, additionalPolicies)

      expect(extended.name).toBe('tenantIsolation_extended')
      expect(extended.policies.length).toBe(basePolicy.policies.length + 1)
    })

    it('should preserve base policy metadata', () => {
      const basePolicy = definePolicy(
        { name: 'base', description: 'Base policy', tags: ['base'] },
        []
      )

      const extended = extendPolicy(basePolicy, [])

      expect(extended.description).toBe('Base policy')
      expect(extended.tags).toEqual(['base'])
    })
  })

  describe('overridePolicy', () => {
    it('should override specific policies by name', () => {
      const basePolicy = definePolicy(
        { name: 'base' },
        [
          filter('read', () => ({ status: 'active' }), { name: 'status-filter' }),
          allow('read', () => true, { name: 'read-allow' })
        ]
      )

      const newFilter = filter('read', () => ({ status: 'published' }), { name: 'status-filter' })

      const overridden = overridePolicy(basePolicy, {
        'status-filter': newFilter
      })

      expect(overridden.name).toBe('base_overridden')
      expect(overridden.policies).toHaveLength(2)

      // Check that the filter was replaced
      const statusFilter = overridden.policies.find(p => p.name === 'status-filter')
      const ctx = createCtx()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((statusFilter?.condition as any)(ctx)).toEqual({ status: 'published' })
    })

    it('should keep non-overridden policies intact', () => {
      const basePolicy = definePolicy(
        { name: 'base' },
        [
          filter('read', () => ({ status: 'active' }), { name: 'status-filter' }),
          allow('read', () => true, { name: 'read-allow' })
        ]
      )

      const overridden = overridePolicy(basePolicy, {
        'status-filter': filter('read', () => ({ status: 'new' }), { name: 'status-filter' })
      })

      const readAllow = overridden.policies.find(p => p.name === 'read-allow')
      expect(readAllow).toBeDefined()
      expect(readAllow?.condition?.(createCtx())).toBe(true)
    })
  })
})
