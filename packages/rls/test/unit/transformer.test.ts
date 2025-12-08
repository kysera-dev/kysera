import { describe, it, expect, beforeEach } from 'vitest';
import { MutationGuard } from '../../src/transformer/mutation.js';
import { PolicyRegistry } from '../../src/policy/registry.js';
import { defineRLSSchema, allow, deny, filter } from '../../src/policy/index.js';
import { rlsContext, createRLSContext } from '../../src/context/index.js';
import { RLSPolicyViolation } from '../../src/errors.js';

interface TestDB {
  resources: {
    id: number;
    owner_id: number;
    tenant_id: string;
    status: string;
  };
}

describe('MutationGuard', () => {
  let registry: PolicyRegistry<TestDB>;
  let guard: MutationGuard<TestDB>;

  beforeEach(() => {
    const schema = defineRLSSchema<TestDB>({
      resources: {
        policies: [
          // Allow owners to do anything
          allow('all', ctx => ctx.auth.userId === ctx.row?.owner_id),
          // Allow admins to do anything
          allow('all', ctx => ctx.auth.roles.includes('admin')),
          // Deny deletion of published resources
          deny('delete', ctx => ctx.row?.status === 'published'),
        ],
      },
    });

    registry = new PolicyRegistry<TestDB>(schema);
    guard = new MutationGuard<TestDB>(registry);
  });

  describe('checkCreate', () => {
    it('should allow when policy passes', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['admin'] },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(guard.checkCreate('resources', {
          owner_id: 2,
          tenant_id: 't1',
          status: 'draft',
        })).resolves.toBeUndefined();
      });
    });

    it('should deny when no policy matches', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'] },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(guard.checkCreate('resources', {
          owner_id: 2,
          tenant_id: 't1',
          status: 'draft',
        })).rejects.toThrow(RLSPolicyViolation);
      });
    });

    it('should throw when no context is set', async () => {
      await expect(guard.checkCreate('resources', {
        owner_id: 1,
        tenant_id: 't1',
        status: 'draft',
      })).rejects.toThrow(RLSPolicyViolation);
    });
  });

  describe('checkUpdate', () => {
    it('should allow owner to update', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'] },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(guard.checkUpdate(
          'resources',
          { id: 1, owner_id: 1, tenant_id: 't1', status: 'draft' },
          { status: 'published' }
        )).resolves.toBeUndefined();
      });
    });

    it('should deny non-owner update', async () => {
      const ctx = createRLSContext({
        auth: { userId: 2, roles: ['user'] },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(guard.checkUpdate(
          'resources',
          { id: 1, owner_id: 1, tenant_id: 't1', status: 'draft' },
          { status: 'published' }
        )).rejects.toThrow(RLSPolicyViolation);
      });
    });

    it('should allow admin to update any resource', async () => {
      const ctx = createRLSContext({
        auth: { userId: 2, roles: ['admin'] },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(guard.checkUpdate(
          'resources',
          { id: 1, owner_id: 1, tenant_id: 't1', status: 'draft' },
          { status: 'published' }
        )).resolves.toBeUndefined();
      });
    });
  });

  describe('checkDelete', () => {
    it('should allow owner to delete draft', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'] },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(guard.checkDelete(
          'resources',
          { id: 1, owner_id: 1, tenant_id: 't1', status: 'draft' }
        )).resolves.toBeUndefined();
      });
    });

    it('should deny deletion of published resources', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'] },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(guard.checkDelete(
          'resources',
          { id: 1, owner_id: 1, tenant_id: 't1', status: 'published' }
        )).rejects.toThrow(RLSPolicyViolation);
      });
    });

    it('should deny even admin from deleting published', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['admin'] },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(guard.checkDelete(
          'resources',
          { id: 1, owner_id: 2, tenant_id: 't1', status: 'published' }
        )).rejects.toThrow(RLSPolicyViolation);
      });
    });

    it('should include policy name in error message', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'] },
      });

      await rlsContext.runAsync(ctx, async () => {
        try {
          await guard.checkDelete(
            'resources',
            { id: 1, owner_id: 1, tenant_id: 't1', status: 'published' }
          );
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(RLSPolicyViolation);
          if (error instanceof RLSPolicyViolation) {
            expect(error.message).toContain('Denied by policy');
          }
        }
      });
    });
  });

  describe('system user bypass', () => {
    it('should bypass RLS for system user', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: [], isSystem: true },
      });

      await rlsContext.runAsync(ctx, async () => {
        // Should pass even though no policy matches
        await expect(guard.checkDelete(
          'resources',
          { id: 1, owner_id: 999, tenant_id: 't1', status: 'published' }
        )).resolves.toBeUndefined();
      });
    });

    it('should bypass create checks for system user', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: [], isSystem: true },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(guard.checkCreate('resources', {
          owner_id: 999,
          tenant_id: 't1',
          status: 'draft',
        })).resolves.toBeUndefined();
      });
    });

    it('should bypass update checks for system user', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: [], isSystem: true },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(guard.checkUpdate(
          'resources',
          { id: 1, owner_id: 999, tenant_id: 't1', status: 'draft' },
          { status: 'published' }
        )).resolves.toBeUndefined();
      });
    });
  });

  describe('checkRead', () => {
    it('should return true for accessible rows', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: [] },
      });

      await rlsContext.runAsync(ctx, async () => {
        const canRead = await guard.checkRead('resources', {
          id: 1,
          owner_id: 1,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canRead).toBe(true);
      });
    });

    it('should return false for inaccessible rows', async () => {
      const ctx = createRLSContext({
        auth: { userId: 2, roles: [] },
      });

      await rlsContext.runAsync(ctx, async () => {
        const canRead = await guard.checkRead('resources', {
          id: 1,
          owner_id: 1,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canRead).toBe(false);
      });
    });

    it('should return true for admin users', async () => {
      const ctx = createRLSContext({
        auth: { userId: 2, roles: ['admin'] },
      });

      await rlsContext.runAsync(ctx, async () => {
        const canRead = await guard.checkRead('resources', {
          id: 1,
          owner_id: 1,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canRead).toBe(true);
      });
    });

    it('should return true for system users', async () => {
      const ctx = createRLSContext({
        auth: { userId: 2, roles: [], isSystem: true },
      });

      await rlsContext.runAsync(ctx, async () => {
        const canRead = await guard.checkRead('resources', {
          id: 1,
          owner_id: 1,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canRead).toBe(true);
      });
    });
  });

  describe('filterRows', () => {
    it('should filter rows based on access', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: [] },
      });

      const rows = [
        { id: 1, owner_id: 1, tenant_id: 't1', status: 'draft' },
        { id: 2, owner_id: 2, tenant_id: 't1', status: 'draft' },
        { id: 3, owner_id: 1, tenant_id: 't1', status: 'published' },
      ];

      await rlsContext.runAsync(ctx, async () => {
        const filtered = await guard.filterRows('resources', rows);
        expect(filtered.length).toBe(2);
        expect(filtered.map(r => r.id)).toEqual([1, 3]);
      });
    });

    it('should return empty array when no rows are accessible', async () => {
      const ctx = createRLSContext({
        auth: { userId: 999, roles: [] },
      });

      const rows = [
        { id: 1, owner_id: 1, tenant_id: 't1', status: 'draft' },
        { id: 2, owner_id: 2, tenant_id: 't1', status: 'draft' },
      ];

      await rlsContext.runAsync(ctx, async () => {
        const filtered = await guard.filterRows('resources', rows);
        expect(filtered.length).toBe(0);
      });
    });

    it('should return all rows for admin', async () => {
      const ctx = createRLSContext({
        auth: { userId: 999, roles: ['admin'] },
      });

      const rows = [
        { id: 1, owner_id: 1, tenant_id: 't1', status: 'draft' },
        { id: 2, owner_id: 2, tenant_id: 't1', status: 'draft' },
        { id: 3, owner_id: 3, tenant_id: 't1', status: 'published' },
      ];

      await rlsContext.runAsync(ctx, async () => {
        const filtered = await guard.filterRows('resources', rows);
        expect(filtered.length).toBe(3);
      });
    });
  });

  describe('defaultDeny behavior', () => {
    it('should deny when no allow policies exist', async () => {
      const schema = defineRLSSchema<TestDB>({
        resources: {
          policies: [],
          defaultDeny: true,
        },
      });

      const registry = new PolicyRegistry<TestDB>(schema);
      const guard = new MutationGuard<TestDB>(registry);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: [] },
      });

      await rlsContext.runAsync(ctx, async () => {
        const canRead = await guard.checkRead('resources', {
          id: 1,
          owner_id: 1,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canRead).toBe(false);
      });
    });

    it('should allow when defaultDeny is false and no policies exist', async () => {
      const schema = defineRLSSchema<TestDB>({
        resources: {
          policies: [],
          defaultDeny: false,
        },
      });

      const registry = new PolicyRegistry<TestDB>(schema);
      const guard = new MutationGuard<TestDB>(registry);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: [] },
      });

      await rlsContext.runAsync(ctx, async () => {
        const canRead = await guard.checkRead('resources', {
          id: 1,
          owner_id: 1,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canRead).toBe(true);
      });
    });
  });

  describe('skipFor behavior', () => {
    it('should skip RLS when user role matches skipFor', async () => {
      const schema = defineRLSSchema<TestDB>({
        resources: {
          policies: [
            allow('read', ctx => ctx.auth.userId === ctx.row?.owner_id),
          ],
          skipFor: ['admin'], // Skip RLS for admin role
        },
      });

      const registry = new PolicyRegistry<TestDB>(schema);
      const guard = new MutationGuard<TestDB>(registry);

      const ctx = createRLSContext({
        auth: { userId: 999, roles: ['admin'] }, // Has admin role
      });

      await rlsContext.runAsync(ctx, async () => {
        // Should pass because user has admin role which is in skipFor
        const canRead = await guard.checkRead('resources', {
          id: 1,
          owner_id: 1,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canRead).toBe(true);
      });
    });

    it('should not skip RLS when user role does not match skipFor', async () => {
      const schema = defineRLSSchema<TestDB>({
        resources: {
          policies: [
            allow('read', ctx => ctx.auth.userId === ctx.row?.owner_id),
          ],
          skipFor: ['admin', 'superuser'], // Skip RLS for admin and superuser roles
        },
      });

      const registry = new PolicyRegistry<TestDB>(schema);
      const guard = new MutationGuard<TestDB>(registry);

      const ctx = createRLSContext({
        auth: { userId: 999, roles: ['user'] }, // Only has user role, not in skipFor
      });

      await rlsContext.runAsync(ctx, async () => {
        const canRead = await guard.checkRead('resources', {
          id: 1,
          owner_id: 1,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canRead).toBe(false);
      });
    });
  });

  describe('error handling', () => {
    it('should handle policy evaluation errors', async () => {
      const schema = defineRLSSchema<TestDB>({
        resources: {
          policies: [
            allow('read', () => {
              throw new Error('Policy error');
            }),
          ],
        },
      });

      const registry = new PolicyRegistry<TestDB>(schema);
      const guard = new MutationGuard<TestDB>(registry);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: [] },
      });

      await rlsContext.runAsync(ctx, async () => {
        // checkRead catches RLSPolicyViolation and returns false
        // We need to use checkMutation directly or checkCreate/Update/Delete
        await expect(guard.checkDelete('resources', {
          id: 1,
          owner_id: 1,
          tenant_id: 't1',
          status: 'draft',
        })).rejects.toThrow(RLSPolicyViolation);
      });
    });

    it('should include error details in violation', async () => {
      const schema = defineRLSSchema<TestDB>({
        resources: {
          policies: [
            allow('delete', () => {
              throw new Error('Custom policy error');
            }),
          ],
        },
      });

      const registry = new PolicyRegistry<TestDB>(schema);
      const guard = new MutationGuard<TestDB>(registry);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: [] },
      });

      await rlsContext.runAsync(ctx, async () => {
        try {
          await guard.checkDelete('resources', {
            id: 1,
            owner_id: 1,
            tenant_id: 't1',
            status: 'draft',
          });
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(RLSPolicyViolation);
          if (error instanceof RLSPolicyViolation) {
            expect(error.message).toContain('Policy evaluation error');
            expect(error.message).toContain('Custom policy error');
          }
        }
      });
    });
  });
});
