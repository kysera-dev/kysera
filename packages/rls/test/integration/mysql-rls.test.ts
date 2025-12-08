/**
 * MySQL Integration Tests for @kysera/rls
 *
 * Tests RLS policy enforcement with real MySQL database.
 * Requires Docker: docker compose -f test/docker/docker-compose.test.yml up -d
 *
 * Run with: TEST_MYSQL=true pnpm test
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Kysely, sql } from 'kysely';
import {
  createTestDb,
  initializeSchema,
  seedDatabase,
  clearDatabase,
  isDatabaseAvailable,
  type RLSTestDatabase,
} from '../utils/test-database.js';
import {
  defineRLSSchema,
  allow,
  deny,
  filter,
  validate,
  rlsContext,
  PolicyRegistry,
  type RLSContext,
} from '../../src/index.js';
import { SelectTransformer } from '../../src/transformer/select.js';
import { MutationGuard } from '../../src/transformer/mutation.js';

// Skip tests if MySQL is not available
const isMysqlEnabled = process.env['TEST_MYSQL'] === 'true' || process.env['CI'] === 'true';

describe.skipIf(!isMysqlEnabled)('MySQL Integration Tests', () => {
  let db: Kysely<RLSTestDatabase>;
  let mysqlAvailable = false;

  beforeAll(async () => {
    try {
      mysqlAvailable = await isDatabaseAvailable('mysql');
      if (!mysqlAvailable) {
        console.warn('MySQL not available - skipping tests');
        return;
      }

      db = await createTestDb('mysql');
      await initializeSchema(db, 'mysql');
    } catch (error) {
      console.warn('Failed to connect to MySQL:', error);
      mysqlAvailable = false;
    }
  });

  beforeEach(async () => {
    if (!mysqlAvailable) return;
    await clearDatabase(db);
    await seedDatabase(db, 'mysql');
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  describe('Multi-Tenant Isolation with Real MySQL', () => {
    const schema = defineRLSSchema<RLSTestDatabase>({
      users: {
        policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
      },
      posts: {
        policies: [
          filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),
          allow('update', (ctx) => Number(ctx.auth.userId) === ctx.row.user_id),
          deny('delete', (ctx) => ctx.row.status === 'published'),
        ],
      },
      resources: {
        policies: [
          filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),
          allow('update', (ctx) => Number(ctx.auth.userId) === ctx.row.owner_id),
          allow('all', (ctx) => ctx.auth.roles.includes('admin')),
        ],
        defaultDeny: true,
      },
    });

    it('should filter users by tenant_id in MySQL', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      const tenant1Ctx: RLSContext = {
        auth: { userId: '1', roles: ['user'], isSystem: false, tenantId: 1 },
      };

      const result = await rlsContext.run(tenant1Ctx, async () => {
        let query = db.selectFrom('users').selectAll();
        query = transformer.transform(query, 'users');
        return query.execute();
      });

      expect(result.length).toBe(4); // 4 users in tenant 1
      expect(result.every((u) => u.tenant_id === 1)).toBe(true);
    });

    it('should enforce tenant isolation for posts', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      // Tenant 2 should only see their posts
      const tenant2Ctx: RLSContext = {
        auth: { userId: '5', roles: ['admin'], isSystem: false, tenantId: 2 },
      };

      const result = await rlsContext.run(tenant2Ctx, async () => {
        let query = db.selectFrom('posts').selectAll();
        query = transformer.transform(query, 'posts');
        return query.execute();
      });

      expect(result.length).toBe(1);
      expect(result[0]!.tenant_id).toBe(2);
    });

    it('should handle complex queries with JOINs', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      const tenant1Ctx: RLSContext = {
        auth: { userId: '1', roles: ['user'], isSystem: false, tenantId: 1 },
      };

      // Complex query with JOIN - RLS should apply to main table
      const result = await rlsContext.run(tenant1Ctx, async () => {
        let query = db
          .selectFrom('posts')
          .innerJoin('users', 'users.id', 'posts.user_id')
          .select(['posts.id', 'posts.title', 'users.name as author_name']);

        query = transformer.transform(query, 'posts');
        return query.execute();
      });

      // All results should be from tenant 1
      expect(result.length).toBe(4);
    });
  });

  describe('MySQL-Specific Features', () => {
    it('should handle MySQL date/time functions', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      // Test that RLS works with MySQL-specific features
      const result = await sql<{ now: Date }>`SELECT NOW() as now`.execute(db);
      expect(result.rows[0]!.now).toBeInstanceOf(Date);
    });

    it('should handle transactions with RLS context', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const schema = defineRLSSchema<RLSTestDatabase>({
        posts: {
          policies: [
            filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),
            validate('create', (ctx) => ctx.data.tenant_id === ctx.auth.tenantId),
          ],
        },
      });

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      // Get actual user ID from database
      const alice = await db.selectFrom('users').select('id').where('email', '=', 'alice@acme.com').executeTakeFirst();
      if (!alice) {
        throw new Error('Test user not found');
      }

      const tenant1Ctx: RLSContext = {
        auth: { userId: String(alice.id), roles: ['user'], isSystem: false, tenantId: 1 },
      };

      await db.transaction().execute(async (trx) => {
        // RLS context should be preserved within transaction
        await rlsContext.run(tenant1Ctx, async () => {
          const isValid = await guard.validateMutation(
            'create',
            'posts',
            { title: 'Transaction Post', tenant_id: 1, user_id: alice.id, status: 'draft', is_public: false },
            undefined
          );

          expect(isValid).toBe(true);

          // Create post within transaction
          await trx
            .insertInto('posts')
            .values({
              title: 'Transaction Post',
              tenant_id: 1,
              user_id: alice.id,
              status: 'draft',
              is_public: false,
            })
            .execute();
        });
      });

      // Verify post was created
      const posts = await db.selectFrom('posts').selectAll().where('title', '=', 'Transaction Post').execute();

      expect(posts.length).toBe(1);
    });

    it('should handle concurrent contexts correctly', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const schema = defineRLSSchema<RLSTestDatabase>({
        users: {
          policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
        },
      });

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      // Simulate concurrent requests with different contexts
      const tenant1Promise = rlsContext.run(
        { auth: { userId: '1', roles: ['user'], isSystem: false, tenantId: 1 } },
        async () => {
          let query = db.selectFrom('users').selectAll();
          query = transformer.transform(query, 'users');
          return query.execute();
        }
      );

      const tenant2Promise = rlsContext.run(
        { auth: { userId: '5', roles: ['user'], isSystem: false, tenantId: 2 } },
        async () => {
          let query = db.selectFrom('users').selectAll();
          query = transformer.transform(query, 'users');
          return query.execute();
        }
      );

      const [tenant1Results, tenant2Results] = await Promise.all([tenant1Promise, tenant2Promise]);

      // Each should only see their own tenant's users
      expect(tenant1Results.every((u) => u.tenant_id === 1)).toBe(true);
      expect(tenant2Results.every((u) => u.tenant_id === 2)).toBe(true);
      expect(tenant1Results.length).toBe(4);
      expect(tenant2Results.length).toBe(2);
    });

    it('should handle MySQL-specific string collation', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const schema = defineRLSSchema<RLSTestDatabase>({
        users: {
          policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
        },
      });

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      const tenant1Ctx: RLSContext = {
        auth: { userId: '1', roles: ['user'], isSystem: false, tenantId: 1 },
      };

      // Query with case-insensitive comparison (MySQL default)
      const result = await rlsContext.run(tenant1Ctx, async () => {
        let query = db.selectFrom('users').selectAll().where('email', 'like', '%ACME.COM%');
        query = transformer.transform(query, 'users');
        return query.execute();
      });

      // Should find users with case-insensitive match
      expect(result.length).toBe(4); // All tenant 1 users have @acme.com
    });
  });

  describe('Owner-Based Access Control', () => {
    const ownerSchema = defineRLSSchema<RLSTestDatabase>({
      resources: {
        policies: [
          allow('read', (ctx) => Number(ctx.auth.userId) === ctx.row.owner_id),
          allow('update', (ctx) => Number(ctx.auth.userId) === ctx.row.owner_id),
          allow('delete', (ctx) => Number(ctx.auth.userId) === ctx.row.owner_id),
          allow('all', (ctx) => ctx.auth.roles.includes('admin')),
          deny('update', (ctx) => ctx.row.is_archived && !ctx.auth.roles.includes('admin')),
        ],
        defaultDeny: true,
      },
    });

    it('should allow owners to access their resources', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(ownerSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      // Get Bob's user ID
      const bob = await db.selectFrom('users').select('id').where('email', '=', 'bob@acme.com').executeTakeFirst();
      const bobResource = await db.selectFrom('resources').selectAll().where('name', '=', 'Bob Doc').executeTakeFirst();

      const bobCtx: RLSContext = {
        auth: { userId: String(bob!.id), roles: ['user'], isSystem: false, tenantId: 1 },
      };

      // Bob should be able to update his own resource
      const canUpdate = await rlsContext.run(bobCtx, async () => {
        return guard.canMutate('update', 'resources', bobResource!);
      });

      expect(canUpdate).toBe(true);
    });

    it('should deny access to resources owned by others', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(ownerSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      const alice = await db.selectFrom('users').select('id').where('email', '=', 'alice@acme.com').executeTakeFirst();
      const bobResource = await db.selectFrom('resources').selectAll().where('name', '=', 'Bob Doc').executeTakeFirst();

      const aliceCtx: RLSContext = {
        auth: { userId: String(alice!.id), roles: ['user'], isSystem: false, tenantId: 1 },
      };

      // Alice should NOT be able to update Bob's resource
      const canUpdate = await rlsContext.run(aliceCtx, async () => {
        return guard.canMutate('update', 'resources', bobResource!);
      });

      expect(canUpdate).toBe(false);
    });
  });

  describe('Performance with Large Datasets', () => {
    it('should handle queries with many rows efficiently', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const schema = defineRLSSchema<RLSTestDatabase>({
        posts: {
          policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
        },
      });

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      // Get user for inserting posts
      const alice = await db.selectFrom('users').select('id').where('email', '=', 'alice@acme.com').executeTakeFirst();

      // Insert more posts for testing
      const additionalPosts = Array.from({ length: 100 }, (_, i) => ({
        user_id: alice!.id,
        tenant_id: 1,
        title: `Bulk Post ${i}`,
        content: `Content for post ${i}`,
        status: 'draft',
        is_public: false,
      }));

      await db.insertInto('posts').values(additionalPosts).execute();

      const tenant1Ctx: RLSContext = {
        auth: { userId: String(alice!.id), roles: ['user'], isSystem: false, tenantId: 1 },
      };

      const startTime = Date.now();

      const result = await rlsContext.run(tenant1Ctx, async () => {
        let query = db.selectFrom('posts').selectAll();
        query = transformer.transform(query, 'posts');
        return query.execute();
      });

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 1 second for 100+ rows)
      expect(duration).toBeLessThan(1000);
      expect(result.length).toBeGreaterThan(100);
      expect(result.every((p) => p.tenant_id === 1)).toBe(true);
    });
  });

  describe('Validate Policies', () => {
    const validateSchema = defineRLSSchema<RLSTestDatabase>({
      posts: {
        policies: [
          validate('create', (ctx) => ctx.data.tenant_id === ctx.auth.tenantId),
          validate('update', (ctx) => !ctx.data.tenant_id || ctx.data.tenant_id === ctx.row.tenant_id),
        ],
      },
    });

    it('should validate create data', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(validateSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      const userCtx: RLSContext = {
        auth: { userId: '1', roles: ['user'], isSystem: false, tenantId: 1 },
      };

      // Valid: tenant_id matches auth context
      const validResult = await rlsContext.run(userCtx, async () => {
        return guard.validateMutation(
          'create',
          'posts',
          { title: 'New Post', tenant_id: 1, user_id: 1, status: 'draft', is_public: false },
          undefined
        );
      });

      expect(validResult).toBe(true);

      // Invalid: tenant_id doesn't match auth context
      const invalidResult = await rlsContext.run(userCtx, async () => {
        return guard.validateMutation(
          'create',
          'posts',
          { title: 'New Post', tenant_id: 2, user_id: 1, status: 'draft', is_public: false },
          undefined
        );
      });

      expect(invalidResult).toBe(false);
    });
  });

  describe('System User Bypass', () => {
    const strictSchema = defineRLSSchema<RLSTestDatabase>({
      users: {
        policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
        defaultDeny: true,
      },
      audit_logs: {
        policies: [deny('all', () => true)],
      },
    });

    it('should bypass all RLS for system users', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(strictSchema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      const systemCtx: RLSContext = {
        auth: { userId: 'system', roles: [], isSystem: true },
      };

      const result = await rlsContext.run(systemCtx, async () => {
        let query = db.selectFrom('users').selectAll();
        query = transformer.transform(query, 'users');
        return query.execute();
      });

      // System user should see ALL users
      expect(result.length).toBe(6);
    });
  });

  describe('Skip For Roles', () => {
    const schemaWithSkip = defineRLSSchema<RLSTestDatabase>({
      users: {
        policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
        skipFor: ['superadmin'],
      },
    });

    it('should skip RLS for specified roles', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schemaWithSkip);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      const superadminCtx: RLSContext = {
        auth: { userId: '1', roles: ['superadmin'], isSystem: false, tenantId: 1 },
      };

      const result = await rlsContext.run(superadminCtx, async () => {
        let query = db.selectFrom('users').selectAll();
        query = transformer.transform(query, 'users');
        return query.execute();
      });

      // Superadmin should see ALL users (RLS skipped)
      expect(result.length).toBe(6);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      // Test with invalid query
      await expect(sql`SELECT * FROM non_existent_table`.execute(db)).rejects.toThrow();
    });

    it('should maintain context after query errors', async function () {
      if (!mysqlAvailable) {
        this.skip?.();
        return;
      }

      const ctx: RLSContext = {
        auth: { userId: '1', roles: ['user'], isSystem: false, tenantId: 1 },
      };

      await rlsContext.run(ctx, async () => {
        try {
          await sql`SELECT * FROM non_existent_table`.execute(db);
        } catch {
          // Error expected
        }

        // Context should still be available
        const current = rlsContext.getContext();
        expect(current.auth.userId).toBe('1');
      });
    });
  });
});
