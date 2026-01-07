/**
 * Policy Testing Utilities
 *
 * Provides tools for unit testing RLS policies without a database.
 *
 * @module @kysera/rls/testing
 */

import type {
  RLSSchema,
  PolicyEvaluationContext,
  Operation,
  RLSAuthContext,
  CompiledPolicy
} from '../policy/types.js'
import { PolicyRegistry } from '../policy/registry.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Result of policy evaluation
 */
export interface PolicyEvaluationResult {
  /**
   * Whether the operation is allowed
   */
  allowed: boolean

  /**
   * Name of the policy that made the decision
   */
  policyName?: string

  /**
   * Type of decision
   */
  decisionType: 'allow' | 'deny' | 'default'

  /**
   * Reason for the decision
   */
  reason?: string

  /**
   * All policies that were evaluated
   */
  evaluatedPolicies: {
    name: string
    type: 'allow' | 'deny' | 'validate'
    result: boolean
  }[]
}

/**
 * Result of filter evaluation
 */
export interface FilterEvaluationResult {
  /**
   * Generated filter conditions
   */
  conditions: Record<string, unknown>

  /**
   * Names of all filters applied
   */
  appliedFilters: string[]
}

/**
 * Test context for policy evaluation
 */
export interface TestContext<TRow = Record<string, unknown>> {
  /**
   * Auth context
   */
  auth: RLSAuthContext

  /**
   * Row data (for read/update/delete operations)
   */
  row?: TRow

  /**
   * Mutation data (for create/update operations)
   */
  data?: Record<string, unknown>

  /**
   * Additional metadata
   */
  meta?: Record<string, unknown>
}

// ============================================================================
// Policy Tester
// ============================================================================

/**
 * Policy Tester
 *
 * Test RLS policies without a database connection.
 *
 * @example
 * ```typescript
 * const tester = createPolicyTester(rlsSchema);
 *
 * describe('Post RLS Policies', () => {
 *   it('should allow owner to update their post', async () => {
 *     const result = await tester.evaluate('posts', 'update', {
 *       auth: { userId: 'user-1', roles: ['user'] },
 *       row: { id: 'post-1', author_id: 'user-1', status: 'draft' }
 *     });
 *
 *     expect(result.allowed).toBe(true);
 *   });
 *
 *   it('should deny non-owner update', async () => {
 *     const result = await tester.evaluate('posts', 'update', {
 *       auth: { userId: 'user-2', roles: ['user'] },
 *       row: { id: 'post-1', author_id: 'user-1', status: 'draft' }
 *     });
 *
 *     expect(result.allowed).toBe(false);
 *     expect(result.reason).toContain('not owner');
 *   });
 *
 *   it('should apply filters correctly', async () => {
 *     const filters = await tester.getFilters('posts', 'read', {
 *       auth: { userId: 'user-1', tenantId: 'tenant-1', roles: [] }
 *     });
 *
 *     expect(filters.conditions).toEqual({
 *       tenant_id: 'tenant-1',
 *       deleted_at: null
 *     });
 *   });
 * });
 * ```
 */
export class PolicyTester<DB = unknown> {
  private registry: PolicyRegistry<DB>

  constructor(schema: RLSSchema<DB>) {
    this.registry = new PolicyRegistry<DB>(schema)
  }

