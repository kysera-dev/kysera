/**
 * @kysera/executor - KyseraExecutor Implementation
 * @module @kysera/executor
 *
 * ## Architecture Notes
 *
 * ### Type System Constraints
 *
 * This implementation uses type assertions due to Kysely's complex type system.
 * All assertions are documented inline and verified safe through runtime behavior.
 *
 * **Type Assertion Categories:**
 *
 * 1. **Plugin interceptQuery** (Line 261)
 *    - Issue: QB is constrained to `Compilable<unknown>` but query builders have
 *      incompatible method signatures (where, and, etc.)
 *    - Safety: Plugin authors must cast based on `context.operation` type
 *    - Alternative: None - Kysely lacks a shared interface for query modification
 *
 * 2. **Transaction wrapping** (Lines 326, 332)
 *    - Issue: Transaction<DB> extends Kysely<DB> but proxy requires Kysely type
 *    - Safety: Structural compatibility verified - Transaction IS-A Kysely
 *    - Alternative: None - TypeScript requires explicit cast despite structural typing
 *
 * 3. **Dynamic method access** (Line 245)
 *    - Issue: Kysely<DB> lacks index signature for dynamic property access
 *    - Safety: Method names validated against INTERCEPTED_METHODS constant
 *    - Alternative: None - Cannot use mapped types with runtime method names
 *
 * 4. **Object.assign marker properties** (Lines 394, 427, 473, 488, 527)
 *    - Issue: Object.assign returns intersection type (Kysely & Marker)
 *    - Safety: Type assertion to union type (KyseraExecutor/KyseraTransaction)
 *    - Alternative: Manual object spread (less performant, same type assertion needed)
 *
 * 5. **wrapTransaction cast chain** (Lines 539, 542)
 *    - Issue: Transaction -> Kysely -> Proxy -> KyseraTransaction requires casts
 *    - Safety: All types structurally compatible; verified in tests
 *    - Alternative: None - TypeScript nominal types would solve this
 *
 * 6. **getRawDb executor check** (Line 588)
 *    - Issue: Need to check if plain Kysely has __rawDb property
 *    - Safety: Optional chaining handles both KyseraExecutor and plain Kysely
 *    - Alternative: Type guard (more verbose, same runtime behavior)
 *
 * ### Transaction API Limitation
 *
 * The wrapped transaction only exposes `.execute()` method, not `.setIsolationLevel()`.
 * This is intentional: isolation level should be set before plugin interception.
 *
 * **Rationale:**
 * - Isolation level is a transaction-level concern, not a query-level concern
 * - Setting isolation level after plugin initialization could cause inconsistencies
 * - Keeps the wrapper API simple and focused on query interception
 *
 * **Escape Hatch:**
 * ```typescript
 * executor.__rawDb.transaction().setIsolationLevel('serializable').execute(...)
 * ```
 *
 * This design keeps the plugin system simple while allowing escape hatches.
 */

import type { Kysely, Transaction } from 'kysely'
import type {
  Plugin,
  KyseraExecutor,
  KyseraTransaction,
  QueryBuilderContext,
  ExecutorConfig,
  PluginValidationErrorType,
  PluginValidationDetails
} from './types.js'

/** Methods that accept table name and should be intercepted */
export const INTERCEPTED_METHODS = [
  'selectFrom',
  'insertInto',
  'updateTable',
  'deleteFrom',
  'replaceInto', // MySQL REPLACE
  'mergeInto' // SQL MERGE (Kysely 0.28.x)
] as const

export type InterceptedMethod = (typeof INTERCEPTED_METHODS)[number]

/** Pre-computed Set for O(1) lookup instead of Array.includes O(n) */
const INTERCEPTED_METHODS_SET = new Set<string>(INTERCEPTED_METHODS)

/** Map method names to operation types */
const METHOD_TO_OPERATION: Record<InterceptedMethod, QueryBuilderContext['operation']> = {
  selectFrom: 'select',
  insertInto: 'insert',
  updateTable: 'update',
  deleteFrom: 'delete',
  replaceInto: 'replace',
  mergeInto: 'merge'
}

/**
 * Plugin validation error
 */
export class PluginValidationError extends Error {
  constructor(
    message: string,
    public readonly type: PluginValidationErrorType,
    public readonly details: PluginValidationDetails
  ) {
    super(message)
    this.name = 'PluginValidationError'
  }
}

