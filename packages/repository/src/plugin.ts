import type { Kysely } from 'kysely'
import type { AnyQueryBuilder } from './types'

export interface QueryBuilderContext {
  operation: 'select' | 'insert' | 'update' | 'delete'
  table: string
  metadata: Record<string, unknown>
}

export interface QueryContext extends QueryBuilderContext {
  sql: string
  params: unknown[]
}

/**
 * Plugin interface with query builder interception
 */
export interface Plugin {
  name: string
  version: string

  // Lifecycle hooks
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void

  // Query builder interceptors (can modify query)
  interceptQuery?<QB extends AnyQueryBuilder>(
    qb: QB,
    context: QueryBuilderContext
  ): QB

  // Result interceptors (post-execution)
  afterQuery?(context: QueryContext, result: unknown): Promise<unknown> | unknown
  onError?(context: QueryContext, error: unknown): Promise<void> | void

  // Repository extensions
  extendRepository?<T extends object>(repo: T): T
}

/**
 * Plugin application function type
 */
export type ApplyPluginsFunction = <QB extends AnyQueryBuilder>(
  qb: QB,
  operation: string,
  table: string,
  metadata?: Record<string, unknown>
) => QB

/**
 * ORM with plugin support
 */
export interface PluginOrm<DB> {
  executor: Kysely<DB>
  createRepository: <T extends object>(
    factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T
  ) => T
  applyPlugins: ApplyPluginsFunction
  plugins: Plugin[]
}

/**
 * Create ORM with plugin support
 */
export async function createORM<DB>(
  executor: Kysely<DB>,
  plugins: Plugin[] = []
): Promise<PluginOrm<DB>> {
  // Initialize plugins
  for (const plugin of plugins) {
    const result = plugin.onInit?.(executor)
    if (result instanceof Promise) {
      await result
    }
  }

  // Helper to apply plugin interceptors to queries
  function applyPlugins<QB extends AnyQueryBuilder>(
    qb: QB,
    operation: string,
    table: string,
    metadata: Record<string, unknown> = {}
  ): QB {
    let result = qb

    for (const plugin of plugins) {
      if (plugin.interceptQuery) {
        result = plugin.interceptQuery(result, {
          operation: operation as 'select' | 'insert' | 'update' | 'delete',
          table,
          metadata
        })
      }
    }

    return result
  }

  // Create enhanced repositories
  function createRepository<T extends object>(
    factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T
  ): T {
    let repo = factory(executor, applyPlugins)

    for (const plugin of plugins) {
      if (plugin.extendRepository) {
        repo = plugin.extendRepository(repo)
      }
    }

    return repo
  }

  return {
    executor,
    createRepository,
    applyPlugins,
    plugins
  }
}

/**
 * Repository method wrapper for automatic plugin application
 */
interface RepositoryMethod {
  (...args: unknown[]): unknown
}

/**
 * Wrap a repository method to automatically apply plugins
 */
function wrapMethod<T extends RepositoryMethod>(
  method: T,
  context: unknown
): T {
  return function wrappedMethod(...args: unknown[]): unknown {
    return method.apply(context, args)
  } as T
}

/**
 * Helper to reduce repository boilerplate with plugins
 */
export async function withPlugins<DB, T extends object>(
  factory: (executor: Kysely<DB>) => T,
  executor: Kysely<DB>,
  plugins: Plugin[]
): Promise<T> {
  const orm = await createORM(executor, plugins)

  return orm.createRepository((exec: Kysely<DB>, _applyPlugins: ApplyPluginsFunction) => {
    const base = factory(exec)

    // Create a new object with wrapped methods
    const wrappedRepo = {} as T

    for (const [key, value] of Object.entries(base)) {
      if (typeof value === 'function') {
        (wrappedRepo as Record<string, unknown>)[key] = wrapMethod(
          value as RepositoryMethod,
          base
        )
      } else {
        (wrappedRepo as Record<string, unknown>)[key] = value
      }
    }

    return wrappedRepo
  })
}