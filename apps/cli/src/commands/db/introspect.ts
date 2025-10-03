import { Command } from 'commander'
import { prism, spinner, table } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { DatabaseIntrospector } from '../generate/introspector.js'

export interface IntrospectOptions {
  table?: string
  json?: boolean
  detailed?: boolean
  config?: string
}

export function introspectCommand(): Command {
  const cmd = new Command('introspect')
    .description('Introspect database schema')
    .argument('[table]', 'Specific table to introspect')
    .option('--json', 'Output as JSON')
    .option('--detailed', 'Show detailed information')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (tableName: string | undefined, options: IntrospectOptions) => {
      try {
        await introspectDatabase(tableName, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to introspect database: ${error instanceof Error ? error.message : String(error)}`,
          'INTROSPECT_ERROR'
        )
      }
    })

  return cmd
}

async function introspectDatabase(tableName: string | undefined, options: IntrospectOptions): Promise<void> {
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

  const introspectSpinner = spinner() as any
  introspectSpinner.start('Introspecting database...')

  try {
    const introspector = new DatabaseIntrospector(db, config.database.dialect as any)

    if (tableName) {
      // Introspect specific table
      const tableInfo = await introspector.getTableInfo(tableName)

      introspectSpinner.succeed(`Found table '${tableName}'`)

      if (options.json) {
        console.log(JSON.stringify(tableInfo, null, 2))
      } else {
        displayTableInfo(tableInfo, options.detailed || false)
      }
    } else {
      // Introspect all tables
      const tables = await introspector.getTables()

      if (tables.length === 0) {
        introspectSpinner.warn('No tables found in database')
        return
      }

      introspectSpinner.succeed(`Found ${tables.length} table${tables.length !== 1 ? 's' : ''}`)

      if (options.json) {
        const allTableInfo = await introspector.introspect()
        console.log(JSON.stringify(allTableInfo, null, 2))
      } else if (options.detailed) {
        // Show detailed info for each table
        for (const table of tables) {
          const tableInfo = await introspector.getTableInfo(table)
          displayTableInfo(tableInfo, true)
          console.log('')
        }
      } else {
        // Show summary table
        const summaryData = []

        for (const tableName of tables) {
          try {
            const info = await introspector.getTableInfo(tableName)
            const rowCount = await getTableRowCount(db, tableName)

            summaryData.push({
              Table: tableName,
              Columns: info.columns.length,
              Indexes: info.indexes.length,
              'Primary Key': info.primaryKey ? info.primaryKey.join(', ') : '-',
              'Foreign Keys': info.foreignKeys?.length || 0,
              Rows: rowCount
            })
          } catch (error) {
            logger.debug(`Failed to get info for ${tableName}: ${error}`)
            summaryData.push({
              Table: tableName,
              Columns: '?',
              Indexes: '?',
              'Primary Key': '?',
              'Foreign Keys': '?',
              Rows: '?'
            })
          }
        }

        console.log('')
        console.log(prism.bold('Database Schema Summary'))
        console.log('')
        console.log(table(summaryData))

        // Database info
        console.log('')
        console.log(prism.gray('Database Information:'))
        console.log(`  Dialect: ${config.database.dialect}`)
        console.log(`  Tables: ${tables.length}`)
        console.log('')
        console.log(prism.gray(`Run ${prism.cyan('kysera db introspect <table>')} to see table details`))
      }
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

function displayTableInfo(tableInfo: any, detailed: boolean): void {
  console.log('')
  console.log(prism.bold(`Table: ${tableInfo.name}`))
  console.log(prism.gray('─'.repeat(50)))

  // Columns
  console.log('')
  console.log(prism.cyan('Columns:'))

  const columnData = tableInfo.columns.map((col: any) => {
    const row: any = {
      Name: col.name,
      Type: col.dataType,
      Nullable: col.isNullable ? 'Yes' : 'No'
    }

    if (col.isPrimaryKey) {
      row.Name = `${row.Name} ${prism.yellow('[PK]')}`
    }
    if (col.isForeignKey) {
      row.Name = `${row.Name} ${prism.blue('[FK]')}`
    }

    if (detailed) {
      row.Default = col.defaultValue || '-'
      if (col.maxLength) {
        row['Max Length'] = col.maxLength
      }
      if (col.referencedTable) {
        row.References = `${col.referencedTable}.${col.referencedColumn}`
      }
    }

    return row
  })

  console.log(table(columnData))

  // Indexes
  if (tableInfo.indexes.length > 0) {
    console.log('')
    console.log(prism.cyan('Indexes:'))

    const indexData = tableInfo.indexes.map((idx: any) => ({
      Name: idx.name,
      Columns: idx.columns.join(', '),
      Unique: idx.isUnique ? 'Yes' : 'No',
      Primary: idx.isPrimary ? 'Yes' : 'No'
    }))

    console.log(table(indexData))
  }

  // Foreign Keys
  if (tableInfo.foreignKeys && tableInfo.foreignKeys.length > 0) {
    console.log('')
    console.log(prism.cyan('Foreign Keys:'))

    const fkData = tableInfo.foreignKeys.map((fk: any) => ({
      Column: fk.column,
      References: `${fk.referencedTable}.${fk.referencedColumn}`
    }))

    console.log(table(fkData))
  }

  // TypeScript types suggestion
  if (detailed) {
    console.log('')
    console.log(prism.cyan('TypeScript Types:'))
    console.log('')

    // Generate interface
    const interfaceName = toPascalCase(tableInfo.name)
    console.log(prism.gray(`interface ${interfaceName} {`))
    for (const col of tableInfo.columns) {
      const fieldName = toCamelCase(col.name)
      const fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(col.dataType, col.isNullable)
      console.log(prism.gray(`  ${fieldName}: ${fieldType}`))
    }
    console.log(prism.gray('}'))
  }
}

async function getTableRowCount(db: any, tableName: string): Promise<string> {
  try {
    const result = await db
      .selectFrom(tableName)
      .select(db.fn.countAll().as('count'))
      .executeTakeFirst()

    return result?.count?.toString() || '0'
  } catch {
    return '?'
  }
}

// Utility functions
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase())
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}