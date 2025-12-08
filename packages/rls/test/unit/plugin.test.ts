import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rlsPlugin } from '../../src/plugin.js';
import { defineRLSSchema, allow, deny, filter } from '../../src/policy/index.js';
import { rlsContext, createRLSContext } from '../../src/context/index.js';
import { RLSContextError, RLSPolicyViolation } from '../../src/errors.js';
import type { Plugin, QueryBuilderContext, AnyQueryBuilder } from '@kysera/repository';
import type { Kysely } from 'kysely';

interface TestDB {
  posts: {
    id: number;
    title: string;
    author_id: number;
    tenant_id: string;
    status: string;
  };
  comments: {
    id: number;
    post_id: number;
    author_id: number;
    content: string;
  };
  system_logs: {
    id: number;
    event: string;
    timestamp: Date;
  };
}

/**
 * Mock query builder for testing
 * Supports both Kysely where signatures:
 * - where(filter: Record<string, unknown>) - object filter
 * - where(column: string, operator: string, value: unknown) - three-arg form
 */
class MockQueryBuilder {
  public readonly metadata: Record<string, unknown> = {};
  private whereCalls: Array<Record<string, unknown>> = [];

  where(columnOrFilter: string | Record<string, unknown>, operator?: string, value?: unknown): this {
    if (typeof columnOrFilter === 'string') {
      // Three-argument form: where('column', '=', value)
      // Extract just the column name (remove table prefix if present)
      const column = columnOrFilter.includes('.')
        ? columnOrFilter.split('.').pop()!
        : columnOrFilter;
      this.whereCalls.push({ [column]: value });
    } else {
      // Object form: where({ column: value })
      this.whereCalls.push(columnOrFilter);
    }
    return this;
  }

  getWhereCalls(): Array<Record<string, unknown>> {
    return this.whereCalls;
  }
}

/**
 * Mock repository for testing
 */
interface MockRepository {
  tableName: string;
  executor: Kysely<TestDB>;
  findById?: (id: unknown) => Promise<unknown>;
  create?: (data: unknown) => Promise<unknown>;
  update?: (id: unknown, data: unknown) => Promise<unknown>;
  delete?: (id: unknown) => Promise<unknown>;
}

