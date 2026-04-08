import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { RLSSchema, TableRLSConfig, PolicyDefinition, Operation } from '../policy/types.js'
import { RLSSchemaError } from '../errors.js'

/**
 * Pattern for valid SQL identifiers (prevents injection in DDL statements)
 */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Validate and quote a SQL identifier to prevent injection.
 * Only allows alphanumeric + underscore characters.
 * @throws RLSSchemaError if identifier contains unsafe characters
 */
function quoteIdent(name: string, context: string): string {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new RLSSchemaError(
      `Unsafe ${context}: "${name}". Only alphanumeric and underscore characters are allowed.`,
      { identifier: name, context }
    )
  }
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * Quote a string literal for use in PL/pgSQL (single quotes, doubled for escaping)
 */
function quoteLiteral(value: string, context: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new RLSSchemaError(
      `Unsafe ${context}: "${value}". Only alphanumeric and underscore characters are allowed.`,
      { identifier: value, context }
    )
  }
  return "'" + value.replace(/'/g, "''") + "'"
}

/**
 * Options for PostgreSQL RLS generation
 */
export interface PostgresRLSOptions {
  /** Force RLS on table owners */
  force?: boolean
  /** Schema name (default: public) */
  schemaName?: string
  /** Prefix for generated policy names */
  policyPrefix?: string
}

/**
 * PostgreSQL RLS Generator
 * Generates native PostgreSQL RLS statements from Kysera RLS schema
 */
export class PostgresRLSGenerator {
  /**
   * Generate all PostgreSQL RLS statements from schema
   */
  generateStatements<DB>(schema: RLSSchema<DB>, options: PostgresRLSOptions = {}): string[] {
    const { force = true, schemaName = 'public', policyPrefix = 'rls' } = options

    const statements: string[] = []
    const quotedSchema = quoteIdent(schemaName, 'schema name')

    for (const [table, config] of Object.entries(schema)) {
      if (!config) continue

      const quotedTable = quoteIdent(table, 'table name')
      const qualifiedTable = `${quotedSchema}.${quotedTable}`
      const tableConfig = config as TableRLSConfig

      // Enable RLS on table
      statements.push(`ALTER TABLE ${qualifiedTable} ENABLE ROW LEVEL SECURITY;`)

      if (force) {
        statements.push(`ALTER TABLE ${qualifiedTable} FORCE ROW LEVEL SECURITY;`)
      }

      // Generate policies
      let policyIndex = 0
      for (const policy of tableConfig.policies) {
        const rawPolicyName = policy.name ?? `${policyPrefix}_${table}_${policy.type}_${policyIndex++}`
        const policySQL = this.generatePolicy(qualifiedTable, rawPolicyName, policy)
        if (policySQL) {
          statements.push(policySQL)
        }
      }
    }

    return statements
  }

  /**
   * Generate a single policy statement
   */
  private generatePolicy(table: string, name: string, policy: PolicyDefinition): string | null {
    // Skip filter policies (they're ORM-only)
    if (policy.type === 'filter' || policy.type === 'validate') {
      return null
    }

    // Need USING or WITH CHECK clause for native RLS
    if (!policy.using && !policy.withCheck) {
      return null
    }

    const quotedName = quoteIdent(name, 'policy name')
    const parts: string[] = [`CREATE POLICY ${quotedName}`, `ON ${table}`]

    // Policy type
    if (policy.type === 'deny') {
      parts.push('AS RESTRICTIVE')
    } else {
      parts.push('AS PERMISSIVE')
    }

    // Target role — validate to prevent injection
    const role = policy.role ?? 'public'
    parts.push(`TO ${quoteIdent(role, 'role name')}`)

    // Operation
    parts.push(`FOR ${this.mapOperation(policy.operation)}`)

    // USING clause
    if (policy.using) {
      parts.push(`USING (${policy.using})`)
    }

    // WITH CHECK clause
    if (policy.withCheck) {
      parts.push(`WITH CHECK (${policy.withCheck})`)
    }

    return parts.join('\n  ') + ';'
  }

  /**
   * Map Kysera operation to PostgreSQL operation
   */
  private mapOperation(operation: Operation | Operation[]): string {
    if (Array.isArray(operation)) {
      if (operation.length === 0) {
        return 'ALL'
      }
      if (operation.length === 4 || operation.includes('all')) {
        return 'ALL'
      }
      // PostgreSQL doesn't support multiple operations in one policy
      // Return first operation
      return this.mapSingleOperation(operation[0]!)
    }
    return this.mapSingleOperation(operation)
  }

  /**
   * Map single operation
   */
  private mapSingleOperation(op: Operation): string {
    switch (op) {
      case 'read':
        return 'SELECT'
      case 'create':
        return 'INSERT'
      case 'update':
        return 'UPDATE'
      case 'delete':
        return 'DELETE'
      case 'all':
        return 'ALL'
      default:
        return 'ALL'
    }
  }

