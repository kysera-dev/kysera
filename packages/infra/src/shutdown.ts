/**
 * Graceful shutdown utilities for database connections.
 *
 * @module @kysera/infra/shutdown
 */

import type { Kysely } from 'kysely'
import { consoleLogger, type KyseraLogger } from '@kysera/core'

/**
 * Type guard to check if a value has process-like signal handling.
 * @internal
 */
interface ProcessLike {
  on: (signal: NodeJS.Signals, handler: () => void) => void
  exit: (code: number) => void
}

/**
 * Get the process object if it exists and has the required methods.
 * Returns undefined in environments without process support.
 * @internal
 */
function getProcess(): ProcessLike | undefined {
  // Use type assertion to avoid ESLint complaints about globalThis checks
  const g = globalThis as { process?: unknown }
  if (g.process !== undefined && g.process !== null && typeof g.process === 'object') {
    const p = g.process as Partial<ProcessLike>
    if (typeof p.on === 'function' && typeof p.exit === 'function') {
      return p as ProcessLike
    }
  }
  return undefined
}

/**
 * Safely exit the process if available.
 * @internal
 */
function safeProcessExit(code: number): void {
  const proc = getProcess()
  if (proc !== undefined) {
    proc.exit(code)
  }
}

/**
 * Options for graceful shutdown.
 */
export interface ShutdownOptions {
  /**
   * Timeout in milliseconds before forced shutdown.
   * @default 30000
   */
  timeout?: number

  /**
   * Custom shutdown handler called before database close.
   */
  onShutdown?: () => void | Promise<void>

  /**
   * Logger for shutdown messages.
   * @default consoleLogger
   */
  logger?: KyseraLogger
}

/**
 * Options for shutdown signal registration.
 */
export interface RegisterShutdownOptions extends ShutdownOptions {
  /**
   * Signals to listen for.
   * @default ['SIGTERM', 'SIGINT']
   */
  signals?: NodeJS.Signals[]
}

/**
 * Perform graceful database shutdown.
 *
 * Closes the database connection with a timeout. If the shutdown
 * takes longer than the timeout, the promise rejects.
 *
 * @param db - Kysely database instance
 * @param options - Shutdown options
 * @returns Promise that resolves when shutdown is complete
 * @throws {Error} If shutdown times out
 *
 * @example
 * ```typescript
 * import { gracefulShutdown } from '@kysera/infra/shutdown';
 *
 * // Basic shutdown
 * await gracefulShutdown(db);
 *
 * // With custom handler
 * await gracefulShutdown(db, {
 *   timeout: 10000,
 *   onShutdown: async () => {
 *     console.log('Flushing pending writes...');
 *     await flushWrites();
 *   },
 * });
 * ```
 */
export async function gracefulShutdown<DB>(
  db: Kysely<DB>,
  options: ShutdownOptions = {}
): Promise<void> {
  const { timeout = 30000, onShutdown, logger = consoleLogger } = options

  const shutdownPromise = async (): Promise<void> => {
    try {
      if (onShutdown) {
        await onShutdown()
      }
      await db.destroy()
    } catch (error) {
      logger.error('Error during database shutdown:', error)
      throw error
    }
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      shutdownPromise(),
      new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Shutdown timeout after ${timeout.toString()}ms`))
        }, timeout)
      })
    ])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * Shutdown database connection.
 *
 * Simple wrapper around db.destroy() for consistency.
 *
 * @param db - Kysely database instance
 *
 * @example
 * ```typescript
 * import { shutdownDatabase } from '@kysera/infra/shutdown';
 *
 * await shutdownDatabase(db);
 * ```
 */
export async function shutdownDatabase<DB>(db: Kysely<DB>): Promise<void> {
  await db.destroy()
}

/**
 * Register process signal handlers for graceful shutdown.
 *
 * Sets up handlers for SIGTERM and SIGINT (Ctrl+C) to gracefully
 * close database connections before exiting.
 *
 * @param db - Kysely database instance
 * @param options - Shutdown options
 *
 * @example
 * ```typescript
 * import { registerShutdownHandlers } from '@kysera/infra/shutdown';
 *
 * // Register handlers for SIGTERM and SIGINT
 * registerShutdownHandlers(db);
 *
 * // With custom signals
 * registerShutdownHandlers(db, {
 *   signals: ['SIGTERM', 'SIGINT', 'SIGQUIT'],
 *   timeout: 10000,
 * });
 * ```
 */
export function registerShutdownHandlers<DB>(
  db: Kysely<DB>,
  options: RegisterShutdownOptions = {}
): void {
  const { signals = ['SIGTERM', 'SIGINT'], logger = consoleLogger, ...shutdownOptions } = options

  // Check if signal handlers are supported in current runtime
  const proc = getProcess()
  if (proc === undefined) {
    logger.warn(
      'Process signal handlers are not available in this runtime. ' +
        'Shutdown handlers will not be registered. ' +
        'Use createShutdownController().execute() for manual shutdown.'
    )
    return
  }

  // Use object to ensure reference stability and prevent race conditions
  const shutdownState = { inProgress: false }

  const handleShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    // Atomic check-and-set pattern to prevent race conditions
    if (shutdownState.inProgress) return
    shutdownState.inProgress = true

    logger.info(`Received ${signal}, starting graceful shutdown...`)

    try {
      await gracefulShutdown(db, { ...shutdownOptions, logger })
      logger.info('Database connections closed successfully')
      safeProcessExit(0)
    } catch (error) {
      logger.error('Error during shutdown:', error)
      safeProcessExit(1)
    }
  }

  for (const signal of signals) {
    proc.on(signal, () => void handleShutdown(signal))
  }
}

/**
 * Create a graceful shutdown controller.
 *
 * Returns functions to manage shutdown without immediately registering
 * signal handlers. Useful for more control over the shutdown process.
 *
 * @param db - Kysely database instance
 * @param options - Shutdown options
 * @returns Object with shutdown control functions
 *
 * @example
 * ```typescript
 * import { createShutdownController } from '@kysera/infra/shutdown';
 *
 * const shutdown = createShutdownController(db, {
 *   timeout: 10000,
 *   onShutdown: () => console.log('Shutting down...'),
 * });
 *
 * // Register signal handlers
 * shutdown.registerSignals();
 *
 * // Or manually trigger shutdown
 * await shutdown.execute();
 *
 * // Check if shutdown is in progress
 * if (shutdown.isShuttingDown()) {
 *   console.log('Shutdown in progress...');
 * }
 * ```
 */
export function createShutdownController<DB>(
  db: Kysely<DB>,
  options: RegisterShutdownOptions = {}
): {
  execute: () => Promise<void>
  registerSignals: () => void
  isShuttingDown: () => boolean
} {
  // Use object to ensure reference stability and prevent race conditions
  const shutdownState = { inProgress: false }
  const {
    logger = consoleLogger,
    signals: _signals = ['SIGTERM', 'SIGINT'],
    ...shutdownOpts
  } = options

  return {
    execute: async (): Promise<void> => {
      // Atomic check-and-set pattern to prevent race conditions
      if (shutdownState.inProgress) return
      shutdownState.inProgress = true

      logger.info('Starting graceful shutdown...')
      await gracefulShutdown(db, { ...shutdownOpts, logger })
      logger.info('Database connections closed successfully')
    },

    registerSignals: (): void => {
      registerShutdownHandlers(db, options)
    },

    isShuttingDown: (): boolean => shutdownState.inProgress
  }
}
