/**
 * Retry utilities for transient database errors.
 *
 * @module @kysera/infra/resilience
 */

/**
 * Options for retry behavior.
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts.
   * @default 3
   */
  maxAttempts?: number;

  /**
   * Initial delay between retries in milliseconds.
   * @default 1000
   */
  delayMs?: number;

  /**
   * Use exponential backoff for delays.
   * @default true
   */
  backoff?: boolean;

  /**
   * Custom function to determine if error should be retried.
   * @default isTransientError
   */
  shouldRetry?: (error: unknown) => boolean;

  /**
   * Callback invoked on each retry attempt.
   */
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Known transient error codes that can be safely retried.
 *
 * Includes codes for:
 * - Network errors (connection refused, timeout, reset)
 * - PostgreSQL transient errors (connection failures, deadlocks)
 * - MySQL transient errors (deadlocks, lock timeouts)
 * - SQLite transient errors (busy, locked)
 */
const TRANSIENT_ERROR_CODES = new Set([
  // Network errors
  'ECONNREFUSED', // Connection refused
  'ETIMEDOUT', // Connection timeout
  'ECONNRESET', // Connection reset
  'EPIPE', // Broken pipe

  // PostgreSQL
  '57P03', // Cannot connect now
  '08006', // Connection failure
  '08001', // Unable to connect
  '08003', // Connection does not exist
  '08004', // Connection rejected
  '40001', // Serialization failure
  '40P01', // Deadlock detected

  // MySQL
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_CON_COUNT_ERROR',

  // SQLite
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
]);

/**
 * Check if error is transient (can be retried).
 *
 * Examines the error code against known transient error codes
 * from PostgreSQL, MySQL, SQLite, and network errors.
 *
 * @param error - Error to check
 * @returns True if error is transient and can be retried
 *
 * @example
 * ```typescript
 * import { isTransientError } from '@kysera/infra/resilience';
 *
 * try {
 *   await db.selectFrom('users').execute();
 * } catch (error) {
 *   if (isTransientError(error)) {
 *     console.log('Transient error, retrying...');
 *   }
 * }
 * ```
 */
export function isTransientError(error: unknown): boolean {
  if (error === null || error === undefined || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: string }).code;
  if (!code) return false;

  return TRANSIENT_ERROR_CODES.has(code);
}

/**
 * Retry a function with exponential backoff.
 *
 * Executes the provided function and retries on transient errors
 * with configurable delay and backoff strategy.
 *
 * @param fn - Function to execute and retry on failure
 * @param options - Retry configuration options
 * @returns Result of the function
 * @throws Last error if all retry attempts fail
 *
 * @example Basic usage
 * ```typescript
 * import { withRetry } from '@kysera/infra/resilience';
 *
 * const users = await withRetry(
 *   () => db.selectFrom('users').selectAll().execute()
 * );
 * ```
 *
 * @example With custom options
 * ```typescript
 * import { withRetry } from '@kysera/infra/resilience';
 *
 * const result = await withRetry(
 *   () => db.insertInto('orders').values(orderData).execute(),
 *   {
 *     maxAttempts: 5,
 *     delayMs: 500,
 *     backoff: true,
 *     onRetry: (attempt, error) => {
 *       console.log(`Retry ${attempt}, error:`, error);
 *     },
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoff = true,
    shouldRetry = isTransientError,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if this is the last attempt or error is not retryable
      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      onRetry?.(attempt, error);

      // Calculate delay with optional exponential backoff
      const delay = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Create a retry wrapper for a function.
 *
 * Returns a new function that wraps the original with retry logic.
 * Useful for creating reusable retry-enabled database operations.
 *
 * @param fn - Function to wrap with retry logic
 * @param options - Retry configuration options
 * @returns Wrapped function with retry capability
 *
 * @example
 * ```typescript
 * import { createRetryWrapper } from '@kysera/infra/resilience';
 *
 * const fetchUsers = async () => db.selectFrom('users').selectAll().execute();
 * const fetchUsersWithRetry = createRetryWrapper(fetchUsers, { maxAttempts: 3 });
 *
 * const users = await fetchUsersWithRetry();
 * ```
 */
export function createRetryWrapper<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    return await withRetry(() => fn(...args), options);
  };
}
