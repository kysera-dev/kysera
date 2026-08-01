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
 * 1. **Plugin interceptQuery**
 *    - Issue: QB is constrained to `Compilable<unknown>` but query builders have
 *      incompatible method signatures (where, and, etc.)
 *    - Safety: Plugin authors must cast based on `context.operation` type
 *    - Alternative: None - Kysely lacks a shared interface for query modification
 *
 * 2. **Transaction wrapping**
 *    - Issue: Transaction<DB> extends Kysely<DB> but proxy requires Kysely type
 *    - Safety: Structural compatibility verified - Transaction IS-A Kysely
 *    - Alternative: None - TypeScript requires explicit cast despite structural typing
 *
 * 3. **Dynamic method access**
 *    - Issue: Kysely<DB> lacks index signature for dynamic property access
 *    - Safety: Method names validated against INTERCEPTED_METHODS constant
 *    - Alternative: None - Cannot use mapped types with runtime method names
 *
 * ### Proxy Getter Semantics
 *
 * All property reads go through `Reflect.get(target, prop)` WITHOUT forwarding
 * the proxy as receiver. Kysely uses native `#private` fields internally; if a
 * getter (e.g. `db.schema`) ran with `this` bound to the proxy, JavaScript would
 * throw "Cannot read private member". Binding getters to the target is required
 * for correctness and matches how the wrapped methods are bound.
 *
 * ### Derived Instance Coverage
 *
 * Kysely methods that return derived instances are wrapped so plugin
 * interception is never silently lost:
 *
 * - `withSchema()` — re-proxied with schema context (LRU-cached)
 * - `with()` / `withRecursive()` — CTE callback receives a plugin-aware creator
 *   (kysely 0.29 direct-expression form is passed through untouched)
 * - `$extendTables()` / `$omitTables()` / `$pickTables()` / `withTables()` /
 *   `withPlugin()` / `withoutPlugins()` — result re-proxied
 * - `transaction()` — full TransactionBuilder surface (setIsolationLevel /
 *   setAccessMode / execute); callback receives a plugin-aware transaction
 * - `startTransaction()` — ControlledTransaction is re-proxied, including
 *   `savepoint()` / `rollbackToSavepoint()` / `releaseSavepoint()` results
 * - `connection()` — callback receives a plugin-aware single-connection instance
 *
 * Note: wrapped builders are structurally compatible with Kysely's builders but
 * are not `instanceof TransactionBuilder`/`ConnectionBuilder`. Use `__rawDb`
 * as an escape hatch when identity matters.
 */

import type {
  AccessMode,
  ConnectionBuilder,
  ControlledTransaction,
  ControlledTransactionBuilder,
  IsolationLevel,
  Kysely,
  Transaction,
  TransactionBuilder
} from 'kysely'
import type {
  Plugin,
  KyseraExecutor,
  KyseraTransaction,
  QueryBuilderContext,
  ExecutorConfig,
  PluginValidationErrorType,
  PluginValidationDetails
} from './types.js'
import { LRUCache } from './lru-cache.js'

