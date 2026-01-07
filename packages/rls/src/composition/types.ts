/**
 * Policy Composition Types
 *
 * Provides types for creating reusable, composable RLS policies.
 *
 * @module @kysera/rls/composition/types
 */

import type {
  PolicyDefinition,
  PolicyCondition,
  FilterCondition,
  PolicyEvaluationContext,
  Operation,
  PolicyHints
} from '../policy/types.js'

// ============================================================================
// Reusable Policy Types
// ============================================================================

/**
 * A named, reusable policy template
 *
 * Can be composed with other policies and applied to multiple tables.
 *
 * @example
 * ```typescript
 * const tenantIsolation = definePolicy({
 *   name: 'tenantIsolation',
 *   type: 'filter',
 *   operation: 'read',
 *   filter: ctx => ({ tenant_id: ctx.auth.tenantId }),
 *   priority: 1000
 * });
 * ```
 */
export interface ReusablePolicy {
  /**
   * Unique name for this policy
   */
  name: string

  /**
   * Description for documentation
   */
  description?: string

  /**
   * Policy definitions (can include multiple policies)
   */
  policies: PolicyDefinition[]

  /**
   * Tags for categorization
   */
  tags?: string[]
}

/**
 * Configuration for a reusable policy template
 */
export interface ReusablePolicyConfig {
  /**
   * Policy name
   */
  name: string

  /**
   * Description
   */
  description?: string

  /**
   * Tags for categorization
   */
  tags?: string[]
}

// ============================================================================
// Policy Builder Configuration
// ============================================================================

/**
 * Configuration for creating a filter policy
 */
export interface FilterPolicyConfig<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> {
  /**
   * Filter condition (returns WHERE clause conditions)
   */
  filter: FilterCondition<TCtx>

  /**
   * Priority for policy evaluation
   * @default 0
   */
  priority?: number

  /**
   * Performance hints
   */
  hints?: PolicyHints
}

/**
 * Configuration for creating an allow policy
 */
export interface AllowPolicyConfig<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> {
  /**
   * Operations this policy applies to
   */
  operation: Operation | Operation[]

  /**
   * Allow condition
   */
  allow: PolicyCondition<TCtx>

  /**
   * Priority for policy evaluation
   * @default 0
   */
  priority?: number

  /**
   * Performance hints
   */
  hints?: PolicyHints
}

/**
 * Configuration for creating a deny policy
 */
export interface DenyPolicyConfig<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> {
  /**
   * Operations this policy applies to
   */
  operation: Operation | Operation[]

  /**
   * Deny condition (optional - if not provided, always denies)
   */
  deny?: PolicyCondition<TCtx>

  /**
   * Priority for policy evaluation
   * @default 100
   */
  priority?: number

  /**
   * Performance hints
   */
  hints?: PolicyHints
}

/**
 * Configuration for creating a validate policy
 */
export interface ValidatePolicyConfig<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> {
  /**
   * Operations this policy applies to
   */
  operation: 'create' | 'update' | 'all'

  /**
   * Validation condition
   */
  validate: PolicyCondition<TCtx>

  /**
   * Priority for policy evaluation
   * @default 0
   */
  priority?: number

  /**
   * Performance hints
   */
  hints?: PolicyHints
}

/**
 * Combined policy configuration
 */
export interface CombinedPolicyConfig<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> {
  /**
   * Filter policy (for read operations)
   */
  filter?: FilterCondition<TCtx>

  /**
   * Allow policies by operation
   */
  allow?: {
    [K in Operation]?: PolicyCondition<TCtx>
  }

  /**
   * Deny policies by operation
   */
  deny?: {
    [K in Operation]?: PolicyCondition<TCtx>
  }

  /**
   * Validate policies by operation
   */
  validate?: {
    create?: PolicyCondition<TCtx>
    update?: PolicyCondition<TCtx>
  }
}

// ============================================================================
// Table Configuration with Composition
// ============================================================================

/**
 * Extended table RLS configuration with policy composition support
 */
export interface ComposableTableConfig {
  /**
   * Reusable policies to extend from
   * Policies are applied in order (first = lowest priority)
   */
  extends?: ReusablePolicy[]

  /**
   * Additional table-specific policies
   */
  policies?: PolicyDefinition[]

  /**
   * Whether to allow access by default when no policies match
   * @default true
   */
  defaultDeny?: boolean

  /**
   * Roles that bypass RLS
   */
  skipFor?: string[]
}

/**
 * Complete schema with composition support
 *
 * @typeParam DB - Database schema type
 */
export type ComposableRLSSchema<DB> = {
  [K in keyof DB]?: ComposableTableConfig
}

// ============================================================================
// Policy Inheritance Types
// ============================================================================

/**
 * Base policy that can be extended
 */
export interface BasePolicyDefinition {
  /**
   * Unique identifier for this base policy
   */
  id: string

  /**
   * Human-readable name
   */
  name: string

  /**
   * Description
   */
  description?: string

  /**
   * Policies included in this base
   */
  policies: PolicyDefinition[]

  /**
   * Other base policies this extends
   */
  extends?: string[]

  /**
   * Priority offset applied to all policies
   * @default 0
   */
  priorityOffset?: number
}

/**
 * Policy inheritance chain resolution
 */
export interface ResolvedInheritance {
  /**
   * Final merged policies
   */
  policies: PolicyDefinition[]

  /**
   * Chain of base policies used
   */
  inheritanceChain: string[]

  /**
   * Any conflicts detected
   */
  conflicts: {
    policy: string
    reason: string
  }[]
}

// ============================================================================
// Common Policy Patterns
// ============================================================================

/**
 * Multi-tenancy policy configuration
 */
export interface TenantIsolationConfig {
  /**
   * Column name for tenant ID
   * @default 'tenant_id'
   */
  tenantColumn?: string

  /**
   * Operations to apply tenant isolation to
   * @default ['read', 'create', 'update', 'delete']
   */
  operations?: Operation[]

  /**
   * Whether to validate tenant on create/update
   * @default true
   */
  validateOnMutation?: boolean
}

/**
 * Ownership policy configuration
 */
export interface OwnershipConfig {
  /**
   * Column name for owner ID
   * @default 'owner_id' or 'user_id'
   */
  ownerColumn?: string

  /**
   * Operations owners can perform
   * @default ['read', 'update', 'delete']
   */
  ownerOperations?: Operation[]

  /**
   * Whether owners can delete
   * @default true
   */
  canDelete?: boolean
}

/**
 * Soft delete policy configuration
 */
export interface SoftDeleteConfig {
  /**
   * Column name for soft delete flag
   * @default 'deleted_at'
   */
  deletedColumn?: string

  /**
   * Whether to filter soft-deleted rows on read
   * @default true
   */
  filterOnRead?: boolean

  /**
   * Whether to prevent hard deletes
   * @default true
   */
  preventHardDelete?: boolean
}

/**
 * Status-based access configuration
 */
export interface StatusAccessConfig {
  /**
   * Column name for status
   * @default 'status'
   */
  statusColumn?: string

  /**
   * Statuses that are publicly readable
   */
  publicStatuses?: string[]

  /**
   * Statuses that can be updated
   */
  editableStatuses?: string[]

  /**
   * Statuses that can be deleted
   */
  deletableStatuses?: string[]
}
