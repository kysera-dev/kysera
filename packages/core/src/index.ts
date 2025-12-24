/**
 * @kysera/core - Core utilities for Kysera
 *
 * Minimal core package containing essential utilities:
 * - Error handling (DatabaseError, error codes)
 * - Pagination (offset and cursor-based)
 * - Helpers (applyOffset, applyDateRange)
 * - Types (Executor, Timestamps, etc.)
 * - Logger interface
 *
 * **Related packages:**
 * - `@kysera/infra` - Health checks, retry, circuit breaker, shutdown
 * - `@kysera/testing` - Testing utilities (testInTransaction, factories)
 * - `@kysera/debug` - Query logging, profiling, SQL formatting
 * - `@kysera/dal` - Functional Data Access Layer
 *
 * @module @kysera/core
 */

// Error handling
export * from './errors.js'
export * from './error-codes.js'

// Pagination
export * from './pagination.js'

// Cursor cryptography
export * from './cursor-crypto.js'

// Dialect detection
export * from './dialect-detection.js'

// Helpers
export * from './helpers.js'

// Types
export * from './types.js'

// Logger
export * from './logger.js'

// Plugin Base Utilities
export * from './plugin-base.js'

// Version
export * from './version.js'
