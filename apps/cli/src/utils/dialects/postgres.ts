import { Kysely, sql } from 'kysely';
import { CLIDatabaseError } from '../errors.js';
import { logger } from '../logger.js';
import {
  validateIdentifier,
  escapeTypedIdentifier,
  safeVacuumAnalyze,
  safeCreateExtension,
} from '../sql-sanitizer.js';

/**
 * PostgreSQL specific utilities
 */

export interface PostgresInfo {
  version: string;
  currentDatabase: string;
  currentUser: string;
  serverEncoding: string;
  clientEncoding: string;
  timezone: string;
}

/**
 * Get PostgreSQL server info
 */
export async function getPostgresInfo(db: Kysely<any>): Promise<PostgresInfo> {
  try {
    const result = await db
      .selectNoFrom([
        sql<string>`version()`.as('version'),
        sql<string>`current_database()`.as('currentDatabase'),
        sql<string>`current_user`.as('currentUser'),
        sql<string>`current_setting('server_encoding')`.as('serverEncoding'),
        sql<string>`current_setting('client_encoding')`.as('clientEncoding'),
        sql<string>`current_setting('timezone')`.as('timezone'),
      ])
      .executeTakeFirst();

    if (!result) {
      throw new Error('Failed to get PostgreSQL info');
    }

    return result as PostgresInfo;
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to get PostgreSQL info: ${error.message}`);
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
      .executeTakeFirst();

    return !!result;
  } catch (error) {
    logger.debug(`Failed to check extension ${extensionName}:`, error);
    return false;
  }
}

/**
 * Create extension if not exists
 */
export async function createExtension(db: Kysely<any>, extensionName: string): Promise<void> {
  try {
    // Use safe extension creation
    await sql.raw(safeCreateExtension(extensionName)).execute(db);
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to create extension ${extensionName}: ${error.message}`);
  }
}

/**
 * Get table size
 */
export async function getTableSize(db: Kysely<any>, tableName: string): Promise<string> {
  try {
    // Validate table name before using in query
    const validName = validateIdentifier(tableName, 'table');
    const result = await db
      .selectNoFrom(sql<string>`pg_size_pretty(pg_total_relation_size(${validName}))`.as('size'))
      .executeTakeFirst();

    return result?.size || 'Unknown';
  } catch (error) {
    logger.debug(`Failed to get table size for ${tableName}:`, error);
    return 'Unknown';
  }
}

/**
 * Get index size
 */
export async function getIndexSize(db: Kysely<any>, indexName: string): Promise<string> {
  try {
    // Validate index name before using in query
    const validName = validateIdentifier(indexName, 'index');
    const result = await db
      .selectNoFrom(sql<string>`pg_size_pretty(pg_relation_size(${validName}))`.as('size'))
      .executeTakeFirst();

    return result?.size || 'Unknown';
  } catch (error) {
    logger.debug(`Failed to get index size for ${indexName}:`, error);
    return 'Unknown';
  }
}

/**
 * Get active connections
 */
export async function getActiveConnections(db: Kysely<any>): Promise<number> {
  try {
    const result = await db
      .selectFrom('pg_stat_activity')
      .select(sql<number>`COUNT(*)`.as('count'))
      .where('state', '=', 'active')
      .executeTakeFirst();

    return result?.count || 0;
  } catch (error) {
    logger.debug('Failed to get active connections:', error);
    return 0;
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
      .select(['query', sql<number>`EXTRACT(EPOCH FROM (now() - query_start)) * 1000`.as('duration'), 'state'])
      .where('state', '!=', 'idle')
      .where(sql`now() - query_start`, '>', sql`interval '${sql.lit(`${thresholdMs} milliseconds`)}'`)
      .orderBy('duration', 'desc')
      .limit(10)
      .execute();

    return result as any;
  } catch (error) {
    logger.debug('Failed to get slow queries:', error);
    return [];
  }
}

/**
 * Kill connection
 */
export async function killConnection(db: Kysely<any>, pid: number): Promise<boolean> {
  try {
    // PID is a number, safe to use directly
    if (!Number.isInteger(pid) || pid < 0) {
      throw new Error('Invalid PID');
    }
    const result = await db
      .selectNoFrom(sql<boolean>`pg_terminate_backend(${pid})`.as('terminated'))
      .executeTakeFirst();

    return result?.terminated || false;
  } catch (error) {
    logger.debug(`Failed to kill connection ${pid}:`, error);
    return false;
  }
}

/**
 * Vacuum table
 */
export async function vacuumTable(db: Kysely<any>, tableName: string): Promise<void> {
  try {
    // Use safe VACUUM ANALYZE statement
    await sql.raw(safeVacuumAnalyze(tableName)).execute(db);
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to vacuum table ${tableName}: ${error.message}`);
  }
}

/**
 * Analyze table
 */
export async function analyzeTable(db: Kysely<any>, tableName: string): Promise<void> {
  try {
    // Validate and escape table name
    const escapedTable = escapeTypedIdentifier(tableName, 'table', 'postgres');
    await sql.raw(`ANALYZE ${escapedTable}`).execute(db);
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to analyze table ${tableName}: ${error.message}`);
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
      .executeTakeFirst();

    return !!result;
  } catch (error) {
    logger.debug(`Failed to check if database exists: ${databaseName}`, error);
    return false;
  }
}

/**
 * Create database
 */
export async function createDatabase(db: Kysely<any>, databaseName: string): Promise<void> {
  try {
    // Validate and escape database name
    const escapedDb = escapeTypedIdentifier(databaseName, 'database', 'postgres');
    await sql.raw(`CREATE DATABASE ${escapedDb}`).execute(db);
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to create database ${databaseName}: ${error.message}`);
  }
}

/**
 * Drop database
 */
export async function dropDatabase(db: Kysely<any>, databaseName: string): Promise<void> {
  try {
    // Validate database name
    const validDbName = validateIdentifier(databaseName, 'database');

    // Terminate connections - use parameterized sql template tag for safety
    await sql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${validDbName} AND pid <> pg_backend_pid()
    `.execute(db);

    // Drop the database using escaped identifier
    const escapedDb = escapeTypedIdentifier(databaseName, 'database', 'postgres');
    await sql.raw(`DROP DATABASE IF EXISTS ${escapedDb}`).execute(db);
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to drop database ${databaseName}: ${error.message}`);
  }
}
