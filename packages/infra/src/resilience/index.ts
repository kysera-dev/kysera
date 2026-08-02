/**
 * Resilience utilities for database operations.
 *
 * @module @kysera/infra/resilience
 */

// Retry
export { type RetryOptions, isTransientError, withRetry, createRetryWrapper } from './retry.js'

// Transaction retry
export {
  type TransactionRetryOptions,
  type RetryableTransactionSource,
  isSerializationError,
  withTransactionRetry
} from './transaction-retry.js'

// Circuit Breaker
export {
  type CircuitState,
  type CircuitBreakerState,
  type CircuitBreakerOptions,
  CircuitBreaker,
  CircuitBreakerError
} from './circuit-breaker.js'
