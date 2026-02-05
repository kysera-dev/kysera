/**
 * Microsoft SQL Server Dialect Adapter
 *
 * Supports SQL Server 2017+, Azure SQL Database, and Azure SQL Edge
 * with full schema support (default: 'dbo')
 */

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { silentLogger, type KyseraLogger } from '@kysera/core'
import type { DialectAdapter, DialectAdapterOptions, SchemaOptions } from '../types.js'
import { assertValidIdentifier, resolveSchema as resolveSchemaUtil, errorMatchers } from '../helpers.js'

/**
 * MSSQL-specific adapter options
 */
export interface MSSQLAdapterOptions extends DialectAdapterOptions {
  /** Logger instance for error reporting */
  logger?: KyseraLogger
}

export class MSSQLAdapter implements DialectAdapter {
  readonly dialect = 'mssql' as const
  readonly defaultSchema: string
  private logger: KyseraLogger

  constructor(options: MSSQLAdapterOptions = {}) {
    // MSSQL uses 'dbo' as the default schema
    this.defaultSchema = options.defaultSchema ?? 'dbo'
    this.logger = options.logger ?? silentLogger
  }

  getDefaultPort(): number {
    return 1433
  }

  getCurrentTimestamp(): string {
    return 'GETDATE()'
  }

