/**
 * Mutation Guard
 * Validates CREATE, UPDATE, DELETE operations against RLS policies
 */

import type { Kysely } from 'kysely';
import type { PolicyRegistry } from '../policy/registry.js';
import type { PolicyEvaluationContext, Operation } from '../policy/types.js';
import type { RLSContext } from '../context/types.js';
import { rlsContext } from '../context/manager.js';
import { RLSPolicyViolation } from '../errors.js';

/**
 * Mutation guard
 * Validates mutations (CREATE, UPDATE, DELETE) against allow/deny/validate policies
 */
export class MutationGuard<DB = unknown> {
  constructor(
    private registry: PolicyRegistry<DB>,
    private executor?: Kysely<DB>
  ) {}

  /**
   * Check if CREATE operation is allowed
   *
   * @param table - Table name
   * @param data - Data being inserted
   * @throws RLSPolicyViolation if access is denied
   *
   * @example
   * ```typescript
   * const guard = new MutationGuard(registry, db);
   * await guard.checkCreate('posts', { title: 'Hello', tenant_id: 1 });
   * ```
   */
  async checkCreate(
    table: string,
    data: Record<string, unknown>
  ): Promise<void> {
    await this.checkMutation(table, 'create', undefined, data);
  }

  /**
   * Check if UPDATE operation is allowed
   *
   * @param table - Table name
   * @param existingRow - Current row data
   * @param data - Data being updated
   * @throws RLSPolicyViolation if access is denied
   *
   * @example
   * ```typescript
   * const guard = new MutationGuard(registry, db);
   * const existingPost = await db.selectFrom('posts').where('id', '=', 1).selectAll().executeTakeFirst();
   * await guard.checkUpdate('posts', existingPost, { title: 'Updated' });
   * ```
   */
  async checkUpdate(
    table: string,
    existingRow: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<void> {
    await this.checkMutation(table, 'update', existingRow, data);
  }

  /**
   * Check if DELETE operation is allowed
   *
   * @param table - Table name
   * @param existingRow - Row to be deleted
   * @throws RLSPolicyViolation if access is denied
   *
   * @example
   * ```typescript
   * const guard = new MutationGuard(registry, db);
   * const existingPost = await db.selectFrom('posts').where('id', '=', 1).selectAll().executeTakeFirst();
   * await guard.checkDelete('posts', existingPost);
   * ```
   */
  async checkDelete(
    table: string,
    existingRow: Record<string, unknown>
  ): Promise<void> {
    await this.checkMutation(table, 'delete', existingRow);
  }

  /**
   * Check if READ operation is allowed on a specific row
   *
   * @param table - Table name
   * @param row - Row to check access for
   * @returns true if access is allowed
   *
   * @example
   * ```typescript
   * const guard = new MutationGuard(registry, db);
   * const post = await db.selectFrom('posts').where('id', '=', 1).selectAll().executeTakeFirst();
   * const canRead = await guard.checkRead('posts', post);
   * ```
   */
  async checkRead(
    table: string,
    row: Record<string, unknown>
  ): Promise<boolean> {
    try {
      await this.checkMutation(table, 'read', row);
      return true;
    } catch (error) {
      if (error instanceof RLSPolicyViolation) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Generic check for any operation (helper for testing)
   *
   * @param operation - Operation type
   * @param table - Table name
   * @param row - Existing row (for UPDATE/DELETE/READ)
   * @param data - New data (for CREATE/UPDATE)
   * @returns true if access is allowed, false otherwise
   */
  async canMutate(
    operation: Operation,
    table: string,
    row?: Record<string, unknown>,
    data?: Record<string, unknown>
  ): Promise<boolean> {
    try {
      await this.checkMutation(table, operation, row, data);
      return true;
    } catch (error) {
      if (error instanceof RLSPolicyViolation) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Validate mutation data (for validate policies)
   *
   * @param operation - Operation type
   * @param table - Table name
   * @param data - New data (for CREATE/UPDATE)
   * @param row - Existing row (for UPDATE)
   * @returns true if valid, false otherwise
   */
  async validateMutation(
    operation: Operation,
    table: string,
    data: Record<string, unknown>,
    row?: Record<string, unknown>
  ): Promise<boolean> {
    const ctx = rlsContext.getContextOrNull();
    if (!ctx) {
      return false;
    }

    // System users bypass validation
    if (ctx.auth.isSystem) {
      return true;
    }

    // Check skipFor roles
    const skipFor = this.registry.getSkipFor(table);
    if (skipFor.some(role => ctx.auth.roles.includes(role))) {
      return true;
    }

    // Get validate policies for this operation
    const validates = this.registry.getValidates(table, operation);
    if (validates.length === 0) {
      return true;
    }

    // Build evaluation context
    const evalCtx: PolicyEvaluationContext = {
      auth: ctx.auth,
      row: row,
      data: data,
      table: table,
      operation: operation,
      ...(ctx.meta !== undefined && { meta: ctx.meta as Record<string, unknown> }),
    };

    // All validate policies must pass
    for (const validate of validates) {
      const result = await this.evaluatePolicy(validate.evaluate, evalCtx);
      if (!result) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check mutation against RLS policies
   *
   * @param table - Table name
   * @param operation - Operation type
   * @param row - Existing row (for UPDATE/DELETE/READ)
   * @param data - New data (for CREATE/UPDATE)
   * @throws RLSPolicyViolation if access is denied
   */
  private async checkMutation(
    table: string,
    operation: Operation,
    row?: Record<string, unknown>,
    data?: Record<string, unknown>
  ): Promise<void> {
    const ctx = rlsContext.getContextOrNull();
    if (!ctx) {
      throw new RLSPolicyViolation(
        operation,
        table,
        'No RLS context available'
      );
    }

    // System users bypass all checks
    if (ctx.auth.isSystem) {
      return;
    }

    // Check if user role should skip RLS
    const skipFor = this.registry.getSkipFor(table);
    if (skipFor.some(role => ctx.auth.roles.includes(role))) {
      return;
    }

    // Evaluate deny policies first (they override allows)
    const denies = this.registry.getDenies(table, operation);
    for (const deny of denies) {
      const evalCtx = this.createEvalContext(ctx, table, operation, row, data);
      const result = await this.evaluatePolicy(deny.evaluate, evalCtx);

      if (result) {
        throw new RLSPolicyViolation(
          operation,
          table,
          `Denied by policy: ${deny.name}`
        );
      }
    }

    // Evaluate validate policies (for CREATE/UPDATE)
    if ((operation === 'create' || operation === 'update') && data) {
      const validates = this.registry.getValidates(table, operation);
      for (const validate of validates) {
        const evalCtx = this.createEvalContext(ctx, table, operation, row, data);
        const result = await this.evaluatePolicy(validate.evaluate, evalCtx);

        if (!result) {
          throw new RLSPolicyViolation(
            operation,
            table,
            `Validation failed: ${validate.name}`
          );
        }
      }
    }

    // Evaluate allow policies
    const allows = this.registry.getAllows(table, operation);
    const defaultDeny = this.registry.hasDefaultDeny(table);

    if (defaultDeny && allows.length === 0) {
      throw new RLSPolicyViolation(
        operation,
        table,
        'No allow policies defined (default deny)'
      );
    }

    if (allows.length > 0) {
      // At least one allow policy must pass
      let allowed = false;

      for (const allow of allows) {
        const evalCtx = this.createEvalContext(ctx, table, operation, row, data);
        const result = await this.evaluatePolicy(allow.evaluate, evalCtx);

        if (result) {
          allowed = true;
          break;
        }
      }

      if (!allowed) {
        throw new RLSPolicyViolation(
          operation,
          table,
          'No allow policies matched'
        );
      }
    }
  }

  /**
   * Create policy evaluation context
   */
  private createEvalContext(
    ctx: RLSContext,
    table: string,
    operation: Operation,
    row?: Record<string, unknown>,
    data?: Record<string, unknown>
  ): PolicyEvaluationContext {
    return {
      auth: ctx.auth,
      row,
      data,
      table,
      operation,
      metadata: ctx.meta,
    };
  }

  /**
   * Evaluate a policy condition
   */
  private async evaluatePolicy(
    condition: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>,
    evalCtx: PolicyEvaluationContext
  ): Promise<boolean> {
    try {
      const result = condition(evalCtx);
      return result instanceof Promise ? await result : result;
    } catch (error) {
      // Policy evaluation errors are treated as denial
      throw new RLSPolicyViolation(
        evalCtx.operation,
        evalCtx.table,
        `Policy evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Filter an array of rows, keeping only accessible ones
   * Useful for post-query filtering when query-level filtering is not possible
   *
   * @param table - Table name
   * @param rows - Array of rows to filter
   * @returns Filtered array containing only accessible rows
   *
   * @example
   * ```typescript
   * const guard = new MutationGuard(registry, db);
   * const allPosts = await db.selectFrom('posts').selectAll().execute();
   * const accessiblePosts = await guard.filterRows('posts', allPosts);
   * ```
   */
  async filterRows<T extends Record<string, unknown>>(
    table: string,
    rows: T[]
  ): Promise<T[]> {
    const results: T[] = [];

    for (const row of rows) {
      if (await this.checkRead(table, row)) {
        results.push(row);
      }
    }

    return results;
  }
}
