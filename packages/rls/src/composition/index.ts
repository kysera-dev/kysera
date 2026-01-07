/**
 * Policy Composition Module
 *
 * Provides tools for creating reusable, composable RLS policies.
 *
 * @module @kysera/rls/composition
 */

// Types
export type {
  ReusablePolicy,
  ReusablePolicyConfig,
  ComposableTableConfig,
  ComposableRLSSchema,
  BasePolicyDefinition,
  ResolvedInheritance,
  TenantIsolationConfig,
  OwnershipConfig,
  SoftDeleteConfig,
  StatusAccessConfig
} from './types.js'

// Builders
export {
  definePolicy,
  defineFilterPolicy,
  defineAllowPolicy,
  defineDenyPolicy,
  defineValidatePolicy,
  defineCombinedPolicy
} from './builder.js'

// Common patterns
export {
  createTenantIsolationPolicy,
  createOwnershipPolicy,
  createSoftDeletePolicy,
  createStatusAccessPolicy,
  createAdminPolicy
} from './builder.js'

// Composition functions
export { composePolicies, extendPolicy, overridePolicy } from './builder.js'
