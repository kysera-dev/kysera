/**
 * Field Access Registry
 *
 * Manages field-level access control configurations across tables.
 *
 * @module @kysera/rls/field-access/registry
 */

import type {
  FieldAccessSchema,
  TableFieldAccessConfig,
  FieldAccessConfig,
  CompiledTableFieldAccess,
  CompiledFieldAccess
} from './types.js'
import type { PolicyEvaluationContext } from '../policy/types.js'
import { silentLogger, type KyseraLogger } from '@kysera/core'

// ============================================================================
// Field Access Registry
// ============================================================================

/**
 * Field Access Registry
 *
 * Manages field-level access control configurations for all tables.
 *
 * @example
 * ```typescript
 * const registry = new FieldAccessRegistry();
 *
 * registry.loadSchema<Database>({
 *   users: {
 *     default: 'allow',
 *     fields: {
 *       email: ownerOrRoles(['admin'], 'id'),
 *       password_hash: neverAccessible(),
 *       mfa_secret: ownerOnly('id')
 *     }
 *   }
 * });
 *
 * // Check if field is accessible
 * const canRead = await registry.canReadField('users', 'email', evalCtx);
 * ```
 */
export class FieldAccessRegistry<DB = unknown> {
  private tables = new Map<string, CompiledTableFieldAccess>()
  private logger: KyseraLogger

  constructor(schema?: FieldAccessSchema<DB>, options?: { logger?: KyseraLogger }) {
    this.logger = options?.logger ?? silentLogger
    if (schema) {
      this.loadSchema(schema)
    }
  }

  /**
   * Load field access schema
   */
  loadSchema(schema: FieldAccessSchema<DB>): void {
    for (const [table, config] of Object.entries(schema)) {
      if (!config) continue
      this.registerTable(table, config as TableFieldAccessConfig)
    }
  }

  /**
   * Register field access configuration for a table
   */
  registerTable(table: string, config: TableFieldAccessConfig): void {
    const compiled: CompiledTableFieldAccess = {
      table,
      defaultAccess: config.default ?? 'allow',
      skipFor: config.skipFor ?? [],
      fields: new Map()
    }

    // Compile field configurations
    for (const [field, fieldConfig] of Object.entries(config.fields)) {
      if (!fieldConfig) continue

      const compiledField = this.compileFieldConfig(field, fieldConfig as FieldAccessConfig)
      compiled.fields.set(field, compiledField)
    }

    this.tables.set(table, compiled)
    this.logger.info?.(`[FieldAccess] Registered table: ${table}`, {
      fields: compiled.fields.size,
      defaultAccess: compiled.defaultAccess
    })
  }

  /**
   * Check if a field is readable in the current context
   *
   * @param table - Table name
   * @param field - Field name
   * @param ctx - Evaluation context
   * @returns True if field is readable
   */
  async canReadField(table: string, field: string, ctx: PolicyEvaluationContext): Promise<boolean> {
    const config = this.tables.get(table)
    if (!config) {
      // No field access config = all fields readable
      return true
    }

    // Check skipFor roles
    if (config.skipFor.some(role => ctx.auth.roles.includes(role))) {
      return true
    }

    // System user bypasses field access
    if (ctx.auth.isSystem) {
      return true
    }

    const fieldConfig = config.fields.get(field)
    if (!fieldConfig) {
      // Use default policy
      return config.defaultAccess === 'allow'
    }

    try {
      const result = fieldConfig.canRead(ctx)
      return result instanceof Promise ? await result : result
    } catch (error) {
      this.logger.error?.(`[FieldAccess] Error checking read access for ${table}.${field}`, {
        error: error instanceof Error ? error.message : String(error)
      })
      return false // Fail closed
    }
  }

  /**
   * Check if a field is writable in the current context
   *
   * @param table - Table name
   * @param field - Field name
   * @param ctx - Evaluation context
   * @returns True if field is writable
   */
  async canWriteField(table: string, field: string, ctx: PolicyEvaluationContext): Promise<boolean> {
    const config = this.tables.get(table)
    if (!config) {
      return true
    }

    // Check skipFor roles
    if (config.skipFor.some(role => ctx.auth.roles.includes(role))) {
      return true
    }

    // System user bypasses field access
    if (ctx.auth.isSystem) {
      return true
    }

    const fieldConfig = config.fields.get(field)
    if (!fieldConfig) {
      return config.defaultAccess === 'allow'
    }

    try {
      const result = fieldConfig.canWrite(ctx)
      return result instanceof Promise ? await result : result
    } catch (error) {
      this.logger.error?.(`[FieldAccess] Error checking write access for ${table}.${field}`, {
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  /**
   * Get field configuration
   *
   * @param table - Table name
   * @param field - Field name
   * @returns Compiled field access config or undefined
   */
  getFieldConfig(table: string, field: string): CompiledFieldAccess | undefined {
    return this.tables.get(table)?.fields.get(field)
  }

  /**
   * Get table configuration
   *
   * @param table - Table name
   * @returns Compiled table field access config or undefined
   */
  getTableConfig(table: string): CompiledTableFieldAccess | undefined {
    return this.tables.get(table)
  }

  /**
   * Check if table has field access configuration
   */
  hasTable(table: string): boolean {
    return this.tables.has(table)
  }

  /**
   * Get all registered table names
   */
  getTables(): string[] {
    return Array.from(this.tables.keys())
  }

  /**
   * Get all fields with explicit configuration for a table
   *
   * @param table - Table name
   * @returns Array of field names
   */
  getConfiguredFields(table: string): string[] {
    const config = this.tables.get(table)
    return config ? Array.from(config.fields.keys()) : []
  }

  /**
   * Clear all configurations
   */
  clear(): void {
    this.tables.clear()
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Compile a field access configuration
   */
  private compileFieldConfig(field: string, config: FieldAccessConfig): CompiledFieldAccess {
    return {
      field,
      canRead: config.read ?? (() => true),
      canWrite: config.write ?? (() => true),
      maskedValue: config.maskedValue ?? null,
      omitWhenHidden: config.omitWhenHidden ?? false
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a field access registry
 */
export function createFieldAccessRegistry<DB = unknown>(
  schema?: FieldAccessSchema<DB>,
  options?: { logger?: KyseraLogger }
): FieldAccessRegistry<DB> {
  return new FieldAccessRegistry<DB>(schema, options)
}
