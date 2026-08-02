import { Kysely, sql } from 'kysely'
import { CLIDatabaseError, ValidationError } from '../errors.js'
import { logger } from '../logger.js'
import {
  validateIdentifier,
  safeOptimizeTable,
  safeCheckTable,
  safeRepairTable,
  escapeTypedIdentifier
} from '../sql-sanitizer.js'

/**
 * MySQL specific utilities
 */

/**
 * System tables these helpers query. Nullable columns reflect what the
 * mysql2 driver actually returns for information_schema rows.
 */
interface MysqlSystemTables {
  'information_schema.tables': {
    table_name: string
    table_schema: string
    table_rows: number | null
    data_length: number | null
    index_length: number | null
    avg_row_length: number | null
    auto_increment: number | null
  }
  'information_schema.statistics': {
    index_name: string
    table_name: string
    table_schema: string
    stat_value: number | null
  }
  'information_schema.processlist': {
    command: string
    time: number | null
    state: string | null
    info: string | null
  }
  'information_schema.schemata': {
    schema_name: string
  }
}

type MysqlDb = Kysely<MysqlSystemTables>

export interface MysqlInfo {
  version: string
  currentDatabase: string
  currentUser: string
  characterSet: string
  collation: string
  timezone: string
}

/**
 * Get MySQL server info
 */
