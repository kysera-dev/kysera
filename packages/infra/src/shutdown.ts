/**
 * Graceful shutdown utilities for database connections.
 *
 * @module @kysera/infra/shutdown
 */

import type { Kysely } from 'kysely';
import { consoleLogger, type KyseraLogger } from '@kysera/core';

/**
 * Check if we're running in an environment with Node.js-like process object.
 * Supports Node.js, Bun, and environments with process polyfills.
 * @internal
 */
function hasProcessSignals(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    'process' in globalThis &&
    typeof globalThis.process === 'object' &&
    globalThis.process !== null &&
    typeof (globalThis.process as NodeJS.Process).on === 'function'
  );
}

/**
 * Safely exit the process if available.
 * @internal
 */
function safeProcessExit(code: number): void {
  if (
    typeof globalThis !== 'undefined' &&
    'process' in globalThis &&
    typeof globalThis.process === 'object' &&
    globalThis.process !== null &&
    typeof (globalThis.process as NodeJS.Process).exit === 'function'
  ) {
    (globalThis.process as NodeJS.Process).exit(code);
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
  timeout?: number;

  /**
   * Custom shutdown handler called before database close.
   */
  onShutdown?: () => void | Promise<void>;

  /**
   * Logger for shutdown messages.
   * @default consoleLogger
   */
  logger?: KyseraLogger;
}

/**
 * Options for shutdown signal registration.
 */
export interface RegisterShutdownOptions extends ShutdownOptions {
  /**
   * Signals to listen for.
   * @default ['SIGTERM', 'SIGINT']
   */
  signals?: NodeJS.Signals[];
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
  const { timeout = 30000, onShutdown, logger = consoleLogger } = options;

  const shutdownPromise = async (): Promise<void> => {
    try {
      if (onShutdown) {
        await onShutdown();
      }
      await db.destroy();
    } catch (error) {
      logger.error('Error during database shutdown:', error);
      throw error;
    }
  };

  await Promise.race([
    shutdownPromise(),
    new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Shutdown timeout after ${timeout.toString()}ms`));
      }, timeout);
    }),
  ]);
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
  await db.destroy();
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
  const {
    signals = ['SIGTERM', 'SIGINT'],
    logger = consoleLogger,
    ...shutdownOptions
  } = options;

  // Check if signal handlers are supported in current runtime
  if (!hasProcessSignals()) {
    logger.warn(
      'Process signal handlers are not available in this runtime. ' +
        'Shutdown handlers will not be registered. ' +
        'Use createShutdownController().execute() for manual shutdown.'
    );
    return;
  }

  let isShuttingDown = false;

  const handleShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal}, starting graceful shutdown...`);

    try {
      await gracefulShutdown(db, { ...shutdownOptions, logger });
      logger.info('Database connections closed successfully');
      safeProcessExit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      safeProcessExit(1);
    }
  };

  const proc = globalThis.process as NodeJS.Process;
  for (const signal of signals) {
    proc.on(signal, () => void handleShutdown(signal));
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
  execute: () => Promise<void>;
  registerSignals: () => void;
  isShuttingDown: () => boolean;
} {
  let shuttingDown = false;
  const { logger = consoleLogger, signals: _signals = ['SIGTERM', 'SIGINT'], ...shutdownOpts } = options;

  return {
    execute: async (): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;

      logger.info('Starting graceful shutdown...');
      await gracefulShutdown(db, { ...shutdownOpts, logger });
      logger.info('Database connections closed successfully');
    },

    registerSignals: (): void => {
      registerShutdownHandlers(db, options);
    },

    isShuttingDown: (): boolean => shuttingDown,
  };
}
