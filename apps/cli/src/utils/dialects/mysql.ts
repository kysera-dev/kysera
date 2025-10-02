import { Kysely } from 'kysely'
import { DatabaseError } from '../errors.js'

/**
 * MySQL specific utilities
 */

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
export async function getMysqlInfo(db: Kysely<any>): Promise<MysqlInfo> {
  try {
    const result = await db
      .selectNoFrom([
        db.raw<string>('VERSION()').as('version'),
        db.raw<string>('DATABASE()').as('currentDatabase'),
        db.raw<string>('CURRENT_USER()').as('currentUser'),
        db.raw<string>('@@character_set_database').as('characterSet'),
        db.raw<string>('@@collation_database').as('collation'),
        db.raw<string>('@@time_zone').as('timezone')
      ])
      .executeTakeFirst()

    if (!result) {
      throw new Error('Failed to get MySQL info')
    }

    return result as MysqlInfo
  } catch (error: any) {
    throw new DatabaseError(`Failed to get MySQL info: ${error.message}`)
  }
}

/**
 * Get table size
 */
export async function getTableSize(db: Kysely<any>, tableName: string, schema?: string): Promise<string> {
  try {
    const result = await db
      .selectFrom('information_schema.tables')
      .select(
        db.raw<number>('(data_length + index_length)').as('sizeBytes')
      )
      .where('table_name', '=', tableName)
      .$if(!!schema, qb => qb.where('table_schema', '=', schema!))
      .executeTakeFirst()

    if (!result?.sizeBytes) {
      return 'Unknown'
    }

    const sizeInMB = (result.sizeBytes / 1024 / 1024).toFixed(2)
    return `${sizeInMB} MB`
  } catch {
    return 'Unknown'
  }
}

/**
 * Get index size
 */
export async function getIndexSize(
  db: Kysely<any>,
  indexName: string,
  tableName: string,
  schema?: string
): Promise<string> {
  try {
    const result = await db
      .selectFrom('information_schema.statistics')
      .select(db.raw<number>('SUM(stat_value)').as('sizePages'))
      .where('index_name', '=', indexName)
      .where('table_name', '=', tableName)
      .$if(!!schema, qb => qb.where('table_schema', '=', schema!))
      .executeTakeFirst()

    if (!result?.sizePages) {
      return 'Unknown'
    }

    // Assuming default page size of 16KB
    const sizeInKB = (result.sizePages * 16).toFixed(2)
    return `${sizeInKB} KB`
  } catch {
    return 'Unknown'
  }
}

/**
 * Get active connections
 */
export async function getActiveConnections(db: Kysely<any>): Promise<number> {
  try {
    const result = await db
      .selectFrom('information_schema.processlist')
      .select(db.raw<number>('COUNT(*)').as('count'))
      .where('command', '!=', 'Sleep')
      .executeTakeFirst()

    return result?.count || 0
  } catch {
    return 0
  }
}

/**
 * Get slow queries
 */
export async function getSlowQueries(
  db: Kysely<any>,
  thresholdMs: number = 100
): Promise<Array<{ query: string; duration: number; state: string }>> {
  try {
    const result = await db
      .selectFrom('information_schema.processlist')
      .select([
        'info as query',
        'time as duration',
        'state'
      ])
      .where('command', '!=', 'Sleep')
      .where('time', '>', thresholdMs / 1000) // Convert to seconds
      .orderBy('time', 'desc')
      .limit(10)
      .execute()

    return result.map(r => ({
      query: r.query || '',
      duration: (r.duration || 0) * 1000, // Convert to milliseconds
      state: r.state || ''
    }))
  } catch {
    return []
  }
}

/**
 * Kill connection
 */
export async function killConnection(db: Kysely<any>, processId: number): Promise<boolean> {
  try {
    await db.schema.raw(`KILL ${processId}`).execute()
    return true
  } catch {
    return false
  }
}

/**
 * Optimize table
 */
export async function optimizeTable(db: Kysely<any>, tableName: string): Promise<void> {
  try {
    await db.schema.raw(`OPTIMIZE TABLE \`${tableName}\``).execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to optimize table ${tableName}: ${error.message}`)
  }
}

/**
 * Analyze table
 */
export async function analyzeTable(db: Kysely<any>, tableName: string): Promise<void> {
  try {
    await db.schema.raw(`ANALYZE TABLE \`${tableName}\``).execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to analyze table ${tableName}: ${error.message}`)
  }
}

/**
 * Check table
 */
export async function checkTable(db: Kysely<any>, tableName: string): Promise<boolean> {
  try {
    const result = await db.schema
      .raw<any>(`CHECK TABLE \`${tableName}\``)
      .execute()

    // Check if any row has Msg_text = 'OK'
    return result.some((row: any) => row.Msg_text === 'OK')
  } catch {
    return false
  }
}

/**
 * Repair table
 */
export async function repairTable(db: Kysely<any>, tableName: string): Promise<void> {
  try {
    await db.schema.raw(`REPAIR TABLE \`${tableName}\``).execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to repair table ${tableName}: ${error.message}`)
  }
}

/**
 * Check if database exists
 */
export async function databaseExists(db: Kysely<any>, databaseName: string): Promise<boolean> {
  try {
    const result = await db
      .selectFrom('information_schema.schemata')
      .select('schema_name')
      .where('schema_name', '=', databaseName)
      .executeTakeFirst()

    return !!result
  } catch {
    return false
  }
}

/**
 * Create database
 */
export async function createDatabase(
  db: Kysely<any>,
  databaseName: string,
  charset: string = 'utf8mb4',
  collation: string = 'utf8mb4_unicode_ci'
): Promise<void> {
  try {
    await db.schema
      .raw(`CREATE DATABASE \`${databaseName}\` CHARACTER SET ${charset} COLLATE ${collation}`)
      .execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to create database ${databaseName}: ${error.message}`)
  }
}

/**
 * Drop database
 */
export async function dropDatabase(db: Kysely<any>, databaseName: string): Promise<void> {
  try {
    await db.schema.raw(`DROP DATABASE IF EXISTS \`${databaseName}\``).execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to drop database ${databaseName}: ${error.message}`)
  }
}

/**
 * Get table statistics
 */
export async function getTableStatistics(
  db: Kysely<any>,
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
      .$if(!!schema, qb => qb.where('table_schema', '=', schema!))
      .executeTakeFirst()

    if (!result) {
      throw new Error('Table not found')
    }

    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
      return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    }

    return {
      rows: result.rows || 0,
      dataSize: formatSize(result.dataLength || 0),
      indexSize: formatSize(result.indexLength || 0),
      totalSize: formatSize((result.dataLength || 0) + (result.indexLength || 0)),
      avgRowLength: result.avgRowLength || 0,
      autoIncrement: result.autoIncrement
    }
  } catch (error: any) {
    throw new DatabaseError(`Failed to get table statistics: ${error.message}`)
  }
}