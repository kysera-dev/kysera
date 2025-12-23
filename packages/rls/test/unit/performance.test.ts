import { describe, it, expect, beforeEach } from 'vitest'
import { MutationGuard } from '../../src/transformer/mutation.js'
import { PolicyRegistry } from '../../src/policy/registry.js'
import { defineRLSSchema, allow } from '../../src/policy/index.js'
import { rlsContext, createRLSContext } from '../../src/context/index.js'

interface TestDB {
  resources: {
    id: number
    owner_id: number
    tenant_id: number
    status: string
  }
}

describe('RLS Performance', () => {
  let registry: PolicyRegistry<TestDB>
  let guard: MutationGuard<TestDB>

  beforeEach(() => {
    const schema = defineRLSSchema<TestDB>({
      resources: {
        policies: [
          // Simple tenant-based filtering
          allow('read', ctx => ctx.auth.tenantId === ctx.row?.tenant_id),
          // Allow admins to read all
          allow('all', ctx => ctx.auth.roles.includes('admin'))
        ]
      }
    })

    registry = new PolicyRegistry<TestDB>(schema)
    guard = new MutationGuard<TestDB>(registry)
  })

  describe('filterRows parallel processing', () => {
    it('should filter many rows efficiently with parallel processing', async () => {
      const rows = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        owner_id: i % 100,
        tenant_id: i % 10,
        status: 'active'
      }))

      const ctx = createRLSContext({
        auth: { userId: 1, tenantId: 5, roles: ['user'] }
      })

      await rlsContext.runAsync(ctx, async () => {
        const start = performance.now()
        const filtered = await guard.filterRows('resources', rows)
        const duration = performance.now() - start

        // Should complete in reasonable time (< 5s for 1000 rows)
        expect(duration).toBeLessThan(5000)

        // Should filter correctly (only rows with tenant_id === 5)
        expect(filtered.length).toBe(100) // 1000 rows / 10 tenants = 100 per tenant
        expect(filtered.every(r => r.tenant_id === 5)).toBe(true)
      })
    })

    it('should handle empty array', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, tenantId: 1, roles: ['user'] }
      })

      await rlsContext.runAsync(ctx, async () => {
        const filtered = await guard.filterRows('resources', [])
        expect(filtered).toEqual([])
      })
    })

    it('should respect custom chunk size', async () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        owner_id: i,
        tenant_id: i % 5,
        status: 'active'
      }))

      const ctx = createRLSContext({
        auth: { userId: 1, tenantId: 0, roles: ['user'] }
      })

      await rlsContext.runAsync(ctx, async () => {
        // With small chunk size to test chunking behavior
        const filtered = await guard.filterRows('resources', rows, 10)

        // Should filter correctly with custom chunk size
        expect(filtered.length).toBe(10) // 50 rows / 5 tenants = 10 per tenant
        expect(filtered.every(r => r.tenant_id === 0)).toBe(true)
      })
    })

    it('should process all rows for admin user efficiently', async () => {
      const rows = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        owner_id: i % 50,
        tenant_id: i % 10,
        status: 'active'
      }))

      const ctx = createRLSContext({
        auth: { userId: 1, tenantId: 1, roles: ['admin'] }
      })

      await rlsContext.runAsync(ctx, async () => {
        const start = performance.now()
        const filtered = await guard.filterRows('resources', rows)
        const duration = performance.now() - start

        // Admin should get all rows
        expect(filtered.length).toBe(500)

        // Should still be fast
        expect(duration).toBeLessThan(2000)
      })
    })

    it('should handle rows with varying access patterns', async () => {
      // Create rows where some pass and some fail
      const rows = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        owner_id: i,
        tenant_id: i < 30 ? 1 : 2, // First 30 rows have tenant_id 1
        status: 'active'
      }))

      const ctx = createRLSContext({
        auth: { userId: 1, tenantId: 1, roles: ['user'] }
      })

      await rlsContext.runAsync(ctx, async () => {
        const filtered = await guard.filterRows('resources', rows)

        // Should only return rows with tenant_id 1
        expect(filtered.length).toBe(30)
        expect(filtered.every(r => r.tenant_id === 1)).toBe(true)
      })
    })
  })

  describe('filterRows maintains order', () => {
    it('should preserve row order after filtering', async () => {
      const rows = [
        { id: 1, owner_id: 1, tenant_id: 1, status: 'a' },
        { id: 2, owner_id: 2, tenant_id: 2, status: 'b' },
        { id: 3, owner_id: 3, tenant_id: 1, status: 'c' },
        { id: 4, owner_id: 4, tenant_id: 2, status: 'd' },
        { id: 5, owner_id: 5, tenant_id: 1, status: 'e' }
      ]

      const ctx = createRLSContext({
        auth: { userId: 1, tenantId: 1, roles: ['user'] }
      })

      await rlsContext.runAsync(ctx, async () => {
        const filtered = await guard.filterRows('resources', rows)

        // Should preserve order
        expect(filtered.map(r => r.id)).toEqual([1, 3, 5])
      })
    })
  })
})
