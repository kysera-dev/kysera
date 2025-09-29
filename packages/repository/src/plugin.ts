import type { SelectQueryBuilder, InsertQueryBuilder, UpdateQueryBuilder, DeleteQueryBuilder } from 'kysely'
import type { Executor } from '@kysera/core'

// Generic query builder type
export type AnyQueryBuilder =
  | SelectQueryBuilder<any, any, any>
  | InsertQueryBuilder<any, any, any>
  | UpdateQueryBuilder<any, any, any, any>
  | DeleteQueryBuilder<any, any, any>

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
  onInit?(executor: Executor<any>): Promise<void> | void

  // Query builder interceptors (can modify query)
  interceptQuery?<QB extends AnyQueryBuilder>(
    qb: QB,
    context: QueryBuilderContext
  ): QB

  // Result interceptors (post-execution)
  afterQuery?(context: QueryContext, result: unknown): Promise<unknown> | unknown
  onError?(context: QueryContext, error: unknown): Promise<void> | void

  // Repository extensions
  extendRepository?(repo: any): any
}

/**
 * Create ORM with plugin support
 */
export function createORM<DB>(executor: Executor<DB>, plugins: Plugin[] = []) {
  // Initialize plugins
  for (const plugin of plugins) {
    plugin.onInit?.(executor)
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
          operation: operation as any,
          table,
          metadata
        })
      }
    }

    return result
  }

  // Create enhanced repositories
  function createRepository<T>(
    factory: (executor: Executor<DB>, applyPlugins: any) => T
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
 * Helper to reduce repository boilerplate with plugins
 */
export function withPlugins<DB, T>(
  factory: (executor: Executor<DB>) => T,
  executor: Executor<DB>,
  plugins: Plugin[]
): T {
  const orm = createORM(executor, plugins)

  return orm.createRepository((exec, _apply) => {
    const base = factory(exec)

    // Wrap all methods to apply plugins automatically
    return Object.entries(base as any).reduce((acc, [key, value]) => {
      if (typeof value === 'function') {
        ;(acc as any)[key] = function(...args: any[]) {
          return value.apply(this, args)
        }
      } else {
        ;(acc as any)[key] = value
      }
      return acc
    }, {} as T)
  })
}