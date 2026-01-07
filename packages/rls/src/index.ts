/**
 * @kysera/rls - Row-Level Security Plugin for Kysera
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
export { defineRLSSchema, mergeRLSSchemas } from './policy/schema.js'

// Policy builders
export {
  allow,
  deny,
  filter,
  validate,
  whenEnvironment,
  whenFeature,
  whenTimeRange,
  whenCondition,
  type PolicyOptions
} from './policy/builder.js'

// Policy registry (for advanced use cases)
export { PolicyRegistry } from './policy/registry.js'

// ============================================================================
// Plugin
// ============================================================================

export { rlsPlugin, RLSPluginOptionsSchema } from './plugin.js'
export type { RLSPluginOptions } from './plugin.js'

// ============================================================================
// Context Management
// ============================================================================

export {
  rlsContext,
  createRLSContext,
  withRLSContext,
  withRLSContextAsync,
  type CreateRLSContextOptions
} from './context/index.js'

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

  // Conditional activation types
  PolicyActivationContext,
  PolicyActivationCondition,
  ConditionalPolicyDefinition
} from './policy/types.js'

// ============================================================================
// Errors
// ============================================================================

export {
  RLSError,
  RLSContextError,
  RLSPolicyViolation,
  RLSPolicyEvaluationError,
  RLSSchemaError,
  RLSContextValidationError,
  RLSErrorCodes,
  type RLSErrorCode
} from './errors.js'

// ============================================================================
// Utilities
// ============================================================================

export {
  createEvaluationContext,
  normalizeOperations,
  isAsyncFunction,
  safeEvaluate,
  deepMerge,
  hashString
} from './utils/index.js'

// ============================================================================
// Context Resolvers (Phase 1)
// ============================================================================

export {
  // Types
  type ResolvedData,
  type EnhancedRLSAuthContext,
  type EnhancedRLSContext,
  type BaseResolverContext,
  type ContextResolver,
  type CompositeResolvedData,
  type ResolverCacheProvider,
  type ResolverManagerOptions,
  type OrganizationResolvedData,
  type TenantResolvedData,
  type HierarchyResolvedData,
  type CommonResolvedData,
  // Classes
  InMemoryCacheProvider,
  ResolverManager,
  // Factory functions
  createResolverManager,
  createResolver
} from './resolvers/index.js'

// ============================================================================
// ReBAC (Relationship-Based Access Control) (Phase 1)
// ============================================================================

export {
  // Types
  type RelationshipStep,
  type RelationshipPath,
  type RelationshipCondition,
  type ReBAcPolicyDefinition,
  type TableReBAcConfig,
  type ReBAcSchema,
  type CompiledRelationshipPath,
  type CompiledReBAcPolicy,
  type ReBAcSubquery,
  type ReBAcQueryOptions,
  // Predefined patterns
  orgMembershipPath,
  shopOrgMembershipPath,
  teamHierarchyPath,
  // Registry
  ReBAcRegistry,
  createReBAcRegistry,
  // Transformer
  ReBAcTransformer,
  createReBAcTransformer,
  allowRelation,
  denyRelation
} from './rebac/index.js'

// ============================================================================
// Field-Level Access Control (Phase 2)
// ============================================================================

export {
  // Types
  type FieldOperation,
  type FieldAccessCondition,
  type FieldAccessConfig,
  type TableFieldAccessConfig,
  type FieldAccessSchema,
  type CompiledFieldAccess,
  type CompiledTableFieldAccess,
  type FieldAccessResult,
  type MaskedRow,
  type FieldAccessOptions,
  // Predefined patterns
  neverAccessible,
  ownerOnly,
  ownerOrRoles,
  rolesOnly,
  readOnly,
  publicReadRestrictedWrite,
  maskedField,
  // Registry
  FieldAccessRegistry,
  createFieldAccessRegistry,
  // Processor
  FieldAccessProcessor,
  createFieldAccessProcessor
} from './field-access/index.js'

// ============================================================================
// Policy Composition (Phase 2)
// ============================================================================

export {
  // Types
  type ReusablePolicy,
  type ReusablePolicyConfig,
  type ComposableTableConfig,
  type ComposableRLSSchema,
  type BasePolicyDefinition,
  type ResolvedInheritance,
  type TenantIsolationConfig,
  type OwnershipConfig,
  type SoftDeleteConfig,
  type StatusAccessConfig,
  // Builders
  definePolicy,
  defineFilterPolicy,
  defineAllowPolicy,
  defineDenyPolicy,
  defineValidatePolicy,
  defineCombinedPolicy,
  // Common patterns
  createTenantIsolationPolicy,
  createOwnershipPolicy,
  createSoftDeletePolicy,
  createStatusAccessPolicy,
  createAdminPolicy,
  // Composition functions
  composePolicies,
  extendPolicy,
  overridePolicy
} from './composition/index.js'

// ============================================================================
// Audit Trail (Phase 2)
// ============================================================================

export {
  // Types
  type AuditDecision,
  type RLSAuditEvent,
  type RLSAuditAdapter,
  type TableAuditConfig,
  type AuditConfig,
  type AuditQueryParams,
  type AuditStats,
  type ConsoleAuditAdapterOptions,
  // Adapters
  ConsoleAuditAdapter,
  InMemoryAuditAdapter,
  // Logger
  AuditLogger,
  createAuditLogger
} from './audit/index.js'

// ============================================================================
// Testing Utilities (Phase 3)
// ============================================================================

export {
  // Types
  type PolicyEvaluationResult,
  type FilterEvaluationResult,
  type TestContext,
  // Tester
  PolicyTester,
  createPolicyTester,
  // Helpers
  createTestAuthContext,
  createTestRow,
  policyAssertions
} from './testing/index.js'
