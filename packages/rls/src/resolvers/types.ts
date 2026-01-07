/**
 * Context Resolver Types
 *
 * Provides infrastructure for pre-resolving async data before RLS policy evaluation.
 * This allows synchronous filters to access data that would otherwise require async lookups.
 *
 * @module @kysera/rls/resolvers/types
 */

import type { RLSAuthContext, RLSContext } from '../policy/types.js'

// ============================================================================
// Resolved Data Types
// ============================================================================

/**
 * Base interface for resolved data that can be added to RLS context
 *
 * @example
 * ```typescript
 * interface MyResolvedData extends ResolvedData {
 *   organizationIds: string[];
 *   permissions: Set<string>;
 *   employeeRoles: Map<string, string[]>;
 * }
 * ```
 */
export interface ResolvedData {
  /**
   * Timestamp when data was resolved
   * Used for cache validation
   */
  resolvedAt: Date

  /**
   * Cache key used for this resolution (if cached)
   */
  cacheKey?: string
}

/**
 * Extended auth context with pre-resolved data
 *
 * @typeParam TUser - Custom user type
 * @typeParam TResolved - Type of pre-resolved data
 *
 * @example
 * ```typescript
 * interface OrgPermissions extends ResolvedData {
 *   organizationIds: string[];
 *   orgPermissions: Map<string, Set<string>>;
 *   isOrgOwner: (orgId: string) => boolean;
 *   hasOrgPermission: (orgId: string, permission: string) => boolean;
 * }
 *
 * type EnhancedAuth = EnhancedRLSAuthContext<User, OrgPermissions>;
 *
 * // Use in policy
 * filter('read', ctx => ({
 *   organization_id: ctx.auth.resolved.organizationIds
 * }));
 * ```
 */
export interface EnhancedRLSAuthContext<TUser = unknown, TResolved extends ResolvedData = ResolvedData>
  extends RLSAuthContext<TUser> {
  /**
   * Pre-resolved data available synchronously in policies
   *
   * This data is populated by ContextResolvers before entering the RLS context.
   * Use this for async data lookups that policies need synchronously.
   */
  resolved: TResolved
}

/**
 * Extended RLS context with enhanced auth containing resolved data
 *
 * @typeParam TUser - Custom user type
 * @typeParam TResolved - Type of pre-resolved data
 * @typeParam TMeta - Custom metadata type
 */
export interface EnhancedRLSContext<
  TUser = unknown,
  TResolved extends ResolvedData = ResolvedData,
  TMeta = unknown
> extends Omit<RLSContext<TUser, TMeta>, 'auth'> {
  auth: EnhancedRLSAuthContext<TUser, TResolved>
}

// ============================================================================
// Context Resolver Interface
// ============================================================================

/**
 * Base context for resolver input (before resolution)
 */
export interface BaseResolverContext {
  auth: {
    userId: string | number
    roles: string[]
    tenantId?: string | number
    organizationIds?: (string | number)[]
    permissions?: string[]
    attributes?: Record<string, unknown>
    isSystem?: boolean
  }
  timestamp: Date
  meta?: unknown
}

/**
 * Context resolver that enriches base context with pre-resolved data
 *
 * Resolvers are responsible for fetching async data and making it available
 * synchronously in policy evaluation contexts.
 *
 * @typeParam TResolved - Type of resolved data this resolver produces
 *
 * @example
 * ```typescript
 * const orgPermissionResolver: ContextResolver<OrgPermissions> = {
 *   name: 'org-permissions',
 *
 *   async resolve(base) {
 *     const employments = await db.selectFrom('employees')
 *       .where('user_id', '=', base.auth.userId)
 *       .where('status', '=', 'active')
 *       .execute();
 *
 *     const orgPermissions = new Map<string, Set<string>>();
 *     // ... resolve permissions ...
 *
 *     return {
 *       resolvedAt: new Date(),
 *       organizationIds: employments.map(e => e.organization_id),
 *       orgPermissions,
 *       isOrgOwner: (orgId) => employments.some(e => e.organization_id === orgId && e.is_owner),
 *       hasOrgPermission: (orgId, permission) => {
 *         const perms = orgPermissions.get(orgId);
 *         return perms?.has('*') || perms?.has(permission) || false;
 *       }
 *     };
 *   },
 *
 *   cacheKey: (base) => `rls:org-perms:${base.auth.userId}`,
 *   cacheTtl: 300 // 5 minutes
 * };
 * ```
 */
export interface ContextResolver<TResolved extends ResolvedData = ResolvedData> {
  /**
   * Unique name for this resolver
   * Used for logging and debugging
   */
  name: string

  /**
   * Resolve async data for the context
   *
   * @param base - Base context with user info
   * @returns Pre-resolved data to be added to context
   */
  resolve(base: BaseResolverContext): Promise<TResolved>

  /**
   * Generate cache key for this context
   * Return undefined to disable caching for this resolver
   *
   * @param base - Base context
   * @returns Cache key string or undefined
   */
  cacheKey?(base: BaseResolverContext): string | undefined

  /**
   * Cache TTL in seconds
   * @default 300 (5 minutes)
   */
  cacheTtl?: number

  /**
   * Whether this resolver is required
   * If true, resolution failure will throw an error
   * If false, the resolver will be skipped on failure
   *
   * @default true
   */
  required?: boolean

