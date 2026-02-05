/**
 * PostgreSQL Dialect Adapter
 *
 * Supports PostgreSQL 12+ with full schema support for multi-tenant
 * and modular database architectures.
 */

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { silentLogger, type KyseraLogger } from '@kysera/core'
import type { DialectAdapter, DialectAdapterOptions, SchemaOptions } from '../types.js'
import {
  assertValidIdentifier,
  resolveSchema as resolveSchemaUtil,
  qualifyTableName,
  errorMatchers
} from '../helpers.js'

/**
 * PostgreSQL-specific adapter options
 */
export interface PostgresAdapterOptions extends DialectAdapterOptions {
  /** Logger instance for error reporting */
  logger?: KyseraLogger
}

export class PostgresAdapter implements DialectAdapter {
  readonly dialect = 'postgres' as const
  readonly defaultSchema: string
  private logger: KyseraLogger

  constructor(options: PostgresAdapterOptions = {}) {
    this.defaultSchema = options.defaultSchema ?? 'public'
    this.logger = options.logger ?? silentLogger
  }

  getDefaultPort(): number {
    return 5432
  }

  getCurrentTimestamp(): string {
    return 'CURRENT_TIMESTAMP'
  }

  escapeIdentifier(identifier: string): string {
    return '"' + identifier.replace(/"/g, '""') + '"'
  }

  formatDate(date: Date): string {
    return date.toISOString()
  }

  isUniqueConstraintError(error: unknown): boolean {
    return errorMatchers.postgres.uniqueConstraint(error)
  }

  isForeignKeyError(error: unknown): boolean {
    return errorMatchers.postgres.foreignKey(error)
  }

  isNotNullError(error: unknown): boolean {
    return errorMatchers.postgres.notNull(error)
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
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_name', '=', tableName)
        .where('table_schema', '=', schema)
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
        .selectFrom('information_schema.columns')
        .select('column_name')
        .where('table_name', '=', tableName)
        .where('table_schema', '=', schema)
        .execute()
      return results.map(r => r.column_name as string)
    } catch {
      return []
    }
  }

  async getTables(db: Kysely<any>, options?: SchemaOptions): Promise<string[]> {
    const schema = this.resolveSchema(options)

    try {
      const results = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', schema)
        .where('table_type', '=', 'BASE TABLE')
        .execute()
      return results.map(r => r.table_name as string)
    } catch {
      return []
    }
  }

