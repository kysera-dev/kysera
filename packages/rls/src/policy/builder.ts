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
  PolicyCondition,
  FilterCondition,
  PolicyHints,
  PolicyActivationCondition,
  ConditionalPolicyDefinition
} from './types.js'

/**
 * Options for policy definitions
 */
export interface PolicyOptions {
  /** Policy name for debugging and identification */
  name?: string
  /** Priority (higher runs first, deny policies default to 100) */
  priority?: number
  /** Performance optimization hints */
  hints?: PolicyHints
  /**
   * Condition that determines if this policy is active
   * The policy will only be evaluated if this returns true
   *
   * @example
   * ```typescript
   * // Only apply in production
   * allow('read', () => true, {
   *   condition: ctx => ctx.meta?.environment === 'production'
   * })
   *
   * // Feature-gated policy
   * filter('read', ctx => ({ strict: true }), {
   *   condition: ctx => ctx.meta?.features?.strictMode
   * })
   * ```
   */
  condition?: PolicyActivationCondition
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
): ConditionalPolicyDefinition {
  const policy: ConditionalPolicyDefinition = {
    type: 'allow',
    operation,
    condition: condition,
    priority: options?.priority ?? 0
  }

  if (options?.name !== undefined) {
    policy.name = options.name
  }

  if (options?.hints !== undefined) {
    policy.hints = options.hints
  }

  if (options?.condition !== undefined) {
    policy.activationCondition = options.condition
  }

  return policy
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
): ConditionalPolicyDefinition {
  const policy: ConditionalPolicyDefinition = {
    type: 'deny',
    operation,
    condition: condition ?? (() => true),
    priority: options?.priority ?? 100 // Deny policies run first by default
  }

  if (options?.name !== undefined) {
    policy.name = options.name
  }

  if (options?.hints !== undefined) {
    policy.hints = options.hints
  }

  if (options?.condition !== undefined) {
    policy.activationCondition = options.condition
  }

  return policy
}

/**
 * Create a filter policy
 * Adds WHERE conditions to SELECT queries
 *
 * **IMPORTANT**: Filter conditions must be synchronous functions.
 * Async filter policies are not currently supported because filters are applied
 * directly to query builders at query construction time.
 *
 * @example
 * ```typescript
 * // ✅ CORRECT: Filter by tenant (synchronous)
 * filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
 *
 * // ✅ CORRECT: Filter by organization with soft delete
 * filter('read', ctx => ({
 *   organization_id: ctx.auth.organizationIds?.[0],
 *   deleted_at: null
 * }))
 *
 * // ❌ WRONG: Async filter (not supported)
 * // filter('read', async ctx => {
 * //   const tenantId = await fetchTenantId(ctx.auth.userId)
 * //   return { tenant_id: tenantId }
 * // })
 *
 * // ✅ WORKAROUND: Fetch data before creating context
 * // const tenantId = await fetchTenantId(userId)
 * // const ctx = createRLSContext({ auth: { userId, tenantId, roles: [] } })
 * // filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
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
): ConditionalPolicyDefinition {
  const policy: ConditionalPolicyDefinition = {
    type: 'filter',
    operation: operation === 'all' ? 'read' : operation,
    condition: condition as unknown as PolicyCondition,
    priority: options?.priority ?? 0
  }

  if (options?.name !== undefined) {
    policy.name = options.name
  }

  if (options?.hints !== undefined) {
    policy.hints = options.hints
  }

  if (options?.condition !== undefined) {
    policy.activationCondition = options.condition
  }

  return policy
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
): ConditionalPolicyDefinition {
  const ops: Operation[] = operation === 'all' ? ['create', 'update'] : [operation]

  const policy: ConditionalPolicyDefinition = {
    type: 'validate',
    operation: ops,
    condition: condition,
    priority: options?.priority ?? 0
  }

  if (options?.name !== undefined) {
    policy.name = options.name
  }

  if (options?.hints !== undefined) {
    policy.hints = options.hints
  }

  if (options?.condition !== undefined) {
    policy.activationCondition = options.condition
  }

  return policy
}

// ============================================================================
// Conditional Policy Helpers
// ============================================================================

/**
 * Create a policy that is only active in specific environments
 *
 * @param environments - Environments where the policy is active
 * @param policyFn - Function that creates the policy
 * @returns Policy with environment condition
 *
 * @example
 * ```typescript
 * // Policy only active in production
 * const prodPolicy = whenEnvironment(['production'], () =>
 *   allow('read', () => true, { name: 'prod-read' })
 * );
 *
 * // Policy active in staging and production
 * const nonDevPolicy = whenEnvironment(['staging', 'production'], () =>
 *   filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
 * );
 * ```
 */
