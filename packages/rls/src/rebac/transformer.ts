/**
 * ReBAC Query Transformer
 *
 * Transforms queries to apply relationship-based access control policies.
 * Generates EXISTS subqueries that filter rows based on relationship chains.
 *
 * @module @kysera/rls/rebac/transformer
 */

import type { SelectQueryBuilder } from 'kysely'
import { sql } from 'kysely'
import type { ReBAcRegistry } from './registry.js'
import type { CompiledReBAcPolicy, ReBAcQueryOptions, ReBAcPolicyDefinition } from './types.js'
import type { PolicyEvaluationContext, Operation, RLSContext } from '../policy/types.js'
import { rlsContext } from '../context/manager.js'

// ============================================================================
// ReBAC Transformer
// ============================================================================

/**
 * ReBAC query transformer
 *
 * Applies relationship-based access control to SELECT queries by generating
 * EXISTS subqueries that follow relationship paths.
 *
 * @example
 * ```typescript
 * const transformer = new ReBAcTransformer(registry);
 *
 * // Transform query
 * let query = db.selectFrom('products').selectAll();
 * query = transformer.transform(query, 'products', 'read');
 *
 * // Generated SQL includes EXISTS subquery:
 * // SELECT * FROM products p
 * // WHERE EXISTS (
 * //   SELECT 1 FROM shops s
 * //   JOIN organizations o ON s.organization_id = o.id
 * //   JOIN employees e ON e.organization_id = o.id
 * //   WHERE s.id = p.shop_id
 * //     AND e.user_id = $1
 * //     AND e.status = 'active'
 * // )
 * ```
 */
export class ReBAcTransformer<DB = unknown> {
  constructor(
    private registry: ReBAcRegistry<DB>,
    private options: ReBAcQueryOptions = {}
  ) {
    this.options = {
      qualifyColumns: true,
      dialect: 'postgres',
      ...options
    }
  }

  /**
   * Transform a SELECT query by applying ReBAC policies
   *
   * @param qb - Query builder to transform
   * @param table - Table being queried
   * @param operation - Operation being performed
   * @returns Transformed query builder
   */
  transform<TB extends keyof DB & string, O>(
    qb: SelectQueryBuilder<DB, TB, O>,
    table: string,
    operation: Operation = 'read'
  ): SelectQueryBuilder<DB, TB, O> {
    const ctx = rlsContext.getContextOrNull()
    if (!ctx) {
      // No context - handled by main RLS plugin
      return qb
    }

    // System users bypass ReBAC
    if (ctx.auth.isSystem) {
      return qb
    }

    // Get applicable ReBAC policies
    const policies = this.registry.getPolicies(table, operation)
    if (policies.length === 0) {
      return qb
    }

    // Apply each policy
    let result = qb
    for (const policy of policies) {
      result = this.applyPolicy(result, policy, ctx, table)
    }

    return result
  }

  /**
   * Generate EXISTS condition SQL for a policy
   *
   * This method can be used to get the raw SQL for debugging or manual query building.
   *
   * @param policy - ReBAC policy to generate SQL for
   * @param ctx - RLS context
   * @param mainTable - Main query table
   * @param mainTableAlias - Alias for main table
   * @returns SQL string and parameters
   */
  generateExistsSql(
    policy: CompiledReBAcPolicy,
    ctx: RLSContext,
    mainTable: string,
    mainTableAlias?: string
  ): { sql: string; params: unknown[] } {
    const { relationshipPath } = policy
    const evalCtx = this.createEvalContext(ctx, mainTable)
    const endConditions = policy.getEndConditions(evalCtx)

    const alias = mainTableAlias ?? mainTable
    const params: unknown[] = []
    let paramIndex = 1

    // Build the EXISTS subquery
    const steps = relationshipPath.steps
    if (steps.length === 0) {
      return { sql: 'TRUE', params: [] }
    }

    // Start with first join target
    const firstStep = steps[0]!
    let sql = `SELECT 1 FROM ${this.quote(firstStep.to)}`
    if (firstStep.alias !== firstStep.to) {
      sql += ` AS ${this.quote(firstStep.alias)}`
    }

    // Add joins for remaining steps
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i]!
      const joinType = step.joinType === 'left' ? 'LEFT JOIN' : step.joinType === 'right' ? 'RIGHT JOIN' : 'JOIN'

