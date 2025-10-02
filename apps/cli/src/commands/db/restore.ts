import { Command } from 'commander'
import { prism, spinner, confirm } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

export interface RestoreOptions {
  force?: boolean
  config?: string
}

export function restoreCommand(): Command {
  const cmd = new Command('restore')
    .description('Restore database from dump')
    .argument('<file>', 'Dump file to restore from')
    .option('--force', 'Skip confirmation prompt')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (file: string, options: RestoreOptions) => {
      try {
        await restoreDatabase(file, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to restore database: ${error instanceof Error ? error.message : String(error)}`,
          'RESTORE_ERROR'
        )
      }
    })

  return cmd
}

async function restoreDatabase(dumpFile: string, options: RestoreOptions): Promise<void> {
  // Check if dump file exists
  const dumpPath = resolve(dumpFile)
  if (!existsSync(dumpPath)) {
    throw new CLIError(
      `Dump file not found: ${dumpPath}`,
      'FILE_NOT_FOUND'
    )
  }

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

  // Confirm restore
  if (!options.force) {
    console.log('')
    console.log(prism.yellow('⚠️  WARNING: This will restore the database from the dump file!'))
    console.log(prism.gray('This may overwrite existing data.'))
    console.log('')

    const confirmed = await confirm({
      message: 'Are you sure you want to continue?',
      initialValue: false
    })

    if (!confirmed) {
      console.log(prism.gray('Restore cancelled'))
      return
    }
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

  const restoreSpinner = spinner()
  restoreSpinner.start(`Restoring from ${dumpFile}...`)

  try {
    // Read dump file
    const dumpContent = readFileSync(dumpPath, 'utf-8')

    // Detect format
    const isJson = dumpFile.endsWith('.json') || dumpContent.trim().startsWith('{')

    if (isJson) {
      // Restore from JSON dump
      await restoreFromJson(db, dumpContent, config.database.dialect)
    } else {
      // Restore from SQL dump
      await restoreFromSql(db, dumpContent, config.database.dialect)
    }

    restoreSpinner.succeed('Database restored successfully')

    // Show summary
    console.log('')
    console.log(prism.green('✅ Restore completed'))
    console.log(prism.gray(`Source: ${dumpPath}`))

  } catch (error) {
    restoreSpinner.fail(`Restore failed: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  } finally {
    // Close database connection
    await db.destroy()
  }
}

async function restoreFromJson(db: any, jsonContent: string, dialect: string): Promise<void> {
  let dump: any

  try {
    dump = JSON.parse(jsonContent)
  } catch (error) {
    throw new CLIError(
      'Invalid JSON dump file',
      'INVALID_DUMP',
      ['Ensure the file is a valid JSON dump created by kysera db dump']
    )
  }

  if (!dump.tables || typeof dump.tables !== 'object') {
    throw new CLIError(
      'Invalid dump format: missing tables',
      'INVALID_DUMP'
    )
  }

  // Start transaction
  const trx = await db.transaction()

  try {
    // Disable foreign key checks
    if (dialect === 'postgres') {
      await trx.executeQuery(trx.raw('SET session_replication_role = replica'))
    } else if (dialect === 'mysql') {
      await trx.executeQuery(trx.raw('SET FOREIGN_KEY_CHECKS = 0'))
    } else if (dialect === 'sqlite') {
      await trx.executeQuery(trx.raw('PRAGMA foreign_keys = OFF'))
    }

    // Process each table
    for (const [tableName, tableData] of Object.entries(dump.tables)) {
      const table = tableData as any

      // Create table schema if present
      if (table.schema) {
        // Drop existing table
        await trx.schema.dropTable(tableName).ifExists().execute()

        // Create table (simplified - in production would need full schema recreation)
        await createTableFromSchema(trx, tableName, table.schema)
      }

      // Insert data if present
      if (table.data && Array.isArray(table.data) && table.data.length > 0) {
        // Clear existing data if schema wasn't recreated
        if (!table.schema) {
          await trx.deleteFrom(tableName).execute()
        }

        // Insert in batches for better performance
        const batchSize = 100
        for (let i = 0; i < table.data.length; i += batchSize) {
          const batch = table.data.slice(i, i + batchSize)
          await trx.insertInto(tableName).values(batch).execute()
        }
      }
    }

    // Re-enable foreign key checks
    if (dialect === 'postgres') {
      await trx.executeQuery(trx.raw('SET session_replication_role = DEFAULT'))
    } else if (dialect === 'mysql') {
      await trx.executeQuery(trx.raw('SET FOREIGN_KEY_CHECKS = 1'))
    } else if (dialect === 'sqlite') {
      await trx.executeQuery(trx.raw('PRAGMA foreign_keys = ON'))
    }

    await trx.commit()
  } catch (error) {
    await trx.rollback()
    throw error
  }
}

async function restoreFromSql(db: any, sqlContent: string, dialect: string): Promise<void> {
  // Split SQL into individual statements
  const statements = sqlContent
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))

  if (statements.length === 0) {
    throw new CLIError(
      'No SQL statements found in dump file',
      'INVALID_DUMP'
    )
  }

  // Execute statements in transaction
  const trx = await db.transaction()

  try {
    for (const statement of statements) {
      if (statement.trim()) {
        // Skip comments and empty statements
        if (statement.startsWith('--') || !statement) {
          continue
        }

        // Execute statement
        await trx.executeQuery(trx.raw(statement))
      }
    }

    await trx.commit()
  } catch (error) {
    await trx.rollback()

    // Provide more detailed error information
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new CLIError(
      `SQL execution failed: ${errorMessage}`,
      'SQL_ERROR',
      [
        'Check that the dump file is compatible with your database',
        'Ensure the SQL syntax matches your database dialect',
        'Verify all referenced tables and columns exist'
      ]
    )
  }
}

