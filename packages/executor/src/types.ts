/**
 * @kysera/executor - Unified Execution Layer Types
 * @module @kysera/executor
 */

import type { Kysely, Transaction } from 'kysely'

/**
 * Query builder context passed to plugin interceptors
 */
export interface QueryBuilderContext {
  /** Type of operation */
  readonly operation: 'select' | 'insert' | 'update' | 'delete' | 'replace' | 'merge'
  /** Table name */
  readonly table: string
  /**
   * Current schema context (if withSchema was called).
   * undefined means default schema is being used.
   */
  readonly schema?: string
  /** Additional metadata */
  readonly metadata: Record<string, unknown>
}

/**
 * Plugin interface - unified for both Repository and DAL patterns
 *
 * Plugins can:
 * - Intercept queries before execution (interceptQuery)
 * - Extend repositories with additional methods (extendRepository)
 * - Initialize resources on startup (onInit)
 * - Cleanup resources on shutdown (onDestroy)
 */
export interface Plugin {
  /** Unique plugin name */
  readonly name: string
  /** Plugin version */
  readonly version: string
  /** Plugin dependencies (must be loaded first) */
  readonly dependencies?: readonly string[]
  /** Higher priority = runs first (default: 0) */
  readonly priority?: number
  /** Plugins that conflict with this one */
  readonly conflictsWith?: readonly string[]

  /**
   * Lifecycle: Called once when plugin is initialized
   * @param db - Kysely database instance (not the executor wrapper)
   */
  onInit?<DB>(db: Kysely<DB>): Promise<void> | void

  /**
   * Lifecycle: Called when executor is being destroyed
   * Use for cleanup, closing connections, clearing timers, etc.
   */
  onDestroy?(): Promise<void> | void

  /**
   * Query interception: Modify query builder before execution
   * Works in both Repository and DAL patterns via @kysera/executor
   *
   * @typeParam QB - Query builder type (intentionally unconstrained)
   *
   * **Type Safety Note:**
   * QB is intentionally unconstrained (not constrained to any base type) because:
   *
   * 1. **Kysely's query builders lack a shared interface**: SelectQueryBuilder,
   *    InsertQueryBuilder, UpdateQueryBuilder, DeleteQueryBuilder, and MergeQueryBuilder
   *    don't share a common base interface that includes query modification methods
   *    like where(), and(), etc.
   *
   * 2. **Each builder has unique generic parameters**: Even if they implemented
   *    Compilable<unknown>, their type parameters differ (DB, TB, O, UT, etc.),
   *    making it impossible to express a shared constraint.
   *
   * 3. **Type inference requirement**: The QB type must be preserved exactly as-is
   *    through the plugin chain. Any constraint would break this preservation.
   *
   * **Plugin Implementation Pattern:**
   * Plugins must handle type safety internally by:
   * 1. Checking the operation type from context.operation
   * 2. Casting to the appropriate specific builder type
   * 3. Using type assertions (documented in plugin code)
   *
   * @example
   * ```typescript
   * interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
   *   if (context.operation === 'select') {
   *     // Cast to SelectQueryBuilder for type-safe WHERE clause
   *     type GenericSelect = SelectQueryBuilder<Record<string, unknown>, string, Record<string, unknown>>;
   *     return (qb as unknown as GenericSelect)
   *       .where('deleted_at', 'is', null) as QB;
   *   }
   *   return qb;
   * }
   * ```
   */
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB

  /**
   * Repository extensions: Add methods to repositories (Repository pattern only)
   */
  extendRepository?<T extends object>(repo: T): T
}

/**
 * Marker interface for KyseraExecutor
 */
export interface KyseraExecutorMarker<DB = unknown> {
  readonly __kysera: true
  readonly __plugins: readonly Plugin[]
  /** Raw Kysely instance bypassing plugin interceptors (for internal plugin use) */
  readonly __rawDb: Kysely<DB>
  /**
   * Current schema context (if withSchema was called).
   * undefined means default schema is being used.
   */
  readonly __schema?: string
}

/**
 * Plugin-aware Kysely wrapper type
 * Extends Kysely with plugin interception capabilities
 */
export type KyseraExecutor<DB> = Kysely<DB> & KyseraExecutorMarker<DB>

/**
 * Plugin-aware Transaction wrapper type
 */
export type KyseraTransaction<DB> = Transaction<DB> & KyseraExecutorMarker<DB>

/**
 * Union type for any Kysera executor (database or transaction)
 */
export type AnyKyseraExecutor<DB> = KyseraExecutor<DB> | KyseraTransaction<DB>

/**
 * Configuration for executor creation
 */
export interface ExecutorConfig {
  /** Enable/disable plugin interception at runtime */
  readonly enabled?: boolean
}

/**
 * Plugin validation error details
 */
export interface PluginValidationDetails {
  readonly pluginName: string
  readonly missingDependency?: string
  readonly conflictingPlugin?: string
  readonly cycle?: readonly string[]
}

/**
 * Plugin validation error types
 */
export type PluginValidationErrorType =
  | 'DUPLICATE_NAME'
  | 'MISSING_DEPENDENCY'
  | 'CONFLICT'
  | 'CIRCULAR_DEPENDENCY'
  | 'INITIALIZATION_FAILED'

/**
 * Base repository interface for plugin extensions.
 * Plugins should use this interface to type-check repository objects.
 *
 * This interface represents the minimum contract that a repository-like object
 * must fulfill to be extended by plugins. It's designed to work with both
 * the @kysera/repository pattern and custom repository implementations.
 *
 * @template DB - The database schema type (defaults to unknown for flexibility)
 *
 * @example
 * ```typescript
 * import type { BaseRepositoryLike } from '@kysera/executor'
 *
 * // In a plugin's extendRepository method:
 * extendRepository<T extends object>(repo: T): T {
 *   if (!isRepositoryLike(repo)) {
 *     return repo // Not a repository, skip extension
 *   }
 *
 *   // Now we can safely access repo.tableName and repo.executor
 *   const { tableName, executor } = repo
 *   // ... extend the repository
 * }
 * ```
 */
export interface BaseRepositoryLike<DB = unknown> {
  /** The name of the database table this repository manages */
  readonly tableName: string
  /** The Kysely executor (database or transaction) */
  readonly executor: Kysely<DB>
  /** Find a record by its primary key */
  findById?: (id: unknown) => Promise<unknown>
  /** Find all records in the table */
  findAll?: () => Promise<unknown[]>
  /** Create a new record */
  create?: (data: unknown) => Promise<unknown>
  /** Update an existing record by primary key */
  update?: (id: unknown, data: unknown) => Promise<unknown>
  /** Delete a record by primary key (returns deleted record or boolean) */
  delete?: (id: unknown) => Promise<unknown>
}

/**
 * Type guard to check if an object is a repository-like object.
 *
 * This function checks for the minimum required properties of a repository:
 * - `tableName`: A string identifying the database table
 * - `executor`: A Kysely instance for database operations
 *
 * @param obj - The object to check
 * @returns True if the object is repository-like, false otherwise
 *
 * @example
 * ```typescript
 * import { isRepositoryLike } from '@kysera/executor'
 *
 * function processRepo(maybeRepo: unknown) {
 *   if (isRepositoryLike(maybeRepo)) {
 *     console.log(`Repository for table: ${maybeRepo.tableName}`)
 *   }
 * }
 * ```
 */
export function isRepositoryLike<DB = unknown>(obj: unknown): obj is BaseRepositoryLike<DB> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'tableName' in obj &&
    'executor' in obj &&
    typeof (obj as Record<string, unknown>)['tableName'] === 'string'
  )
}
