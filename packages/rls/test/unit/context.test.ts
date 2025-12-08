import { describe, it, expect, beforeEach } from 'vitest';
import {
  rlsContext,
  createRLSContext,
  withRLSContext,
  withRLSContextAsync,
} from '../../src/context/index.js';
import { RLSContextError, RLSContextValidationError } from '../../src/errors.js';

describe('RLS Context', () => {
  describe('createRLSContext', () => {
    it('should create context with required fields', () => {
      const ctx = createRLSContext({
        auth: {
          userId: 'user-123',
          roles: ['user'],
        },
      });

      expect(ctx.auth.userId).toBe('user-123');
      expect(ctx.auth.roles).toEqual(['user']);
      expect(ctx.timestamp).toBeInstanceOf(Date);
    });

    it('should include optional fields', () => {
      const ctx = createRLSContext({
        auth: {
          userId: 'user-123',
          roles: ['admin'],
          tenantId: 'tenant-456',
          permissions: ['read', 'write'],
        },
        request: {
          requestId: 'req-789',
          ipAddress: '127.0.0.1',
        },
        meta: { custom: 'data' },
      });

      expect(ctx.auth.tenantId).toBe('tenant-456');
      expect(ctx.auth.permissions).toEqual(['read', 'write']);
      expect(ctx.request?.requestId).toBe('req-789');
      expect(ctx.meta).toEqual({ custom: 'data' });
    });

    it('should throw on missing userId', () => {
      expect(() => createRLSContext({
        auth: {
          userId: undefined as any,
          roles: [],
        },
      })).toThrow(RLSContextValidationError);
    });

    it('should throw on invalid roles', () => {
      expect(() => createRLSContext({
        auth: {
          userId: 'user-123',
          roles: 'admin' as any, // Should be array
        },
      })).toThrow(RLSContextValidationError);
    });
  });

  describe('rlsContext manager', () => {
    it('should run sync function within context', () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: [] },
      });

      const result = rlsContext.run(ctx, () => {
        return rlsContext.getUserId();
      });

      expect(result).toBe('user-123');
    });

    it('should run async function within context', async () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: [] },
      });

      const result = await rlsContext.runAsync(ctx, async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return rlsContext.getUserId();
      });

      expect(result).toBe('user-123');
    });

    it('should throw when getting context outside of run', () => {
      expect(() => rlsContext.getContext()).toThrow(RLSContextError);
    });

    it('should return null for getContextOrNull outside of run', () => {
      expect(rlsContext.getContextOrNull()).toBeNull();
    });

    it('should check hasContext correctly', () => {
      expect(rlsContext.hasContext()).toBe(false);

      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: [] },
      });

      rlsContext.run(ctx, () => {
        expect(rlsContext.hasContext()).toBe(true);
      });
    });

    it('should check roles correctly', () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: ['admin', 'user'] },
      });

      rlsContext.run(ctx, () => {
        expect(rlsContext.hasRole('admin')).toBe(true);
        expect(rlsContext.hasRole('superadmin')).toBe(false);
      });
    });

    it('should handle nested contexts', () => {
      const outerCtx = createRLSContext({
        auth: { userId: 'outer-user', roles: [] },
      });
      const innerCtx = createRLSContext({
        auth: { userId: 'inner-user', roles: [] },
      });

      rlsContext.run(outerCtx, () => {
        expect(rlsContext.getUserId()).toBe('outer-user');

        rlsContext.run(innerCtx, () => {
          expect(rlsContext.getUserId()).toBe('inner-user');
        });

        expect(rlsContext.getUserId()).toBe('outer-user');
      });
    });

    it('should create system context', () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: [], isSystem: false },
      });

      rlsContext.run(ctx, () => {
        expect(rlsContext.isSystem()).toBe(false);

        const result = rlsContext.asSystem(() => {
          expect(rlsContext.isSystem()).toBe(true);
          return 'done';
        });

        expect(result).toBe('done');
        expect(rlsContext.isSystem()).toBe(false);
      });
    });

    it('should throw when creating system context without existing context', () => {
      expect(() => rlsContext.asSystem(() => {})).toThrow(RLSContextError);
    });

    it('should support async system context', async () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: [], isSystem: false },
      });

      await rlsContext.runAsync(ctx, async () => {
        expect(rlsContext.isSystem()).toBe(false);

        const result = await rlsContext.asSystemAsync(async () => {
          expect(rlsContext.isSystem()).toBe(true);
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'done';
        });

        expect(result).toBe('done');
        expect(rlsContext.isSystem()).toBe(false);
      });
    });

    it('should get tenant ID correctly', () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: [], tenantId: 'tenant-456' },
      });

      rlsContext.run(ctx, () => {
        expect(rlsContext.getTenantId()).toBe('tenant-456');
      });
    });

    it('should check permissions correctly', () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: [], permissions: ['read', 'write'] },
      });

      rlsContext.run(ctx, () => {
        expect(rlsContext.hasPermission('read')).toBe(true);
        expect(rlsContext.hasPermission('delete')).toBe(false);
      });
    });

    it('should return false for hasPermission without permissions', () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: [] },
      });

      rlsContext.run(ctx, () => {
        expect(rlsContext.hasPermission('read')).toBe(false);
      });
    });

    it('should get auth context correctly', () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: ['admin'] },
      });

      rlsContext.run(ctx, () => {
        const auth = rlsContext.getAuth();
        expect(auth.userId).toBe('user-123');
        expect(auth.roles).toEqual(['admin']);
      });
    });
  });

  describe('withRLSContext helper', () => {
    it('should work as convenience wrapper', () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: [] },
      });

      const result = withRLSContext(ctx, () => {
        return rlsContext.getUserId();
      });

      expect(result).toBe('user-123');
    });
  });

  describe('withRLSContextAsync helper', () => {
    it('should work as async convenience wrapper', async () => {
      const ctx = createRLSContext({
        auth: { userId: 'user-123', roles: [] },
      });

      const result = await withRLSContextAsync(ctx, async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return rlsContext.getUserId();
      });

      expect(result).toBe('user-123');
    });
  });
});