      sql += ` ${joinType} ${this.quote(step.to)}`
      if (step.alias !== step.to) {
        sql += ` AS ${this.quote(step.alias)}`
      }

      // Join condition
      const prevStep = steps[i - 1]!
      const prevAlias = prevStep.alias
      sql += ` ON ${this.quote(prevAlias)}.${this.quote(step.fromColumn)} = ${this.quote(step.alias)}.${this.quote(step.toColumn)}`

      // Additional conditions for this step
      if (Object.keys(step.additionalConditions).length > 0) {
        for (const [col, val] of Object.entries(step.additionalConditions)) {
          if (val === null) {
            sql += ` AND ${this.quote(step.alias)}.${this.quote(col)} IS NULL`
          } else {
            sql += ` AND ${this.quote(step.alias)}.${this.quote(col)} = ${this.param(paramIndex++)}`
            params.push(val)
          }
        }
      }
    }

    // WHERE clause connecting to main table
    sql += ` WHERE ${this.quote(firstStep.alias)}.${this.quote(firstStep.toColumn)} = ${this.quote(alias)}.${this.quote(firstStep.fromColumn)}`

    // Additional conditions from first step
    if (Object.keys(firstStep.additionalConditions).length > 0) {
      for (const [col, val] of Object.entries(firstStep.additionalConditions)) {
        if (val === null) {
          sql += ` AND ${this.quote(firstStep.alias)}.${this.quote(col)} IS NULL`
        } else {
          sql += ` AND ${this.quote(firstStep.alias)}.${this.quote(col)} = ${this.param(paramIndex++)}`
          params.push(val)
        }
      }
    }

    // End conditions (applied to the final table in the chain)
    const lastStep = steps[steps.length - 1]!
    for (const [col, val] of Object.entries(endConditions)) {
      if (val === null) {
        sql += ` AND ${this.quote(lastStep.alias)}.${this.quote(col)} IS NULL`
      } else if (val === undefined) {
        // Skip undefined
        continue
      } else if (Array.isArray(val)) {
        if (val.length === 0) {
          sql += ` AND FALSE`
        } else {
          const placeholders = val.map(() => this.param(paramIndex++)).join(', ')
          sql += ` AND ${this.quote(lastStep.alias)}.${this.quote(col)} IN (${placeholders})`
          params.push(...val)
        }
      } else {
        sql += ` AND ${this.quote(lastStep.alias)}.${this.quote(col)} = ${this.param(paramIndex++)}`
        params.push(val)
      }
    }

    // Wrap in EXISTS or NOT EXISTS based on policy type
    const existsExpr = policy.type === 'deny' ? `NOT EXISTS (${sql})` : `EXISTS (${sql})`

    return { sql: existsExpr, params }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Apply a single ReBAC policy to a query
   *
   * NOTE: Uses type casting for dynamic SQL because Kysely's type system
   * requires compile-time known types, but ReBAC policies work with
   * runtime-generated EXISTS clauses.
   */
  private applyPolicy<TB extends keyof DB & string, O>(
    qb: SelectQueryBuilder<DB, TB, O>,
    policy: CompiledReBAcPolicy,
    ctx: RLSContext,
    table: string
  ): SelectQueryBuilder<DB, TB, O> {
    const { sql: existsSql, params } = this.generateExistsSql(policy, ctx, table, this.options.mainTableAlias)

    // Build the SQL template parts for parameterization
    // Replace $N placeholders with sql template placeholders
    const sqlParts = existsSql.split(/\$\d+/)

    // Use Kysely's sql template function with tagged template literal
    // Build a raw sql expression with proper parameter binding
    const rawBuilder = sql.join(
      sqlParts.map((part, i) => {
        if (i < params.length) {
          return sql`${sql.raw(part)}${params[i]}`
        }
        return sql.raw(part)
      })
    )

    // Add the EXISTS/NOT EXISTS condition to the WHERE clause
    // Type cast is necessary because sql.join returns RawBuilder<unknown>
    // but where() requires ExpressionOrFactory<SqlBool>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return qb.where(rawBuilder as any) as SelectQueryBuilder<DB, TB, O>
  }

  /**
   * Create evaluation context for policy conditions
   */
  private createEvalContext(ctx: RLSContext, table: string): PolicyEvaluationContext {
    return {
      auth: ctx.auth,
      table,
      operation: 'read',
      ...(ctx.meta !== undefined && { meta: ctx.meta as Record<string, unknown> })
    }
  }

  /**
   * Quote an identifier for the target dialect
   */
  private quote(identifier: string): string {
    switch (this.options.dialect) {
      case 'mysql':
        return `\`${identifier}\``
      case 'sqlite':
        return `"${identifier}"`
      case 'postgres':
      default:
        return `"${identifier}"`
    }
  }

  /**
   * Generate parameter placeholder for the target dialect
   */
  private param(index: number): string {
    switch (this.options.dialect) {
      case 'mysql':
      case 'sqlite':
        return '?'
      case 'postgres':
      default:
        return `$${index}`
    }
  }
}

