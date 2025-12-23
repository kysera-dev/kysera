/**
 * Column validation utilities for dynamic query operations.
 *
 * @module @kysera/repository
 *
 * This module addresses H-7: Dynamic column names without sanitization.
 * Provides runtime validation to ensure column names exist in schema.
 */

import type { PrimaryKeyConfig } from './types.js'
import { getPrimaryKeyColumns } from './types.js'

/**
 * Validate that all column names in conditions exist in a whitelist.
 *
 * This prevents SQL injection and ensures type safety for dynamic queries.
 *
 * @param conditions - Conditions object with column names as keys
 * @param allowedColumns - Set of allowed column names (from schema)
 * @throws Error if any column name is not in the whitelist
 *
 * @example
 * ```typescript
 * const allowedColumns = new Set(['id', 'name', 'email']);
 * validateColumnNames({ name: 'Alice', email: 'alice@example.com' }, allowedColumns);
 * // OK
 *
 * validateColumnNames({ name: 'Alice', malicious: 'DROP TABLE' }, allowedColumns);
 * // Throws: Invalid column name(s): malicious
 * ```
 */
export function validateColumnNames(
  conditions: Record<string, unknown>,
  allowedColumns: ReadonlySet<string>
): void {
  const invalidColumns: string[] = []

  for (const column of Object.keys(conditions)) {
    if (!allowedColumns.has(column)) {
      invalidColumns.push(column)
    }
  }

  if (invalidColumns.length > 0) {
    throw new Error(
      `Invalid column name(s): ${invalidColumns.join(', ')}. ` +
        `Allowed columns: ${Array.from(allowedColumns).join(', ')}`
    )
  }
}

/**
 * Extract allowed column names from primary key configuration.
 *
 * This provides a basic whitelist for validation when full schema is not available.
 *
 * @param pkConfig - Primary key configuration
 * @returns Set of allowed column names
 *
 * @example
 * ```typescript
 * const pkConfig = { columns: ['userId', 'roleId'], type: 'number' };
 * const allowed = getAllowedColumnsFromPkConfig(pkConfig);
 * // Returns: Set(['userId', 'roleId'])
 * ```
 */
export function getAllowedColumnsFromPkConfig(pkConfig: PrimaryKeyConfig): ReadonlySet<string> {
  const columns = getPrimaryKeyColumns(pkConfig.columns)
  return new Set(columns)
}

/**
 * Validation options for dynamic queries.
 */
export interface ColumnValidationOptions {
  /**
   * Enable column validation (default: true in development, false in production)
   */
  enabled?: boolean
  /**
   * Custom allowed columns set (default: derived from primary key config)
   */
  allowedColumns?: ReadonlySet<string>
}

/**
 * Create a validated conditions object with schema whitelist check.
 *
 * @param conditions - Conditions to validate
 * @param pkConfig - Primary key configuration (provides default whitelist)
 * @param options - Validation options
 * @returns Validated conditions (same object if valid)
 * @throws Error if validation enabled and columns are invalid
 *
 * @example
 * ```typescript
 * const conditions = validateConditions(
 *   { name: 'Alice' },
 *   { columns: 'id', type: 'number' },
 *   { allowedColumns: new Set(['id', 'name', 'email']) }
 * );
 * ```
 */
export function validateConditions(
  conditions: Record<string, unknown>,
  pkConfig: PrimaryKeyConfig,
  options: ColumnValidationOptions = {}
): Record<string, unknown> {
  const { enabled = process.env['NODE_ENV'] === 'development', allowedColumns } = options

  if (!enabled) {
    return conditions
  }

  const whitelist = allowedColumns ?? getAllowedColumnsFromPkConfig(pkConfig)

  // In development mode, validate column names against whitelist
  // This helps catch bugs early and prevents SQL injection
  validateColumnNames(conditions, whitelist)

  return conditions
}
