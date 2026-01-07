/**
 * ReBAC (Relationship-Based Access Control) Types
 *
 * Provides type definitions for relationship-based filtering in RLS policies.
 * ReBAC allows policies to be defined based on relationships between entities
 * in the database, enabling complex access control patterns like
 * "show products if user is employee of product's shop's organization".
 *
 * @module @kysera/rls/rebac/types
 */

import type { PolicyEvaluationContext, PolicyDefinition } from '../policy/types.js'

// ============================================================================
// Relationship Definition Types
// ============================================================================

/**
 * A single step in a relationship path
 *
 * Defines how to join from one table to another.
 *
 * @example
 * ```typescript
 * // Simple join: products.shop_id -> shops.id
 * const step: RelationshipStep = {
 *   from: 'products',
 *   to: 'shops',
 *   fromColumn: 'shop_id',
 *   toColumn: 'id'
 * };
 * ```
 */
export interface RelationshipStep {
  /**
   * Source table name
   */
  from: string

  /**
   * Target table name
   */
  to: string

  /**
   * Column in source table for the join
   * @default 'id' on target table side, '{to}_id' on source side
   */
  fromColumn?: string

  /**
   * Column in target table for the join
   * @default 'id'
   */
  toColumn?: string

  /**
   * Optional alias for the target table in the join
   * Useful when joining the same table multiple times
   */
  alias?: string

  /**
   * Join type
   * @default 'inner'
   */
  joinType?: 'inner' | 'left' | 'right'

  /**
   * Additional conditions for this join step
   * @example { 'shops.deleted_at': null, 'shops.status': 'active' }
   */
  additionalConditions?: Record<string, unknown>
}

/**
 * Complete relationship path definition
 *
 * Defines a chain of relationships from a source table to a target.
 *
 * @example
 * ```typescript
 * // Path: products -> shops -> organizations -> employees
 * const path: RelationshipPath = {
 *   name: 'orgEmployee',
 *   steps: [
 *     { from: 'products', to: 'shops', fromColumn: 'shop_id' },
 *     { from: 'shops', to: 'organizations', fromColumn: 'organization_id' },
 *     { from: 'organizations', to: 'employees', toColumn: 'organization_id' }
 *   ]
 * };
 * ```
 */
export interface RelationshipPath {
  /**
   * Unique name for this relationship path
   * Used in policy definitions to reference this path
   */
  name: string

  /**
   * Steps in the relationship chain
   */
  steps: RelationshipStep[]

  /**
   * Optional description for documentation
   */
  description?: string
}

/**
 * Condition to apply at the end of a relationship path
 *
 * @typeParam TCtx - Policy evaluation context type
 */
export type RelationshipCondition<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> =
  | ((ctx: TCtx) => Record<string, unknown>)
  | Record<string, unknown>

/**
 * ReBAC policy definition
 *
 * Extends standard policy definition with relationship-based filtering.
 */
export interface ReBAcPolicyDefinition<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext>
  extends Omit<PolicyDefinition, 'condition'> {
  /**
   * Name of the relationship path to use (defined in relationships config)
   */
  relationshipPath: string

  /**
   * Conditions to apply at the end of the relationship
   * These conditions filter the final table in the relationship chain.
   *
   * @example
   * ```typescript
   * // Filter employees table at end of relationship
   * endCondition: ctx => ({
   *   user_id: ctx.auth.userId,
   *   status: 'active'
   * })
   * ```
   */
  endCondition: RelationshipCondition<TCtx>

  /**
   * Whether this is a permissive or restrictive policy
   * - 'allow': Row is accessible if relationship exists
   * - 'deny': Row is NOT accessible if relationship exists
   * @default 'allow'
   */
  policyType?: 'allow' | 'deny'
}

// ============================================================================
// Table ReBAC Configuration
// ============================================================================

/**
 * ReBAC configuration for a single table
 */
export interface TableReBAcConfig {
  /**
   * Relationship paths available for this table
   */
  relationships: RelationshipPath[]

  /**
   * ReBAC policies for this table
   */
  policies: ReBAcPolicyDefinition[]
}

/**
 * Complete ReBAC schema for all tables
 *
 * @typeParam DB - Database schema type
 */
export type ReBAcSchema<DB> = {
  [K in keyof DB]?: TableReBAcConfig
}

// ============================================================================
// Compiled ReBAC Types
// ============================================================================

/**
 * Compiled relationship path ready for query generation
 */
export interface CompiledRelationshipPath {
  /**
   * Path name
   */
  name: string

