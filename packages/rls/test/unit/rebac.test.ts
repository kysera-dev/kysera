/**
 * ReBAC (Relationship-Based Access Control) Tests
 *
 * Tests for relationship-based filtering and query transformation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, DummyDriver } from 'kysely'
import { PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely'
import {
  ReBAcRegistry,
  createReBAcRegistry,
  ReBAcTransformer,
  createReBAcTransformer,
  allowRelation,
  denyRelation,
  orgMembershipPath,
  shopOrgMembershipPath,
  teamHierarchyPath,
  type RelationshipPath,
  type TableReBAcConfig
} from '../../src/rebac/index.js'
import { rlsContext } from '../../src/context/index.js'

// ============================================================================
// Test Database Schema
// ============================================================================

interface TestDB {
  products: {
    id: number
    name: string
    shop_id: number
    organization_id: number
    price: number
  }
  shops: {
    id: number
    name: string
    organization_id: number
  }
  organizations: {
    id: number
    name: string
  }
  employees: {
    id: number
    user_id: string
    organization_id: number
    status: string
  }
  teams: {
    id: number
    name: string
    parent_id: number | null
  }
  team_members: {
    id: number
    team_id: number
    user_id: string
  }
  tasks: {
    id: number
    title: string
    team_id: number
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function createTestDb(): Kysely<TestDB> {
  return new Kysely<TestDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: db => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  })
}

// ============================================================================
// Predefined Relationship Path Tests
// ============================================================================

describe('Predefined Relationship Paths', () => {
  describe('orgMembershipPath', () => {
    it('should create correct organization membership path', () => {
      const path = orgMembershipPath('products', 'organization_id')

      expect(path.name).toBe('products_org_membership')
      expect(path.description).toBeDefined()
      expect(path.steps).toHaveLength(2)
      expect(path.steps[0]?.from).toBe('products')
      expect(path.steps[0]?.to).toBe('organizations')
      expect(path.steps[0]?.fromColumn).toBe('organization_id')
      expect(path.steps[1]?.to).toBe('employees')
    })

    it('should support custom organization column', () => {
      const path = orgMembershipPath('products', 'org_id')

      expect(path.steps[0]?.fromColumn).toBe('org_id')
      expect(path.name).toBe('products_org_membership')
    })
  })

  describe('shopOrgMembershipPath', () => {
    it('should create correct shop organization membership path', () => {
      const path = shopOrgMembershipPath('products', 'shop_id')

      expect(path.name).toBe('products_shop_org_membership')
      expect(path.steps).toHaveLength(3)
      expect(path.steps[0]?.from).toBe('products')
      expect(path.steps[0]?.to).toBe('shops')
      expect(path.steps[1]?.to).toBe('organizations')
      expect(path.steps[2]?.to).toBe('employees')
    })

    it('should support custom shop column', () => {
      const path = shopOrgMembershipPath('products', 'store_id')

      expect(path.steps[0]?.fromColumn).toBe('store_id')
    })
  })

  describe('teamHierarchyPath', () => {
    it('should create correct team hierarchy path', () => {
      const path = teamHierarchyPath('tasks', 'team_id')

      expect(path.name).toBe('tasks_team_access')
      expect(path.steps).toHaveLength(2)
      expect(path.steps[0]?.from).toBe('tasks')
      expect(path.steps[0]?.to).toBe('teams')
      expect(path.steps[1]?.to).toBe('team_members')
    })

    it('should support custom team column', () => {
      const path = teamHierarchyPath('tasks', 'assigned_team_id')

      expect(path.steps[0]?.fromColumn).toBe('assigned_team_id')
    })
  })
})

// ============================================================================
// ReBAC Policy Builder Tests
// ============================================================================

describe('ReBAC Policy Builders', () => {
  describe('allowRelation', () => {
    it('should create allow policy with function end condition', () => {
      const policy = allowRelation(
        'read',
        'org_membership',
        ctx => ({
          user_id: ctx.auth.userId,
          status: 'active'
        })
      )

      expect(policy.type).toBe('filter')
      expect(policy.policyType).toBe('allow')
      expect(policy.operation).toBe('read')
      expect(policy.relationshipPath).toBe('org_membership')
      expect(typeof policy.endCondition).toBe('function')
    })

    it('should create allow policy with static end condition', () => {
      const policy = allowRelation('read', 'org_membership', {
        status: 'active'
      })

      expect(policy.policyType).toBe('allow')
      expect(policy.endCondition).toEqual({ status: 'active' })
    })

    it('should support multiple operations', () => {
      const policy = allowRelation(
        ['read', 'update'],
        'org_membership',
        ctx => ({ user_id: ctx.auth.userId })
      )

      expect(policy.operation).toEqual(['read', 'update'])
    })

    it('should support options', () => {
      const policy = allowRelation(
        'read',
        'org_membership',
        { status: 'active' },
        { name: 'custom-policy', priority: 100 }
      )

      expect(policy.name).toBe('custom-policy')
      expect(policy.priority).toBe(100)
    })
  })

  describe('denyRelation', () => {
    it('should create deny policy', () => {
      const policy = denyRelation(
        'delete',
        'org_membership',
        ctx => ({
          user_id: ctx.auth.userId,
          status: 'blocked'
        })
      )

      expect(policy.type).toBe('filter')
      expect(policy.policyType).toBe('deny')
      expect(policy.operation).toBe('delete')
    })

    it('should have higher default priority', () => {
      const policy = denyRelation(
        'read',
        'org_membership',
        { status: 'blocked' }
      )

      expect(policy.priority).toBe(100)
    })
  })
})

// ============================================================================
// ReBAC Registry Tests
// ============================================================================

describe('ReBAcRegistry', () => {
  let registry: ReBAcRegistry<TestDB>

  beforeEach(() => {
    registry = createReBAcRegistry<TestDB>()
  })

  describe('registerRelationship', () => {
    it('should register a global relationship path', () => {
      const path: RelationshipPath = {
        name: 'test_path',
        steps: [
          {
            from: 'products',
            to: 'shops',
            fromColumn: 'shop_id',
            toColumn: 'id'
          }
        ]
      }

      registry.registerRelationship(path)

      expect(registry.getRelationship('test_path')).toBeDefined()
      expect(registry.getRelationship('test_path')?.name).toBe('test_path')
    })

    it('should throw on empty steps', () => {
      const path: RelationshipPath = {
        name: 'empty_path',
        steps: []
      }

      expect(() => registry.registerRelationship(path)).toThrow()
    })
  })

  describe('registerTable', () => {
    it('should register a table configuration', () => {
      const path = shopOrgMembershipPath('products', 'shop_id')
      const config: TableReBAcConfig = {
        relationships: [path],
        policies: [
          allowRelation('read', path.name, { status: 'active' })
        ]
      }

      registry.registerTable('products', config)

      expect(registry.hasTable('products')).toBe(true)
      expect(registry.getTables()).toContain('products')
    })

    it('should throw when policy references unknown path', () => {
      const config: TableReBAcConfig = {
        relationships: [],
        policies: [
          allowRelation('read', 'unknown_path', { status: 'active' })
        ]
      }

      expect(() => registry.registerTable('products', config)).toThrow()
    })
  })

  describe('getPolicies', () => {
    beforeEach(() => {
      const path = shopOrgMembershipPath('products', 'shop_id')
      registry.registerTable('products', {
        relationships: [path],
        policies: [
          allowRelation('read', path.name, { status: 'active' }),
          allowRelation('update', path.name, { status: 'active' }),
          allowRelation('all', path.name, { status: 'active' })
        ]
      })
    })

    it('should return policies matching table and operation', () => {
      const readPolicies = registry.getPolicies('products', 'read')
      expect(readPolicies.length).toBeGreaterThanOrEqual(2) // read + all

      const updatePolicies = registry.getPolicies('products', 'update')
      expect(updatePolicies.length).toBeGreaterThanOrEqual(2) // update + all

      const deletePolicies = registry.getPolicies('products', 'delete')
      expect(deletePolicies.length).toBeGreaterThanOrEqual(1) // only all
    })

    it('should return empty array for unconfigured tables', () => {
      expect(registry.getPolicies('unknown_table' as keyof TestDB, 'read')).toEqual([])
    })
  })

  describe('getRelationship', () => {
    it('should get table-specific relationship', () => {
      const path = shopOrgMembershipPath('products', 'shop_id')
      registry.registerTable('products', {
        relationships: [path],
        policies: []
      })

      const compiled = registry.getRelationship(path.name, 'products')

      expect(compiled).toBeDefined()
      expect(compiled?.name).toBe(path.name)
      expect(compiled?.steps).toHaveLength(3)
    })

    it('should fall back to global relationship', () => {
      const path: RelationshipPath = {
        name: 'global_path',
        steps: [
          { from: 'products', to: 'shops', fromColumn: 'shop_id', toColumn: 'id' },
          { from: 'shops', to: 'organizations', fromColumn: 'organization_id', toColumn: 'id' }
        ]
      }

      registry.registerRelationship(path)

      const compiled = registry.getRelationship('global_path')

      expect(compiled).toBeDefined()
      expect(compiled?.steps).toHaveLength(2)
    })

    it('should return undefined for unknown path', () => {
      expect(registry.getRelationship('unknown')).toBeUndefined()
    })
  })

  describe('clear', () => {
    it('should remove all registrations', () => {
      const path = shopOrgMembershipPath('products', 'shop_id')
      registry.registerTable('products', {
        relationships: [path],
        policies: []
      })

      registry.clear()

      expect(registry.hasTable('products')).toBe(false)
      expect(registry.getTables()).toHaveLength(0)
    })
  })
})

// ============================================================================
// ReBAC Transformer Tests
// ============================================================================

describe('ReBAcTransformer', () => {
  let db: Kysely<TestDB>
  let registry: ReBAcRegistry<TestDB>
  let transformer: ReBAcTransformer<TestDB>

  beforeEach(() => {
    db = createTestDb()
    registry = createReBAcRegistry<TestDB>()

    // Register a path and policy using the correct API
    const path = shopOrgMembershipPath('products', 'shop_id')
    registry.registerTable('products', {
      relationships: [path],
      policies: [
        allowRelation('read', path.name, ctx => ({
          user_id: ctx.auth.userId,
          status: 'active'
        }))
      ]
    })

    transformer = createReBAcTransformer(registry)
  })

  afterEach(async () => {
    await db.destroy()
  })

  describe('generateExistsSql', () => {
    it('should generate EXISTS SQL for allow policy', () => {
      const policy = registry.getPolicies('products', 'read')[0]!
      const ctx = {
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: [],
          isSystem: false
        }
      }

      const { sql, params } = transformer.generateExistsSql(
        policy,
        ctx,
        'products',
        'p'
      )

      expect(sql).toContain('EXISTS')
      expect(sql).toContain('"shops"')
      expect(sql).toContain('"organizations"')
      expect(sql).toContain('"employees"')
      expect(params).toContain('123')
      expect(params).toContain('active')
    })

    it('should generate NOT EXISTS SQL for deny policy', () => {
      const path = shopOrgMembershipPath('products', 'shop_id')
      const denyRegistry = createReBAcRegistry<TestDB>()
      denyRegistry.registerTable('products', {
        relationships: [path],
        policies: [
          denyRelation('read', path.name, ctx => ({
            user_id: ctx.auth.userId,
            status: 'blocked'
          }))
        ]
      })

      const denyTransformer = createReBAcTransformer(denyRegistry)
      const policies = denyRegistry.getPolicies('products', 'read')
      const denyPolicy = policies.find(p => p.type === 'deny')!

      const ctx = {
        auth: {
          userId: '123',
          tenantId: 'tenant-1',
          roles: [],
          isSystem: false
        }
      }

      const { sql } = denyTransformer.generateExistsSql(
        denyPolicy,
        ctx,
        'products',
        'p'
      )

      expect(sql).toContain('NOT EXISTS')
    })
  })

  describe('transform', () => {
    it('should return query unchanged when no context', () => {
      const query = db.selectFrom('products').selectAll()

      const result = transformer.transform(query, 'products', 'read')

      // Query should be the same object (no transformation)
      expect(result).toBe(query)
    })

    it('should return query unchanged for system users', () => {
      rlsContext.run(
        {
          auth: {
            userId: 'system',
            tenantId: 'tenant-1',
            roles: ['admin'],
            isSystem: true
          }
        },
        () => {
          const query = db.selectFrom('products').selectAll()
          const result = transformer.transform(query, 'products', 'read')

          expect(result).toBe(query)
        }
      )
    })

    it('should return query unchanged for tables without policies', () => {
      rlsContext.run(
        {
          auth: {
            userId: '123',
            tenantId: 'tenant-1',
            roles: [],
            isSystem: false
          }
        },
        () => {
          const query = db.selectFrom('shops').selectAll()
          const result = transformer.transform(query, 'shops', 'read')

          expect(result).toBe(query)
        }
      )
    })

    it('should transform query for regular users', () => {
      rlsContext.run(
        {
          auth: {
            userId: '123',
            tenantId: 'tenant-1',
            roles: ['user'],
            isSystem: false
          }
        },
        () => {
          const query = db.selectFrom('products').selectAll()
          const result = transformer.transform(query, 'products', 'read')

          // Query should be transformed (different object)
          expect(result).not.toBe(query)

          // Compile and check the SQL
          const compiled = result.compile()
          expect(compiled.sql.toLowerCase()).toContain('exists')
        }
      )
    })
  })

  describe('dialect support', () => {
    it('should generate PostgreSQL-style parameters', () => {
      const pgTransformer = createReBAcTransformer(registry, { dialect: 'postgres' })
      const policy = registry.getPolicies('products', 'read')[0]!

      const ctx = {
        auth: { userId: '123', tenantId: 'tenant-1', roles: [], isSystem: false }
      }

      const { sql } = pgTransformer.generateExistsSql(policy, ctx, 'products')

      expect(sql).toContain('$1')
    })

    it('should generate MySQL-style parameters', () => {
      const mysqlTransformer = createReBAcTransformer(registry, { dialect: 'mysql' })
      const policy = registry.getPolicies('products', 'read')[0]!

      const ctx = {
        auth: { userId: '123', tenantId: 'tenant-1', roles: [], isSystem: false }
      }

      const { sql } = mysqlTransformer.generateExistsSql(policy, ctx, 'products')

      expect(sql).toContain('?')
      expect(sql).not.toContain('$')
    })
  })
})
