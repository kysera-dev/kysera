/**
 * Database cleanup utilities.
 *
 * @module @kysera/testing
 */

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { silentLogger, type Dialect, type KyseraLogger } from '@kysera/core'

/**
 * Database cleanup strategies.
 */
export type CleanupStrategy = 'truncate' | 'transaction' | 'delete'

/**
 * Options for database cleanup operations.
 */
export interface CleanupOptions {
  /**
   * Explicitly specify the database dialect.
   * If not provided, will attempt to detect from Kysely instance.
   */
  dialect?: Dialect
  /**
   * List of tables to clean (in deletion order for 'delete' strategy).
   */
  tables?: string[]
  /**
   * Logger for warnings and errors.
   * Defaults to silentLogger (no output).
   */
  logger?: KyseraLogger
}

/**
 * Strict regex pattern for valid SQL identifiers.
 * - Must start with a letter or underscore
 * - Can contain letters, digits, and underscores
 * - No special characters or SQL injection patterns
 * @internal
 */
const VALID_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Validate an SQL identifier to prevent injection.
 * @internal
 */
function validateIdentifier(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid identifier: must be a non-empty string')
  }

  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 128) {
    throw new Error('Invalid identifier: length must be between 1 and 128 characters')
  }

  if (!VALID_IDENTIFIER_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid identifier ${trimmed}: must start with a letter or underscore and contain only letters, digits, and underscores`
    )
  }

  return trimmed
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
 * @param tablesOrOptions - List of tables to clean or cleanup options
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
 * @example Using truncate strategy with explicit dialect
 * ```typescript
 * import { cleanDatabase } from '@kysera/testing';
 *
 * afterEach(async () => {
 *   await cleanDatabase(db, 'truncate', {
 *     dialect: 'postgres',
 *     tables: ['users', 'orders', 'order_items']
 *   });
 * });
 * ```
 */
export async function cleanDatabase<DB>(
  db: Kysely<DB>,
  strategy: CleanupStrategy = 'transaction',
  tablesOrOptions?: string[] | CleanupOptions
): Promise<void> {
  // Transaction strategy means we're using testInTransaction, no cleanup needed
  if (strategy === 'transaction') {
    return
  }

  // Normalize options
  const options: CleanupOptions = Array.isArray(tablesOrOptions)
    ? { tables: tablesOrOptions }
    : (tablesOrOptions ?? {})

  const logger = options.logger ?? silentLogger
  const tables = options.tables

  if (!tables || tables.length === 0) {
    throw new Error(
      'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
    )
  }

  if (strategy === 'delete') {
    await cleanUsingDelete(db, tables)
  } else {
    await cleanUsingTruncate(db, tables, options.dialect, logger)
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
    await db.deleteFrom(table as any).execute()
  }
}

/**
 * Internal interface for database executors with adapter access
 * This provides a type-safe way to access internal Kysely properties
 * @internal
 * @deprecated Use explicit dialect parameter instead of relying on Kysely internals
 */
interface DatabaseExecutorWithAdapter {
  getExecutor?: () => {
    adapter?: {
      dialect?: {
        constructor?: {
          name?: string
        }
      }
    }
  }
}

/**
 * Detect database dialect from Kysely internals (fallback mechanism)
 *
 * @deprecated This function relies on Kysely's internal implementation details
 * which may change across versions. Use explicit `dialect` parameter instead.
 *
 * **Why this exists:**
 * Provides backward compatibility for code that doesn't pass explicit dialect.
 * This allows cleanup utilities to work out-of-the-box while we encourage
 * migration to explicit configuration.
 *
 * **Risks:**
 * - Kysely may change internal adapter structure in future versions
 * - Constructor name detection is fragile and could fail silently
 * - May not work correctly with custom adapters or proxies
 *
 * **Migration path:**
 * ```typescript
 * // Old (relies on detection):
 * await cleanDatabase(db, 'truncate', ['users']);
 *
 * // New (explicit configuration - recommended):
 * await cleanDatabase(db, 'truncate', { dialect: 'postgres', tables: ['users'] });
 * ```
 *
 * @internal
 */
function detectDialect<DB>(
  db: Kysely<DB>,
  providedDialect?: Dialect,
  logger: KyseraLogger = silentLogger
): Dialect {
  // Use provided dialect if available (recommended approach)
  if (providedDialect) {
    return providedDialect
  }

  // Warn about deprecated internal API usage
  logger.warn(
    'Dialect detection via Kysely internals is deprecated and may fail in future versions. ' +
      'Please provide dialect option explicitly in CleanupOptions: { dialect: "postgres", tables: [...] }'
  )

  try {
    // Attempt multiple detection strategies for robustness
    const detected = tryMultipleDetectionStrategies(db)
    if (detected) {
      return detected
    }

    // If all detection strategies fail, fall back to SQLite as safe default
    logger.warn(
      'Could not detect database dialect, falling back to SQLite. ' +
        'For better reliability, provide explicit dialect in CleanupOptions: { dialect: "postgres"|"mysql"|"sqlite"|"mssql", tables: [...] }'
    )
    return 'sqlite'
  } catch (error) {
    // For unexpected errors, fall back to SQLite with warning
    logger.warn(
      'Error during dialect detection, falling back to SQLite: ' +
        (error instanceof Error ? error.message : String(error))
    )
    return 'sqlite'
  }
}

/**
 * Try multiple strategies to detect database dialect
 * @internal
 */
function tryMultipleDetectionStrategies<DB>(db: Kysely<DB>): Dialect | null {
  // Strategy 1: Check via getExecutor() method (most common)
  const strategy1 = tryGetExecutorStrategy(db)
  if (strategy1) return strategy1

  // Strategy 2: Check for dialect-specific methods/properties
  const strategy2 = tryDialectMethodsStrategy(db)
  if (strategy2) return strategy2

  // All strategies failed
  return null
}

/**
 * Strategy 1: Detect via getExecutor() accessor
 * @internal
 */
function tryGetExecutorStrategy<DB>(db: Kysely<DB>): Dialect | null {
  try {
    // Type assertion is necessary for accessing internal Kysely properties
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const dbWithAdapter = db as unknown as DatabaseExecutorWithAdapter
    const executor = dbWithAdapter.getExecutor?.()
    const adapter = executor?.adapter
    const dialect = adapter?.dialect

    if (!dialect?.constructor?.name) {
      return null
    }

    const dialectName = dialect.constructor.name.toLowerCase()
    if (dialectName.includes('postgres') || dialectName.includes('pg')) {
      return 'postgres'
    }
    if (dialectName.includes('mysql')) {
      return 'mysql'
    }
    if (dialectName.includes('sqlite')) {
      return 'sqlite'
    }
    if (dialectName.includes('mssql') || dialectName.includes('sqlserver')) {
      return 'mssql'
    }

    return null
  } catch {
    return null
  }
}

/**
 * Strategy 2: Detect via introspection of db object properties
 * @internal
 */
function tryDialectMethodsStrategy<DB>(db: Kysely<DB>): Dialect | null {
  try {
    // Check if db has any dialect-specific internal properties
    // This is a more defensive fallback strategy
    const dbObj = db as unknown as Record<string, unknown>

    // Look for common internal property patterns
    for (const key of Object.keys(dbObj)) {
      const detected = checkPropertyForDialect(dbObj[key])
      if (detected) {
        return detected
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Check a single property for dialect indicators
 * @internal
 */
function checkPropertyForDialect(value: unknown): Dialect | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const constructorName = (value as { constructor?: { name?: string } }).constructor?.name
  if (!constructorName) {
    return null
  }

  const stringified = constructorName.toLowerCase()
  if (stringified.includes('postgres') || stringified.includes('pg')) {
    return 'postgres'
  }
  if (stringified.includes('mysql')) {
    return 'mysql'
  }
  if (stringified.includes('sqlite')) {
    return 'sqlite'
  }
  if (stringified.includes('mssql') || stringified.includes('sqlserver')) {
    return 'mssql'
  }

  return null
}

/**
 * Execute TRUNCATE TABLE statement for MySQL.
 *
 * Note: DDL statements like TRUNCATE don't support parameterization.
 * Security is ensured through strict identifier validation which prevents
 * all SQL injection vectors (only allows [a-zA-Z0-9_] patterns).
 *
 * @internal
 */
async function truncateTableMySQL<DB>(db: Kysely<DB>, tableName: string): Promise<void> {
  const validTable = validateIdentifier(tableName)
  // MySQL requires backticks for identifier quoting
  await sql.raw(`TRUNCATE TABLE \`${validTable}\``).execute(db)
}

