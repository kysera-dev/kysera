/**
 * @kysera/rls - Row-Level Security Plugin for Kysera ORM
 *
 * Provides declarative policy definition, automatic query transformation,
 * and optional native PostgreSQL RLS generation.
 *
 * @packageDocumentation
 */

// ============================================================================
// Policy Definition
// ============================================================================

// Schema definition
export { defineRLSSchema, mergeRLSSchemas } from './policy/schema.js';

// Policy builders
export { allow, deny, filter, validate, type PolicyOptions } from './policy/builder.js';

// Policy registry (for advanced use cases)
export { PolicyRegistry } from './policy/registry.js';

// ============================================================================
// Plugin
// ============================================================================

export { rlsPlugin } from './plugin.js';
export type { RLSPluginOptions } from './plugin.js';

// ============================================================================
// Context Management
// ============================================================================

export {
  rlsContext,
  createRLSContext,
  withRLSContext,
  withRLSContextAsync,
  type CreateRLSContextOptions,
} from './context/index.js';

// ============================================================================
// Types
// ============================================================================

export type {
  // Core types
  Operation,
  PolicyType,
  PolicyDefinition,
  PolicyCondition,
  FilterCondition,
  PolicyHints,

  // Schema types
  RLSSchema,
  TableRLSConfig,

  // Context types
  RLSContext,
  RLSAuthContext,
  RLSRequestContext,

  // Evaluation types
  PolicyEvaluationContext,
  CompiledPolicy,
  CompiledFilterPolicy,
} from './policy/types.js';

// ============================================================================
// Errors
// ============================================================================

export {
  RLSError,
  RLSContextError,
  RLSPolicyViolation,
  RLSSchemaError,
  RLSContextValidationError,
  RLSErrorCodes,
  type RLSErrorCode,
} from './errors.js';

// ============================================================================
// Utilities
// ============================================================================

export {
  createEvaluationContext,
  normalizeOperations,
  isAsyncFunction,
  safeEvaluate,
  deepMerge,
  hashString,
} from './utils/index.js';