  escapeIdentifier(identifier: string): string {
    // MSSQL uses square brackets for escaping
    return '[' + identifier.replace(/\]/g, ']]') + ']'
  }

  formatDate(date: Date): string {
    // MSSQL datetime format: YYYY-MM-DD HH:MM:SS.mmm
    return date.toISOString().replace('T', ' ').replace('Z', '')
  }

  isUniqueConstraintError(error: unknown): boolean {
    return errorMatchers.mssql.uniqueConstraint(error)
  }

  isForeignKeyError(error: unknown): boolean {
    return errorMatchers.mssql.foreignKey(error)
  }

  isNotNullError(error: unknown): boolean {
    return errorMatchers.mssql.notNull(error)
  }

  /**
   * Resolve the schema to use for an operation.
   * Uses the shared resolveSchema utility from helpers.ts.
   */
  private resolveSchema(options?: SchemaOptions): string {
    return resolveSchemaUtil(this.defaultSchema, options)
  }

  async tableExists(
    db: Kysely<any>,
    tableName: string,
    options?: SchemaOptions
  ): Promise<boolean> {
    assertValidIdentifier(tableName, 'table name')
    const schema = this.resolveSchema(options)

    try {
      const result = await db
        .selectFrom('INFORMATION_SCHEMA.TABLES')
        .select('TABLE_NAME')
        .where('TABLE_NAME', '=', tableName)
        .where('TABLE_SCHEMA', '=', schema)
        .where('TABLE_TYPE', '=', 'BASE TABLE')
        .executeTakeFirst()
      return !!result
    } catch {
      return false
    }
  }

  async getTableColumns(
    db: Kysely<any>,
    tableName: string,
    options?: SchemaOptions
  ): Promise<string[]> {
    assertValidIdentifier(tableName, 'table name')
    const schema = this.resolveSchema(options)

    try {
      const results = await db
        .selectFrom('INFORMATION_SCHEMA.COLUMNS')
        .select('COLUMN_NAME')
        .where('TABLE_NAME', '=', tableName)
        .where('TABLE_SCHEMA', '=', schema)
        .execute()
      return results.map(r => (r as { COLUMN_NAME: string }).COLUMN_NAME)
    } catch {
      return []
    }
  }

  async getTables(db: Kysely<any>, options?: SchemaOptions): Promise<string[]> {
    const schema = this.resolveSchema(options)

    try {
      const results = await db
        .selectFrom('INFORMATION_SCHEMA.TABLES')
        .select('TABLE_NAME')
        .where('TABLE_TYPE', '=', 'BASE TABLE')
        .where('TABLE_SCHEMA', '=', schema)
        .execute()
      return results.map(r => (r as { TABLE_NAME: string }).TABLE_NAME)
    } catch {
      return []
    }
  }

  async getDatabaseSize(db: Kysely<any>, _databaseName?: string): Promise<number> {
    try {
      // MSSQL: Get database size using sys.database_files
      // Note: _databaseName is ignored as MSSQL uses the current database context
      const result = await sql<{ size: number }>`
        SELECT SUM(size * 8 * 1024) as size
        FROM sys.database_files
        WHERE type = 0
      `.execute(db)
      return (result.rows?.[0] as { size?: number })?.size || 0
    } catch {
      return 0
    }
  }

  async truncateTable(
    db: Kysely<any>,
    tableName: string,
    options?: SchemaOptions
  ): Promise<boolean> {
    assertValidIdentifier(tableName, 'table name')
    const schema = this.resolveSchema(options)

    try {
      const qualifiedTable = `${this.escapeIdentifier(schema)}.${this.escapeIdentifier(tableName)}`

      // MSSQL: First try TRUNCATE, fall back to DELETE if FK constraints exist
      try {
        await sql.raw(`TRUNCATE TABLE ${qualifiedTable}`).execute(db)
      } catch (truncateError) {
        // If truncate fails due to FK, use DELETE
        const errorMsg = String(truncateError)
        if (errorMsg.includes('FOREIGN KEY') || errorMsg.includes('Cannot truncate')) {
          await sql.raw(`DELETE FROM ${qualifiedTable}`).execute(db)
          // Reset identity if table has one
          try {
            await sql.raw(`DBCC CHECKIDENT (${qualifiedTable}, RESEED, 0)`).execute(db)
          } catch {
            // Ignore if table doesn't have identity column
          }
        } else {
          throw truncateError
        }
      }
      return true
    } catch (error) {
      const errorMessage = String(error)
      if (
        errorMessage.includes('Invalid object name') ||
        errorMessage.includes('does not exist')
      ) {
        return false
      }
      // Log and rethrow with context
      this.logger.error(`Failed to truncate MSSQL table "${schema}.${tableName}":`, error)
      throw new Error(`Failed to truncate MSSQL table "${schema}.${tableName}": ${String(error)}`)
    }
  }

  async truncateAllTables(
    db: Kysely<any>,
    exclude: string[] = [],
    options?: SchemaOptions
  ): Promise<void> {
    const tables = await this.getTables(db, options)
    const schema = this.resolveSchema(options)

    // MSSQL: Disable all FK constraints first
    for (const table of tables) {
      if (!exclude.includes(table)) {
        try {
          const qualifiedTable = `${this.escapeIdentifier(schema)}.${this.escapeIdentifier(table)}`
          await sql.raw(`ALTER TABLE ${qualifiedTable} NOCHECK CONSTRAINT ALL`).execute(db)
        } catch {
          // Ignore errors for tables without constraints
        }
      }
    }

    // Truncate all tables
    for (const table of tables) {
      if (!exclude.includes(table)) {
        await this.truncateTable(db, table, options)
      }
    }

    // Re-enable all FK constraints
    for (const table of tables) {
      if (!exclude.includes(table)) {
        try {
          const qualifiedTable = `${this.escapeIdentifier(schema)}.${this.escapeIdentifier(table)}`
          await sql.raw(`ALTER TABLE ${qualifiedTable} CHECK CONSTRAINT ALL`).execute(db)
        } catch {
          // Ignore errors
        }
      }
    }
  }

  /**
   * Check if a schema exists in the database
   *
   * @param db - Kysely database instance
   * @param schemaName - Name of the schema to check
   * @returns true if schema exists, false otherwise
   */
  async schemaExists(db: Kysely<any>, schemaName: string): Promise<boolean> {
    assertValidIdentifier(schemaName, 'schema name')

    try {
      const result = await db
        .selectFrom('INFORMATION_SCHEMA.SCHEMATA')
        .select('SCHEMA_NAME')
        .where('SCHEMA_NAME', '=', schemaName)
        .executeTakeFirst()
      return !!result
    } catch {
      return false
    }
  }

  /**
   * Get all schemas in the database (excluding system schemas)
   *
   * @param db - Kysely database instance
   * @returns Array of schema names
   */
  async getSchemas(db: Kysely<any>): Promise<string[]> {
    try {
      const results = await db
        .selectFrom('INFORMATION_SCHEMA.SCHEMATA')
        .select('SCHEMA_NAME')
        .where('SCHEMA_NAME', 'not in', [
          'INFORMATION_SCHEMA',
          'sys',
          'guest',
          'db_owner',
          'db_accessadmin',
          'db_securityadmin',
          'db_ddladmin',
          'db_backupoperator',
          'db_datareader',
          'db_datawriter',
          'db_denydatareader',
          'db_denydatawriter'
        ])
        .execute()
      return results.map(r => (r as { SCHEMA_NAME: string }).SCHEMA_NAME)
    } catch {
      return []
    }
  }

  /**
   * Create a new schema in the database
   *
   * @param db - Kysely database instance
   * @param schemaName - Name of the schema to create
   * @returns true if schema was created, false if it already exists
   */
  async createSchema(db: Kysely<any>, schemaName: string): Promise<boolean> {
    assertValidIdentifier(schemaName, 'schema name')

    try {
      await sql.raw(`CREATE SCHEMA ${this.escapeIdentifier(schemaName)}`).execute(db)
      return true
    } catch (error) {
      const errorMessage = String(error)
      if (errorMessage.includes('already exists')) {
        return false
      }
      this.logger.error(`Failed to create schema "${schemaName}":`, error)
      throw error
    }
  }

  /**
   * Drop a schema from the database
   *
   * @param db - Kysely database instance
   * @param schemaName - Name of the schema to drop
   * @returns true if schema was dropped, false if it doesn't exist
   */
  async dropSchema(db: Kysely<any>, schemaName: string): Promise<boolean> {
    assertValidIdentifier(schemaName, 'schema name')

    // Prevent dropping protected schemas
    const protectedSchemas = ['dbo', 'sys', 'INFORMATION_SCHEMA', 'guest']
    if (protectedSchemas.includes(schemaName)) {
      throw new Error(`Cannot drop protected schema: ${schemaName}`)
    }

    try {
      await sql.raw(`DROP SCHEMA ${this.escapeIdentifier(schemaName)}`).execute(db)
      return true
    } catch (error) {
      const errorMessage = String(error)
      if (errorMessage.includes('does not exist') || errorMessage.includes('Cannot find')) {
        return false
      }
      this.logger.error(`Failed to drop schema "${schemaName}":`, error)
      throw error
    }
  }
}

/**
 * Default MSSQL adapter instance with 'dbo' schema
 */
export const mssqlAdapter = new MSSQLAdapter()

/**
 * Create a new MSSQL adapter with custom configuration
 *
 * @param options - Adapter configuration options
 * @returns Configured MSSQLAdapter instance
 *
 * @example
 * // Create adapter with custom default schema
 * const adapter = createMSSQLAdapter({ defaultSchema: 'app' })
 */
export function createMSSQLAdapter(options?: MSSQLAdapterOptions): MSSQLAdapter {
  return new MSSQLAdapter(options)
}
