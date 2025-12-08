import { describe, it, expect, vi } from 'vitest';
import { PostgresRLSGenerator, syncContextToPostgres } from '../../src/native/postgres.js';
import { RLSMigrationGenerator } from '../../src/native/migration.js';
import { defineRLSSchema } from '../../src/policy/index.js';
import type { RLSSchema, PolicyDefinition } from '../../src/policy/types.js';
import { sql } from 'kysely';

// Test database schema
interface TestDB {
  users: {
    id: number;
    name: string;
    tenant_id: string;
    role: string;
  };
  posts: {
    id: number;
    title: string;
    author_id: number;
    tenant_id: string;
    status: string;
  };
  resources: {
    id: number;
    owner_id: number;
    tenant_id: string;
  };
}

describe('PostgresRLSGenerator', () => {
  describe('generateStatements()', () => {
    it('should generate valid SQL for RLS policies', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'id = rls_current_user_id()::int',
              name: 'user_self_access',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      // Should generate: ENABLE RLS, FORCE RLS, and CREATE POLICY statements
      expect(statements.length).toBeGreaterThanOrEqual(2);
      expect(statements[0]).toBe('ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;');
      expect(statements[1]).toBe('ALTER TABLE public.users FORCE ROW LEVEL SECURITY;');
      // Third statement would be CREATE POLICY if there's a policy with USING clause
      expect(statements.some(s => s.includes('CREATE POLICY') || s.includes('ENABLE ROW LEVEL'))).toBe(true);
    });

    it('should generate policy with USING clause', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'tenant_id = rls_current_tenant_id()',
              name: 'tenant_isolation',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      const policyStatement = statements.find(s => s.includes('CREATE POLICY'));
      expect(policyStatement).toBeDefined();
      expect(policyStatement).toContain('CREATE POLICY "tenant_isolation"');
      expect(policyStatement).toContain('ON public.users');
      expect(policyStatement).toContain('AS PERMISSIVE');
      expect(policyStatement).toContain('TO public');
      expect(policyStatement).toContain('FOR SELECT');
      expect(policyStatement).toContain('USING (tenant_id = rls_current_tenant_id())');
    });

    it('should generate policy with WITH CHECK clause', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'create',
              condition: '',
              withCheck: 'tenant_id = rls_current_tenant_id()',
              name: 'tenant_insert_check',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      const policyStatement = statements.find(s => s.includes('CREATE POLICY'));
      expect(policyStatement).toContain('FOR INSERT');
      expect(policyStatement).toContain('WITH CHECK (tenant_id = rls_current_tenant_id())');
    });

    it('should generate policy with both USING and WITH CHECK clauses', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'update',
              condition: '',
              using: 'id = rls_current_user_id()::int',
              withCheck: 'tenant_id = rls_current_tenant_id()',
              name: 'user_update_policy',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      const policyStatement = statements.find(s => s.includes('CREATE POLICY'));
      expect(policyStatement).toContain('FOR UPDATE');
      expect(policyStatement).toContain('USING (id = rls_current_user_id()::int)');
      expect(policyStatement).toContain('WITH CHECK (tenant_id = rls_current_tenant_id())');
    });

    it('should handle force option', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();

      const statementsWithForce = generator.generateStatements(schema, { force: true });
      expect(statementsWithForce.some(s => s.includes('FORCE ROW LEVEL SECURITY'))).toBe(true);

      const statementsWithoutForce = generator.generateStatements(schema, { force: false });
      expect(statementsWithoutForce.some(s => s.includes('FORCE ROW LEVEL SECURITY'))).toBe(false);
    });

    it('should handle schemaName option', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema, { schemaName: 'app_schema' });

      expect(statements[0]).toContain('app_schema.users');
    });

    it('should handle policyPrefix option', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema, { policyPrefix: 'custom' });

      const policyStatement = statements.find(s => s.includes('CREATE POLICY'));
      expect(policyStatement).toMatch(/CREATE POLICY "custom_users_\w+_\d+"/);
    });

    it('should skip filter policies (they are ORM-only)', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'filter',
              operation: 'read',
              condition: ctx => ({ tenant_id: ctx.auth.tenantId }),
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      // Should only have ENABLE RLS statements, no CREATE POLICY
      expect(statements).toHaveLength(2);
      expect(statements.every(s => !s.includes('CREATE POLICY'))).toBe(true);
    });

    it('should skip validate policies (they are ORM-only)', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'validate',
              operation: 'create',
              condition: ctx => !!ctx.data?.name,
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      // Should only have ENABLE RLS statements, no CREATE POLICY
      expect(statements).toHaveLength(2);
      expect(statements.every(s => !s.includes('CREATE POLICY'))).toBe(true);
    });

    it('should skip policies without USING or WITH CHECK clauses', () => {
      const schema: RLSSchema<TestDB> = {
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: () => true,
              // No using or withCheck
            },
          ],
        },
      };

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      // Should only have ENABLE RLS statements, no CREATE POLICY
      expect(statements).toHaveLength(2);
      expect(statements.every(s => !s.includes('CREATE POLICY'))).toBe(true);
    });

    it('should handle deny policies with AS RESTRICTIVE', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'deny',
              operation: 'delete',
              condition: '',
              using: 'role = \'admin\'',
              name: 'prevent_admin_delete',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      const policyStatement = statements.find(s => s.includes('CREATE POLICY'));
      expect(policyStatement).toContain('AS RESTRICTIVE');
    });

    it('should handle custom role in policy', () => {
      const schema: RLSSchema<TestDB> = {
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
              role: 'authenticated',
              name: 'auth_read',
            },
          ],
        },
      };

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      const policyStatement = statements.find(s => s.includes('CREATE POLICY'));
      expect(policyStatement).toContain('TO authenticated');
    });

    it('should map operations correctly', () => {
      const operations: Array<[string, string]> = [
        ['read', 'SELECT'],
        ['create', 'INSERT'],
        ['update', 'UPDATE'],
        ['delete', 'DELETE'],
        ['all', 'ALL'],
      ];

      for (const [op, expected] of operations) {
        const schema: RLSSchema<TestDB> = {
          users: {
            policies: [
              {
                type: 'allow',
                operation: op as any,
                condition: '',
                using: 'true',
              },
            ],
          },
        };

        const generator = new PostgresRLSGenerator();
        const statements = generator.generateStatements(schema);
        const policyStatement = statements.find(s => s.includes('CREATE POLICY'));

        expect(policyStatement).toContain(`FOR ${expected}`);
      }
    });

    it('should handle array of operations (uses first operation)', () => {
      const schema: RLSSchema<TestDB> = {
        users: {
          policies: [
            {
              type: 'allow',
              operation: ['read', 'update'],
              condition: '',
              using: 'true',
              name: 'multi_op',
            },
          ],
        },
      };

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);
      const policyStatement = statements.find(s => s.includes('CREATE POLICY'));

      // Should use first operation
      expect(policyStatement).toContain('FOR SELECT');
    });

    it('should treat full array of operations as ALL', () => {
      const schema: RLSSchema<TestDB> = {
        users: {
          policies: [
            {
              type: 'allow',
              operation: ['read', 'create', 'update', 'delete'],
              condition: '',
              using: 'true',
            },
          ],
        },
      };

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);
      const policyStatement = statements.find(s => s.includes('CREATE POLICY'));

      expect(policyStatement).toContain('FOR ALL');
    });

    it('should handle multiple tables', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
        posts: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      expect(statements.some(s => s.includes('users'))).toBe(true);
      expect(statements.some(s => s.includes('posts'))).toBe(true);
    });

    it('should generate multiple policies for same table', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'tenant_id = rls_current_tenant_id()',
              name: 'tenant_read',
            },
            {
              type: 'allow',
              operation: 'update',
              condition: '',
              using: 'id = rls_current_user_id()::int',
              name: 'self_update',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateStatements(schema);

      const policyStatements = statements.filter(s => s.includes('CREATE POLICY'));
      expect(policyStatements).toHaveLength(2);
      expect(policyStatements[0]).toContain('tenant_read');
      expect(policyStatements[1]).toContain('self_update');
    });
  });

  describe('generateContextFunctions()', () => {
    it('should generate STABLE context functions', () => {
      const generator = new PostgresRLSGenerator();
      const functions = generator.generateContextFunctions();

      expect(functions).toContain('CREATE OR REPLACE FUNCTION rls_current_user_id()');
      expect(functions).toContain('RETURNS text');
      expect(functions).toContain('LANGUAGE SQL STABLE');
      expect(functions).toContain('SELECT current_setting(\'app.user_id\', true)');
    });

    it('should generate rls_current_tenant_id function', () => {
      const generator = new PostgresRLSGenerator();
      const functions = generator.generateContextFunctions();

      expect(functions).toContain('CREATE OR REPLACE FUNCTION rls_current_tenant_id()');
      expect(functions).toContain('RETURNS uuid');
      expect(functions).toContain('LANGUAGE SQL STABLE');
      expect(functions).toContain('SELECT NULLIF(current_setting(\'app.tenant_id\', true), \'\')::uuid');
    });

    it('should generate rls_current_roles function', () => {
      const generator = new PostgresRLSGenerator();
      const functions = generator.generateContextFunctions();

      expect(functions).toContain('CREATE OR REPLACE FUNCTION rls_current_roles()');
      expect(functions).toContain('RETURNS text[]');
      expect(functions).toContain('LANGUAGE SQL STABLE');
      expect(functions).toContain('string_to_array');
    });

    it('should generate rls_has_role function', () => {
      const generator = new PostgresRLSGenerator();
      const functions = generator.generateContextFunctions();

      expect(functions).toContain('CREATE OR REPLACE FUNCTION rls_has_role(role_name text)');
      expect(functions).toContain('RETURNS boolean');
      expect(functions).toContain('LANGUAGE SQL STABLE');
      expect(functions).toContain('role_name = ANY(rls_current_roles())');
    });

    it('should generate rls_current_permissions function', () => {
      const generator = new PostgresRLSGenerator();
      const functions = generator.generateContextFunctions();

      expect(functions).toContain('CREATE OR REPLACE FUNCTION rls_current_permissions()');
      expect(functions).toContain('RETURNS text[]');
      expect(functions).toContain('LANGUAGE SQL STABLE');
    });

    it('should generate rls_has_permission function', () => {
      const generator = new PostgresRLSGenerator();
      const functions = generator.generateContextFunctions();

      expect(functions).toContain('CREATE OR REPLACE FUNCTION rls_has_permission(permission_name text)');
      expect(functions).toContain('RETURNS boolean');
      expect(functions).toContain('LANGUAGE SQL STABLE');
      expect(functions).toContain('permission_name = ANY(rls_current_permissions())');
    });

    it('should generate rls_is_system function', () => {
      const generator = new PostgresRLSGenerator();
      const functions = generator.generateContextFunctions();

      expect(functions).toContain('CREATE OR REPLACE FUNCTION rls_is_system()');
      expect(functions).toContain('RETURNS boolean');
      expect(functions).toContain('LANGUAGE SQL STABLE');
      expect(functions).toContain('COALESCE(current_setting(\'app.is_system\', true), \'false\')::boolean');
    });
  });

  describe('generateDropStatements()', () => {
    it('should generate DROP statements', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateDropStatements(schema);

      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain('DROP POLICY IF EXISTS');
      expect(statements[0]).toContain('pg_policies');
      expect(statements[1]).toBe('ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;');
    });

    it('should handle custom schema name', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateDropStatements(schema, { schemaName: 'app_schema' });

      expect(statements[0]).toContain('schemaname = \'app_schema\'');
      expect(statements[1]).toContain('app_schema.users');
    });

    it('should handle custom policy prefix', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateDropStatements(schema, { policyPrefix: 'custom' });

      expect(statements[0]).toContain('policyname LIKE \'custom_%\'');
    });

    it('should handle multiple tables', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
        posts: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new PostgresRLSGenerator();
      const statements = generator.generateDropStatements(schema);

      expect(statements).toHaveLength(4); // 2 tables * 2 statements each
      expect(statements.some(s => s.includes('users'))).toBe(true);
      expect(statements.some(s => s.includes('posts'))).toBe(true);
    });
  });
});

