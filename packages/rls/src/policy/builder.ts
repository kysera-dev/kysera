/**
 * Fluent policy builders for Row-Level Security
 *
 * Provides intuitive builder functions for creating RLS policies:
 * - allow: Grants access when condition is true
 * - deny: Blocks access when condition is true (overrides allow)
 * - filter: Adds WHERE conditions to SELECT queries
 * - validate: Validates mutation data before execution
 */

import type {
  Operation,
  PolicyDefinition,
  PolicyCondition,
  FilterCondition,
  PolicyHints,
} from './types.js';

/**
 * Options for policy definitions
 */
export interface PolicyOptions {
  /** Policy name for debugging and identification */
  name?: string;
  /** Priority (higher runs first, deny policies default to 100) */
  priority?: number;
  /** Performance optimization hints */
  hints?: PolicyHints;
}

/**
 * Create an allow policy
 * Grants access when condition evaluates to true
 *
 * @example
 * ```typescript
 * // Allow users to read their own records
 * allow('read', ctx => ctx.auth.userId === ctx.row.userId)
 *
 * // Allow admins to do everything
 * allow('all', ctx => ctx.auth.roles.includes('admin'))
 *
 * // Allow with multiple operations
 * allow(['read', 'update'], ctx => ctx.auth.userId === ctx.row.userId)
 *
 * // Named policy with priority
 * allow('read', ctx => ctx.auth.roles.includes('verified'), {
 *   name: 'verified-users-only',
 *   priority: 10
 * })
 * ```
 */
export function allow(
  operation: Operation | Operation[],
  condition: PolicyCondition,
  options?: PolicyOptions
): PolicyDefinition {
  const policy: PolicyDefinition = {
    type: 'allow',
    operation,
    condition: condition as PolicyCondition,
    priority: options?.priority ?? 0,
  };

  if (options?.name !== undefined) {
    policy.name = options.name;
  }

  if (options?.hints !== undefined) {
    policy.hints = options.hints;
  }

  return policy;
}

/**
 * Create a deny policy
 * Blocks access when condition evaluates to true (overrides allow)
 * If no condition is provided, always denies
 *
 * @example
 * ```typescript
 * // Deny access to banned users
 * deny('all', ctx => ctx.auth.attributes?.banned === true)
 *
 * // Deny deletions on archived records
 * deny('delete', ctx => ctx.row.archived === true)
 *
 * // Deny all access to sensitive table
 * deny('all')
 *
 * // Named deny with high priority
 * deny('all', ctx => ctx.auth.attributes?.suspended === true, {
 *   name: 'block-suspended-users',
 *   priority: 200
 * })
 * ```
 */
export function deny(
  operation: Operation | Operation[],
  condition?: PolicyCondition,
  options?: PolicyOptions
): PolicyDefinition {
  const policy: PolicyDefinition = {
    type: 'deny',
    operation,
    condition: (condition ?? (() => true)) as PolicyCondition,
    priority: options?.priority ?? 100, // Deny policies run first by default
  };

  if (options?.name !== undefined) {
    policy.name = options.name;
  }

  if (options?.hints !== undefined) {
    policy.hints = options.hints;
  }

  return policy;
}

/**
 * Create a filter policy
 * Adds WHERE conditions to SELECT queries
 *
 * @example
 * ```typescript
 * // Filter by tenant
 * filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
 *
 * // Filter by organization with soft delete
 * filter('read', ctx => ({
 *   organization_id: ctx.auth.organizationIds?.[0],
 *   deleted_at: null
 * }))
 *
 * // Named filter
 * filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }), {
 *   name: 'tenant-filter'
 * })
 * ```
 */
export function filter(
  operation: 'read' | 'all',
  condition: FilterCondition,
  options?: PolicyOptions
): PolicyDefinition {
  const policy: PolicyDefinition = {
    type: 'filter',
    operation: operation === 'all' ? 'read' : operation,
    condition: condition as unknown as PolicyCondition,
    priority: options?.priority ?? 0,
  };

  if (options?.name !== undefined) {
    policy.name = options.name;
  }

  if (options?.hints !== undefined) {
    policy.hints = options.hints;
  }

  return policy;
}

/**
 * Create a validate policy
 * Validates mutation data before execution
 *
 * @example
 * ```typescript
 * // Validate user can only set their own user_id
 * validate('create', ctx => ctx.data.userId === ctx.auth.userId)
 *
 * // Validate status transitions
 * validate('update', ctx => {
 *   const { status } = ctx.data;
 *   return !status || ['draft', 'published'].includes(status);
 * })
 *
 * // Apply to both create and update
 * validate('all', ctx => ctx.data.price >= 0)
 *
 * // Named validation
 * validate('create', ctx => validateEmail(ctx.data.email), {
 *   name: 'validate-email'
 * })
 * ```
 */
export function validate(
  operation: 'create' | 'update' | 'all',
  condition: PolicyCondition,
  options?: PolicyOptions
): PolicyDefinition {
  const ops: Operation[] = operation === 'all'
    ? ['create', 'update']
    : [operation];

  const policy: PolicyDefinition = {
    type: 'validate',
    operation: ops,
    condition: condition as PolicyCondition,
    priority: options?.priority ?? 0,
  };

  if (options?.name !== undefined) {
    policy.name = options.name;
  }

  if (options?.hints !== undefined) {
    policy.hints = options.hints;
  }

  return policy;
}
