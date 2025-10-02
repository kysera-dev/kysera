import { Kysely } from 'kysely'
import { DatabaseError } from '../errors.js'
import { stat } from 'fs-extra'

/**
 * SQLite specific utilities
 */

export interface SqliteInfo {
  version: string
  compiledOptions: string[]
  pageSize: number
  pageCount: number
  freePages: number
  databaseSize: string
}

/**
 * Get SQLite info
 */
export async function getSqliteInfo(db: Kysely<any>, dbPath?: string): Promise<SqliteInfo> {
  try {
    // Get version
    const versionResult = await db
      .selectNoFrom(db.raw<string>('sqlite_version()').as('version'))
      .executeTakeFirst()

    // Get pragma info
    const pageSizeResult = await db.schema.raw<any>('PRAGMA page_size').execute()
    const pageCountResult = await db.schema.raw<any>('PRAGMA page_count').execute()
    const freePagesResult = await db.schema.raw<any>('PRAGMA freelist_count').execute()

    // Get compiled options
    const compiledOptionsResult = await db.schema
      .raw<any>('PRAGMA compile_options')
      .execute()

    const pageSize = pageSizeResult[0]?.page_size || 4096
    const pageCount = pageCountResult[0]?.page_count || 0
    const freePages = freePagesResult[0]?.freelist_count || 0

    // Calculate database size
    const sizeBytes = pageSize * pageCount
    const databaseSize = formatSize(sizeBytes)

    return {
      version: versionResult?.version || 'Unknown',
      compiledOptions: compiledOptionsResult.map((r: any) => r.compile_option),
      pageSize,
      pageCount,
      freePages,
      databaseSize
    }
  } catch (error: any) {
    throw new DatabaseError(`Failed to get SQLite info: ${error.message}`)
  }
}

/**
 * Get table info
 */
export async function getTableInfo(db: Kysely<any>, tableName: string): Promise<Array<{
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: any
  pk: number
}>> {
  try {
    const result = await db.schema
      .raw<any>(`PRAGMA table_info('${tableName}')`)
      .execute()

    return result
  } catch (error: any) {
    throw new DatabaseError(`Failed to get table info for ${tableName}: ${error.message}`)
  }
}

/**
 * Get index info
 */
export async function getIndexInfo(db: Kysely<any>, indexName: string): Promise<Array<{
  seqno: number
  cid: number
  name: string
}>> {
  try {
    const result = await db.schema
      .raw<any>(`PRAGMA index_info('${indexName}')`)
      .execute()

    return result
  } catch (error: any) {
    throw new DatabaseError(`Failed to get index info for ${indexName}: ${error.message}`)
  }
}

/**
 * Get foreign key info
 */
export async function getForeignKeys(db: Kysely<any>, tableName: string): Promise<Array<{
  id: number
  seq: number
  table: string
  from: string
  to: string
  on_update: string
  on_delete: string
  match: string
}>> {
  try {
    const result = await db.schema
      .raw<any>(`PRAGMA foreign_key_list('${tableName}')`)
      .execute()

    return result
  } catch (error: any) {
    throw new DatabaseError(`Failed to get foreign keys for ${tableName}: ${error.message}`)
  }
}

/**
 * Check integrity
 */
export async function checkIntegrity(db: Kysely<any>): Promise<boolean> {
  try {
    const result = await db.schema
      .raw<any>('PRAGMA integrity_check')
      .execute()

    return result.length === 1 && result[0].integrity_check === 'ok'
  } catch {
    return false
  }
}

/**
 * Check foreign key violations
 */
export async function checkForeignKeyViolations(db: Kysely<any>): Promise<Array<{
  table: string
  rowid: number
  parent: string
  fkid: number
}>> {
  try {
    const result = await db.schema
      .raw<any>('PRAGMA foreign_key_check')
      .execute()

    return result
  } catch {
    return []
  }
}

/**
 * Vacuum database
 */
export async function vacuum(db: Kysely<any>): Promise<void> {
  try {
    await db.schema.raw('VACUUM').execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to vacuum database: ${error.message}`)
  }
}

/**
 * Analyze database
 */
export async function analyze(db: Kysely<any>, tableName?: string): Promise<void> {
  try {
    if (tableName) {
      await db.schema.raw(`ANALYZE '${tableName}'`).execute()
    } else {
      await db.schema.raw('ANALYZE').execute()
    }
  } catch (error: any) {
    throw new DatabaseError(`Failed to analyze database: ${error.message}`)
  }
}

/**
 * Optimize database
 */
export async function optimize(db: Kysely<any>): Promise<void> {
  try {
    // Run various optimizations
    await db.schema.raw('PRAGMA optimize').execute()
    await vacuum(db)
    await analyze(db)
  } catch (error: any) {
    throw new DatabaseError(`Failed to optimize database: ${error.message}`)
  }
}

/**
 * Get database file size
 */
export async function getDatabaseFileSize(dbPath: string): Promise<string> {
  try {
    const stats = await stat(dbPath)
    return formatSize(stats.size)
  } catch {
    return 'Unknown'
  }
}

/**
 * Get table statistics
 */
export async function getTableStatistics(db: Kysely<any>, tableName: string): Promise<{
  rows: number
  columns: number
  indexes: number
  triggers: number
  primaryKey: string | null
}> {
  try {
    // Get row count
    const rowCountResult = await db
      .selectFrom(tableName as any)
      .select(db.raw<number>('COUNT(*)').as('count'))
      .executeTakeFirst()

    // Get table info
    const tableInfo = await getTableInfo(db, tableName)

    // Get indexes
    const indexesResult = await db
      .selectFrom('sqlite_master')
      .select('name')
      .where('type', '=', 'index')
      .where('tbl_name', '=', tableName)
      .execute()

    // Get triggers
    const triggersResult = await db
      .selectFrom('sqlite_master')
      .select('name')
      .where('type', '=', 'trigger')
      .where('tbl_name', '=', tableName)
      .execute()

    // Find primary key
    const primaryKeyColumn = tableInfo.find(col => col.pk === 1)

    return {
      rows: rowCountResult?.count || 0,
      columns: tableInfo.length,
      indexes: indexesResult.length,
      triggers: triggersResult.length,
      primaryKey: primaryKeyColumn?.name || null
    }
  } catch (error: any) {
    throw new DatabaseError(`Failed to get table statistics: ${error.message}`)
  }
}

/**
 * Enable WAL mode
 */
export async function enableWalMode(db: Kysely<any>): Promise<void> {
  try {
    await db.schema.raw('PRAGMA journal_mode=WAL').execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to enable WAL mode: ${error.message}`)
  }
}

/**
 * Create backup
 */
export async function createBackup(db: Kysely<any>, backupPath: string): Promise<void> {
  try {
    await db.schema.raw(`VACUUM INTO '${backupPath}'`).execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to create backup: ${error.message}`)
  }
}

/**
 * Get all tables
 */
export async function getAllTables(db: Kysely<any>): Promise<string[]> {
  try {
    const result = await db
      .selectFrom('sqlite_master')
      .select('name')
      .where('type', '=', 'table')
      .where('name', 'not like', 'sqlite_%')
      .execute()

    return result.map(r => r.name)
  } catch {
    return []
  }
}

/**
 * Get all indexes
 */
export async function getAllIndexes(db: Kysely<any>): Promise<Array<{
  name: string
  table: string
  unique: boolean
}>> {
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
      unique: r.sql?.includes('UNIQUE') || false
    }))
  } catch {
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