/**
 * Database cleanup utilities.
 *
 * @module @kysera/testing
 */

import type { Kysely } from 'kysely';

/**
 * Database cleanup strategies.
 */
export type CleanupStrategy = 'truncate' | 'transaction' | 'delete';

/**
 * Strict regex pattern for valid SQL identifiers.
 * - Must start with a letter or underscore
 * - Can contain letters, digits, and underscores
 * - No special characters or SQL injection patterns
 * @internal
 */
const VALID_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validate an SQL identifier to prevent injection.
 * @internal
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
    throw new Error(
      `Invalid identifier ${trimmed}: must start with a letter or underscore and contain only letters, digits, and underscores`
    );
  }

  return trimmed;
}

/**
 * Escape an identifier for PostgreSQL.
 * @internal
 */
function escapePostgresIdentifier(name: string): string {
  const valid = validateIdentifier(name);
  return valid;
}

/**
 * Escape an identifier for MySQL.
 * @internal
 */
function escapeMysqlIdentifier(name: string): string {
  const valid = validateIdentifier(name);
  return `\`${valid}\``;
}

/**
 * Clean database using specified strategy.
 *
 * Different strategies have different performance characteristics:
 * - `transaction`: No cleanup (fastest, use with testInTransaction)
 * - `delete`: DELETE FROM each table (medium speed, FK-safe order required)
 * - `truncate`: TRUNCATE TABLE (fastest bulk clean, handles FKs automatically)
 *
 * @param db - Kysely database instance
 * @param strategy - Cleanup strategy
 * @param tables - List of tables to clean (in deletion order for 'delete' strategy)
 *
 * @example Using delete strategy
 * ```typescript
 * import { cleanDatabase } from '@kysera/testing';
 *
 * afterEach(async () => {
 *   // Tables in FK-safe order (children first)
 *   await cleanDatabase(db, 'delete', ['order_items', 'orders', 'users']);
 * });
 * ```
 *
 * @example Using truncate strategy
 * ```typescript
 * import { cleanDatabase } from '@kysera/testing';
 *
 * afterEach(async () => {
 *   await cleanDatabase(db, 'truncate', ['users', 'orders', 'order_items']);
 * });
 * ```
 */
export async function cleanDatabase<DB>(
  db: Kysely<DB>,
  strategy: CleanupStrategy = 'transaction',
  tables?: string[]
): Promise<void> {
  // Transaction strategy means we're using testInTransaction, no cleanup needed
  if (strategy === 'transaction') {
    return;
  }

  if (!tables || tables.length === 0) {
    throw new Error(
      'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
    );
  }

  if (strategy === 'delete') {
    await cleanUsingDelete(db, tables);
  } else {
    await cleanUsingTruncate(db, tables);
  }
}

/**
 * Clean database using DELETE FROM strategy.
 * @internal
 */
async function cleanUsingDelete<DB>(db: Kysely<DB>, tables: string[]): Promise<void> {
  // Delete from each table in order (should be FK-safe order)
  for (const table of tables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic table name requires any cast
    await db.deleteFrom(table as any).execute();
  }
}

/**
 * Detect database dialect from Kysely instance.
 * @internal
 */
function detectDialect<DB>(db: Kysely<DB>): 'postgres' | 'mysql' | 'sqlite' {
  // Access internal Kysely structure to determine dialect
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Kysely internals not typed
  const dialect = (db as any).getExecutor?.().adapter?.dialect;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Kysely internals not typed
  const dialectName: string = dialect?.constructor?.name ?? '';

  if (dialectName.includes('Postgres')) {
    return 'postgres';
  }
  if (dialectName.includes('Mysql')) {
    return 'mysql';
  }
  return 'sqlite';
}

/**
 * Execute raw SQL query (Kysely internals access).
 * @internal
 */
async function executeRaw<DB>(db: Kysely<DB>, sql: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Kysely raw() not in types
  await (db as any).raw(sql).execute();
}

/**
 * Clean database using TRUNCATE strategy.
 * @internal
 */
async function cleanUsingTruncate<DB>(db: Kysely<DB>, tables: string[]): Promise<void> {
  const dialect = detectDialect(db);

  if (dialect === 'postgres') {
    await cleanPostgres(db, tables);
  } else if (dialect === 'mysql') {
    await cleanMysql(db, tables);
  } else {
    await cleanSqlite(db, tables);
  }
}

/**
 * Clean PostgreSQL database using TRUNCATE.
 * @internal
 */
async function cleanPostgres<DB>(db: Kysely<DB>, tables: string[]): Promise<void> {
  // PostgreSQL: Disable FK checks, truncate, re-enable
  await executeRaw(db, 'SET session_replication_role = replica');

  for (const table of tables) {
    const escapedTable = escapePostgresIdentifier(table);
    await executeRaw(db, `TRUNCATE TABLE ${escapedTable} CASCADE`);
  }

  await executeRaw(db, 'SET session_replication_role = DEFAULT');
}

/**
 * Clean MySQL database using TRUNCATE.
 * @internal
 */
async function cleanMysql<DB>(db: Kysely<DB>, tables: string[]): Promise<void> {
  // MySQL: Disable FK checks, truncate, re-enable
  await executeRaw(db, 'SET FOREIGN_KEY_CHECKS = 0');

  for (const table of tables) {
    const escapedTable = escapeMysqlIdentifier(table);
    await executeRaw(db, `TRUNCATE TABLE ${escapedTable}`);
  }

  await executeRaw(db, 'SET FOREIGN_KEY_CHECKS = 1');
}

/**
 * Clean SQLite database using DELETE (no TRUNCATE support).
 * @internal
 */
async function cleanSqlite<DB>(db: Kysely<DB>, tables: string[]): Promise<void> {
  // SQLite: No TRUNCATE, use DELETE and reset sequences
  for (const table of tables) {
    const validTable = validateIdentifier(table);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic table name requires any cast
    await db.deleteFrom(table as any).execute();
    // Reset auto-increment sequence
    await executeRaw(db, `DELETE FROM sqlite_sequence WHERE name='${validTable}'`);
  }
}