  /**
   * Evaluate policies for an operation
   *
   * @param table - Table name
   * @param operation - Operation to test
   * @param context - Test context
   * @returns Evaluation result
   */
  async evaluate(
    table: string,
    operation: Operation,
    context: TestContext
  ): Promise<PolicyEvaluationResult> {
    const evaluatedPolicies: PolicyEvaluationResult['evaluatedPolicies'] = []

    // Check if table is registered
    if (!this.registry.hasTable(table)) {
      return {
        allowed: true,
        decisionType: 'default',
        reason: 'Table has no RLS policies',
        evaluatedPolicies
      }
    }

    // Check system user bypass
    if (context.auth.isSystem) {
      return {
        allowed: true,
        decisionType: 'allow',
        reason: 'System user bypasses RLS',
        evaluatedPolicies
      }
    }

    // Check skipFor roles
    const skipFor = this.registry.getSkipFor(table)
    if (skipFor.some(role => context.auth.roles.includes(role))) {
      return {
        allowed: true,
        decisionType: 'allow',
        reason: `Role bypass: ${skipFor.find(r => context.auth.roles.includes(r))}`,
        evaluatedPolicies
      }
    }

    // Build evaluation context
    const evalCtx: PolicyEvaluationContext = {
      auth: context.auth,
      row: context.row,
      data: context.data,
      table,
      operation,
      ...(context.meta !== undefined && { meta: context.meta })
    }

    // Evaluate deny policies first
    const denies = this.registry.getDenies(table, operation)
    for (const deny of denies) {
      const result = await this.evaluatePolicy(deny, evalCtx)
      evaluatedPolicies.push({
        name: deny.name,
        type: 'deny',
        result
      })

      if (result) {
        return {
          allowed: false,
          policyName: deny.name,
          decisionType: 'deny',
          reason: `Denied by policy: ${deny.name}`,
          evaluatedPolicies
        }
      }
    }

    // Evaluate validate policies (for create/update)
    if ((operation === 'create' || operation === 'update') && context.data) {
      const validates = this.registry.getValidates(table, operation)
      for (const validate of validates) {
        const result = await this.evaluatePolicy(validate, evalCtx)
        evaluatedPolicies.push({
          name: validate.name,
          type: 'validate',
          result
        })

        if (!result) {
          return {
            allowed: false,
            policyName: validate.name,
            decisionType: 'deny',
            reason: `Validation failed: ${validate.name}`,
            evaluatedPolicies
          }
        }
      }
    }

    // Evaluate allow policies
    const allows = this.registry.getAllows(table, operation)
    const defaultDeny = this.registry.hasDefaultDeny(table)

    if (defaultDeny && allows.length === 0) {
      return {
        allowed: false,
        decisionType: 'default',
        reason: 'No allow policies defined (default deny)',
        evaluatedPolicies
      }
    }

    for (const allow of allows) {
      const result = await this.evaluatePolicy(allow, evalCtx)
      evaluatedPolicies.push({
        name: allow.name,
        type: 'allow',
        result
      })

      if (result) {
        return {
          allowed: true,
          policyName: allow.name,
          decisionType: 'allow',
          reason: `Allowed by policy: ${allow.name}`,
          evaluatedPolicies
        }
      }
    }

    // No allow policy matched
    if (defaultDeny) {
      return {
        allowed: false,
        decisionType: 'default',
        reason: 'No allow policies matched (default deny)',
        evaluatedPolicies
      }
    }

    return {
      allowed: true,
      decisionType: 'default',
      reason: 'No policies matched (default allow)',
      evaluatedPolicies
    }
  }

  /**
   * Get filter conditions for read operations
   *
   * @param table - Table name
   * @param operation - Must be 'read'
   * @param context - Test context
   * @returns Filter conditions
   */
  getFilters(
    table: string,
    _operation: 'read',
    context: Pick<TestContext, 'auth' | 'meta'>
  ): FilterEvaluationResult {
    const conditions: Record<string, unknown> = {}
    const appliedFilters: string[] = []

    // Check if table is registered
    if (!this.registry.hasTable(table)) {
      return { conditions, appliedFilters }
    }

    // Check system user bypass
    if (context.auth.isSystem) {
      return { conditions, appliedFilters }
    }

    // Check skipFor roles
    const skipFor = this.registry.getSkipFor(table)
    if (skipFor.some(role => context.auth.roles.includes(role))) {
      return { conditions, appliedFilters }
    }

    // Get filters
    const filters = this.registry.getFilters(table)

    // Build evaluation context
    const evalCtx: PolicyEvaluationContext = {
      auth: context.auth,
      ...(context.meta !== undefined && { meta: context.meta })
    }

    // Evaluate each filter
    for (const filter of filters) {
      const filterConditions = filter.getConditions(evalCtx)
      Object.assign(conditions, filterConditions)
      appliedFilters.push(filter.name)
    }

    return { conditions, appliedFilters }
  }

