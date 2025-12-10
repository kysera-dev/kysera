/**
 * Core types for Functional DAL.
 *
 * @module @kysera/dal
 */

import type { Kysely, Transaction } from 'kysely';

/**
 * Database context for query functions.
 *
 * Contains the database instance (either Kysely or Transaction)
 * and metadata about the current execution context.
 *
 * @typeParam DB - Database schema type, defaults to Record<string, unknown>
 */
export interface DbContext<DB = Record<string, unknown>> {
  /** Database or transaction instance */
  readonly db: Kysely<DB> | Transaction<DB>;
  /** Whether the context is within a transaction */
  readonly isTransaction: boolean;
}

/**
 * Options for transaction execution.
 */
export interface TransactionOptions {
  /**
   * Isolation level for the transaction.
   */
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
}

/**
 * Query function signature.
 *
 * A query function takes a database context (or Kysely instance) and arguments,
 * and returns a Promise with the result.
 *
 * The function can be called with either:
 * - `DbContext<DB>` - when inside `withTransaction` or with explicit context
 * - `Kysely<DB>` - for convenience, context is created automatically
 *
 * @typeParam DB - Database schema type
 * @typeParam TArgs - Tuple of argument types
 * @typeParam TResult - Return type
 */
export type QueryFunction<DB, TArgs extends readonly unknown[], TResult> = (
  ctxOrDb: DbContext<DB> | Kysely<DB>,
  ...args: TArgs
) => Promise<TResult>;

/**
 * Infer result type from a query function.
 */
export type InferResult<T> = T extends QueryFunction<
  Record<string, unknown>,
  readonly unknown[],
  infer R
>
  ? R
  : never;

/**
 * Infer arguments type from a query function.
 */
export type InferArgs<T> = T extends QueryFunction<Record<string, unknown>, infer A, unknown>
  ? A
  : never;

/**
 * Infer database type from a query function.
 */
export type InferDB<T> = T extends QueryFunction<infer DB, readonly unknown[], unknown> ? DB : never;
