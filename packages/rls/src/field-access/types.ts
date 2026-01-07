/**
 * Field-Level Access Control Types
 *
 * Provides type definitions for controlling access to individual columns
 * based on context. This allows hiding sensitive fields from unauthorized users.
 *
 * @module @kysera/rls/field-access/types
 */

import type { PolicyEvaluationContext } from '../policy/types.js'

// ============================================================================
// Field Access Types
// ============================================================================

/**
 * Operations that can be controlled at field level
 */
export type FieldOperation = 'read' | 'write'

/**
 * Field access condition function
 *
 * Returns true if the field is accessible, false otherwise.
 *
 * @typeParam TCtx - Policy evaluation context type
 */
export type FieldAccessCondition<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> = (
  ctx: TCtx
) => boolean | Promise<boolean>

/**
 * Configuration for a single field's access control
 *
 * @example
 * ```typescript
 * const emailConfig: FieldAccessConfig = {
 *   read: ctx => ctx.auth.userId === ctx.row.id || ctx.auth.roles.includes('admin'),
 *   write: ctx => ctx.auth.userId === ctx.row.id
 * };
 * ```
 */
export interface FieldAccessConfig<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> {
  /**
   * Condition for read access
   * If undefined, uses table default
   */
  read?: FieldAccessCondition<TCtx>

  /**
   * Condition for write access
   * If undefined, uses table default
   */
  write?: FieldAccessCondition<TCtx>

  /**
   * Value to use when field is not readable
   * @default null
   */
  maskedValue?: unknown

  /**
   * Whether to completely omit the field when not readable
   * @default false (uses maskedValue instead)
   */
  omitWhenHidden?: boolean
}

/**
 * Table field access configuration
 *
 * @typeParam TRow - Type of the database row
 * @typeParam TCtx - Policy evaluation context type
 *
 * @example
 * ```typescript
 * const usersFieldAccess: TableFieldAccessConfig<User> = {
 *   default: 'allow',
 *   fields: {
 *     email: {
 *       read: ctx => ctx.auth.userId === ctx.row.id || ctx.auth.roles.includes('admin')
 *     },
 *     password_hash: {
 *       read: () => false,
 *       write: () => false
 *     },
 *     mfa_totp_secret: {
 *       read: ctx => ctx.auth.userId === ctx.row.id,
 *       omitWhenHidden: true
 *     }
 *   }
 * };
 * ```
 */
export interface TableFieldAccessConfig<
  TRow = unknown,
  TCtx extends PolicyEvaluationContext = PolicyEvaluationContext
> {
  /**
   * Default access policy for fields not explicitly configured
   * - 'allow': All fields are accessible by default
   * - 'deny': Only explicitly allowed fields are accessible
   * @default 'allow'
   */
  default?: 'allow' | 'deny'

  /**
   * Field-specific access configurations
   */
  fields: {
    [K in keyof TRow]?: FieldAccessConfig<TCtx>
  }

  /**
   * Roles that bypass field access control
   */
  skipFor?: string[]
}

/**
 * Complete field access schema for all tables
 *
 * @typeParam DB - Database schema type
 */
export type FieldAccessSchema<DB> = {
  [K in keyof DB]?: TableFieldAccessConfig<DB[K]>
}

// ============================================================================
// Compiled Field Access Types
// ============================================================================

/**
 * Compiled field access configuration ready for evaluation
 */
export interface CompiledFieldAccess {
  /**
   * Field name
   */
  field: string

  /**
   * Compiled read condition
   * Returns true if field is readable
   */
  canRead: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>

  /**
   * Compiled write condition
   * Returns true if field is writable
   */
  canWrite: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>

  /**
   * Value to use when field is masked
   */
  maskedValue: unknown

  /**
   * Whether to omit the field entirely when hidden
   */
  omitWhenHidden: boolean
}

/**
 * Compiled table field access configuration
 */
export interface CompiledTableFieldAccess {
  /**
   * Table name
   */
  table: string

  /**
   * Default access policy
   */
  defaultAccess: 'allow' | 'deny'

  /**
   * Roles that bypass field access
   */
  skipFor: string[]

  /**
   * Field-specific configurations
   */
  fields: Map<string, CompiledFieldAccess>
}

// ============================================================================
// Field Masking Result Types
// ============================================================================

/**
 * Result of field access evaluation
 */
export interface FieldAccessResult {
  /**
   * Whether the field is accessible
   */
  accessible: boolean

  /**
   * If not accessible, the reason
   */
  reason?: string

  /**
   * Value to use (original or masked)
   */
  value: unknown

  /**
   * Whether the field should be omitted entirely
   */
  omit: boolean
}

/**
 * Result of applying field access to a row
 */
export interface MaskedRow<T = Record<string, unknown>> {
  /**
   * The row with field access applied
   */
  data: Partial<T>

  /**
   * Fields that were masked
   */
  maskedFields: string[]

  /**
   * Fields that were omitted
   */
  omittedFields: string[]
}

// ============================================================================
// Field Access Options
// ============================================================================

/**
 * Options for field access processing
 */
export interface FieldAccessOptions {
  /**
   * Whether to throw an error when accessing a denied field
   * @default false (returns masked value instead)
   */
  throwOnDenied?: boolean

