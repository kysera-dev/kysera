/**
 * Custom error classes for @kysera/dal
 *
 * @module @kysera/dal
 */

import { DatabaseError, ErrorCodes } from '@kysera/core'

/**
 * Error thrown when a query that requires a transaction is called outside of a transaction context.
 *
 * Extends DatabaseError from @kysera/core for consistent error hierarchy
 * with `.code` and `.toJSON()` support.
 *
 * @example
 * ```typescript
 * import { createTransactionalQuery, withTransaction } from '@kysera/dal';
 *
 * const transferFunds = createTransactionalQuery(async (ctx, from, to, amount) => {
 *   // ... transfer logic
 * });
 *
 * // This throws TransactionRequiredError:
 * await transferFunds(db, 1, 2, 100);
 *
 * // This works:
 * await withTransaction(db, (ctx) => transferFunds(ctx, 1, 2, 100));
 * ```
 */
export class TransactionRequiredError extends DatabaseError {
  /**
   * Create a new TransactionRequiredError
   *
   * @param message - Error message
   */
  constructor(
    message = 'Query requires a transaction. Use withTransaction() to execute this query.'
  ) {
    super(message, ErrorCodes.DB_TRANSACTION_FAILED)
    this.name = 'TransactionRequiredError'
  }
}
