/**
 * Core type definitions for RLS (Row-Level Security) policies
 *
 * This module provides comprehensive type definitions for defining and evaluating
 * row-level security policies in Kysera ORM. It supports multiple policy types,
 * flexible context management, and type-safe policy definitions.
 *
 * @module @kysera/rls/policy/types
 */

import type { Kysely } from 'kysely';

// ============================================================================
// Operation Types
// ============================================================================

/**
 * Database operations that can be controlled by RLS policies
 *
 * - `read`: SELECT operations
 * - `create`: INSERT operations
 * - `update`: UPDATE operations
 * - `delete`: DELETE operations
 * - `all`: All operations (wildcard)
 *
 * @example
 * ```typescript
 * const policy: PolicyDefinition = {
 *   type: 'allow',
 *   operation: ['read', 'update'], // Multiple operations
 *   condition: (ctx) => ctx.auth.userId === ctx.row.userId
 * };
 * ```
 */
export type Operation = 'read' | 'create' | 'update' | 'delete' | 'all';

// ============================================================================
// Authentication Context
// ============================================================================

/**
 * Authentication context containing user identity and authorization information
 *
 * This context is passed to all policy evaluation functions and contains
 * information about the authenticated user, their roles, and permissions.
 *
 * @typeParam TUser - Custom user type for additional user properties
 *
 * @example
 * ```typescript
 * const authContext: RLSAuthContext = {
 *   userId: 123,
 *   roles: ['user', 'editor'],
 *   tenantId: 'acme-corp',
 *   organizationIds: ['org-1', 'org-2'],
 *   permissions: ['posts:read', 'posts:write'],
 *   isSystem: false
 * };
 * ```
 */
export interface RLSAuthContext<TUser = unknown> {
  /**
   * Unique identifier for the authenticated user
   * Can be a string or number depending on your ID strategy
   */
  userId: string | number;

  /**
   * List of roles assigned to the user
   * Used for role-based access control (RBAC)
   */
  roles: string[];

  /**
   * Optional tenant identifier for multi-tenancy
   * Use for tenant isolation in SaaS applications
   */
  tenantId?: string | number;

  /**
   * Optional list of organization IDs the user belongs to
   * Use for hierarchical multi-tenancy or organization-based access
   */
  organizationIds?: (string | number)[];

  /**
   * Optional list of granular permissions
   * Use for fine-grained access control
   */
  permissions?: string[];

  /**
   * Optional custom attributes for advanced policy logic
   * Can contain any additional context needed for policy evaluation
   */
  attributes?: Record<string, unknown>;

  /**
   * Optional full user object for accessing user properties
   * Useful when policies need to check user-specific attributes
   */
  user?: TUser;

  /**
   * Flag indicating if this is a system/admin context
   * System contexts typically bypass RLS policies
   *
   * @default false
   */
  isSystem?: boolean;
}

// ============================================================================
// Request Context
// ============================================================================

/**
 * HTTP request context for audit and policy evaluation
 *
 * Contains information about the current request, useful for logging,
 * audit trails, and IP-based or time-based access policies.
 *
 * @example
 * ```typescript
 * const requestContext: RLSRequestContext = {
 *   requestId: 'req-123abc',
 *   ipAddress: '192.168.1.100',
 *   userAgent: 'Mozilla/5.0...',
 *   timestamp: new Date(),
 *   headers: { 'x-api-key': 'secret' }
 * };
 * ```
 */
export interface RLSRequestContext {
  /**
   * Unique identifier for the request
   * Useful for tracing and debugging
   */
  requestId?: string;

  /**
   * Client IP address
   * Can be used for IP-based access policies
   */
  ipAddress?: string;

  /**
   * Client user agent string
   * Useful for device-based access policies
   */
  userAgent?: string;

  /**
   * Request timestamp
   * Required for time-based policies and audit logs
   */
  timestamp: Date;

  /**
   * HTTP headers
   * Can contain custom authentication or context headers
   */
  headers?: Record<string, string>;
}

// ============================================================================
// Complete RLS Context
// ============================================================================

/**
 * Complete RLS context containing all information for policy evaluation
 *
 * This is the main context object passed to policy functions and used
 * throughout the RLS system.
 *
 * @typeParam TUser - Custom user type
 * @typeParam TMeta - Custom metadata type for additional context
 *
 * @example
 * ```typescript
 * const rlsContext: RLSContext = {
 *   auth: {
 *     userId: 123,
 *     roles: ['user'],
 *     tenantId: 'acme-corp'
 *   },
 *   request: {
 *     requestId: 'req-123',
 *     ipAddress: '192.168.1.1',
 *     timestamp: new Date()
 *   },
 *   meta: {
 *     feature_flags: ['new_ui', 'beta_access']
 *   },
 *   timestamp: new Date()
 * };
 * ```
 */
