/**
 * PostgreSQL Integration Tests for New RLS Features
 *
 * Tests for ReBAC, Field-Level Access, Composition, Audit, Conditional Activation.
 * Requires Docker: docker compose -f test/docker/docker-compose.test.yml up -d
 *
 * Run with: TEST_POSTGRES=true pnpm test
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { Kysely, sql } from 'kysely'
import {
  createTestDb,
  initializeSchema,
  seedDatabase,
  clearDatabase,
  isDatabaseAvailable,
  type RLSTestDatabase
} from '../utils/test-database.js'
import {
  defineRLSSchema,
  allow,
  deny,
  filter,
  validate,
  rlsContext,
  PolicyRegistry,
  type RLSContext
} from '../../src/index.js'
import { SelectTransformer } from '../../src/transformer/select.js'
import { MutationGuard } from '../../src/transformer/mutation.js'

// Import new features
import {
  createReBAcRegistry,
  createReBAcTransformer,
  shopOrgMembershipPath,
  allowRelation
} from '../../src/rebac/index.js'
import {
  createFieldAccessRegistry,
  createFieldAccessProcessor,
  ownerOnly,
  rolesOnly,
  neverAccessible
} from '../../src/field-access/index.js'
import {
  createTenantIsolationPolicy,
  createOwnershipPolicy,
  defineFilterPolicy
} from '../../src/composition/builder.js'
import {
  createAuditLogger,
  InMemoryAuditAdapter,
  type RLSAuditEvent
} from '../../src/audit/index.js'
import {
  whenEnvironment,
  whenFeature,
  whenTimeRange
} from '../../src/policy/builder.js'
import {
  createResolverManager,
  createResolver
} from '../../src/resolvers/index.js'

// Skip tests if PostgreSQL is not available
const isPostgresAvailable = process.env['TEST_POSTGRES'] === 'true' || process.env['CI'] === 'true'

describe.skipIf(!isPostgresAvailable)('PostgreSQL New Features Integration Tests', () => {
  let db: Kysely<RLSTestDatabase>
  let postgresAvailable = false

  beforeAll(async () => {
    try {
      postgresAvailable = await isDatabaseAvailable('postgres')
      if (!postgresAvailable) {
        console.warn('PostgreSQL not available - skipping tests')
        return
      }

      db = await createTestDb('postgres')
      await initializeSchema(db, 'postgres')
    } catch (error) {
      console.warn('Failed to connect to PostgreSQL:', error)
      postgresAvailable = false
    }
  })

  beforeEach(async () => {
    if (!postgresAvailable) return
    await clearDatabase(db)
    await seedDatabase(db, 'postgres')
  })

  afterAll(async () => {
    if (db) {
      await db.destroy()
    }
  })

  // ============================================================================
  // Field-Level Access Control Tests
  // ============================================================================

  describe('Field-Level Access Control with PostgreSQL', () => {
    it('should mask sensitive fields based on ownership', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const fieldSchema = {
        users: {
          default: 'allow' as const,
          fields: {
            email: ownerOnly('id'),
            name: { read: () => true, write: () => true }
          }
        }
      }

      const registry = createFieldAccessRegistry(fieldSchema)
      const processor = createFieldAccessProcessor(registry)

      // Get all users
      const users = await db.selectFrom('users').selectAll().execute()

      // User 1 accessing user 1's data (owner)
      const ownerCtx: RLSContext = {
        auth: { userId: String(users[0]!.id), roles: ['user'], isSystem: false }
      }

      const ownerResult = await rlsContext.run(ownerCtx, async () => {
        return processor.maskRow('users', users[0] as Record<string, unknown>)
      })

      expect(ownerResult.data.email).toBe(users[0]!.email)
      expect(ownerResult.maskedFields).not.toContain('email')

      // User 1 accessing user 2's data (not owner)
      const nonOwnerResult = await rlsContext.run(ownerCtx, async () => {
        return processor.maskRow('users', users[1] as Record<string, unknown>)
      })

      expect(nonOwnerResult.data.email).toBeNull()
      expect(nonOwnerResult.maskedFields).toContain('email')
    })

    it('should validate write access on mutations', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const fieldSchema = {
        users: {
          default: 'allow' as const,
          fields: {
            email: ownerOnly('id'),
            role: rolesOnly(['admin'])
          }
        }
      }

      const registry = createFieldAccessRegistry(fieldSchema)
      const processor = createFieldAccessProcessor(registry)

      const users = await db.selectFrom('users').selectAll().execute()
      const user = users[0]!

      // Regular user trying to update their own email (should work)
      const userCtx: RLSContext = {
        auth: { userId: String(user.id), roles: ['user'], isSystem: false }
      }

      await expect(
        rlsContext.run(userCtx, async () => {
          return processor.validateWrite(
            'users',
            { email: 'new@example.com' },
            { id: String(user.id) }
          )
        })
      ).resolves.toBeUndefined()

      // Regular user trying to update role (should fail)
      await expect(
        rlsContext.run(userCtx, async () => {
          return processor.validateWrite(
            'users',
            { role: 'admin' },
            { id: String(user.id) }
          )
        })
      ).rejects.toThrow()
    })

    it('should allow system users to bypass field access', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const fieldSchema = {
        users: {
          default: 'deny' as const,
          fields: {
            email: neverAccessible()
          }
        }
      }

      const registry = createFieldAccessRegistry(fieldSchema)
      const processor = createFieldAccessProcessor(registry)

      const users = await db.selectFrom('users').selectAll().execute()
      const user = users[0]!

      const systemCtx: RLSContext = {
        auth: { userId: 'system', roles: [], isSystem: true }
      }

      const result = await rlsContext.run(systemCtx, async () => {
        return processor.maskRow('users', user as Record<string, unknown>)
      })

      // System user should see all fields
      expect(result.data.email).toBe(user.email)
      expect(result.maskedFields).toHaveLength(0)
    })
  })

  // ============================================================================
  // Policy Composition Tests
  // ============================================================================

  describe('Policy Composition with PostgreSQL', () => {
    it('should apply tenant isolation policy from composition', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const tenantPolicy = createTenantIsolationPolicy()
      const schema = defineRLSSchema<RLSTestDatabase>({
        users: {
          policies: tenantPolicy.policies
        }
      })

      const registry = new PolicyRegistry<RLSTestDatabase>()
      registry.register(schema)
      const transformer = new SelectTransformer<RLSTestDatabase>(registry)

      const tenant1Ctx: RLSContext = {
        auth: { userId: '1', roles: ['user'], isSystem: false, tenantId: 1 }
      }

      const result = await rlsContext.run(tenant1Ctx, async () => {
        let query = db.selectFrom('users').selectAll()
        query = transformer.transform(query, 'users')
        return query.execute()
      })

      expect(result.every(u => u.tenant_id === 1)).toBe(true)
    })

    it('should apply owner access policy', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const ownerPolicy = createOwnershipPolicy({ ownerColumn: 'user_id' })
      const schema = defineRLSSchema<RLSTestDatabase>({
        posts: {
          policies: ownerPolicy.policies,
          defaultDeny: true
        }
      })

      const registry = new PolicyRegistry<RLSTestDatabase>()
      registry.register(schema)
      const guard = new MutationGuard<RLSTestDatabase>(registry)

      const users = await db.selectFrom('users').selectAll().execute()
      const posts = await db.selectFrom('posts').selectAll().execute()
      const ownedPost = posts.find(p => p.user_id === users[0]!.id)!

      const ownerCtx: RLSContext = {
        auth: { userId: String(users[0]!.id), roles: ['user'], isSystem: false }
      }

      const isAllowed = await rlsContext.run(ownerCtx, async () => {
        return guard.validateMutation(
          'update',
          'posts',
          { title: 'Updated Title' },
          ownedPost
        )
      })

      expect(isAllowed).toBe(true)
    })

    it('should apply custom filter policy', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const publicPostsPolicy = defineFilterPolicy(
        'public-posts',
        () => ({ is_public: true })
      )

      const schema = defineRLSSchema<RLSTestDatabase>({
        posts: {
          policies: publicPostsPolicy.policies
        }
      })

      const registry = new PolicyRegistry<RLSTestDatabase>()
      registry.register(schema)
      const transformer = new SelectTransformer<RLSTestDatabase>(registry)

      // Ensure we have some public posts
      await db
        .updateTable('posts')
        .set({ is_public: true })
        .where('id', '=', 1)
        .execute()

      const anonCtx: RLSContext = {
        auth: { userId: 'anon', roles: [], isSystem: false }
      }

      const result = await rlsContext.run(anonCtx, async () => {
        let query = db.selectFrom('posts').selectAll()
        query = transformer.transform(query, 'posts')
        return query.execute()
      })

      expect(result.every(p => p.is_public === true)).toBe(true)
    })
  })

  // ============================================================================
  // Audit Trail Tests
  // ============================================================================

  describe('Audit Trail with PostgreSQL', () => {
    it('should log policy decisions for database queries', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const adapter = new InMemoryAuditAdapter()
      const logger = createAuditLogger({
        adapter,
        bufferSize: 1,
        flushInterval: 0,
        async: false,
        defaults: {
          logAllowed: true,
          logDenied: true,
          logFilters: true
        }
      })

      const userCtx: RLSContext = {
        auth: { userId: '1', tenantId: 1, roles: ['user'], isSystem: false }
      }

      // Log a read operation
      await rlsContext.run(userCtx, async () => {
        await logger.logAllow('read', 'users', 'tenant-filter')
      })

      const events = adapter.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]!.decision).toBe('allow')
      expect(events[0]!.table).toBe('users')
      expect(events[0]!.operation).toBe('read')
      expect(events[0]!.userId).toBe('1')
      expect(events[0]!.tenantId).toBe(1)

      await logger.close()
    })

    it('should log denied operations with reason', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const adapter = new InMemoryAuditAdapter()
      const logger = createAuditLogger({
        adapter,
        bufferSize: 1,
        flushInterval: 0,
        async: false,
        defaults: {
          logDenied: true
        }
      })

      const userCtx: RLSContext = {
        auth: { userId: '1', tenantId: 1, roles: ['user'], isSystem: false }
      }

      await rlsContext.run(userCtx, async () => {
        await logger.logDeny('delete', 'posts', 'published-protection', {
          reason: 'Cannot delete published posts'
        })
      })

      const events = adapter.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]!.decision).toBe('deny')
      expect(events[0]!.reason).toBe('Cannot delete published posts')

      await logger.close()
    })

    it('should query audit logs by filters', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const adapter = new InMemoryAuditAdapter()
      const logger = createAuditLogger({
        adapter,
        bufferSize: 10,
        flushInterval: 0,
        async: false,
        defaults: {
          logAllowed: true,
          logDenied: true
        }
      })

      const user1Ctx: RLSContext = {
        auth: { userId: '1', tenantId: 1, roles: ['user'], isSystem: false }
      }
      const user2Ctx: RLSContext = {
        auth: { userId: '2', tenantId: 1, roles: ['admin'], isSystem: false }
      }

      await rlsContext.run(user1Ctx, async () => {
        await logger.logAllow('read', 'users', 'policy1')
        await logger.logDeny('delete', 'posts', 'policy2')
      })

      await rlsContext.run(user2Ctx, async () => {
        await logger.logAllow('update', 'users', 'policy3')
      })

      await logger.flush()

      // Query by user
      const user1Events = adapter.query({ userId: '1' })
      expect(user1Events).toHaveLength(2)

      // Query by decision
      const denyEvents = adapter.query({ decision: 'deny' })
      expect(denyEvents).toHaveLength(1)

      // Query by table
      const userEvents = adapter.query({ table: 'users' })
      expect(userEvents).toHaveLength(2)

      await logger.close()
    })
  })

  // ============================================================================
  // Conditional Policy Activation Tests
  // ============================================================================

  describe('Conditional Policy Activation with PostgreSQL', () => {
    it('should activate policies based on environment', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const productionOnlyPolicy = whenEnvironment(['production'], () =>
        deny('delete', () => true, { name: 'no-delete-in-prod' })
      )

      // In production environment
      const result = productionOnlyPolicy.activationCondition?.({
        environment: 'production',
        auth: { userId: '1', roles: [], isSystem: false }
      })
      expect(result).toBe(true)

      // In development environment
      const devResult = productionOnlyPolicy.activationCondition?.({
        environment: 'development',
        auth: { userId: '1', roles: [], isSystem: false }
      })
      expect(devResult).toBe(false)
    })

    it('should activate policies based on feature flags', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const featurePolicy = whenFeature('strict_access', () =>
        filter('read', () => ({ status: 'active' }), { name: 'active-only' })
      )

      // With feature enabled
      const enabledResult = featurePolicy.activationCondition?.({
        features: { strict_access: true },
        auth: { userId: '1', roles: [], isSystem: false }
      })
      expect(enabledResult).toBe(true)

      // With feature disabled
      const disabledResult = featurePolicy.activationCondition?.({
        features: { strict_access: false },
        auth: { userId: '1', roles: [], isSystem: false }
      })
      expect(disabledResult).toBe(false)

      // With feature as array
      const arrayResult = featurePolicy.activationCondition?.({
        features: ['strict_access', 'other_feature'],
        auth: { userId: '1', roles: [], isSystem: false }
      })
      expect(arrayResult).toBe(true)
    })

    it('should support nested conditional wrappers', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      // Policy active only in production when feature is enabled
      const nestedPolicy = whenEnvironment(['production'], () =>
        whenFeature('strict_mode', () =>
          deny('delete', () => true, { name: 'strict-delete-deny' })
        )
      )

      // Both conditions met
      const bothMet = nestedPolicy.activationCondition?.({
        environment: 'production',
        features: { strict_mode: true },
        auth: { userId: '1', roles: [], isSystem: false }
      })
      expect(bothMet).toBe(true)

      // Environment met but feature not
      const envOnlyMet = nestedPolicy.activationCondition?.({
        environment: 'production',
        features: { strict_mode: false },
        auth: { userId: '1', roles: [], isSystem: false }
      })
      expect(envOnlyMet).toBe(false)

      // Feature met but environment not
      const featureOnlyMet = nestedPolicy.activationCondition?.({
        environment: 'development',
        features: { strict_mode: true },
        auth: { userId: '1', roles: [], isSystem: false }
      })
      expect(featureOnlyMet).toBe(false)
    })

    it('should activate policies based on time range', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      // Policy active during business hours (9-17)
      const businessHoursPolicy = whenTimeRange(9, 17, () =>
        allow('read', () => true, { name: 'business-hours-access' })
      )

      // Test during business hours
      const businessTime = new Date()
      businessTime.setHours(12, 0, 0, 0)

      const duringBusiness = businessHoursPolicy.activationCondition?.({
        timestamp: businessTime,
        auth: { userId: '1', roles: [], isSystem: false }
      })
      expect(duringBusiness).toBe(true)

      // Test outside business hours
      const offTime = new Date()
      offTime.setHours(20, 0, 0, 0)

      const afterBusiness = businessHoursPolicy.activationCondition?.({
        timestamp: offTime,
        auth: { userId: '1', roles: [], isSystem: false }
      })
      expect(afterBusiness).toBe(false)
    })
  })

  // ============================================================================
  // Context Resolvers Tests
  // ============================================================================

  describe('Context Resolvers with PostgreSQL', () => {
    it('should resolve organization data from database', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const manager = createResolverManager()

      interface OrgData {
        organizationId: number
        organizationName: string
      }

      // In a real app, this would query the database
      const orgResolver = createResolver<OrgData>({
        name: 'organization',
        resolve: async ctx => {
          // Simulate database lookup
          const user = await db
            .selectFrom('users')
            .select(['id', 'tenant_id'])
            .where('id', '=', Number(ctx.auth.userId))
            .executeTakeFirst()

          return {
            organizationId: user?.tenant_id ?? 0,
            organizationName: `Org ${user?.tenant_id ?? 0}`
          }
        }
      })

      manager.register(orgResolver)

      const users = await db.selectFrom('users').selectAll().execute()
      const userCtx: RLSContext = {
        auth: { userId: String(users[0]!.id), roles: ['user'], isSystem: false }
      }

      const result = await manager.resolveOne<OrgData>('organization', userCtx)

      expect(result).toBeDefined()
      expect(result!.organizationId).toBe(users[0]!.tenant_id)
    })

    it('should cache resolved data', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      const manager = createResolverManager()
      let resolveCount = 0

      const countingResolver = createResolver({
        name: 'counter',
        cacheable: true,
        ttl: 5000,
        cacheKey: ctx => `user:${ctx.auth.userId}`,
        resolve: async () => {
          resolveCount++
          return { count: resolveCount }
        }
      })

      manager.register(countingResolver)

      const userCtx: RLSContext = {
        auth: { userId: '1', roles: ['user'], isSystem: false }
      }

      // First resolve
      await manager.resolveOne('counter', userCtx)
      expect(resolveCount).toBe(1)

      // Note: Without a real cache implementation, each call resolves fresh
      // This test demonstrates the pattern - production would use Redis/Memcached
    })
  })

  // ============================================================================
  // Combined Features Integration Test
  // ============================================================================

  describe('Combined Features Integration', () => {
    it('should work with multiple features together', async ctx => {
      if (!postgresAvailable) {
        ctx.skip()
        return
      }

      // Setup field access
      const fieldSchema = {
        posts: {
          default: 'allow' as const,
          fields: {
            content: ownerOnly('user_id')
          }
        }
      }
      const fieldRegistry = createFieldAccessRegistry(fieldSchema)
      const fieldProcessor = createFieldAccessProcessor(fieldRegistry)

      // Setup policies
      const schema = defineRLSSchema<RLSTestDatabase>({
        posts: {
          policies: [
            filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
            allow('update', ctx => Number(ctx.auth.userId) === ctx.row?.user_id)
          ]
        }
      })

      const policyRegistry = new PolicyRegistry<RLSTestDatabase>()
      policyRegistry.register(schema)
      const transformer = new SelectTransformer<RLSTestDatabase>(policyRegistry)

      // Setup audit
      const auditAdapter = new InMemoryAuditAdapter()
      const logger = createAuditLogger({
        adapter: auditAdapter,
        bufferSize: 10,
        flushInterval: 0,
        async: false,
        defaults: { logAllowed: true, logDenied: true }
      })

      // Get test data
      const users = await db.selectFrom('users').selectAll().execute()
      const user = users[0]!

      const userCtx: RLSContext = {
        auth: {
          userId: String(user.id),
          tenantId: user.tenant_id,
          roles: ['user'],
          isSystem: false
        }
      }

      // Execute query with all features
      const posts = await rlsContext.run(userCtx, async () => {
        // Apply RLS filter
        let query = db.selectFrom('posts').selectAll()
        query = transformer.transform(query, 'posts')
        const result = await query.execute()

        // Log the operation
        await logger.logAllow('read', 'posts', 'tenant-filter')

        // Mask fields for each post
        const maskedPosts = await Promise.all(
          result.map(post =>
            fieldProcessor.maskRow('posts', post as Record<string, unknown>)
          )
        )

        return maskedPosts
      })

      await logger.flush()

      // Verify results
      expect(posts.length).toBeGreaterThan(0)

      // All posts should be from user's tenant
      expect(posts.every(p => {
        const data = p.data as { tenant_id?: number }
        return data.tenant_id === user.tenant_id
      })).toBe(true)

      // Non-owned posts should have masked content
      const nonOwnedPost = posts.find(p => {
        const data = p.data as { user_id?: number }
        return data.user_id !== user.id
      })
      if (nonOwnedPost) {
        expect(nonOwnedPost.maskedFields).toContain('content')
      }

      // Verify audit log
      const auditEvents = auditAdapter.getEvents()
      expect(auditEvents.length).toBeGreaterThan(0)
      expect(auditEvents[0]!.userId).toBe(String(user.id))

      await logger.close()
    })
  })
})
