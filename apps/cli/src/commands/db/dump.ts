import { Command } from 'commander'
import {
  DatabaseIntrospector,
  type TableColumn,
  type TableIndex,
  type TableInfo
} from '../generate/introspector.js'
import { prism } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'

import { safePath, isPathSafe } from '../../utils/fs.js'
import { formatBytes } from '../../utils/formatting.js'
import { isJsonMode, output } from '../../utils/output.js'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import type { DatabaseDialect } from '../../utils/database.js'
import type { DatabaseInstance } from '../../types/index.js'

export interface DumpOptions {
  json?: boolean
  output?: string
  tables?: string
  dataOnly?: boolean
  schemaOnly?: boolean
  format?: 'sql' | 'json'
  config?: string
  schema?: string
}

interface JsonDumpTable {
  name: string
  schema?: {
    columns: TableColumn[]
    indexes: TableIndex[]
    primaryKey?: string[]
    foreignKeys?: TableInfo['foreignKeys']
  }
  data?: unknown[]
}

interface JsonDump {
  version: string
  timestamp: string
  tables: Record<string, JsonDumpTable>
}

export function dumpCommand(): Command {
  const cmd = new Command('dump')
    .description('Export database dump')
    .option('-o, --output <file>', 'Output file path')
    .option('-t, --tables <list>', 'Comma-separated table names')
    .option('--data-only', 'Export data only (no schema)')
    .option('--schema-only', 'Export schema only (no data)')
    .option('-f, --format <type>', 'Format (sql/json)', 'sql')
    .option('--json', 'Output dump summary as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .action(async (options: DumpOptions) => {
      try {
        await dumpDatabase(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to dump database: ${error instanceof Error ? error.message : String(error)}`,
          'DUMP_ERROR'
        )
      }
    })

  return cmd
}

async function dumpDatabase(options: DumpOptions): Promise<void> {
  // Validate options
  if (options.dataOnly && options.schemaOnly) {
    throw new CLIError('Cannot use both --data-only and --schema-only', 'INVALID_OPTIONS')
  }

  await withDatabase(
    { config: options.config, schema: options.schema },
    async (db, config, schema) => {
      const dumpSpinner = spinner()
      dumpSpinner.start(
        `Creating database dump${schema !== 'public' ? ` (schema: ${schema})` : ''}...`
      )

      const introspector = new DatabaseIntrospector(db, config.database.dialect, schema)

      // Get tables to dump
      let tables: string[]
      if (options.tables) {
        tables = options.tables.split(',').map(t => t.trim())
        // Validate tables exist
        const allTables = await introspector.getTables()
        const invalidTables = tables.filter(t => !allTables.includes(t))
        if (invalidTables.length > 0) {
          throw new CLIError(`Table(s) not found: ${invalidTables.join(', ')}`, 'TABLE_NOT_FOUND')
        }
      } else {
        tables = await introspector.getTables()
      }

      if (tables.length === 0) {
        dumpSpinner.warn('No tables to dump')
        return
      }

      dumpSpinner.text = `Dumping ${tables.length} table${tables.length !== 1 ? 's' : ''}...`

      // Generate output filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      const outputFile =
        options.output ?? `dump_${timestamp}.${options.format === 'json' ? 'json' : 'sql'}`

      // Validate output path is safe (within current working directory or absolute path)
      const baseDir = process.cwd()
      let outputPath: string

      if (resolve(outputFile) === outputFile) {
        // Absolute path provided - validate it's within a reasonable location
        outputPath = outputFile
        const outputDir = dirname(outputPath)
        // Ensure the output directory exists and is accessible
        if (!outputDir.startsWith(baseDir) && !outputDir.startsWith('/tmp')) {
          // For absolute paths outside cwd, just use them directly but warn
          console.log(
            prism.yellow(`Warning: Writing to path outside current directory: ${outputPath}`)
          )
        }
      } else {
        // Relative path - validate no traversal
        if (!isPathSafe(baseDir, outputFile)) {
          throw new CLIError(`Invalid output path: ${outputFile}`, 'PATH_TRAVERSAL', undefined, [
            'Output path must not contain path traversal sequences',
            'Use a path within the current directory'
          ])
        }
        outputPath = safePath(baseDir, outputFile)
      }

      let dumpContent: string

      if (options.format === 'json') {
        // JSON format
        dumpContent = await generateJsonDump(db, introspector, tables, options)
      } else {
        // SQL format
        dumpContent = await generateSqlDump(
          db,
          introspector,
          tables,
          options,
          config.database.dialect
        )
      }

      // Write to file
      writeFileSync(outputPath, dumpContent, 'utf-8')

      dumpSpinner.succeed(`Database dump created: ${outputPath}`)

      if (isJsonMode()) {
        output({
          file: outputPath,
          format: options.format ?? 'sql',
          tables: tables.length,
          schemaIncluded: !options.dataOnly,
          dataIncluded: !options.schemaOnly,
          bytes: dumpContent.length
        })
        return
      }

      // Show summary
      console.log('')
      console.log(prism.gray('Dump Summary:'))
      console.log(`  Format: ${options.format ?? 'sql'}`)
      console.log(`  Tables: ${tables.length}`)
      console.log(`  Schema: ${options.dataOnly ? 'No' : 'Yes'}`)
      console.log(`  Data: ${options.schemaOnly ? 'No' : 'Yes'}`)
      console.log(`  File Size: ${formatBytes(dumpContent.length)}`)
    }
  )
}

async function generateJsonDump(
  db: DatabaseInstance,
  introspector: DatabaseIntrospector,
  tables: string[],
  options: DumpOptions
): Promise<string> {
  const dump: JsonDump = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    tables: {}
  }

  for (const tableName of tables) {
    const tableData: JsonDumpTable = {
      name: tableName
    }

    // Include schema unless data-only
    if (!options.dataOnly) {
      const tableInfo = await introspector.getTableInfo(tableName)
      tableData.schema = {
        columns: tableInfo.columns,
        indexes: tableInfo.indexes,
        primaryKey: tableInfo.primaryKey,
        foreignKeys: tableInfo.foreignKeys
      }
    }

    // Include data unless schema-only
    if (!options.schemaOnly) {
      const rows = await db.selectFrom(tableName).selectAll().execute()
      tableData.data = rows
    }

    dump.tables[tableName] = tableData
  }

  return JSON.stringify(dump, null, 2)
}

async function generateSqlDump(
  db: DatabaseInstance,
  introspector: DatabaseIntrospector,
  tables: string[],
  options: DumpOptions,
  dialect: DatabaseDialect
): Promise<string> {
  const lines: string[] = []

  // Header
  lines.push(`-- Kysera Database Dump`)
  lines.push(`-- Version: 1.0.0`)
  lines.push(`-- Generated: ${new Date().toISOString()}`)
  lines.push(`-- Dialect: ${dialect}`)
  lines.push(``)

  // Disable foreign key checks
  if (dialect === 'postgres') {
    lines.push(`SET session_replication_role = replica;`)
  } else if (dialect === 'mysql') {
    lines.push(`SET FOREIGN_KEY_CHECKS = 0;`)
  } else {
    lines.push(`PRAGMA foreign_keys = OFF;`)
  }
  lines.push(``)

  for (const tableName of tables) {
    lines.push(`-- Table: ${tableName}`)
    lines.push(``)

    // Include schema unless data-only
    if (!options.dataOnly) {
      const tableInfo = await introspector.getTableInfo(tableName)

      // Drop table if exists (CASCADE is PostgreSQL-only syntax)
      const dropSuffix = dialect === 'postgres' ? ' CASCADE' : ''
      lines.push(`DROP TABLE IF EXISTS "${tableName}"${dropSuffix};`)
      lines.push(``)

      // Create table
      const createTableSql = generateCreateTableSql(tableInfo, dialect)
      lines.push(createTableSql)
      lines.push(``)

      // Create indexes
      for (const index of tableInfo.indexes) {
        if (!index.isPrimary) {
          const indexSql = generateCreateIndexSql(tableName, index)
          lines.push(indexSql)
        }
      }

      if (tableInfo.indexes.length > 0) {
        lines.push(``)
      }
    }

    // Include data unless schema-only
    if (!options.schemaOnly) {
      const rows = await db.selectFrom(tableName).selectAll().execute()

      if (rows.length > 0) {
        lines.push(`-- Data for table: ${tableName}`)

        // Get column names
        const columns = Object.keys(rows[0])
        const columnList = columns.map(c => `"${c}"`).join(', ')

        // Generate INSERT statements
        for (const row of rows) {
          const values = columns
            .map(col => {
              const value: unknown = row[col]
              if (value === null) {
                return 'NULL'
              } else if (typeof value === 'string') {
                return `'${value.replace(/'/g, "''")}'`
              } else if (value instanceof Date) {
                return `'${value.toISOString()}'`
              } else if (typeof value === 'boolean') {
                return value ? 'TRUE' : 'FALSE'
              } else if (typeof value === 'object') {
                // JSON/array columns: String() would emit "[object Object]"
                // and corrupt the dump; store the serialized JSON instead.
                return `'${JSON.stringify(value).replace(/'/g, "''")}'`
              } else {
                // Numbers and bigints keep their default stringification
                const stringable = value as { toString(): string }
                return String(stringable)
              }
            })
            .join(', ')

          lines.push(`INSERT INTO "${tableName}" (${columnList}) VALUES (${values});`)
        }
        lines.push(``)
      }
    }
  }

  // Re-enable foreign key checks
  if (dialect === 'postgres') {
    lines.push(`SET session_replication_role = DEFAULT;`)
  } else if (dialect === 'mysql') {
    lines.push(`SET FOREIGN_KEY_CHECKS = 1;`)
  } else {
    lines.push(`PRAGMA foreign_keys = ON;`)
  }

  return lines.join('\n')
}