/**
 * Validate plugins for conflicts, duplicates, and missing dependencies
 */
export function validatePlugins(plugins: readonly Plugin[]): void {
  const names = new Set<string>()

  for (const plugin of plugins) {
    if (names.has(plugin.name)) {
      throw new PluginValidationError(`Duplicate plugin: "${plugin.name}"`, 'DUPLICATE_NAME', {
        pluginName: plugin.name
      })
    }
    names.add(plugin.name)
  }

  for (const plugin of plugins) {
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!names.has(dep)) {
          throw new PluginValidationError(
            `Plugin "${plugin.name}" requires "${dep}" which is not registered`,
            'MISSING_DEPENDENCY',
            { pluginName: plugin.name, missingDependency: dep }
          )
        }
      }
    }

    if (plugin.conflictsWith) {
      for (const conflict of plugin.conflictsWith) {
        if (names.has(conflict)) {
          throw new PluginValidationError(
            `Plugin "${plugin.name}" conflicts with "${conflict}"`,
            'CONFLICT',
            { pluginName: plugin.name, conflictingPlugin: conflict }
          )
        }
      }
    }
  }

  detectCircularDependencies(plugins)
}

/**
 * Detect circular dependencies using DFS
 */
function detectCircularDependencies(plugins: readonly Plugin[]): void {
  const visited = new Set<string>()
  const stack = new Set<string>()
  const path: string[] = []
  const map = new Map(plugins.map(p => [p.name, p]))

  function dfs(name: string): void {
    visited.add(name)
    stack.add(name)
    path.push(name)

    const plugin = map.get(name)
    if (plugin?.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!visited.has(dep)) {
          dfs(dep)
        } else if (stack.has(dep)) {
          const start = path.indexOf(dep)
          const cycle = [...path.slice(start), dep]
          throw new PluginValidationError(
            `Circular dependency: ${cycle.join(' -> ')}`,
            'CIRCULAR_DEPENDENCY',
            { pluginName: name, cycle }
          )
        }
      }
    }

    path.pop()
    stack.delete(name)
  }

  for (const plugin of plugins) {
    if (!visited.has(plugin.name)) {
      dfs(plugin.name)
    }
  }
}

/**
 * Resolve plugin execution order using topological sort with priority
 */
export function resolvePluginOrder(plugins: readonly Plugin[]): Plugin[] {
  if (plugins.length === 0) return []

  const map = new Map(plugins.map(p => [p.name, p]))
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, Set<string>>()

  for (const plugin of plugins) {
    inDegree.set(plugin.name, 0)
    dependents.set(plugin.name, new Set())
  }

  for (const plugin of plugins) {
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        inDegree.set(plugin.name, (inDegree.get(plugin.name) ?? 0) + 1)
        dependents.get(dep)?.add(plugin.name)
      }
    }
  }

  const result: Plugin[] = []
  const available = plugins.filter(p => (inDegree.get(p.name) ?? 0) === 0)

  while (available.length > 0) {
    // Sort by priority (higher first), then by name for stability
    available.sort((a, b) => {
      const pA = a.priority ?? 0
      const pB = b.priority ?? 0
      return pA !== pB ? pB - pA : a.name.localeCompare(b.name)
    })

    const current = available.shift()!
    result.push(current)

    const deps = dependents.get(current.name)
    if (deps) {
      for (const dep of deps) {
        const newDegree = (inDegree.get(dep) ?? 0) - 1
        inDegree.set(dep, newDegree)
        if (newDegree === 0) {
          const plugin = map.get(dep)
          if (plugin) available.push(plugin)
        }
      }
    }
  }

  return result
}

/**
 * Create intercepted method that applies plugins
 */