export interface RLSContext<TUser = unknown, TMeta = unknown> {
  /**
   * Authentication context (required)
   * Contains user identity and authorization information
   */
  auth: RLSAuthContext<TUser>;

  /**
   * Request context (optional)
   * Contains HTTP request information
   */
  request?: RLSRequestContext;

  /**
   * Custom metadata (optional)
   * Can contain any additional context needed for policy evaluation
   * Examples: feature flags, A/B test groups, regional settings
   */
  meta?: TMeta;

  /**
   * Context creation timestamp
   * Used for temporal policies and audit trails
   */
  timestamp: Date;
}

// ============================================================================
// Policy Evaluation Context
// ============================================================================

/**
 * Context passed to policy evaluation functions
 *
 * This extended context includes the authentication/request context plus
 * additional information about the current row being evaluated and the
 * data being operated on.
 *
 * @typeParam TAuth - Custom user type for auth context
 * @typeParam TRow - Type of the database row being evaluated
 * @typeParam TData - Type of the data being inserted/updated
 * @typeParam TDB - Database schema type for Kysely
 *
 * @example
 * ```typescript
 * // Policy function using evaluation context
 * const ownershipPolicy = (ctx: PolicyEvaluationContext<User, Post>) => {
 *   // Check if user owns the post
 *   return ctx.auth.userId === ctx.row.authorId;
 * };
 *
 * // Filter policy using evaluation context
 * const tenantFilter = (ctx: PolicyEvaluationContext) => {
 *   return {
 *     tenant_id: ctx.auth.tenantId
 *   };
 * };
 * ```
 */
export interface PolicyEvaluationContext<
  TAuth = unknown,
  TRow = unknown,
  TData = unknown,
  TDB = unknown
> {
  /**
   * Authentication context
   * Contains user identity and authorization information
   */
  auth: RLSAuthContext<TAuth>;

  /**
   * Current row being evaluated (optional)
   * Available during read/update/delete operations
   * Used for row-level policies that check row attributes
   */
  row?: TRow;

  /**
   * Data being inserted or updated (optional)
   * Available during create/update operations
   * Used for validation policies
   */
  data?: TData;

  /**
   * Request context (optional)
   * Contains HTTP request information
   */
  request?: RLSRequestContext;

  /**
   * Kysely database instance (optional)
   * Available for policies that need to perform additional queries
   * Use sparingly as it can impact performance
   */
  db?: Kysely<TDB>;

  /**
   * Custom metadata (optional)
   * Can contain any additional context needed for policy evaluation
   */
  meta?: Record<string, unknown>;
}

// ============================================================================
// Policy Condition Types
// ============================================================================

/**
 * Policy condition function or expression
 *
 * Can be either:
 * - A function that returns a boolean (or Promise<boolean>)
 * - A string expression for native RLS (PostgreSQL)
 *
 * @typeParam TCtx - Policy evaluation context type
 *
 * @example
 * ```typescript
 * // Function-based condition
 * const condition: PolicyCondition = (ctx) => {
 *   return ctx.auth.roles.includes('admin') ||
 *          ctx.auth.userId === ctx.row.ownerId;
 * };
 *
 * // Async condition
 * const asyncCondition: PolicyCondition = async (ctx) => {
 *   const hasPermission = await checkPermission(ctx.auth.userId, 'posts:read');
 *   return hasPermission;
 * };
 *
 * // String expression for native RLS
 * const nativeCondition: PolicyCondition = 'user_id = current_user_id()';
 * ```
 */
export type PolicyCondition<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> =
  | ((ctx: TCtx) => boolean | Promise<boolean>)
  | string;

/**
 * Filter condition that returns WHERE clause conditions
 *
 * Used for filter-type policies that add WHERE conditions to queries.
 * Can be either:
 * - A function that returns an object with column-value pairs
 * - An object mapping column names to context property paths
 *
 * @typeParam TCtx - Policy evaluation context type
 *
 * @example
 * ```typescript
 * // Function-based filter
 * const filter: FilterCondition = (ctx) => ({
 *   tenant_id: ctx.auth.tenantId,
 *   deleted_at: null
 * });
 *
 * // Static filter mapping
 * const staticFilter: FilterCondition = {
 *   tenant_id: 'auth.tenantId',
 *   status: 'meta.defaultStatus'
 * };
 * ```
 */
export type FilterCondition<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> =
  | ((ctx: TCtx) => Record<string, unknown>)
  | Record<string, string>;

// ============================================================================
// Policy Types
// ============================================================================

