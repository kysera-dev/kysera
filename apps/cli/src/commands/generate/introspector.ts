import type { Kysely } from 'kysely'
import type { Database as CliDatabase } from '../../types/index.js'
import { logger } from '../../utils/logger.js'
import { validateIdentifier } from '../../utils/sql-sanitizer.js'
import { CLIError, CLIErrorCodes } from '../../utils/errors.js'

export type IntrospectorDialect = 'postgres' | 'mysql' | 'sqlite'

export interface TableColumn {
  name: string
  dataType: string
  isNullable: boolean
  isPrimaryKey: boolean
  isForeignKey: boolean
  /**
   * The database fills this column in when the insert omits it:
   * serial/identity (PostgreSQL), AUTO_INCREMENT (MySQL) or a single
   * INTEGER PRIMARY KEY rowid alias (SQLite).
   */
  isAutoIncrement: boolean
  defaultValue?: string
  maxLength?: number
  numericPrecision?: number
  numericScale?: number
  referencedTable?: string
  referencedColumn?: string
  /** PostgreSQL underlying type name ('_int4' for int[] arrays, enum name, ...) */
  udtName?: string
}

export interface TableIndex {
  name: string
  columns: string[]
  isUnique: boolean
  isPrimary: boolean
}

export interface TableInfo {
  name: string
  columns: TableColumn[]
  indexes: TableIndex[]
  primaryKey?: string[]
  foreignKeys?: {
    column: string
    referencedTable: string
    referencedColumn: string
  }[]
}

/** information_schema.tables (PostgreSQL and MySQL share the selected shape) */
interface InformationSchemaTablesRow {
  table_schema: string
  table_name: string
  table_type: string
}

interface InformationSchemaColumnsRow {
  table_schema: string
  table_name: string
  column_name: string
  ordinal_position: number
  data_type: string
  is_nullable: string
  column_default: string | null
  character_maximum_length: number | null
  numeric_precision: number | null
  numeric_scale: number | null
  /** PostgreSQL only */
  is_identity: string | null
  /** PostgreSQL only */
  udt_name: string | null
  /** MySQL only: 'PRI' | 'UNI' | 'MUL' | '' */
  column_key: string | null
  /** MySQL only: contains 'auto_increment' for auto-increment columns */
  extra: string | null
}

interface InformationSchemaKeyColumnUsageRow {
  constraint_name: string
  table_schema: string
  table_name: string
  column_name: string
  /** MySQL only */
  referenced_table_name: string | null
  /** MySQL only */
  referenced_column_name: string | null
}

interface InformationSchemaTableConstraintsRow {
  constraint_name: string
  table_schema: string
  table_name: string
  constraint_type: string
}

interface InformationSchemaConstraintColumnUsageRow {
  constraint_name: string
  table_schema: string
  table_name: string
  column_name: string
}

interface InformationSchemaStatisticsRow {
  table_schema: string
  table_name: string
  index_name: string
  column_name: string
  non_unique: number
  seq_in_index: number
}

interface PgIndexesRow {
  schemaname: string
  tablename: string
  indexname: string
  indexdef: string
}

interface SqliteMasterRow {
  type: string
  name: string
  sql: string | null
}

/**
 * System catalogs queried during introspection. These tables are not part
 * of the user's schema type, so the constructor rebinds the connection to
 * this interface once.
 */
interface IntrospectionDatabase {
  'information_schema.tables': InformationSchemaTablesRow
  'information_schema.columns': InformationSchemaColumnsRow
  'information_schema.key_column_usage': InformationSchemaKeyColumnUsageRow
  'information_schema.table_constraints': InformationSchemaTableConstraintsRow
  'information_schema.constraint_column_usage': InformationSchemaConstraintColumnUsageRow
  'information_schema.statistics': InformationSchemaStatisticsRow
  pg_indexes: PgIndexesRow
  sqlite_master: SqliteMasterRow
}

interface SqliteTableInfoRow {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | number | null
  pk: number
}

interface SqliteForeignKeyRow {
  id: number
  seq: number
  table: string
  from: string
  to: string | null
}

interface SqliteIndexListRow {
  seq: number
  name: string
  unique: number
  origin: string
  partial: number
}

