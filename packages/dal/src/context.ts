/**
 * Database context and transaction utilities.
 *
 * @module @kysera/dal
 */

import type { Kysely, Transaction } from 'kysely';
import type { KyseraExecutor, KyseraTransaction } from '@kysera/executor';
import { isKyseraExecutor, getPlugins, wrapTransaction } from '@kysera/executor';
import type { DbContext, TransactionOptions } from './types.js';

/**
 * Create a database context from any database instance.
 *
 * Supports raw Kysely instances and plugin-aware KyseraExecutor.
 * When using KyseraExecutor, plugins are automatically available in context.
 *
 * @param db - Kysely, KyseraExecutor, or transaction instance
 * @returns Database context
 *
 * @example
 * ```typescript
 * import { createContext } from '@kysera/dal';
 * import { createExecutor } from '@kysera/executor';
 *
 * const executor = await createExecutor(db, [softDeletePlugin()]);
 * const ctx = createContext(executor);
 * const user = await findUserById(ctx, 1); // soft-delete filter applied
 * ```
 */
export function createContext<DB>(
  db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>
): DbContext<DB> {
  const isTransaction = 'isTransaction' in db && db.isTransaction;

  return {
    db,
    isTransaction,
  };
}

/**
 * Execute a function within a transaction.
 *
 * If the database is a KyseraExecutor, plugins are automatically propagated
 * to the transaction context. Otherwise, creates a standard Kysely transaction.
 *
 * @param db - Database instance (Kysely or KyseraExecutor)
 * @param fn - Function to execute within transaction
 * @param options - Transaction options (isolation level not supported in Kysely API)
 * @returns Result of the function
 *
 * @example Basic usage
 * ```typescript
 * import { withTransaction } from '@kysera/dal';
 *
 * const result = await withTransaction(db, async (ctx) => {
 *   const user = await createUser(ctx, userData);
 *   const profile = await createProfile(ctx, { userId: user.id, ...profileData });
 *   return { user, profile };
 * });
 * ```
 *
 * @example With KyseraExecutor (plugins propagated)
 * ```typescript
 * import { createExecutor } from '@kysera/executor';
 * import { withTransaction } from '@kysera/dal';
 *
 * const executor = await createExecutor(db, [softDeletePlugin()]);
 *
 * const result = await withTransaction(executor, async (ctx) => {
 *   // All queries in transaction have soft-delete filter applied
 *   const users = await getUsers(ctx);
 *   return users;
 * });
 * ```
 */
export async function withTransaction<DB, T>(
  db: Kysely<DB> | KyseraExecutor<DB>,
  fn: (ctx: DbContext<DB>) => Promise<T>,
  _options: TransactionOptions = {}
): Promise<T> {
  return await db.transaction().execute(async (trx: Transaction<DB>) => {
    // Wrap transaction with plugins if using KyseraExecutor
    const wrappedTrx = isKyseraExecutor(db)
      ? wrapTransaction(trx, getPlugins(db))
      : trx;

    const ctx: DbContext<DB> = {
      db: wrappedTrx,
      isTransaction: true,
    };

    return await fn(ctx);
  });
}

/**
 * Execute a function with a database context.
 *
 * Creates a context without a transaction.
 * Supports both Kysely and KyseraExecutor instances.
 *
 * @param db - Database instance (Kysely or KyseraExecutor)
 * @param fn - Function to execute
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * import { withContext } from '@kysera/dal';
 *
 * const users = await withContext(db, async (ctx) => {
 *   return getAllUsers(ctx);
 * });
 * ```
 */
export async function withContext<DB, T>(
  db: Kysely<DB> | KyseraExecutor<DB>,
  fn: (ctx: DbContext<DB>) => Promise<T>
): Promise<T> {
  const ctx = createContext(db);
  return await fn(ctx);
}

/**
 * Check if context is within a transaction.
 *
 * @param ctx - Database context
 * @returns True if within a transaction
 */
export function isInTransaction<DB>(ctx: DbContext<DB>): boolean {
  return ctx.isTransaction;
}
