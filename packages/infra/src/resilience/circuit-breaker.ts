/**
 * Circuit breaker pattern implementation.
 *
 * @module @kysera/infra/resilience
 */

import { DatabaseError, ErrorCodes } from '@kysera/core'

/**
 * Circuit breaker state.
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker state snapshot.
 */
export interface CircuitBreakerState {
  /** Current state */
  state: CircuitState
  /** Number of consecutive failures */
  failures: number
  /** Timestamp of last failure (if any) */
  lastFailureTime: number | undefined
  /** Whether a test request is in progress during half-open state */
  isTestingHalfOpen: boolean
}

/**
 * Options for CircuitBreaker.
 */
export interface CircuitBreakerOptions {
  /**
   * Number of failures before opening the circuit.
   * @default 5
   */
  threshold?: number

  /**
   * Time in milliseconds before attempting to close the circuit.
   * @default 60000 (1 minute)
   */
  resetTimeMs?: number

  /**
   * Callback invoked when circuit state changes.
   */
  onStateChange?: (newState: CircuitState, previousState: CircuitState) => void
}

/**
 * Error thrown when circuit breaker rejects a request.
 */
export class CircuitBreakerError extends DatabaseError {
  constructor(message: string) {
    super(message, ErrorCodes.DB_CONNECTION_FAILED)
    this.name = 'CircuitBreakerError'
  }
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
 *   if (error instanceof CircuitBreakerError) {
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
  private failures = 0
  private lastFailureTime: number | undefined = undefined
  private state: CircuitState = 'closed'
  private isTestingHalfOpen = false
  private stateMutex: Promise<void> = Promise.resolve()

  private readonly threshold: number
  private readonly resetTimeMs: number
  private readonly onStateChange:
    | ((newState: CircuitState, previousState: CircuitState) => void)
    | undefined

  /**
   * Create a new circuit breaker.
   *
   * @param thresholdOrOptions - Failure threshold or options object
   * @param resetTimeMs - Reset time in milliseconds (if first param is threshold)
   */
  constructor(thresholdOrOptions: number | CircuitBreakerOptions = 5, resetTimeMs = 60000) {
    if (typeof thresholdOrOptions === 'number') {
      this.threshold = thresholdOrOptions
      this.resetTimeMs = resetTimeMs
    } else {
      this.threshold = thresholdOrOptions.threshold ?? 5
      this.resetTimeMs = thresholdOrOptions.resetTimeMs ?? 60000
      this.onStateChange = thresholdOrOptions.onStateChange
    }
  }

  /**
   * Execute a function with circuit breaker protection.
   *
   * Uses a mutex to prevent race conditions during state transitions,
   * particularly in half-open state where only one test request should proceed.
   *
   * @param fn - Function to execute
   * @returns Result of the function
   * @throws {CircuitBreakerError} If circuit is open or testing recovery
   * @throws Original error if function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Acquire mutex to prevent concurrent state transitions
    await this.stateMutex

    let releaseMutex: (() => void) | undefined
    const mutexPromise = new Promise<void>(resolve => {
      releaseMutex = resolve
    })
    this.stateMutex = mutexPromise

    try {
      // Check if circuit should be reset
      if (
        this.state === 'open' &&
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime > this.resetTimeMs
      ) {
        this.setState('half-open')
      }

      // If circuit is open, fail fast
      if (this.state === 'open') {
        throw new CircuitBreakerError('Circuit breaker is open')
      }

      // If circuit is half-open and a test is already in progress, reject
      if (this.state === 'half-open') {
        if (this.isTestingHalfOpen) {
          throw new CircuitBreakerError('Circuit breaker is testing recovery')
        }
        this.isTestingHalfOpen = true
      }

      // Release mutex before executing fn (we've secured our state)
      releaseMutex?.()
      releaseMutex = undefined

      try {
        const result = await fn()

        // Reset on success
        if (this.state === 'half-open') {
          this.isTestingHalfOpen = false
          this.setState('closed')
          this.failures = 0
        }

        return result
      } catch (error) {
        // Reset testing flag on failure in half-open state
        if (this.state === 'half-open') {
          this.isTestingHalfOpen = false
        }

        this.failures++
        this.lastFailureTime = Date.now()

        // Open circuit if threshold exceeded or failed in half-open
        if (this.failures >= this.threshold || this.state === 'half-open') {
          this.setState('open')
        }

        throw error
      }
    } finally {
      // Ensure mutex is always released
      releaseMutex?.()
    }
  }

  /**
   * Reset the circuit breaker to closed state.
   */
  reset(): void {
    this.failures = 0
    this.lastFailureTime = undefined
    this.isTestingHalfOpen = false
    this.setState('closed')
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
      isTestingHalfOpen: this.isTestingHalfOpen
    }
  }

  /**
   * Check if circuit is currently open.
   *
   * @returns True if circuit is open
   */
  isOpen(): boolean {
    return this.state === 'open'
  }

  /**
   * Check if circuit is currently closed.
   *
   * @returns True if circuit is closed
   */
  isClosed(): boolean {
    return this.state === 'closed'
  }

  /**
   * Force open the circuit.
   *
   * Useful for manual intervention when problems are detected.
   */
  forceOpen(): void {
    this.failures = this.threshold
    this.lastFailureTime = Date.now()
    this.isTestingHalfOpen = false
    this.setState('open')
  }

  /**
   * Set circuit state with optional callback.
   */
  private setState(newState: CircuitState): void {
    if (this.state !== newState) {
      const previousState = this.state
      this.state = newState
      this.onStateChange?.(newState, previousState)
    }
  }
}
