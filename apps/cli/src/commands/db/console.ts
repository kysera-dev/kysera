import { Command } from 'commander'
import { prism, table as displayTable } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { DatabaseIntrospector } from '../generate/introspector.js'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

export interface ConsoleOptions {
  query?: string
  config?: string
}

export function consoleCommand(): Command {
  const cmd = new Command('console')
    .description('Open interactive database console')
    .option('-q, --query <sql>', 'Execute SQL query and exit')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: ConsoleOptions) => {
      try {
        await databaseConsole(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to open console: ${error instanceof Error ? error.message : String(error)}`,
          'CONSOLE_ERROR'
        )
      }
    })

  return cmd
}

async function databaseConsole(options: ConsoleOptions): Promise<void> {
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

  try {
    // If query provided, execute and exit
    if (options.query) {
      await executeQuery(db, options.query, config.database.dialect)
      return
    }

    // Interactive mode
    console.log(prism.cyan('🗄️  Kysera Database Console'))
    console.log(prism.gray(`Connected to: ${config.database.dialect}`))
    console.log(prism.gray('Type ".help" for help, ".exit" to quit'))
    console.log('')

    const rl = createInterface({
      input: stdin,
      output: stdout,
      prompt: prism.gray('kysera> ')
    })

    const introspector = new DatabaseIntrospector(db, config.database.dialect as any)
    let multilineQuery = ''
    let inMultiline = false

    rl.prompt()

    for await (const line of rl) {
      const trimmedLine = line.trim()

      // Handle multi-line queries
      if (inMultiline) {
        multilineQuery += ' ' + line
        if (line.endsWith(';')) {
          inMultiline = false
          const query = multilineQuery.trim()
          multilineQuery = ''

          try {
            await executeQuery(db, query, config.database.dialect)
          } catch (error) {
            console.error(prism.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
          }
          rl.setPrompt(prism.gray('kysera> '))
        } else {
          rl.setPrompt(prism.gray('     -> '))
        }
        rl.prompt()
        continue
      }

      // Handle special commands
      if (trimmedLine.startsWith('.')) {
        const command = trimmedLine.toLowerCase().split(' ')[0]
        const args = trimmedLine.slice(command.length).trim()

        switch (command) {
          case '.help':
          case '.h':
            showHelp()
            break

          case '.exit':
          case '.quit':
          case '.q':
            console.log(prism.gray('Goodbye!'))
            rl.close()
            return

          case '.tables':
          case '.t':
            await showTables(introspector)
            break

          case '.describe':
          case '.d':
            if (args) {
              await describeTable(introspector, args)
            } else {
              console.log(prism.yellow('Usage: .describe <table_name>'))
            }
            break

          case '.indexes':
          case '.i':
            if (args) {
              await showIndexes(introspector, args)
            } else {
              console.log(prism.yellow('Usage: .indexes <table_name>'))
            }
            break

          case '.count':
          case '.c':
            if (args) {
              await showCount(db, args)
            } else {
              console.log(prism.yellow('Usage: .count <table_name>'))
            }
            break

          case '.clear':
          case '.cls':
            console.clear()
            break

          default:
            console.log(prism.yellow(`Unknown command: ${command}`))
            console.log(prism.gray('Type ".help" for available commands'))
        }
      } else if (trimmedLine) {
        // SQL query
        if (trimmedLine.endsWith(';')) {
          // Single line query
          try {
            await executeQuery(db, trimmedLine, config.database.dialect)
          } catch (error) {
            console.error(prism.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
          }
        } else if (trimmedLine.toLowerCase().startsWith('select') ||
                   trimmedLine.toLowerCase().startsWith('insert') ||
                   trimmedLine.toLowerCase().startsWith('update') ||
                   trimmedLine.toLowerCase().startsWith('delete') ||
                   trimmedLine.toLowerCase().startsWith('create') ||
                   trimmedLine.toLowerCase().startsWith('drop') ||
                   trimmedLine.toLowerCase().startsWith('alter')) {
          // Start multi-line query
          inMultiline = true
          multilineQuery = trimmedLine
          rl.setPrompt(prism.gray('     -> '))
        } else {
          console.log(prism.yellow('SQL queries must end with ";"'))
        }
      }

      rl.prompt()
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

async function executeQuery(db: any, query: string, dialect: string): Promise<void> {
  const startTime = Date.now()

  try {
    // Remove trailing semicolon for Kysely
    const cleanQuery = query.trim().replace(/;$/, '')

    // Determine query type
    const queryLower = cleanQuery.toLowerCase()
    const isSelect = queryLower.startsWith('select')
    const isInsert = queryLower.startsWith('insert')
    const isUpdate = queryLower.startsWith('update')
    const isDelete = queryLower.startsWith('delete')
    const isDDL = queryLower.startsWith('create') || queryLower.startsWith('drop') || queryLower.startsWith('alter')

    // Execute query
    const result = await db.executeQuery(db.raw(cleanQuery))

    const duration = Date.now() - startTime

    if (isSelect) {
      // Display results as table
      const rows = result.rows as any[]

      if (rows.length === 0) {
        console.log(prism.gray('(0 rows)'))
      } else {
        // Format rows for display
        const formattedRows = rows.map(row => {
          const formatted: any = {}
          for (const [key, value] of Object.entries(row)) {
            if (value === null) {
              formatted[key] = prism.gray('NULL')
            } else if (value instanceof Date) {
              formatted[key] = value.toISOString()
            } else if (typeof value === 'boolean') {
              formatted[key] = value ? prism.green('true') : prism.red('false')
            } else {
              formatted[key] = String(value)
            }
          }
          return formatted
        })

        console.log('')
        console.log(displayTable(formattedRows))
        console.log('')
        console.log(prism.gray(`(${rows.length} row${rows.length !== 1 ? 's' : ''}, ${duration}ms)`))
      }
    } else if (isInsert || isUpdate || isDelete) {
      // Show affected rows
      const affected = result.numAffectedRows ?? 0
      console.log(prism.green(`✓ Query OK, ${affected} row${affected !== 1 ? 's' : ''} affected (${duration}ms)`))
    } else if (isDDL) {
      // DDL statement
      console.log(prism.green(`✓ Query OK (${duration}ms)`))
    } else {
      // Other statements
      console.log(prism.green(`✓ Query executed successfully (${duration}ms)`))
    }
  } catch (error) {
    throw error
  }
}

function showHelp(): void {
  console.log('')
  console.log(prism.bold('Available Commands:'))
  console.log('')
  console.log('  .help, .h            Show this help message')
  console.log('  .exit, .quit, .q     Exit the console')
  console.log('  .tables, .t          List all tables')
  console.log('  .describe, .d <table> Describe table structure')
  console.log('  .indexes, .i <table> Show table indexes')
  console.log('  .count, .c <table>   Count rows in table')
  console.log('  .clear, .cls         Clear the screen')
  console.log('')
  console.log(prism.bold('SQL Queries:'))
  console.log('')
  console.log('  Execute any SQL query by typing it and ending with ";"')
  console.log('  Multi-line queries are supported')
  console.log('')
  console.log(prism.bold('Examples:'))
  console.log('')
  console.log('  SELECT * FROM users LIMIT 5;')
  console.log('  UPDATE users SET status = \'active\' WHERE id = 1;')
  console.log('  .describe users')
  console.log('  .count posts')
  console.log('')
}

async function showTables(introspector: DatabaseIntrospector): Promise<void> {
  try {
    const tables = await introspector.getTables()

    if (tables.length === 0) {
      console.log(prism.gray('No tables found'))
    } else {
      console.log('')
      console.log(prism.bold('Tables:'))
      for (const table of tables) {
        console.log(`  • ${table}`)
      }
      console.log('')
      console.log(prism.gray(`(${tables.length} table${tables.length !== 1 ? 's' : ''})`))
    }
  } catch (error) {
    console.error(prism.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
  }
}

async function describeTable(introspector: DatabaseIntrospector, tableName: string): Promise<void> {
  try {
    const info = await introspector.getTableInfo(tableName)

    console.log('')
    console.log(prism.bold(`Table: ${tableName}`))
    console.log('')

    // Format columns for display
    const columns = info.columns.map((col: any) => ({
      Column: col.name,
      Type: col.dataType,
      Nullable: col.isNullable ? 'YES' : 'NO',
      Key: col.isPrimaryKey ? 'PRI' : col.isForeignKey ? 'MUL' : '',
      Default: col.defaultValue || prism.gray('NULL'),
      Extra: col.isAutoIncrement ? 'auto_increment' : ''
    }))

    console.log(displayTable(columns))

    // Show primary key
    if (info.primaryKey && info.primaryKey.length > 0) {
      console.log('')
      console.log(`Primary Key: ${info.primaryKey.join(', ')}`)
    }

    // Show foreign keys
    if (info.foreignKeys && info.foreignKeys.length > 0) {
      console.log('')
      console.log('Foreign Keys:')
      for (const fk of info.foreignKeys) {
        console.log(`  • ${fk.column} → ${fk.referencedTable}.${fk.referencedColumn}`)
      }
    }

    console.log('')
  } catch (error) {
    console.error(prism.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
  }
}

async function showIndexes(introspector: DatabaseIntrospector, tableName: string): Promise<void> {
  try {
    const info = await introspector.getTableInfo(tableName)

    if (info.indexes.length === 0) {
      console.log(prism.gray(`No indexes found for table '${tableName}'`))
    } else {
      console.log('')
      console.log(prism.bold(`Indexes for table '${tableName}':`))
      console.log('')

      const indexes = info.indexes.map((idx: any) => ({
        Name: idx.name,
        Columns: idx.columns.join(', '),
        Unique: idx.isUnique ? 'YES' : 'NO',
        Primary: idx.isPrimary ? 'YES' : 'NO'
      }))

      console.log(displayTable(indexes))
      console.log('')
    }
  } catch (error) {
    console.error(prism.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
  }
}

async function showCount(db: any, tableName: string): Promise<void> {
  try {
    const result = await db
      .selectFrom(tableName)
      .select(db.fn.countAll().as('count'))
      .executeTakeFirst()

    const count = Number(result?.count || 0)
    console.log(`${tableName}: ${count} row${count !== 1 ? 's' : ''}`)
  } catch (error) {
    console.error(prism.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
  }
}