/**
 * Execute TRUNCATE TABLE with CASCADE statement.
 *
 * Note: DDL statements like TRUNCATE don't support parameterization.
 * Security is ensured through strict identifier validation which prevents
 * all SQL injection vectors (only allows [a-zA-Z0-9_] patterns).
 *
 * @internal
 */
async function truncateTableCascade<DB>(db: Kysely<DB>, tableName: string): Promise<void> {
  const validTable = validateIdentifier(tableName)
  // DDL statements require string literals; security via validateIdentifier()
  await sql.raw(`TRUNCATE TABLE ${validTable} CASCADE`).execute(db)
}

/**
 * Clean database using TRUNCATE strategy.
 * @internal
 */
async function cleanUsingTruncate<DB>(
  db: Kysely<DB>,
  tables: string[],
  providedDialect?: Dialect,
  logger: KyseraLogger = silentLogger
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const dialect = detectDialect(db, providedDialect, logger)

  switch (dialect) {
    case 'postgres':
      await cleanPostgres(db, tables)
      break
    case 'mysql':
      await cleanMysql(db, tables)
      break
    case 'mssql':
      await cleanMssql(db, tables)
      break
    case 'sqlite':
      await cleanSqlite(db, tables)
      break
    default:
      // Fall back to SQLite for unknown dialects
      await cleanSqlite(db, tables)
      break
  }
}