  /**
   * Test if a specific policy allows the operation
   *
   * @param table - Table name
   * @param policyName - Name of the policy to test
   * @param context - Test context
   * @returns True if policy allows
   */
  async testPolicy(
    table: string,
    policyName: string,
    context: TestContext
  ): Promise<{ found: boolean; result?: boolean }> {
    // Search in all policy types
    const operations: Operation[] = ['read', 'create', 'update', 'delete']

    for (const op of operations) {
      // Build evaluation context once per operation
      const evalCtx: PolicyEvaluationContext = {
        auth: context.auth,
        row: context.row,
        data: context.data,
        table,
        operation: op,
        ...(context.meta !== undefined && { meta: context.meta })
      }

      // Check allows
      const allows = this.registry.getAllows(table, op)
      const allow = allows.find(p => p.name === policyName)
      if (allow) {
        const result = await this.evaluatePolicy(allow, evalCtx)
        return { found: true, result }
      }

      // Check denies
      const denies = this.registry.getDenies(table, op)
      const deny = denies.find(p => p.name === policyName)
      if (deny) {
        const result = await this.evaluatePolicy(deny, evalCtx)
        return { found: true, result }
      }

      // Check validates
      const validates = this.registry.getValidates(table, op)
      const validate = validates.find(p => p.name === policyName)
      if (validate) {
        const result = await this.evaluatePolicy(validate, evalCtx)
        return { found: true, result }
      }
    }

    return { found: false }
  }

  /**
   * List all policies for a table
   */
  listPolicies(table: string): {
    allows: string[]
    denies: string[]
    filters: string[]
    validates: string[]
  } {
    const operations: Operation[] = ['read', 'create', 'update', 'delete']
    const allowSet = new Set<string>()
    const denySet = new Set<string>()
    const validateSet = new Set<string>()

    for (const op of operations) {
      this.registry.getAllows(table, op).forEach(p => allowSet.add(p.name))
      this.registry.getDenies(table, op).forEach(p => denySet.add(p.name))
      this.registry.getValidates(table, op).forEach(p => validateSet.add(p.name))
    }

    return {
      allows: Array.from(allowSet),
      denies: Array.from(denySet),
      filters: this.registry.getFilters(table).map(f => f.name),
      validates: Array.from(validateSet)
    }
  }

  /**
   * Get all registered tables
   */
  getTables(): string[] {
    return this.registry.getTables()
  }

  /**
   * Evaluate a single policy
   */
  private async evaluatePolicy(
    policy: CompiledPolicy,
    ctx: PolicyEvaluationContext
  ): Promise<boolean> {
    try {
      const result = policy.evaluate(ctx)
      return result instanceof Promise ? await result : result
    } catch {
      return false // Fail closed
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a policy tester
 *
 * @param schema - RLS schema to test
 * @returns PolicyTester instance
 */
export function createPolicyTester<DB = unknown>(schema: RLSSchema<DB>): PolicyTester<DB> {
  return new PolicyTester<DB>(schema)
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test auth context
 *
 * @param overrides - Values to override
 * @returns RLSAuthContext for testing
 */
export function createTestAuthContext(
  overrides: Partial<RLSAuthContext> & { userId: string | number }
): RLSAuthContext {
  return {
    roles: [],
    isSystem: false,
    ...overrides
  }
}

/**
 * Create a test row
 *
 * @param data - Row data
 * @returns Row object
 */
export function createTestRow<T extends Record<string, unknown>>(data: T): T {
  return { ...data }
}

/**
 * Assertion helpers for policy testing
 */
export const policyAssertions = {
  /**
   * Assert that the result is allowed
   */
  assertAllowed(result: PolicyEvaluationResult, message?: string): void {
    if (!result.allowed) {
      throw new Error(
        message ?? `Expected policy to allow, but was denied: ${result.reason}`
      )
    }
  },

  /**
   * Assert that the result is denied
   */
  assertDenied(result: PolicyEvaluationResult, message?: string): void {
    if (result.allowed) {
      throw new Error(
        message ?? `Expected policy to deny, but was allowed: ${result.reason}`
      )
    }
  },

  /**
   * Assert that a specific policy made the decision
   */
  assertPolicyUsed(result: PolicyEvaluationResult, policyName: string, message?: string): void {
    if (result.policyName !== policyName) {
      throw new Error(
        message ?? `Expected policy "${policyName}" but was "${result.policyName}"`
      )
    }
  },

  /**
   * Assert that filters include expected conditions
   */
  assertFiltersInclude(
    result: FilterEvaluationResult,
    expected: Record<string, unknown>,
    message?: string
  ): void {
    for (const [key, value] of Object.entries(expected)) {
      if (result.conditions[key] !== value) {
        throw new Error(
          message ??
            `Expected filter condition ${key}=${JSON.stringify(value)} but got ${JSON.stringify(result.conditions[key])}`
        )
      }
    }
  }
}
