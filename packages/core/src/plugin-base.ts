/**
 * Base Plugin Utilities
 *
 * Provides common abstractions for creating Kysera plugins, reducing boilerplate
 * and ensuring consistent behavior across the plugin ecosystem.
 *
 * @module @kysera/core/plugin-base
 */

import { silentLogger, type KyseraLogger } from './logger.js'
import type { TableFilterConfig } from './helpers.js'

// Re-export TableFilterConfig for plugin convenience
export type { TableFilterConfig } from './helpers.js'

// ============================================================================
// Base Options Interface
// ============================================================================

/**
 * Common options shared by all Kysera plugins.
 *
 * This interface defines the standard configuration options that every plugin
 * should support. Plugin-specific options should extend this interface.
 *
 * Extends TableFilterConfig to provide consistent table filtering behavior.
 *
 * @example
 * ```typescript
 * import type { BasePluginOptions } from '@kysera/core'
 *
 * export interface MyPluginOptions extends BasePluginOptions {
 *   customOption: string
 *   anotherOption?: number
 * }
 *
 * export function myPlugin(options: MyPluginOptions = {}): Plugin {
 *   const config = createPluginConfig('my-plugin', options)
 *   // ... plugin implementation
 * }
 * ```
 */
export interface BasePluginOptions extends TableFilterConfig {
  /**
   * Logger for plugin operations.
   * Uses KyseraLogger interface for standardized logging.
   *
   * @default silentLogger (no output)
   */
  logger?: KyseraLogger
}

/**
 * Extended options for plugins that need primary key configuration.
 */
export interface BasePluginOptionsWithPrimaryKey extends BasePluginOptions {
  /**
   * Primary key column name used for identifying records.
   *
   * @default 'id'
   */
  primaryKeyColumn?: string
}

// ============================================================================
// Plugin Configuration Helper
// ============================================================================

/**
 * Resolved plugin configuration with defaults applied.
 */
export interface ResolvedPluginConfig {
  /** The plugin name */
  readonly name: string
  /** Configured logger instance */
  readonly logger: KyseraLogger
  /** Tables to apply plugin to (undefined = all tables) */
  readonly tables: string[] | undefined
  /** Tables to exclude from plugin processing */
  readonly excludeTables: string[]
  /** Primary key column name */
  readonly primaryKeyColumn: string
}

/**
 * Creates a resolved plugin configuration with defaults applied.
 *
 * This helper function standardizes plugin configuration, ensuring
 * consistent default values and behavior across all plugins.
 *
 * @param name - The plugin name (used for logging)
 * @param options - Plugin options (with optional BasePluginOptions fields)
 * @returns Resolved configuration with all defaults applied
 *
 * @example
 * ```typescript
 * import { createPluginConfig, type BasePluginOptionsWithPrimaryKey } from '@kysera/core'
 *
 * interface SoftDeleteOptions extends BasePluginOptionsWithPrimaryKey {
 *   deletedAtColumn?: string
 *   includeDeleted?: boolean
 * }
 *
 * export function softDeletePlugin(options: SoftDeleteOptions = {}): Plugin {
 *   const config = createPluginConfig('soft-delete', options)
 *
 *   // Now use config.logger, config.tables, config.primaryKeyColumn, etc.
 *   config.logger.debug('Initializing soft-delete plugin')
 *
 *   // Check if plugin should apply to a table
 *   if (!shouldApplyToTable('users', config)) {
 *     return qb // Skip this table
 *   }
 * }
 * ```
 */
export function createPluginConfig(
  name: string,
  options: BasePluginOptions | BasePluginOptionsWithPrimaryKey
): ResolvedPluginConfig {
  return {
    name,
    logger: options.logger ?? silentLogger,
    tables: options.tables,
    excludeTables: options.excludeTables ?? [],
    primaryKeyColumn: (options as BasePluginOptionsWithPrimaryKey).primaryKeyColumn ?? 'id',
  }
}

// ============================================================================
// Plugin Factory Helpers
// ============================================================================

/**
 * Plugin metadata structure.
 */
export interface PluginMetadata {
  /** Unique plugin name */
  name: string
  /** Plugin version (semver) */
  version: string
  /** Plugin dependencies (must be loaded first) */
  dependencies?: readonly string[]
  /** Higher priority = runs first (default: 0) */
  priority?: number
  /** Plugins that conflict with this one */
  conflictsWith?: readonly string[]
}

/**
 * Creates plugin metadata with optional defaults.
 *
 * @param name - Plugin name
 * @param version - Plugin version
 * @param options - Optional metadata fields
 * @returns Complete plugin metadata object
 *
 * @example
 * ```typescript
 * import { createPluginMetadata } from '@kysera/core'
 *
 * const metadata = createPluginMetadata('soft-delete', '0.8.0', {
 *   priority: 100,  // Run early to filter deleted records
 *   conflictsWith: ['hard-delete-only']
 * })
 * ```
 */
export function createPluginMetadata(
  name: string,
  version: string,
  options: Omit<PluginMetadata, 'name' | 'version'> = {}
): PluginMetadata {
  const metadata: PluginMetadata = { name, version }

  // Only include optional properties if they are defined
  // (required for exactOptionalPropertyTypes: true)
  if (options.dependencies !== undefined) {
    metadata.dependencies = options.dependencies
  }
  if (options.priority !== undefined) {
    metadata.priority = options.priority
  }
  if (options.conflictsWith !== undefined) {
    metadata.conflictsWith = options.conflictsWith
  }

  return metadata
}

// ============================================================================
// Common Plugin Priorities
// ============================================================================

/**
 * Recommended priority values for different plugin types.
 *
 * Higher priority = runs first. Use these constants to ensure
 * consistent plugin ordering across the ecosystem.
 *
 * **Execution Order (highest to lowest):**
 * 1. SECURITY (1000) - RLS, authentication filters
 * 2. FILTER (500) - Soft delete, tenant isolation
 * 3. TRANSFORM (100) - Timestamps, data transformation
 * 4. AUDIT (50) - Audit logging, change tracking
 * 5. DEBUG (-100) - Query logging, profiling
 *
 * @example
 * ```typescript
 * import { PLUGIN_PRIORITIES, createPluginMetadata } from '@kysera/core'
 *
 * const metadata = createPluginMetadata('my-security-plugin', '1.0.0', {
 *   priority: PLUGIN_PRIORITIES.SECURITY
 * })
 * ```
 */
export const PLUGIN_PRIORITIES = {
  /** Security plugins (RLS, auth) - run first */
  SECURITY: 1000,
  /** Filter plugins (soft delete, tenant isolation) */
  FILTER: 500,
  /** Transform plugins (timestamps, data modification) */
  TRANSFORM: 100,
  /** Audit plugins (logging, change tracking) */
  AUDIT: 50,
  /** Default priority for plugins without explicit priority */
  DEFAULT: 0,
  /** Debug plugins (logging, profiling) - run last */
  DEBUG: -100,
} as const

/**
 * Type for plugin priority constants.
 */
export type PluginPriority = (typeof PLUGIN_PRIORITIES)[keyof typeof PLUGIN_PRIORITIES]
