/**
 * Context Resolver Manager
 *
 * Orchestrates the resolution of context data from multiple resolvers,
 * handling caching, dependencies, and parallel execution.
 *
 * @module @kysera/rls/resolvers/manager
 */

import type {
  ContextResolver,
  ResolvedData,
  BaseResolverContext,
  ResolverManagerOptions,
  ResolverCacheProvider,
  EnhancedRLSContext
} from './types.js'
import { InMemoryCacheProvider } from './types.js'
import { RLSError, RLSErrorCodes } from '../errors.js'

// ============================================================================
// Resolver Manager
// ============================================================================

/**
 * Manages context resolvers and orchestrates context resolution
 *
 * The ResolverManager is responsible for:
 * - Registering and organizing resolvers
 * - Resolving context data in the correct order (respecting dependencies)
 * - Caching resolved data
 * - Handling resolver failures
 *
 * @example
 * ```typescript
 * const manager = new ResolverManager({
 *   cacheProvider: new RedisCacheProvider(redis),
 *   defaultCacheTtl: 300,
 *   parallelResolution: true
 * });
 *
 * // Register resolvers
 * manager.register(orgPermissionResolver);
 * manager.register(tenantSettingsResolver);
 *
 * // Resolve context
 * const enhancedCtx = await manager.resolve({
 *   auth: { userId: '123', roles: ['user'] },
 *   timestamp: new Date()
 * });
 *
 * // Use in RLS
 * await rlsContext.runAsync(enhancedCtx, async () => {
 *   // Policies can access resolved data synchronously
 * });
 * ```
 */
export class ResolverManager<TResolved extends ResolvedData = ResolvedData> {
  private resolvers = new Map<string, ContextResolver>()
  private cacheProvider: ResolverCacheProvider
  private defaultCacheTtl: number
  private parallelResolution: boolean
  private resolverTimeout: number
  private logger: ResolverManagerOptions['logger']

  constructor(options: ResolverManagerOptions = {}) {
    this.cacheProvider = options.cacheProvider ?? new InMemoryCacheProvider()
    this.defaultCacheTtl = options.defaultCacheTtl ?? 300
    this.parallelResolution = options.parallelResolution ?? true
    this.resolverTimeout = options.resolverTimeout ?? 5000
    this.logger = options.logger
  }

  /**
   * Register a context resolver
   *
   * @param resolver - Resolver to register
   * @throws RLSError if resolver with same name already exists
   */
  register<T extends ResolvedData>(resolver: ContextResolver<T>): void {
    if (this.resolvers.has(resolver.name)) {
      throw new RLSError(
        `Resolver "${resolver.name}" is already registered`,
        RLSErrorCodes.RLS_SCHEMA_INVALID
      )
    }

    // Validate dependencies exist
    if (resolver.dependsOn) {
      for (const dep of resolver.dependsOn) {
        if (dep === resolver.name) {
          throw new RLSError(
            `Resolver "${resolver.name}" cannot depend on itself`,
            RLSErrorCodes.RLS_SCHEMA_INVALID
          )
        }
      }
    }

    this.resolvers.set(resolver.name, resolver as ContextResolver)
    this.logger?.debug?.(`[ResolverManager] Registered resolver: ${resolver.name}`)
  }

  /**
   * Unregister a context resolver
   *
   * @param name - Name of resolver to unregister
   * @returns true if resolver was removed, false if it didn't exist
   */
  unregister(name: string): boolean {
    const removed = this.resolvers.delete(name)
    if (removed) {
      this.logger?.debug?.(`[ResolverManager] Unregistered resolver: ${name}`)
    }
    return removed
  }

  /**
   * Check if a resolver is registered
   *
   * @param name - Resolver name
   */
  hasResolver(name: string): boolean {
    return this.resolvers.has(name)
  }

  /**
   * Get all registered resolver names
   */
  getResolverNames(): string[] {
    return Array.from(this.resolvers.keys())
  }

