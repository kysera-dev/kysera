/**
 * @kysera/executor - KyseraExecutor Implementation
 * @module @kysera/executor
 */

import type { Kysely, Transaction } from 'kysely';
import type {
  Plugin,
  KyseraExecutor,
  KyseraTransaction,
  QueryBuilderContext,
  ExecutorConfig,
  PluginValidationErrorType,
  PluginValidationDetails,
} from './types.js';

/** Methods that accept table name and should be intercepted */
const INTERCEPTED_METHODS = [
  'selectFrom',
  'insertInto',
  'updateTable',
  'deleteFrom',
] as const;

type InterceptedMethod = (typeof INTERCEPTED_METHODS)[number];

/** Pre-computed Set for O(1) lookup instead of Array.includes O(n) */
const INTERCEPTED_METHODS_SET: Set<string> = new Set(INTERCEPTED_METHODS);

/** Map method names to operation types */
const METHOD_TO_OPERATION: Record<InterceptedMethod, QueryBuilderContext['operation']> = {
  selectFrom: 'select',
  insertInto: 'insert',
  updateTable: 'update',
  deleteFrom: 'delete',
};

/**
 * Plugin validation error
 */
export class PluginValidationError extends Error {
  constructor(
    message: string,
    public readonly type: PluginValidationErrorType,
    public readonly details: PluginValidationDetails
  ) {
    super(message);
    this.name = 'PluginValidationError';
  }
}

/**
 * Validate plugins for conflicts, duplicates, and missing dependencies
 */
export function validatePlugins(plugins: readonly Plugin[]): void {
  const names = new Set<string>();

  for (const plugin of plugins) {
    if (names.has(plugin.name)) {
      throw new PluginValidationError(
        `Duplicate plugin: "${plugin.name}"`,
        'DUPLICATE_NAME',
        { pluginName: plugin.name }
      );
    }
    names.add(plugin.name);
  }

  for (const plugin of plugins) {
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!names.has(dep)) {
          throw new PluginValidationError(
            `Plugin "${plugin.name}" requires "${dep}" which is not registered`,
            'MISSING_DEPENDENCY',
            { pluginName: plugin.name, missingDependency: dep }
          );
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
          );
        }
      }
    }
  }

  detectCircularDependencies(plugins);
}

/**
 * Detect circular dependencies using DFS
 */
function detectCircularDependencies(plugins: readonly Plugin[]): void {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];
  const map = new Map(plugins.map((p) => [p.name, p]));

  function dfs(name: string): void {
    visited.add(name);
    stack.add(name);
    path.push(name);

    const plugin = map.get(name);
    if (plugin?.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!visited.has(dep)) {
          dfs(dep);
        } else if (stack.has(dep)) {
          const start = path.indexOf(dep);
          const cycle = [...path.slice(start), dep];
          throw new PluginValidationError(
            `Circular dependency: ${cycle.join(' -> ')}`,
            'CIRCULAR_DEPENDENCY',
            { pluginName: name, cycle }
          );
        }
      }
    }

    path.pop();
    stack.delete(name);
  }

  for (const plugin of plugins) {
    if (!visited.has(plugin.name)) {
      dfs(plugin.name);
    }
  }
}

/**
 * Resolve plugin execution order using topological sort with priority
 */
export function resolvePluginOrder(plugins: readonly Plugin[]): Plugin[] {
  if (plugins.length === 0) return [];

  const map = new Map(plugins.map((p) => [p.name, p]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();

  for (const plugin of plugins) {
    inDegree.set(plugin.name, 0);
    dependents.set(plugin.name, new Set());
  }

  for (const plugin of plugins) {
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        inDegree.set(plugin.name, (inDegree.get(plugin.name) ?? 0) + 1);
        dependents.get(dep)?.add(plugin.name);
      }
    }
  }

  const result: Plugin[] = [];
  const available = plugins.filter((p) => (inDegree.get(p.name) ?? 0) === 0);

  while (available.length > 0) {
    // Sort by priority (higher first), then by name for stability
    available.sort((a, b) => {
      const pA = a.priority ?? 0;
      const pB = b.priority ?? 0;
      return pA !== pB ? pB - pA : a.name.localeCompare(b.name);
    });

    const current = available.shift()!;
    result.push(current);

    const deps = dependents.get(current.name);
    if (deps) {
      for (const dep of deps) {
        const newDegree = (inDegree.get(dep) ?? 0) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) {
          const plugin = map.get(dep);
          if (plugin) available.push(plugin);
        }
      }
    }
  }

  return result;
}

/**
 * Create intercepted method that applies plugins
 */
function createInterceptedMethod<DB>(
  db: Kysely<DB>,
  method: InterceptedMethod,
  interceptors: readonly Plugin[]
): (table: string) => unknown {
  const operation = METHOD_TO_OPERATION[method];

  return (table: string) => {
    // Call original method - safely access the method on db
    const originalMethod = (db as unknown as Record<string, (t: string) => unknown>)[method];
    if (!originalMethod) {
      throw new Error(`Method ${method} not found on Kysely instance`);
    }
    // Call with correct 'this' context
    let qb = originalMethod.call(db, table);

    // Apply interceptors
    const context: QueryBuilderContext = {
      operation,
      table,
      metadata: {},
    };

    for (const plugin of interceptors) {
      if (plugin.interceptQuery) {
        qb = plugin.interceptQuery(qb, context);
      }
    }

    return qb;
  };
}

