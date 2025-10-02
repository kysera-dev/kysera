import { Kysely } from 'kysely'
import { logger } from '../../utils/logger.js'

export interface TableColumn {
  name: string
  dataType: string
  isNullable: boolean
  isPrimaryKey: boolean
  isForeignKey: boolean
  defaultValue?: string
  maxLength?: number
  numericPrecision?: number
  numericScale?: number
  referencedTable?: string
  referencedColumn?: string
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
  foreignKeys?: Array<{
    column: string
    referencedTable: string
    referencedColumn: string
  }>
}

export class DatabaseIntrospector {
  constructor(
    private db: Kysely<any>,
    private dialect: 'postgres' | 'mysql' | 'sqlite'
  ) {}

  /**
   * Get all tables in the database
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
        throw new Error(`Unsupported dialect: ${this.dialect}`)
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
        throw new Error(`Unsupported dialect: ${this.dialect}`)
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
        logger.warn(`Failed to introspect table ${table}: ${error}`)
      }
    }

    return tableInfos
  }

  // PostgreSQL specific methods
  private async getPostgresTables(): Promise<string[]> {
    const result = await this.db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_schema', '=', 'public')
      .where('table_type', '=', 'BASE TABLE')
      .execute() as any[]

    return result.map(r => r.table_name)
  }

  private async getPostgresTableInfo(tableName: string): Promise<TableInfo> {
    // Get columns
    const columns = await this.db
      .selectFrom('information_schema.columns as c')
      .leftJoin(
        'information_schema.key_column_usage as kcu',
        (join) => join
          .onRef('c.table_name', '=', 'kcu.table_name')
          .onRef('c.column_name', '=', 'kcu.column_name')
          .onRef('c.table_schema', '=', 'kcu.table_schema')
      )
      .leftJoin(
        'information_schema.table_constraints as tc',
        (join) => join
          .onRef('kcu.constraint_name', '=', 'tc.constraint_name')
          .onRef('kcu.table_schema', '=', 'tc.table_schema')
      )
      .leftJoin(
        'information_schema.constraint_column_usage as ccu',
        (join) => join
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
        'tc.constraint_type',
        'ccu.table_name as referenced_table',
        'ccu.column_name as referenced_column'
      ])
      .where('c.table_schema', '=', 'public')
      .where('c.table_name', '=', tableName)
      .orderBy('c.ordinal_position')
      .execute() as any[]

    const tableColumns: TableColumn[] = columns.map(col => ({
      name: col.column_name,
      dataType: col.data_type,
      isNullable: col.is_nullable === 'YES',
      isPrimaryKey: col.constraint_type === 'PRIMARY KEY',
      isForeignKey: col.constraint_type === 'FOREIGN KEY',
      defaultValue: col.column_default,
      maxLength: col.character_maximum_length,
      numericPrecision: col.numeric_precision,
      numericScale: col.numeric_scale,
      referencedTable: col.referenced_table,
      referencedColumn: col.referenced_column
    }))

    // Get indexes
    const indexes = await this.db
      .selectFrom('pg_indexes')
      .select(['indexname', 'indexdef'])
      .where('schemaname', '=', 'public')
      .where('tablename', '=', tableName)
      .execute() as any[]

    const tableIndexes: TableIndex[] = indexes.map(idx => {
      // Parse index definition to extract columns
      const columnsMatch = idx.indexdef.match(/\((.*?)\)/)
      const columns = columnsMatch
        ? columnsMatch[1].split(',').map((c: string) => c.trim().replace(/"/g, ''))
        : []

      return {
        name: idx.indexname,
        columns,
        isUnique: idx.indexdef.includes('UNIQUE'),
        isPrimary: idx.indexdef.includes('PRIMARY KEY')
      }
    })

    const primaryKey = tableColumns
      .filter(col => col.isPrimaryKey)
      .map(col => col.name)

    const foreignKeys = tableColumns
      .filter(col => col.isForeignKey)
      .map(col => ({
        column: col.name,
        referencedTable: col.referencedTable!,
        referencedColumn: col.referencedColumn!
      }))

    return {
      name: tableName,
      columns: tableColumns,
      indexes: tableIndexes,
      primaryKey: primaryKey.length > 0 ? primaryKey : undefined,
      foreignKeys: foreignKeys.length > 0 ? foreignKeys : undefined
    }
  }

  // MySQL specific methods
  private async getMysqlTables(): Promise<string[]> {
    const result = await this.db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_schema', '=', this.db.raw('DATABASE()'))
      .where('table_type', '=', 'BASE TABLE')
      .execute() as any[]

    return result.map(r => r.table_name || r.TABLE_NAME)
  }

  private async getMysqlTableInfo(tableName: string): Promise<TableInfo> {
    // Get columns
    const columns = await this.db
      .selectFrom('information_schema.columns')
      .select([
        'column_name',
        'data_type',
        'is_nullable',
        'column_default',
        'character_maximum_length',
        'numeric_precision',
        'numeric_scale',
        'column_key'
      ])
      .where('table_schema', '=', this.db.raw('DATABASE()'))
      .where('table_name', '=', tableName)
      .orderBy('ordinal_position')
      .execute() as any[]

    const tableColumns: TableColumn[] = columns.map((col: any) => ({
      name: col.column_name || col.COLUMN_NAME,
      dataType: col.data_type || col.DATA_TYPE,
      isNullable: (col.is_nullable || col.IS_NULLABLE) === 'YES',
      isPrimaryKey: (col.column_key || col.COLUMN_KEY) === 'PRI',
      isForeignKey: (col.column_key || col.COLUMN_KEY) === 'MUL',
      defaultValue: col.column_default || col.COLUMN_DEFAULT,
      maxLength: col.character_maximum_length || col.CHARACTER_MAXIMUM_LENGTH,
      numericPrecision: col.numeric_precision || col.NUMERIC_PRECISION,
      numericScale: col.numeric_scale || col.NUMERIC_SCALE
    }))

    // Get indexes
    const indexes = await this.db
      .selectFrom('information_schema.statistics')
      .select(['index_name', 'column_name', 'non_unique'])
      .where('table_schema', '=', this.db.raw('DATABASE()'))
      .where('table_name', '=', tableName)
      .orderBy(['index_name', 'seq_in_index'])
      .execute() as any[]

    // Group columns by index
    const indexMap = new Map<string, TableIndex>()
    for (const idx of indexes) {
      const indexName = idx.index_name || idx.INDEX_NAME
      const columnName = idx.column_name || idx.COLUMN_NAME
      const isUnique = !(idx.non_unique || idx.NON_UNIQUE)

      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, {
          name: indexName,
          columns: [],
          isUnique,
          isPrimary: indexName === 'PRIMARY'
        })
      }
      indexMap.get(indexName)!.columns.push(columnName)
    }

    const tableIndexes = Array.from(indexMap.values())

    const primaryKey = tableColumns
      .filter(col => col.isPrimaryKey)
      .map(col => col.name)

    return {
      name: tableName,
      columns: tableColumns,
      indexes: tableIndexes,
      primaryKey: primaryKey.length > 0 ? primaryKey : undefined
    }
  }

  // SQLite specific methods
  private async getSqliteTables(): Promise<string[]> {
    const result = await this.db
      .selectFrom('sqlite_master')
      .select('name')
      .where('type', '=', 'table')
      .where('name', 'not like', 'sqlite_%')
      .execute() as any[]

    return result.map(r => r.name)
  }

  private async getSqliteTableInfo(tableName: string): Promise<TableInfo> {
    // SQLite's PRAGMA commands aren't directly supported by Kysely
    // We'll use raw SQL for introspection
    const columns = await this.db.raw(`PRAGMA table_info(${tableName})`).execute() as any

    const tableColumns: TableColumn[] = columns.rows.map((col: any) => ({
      name: col.name,
      dataType: col.type,
      isNullable: col.notnull === 0,
      isPrimaryKey: col.pk === 1,
      isForeignKey: false, // Will be updated with foreign key info
      defaultValue: col.dflt_value
    }))

    // Get foreign keys
    const foreignKeys = await this.db.raw(`PRAGMA foreign_key_list(${tableName})`).execute() as any

    for (const fk of foreignKeys.rows || []) {
      const column = tableColumns.find(c => c.name === fk.from)
      if (column) {
        column.isForeignKey = true
        column.referencedTable = fk.table
        column.referencedColumn = fk.to
      }
    }

    // Get indexes
    const indexList = await this.db.raw(`PRAGMA index_list(${tableName})`).execute() as any
    const tableIndexes: TableIndex[] = []

    for (const idx of indexList.rows || []) {
      const indexInfo = await this.db.raw(`PRAGMA index_info(${idx.name})`).execute() as any
      const columns = indexInfo.rows.map((info: any) => info.name)

      tableIndexes.push({
        name: idx.name,
        columns,
        isUnique: idx.unique === 1,
        isPrimary: idx.origin === 'pk'
      })
    }

    const primaryKey = tableColumns
      .filter(col => col.isPrimaryKey)
      .map(col => col.name)

    const fkList = tableColumns
      .filter(col => col.isForeignKey)
      .map(col => ({
        column: col.name,
        referencedTable: col.referencedTable!,
        referencedColumn: col.referencedColumn!
      }))

    return {
      name: tableName,
      columns: tableColumns,
      indexes: tableIndexes,
      primaryKey: primaryKey.length > 0 ? primaryKey : undefined,
      foreignKeys: fkList.length > 0 ? fkList : undefined
    }
  }

  /**
   * Convert database type to TypeScript type
   */
  static mapDataTypeToTypeScript(dataType: string, isNullable: boolean = false): string {
    const baseType = this.getBaseTypeScriptType(dataType.toLowerCase())
    return isNullable ? `${baseType} | null` : baseType
  }

