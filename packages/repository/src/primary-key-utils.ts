/**
 * Shared utilities for primary key extraction and validation.
 *
 * @module @kysera/repository
 *
 * This module addresses H-9: Duplicate primary key extraction logic.
 * Previously duplicated in:
 * - packages/repository/src/base-repository.ts:148-165
 * - packages/repository/src/table-operations.ts:334-350
 */

import type {
  PrimaryKeyConfig,
  PrimaryKeyInput,
  CompositeKeyValue,
  PrimaryKeyValue
} from './types.js'
import { getPrimaryKeyColumns } from './types.js'

/**
 * Extract primary key value from a row or entity.
 *
 * Handles both single and composite primary keys.
 *
 * @param row - Row or entity object containing primary key values
 * @param pkConfig - Primary key configuration
 * @returns Primary key value (scalar for single keys, object for composite keys)
 *
 * @example Single primary key
 * ```typescript
 * const pk = extractPrimaryKey({ id: 1, name: 'Alice' }, { columns: 'id', type: 'number' });
 * // Returns: 1
 * ```
 *
 * @example Composite primary key
 * ```typescript
 * const pk = extractPrimaryKey(
 *   { userId: 1, roleId: 2, name: 'Admin' },
 *   { columns: ['userId', 'roleId'], type: 'number' }
 * );
 * // Returns: { userId: 1, roleId: 2 }
 * ```
 */
export function extractPrimaryKey<T = unknown>(
  row: T,
  pkConfig: PrimaryKeyConfig
): PrimaryKeyInput {
  const columns = getPrimaryKeyColumns(pkConfig.columns)

  if (columns.length === 1) {
    const column = columns[0]
    if (!column) {
      throw new Error('Primary key configuration is invalid: no columns defined')
    }
    return (row as Record<string, unknown>)[column] as PrimaryKeyInput
  }

  // For composite keys, return an object
  const result: CompositeKeyValue = {}
  for (const column of columns) {
    result[column] = (row as Record<string, unknown>)[column] as PrimaryKeyValue
  }
  return result
}
