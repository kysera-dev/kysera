/**
 * Circuit breaker pattern implementation.
 *
 * @module @kysera/infra/resilience
 */

import { DatabaseError, ErrorCodes } from '@kysera/core';

/**
 * Circuit breaker state.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker state snapshot.
 */
export interface CircuitBreakerState {
  /** Current state */
  state: CircuitState;
  /** Number of consecutive failures */
  failures: number;
  /** Timestamp of last failure (if any) */
  lastFailureTime: number | undefined;
}

/**
 * Options for CircuitBreaker.
 */
export interface CircuitBreakerOptions {
  /**
   * Number of failures before opening the circuit.
   * @default 5
   */
  threshold?: number;

  /**
   * Time in milliseconds before attempting to close the circuit.
   * @default 60000 (1 minute)
   */
  resetTimeMs?: number;

  /**
   * Callback invoked when circuit state changes.
   */
  onStateChange?: (newState: CircuitState, previousState: CircuitState) => void;
}

/**
 * Circuit breaker for preventing cascading failures.
 *
 * Implements the circuit breaker pattern to protect against cascading
 * failures when a service is unavailable. After a threshold of failures,
 * the circuit "opens" and fails fast without attempting the operation.
 *
 * States:
 * - **closed**: Normal operation, requests pass through
 * - **open**: Failures exceeded threshold, requests fail immediately
 * - **half-open**: Testing if service recovered, allows one request
 *
 * @example Basic usage
 * ```typescript
 * import { CircuitBreaker } from '@kysera/infra/resilience';
 *
 * const breaker = new CircuitBreaker(5, 60000);
 *
 * try {
 *   const result = await breaker.execute(() =>
 *     db.selectFrom('users').execute()
 *   );
 * } catch (error) {
 *   if (error.message.includes('Circuit breaker is open')) {
 *     console.log('Service unavailable, try again later');
 *   }
 * }
 * ```
 *
 * @example With state change callback
 * ```typescript
 * import { CircuitBreaker } from '@kysera/infra/resilience';
 *
 * const breaker = new CircuitBreaker({
 *   threshold: 3,
 *   resetTimeMs: 30000,
 *   onStateChange: (newState, oldState) => {
 *     console.log(`Circuit breaker: ${oldState} -> ${newState}`);
 *   },
 * });
 * ```
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime: number | undefined = undefined;
  private state: CircuitState = 'closed';

  private readonly threshold: number;
  private readonly resetTimeMs: number;
  private readonly onStateChange: ((newState: CircuitState, previousState: CircuitState) => void) | undefined;

  /**
   * Create a new circuit breaker.
   *
   * @param thresholdOrOptions - Failure threshold or options object
   * @param resetTimeMs - Reset time in milliseconds (if first param is threshold)
   */
  constructor(thresholdOrOptions: number | CircuitBreakerOptions = 5, resetTimeMs = 60000) {
    if (typeof thresholdOrOptions === 'number') {
      this.threshold = thresholdOrOptions;
      this.resetTimeMs = resetTimeMs;
    } else {
      this.threshold = thresholdOrOptions.threshold ?? 5;
      this.resetTimeMs = thresholdOrOptions.resetTimeMs ?? 60000;
      this.onStateChange = thresholdOrOptions.onStateChange;
    }
  }

  /**
   * Execute a function with circuit breaker protection.
   *
   * @param fn - Function to execute
   * @returns Result of the function
   * @throws {DatabaseError} If circuit is open
   * @throws Original error if function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should be reset
    if (
      this.state === 'open' &&
      this.lastFailureTime &&
      Date.now() - this.lastFailureTime > this.resetTimeMs
    ) {
      this.setState('half-open');
    }

    // If circuit is open, fail fast
    if (this.state === 'open') {
      throw new DatabaseError('Circuit breaker is open', ErrorCodes.DB_CONNECTION_FAILED);
    }

    try {
      const result = await fn();

      // Reset on success
      if (this.state === 'half-open') {
        this.setState('closed');
        this.failures = 0;
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      // Open circuit if threshold exceeded
      if (this.failures >= this.threshold) {
        this.setState('open');
      }

      throw error;
    }
  }

  /**
   * Reset the circuit breaker to closed state.
   */
  reset(): void {
    this.failures = 0;
    this.lastFailureTime = undefined;
    this.setState('closed');
  }

  /**
   * Get current circuit breaker state.
   *
   * @returns Current state snapshot
   */
  getState(): CircuitBreakerState {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Check if circuit is currently open.
   *
   * @returns True if circuit is open
   */
  isOpen(): boolean {
    return this.state === 'open';
  }

  /**
   * Check if circuit is currently closed.
   *
   * @returns True if circuit is closed
   */
  isClosed(): boolean {
    return this.state === 'closed';
  }

  /**
   * Force open the circuit.
   *
   * Useful for manual intervention when problems are detected.
   */
  forceOpen(): void {
    this.failures = this.threshold;
    this.lastFailureTime = Date.now();
    this.setState('open');
  }

  /**
   * Set circuit state with optional callback.
   */
  private setState(newState: CircuitState): void {
    if (this.state !== newState) {
      const previousState = this.state;
      this.state = newState;
      this.onStateChange?.(newState, previousState);
    }
  }
}
