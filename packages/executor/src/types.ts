/**
 * @kysera/executor - Unified Execution Layer Types
 * @module @kysera/executor
 */

import type { Kysely, Transaction } from 'kysely';

/**
 * Query builder context passed to plugin interceptors
 */
export interface QueryBuilderContext {
  /** Type of operation */
  readonly operation: 'select' | 'insert' | 'update' | 'delete';
  /** Table name */
  readonly table: string;
  /** Additional metadata */
  readonly metadata: Record<string, unknown>;
}

/**
 * Plugin interface - unified for both Repository and DAL patterns
 *
 * Plugins can:
 * - Intercept queries before execution (interceptQuery)
 * - Extend repositories with additional methods (extendRepository)
 * - Initialize resources on startup (onInit)
 */
export interface Plugin {
  /** Unique plugin name */
  readonly name: string;
  /** Plugin version */
  readonly version: string;
  /** Plugin dependencies (must be loaded first) */
  readonly dependencies?: readonly string[];
  /** Higher priority = runs first (default: 0) */
  readonly priority?: number;
  /** Plugins that conflict with this one */
  readonly conflictsWith?: readonly string[];

  /**
   * Lifecycle: Called once when plugin is initialized
   */
  onInit?<DB>(executor: Kysely<DB>): Promise<void> | void;

  /**
   * Query interception: Modify query builder before execution
   * Works in both Repository and DAL patterns via @kysera/executor
   */
  interceptQuery?<QB>(qb: QB, context: QueryBuilderContext): QB;

  /**
   * Repository extensions: Add methods to repositories (Repository pattern only)
   */
  extendRepository?<T extends object>(repo: T): T;
}

/**
 * Marker interface for KyseraExecutor
 */
export interface KyseraExecutorMarker<DB = unknown> {
  readonly __kysera: true;
  readonly __plugins: readonly Plugin[];
  /** Raw Kysely instance bypassing plugin interceptors (for internal plugin use) */
  readonly __rawDb: Kysely<DB>;
}

/**
 * Plugin-aware Kysely wrapper type
 * Extends Kysely with plugin interception capabilities
 */
export type KyseraExecutor<DB> = Kysely<DB> & KyseraExecutorMarker<DB>;

/**
 * Plugin-aware Transaction wrapper type
 */
export type KyseraTransaction<DB> = Transaction<DB> & KyseraExecutorMarker<DB>;

/**
 * Union type for any Kysera executor (database or transaction)
 */
export type AnyKyseraExecutor<DB> = KyseraExecutor<DB> | KyseraTransaction<DB>;

/**
 * Configuration for executor creation
 */
export interface ExecutorConfig {
  /** Enable/disable plugin interception at runtime */
  readonly enabled?: boolean;
}

/**
 * Plugin validation error details
 */
export interface PluginValidationDetails {
  readonly pluginName: string;
  readonly missingDependency?: string;
  readonly conflictingPlugin?: string;
  readonly cycle?: readonly string[];
}

/**
 * Plugin validation error types
 */
export type PluginValidationErrorType =
  | 'DUPLICATE_NAME'
  | 'MISSING_DEPENDENCY'
  | 'CONFLICT'
  | 'CIRCULAR_DEPENDENCY';
