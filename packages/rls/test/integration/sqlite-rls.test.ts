/**
 * SQLite Integration Tests for @kysera/rls
 *
 * Tests RLS policy enforcement with real SQLite database
 * (in-memory for performance).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Kysely } from 'kysely';
import {
  createTestDb,
  initializeSchema,
  seedDatabase,
  clearDatabase,
  type RLSTestDatabase,
} from '../utils/test-database.js';
import {
  defineRLSSchema,
  allow,
  deny,
  filter,
  validate,
  rlsContext,
  createRLSContext,
  withRLSContext,
  PolicyRegistry,
  RLSPolicyViolation,
  type RLSContext,
} from '../../src/index.js';
import { SelectTransformer } from '../../src/transformer/select.js';
import { MutationGuard } from '../../src/transformer/mutation.js';

describe('SQLite Integration Tests', () => {
  let db: Kysely<RLSTestDatabase>;

  beforeAll(async () => {
    db = await createTestDb('sqlite');
    await initializeSchema(db, 'sqlite');
  });

  beforeEach(async () => {
    await clearDatabase(db);
    await seedDatabase(db, 'sqlite');
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('Multi-Tenant Isolation', () => {
    const schema = defineRLSSchema<RLSTestDatabase>({
      users: {
        policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
      },
      posts: {
        policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
      },
      resources: {
        policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
      },
      comments: {
        policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
      },
    });

    it('should filter users by tenant_id', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      // Tenant 1 context
      const tenant1Ctx: RLSContext = {
        auth: { userId: '1', roles: ['user'], isSystem: false, tenantId: 1 },
      };

      const result = await rlsContext.run(tenant1Ctx, async () => {
        let query = db.selectFrom('users').selectAll();
        query = transformer.transform(query, 'users');
        return query.execute();
      });

      // Should only see tenant 1 users
      expect(result.length).toBe(4); // alice, bob, charlie, disabled
      expect(result.every((u) => u.tenant_id === 1)).toBe(true);
    });

    it('should isolate posts between tenants', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      // Tenant 2 context (Beta Inc)
      const tenant2Ctx: RLSContext = {
        auth: { userId: '5', roles: ['admin'], isSystem: false, tenantId: 2 },
      };

      const result = await rlsContext.run(tenant2Ctx, async () => {
        let query = db.selectFrom('posts').selectAll();
        query = transformer.transform(query, 'posts');
        return query.execute();
      });

      // Should only see tenant 2 posts
      expect(result.length).toBe(1);
      expect(result[0]!.title).toBe('Beta Company Post');
    });

    it('should prevent cross-tenant data access', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(schema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      // Get total counts without RLS
      const allUsers = await db.selectFrom('users').selectAll().execute();
      const allPosts = await db.selectFrom('posts').selectAll().execute();

      expect(allUsers.length).toBe(6); // 4 tenant 1 + 2 tenant 2

      // Query with tenant 1 context
      const ctx1: RLSContext = {
        auth: { userId: '1', roles: ['admin'], isSystem: false, tenantId: 1 },
      };

      const tenant1Users = await rlsContext.run(ctx1, async () => {
        let query = db.selectFrom('users').selectAll();
        query = transformer.transform(query, 'users');
        return query.execute();
      });

      const tenant1Posts = await rlsContext.run(ctx1, async () => {
        let query = db.selectFrom('posts').selectAll();
        query = transformer.transform(query, 'posts');
        return query.execute();
      });

      // Verify isolation
      expect(tenant1Users.length).toBeLessThan(allUsers.length);
      expect(tenant1Posts.length).toBe(4); // 4 posts from tenant 1
    });
  });

  describe('Owner-Based Access Control', () => {
    const ownerSchema = defineRLSSchema<RLSTestDatabase>({
      resources: {
        policies: [
          // Allow owners to access their own resources
          allow('read', (ctx) => Number(ctx.auth.userId) === ctx.row.owner_id),
          allow('update', (ctx) => Number(ctx.auth.userId) === ctx.row.owner_id),
          allow('delete', (ctx) => Number(ctx.auth.userId) === ctx.row.owner_id),
          // Admins can access all
          allow('all', (ctx) => ctx.auth.roles.includes('admin')),
          // Deny archived resources for non-admins
          deny('update', (ctx) => ctx.row.is_archived && !ctx.auth.roles.includes('admin')),
        ],
        defaultDeny: true,
      },
    });

    it('should allow owners to access their resources', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(ownerSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      // Get Bob's user ID
      const bob = await db.selectFrom('users').select('id').where('email', '=', 'bob@acme.com').executeTakeFirst();
      const bobResource = await db
        .selectFrom('resources')
        .selectAll()
        .where('name', '=', 'Bob Doc')
        .executeTakeFirst();

      const bobCtx: RLSContext = {
        auth: { userId: String(bob!.id), roles: ['user'], isSystem: false, tenantId: 1 },
      };

      // Bob should be able to update his own resource
      const canUpdate = await rlsContext.run(bobCtx, async () => {
        return guard.canMutate('update', 'resources', bobResource!);
      });

      expect(canUpdate).toBe(true);
    });

    it('should deny access to resources owned by others', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(ownerSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      // Get Alice's and Bob's user IDs
      const alice = await db.selectFrom('users').select('id').where('email', '=', 'alice@acme.com').executeTakeFirst();
      const bobResource = await db
        .selectFrom('resources')
        .selectAll()
        .where('name', '=', 'Bob Doc')
        .executeTakeFirst();

      const aliceCtx: RLSContext = {
        auth: { userId: String(alice!.id), roles: ['user'], isSystem: false, tenantId: 1 },
      };

      // Alice should NOT be able to update Bob's resource
      const canUpdate = await rlsContext.run(aliceCtx, async () => {
        return guard.canMutate('update', 'resources', bobResource!);
      });

      expect(canUpdate).toBe(false);
    });

    it('should allow admins to access all resources', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(ownerSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      // Get Alice (admin) and Bob's resource
      const alice = await db.selectFrom('users').select('id').where('email', '=', 'alice@acme.com').executeTakeFirst();
      const bobResource = await db
        .selectFrom('resources')
        .selectAll()
        .where('name', '=', 'Bob Doc')
        .executeTakeFirst();

      const adminCtx: RLSContext = {
        auth: { userId: String(alice!.id), roles: ['admin'], isSystem: false, tenantId: 1 },
      };

      // Admin should be able to update anyone's resource
      const canUpdate = await rlsContext.run(adminCtx, async () => {
        return guard.canMutate('update', 'resources', bobResource!);
      });

      expect(canUpdate).toBe(true);
    });

    it('should deny updates to archived resources for non-admins', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(ownerSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      // Get Bob and his archived resource
      const bob = await db.selectFrom('users').select('id').where('email', '=', 'bob@acme.com').executeTakeFirst();
      const archivedResource = await db
        .selectFrom('resources')
        .selectAll()
        .where('name', '=', 'Bob Archived')
        .executeTakeFirst();

      const bobCtx: RLSContext = {
        auth: { userId: String(bob!.id), roles: ['user'], isSystem: false, tenantId: 1 },
      };

      // Bob should NOT be able to update his archived resource
      const canUpdate = await rlsContext.run(bobCtx, async () => {
        return guard.canMutate('update', 'resources', archivedResource!);
      });

      expect(canUpdate).toBe(false);
    });
  });

  describe('Status-Based Access Control', () => {
    const postSchema = defineRLSSchema<RLSTestDatabase>({
      posts: {
        policies: [
          // Public posts are readable by all
          allow('read', (ctx) => ctx.row.is_public === true || ctx.row.is_public === 1),
          // Tenant members can read all tenant posts
          filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),
          // Only authors can update their own posts
          allow('update', (ctx) => Number(ctx.auth.userId) === ctx.row.user_id),
          // Deny deletion of published posts
          deny('delete', (ctx) => ctx.row.status === 'published'),
          // Editors can update any post in their tenant
          allow('update', (ctx) => ctx.auth.roles.includes('editor')),
        ],
      },
    });

    it('should allow reading public posts', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(postSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      const publicPost = await db
        .selectFrom('posts')
        .selectAll()
        .where('title', '=', 'Public Post by Alice')
        .executeTakeFirst();

      const userCtx: RLSContext = {
        auth: { userId: '999', roles: ['user'], isSystem: false, tenantId: 1 },
      };

      const canRead = await rlsContext.run(userCtx, async () => {
        return guard.canMutate('read', 'posts', publicPost!);
      });

      expect(canRead).toBe(true);
    });

    it('should deny deletion of published posts', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(postSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      // Get Alice and her published post
      const alice = await db.selectFrom('users').select('id').where('email', '=', 'alice@acme.com').executeTakeFirst();
      const publishedPost = await db
        .selectFrom('posts')
        .selectAll()
        .where('title', '=', 'Public Post by Alice')
        .executeTakeFirst();

      const aliceCtx: RLSContext = {
        auth: { userId: String(alice!.id), roles: ['admin'], isSystem: false, tenantId: 1 },
      };

      // Even owner/admin cannot delete published post
      const canDelete = await rlsContext.run(aliceCtx, async () => {
        return guard.canMutate('delete', 'posts', publishedPost!);
      });

      expect(canDelete).toBe(false);
    });

    it('should allow editors to update any tenant post', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(postSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      // Get Charlie (editor) and Alice's post
      const charlie = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', 'charlie@acme.com')
        .executeTakeFirst();
      const alicePost = await db
        .selectFrom('posts')
        .selectAll()
        .where('title', '=', 'Public Post by Alice')
        .executeTakeFirst();

      const editorCtx: RLSContext = {
        auth: { userId: String(charlie!.id), roles: ['editor'], isSystem: false, tenantId: 1 },
      };

      const canUpdate = await rlsContext.run(editorCtx, async () => {
        return guard.canMutate('update', 'posts', alicePost!);
      });

      expect(canUpdate).toBe(true);
    });
  });

  describe('System User Bypass', () => {
    const strictSchema = defineRLSSchema<RLSTestDatabase>({
      users: {
        policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
        defaultDeny: true,
      },
      audit_logs: {
        policies: [
          deny('all', () => true), // Deny all access
        ],
      },
    });

    it('should bypass all RLS for system users', async () => {
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

    it('should bypass denied tables for system users', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(strictSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      const systemCtx: RLSContext = {
        auth: { userId: 'system', roles: [], isSystem: true },
      };

      const canRead = await rlsContext.run(systemCtx, async () => {
        return guard.canMutate('read', 'audit_logs', { id: 1 } as any);
      });

      // System user should bypass deny policies
      expect(canRead).toBe(true);
    });
  });

  describe('Skip For Roles', () => {
    const schemaWithSkip = defineRLSSchema<RLSTestDatabase>({
      users: {
        policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
        skipFor: ['superadmin'],
      },
    });

    it('should skip RLS for specified roles', async () => {
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

  describe('Validate Policies', () => {
    const validateSchema = defineRLSSchema<RLSTestDatabase>({
      posts: {
        policies: [
          // Validate that new posts belong to the correct tenant
          validate('create', (ctx) => ctx.data.tenant_id === ctx.auth.tenantId),
          // Validate that updates don't change tenant_id
          validate('update', (ctx) => !ctx.data.tenant_id || ctx.data.tenant_id === ctx.row.tenant_id),
        ],
      },
    });

    it('should validate create data', async () => {
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

    it('should validate update data against existing row', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(validateSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      const existingPost = await db.selectFrom('posts').selectAll().where('tenant_id', '=', 1).executeTakeFirst();

      const userCtx: RLSContext = {
        auth: { userId: '1', roles: ['user'], isSystem: false, tenantId: 1 },
      };

      // Invalid: trying to change tenant_id
      const invalidResult = await rlsContext.run(userCtx, async () => {
        return guard.validateMutation('update', 'posts', { tenant_id: 2 }, existingPost!);
      });

      expect(invalidResult).toBe(false);

      // Valid: updating without changing tenant_id
      const validResult = await rlsContext.run(userCtx, async () => {
        return guard.validateMutation('update', 'posts', { title: 'Updated Title' }, existingPost!);
      });

      expect(validResult).toBe(true);
    });
  });

  describe('Context Management', () => {
    it('should properly isolate nested contexts', async () => {
      const outerCtx: RLSContext = {
        auth: { userId: '1', roles: ['user'], isSystem: false, tenantId: 1 },
      };

      const innerCtx: RLSContext = {
        auth: { userId: '2', roles: ['admin'], isSystem: false, tenantId: 2 },
      };

      await rlsContext.run(outerCtx, async () => {
        const outer = rlsContext.getContext();
        expect(outer.auth.userId).toBe('1');
        expect(outer.auth.tenantId).toBe(1);

        await rlsContext.run(innerCtx, async () => {
          const inner = rlsContext.getContext();
          expect(inner.auth.userId).toBe('2');
          expect(inner.auth.tenantId).toBe(2);
        });

        // Back to outer context
        const afterInner = rlsContext.getContext();
        expect(afterInner.auth.userId).toBe('1');
        expect(afterInner.auth.tenantId).toBe(1);
      });
    });

    it('should work with createRLSContext helper', async () => {
      const ctx = createRLSContext({
        auth: {
          userId: 'test-user',
          roles: ['editor'],
          tenantId: 42,
        },
      });

      await rlsContext.run(ctx, async () => {
        const current = rlsContext.getContext();
        expect(current.auth.userId).toBe('test-user');
        expect(current.auth.roles).toContain('editor');
        expect(current.auth.tenantId).toBe(42);
        expect(current.auth.isSystem).toBe(false);
      });
    });

    it('should work with withRLSContext helper', async () => {
      const result = await withRLSContext(
        {
          auth: { userId: 'helper-user', roles: ['user'], isSystem: false },
        },
        async () => {
          const ctx = rlsContext.getContext();
          return ctx.auth.userId;
        }
      );

      expect(result).toBe('helper-user');
    });
  });

  describe('Combined Filter and Allow Policies', () => {
    const combinedSchema = defineRLSSchema<RLSTestDatabase>({
      comments: {
        policies: [
          // Base filter: tenant isolation
          filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),
          // Additional filter: only approved comments (unless admin)
          // Note: SQLite uses 1/0 for booleans
          filter('read', (ctx) => {
            if (ctx.auth.roles.includes('admin')) {
              return {}; // No additional filter for admins
            }
            return { is_approved: 1 }; // Use 1 instead of true for SQLite
          }),
          // Allow users to see their own unapproved comments
          allow('read', (ctx) => Number(ctx.auth.userId) === ctx.row.user_id),
        ],
      },
    });

    it('should apply multiple filters', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(combinedSchema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      // Get Bob's user ID
      const bob = await db.selectFrom('users').select('id').where('email', '=', 'bob@acme.com').executeTakeFirst();

      const bobCtx: RLSContext = {
        auth: { userId: String(bob!.id), roles: ['user'], isSystem: false, tenantId: 1 },
      };

      const result = await rlsContext.run(bobCtx, async () => {
        let query = db.selectFrom('comments').selectAll();
        query = transformer.transform(query, 'comments');
        return query.execute();
      });

      // Bob should only see approved comments in tenant 1
      // (his own unapproved comments would need additional allow policy evaluation)
      expect(result.every((c) => c.tenant_id === 1)).toBe(true);
    });

    it('should give admins access to all tenant comments', async () => {
      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(combinedSchema);
      const transformer = new SelectTransformer<RLSTestDatabase>(registry);

      // Get Alice (admin)
      const alice = await db.selectFrom('users').select('id').where('email', '=', 'alice@acme.com').executeTakeFirst();

      const adminCtx: RLSContext = {
        auth: { userId: String(alice!.id), roles: ['admin'], isSystem: false, tenantId: 1 },
      };

      const result = await rlsContext.run(adminCtx, async () => {
        let query = db.selectFrom('comments').selectAll();
        query = transformer.transform(query, 'comments');
        return query.execute();
      });

      // Admin should see all tenant 1 comments (approved and unapproved)
      expect(result.every((c) => c.tenant_id === 1)).toBe(true);
      // Should include both approved and unapproved
      expect(result.length).toBe(3); // 3 comments in tenant 1
    });
  });
});