describe('rlsPlugin', () => {
  let schema: ReturnType<typeof defineRLSSchema<TestDB>>;

  beforeEach(() => {
    schema = defineRLSSchema<TestDB>({
      posts: {
        policies: [
          // Filter by tenant
          filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
          // Allow authors to do anything
          allow('all', ctx => ctx.auth.userId === ctx.row?.author_id),
          // Allow admins to do anything
          allow('all', ctx => ctx.auth.roles.includes('admin')),
          // Deny deletion of published posts
          deny('delete', ctx => ctx.row?.status === 'published'),
        ],
      },
      comments: {
        policies: [
          allow('all', ctx => ctx.auth.roles.includes('moderator')),
          allow('all', ctx => ctx.auth.userId === ctx.row?.author_id),
        ],
      },
    });
  });

  describe('rlsPlugin function', () => {
    it('should return plugin with correct name and version', () => {
      const plugin = rlsPlugin({ schema });

      expect(plugin.name).toBe('@kysera/rls');
      expect(plugin.version).toBe('0.5.1');
    });

    it('should have correct priority', () => {
      const plugin = rlsPlugin({ schema });

      expect(plugin.priority).toBe(50);
    });

    it('should have empty dependencies', () => {
      const plugin = rlsPlugin({ schema });

      expect(plugin.dependencies).toEqual([]);
    });

    it('should accept all valid options', () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const onViolation = vi.fn();

      const plugin = rlsPlugin({
        schema,
        skipTables: ['system_logs'],
        bypassRoles: ['admin', 'system'],
        logger,
        requireContext: true,
        auditDecisions: true,
        onViolation,
      });

      expect(plugin).toBeDefined();
      expect(plugin.name).toBe('@kysera/rls');
    });
  });

  describe('Plugin onInit', () => {
    it('should initialize without errors', async () => {
      const plugin = rlsPlugin({ schema });
      const mockExecutor = {} as Kysely<TestDB>;

      await expect(plugin.onInit!(mockExecutor)).resolves.toBeUndefined();
    });

    it('should log initialization when logger is provided', async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const plugin = rlsPlugin({
        schema,
        logger,
        skipTables: ['system_logs'],
        bypassRoles: ['admin'],
      });

      const mockExecutor = {} as Kysely<TestDB>;
      await plugin.onInit!(mockExecutor);

      expect(logger.info).toHaveBeenCalledWith(
        '[RLS] Initializing RLS plugin',
        expect.objectContaining({
          tables: 2,
          skipTables: 1,
          bypassRoles: 1,
        })
      );

      expect(logger.info).toHaveBeenCalledWith('[RLS] RLS plugin initialized successfully');
    });
  });

  describe('Plugin interceptQuery', () => {
    let plugin: Plugin;
    let mockExecutor: Kysely<TestDB>;

    beforeEach(async () => {
      plugin = rlsPlugin({ schema });
      mockExecutor = {} as Kysely<TestDB>;
      await plugin.onInit!(mockExecutor);
    });

    it('should skip excluded tables (skipTables option)', () => {
      const pluginWithSkip = rlsPlugin({
        schema,
        skipTables: ['system_logs'],
      });

      const qb = new MockQueryBuilder();
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'system_logs',
        metadata: {},
      };

      const result = pluginWithSkip.interceptQuery!(qb as unknown as AnyQueryBuilder, context);
      expect(result).toBe(qb);
      expect(qb.getWhereCalls()).toHaveLength(0);
    });

    it('should skip when metadata.skipRLS is true', () => {
      const qb = new MockQueryBuilder();
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'posts',
        metadata: { skipRLS: true },
      };

      const result = plugin.interceptQuery!(qb as unknown as AnyQueryBuilder, context);
      expect(result).toBe(qb);
      expect(qb.getWhereCalls()).toHaveLength(0);
    });

    it('should skip when no context is set and requireContext is false', () => {
      const qb = new MockQueryBuilder();
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'posts',
        metadata: {},
      };

      const result = plugin.interceptQuery!(qb as unknown as AnyQueryBuilder, context);
      expect(result).toBe(qb);
    });

    it('should throw when no context is set and requireContext is true', () => {
      const pluginWithRequireContext = rlsPlugin({
        schema,
        requireContext: true,
      });

      const qb = new MockQueryBuilder();
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'posts',
        metadata: {},
      };

      expect(() =>
        pluginWithRequireContext.interceptQuery!(qb as unknown as AnyQueryBuilder, context)
      ).toThrow(RLSContextError);
    });

    it('should skip for system users (ctx.auth.isSystem)', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: [], isSystem: true },
      });

      await rlsContext.runAsync(ctx, async () => {
        const qb = new MockQueryBuilder();
        const context: QueryBuilderContext = {
          operation: 'select',
          table: 'posts',
          metadata: {},
        };

        const result = plugin.interceptQuery!(qb as unknown as AnyQueryBuilder, context);
        expect(result).toBe(qb);
        expect(qb.getWhereCalls()).toHaveLength(0);
      });
    });

    it('should skip for bypass roles', async () => {
      const pluginWithBypass = rlsPlugin({
        schema,
        bypassRoles: ['admin', 'superuser'],
      });

      await pluginWithBypass.onInit!(mockExecutor);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['admin'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        const qb = new MockQueryBuilder();
        const context: QueryBuilderContext = {
          operation: 'select',
          table: 'posts',
          metadata: {},
        };

        const result = pluginWithBypass.interceptQuery!(qb as unknown as AnyQueryBuilder, context);
        expect(result).toBe(qb);
        expect(qb.getWhereCalls()).toHaveLength(0);
      });
    });

    it('should transform SELECT queries with filters', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        const qb = new MockQueryBuilder();
        const context: QueryBuilderContext = {
          operation: 'select',
          table: 'posts',
          metadata: {},
        };

        plugin.interceptQuery!(qb as unknown as AnyQueryBuilder, context);

        // Check that filter was applied
        const whereCalls = qb.getWhereCalls();
        expect(whereCalls.length).toBeGreaterThan(0);
        expect(whereCalls[0]).toHaveProperty('tenant_id', 't1');
      });
    });

    it('should mark mutations for later RLS check', async () => {
      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        const qb = new MockQueryBuilder();

        // Test insert
        const insertContext: QueryBuilderContext = {
          operation: 'insert',
          table: 'posts',
          metadata: {},
        };

        plugin.interceptQuery!(qb as unknown as AnyQueryBuilder, insertContext);
        expect(insertContext.metadata['__rlsRequired']).toBe(true);
        expect(insertContext.metadata['__rlsTable']).toBe('posts');

        // Test update
        const updateContext: QueryBuilderContext = {
          operation: 'update',
          table: 'posts',
          metadata: {},
        };

        plugin.interceptQuery!(qb as unknown as AnyQueryBuilder, updateContext);
        expect(updateContext.metadata['__rlsRequired']).toBe(true);
        expect(updateContext.metadata['__rlsTable']).toBe('posts');

        // Test delete
        const deleteContext: QueryBuilderContext = {
          operation: 'delete',
          table: 'posts',
          metadata: {},
        };

        plugin.interceptQuery!(qb as unknown as AnyQueryBuilder, deleteContext);
        expect(deleteContext.metadata['__rlsRequired']).toBe(true);
        expect(deleteContext.metadata['__rlsTable']).toBe('posts');
      });
    });

    it('should log debug messages when logger is provided', async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const pluginWithLogger = rlsPlugin({
        schema,
        logger,
        skipTables: ['system_logs'],
      });

      await pluginWithLogger.onInit!(mockExecutor);

      const qb = new MockQueryBuilder();
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'system_logs',
        metadata: {},
      };

      pluginWithLogger.interceptQuery!(qb as unknown as AnyQueryBuilder, context);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Skipping RLS for excluded table: system_logs')
      );
    });
  });

  describe('Plugin extendRepository', () => {
    let plugin: Plugin;
    let mockExecutor: Kysely<TestDB>;

    beforeEach(async () => {
      plugin = rlsPlugin({ schema });
      mockExecutor = {} as Kysely<TestDB>;
      await plugin.onInit!(mockExecutor);
    });

    it('should wrap create method with RLS checks', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 1 });
      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        create: mockCreate,
      };

      const extended = plugin.extendRepository!(mockRepo);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        // Should fail - user is not author of new post
        await expect(
          extended.create!({ title: 'Test', author_id: 2, tenant_id: 't1', status: 'draft' })
        ).rejects.toThrow(RLSPolicyViolation);
      });

      // Should succeed for admin
      const adminCtx = createRLSContext({
        auth: { userId: 1, roles: ['admin'], tenantId: 't1' },
      });

      await rlsContext.runAsync(adminCtx, async () => {
        await extended.create!({ title: 'Test', author_id: 2, tenant_id: 't1', status: 'draft' });
        expect(mockCreate).toHaveBeenCalled();
      });
    });

    it('should wrap update method with RLS checks', async () => {
      const mockFindById = vi.fn().mockResolvedValue({
        id: 1,
        title: 'Old Title',
        author_id: 1,
        tenant_id: 't1',
        status: 'draft',
      });
      const mockUpdate = vi.fn().mockResolvedValue({ id: 1 });

      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        findById: mockFindById,
        update: mockUpdate,
      };

      const extended = plugin.extendRepository!(mockRepo);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        // Should succeed - user is author
        await extended.update!(1, { title: 'New Title' });
        expect(mockUpdate).toHaveBeenCalledWith(1, { title: 'New Title' });
      });

      // Should fail - different user
      const otherUserCtx = createRLSContext({
        auth: { userId: 2, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(otherUserCtx, async () => {
        await expect(extended.update!(1, { title: 'New Title' })).rejects.toThrow(
          RLSPolicyViolation
        );
      });
    });

    it('should wrap delete method with RLS checks', async () => {
      const mockFindById = vi.fn().mockResolvedValue({
        id: 1,
        title: 'Test',
        author_id: 1,
        tenant_id: 't1',
        status: 'draft',
      });
      const mockDelete = vi.fn().mockResolvedValue(true);

      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        findById: mockFindById,
        delete: mockDelete,
      };

      const extended = plugin.extendRepository!(mockRepo);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        // Should succeed - user is author and status is draft
        await extended.delete!(1);
        expect(mockDelete).toHaveBeenCalledWith(1);
      });

      // Should fail - published posts cannot be deleted
      mockFindById.mockResolvedValue({
        id: 2,
        title: 'Published',
        author_id: 1,
        tenant_id: 't1',
        status: 'published',
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(extended.delete!(2)).rejects.toThrow(RLSPolicyViolation);
      });
    });

    it('should add withoutRLS helper method', async () => {
      const mockFindAll = vi.fn().mockResolvedValue([]);
      const mockRepo = {
        tableName: 'posts',
        executor: mockExecutor,
        findAll: mockFindAll,
      };

      const extended = plugin.extendRepository!(mockRepo);

      expect(extended).toHaveProperty('withoutRLS');
      expect(typeof (extended as any).withoutRLS).toBe('function');

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        // Should bypass RLS
        const isSystem = await (extended as any).withoutRLS(async () => {
          return rlsContext.isSystem();
        });

        expect(isSystem).toBe(true);
      });
    });

    it('should add canAccess helper method', async () => {
      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
      };

      const extended = plugin.extendRepository!(mockRepo);

      expect(extended).toHaveProperty('canAccess');
      expect(typeof (extended as any).canAccess).toBe('function');

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        // User can read their own post
        const canRead = await (extended as any).canAccess('read', {
          id: 1,
          author_id: 1,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canRead).toBe(true);

        // User cannot read other's post
        const canReadOther = await (extended as any).canAccess('read', {
          id: 2,
          author_id: 2,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canReadOther).toBe(false);

        // User can delete their draft
        const canDelete = await (extended as any).canAccess('delete', {
          id: 1,
          author_id: 1,
          tenant_id: 't1',
          status: 'draft',
        });
        expect(canDelete).toBe(true);

        // User cannot delete published post
        const canDeletePublished = await (extended as any).canAccess('delete', {
          id: 1,
          author_id: 1,
          tenant_id: 't1',
          status: 'published',
        });
        expect(canDeletePublished).toBe(false);
      });
    });

    it('should skip non-repository objects', () => {
      const notARepo = { someProp: 'value' };

      const result = plugin.extendRepository!(notARepo);
      expect(result).toBe(notARepo);
      expect(result).not.toHaveProperty('withoutRLS');
    });

    it('should skip tables not in schema', () => {
      const mockRepo: MockRepository = {
        tableName: 'unknown_table',
        executor: mockExecutor,
        create: vi.fn(),
      };

      const result = plugin.extendRepository!(mockRepo);
      // Should return original repo without wrapping
      expect(result).toBe(mockRepo);
    });

    it('should skip excluded tables in extendRepository', async () => {
      const pluginWithSkip = rlsPlugin({
        schema,
        skipTables: ['posts'],
      });

      await pluginWithSkip.onInit!(mockExecutor);

      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        create: vi.fn(),
      };

      const result = pluginWithSkip.extendRepository!(mockRepo);
      expect(result).toBe(mockRepo);
    });
  });

  describe('Options handling', () => {
    let mockExecutor: Kysely<TestDB>;

    beforeEach(() => {
      mockExecutor = {} as Kysely<TestDB>;
    });

    it('should respect auditDecisions option', async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const plugin = rlsPlugin({
        schema,
        logger,
        auditDecisions: true,
      });

      await plugin.onInit!(mockExecutor);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        const qb = new MockQueryBuilder();
        const context: QueryBuilderContext = {
          operation: 'select',
          table: 'posts',
          metadata: {},
        };

        plugin.interceptQuery!(qb as unknown as AnyQueryBuilder, context);

        expect(logger.info).toHaveBeenCalledWith(
          '[RLS] Filter applied',
          expect.objectContaining({
            table: 'posts',
            operation: 'select',
            userId: 1,
          })
        );
      });
    });

    it('should call onViolation callback on violations', async () => {
      const onViolation = vi.fn();
      const plugin = rlsPlugin({
        schema,
        onViolation,
      });

      await plugin.onInit!(mockExecutor);

      const mockFindById = vi.fn().mockResolvedValue({
        id: 1,
        title: 'Test',
        author_id: 2, // Different author
        tenant_id: 't1',
        status: 'draft',
      });
      const mockUpdate = vi.fn();

      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        findById: mockFindById,
        update: mockUpdate,
      };

      const extended = plugin.extendRepository!(mockRepo);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        try {
          await extended.update!(1, { title: 'New Title' });
        } catch (error) {
          // Expected to throw
        }

        expect(onViolation).toHaveBeenCalledWith(expect.any(RLSPolicyViolation));
      });
    });

    it('should use provided logger', async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const plugin = rlsPlugin({
        schema,
        logger,
      });

      await plugin.onInit!(mockExecutor);

      expect(logger.info).toHaveBeenCalledWith(
        '[RLS] Initializing RLS plugin',
        expect.any(Object)
      );
      expect(logger.info).toHaveBeenCalledWith('[RLS] RLS plugin initialized successfully');
    });

    it('should not log when no logger is provided', async () => {
      const plugin = rlsPlugin({ schema });

      await plugin.onInit!(mockExecutor);

      // Should not throw, logger is optional
      expect(plugin).toBeDefined();
    });

    it('should handle audit decisions for create operations', async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const plugin = rlsPlugin({
        schema,
        logger,
        auditDecisions: true,
      });

      await plugin.onInit!(mockExecutor);

      const mockCreate = vi.fn().mockResolvedValue({ id: 1 });
      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        create: mockCreate,
      };

      const extended = plugin.extendRepository!(mockRepo);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['admin'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        await extended.create!({ title: 'Test', author_id: 1, tenant_id: 't1', status: 'draft' });

        expect(logger.info).toHaveBeenCalledWith(
          '[RLS] Create allowed',
          expect.objectContaining({
            table: 'posts',
            userId: 1,
          })
        );
      });
    });

    it('should handle audit decisions for failed operations', async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const plugin = rlsPlugin({
        schema,
        logger,
        auditDecisions: true,
      });

      await plugin.onInit!(mockExecutor);

      const mockFindById = vi.fn().mockResolvedValue({
        id: 1,
        title: 'Published',
        author_id: 1,
        tenant_id: 't1',
        status: 'published',
      });
      const mockDelete = vi.fn();

      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        findById: mockFindById,
        delete: mockDelete,
      };

      const extended = plugin.extendRepository!(mockRepo);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        try {
          await extended.delete!(1);
        } catch (error) {
          // Expected to throw
        }

        expect(logger.warn).toHaveBeenCalledWith(
          '[RLS] Delete denied',
          expect.objectContaining({
            table: 'posts',
            id: 1,
            userId: 1,
          })
        );
      });
    });
  });

  describe('Context bypass scenarios', () => {
    let plugin: Plugin;
    let mockExecutor: Kysely<TestDB>;

    beforeEach(async () => {
      plugin = rlsPlugin({
        schema,
        bypassRoles: ['admin', 'superuser'],
      });
      mockExecutor = {} as Kysely<TestDB>;
      await plugin.onInit!(mockExecutor);
    });

    it('should bypass RLS for system context in repository methods', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 1 });
      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        create: mockCreate,
      };

      const extended = plugin.extendRepository!(mockRepo);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: [], isSystem: true },
      });

      await rlsContext.runAsync(ctx, async () => {
        // Should succeed without policy checks
        await extended.create!({ title: 'Test', author_id: 999, tenant_id: 't1', status: 'draft' });
        expect(mockCreate).toHaveBeenCalled();
      });
    });

    it('should bypass RLS for bypass roles in repository methods', async () => {
      const mockFindById = vi.fn().mockResolvedValue({
        id: 1,
        title: 'Test',
        author_id: 2,
        tenant_id: 't1',
        status: 'published',
      });
      const mockDelete = vi.fn().mockResolvedValue(true);

      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        findById: mockFindById,
        delete: mockDelete,
      };

      const extended = plugin.extendRepository!(mockRepo);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['admin'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        // Admin should bypass even deny policies
        await extended.delete!(1);
        expect(mockDelete).toHaveBeenCalled();
      });
    });

    it('should handle missing findById for update gracefully', async () => {
      const mockUpdate = vi.fn().mockResolvedValue({ id: 1 });
      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        update: mockUpdate,
        // findById is missing
      };

      const extended = plugin.extendRepository!(mockRepo);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        await expect(extended.update!(1, { title: 'New Title' })).rejects.toThrow(
          'Repository does not support update operation'
        );
      });
    });

    it('should handle non-existent row in update', async () => {
      const mockFindById = vi.fn().mockResolvedValue(null);
      const mockUpdate = vi.fn().mockResolvedValue(null);

      const mockRepo: MockRepository = {
        tableName: 'posts',
        executor: mockExecutor,
        findById: mockFindById,
        update: mockUpdate,
      };

      const extended = plugin.extendRepository!(mockRepo);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: ['user'], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        // Should still call original update
        await extended.update!(999, { title: 'New Title' });
        expect(mockUpdate).toHaveBeenCalledWith(999, { title: 'New Title' });
      });
    });
  });

  describe('Error handling', () => {
    let plugin: Plugin;
    let mockExecutor: Kysely<TestDB>;

    beforeEach(async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      plugin = rlsPlugin({ schema, logger });
      mockExecutor = {} as Kysely<TestDB>;
      await plugin.onInit!(mockExecutor);
    });

    it('should handle errors in query transformation', async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      // Schema with invalid filter that throws
      const badSchema = defineRLSSchema<TestDB>({
        posts: {
          policies: [
            filter('read', () => {
              throw new Error('Filter error');
            }),
          ],
        },
      });

      const badPlugin = rlsPlugin({ schema: badSchema, logger });
      await badPlugin.onInit!(mockExecutor);

      const ctx = createRLSContext({
        auth: { userId: 1, roles: [], tenantId: 't1' },
      });

      await rlsContext.runAsync(ctx, async () => {
        const qb = new MockQueryBuilder();
        const context: QueryBuilderContext = {
          operation: 'select',
          table: 'posts',
          metadata: {},
        };

        expect(() => badPlugin.interceptQuery!(qb as unknown as AnyQueryBuilder, context)).toThrow(
          'Filter error'
        );

        expect(logger.error).toHaveBeenCalledWith(
          '[RLS] Error applying filter',
          expect.objectContaining({
            table: 'posts',
          })
        );
      });
    });
  });
});
