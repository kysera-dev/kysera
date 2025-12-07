import { Kysely, sql } from 'kysely';
import { CLIDatabaseError } from '../errors.js';
import { logger } from '../logger.js';
import {
  validateIdentifier,
  escapeIdentifier,
  safeOptimizeTable,
  safeCheckTable,
  safeRepairTable,
  escapeTypedIdentifier,
} from '../sql-sanitizer.js';

/**
 * MySQL specific utilities
 */

export interface MysqlInfo {
  version: string;
  currentDatabase: string;
  currentUser: string;
  characterSet: string;
  collation: string;
  timezone: string;
}

/**
 * Get MySQL server info
 */
export async function getMysqlInfo(db: Kysely<any>): Promise<MysqlInfo> {
  try {
    const result = await db
      .selectNoFrom([
        sql<string>`VERSION()`.as('version'),
        sql<string>`DATABASE()`.as('currentDatabase'),
        sql<string>`CURRENT_USER()`.as('currentUser'),
        sql<string>`@@character_set_database`.as('characterSet'),
        sql<string>`@@collation_database`.as('collation'),
        sql<string>`@@time_zone`.as('timezone'),
      ])
      .executeTakeFirst();

    if (!result) {
      throw new Error('Failed to get MySQL info');
    }

    return result as MysqlInfo;
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to get MySQL info: ${error.message}`);
  }
}

/**
 * Get table size
 */
export async function getTableSize(db: Kysely<any>, tableName: string, schema?: string): Promise<string> {
  try {
    const result = await db
      .selectFrom('information_schema.tables')
      .select(sql<number>`(data_length + index_length)`.as('sizeBytes'))
      .where('table_name', '=', tableName)
      .$if(!!schema, (qb) => qb.where('table_schema', '=', schema!))
      .executeTakeFirst();

    if (!result?.sizeBytes) {
      return 'Unknown';
    }

    const sizeInMB = (result.sizeBytes / 1024 / 1024).toFixed(2);
    return `${sizeInMB} MB`;
  } catch (error) {
    logger.debug(`Failed to get table size for ${tableName}:`, error);
    return 'Unknown';
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
      .select(sql<number>`SUM(stat_value)`.as('sizePages'))
      .where('index_name', '=', indexName)
      .where('table_name', '=', tableName)
      .$if(!!schema, (qb) => qb.where('table_schema', '=', schema!))
      .executeTakeFirst();

    if (!result?.sizePages) {
      return 'Unknown';
    }

    const sizeInKB = (result.sizePages * 16).toFixed(2);
    return `${sizeInKB} KB`;
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
      .selectFrom('information_schema.processlist')
      .select(sql<number>`COUNT(*)`.as('count'))
      .where('command', '!=', 'Sleep')
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
      .selectFrom('information_schema.processlist')
      .select(['info as query', 'time as duration', 'state'])
      .where('command', '!=', 'Sleep')
      .where('time', '>', thresholdMs / 1000)
      .orderBy('time', 'desc')
      .limit(10)
      .execute();

    return result.map((r) => ({
      query: r.query || '',
      duration: (r.duration || 0) * 1000,
      state: r.state || '',
    }));
  } catch (error) {
    logger.debug('Failed to get slow queries:', error);
    return [];
  }
}

/**
 * Kill connection
 */
export async function killConnection(db: Kysely<any>, processId: number): Promise<boolean> {
  try {
    // Process ID is a number, so it's safe to interpolate
    if (!Number.isInteger(processId) || processId < 0) {
      throw new Error('Invalid process ID');
    }
    await sql.raw(`KILL ${processId}`).execute(db);
    return true;
  } catch (error) {
    logger.debug(`Failed to kill connection ${processId}:`, error);
    return false;
  }
}

/**
 * Optimize table
 */
export async function optimizeTable(db: Kysely<any>, tableName: string): Promise<void> {
  try {
    // Use safe SQL builder
    await sql.raw(safeOptimizeTable(tableName)).execute(db);
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to optimize table ${tableName}: ${error.message}`);
  }
}

/**
 * Analyze table
 */
export async function analyzeTable(db: Kysely<any>, tableName: string): Promise<void> {
  try {
    // Validate and escape table name
    const escapedTable = escapeTypedIdentifier(tableName, 'table', 'mysql');
    await sql.raw(`ANALYZE TABLE ${escapedTable}`).execute(db);
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to analyze table ${tableName}: ${error.message}`);
  }
}

/**
 * Check table
 */
export async function checkTable(db: Kysely<any>, tableName: string): Promise<boolean> {
  try {
    // Use safe SQL builder
    const result = await sql.raw<any>(safeCheckTable(tableName)).execute(db);

    return result.rows.some((row: any) => row.Msg_text === 'OK');
  } catch (error) {
    logger.debug(`Failed to check table ${tableName}:`, error);
    return false;
  }
}

/**
 * Repair table
 */
export async function repairTable(db: Kysely<any>, tableName: string): Promise<void> {
  try {
    // Use safe SQL builder
    await sql.raw(safeRepairTable(tableName)).execute(db);
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to repair table ${tableName}: ${error.message}`);
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
export async function createDatabase(
  db: Kysely<any>,
  databaseName: string,
  charset: string = 'utf8mb4',
  collation: string = 'utf8mb4_unicode_ci'
): Promise<void> {
  try {
    // Validate database name and charset/collation
    validateIdentifier(databaseName, 'database');
    // Charset and collation should also be validated
    if (!/^[a-zA-Z0-9_]+$/.test(charset) || !/^[a-zA-Z0-9_]+$/.test(collation)) {
      throw new Error('Invalid charset or collation');
    }
    const escapedDb = escapeTypedIdentifier(databaseName, 'database', 'mysql');
    await sql.raw(`CREATE DATABASE ${escapedDb} CHARACTER SET ${charset} COLLATE ${collation}`).execute(db);
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to create database ${databaseName}: ${error.message}`);
  }
}

/**
 * Drop database
 */
export async function dropDatabase(db: Kysely<any>, databaseName: string): Promise<void> {
  try {
    // Validate and escape database name
    const escapedDb = escapeTypedIdentifier(databaseName, 'database', 'mysql');
    await sql.raw(`DROP DATABASE IF EXISTS ${escapedDb}`).execute(db);
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to drop database ${databaseName}: ${error.message}`);
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
  rows: number;
  dataSize: string;
  indexSize: string;
  totalSize: string;
  avgRowLength: number;
  autoIncrement: number | null;
}> {
  try {
    const result = await db
      .selectFrom('information_schema.tables')
      .select([
        'table_rows as rows',
        'data_length as dataLength',
        'index_length as indexLength',
        'avg_row_length as avgRowLength',
        'auto_increment as autoIncrement',
      ])
      .where('table_name', '=', tableName)
      .$if(!!schema, (qb) => qb.where('table_schema', '=', schema!))
      .executeTakeFirst();

    if (!result) {
      throw new Error('Table not found');
    }

    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    };

    return {
      rows: result.rows || 0,
      dataSize: formatSize(result.dataLength || 0),
      indexSize: formatSize(result.indexLength || 0),
      totalSize: formatSize((result.dataLength || 0) + (result.indexLength || 0)),
      avgRowLength: result.avgRowLength || 0,
      autoIncrement: result.autoIncrement,
    };
  } catch (error: any) {
    throw new CLIDatabaseError(`Failed to get table statistics: ${error.message}`);
  }
}