/** Marker properties Set for fast O(1) lookup */
const MARKER_PROPS: Set<string | symbol> = new Set(['__kysera', '__plugins', '__rawDb']);

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
  const methodCache = new Map<string | symbol, unknown>();

  // Cache intercepted methods to avoid repeated creation
  const interceptedCache = new Map<string, (table: string) => unknown>();

  // Cached transaction wrapper (created once, reused)
  let cachedTransactionWrapper: (() => { execute: <T>(fn: (trx: Transaction<DB>) => Promise<T>) => Promise<T> }) | null = null;

  const handler: ProxyHandler<Kysely<DB>> = {
    // Handle 'in' operator for type guards
    has(target, prop) {
      if (MARKER_PROPS.has(prop)) return true;
      return Reflect.has(target, prop);
    },

    get(target, prop, receiver) {
      // Fast path: marker properties (O(1) Set lookup)
      if (prop === '__kysera') return true;
      if (prop === '__plugins') return allPlugins;
      if (prop === '__rawDb') return target;

      // Fast path: check intercepted methods first (most common hot path)
      if (typeof prop === 'string' && INTERCEPTED_METHODS_SET.has(prop)) {
        let intercepted = interceptedCache.get(prop);
        if (!intercepted) {
          intercepted = createInterceptedMethod(target, prop as InterceptedMethod, interceptors);
          interceptedCache.set(prop, intercepted);
        }
        return intercepted;
      }

      // Cached transaction wrapper
      if (prop === 'transaction') {
        if (!cachedTransactionWrapper) {
          cachedTransactionWrapper = () => ({
            execute: async <T>(fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> => {
              return target.transaction().execute(async (trx) => {
                const wrappedTrx = createProxy(
                  trx as unknown as Kysely<DB>,
                  interceptors,
                  allPlugins
                );
                return fn(wrappedTrx as unknown as Transaction<DB>);
              });
            },
          });
        }
        return cachedTransactionWrapper;
      }

      // Check method cache for bound functions
      if (methodCache.has(prop)) {
        return methodCache.get(prop);
      }

      const value = Reflect.get(target, prop, receiver);

      // Cache bound methods to avoid repeated .bind() allocations
      if (typeof value === 'function') {
        const bound = value.bind(target);
        methodCache.set(prop, bound);
        return bound;
      }

      return value;
    },
  };

  return new Proxy(db, handler) as KyseraExecutor<DB>;
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
  const { enabled = true } = config;

  // Fast path: no plugins or disabled
  if (plugins.length === 0 || !enabled) {
    return Object.assign(db, {
      __kysera: true as const,
      __plugins: plugins,
      __rawDb: db,
    }) as KyseraExecutor<DB>;
  }

  // Validate and sort plugins
  validatePlugins(plugins);
  const sorted = resolvePluginOrder(plugins);

  // Initialize plugins
  for (const plugin of sorted) {
    await plugin.onInit?.(db);
  }

  // Filter plugins with interceptQuery for performance
  const interceptors = sorted.filter((p) => p.interceptQuery);

  // Fast path: no interceptors
  if (interceptors.length === 0) {
    return Object.assign(db, {
      __kysera: true as const,
      __plugins: sorted,
      __rawDb: db,
    }) as KyseraExecutor<DB>;
  }

  // Create proxy with interception
  return createProxy(db, interceptors, sorted);
}

/**
 * Synchronous version of createExecutor (no plugin initialization)
 */
export function createExecutorSync<DB>(
  db: Kysely<DB>,
  plugins: readonly Plugin[] = [],
  config: ExecutorConfig = {}
): KyseraExecutor<DB> {
  const { enabled = true } = config;

  if (plugins.length === 0 || !enabled) {
    return Object.assign(db, {
      __kysera: true as const,
      __plugins: plugins,
      __rawDb: db,
    }) as KyseraExecutor<DB>;
  }

  validatePlugins(plugins);
  const sorted = resolvePluginOrder(plugins);
  const interceptors = sorted.filter((p) => p.interceptQuery);

  if (interceptors.length === 0) {
    return Object.assign(db, {
      __kysera: true as const,
      __plugins: sorted,
      __rawDb: db,
    }) as KyseraExecutor<DB>;
  }

  return createProxy(db, interceptors, sorted);
}

/**
 * Check if value is a KyseraExecutor
 */
export function isKyseraExecutor<DB>(
  value: Kysely<DB> | KyseraExecutor<DB>
): value is KyseraExecutor<DB> {
  return '__kysera' in value && value.__kysera === true;
}

/**
 * Get plugins from executor
 */
export function getPlugins<DB>(executor: KyseraExecutor<DB>): readonly Plugin[] {
  return executor.__plugins;
}

/**
 * Wrap transaction with plugins
 */
export function wrapTransaction<DB>(
  trx: Transaction<DB>,
  plugins: readonly Plugin[]
): KyseraTransaction<DB> {
  const interceptors = plugins.filter((p) => p.interceptQuery);

  if (interceptors.length === 0) {
    return Object.assign(trx, {
      __kysera: true as const,
      __plugins: plugins,
      __rawDb: trx,
    }) as KyseraTransaction<DB>;
  }

  return createProxy(
    trx as unknown as Kysely<DB>,
    interceptors,
    plugins
  ) as unknown as KyseraTransaction<DB>;
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
  let result = qb;
  for (const plugin of plugins) {
    if (plugin.interceptQuery) {
      result = plugin.interceptQuery(result, context);
    }
  }
  return result;
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
  const kyseraExecutor = executor as unknown as KyseraExecutor<DB>;
  return kyseraExecutor.__rawDb ?? executor;
}
