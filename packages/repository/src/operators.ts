/**
 * Query Operators for Enhanced find() Method
 *
 * Provides MongoDB-style query operators for type-safe, expressive queries.
 *
 * @example
 * ```typescript
 * // Simple equality (backwards compatible)
 * await repo.find({ where: { status: 'active' } })
 *
 * // With operators
 * await repo.find({
 *   where: {
 *     age: { $gte: 18, $lte: 65 },
 *     status: { $in: ['active', 'pending'] },
 *     email: { $like: '%@example.com' }
 *   },
 *   orderBy: 'createdAt',
 *   orderDirection: 'desc'
 * })
 * ```
 *
 * @module @kysera/repository
 */

import { sql, type ExpressionBuilder } from 'kysely'

// ============================================================================
// Operator Type Definitions
// ============================================================================

/**
 * Comparison operators for numeric and comparable values
 */
export interface ComparisonOperators<T> {
  /** Equal to (explicit) */
  $eq?: T
  /** Not equal to */
  $ne?: T
  /** Greater than */
  $gt?: T
  /** Greater than or equal to */
  $gte?: T
  /** Less than */
  $lt?: T
  /** Less than or equal to */
  $lte?: T
}

/**
 * Array operators for IN/NOT IN queries
 */
export interface ArrayOperators<T> {
  /** Value is in the array */
  $in?: T[]
  /** Value is not in the array */
  $nin?: T[]
}

/**
 * String pattern operators
 */
export interface StringOperators {
  /** SQL LIKE pattern (use % for wildcards) */
  $like?: string
  /** Case-insensitive LIKE (PostgreSQL only) */
  $ilike?: string
  /** Contains substring (wraps with %) */
  $contains?: string
  /** Starts with (appends %) */
  $startsWith?: string
  /** Ends with (prepends %) */
  $endsWith?: string
}

/**
 * Null check operators
 */
export interface NullOperators {
  /** Check if value is NULL */
  $isNull?: boolean
  /** Check if value is NOT NULL */
  $isNotNull?: boolean
}

/**
 * Range operator for BETWEEN queries
 */
export interface RangeOperator<T> {
  /** Value is between [min, max] (inclusive) */
  $between?: [T, T]
}

/**
 * All operators combined for a field value
 */
export type FieldOperators<T> =
  | T // Direct value (equality shorthand)
  | (ComparisonOperators<T> &
      ArrayOperators<T> &
      (T extends string ? StringOperators : object) &
      NullOperators &
      RangeOperator<T>)

/**
 * Condition for a single field - either a direct value or operators
 */
export type ConditionValue<T> = FieldOperators<T>

/**
 * Where clause with field conditions and logical operators
 */
export type WhereClause<Entity> = {
  [K in keyof Entity]?: ConditionValue<Entity[K]>
} & {
  /** OR conditions - matches if any condition is true */
  $or?: WhereClause<Entity>[]
  /** AND conditions - matches if all conditions are true (implicit for top-level) */
  $and?: WhereClause<Entity>[]
}

/**
 * Single sort specification
 */
export interface SortSpec<Entity> {
  column: keyof Entity
  direction: 'asc' | 'desc'
}

/**
 * Options for find() and related methods
 */
export interface FindOptions<Entity, Columns extends keyof Entity = keyof Entity> {
  /** Filter conditions with operator support */
  where?: WhereClause<Entity> | Record<string, unknown>
  /** Column to sort by (single column shorthand) */
  orderBy?: keyof Entity | string
  /** Sort direction (used with orderBy string shorthand) */
  orderDirection?: 'asc' | 'desc'
  /** Multiple sort specifications */
  sort?: SortSpec<Entity>[]
  /** Columns to select (type-safe column selection) */
  select?: Columns[]
  /** Maximum number of results */
  limit?: number
  /** Number of results to skip */
  offset?: number
}