/**
 * Policy behavior type
 *
 * - `allow`: Grants access if condition is true
 * - `deny`: Denies access if condition is true (takes precedence)
 * - `filter`: Adds WHERE conditions to automatically filter rows
 * - `validate`: Validates data during create/update operations
 *
 * @example
 * ```typescript
 * // Allow policy: grants access to owners
 * const allowPolicy: PolicyDefinition = {
 *   type: 'allow',
 *   operation: 'update',
 *   condition: (ctx) => ctx.auth.userId === ctx.row.ownerId
 * };
 *
 * // Deny policy: prevents access to deleted items
 * const denyPolicy: PolicyDefinition = {
 *   type: 'deny',
 *   operation: 'read',
 *   condition: (ctx) => ctx.row.deletedAt !== null
 * };
 *
 * // Filter policy: automatically filters by tenant
 * const filterPolicy: PolicyDefinition = {
 *   type: 'filter',
 *   operation: 'read',
 *   condition: (ctx) => ({ tenant_id: ctx.auth.tenantId })
 * };
 *
 * // Validate policy: ensures valid status transitions
 * const validatePolicy: PolicyDefinition = {
 *   type: 'validate',
 *   operation: 'update',
 *   condition: (ctx) => isValidStatusTransition(ctx.row.status, ctx.data.status)
 * };
 * ```
 */
export type PolicyType = 'allow' | 'deny' | 'filter' | 'validate';

// ============================================================================
// Policy Definition
// ============================================================================

/**
 * Policy definition for RLS enforcement
 *
 * Defines a single security policy with its behavior, operations, and conditions.
 *
 * @typeParam TOperation - Operation type(s) the policy applies to
 * @typeParam TCondition - Condition type (function or string)
 *
 * @example
 * ```typescript
 * // Basic ownership policy
 * const ownershipPolicy: PolicyDefinition = {
 *   type: 'allow',
 *   operation: ['read', 'update', 'delete'],
 *   condition: (ctx) => ctx.auth.userId === ctx.row.ownerId,
 *   name: 'ownership_policy',
 *   priority: 100
 * };
 *
 * // Native PostgreSQL RLS policy
 * const nativePolicy: PolicyDefinition = {
 *   type: 'allow',
 *   operation: 'read',
 *   condition: '',
 *   using: 'user_id = current_user_id()',
 *   withCheck: 'user_id = current_user_id()',
 *   role: 'authenticated',
 *   name: 'user_isolation'
 * };
 *
 * // Multi-tenancy filter
 * const tenantFilter: PolicyDefinition = {
 *   type: 'filter',
 *   operation: 'read',
 *   condition: (ctx) => ({ tenant_id: ctx.auth.tenantId }),
 *   name: 'tenant_isolation',
 *   priority: 1000 // High priority for tenant isolation
 * };
 * ```
 */
export interface PolicyDefinition<
  TOperation extends Operation = Operation,
  TCondition = PolicyCondition
> {
  /**
   * Policy behavior type
   * Determines how the policy affects access control
   */
  type: PolicyType;

  /**
   * Operation(s) this policy applies to
   * Can be a single operation or an array of operations
   */
  operation: TOperation | TOperation[];

  /**
   * Condition function or expression
   * - For 'allow'/'deny'/'validate': returns boolean
   * - For 'filter': returns WHERE conditions object
   * - For native RLS: SQL expression string
   */
  condition: TCondition;

  /**
   * Optional policy name for debugging and logging
   * Recommended for easier policy management
   */
  name?: string;

  /**
   * Optional priority for policy evaluation order
   * Higher priority policies are evaluated first
   * Deny policies typically have higher priority
   *
   * @default 0
   */
  priority?: number;

  /**
   * Optional SQL expression for native RLS USING clause
   * PostgreSQL only - used for row visibility checks
   *
   * @example 'user_id = current_user_id()'
   */
  using?: string;

  /**
   * Optional SQL expression for native RLS WITH CHECK clause
   * PostgreSQL only - used for insert/update validation
   *
   * @example 'tenant_id = current_tenant_id()'
   */
  withCheck?: string;

  /**
   * Optional database role this policy applies to
   * PostgreSQL only - restricts policy to specific roles
   *
   * @example 'authenticated'
   */
  role?: string;

  /**
   * Optional performance optimization hints
   * Used for query optimization and index suggestions
   */
  hints?: PolicyHints;
}

// ============================================================================
// Table Configuration
// ============================================================================

