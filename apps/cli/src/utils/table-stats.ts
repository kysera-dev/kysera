import type { RawBuilder } from 'kysely'
import { logger } from './logger.js'
import { validateIdentifier } from './sql-sanitizer.js'
import type { DatabaseInstance } from '../types/index.js'

export interface TableStatistics {
  rows: number
  size: number
  indexSize: number
}

/**
 * Raw-SQL surface the size probes expect on the expression builder.
 * Structural type only: the probes run inside try/catch and fall back to
 * zeroed statistics when the runtime does not provide `raw`.
 */
interface RawExpressionApi {
  raw<T>(fragment: string): RawBuilder<T>
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
      const sizeResult = await db
        .selectNoFrom(eb => [
          (eb as unknown as RawExpressionApi)
            .raw<number | string>(`pg_relation_size('${validatedTableName}')`)
            .as('table_size'),
          (eb as unknown as RawExpressionApi)
            .raw<number | string>(`pg_indexes_size('${validatedTableName}')`)
            .as('index_size')
        ])
        .executeTakeFirst()

      size = Number(sizeResult?.table_size ?? 0)
      indexSize = Number(sizeResult?.index_size ?? 0)
    } else if (dialect === 'mysql') {
      const sizeResult = await db
        .selectFrom('information_schema.TABLES')
        .select(['DATA_LENGTH', 'INDEX_LENGTH'])
        .where('TABLE_NAME', '=', validatedTableName)
        .where('TABLE_SCHEMA', '=', db.raw('DATABASE()'))
        .executeTakeFirst()

      size = Number(sizeResult?.DATA_LENGTH ?? 0)
      indexSize = Number(sizeResult?.INDEX_LENGTH ?? 0)
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
