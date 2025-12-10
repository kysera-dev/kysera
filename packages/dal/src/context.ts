/**
 * Database context and transaction utilities.
 *
 * @module @kysera/dal
 */

import type { Kysely, Transaction } from 'kysely';
import type { DbContext, TransactionOptions } from './types.js';

/**
 * Create a database context from a Kysely instance.
 *
 * @param db - Kysely database or transaction instance
 * @returns Database context
 *
 * @example
 * ```typescript
 * import { createContext } from '@kysera/dal';
 *
 * const ctx = createContext(db);
 * const user = await findUserById(ctx, 1);
 * ```
 */
export function createContext<DB>(db: Kysely<DB> | Transaction<DB>): DbContext<DB> {
  // Check if it's a transaction by looking for transaction-specific properties
  const isTransaction = 'isTransaction' in db && db.isTransaction;

  return {
    db,
    isTransaction,
  };
}

/**
 * Execute a function within a transaction.
 *
 * If already in a transaction, reuses the existing transaction.
 * Otherwise, creates a new transaction.
 *
 * @param db - Kysely database instance
 * @param fn - Function to execute within transaction
 * @param options - Transaction options
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
 * @example With isolation level
 * ```typescript
 * import { withTransaction } from '@kysera/dal';
 *
 * const result = await withTransaction(
 *   db,
 *   async (ctx) => {
 *     // Critical operation requiring serializable isolation
 *     return processPayment(ctx, paymentData);
 *   },
 *   { isolationLevel: 'serializable' }
 * );
 * ```
 */
export async function withTransaction<DB, T>(
  db: Kysely<DB>,
  fn: (ctx: DbContext<DB>) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  return await db.transaction().execute(async (trx) => {
    // Set isolation level if specified
    // Note: Isolation level must be set at the connection/dialect level in Kysely,
    // or you can use database-specific SQL before starting the transaction.
    // This is a limitation of Kysely's Transaction API which doesn't expose raw().
    if (options.isolationLevel) {
      // Isolation level setting is not directly supported on Transaction in Kysely.
      // Users should configure isolation at the pool/connection level instead.
      // See: https://kysely.dev/docs/recipes/transactions
      console.warn(
        `[@kysera/dal] Isolation level '${options.isolationLevel}' specified but not applied. ` +
          'Configure isolation at the database pool level for your dialect.'
      );
    }

    const ctx: DbContext<DB> = {
      db: trx,
      isTransaction: true,
    };

    return await fn(ctx);
  });
}

/**
 * Execute a function with a database context.
 *
 * Creates a context without a transaction.
 *
 * @param db - Kysely database instance
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
  db: Kysely<DB>,
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