  private static getBaseTypeScriptType(dataType: string): string {
    // Common types across databases
    if (dataType.includes('int') || dataType.includes('serial')) {
      return 'number'
    }
    if (dataType.includes('decimal') || dataType.includes('numeric') ||
        dataType.includes('float') || dataType.includes('double') || dataType.includes('real')) {
      return 'number'
    }
    if (dataType.includes('bool')) {
      return 'boolean'
    }
    if (dataType.includes('json')) {
      return 'any'
    }
    if (dataType.includes('date') || dataType.includes('time')) {
      return 'Date'
    }
    if (dataType.includes('uuid')) {
      return 'string'
    }
    if (dataType.includes('char') || dataType.includes('text') ||
        dataType.includes('varchar') || dataType.includes('string')) {
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
  static mapDataTypeToZod(dataType: string, isNullable: boolean = false): string {
    const baseType = this.getBaseZodType(dataType.toLowerCase())
    return isNullable ? `${baseType}.nullable()` : baseType
  }

  private static getBaseZodType(dataType: string): string {
    if (dataType.includes('int') || dataType.includes('serial')) {
      return 'z.number().int()'
    }
    if (dataType.includes('decimal') || dataType.includes('numeric') ||
        dataType.includes('float') || dataType.includes('double') || dataType.includes('real')) {
      return 'z.number()'
    }
    if (dataType.includes('bool')) {
      return 'z.boolean()'
    }
    if (dataType.includes('json')) {
      return 'z.any()'
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
    if (dataType.includes('char') || dataType.includes('text') ||
        dataType.includes('varchar') || dataType.includes('string')) {
      return 'z.string()'
    }

    // Default to string for unknown types
    return 'z.string()'
  }
}