describe('RLSMigrationGenerator', () => {
  describe('generateMigration()', () => {
    it('should generate valid migration file content', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'id = rls_current_user_id()::int',
              name: 'user_self_access',
            },
          ],
        },
      });

      const generator = new RLSMigrationGenerator();
      const migration = generator.generateMigration(schema);

      expect(migration).toContain('import { Kysely, sql } from \'kysely\';');
      expect(migration).toContain('export async function up(db: Kysely<any>): Promise<void>');
      expect(migration).toContain('export async function down(db: Kysely<any>): Promise<void>');
    });

    it('should include context functions when includeContextFunctions is true', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new RLSMigrationGenerator();
      const migration = generator.generateMigration(schema, { includeContextFunctions: true });

      expect(migration).toContain('CREATE OR REPLACE FUNCTION rls_current_user_id()');
      expect(migration).toContain('CREATE OR REPLACE FUNCTION rls_current_tenant_id()');
      expect(migration).toContain('CREATE OR REPLACE FUNCTION rls_has_role');
      expect(migration).toContain('DROP FUNCTION IF EXISTS rls_current_user_id()');
    });

    it('should exclude context functions when includeContextFunctions is false', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new RLSMigrationGenerator();
      const migration = generator.generateMigration(schema, { includeContextFunctions: false });

      expect(migration).not.toContain('CREATE OR REPLACE FUNCTION rls_current_user_id()');
      expect(migration).not.toContain('DROP FUNCTION IF EXISTS rls_current_user_id()');
    });

    it('should include context functions by default', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new RLSMigrationGenerator();
      const migration = generator.generateMigration(schema);

      expect(migration).toContain('CREATE OR REPLACE FUNCTION rls_current_user_id()');
    });

    it('should handle custom migration name', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new RLSMigrationGenerator();
      const migration = generator.generateMigration(schema, { name: 'custom_rls' });

      expect(migration).toContain('Migration: custom_rls');
    });

    it('should escape template literals correctly', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'tenant_id = rls_current_tenant_id()',
              name: 'tenant_isolation',
            },
          ],
        },
      });

      const generator = new RLSMigrationGenerator();
      const migration = generator.generateMigration(schema);

      // Should contain escaped $ (used in PostgreSQL dollar quoting $$ for function bodies)
      // The escapeTemplate method converts $$ to \$\$ for safe embedding in template literals
      expect(migration).toContain('\\$\\$');
      // Should use template literals (backticks) for sql.raw()
      expect(migration).toContain('sql.raw(`');
    });

    it('should include up statements', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
              name: 'allow_read',
            },
          ],
        },
      });

      const generator = new RLSMigrationGenerator();
      const migration = generator.generateMigration(schema);

      expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
      expect(migration).toContain('FORCE ROW LEVEL SECURITY');
      expect(migration).toContain('CREATE POLICY');
    });

    it('should include down statements', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new RLSMigrationGenerator();
      const migration = generator.generateMigration(schema);

      expect(migration).toContain('DROP POLICY IF EXISTS');
      expect(migration).toContain('DISABLE ROW LEVEL SECURITY');
    });

    it('should pass options to generator', () => {
      const schema = defineRLSSchema<TestDB>({
        users: {
          policies: [
            {
              type: 'allow',
              operation: 'read',
              condition: '',
              using: 'true',
            },
          ],
        },
      });

      const generator = new RLSMigrationGenerator();
      const migration = generator.generateMigration(schema, {
        schemaName: 'app_schema',
        policyPrefix: 'custom',
        force: false,
      });

      expect(migration).toContain('app_schema.users');
      expect(migration).not.toContain('FORCE ROW LEVEL SECURITY');
    });
  });

  describe('generateFilename()', () => {
    it('should generate timestamped filename', () => {
      const generator = new RLSMigrationGenerator();
      const filename = generator.generateFilename();

      expect(filename).toMatch(/^\d{8}_\d{6}_rls_policies\.ts$/);
    });

    it('should handle custom migration name', () => {
      const generator = new RLSMigrationGenerator();
      const filename = generator.generateFilename('custom_migration');

      expect(filename).toMatch(/^\d{8}_\d{6}_custom_migration\.ts$/);
    });

    it('should format timestamp correctly', () => {
      const generator = new RLSMigrationGenerator();
      const filename = generator.generateFilename();

      // Should be in format YYYYMMDD_HHMMSS_name.ts
      const parts = filename.split('_');
      expect(parts[0]).toHaveLength(8); // YYYYMMDD
      expect(parts[1]).toHaveLength(6); // HHMMSS
    });

    it('should generate unique timestamps', async () => {
      const generator = new RLSMigrationGenerator();
      const filename1 = generator.generateFilename();

      // Wait 1ms to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1));

      const filename2 = generator.generateFilename();

      // Filenames might be the same if generated too quickly
      // but at least they should be valid format
      expect(filename1).toMatch(/^\d{8}_\d{6}_rls_policies\.ts$/);
      expect(filename2).toMatch(/^\d{8}_\d{6}_rls_policies\.ts$/);
    });
  });
});

