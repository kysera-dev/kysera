/**
 * RLS schema definition and validation
 *
 * Provides functions to define, validate, and merge RLS schemas.
 */

import type { RLSSchema, TableRLSConfig, PolicyDefinition } from './types.js';
import { RLSSchemaError } from '../errors.js';

/**
 * Define RLS schema with full type safety
 *
 * @example
 * ```typescript
 * interface Database {
 *   users: { id: number; email: string; tenant_id: number };
 *   posts: { id: number; user_id: number; tenant_id: number };
 * }
 *
 * const schema = defineRLSSchema<Database>({
 *   users: {
 *     policies: [
 *       // Users can read their own records
 *       allow('read', ctx => ctx.auth.userId === ctx.row.id),
 *       // Filter by tenant
 *       filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
 *       // Admins bypass all checks
 *       allow('all', ctx => ctx.auth.roles.includes('admin')),
 *     ],
 *   },
 *   posts: {
 *     policies: [
 *       // Filter posts by tenant
 *       filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
 *       // Users can only edit their own posts
 *       allow(['update', 'delete'], ctx => ctx.auth.userId === ctx.row.user_id),
 *       // Validate new posts belong to user's tenant
 *       validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId),
 *     ],
 *     defaultDeny: true, // Require explicit allow
 *   },
 * });
 * ```
 */
export function defineRLSSchema<DB>(
  schema: RLSSchema<DB>
): RLSSchema<DB> {
  // Validate schema
  validateSchema(schema);
  return schema;
}

/**
 * Validate RLS schema
 * Throws RLSSchemaError if validation fails
 *
 * @internal
 */
function validateSchema<DB>(schema: RLSSchema<DB>): void {
  for (const [table, config] of Object.entries(schema)) {
    if (!config) continue;

    const tableConfig = config as TableRLSConfig;

    if (!Array.isArray(tableConfig.policies)) {
      throw new RLSSchemaError(
        `Invalid policies for table "${table}": must be an array`,
        { table }
      );
    }

    // Validate each policy
    for (let i = 0; i < tableConfig.policies.length; i++) {
      const policy = tableConfig.policies[i];
      if (policy !== undefined) {
        validatePolicy(policy, table, i);
      }
    }

    // Validate skipFor if present (array of role names that bypass RLS)
    if (tableConfig.skipFor !== undefined) {
      if (!Array.isArray(tableConfig.skipFor)) {
        throw new RLSSchemaError(
          `Invalid skipFor for table "${table}": must be an array of role names`,
          { table }
        );
      }

      // skipFor contains role names (strings), not operations
      for (const role of tableConfig.skipFor) {
        if (typeof role !== 'string' || role.trim() === '') {
          throw new RLSSchemaError(
            `Invalid role in skipFor for table "${table}": must be a non-empty string`,
            { table }
          );
        }
      }
    }

    // Validate defaultDeny if present
    if (tableConfig.defaultDeny !== undefined && typeof tableConfig.defaultDeny !== 'boolean') {
      throw new RLSSchemaError(
        `Invalid defaultDeny for table "${table}": must be a boolean`,
        { table }
      );
    }
  }
}

/**
 * Validate a single policy
 * Throws RLSSchemaError if validation fails
 *
 * @internal
 */
function validatePolicy(
  policy: PolicyDefinition,
  table: string,
  index: number
): void {
  if (!policy.type) {
    throw new RLSSchemaError(
      `Policy ${index} for table "${table}" missing type`,
      { table, index }
    );
  }

  const validTypes = ['allow', 'deny', 'filter', 'validate'];
  if (!validTypes.includes(policy.type)) {
    throw new RLSSchemaError(
      `Policy ${index} for table "${table}" has invalid type: ${policy.type}`,
      { table, index, type: policy.type }
    );
  }

  if (!policy.operation) {
    throw new RLSSchemaError(
      `Policy ${index} for table "${table}" missing operation`,
      { table, index }
    );
  }

  const validOps = ['read', 'create', 'update', 'delete', 'all'];
  const ops = Array.isArray(policy.operation) ? policy.operation : [policy.operation];

  for (const op of ops) {
    if (!validOps.includes(op)) {
      throw new RLSSchemaError(
        `Policy ${index} for table "${table}" has invalid operation: ${op}`,
        { table, index, operation: op }
      );
    }
  }

  if (policy.condition === undefined || policy.condition === null) {
    throw new RLSSchemaError(
      `Policy ${index} for table "${table}" missing condition`,
      { table, index }
    );
  }

  if (typeof policy.condition !== 'function' && typeof policy.condition !== 'string') {
    throw new RLSSchemaError(
      `Policy ${index} for table "${table}" condition must be a function or string`,
      { table, index }
    );
  }

  // Validate priority if present
  if (policy.priority !== undefined && typeof policy.priority !== 'number') {
    throw new RLSSchemaError(
      `Policy ${index} for table "${table}" priority must be a number`,
      { table, index }
    );
  }

  // Validate name if present
  if (policy.name !== undefined && typeof policy.name !== 'string') {
    throw new RLSSchemaError(
      `Policy ${index} for table "${table}" name must be a string`,
      { table, index }
    );
  }
}

/**
 * Merge multiple RLS schemas
 * Later schemas override earlier ones for the same table
 *
 * @example
 * ```typescript
 * const baseSchema = defineRLSSchema<Database>({
 *   users: {
 *     policies: [
 *       filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
 *     ],
 *   },
 * });
 *
 * const adminSchema = defineRLSSchema<Database>({
 *   users: {
 *     policies: [
 *       allow('all', ctx => ctx.auth.roles.includes('admin')),
 *     ],
 *   },
 * });
 *
 * // Merged schema will have both filters and admin allow
 * const merged = mergeRLSSchemas(baseSchema, adminSchema);
 * ```
 */
export function mergeRLSSchemas<DB>(
  ...schemas: RLSSchema<DB>[]
): RLSSchema<DB> {
  const merged: RLSSchema<DB> = {};

  for (const schema of schemas) {
    for (const [table, config] of Object.entries(schema)) {
      if (!config) continue;

      const existingConfig = merged[table as keyof DB] as TableRLSConfig | undefined;
      const newConfig = config as TableRLSConfig;

      if (existingConfig) {
        // Merge policies (append new policies)
        existingConfig.policies = [
          ...existingConfig.policies,
          ...newConfig.policies,
        ];

        // Merge skipFor (combine arrays and deduplicate)
        if (newConfig.skipFor) {
          const existingSkipFor = existingConfig.skipFor ?? [];
          const combinedSkipFor = [...existingSkipFor, ...newConfig.skipFor];
          existingConfig.skipFor = Array.from(new Set(combinedSkipFor));
        }

        // Override defaultDeny if explicitly set in new config
        if (newConfig.defaultDeny !== undefined) {
          existingConfig.defaultDeny = newConfig.defaultDeny;
        }
      } else {
        // Deep copy the config to avoid mutation
        merged[table as keyof DB] = {
          policies: [...newConfig.policies],
          skipFor: newConfig.skipFor ? [...newConfig.skipFor] : undefined,
          defaultDeny: newConfig.defaultDeny,
        } as any;
      }
    }
  }

  // Validate merged schema
  validateSchema(merged);

  return merged;
}
