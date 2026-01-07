/**
 * Field-Level Access Control Module
 *
 * Provides field-level security for controlling access to individual columns.
 *
 * @module @kysera/rls/field-access
 */

// Types
export type {
  FieldOperation,
  FieldAccessCondition,
  FieldAccessConfig,
  TableFieldAccessConfig,
  FieldAccessSchema,
  CompiledFieldAccess,
  CompiledTableFieldAccess,
  FieldAccessResult,
  MaskedRow,
  FieldAccessOptions
} from './types.js'

// Predefined patterns
export {
  neverAccessible,
  ownerOnly,
  ownerOrRoles,
  rolesOnly,
  readOnly,
  publicReadRestrictedWrite,
  maskedField
} from './types.js'

// Registry
export { FieldAccessRegistry, createFieldAccessRegistry } from './registry.js'

// Processor
export { FieldAccessProcessor, createFieldAccessProcessor } from './processor.js'
