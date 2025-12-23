/**
 * Type utilities for RLS plugin
 *
 * These utilities provide type-safe wrappers around dynamic operations
 * that require runtime flexibility beyond TypeScript's compile-time constraints.
 *
 * NOTE: This file intentionally uses `any` types to bridge the gap between
 * Kysely's compile-time type system and RLS's runtime dynamic requirements.
 * All `any` usage is documented and justified with runtime safety guarantees.
 *
 * @module @kysera/rls/utils/type-utils
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SelectQueryBuilder, Kysely, RawBuilder } from 'kysely'
import { sql } from 'kysely'

/**
 * Type-safe wrapper for dynamic column references in WHERE clauses
 *
 * Kysely's type system requires compile-time known column names, but RLS policies
 * work with dynamic column names at runtime. This utility provides a type-safe
 * boundary for this conversion.
 *
 * Type safety is maintained through:
 * 1. Column names come from validated policy definitions (developer-controlled)
 * 2. Values are type-checked by policy condition functions
 * 3. Runtime validation during policy registration
 *
 * @param table - Table name (from validated policy schema)
 * @param column - Column name (from validated policy definition)
 * @returns Type-safe column reference for Kysely query builder
 */
export function createQualifiedColumn(table: string, column: string): string {
  return `${table}.${column}`
}

/**
 * Type-safe wrapper for applying WHERE conditions from RLS filters
 *
 * This function encapsulates the type boundary between runtime policy conditions
 * and Kysely's compile-time type system.
 *
 * @param qb - Query builder to modify
 * @param column - Qualified column name (table.column)
 * @param operator - Comparison operator
 * @param value - Value to compare against
 * @returns Modified query builder
 */
export function applyWhereCondition<DB, TB extends keyof DB & string, O>(
  qb: SelectQueryBuilder<DB, TB, O>,
  column: string,
  operator: 'is' | '=' | 'in',
  value: unknown
): SelectQueryBuilder<DB, TB, O> {
  return qb.where(column as any, operator as any, value as any)
}

/**
 * Type-safe wrapper for raw SQL expressions
 *
 * @param expression - SQL expression (e.g., 'FALSE' for impossible conditions)
 * @returns Type-safe raw builder for WHERE clauses
 */
export function createRawCondition(expression: string): RawBuilder<boolean> {
  return sql`${sql.raw(expression)}`
}

/**
 * Type-safe wrapper for dynamic table queries (used in raw db queries)
 *
 * This is used by plugins to bypass RLS filtering when fetching existing rows
 * for mutation validation. The table name comes from repository configuration
 * and is validated during repository creation.
 *
 * @param db - Kysely database instance
 * @param table - Table name (from repository config)
 * @returns Query builder for the table
 */
export function selectFromDynamicTable<DB>(
  db: Kysely<DB>,
  table: string
): SelectQueryBuilder<Record<string, unknown>, string, Record<string, unknown>> {
  return db.selectFrom(table as any).selectAll() as any
}

/**
 * Add WHERE clause for primary key equality.
 * Supports custom primary key column names.
 *
 * @param qb - Select query builder
 * @param id - Primary key value
 * @param primaryKeyColumn - Primary key column name (default: 'id')
 * @returns Query builder with ID filter
 */
export function whereIdEquals(
  qb: SelectQueryBuilder<any, any, any>,
  id: unknown,
  primaryKeyColumn = 'id'
): SelectQueryBuilder<any, any, any> {
  return qb.where(primaryKeyColumn as any, '=', id as any)
}

/**
 * Type-safe wrapper for transforming query builders in plugin interceptors
 *
 * Used when plugins need to transform a generic query builder (QB) to a specific
 * type (e.g., SelectQueryBuilder) and back. This is necessary because the executor's
 * interceptQuery hook receives unconstrained QB types to preserve type inference.
 *
 * @param qb - Generic query builder from interceptor
 * @param operation - Operation type (for runtime validation)
 * @param transform - Transformation function
 * @returns Transformed query builder
 */
export function transformQueryBuilder<QB>(
  qb: QB,
  operation: string,
  transform: (
    qb: SelectQueryBuilder<Record<string, unknown>, string, Record<string, unknown>>
  ) => SelectQueryBuilder<Record<string, unknown>, string, Record<string, unknown>>
): QB {
  if (operation !== 'select') {
    return qb
  }

  const transformed = transform(qb as any)
  return transformed as QB
}

/**
 * Type guard to check if an executor has a raw db instance
 *
 * @param executor - Kysely executor (may have __rawDb property)
 * @returns True if executor has __rawDb property
 */
export function hasRawDb<DB>(
  executor: Kysely<DB>
): executor is Kysely<DB> & { __rawDb: Kysely<DB> } {
  return '__rawDb' in executor && (executor as any).__rawDb !== undefined
}

/**
 * Type-safe wrapper to get raw db from executor
 *
 * @param executor - Kysely executor with optional __rawDb
 * @returns Raw db instance or original executor
 */
export function getRawDbSafe<DB>(executor: Kysely<DB>): Kysely<DB> {
  if (hasRawDb(executor)) {
    return executor.__rawDb
  }
  return executor
}