  async getDatabaseSize(db: Kysely<any>, databaseName?: string): Promise<number> {
    try {
      // Use parameterized query to prevent SQL injection
      const result = databaseName
        ? await sql<{ size: number }>`SELECT pg_database_size(${databaseName}) as size`.execute(db)
        : await sql<{ size: number }>`SELECT pg_database_size(current_database()) as size`.execute(
            db
          )
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
      const qualifiedTable = qualifyTableName(schema, tableName, this.escapeIdentifier.bind(this))
      await sql
        .raw(`TRUNCATE TABLE ${qualifiedTable} RESTART IDENTITY CASCADE`)
        .execute(db)
      return true
    } catch (error) {
      // Only ignore "table does not exist" errors
      const errorMessage = String(error)
      if (
        errorMessage.includes('does not exist') ||
        (errorMessage.includes('relation') && errorMessage.includes('not exist'))
      ) {
        return false
      }
      // Log and rethrow unexpected errors
      this.logger.error(`Failed to truncate table "${schema}.${tableName}":`, error)
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

  /**
   * Check if a schema exists in the database
   *
   * @param db - Kysely database instance
   * @param schemaName - Name of the schema to check
   * @returns true if schema exists, false otherwise
   *
   * @example
   * const exists = await adapter.schemaExists(db, 'auth')
   */
  async schemaExists(db: Kysely<any>, schemaName: string): Promise<boolean> {
    assertValidIdentifier(schemaName, 'schema name')

    try {
      const result = await db
        .selectFrom('information_schema.schemata')
        .select('schema_name')
        .where('schema_name', '=', schemaName)
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
   *
   * @example
   * const schemas = await adapter.getSchemas(db)
   * // ['public', 'auth', 'admin', 'tenant_1']
   */
  async getSchemas(db: Kysely<any>): Promise<string[]> {
    try {
      const results = await db
        .selectFrom('information_schema.schemata')
        .select('schema_name')
        .where('schema_name', 'not like', 'pg_%')
        .where('schema_name', '!=', 'information_schema')
        .execute()
      return results.map(r => r.schema_name as string)
    } catch {
      return []
    }
  }

  /**
   * Create a new schema in the database
   *
   * @param db - Kysely database instance
   * @param schemaName - Name of the schema to create
   * @param options - Creation options
   * @returns true if schema was created, false if it already exists
   *
   * @example
   * await adapter.createSchema(db, 'tenant_123')
   */
  async createSchema(
    db: Kysely<any>,
    schemaName: string,
    options: { ifNotExists?: boolean } = {}
  ): Promise<boolean> {
    assertValidIdentifier(schemaName, 'schema name')

    try {
      const ifNotExists = options.ifNotExists ? 'IF NOT EXISTS ' : ''
      await sql
        .raw(`CREATE SCHEMA ${ifNotExists}${this.escapeIdentifier(schemaName)}`)
        .execute(db)
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
   * @param options - Drop options
   * @returns true if schema was dropped, false if it doesn't exist
   *
   * @example
   * await adapter.dropSchema(db, 'tenant_123', { cascade: true })
   */
  async dropSchema(
    db: Kysely<any>,
    schemaName: string,
    options: { ifExists?: boolean; cascade?: boolean } = {}
  ): Promise<boolean> {
    assertValidIdentifier(schemaName, 'schema name')

    // Prevent dropping protected schemas
    const protectedSchemas = ['public', 'pg_catalog', 'information_schema']
    if (protectedSchemas.includes(schemaName)) {
      throw new Error(`Cannot drop protected schema: ${schemaName}`)
    }

    try {
      const ifExists = options.ifExists ? 'IF EXISTS ' : ''
      const cascade = options.cascade ? ' CASCADE' : ''
      await sql
        .raw(`DROP SCHEMA ${ifExists}${this.escapeIdentifier(schemaName)}${cascade}`)
        .execute(db)
      return true
    } catch (error) {
      const errorMessage = String(error)
      if (errorMessage.includes('does not exist')) {
        return false
      }
      this.logger.error(`Failed to drop schema "${schemaName}":`, error)
      throw error
    }
  }

  // ============================================================================
  // Schema Information & Inspection
  // ============================================================================

  /**
   * Get detailed information about a schema
   *
   * @param db - Kysely database instance
   * @param schemaName - Name of the schema
   * @returns Schema information including table count, size, and owner
   *
   * @example
   * const info = await adapter.getSchemaInfo(db, 'tenant_123')
   * // { name: 'tenant_123', tableCount: 15, owner: 'app_user', sizeBytes: 1048576 }
   */
  async getSchemaInfo(
    db: Kysely<any>,
    schemaName: string
  ): Promise<{
    name: string
    tableCount: number
    owner: string | null
    sizeBytes: number
  }> {
    assertValidIdentifier(schemaName, 'schema name')

    try {
      // Get table count
      const tablesResult = await db
        .selectFrom('information_schema.tables')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('table_schema', '=', schemaName)
        .where('table_type', '=', 'BASE TABLE')
        .executeTakeFirst()

      // Get schema owner from pg_namespace
      const ownerResult = await sql<{ owner: string }>`
        SELECT pg_catalog.pg_get_userbyid(nspowner) as owner
        FROM pg_catalog.pg_namespace
        WHERE nspname = ${schemaName}
      `.execute(db)

      // Calculate schema size
      const sizeResult = await sql<{ size: number }>`
        SELECT COALESCE(
          SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)))::bigint,
          0
        ) as size
        FROM pg_tables
        WHERE schemaname = ${schemaName}
      `.execute(db)

      const rawSize = sizeResult.rows?.[0]?.size
      return {
        name: schemaName,
        tableCount: tablesResult?.count ?? 0,
        owner: ownerResult.rows?.[0]?.owner ?? null,
        sizeBytes: typeof rawSize === 'number' ? rawSize : (rawSize ? parseInt(String(rawSize), 10) : 0)
      }
    } catch (error) {
      this.logger.error(`Failed to get schema info for "${schemaName}":`, error)
      return {
        name: schemaName,
        tableCount: 0,
        owner: null,
        sizeBytes: 0
      }
    }
  }

  /**
   * Get index information for all tables in a schema
   *
   * @param db - Kysely database instance
   * @param options - Optional schema configuration
   * @returns Array of index information
   *
   * @example
   * const indexes = await adapter.getSchemaIndexes(db, { schema: 'auth' })
   */
  async getSchemaIndexes(
    db: Kysely<any>,
    options?: SchemaOptions
  ): Promise<{
    tableName: string
    indexName: string
    indexType: string
    isUnique: boolean
    isPrimary: boolean
    columns: string[]
  }[]> {
    const schema = this.resolveSchema(options)

    try {
      const result = await sql<{
        table_name: string
        index_name: string
        index_type: string
        is_unique: boolean
        is_primary: boolean
        column_names: string
      }>`
        SELECT
          t.relname as table_name,
          i.relname as index_name,
          am.amname as index_type,
          ix.indisunique as is_unique,
          ix.indisprimary as is_primary,
          string_agg(a.attname, ', ' ORDER BY array_position(ix.indkey, a.attnum)) as column_names
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_am am ON am.oid = i.relam
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        WHERE n.nspname = ${schema}
          AND t.relkind = 'r'
        GROUP BY t.relname, i.relname, am.amname, ix.indisunique, ix.indisprimary
        ORDER BY t.relname, i.relname
      `.execute(db)

      return (result.rows ?? []).map(row => ({
        tableName: row.table_name,
        indexName: row.index_name,
        indexType: row.index_type,
        isUnique: row.is_unique,
        isPrimary: row.is_primary,
        columns: row.column_names.split(', ')
      }))
    } catch (error) {
      this.logger.error(`Failed to get indexes for schema "${schema}":`, error)
      return []
    }
  }

  /**
   * Get foreign key relationships in a schema
   *
   * @param db - Kysely database instance
   * @param options - Optional schema configuration
   * @returns Array of foreign key relationships
   *
   * @example
   * const fks = await adapter.getSchemaForeignKeys(db, { schema: 'public' })
   */
  async getSchemaForeignKeys(
    db: Kysely<any>,
    options?: SchemaOptions
  ): Promise<{
    constraintName: string
    tableName: string
    columnName: string
    referencedSchema: string
    referencedTable: string
    referencedColumn: string
    onDelete: string
    onUpdate: string
  }[]> {
    const schema = this.resolveSchema(options)

    try {
      const result = await sql<{
        constraint_name: string
        table_name: string
        column_name: string
        referenced_schema: string
        referenced_table: string
        referenced_column: string
        on_delete: string
        on_update: string
      }>`
        SELECT
          tc.constraint_name,
          tc.table_name,
          kcu.column_name,
          ccu.table_schema as referenced_schema,
          ccu.table_name as referenced_table,
          ccu.column_name as referenced_column,
          rc.delete_rule as on_delete,
          rc.update_rule as on_update
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints rc
          ON tc.constraint_name = rc.constraint_name
          AND tc.table_schema = rc.constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = ${schema}
        ORDER BY tc.table_name, kcu.column_name
      `.execute(db)

      return (result.rows ?? []).map(row => ({
        constraintName: row.constraint_name,
        tableName: row.table_name,
        columnName: row.column_name,
        referencedSchema: row.referenced_schema,
        referencedTable: row.referenced_table,
        referencedColumn: row.referenced_column,
        onDelete: row.on_delete,
        onUpdate: row.on_update
      }))
    } catch (error) {
      this.logger.error(`Failed to get foreign keys for schema "${schema}":`, error)
      return []
    }
  }

  // ============================================================================
  // Search Path Management
  // ============================================================================

  /**
   * Get the current search_path setting
   *
   * @param db - Kysely database instance
   * @returns Array of schema names in the search path
   *
   * @example
   * const path = await adapter.getSearchPath(db)
   * // ['public', 'tenant_123']
   */
  async getSearchPath(db: Kysely<any>): Promise<string[]> {
    try {
      const result = await sql<{ search_path: string }>`SHOW search_path`.execute(db)
      const rawPath = result.rows?.[0]?.search_path ?? ''
      return rawPath
        .split(',')
        .map(s => s.trim().replace(/^"(.*)"$/, '$1'))
        .filter(s => s.length > 0)
    } catch (error) {
      this.logger.error('Failed to get search_path:', error)
      return []
    }
  }

  /**
   * Set the search_path for the current session
   *
   * @param db - Kysely database instance
   * @param schemas - Array of schema names to set in the search path
   *
   * @example
   * // Set search path for multi-tenant query
   * await adapter.setSearchPath(db, ['tenant_123', 'public'])
   */
  async setSearchPath(db: Kysely<any>, schemas: string[]): Promise<void> {
    for (const schema of schemas) {
      assertValidIdentifier(schema, 'schema name')
    }

    const escapedSchemas = schemas.map(s => this.escapeIdentifier(s)).join(', ')
    await sql.raw(`SET search_path TO ${escapedSchemas}`).execute(db)
  }

  /**
   * Execute a function with a temporary search_path, then restore the original
   *
   * @param db - Kysely database instance
   * @param schemas - Temporary search path
   * @param fn - Function to execute with the temporary search path
   * @returns The result of the function
   *
   * @example
   * const result = await adapter.withSearchPath(db, ['tenant_123'], async () => {
   *   // All queries in here will use tenant_123 schema by default
   *   return await db.selectFrom('users').selectAll().execute()
   * })
   */
  async withSearchPath<T>(
    db: Kysely<any>,
    schemas: string[],
    fn: () => Promise<T>
  ): Promise<T> {
    const originalPath = await this.getSearchPath(db)

    try {
      await this.setSearchPath(db, schemas)
      return await fn()
    } finally {
      if (originalPath.length > 0) {
        await this.setSearchPath(db, originalPath)
      }
    }
  }

  // ============================================================================
  // Schema Cloning & Migration
  // ============================================================================

  /**
   * Clone a schema's structure (tables, indexes, constraints) to a new schema
   *
   * @param db - Kysely database instance
   * @param sourceSchema - Source schema to clone from
   * @param targetSchema - Target schema name to create
   * @param options - Clone options
   * @returns true if successful
   *
   * @example
   * // Clone 'template' schema to create new tenant schema
   * await adapter.cloneSchema(db, 'template', 'tenant_456')
   *
   * @example
   * // Clone with data included
   * await adapter.cloneSchema(db, 'template', 'tenant_456', { includeData: true })
   */
  async cloneSchema(
    db: Kysely<any>,
    sourceSchema: string,
    targetSchema: string,
    options: {
      includeData?: boolean
      excludeTables?: string[]
    } = {}
  ): Promise<boolean> {
    assertValidIdentifier(sourceSchema, 'source schema name')
    assertValidIdentifier(targetSchema, 'target schema name')

    const { includeData = false, excludeTables = [] } = options

    try {
      // Create target schema
      await this.createSchema(db, targetSchema, { ifNotExists: true })

      // Get all tables from source schema
      const tables = await this.getTables(db, { schema: sourceSchema })
      const tablesToClone = tables.filter(t => !excludeTables.includes(t))

      // Clone each table
      for (const tableName of tablesToClone) {
        const sourceTable = qualifyTableName(sourceSchema, tableName, this.escapeIdentifier.bind(this))
        const targetTable = qualifyTableName(targetSchema, tableName, this.escapeIdentifier.bind(this))

        if (includeData) {
          // Clone structure and data
          await sql.raw(`CREATE TABLE ${targetTable} (LIKE ${sourceTable} INCLUDING ALL)`).execute(db)
          await sql.raw(`INSERT INTO ${targetTable} SELECT * FROM ${sourceTable}`).execute(db)
        } else {
          // Clone structure only with all constraints, indexes, defaults
          await sql.raw(`CREATE TABLE ${targetTable} (LIKE ${sourceTable} INCLUDING ALL)`).execute(db)
        }
      }

      return true
    } catch (error) {
      this.logger.error(`Failed to clone schema "${sourceSchema}" to "${targetSchema}":`, error)
      throw error
    }
  }

  /**
   * Compare two schemas and return the differences
   *
   * @param db - Kysely database instance
   * @param schema1 - First schema name
   * @param schema2 - Second schema name
   * @returns Comparison result with tables unique to each schema
   *
   * @example
   * const diff = await adapter.compareSchemas(db, 'template', 'tenant_123')
   * // { onlyInFirst: ['archived_users'], onlyInSecond: ['custom_settings'], inBoth: ['users', 'posts'] }
   */
  async compareSchemas(
    db: Kysely<any>,
    schema1: string,
    schema2: string
  ): Promise<{
    onlyInFirst: string[]
    onlyInSecond: string[]
    inBoth: string[]
  }> {
    assertValidIdentifier(schema1, 'schema name')
    assertValidIdentifier(schema2, 'schema name')

    const tables1 = new Set(await this.getTables(db, { schema: schema1 }))
    const tables2 = new Set(await this.getTables(db, { schema: schema2 }))

    const onlyInFirst: string[] = []
    const inBoth: string[] = []

    for (const table of tables1) {
      if (tables2.has(table)) {
        inBoth.push(table)
      } else {
        onlyInFirst.push(table)
      }
    }

    const onlyInSecond = [...tables2].filter(t => !tables1.has(t))

    return {
      onlyInFirst: onlyInFirst.sort(),
      onlyInSecond: onlyInSecond.sort(),
      inBoth: inBoth.sort()
    }
  }
}

/**
 * Default PostgreSQL adapter instance with 'public' schema
 */
export const postgresAdapter = new PostgresAdapter()

/**
 * Create a new PostgreSQL adapter with custom configuration
 *
 * @param options - Adapter configuration options
 * @returns Configured PostgresAdapter instance
 *
 * @example
 * // Create adapter with custom default schema
 * const adapter = createPostgresAdapter({ defaultSchema: 'auth' })
 *
 * @example
 * // Create adapter with logger
 * const adapter = createPostgresAdapter({
 *   defaultSchema: 'app',
 *   logger: myLogger
 * })
 */
export function createPostgresAdapter(options?: PostgresAdapterOptions): PostgresAdapter {
  return new PostgresAdapter(options)
}
