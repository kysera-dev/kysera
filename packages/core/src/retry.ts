/**
 * Retry utilities for transient database errors
 */

import { DatabaseError } from './errors.js';
import { ErrorCodes } from './error-codes.js';

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: boolean;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Check if error is transient (can be retried)
 */
export function isTransientError(error: unknown): boolean {
  const code = (error as any)?.code;
  const transientCodes = [
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
  ];

  return transientCodes.includes(code);
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoff = true, shouldRetry = isTransientError, onRetry } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      onRetry?.(attempt, error);

      const delay = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Create a retry wrapper for a function
 */
export function createRetryWrapper<T extends (...args: any[]) => Promise<any>>(fn: T, options: RetryOptions = {}): T {
  return (async (...args: Parameters<T>) => {
    return withRetry(() => fn(...args), options);
  }) as T;
}

/**
 * Circuit breaker for preventing cascading failures
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime?: number;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeMs: number = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should be reset
    if (this.state === 'open' && this.lastFailureTime && Date.now() - this.lastFailureTime > this.resetTimeMs) {
      this.state = 'half-open';
    }

    // If circuit is open, fail fast
    if (this.state === 'open') {
      throw new DatabaseError('Circuit breaker is open', ErrorCodes.DB_CONNECTION_FAILED);
    }

    try {
      const result = await fn();

      // Reset on success
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      // Open circuit if threshold exceeded
      if (this.failures >= this.threshold) {
        this.state = 'open';
      }

      throw error;
    }
  }

  reset(): void {
    this.failures = 0;
    this.state = 'closed';
    delete (this as any).lastFailureTime;
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}
