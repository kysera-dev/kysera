import type { Kysely } from 'kysely';
import type { AnyQueryBuilder } from './types.js';
import { PluginErrorCodes, type ErrorCode } from '@kysera/core';

export interface QueryBuilderContext {
  operation: 'select' | 'insert' | 'update' | 'delete';
  table: string;
  metadata: Record<string, unknown>;
}

export interface QueryContext extends QueryBuilderContext {
  sql: string;
  params: unknown[];
}

/**
 * Plugin validation error codes using unified ErrorCodes system
 */
export const PluginValidationErrorCodes = {
  MISSING_DEPENDENCY: PluginErrorCodes.PLUGIN_DEPENDENCY_MISSING,
  CIRCULAR_DEPENDENCY: PluginErrorCodes.PLUGIN_CONFLICT,
  CONFLICT: PluginErrorCodes.PLUGIN_CONFLICT,
  DUPLICATE_NAME: PluginErrorCodes.PLUGIN_DUPLICATE,
} as const;

export type PluginValidationErrorCode = keyof typeof PluginValidationErrorCodes;

/**
 * Plugin interface with query builder interception and dependency management
 */
export interface Plugin {
  name: string;
  version: string;

  /** Names of plugins this plugin depends on (must be loaded first) */
  dependencies?: string[];

  /** Higher priority = runs first (default: 0) */
  priority?: number;

  /** Names of plugins that cannot be used together with this plugin */
  conflictsWith?: string[];

  // Lifecycle hooks
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void;

  // Query builder interceptors (can modify query)
  interceptQuery?<QB extends AnyQueryBuilder>(qb: QB, context: QueryBuilderContext): QB;

  // Result interceptors (post-execution)
  afterQuery?(context: QueryContext, result: unknown): Promise<unknown> | unknown;
  onError?(context: QueryContext, error: unknown): Promise<void> | void;

  // Repository extensions
  extendRepository?<T extends object>(repo: T): T;
}

/**
 * Error thrown when plugin validation fails
 *
 * Uses unified ErrorCodes from @kysera/core for consistency
 */
export class PluginValidationError extends Error {
  /** Unified error code from @kysera/core */
  public readonly unifiedCode: ErrorCode;

  constructor(
    message: string,
    public readonly code: PluginValidationErrorCode,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'PluginValidationError';
    this.unifiedCode = PluginValidationErrorCodes[code];
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      unifiedCode: this.unifiedCode,
      details: this.details,
    };
  }
}

/**
 * Validate plugins for conflicts, missing dependencies, and duplicates
 * @throws PluginValidationError if validation fails
 */
export function validatePlugins(plugins: Plugin[]): void {
  const pluginNames = new Set<string>();
  const pluginMap = new Map<string, Plugin>();
  
  // Check for duplicate names
  for (const plugin of plugins) {
    if (pluginNames.has(plugin.name)) {
      throw new PluginValidationError(
        `Duplicate plugin name: "${plugin.name}"`,
        'DUPLICATE_NAME',
        { pluginName: plugin.name }
      );
    }
    pluginNames.add(plugin.name);
    pluginMap.set(plugin.name, plugin);
  }
  
  // Check for missing dependencies
  for (const plugin of plugins) {
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!pluginNames.has(dep)) {
          throw new PluginValidationError(
            `Plugin "${plugin.name}" depends on "${dep}" which is not registered`,
            'MISSING_DEPENDENCY',
            { pluginName: plugin.name, missingDependency: dep }
          );
        }
      }
    }
  }
  
  // Check for conflicts
  for (const plugin of plugins) {
    if (plugin.conflictsWith) {
      for (const conflict of plugin.conflictsWith) {
        if (pluginNames.has(conflict)) {
          throw new PluginValidationError(
            `Plugin "${plugin.name}" conflicts with "${conflict}"`,
            'CONFLICT',
            { pluginName: plugin.name, conflictingPlugin: conflict }
          );
        }
      }
    }
  }
  
  // Check for circular dependencies
  detectCircularDependencies(plugins);
}

/**
 * Detect circular dependencies using depth-first search
 * @throws PluginValidationError if circular dependency is found
 */
function detectCircularDependencies(plugins: Plugin[]): void {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];
  const pluginMap = new Map(plugins.map(p => [p.name, p]));
  
  function dfs(name: string): void {
    visited.add(name);
    recursionStack.add(name);
    path.push(name);
    
    const plugin = pluginMap.get(name);
    if (plugin?.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!visited.has(dep)) {
          dfs(dep);
        } else if (recursionStack.has(dep)) {
          // Found a cycle
          const cycleStart = path.indexOf(dep);
          const cycle = [...path.slice(cycleStart), dep];
          throw new PluginValidationError(
            'Circular dependency detected: ' + cycle.join(' -> '),
            'CIRCULAR_DEPENDENCY',
            { cycle }
          );
        }
      }
    }
    
    path.pop();
    recursionStack.delete(name);
  }
  
  for (const plugin of plugins) {
    if (!visited.has(plugin.name)) {
      dfs(plugin.name);
    }
  }
}

/**
 * Resolve plugin order based on dependencies and priority
 * Uses topological sort with priority consideration within groups
 */
