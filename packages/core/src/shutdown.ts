import type { Kysely } from 'kysely';

export interface ShutdownOptions {
  timeout?: number;
  onShutdown?: () => void | Promise<void>;
  logger?: (message: string) => void;
}

/**
 * Graceful shutdown handler for database connections
 */
export async function createGracefulShutdown<DB>(db: Kysely<DB>, options: ShutdownOptions = {}): Promise<void> {
  const { timeout = 30000, onShutdown, logger = console.log } = options;

  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger(`Received ${signal}, starting graceful shutdown...`);

    // Set timeout for forced shutdown
    const shutdownTimeout = setTimeout(() => {
      logger('Forced shutdown after timeout');
      process.exit(1);
    }, timeout);

    try {
      // Run custom shutdown handler
      if (onShutdown) {
        await onShutdown();
      }

      // Close database connections
      await db.destroy();
      logger('Database connections closed');

      clearTimeout(shutdownTimeout);
      process.exit(0);
    } catch (error: any) {
      logger(`Error during shutdown: ${error.message}`);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  };

  // Register handlers
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Shutdown database connection
 */
export async function shutdownDatabase<DB>(db: Kysely<DB>): Promise<void> {
  await db.destroy();
}
