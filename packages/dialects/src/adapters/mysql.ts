/**
 * MySQL Dialect Adapter
 *
 * Note: In MySQL, "schema" and "database" are synonymous.
 * The schema option maps to the current database context.
 */

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { silentLogger, type KyseraLogger } from '@kysera/core'
import type { DialectAdapter, DialectAdapterOptions, SchemaOptions } from '../types.js'
import { assertValidIdentifier, errorMatchers } from '../helpers.js'

/**
 * MySQL-specific adapter options
 */
export interface MySQLAdapterOptions extends DialectAdapterOptions {
  /** Logger instance for error reporting */
  logger?: KyseraLogger
}

export class MySQLAdapter implements DialectAdapter {
  readonly dialect = 'mysql' as const
  readonly defaultSchema: string
  private logger: KyseraLogger

  constructor(options: MySQLAdapterOptions = {}) {
    // In MySQL, defaultSchema is the database name
    // Empty string means use current database (DATABASE())
    this.defaultSchema = options.defaultSchema ?? ''
    this.logger = options.logger ?? silentLogger
  }

  getDefaultPort(): number {
    return 3306
  }

  getCurrentTimestamp(): string {
    return 'CURRENT_TIMESTAMP'
  }

  escapeIdentifier(identifier: string): string {
    return '`' + identifier.replace(/`/g, '``') + '`'
  }

  formatDate(date: Date): string {
    // MySQL datetime format: YYYY-MM-DD HH:MM:SS
    return date.toISOString().slice(0, 19).replace('T', ' ')
  }

  isUniqueConstraintError(error: unknown): boolean {
    return errorMatchers.mysql.uniqueConstraint(error)
  }

  isForeignKeyError(error: unknown): boolean {
    return errorMatchers.mysql.foreignKey(error)
  }

  isNotNullError(error: unknown): boolean {
    return errorMatchers.mysql.notNull(error)
  }

  /**
   * Get the schema (database) filter for queries.
   * In MySQL, schema = database, so we use DATABASE() if not specified.
   */
  private getSchemaFilter(options?: SchemaOptions): ReturnType<typeof sql> | string {
    const schema = options?.schema ?? this.defaultSchema
    if (schema) {
      assertValidIdentifier(schema, 'schema/database name')
      return schema
    }
    return sql`DATABASE()`
  }

  async tableExists(
    db: Kysely<any>,
    tableName: string,
    options?: SchemaOptions
  ): Promise<boolean> {
    assertValidIdentifier(tableName, 'table name')
    const schemaFilter = this.getSchemaFilter(options)

    try {
      const query = db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_name', '=', tableName)

      const result = typeof schemaFilter === 'string'
        ? await query.where('table_schema', '=', schemaFilter).executeTakeFirst()
        : await query.where('table_schema', '=', schemaFilter).executeTakeFirst()

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
    const schemaFilter = this.getSchemaFilter(options)

    try {
      const query = db
        .selectFrom('information_schema.columns')
        .select('column_name')
        .where('table_name', '=', tableName)

      const results = typeof schemaFilter === 'string'
        ? await query.where('table_schema', '=', schemaFilter).execute()
        : await query.where('table_schema', '=', schemaFilter).execute()

      return results.map(r => r.column_name as string)
    } catch {
      return []
    }
  }

  async getTables(db: Kysely<any>, options?: SchemaOptions): Promise<string[]> {
    const schemaFilter = this.getSchemaFilter(options)

    try {
      const query = db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_type', '=', 'BASE TABLE')

      const results = typeof schemaFilter === 'string'
        ? await query.where('table_schema', '=', schemaFilter).execute()
        : await query.where('table_schema', '=', schemaFilter).execute()

      return results.map(r => r.table_name as string)
    } catch {
      return []
    }
  }

  async getDatabaseSize(db: Kysely<any>, databaseName?: string): Promise<number> {
    try {
      const dbName =
        databaseName ||
        (await sql<{ name: string }>`SELECT DATABASE() as name`
          .execute(db)
          .then(r => r.rows?.[0]?.name))

      if (!dbName) {
        return 0
      }

      // Use parameterized query to prevent SQL injection
      const result = await sql<{ size: number }>`
        SELECT SUM(data_length + index_length) as size
        FROM information_schema.tables
        WHERE table_schema = ${dbName}
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
    const schema = options?.schema ?? this.defaultSchema

    try {
      await sql.raw('SET FOREIGN_KEY_CHECKS = 0').execute(db)
      try {
        const qualifiedTable = schema
          ? `${this.escapeIdentifier(schema)}.${this.escapeIdentifier(tableName)}`
          : this.escapeIdentifier(tableName)
        await sql.raw(`TRUNCATE TABLE ${qualifiedTable}`).execute(db)
        return true
      } finally {
        // Always try to re-enable FK checks
        try {
          await sql.raw('SET FOREIGN_KEY_CHECKS = 1').execute(db)
        } catch (fkError) {
          this.logger.error('Failed to re-enable foreign key checks:', fkError)
        }
      }
    } catch (error) {
      const errorMessage = String(error)
      if (errorMessage.includes("doesn't exist") || errorMessage.includes('Unknown table')) {
        return false
      }
      // Log and rethrow unexpected errors
      this.logger.error(`Failed to truncate table "${tableName}":`, error)
      throw error
    }
  }

  async truncateAllTables(
    db: Kysely<any>,
    exclude: string[] = [],
    options?: SchemaOptions
  ): Promise<void> {
    const tables = await this.getTables(db, options)
    for (const table of tables) {
      if (!exclude.includes(table)) {
        await this.truncateTable(db, table, options)
      }
    }
  }
}

/**
 * Default MySQL adapter instance
 */
export const mysqlAdapter = new MySQLAdapter()

/**
 * Create a new MySQL adapter with custom configuration
 *
 * @param options - Adapter configuration options
 * @returns Configured MySQLAdapter instance
 *
 * @example
 * // Create adapter with specific database as default
 * const adapter = createMySQLAdapter({ defaultSchema: 'my_database' })
 */
export function createMySQLAdapter(options?: MySQLAdapterOptions): MySQLAdapter {
  return new MySQLAdapter(options)
}
