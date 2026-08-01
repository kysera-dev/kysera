import type { Kysely, Transaction } from 'kysely'
import type { AnyQueryBuilder } from './types.js'
import { createExecutor, getPlugins, wrapTransaction, type Plugin } from '@kysera/executor'
import { createContext as createDalContext, withTransaction, type DbContext } from '@kysera/dal'

/**
 * Plugin application function type
 * Used by repositories to apply plugin interceptors to query builders
 */
export type ApplyPluginsFunction = <QB extends AnyQueryBuilder>(
  qb: QB,
  operation: string,
  table: string,
  metadata?: Record<string, unknown>
) => QB

/**
 * Plugin container interface for repository pattern
 * Provides repository creation and plugin application
 */
export interface PluginOrm<DB> {
  /** Plugin-aware executor from @kysera/executor */
  executor: Kysely<DB>
  /** Create a repository with plugin support */
  createRepository: <T extends object>(
    factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T
  ) => T
  /** Apply plugin interceptors to query builders */
  applyPlugins: ApplyPluginsFunction
  /** Registered plugins */
  plugins: readonly Plugin[]
  /** Create a DAL context with registered plugins */
  createContext(): DbContext<DB>
  /** Execute a transaction with both Repository and DAL patterns */
  transaction<T>(fn: (ctx: DbContext<DB>) => Promise<T>): Promise<T>
}

/**
 * Create plugin container with plugin support
 * Uses @kysera/executor internally for unified plugin management
 *
 * @param db - Kysely database instance
 * @param plugins - Array of plugins to register
 * @returns Promise resolving to PluginOrm instance
 */
export async function createORM<DB>(
  db: Kysely<DB>,
  plugins: Plugin[] = []
): Promise<PluginOrm<DB>> {
  // Create executor with plugins (handles validation, resolution, and initialization)
  const executor = await createExecutor(db, plugins)

  // Get the resolved plugin order from executor
  const resolvedPlugins = getPlugins(executor)

  // Helper to apply plugin interceptors to queries
  function applyPlugins<QB extends AnyQueryBuilder>(
    qb: QB,
    operation: string,
    table: string,
    metadata: Record<string, unknown> = {}
  ): QB {
    let result = qb

    // Use resolved plugin order
    for (const plugin of resolvedPlugins) {
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

  // Create enhanced repositories with plugin extensions
  function createRepository<T extends object>(
    factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T
  ): T {
    const build = (exec: Kysely<DB>): T => {
      let repo = factory(exec, applyPlugins)

      // Apply repository extensions in resolved order
      for (const plugin of resolvedPlugins) {
        if (plugin.extendRepository) {
          repo = plugin.extendRepository(repo)
        }
      }

      return repo
    }

    const repo = build(executor)

    // Repository.withTransaction rebuilds the repo against a raw transaction,
    // which silently dropped EVERY plugin (no interception, no extensions —
    // no soft-delete/audit/timestamps/RLS inside transactions). Re-run the
    // full build against a plugin-wrapped transaction instead.
    if (typeof (repo as { withTransaction?: unknown }).withTransaction === 'function') {
      return {
        ...repo,
        withTransaction: (trx: Transaction<DB>): T =>
          build(wrapTransaction(trx, resolvedPlugins) as unknown as Kysely<DB>)
      }
    }

    return repo
  }

  // Create DAL context with registered plugins
  function createContext(): DbContext<DB> {
    return createDalContext(executor)
  }

  // Execute transaction with both Repository and DAL patterns
  async function transaction<T>(fn: (ctx: DbContext<DB>) => Promise<T>): Promise<T> {
    return withTransaction(executor, fn)
  }

  return {
    executor,
    createRepository,
    applyPlugins,
    plugins: resolvedPlugins,
    createContext,
    transaction
  }
}

/**
 * Helper to create a repository with plugins
 * Simplifies the common pattern of creating a plugin container and repository together
 *
 * @param factory - Repository factory function
 * @param executor - Kysely database instance
 * @param plugins - Array of plugins to register
 * @returns Promise resolving to repository instance
 */
export async function withPlugins<DB, T extends object>(
  factory: (executor: Kysely<DB>, applyPlugins: ApplyPluginsFunction) => T,
  executor: Kysely<DB>,
  plugins: Plugin[]
): Promise<T> {
  const orm = await createORM(executor, plugins)
  return orm.createRepository(factory)
}
