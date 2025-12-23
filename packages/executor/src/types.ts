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
   */
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void

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
