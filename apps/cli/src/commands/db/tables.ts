import { Command } from 'commander'
import { prism, spinner, table } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { DatabaseIntrospector } from '../generate/introspector.js'

export interface TablesOptions {
  json?: boolean
  verbose?: boolean
  config?: string
}

export function tablesCommand(): Command {
  const cmd = new Command('tables')
    .description('List all database tables with statistics')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed info (columns, indexes, etc.)')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: TablesOptions) => {
      try {
        await listTables(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to list tables: ${error instanceof Error ? error.message : String(error)}`,
          'TABLES_ERROR'
        )
      }
    })

  return cmd
}

async function listTables(options: TablesOptions): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config)

  if (!config?.database) {
    throw new CLIError(
      'Database configuration not found',
      'CONFIG_ERROR',
      [
        'Create a kysera.config.ts file with database configuration',
        'Or specify a config file with --config option'
      ]
    )
  }

  // Get database connection
  const db = await getDatabaseConnection(config.database)

  if (!db) {
    throw new CLIError(
      'Failed to connect to database',
      'DATABASE_ERROR',
      ['Check your database configuration', 'Ensure the database server is running']
    )
  }

  const listSpinner = spinner()
  listSpinner.start('Fetching table information...')

  try {
    const introspector = new DatabaseIntrospector(db, config.database.dialect as any)
    const tables = await introspector.getTables()

    if (tables.length === 0) {
      listSpinner.warn('No tables found in database')
      return
    }

    listSpinner.succeed(`Found ${tables.length} table${tables.length !== 1 ? 's' : ''}`)

    if (options.json) {
      // JSON output
      const tablesData = []
      for (const tableName of tables) {
        const info = await introspector.getTableInfo(tableName)
        const stats = await getTableStats(db, tableName, config.database.dialect)
        tablesData.push({
          name: tableName,
          columns: info.columns.length,
          indexes: info.indexes.length,
          primaryKey: info.primaryKey,
          foreignKeys: info.foreignKeys?.length || 0,
          rows: stats.rows,
          size: stats.size,
          indexSize: stats.indexSize
        })
      }
      console.log(JSON.stringify(tablesData, null, 2))
    } else if (options.verbose) {
      // Verbose output - show detailed info for each table
      for (const tableName of tables) {
        const info = await introspector.getTableInfo(tableName)
        const stats = await getTableStats(db, tableName, config.database.dialect)

        console.log('')
        console.log(prism.bold(`📋 Table: ${tableName}`))
        console.log(prism.gray('─'.repeat(50)))

        // Statistics
        console.log('')
        console.log(prism.cyan('Statistics:'))
        console.log(`  Rows: ${formatNumber(stats.rows)}`)
        console.log(`  Size: ${formatBytes(stats.size)}`)
        console.log(`  Index Size: ${formatBytes(stats.indexSize)}`)
        console.log(`  Total Size: ${formatBytes(stats.size + stats.indexSize)}`)

        // Columns
        console.log('')
        console.log(prism.cyan(`Columns (${info.columns.length}):`))
        const columnData = info.columns.map((col: any) => ({
          Name: col.name,
          Type: col.dataType,
          Nullable: col.isNullable ? 'Yes' : 'No',
          Default: col.defaultValue || '-',
          Key: col.isPrimaryKey ? 'PK' : col.isForeignKey ? 'FK' : '-'
        }))
        console.log(table(columnData))

        // Indexes
        if (info.indexes.length > 0) {
          console.log('')
          console.log(prism.cyan(`Indexes (${info.indexes.length}):`))
          const indexData = info.indexes.map((idx: any) => ({
            Name: idx.name,
            Columns: idx.columns.join(', '),
            Unique: idx.isUnique ? 'Yes' : 'No',
            Primary: idx.isPrimary ? 'Yes' : 'No'
          }))
          console.log(table(indexData))
        }

        // Foreign Keys
        if (info.foreignKeys && info.foreignKeys.length > 0) {
          console.log('')
          console.log(prism.cyan(`Foreign Keys (${info.foreignKeys.length}):`))
          const fkData = info.foreignKeys.map((fk: any) => ({
            Column: fk.column,
            References: `${fk.referencedTable}.${fk.referencedColumn}`
          }))
          console.log(table(fkData))
        }
      }

      // Summary
      console.log('')
      console.log(prism.gray('─'.repeat(50)))
      console.log(prism.bold('Database Summary'))
      const totalStats = await getDatabaseStats(db, tables, config.database.dialect)
      console.log(`  Total Tables: ${tables.length}`)
      console.log(`  Total Rows: ${formatNumber(totalStats.totalRows)}`)
      console.log(`  Total Size: ${formatBytes(totalStats.totalSize)}`)
      console.log(`  Total Index Size: ${formatBytes(totalStats.totalIndexSize)}`)
      console.log(`  Database Size: ${formatBytes(totalStats.totalSize + totalStats.totalIndexSize)}`)
    } else {
      // Default table view
      const tableData = []

      for (const tableName of tables) {
        try {
          const info = await introspector.getTableInfo(tableName)
          const stats = await getTableStats(db, tableName, config.database.dialect)

          tableData.push({
            Table: tableName,
            Rows: formatNumber(stats.rows),
            Size: formatBytes(stats.size),
            Indexes: info.indexes.length,
            Columns: info.columns.length,
            'Foreign Keys': info.foreignKeys?.length || 0
          })
        } catch (error) {
          logger.debug(`Failed to get stats for ${tableName}: ${error}`)
          tableData.push({
            Table: tableName,
            Rows: '?',
            Size: '?',
            Indexes: '?',
            Columns: '?',
            'Foreign Keys': '?'
          })
        }
      }

      console.log('')
      console.log(prism.bold('📋 Database Tables'))
      console.log('')
      console.log(table(tableData))

      // Summary
      const totalStats = await getDatabaseStats(db, tables, config.database.dialect)
      console.log('')
      console.log(prism.gray(`Total: ${tables.length} tables, ${formatBytes(totalStats.totalSize + totalStats.totalIndexSize)}`))
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

async function getTableStats(
  db: any,
  tableName: string,
  dialect: string
): Promise<{ rows: number; size: number; indexSize: number }> {
  try {
    // Get row count
    const countResult = await db
      .selectFrom(tableName)
      .select(db.fn.countAll().as('count'))
      .executeTakeFirst()
    const rows = Number(countResult?.count || 0)

    // Get table size (dialect-specific)
    let size = 0
    let indexSize = 0

    if (dialect === 'postgres') {
      const sizeResult = await db
        .selectNoFrom(eb => [
          eb.raw(`pg_relation_size('${tableName}')`).as('table_size'),
          eb.raw(`pg_indexes_size('${tableName}')`).as('index_size')
        ])
        .executeTakeFirst()

      size = Number(sizeResult?.table_size || 0)
      indexSize = Number(sizeResult?.index_size || 0)
    } else if (dialect === 'mysql') {
      const sizeResult = await db
        .selectFrom('information_schema.TABLES')
        .select(['DATA_LENGTH', 'INDEX_LENGTH'])
        .where('TABLE_NAME', '=', tableName)
        .where('TABLE_SCHEMA', '=', db.raw('DATABASE()'))
        .executeTakeFirst()

      size = Number(sizeResult?.DATA_LENGTH || 0)
      indexSize = Number(sizeResult?.INDEX_LENGTH || 0)
    } else {
      // SQLite - estimate based on row count
      // SQLite doesn't provide easy access to table sizes
      size = rows * 100 // Rough estimate: 100 bytes per row
      indexSize = rows * 20 // Rough estimate: 20 bytes per row for indexes
    }

    return { rows, size, indexSize }
  } catch (error) {
    logger.debug(`Failed to get stats for ${tableName}: ${error}`)
    return { rows: 0, size: 0, indexSize: 0 }
  }
}

async function getDatabaseStats(
  db: any,
  tables: string[],
  dialect: string
): Promise<{ totalRows: number; totalSize: number; totalIndexSize: number }> {
  let totalRows = 0
  let totalSize = 0
  let totalIndexSize = 0

  for (const tableName of tables) {
    const stats = await getTableStats(db, tableName, dialect)
    totalRows += stats.rows
    totalSize += stats.size
    totalIndexSize += stats.indexSize
  }

  return { totalRows, totalSize, totalIndexSize }
}

function formatNumber(num: number): string {
  if (num === 0) return '0'
  if (num < 1000) return num.toString()
  if (num < 1000000) return (num / 1000).toFixed(1) + 'K'
  if (num < 1000000000) return (num / 1000000).toFixed(1) + 'M'
  return (num / 1000000000).toFixed(1) + 'B'
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i]
}