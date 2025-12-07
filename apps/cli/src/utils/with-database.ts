import { Kysely } from 'kysely';
import { loadConfig } from '../config/loader.js';
import { getDatabaseConnection, type Database } from './database.js';
import { CLIError } from './errors.js';
import type { KyseraConfig } from '../config/schema.js';
import type { DatabaseInstance } from '../types/index.js';

/**
 * Options for the withDatabase helper
 */
export interface WithDatabaseOptions {
  /** Path to configuration file */
  config?: string;
  /** Enable verbose output */
  verbose?: boolean;
}

/**
 * Execute a handler with a database connection, ensuring proper cleanup.
 *
 * This helper eliminates the repetitive pattern of:
 * 1. Loading config
 * 2. Validating database config exists
 * 3. Getting database connection
 * 4. Validating connection succeeded
 * 5. Running the handler
 * 6. Destroying the connection in a finally block
 *
 * @param options - Options containing config path and verbose flag
 * @param handler - Async function to execute with the database connection
 * @returns The result of the handler function
 *
 * @example
 * ```typescript
 * await withDatabase({ config: options.config }, async (db, config) => {
 *   const tables = await db.introspection.getTables();
 *   return tables;
 * });
 * ```
 */
export async function withDatabase<T>(
  options: WithDatabaseOptions,
  handler: (db: DatabaseInstance, config: KyseraConfig) => Promise<T>
): Promise<T> {
  const config = await loadConfig(options.config);

  if (!config?.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', undefined, [
      'Create kysera.config.ts with database configuration',
      'Or specify config path with --config option',
    ]);
  }

  const db = await getDatabaseConnection(config.database);

  if (!db) {
    throw new CLIError('Failed to connect to database', 'DATABASE_ERROR', undefined, [
      'Check database connection settings',
      'Ensure database server is running',
    ]);
  }

  try {
    // Cast to DatabaseInstance - the db has these methods at runtime
    return await handler(db as DatabaseInstance, config);
  } finally {
    await db.destroy();
  }
}

/**
 * Execute a handler with an optional database connection.
 *
 * Unlike `withDatabase`, this version does not throw if database config is missing.
 * The handler receives `null` for both db and config if configuration is not found.
 * This is useful for commands that can work with or without a database.
 *
 * @param options - Options containing config path and verbose flag
 * @param handler - Async function to execute, receives null if no config/connection
 * @returns The result of the handler function
 *
 * @example
 * ```typescript
 * await withDatabaseOptional({ config: options.config }, async (db, config) => {
 *   if (db && config) {
 *     // Work with database
 *   } else {
 *     // Work without database
 *   }
 * });
 * ```
 */
export async function withDatabaseOptional<T>(
  options: WithDatabaseOptions,
  handler: (db: DatabaseInstance | null, config: KyseraConfig | null) => Promise<T>
): Promise<T> {
  let config: KyseraConfig | null = null;
  let db: DatabaseInstance | null = null;

  try {
    config = await loadConfig(options.config);
  } catch {
    // Config loading failed, continue with null
  }

  if (config?.database) {
    db = await getDatabaseConnection(config.database) as DatabaseInstance | null;
  }

  try {
    return await handler(db, config);
  } finally {
    if (db) {
      await db.destroy();
    }
  }
}
