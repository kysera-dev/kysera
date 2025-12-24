/**
 * Database context and transaction utilities.
 *
 * @module @kysera/dal
 */

import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import type { KyseraExecutor, KyseraTransaction } from '@kysera/executor'
import { isKyseraExecutor, getPlugins, wrapTransaction } from '@kysera/executor'
import { silentLogger, type KyseraLogger, detectDialect } from '@kysera/core'
import type { DbContext, TransactionOptions } from './types.js'
import {
  DB_CONTEXT_SYMBOL,
  IN_TRANSACTION_SYMBOL,
  SAVEPOINT_COUNTER_SYMBOL,
  isDbContext
} from './types.js'

/**
 * Detect if a database instance is currently in a transaction.
 *
 * Uses a unified detection mechanism that checks:
 * 1. Internal IN_TRANSACTION_SYMBOL marker (set by withTransaction)
 * 2. KyseraTransaction marker (__kysera property with __rawDb.isTransaction)
 * 3. Kysely's isTransaction property (for raw Transaction instances)
 *
 * The internal marker takes precedence to ensure reliable detection
 * across nested transactions and savepoints.
 *
 * @internal
 */
function detectTransaction<DB>(
  db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>
): boolean {
  // Check internal marker first (most reliable, set by withTransaction)
  if (hasInTransactionMarker(db)) {
    return true
  }

  // Check for KyseraTransaction marker (wrapped transaction with plugins)
  // This ensures we don't assume Kysely internals on wrapped executors
  if (isKyseraTransaction(db)) {
    return true
  }

  // Fallback to Kysely's isTransaction property (for raw Transaction instances)
  // Only safe when not a KyseraExecutor (already checked above)
  return 'isTransaction' in db && db.isTransaction
}

/**
 * Check if a database instance is a KyseraTransaction.
 * KyseraTransaction has __kysera marker and wraps a Transaction instance.
 *
 * @internal
 */
function isKyseraTransaction<DB>(
  db: Kysely<DB> | Transaction<DB> | KyseraExecutor<DB> | KyseraTransaction<DB>
): db is KyseraTransaction<DB> {
  // Check for KyseraExecutor marker - runtime check for unknown inputs
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!('__kysera' in db && db.__kysera)) {
    return false
  }

  // Type assertion is safe here because we just checked __kysera exists
  const executor = db

  // Check if __rawDb exists (it might be missing on malformed executors)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!executor.__rawDb) {
    return false
  }

  // Check if the raw database is a transaction
  const rawDb = executor.__rawDb as unknown as { isTransaction?: boolean }
  return rawDb.isTransaction === true
}

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
  // If explicitly provided, use that value; otherwise use unified detection
  const inTransaction = isTransaction ?? detectTransaction(db)

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
    throw new Error('Invalid savepoint counter: expected positive integer, got ' + String(nextId))
  }

  obj[SAVEPOINT_COUNTER_SYMBOL] = nextId
  return nextId
}

/**
 * Extended transaction options with logger support and rollback error handling.
 */
