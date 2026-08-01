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
 * 1. Primary: Compiles a probe query with one parameter and analyzes the
 *    parameter placeholder style — unambiguous across kysely's compilers:
 *    - `$1` → postgres
 *    - `@1` / `@p1` → mssql
 *    - `?` + backtick-quoted identifiers → mysql
 *    - `?` + double-quoted (or unquoted) identifiers → sqlite
 *    (Identifier quoting alone CANNOT distinguish sqlite from postgres —
 *    kysely's SqliteQueryCompiler double-quotes identifiers exactly like
 *    PostgreSQL, and MssqlQueryCompiler double-quotes too.)
 * 2. Fallback: Adapter constructor name via the public `getExecutor()` API
 *    (PostgresAdapter / MysqlAdapter / SqliteAdapter / MssqlAdapter)
 * 3. Legacy fallback: dialect constructor name shapes
 * 4. Default: Returns 'postgres' if detection fails (safest default)
 *
 * **Why this approach?**
 * - Compiled SQL patterns are stable across Kysely versions
 * - Placeholder style is immune to bundler minification (unlike class names)
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
/** Map a constructor-like name to a dialect, or undefined if unrecognized */
function dialectFromName(name: string | undefined): Dialect | undefined {
  if (!name) return undefined
  const normalized = name.toLowerCase()
  if (normalized.includes('postgres') || normalized.includes('pglite')) return 'postgres'
  if (normalized.includes('mysql')) return 'mysql'
  if (normalized.includes('sqlite')) return 'sqlite'
  if (normalized.includes('mssql') || normalized.includes('sqlserver')) return 'mssql'
  return undefined
}

export function detectDialect<DB>(executor: Kysely<DB>): Dialect {
  try {
    // Primary detection: compile a probe query with exactly one parameter
    // (the limit value) and analyze placeholder style + identifier quoting.
    // We use a type assertion here because we're intentionally using a fake
    // table name just to generate SQL for dialect detection.
    const query = (executor as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom('_kysera_test')
      .select(sql<number>`1`.as('test'))
      .limit(0)

    const compiled = query.compile()
    const compiledSql = compiled.sql

    // 1) Parameter placeholder style — unambiguous across kysely compilers:
    //    postgres → $1, mssql → @1/@p1, mysql & sqlite → ?
    if (/\$\d/.test(compiledSql)) {
      return 'postgres'
    }
    if (/@p?\d/.test(compiledSql)) {
      return 'mssql'
    }

    // 2) Identifier quoting narrows down the `?`-placeholder dialects:
    if (compiledSql.includes('`_kysera_test`')) {
      // MySQL uses backticks for identifiers
      return 'mysql'
    }
    if (compiledSql.includes('[_kysera_test]')) {
      // Square brackets — community/legacy MSSQL compilers
      return 'mssql'
    }
    if (compiledSql.includes('"_kysera_test"') && compiledSql.includes('?')) {
      // Double quotes + positional `?` placeholders → SQLite.
      // (PostgreSQL always uses $n, so this combination is unambiguous.)
      return 'sqlite'
    }
    if (
      compiledSql.includes('_kysera_test') &&
      !compiledSql.includes('"') &&
      !compiledSql.includes('`') &&
      !compiledSql.includes('[')
    ) {
      // Unquoted simple identifiers → SQLite-style compilers
      return 'sqlite'
    }
    // Double quotes without any parameters: cannot disambiguate from SQL
    // alone — fall through to adapter inspection.
  } catch {
    // If SQL generation fails, fall through to fallback methods
  }

  // Fallback: adapter constructor name via the public getExecutor() API
  // (PostgresAdapter / MysqlAdapter / SqliteAdapter / MssqlAdapter).
  // May be defeated by minification, hence only a fallback.
  try {
    const execAny = executor as unknown as {
      getExecutor?: () => { adapter?: { constructor?: { name?: string } } }
    }
    const adapterDialect = dialectFromName(
      execAny.getExecutor?.().adapter?.constructor?.name
    )
    if (adapterDialect) return adapterDialect
  } catch {
    // Ignore errors in fallback method
  }

  // Legacy fallback: dialect constructor name shape (older wrappers/mocks)
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
    const legacyDialect = dialectFromName(
      execAny.executor?.adapter?.dialect?.constructor?.name
    )
    if (legacyDialect) return legacyDialect
  } catch {
    // Ignore errors in fallback method
  }

  // Default fallback: postgres is the safest default
  // PostgreSQL has the most consistent behavior and is widely used
  return 'postgres'
}