function createInterceptedMethod<DB>(
  db: Kysely<DB>,
  method: InterceptedMethod,
  interceptors: readonly Plugin[]
): (table: string) => unknown {
  const operation = METHOD_TO_OPERATION[method]

  return (table: string) => {
    /**
     * TYPE ASSERTION #3: Dynamic method access
     *
     * Cast: Kysely<DB> -> Record<string, (t: string) => unknown>
     *
     * Why needed:
     * - Kysely<DB> interface doesn't have an index signature
     * - TypeScript doesn't allow db[method] for dynamic property access
     *
     * Why safe:
     * - Method name validated against INTERCEPTED_METHODS constant
     * - Runtime check throws if method doesn't exist
     * - All intercepted methods have signature: (table: string) => QueryBuilder
     */
    const originalMethod = (db as unknown as Record<string, (t: string) => unknown>)[method]
    if (!originalMethod) {
      throw new Error(`Method ${method} not found on Kysely instance`)
    }
    // Call with correct 'this' context
    let qb = originalMethod.call(db, table)

    // Apply interceptors
    const context: QueryBuilderContext = {
      operation,
      table,
      metadata: {}
    }

    for (const plugin of interceptors) {
      if (plugin.interceptQuery) {
        qb = plugin.interceptQuery(qb, context)
      }
    }

    return qb
  }
}

/** Marker properties Set for fast O(1) lookup */
const MARKER_PROPS = new Set<string | symbol>(['__kysera', '__plugins', '__rawDb'])

/**
 * Create plugin-aware executor using Proxy
 * Optimized with method caching and Set-based lookups
 */