function generateCreateTableSql(tableInfo: TableInfo, dialect: string): string {
  const lines: string[] = []
  lines.push(`CREATE TABLE "${tableInfo.name}" (`)

  // Columns
  const columnDefs = tableInfo.columns.map((col: TableColumn) => {
    let def = `  "${col.name}" ${mapDataTypeToSql(col.dataType, dialect)}`

    if (col.isPrimaryKey && dialect !== 'sqlite') {
      def += ' PRIMARY KEY'
    }

    if (!col.isNullable) {
      def += ' NOT NULL'
    }

    if (col.defaultValue) {
      def += ` DEFAULT ${col.defaultValue}`
    }

    if (col.isAutoIncrement) {
      if (dialect === 'postgres') {
        def = `  "${col.name}" SERIAL PRIMARY KEY`
      } else if (dialect === 'mysql') {
        def += ' AUTO_INCREMENT'
      } else if (dialect === 'sqlite') {
        def += ' PRIMARY KEY AUTOINCREMENT'
      }
    }

    return def
  })

  lines.push(columnDefs.join(',\n'))

  // Primary key constraint (if multi-column)
  if (tableInfo.primaryKey && tableInfo.primaryKey.length > 1) {
    const pkColumns = tableInfo.primaryKey.map((c: string) => `"${c}"`).join(', ')
    lines[lines.length - 1] += ','
    lines.push(`  PRIMARY KEY (${pkColumns})`)
  }

  // Foreign key constraints
  if (tableInfo.foreignKeys && tableInfo.foreignKeys.length > 0) {
    for (const fk of tableInfo.foreignKeys) {
      lines[lines.length - 1] += ','
      lines.push(
        `  FOREIGN KEY ("${fk.column}") REFERENCES "${fk.referencedTable}"("${fk.referencedColumn}")`
      )
    }
  }

  lines.push(`);`)
  return lines.join('\n')
}