// ============================================================================
// Policy Builder Functions
// ============================================================================

/**
 * Create a ReBAC allow policy
 *
 * Rows are accessible if the relationship EXISTS with the given end conditions.
 *
 * @param operation - Operation(s) this policy applies to
 * @param relationshipPath - Name of the relationship path to use
 * @param endCondition - Conditions to apply at the end of the relationship
 * @param options - Additional policy options
 *
 * @example
 * ```typescript
 * // Allow read if user is employee of product's shop's organization
 * allowRelation('read', 'products_shop_org_membership', ctx => ({
 *   user_id: ctx.auth.userId,
 *   status: 'active'
 * }))
 * ```
 */
export function allowRelation(
  operation: Operation | Operation[],
  relationshipPath: string,
  endCondition: ((ctx: PolicyEvaluationContext) => Record<string, unknown>) | Record<string, unknown>,
  options?: { name?: string; priority?: number }
): ReBAcPolicyDefinition {
  const policy: ReBAcPolicyDefinition = {
    type: 'filter',
    operation,
    relationshipPath,
    endCondition,
    policyType: 'allow'
  }

  if (options?.name !== undefined) {
    policy.name = options.name
  }

  if (options?.priority !== undefined) {
    policy.priority = options.priority
  }

  return policy
}

/**
 * Create a ReBAC deny policy
 *
 * Rows are NOT accessible if the relationship EXISTS with the given conditions.
 *
 * @param operation - Operation(s) this policy applies to
 * @param relationshipPath - Name of the relationship path to use
 * @param endCondition - Conditions to apply at the end of the relationship
 * @param options - Additional policy options
 *
 * @example
 * ```typescript
 * // Deny access if user is blocked in the organization
 * denyRelation('all', 'products_shop_org_membership', ctx => ({
 *   user_id: ctx.auth.userId,
 *   status: 'blocked'
 * }))
 * ```
 */
export function denyRelation(
  operation: Operation | Operation[],
  relationshipPath: string,
  endCondition: ((ctx: PolicyEvaluationContext) => Record<string, unknown>) | Record<string, unknown>,
  options?: { name?: string; priority?: number }
): ReBAcPolicyDefinition {
  const policy: ReBAcPolicyDefinition = {
    type: 'filter',
    operation,
    relationshipPath,
    endCondition,
    policyType: 'deny',
    priority: options?.priority ?? 100 // Higher priority for deny
  }

  if (options?.name !== undefined) {
    policy.name = options.name
  }

  return policy
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a ReBAC transformer
 */
export function createReBAcTransformer<DB = unknown>(
  registry: ReBAcRegistry<DB>,
  options?: ReBAcQueryOptions
): ReBAcTransformer<DB> {
  return new ReBAcTransformer<DB>(registry, options)
}