function createProxy<DB>(
  db: Kysely<DB>,
  interceptors: readonly Plugin[],
  allPlugins: readonly Plugin[]
): KyseraExecutor<DB> {
  // Cache for bound methods to avoid repeated .bind() allocations
  const methodCache = new Map<string | symbol, unknown>()

  // Cache intercepted methods to avoid repeated creation
  const interceptedCache = new Map<string, (table: string) => unknown>()

  // Cached transaction wrapper (created once, reused)
  let cachedTransactionWrapper:
    | (() => { execute: <T>(fn: (trx: Transaction<DB>) => Promise<T>) => Promise<T> })
    | null = null

  // Cached withSchema wrapper (created once per schema, reused)
  const schemaProxyCache = new Map<string, KyseraExecutor<DB>>()

  const handler: ProxyHandler<Kysely<DB>> = {
    // Handle 'in' operator for type guards
    has(target, prop) {
      if (MARKER_PROPS.has(prop)) return true
      return Reflect.has(target, prop)
    },

    get(target, prop, receiver) {
      // Fast path: marker properties (O(1) Set lookup)
      if (prop === '__kysera') return true
      if (prop === '__plugins') return allPlugins
      if (prop === '__rawDb') return target

      // Fast path: check intercepted methods first (most common hot path)
      if (typeof prop === 'string' && INTERCEPTED_METHODS_SET.has(prop)) {
        let intercepted = interceptedCache.get(prop)
        if (!intercepted) {
          intercepted = createInterceptedMethod(target, prop as InterceptedMethod, interceptors)
          interceptedCache.set(prop, intercepted)
        }
        return intercepted
      }

      // Intercept withSchema to maintain plugin proxy
      if (prop === 'withSchema') {
        return (schema: string) => {
          let cachedSchemaProxy = schemaProxyCache.get(schema)
          if (!cachedSchemaProxy) {
            const schemaDb = target.withSchema(schema)
            cachedSchemaProxy = createProxy(schemaDb, interceptors, allPlugins)
            schemaProxyCache.set(schema, cachedSchemaProxy)
          }
          return cachedSchemaProxy
        }
      }

      // Intercept with() for CTEs - cache the wrapper and also wrap the result
      if (prop === 'with') {
        if (!methodCache.has('with')) {
          const withWrapper = (name: string, fn: (db: Kysely<DB>) => unknown): unknown => {
            const wrappedFn = (innerDb: Kysely<DB>): unknown =>
              fn(createProxy(innerDb, interceptors, allPlugins))
            const originalMethod = Reflect.get(target, 'with') as (
              n: string,
              f: (db: Kysely<DB>) => unknown
            ) => Kysely<DB>
            const result = originalMethod.call(target, name, wrappedFn)
            return createProxy(result, interceptors, allPlugins)
          }
          methodCache.set('with', withWrapper)
        }
        return methodCache.get('with')
      }

      // Intercept withRecursive() for recursive CTEs - cache the wrapper and wrap result
      if (prop === 'withRecursive') {
        if (!methodCache.has('withRecursive')) {
          const withRecursiveWrapper = (name: string, fn: (db: Kysely<DB>) => unknown): unknown => {
            const wrappedFn = (innerDb: Kysely<DB>): unknown =>
              fn(createProxy(innerDb, interceptors, allPlugins))
            const originalMethod = Reflect.get(target, 'withRecursive') as (
              n: string,
              f: (db: Kysely<DB>) => unknown
            ) => Kysely<DB>
            const result = originalMethod.call(target, name, wrappedFn)
            return createProxy(result, interceptors, allPlugins)
          }
          methodCache.set('withRecursive', withRecursiveWrapper)
        }
        return methodCache.get('withRecursive')
      }

      // Cached transaction wrapper
      // NOTE: Transaction API limitation - only execute() method is wrapped
      // Methods like setIsolationLevel() are not available on the wrapper
      // This is intentional: isolation level should be set before plugin interception
      // For advanced use cases, use: executor.__rawDb.transaction().setIsolationLevel(...).execute(...)
      if (prop === 'transaction') {
        if (!cachedTransactionWrapper) {
          cachedTransactionWrapper = () => ({
            execute: async <T>(fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> => {
              return await target.transaction().execute(async trx => {
                /**
                 * TYPE ASSERTION #2a: Transaction to Kysely for proxy creation
                 *
                 * Cast: Transaction<DB> -> Kysely<DB>
                 *
                 * Why needed:
                 * - createProxy expects Kysely<DB>, not Transaction<DB>
                 * - TypeScript doesn't recognize structural compatibility automatically
                 *
                 * Why safe:
                 * - Transaction<DB> extends Kysely<DB> (verified in Kysely types)
                 * - All Kysely methods are available on Transaction
                 * - createProxy only accesses Kysely methods
                 */
                const wrappedTrx = createProxy(
                  trx as unknown as Kysely<DB>,
                  interceptors,
                  allPlugins
                )
                /**
                 * TYPE ASSERTION #2b: Wrapped proxy back to Transaction
                 *
                 * Cast: KyseraExecutor<DB> -> Transaction<DB>
                 *
                 * Why needed:
                 * - User callback expects Transaction<DB>, not KyseraExecutor<DB>
                 * - Proxy wraps a Transaction but returns KyseraExecutor type
                 *
                 * Why safe:
                 * - Original trx is Transaction<DB>
                 * - Proxy preserves all Transaction methods
                 * - Only adds marker properties (__kysera, __plugins, __rawDb)
                 */
                return await fn(wrappedTrx as unknown as Transaction<DB>)
              })
            }
          })
        }
        return cachedTransactionWrapper
      }

      // Check method cache for bound functions
      if (methodCache.has(prop)) {
        return methodCache.get(prop)
      }

      const value = Reflect.get(target, prop, receiver)

      // Cache bound methods to avoid repeated .bind() allocations
      if (typeof value === 'function') {
        const bound = value.bind(target)
        methodCache.set(prop, bound)
        return bound
      }

      return value
    }
  }

  return new Proxy(db, handler) as KyseraExecutor<DB>
}

/**
 * Create a plugin-aware executor
 *
 * Zero overhead if no plugins have interceptQuery
 *
 * @param db - Kysely database instance
 * @param plugins - Array of plugins to apply
 * @param config - Optional configuration
 * @returns Plugin-aware executor
 *
 * @example
 * ```typescript
 * import { createExecutor } from '@kysera/executor';
 * import { softDeletePlugin } from '@kysera/soft-delete';
 *
 * const executor = await createExecutor(db, [softDeletePlugin()]);
 *
 * // All queries now have soft-delete filter applied
 * const users = await executor.selectFrom('users').selectAll().execute();
 * ```
 */
export async function createExecutor<DB>(
  db: Kysely<DB>,
  plugins: readonly Plugin[] = [],
  config: ExecutorConfig = {}
): Promise<KyseraExecutor<DB>> {
  const { enabled = true } = config

  // Fast path: no plugins or disabled
  if (plugins.length === 0 || !enabled) {
    /**
     * TYPE ASSERTION #4a: Object.assign result to KyseraExecutor
     *
     * Cast: Kysely<DB> & KyseraExecutorMarker<DB> -> KyseraExecutor<DB>
     *
     * Why needed:
     * - Object.assign returns intersection type (Kysely & Marker)
     * - KyseraExecutor is defined as: type KyseraExecutor<DB> = Kysely<DB> & KyseraExecutorMarker<DB>
     * - TypeScript treats intersection types different from type aliases
     *
     * Why safe:
     * - We're adding exactly the marker properties defined in KyseraExecutorMarker
     * - Runtime type is identical to KyseraExecutor type definition
     * - No structural difference between intersection and type alias at runtime
     */
    return Object.assign(db, {
      __kysera: true as const,
      __plugins: plugins,
      __rawDb: db
    }) as KyseraExecutor<DB>
  }

  // Validate and sort plugins
  validatePlugins(plugins)
  const sorted = resolvePluginOrder(plugins)

  // Initialize plugins with error handling
  for (const plugin of sorted) {
    try {
      await plugin.onInit?.(db)
    } catch (error) {
      throw new PluginValidationError(
        `Plugin "${plugin.name}" failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
        'INITIALIZATION_FAILED',
        { pluginName: plugin.name }
      )
    }
  }

  // Filter plugins with interceptQuery for performance
  const interceptors = sorted.filter(p => p.interceptQuery)

  // Fast path: no interceptors
  if (interceptors.length === 0) {
    /**
     * TYPE ASSERTION #4b: Object.assign result to KyseraExecutor (no interceptors)
     *
     * Same as #4a but with sorted plugins instead of input plugins.
     * This path is for plugins that have onInit but no interceptQuery.
     */
    return Object.assign(db, {
      __kysera: true as const,
      __plugins: sorted,
      __rawDb: db
    }) as KyseraExecutor<DB>
  }

  // Create proxy with interception
  return createProxy(db, interceptors, sorted)
}

/**
 * Creates executor synchronously WITHOUT calling plugin onInit hooks.
 *
 * @warning This function skips plugin initialization. Use createExecutor()
 * instead unless you are certain plugins don't need async initialization.
 *
 * Use cases where this is safe:
 * - Plugins without onInit hooks
 * - Plugins with synchronous-only initialization
 * - Testing scenarios where initialization is handled separately
 *
 * @param db - Kysely database instance
 * @param plugins - Array of plugins to apply
 * @param config - Optional configuration
 * @returns Plugin-aware executor (without onInit called)
 *
 * @example
 * ```typescript
 * // Use for simple plugins without async init:
 * const executor = createExecutorSync(db, [simplePlugin]);
 *
 * // WARNING: Plugin onInit hooks are NOT called!
 * // If your plugin requires initialization, use createExecutor() instead.
 * ```
 */
export function createExecutorSync<DB>(
  db: Kysely<DB>,
  plugins: readonly Plugin[] = [],
  config: ExecutorConfig = {}
): KyseraExecutor<DB> {
  const { enabled = true } = config

  if (plugins.length === 0 || !enabled) {
    /**
     * TYPE ASSERTION #4c: Object.assign in createExecutorSync (no plugins/disabled)
     *
     * Same as #4a - see explanation there.
     */
    return Object.assign(db, {
      __kysera: true as const,
      __plugins: plugins,
      __rawDb: db
    }) as KyseraExecutor<DB>
  }

  validatePlugins(plugins)
  const sorted = resolvePluginOrder(plugins)
  const interceptors = sorted.filter(p => p.interceptQuery)

  if (interceptors.length === 0) {
    /**
     * TYPE ASSERTION #4d: Object.assign in createExecutorSync (no interceptors)
     *
     * Same as #4b - see explanation there.
     */
    return Object.assign(db, {
      __kysera: true as const,
      __plugins: sorted,
      __rawDb: db
    }) as KyseraExecutor<DB>
  }

  return createProxy(db, interceptors, sorted)
}

/**
 * Check if value is a KyseraExecutor
 */
export function isKyseraExecutor<DB>(
  value: Kysely<DB> | KyseraExecutor<DB>
): value is KyseraExecutor<DB> {
  return '__kysera' in value && value.__kysera
}

/**
 * Get plugins from executor
 */
export function getPlugins<DB>(executor: KyseraExecutor<DB>): readonly Plugin[] {
  return executor.__plugins
}

/**
 * Wrap transaction with plugins
 */
export function wrapTransaction<DB>(
  trx: Transaction<DB>,
  plugins: readonly Plugin[]
): KyseraTransaction<DB> {
  const interceptors = plugins.filter(p => p.interceptQuery)

  if (interceptors.length === 0) {
    /**
     * TYPE ASSERTION #4e: Object.assign for transaction wrapping (no interceptors)
     *
     * Cast: Transaction<DB> & KyseraExecutorMarker<DB> -> KyseraTransaction<DB>
     *
     * Similar to #4a but for Transaction type instead of Kysely type.
     * KyseraTransaction is defined as: type KyseraTransaction<DB> = Transaction<DB> & KyseraExecutorMarker<DB>
     */
    return Object.assign(trx, {
      __kysera: true as const,
      __plugins: plugins,
      __rawDb: trx
    }) as KyseraTransaction<DB>
  }

  /**
   * TYPE ASSERTION #5: wrapTransaction cast chain
   *
   * Double cast: Transaction<DB> -> Kysely<DB> -> KyseraExecutor<DB> -> KyseraTransaction<DB>
   *
   * Why needed:
   * - createProxy expects Kysely<DB> and returns KyseraExecutor<DB>
   * - We need to return KyseraTransaction<DB>
   * - TypeScript doesn't recognize that KyseraExecutor wrapping a Transaction is compatible with KyseraTransaction
   *
   * Why safe:
   * - Transaction<DB> extends Kysely<DB> (first cast is upcast)
   * - createProxy preserves all methods (adds marker properties only)
   * - KyseraTransaction<DB> = Transaction<DB> & Marker, KyseraExecutor<DB> = Kysely<DB> & Marker
   * - Since original is Transaction, wrapped result is structurally KyseraTransaction
   * - Verified in integration tests (packages/executor/test/executor.test.ts)
   */
  return createProxy(
    trx as unknown as Kysely<DB>,
    interceptors,
    plugins
  ) as unknown as KyseraTransaction<DB>
}

/**
 * Apply plugins to a query builder manually
 * Useful for complex queries that bypass normal interception
 */
export function applyPlugins<QB>(
  qb: QB,
  plugins: readonly Plugin[],
  context: QueryBuilderContext
): QB {
  let result = qb
  for (const plugin of plugins) {
    if (plugin.interceptQuery) {
      result = plugin.interceptQuery(result, context)
    }
  }
  return result
}

/**
 * Get raw Kysely instance from executor, bypassing plugin interceptors.
 * Returns the executor itself if it's not a KyseraExecutor.
 *
 * Useful for plugins that need to:
 * - Perform internal queries without triggering interceptors
 * - Avoid double-filtering (e.g., soft-delete checking its own records)
 * - Access the underlying Kysely instance for advanced operations
 *
 * @param executor - Kysely or KyseraExecutor instance
 * @returns Raw Kysely instance without plugin interception
 *
 * @example
 * ```typescript
 * // Inside a plugin's extendRepository:
 * const rawDb = getRawDb(baseRepo.executor);
 * // This query bypasses all plugin interceptors
 * const result = await rawDb.selectFrom('users').selectAll().execute();
 * ```
 */
export function getRawDb<DB>(executor: Kysely<DB>): Kysely<DB> {
  /**
   * TYPE ASSERTION #6: getRawDb executor check
   *
   * Cast: Kysely<DB> -> KyseraExecutor<DB>
   *
   * Why needed:
   * - Need to check if executor has __rawDb property
   * - Plain Kysely<DB> doesn't have __rawDb, only KyseraExecutor<DB> does
   * - TypeScript doesn't allow property access without type assertion
   *
   * Why safe:
   * - Optional chaining (??) handles both cases gracefully:
   *   - If KyseraExecutor: __rawDb exists and is returned
   *   - If plain Kysely: __rawDb is undefined, executor is returned
   * - No runtime error possible - undefined ?? executor always succeeds
   * - Type guard alternative would be more verbose with same behavior
   */
  const kyseraExecutor = executor as unknown as KyseraExecutor<DB>
  return kyseraExecutor.__rawDb ?? executor
}

/**
 * Destroy executor and call onDestroy for all plugins
 *
 * @param executor - KyseraExecutor instance to destroy
 *
 * @example
 * ```typescript
 * const executor = await createExecutor(db, [myPlugin]);
 * // ... use executor ...
 * await destroyExecutor(executor);  // Calls onDestroy on all plugins
 * await db.destroy();               // Then destroy underlying Kysely instance
 * ```
 */
export async function destroyExecutor<DB>(executor: KyseraExecutor<DB>): Promise<void> {
  const plugins = executor.__plugins

  // Call onDestroy in reverse order (cleanup in reverse of initialization)
  for (let i = plugins.length - 1; i >= 0; i--) {
    const plugin = plugins[i]
    if (plugin?.onDestroy) {
      await plugin.onDestroy()
    }
  }
}
