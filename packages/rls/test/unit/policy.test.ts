import { describe, it, expect } from 'vitest';
import {
  allow,
  deny,
  filter,
  validate,
  defineRLSSchema,
  mergeRLSSchemas,
} from '../../src/policy/index.js';
import { PolicyRegistry } from '../../src/policy/registry.js';
import { RLSSchemaError } from '../../src/errors.js';

// Test database schema
interface TestDB {
  users: {
    id: number;
    name: string;
    tenant_id: string;
    role: string;
  };
  resources: {
    id: number;
    owner_id: number;
    tenant_id: string;
    status: string;
  };
}

describe('Policy Builders', () => {
  describe('allow()', () => {
    it('should create allow policy', () => {
      const policy = allow('read', ctx => ctx.auth.userId === ctx.row?.id);

      expect(policy.type).toBe('allow');
      expect(policy.operation).toBe('read');
      expect(typeof policy.condition).toBe('function');
    });

    it('should support multiple operations', () => {
      const policy = allow(['read', 'update'], () => true);

      expect(policy.operation).toEqual(['read', 'update']);
    });

    it('should support options', () => {
      const policy = allow('read', () => true, {
        name: 'custom-policy',
        priority: 100,
      });

      expect(policy.name).toBe('custom-policy');
      expect(policy.priority).toBe(100);
    });

    it('should default priority to 0', () => {
      const policy = allow('read', () => true);

      expect(policy.priority).toBe(0);
    });

    it('should support hints', () => {
      const policy = allow('read', () => true, {
        name: 'test-policy',
        hints: { cacheable: true, cacheTTL: 300 },
      });

      expect(policy.name).toBe('test-policy');
      expect(policy.hints).toBeDefined();
      if (policy.hints) {
        expect(policy.hints.cacheable).toBe(true);
        expect(policy.hints.cacheTTL).toBe(300);
      }
    });
  });

  describe('deny()', () => {
    it('should create deny policy', () => {
      const policy = deny('delete', ctx => ctx.row?.status === 'published');

      expect(policy.type).toBe('deny');
      expect(policy.operation).toBe('delete');
    });

    it('should create deny policy without condition (always deny)', () => {
      const policy = deny('delete');

      expect(policy.type).toBe('deny');
      expect(typeof policy.condition).toBe('function');
      // Default condition returns true (always deny)
      expect((policy.condition as Function)({})).toBe(true);
    });

    it('should have higher default priority', () => {
      const policy = deny('delete');
      expect(policy.priority).toBe(100);
    });

    it('should support custom priority', () => {
      const policy = deny('delete', () => true, { priority: 200 });
      expect(policy.priority).toBe(200);
    });
  });

  describe('filter()', () => {
    it('should create filter policy with function', () => {
      const policy = filter('read', ctx => ({
        tenant_id: ctx.auth.tenantId,
      }));

      expect(policy.type).toBe('filter');
      expect(policy.operation).toBe('read');
    });

    it('should normalize "all" to "read"', () => {
      const policy = filter('all', ctx => ({}));

      expect(policy.operation).toBe('read');
    });

    it('should support hints', () => {
      const policy = filter('read', ctx => ({}), {
        name: 'test-filter',
        hints: { cacheable: true },
      });

      expect(policy.name).toBe('test-filter');
      expect(policy.hints).toBeDefined();
      if (policy.hints) {
        expect(policy.hints.cacheable).toBe(true);
      }
    });
  });

  describe('validate()', () => {
    it('should create validate policy', () => {
      const policy = validate('create', ctx => ctx.data?.tenant_id === ctx.auth.tenantId);

      expect(policy.type).toBe('validate');
    });

    it('should expand "all" to create and update', () => {
      const policy = validate('all', () => true);

      expect(policy.operation).toEqual(['create', 'update']);
    });

    it('should support single operation', () => {
      const createPolicy = validate('create', () => true);
      expect(createPolicy.operation).toEqual(['create']);

      const updatePolicy = validate('update', () => true);
      expect(updatePolicy.operation).toEqual(['update']);
    });

    it('should support hints for async validation', () => {
      const policy = validate('create', () => true, {
        name: 'test-validate',
        hints: { async: true },
      });

      expect(policy.name).toBe('test-validate');
      expect(policy.hints).toBeDefined();
      if (policy.hints) {
        expect(policy.hints.async).toBe(true);
      }
    });
  });
});

