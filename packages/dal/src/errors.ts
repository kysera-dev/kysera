/**
 * Custom error classes for @kysera/dal
 *
 * @module @kysera/dal
 */

/**
 * Error thrown when a query that requires a transaction is called outside of a transaction context.
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
export class TransactionRequiredError extends Error {
  /**
   * Create a new TransactionRequiredError
   *
   * @param message - Error message
   */
  constructor(
    message = 'Query requires a transaction. Use withTransaction() to execute this query.'
  ) {
    super(message)
    this.name = 'TransactionRequiredError'
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TransactionRequiredError)
    }
  }
}
