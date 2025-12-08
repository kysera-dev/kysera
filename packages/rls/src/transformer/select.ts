/**
 * SELECT Query Transformer
 * Applies filter policies to SELECT queries by adding WHERE conditions
 */

import type { SelectQueryBuilder } from 'kysely';
import type { PolicyRegistry } from '../policy/registry.js';
import type { PolicyEvaluationContext } from '../policy/types.js';
import type { RLSContext } from '../context/types.js';
import { rlsContext } from '../context/manager.js';
import { RLSError, RLSErrorCodes } from '../errors.js';

/**
 * SELECT query transformer
 * Applies filter policies to SELECT queries by adding WHERE conditions
 */
export class SelectTransformer<DB = unknown> {
  constructor(private registry: PolicyRegistry<DB>) {}

  /**
   * Transform a SELECT query by applying filter policies
   *
   * @param qb - The query builder to transform
   * @param table - Table name being queried
   * @returns Transformed query builder with RLS filters applied
   *
   * @example
   * ```typescript
   * const transformer = new SelectTransformer(registry);
   * let query = db.selectFrom('posts').selectAll();
   * query = transformer.transform(query, 'posts');
   * // Query now includes WHERE conditions from RLS policies
   * ```
   */
  transform<TB extends keyof DB & string, O>(
    qb: SelectQueryBuilder<DB, TB, O>,
    table: string
  ): SelectQueryBuilder<DB, TB, O> {
    // Check for context
    const ctx = rlsContext.getContextOrNull();
    if (!ctx) {
      // No context - return original query
      // In production, you might want to throw an error here
      return qb;
    }

    // Check if system user (bypass RLS)
    if (ctx.auth.isSystem) {
      return qb;
    }

    // Check if user role should skip RLS
    const skipFor = this.registry.getSkipFor(table);
    if (skipFor.some(role => ctx.auth.roles.includes(role))) {
      return qb;
    }

    // Get filter policies for this table
    const filters = this.registry.getFilters(table);
    if (filters.length === 0) {
      return qb;
    }

    // Apply each filter as WHERE condition
    let result = qb;
    for (const filter of filters) {
      const conditions = this.evaluateFilter(filter, ctx, table);
      result = this.applyConditions(result, conditions, table);
    }

    return result;
  }

  /**
   * Evaluate a filter policy to get WHERE conditions
   *
   * @param filter - The filter policy to evaluate
   * @param ctx - RLS context
   * @param table - Table name
   * @returns WHERE clause conditions as key-value pairs
   */
  private evaluateFilter(
    filter: { name: string; getConditions: (ctx: PolicyEvaluationContext) => Record<string, unknown> | Promise<Record<string, unknown>> },
    ctx: RLSContext,
    table: string
  ): Record<string, unknown> {
    const evalCtx: PolicyEvaluationContext = {
      auth: ctx.auth,
      ...(ctx.meta !== undefined && { meta: ctx.meta as Record<string, unknown> }),
    };

    const result = filter.getConditions(evalCtx);

    // Note: If async filters are needed, this method signature would need to change
    // For now, we assume synchronous filter evaluation
    if (result instanceof Promise) {
      throw new RLSError(
        `Async filter policies are not supported in SELECT transformers. ` +
        `Filter '${filter.name}' on table '${table}' returned a Promise. ` +
        `Use synchronous conditions for filter policies.`,
        RLSErrorCodes.RLS_POLICY_INVALID
      );
    }

    return result;
  }

  /**
   * Apply filter conditions to query builder
   *
   * @param qb - Query builder to modify
   * @param conditions - WHERE clause conditions
   * @param table - Table name (for qualified column names)
   * @returns Modified query builder
   */
  private applyConditions<TB extends keyof DB & string, O>(
    qb: SelectQueryBuilder<DB, TB, O>,
    conditions: Record<string, unknown>,
    table: string
  ): SelectQueryBuilder<DB, TB, O> {
    let result = qb;

    for (const [column, value] of Object.entries(conditions)) {
      // Use table-qualified column name to avoid ambiguity in joins
      const qualifiedColumn = `${table}.${column}` as any;

      if (value === null) {
        // NULL check
        result = result.where(qualifiedColumn, 'is', null);
      } else if (value === undefined) {
        // Skip undefined values
        continue;
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          // Empty array means no matches - add impossible condition
          // This ensures the query returns no rows
          result = result.where(qualifiedColumn, '=', '__RLS_NO_MATCH__' as any);
        } else {
          // IN clause for array values
          result = result.where(qualifiedColumn, 'in', value as any);
        }
      } else {
        // Equality check
        result = result.where(qualifiedColumn, '=', value as any);
      }
    }

    return result;
  }
}