  /**
   * Compiled join steps with defaults filled in
   */
  steps: Required<RelationshipStep>[]

  /**
   * Source table (first table in the chain)
   */
  sourceTable: string

  /**
   * Target table (final table in the chain)
   */
  targetTable: string
}

/**
 * Compiled ReBAC policy ready for evaluation
 */
export interface CompiledReBAcPolicy<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> {
  /**
   * Policy name
   */
  name: string

  /**
   * Policy type (allow/deny)
   */
  type: 'allow' | 'deny'

  /**
   * Operations this policy applies to
   */
  operations: Set<string>

  /**
   * Compiled relationship path
   */
  relationshipPath: CompiledRelationshipPath

  /**
   * Function to get end conditions
   */
  getEndConditions: (ctx: TCtx) => Record<string, unknown>

  /**
   * Priority for policy evaluation
   */
  priority: number
}

// ============================================================================
// Query Generation Types
// ============================================================================

/**
 * Generated EXISTS subquery for ReBAC filtering
 */
export interface ReBAcSubquery {
  /**
   * SQL for the EXISTS subquery
   */
  sql: string

  /**
   * Parameter values for the subquery
   */
  parameters: unknown[]

  /**
   * Whether this is an allow (EXISTS) or deny (NOT EXISTS) check
   */
  isNegated: boolean
}

/**
 * Options for ReBAC query generation
 */
export interface ReBAcQueryOptions {
  /**
   * Table alias for the main query table
   * @default table name
   */
  mainTableAlias?: string

  /**
   * Whether to use qualified column names
   * @default true
   */
  qualifyColumns?: boolean

  /**
   * Database dialect for query generation
   * @default 'postgres'
   */
  dialect?: 'postgres' | 'mysql' | 'sqlite'
}

// ============================================================================
// Predefined Relationship Patterns
// ============================================================================

/**
 * Common relationship pattern: Resource belongs to organization via owner
 *
 * @param resourceTable - Table containing the resource
 * @param organizationColumn - Column linking to organization
 *
 * @example
 * ```typescript
 * const path = orgMembershipPath('products', 'organization_id');
 * // Creates path: products -> organizations -> employees
 * ```
 */
export function orgMembershipPath(
  resourceTable: string,
  organizationColumn = 'organization_id'
): RelationshipPath {
  return {
    name: `${resourceTable}_org_membership`,
    description: `Access ${resourceTable} through organization membership`,
    steps: [
      {
        from: resourceTable,
        to: 'organizations',
        fromColumn: organizationColumn,
        toColumn: 'id'
      },
      {
        from: 'organizations',
        to: 'employees',
        fromColumn: 'id',
        toColumn: 'organization_id'
      }
    ]
  }
}

/**
 * Common relationship pattern: Resource belongs to shop's organization
 *
 * @param resourceTable - Table containing the resource
 * @param shopColumn - Column linking to shop
 *
 * @example
 * ```typescript
 * const path = shopOrgMembershipPath('products', 'shop_id');
 * // Creates path: products -> shops -> organizations -> employees
 * ```
 */
export function shopOrgMembershipPath(
  resourceTable: string,
  shopColumn = 'shop_id'
): RelationshipPath {
  return {
    name: `${resourceTable}_shop_org_membership`,
    description: `Access ${resourceTable} through shop's organization membership`,
    steps: [
      {
        from: resourceTable,
        to: 'shops',
        fromColumn: shopColumn,
        toColumn: 'id'
      },
      {
        from: 'shops',
        to: 'organizations',
        fromColumn: 'organization_id',
        toColumn: 'id'
      },
      {
        from: 'organizations',
        to: 'employees',
        fromColumn: 'id',
        toColumn: 'organization_id'
      }
    ]
  }
}

/**
 * Common relationship pattern: Hierarchical team access
 *
 * @param resourceTable - Table containing the resource
 * @param teamColumn - Column linking to team
 *
 * @example
 * ```typescript
 * const path = teamHierarchyPath('tasks', 'team_id');
 * // Creates path: tasks -> teams -> team_members
 * ```
 */
export function teamHierarchyPath(
  resourceTable: string,
  teamColumn = 'team_id'
): RelationshipPath {
  return {
    name: `${resourceTable}_team_access`,
    description: `Access ${resourceTable} through team membership`,
    steps: [
      {
        from: resourceTable,
        to: 'teams',
        fromColumn: teamColumn,
        toColumn: 'id'
      },
      {
        from: 'teams',
        to: 'team_members',
        fromColumn: 'id',
        toColumn: 'team_id'
      }
    ]
  }
}