function generateCreateIndexSql(tableName: string, index: TableIndex): string {
  const unique = index.isUnique ? 'UNIQUE ' : ''
  const columns = index.columns.map((c: string) => `"${c}"`).join(', ')
  return `CREATE ${unique}INDEX "${index.name}" ON "${tableName}" (${columns});`
}

function mapDataTypeToSql(dataType: string, dialect: string): string {
  const type = dataType.toLowerCase()

  // Common mappings
  const commonMap: Record<string, string> = {
    integer: 'INTEGER',
    int: 'INTEGER',
    bigint: 'BIGINT',
    smallint: 'SMALLINT',
    decimal: 'DECIMAL',
    numeric: 'NUMERIC',
    real: 'REAL',
    float: 'FLOAT',
    double: 'DOUBLE PRECISION',
    boolean: 'BOOLEAN',
    text: 'TEXT',
    varchar: 'VARCHAR(255)',
    char: 'CHAR',
    date: 'DATE',
    time: 'TIME',
    datetime: 'TIMESTAMP',
    timestamp: 'TIMESTAMP',
    json: 'JSON',
    jsonb: 'JSONB',
    uuid: 'UUID',
    blob: 'BLOB',
    bytea: 'BYTEA'
  }

  // Dialect-specific mappings
  if (dialect === 'postgres') {
    if (type.includes('serial')) return 'SERIAL'
    if (type.includes('bigserial')) return 'BIGSERIAL'
  } else if (dialect === 'mysql') {
    if (type.includes('tinyint')) return 'TINYINT'
    if (type.includes('mediumint')) return 'MEDIUMINT'
    if (type.includes('mediumtext')) return 'MEDIUMTEXT'
    if (type.includes('longtext')) return 'LONGTEXT'
  } else if (dialect === 'sqlite') {
    // SQLite has limited types
    if (type.includes('int')) return 'INTEGER'
    if (type.includes('char') || type.includes('text')) return 'TEXT'
    if (type.includes('real') || type.includes('float') || type.includes('double')) return 'REAL'
    if (type.includes('blob')) return 'BLOB'
  }

  // Check common map
  for (const [key, value] of Object.entries(commonMap)) {
    if (type.includes(key)) {
      return value
    }
  }

  // Return original if no mapping found
  return dataType.toUpperCase()
}