/**
 * Result type with optional column selection
 * Uses tuple wrapping [Cols] extends [keyof Entity] to prevent distribution over unions
 */
export type FindResult<Entity, Columns extends keyof Entity> = [Columns] extends [keyof Entity]
  ? Pick<Entity, Columns>[]
  : Entity[]

// ============================================================================
// Operator Constants
// ============================================================================

/** All supported comparison operators */
export const COMPARISON_OPERATORS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'] as const

/** All supported array operators */
export const ARRAY_OPERATORS = ['$in', '$nin'] as const

/** All supported string operators */
export const STRING_OPERATORS = ['$like', '$ilike', '$contains', '$startsWith', '$endsWith'] as const

/** All supported null operators */
export const NULL_OPERATORS = ['$isNull', '$isNotNull'] as const

/** Range operator */
export const RANGE_OPERATORS = ['$between'] as const

/** Logical operators */
export const LOGICAL_OPERATORS = ['$or', '$and'] as const

/** All valid operators (for validation) */
export const ALL_OPERATORS = [
  ...COMPARISON_OPERATORS,
  ...ARRAY_OPERATORS,
  ...STRING_OPERATORS,
  ...NULL_OPERATORS,
  ...RANGE_OPERATORS,
  ...LOGICAL_OPERATORS
] as const

export type OperatorKey = (typeof ALL_OPERATORS)[number]

/** Operator to SQL mapping */
export const OPERATOR_TO_SQL: Record<string, string> = {
  $eq: '=',
  $ne: '<>',
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<=',
  $in: 'in',
  $nin: 'not in',
  $like: 'like',
  $ilike: 'ilike'
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is an operator object (has $ prefixed keys)
 */
export function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value)
  return keys.length > 0 && keys.some(k => k.startsWith('$'))
}

/**
 * Check if a key is a valid operator
 */
export function isValidOperator(key: string): key is OperatorKey {
  return (ALL_OPERATORS as readonly string[]).includes(key)
}

/**
 * Check if a key is a logical operator ($or, $and)
 */
export function isLogicalOperator(key: string): key is '$or' | '$and' {
  return key === '$or' || key === '$and'
}

// ============================================================================
// Operator Parsing and Query Building
// ============================================================================

/**
 * Error thrown when an invalid operator is used
 */
export class InvalidOperatorError extends Error {
  constructor(
    public readonly operator: string,
    public readonly field?: string
  ) {
    super(
      field
        ? `Invalid operator "${operator}" for field "${field}". Valid operators: ${ALL_OPERATORS.join(', ')}`
        : `Invalid operator "${operator}". Valid operators: ${ALL_OPERATORS.join(', ')}`
    )
    this.name = 'InvalidOperatorError'
  }
}

/**
 * Apply comparison operators ($eq, $ne, $gt, $gte, $lt, $lte)
 * @internal
 */
function applyComparisonOperator<DB, TB extends keyof DB>(
  eb: ExpressionBuilder<DB, TB>,
  column: string,
  operator: string,
  value: unknown,
  conditions: ReturnType<typeof eb>[]
): void {
  switch (operator) {
    case '$eq':
      if (value === null) {
        conditions.push(eb(column as never, 'is', null as never))
      } else {
        conditions.push(eb(column as never, '=', value as never))
      }
      break
    case '$ne':
      if (value === null) {
        conditions.push(eb(column as never, 'is not', null as never))
      } else {
        conditions.push(eb(column as never, '<>', value as never))
      }
      break
    case '$gt':
      conditions.push(eb(column as never, '>', value as never))
      break
    case '$gte':
      conditions.push(eb(column as never, '>=', value as never))
      break
    case '$lt':
      conditions.push(eb(column as never, '<', value as never))
      break
    case '$lte':
      conditions.push(eb(column as never, '<=', value as never))
      break
  }
}

/**
 * Apply array operators ($in, $nin)
 * @internal
 */