/**
 * Clean PostgreSQL database using TRUNCATE.
 * @internal
 */
async function cleanPostgres<DB>(db: Kysely<DB>, tables: string[]): Promise<void> {
  // PostgreSQL: Disable FK checks, truncate, re-enable
  await sql.raw('SET session_replication_role = replica').execute(db)

  for (const table of tables) {
    await truncateTableCascade(db, table)
  }

  await sql.raw('SET session_replication_role = DEFAULT').execute(db)
}

/**
 * Clean MySQL database using TRUNCATE.
 * @internal
 */
async function cleanMysql<DB>(db: Kysely<DB>, tables: string[]): Promise<void> {
  // MySQL: Disable FK checks, truncate, re-enable
  await sql.raw('SET FOREIGN_KEY_CHECKS = 0').execute(db)

  for (const table of tables) {
    await truncateTableMySQL(db, table)
  }

  await sql.raw('SET FOREIGN_KEY_CHECKS = 1').execute(db)
}

/**
 * Execute TRUNCATE TABLE statement for MSSQL.
 *
 * MSSQL TRUNCATE considerations:
 * - Cannot truncate tables with foreign key constraints (must disable FKs first)
 * - TRUNCATE resets IDENTITY columns automatically
 * - Syntax: TRUNCATE TABLE [schema].[table] or TRUNCATE TABLE [table]
 * - Bracket escaping for identifiers: [table_name]
 *
 * Note: DDL statements like TRUNCATE don't support parameterization.
 * Security is ensured through strict identifier validation which prevents
 * all SQL injection vectors (only allows [a-zA-Z0-9_] patterns).
 *
 * @internal
 */
async function truncateTableMssql<DB>(db: Kysely<DB>, tableName: string): Promise<void> {
  const validTable = validateIdentifier(tableName)
  // MSSQL uses square brackets for identifier quoting
  // Default schema is 'dbo' but we omit it to allow any schema
  await sql.raw(`TRUNCATE TABLE [${validTable}]`).execute(db)
}

/**
 * Clean MSSQL database using TRUNCATE.
 *
 * MSSQL foreign key handling strategy:
 * - Use NOCHECK CONSTRAINT to temporarily disable FK checks
 * - Execute TRUNCATE on each table
 * - Re-enable constraints with CHECK CONSTRAINT
 *
 * Alternative approach for tables with foreign keys:
 * - Could use DELETE instead of TRUNCATE (slower but FK-safe)
 * - Could use DBCC CHECKIDENT to reset identity columns after DELETE
 *
 * Current implementation uses the constraint disable approach for consistency
 * with PostgreSQL and MySQL patterns and better performance.
 *
 * @internal
 */
async function cleanMssql<DB>(db: Kysely<DB>, tables: string[]): Promise<void> {
  // MSSQL: Disable FK checks globally, truncate, re-enable
  // Note: NOCHECK CONSTRAINT ALL is supported in MSSQL 2005+
  await sql.raw('EXEC sp_MSforeachtable "ALTER TABLE ? NOCHECK CONSTRAINT ALL"').execute(db)

  for (const table of tables) {
    await truncateTableMssql(db, table)
  }

  // Re-enable all constraints
  await sql.raw('EXEC sp_MSforeachtable "ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL"').execute(db)
}

/**
 * Clean SQLite database using DELETE (no TRUNCATE support).
 * @internal
 */
async function cleanSqlite<DB>(db: Kysely<DB>, tables: string[]): Promise<void> {
  // SQLite: No TRUNCATE, use DELETE and reset sequences
  for (const table of tables) {
    const validTable = validateIdentifier(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic table name requires any cast
    await db.deleteFrom(table as any).execute()
    // Reset auto-increment sequence using parameterized query to prevent SQL injection
    await sql`DELETE FROM sqlite_sequence WHERE name = ${validTable}`.execute(db)
  }
}
