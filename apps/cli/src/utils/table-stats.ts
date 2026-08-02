import { logger } from './logger.js'
import { validateIdentifier } from './sql-sanitizer.js'
import type { DatabaseInstance } from '../types/index.js'

export interface TableStatistics {
  rows: number
  size: number
  indexSize: number
}

/**
 * SQL for the PostgreSQL size probe. The table is matched by name in the
 * current schema via pg_class so exact case is honored ($1 is used for
 * both relation and index sizes).
 */
export const PG_TABLE_SIZE_SQL = `SELECT pg_relation_size(c.oid) AS table_size, pg_indexes_size(c.oid) AS index_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = $1 AND n.nspname = current_schema()`

/**
 * SQL for the MySQL size probe against information_schema.
 */
export const MYSQL_TABLE_SIZE_SQL = `SELECT DATA_LENGTH AS table_size, INDEX_LENGTH AS index_size
FROM information_schema.TABLES
WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()`

interface TableSizeRow {
  table_size: number | string | bigint | null
  index_size: number | string | bigint | null
}

/**
 * Get table statistics for a given table
 * Handles all supported database dialects (postgres, mysql, sqlite)
 *
 * @param db - Database connection instance
 * @param tableName - Name of the table to get statistics for
 * @param dialect - Database dialect (postgres, mysql, or sqlite)
 * @returns Table statistics object with row count, size, and index size
 */
export async function getTableStatistics(
  db: DatabaseInstance,
  tableName: string,
  dialect: string
): Promise<TableStatistics> {
  try {
    // Validate table name to prevent SQL injection
    const validatedTableName = validateIdentifier(tableName, 'table')
    const { CompiledQuery } = await import('kysely')

    // Get row count
    const countResult = await db
      .selectFrom(validatedTableName)
      .select(db.fn.countAll().as('count'))
      .executeTakeFirst()
    const rows = Number(countResult?.count ?? 0)

    // Get table size (dialect-specific)
    let size = 0
    let indexSize = 0

    if (dialect === 'postgres') {
      const sizeResult = await db.executeQuery(
        CompiledQuery.raw(PG_TABLE_SIZE_SQL, [validatedTableName])
      )
      const row = sizeResult.rows[0] as TableSizeRow | undefined
      size = Number(row?.table_size ?? 0)
      indexSize = Number(row?.index_size ?? 0)
    } else if (dialect === 'mysql') {
      const sizeResult = await db.executeQuery(
        CompiledQuery.raw(MYSQL_TABLE_SIZE_SQL, [validatedTableName])
      )
      const row = sizeResult.rows[0] as TableSizeRow | undefined
      size = Number(row?.table_size ?? 0)
      indexSize = Number(row?.index_size ?? 0)
    } else {
      // SQLite - estimate based on row count
      // SQLite doesn't provide easy access to table sizes
      size = rows * 100 // Rough estimate: 100 bytes per row
      indexSize = rows * 20 // Rough estimate: 20 bytes per row for indexes
    }

    return { rows, size, indexSize }
  } catch (error) {
    logger.debug(`Failed to get stats for ${tableName}: ${String(error)}`)
    return { rows: 0, size: 0, indexSize: 0 }
  }
}

/**
 * Get statistics for multiple tables
 *
 * @param db - Database connection instance
 * @param tableNames - Array of table names to get statistics for
 * @param dialect - Database dialect (postgres, mysql, or sqlite)
 * @returns Map of table name to statistics
 */
export async function getMultipleTableStatistics(
  db: DatabaseInstance,
  tableNames: string[],
  dialect: string
): Promise<Map<string, TableStatistics>> {
  const stats = new Map<string, TableStatistics>()

  for (const tableName of tableNames) {
    const tableStats = await getTableStatistics(db, tableName, dialect)
    stats.set(tableName, tableStats)
  }

  return stats
}

/**
 * Get aggregated database statistics
 *
 * @param db - Database connection instance
 * @param tableNames - Array of table names to aggregate statistics for
 * @param dialect - Database dialect (postgres, mysql, or sqlite)
 * @returns Aggregated statistics object
 */
export async function getDatabaseStatistics(
  db: DatabaseInstance,
  tableNames: string[],
  dialect: string
): Promise<{ totalRows: number; totalSize: number; totalIndexSize: number }> {
  let totalRows = 0
  let totalSize = 0
  let totalIndexSize = 0

  for (const tableName of tableNames) {
    const stats = await getTableStatistics(db, tableName, dialect)
    totalRows += stats.rows
    totalSize += stats.size
    totalIndexSize += stats.indexSize
  }

  return { totalRows, totalSize, totalIndexSize }
}