function applyArrayOperator<DB, TB extends keyof DB>(
  eb: ExpressionBuilder<DB, TB>,
  column: string,
  operator: string,
  value: unknown,
  conditions: ReturnType<typeof eb>[]
): void {
  if (operator === '$in') {
    if (!Array.isArray(value) || value.length === 0) {
      conditions.push(sql`1 = 0` as unknown as ReturnType<typeof eb>)
    } else {
      conditions.push(eb(column as never, 'in', value as never))
    }
  } else if (operator === '$nin') {
    if (Array.isArray(value) && value.length > 0) {
      conditions.push(eb(column as never, 'not in', value as never))
    }
    // Empty NOT IN matches everything - skip adding constraint
  }
}

/**
 * Apply string operators ($like, $ilike, $contains, $startsWith, $endsWith)
 * @internal
 */
function applyStringOperator<DB, TB extends keyof DB>(
  eb: ExpressionBuilder<DB, TB>,
  column: string,
  operator: string,
  value: unknown,
  conditions: ReturnType<typeof eb>[]
): void {
  const strValue = String(value)
  switch (operator) {
    case '$like':
      conditions.push(eb(column as never, 'like', strValue as never))
      break
    case '$ilike':
      conditions.push(eb(column as never, 'ilike', strValue as never))
      break
    case '$contains':
      conditions.push(eb(column as never, 'like', `%${strValue}%` as never))
      break
    case '$startsWith':
      conditions.push(eb(column as never, 'like', `${strValue}%` as never))
      break
    case '$endsWith':
      conditions.push(eb(column as never, 'like', `%${strValue}` as never))
      break
  }
}

/**
 * Apply null operators ($isNull, $isNotNull)
 * @internal
 */
function applyNullOperator<DB, TB extends keyof DB>(
  eb: ExpressionBuilder<DB, TB>,
  column: string,
  operator: string,
  value: unknown,
  conditions: ReturnType<typeof eb>[]
): void {
  if (operator === '$isNull') {
    if (value === true) {
      conditions.push(eb(column as never, 'is', null as never))
    } else if (value === false) {
      conditions.push(eb(column as never, 'is not', null as never))
    }
  } else if (operator === '$isNotNull') {
    if (value === true) {
      conditions.push(eb(column as never, 'is not', null as never))
    } else if (value === false) {
      conditions.push(eb(column as never, 'is', null as never))
    }
  }
}

/**
 * Apply range operator ($between)
 * @internal
 */
function applyRangeOperator<DB, TB extends keyof DB>(
  eb: ExpressionBuilder<DB, TB>,
  column: string,
  value: unknown,
  conditions: ReturnType<typeof eb>[]
): void {
  if (Array.isArray(value) && value.length === 2) {
    const [min, max] = value
    conditions.push(eb(column as never, '>=', min as never))
    conditions.push(eb(column as never, '<=', max as never))
  }
}

/**
 * Parse a condition value and apply it to a query builder
 *
 * @internal
 */
export function applyCondition<DB, TB extends keyof DB>(
  eb: ExpressionBuilder<DB, TB>,
  column: string,
  condition: unknown
): ReturnType<ExpressionBuilder<DB, TB>['and']> {
  // Direct value - equality check
  if (!isOperatorObject(condition)) {
    if (condition === null) {
      return eb(column as never, 'is', null as never)
    }
    return eb(column as never, '=', condition as never)
  }

  // Operator object - parse each operator
  const conditions: ReturnType<typeof eb>[] = []

  for (const [operator, value] of Object.entries(condition)) {
    if (!isValidOperator(operator)) {
      throw new InvalidOperatorError(operator, column)
    }

    if (value === undefined) continue

    // Comparison operators
    if (['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'].includes(operator)) {
      applyComparisonOperator(eb, column, operator, value, conditions)
    }
    // Array operators
    else if (['$in', '$nin'].includes(operator)) {
      applyArrayOperator(eb, column, operator, value, conditions)
    }
    // String operators
    else if (['$like', '$ilike', '$contains', '$startsWith', '$endsWith'].includes(operator)) {
      applyStringOperator(eb, column, operator, value, conditions)
    }
    // Null operators
    else if (['$isNull', '$isNotNull'].includes(operator)) {
      applyNullOperator(eb, column, operator, value, conditions)
    }
    // Range operator
    else if (operator === '$between') {
      applyRangeOperator(eb, column, value, conditions)
    }
  }

  // Combine all conditions with AND
  if (conditions.length === 0) {
    return sql`1 = 1` as unknown as ReturnType<typeof eb>
  }
  if (conditions.length === 1) {
    return conditions[0] as ReturnType<ExpressionBuilder<DB, TB>['and']>
  }
  return eb.and(conditions)
}