interface SqliteIndexInfoRow {
  seqno: number
  cid: number
  name: string | null
}

/**
 * MySQL returns information_schema columns upper- or lower-cased depending
 * on server version and driver settings; read both spellings.
 */
function mysqlField(row: object, key: string): unknown {
  const record = row as Record<string, unknown>
  return record[key] ?? record[key.toUpperCase()] ?? undefined
}

function mysqlString(row: object, key: string): string | undefined {
  const value = mysqlField(row, key)
  return typeof value === 'string' ? value : undefined
}

function mysqlNumber(row: object, key: string): number | undefined {
  const value = mysqlField(row, key)
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return undefined
}

export class DatabaseIntrospector {
  private readonly idb: Kysely<IntrospectionDatabase>

  constructor(
    private readonly db: Kysely<CliDatabase>,
    private readonly dialect: IntrospectorDialect,
    private readonly schema = 'public'
  ) {
    this.idb = db as unknown as Kysely<IntrospectionDatabase>
  }

  /**
   * Get all tables in the database, sorted by name.
   */
  async getTables(): Promise<string[]> {
    switch (this.dialect) {
      case 'postgres':
        return this.getPostgresTables()
      case 'mysql':
        return this.getMysqlTables()
      case 'sqlite':
        return this.getSqliteTables()
      default:
        throw new CLIError(
          `Unsupported dialect: ${String(this.dialect)}`,
          CLIErrorCodes.DATABASE_ERROR
        )
    }
  }

  /**
   * Get table information including columns and indexes
   */
  async getTableInfo(tableName: string): Promise<TableInfo> {
    switch (this.dialect) {
      case 'postgres':
        return this.getPostgresTableInfo(tableName)
      case 'mysql':
        return this.getMysqlTableInfo(tableName)
      case 'sqlite':
        return this.getSqliteTableInfo(tableName)
      default:
        throw new CLIError(
          `Unsupported dialect: ${String(this.dialect)}`,
          CLIErrorCodes.DATABASE_ERROR
        )
    }
  }

  /**
   * Get all table information for the entire database
   */
  async introspect(): Promise<TableInfo[]> {
    const tables = await this.getTables()
    const tableInfos: TableInfo[] = []

    for (const table of tables) {
      try {
        const info = await this.getTableInfo(table)
        tableInfos.push(info)
      } catch (error) {
        logger.warn(`Failed to introspect table ${table}: ${String(error)}`)
      }
    }

    return tableInfos
  }

  // PostgreSQL specific methods
  private async getPostgresTables(): Promise<string[]> {
    const rows = await this.idb
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_schema', '=', this.schema)
      .where('table_type', '=', 'BASE TABLE')
      .orderBy('table_name')
      .execute()

    return rows.map(row => row.table_name)
  }