  /**
   * Whether to include metadata about masked fields in the result
   * @default false
   */
  includeMetadata?: boolean

  /**
   * Fields to explicitly include (whitelist)
   * If specified, only these fields are processed
   */
  includeFields?: string[]

  /**
   * Fields to explicitly exclude (blacklist)
   * These fields are never included regardless of access
   */
  excludeFields?: string[]
}

// ============================================================================
// Predefined Field Patterns
// ============================================================================

/**
 * Always deny access to a field
 *
 * @example
 * ```typescript
 * const config = {
 *   fields: {
 *     password_hash: neverAccessible(),
 *     api_secret: neverAccessible()
 *   }
 * };
 * ```
 */
export function neverAccessible(): FieldAccessConfig {
  return {
    read: () => false,
    write: () => false,
    omitWhenHidden: true
  }
}

/**
 * Only the resource owner can access this field
 *
 * @param ownerField - Field name containing the owner ID
 *
 * @example
 * ```typescript
 * const config = {
 *   fields: {
 *     email: ownerOnly('user_id'),
 *     phone: ownerOnly('user_id')
 *   }
 * };
 * ```
 */
export function ownerOnly(ownerField = 'id'): FieldAccessConfig {
  return {
    read: ctx => {
      const rowValue = (ctx.row as Record<string, unknown>)?.[ownerField]
      // Convert both to strings for comparison to handle number/string mismatches
      return String(ctx.auth.userId) === String(rowValue)
    },
    write: ctx => {
      const rowValue = (ctx.row as Record<string, unknown>)?.[ownerField]
      return String(ctx.auth.userId) === String(rowValue)
    }
  }
}

/**
 * Owner or users with specific roles can access this field
 *
 * @param roles - Roles that can access besides owner
 * @param ownerField - Field name containing the owner ID
 *
 * @example
 * ```typescript
 * const config = {
 *   fields: {
 *     email: ownerOrRoles(['admin', 'support'], 'user_id'),
 *     address: ownerOrRoles(['admin'], 'user_id')
 *   }
 * };
 * ```
 */
export function ownerOrRoles(roles: string[], ownerField = 'id'): FieldAccessConfig {
  return {
    read: ctx => {
      const rowValue = (ctx.row as Record<string, unknown>)?.[ownerField]
      return String(ctx.auth.userId) === String(rowValue) || roles.some(r => ctx.auth.roles.includes(r))
    },
    write: ctx => {
      const rowValue = (ctx.row as Record<string, unknown>)?.[ownerField]
      return String(ctx.auth.userId) === String(rowValue) || roles.some(r => ctx.auth.roles.includes(r))
    }
  }
}

/**
 * Only users with specific roles can access this field
 *
 * @param roles - Roles that can access
 *
 * @example
 * ```typescript
 * const config = {
 *   fields: {
 *     internal_notes: rolesOnly(['admin', 'moderator']),
 *     audit_log: rolesOnly(['admin'])
 *   }
 * };
 * ```
 */
export function rolesOnly(roles: string[]): FieldAccessConfig {
  return {
    read: ctx => roles.some(r => ctx.auth.roles.includes(r)),
    write: ctx => roles.some(r => ctx.auth.roles.includes(r))
  }
}

/**
 * Field is read-only (no write access)
 *
 * @param readCondition - Optional condition for read access
 *
 * @example
 * ```typescript
 * const config = {
 *   fields: {
 *     created_at: readOnly(),
 *     version: readOnly()
 *   }
 * };
 * ```
 */
export function readOnly(readCondition?: FieldAccessCondition): FieldAccessConfig {
  return {
    read: readCondition ?? (() => true),
    write: () => false
  }
}

/**
 * Field has public read access but restricted write
 *
 * @param writeCondition - Condition for write access
 *
 * @example
 * ```typescript
 * const config = {
 *   fields: {
 *     display_name: publicReadRestrictedWrite(ctx => ctx.auth.userId === ctx.row.id),
 *     bio: publicReadRestrictedWrite(ctx => ctx.auth.userId === ctx.row.id)
 *   }
 * };
 * ```
 */
export function publicReadRestrictedWrite(writeCondition: FieldAccessCondition): FieldAccessConfig {
  return {
    read: () => true,
    write: writeCondition
  }
}

/**
 * Mask field value with custom masking function
 *
 * @param maskFn - Function to mask the value
 * @param readCondition - Condition for full read access
 *
 * @example
 * ```typescript
 * const config = {
 *   fields: {
 *     email: maskedField(
 *       value => value.replace(/(.{2}).*@/, '$1***@'),
 *       ctx => ctx.auth.userId === ctx.row.id
 *     ),
 *     phone: maskedField(
 *       value => value.replace(/\d(?=\d{4})/g, '*'),
 *       ctx => ctx.auth.userId === ctx.row.id
 *     )
 *   }
 * };
 * ```
 */
export function maskedField(
  maskFn: (value: unknown) => unknown,
  readCondition: FieldAccessCondition
): FieldAccessConfig & { maskFn: (value: unknown) => unknown } {
  return {
    read: readCondition,
    write: readCondition,
    maskedValue: undefined, // Will be computed by maskFn
    maskFn
  }
}