export interface TransactionOptionsWithLogger extends TransactionOptions {
  /**
   * Logger for transaction operations.
   * Defaults to silentLogger (no-op).
   */
  logger?: KyseraLogger
  /**
   * How to handle savepoint rollback errors in nested transactions.
   *
   * - 'log-only' (default): Log rollback errors but don't throw (original error is more important)
   * - 'throw': Throw rollback error instead of original error (useful for debugging)
   * - 'callback': Call onRollbackError callback with both errors (for custom handling)
   *
   * @default 'log-only'
   */
  rollbackErrorMode?: 'log-only' | 'throw' | 'callback'
  /**
   * Callback invoked when savepoint rollback fails (only used with rollbackErrorMode: 'callback').
   *
   * Receives both the original error that triggered the rollback and the rollback error.
   * This allows custom error handling logic (e.g., logging to external service, alerting, etc.)
   *
   * @param originalError - The error that caused the savepoint to rollback
   * @param rollbackError - The error that occurred during rollback
   */
  onRollbackError?: (originalError: unknown, rollbackError: unknown) => void | Promise<void>
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
 * @param options - Transaction options (isolation level, logger)
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
 *
 * @example With custom logger
 * ```typescript
 * import { consoleLogger } from "@kysera/core";
 *
 * await withTransaction(db, async (ctx) => {
 *   return await operation(ctx);
 * }, { logger: consoleLogger });
 * ```
 *
 * @example With rollback error handling
 * ```typescript
 * // Throw rollback error instead of original error (debugging)
 * await withTransaction(db, async (ctx) => {
 *   // ...
 * }, { rollbackErrorMode: 'throw' });
 *
 * // Custom error handling callback
 * await withTransaction(db, async (ctx) => {
 *   // ...
 * }, {
 *   rollbackErrorMode: 'callback',
 *   onRollbackError: async (originalError, rollbackError) => {
 *     await logToMonitoring({
 *       type: 'savepoint_rollback_failure',
 *       originalError,
 *       rollbackError
 *     });
 *   }
 * });
 * ```
 */
// eslint-disable-next-line complexity
export async function withTransaction<DB, T>(
  db: Kysely<DB> | KyseraExecutor<DB> | DbContext<DB>,
  fn: (ctx: DbContext<DB>) => Promise<T>,
  options: TransactionOptionsWithLogger = {}
): Promise<T> {
  const { logger = silentLogger, rollbackErrorMode = 'log-only', onRollbackError } = options

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
    const savepointName = 'kysera_sp_' + String(savepointId)

    // Detect dialect for savepoint syntax
    const dialect = detectDialect(actualDb)

    try {
      // Create savepoint - use dialect-specific syntax
      // PostgreSQL/MySQL/SQLite: SAVEPOINT name
      // MSSQL: SAVE TRANSACTION name
      if (dialect === 'mssql') {
        await sql`SAVE TRANSACTION ${sql.id(savepointName)}`.execute(actualDb as Transaction<DB>)
      } else {
        await sql`SAVEPOINT ${sql.id(savepointName)}`.execute(actualDb as Transaction<DB>)
      }

      // Create context with same db (already in transaction)
      const ctx: DbContext<DB> = {
        [DB_CONTEXT_SYMBOL]: true,
        db: actualDb,
        isTransaction: true
      }

      // Execute function
      const result = await fn(ctx)

      // Release savepoint on success
      // PostgreSQL/MySQL/SQLite: RELEASE SAVEPOINT name
      // MSSQL: Does not support RELEASE, savepoint is automatically released on commit
      if (dialect !== 'mssql') {
        await sql`RELEASE SAVEPOINT ${sql.id(savepointName)}`.execute(actualDb as Transaction<DB>)
      }

      return result
    } catch (error) {
      // Rollback to savepoint on error
      try {
        // PostgreSQL/MySQL/SQLite: ROLLBACK TO SAVEPOINT name
        // MSSQL: ROLLBACK TRANSACTION name
        if (dialect === 'mssql') {
          await sql`ROLLBACK TRANSACTION ${sql.id(savepointName)}`.execute(
            actualDb as Transaction<DB>
          )
        } else {
          await sql`ROLLBACK TO SAVEPOINT ${sql.id(savepointName)}`.execute(
            actualDb as Transaction<DB>
          )
        }
      } catch (rollbackError) {
        // Handle rollback errors based on configured mode
        switch (rollbackErrorMode) {
          case 'throw':
            // Throw rollback error instead of original error (useful for debugging)
            throw rollbackError
          case 'callback':
            // Call custom callback with both errors
            // eslint-disable-next-line max-depth
            if (onRollbackError) {
              await onRollbackError(error, rollbackError)
            }
            break
          case 'log-only':
          default:
            // Log rollback failure (default behavior)
            // Original error is more important, so we do not throw here
            logger.error('Savepoint rollback failed for ' + savepointName + ':', rollbackError)
            break
        }
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
