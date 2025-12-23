/**
 * Database context and transaction utilities.
 *
 * @module @kysera/dal
 */

import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import type { KyseraExecutor, KyseraTransaction } from '@kysera/executor'
import { isKyseraExecutor, getPlugins, wrapTransaction } from '@kysera/executor'
import type { DbContext, TransactionOptions } from './types.js'
import {
  DB_CONTEXT_SYMBOL,
  IN_TRANSACTION_SYMBOL,
  SAVEPOINT_COUNTER_SYMBOL,
  isDbContext
} from './types.js'

/**
 * Create a database context from any database instance.
 *
 * Supports raw Kysely instances and plugin-aware KyseraExecutor.
 * When using KyseraExecutor, plugins are automatically available in context.
 *
 * @param db - Kysely, KyseraExecutor, or transaction instance
 * @param isTransaction - Override transaction detection (optional)
 * @returns Database context
 *
 * @example
 * ```typescript
 * import { createContext } from "@kysera/dal";
 * import { createExecutor } from "@kysera/executor";
 *
 * const executor = await createExecutor(db, [softDeletePlugin()]);
 * const ctx = createContext(executor);
 * const user = await findUserById(ctx, 1); // soft-delete filter applied
 * ```
 */
export function createContext<DB>(
  db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>,
  isTransaction?: boolean
): DbContext<DB> {
  // If explicitly provided, use that value; otherwise detect from db
  const inTransaction =
    isTransaction ?? (('isTransaction' in db && db.isTransaction) || hasInTransactionMarker(db))

  return {
    [DB_CONTEXT_SYMBOL]: true,
    db,
    isTransaction: inTransaction
  }
}

/**
 * Check if a database instance has the in-transaction marker.
 * @internal
 */
function hasInTransactionMarker<DB>(
  db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>
): boolean {
  return (db as unknown as Record<symbol, boolean>)[IN_TRANSACTION_SYMBOL] === true
}

/**
 * Mark a database instance as being in a transaction.
 * @internal
 */
function markAsInTransaction<T>(obj: T): T {
  ;(obj as unknown as Record<symbol, boolean>)[IN_TRANSACTION_SYMBOL] = true
  return obj
}

/**
 * Increment and return the savepoint counter for a transaction.
 * Validates the counter to prevent SQL injection through malformed savepoint names.
 * @internal
 */
function incrementSavepointCounter<DB>(
  db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>
): number {
  const obj = db as unknown as Record<symbol, number>
  const current = obj[SAVEPOINT_COUNTER_SYMBOL] ?? 0
  const nextId = current + 1

  // CRITICAL: Explicit validation to prevent SQL injection
  // Savepoint ID must be a positive integer to ensure safe identifier construction
  if (!Number.isInteger(nextId) || nextId < 1 || nextId > 1_000_000) {
    throw new Error(`Invalid savepoint counter: expected positive integer, got ${String(nextId)}`)
  }

  obj[SAVEPOINT_COUNTER_SYMBOL] = nextId
  return nextId
}

/**
 * Execute a function within a transaction.
 *
 * If the database is a KyseraExecutor, plugins are automatically propagated
 * to the transaction context. Otherwise, creates a standard Kysely transaction.
 *
 * **Nested Transaction Support with Savepoints:**
 * When called within an existing transaction, this function automatically creates
 * a savepoint instead of a new transaction. If the nested operation throws an error,
 * only the savepoint is rolled back, leaving the parent transaction intact.
 *
 * @param db - Database instance (Kysely or KyseraExecutor) or DbContext
 * @param fn - Function to execute within transaction
 * @param options - Transaction options (isolation level, only applies to top-level transaction)
 * @returns Result of the function
 *
 * @example Basic usage
 * ```typescript
 * import { withTransaction } from "@kysera/dal";
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
 * import { createExecutor } from "@kysera/executor";
 * import { withTransaction } from "@kysera/dal";
 *
 * const executor = await createExecutor(db, [softDeletePlugin()]);
 *
 * const result = await withTransaction(executor, async (ctx) => {
 *   // All queries in transaction have soft-delete filter applied
 *   const users = await getUsers(ctx);
 *   return users;
 * });
 * ```
 *
 * @example Nested transactions with savepoints (automatic rollback on error)
 * ```typescript
 * await withTransaction(db, async (ctx) => {
 *   const user = await createUser(ctx, userData);
 *
 *   try {
 *     // This nested call creates a SAVEPOINT
 *     await withTransaction(ctx.db, async (nestedCtx) => {
 *       await createProfile(nestedCtx, profileData);
 *       throw new Error("Profile validation failed");
 *     });
 *   } catch (error) {
 *     // Profile creation rolled back to savepoint
 *     // User creation still exists in transaction
 *   }
 *
 *   // User creation will be committed
 * });
 * ```
 *
 * @example With isolation level (top-level only)
 * ```typescript
 * await withTransaction(db, async (ctx) => {
 *   // Serializable isolation for strict consistency
 *   return await criticalOperation(ctx);
 * }, { isolationLevel: "serializable" });
 * ```
 */