async function createTableFromSchema(trx: any, tableName: string, schema: any): Promise<void> {
  // This is a simplified implementation
  // In production, you would need to properly map all column types and constraints

  let createTable = trx.schema.createTable(tableName)

  for (const column of schema.columns) {
    // Map column type to Kysely schema builder
    switch (column.dataType.toLowerCase()) {
      case 'integer':
      case 'int':
        if (column.isPrimaryKey && column.isAutoIncrement) {
          createTable = createTable.addColumn(column.name, 'serial', col => {
            col = col.primaryKey()
            if (!column.isNullable) col = col.notNull()
            return col
          })
        } else {
          createTable = createTable.addColumn(column.name, 'integer', col => {
            if (column.isPrimaryKey) col = col.primaryKey()
            if (!column.isNullable) col = col.notNull()
            if (column.defaultValue) col = col.defaultTo(column.defaultValue)
            return col
          })
        }
        break

      case 'bigint':
        createTable = createTable.addColumn(column.name, 'bigint', col => {
          if (column.isPrimaryKey) col = col.primaryKey()
          if (!column.isNullable) col = col.notNull()
          if (column.defaultValue) col = col.defaultTo(column.defaultValue)
          return col
        })
        break

      case 'varchar':
      case 'text':
      case 'string':
        createTable = createTable.addColumn(column.name, 'text', col => {
          if (column.isPrimaryKey) col = col.primaryKey()
          if (!column.isNullable) col = col.notNull()
          if (column.defaultValue) col = col.defaultTo(column.defaultValue)
          return col
        })
        break

      case 'boolean':
        createTable = createTable.addColumn(column.name, 'boolean', col => {
          if (!column.isNullable) col = col.notNull()
          if (column.defaultValue) col = col.defaultTo(column.defaultValue)
          return col
        })
        break

      case 'timestamp':
      case 'datetime':
        createTable = createTable.addColumn(column.name, 'timestamp', col => {
          if (!column.isNullable) col = col.notNull()
          if (column.defaultValue) {
            if (column.defaultValue.toLowerCase().includes('current') ||
                column.defaultValue.toLowerCase().includes('now')) {
              col = col.defaultTo(trx.fn.now())
            } else {
              col = col.defaultTo(column.defaultValue)
            }
          }
          return col
        })
        break

      case 'json':
      case 'jsonb':
        createTable = createTable.addColumn(column.name, 'json', col => {
          if (!column.isNullable) col = col.notNull()
          if (column.defaultValue) col = col.defaultTo(column.defaultValue)
          return col
        })
        break

      case 'decimal':
      case 'numeric':
        createTable = createTable.addColumn(column.name, 'decimal', col => {
          if (!column.isNullable) col = col.notNull()
          if (column.defaultValue) col = col.defaultTo(column.defaultValue)
          return col
        })
        break

      default:
        // Default to text for unknown types
        createTable = createTable.addColumn(column.name, 'text', col => {
          if (column.isPrimaryKey) col = col.primaryKey()
          if (!column.isNullable) col = col.notNull()
          return col
        })
    }
  }

  // Add foreign keys
  if (schema.foreignKeys && schema.foreignKeys.length > 0) {
    for (const fk of schema.foreignKeys) {
      createTable = createTable.addForeignKeyConstraint(
        `fk_${tableName}_${fk.column}`,
        [fk.column],
        fk.referencedTable,
        [fk.referencedColumn]
      )
    }
  }

  // Add indexes (after table creation)
  await createTable.execute()

  // Create additional indexes
  if (schema.indexes && schema.indexes.length > 0) {
    for (const index of schema.indexes) {
      if (!index.isPrimary) {
        let createIndex = trx.schema.createIndex(index.name)
          .on(tableName)
          .columns(index.columns)

        if (index.isUnique) {
          createIndex = createIndex.unique()
        }

        await createIndex.execute()
      }
    }
  }
}