export async function getMysqlInfo(db: MysqlDb): Promise<MysqlInfo> {
  try {
    const result = await db
      .selectNoFrom([
        sql<string>`VERSION()`.as('version'),
        sql<string>`DATABASE()`.as('currentDatabase'),
        sql<string>`CURRENT_USER()`.as('currentUser'),
        sql<string>`@@character_set_database`.as('characterSet'),
        sql<string>`@@collation_database`.as('collation'),
        sql<string>`@@time_zone`.as('timezone')
      ])
      .executeTakeFirst()

    if (!result) {
      throw new CLIDatabaseError('Failed to get MySQL info')
    }

    return result
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to get MySQL info: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Get table size
 */
export async function getTableSize(
  db: MysqlDb,
  tableName: string,
  schema?: string
): Promise<string> {
  try {
    const result = await db
      .selectFrom('information_schema.tables')
      .select(sql<number>`(data_length + index_length)`.as('sizeBytes'))
      .where('table_name', '=', tableName)
      .$if(!!schema, qb => qb.where('table_schema', '=', schema ?? ''))
      .executeTakeFirst()

    if (!result?.sizeBytes) {
      return 'Unknown'
    }

    const sizeInMB = (result.sizeBytes / 1024 / 1024).toFixed(2)
    return `${sizeInMB} MB`
  } catch (error) {
    logger.debug(`Failed to get table size for ${tableName}:`, error)
    return 'Unknown'
  }
}

/**
 * Get index size
 */
export async function getIndexSize(
  db: MysqlDb,
  indexName: string,
  tableName: string,
  schema?: string
): Promise<string> {
  try {
    const result = await db
      .selectFrom('information_schema.statistics')
      .select(sql<number>`SUM(stat_value)`.as('sizePages'))
      .where('index_name', '=', indexName)
      .where('table_name', '=', tableName)
      .$if(!!schema, qb => qb.where('table_schema', '=', schema ?? ''))
      .executeTakeFirst()

    if (!result?.sizePages) {
      return 'Unknown'
    }

    const sizeInKB = (result.sizePages * 16).toFixed(2)
    return `${sizeInKB} KB`
  } catch (error) {
    logger.debug(`Failed to get index size for ${indexName}:`, error)
    return 'Unknown'
  }
}

/**
 * Get active connections
 */
export async function getActiveConnections(db: MysqlDb): Promise<number> {
  try {
    const result = await db
      .selectFrom('information_schema.processlist')
      .select(sql<number>`COUNT(*)`.as('count'))
      .where('command', '!=', 'Sleep')
      .executeTakeFirst()

    return result?.count ?? 0
  } catch (error) {
    logger.debug('Failed to get active connections:', error)
    return 0
  }
}

/**
 * Get slow queries
 */
export async function getSlowQueries(
  db: MysqlDb,
  thresholdMs = 100
): Promise<{ query: string; duration: number; state: string }[]> {
  try {
    const result = await db
      .selectFrom('information_schema.processlist')
      .select(['info as query', 'time as duration', 'state'])
      .where('command', '!=', 'Sleep')
      .where('time', '>', thresholdMs / 1000)
      .orderBy('time', 'desc')
      .limit(10)
      .execute()

    return result.map(r => ({
      query: r.query ?? '',
      duration: (r.duration ?? 0) * 1000,
      state: r.state ?? ''
    }))
  } catch (error) {
    logger.debug('Failed to get slow queries:', error)
    return []
  }
}

/**
 * Kill connection
 */
export async function killConnection(db: MysqlDb, processId: number): Promise<boolean> {
  try {
    // Process ID is a number, so it's safe to interpolate
    if (!Number.isInteger(processId) || processId < 0) {
      throw new ValidationError('Invalid process ID')
    }
    await sql.raw(`KILL ${processId}`).execute(db)
    return true
  } catch (error) {
    logger.debug(`Failed to kill connection ${processId}:`, error)
    return false
  }
}

/**
 * Optimize table
 */
export async function optimizeTable(db: MysqlDb, tableName: string): Promise<void> {
  try {
    // Use safe SQL builder
    await sql.raw(safeOptimizeTable(tableName)).execute(db)
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to optimize table ${tableName}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Analyze table
 */
export async function analyzeTable(db: MysqlDb, tableName: string): Promise<void> {
  try {
    // Validate and escape table name
    const escapedTable = escapeTypedIdentifier(tableName, 'table', 'mysql')
    await sql.raw(`ANALYZE TABLE ${escapedTable}`).execute(db)
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to analyze table ${tableName}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Check table
 */
export async function checkTable(db: MysqlDb, tableName: string): Promise<boolean> {
  try {
    // Use safe SQL builder
    const result = await sql.raw<{ Msg_text: string }>(safeCheckTable(tableName)).execute(db)

    return result.rows.some(row => row.Msg_text === 'OK')
  } catch (error) {
    logger.debug(`Failed to check table ${tableName}:`, error)
    return false
  }
}

/**
 * Repair table
 */
export async function repairTable(db: MysqlDb, tableName: string): Promise<void> {
  try {
    // Use safe SQL builder
    await sql.raw(safeRepairTable(tableName)).execute(db)
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to repair table ${tableName}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Check if database exists
 */
export async function databaseExists(db: MysqlDb, databaseName: string): Promise<boolean> {
  try {
    const result = await db
      .selectFrom('information_schema.schemata')
      .select('schema_name')
      .where('schema_name', '=', databaseName)
      .executeTakeFirst()

    return !!result
  } catch (error) {
    logger.debug(`Failed to check if database exists: ${databaseName}`, error)
    return false
  }
}

/**
 * Create database
 */
export async function createDatabase(
  db: MysqlDb,
  databaseName: string,
  charset = 'utf8mb4',
  collation = 'utf8mb4_unicode_ci'
): Promise<void> {
  try {
    // Validate database name and charset/collation
    validateIdentifier(databaseName, 'database')
    // Charset and collation should also be validated
    if (!/^[a-zA-Z0-9_]+$/.test(charset) || !/^[a-zA-Z0-9_]+$/.test(collation)) {
      throw new ValidationError('Invalid charset or collation')
    }
    const escapedDb = escapeTypedIdentifier(databaseName, 'database', 'mysql')
    await sql
      .raw(`CREATE DATABASE ${escapedDb} CHARACTER SET ${charset} COLLATE ${collation}`)
      .execute(db)
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to create database ${databaseName}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Drop database
 */
export async function dropDatabase(db: MysqlDb, databaseName: string): Promise<void> {
  try {
    // Validate and escape database name
    const escapedDb = escapeTypedIdentifier(databaseName, 'database', 'mysql')
    await sql.raw(`DROP DATABASE IF EXISTS ${escapedDb}`).execute(db)
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to drop database ${databaseName}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Get table statistics
 */
export async function getTableStatistics(
  db: MysqlDb,
  tableName: string,
  schema?: string
): Promise<{
  rows: number
  dataSize: string
  indexSize: string
  totalSize: string
  avgRowLength: number
  autoIncrement: number | null
}> {
  try {
    const result = await db
      .selectFrom('information_schema.tables')
      .select([
        'table_rows as rows',
        'data_length as dataLength',
        'index_length as indexLength',
        'avg_row_length as avgRowLength',
        'auto_increment as autoIncrement'
      ])
      .where('table_name', '=', tableName)
      .$if(!!schema, qb => qb.where('table_schema', '=', schema ?? ''))
      .executeTakeFirst()

    if (!result) {
      throw new CLIDatabaseError('Table not found')
    }

    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
      return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    }

    return {
      rows: result.rows ?? 0,
      dataSize: formatSize(result.dataLength ?? 0),
      indexSize: formatSize(result.indexLength ?? 0),
      totalSize: formatSize((result.dataLength ?? 0) + (result.indexLength ?? 0)),
      avgRowLength: result.avgRowLength ?? 0,
      autoIncrement: result.autoIncrement
    }
  } catch (error) {
    throw new CLIDatabaseError(
      `Failed to get table statistics: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