describe('defineRLSSchema', () => {
  it('should create valid schema', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [
          allow('read', ctx => true),
        ],
      },
    });

    expect(schema.users).toBeDefined();
    expect(schema.users?.policies.length).toBe(1);
  });

  it('should throw on invalid policy type', () => {
    expect(() => defineRLSSchema({
      users: {
        policies: [
          { type: 'invalid' as any, operation: 'read', condition: () => true },
        ],
      },
    })).toThrow(RLSSchemaError);
  });

  it('should throw on missing operation', () => {
    expect(() => defineRLSSchema({
      users: {
        policies: [
          { type: 'allow', operation: undefined as any, condition: () => true },
        ],
      },
    })).toThrow(RLSSchemaError);
  });

  it('should throw on missing condition', () => {
    expect(() => defineRLSSchema({
      users: {
        policies: [
          { type: 'allow', operation: 'read', condition: undefined as any },
        ],
      },
    })).toThrow(RLSSchemaError);
  });

  it('should throw on invalid condition type', () => {
    expect(() => defineRLSSchema({
      users: {
        policies: [
          { type: 'allow', operation: 'read', condition: 123 as any },
        ],
      },
    })).toThrow(RLSSchemaError);
  });

  it('should validate skipFor contains valid role names', () => {
    // Empty string is invalid
    expect(() => defineRLSSchema({
      users: {
        policies: [allow('read', () => true)],
        skipFor: ['', 'admin'] as any,
      },
    })).toThrow(RLSSchemaError);

    // Non-string is invalid
    expect(() => defineRLSSchema({
      users: {
        policies: [allow('read', () => true)],
        skipFor: [123] as any,
      },
    })).toThrow(RLSSchemaError);
  });

  it('should validate defaultDeny is boolean', () => {
    expect(() => defineRLSSchema({
      users: {
        policies: [allow('read', () => true)],
        defaultDeny: 'yes' as any,
      },
    })).toThrow(RLSSchemaError);
  });

  it('should accept valid skipFor role names', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
        skipFor: ['admin', 'superuser', 'system'],
      },
    });

    expect(schema.users?.skipFor).toEqual(['admin', 'superuser', 'system']);
  });

  it('should accept policy hints', () => {
    const schema = defineRLSSchema({
      users: {
        policies: [
          {
            type: 'allow',
            operation: 'read',
            condition: () => true,
            hints: { cacheable: true, async: true },
          },
        ],
      },
    });

    expect(schema.users?.policies[0].hints?.cacheable).toBe(true);
    expect(schema.users?.policies[0].hints?.async).toBe(true);
  });
});

describe('mergeRLSSchemas', () => {
  it('should merge schemas', () => {
    const schema1 = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
      },
    });

    const schema2 = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('update', () => true)],
      },
      resources: {
        policies: [allow('read', () => true)],
      },
    });

    const merged = mergeRLSSchemas(schema1, schema2);

    expect(merged.users?.policies.length).toBe(2);
    expect(merged.resources?.policies.length).toBe(1);
  });

  it('should merge skipFor role arrays', () => {
    const schema1 = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
        skipFor: ['admin'],
      },
    });

    const schema2 = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('update', () => true)],
        skipFor: ['superuser', 'admin'], // Duplicate 'admin'
      },
    });

    const merged = mergeRLSSchemas(schema1, schema2);

    // Should deduplicate
    expect(merged.users?.skipFor).toEqual(['admin', 'superuser']);
  });

  it('should override defaultDeny', () => {
    const schema1 = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
        defaultDeny: true,
      },
    });

    const schema2 = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('update', () => true)],
        defaultDeny: false,
      },
    });

    const merged = mergeRLSSchemas(schema1, schema2);

    expect(merged.users?.defaultDeny).toBe(false);
  });

  it('should validate merged schema', () => {
    const schema1 = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
      },
    });

    const schema2 = {
      users: {
        policies: [
          { type: 'invalid' as any, operation: 'read', condition: () => true },
        ],
      },
    };

    expect(() => mergeRLSSchemas(schema1, schema2 as any)).toThrow(RLSSchemaError);
  });

  it('should handle multiple schema merges', () => {
    const schema1 = defineRLSSchema<TestDB>({
      users: { policies: [allow('read', () => true)] },
    });

    const schema2 = defineRLSSchema<TestDB>({
      users: { policies: [allow('create', () => true)] },
    });

    const schema3 = defineRLSSchema<TestDB>({
      users: { policies: [allow('update', () => true)] },
    });

    const merged = mergeRLSSchemas(schema1, schema2, schema3);

    expect(merged.users?.policies.length).toBe(3);
  });
});

