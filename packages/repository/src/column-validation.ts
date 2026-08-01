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
 * Plain SQL identifier: letters/underscore start, then letters/digits/underscore.
 * Rejects injection vectors and silent mistakes like `orderBy: 'name desc'`
 * (which SQLite would otherwise treat as a quoted string literal).
 */
const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Assert that a dynamic name is a plain SQL identifier.
 *
 * @param name - The identifier to validate (column name, orderBy target, ...)
 * @param context - Human-readable description for the error message
 * @throws Error when the name is not a plain identifier
 *
 * @example
 * ```typescript
 * assertValidIdentifier('created_at', 'orderBy column') // OK
 * assertValidIdentifier('name desc', 'orderBy column')  // throws
 * ```
 */
export function assertValidIdentifier(name: string, context: string): void {
  if (!SQL_IDENTIFIER_PATTERN.test(name)) {
    throw new Error(
      `Invalid ${context}: "${name}". Expected a plain SQL identifier ` +
        `(letters, digits, underscore; must not contain spaces or punctuation).`
    )
  }
}

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
   * Enable column validation (default: true).
   * The default identifier-shape check is O(number of keys) and safe to keep
   * on in production.
   */
  enabled?: boolean
  /**
   * Explicit column whitelist. When provided, every condition key must be in
   * this set (strict schema validation). When omitted, keys are checked to be
   * plain SQL identifiers instead — this avoids the old failure mode where
   * development rejected legitimate columns because only primary-key columns
   * were known, while production skipped validation entirely.
   */
  allowedColumns?: ReadonlySet<string>
}

/**
 * Validate condition column names.
 *
 * - With `allowedColumns`: strict whitelist membership check.
 * - Without: identifier-shape check (consistent across environments).
 *
 * @param conditions - Conditions to validate
 * @param _pkConfig - Primary key configuration (kept for API compatibility)
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
  _pkConfig: PrimaryKeyConfig,
  options: ColumnValidationOptions = {}
): Record<string, unknown> {
  const { enabled = true, allowedColumns } = options

  if (!enabled) {
    return conditions
  }

  if (allowedColumns) {
    validateColumnNames(conditions, allowedColumns)
    return conditions
  }

  for (const column of Object.keys(conditions)) {
    assertValidIdentifier(column, 'column name')
  }

  return conditions
}
