/**
 * Field Access Processor
 *
 * Applies field-level access control to database rows and mutation data.
 *
 * @module @kysera/rls/field-access/processor
 */

import type { FieldAccessRegistry } from './registry.js'
import type {
  MaskedRow,
  FieldAccessOptions,
  FieldAccessResult,
  CompiledFieldAccess
} from './types.js'
import type { PolicyEvaluationContext, RLSContext } from '../policy/types.js'
import { rlsContext } from '../context/manager.js'
import { RLSPolicyViolation } from '../errors.js'

// ============================================================================
// Field Access Processor
// ============================================================================

/**
 * Field Access Processor
 *
 * Applies field-level access control rules to rows and mutation data.
 *
 * @example
 * ```typescript
 * const processor = new FieldAccessProcessor(registry);
 *
 * // Mask fields in a row
 * const result = await processor.maskRow('users', user, {
 *   includeMetadata: true
 * });
 *
 * console.log(result.data);          // Row with masked fields
 * console.log(result.maskedFields);  // ['email', 'phone']
 * console.log(result.omittedFields); // ['mfa_secret']
 *
 * // Validate write access
 * await processor.validateWrite('users', { email: 'new@example.com' });
 * ```
 */
export class FieldAccessProcessor<DB = unknown> {
  constructor(
    private registry: FieldAccessRegistry<DB>,
    private defaultMaskValue: unknown = null
  ) {}

  /**
   * Apply field access control to a single row
   *
   * @param table - Table name
   * @param row - Row data
   * @param options - Processing options
   * @returns Masked row with metadata
   */
  async maskRow<T extends Record<string, unknown>>(
    table: string,
    row: T,
    options: FieldAccessOptions = {}
  ): Promise<MaskedRow<T>> {
    const ctx = this.getContext()
    if (!ctx) {
      // No context - return original row
      return {
        data: row,
        maskedFields: [],
        omittedFields: []
      }
    }

    // System user sees everything
    if (ctx.auth.isSystem) {
      return {
        data: row,
        maskedFields: [],
        omittedFields: []
      }
    }

    const tableConfig = this.registry.getTableConfig(table)
    if (!tableConfig) {
      // No field access config - return original
      return {
        data: row,
        maskedFields: [],
        omittedFields: []
      }
    }

    // Check skipFor roles
    if (tableConfig.skipFor.some(role => ctx.auth.roles.includes(role))) {
      return {
        data: row,
        maskedFields: [],
        omittedFields: []
      }
    }

    const evalCtx = this.createEvalContext(ctx, row, table)
    const result: Partial<T> = {}
    const maskedFields: string[] = []
    const omittedFields: string[] = []

    // Process each field
    for (const [field, value] of Object.entries(row)) {
      // Check explicit include/exclude
      if (options.excludeFields?.includes(field)) {
        continue
      }
      if (options.includeFields && !options.includeFields.includes(field)) {
        continue
      }

      const fieldResult = await this.evaluateFieldAccess(
        tableConfig,
        field,
        value,
        evalCtx,
        options
      )

      if (fieldResult.omit) {
        omittedFields.push(field)
      } else if (!fieldResult.accessible) {
        maskedFields.push(field)
        ;(result as Record<string, unknown>)[field] = fieldResult.value
      } else {
        ;(result as Record<string, unknown>)[field] = value
      }
    }

    return {
      data: result,
      maskedFields,
      omittedFields
    }
  }

  /**
   * Apply field access control to multiple rows
   *
   * @param table - Table name
   * @param rows - Array of rows
   * @param options - Processing options
   * @returns Array of masked rows
   */
  async maskRows<T extends Record<string, unknown>>(
    table: string,
    rows: T[],
    options: FieldAccessOptions = {}
  ): Promise<MaskedRow<T>[]> {
    return await Promise.all(rows.map(row => this.maskRow(table, row, options)))
  }

  /**
   * Validate that all fields in mutation data are writable
   *
   * @param table - Table name
   * @param data - Mutation data
   * @param existingRow - Existing row (for update operations)
   * @throws RLSPolicyViolation if any field is not writable
   */
  async validateWrite(
    table: string,
    data: Record<string, unknown>,
    existingRow?: Record<string, unknown>
  ): Promise<void> {
    const ctx = this.getContext()
    if (!ctx) {
      return // No context = no validation
    }

    if (ctx.auth.isSystem) {
      return // System user can write anything
    }

    const tableConfig = this.registry.getTableConfig(table)
    if (!tableConfig) {
      return // No field access config
    }

    // Check skipFor roles
    if (tableConfig.skipFor.some(role => ctx.auth.roles.includes(role))) {
      return
    }

    const evalCtx = this.createEvalContext(ctx, existingRow ?? {}, table, data)

    // Check each field being written
    const unwritableFields: string[] = []

    for (const field of Object.keys(data)) {
      const canWrite = await this.registry.canWriteField(table, field, evalCtx)
      if (!canWrite) {
        unwritableFields.push(field)
      }
    }

    if (unwritableFields.length > 0) {
      throw new RLSPolicyViolation(
        'write',
        table,
        `Cannot write to protected fields: ${unwritableFields.join(', ')}`
      )
    }
  }