  /**
   * Resolve context data using all registered resolvers
   *
   * @param baseContext - Base context to resolve
   * @returns Enhanced context with resolved data
   *
   * @example
   * ```typescript
   * const baseCtx = {
   *   auth: { userId: '123', roles: ['user'], tenantId: 'acme' },
   *   timestamp: new Date()
   * };
   *
   * const enhancedCtx = await manager.resolve(baseCtx);
   * // enhancedCtx.auth.resolved contains all resolved data
   * ```
   */
  async resolve(baseContext: BaseResolverContext): Promise<EnhancedRLSContext<unknown, TResolved>> {
    const startTime = Date.now()
    const resolverOrder = this.getResolverOrder()

    this.logger?.debug?.(`[ResolverManager] Starting resolution for user ${baseContext.auth.userId}`, {
      resolverCount: resolverOrder.length,
      resolvers: resolverOrder.map(r => r.name)
    })

    const results = new Map<string, ResolvedData>()

    if (this.parallelResolution) {
      await this.resolveParallel(baseContext, resolverOrder, results)
    } else {
      await this.resolveSequential(baseContext, resolverOrder, results)
    }

    // Merge all resolved data
    const mergedResolved = this.mergeResolvedData(results)

    const enhancedContext: EnhancedRLSContext<unknown, TResolved> = {
      auth: {
        ...baseContext.auth,
        resolved: mergedResolved as TResolved
      },
      timestamp: baseContext.timestamp
    }

    if (baseContext.meta !== undefined) {
      enhancedContext.meta = baseContext.meta
    }

    const duration = Date.now() - startTime
    this.logger?.info?.(`[ResolverManager] Resolution completed`, {
      userId: baseContext.auth.userId,
      durationMs: duration,
      resolverCount: results.size
    })

    return enhancedContext
  }

  /**
   * Resolve a single resolver (useful for partial updates)
   *
   * @param name - Resolver name
   * @param baseContext - Base context
   * @returns Resolved data from the specific resolver
   */
  async resolveOne<T extends ResolvedData>(
    name: string,
    baseContext: BaseResolverContext
  ): Promise<T | null> {
    const resolver = this.resolvers.get(name)
    if (!resolver) {
      this.logger?.warn?.(`[ResolverManager] Resolver not found: ${name}`)
      return null
    }

    return (await this.resolveWithCache(resolver, baseContext)) as T | null
  }

  /**
   * Invalidate cached data for a user
   *
   * @param userId - User ID whose cache should be invalidated
   * @param resolverName - Optional specific resolver to invalidate
   */
  async invalidateCache(userId: string | number, resolverName?: string): Promise<void> {
    if (resolverName) {
      const resolver = this.resolvers.get(resolverName)
      if (resolver?.cacheKey) {
        const key = resolver.cacheKey({ auth: { userId, roles: [] }, timestamp: new Date() })
        if (key) {
          await this.cacheProvider.delete(key)
          this.logger?.debug?.(`[ResolverManager] Invalidated cache for ${resolverName}: ${key}`)
        }
      }
    } else {
      // Invalidate all resolvers for this user
      const pattern = `rls:*:${userId}:*`
      if (this.cacheProvider.deletePattern) {
        await this.cacheProvider.deletePattern(pattern)
      }
      this.logger?.debug?.(`[ResolverManager] Invalidated all cache for user ${userId}`)
    }
  }

