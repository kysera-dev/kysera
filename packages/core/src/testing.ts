import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

/**
 * Testing utilities for Kysera ORM
 *
 * These utilities provide fast, isolated testing with automatic cleanup
 * using transaction-based testing patterns.
 */

/**
 * Internal error class used to trigger transaction rollback
 */
class RollbackError extends Error {
  constructor() {
    super('ROLLBACK');
    this.name = 'RollbackError';
  }
}

/**
 * Database cleanup strategies
 */
export type CleanupStrategy = 'truncate' | 'transaction' | 'delete';

/**
 * Strict regex pattern for valid SQL identifiers
 * - Must start with a letter or underscore
 * - Can contain letters, digits, and underscores
 * - No special characters or SQL injection patterns
 */
const VALID_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validate an SQL identifier to prevent injection
 */
function validateIdentifier(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid identifier: must be a non-empty string');
  }

  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    throw new Error('Invalid identifier: length must be between 1 and 128 characters');
  }

  if (!VALID_IDENTIFIER_PATTERN.test(trimmed)) {
    throw new Error(`Invalid identifier ${trimmed}: must start with a letter or underscore and contain only letters, digits, and underscores`);
  }

  return trimmed;
}

/**
 * Escape an identifier for PostgreSQL
 */
function escapePostgresIdentifier(name: string): string {
  const valid = validateIdentifier(name);
  return `${valid}`;
}

/**
 * Escape an identifier for MySQL
 */
function escapeMysqlIdentifier(name: string): string {
  const valid = validateIdentifier(name);
  return `\`${valid}\``;
}

/**
 * Test in a transaction that automatically rolls back
 *
 * This is the FASTEST testing approach - no cleanup needed!
 *
 * @example
 * ```typescript
 * it('creates user', async () => {
 *   await testInTransaction(db, async (trx) => {
 *     const user = await trx
 *       .insertInto('users')
 *       .values({ email: 'test@example.com' })
 *       .returningAll()
 *       .executeTakeFirst()
 *
 *     expect(user.email).toBe('test@example.com')
 *   })
 *   // Transaction automatically rolled back - database is clean!
 * })
 * ```
 *
 * @param db - Kysely database instance
 * @param fn - Test function that receives transaction
 */
export async function testInTransaction<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      await fn(trx);
      throw new RollbackError();
    });
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error;
    }
  }
}

/**
 * Test with savepoints for nested transaction testing
 *
 * Useful for testing complex business logic that uses nested transactions
 *
 * @param db - Kysely database instance
 * @param fn - Test function that receives transaction
 */
export async function testWithSavepoints<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      await sql`SAVEPOINT test_sp`.execute(trx);

      try {
        await fn(trx);
      } finally {
        try {
          await sql`ROLLBACK TO SAVEPOINT test_sp`.execute(trx);
        } catch (error) {
          // Savepoint might not exist if transaction already failed
          // This is expected when the transaction has already rolled back
        }
      }

      throw new RollbackError();
    });
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error;
    }
  }
}

/**
 * Clean database using specified strategy
 *
 * @param db - Kysely database instance
 * @param strategy - Cleanup strategy
 * @param tables - Optional list of tables to clean (in deletion order)
 */
export async function cleanDatabase<DB>(
  db: Kysely<DB>,
  strategy: CleanupStrategy = 'transaction',
  tables?: string[]
): Promise<void> {
  if (strategy === 'transaction') {
    return;
  }

  if (!tables || tables.length === 0) {
    throw new Error('cleanDatabase requires tables parameter when using "delete" or "truncate" strategy');
  }

  if (strategy === 'delete') {
    for (const table of tables) {
      await db.deleteFrom(table as any).execute();
    }
  } else if (strategy === 'truncate') {
    const dialect = (db as any).getExecutor().adapter.dialect;

    if (dialect.constructor.name.includes('Postgres')) {
      await (db as any).raw('SET session_replication_role = replica').execute();

      for (const table of tables) {
        // Validate and escape table name to prevent SQL injection
        const escapedTable = escapePostgresIdentifier(table);
        await (db as any).raw(`TRUNCATE TABLE ${escapedTable} CASCADE`).execute();
      }

      await (db as any).raw('SET session_replication_role = DEFAULT').execute();
    } else if (dialect.constructor.name.includes('Mysql')) {
      await (db as any).raw('SET FOREIGN_KEY_CHECKS = 0').execute();

      for (const table of tables) {
        // Validate and escape table name to prevent SQL injection
        const escapedTable = escapeMysqlIdentifier(table);
        await (db as any).raw(`TRUNCATE TABLE ${escapedTable}`).execute();
      }

      await (db as any).raw('SET FOREIGN_KEY_CHECKS = 1').execute();
    } else {
      // SQLite: No TRUNCATE, use DELETE
      for (const table of tables) {
        // Validate table name
        const validTable = validateIdentifier(table);
        await db.deleteFrom(table as any).execute();
        // Reset sequences - use validated name
        await (db as any).raw(`DELETE FROM sqlite_sequence WHERE name='${validTable}'`).execute();
      }
    }
  }
}

/**
 * Generic test data factory
 *
 * @param defaults - Default values (can be values or functions)
 * @returns Factory function that creates test data
 */
export function createFactory<T extends Record<string, any>>(defaults: {
  [K in keyof T]: T[K] | (() => T[K]);
}): (overrides?: Partial<T>) => T {
  return (overrides = {}) => {
    const result = {} as T;

    for (const [key, value] of Object.entries(defaults)) {
      result[key as keyof T] = typeof value === 'function' ? (value as () => any)() : value;
    }

    for (const [key, value] of Object.entries(overrides)) {
      result[key as keyof T] = value as T[keyof T];
    }

    return result;
  };
}

/**
 * Wait for a condition to be true (useful for async operations)
 *
 * @param condition - Function that returns true when condition is met
 * @param options - Configuration options
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  options: {
    timeout?: number;
    interval?: number;
    timeoutMessage?: string;
  } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100, timeoutMessage = 'Condition not met within timeout' } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(timeoutMessage);
}

/**
 * Seed database with test data
 *
 * @param db - Kysely database instance
 * @param fn - Seeding function
 */
export async function seedDatabase<DB>(db: Kysely<DB>, fn: (trx: Transaction<DB>) => Promise<void>): Promise<void> {
  await db.transaction().execute(fn);
}

/**
 * Isolation level for transactions
 */
export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

/**
 * Test with specific transaction isolation level
 *
 * @param db - Kysely database instance
 * @param isolationLevel - Transaction isolation level
 * @param fn - Test function
 */
export async function testWithIsolation<DB, T>(
  db: Kysely<DB>,
  isolationLevel: IsolationLevel,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      await (trx as any).raw(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel.toUpperCase()}`).execute();

      await fn(trx);

      throw new RollbackError();
    });
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error;
    }
  }
}

/**
 * Snapshot database state for later comparison
 *
 * @param db - Kysely database instance
 * @param table - Table name
 * @returns Array of all rows in the table
 */
export async function snapshotTable<DB>(db: Kysely<DB>, table: string): Promise<any[]> {
  return db
    .selectFrom(table as any)
    .selectAll()
    .execute();
}

/**
 * Count rows in a table
 *
 * @param db - Kysely database instance
 * @param table - Table name
 * @returns Number of rows
 */
export async function countRows<DB>(db: Kysely<DB>, table: string): Promise<number> {
  const result = await (db as any)
    .selectFrom(table)
    .select((eb: any) => eb.fn.countAll().as('count'))
    .executeTakeFirst();

  return result ? Number(result.count) : 0;
}
