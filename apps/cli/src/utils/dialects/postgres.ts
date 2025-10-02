import { Kysely } from 'kysely'
import { DatabaseError } from '../errors.js'

/**
 * PostgreSQL specific utilities
 */

export interface PostgresInfo {
  version: string
  currentDatabase: string
  currentUser: string
  serverEncoding: string
  clientEncoding: string
  timezone: string
}

/**
 * Get PostgreSQL server info
 */
export async function getPostgresInfo(db: Kysely<any>): Promise<PostgresInfo> {
  try {
    const result = await db
      .selectNoFrom([
        db.raw<string>('version()').as('version'),
        db.raw<string>('current_database()').as('currentDatabase'),
        db.raw<string>('current_user').as('currentUser'),
        db.raw<string>('current_setting(\'server_encoding\')').as('serverEncoding'),
        db.raw<string>('current_setting(\'client_encoding\')').as('clientEncoding'),
        db.raw<string>('current_setting(\'timezone\')').as('timezone')
      ])
      .executeTakeFirst()

    if (!result) {
      throw new Error('Failed to get PostgreSQL info')
    }

    return result as PostgresInfo
  } catch (error: any) {
    throw new DatabaseError(`Failed to get PostgreSQL info: ${error.message}`)
  }
}

/**
 * Check if extension is available
 */
export async function checkExtension(db: Kysely<any>, extensionName: string): Promise<boolean> {
  try {
    const result = await db
      .selectFrom('pg_extension')
      .select('extname')
      .where('extname', '=', extensionName)
      .executeTakeFirst()

    return !!result
  } catch {
    return false
  }
}

/**
 * Create extension if not exists
 */
export async function createExtension(db: Kysely<any>, extensionName: string): Promise<void> {
  try {
    await db.schema
      .raw(`CREATE EXTENSION IF NOT EXISTS "${extensionName}"`)
      .execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to create extension ${extensionName}: ${error.message}`)
  }
}

/**
 * Get table size
 */
export async function getTableSize(db: Kysely<any>, tableName: string): Promise<string> {
  try {
    const result = await db
      .selectNoFrom(
        db.raw<string>(`pg_size_pretty(pg_total_relation_size('${tableName}'))`).as('size')
      )
      .executeTakeFirst()

    return result?.size || 'Unknown'
  } catch {
    return 'Unknown'
  }
}

/**
 * Get index size
 */
export async function getIndexSize(db: Kysely<any>, indexName: string): Promise<string> {
  try {
    const result = await db
      .selectNoFrom(
        db.raw<string>(`pg_size_pretty(pg_relation_size('${indexName}'))`).as('size')
      )
      .executeTakeFirst()

    return result?.size || 'Unknown'
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
      .selectFrom('pg_stat_activity')
      .select(db.raw<number>('COUNT(*)').as('count'))
      .where('state', '=', 'active')
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
      .selectFrom('pg_stat_activity')
      .select([
        'query',
        db.raw<number>('EXTRACT(EPOCH FROM (now() - query_start)) * 1000').as('duration'),
        'state'
      ])
      .where('state', '!=', 'idle')
      .where(db.raw('now() - query_start'), '>', db.raw(`interval '${thresholdMs} milliseconds'`))
      .orderBy('duration', 'desc')
      .limit(10)
      .execute()

    return result as any
  } catch {
    return []
  }
}

/**
 * Kill connection
 */
export async function killConnection(db: Kysely<any>, pid: number): Promise<boolean> {
  try {
    const result = await db
      .selectNoFrom(
        db.raw<boolean>(`pg_terminate_backend(${pid})`).as('terminated')
      )
      .executeTakeFirst()

    return result?.terminated || false
  } catch {
    return false
  }
}

/**
 * Vacuum table
 */
export async function vacuumTable(db: Kysely<any>, tableName: string): Promise<void> {
  try {
    await db.schema.raw(`VACUUM ANALYZE "${tableName}"`).execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to vacuum table ${tableName}: ${error.message}`)
  }
}

/**
 * Analyze table
 */
export async function analyzeTable(db: Kysely<any>, tableName: string): Promise<void> {
  try {
    await db.schema.raw(`ANALYZE "${tableName}"`).execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to analyze table ${tableName}: ${error.message}`)
  }
}

/**
 * Check if database exists
 */
export async function databaseExists(db: Kysely<any>, databaseName: string): Promise<boolean> {
  try {
    const result = await db
      .selectFrom('pg_database')
      .select('datname')
      .where('datname', '=', databaseName)
      .executeTakeFirst()

    return !!result
  } catch {
    return false
  }
}

/**
 * Create database
 */
export async function createDatabase(db: Kysely<any>, databaseName: string): Promise<void> {
  try {
    await db.schema.raw(`CREATE DATABASE "${databaseName}"`).execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to create database ${databaseName}: ${error.message}`)
  }
}

/**
 * Drop database
 */
export async function dropDatabase(db: Kysely<any>, databaseName: string): Promise<void> {
  try {
    // Terminate connections to the database
    await db.schema
      .raw(`
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = '${databaseName}'
          AND pid <> pg_backend_pid()
      `)
      .execute()

    // Drop the database
    await db.schema.raw(`DROP DATABASE IF EXISTS "${databaseName}"`).execute()
  } catch (error: any) {
    throw new DatabaseError(`Failed to drop database ${databaseName}: ${error.message}`)
  }
}