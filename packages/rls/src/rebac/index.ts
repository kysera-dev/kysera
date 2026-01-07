/**
 * ReBAC (Relationship-Based Access Control) Module
 *
 * Provides relationship-based filtering for RLS policies.
 *
 * @module @kysera/rls/rebac
 */

// Types
export type {
  RelationshipStep,
  RelationshipPath,
  RelationshipCondition,
  ReBAcPolicyDefinition,
  TableReBAcConfig,
  ReBAcSchema,
  CompiledRelationshipPath,
  CompiledReBAcPolicy,
  ReBAcSubquery,
  ReBAcQueryOptions
} from './types.js'

// Predefined path patterns
export { orgMembershipPath, shopOrgMembershipPath, teamHierarchyPath } from './types.js'

// Registry
export { ReBAcRegistry, createReBAcRegistry } from './registry.js'

// Transformer
export { ReBAcTransformer, createReBAcTransformer, allowRelation, denyRelation } from './transformer.js'
