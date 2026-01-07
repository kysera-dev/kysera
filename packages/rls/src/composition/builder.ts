/**
 * Policy Composition Builder
 *
 * Factory functions for creating reusable, composable RLS policies.
 *
 * @module @kysera/rls/composition/builder
 */

import type {
  ReusablePolicy,
  ReusablePolicyConfig,
  TenantIsolationConfig,
  OwnershipConfig,
  SoftDeleteConfig,
  StatusAccessConfig
} from './types.js'
import type { PolicyDefinition, PolicyEvaluationContext, Operation } from '../policy/types.js'
import { allow, deny, filter, validate } from '../policy/builder.js'

// ============================================================================
// Core Policy Builder
// ============================================================================

/**
 * Create a reusable policy template
 *
 * @param config - Policy configuration
 * @param policies - Array of policy definitions
 * @returns Reusable policy template
 *
 * @example
 * ```typescript
 * const tenantPolicy = definePolicy(
 *   {
 *     name: 'tenantIsolation',
 *     description: 'Filter by tenant_id',
 *     tags: ['multi-tenant']
 *   },
 *   [
 *     filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }), {
 *       priority: 1000,
 *       name: 'tenant-filter'
 *     }),
 *     validate('create', ctx => ctx.data?.tenant_id === ctx.auth.tenantId, {
 *       name: 'tenant-validate'
 *     })
 *   ]
 * );
 * ```
 */
export function definePolicy(
  config: ReusablePolicyConfig,
  policies: PolicyDefinition[]
): ReusablePolicy {
  const result: ReusablePolicy = {
    name: config.name,
    policies
  }

  if (config.description !== undefined) {
    result.description = config.description
  }

  if (config.tags !== undefined) {
    result.tags = config.tags
  }

  return result
}

/**
 * Create a filter-only policy
 *
 * @param name - Policy name
 * @param filterFn - Filter condition
 * @param options - Additional options
 * @returns Reusable filter policy
 */
export function defineFilterPolicy(
  name: string,
  filterFn: (ctx: PolicyEvaluationContext) => Record<string, unknown>,
  options?: { priority?: number }
): ReusablePolicy {
  return {
    name,
    policies: [
      filter('read', filterFn, {
        name: `${name}-filter`,
        ...(options?.priority !== undefined && { priority: options.priority })
      })
    ]
  }
}

/**
 * Create an allow-based policy
 *
 * @param name - Policy name
 * @param operation - Operations to allow
 * @param condition - Allow condition
 * @param options - Additional options
 * @returns Reusable allow policy
 */
export function defineAllowPolicy(
  name: string,
  operation: Operation | Operation[],
  condition: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>,
  options?: { priority?: number }
): ReusablePolicy {
  return {
    name,
    policies: [
      allow(operation, condition, {
        name: `${name}-allow`,
        ...(options?.priority !== undefined && { priority: options.priority })
      })
    ]
  }
}

/**
 * Create a deny-based policy
 *
 * @param name - Policy name
 * @param operation - Operations to deny
 * @param condition - Deny condition (optional - if not provided, always denies)
 * @param options - Additional options
 * @returns Reusable deny policy
 */
export function defineDenyPolicy(
  name: string,
  operation: Operation | Operation[],
  condition?: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>,
  options?: { priority?: number }
): ReusablePolicy {
  return {
    name,
    policies: [
      deny(operation, condition, {
        name: `${name}-deny`,
        priority: options?.priority ?? 100
      })
    ]
  }
}

/**
 * Create a validation policy
 *
 * @param name - Policy name
 * @param operation - Operations to validate
 * @param condition - Validation condition
 * @param options - Additional options
 * @returns Reusable validate policy
 */
export function defineValidatePolicy(
  name: string,
  operation: 'create' | 'update' | 'all',
  condition: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>,
  options?: { priority?: number }
): ReusablePolicy {
  return {
    name,
    policies: [
      validate(operation, condition, {
        name: `${name}-validate`,
        ...(options?.priority !== undefined && { priority: options.priority })
      })
    ]
  }
}

/**
 * Create a combined policy with multiple types
 *
 * @param name - Policy name
 * @param config - Policy configurations
 * @returns Reusable combined policy
 */