  private async getPostgresTableInfo(tableName: string): Promise<TableInfo> {
    // One row per column and matching constraint; rows are merged per column
    // below because a column can appear in several constraints (PK + FK + UNIQUE).
    const rows = await this.idb
      .selectFrom('information_schema.columns as c')
      .leftJoin('information_schema.key_column_usage as kcu', join =>
        join
          .onRef('c.table_name', '=', 'kcu.table_name')
          .onRef('c.column_name', '=', 'kcu.column_name')
          .onRef('c.table_schema', '=', 'kcu.table_schema')
      )
      .leftJoin('information_schema.table_constraints as tc', join =>
        join
          .onRef('kcu.constraint_name', '=', 'tc.constraint_name')
          .onRef('kcu.table_schema', '=', 'tc.table_schema')
      )
      .leftJoin('information_schema.constraint_column_usage as ccu', join =>
        join
          .onRef('kcu.constraint_name', '=', 'ccu.constraint_name')
          .onRef('kcu.table_schema', '=', 'ccu.table_schema')
      )
      .select([
        'c.column_name',
        'c.data_type',
        'c.is_nullable',
        'c.column_default',
        'c.character_maximum_length',
        'c.numeric_precision',
        'c.numeric_scale',
        'c.is_identity',
        'c.udt_name',
        'tc.constraint_type',
        'ccu.table_name as referenced_table',
        'ccu.column_name as referenced_column'
      ])
      .where('c.table_schema', '=', this.schema)
      .where('c.table_name', '=', tableName)
      .orderBy('c.ordinal_position')
      .orderBy('tc.constraint_type')
      .execute()

    const byName = new Map<string, TableColumn>()
    for (const row of rows) {
      const isPrimaryKey = row.constraint_type === 'PRIMARY KEY'
      const isForeignKey = row.constraint_type === 'FOREIGN KEY'
      const existing = byName.get(row.column_name)

      if (existing) {
        existing.isPrimaryKey ||= isPrimaryKey
        if (isForeignKey) {
          existing.isForeignKey = true
          existing.referencedTable ??= row.referenced_table ?? undefined
          existing.referencedColumn ??= row.referenced_column ?? undefined
        }
        continue
      }

      byName.set(row.column_name, {
        name: row.column_name,
        dataType: row.data_type,
        isNullable: row.is_nullable === 'YES',
        isPrimaryKey,
        isForeignKey,
        isAutoIncrement:
          row.is_identity === 'YES' || (row.column_default?.startsWith('nextval(') ?? false),
        defaultValue: row.column_default ?? undefined,
        maxLength: row.character_maximum_length ?? undefined,
        numericPrecision: row.numeric_precision ?? undefined,
        numericScale: row.numeric_scale ?? undefined,
        referencedTable: isForeignKey ? (row.referenced_table ?? undefined) : undefined,
        referencedColumn: isForeignKey ? (row.referenced_column ?? undefined) : undefined,
        udtName: row.udt_name ?? undefined
      })
    }
    const tableColumns = [...byName.values()]

    const indexRows = await this.idb
      .selectFrom('pg_indexes')
      .select(['indexname', 'indexdef'])
      .where('schemaname', '=', this.schema)
      .where('tablename', '=', tableName)
      .orderBy('indexname')
      .execute()

    const tableIndexes: TableIndex[] = indexRows.map(idx => {
      const columnsMatch = /\((.*?)\)/.exec(idx.indexdef)
      const columns = columnsMatch?.[1]
        ? columnsMatch[1].split(',').map(column => column.trim().replace(/"/g, ''))
        : []

      return {
        name: idx.indexname,
        columns,
        isUnique: idx.indexdef.includes('UNIQUE'),
        isPrimary: idx.indexdef.includes('PRIMARY KEY')
      }
    })

    return this.buildTableInfo(tableName, tableColumns, tableIndexes)
  }

  // MySQL specific methods
  private async getMysqlTables(): Promise<string[]> {
    const { sql } = await import('kysely')
    const rows = await this.idb
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_schema', '=', sql<string>`DATABASE()`)
      .where('table_type', '=', 'BASE TABLE')
      .orderBy('table_name')
      .execute()

    return rows
      .map(row => mysqlString(row, 'table_name'))
      .filter((name): name is string => typeof name === 'string')
  }

  private async getMysqlTableInfo(tableName: string): Promise<TableInfo> {
    const { sql } = await import('kysely')

    const columnRows = await this.idb
      .selectFrom('information_schema.columns')
      .select([
        'column_name',
        'data_type',
        'is_nullable',
        'column_default',
        'character_maximum_length',
        'numeric_precision',
        'numeric_scale',
        'column_key',
        'extra'
      ])
      .where('table_schema', '=', sql<string>`DATABASE()`)
      .where('table_name', '=', tableName)
      .orderBy('ordinal_position')
      .execute()

    const tableColumns: TableColumn[] = columnRows.map(row => {
      const extra = mysqlString(row, 'extra') ?? ''
      return {
        name: mysqlString(row, 'column_name') ?? '',
        dataType: mysqlString(row, 'data_type') ?? '',
        isNullable: mysqlString(row, 'is_nullable') === 'YES',
        isPrimaryKey: mysqlString(row, 'column_key') === 'PRI',
        isForeignKey: false,
        isAutoIncrement: extra.toLowerCase().includes('auto_increment'),
        defaultValue: mysqlString(row, 'column_default'),
        maxLength: mysqlNumber(row, 'character_maximum_length'),
        numericPrecision: mysqlNumber(row, 'numeric_precision'),
        numericScale: mysqlNumber(row, 'numeric_scale')
      }
    })

    const fkRows = await this.idb
      .selectFrom('information_schema.key_column_usage')
      .select(['column_name', 'referenced_table_name', 'referenced_column_name'])
      .where('table_schema', '=', sql<string>`DATABASE()`)
      .where('table_name', '=', tableName)
      .where('referenced_table_name', 'is not', null)
      .orderBy('column_name')
      .execute()

    for (const row of fkRows) {
      const columnName = mysqlString(row, 'column_name')
      const column = tableColumns.find(c => c.name === columnName)
      if (column) {
        column.isForeignKey = true
        column.referencedTable ??= mysqlString(row, 'referenced_table_name')
        column.referencedColumn ??= mysqlString(row, 'referenced_column_name')
      }
    }

    const indexRows = await this.idb
      .selectFrom('information_schema.statistics')
      .select(['index_name', 'column_name', 'non_unique'])
      .where('table_schema', '=', sql<string>`DATABASE()`)
      .where('table_name', '=', tableName)
      .orderBy('index_name')
      .orderBy('seq_in_index')
      .execute()

    const indexMap = new Map<string, TableIndex>()
    for (const row of indexRows) {
      const indexName = mysqlString(row, 'index_name')
      const columnName = mysqlString(row, 'column_name')
      if (indexName === undefined || columnName === undefined) continue

      const nonUnique = mysqlNumber(row, 'non_unique')
      let index = indexMap.get(indexName)
      if (!index) {
        index = {
          name: indexName,
          columns: [],
          isUnique: !nonUnique,
          isPrimary: indexName === 'PRIMARY'
        }
        indexMap.set(indexName, index)
      }
      index.columns.push(columnName)
    }

    return this.buildTableInfo(tableName, tableColumns, [...indexMap.values()])
  }

  // SQLite specific methods
  private async getSqliteTables(): Promise<string[]> {
    const rows = await this.idb
      .selectFrom('sqlite_master')
      .select('name')
      .where('type', '=', 'table')
      .where('name', 'not like', 'sqlite_%')
      .orderBy('name')
      .execute()

    return rows.map(row => row.name)
  }

  private async getSqliteTableInfo(tableName: string): Promise<TableInfo> {
    const { sql } = await import('kysely')
    // PRAGMA statements cannot be parameterized; the identifier is validated
    // to prevent SQL injection.
    const validTableName = validateIdentifier(tableName, 'table')

    const ddlRow = await this.idb
      .selectFrom('sqlite_master')
      .select('sql')
      .where('type', '=', 'table')
      .where('name', '=', tableName)
      .executeTakeFirst()
    const withoutRowid = /WITHOUT\s+ROWID/i.test(ddlRow?.sql ?? '')

    const columnResult = await sql
      .raw<SqliteTableInfoRow>(`PRAGMA table_info(${validTableName})`)
      .execute(this.db)

    const pkCount = columnResult.rows.filter(row => row.pk > 0).length

    const tableColumns: TableColumn[] = columnResult.rows.map(row => {
      const isPrimaryKey = row.pk > 0
      // A single INTEGER PRIMARY KEY of a rowid table aliases the rowid:
      // SQLite generates the value and the column can never hold NULL.
      const isRowIdAlias =
        isPrimaryKey && pkCount === 1 && row.type.toUpperCase() === 'INTEGER' && !withoutRowid
      return {
        name: row.name,
        dataType: row.type,
        isNullable: row.notnull === 0 && !isRowIdAlias,
        isPrimaryKey,
        isForeignKey: false,
        isAutoIncrement: isRowIdAlias,
        defaultValue: row.dflt_value === null ? undefined : String(row.dflt_value)
      }
    })

    const foreignKeyResult = await sql
      .raw<SqliteForeignKeyRow>(`PRAGMA foreign_key_list(${validTableName})`)
      .execute(this.db)

    for (const fk of foreignKeyResult.rows) {
      const column = tableColumns.find(c => c.name === fk.from)
      if (column) {
        column.isForeignKey = true
        column.referencedTable = fk.table
        // A NULL "to" means the foreign key references the primary key of
        // the target table; leave the column reference unset in that case.
        column.referencedColumn = fk.to ?? undefined
      }
    }

    const indexListResult = await sql
      .raw<SqliteIndexListRow>(`PRAGMA index_list(${validTableName})`)
      .execute(this.db)
    const tableIndexes: TableIndex[] = []

    for (const idx of indexListResult.rows) {
      const validIndexName = validateIdentifier(idx.name, 'index')
      const indexInfoResult = await sql
        .raw<SqliteIndexInfoRow>(`PRAGMA index_info(${validIndexName})`)
        .execute(this.db)
      const columns = indexInfoResult.rows
        .map(info => info.name)
        .filter((name): name is string => name !== null)

      tableIndexes.push({
        name: idx.name,
        columns,
        isUnique: idx.unique === 1,
        isPrimary: idx.origin === 'pk'
      })
    }

    return this.buildTableInfo(tableName, tableColumns, tableIndexes)
  }

  private buildTableInfo(
    tableName: string,
    columns: TableColumn[],
    indexes: TableIndex[]
  ): TableInfo {
    const primaryKey = columns.filter(col => col.isPrimaryKey).map(col => col.name)

    const foreignKeys = columns
      .filter(col => col.isForeignKey && col.referencedTable !== undefined)
      .map(col => ({
        column: col.name,
        referencedTable: col.referencedTable ?? '',
        referencedColumn: col.referencedColumn ?? ''
      }))

    return {
      name: tableName,
      columns,
      indexes,
      primaryKey: primaryKey.length > 0 ? primaryKey : undefined,
      foreignKeys: foreignKeys.length > 0 ? foreignKeys : undefined
    }
  }

  /**
   * Convert database type to TypeScript type
   */
  static mapDataTypeToTypeScript(dataType: string, isNullable = false): string {
    const baseType = this.getBaseTypeScriptType(dataType.toLowerCase())
    return isNullable ? `${baseType} | null` : baseType
  }

  private static getBaseTypeScriptType(dataType: string): string {
    // Common types across databases
    if (dataType.includes('int') || dataType.includes('serial')) {
      return 'number'
    }
    if (
      dataType.includes('decimal') ||
      dataType.includes('numeric') ||
      dataType.includes('float') ||
      dataType.includes('double') ||
      dataType.includes('real')
    ) {
      return 'number'
    }
    if (dataType.includes('bool')) {
      return 'boolean'
    }
    if (dataType.includes('json')) {
      return 'unknown'
    }
    if (dataType.includes('date') || dataType.includes('time')) {
      return 'Date'
    }
    if (dataType.includes('uuid')) {
      return 'string'
    }
    if (
      dataType.includes('char') ||
      dataType.includes('text') ||
      dataType.includes('varchar') ||
      dataType.includes('string')
    ) {
      return 'string'
    }
    if (dataType.includes('blob') || dataType.includes('bytea') || dataType.includes('binary')) {
      return 'Buffer'
    }

    // Default to string for unknown types
    return 'string'
  }

  /**
   * Convert database type to Zod schema
   */
  static mapDataTypeToZod(dataType: string, isNullable = false): string {
    const baseType = this.getBaseZodType(dataType.toLowerCase())
    return isNullable ? `${baseType}.nullable()` : baseType
  }

  private static getBaseZodType(dataType: string): string {
    if (dataType.includes('int') || dataType.includes('serial')) {
      return 'z.number().int()'
    }
    if (
      dataType.includes('decimal') ||
      dataType.includes('numeric') ||
      dataType.includes('float') ||
      dataType.includes('double') ||
      dataType.includes('real')
    ) {
      return 'z.number()'
    }
    if (dataType.includes('bool')) {
      return 'z.boolean()'
    }
    if (dataType.includes('json')) {
      return 'z.unknown()'
    }
    if (dataType.includes('date') || dataType.includes('time')) {
      return 'z.date()'
    }
    if (dataType.includes('uuid')) {
      return 'z.string().uuid()'
    }
    if (dataType.includes('email')) {
      return 'z.string().email()'
    }
    if (dataType.includes('url')) {
      return 'z.string().url()'
    }
    if (
      dataType.includes('char') ||
      dataType.includes('text') ||
      dataType.includes('varchar') ||
      dataType.includes('string')
    ) {
      return 'z.string()'
    }

    // Default to string for unknown types
    return 'z.string()'
  }
}
