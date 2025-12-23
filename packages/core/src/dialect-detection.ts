import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { Dialect } from './types.js'

/**
 * Detects the database dialect from a Kysely instance using stable SQL generation patterns.
 *
 * This function uses a version-stable approach that generates test SQL and examines
 * identifier quoting patterns instead of relying on Kysely's internal structure.
 * This ensures compatibility across different Kysely versions.
 *
 * **Detection strategy:**
 * 1. Primary: Generates a test query and analyzes identifier quoting in compiled SQL
 *    - Double quotes `"table"` → postgres
 *    - Backticks `` `table` `` → mysql
 *    - Square brackets `[table]` → mssql
 *    - No quotes (or double quotes in some cases) → sqlite
 * 2. Fallback: Examines constructor names (legacy support)
 * 3. Default: Returns 'postgres' if detection fails (safest default)
 *
 * **Why this approach?**
 * - SQL generation patterns are stable across Kysely versions
 * - Doesn't rely on private/internal Kysely properties
 * - Each dialect has unique, unchanging identifier quoting rules
 * - Works with both raw Kysely instances and transactions
 *
 * **Supported dialects:**
 * - `postgres` - PostgreSQL (including CockroachDB, Yugabyte)
 * - `mysql` - MySQL and MariaDB
 * - `sqlite` - SQLite (including better-sqlite3)
 * - `mssql` - Microsoft SQL Server
 *
 * @param executor - The Kysely database instance or transaction
 * @returns The detected dialect type
 *
 * @example
 * Basic usage:
 * ```typescript
 * import { detectDialect } from '@kysera/core'
 * import { Kysely, PostgresDialect } from 'kysely'
 *
 * const db = new Kysely<Database>({
 *   dialect: new PostgresDialect({ pool })
 * })
 *
 * const dialect = detectDialect(db)
 * // Returns: 'postgres'
 * ```
 *
 * @example
 * Use for dialect-specific logic:
 * ```typescript
 * const dialect = detectDialect(db)
 *
 * switch (dialect) {
 *   case 'postgres':
 *     // Use ON CONFLICT for upsert
 *     break
 *   case 'mysql':
 *     // Use ON DUPLICATE KEY UPDATE for upsert
 *     break
 *   case 'sqlite':
 *     // Use INSERT OR REPLACE for upsert
 *     break
 *   case 'mssql':
 *     // Use MERGE for upsert
 *     break
 * }
 * ```
 *
 * @example
 * Works with transactions:
 * ```typescript
 * await db.transaction().execute(async (trx) => {
 *   const dialect = detectDialect(trx)
 *   // Same dialect as parent db
 * })
 * ```
 *
 * @example
 * Use in plugins for cross-database compatibility:
 * ```typescript
 * import { detectDialect } from '@kysera/core'
 *
 * export function myPlugin() {
 *   return {
 *     transformQuery(args) {
 *       const dialect = detectDialect(args.executor)
 *
 *       // Apply dialect-specific transformations
 *       if (dialect === 'mysql') {
 *         // MySQL-specific logic
 *       }
 *
 *       return args.node
 *     }
 *   }
 * }
 * ```
 */
export function detectDialect<DB>(executor: Kysely<DB>): Dialect {
  try {
    // Primary detection: Generate test SQL and analyze identifier quoting
    // We use a type assertion here because we're intentionally using a fake table name
    // just to generate SQL for dialect detection
    const query = (executor as Kysely<any>)
      .selectFrom('_kysera_test')
      .select(sql<number>`1`.as('test'))
      .limit(0)

    const compiled = query.compile()
    const compiledSql = compiled.sql

    // Check for identifier quoting patterns in the compiled SQL
    if (compiledSql.includes('"_kysera_test"')) {
      // PostgreSQL uses double quotes for identifiers
      return 'postgres'
    }
    if (compiledSql.includes('`_kysera_test`')) {
      // MySQL uses backticks for identifiers
      return 'mysql'
    }
    if (compiledSql.includes('[_kysera_test]')) {
      // SQL Server uses square brackets for identifiers
      return 'mssql'
    }
    if (
      compiledSql.includes('_kysera_test') &&
      !compiledSql.includes('"') &&
      !compiledSql.includes('`') &&
      !compiledSql.includes('[')
    ) {
      // SQLite typically doesn't quote simple identifiers
      return 'sqlite'
    }
  } catch {
    // If SQL generation fails, fall through to fallback methods
  }

  // Fallback: Try constructor name inspection (legacy support)
  // This is less stable but works for older Kysely versions or edge cases
  try {
    const execAny = executor as unknown as {
      executor?: {
        adapter?: {
          dialect?: {
            constructor?: { name?: string }
          }
        }
      }
    }

    const dialectName = execAny.executor?.adapter?.dialect?.constructor?.name

    if (dialectName) {
      const normalized = dialectName.toLowerCase()

      if (normalized.includes('postgres')) return 'postgres'
      if (normalized.includes('mysql')) return 'mysql'
      if (normalized.includes('sqlite')) return 'sqlite'
      if (normalized.includes('mssql') || normalized.includes('sqlserver')) return 'mssql'
    }
  } catch {
    // Ignore errors in fallback method
  }

  // Default fallback: postgres is the safest default
  // PostgreSQL has the most consistent behavior and is widely used
  return 'postgres'
}
