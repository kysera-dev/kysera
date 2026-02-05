/**
 * SQLite Dialect Adapter
 *
 * Note: SQLite does not support schemas in the same way as PostgreSQL.
 * Each SQLite database is a single schema. The schema option is accepted
 * for interface compatibility but is ignored for most operations.
 *
 * SQLite does support ATTACH DATABASE for multiple schemas, but this
 * requires special handling and is not currently implemented.
 */

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { silentLogger, type KyseraLogger } from '@kysera/core'
import type { DialectAdapter, DialectAdapterOptions, SchemaOptions } from '../types.js'
import { assertValidIdentifier, resolveSchema as resolveSchemaUtil, errorMatchers } from '../helpers.js'

/**
 * SQLite-specific adapter options
 */
export interface SQLiteAdapterOptions extends DialectAdapterOptions {
  /** Logger instance for error reporting */
  logger?: KyseraLogger
}

export class SQLiteAdapter implements DialectAdapter {
  readonly dialect = 'sqlite' as const
  readonly defaultSchema: string
  private logger: KyseraLogger

  constructor(options: SQLiteAdapterOptions = {}) {
    // SQLite uses 'main' as the default schema name
    this.defaultSchema = options.defaultSchema ?? 'main'
    this.logger = options.logger ?? silentLogger
  }

  getDefaultPort(): null {
    // SQLite is file-based, no port
    return null
  }

  getCurrentTimestamp(): string {
    return "datetime('now')"
  }

  escapeIdentifier(identifier: string): string {
    return '"' + identifier.replace(/"/g, '""') + '"'
  }

  formatDate(date: Date): string {
    return date.toISOString()
  }

  isUniqueConstraintError(error: unknown): boolean {
    return errorMatchers.sqlite.uniqueConstraint(error)
  }

  isForeignKeyError(error: unknown): boolean {
    return errorMatchers.sqlite.foreignKey(error)
  }

  isNotNullError(error: unknown): boolean {
    return errorMatchers.sqlite.notNull(error)
  }

  /**
   * Resolve the schema to use. In SQLite, this is typically 'main'
   * unless ATTACH DATABASE has been used.
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
      // For 'main' schema, use sqlite_master
      // For attached databases, use schema.sqlite_master
      if (schema === 'main') {
        const result = await db
          .selectFrom('sqlite_master')
          .select('name')
          .where('type', '=', 'table')
          .where('name', '=', tableName)
          .executeTakeFirst()
        return !!result
      } else {
        // For attached databases
        const result = await sql<{ name: string }>`
          SELECT name FROM ${sql.ref(`${schema}.sqlite_master`)}
          WHERE type = 'table' AND name = ${tableName}
        `.execute(db)
        return (result.rows?.length ?? 0) > 0
      }
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
      const qualifiedTable = schema === 'main'
        ? this.escapeIdentifier(tableName)
        : `${this.escapeIdentifier(schema)}.${this.escapeIdentifier(tableName)}`

      const results = await sql
        .raw(`PRAGMA table_info(${qualifiedTable})`)
        .execute(db)
      return (results.rows as { name: string }[]).map(r => r.name)
    } catch {
      return []
    }
  }

  async getTables(db: Kysely<any>, options?: SchemaOptions): Promise<string[]> {
    const schema = this.resolveSchema(options)

    try {
      if (schema === 'main') {
        const results = await db
          .selectFrom('sqlite_master')
          .select('name')
          .where('type', '=', 'table')
          .where('name', 'not like', 'sqlite_%')
          .execute()
        return results.map(r => r.name as string)
      } else {
        // For attached databases
        const results = await sql<{ name: string }>`
          SELECT name FROM ${sql.ref(`${schema}.sqlite_master`)}
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        `.execute(db)
        return results.rows?.map(r => r.name) ?? []
      }
    } catch {
      return []
    }
  }

  async getDatabaseSize(_db: Kysely<any>, _databaseName?: string): Promise<number> {
    // SQLite database size requires file system access
    // which is not available in a cross-runtime way
    return 0
  }

  async truncateTable(
    db: Kysely<any>,
    tableName: string,
    options?: SchemaOptions
  ): Promise<boolean> {
    assertValidIdentifier(tableName, 'table name')
    const schema = this.resolveSchema(options)

    try {
      // SQLite doesn't support TRUNCATE, use DELETE instead
      const qualifiedTable = schema === 'main'
        ? this.escapeIdentifier(tableName)
        : `${this.escapeIdentifier(schema)}.${this.escapeIdentifier(tableName)}`

      await sql.raw(`DELETE FROM ${qualifiedTable}`).execute(db)
      return true
    } catch (error) {
      const errorMessage = String(error)
      if (errorMessage.includes('no such table')) {
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
 * Default SQLite adapter instance
 */
export const sqliteAdapter = new SQLiteAdapter()

/**
 * Create a new SQLite adapter with custom configuration
 *
 * @param options - Adapter configuration options
 * @returns Configured SQLiteAdapter instance
 *
 * @example
 * // Create adapter (schema options have limited effect in SQLite)
 * const adapter = createSQLiteAdapter()
 */
export function createSQLiteAdapter(options?: SQLiteAdapterOptions): SQLiteAdapter {
  return new SQLiteAdapter(options)
}