  /**
   * Filter mutation data to only include writable fields
   *
   * @param table - Table name
   * @param data - Mutation data
   * @param existingRow - Existing row (for update operations)
   * @returns Filtered data with only writable fields
   */
  async filterWritableFields(
    table: string,
    data: Record<string, unknown>,
    existingRow?: Record<string, unknown>
  ): Promise<{ data: Record<string, unknown>; removedFields: string[] }> {
    const ctx = this.getContext()
    if (!ctx) {
      return { data, removedFields: [] }
    }

    if (ctx.auth.isSystem) {
      return { data, removedFields: [] }
    }

    const tableConfig = this.registry.getTableConfig(table)
    if (!tableConfig) {
      return { data, removedFields: [] }
    }

    // Check skipFor roles
    if (tableConfig.skipFor.some(role => ctx.auth.roles.includes(role))) {
      return { data, removedFields: [] }
    }

    const evalCtx = this.createEvalContext(ctx, existingRow ?? {}, table, data)
    const result: Record<string, unknown> = {}
    const removedFields: string[] = []

    for (const [field, value] of Object.entries(data)) {
      const canWrite = await this.registry.canWriteField(table, field, evalCtx)
      if (canWrite) {
        result[field] = value
      } else {
        removedFields.push(field)
      }
    }

    return { data: result, removedFields }
  }

  /**
   * Get list of readable fields for a table
   *
   * @param table - Table name
   * @param row - Row data (for context-dependent fields)
   * @returns Array of readable field names
   */
  async getReadableFields(table: string, row: Record<string, unknown>): Promise<string[]> {
    const ctx = this.getContext()
    if (!ctx || ctx.auth.isSystem) {
      return Object.keys(row)
    }

    const tableConfig = this.registry.getTableConfig(table)
    if (!tableConfig) {
      return Object.keys(row)
    }

    // Check skipFor roles
    if (tableConfig.skipFor.some(role => ctx.auth.roles.includes(role))) {
      return Object.keys(row)
    }

    const evalCtx = this.createEvalContext(ctx, row, table)
    const readable: string[] = []

    for (const field of Object.keys(row)) {
      const canRead = await this.registry.canReadField(table, field, evalCtx)
      if (canRead) {
        readable.push(field)
      }
    }

    return readable
  }

  /**
   * Get list of writable fields for a table
   *
   * @param table - Table name
   * @param row - Existing row data (for context-dependent fields)
   * @returns Array of writable field names
   */
  async getWritableFields(table: string, row: Record<string, unknown>): Promise<string[]> {
    const ctx = this.getContext()
    if (!ctx || ctx.auth.isSystem) {
      return Object.keys(row)
    }

    const tableConfig = this.registry.getTableConfig(table)
    if (!tableConfig) {
      return Object.keys(row)
    }

    // Check skipFor roles
    if (tableConfig.skipFor.some(role => ctx.auth.roles.includes(role))) {
      return Object.keys(row)
    }

    const evalCtx = this.createEvalContext(ctx, row, table)
    const writable: string[] = []

    for (const field of Object.keys(row)) {
      const canWrite = await this.registry.canWriteField(table, field, evalCtx)
      if (canWrite) {
        writable.push(field)
      }
    }

    return writable
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get current RLS context
   */
  private getContext(): RLSContext | null {
    return rlsContext.getContextOrNull()
  }

  /**
   * Create evaluation context
   */
  private createEvalContext(
    ctx: RLSContext,
    row: Record<string, unknown>,
    table: string,
    data?: Record<string, unknown>
  ): PolicyEvaluationContext {
    return {
      auth: ctx.auth,
      row,
      data,
      table,
      ...(ctx.meta !== undefined && { meta: ctx.meta as Record<string, unknown> })
    }
  }

  /**
   * Evaluate field access for a specific field
   */
  private async evaluateFieldAccess(
    tableConfig: {
      defaultAccess: 'allow' | 'deny'
      fields: Map<string, CompiledFieldAccess>
    },
    field: string,
    value: unknown,
    ctx: PolicyEvaluationContext,
    options: FieldAccessOptions
  ): Promise<FieldAccessResult> {
    const fieldConfig = tableConfig.fields.get(field)

    if (!fieldConfig) {
      // Use default access policy
      const accessible = tableConfig.defaultAccess === 'allow'
      return {
        accessible,
        value: accessible ? value : this.defaultMaskValue,
        omit: !accessible && options.throwOnDenied !== true
      }
    }

    try {
      const canRead = await fieldConfig.canRead(ctx)

      if (canRead) {
        return {
          accessible: true,
          value
        } as FieldAccessResult
      }

      if (options.throwOnDenied) {
        throw new RLSPolicyViolation('read', ctx.table ?? 'unknown', `Cannot read field: ${field}`)
      }

      // Check if there's a mask function
      const configWithMask = fieldConfig as CompiledFieldAccess & {
        maskFn?: (value: unknown) => unknown
      }
      const maskedValue = configWithMask.maskFn
        ? configWithMask.maskFn(value)
        : fieldConfig.maskedValue ?? this.defaultMaskValue

      return {
        accessible: false,
        reason: `Field "${field}" is not accessible`,
        value: maskedValue,
        omit: fieldConfig.omitWhenHidden
      }
    } catch (error) {
      if (error instanceof RLSPolicyViolation) {
        throw error
      }

      // Log error and fail closed
      return {
        accessible: false,
        reason: `Error evaluating access: ${error instanceof Error ? error.message : String(error)}`,
        value: this.defaultMaskValue,
        omit: true
      }
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a field access processor
 */
export function createFieldAccessProcessor<DB = unknown>(
  registry: FieldAccessRegistry<DB>,
  defaultMaskValue?: unknown
): FieldAccessProcessor<DB> {
  return new FieldAccessProcessor<DB>(registry, defaultMaskValue)
}