  /**
   * Generate context-setting functions for PostgreSQL
   * These functions should be STABLE for optimal performance
   */
  generateContextFunctions(): string {
    return `
-- RLS Context Functions (STABLE for query planner optimization)
-- These functions read session variables set by the application

CREATE OR REPLACE FUNCTION rls_current_user_id()
RETURNS text
LANGUAGE SQL STABLE
AS $$ SELECT current_setting('app.user_id', true) $$;

CREATE OR REPLACE FUNCTION rls_current_tenant_id()
RETURNS uuid
LANGUAGE SQL STABLE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION rls_current_roles()
RETURNS text[]
LANGUAGE SQL STABLE
AS $$ SELECT string_to_array(COALESCE(current_setting('app.roles', true), ''), ',') $$;

CREATE OR REPLACE FUNCTION rls_has_role(role_name text)
RETURNS boolean
LANGUAGE SQL STABLE
AS $$ SELECT role_name = ANY(rls_current_roles()) $$;

CREATE OR REPLACE FUNCTION rls_current_permissions()
RETURNS text[]
LANGUAGE SQL STABLE
AS $$ SELECT string_to_array(COALESCE(current_setting('app.permissions', true), ''), ',') $$;

CREATE OR REPLACE FUNCTION rls_has_permission(permission_name text)
RETURNS boolean
LANGUAGE SQL STABLE
AS $$ SELECT permission_name = ANY(rls_current_permissions()) $$;

CREATE OR REPLACE FUNCTION rls_is_system()
RETURNS boolean
LANGUAGE SQL STABLE
AS $$ SELECT COALESCE(current_setting('app.is_system', true), 'false')::boolean $$;
`
  }

  /**
   * Generate DROP statements for cleaning up
   */
  generateDropStatements<DB>(schema: RLSSchema<DB>, options: PostgresRLSOptions = {}): string[] {
    const { schemaName = 'public', policyPrefix = 'rls' } = options
    const statements: string[] = []
    const quotedSchema = quoteIdent(schemaName, 'schema name')

    // Validate prefix (used in LIKE pattern)
    if (!SAFE_IDENTIFIER.test(policyPrefix)) {
      throw new RLSSchemaError(
        `Unsafe policy prefix: "${policyPrefix}". Only alphanumeric and underscore characters are allowed.`,
        { identifier: policyPrefix, context: 'policy prefix' }
      )
    }

    for (const table of Object.keys(schema)) {
      const quotedTable = quoteIdent(table, 'table name')
      const qualifiedTable = `${quotedSchema}.${quotedTable}`

      // Drop all policies with prefix — use dollar-quoting for safety
      // pg_policies.tablename/schemaname are system-provided, safe for comparison
      // policyPrefix is validated above
      statements.push(
        `DO $$ BEGIN
  EXECUTE (
    SELECT string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON ${qualifiedTable};', E'\\n')
    FROM pg_policies
    WHERE tablename = ${quoteLiteral(table, 'table name')}
      AND schemaname = ${quoteLiteral(schemaName, 'schema name')}
      AND policyname LIKE '${policyPrefix}_%'
  );
END $$;`
      )

      // Disable RLS
      statements.push(`ALTER TABLE ${qualifiedTable} DISABLE ROW LEVEL SECURITY;`)
    }

    return statements
  }
}

/**
 * Sync RLS context to PostgreSQL session settings
 * Call this at the start of each request/transaction
 */
export async function syncContextToPostgres<DB>(
  db: Kysely<DB>,
  context: {
    userId: string | number
    tenantId?: string | number
    roles?: string[]
    permissions?: string[]
    isSystem?: boolean
  }
): Promise<void> {
  const { userId, tenantId, roles, permissions, isSystem } = context

  await sql`
    SELECT
      set_config('app.user_id', ${String(userId)}, true),
      set_config('app.tenant_id', ${tenantId ? String(tenantId) : ''}, true),
      set_config('app.roles', ${(roles ?? []).join(',')}, true),
      set_config('app.permissions', ${(permissions ?? []).join(',')}, true),
      set_config('app.is_system', ${isSystem ? 'true' : 'false'}, true)
  `.execute(db)
}

/**
 * Clear RLS context from PostgreSQL session
 */
export async function clearPostgresContext<DB>(db: Kysely<DB>): Promise<void> {
  await sql`
    SELECT
      set_config('app.user_id', '', true),
      set_config('app.tenant_id', '', true),
      set_config('app.roles', '', true),
      set_config('app.permissions', '', true),
      set_config('app.is_system', 'false', true)
  `.execute(db)
}
