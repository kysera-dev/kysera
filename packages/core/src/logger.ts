/**
 * Universal logging interface for the Kysera ecosystem.
 *
 * This interface provides a standardized way to log messages across all Kysera packages.
 * It follows common logging levels (trace, debug, info, warn, error, fatal) and can be
 * implemented with any logging library (winston, pino, bunyan, etc.) or custom implementation.
 *
 * **Log levels (from least to most severe):**
 * - `trace`: Very detailed diagnostic information (e.g., function entry/exit, variable values)
 * - `debug`: Detailed information for debugging purposes
 * - `info`: General informational messages about application progress
 * - `warn`: Warning messages for potentially harmful situations
 * - `error`: Error messages for failures that don't crash the application
 * - `fatal`: Critical errors that cause application termination
 *
 * @example
 * ```typescript
 * // Custom logger implementation with Winston
 * import winston from 'winston'
 * import type { KyseraLogger } from '@kysera/core'
 *
 * const winstonLogger = winston.createLogger({
 *   level: 'info',
 *   format: winston.format.json(),
 *   transports: [new winston.transports.Console()]
 * })
 *
 * const customLogger: KyseraLogger = {
 *   trace: (msg, ...args) => winstonLogger.silly(msg, ...args), // Winston uses 'silly' for trace
 *   debug: (msg, ...args) => winstonLogger.debug(msg, ...args),
 *   info: (msg, ...args) => winstonLogger.info(msg, ...args),
 *   warn: (msg, ...args) => winstonLogger.warn(msg, ...args),
 *   error: (msg, ...args) => winstonLogger.error(msg, ...args),
 *   fatal: (msg, ...args) => winstonLogger.error(msg, ...args) // Or use crit/emerg
 * }
 *
 * // Use with Kysera packages
 * const orm = await createORM(db, [], { logger: customLogger })
 * ```
 */
export interface KyseraLogger {
  trace(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  fatal(message: string, ...args: unknown[]): void
}

/**
 * Default console-based logger implementation.
 *
 * This is the default logger used by Kysera packages when no custom logger is provided.
 * All log messages are prefixed with `[kysera:level]` for easy filtering and identification.
 *
 * **Log level mapping:**
 * - `trace` → `console.debug` (browsers don't have console.trace for logging)
 * - `debug` → `console.debug`
 * - `info` → `console.info`
 * - `warn` → `console.warn`
 * - `error` → `console.error`
 * - `fatal` → `console.error` (with FATAL prefix for visibility)
 *
 * @example
 * ```typescript
 * import { consoleLogger } from '@kysera/core'
 *
 * // Use as default logger
 * const orm = await createORM(db, [], { logger: consoleLogger })
 *
 * // Direct usage
 * consoleLogger.trace('Function entry', { functionName: 'createUser' })
 * // Output: [kysera:trace] Function entry { functionName: 'createUser' }
 *
 * consoleLogger.info('User created', { userId: 123 })
 * // Output: [kysera:info] User created { userId: 123 }
 *
 * consoleLogger.error('Database error', error)
 * // Output: [kysera:error] Database error [Error object]
 *
 * consoleLogger.fatal('Critical failure', error)
 * // Output: [kysera:fatal] FATAL: Critical failure [Error object]
 * ```
 */
export const consoleLogger: KyseraLogger = {
  trace: (msg, ...args) => console.debug(`[kysera:trace] ${msg}`, ...args),
  debug: (msg, ...args) => console.debug(`[kysera:debug] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[kysera:info] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[kysera:warn] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[kysera:error] ${msg}`, ...args),
  fatal: (msg, ...args) => console.error(`[kysera:fatal] FATAL: ${msg}`, ...args)
}

/**
 * No-op logger that discards all log messages.
 *
 * This logger is useful for testing environments or production scenarios where
 * logging should be completely disabled. All methods are empty functions that
 * do nothing, ensuring zero performance overhead from logging operations.
 *
 * @example
 * ```typescript
 * import { silentLogger } from '@kysera/core'
 *
 * // Disable all logging in tests
 * const orm = await createORM(db, [], { logger: silentLogger })
 *
 * // Or conditionally in production
 * const logger = process.env.NODE_ENV === 'production'
 *   ? silentLogger
 *   : consoleLogger
 *
 * const orm = await createORM(db, [], { logger })
 * ```
 */
export const silentLogger: KyseraLogger = {
  trace: () => {
    /* intentionally empty */
  },
  debug: () => {
    /* intentionally empty */
  },
  info: () => {
    /* intentionally empty */
  },
  warn: () => {
    /* intentionally empty */
  },
  error: () => {
    /* intentionally empty */
  },
  fatal: () => {
    /* intentionally empty */
  }
}

/**
 * Create a logger that adds a custom prefix to all log messages.
 *
 * This is useful for creating package-specific or feature-specific loggers
 * that help identify the source of log messages in complex applications.
 *
 * @param prefix - The prefix to add to all log messages (without brackets)
 * @param baseLogger - The underlying logger to use (defaults to consoleLogger)
 * @returns A new logger that prefixes all messages with `[prefix]`
 *
 * @example
 * ```typescript
 * import { createPrefixedLogger, consoleLogger } from '@kysera/core'
 *
 * // Create package-specific logger
 * const auditLogger = createPrefixedLogger('audit', consoleLogger)
 * auditLogger.trace('Function entry', { function: 'recordAudit' })
 * // Output: [kysera:trace] [audit] Function entry { function: 'recordAudit' }
 *
 * auditLogger.info('User action recorded', { userId: 123, action: 'login' })
 * // Output: [kysera:info] [audit] User action recorded { userId: 123, action: 'login' }
 *
 * // Create feature-specific logger
 * const authLogger = createPrefixedLogger('auth')
 * authLogger.warn('Failed login attempt', { username: 'alice' })
 * // Output: [kysera:warn] [auth] Failed login attempt { username: 'alice' }
 *
 * authLogger.fatal('Authentication system crashed', error)
 * // Output: [kysera:fatal] [auth] FATAL: Authentication system crashed [Error object]
 *
 * // Use with custom base logger
 * const myLogger = createPrefixedLogger('my-app', customWinstonLogger)
 * ```
 */
export function createPrefixedLogger(
  prefix: string,
  baseLogger: KyseraLogger = consoleLogger
): KyseraLogger {
  return {
    trace: (msg, ...args) => baseLogger.trace(`[${prefix}] ${msg}`, ...args),
    debug: (msg, ...args) => baseLogger.debug(`[${prefix}] ${msg}`, ...args),
    info: (msg, ...args) => baseLogger.info(`[${prefix}] ${msg}`, ...args),
    warn: (msg, ...args) => baseLogger.warn(`[${prefix}] ${msg}`, ...args),
    error: (msg, ...args) => baseLogger.error(`[${prefix}] ${msg}`, ...args),
    fatal: (msg, ...args) => baseLogger.fatal(`[${prefix}] ${msg}`, ...args)
  }
}
