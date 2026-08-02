import { Kysely, sql } from 'kysely'
import { CLIDatabaseError } from '../errors.js'
import { stat } from 'node:fs/promises'
import { logger } from '../logger.js'
import {
  validateIdentifier,
  safePragmaTableInfo,
  safePragmaIndexInfo,
  safePragmaForeignKeyList,
  safeAnalyze,
  safeVacuumInto
} from '../sql-sanitizer.js'

/**
 * SQLite specific utilities
 */

/**
 * System tables these helpers query. The index signature covers user
 * tables reached with a runtime-validated name (row shape unknown).
 */
interface SqliteSystemTables {
  sqlite_master: {
    type: string
    name: string
    tbl_name: string
    rootpage: number
    sql: string | null
  }
  [table: string]: Record<string, unknown>
}

type SqliteDb = Kysely<SqliteSystemTables>

export interface SqliteInfo {
  version: string
  compiledOptions: string[]
  pageSize: number
  pageCount: number
  freePages: number
  databaseSize: string
}

/**
 * Column row returned by PRAGMA table_info.
 */
export interface SqliteColumnInfo {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: unknown
  pk: number
}

/**
 * Get SQLite info
 */
export async function getSqliteInfo(db: SqliteDb): Promise<SqliteInfo> {
  try {
    const versionResult = await db
      .selectNoFrom(sql<string>`sqlite_version()`.as('version'))
      .executeTakeFirst()

    const pageSizeResult = await sql.raw<{ page_size: number }>('PRAGMA page_size').execute(db)
    const pageCountResult = await sql.raw<{ page_count: number }>('PRAGMA page_count').execute(db)
    const freePagesResult = await sql
      .raw<{ freelist_count: number }>('PRAGMA freelist_count')
      .execute(db)

    const compiledOptionsResult = await sql
      .raw<{ compile_option: string }>('PRAGMA compile_options')
      .execute(db)

    const pageSize = pageSizeResult.rows.at(0)?.page_size ?? 4096
    const pageCount = pageCountResult.rows.at(0)?.page_count ?? 0
    const freePages = freePagesResult.rows.at(0)?.freelist_count ?? 0

    const sizeBytes = pageSize * pageCount
    const databaseSize = formatSize(sizeBytes)

    return {
      version: versionResult?.version ?? 'Unknown',
      compiledOptions: compiledOptionsResult.rows.map(r => r.compile_option),
      pageSize,
      pageCount,
      freePages,
      databaseSize
    }
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to get SQLite info: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Get table info
 */
export async function getTableInfo(db: SqliteDb, tableName: string): Promise<SqliteColumnInfo[]> {
  try {
    // Use safe PRAGMA statement
    const result = await sql.raw<SqliteColumnInfo>(safePragmaTableInfo(tableName)).execute(db)

    return result.rows
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to get table info for ${tableName}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Get index info
 */
export async function getIndexInfo(
  db: SqliteDb,
  indexName: string
): Promise<
  {
    seqno: number
    cid: number
    name: string
  }[]
> {
  try {
    // Use safe PRAGMA statement
    const result = await sql
      .raw<{ seqno: number; cid: number; name: string }>(safePragmaIndexInfo(indexName))
      .execute(db)

    return result.rows
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to get index info for ${indexName}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Get foreign key info
 */
export async function getForeignKeys(
  db: SqliteDb,
  tableName: string
): Promise<
  {
    id: number
    seq: number
    table: string
    from: string
    to: string
    on_update: string
    on_delete: string
    match: string
  }[]
> {
  try {
    // Use safe PRAGMA statement
    const result = await sql
      .raw<{
        id: number
        seq: number
        table: string
        from: string
        to: string
        on_update: string
        on_delete: string
        match: string
      }>(safePragmaForeignKeyList(tableName))
      .execute(db)

    return result.rows
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to get foreign keys for ${tableName}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Check integrity
 */
export async function checkIntegrity(db: SqliteDb): Promise<boolean> {
  try {
    const result = await sql
      .raw<{ integrity_check: string }>('PRAGMA integrity_check')
      .execute(db)

    return result.rows.length === 1 && result.rows[0].integrity_check === 'ok'
  } catch (error) {
    logger.debug('Failed to check database integrity:', error)
    return false
  }
}

/**
 * Check foreign key violations
 */
export async function checkForeignKeyViolations(db: SqliteDb): Promise<
  {
    table: string
    rowid: number
    parent: string
    fkid: number
  }[]
> {
  try {
    const result = await sql
      .raw<{ table: string; rowid: number; parent: string; fkid: number }>(
        'PRAGMA foreign_key_check'
      )
      .execute(db)

    return result.rows
  } catch (error) {
    logger.debug('Failed to check foreign key violations:', error)
    return []
  }
}

/**
 * Vacuum database
 */
export async function vacuum(db: SqliteDb): Promise<void> {
  try {
    await sql.raw('VACUUM').execute(db)
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to vacuum database: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Analyze database
 */
export async function analyze(db: SqliteDb, tableName?: string): Promise<void> {
  try {
    // Use safe ANALYZE statement
    await sql.raw(safeAnalyze(tableName, 'sqlite')).execute(db)
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to analyze database: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Optimize database
 */
export async function optimize(db: SqliteDb): Promise<void> {
  try {
    await sql.raw('PRAGMA optimize').execute(db)
    await vacuum(db)
    await analyze(db)
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to optimize database: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Get database file size
 */
export async function getDatabaseFileSize(dbPath: string): Promise<string> {
  try {
    const stats = await stat(dbPath)
    return formatSize(stats.size)
  } catch (error) {
    logger.debug(`Failed to get database file size for ${dbPath}:`, error)
    return 'Unknown'
  }
}

/**
 * Get table statistics
 */
export async function getTableStatistics(
  db: SqliteDb,
  tableName: string
): Promise<{
  rows: number
  columns: number
  indexes: number
  triggers: number
  primaryKey: string | null
}> {
  try {
    // Validate table name
    validateIdentifier(tableName, 'table')

    const rowCountResult = await db
      .selectFrom(tableName)
      .select(sql<number>`COUNT(*)`.as('count'))
      .executeTakeFirst()

    const tableInfo = await getTableInfo(db, tableName)

    const indexesResult = await db
      .selectFrom('sqlite_master')
      .select('name')
      .where('type', '=', 'index')
      .where('tbl_name', '=', tableName)
      .execute()

    const triggersResult = await db
      .selectFrom('sqlite_master')
      .select('name')
      .where('type', '=', 'trigger')
      .where('tbl_name', '=', tableName)
      .execute()

    const primaryKeyColumn = tableInfo.find(col => col.pk === 1)

    return {
      rows: rowCountResult?.count ?? 0,
      columns: tableInfo.length,
      indexes: indexesResult.length,
      triggers: triggersResult.length,
      primaryKey: primaryKeyColumn?.name ?? null
    }
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to get table statistics: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Enable WAL mode
 */
export async function enableWalMode(db: SqliteDb): Promise<void> {
  try {
    await sql.raw('PRAGMA journal_mode=WAL').execute(db)
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to enable WAL mode: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Create backup
 */
export async function createBackup(db: SqliteDb, backupPath: string): Promise<void> {
  try {
    // Use safe VACUUM INTO statement
    await sql.raw(safeVacuumInto(backupPath)).execute(db)
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to create backup: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Get all tables
 */
export async function getAllTables(db: SqliteDb): Promise<string[]> {
  try {
    const result = await db
      .selectFrom('sqlite_master')
      .select('name')
      .where('type', '=', 'table')
      .where('name', 'not like', 'sqlite_%')
      .execute()

    return result.map(r => r.name)
  } catch (error) {
    logger.debug('Failed to get all tables:', error)
    return []
  }
}

/**
 * Get all indexes
 */
export async function getAllIndexes(db: SqliteDb): Promise<
  {
    name: string
    table: string
    unique: boolean
  }[]
> {
  try {
    const result = await db
      .selectFrom('sqlite_master')
      .select(['name', 'tbl_name as table', 'sql'])
      .where('type', '=', 'index')
      .where('name', 'not like', 'sqlite_%')
      .execute()

    return result.map(r => ({
      name: r.name,
      table: r.table,
      unique: r.sql?.includes('UNIQUE') ?? false
    }))
  } catch (error) {
    logger.debug('Failed to get all indexes:', error)
    return []
  }
}

/**
 * Format size in bytes to human-readable format
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