  /**
   * Dependencies on other resolvers (by name)
   * This resolver will wait for dependencies to complete first
   */
  dependsOn?: string[]

  /**
   * Priority for resolver execution order (higher = earlier)
   * @default 0
   */
  priority?: number
}

/**
 * Combined result of multiple resolvers
 *
 * @typeParam T - Union type of all resolved data types
 */
export interface CompositeResolvedData<T extends Record<string, ResolvedData>> extends ResolvedData {
  /**
   * Individual resolver results keyed by resolver name
   */
  resolvers: T
}

// ============================================================================
// Resolver Manager Options
// ============================================================================

/**
 * Cache provider interface for storing resolved context data
 */
export interface ResolverCacheProvider {
  /**
   * Get cached data
   * @param key - Cache key
   * @returns Cached data or null if not found/expired
   */
  get<T>(key: string): Promise<T | null>

  /**
   * Set cached data
   * @param key - Cache key
   * @param value - Data to cache
   * @param ttlSeconds - Time to live in seconds
   */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>

  /**
   * Delete cached data
   * @param key - Cache key
   */
  delete(key: string): Promise<void>

  /**
   * Delete all cached data matching a pattern
   * @param pattern - Pattern to match (e.g., "rls:org-perms:*")
   */
  deletePattern?(pattern: string): Promise<void>
}

/**
 * In-memory cache provider implementation
 *
 * Suitable for single-instance deployments or testing.
 * For distributed systems, use a Redis-based provider.
 */
export class InMemoryCacheProvider implements ResolverCacheProvider {
  private cache = new Map<string, { value: unknown; expiresAt: number }>()

  get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key)
    if (!entry) return Promise.resolve(null)
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return Promise.resolve(null)
    }
    return Promise.resolve(entry.value as T)
  }

  set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    })
    return Promise.resolve()
  }

  delete(key: string): Promise<void> {
    this.cache.delete(key)
    return Promise.resolve()
  }

  deletePattern(pattern: string): Promise<void> {
    // Simple pattern matching: * at end matches any suffix
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
      }
    }
    return Promise.resolve()
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size
  }
}

/**
 * Options for ResolverManager
 */
export interface ResolverManagerOptions {
  /**
   * Cache provider for storing resolved data
   * @default InMemoryCacheProvider
   */
  cacheProvider?: ResolverCacheProvider

  /**
   * Default cache TTL in seconds
   * @default 300 (5 minutes)
   */
  defaultCacheTtl?: number

  /**
   * Whether to run resolvers in parallel when possible
   * @default true
   */
  parallelResolution?: boolean

  /**
   * Maximum time (ms) to wait for a single resolver
   * @default 5000 (5 seconds)
   */
  resolverTimeout?: number

  /**
   * Logger for resolver operations
   */
  logger?: {
    debug?: (message: string, context?: Record<string, unknown>) => void
    info?: (message: string, context?: Record<string, unknown>) => void
    warn?: (message: string, context?: Record<string, unknown>) => void
    error?: (message: string, context?: Record<string, unknown>) => void
  }
}

// ============================================================================
// Common Resolved Data Patterns
// ============================================================================

/**
 * Common resolved data for organization-based permissions
 *
 * Pre-built pattern for multi-organization systems where users can
 * belong to multiple organizations with different roles/permissions.
 */
export interface OrganizationResolvedData extends ResolvedData {
  /**
   * List of organization IDs the user belongs to
   */
  organizationIds: (string | number)[]

  /**
   * Map of organization ID to user's permissions in that org
   */
  orgPermissions: Map<string | number, Set<string>>

  /**
   * Map of organization ID to user's roles in that org
   */
  orgRoles: Map<string | number, string[]>

  /**
   * Check if user is owner of an organization
   * @param orgId - Organization ID
   */
  isOrgOwner(orgId: string | number): boolean

  /**
   * Check if user has a specific permission in an organization
   * @param orgId - Organization ID
   * @param permission - Permission to check
   */
  hasOrgPermission(orgId: string | number, permission: string): boolean

  /**
   * Check if user has a specific role in an organization
   * @param orgId - Organization ID
   * @param role - Role to check
   */
  hasOrgRole(orgId: string | number, role: string): boolean
}

/**
 * Common resolved data for tenant-based systems
 */
export interface TenantResolvedData extends ResolvedData {
  /**
   * Current tenant ID (resolved from user context)
   */
  tenantId: string | number

  /**
   * Tenant-specific settings/restrictions
   */
  tenantSettings?: Record<string, unknown>

  /**
   * Tenant-specific feature flags
   */
  tenantFeatures?: Set<string>
}

/**
 * Common resolved data for hierarchical permissions
 *
 * For systems with resource hierarchies (e.g., team -> project -> task)
 */
export interface HierarchyResolvedData extends ResolvedData {
  /**
   * Resources the user has direct access to
   */
  directAccess: Set<string>

  /**
   * Resources the user has inherited access to (through hierarchy)
   */
  inheritedAccess: Set<string>

  /**
   * Check if user can access a resource (direct or inherited)
   * @param resourceId - Resource ID
   */
  canAccess(resourceId: string): boolean

  /**
   * Get the access level for a resource
   * @param resourceId - Resource ID
   * @returns Access level or null if no access
   */
  getAccessLevel(resourceId: string): string | null
}

/**
 * Combined resolved data type for common use cases
 */
export type CommonResolvedData = OrganizationResolvedData & TenantResolvedData
