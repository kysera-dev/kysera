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
 * Detect circular dependencies using iterative DFS
 * Prevents stack overflow with deep dependency chains
 */
function detectCircularDependencies(plugins: readonly Plugin[]): void {
  const map = new Map(plugins.map(p => [p.name, p]))
  const visited = new Set<string>()

  for (const plugin of plugins) {
    if (visited.has(plugin.name)) continue

    // Iterative DFS using explicit stack
    const stack: { name: string; deps: readonly string[]; depIndex: number }[] = []
    const inStack = new Set<string>()
    const path: string[] = []

    stack.push({ name: plugin.name, deps: plugin.dependencies ?? [], depIndex: 0 })
    inStack.add(plugin.name)
    path.push(plugin.name)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!

      if (frame.depIndex >= frame.deps.length) {
        // Done with this node, backtrack
        stack.pop()
        inStack.delete(frame.name)
        path.pop()
        visited.add(frame.name)
        continue
      }

      const dep = frame.deps[frame.depIndex]!
      frame.depIndex++

      if (inStack.has(dep)) {
        // Cycle detected
        const start = path.indexOf(dep)
        const cycle = [...path.slice(start), dep]
        throw new PluginValidationError(
          `Circular dependency: ${cycle.join(' -> ')}`,
          'CIRCULAR_DEPENDENCY',
          { pluginName: frame.name, cycle }
        )
      }

      if (!visited.has(dep)) {
        const depPlugin = map.get(dep)
        if (depPlugin) {
          stack.push({ name: dep, deps: depPlugin.dependencies ?? [], depIndex: 0 })
          inStack.add(dep)
          path.push(dep)
        }
      }
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

  // Helper to maintain sorted order efficiently (descending priority, then alphabetical)
  const insertSorted = (arr: Plugin[], plugin: Plugin): void => {
    const priority = plugin.priority ?? 0
    let left = 0
    let right = arr.length

    // Binary search for insertion point (O(log n))
    // We want descending priority (high to low), then alphabetical
    while (left < right) {
      const mid = (left + right) >>> 1
      const midPriority = arr[mid]!.priority ?? 0
      // If mid has higher priority, or same priority but earlier name, insert after mid
      if (midPriority > priority || (midPriority === priority && arr[mid]!.name < plugin.name)) {
        left = mid + 1
      } else {
        right = mid
      }
    }
    arr.splice(left, 0, plugin)
  }

  // Initial sort: descending priority (high to low), then alphabetical
  available.sort((a, b) => {
    const pA = a.priority ?? 0
    const pB = b.priority ?? 0
    return pA !== pB ? pB - pA : a.name.localeCompare(b.name)
  })

  while (available.length > 0) {
    // Take first element (highest priority): O(1) with shift
    const current = available.shift()
    // Safety: available.length > 0 check ensures current is defined
    if (!current) break
    result.push(current)

    const deps = dependents.get(current.name)
    if (deps) {
      for (const dep of deps) {
        const newDegree = (inDegree.get(dep) ?? 0) - 1
        inDegree.set(dep, newDegree)
        if (newDegree === 0) {
          const plugin = map.get(dep)
          // Insert maintaining sorted order: O(log n) search + O(n) splice
          // Overall complexity: O(n log n) instead of O(n²)
          if (plugin) insertSorted(available, plugin)
        }
      }
    }
  }

  return result
}

/**
 * Create intercepted method that applies plugins
 *
 * @param db - Kysely database instance
 * @param method - Method name being intercepted
 * @param interceptors - Plugins with interceptQuery methods
 * @param currentSchema - Optional schema context (from withSchema)
 */
function createInterceptedMethod<DB>(
  db: Kysely<DB>,
  method: InterceptedMethod,
  interceptors: readonly Plugin[],
  currentSchema?: string
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

    // Apply interceptors with schema context
    // Use spread to conditionally include schema only when defined
    const context: QueryBuilderContext = currentSchema !== undefined
      ? { operation, table, schema: currentSchema, metadata: {} }
      : { operation, table, metadata: {} }

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

/** Maximum size for LRU caches to prevent unbounded growth */
const MAX_CACHE_SIZE = 100

/**
 * Sentinel value to distinguish "cached undefined" from "not in cache"
 * @internal
 */
const UNDEFINED_SENTINEL = Symbol('UNDEFINED_SENTINEL')

/**
 * Wrapper type for cache values to handle undefined correctly
 * @internal
 */
type CacheValue<V> = V | typeof UNDEFINED_SENTINEL

/**
 * Simple LRU cache implementation to prevent unbounded cache growth.
 *
 * Correctly handles undefined values using a sentinel pattern:
 * - get() returns undefined for both "cached undefined" and "not in cache"
 * - has() returns true only if key is actually in cache (even if value is undefined)
 *
 * @internal
 */
class LRUCache<K, V> {
  private cache: Map<K, CacheValue<V>>
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.cache = new Map()
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
      // Unwrap sentinel value
      return value === UNDEFINED_SENTINEL ? undefined : value
    }
    return undefined
  }

  set(key: K, value: V): void {
    // Wrap undefined values with sentinel
    const wrappedValue: CacheValue<V> = value === undefined ? UNDEFINED_SENTINEL : value

    // Delete if exists to move to end
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }
    this.cache.set(key, wrappedValue)

    // Evict oldest (first) entry if size exceeded
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }
}