/**
 * RLS configuration for a single database table
 *
 * Defines all policies and settings for row-level security on a table.
 *
 * @example
 * ```typescript
 * const postsConfig: TableRLSConfig = {
 *   policies: [
 *     {
 *       type: 'filter',
 *       operation: 'read',
 *       condition: (ctx) => ({ tenant_id: ctx.auth.tenantId }),
 *       name: 'tenant_isolation',
 *       priority: 1000
 *     },
 *     {
 *       type: 'allow',
 *       operation: ['update', 'delete'],
 *       condition: (ctx) => ctx.auth.userId === ctx.row.authorId,
 *       name: 'author_access'
 *     }
 *   ],
 *   defaultDeny: true,
 *   skipFor: ['system', 'admin']
 * };
 * ```
 */
export interface TableRLSConfig {
  /**
   * List of policies to enforce on this table
   * Policies are evaluated in priority order (highest first)
   */
  policies: PolicyDefinition[];

  /**
   * Default behavior when no policies match
   * - true: Deny access by default (secure default)
   * - false: Allow access by default (open default)
   *
   * @default true
   */
  defaultDeny?: boolean;

  /**
   * List of roles that bypass RLS policies
   * Useful for system operations or admin accounts
   *
   * @example ['system', 'admin', 'superuser']
   */
  skipFor?: string[];
}

// ============================================================================
// Complete Schema
// ============================================================================

/**
 * Complete RLS schema for all tables in the database
 *
 * Maps table names to their RLS configurations.
 *
 * @typeParam DB - Database schema type (Kysely DB type)
 *
 * @example
 * ```typescript
 * interface Database {
 *   posts: Post;
 *   comments: Comment;
 *   users: User;
 * }
 *
 * const rlsSchema: RLSSchema<Database> = {
 *   posts: {
 *     policies: [
 *       {
 *         type: 'filter',
 *         operation: 'read',
 *         condition: (ctx) => ({ tenant_id: ctx.auth.tenantId })
 *       }
 *     ],
 *     defaultDeny: true
 *   },
 *   comments: {
 *     policies: [
 *       {
 *         type: 'allow',
 *         operation: 'all',
 *         condition: (ctx) => ctx.auth.roles.includes('moderator')
 *       }
 *     ]
 *   }
 * };
 * ```
 */
export type RLSSchema<DB> = {
  [K in keyof DB]?: TableRLSConfig;
};

// ============================================================================
// Compiled Policies
// ============================================================================

/**
 * Compiled policy ready for runtime evaluation
 *
 * Internal representation of a policy after compilation and optimization.
 *
 * @typeParam TCtx - Policy evaluation context type
 */
export interface CompiledPolicy<TCtx = PolicyEvaluationContext> {
  /**
   * Policy behavior type
   */
  type: PolicyType;

  /**
   * Operations this policy applies to
   * Always an array after compilation
   */
  operation: Operation[];

  /**
   * Compiled evaluation function
   * Returns boolean or Promise<boolean>
   */
  evaluate: (ctx: TCtx) => boolean | Promise<boolean>;

  /**
   * Policy name for debugging
   */
  name: string;

  /**
   * Priority for evaluation order
   */
  priority: number;
}

/**
 * Compiled filter policy for query transformation
 *
 * Specialized compiled policy type for filter operations.
 *
 * @typeParam TCtx - Policy evaluation context type
 */
export interface CompiledFilterPolicy<TCtx = PolicyEvaluationContext> {
  /**
   * Always 'read' for filter policies
   */
  operation: 'read';

  /**
   * Function to get WHERE conditions
   * Returns object with column-value pairs
   */
  getConditions: (ctx: TCtx) => Record<string, unknown>;

  /**
   * Policy name for debugging
   */
  name: string;
}

// ============================================================================
// Policy Optimization Hints
// ============================================================================

/**
 * Optimization hints for policy execution
 *
 * Provides metadata to help optimize policy evaluation and query generation.
 * These hints can be used by query optimizers and execution planners.
 *
 * @example
 * ```typescript
 * const hints: PolicyHints = {
 *   indexColumns: ['tenant_id', 'user_id'],
 *   selectivity: 'high',
 *   leakproof: true,
 *   stable: true
 * };
 * ```
 */
export interface PolicyHints {
  /**
   * Columns that should be indexed for optimal performance
   * Suggests which columns are frequently used in policy conditions
   */
  indexColumns?: string[];

  /**
   * Expected selectivity of the policy
   * - 'high': Filters out most rows (good for early evaluation)
   * - 'medium': Filters moderate number of rows
   * - 'low': Filters few rows (evaluate later)
   */
  selectivity?: 'high' | 'medium' | 'low';

  /**
   * Whether the policy is leakproof (PostgreSQL concept)
   * Leakproof functions don't reveal information about their inputs
   * Safe to execute before other security checks
   */
  leakproof?: boolean;

  /**
   * Whether the policy result is stable for the same inputs
   * Stable policies can be cached during a query execution
   */
  stable?: boolean;
}