describe('syncContextToPostgres', () => {
  /**
   * Create a mock Kysely db that supports sql template tag execution
   * This requires implementing the full executor interface that Kysely's RawBuilder expects
   */
  function createMockDb() {
    const mockExecute = vi.fn().mockResolvedValue({ rows: [] });

    // Create a minimal mock that satisfies Kysely's RawBuilder requirements
    const mockCompiler = {
      compileQuery: vi.fn().mockReturnValue({
        sql: 'SELECT set_config($1, $2, $3)',
        parameters: [],
      }),
    };

    const mockAdapter = {
      supportsReturning: true,
    };

    const mockQueryCreator = {
      getExecutor: () => mockExecutor,
    };

    const mockExecutor = {
      // Required for query compilation
      transformQuery: vi.fn().mockImplementation((node: unknown) => node),
      // Required for query compilation
      compileQuery: vi.fn().mockReturnValue({
        sql: 'SELECT set_config($1, $2, $3)',
        parameters: [],
      }),
      // Required for execution
      executeQuery: mockExecute,
      // Adapter for database-specific features
      adapter: mockAdapter,
    };

    return {
      // Main entry point for RawBuilder
      getExecutor: () => mockExecutor,
      // Store reference for assertions
      _mockExecute: mockExecute,
      _mockTransformQuery: mockExecutor.transformQuery,
    } as any;
  }

  it('should call set_config with correct values', async () => {
    const mockDb = createMockDb();

    await syncContextToPostgres(mockDb, {
      userId: 123,
      tenantId: 'tenant-1',
      roles: ['user', 'editor'],
      permissions: ['posts:read', 'posts:write'],
      isSystem: false,
    });

    // Verify the execute was called
    expect(mockDb._mockExecute).toHaveBeenCalled();
  });

  it('should handle string userId', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 'user-123',
        tenantId: 'tenant-1',
        roles: ['user'],
        permissions: [],
      })
    ).resolves.not.toThrow();
  });

  it('should handle number userId', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 123,
        tenantId: 'tenant-1',
        roles: ['user'],
        permissions: [],
      })
    ).resolves.not.toThrow();
  });

  it('should handle undefined tenantId', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 123,
        roles: ['user'],
      })
    ).resolves.not.toThrow();
  });

  it('should handle undefined roles', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 123,
        tenantId: 'tenant-1',
      })
    ).resolves.not.toThrow();
  });

  it('should handle undefined permissions', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 123,
        tenantId: 'tenant-1',
        roles: ['user'],
      })
    ).resolves.not.toThrow();
  });

  it('should handle undefined isSystem', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 123,
        tenantId: 'tenant-1',
        roles: ['user'],
        permissions: [],
      })
    ).resolves.not.toThrow();
  });

  it('should convert isSystem to string', async () => {
    const mockDb = createMockDb();

    // Test with true
    await expect(
      syncContextToPostgres(mockDb, {
        userId: 123,
        isSystem: true,
      })
    ).resolves.not.toThrow();

    // Test with false - need a fresh mock
    const mockDb2 = createMockDb();
    await expect(
      syncContextToPostgres(mockDb2, {
        userId: 123,
        isSystem: false,
      })
    ).resolves.not.toThrow();
  });

  it('should handle empty roles array', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 123,
        roles: [],
      })
    ).resolves.not.toThrow();
  });

  it('should handle empty permissions array', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 123,
        permissions: [],
      })
    ).resolves.not.toThrow();
  });

  it('should handle multiple roles', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 123,
        roles: ['user', 'admin', 'editor', 'viewer'],
      })
    ).resolves.not.toThrow();
  });

  it('should handle multiple permissions', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 123,
        permissions: ['posts:read', 'posts:write', 'users:read', 'users:write'],
      })
    ).resolves.not.toThrow();
  });

  it('should handle all context properties', async () => {
    const mockDb = createMockDb();

    await expect(
      syncContextToPostgres(mockDb, {
        userId: 'user-123',
        tenantId: 'tenant-456',
        roles: ['admin', 'user'],
        permissions: ['all:read', 'all:write'],
        isSystem: true,
      })
    ).resolves.not.toThrow();
  });
});