/**
 * Create plugin-aware executor using Proxy
 * Optimized with LRU caching and Set-based lookups
 *
 * @param db - Kysely database instance
 * @param interceptors - Plugins with interceptQuery methods
 * @param allPlugins - All registered plugins
 * @param currentSchema - Optional schema context (from withSchema)
 */
function createProxy<DB>(
  db: Kysely<DB>,
  interceptors: readonly Plugin[],
  allPlugins: readonly Plugin[],
  currentSchema?: string
): KyseraExecutor<DB> {
  // Cache for bound methods to avoid repeated .bind() allocations
  const methodCache = new Map<string | symbol, unknown>()

  // Cache intercepted methods to avoid repeated creation
  const interceptedCache = new Map<string, (table: string) => unknown>()

  // Cached transaction wrapper (created once, reused)
  let cachedTransactionWrapper:
    | (() => { execute: <T>(fn: (trx: Transaction<DB>) => Promise<T>) => Promise<T> })
    | null = null

  // LRU cache for withSchema to prevent unbounded growth (max 100 schemas)
  const schemaProxyCache = new LRUCache<string, KyseraExecutor<DB>>(MAX_CACHE_SIZE)

  const handler: ProxyHandler<Kysely<DB>> = {
    // Handle 'in' operator for type guards
    has(target, prop) {
      if (MARKER_PROPS.has(prop)) return true
      if (prop === '__schema') return true
      return Reflect.has(target, prop)
    },

    get(target, prop, receiver) {
      // Fast path: marker properties (O(1) Set lookup)
      if (prop === '__kysera') return true
      if (prop === '__plugins') return allPlugins
      if (prop === '__rawDb') return target
      if (prop === '__schema') return currentSchema

      // Fast path: check intercepted methods first (most common hot path)
      if (typeof prop === 'string' && INTERCEPTED_METHODS_SET.has(prop)) {
        let intercepted = interceptedCache.get(prop)
        if (!intercepted) {
          intercepted = createInterceptedMethod(target, prop as InterceptedMethod, interceptors, currentSchema)
          interceptedCache.set(prop, intercepted)
        }
        return intercepted
      }

      // Intercept withSchema to maintain plugin proxy and track schema
      if (prop === 'withSchema') {
        return (schema: string) => {
          const cachedSchemaProxy = schemaProxyCache.get(schema)
          if (cachedSchemaProxy) {
            return cachedSchemaProxy
          }
          const schemaDb = target.withSchema(schema)
          // Pass schema to new proxy so it's available in QueryBuilderContext
          const newProxy = createProxy(schemaDb, interceptors, allPlugins, schema)
          schemaProxyCache.set(schema, newProxy)
          return newProxy
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