/**
 * Apply a where clause (with $or/$and support) to an expression builder
 *
 * @internal
 */
export function applyWhereClause<DB, TB extends keyof DB>(
  eb: ExpressionBuilder<DB, TB>,
  where: WhereClause<unknown> | Record<string, unknown>
): ReturnType<ExpressionBuilder<DB, TB>['and']> {
  const conditions: ReturnType<typeof eb>[] = []

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue

    // Handle logical operators
    if (key === '$or' && Array.isArray(value)) {
      const orConditions = value.map(clause => applyWhereClause(eb, clause as Record<string, unknown>))
      if (orConditions.length > 0) {
        conditions.push(eb.or(orConditions))
      }
      continue
    }

    if (key === '$and' && Array.isArray(value)) {
      const andConditions = value.map(clause => applyWhereClause(eb, clause as Record<string, unknown>))
      if (andConditions.length > 0) {
        conditions.push(eb.and(andConditions))
      }
      continue
    }

    // Regular field condition
    conditions.push(applyCondition(eb, key, value))
  }

  // Combine all top-level conditions with AND
  if (conditions.length === 0) {
    return sql`1 = 1` as unknown as ReturnType<ExpressionBuilder<DB, TB>['and']>
  }
  if (conditions.length === 1) {
    return conditions[0] as ReturnType<ExpressionBuilder<DB, TB>['and']>
  }
  return eb.and(conditions)
}

/**
 * Check if where clause uses any operators (vs simple equality)
 */
export function hasOperators(where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    // Check for logical operators
    if (key === '$or' || key === '$and') {
      return true
    }
    // Check for operator objects in field values
    if (isOperatorObject(value)) {
      return true
    }
  }
  return false
}

/**
 * Validate all operators in a where clause
 */
export function validateOperators(where: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(where)) {
    // Validate logical operators
    if (key === '$or' || key === '$and') {
      if (!Array.isArray(value)) {
        throw new InvalidOperatorError(key, `${key} must be an array`)
      }
      for (const clause of value) {
        if (typeof clause === 'object' && clause !== null) {
          validateOperators(clause as Record<string, unknown>)
        }
      }
      continue
    }

    // Validate field operator objects
    if (isOperatorObject(value)) {
      for (const operator of Object.keys(value as object)) {
        if (!isValidOperator(operator)) {
          throw new InvalidOperatorError(operator, key)
        }
      }
    }
  }
}

/**
 * Extract column names from a where clause (for validation)
 */
export function extractColumns(where: Record<string, unknown>): string[] {
  const columns: string[] = []

  for (const [key, value] of Object.entries(where)) {
    // Skip logical operators
    if (key === '$or' || key === '$and') {
      if (Array.isArray(value)) {
        for (const clause of value) {
          if (typeof clause === 'object' && clause !== null) {
            columns.push(...extractColumns(clause as Record<string, unknown>))
          }
        }
      }
      continue
    }

    // Regular column
    columns.push(key)
  }

  return [...new Set(columns)] // Deduplicate
}