export function whenEnvironment(
  environments: string[],
  policyFn: () => ConditionalPolicyDefinition
): ConditionalPolicyDefinition {
  const policy = policyFn()
  const existingCondition = policy.activationCondition
  policy.activationCondition = ctx => {
    const envMatch = environments.includes(ctx.environment ?? '')
    if (!envMatch) return false
    // If there was an existing condition (from inner wrapper), it must also pass
    return existingCondition ? existingCondition(ctx) : true
  }
  return policy
}

/**
 * Create a policy that is only active when a feature flag is enabled
 *
 * @param feature - Feature flag name
 * @param policyFn - Function that creates the policy
 * @returns Policy with feature flag condition
 *
 * @example
 * ```typescript
 * // Policy only active when 'strict_rls' feature is enabled
 * const strictPolicy = whenFeature('strict_rls', () =>
 *   deny('delete', () => true, { name: 'strict-no-delete' })
 * );
 * ```
 */
export function whenFeature(
  feature: string,
  policyFn: () => ConditionalPolicyDefinition
): ConditionalPolicyDefinition {
  const policy = policyFn()
  const existingCondition = policy.activationCondition
  policy.activationCondition = ctx => {
    let featureEnabled = false
    if (Array.isArray(ctx.features)) {
      featureEnabled = ctx.features.includes(feature)
    } else if (ctx.features && typeof ctx.features === 'object' && 'has' in ctx.features) {
      // Support Set<string>
      featureEnabled = (ctx.features as Set<string>).has(feature)
    } else if (ctx.features && typeof ctx.features === 'object') {
      // Support object-style features: { feature_name: boolean }
      featureEnabled = !!(ctx.features as Record<string, unknown>)[feature]
    }
    if (!featureEnabled) return false
    // If there was an existing condition (from inner wrapper), it must also pass
    return existingCondition ? existingCondition(ctx) : true
  }
  return policy
}

/**
 * Create a policy that is only active during specific hours
 *
 * @param startHour - Start hour (0-23)
 * @param endHour - End hour (0-23)
 * @param policyFn - Function that creates the policy
 * @returns Policy with time-based condition
 *
 * @example
 * ```typescript
 * // Policy only active during business hours (9 AM - 5 PM)
 * const businessHoursPolicy = whenTimeRange(9, 17, () =>
 *   allow('update', () => true, { name: 'business-hours-update' })
 * );
 * ```
 */
export function whenTimeRange(
  startHour: number,
  endHour: number,
  policyFn: () => ConditionalPolicyDefinition
): ConditionalPolicyDefinition {
  const policy = policyFn()
  const existingCondition = policy.activationCondition
  policy.activationCondition = ctx => {
    const hour = (ctx.timestamp ?? new Date()).getHours()
    let inRange: boolean
    // Handle midnight crossing (e.g., 22:00 to 06:00)
    if (startHour > endHour) {
      inRange = hour >= startHour || hour < endHour
    } else {
      inRange = hour >= startHour && hour < endHour
    }
    if (!inRange) return false
    // If there was an existing condition (from inner wrapper), it must also pass
    return existingCondition ? existingCondition(ctx) : true
  }
  return policy
}

/**
 * Create a policy that is only active when a custom condition is met
 *
 * @param condition - Custom activation condition
 * @param policyFn - Function that creates the policy
 * @returns Policy with custom condition
 *
 * @example
 * ```typescript
 * // Policy only active when user is in beta program
 * const betaPolicy = whenCondition(
 *   ctx => ctx.meta?.betaUser === true,
 *   () => allow('read', () => true, { name: 'beta-read' })
 * );
 * ```
 */
export function whenCondition(
  condition: PolicyActivationCondition,
  policyFn: () => ConditionalPolicyDefinition
): ConditionalPolicyDefinition {
  const policy = policyFn()
  policy.activationCondition = condition
  return policy
}