/** Methods that accept table name and should be intercepted */
export const INTERCEPTED_METHODS = [
  'selectFrom',
  'insertInto',
  'updateTable',
  'deleteFrom',
  'replaceInto', // MySQL REPLACE
  'mergeInto' // SQL MERGE (Kysely 0.28+)
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
    // Take first element (highest priority)
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
 * A parsed SQL table reference.
 *
 * Mirrors kysely's own grammar exactly (`parseAliasedTable`/`parseTable`):
 * `[schema.]table[ as alias]`, where the alias separator is the literal
 * lowercase string ` as ` and the schema separator is `.`.
 */
export interface ParsedTableReference {
  /** Base table name without schema qualifier or alias */
  readonly table: string
  /** Schema qualifier when present (`'public.users'` -> `'public'`) */
  readonly schema?: string
  /** Alias when present (`'users as u'` -> `'u'`) */
  readonly alias?: string
}

/**
 * Parse a table expression string the same way kysely does.
 *
 * @example
 * ```typescript
 * parseTableReference('users')              // { table: 'users' }
 * parseTableReference('users as u')         // { table: 'users', alias: 'u' }
 * parseTableReference('auth.users')         // { table: 'users', schema: 'auth' }
 * parseTableReference('auth.users as u')    // { table: 'users', schema: 'auth', alias: 'u' }
 * ```
 */
export function parseTableReference(expression: string): ParsedTableReference {
  // Kysely splits on the literal lowercase ' as ' (see kysely parseAliasedTable)
  const ALIAS_SEPARATOR = ' as '
  const SCHEMA_SEPARATOR = '.'

  let tablePart = expression
  let alias: string | undefined

  if (expression.includes(ALIAS_SEPARATOR)) {
    const [table = '', aliasPart = ''] = expression.split(ALIAS_SEPARATOR)
    tablePart = table.trim()
    alias = aliasPart.trim()
  }

  if (tablePart.includes(SCHEMA_SEPARATOR)) {
    const [schema = '', table = ''] = tablePart.split(SCHEMA_SEPARATOR)
    return alias !== undefined
      ? { table: table.trim(), schema: schema.trim(), alias }
      : { table: table.trim(), schema: schema.trim() }
  }

  return alias !== undefined ? { table: tablePart, alias } : { table: tablePart }
}

/**
 * Build the plugin context for a single parsed table reference.
 * An explicit schema qualifier in the expression wins over withSchema context.
 */
function buildContext(
  operation: QueryBuilderContext['operation'],
  expression: string,
  currentSchema: string | undefined,
  baseMetadata?: Readonly<Record<string, unknown>>
): QueryBuilderContext {
  const parsed = parseTableReference(expression)
  const schema = parsed.schema ?? currentSchema

  return {
    operation,
    table: parsed.table,
    ...(parsed.alias !== undefined && { alias: parsed.alias }),
    tableExpression: expression,
    ...(schema !== undefined && { schema }),
    metadata: baseMetadata ? { ...baseMetadata } : {}
  }
}

/** Apply all interceptors to a query builder for one table context */
function runInterceptors(
  qb: unknown,
  interceptors: readonly Plugin[],
  context: QueryBuilderContext
): unknown {
  let result = qb
  for (const plugin of interceptors) {
    if (plugin.interceptQuery) {
      try {
        result = plugin.interceptQuery(result, context)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Plugin "${plugin.name}" threw during interceptQuery for ${context.operation} on "${context.table}": ${message}`,
          { cause: error }
        )
      }
    }
  }
  return result
}

/**
 * Create intercepted method that applies plugins
 *
 * Handles every argument shape kysely accepts:
 * - `'users'` / `'users as u'` / `'auth.users as u'` — parsed; plugins receive
 *   the base table name plus alias/schema so filters stay correct and
 *   allowlists keep matching.
 * - `['users', 'posts as p']` (cross join) — plugins run once per string entry.
 * - Subqueries / dynamic table builders — passed through untouched: their
 *   inner builders never originate from this proxy, so plugins cannot target
 *   them here. Security-critical plugins (RLS) must not rely on interception
 *   for such shapes (documented in @kysera/rls).
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
  currentSchema?: string,
  baseMetadata?: Readonly<Record<string, unknown>>,
  cteNames?: ReadonlySet<string>
): (table: unknown) => unknown {
  const operation = METHOD_TO_OPERATION[method]

  return (table: unknown) => {
    /**
     * TYPE ASSERTION #3: Dynamic method access
     *
     * Cast: Kysely<DB> -> Record<string, (t: unknown) => unknown>
     *
     * Why needed:
     * - Kysely<DB> interface doesn't have an index signature
     * - TypeScript doesn't allow db[method] for dynamic property access
     *
     * Why safe:
     * - Method name validated against INTERCEPTED_METHODS constant
     * - Runtime check throws if method doesn't exist
     * - The argument is forwarded verbatim to the original method
     */
    const originalMethod = (db as unknown as Record<string, (t: unknown) => unknown>)[method]
    if (!originalMethod) {
      throw new Error(`Method ${method} not found on Kysely instance`)
    }
    // Call with correct 'this' context
    const qb = originalMethod.call(db, table)

    if (typeof table === 'string') {
      const context = buildContext(operation, table, currentSchema, baseMetadata)
      // CTE names are not real tables — plugins must not filter them
      if (cteNames?.has(context.table)) {
        return qb
      }
      return runInterceptors(qb, interceptors, context)
    }

    if (Array.isArray(table)) {
      // Cross-join form: apply plugins once per string table reference
      let result = qb
      for (const entry of table) {
        if (typeof entry === 'string') {
          const context = buildContext(operation, entry, currentSchema, baseMetadata)
          if (cteNames?.has(context.table)) {
            continue
          }
          result = runInterceptors(result, interceptors, context)
        }
      }
      return result
    }

    // Subquery / dynamic builder — cannot be attributed to a table name here
    return qb
  }
}

/** Marker properties Set for fast O(1) lookup */
const MARKER_PROPS = new Set<string | symbol>(['__kysera', '__plugins', '__rawDb', '__schema'])

/**
 * Kysely methods that return a derived Kysely instance sharing the same
 * connection/executor. Their results must be re-wrapped, otherwise plugin
 * interception (soft-delete, RLS, ...) would be silently lost.
 *
 * `$extendTables`/`$omitTables`/`$pickTables` are the kysely 0.29 type-level
 * helpers; `withTables` is their deprecated predecessor.
 */
const REWRAP_KYSELY_METHODS = new Set<string>([
  '$extendTables',
  '$omitTables',
  '$pickTables',
  'withTables',
  'withPlugin',
  'withoutPlugins'
])

/**
 * ControlledTransaction methods that return Command<ControlledTransaction>.
 * The command result must be re-wrapped so plugin interception survives
 * savepoint chains (kysely 0.28+ controlled transactions).
 */
const SAVEPOINT_METHODS = new Set<string>([
  'savepoint',
  'rollbackToSavepoint',
  'releaseSavepoint'
])

/** Shared empty interceptor list for marker-only wrapping */
const NO_INTERCEPTORS: readonly Plugin[] = []

/** Maximum size for LRU caches to prevent unbounded growth */
const MAX_CACHE_SIZE = 100

/**
 * Transaction builder wrapper that preserves the full TransactionBuilder
 * surface (isolation level, access mode) while ensuring the execute callback
 * receives a plugin-aware transaction.
 */
export interface WrappedTransactionBuilder<DB> {
  setAccessMode(accessMode: AccessMode): WrappedTransactionBuilder<DB>
  setIsolationLevel(isolationLevel: IsolationLevel): WrappedTransactionBuilder<DB>
  execute<T>(callback: (trx: Transaction<DB>) => Promise<T>): Promise<T>
}

/**
 * Controlled transaction builder wrapper (kysely `startTransaction()`).
 * The resulting ControlledTransaction is plugin-aware, including derived
 * transactions returned by savepoint commands.
 */
export interface WrappedControlledTransactionBuilder<DB> {
  setAccessMode(accessMode: AccessMode): WrappedControlledTransactionBuilder<DB>
  setIsolationLevel(isolationLevel: IsolationLevel): WrappedControlledTransactionBuilder<DB>
  execute(): Promise<ControlledTransaction<DB>>
}

/**
 * Build a wrapper for Kysely APIs that yield derived instances, or return
 * undefined when the property needs no special handling.
 *
 * Extracted from the proxy `get` trap to keep it small; results are cached
 * per proxy in `methodCache` by the caller.
 *
 * @internal
 */
/** Rewrap helpers passed from createProxy to the special-wrapper factory @internal */
interface RewrapHelpers<DB> {
  rewrap: (derived: Kysely<DB>, schema?: string) => KyseraExecutor<DB>
  /** Rewrap and register an additional CTE name for downstream interception skips */
  rewrapWithCte: (derived: Kysely<DB>, cteName: string) => KyseraExecutor<DB>
  schemaProxyCache: LRUCache<string, KyseraExecutor<DB>>
}

function createSpecialWrapper<DB>(
  target: Kysely<DB>,
  prop: string | symbol,
  helpers: RewrapHelpers<DB>
): unknown {
  const { rewrap, rewrapWithCte, schemaProxyCache } = helpers

  // Intercept withSchema to maintain plugin proxy and track schema
  if (prop === 'withSchema') {
    return (schema: string): KyseraExecutor<DB> => {
      const cachedSchemaProxy = schemaProxyCache.get(schema)
      if (cachedSchemaProxy) {
        return cachedSchemaProxy
      }
      // Pass schema to new proxy so it's available in QueryBuilderContext
      const newProxy = rewrap(target.withSchema(schema), schema)
      schemaProxyCache.set(schema, newProxy)
      return newProxy
    }
  }

  // Intercept with()/withRecursive() for CTEs.
  // Kysely 0.29 accepts either a callback or a ready-made expression as the
  // second argument — only callbacks are wrapped; expressions pass through.
  // The returned query creator is re-wrapped so subsequent selectFrom() etc.
  // keep plugin interception. The CTE name is registered so that
  // selectFrom('<cte>') downstream is NOT treated as a real table by plugins
  // (soft-delete would otherwise emit `<cte>.deleted_at` — invalid SQL).
  if (prop === 'with' || prop === 'withRecursive') {
    return (nameOrBuilder: unknown, expression: unknown): unknown => {
      const originalMethod = Reflect.get(target, prop) as (
        n: unknown,
        e: unknown
      ) => Kysely<DB>
      const wrappedExpression =
        typeof expression === 'function'
          ? (creator: Kysely<DB>) =>
              (expression as (db: Kysely<DB>) => unknown)(rewrap(creator))
          : expression
      const result = originalMethod.call(target, nameOrBuilder, wrappedExpression)
      // String form: 'name' or 'name(col1, col2)' — register the bare name.
      // Callback CTE-builder form has no statically known name; skipped.
      if (typeof nameOrBuilder === 'string') {
        const cteName = (nameOrBuilder.split('(')[0] ?? '').trim()
        if (cteName.length > 0) {
          return rewrapWithCte(result, cteName)
        }
      }
      return rewrap(result)
    }
  }

  // Methods returning a derived Kysely instance — re-wrap to keep interception
  // ($pickTables/$omitTables/$extendTables/withTables/withPlugin/withoutPlugins)
  if (typeof prop === 'string' && REWRAP_KYSELY_METHODS.has(prop)) {
    const originalMethod = Reflect.get(target, prop)
    if (typeof originalMethod === 'function') {
      return (...args: unknown[]): KyseraExecutor<DB> =>
        rewrap((originalMethod as (...a: unknown[]) => Kysely<DB>).apply(target, args))
    }
    return undefined
  }

  // ControlledTransaction savepoint commands — re-wrap the transaction
  // returned by Command.execute() so plugins survive savepoint chains
  if (typeof prop === 'string' && SAVEPOINT_METHODS.has(prop)) {
    const originalMethod = Reflect.get(target, prop)
    if (typeof originalMethod === 'function') {
      return (...args: unknown[]): { execute: () => Promise<KyseraExecutor<DB>> } => {
        const command = (
          originalMethod as (...a: unknown[]) => { execute: () => Promise<unknown> }
        ).apply(target, args)
        return {
          execute: async () => rewrap((await command.execute()) as Kysely<DB>)
        }
      }
    }
    return undefined
  }

  // Full TransactionBuilder surface; the callback receives a plugin-aware
  // transaction (setIsolationLevel/setAccessMode are preserved)
  if (prop === 'transaction') {
    const wrapBuilder = (builder: TransactionBuilder<DB>): WrappedTransactionBuilder<DB> => ({
      setAccessMode: accessMode => wrapBuilder(builder.setAccessMode(accessMode)),
      setIsolationLevel: isolationLevel =>
        wrapBuilder(builder.setIsolationLevel(isolationLevel)),
      execute: async <T>(callback: (trx: Transaction<DB>) => Promise<T>): Promise<T> =>
        builder.execute(trx =>
          /**
           * TYPE ASSERTION #2: Transaction <-> Kysely for proxy round-trip
           *
           * Transaction<DB> extends Kysely<DB>; the proxy preserves all
           * Transaction methods and only adds marker properties, so the
           * round-trip Transaction -> proxy -> Transaction is safe.
           */
          callback(rewrap(trx as unknown as Kysely<DB>) as unknown as Transaction<DB>)
        )
    })
    return (): WrappedTransactionBuilder<DB> => wrapBuilder(target.transaction())
  }

  // Controlled transactions (kysely 0.28+): the resulting transaction is
  // re-proxied; savepoint commands are handled by SAVEPOINT_METHODS above
  if (prop === 'startTransaction') {
    const wrapControlled = (
      builder: ControlledTransactionBuilder<DB>
    ): WrappedControlledTransactionBuilder<DB> => ({
      setAccessMode: accessMode => wrapControlled(builder.setAccessMode(accessMode)),
      setIsolationLevel: isolationLevel =>
        wrapControlled(builder.setIsolationLevel(isolationLevel)),
      execute: async (): Promise<ControlledTransaction<DB>> => {
        const trx = await builder.execute()
        // ControlledTransaction extends Kysely; the proxy only adds markers
        return rewrap(trx) as unknown as ControlledTransaction<DB>
      }
    })
    return (): WrappedControlledTransactionBuilder<DB> =>
      wrapControlled(target.startTransaction())
  }

  // Dedicated connection: callback receives a plugin-aware instance
  if (prop === 'connection') {
    return (): {
      execute: <T>(
        callback: (conn: Kysely<DB>) => Promise<T>,
        options?: Parameters<ConnectionBuilder<DB>['execute']>[1]
      ) => Promise<T>
    } => {
      const builder = target.connection()
      return {
        execute: (callback, options) =>
          builder.execute(conn => callback(rewrap(conn)), options)
      }
    }
  }

  return undefined
}

/**
 * Create plugin-aware executor using Proxy.
 *
 * Handles marker properties, query-method interception, and re-wrapping of
 * every Kysely API that yields a derived instance (see module header).
 * Optimized with per-proxy method caches and Set-based lookups.
 *
 * @param db - Kysely database instance (or Transaction/ControlledTransaction)
 * @param interceptors - Plugins with interceptQuery methods (may be empty)
 * @param allPlugins - All registered plugins
 * @param currentSchema - Optional schema context (from withSchema)
 */
function createProxy<DB>(
  db: Kysely<DB>,
  interceptors: readonly Plugin[],
  allPlugins: readonly Plugin[],
  currentSchema?: string,
  baseMetadata?: Readonly<Record<string, unknown>>,
  cteNames?: ReadonlySet<string>
): KyseraExecutor<DB> {
  // Cache for bound/wrapped methods to avoid repeated allocations
  const methodCache = new Map<string | symbol, unknown>()

  // Cache intercepted methods to avoid repeated creation
  const interceptedCache = new Map<string, (table: unknown) => unknown>()

  // LRU cache for withSchema to prevent unbounded growth (max 100 schemas)
  const schemaProxyCache = new LRUCache<string, KyseraExecutor<DB>>(MAX_CACHE_SIZE)

  /** Re-wrap a derived instance, preserving plugins, schema and metadata context */
  const rewrap = (derived: Kysely<DB>, schema?: string): KyseraExecutor<DB> =>
    createProxy(derived, interceptors, allPlugins, schema ?? currentSchema, baseMetadata, cteNames)

  /** Re-wrap registering one more CTE name (with()/withRecursive() results) */
  const rewrapWithCte = (derived: Kysely<DB>, cteName: string): KyseraExecutor<DB> =>
    createProxy(
      derived,
      interceptors,
      allPlugins,
      currentSchema,
      baseMetadata,
      new Set([...(cteNames ?? []), cteName])
    )

  const handler: ProxyHandler<Kysely<DB>> = {
    // Handle 'in' operator for type guards
    has(target, prop) {
      if (MARKER_PROPS.has(prop)) return true
      return Reflect.has(target, prop)
    },

    get(target, prop) {
      // Fast path: marker properties (O(1) checks)
      if (prop === '__kysera') return true
      if (prop === '__plugins') return allPlugins
      if (prop === '__rawDb') return target
      if (prop === '__schema') return currentSchema

      // Fast path: check intercepted methods first (most common hot path).
      // Skipped entirely when no plugin intercepts queries.
      if (
        interceptors.length > 0 &&
        typeof prop === 'string' &&
        INTERCEPTED_METHODS_SET.has(prop)
      ) {
        let intercepted = interceptedCache.get(prop)
        if (!intercepted) {
          intercepted = createInterceptedMethod(
            target,
            prop as InterceptedMethod,
            interceptors,
            currentSchema,
            baseMetadata,
            cteNames
          )
          interceptedCache.set(prop, intercepted)
        }
        return intercepted
      }

      // Cached wrappers and bound methods
      if (methodCache.has(prop)) {
        return methodCache.get(prop)
      }

      // Derived-instance APIs (withSchema/with/transaction/connection/...)
      const special = createSpecialWrapper(target, prop, { rewrap, rewrapWithCte, schemaProxyCache })
      if (special !== undefined) {
        methodCache.set(prop, special)
        return special
      }

      /**
       * Generic path.
       *
       * IMPORTANT: receiver is intentionally NOT forwarded to Reflect.get.
       * Kysely getters (e.g. `db.schema`) access native `#private` fields; with
       * the proxy as receiver they would throw "Cannot read private member".
       * Non-function values (including stateful getters like `isCommitted`) are
       * returned uncached; functions are bound to the target and cached.
       */
      const value = Reflect.get(target, prop)

      if (typeof value === 'function') {
        const bound = value.bind(target) as unknown
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
 * Near-zero overhead if no plugins have interceptQuery (marker-only proxy)
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

  // Fast path: no plugins or disabled — marker-only proxy (no interception)
  if (plugins.length === 0 || !enabled) {
    return createProxy(db, NO_INTERCEPTORS, plugins)
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
    return createProxy(db, NO_INTERCEPTORS, plugins)
  }

  validatePlugins(plugins)
  const sorted = resolvePluginOrder(plugins)
  const interceptors = sorted.filter(p => p.interceptQuery)

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

  /**
   * TYPE ASSERTION: Transaction -> Kysely -> KyseraTransaction
   *
   * Transaction<DB> extends Kysely<DB>; the proxy preserves all Transaction
   * methods and only adds marker properties, so the cast chain is safe.
   */
  return createProxy(
    trx as unknown as Kysely<DB>,
    interceptors,
    plugins
  ) as unknown as KyseraTransaction<DB>
}

/**
 * Derive an executor whose plugin contexts start with the given metadata.
 *
 * This is the SAFE alternative to `getRawDb` when a caller needs to opt out
 * of ONE plugin's behavior while keeping every other plugin active. Plugins
 * read the metadata in `interceptQuery` (e.g. soft-delete skips its filter
 * when `metadata.includeDeleted === true`).
 *
 * **Security contract for plugin authors:** this channel is reachable by any
 * caller holding the executor, WITHOUT any authentication context. Plugins
 * may honor *behavioral* opt-outs here (visibility of soft-deleted rows,
 * verbosity, ...), but MUST NOT honor security bypasses — @kysera/rls
 * deliberately ignores this channel entirely for that reason.
 *
 * Returns the executor unchanged when it is not a KyseraExecutor (no plugins
 * to parameterize).
 *
 * @example
 * ```typescript
 * const withDeleted = withPluginMetadata(executor, { includeDeleted: true })
 * // soft-delete's own filter off; security plugins unaffected by metadata:
 * const rows = await withDeleted.selectFrom('users').selectAll().execute()
 * ```
 */
export function withPluginMetadata<DB>(
  executor: Kysely<DB>,
  metadata: Readonly<Record<string, unknown>>
): Kysely<DB> {
  if (!isKyseraExecutor(executor)) {
    return executor
  }
  const plugins = executor.__plugins
  return createProxy(
    executor.__rawDb,
    plugins.filter(p => p.interceptQuery),
    plugins,
    executor.__schema,
    metadata
  )
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
      try {
        result = plugin.interceptQuery(result, context)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Plugin "${plugin.name}" threw during interceptQuery for ${context.operation} on "${context.table}": ${message}`,
          { cause: error }
        )
      }
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
  const errors: { plugin: string; error: unknown }[] = []

  // Call onDestroy in reverse order (cleanup in reverse of initialization)
  // Continue through all plugins even if some throw — collect errors
  for (let i = plugins.length - 1; i >= 0; i--) {
    const plugin = plugins[i]
    if (plugin?.onDestroy) {
      try {
        await plugin.onDestroy()
      } catch (error) {
        errors.push({ plugin: plugin.name, error })
      }
    }
  }

  // If any plugins failed to destroy, throw aggregate error
  if (errors.length > 0) {
    const messages = errors.map(e => `${e.plugin}: ${e.error instanceof Error ? e.error.message : String(e.error)}`)
    throw new Error(`Failed to destroy ${String(errors.length)} plugin(s): ${messages.join('; ')}`)
  }
}
