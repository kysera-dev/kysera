/**
 * End-to-End Workflow Tests for @kysera/rls
 *
 * Tests complete real-world scenarios:
 * - Multi-tenant SaaS application
 * - Blog platform with roles
 * - Document management system
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
  mergeRLSSchemas,
  allow,
  deny,
  filter,
  validate,
  rlsContext,
  withRLSContext,
  PolicyRegistry,
  type RLSContext,
  type RLSSchema,
} from '../../src/index.js';
import { SelectTransformer } from '../../src/transformer/select.js';
import { MutationGuard } from '../../src/transformer/mutation.js';

describe('E2E Workflow Tests', () => {
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

  describe('Multi-Tenant SaaS Application', () => {
    /**
     * Scenario: Multi-tenant SaaS with organizations
     * - Each tenant has isolated data
     * - Admins can manage all data within their tenant
     * - Users can only access their own data
     * - Super admins can access across tenants
     */

    const tenantSchema = defineRLSSchema<RLSTestDatabase>({
      users: {
        policies: [
          // Tenant isolation
          filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),
          // Users can update their own profile
          allow('update', (ctx) => Number(ctx.auth.userId) === ctx.row.id),
          // Admins can update any user in their tenant
          allow('update', (ctx) => ctx.auth.roles.includes('admin')),
          // Only admins can delete users
          allow('delete', (ctx) => ctx.auth.roles.includes('admin')),
          // Cannot delete yourself
          deny('delete', (ctx) => Number(ctx.auth.userId) === ctx.row.id),
        ],
        skipFor: ['superadmin'],
      },
      resources: {
        policies: [
          // Tenant isolation
          filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),
          // Owners have full access
          allow('all', (ctx) => Number(ctx.auth.userId) === ctx.row.owner_id),
          // Admins have full access
          allow('all', (ctx) => ctx.auth.roles.includes('admin')),
          // Deny archived resources for non-admins (except read)
          deny(['update', 'delete'], (ctx) => ctx.row.is_archived && !ctx.auth.roles.includes('admin')),
        ],
        defaultDeny: true,
      },
      posts: {
        policies: [
          // Tenant isolation
          filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),
          // Authors can manage their posts
          allow(['update', 'delete'], (ctx) => Number(ctx.auth.userId) === ctx.row.user_id),
          // Editors can update any post
          allow('update', (ctx) => ctx.auth.roles.includes('editor')),
          // Cannot delete published posts
          deny('delete', (ctx) => ctx.row.status === 'published'),
          // Validate tenant_id on create
          validate('create', (ctx) => ctx.data.tenant_id === ctx.auth.tenantId),
        ],
      },
    });

    let registry: PolicyRegistry<RLSTestDatabase>;
    let transformer: SelectTransformer<RLSTestDatabase>;
    let guard: MutationGuard<RLSTestDatabase>;

    beforeEach(() => {
      registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(tenantSchema);
      transformer = new SelectTransformer<RLSTestDatabase>(registry);
      guard = new MutationGuard<RLSTestDatabase>(registry);
    });

    it('should isolate data between tenants completely', async () => {
      // Get user from each tenant
      const acmeAdmin = await db.selectFrom('users').selectAll().where('email', '=', 'alice@acme.com').executeTakeFirst();
      const betaAdmin = await db.selectFrom('users').selectAll().where('email', '=', 'diana@beta.com').executeTakeFirst();

      // Acme admin queries
      const acmeUsers = await withRLSContext(
        { auth: { userId: String(acmeAdmin!.id), roles: ['admin'], isSystem: false, tenantId: 1 } },
        async () => {
          let query = db.selectFrom('users').selectAll();
          query = transformer.transform(query, 'users');
          return query.execute();
        }
      );

      // Beta admin queries
      const betaUsers = await withRLSContext(
        { auth: { userId: String(betaAdmin!.id), roles: ['admin'], isSystem: false, tenantId: 2 } },
        async () => {
          let query = db.selectFrom('users').selectAll();
          query = transformer.transform(query, 'users');
          return query.execute();
        }
      );

      // Complete isolation
      expect(acmeUsers.every((u) => u.tenant_id === 1)).toBe(true);
      expect(betaUsers.every((u) => u.tenant_id === 2)).toBe(true);
      expect(acmeUsers.length).toBe(4);
      expect(betaUsers.length).toBe(2);

      // No overlap
      const acmeIds = new Set(acmeUsers.map((u) => u.id));
      const betaIds = new Set(betaUsers.map((u) => u.id));
      const intersection = [...acmeIds].filter((id) => betaIds.has(id));
      expect(intersection.length).toBe(0);
    });

    it('should enforce role-based access within tenant', async () => {
      const alice = await db.selectFrom('users').selectAll().where('email', '=', 'alice@acme.com').executeTakeFirst();
      const bob = await db.selectFrom('users').selectAll().where('email', '=', 'bob@acme.com').executeTakeFirst();
      const charlie = await db.selectFrom('users').selectAll().where('email', '=', 'charlie@acme.com').executeTakeFirst();

      const bobResource = await db.selectFrom('resources').selectAll().where('name', '=', 'Bob Doc').executeTakeFirst();

      // Admin (Alice) can update Bob's resource
      const adminCanUpdate = await withRLSContext(
        { auth: { userId: String(alice!.id), roles: ['admin'], isSystem: false, tenantId: 1 } },
        async () => guard.canMutate('update', 'resources', bobResource!)
      );
      expect(adminCanUpdate).toBe(true);

      // Regular user (Charlie) cannot update Bob's resource
      const userCanUpdate = await withRLSContext(
        { auth: { userId: String(charlie!.id), roles: ['user'], isSystem: false, tenantId: 1 } },
        async () => guard.canMutate('update', 'resources', bobResource!)
      );
      expect(userCanUpdate).toBe(false);

      // Owner (Bob) can update his own resource
      const ownerCanUpdate = await withRLSContext(
        { auth: { userId: String(bob!.id), roles: ['user'], isSystem: false, tenantId: 1 } },
        async () => guard.canMutate('update', 'resources', bobResource!)
      );
      expect(ownerCanUpdate).toBe(true);
    });

    it('should prevent admins from deleting themselves', async () => {
      const alice = await db.selectFrom('users').selectAll().where('email', '=', 'alice@acme.com').executeTakeFirst();
      const bob = await db.selectFrom('users').selectAll().where('email', '=', 'bob@acme.com').executeTakeFirst();

      // Admin can delete other users
      const canDeleteBob = await withRLSContext(
        { auth: { userId: String(alice!.id), roles: ['admin'], isSystem: false, tenantId: 1 } },
        async () => guard.canMutate('delete', 'users', bob!)
      );
      expect(canDeleteBob).toBe(true);

      // Admin cannot delete themselves
      const canDeleteSelf = await withRLSContext(
        { auth: { userId: String(alice!.id), roles: ['admin'], isSystem: false, tenantId: 1 } },
        async () => guard.canMutate('delete', 'users', alice!)
      );
      expect(canDeleteSelf).toBe(false);
    });

    it('should allow superadmin to bypass tenant isolation', async () => {
      // Superadmin from tenant 1 can see all users
      const allUsers = await withRLSContext(
        { auth: { userId: '999', roles: ['superadmin'], isSystem: false, tenantId: 1 } },
        async () => {
          let query = db.selectFrom('users').selectAll();
          query = transformer.transform(query, 'users');
          return query.execute();
        }
      );

      // Should see users from both tenants
      expect(allUsers.length).toBe(6);
      expect(allUsers.some((u) => u.tenant_id === 1)).toBe(true);
      expect(allUsers.some((u) => u.tenant_id === 2)).toBe(true);
    });

    it('should validate tenant_id on post creation', async () => {
      const alice = await db.selectFrom('users').selectAll().where('email', '=', 'alice@acme.com').executeTakeFirst();

      // Valid: creating post for own tenant
      const validCreate = await withRLSContext(
        { auth: { userId: String(alice!.id), roles: ['user'], isSystem: false, tenantId: 1 } },
        async () =>
          guard.validateMutation(
            'create',
            'posts',
            { title: 'New Post', tenant_id: 1, user_id: alice!.id, status: 'draft', is_public: false },
            undefined
          )
      );
      expect(validCreate).toBe(true);

      // Invalid: trying to create post for different tenant
      const invalidCreate = await withRLSContext(
        { auth: { userId: String(alice!.id), roles: ['user'], isSystem: false, tenantId: 1 } },
        async () =>
          guard.validateMutation(
            'create',
            'posts',
            { title: 'Evil Post', tenant_id: 2, user_id: alice!.id, status: 'draft', is_public: false },
            undefined
          )
      );
      expect(invalidCreate).toBe(false);
    });
  });

  describe('Blog Platform with Content Workflow', () => {
    /**
     * Scenario: Blog with editorial workflow
     * - Authors write drafts
     * - Editors review and can update
     * - Only editors can publish
     * - Published posts cannot be deleted
     * - Public posts are visible to all
     */

    const blogSchema = defineRLSSchema<RLSTestDatabase>({
      posts: {
        policies: [
          // Tenant isolation
          filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),

          // Public posts visible to everyone (within tenant)
          allow('read', (ctx) => ctx.row.is_public === true || ctx.row.is_public === 1),

          // Authors can read their own drafts
          allow('read', (ctx) => Number(ctx.auth.userId) === ctx.row.user_id),

          // Authors can update their own posts
          allow('update', (ctx) => Number(ctx.auth.userId) === ctx.row.user_id),

          // Editors can update any post
          allow('update', (ctx) => ctx.auth.roles.includes('editor')),

          // Only authors can delete their own drafts
          allow('delete', (ctx) => Number(ctx.auth.userId) === ctx.row.user_id && ctx.row.status === 'draft'),

          // No one can delete published posts
          deny('delete', (ctx) => ctx.row.status === 'published'),

          // Validate status transitions
          validate('update', (ctx) => {
            // Only editors can change status to published
            if (ctx.data.status === 'published' && !ctx.auth.roles.includes('editor')) {
              return false;
            }
            return true;
          }),
        ],
      },
      comments: {
        policies: [
          // Tenant isolation
          filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),

          // Only show approved comments (unless admin/moderator)
          filter('read', (ctx) => {
            if (ctx.auth.roles.includes('admin') || ctx.auth.roles.includes('moderator')) {
              return {};
            }
            return { is_approved: true };
          }),

          // Users can see their own pending comments
          allow('read', (ctx) => Number(ctx.auth.userId) === ctx.row.user_id),

          // Anyone can create comments
          allow('create', () => true),

          // Users can delete their own comments
          allow('delete', (ctx) => Number(ctx.auth.userId) === ctx.row.user_id),

          // Moderators can delete any comment
          allow('delete', (ctx) => ctx.auth.roles.includes('moderator') || ctx.auth.roles.includes('admin')),
        ],
      },
    });

    let registry: PolicyRegistry<RLSTestDatabase>;
    let guard: MutationGuard<RLSTestDatabase>;

    beforeEach(() => {
      registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(blogSchema);
      guard = new MutationGuard<RLSTestDatabase>(registry);
    });

    it('should enforce editorial workflow for publishing', async () => {
      const bob = await db.selectFrom('users').selectAll().where('email', '=', 'bob@acme.com').executeTakeFirst();
      const charlie = await db.selectFrom('users').selectAll().where('email', '=', 'charlie@acme.com').executeTakeFirst();

      const draftPost = await db.selectFrom('posts').selectAll().where('title', '=', 'Charlie Draft').executeTakeFirst();

      // Author (Charlie) cannot publish
      const authorCanPublish = await withRLSContext(
        { auth: { userId: String(charlie!.id), roles: ['user'], isSystem: false, tenantId: 1 } },
        async () => guard.validateMutation('update', 'posts', { status: 'published' }, draftPost!)
      );
      expect(authorCanPublish).toBe(false);

      // Editor (Charlie with editor role) can publish
      const editorCanPublish = await withRLSContext(
        { auth: { userId: String(charlie!.id), roles: ['editor'], isSystem: false, tenantId: 1 } },
        async () => guard.validateMutation('update', 'posts', { status: 'published' }, draftPost!)
      );
      expect(editorCanPublish).toBe(true);
    });

    it('should prevent deletion of published posts', async () => {
      const alice = await db.selectFrom('users').selectAll().where('email', '=', 'alice@acme.com').executeTakeFirst();

      const publishedPost = await db
        .selectFrom('posts')
        .selectAll()
        .where('title', '=', 'Public Post by Alice')
        .executeTakeFirst();

      // Even the author cannot delete published post
      const canDelete = await withRLSContext(
        { auth: { userId: String(alice!.id), roles: ['admin', 'editor'], isSystem: false, tenantId: 1 } },
        async () => guard.canMutate('delete', 'posts', publishedPost!)
      );
      expect(canDelete).toBe(false);
    });

    it('should allow authors to delete their own drafts', async () => {
      const charlie = await db.selectFrom('users').selectAll().where('email', '=', 'charlie@acme.com').executeTakeFirst();

      const draftPost = await db.selectFrom('posts').selectAll().where('title', '=', 'Charlie Draft').executeTakeFirst();

      const canDelete = await withRLSContext(
        { auth: { userId: String(charlie!.id), roles: ['user'], isSystem: false, tenantId: 1 } },
        async () => guard.canMutate('delete', 'posts', draftPost!)
      );
      expect(canDelete).toBe(true);
    });
  });

  describe('Schema Merging for Modular Policies', () => {
    /**
     * Scenario: Composable policy modules
     * - Base tenant isolation
     * - Additional role-based policies
     * - Feature-specific policies
     */

    it('should merge multiple schema modules correctly', async () => {
      // Base schema with tenant isolation
      const baseSchema = defineRLSSchema<RLSTestDatabase>({
        users: {
          policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
        },
        posts: {
          policies: [filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId }))],
        },
      });

      // Admin override schema
      const adminSchema = defineRLSSchema<RLSTestDatabase>({
        users: {
          policies: [allow('all', (ctx) => ctx.auth.roles.includes('admin'))],
        },
        posts: {
          policies: [allow('all', (ctx) => ctx.auth.roles.includes('admin'))],
        },
      });

      // Feature schema for archived content
      const archiveSchema = defineRLSSchema<RLSTestDatabase>({
        resources: {
          policies: [
            filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),
            deny('update', (ctx) => ctx.row.is_archived === true || ctx.row.is_archived === 1),
          ],
        },
      });

      // Merge all schemas
      const mergedSchema = mergeRLSSchemas(baseSchema, adminSchema, archiveSchema);

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(mergedSchema);

      // Verify merged schema has all tables
      expect(mergedSchema.users).toBeDefined();
      expect(mergedSchema.posts).toBeDefined();
      expect(mergedSchema.resources).toBeDefined();

      // Verify merged policies for users (should have filter + admin allow)
      expect(mergedSchema.users!.policies.length).toBe(2);
    });
  });

  describe('Complex Access Control Matrix', () => {
    /**
     * Scenario: Document management with complex permissions
     * - Owner: full access
     * - Team members: read + comment
     * - Public: read only if shared
     * - Admin: full access
     * - Archived: read-only for everyone
     */

    const documentSchema = defineRLSSchema<RLSTestDatabase>({
      resources: {
        policies: [
          // Tenant isolation (always applied first via filter)
          filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),

          // Owner has full access
          allow('all', (ctx) => Number(ctx.auth.userId) === ctx.row.owner_id),

          // Admin has full access
          allow('all', (ctx) => ctx.auth.roles.includes('admin')),

          // Archived resources are read-only (deny mutations)
          deny(['create', 'update', 'delete'], (ctx) => ctx.row.is_archived === true || ctx.row.is_archived === 1),

          // Team members can read (would need team membership check in real app)
          allow('read', (ctx) => ctx.auth.roles.includes('team_member')),
        ],
        defaultDeny: true,
        skipFor: ['superadmin'],
      },
    });

    let registry: PolicyRegistry<RLSTestDatabase>;
    let guard: MutationGuard<RLSTestDatabase>;

    beforeEach(() => {
      registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(documentSchema);
      guard = new MutationGuard<RLSTestDatabase>(registry);
    });

    it('should enforce complete access control matrix', async () => {
      const alice = await db.selectFrom('users').selectAll().where('email', '=', 'alice@acme.com').executeTakeFirst();
      const bob = await db.selectFrom('users').selectAll().where('email', '=', 'bob@acme.com').executeTakeFirst();

      const aliceDoc = await db.selectFrom('resources').selectAll().where('name', '=', 'Alice Doc').executeTakeFirst();
      const bobDoc = await db.selectFrom('resources').selectAll().where('name', '=', 'Bob Doc').executeTakeFirst();
      const archivedDoc = await db
        .selectFrom('resources')
        .selectAll()
        .where('name', '=', 'Bob Archived')
        .executeTakeFirst();

      // Test matrix
      const testCases = [
        // Owner access
        {
          user: alice,
          roles: ['user'],
          resource: aliceDoc,
          operation: 'update' as const,
          expected: true,
          reason: 'Owner can update',
        },
        {
          user: alice,
          roles: ['user'],
          resource: aliceDoc,
          operation: 'delete' as const,
          expected: true,
          reason: 'Owner can delete',
        },

        // Non-owner access
        {
          user: alice,
          roles: ['user'],
          resource: bobDoc,
          operation: 'update' as const,
          expected: false,
          reason: 'Non-owner cannot update',
        },
        {
          user: alice,
          roles: ['user'],
          resource: bobDoc,
          operation: 'delete' as const,
          expected: false,
          reason: 'Non-owner cannot delete',
        },

        // Admin access
        {
          user: alice,
          roles: ['admin'],
          resource: bobDoc,
          operation: 'update' as const,
          expected: true,
          reason: 'Admin can update any',
        },
        {
          user: alice,
          roles: ['admin'],
          resource: bobDoc,
          operation: 'delete' as const,
          expected: true,
          reason: 'Admin can delete any',
        },

        // Archived resource
        {
          user: bob,
          roles: ['user'],
          resource: archivedDoc,
          operation: 'update' as const,
          expected: false,
          reason: 'Owner cannot update archived',
        },
        {
          user: alice,
          roles: ['admin'],
          resource: archivedDoc,
          operation: 'update' as const,
          expected: false,
          reason: 'Admin cannot update archived',
        },
        {
          user: bob,
          roles: ['user'],
          resource: archivedDoc,
          operation: 'read' as const,
          expected: true,
          reason: 'Owner can read archived',
        },
      ];

      for (const tc of testCases) {
        const result = await withRLSContext(
          { auth: { userId: String(tc.user!.id), roles: tc.roles, isSystem: false, tenantId: 1 } },
          async () => guard.canMutate(tc.operation, 'resources', tc.resource!)
        );

        expect(result, tc.reason).toBe(tc.expected);
      }
    });
  });

  describe('Async Policy Evaluation', () => {
    /**
     * Scenario: Policies that require database lookups
     * - Check team membership
     * - Check subscription status
     * - Check feature flags
     */

    it('should handle async validation policies', async () => {
      const alice = await db.selectFrom('users').selectAll().where('email', '=', 'alice@acme.com').executeTakeFirst();

      // Schema with async policy
      const asyncSchema = defineRLSSchema<RLSTestDatabase>({
        posts: {
          policies: [
            filter('read', (ctx) => ({ tenant_id: ctx.auth.tenantId })),
            // Async validation that checks user exists
            validate('create', async (ctx) => {
              // Simulate async database lookup
              const user = await db
                .selectFrom('users')
                .select('id')
                .where('id', '=', Number(ctx.auth.userId))
                .executeTakeFirst();
              return user !== undefined;
            }),
          ],
        },
      });

      const registry = new PolicyRegistry<RLSTestDatabase>();
      registry.register(asyncSchema);
      const guard = new MutationGuard<RLSTestDatabase>(registry);

      // Valid user
      const validResult = await withRLSContext(
        { auth: { userId: String(alice!.id), roles: ['user'], isSystem: false, tenantId: 1 } },
        async () =>
          guard.validateMutation(
            'create',
            'posts',
            { title: 'Test', tenant_id: 1, user_id: alice!.id, status: 'draft', is_public: false },
            undefined
          )
      );
      expect(validResult).toBe(true);

      // Invalid user ID
      const invalidResult = await withRLSContext(
        { auth: { userId: '99999', roles: ['user'], isSystem: false, tenantId: 1 } },
        async () =>
          guard.validateMutation(
            'create',
            'posts',
            { title: 'Test', tenant_id: 1, user_id: 99999, status: 'draft', is_public: false },
            undefined
          )
      );
      expect(invalidResult).toBe(false);
    });
  });
});