export function defineCombinedPolicy(
  name: string,
  config: {
    filter?: (ctx: PolicyEvaluationContext) => Record<string, unknown>
    allow?: Record<string, (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>>
    deny?: Record<string, (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>>
    validate?: {
      create?: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
      update?: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
    }
  }
): ReusablePolicy {
  const policies: PolicyDefinition[] = []

  // Add filter policy
  if (config.filter) {
    policies.push(
      filter('read', config.filter, {
        name: `${name}-filter`
      })
    )
  }

  // Add allow policies
  if (config.allow) {
    for (const [op, condition] of Object.entries(config.allow)) {
      if (condition) {
        policies.push(
          allow(op as Operation, condition, {
            name: `${name}-allow-${op}`
          })
        )
      }
    }
  }

  // Add deny policies
  if (config.deny) {
    for (const [op, condition] of Object.entries(config.deny)) {
      if (condition) {
        policies.push(
          deny(op as Operation, condition, {
            name: `${name}-deny-${op}`,
            priority: 100
          })
        )
      }
    }
  }

  // Add validate policies
  if (config.validate) {
    if (config.validate.create) {
      policies.push(
        validate('create', config.validate.create, {
          name: `${name}-validate-create`
        })
      )
    }
    if (config.validate.update) {
      policies.push(
        validate('update', config.validate.update, {
          name: `${name}-validate-update`
        })
      )
    }
  }

  return {
    name,
    policies
  }
}

// ============================================================================
// Common Policy Patterns
// ============================================================================

/**
 * Create a tenant isolation policy
 *
 * Automatically filters by tenant_id and validates mutations.
 *
 * @param config - Tenant isolation configuration
 * @returns Reusable tenant isolation policy
 */
export function createTenantIsolationPolicy(config: TenantIsolationConfig = {}): ReusablePolicy {
  const { tenantColumn = 'tenant_id', validateOnMutation = true } = config

  const policies: PolicyDefinition[] = [
    // Filter reads by tenant
    filter('read', ctx => ({ [tenantColumn]: ctx.auth.tenantId }), {
      name: 'tenant-isolation-filter',
      priority: 1000
    })
  ]

  // Validate tenant on mutations
  if (validateOnMutation) {
    policies.push(
      validate('create', ctx => {
        const data = ctx.data as Record<string, unknown> | undefined
        return data?.[tenantColumn] === ctx.auth.tenantId
      }, {
        name: 'tenant-isolation-validate-create'
      }),
      validate('update', ctx => {
        const data = ctx.data as Record<string, unknown> | undefined
        // Cannot change tenant on update
        if (data?.[tenantColumn] !== undefined) {
          return data[tenantColumn] === ctx.auth.tenantId
        }
        return true
      }, {
        name: 'tenant-isolation-validate-update'
      })
    )
  }

  return {
    name: 'tenantIsolation',
    description: `Filter by ${tenantColumn} for multi-tenancy`,
    policies,
    tags: ['multi-tenant', 'isolation']
  }
}

/**
 * Create an ownership policy
 *
 * Allows owners to read/update/delete their own resources.
 *
 * @param config - Ownership configuration
 * @returns Reusable ownership policy
 */
export function createOwnershipPolicy(config: OwnershipConfig = {}): ReusablePolicy {
  const { ownerColumn = 'owner_id', ownerOperations = ['read', 'update', 'delete'], canDelete = true } = config

  const policies: PolicyDefinition[] = []

  // Filter ops to only those allowed
  const ops = ownerOperations.filter(op => op !== 'delete' || canDelete)

  if (ops.length > 0) {
    policies.push(
      allow(ops, ctx => {
        const row = ctx.row as Record<string, unknown> | undefined
        return ctx.auth.userId === row?.[ownerColumn]
      }, {
        name: 'ownership-allow'
      })
    )
  }

  // Explicit deny for delete if not allowed
  if (!canDelete && ownerOperations.includes('delete')) {
    policies.push(
      deny('delete', () => true, {
        name: 'ownership-no-delete',
        priority: 150
      })
    )
  }

  return {
    name: 'ownership',
    description: `Owner access via ${ownerColumn}`,
    policies,
    tags: ['ownership']
  }
}

/**
 * Create a soft delete policy
 *
 * Filters out soft-deleted rows and optionally prevents hard deletes.
 *
 * @param config - Soft delete configuration
 * @returns Reusable soft delete policy
 */
export function createSoftDeletePolicy(config: SoftDeleteConfig = {}): ReusablePolicy {
  const { deletedColumn = 'deleted_at', filterOnRead = true, preventHardDelete = true } = config

  const policies: PolicyDefinition[] = []

  // Filter soft-deleted rows
  if (filterOnRead) {
    policies.push(
      filter('read', () => ({ [deletedColumn]: null }), {
        name: 'soft-delete-filter',
        priority: 900
      })
    )
  }

  // Prevent hard deletes
  if (preventHardDelete) {
    policies.push(
      deny('delete', () => true, {
        name: 'soft-delete-no-hard-delete',
        priority: 150
      })
    )
  }

  return {
    name: 'softDelete',
    description: `Soft delete via ${deletedColumn}`,
    policies,
    tags: ['soft-delete']
  }
}

/**
 * Create a status-based access policy
 *
 * Controls access based on resource status.
 *
 * @param config - Status access configuration
 * @returns Reusable status policy
 */
export function createStatusAccessPolicy(config: StatusAccessConfig): ReusablePolicy {
  const { statusColumn = 'status', publicStatuses = [], editableStatuses = [], deletableStatuses = [] } = config

  const policies: PolicyDefinition[] = []

  // Allow public read for certain statuses
  if (publicStatuses.length > 0) {
    policies.push(
      allow('read', ctx => {
        const row = ctx.row as Record<string, unknown> | undefined
        return publicStatuses.includes(row?.[statusColumn] as string)
      }, {
        name: 'status-public-read'
      })
    )
  }

  // Restrict updates to certain statuses
  if (editableStatuses.length > 0) {
    policies.push(
      deny('update', ctx => {
        const row = ctx.row as Record<string, unknown> | undefined
        return !editableStatuses.includes(row?.[statusColumn] as string)
      }, {
        name: 'status-restrict-update',
        priority: 100
      })
    )
  }

  // Restrict deletes to certain statuses
  if (deletableStatuses.length > 0) {
    policies.push(
      deny('delete', ctx => {
        const row = ctx.row as Record<string, unknown> | undefined
        return !deletableStatuses.includes(row?.[statusColumn] as string)
      }, {
        name: 'status-restrict-delete',
        priority: 100
      })
    )
  }

  return {
    name: 'statusAccess',
    description: `Status-based access via ${statusColumn}`,
    policies,
    tags: ['status']
  }
}

/**
 * Create an admin bypass policy
 *
 * Allows admin roles to perform all operations.
 *
 * @param roles - Roles that have admin access
 * @returns Reusable admin policy
 */
export function createAdminPolicy(roles: string[]): ReusablePolicy {
  return {
    name: 'adminBypass',
    description: `Admin access for roles: ${roles.join(', ')}`,
    policies: [
      allow('all', ctx => roles.some(r => ctx.auth.roles.includes(r)), {
        name: 'admin-bypass',
        priority: 500
      })
    ],
    tags: ['admin']
  }
}

// ============================================================================
// Policy Composition Functions
// ============================================================================

/**
 * Compose multiple reusable policies into one
 *
 * @param name - Name for the composed policy
 * @param policies - Policies to compose
 * @returns Composed policy
 */
export function composePolicies(name: string, policies: ReusablePolicy[]): ReusablePolicy {
  const allPolicies: PolicyDefinition[] = []
  const allTags = new Set<string>()

  for (const policy of policies) {
    allPolicies.push(...policy.policies)
    policy.tags?.forEach(tag => allTags.add(tag))
  }

  return {
    name,
    description: `Composed from: ${policies.map(p => p.name).join(', ')}`,
    policies: allPolicies,
    tags: Array.from(allTags)
  }
}

/**
 * Extend a reusable policy with additional policies
 *
 * @param base - Base policy to extend
 * @param additional - Additional policies to add
 * @returns Extended policy
 */
export function extendPolicy(base: ReusablePolicy, additional: PolicyDefinition[]): ReusablePolicy {
  const result: ReusablePolicy = {
    name: `${base.name}_extended`,
    policies: [...base.policies, ...additional]
  }

  if (base.description !== undefined) {
    result.description = base.description
  }

  if (base.tags !== undefined) {
    result.tags = base.tags
  }

  return result
}

/**
 * Override policies from a base with new conditions
 *
 * @param base - Base policy
 * @param overrides - Policy name to new policy mapping
 * @returns Policy with overrides applied
 */
export function overridePolicy(
  base: ReusablePolicy,
  overrides: Record<string, PolicyDefinition>
): ReusablePolicy {
  const newPolicies = base.policies.map(policy => {
    const override = policy.name ? overrides[policy.name] : undefined
    return override ?? policy
  })

  const result: ReusablePolicy = {
    name: `${base.name}_overridden`,
    policies: newPolicies
  }

  if (base.description !== undefined) {
    result.description = base.description
  }

  if (base.tags !== undefined) {
    result.tags = base.tags
  }

  return result
}
