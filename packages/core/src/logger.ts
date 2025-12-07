/**
 * Shared logger interface for Kysera ecosystem.
 * All packages can optionally accept this logger for consistent logging.
 */
export interface KyseraLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Simple console logger implementation.
 */
export const consoleLogger: KyseraLogger = {
  debug: (msg, ...args) => console.debug(`[kysera:debug] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[kysera:info] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[kysera:warn] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[kysera:error] ${msg}`, ...args),
};

/**
 * No-op logger for silent operation.
 */
export const silentLogger: KyseraLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Create a logger with a specific prefix.
 */
export function createPrefixedLogger(prefix: string, baseLogger: KyseraLogger = consoleLogger): KyseraLogger {
  return {
    debug: (msg, ...args) => baseLogger.debug(`[${prefix}] ${msg}`, ...args),
    info: (msg, ...args) => baseLogger.info(`[${prefix}] ${msg}`, ...args),
    warn: (msg, ...args) => baseLogger.warn(`[${prefix}] ${msg}`, ...args),
    error: (msg, ...args) => baseLogger.error(`[${prefix}] ${msg}`, ...args),
  };
}
