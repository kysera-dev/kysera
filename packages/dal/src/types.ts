/**
 * Core types for Functional DAL.
 *
 * @module @kysera/dal
 */

import type { Kysely, Transaction } from 'kysely'
import type { KyseraExecutor, KyseraTransaction } from '@kysera/executor'

/**
 * Symbol used to reliably identify DbContext objects.
 * Using Symbol.for() ensures the same symbol is used across different module instances.
 */
export const DB_CONTEXT_SYMBOL: unique symbol = Symbol.for('kysera.DbContext')

/**
 * Symbol used to mark that we are inside a transaction (for nested transaction detection).
 */
export const IN_TRANSACTION_SYMBOL: unique symbol = Symbol.for('kysera.InTransaction')

/**
 * Symbol used to track savepoint nesting depth for unique savepoint names.
 */
export const SAVEPOINT_COUNTER_SYMBOL: unique symbol = Symbol.for('kysera.SavepointCounter')

/**
 * Database context for query functions.
 *
 * Supports both raw Kysely instances and plugin-aware KyseraExecutor.
 * When using KyseraExecutor, all queries automatically have plugins applied.
 *
 * @typeParam DB - Database schema type, defaults to Record<string, unknown>
 */
export interface DbContext<DB = Record<string, unknown>> {
  /** Marker symbol for reliable type detection */
  readonly [DB_CONTEXT_SYMBOL]: true
  /** Database or transaction instance (raw or plugin-aware) */
  readonly db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>
  /** Whether the context is within a transaction */
  readonly isTransaction: boolean
}

/**
 * Options for transaction execution.
 */
export interface TransactionOptions {
  /**
   * Isolation level for the transaction.
   * Note: Kysely's setIsolationLevel must be called on the transaction builder.
   */
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'
}

/**
 * Query function signature.
 *
 * A query function accepts database context or any database instance and arguments,
 * returning a Promise with the result.
 *
 * Supports:
 * - `DbContext<DB>` - Explicit context (inside `withTransaction`)
 * - `Kysely<DB>` - Raw Kysely instance
 * - `KyseraExecutor<DB>` - Plugin-aware executor (recommended)
 *
 * @typeParam DB - Database schema type
 * @typeParam TArgs - Tuple of argument types
 * @typeParam TResult - Return type
 */
export type QueryFunction<DB, TArgs extends readonly unknown[], TResult> = (
  ctxOrDb: DbContext<DB> | Kysely<DB> | KyseraExecutor<DB>,
  ...args: TArgs
) => Promise<TResult>

/**
 * Infer result type from a query function.
 */
export type InferResult<T> =
  T extends QueryFunction<Record<string, unknown>, readonly unknown[], infer R> ? R : never

/**
 * Infer arguments type from a query function.
 */
export type InferArgs<T> =
  T extends QueryFunction<Record<string, unknown>, infer A, unknown> ? A : never

/**
 * Infer database type from a query function.
 */
export type InferDB<T> = T extends QueryFunction<infer DB, readonly unknown[], unknown> ? DB : never

/**
 * Type guard to check if a value is a DbContext.
 * Uses the DB_CONTEXT_SYMBOL for reliable detection.
 */
export function isDbContext<DB>(obj: unknown): obj is DbContext<DB> {
  return typeof obj === 'object' && obj !== null && DB_CONTEXT_SYMBOL in obj
}