export async function withTransaction<DB, T>(
  db: Kysely<DB> | KyseraExecutor<DB> | DbContext<DB>,
  fn: (ctx: DbContext<DB>) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  // Handle DbContext input - extract the db instance
  const actualDb: Kysely<DB> | KyseraExecutor<DB> = isDbContext<DB>(db)
    ? (db.db as Kysely<DB> | KyseraExecutor<DB>)
    : db

  // Check if we are already inside a transaction (nested call)
  if (hasInTransactionMarker(actualDb)) {
    // Use savepoint for nested transaction
    const savepointId = incrementSavepointCounter(actualDb)
    // CRITICAL: Strict validation ensures savepointId is a positive integer (1-1000000)
    // This prevents SQL injection through savepoint name construction
    const savepointName = `kysera_sp_${String(savepointId)}`

    try {
      // Create savepoint - use Kysely sql template literal
      await sql`SAVEPOINT ${sql.id(savepointName)}`.execute(actualDb as Transaction<DB>)

      // Create context with same db (already in transaction)
      const ctx: DbContext<DB> = {
        [DB_CONTEXT_SYMBOL]: true,
        db: actualDb,
        isTransaction: true
      }

      // Execute function
      const result = await fn(ctx)

      // Release savepoint on success
      await sql`RELEASE SAVEPOINT ${sql.id(savepointName)}`.execute(actualDb as Transaction<DB>)

      return result
    } catch (error) {
      // Rollback to savepoint on error
      try {
        await sql`ROLLBACK TO SAVEPOINT ${sql.id(savepointName)}`.execute(
          actualDb as Transaction<DB>
        )
      } catch (rollbackError) {
        // HIGH: Log rollback failure to prevent silent errors
        // Original error is more important, so we don't throw here
        console.error(`[Kysera DAL] Savepoint rollback failed for ${savepointName}:`, rollbackError)
      }
      throw error
    }
  }

  // Create transaction builder
  const transactionBuilder = actualDb.transaction()

  // Apply isolation level if specified (only valid for top-level transaction)
  if (options.isolationLevel) {
    transactionBuilder.setIsolationLevel(options.isolationLevel)
  }

  return await transactionBuilder.execute(async (trx: Transaction<DB>) => {
    // Wrap transaction with plugins if using KyseraExecutor
    const wrappedTrx = isKyseraExecutor(actualDb) ? wrapTransaction(trx, getPlugins(actualDb)) : trx

    // Mark the transaction as being in a transaction (for nested detection)
    markAsInTransaction(wrappedTrx)

    // Initialize savepoint counter
    ;(wrappedTrx as unknown as Record<symbol, number>)[SAVEPOINT_COUNTER_SYMBOL] = 0

    const ctx: DbContext<DB> = {
      [DB_CONTEXT_SYMBOL]: true,
      db: wrappedTrx,
      isTransaction: true
    }

    return await fn(ctx)
  })
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
 * import { withContext } from "@kysera/dal";
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
  const ctx = createContext(db)
  return await fn(ctx)
}

/**
 * Check if context is within a transaction.
 *
 * @param ctx - Database context
 * @returns True if within a transaction
 */
export function isInTransaction<DB>(ctx: DbContext<DB>): boolean {
  return ctx.isTransaction
}