export function resolvePluginOrder(plugins: Plugin[]): Plugin[] {
  if (plugins.length === 0) {
    return [];
  }
  
  // Build dependency graph
  const pluginMap = new Map(plugins.map(p => [p.name, p]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  
  // Initialize
  for (const plugin of plugins) {
    inDegree.set(plugin.name, 0);
    dependents.set(plugin.name, new Set());
  }
  
  // Calculate in-degrees and build reverse adjacency list
  for (const plugin of plugins) {
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        // This plugin depends on dep, so dep must come before this plugin
        inDegree.set(plugin.name, (inDegree.get(plugin.name) ?? 0) + 1);
        dependents.get(dep)?.add(plugin.name);
      }
    }
  }
  
  // Kahn's algorithm with priority consideration
  const result: Plugin[] = [];
  
  // Get all plugins with no dependencies
  let available = plugins.filter(p => (inDegree.get(p.name) ?? 0) === 0);
  
  while (available.length > 0) {
    // Sort available plugins by priority (higher first), then by name for stability
    available.sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      if (priorityB !== priorityA) {
        return priorityB - priorityA; // Higher priority first
      }
      return a.name.localeCompare(b.name); // Alphabetical for stability
    });
    
    // Take the highest priority plugin
    const current = available.shift()!;
    result.push(current);
    
    // Update in-degrees for dependents
    const deps = dependents.get(current.name);
    if (deps) {
      for (const dep of deps) {
        const newDegree = (inDegree.get(dep) ?? 0) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) {
          const plugin = pluginMap.get(dep);
          if (plugin) {
            available.push(plugin);
          }
        }
      }
    }
  }
  
  // If we didn't process all plugins, there's a cycle (should be caught by validation)
  if (result.length !== plugins.length) {
    throw new PluginValidationError(
      'Could not resolve plugin order - possible circular dependency',
      'CIRCULAR_DEPENDENCY',
      { resolvedCount: result.length, totalCount: plugins.length }
    );
  }
  
  return result;
}

/**
 * Plugin application function type
 */
export type ApplyPluginsFunction = <QB extends AnyQueryBuilder>(
  qb: QB,
  operation: string,
  table: string,
  metadata?: Record<string, unknown>
) => QB;

/**
 * ORM with plugin support
 */
export interface PluginOrm<DB> {
  executor: Kysely<DB>;
  createRepository: <T extends object>(factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T) => T;
  applyPlugins: ApplyPluginsFunction;
  plugins: Plugin[];
}

/**
 * Create ORM with plugin support
 * Automatically validates and resolves plugin order based on dependencies
 */
export async function createORM<DB>(executor: Kysely<DB>, plugins: Plugin[] = []): Promise<PluginOrm<DB>> {
  // Validate and resolve plugin order
  if (plugins.length > 0) {
    validatePlugins(plugins);
    plugins = resolvePluginOrder(plugins);
  }
  
  // Initialize plugins in resolved order
  for (const plugin of plugins) {
    const result = plugin.onInit?.(executor);
    if (result instanceof Promise) {
      await result;
    }
  }

  // Helper to apply plugin interceptors to queries
  function applyPlugins<QB extends AnyQueryBuilder>(
    qb: QB,
    operation: string,
    table: string,
    metadata: Record<string, unknown> = {}
  ): QB {
    let result = qb;

    for (const plugin of plugins) {
      if (plugin.interceptQuery) {
        result = plugin.interceptQuery(result, {
          operation: operation as 'select' | 'insert' | 'update' | 'delete',
          table,
          metadata,
        });
      }
    }

    return result;
  }

  // Create enhanced repositories
  function createRepository<T extends object>(
    factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T
  ): T {
    let repo = factory(executor, applyPlugins);

    for (const plugin of plugins) {
      if (plugin.extendRepository) {
        repo = plugin.extendRepository(repo);
      }
    }

    return repo;
  }

  return {
    executor,
    createRepository,
    applyPlugins,
    plugins,
  };
}

/**
 * Repository method wrapper for automatic plugin application
 */
interface RepositoryMethod {
  (...args: unknown[]): unknown;
}

/**
 * Wrap a repository method to automatically apply plugins
 */
function wrapMethod<T extends RepositoryMethod>(method: T, context: unknown): T {
  return function wrappedMethod(...args: unknown[]): unknown {
    return method.apply(context, args);
  } as T;
}

/**
 * Helper to reduce repository boilerplate with plugins
 */
export async function withPlugins<DB, T extends object>(
  factory: (executor: Kysely<DB>) => T,
  executor: Kysely<DB>,
  plugins: Plugin[]
): Promise<T> {
  const orm = await createORM(executor, plugins);

  return orm.createRepository((exec: Kysely<DB>, _applyPlugins: ApplyPluginsFunction) => {
    const base = factory(exec);

    // Create a new object with wrapped methods
    const wrappedRepo = {} as T;

    for (const [key, value] of Object.entries(base)) {
      if (typeof value === 'function') {
        (wrappedRepo as Record<string, unknown>)[key] = wrapMethod(value as RepositoryMethod, base);
      } else {
        (wrappedRepo as Record<string, unknown>)[key] = value;
      }
    }

    return wrappedRepo;
  });
}
