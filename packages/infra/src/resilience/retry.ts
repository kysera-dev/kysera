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
  maxAttempts?: number

  /**
   * Initial delay between retries in milliseconds.
   * @default 1000
   */
  delayMs?: number

  /**
   * Maximum delay between retries in milliseconds.
   * Caps the exponential backoff to prevent excessive wait times.
   * @default 30000
   */
  maxDelayMs?: number

  /**
   * Use exponential backoff for delays.
   * @default true
   */
  backoff?: boolean

  /**
   * Jitter factor for randomizing delays (0 to 1).
   * Helps prevent thundering herd problem.
   * @default 0.25
   */
  jitterFactor?: number

  /**
   * Custom function to determine if error should be retried.
   * @default isTransientError
   */
  shouldRetry?: (error: unknown) => boolean

  /**
   * Callback invoked on each retry attempt.
   */
  onRetry?: (attempt: number, error: unknown) => void
}

/**
 * Known transient error codes that can be safely retried.
 *
 * Includes codes for:
 * - Network errors (connection refused, timeout, reset)
 * - PostgreSQL transient errors (connection failures, deadlocks)
 * - MySQL transient errors (deadlocks, lock timeouts)
 * - SQLite transient errors (busy, locked)
 * - MSSQL transient errors (timeout, deadlock, connection issues)
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
  '08000', // Connection exception
  '40001', // Serialization failure
  '40P01', // Deadlock detected
  '57P01', // Admin shutdown
  '57P02', // Crash shutdown

  // MySQL
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_CON_COUNT_ERROR',
  'PROTOCOL_CONNECTION_LOST',

  // SQLite
  'SQLITE_BUSY',
  'SQLITE_LOCKED',

  // MSSQL (SQL Server)
  '-2', // Timeout
  '1205', // Deadlock
  '1222', // Lock timeout
  '-1', // Connection error
  '233', // Connection closed
  '10054', // Connection reset
  '10053' // Connection aborted
])

/**
 * Check if error is transient (can be retried).
 *
 * Examines the error code against known transient error codes
 * from PostgreSQL, MySQL, SQLite, MSSQL, and network errors.
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
    return false
  }

  // Check 'code' property (common in Node.js and most database drivers)
  const code = (error as { code?: string | number }).code
  if (code !== undefined) {
    const codeStr = String(code)
    if (TRANSIENT_ERROR_CODES.has(codeStr)) {
      return true
    }
  }

  // Check 'number' property (MSSQL uses this for error numbers)
  const number = (error as { number?: number }).number
  if (number !== undefined) {
    const numberStr = String(number)
    if (TRANSIENT_ERROR_CODES.has(numberStr)) {
      return true
    }
  }

  return false
}

/**
 * Calculate delay with exponential backoff and jitter.
 *
 * Jitter helps prevent the thundering herd problem where multiple
 * clients retry at exactly the same time after a failure.
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay cap in milliseconds
 * @param jitterFactor - Jitter factor (0 to 1), default 0.25
 * @returns Calculated delay in milliseconds
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitterFactor = 0.25
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt)

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelay)

  // Add random jitter: delay * (1 - jitter + random * 2 * jitter)
  // This gives us delay * (0.75 to 1.25) for jitterFactor = 0.25
  const jitter = cappedDelay * jitterFactor * (2 * Math.random() - 1)

  return Math.max(0, cappedDelay + jitter)
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
 *     maxDelayMs: 10000,
 *     backoff: true,
 *     jitterFactor: 0.3,
 *     onRetry: (attempt, error) => {
 *       console.log('Retry attempt:', attempt, 'error:', error);
 *     },
 *   }
 * );
 * ```
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    maxDelayMs = 30000,
    backoff = true,
    jitterFactor = 0.25,
    shouldRetry = isTransientError,
    onRetry
  } = options

  // Validate maxDelayMs is not less than delayMs
  if (maxDelayMs < delayMs) {
    throw new Error(
      'maxDelayMs (' + String(maxDelayMs) + ') must be greater than or equal to delayMs (' + String(delayMs) + ')'
    )
  }

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Do not retry if this is the last attempt or error is not retryable
      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error
      }

      onRetry?.(attempt, error)

      // Calculate delay with optional exponential backoff and jitter
      const delay = backoff
        ? calculateDelay(attempt - 1, delayMs, maxDelayMs, jitterFactor)
        : delayMs

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
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
    return await withRetry(() => fn(...args), options)
  }
}