describe('PolicyRegistry', () => {
  it('should compile schema', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [
          allow('read', ctx => ctx.auth.userId === ctx.row?.id),
          deny('delete', ctx => ctx.row?.role === 'admin'),
        ],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);

    expect(registry.isCompiled()).toBe(true);
    expect(registry.hasTable('users')).toBe(true);
    expect(registry.hasTable('resources')).toBe(false);
  });

  it('should get policies by operation', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [
          allow('read', () => true),
          allow('update', () => true),
          deny('delete', () => true),
        ],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);

    const readAllows = registry.getAllows('users', 'read');
    expect(readAllows.length).toBe(1);

    const deleteDenies = registry.getDenies('users', 'delete');
    expect(deleteDenies.length).toBe(1);
  });

  it('should expand "all" operation', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [
          allow('all', () => true),
        ],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);

    expect(registry.getAllows('users', 'read').length).toBe(1);
    expect(registry.getAllows('users', 'create').length).toBe(1);
    expect(registry.getAllows('users', 'update').length).toBe(1);
    expect(registry.getAllows('users', 'delete').length).toBe(1);
  });

  it('should get filter policies', () => {
    const schema = defineRLSSchema<TestDB>({
      resources: {
        policies: [
          filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
        ],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);
    const filters = registry.getFilters('resources');

    expect(filters.length).toBe(1);
  });

  it('should sort policies by priority', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [
          allow('read', () => true, { priority: 10 }),
          allow('read', () => true, { priority: 100 }),
          allow('read', () => true, { priority: 50 }),
        ],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);
    const allows = registry.getAllows('users', 'read');

    expect(allows[0].priority).toBe(100);
    expect(allows[1].priority).toBe(50);
    expect(allows[2].priority).toBe(10);
  });

  it('should evaluate compiled policies', async () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [
          allow('read', ctx => ctx.auth.userId === ctx.row?.id),
        ],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);
    const allows = registry.getAllows('users', 'read');

    const result = await allows[0].evaluate({
      auth: { userId: 1, roles: [] },
      row: { id: 1, name: 'Test', tenant_id: 't1', role: 'user' },
      table: 'users',
      operation: 'read',
    });

    expect(result).toBe(true);

    const resultFalse = await allows[0].evaluate({
      auth: { userId: 2, roles: [] },
      row: { id: 1, name: 'Test', tenant_id: 't1', role: 'user' },
      table: 'users',
      operation: 'read',
    });

    expect(resultFalse).toBe(false);
  });

  it('should get skipFor roles', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
        skipFor: ['admin', 'superuser'],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);

    expect(registry.getSkipFor('users')).toEqual(['admin', 'superuser']);
  });

  it('should check defaultDeny setting', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
        defaultDeny: false,
      },
      resources: {
        policies: [allow('read', () => true)],
        defaultDeny: true,
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);

    expect(registry.hasDefaultDeny('users')).toBe(false);
    expect(registry.hasDefaultDeny('resources')).toBe(true);
  });

  it('should get all registered tables', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
      },
      resources: {
        policies: [allow('read', () => true)],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);
    const tables = registry.getTables();

    expect(tables).toContain('users');
    expect(tables).toContain('resources');
    expect(tables.length).toBe(2);
  });

  it('should clear all policies', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);

    expect(registry.hasTable('users')).toBe(true);

    registry.clear();

    expect(registry.hasTable('users')).toBe(false);
    expect(registry.isCompiled()).toBe(false);
  });

  it('should remove table policies', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
      },
      resources: {
        policies: [allow('read', () => true)],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);

    registry.remove('users');

    expect(registry.hasTable('users')).toBe(false);
    expect(registry.hasTable('resources')).toBe(true);
  });

  it('should support validate policies', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [
          validate('create', ctx => !!ctx.data?.name),
        ],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);
    const validates = registry.getValidates('users', 'create');

    expect(validates.length).toBe(1);
  });

  it('should default to defaultDeny=true', () => {
    const schema = defineRLSSchema<TestDB>({
      users: {
        policies: [allow('read', () => true)],
      },
    });

    const registry = new PolicyRegistry<TestDB>(schema);

    expect(registry.hasDefaultDeny('users')).toBe(true);
  });
});