  /**
   * Clear all cached data
   */
  async clearCache(): Promise<void> {
    if (this.cacheProvider instanceof InMemoryCacheProvider) {
      this.cacheProvider.clear()
    } else if (this.cacheProvider.deletePattern) {
      await this.cacheProvider.deletePattern('rls:*')
    }
    this.logger?.info?.('[ResolverManager] Cleared all cache')
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get resolvers in dependency order (topological sort)
   */
  private getResolverOrder(): ContextResolver[] {
    const ordered: ContextResolver[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (name: string): void => {
      if (visited.has(name)) return
      if (visiting.has(name)) {
        throw new RLSError(
          `Circular dependency detected in resolvers involving "${name}"`,
          RLSErrorCodes.RLS_SCHEMA_INVALID
        )
      }

      const resolver = this.resolvers.get(name)
      if (!resolver) return

      visiting.add(name)

      // Visit dependencies first
      if (resolver.dependsOn) {
        for (const dep of resolver.dependsOn) {
          visit(dep)
        }
      }

      visiting.delete(name)
      visited.add(name)
      ordered.push(resolver)
    }

    // Visit all resolvers
    for (const name of this.resolvers.keys()) {
      visit(name)
    }

    // Sort by priority within dependency constraints
    // Higher priority = earlier execution
    return ordered.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  }

  /**
   * Resolve resolvers sequentially
   */
  private async resolveSequential(
    baseContext: BaseResolverContext,
    resolvers: ContextResolver[],
    results: Map<string, ResolvedData>
  ): Promise<void> {
    for (const resolver of resolvers) {
      const data = await this.resolveWithCache(resolver, baseContext)
      if (data) {
        results.set(resolver.name, data)
      }
    }
  }

  /**
   * Resolve resolvers in parallel (respecting dependencies)
   */
  private async resolveParallel(
    baseContext: BaseResolverContext,
    resolvers: ContextResolver[],
    results: Map<string, ResolvedData>
  ): Promise<void> {
    // Group resolvers by their dependency depth
    const levels: ContextResolver[][] = []
    const assigned = new Set<string>()

    const getLevel = (resolver: ContextResolver): number => {
      if (!resolver.dependsOn || resolver.dependsOn.length === 0) {
        return 0
      }
      let maxDepLevel = 0
      for (const dep of resolver.dependsOn) {
        const depResolver = this.resolvers.get(dep)
        if (depResolver) {
          maxDepLevel = Math.max(maxDepLevel, getLevel(depResolver) + 1)
        }
      }
      return maxDepLevel
    }

    // Assign resolvers to levels
    for (const resolver of resolvers) {
      const level = getLevel(resolver)
      while (levels.length <= level) {
        levels.push([])
      }
      levels[level]!.push(resolver)
      assigned.add(resolver.name)
    }

    // Execute level by level
    for (const level of levels) {
      await Promise.all(
        level.map(async resolver => {
          const data = await this.resolveWithCache(resolver, baseContext)
          if (data) {
            results.set(resolver.name, data)
          }
        })
      )
    }
  }

  /**
   * Resolve a single resolver with caching
   */
  private async resolveWithCache(
    resolver: ContextResolver,
    baseContext: BaseResolverContext
  ): Promise<ResolvedData | null> {
    const startTime = Date.now()

    try {
      // Check cache first
      if (resolver.cacheKey) {
        const cacheKey = resolver.cacheKey(baseContext)
        if (cacheKey) {
          const cached = await this.cacheProvider.get<ResolvedData>(cacheKey)
          if (cached) {
            this.logger?.debug?.(`[ResolverManager] Cache hit for ${resolver.name}`, { cacheKey })
            return cached
          }
        }
      }

      // Resolve with timeout
      const data = await this.withTimeout(
        resolver.resolve(baseContext),
        this.resolverTimeout,
        `Resolver "${resolver.name}" timed out after ${this.resolverTimeout}ms`
      )

      // Cache the result
      if (resolver.cacheKey) {
        const cacheKey = resolver.cacheKey(baseContext)
        if (cacheKey) {
          const ttl = resolver.cacheTtl ?? this.defaultCacheTtl
          await this.cacheProvider.set(cacheKey, data, ttl)
          this.logger?.debug?.(`[ResolverManager] Cached ${resolver.name}`, { cacheKey, ttl })
        }
      }

      const duration = Date.now() - startTime
      this.logger?.debug?.(`[ResolverManager] Resolved ${resolver.name}`, { durationMs: duration })

      return data
    } catch (error) {
      const duration = Date.now() - startTime
      this.logger?.error?.(`[ResolverManager] Failed to resolve ${resolver.name}`, {
        error: error instanceof Error ? error.message : String(error),
        durationMs: duration
      })

      if (resolver.required !== false) {
        throw new RLSError(
          `Required resolver "${resolver.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
          RLSErrorCodes.RLS_POLICY_EVALUATION_ERROR
        )
      }

      return null
    }
  }

  /**
   * Execute a promise with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => { reject(new Error(message)); }, timeoutMs))
    ])
  }

  /**
   * Merge resolved data from multiple resolvers
   */
  private mergeResolvedData(results: Map<string, ResolvedData>): ResolvedData {
    const merged: ResolvedData & Record<string, unknown> = {
      resolvedAt: new Date()
    }

    for (const [name, data] of results) {
      // Add resolver data under its name
      merged[name] = data

      // Also spread properties to root level for convenience
      for (const [key, value] of Object.entries(data)) {
        if (key !== 'resolvedAt' && key !== 'cacheKey') {
          if (merged[key] === undefined) {
            merged[key] = value
          }
        }
      }
    }

    return merged
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a context resolver manager with common defaults
 *
 * @param options - Manager options
 * @returns Configured ResolverManager
 */
export function createResolverManager<TResolved extends ResolvedData = ResolvedData>(
  options?: ResolverManagerOptions
): ResolverManager<TResolved> {
  return new ResolverManager<TResolved>(options)
}

/**
 * Helper to create a context resolver
 *
 * @param config - Resolver configuration
 * @returns ContextResolver instance
 *
 * @example
 * ```typescript
 * const resolver = createResolver({
 *   name: 'org-permissions',
 *   resolve: async (base) => {
 *     const orgs = await getEmployeeOrganizations(base.auth.userId);
 *     return {
 *       resolvedAt: new Date(),
 *       organizationIds: orgs.map(o => o.id)
 *     };
 *   },
 *   cacheKey: (base) => `rls:org:${base.auth.userId}`,
 *   cacheTtl: 300
 * });
 * ```
 */
export function createResolver<TResolved extends ResolvedData>(
  config: ContextResolver<TResolved>
): ContextResolver<TResolved> {
  return {
    required: true,
    priority: 0,
    ...config
  }
}
