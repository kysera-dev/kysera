import { Command } from 'commander'
import { prism, spinner } from '@xec-sh/kit'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { DatabaseIntrospector, TableInfo } from './introspector.js'

export interface ModelOptions {
  table?: string
  output?: string
  overwrite?: boolean
  config?: string
  timestamps?: boolean
  softDelete?: boolean
}

export function modelCommand(): Command {
  const cmd = new Command('model')
    .description('Generate TypeScript model from database table')
    .argument('[table]', 'Table name to generate model for')
    .option('-o, --output <path>', 'Output directory', './src/models')
    .option('--overwrite', 'Overwrite existing files', false)
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--timestamps', 'Include timestamp fields', true)
    .option('--no-timestamps', 'Exclude timestamp fields')
    .option('--soft-delete', 'Include soft delete fields', false)
    .action(async (table: string | undefined, options: ModelOptions) => {
      try {
        await generateModel(table, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to generate model: ${error instanceof Error ? error.message : String(error)}`,
          'GENERATE_MODEL_ERROR'
        )
      }
    })

  return cmd
}

async function generateModel(tableName: string | undefined, options: ModelOptions): Promise<void> {
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

  const generateSpinner = spinner()
  generateSpinner.start('Introspecting database...')

  try {
    const introspector = new DatabaseIntrospector(db, config.database.dialect as any)

    // Get table information
    let tables: TableInfo[] = []

    if (tableName) {
      // Generate for specific table
      const tableInfo = await introspector.getTableInfo(tableName)
      tables = [tableInfo]
    } else {
      // Generate for all tables
      tables = await introspector.introspect()
    }

    generateSpinner.succeed(`Found ${tables.length} table${tables.length !== 1 ? 's' : ''}`)

    // Generate models
    const outputDir = options.output || './src/models'

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
      logger.debug(`Created output directory: ${outputDir}`)
    }

    let generated = 0

    for (const table of tables) {
      const fileName = `${toKebabCase(table.name)}.ts`
      const filePath = join(outputDir, fileName)

      // Check if file exists
      if (existsSync(filePath) && !options.overwrite) {
        logger.warn(`Skipping ${fileName} (file exists, use --overwrite to replace)`)
        continue
      }

      // Generate model code
      const modelCode = generateModelCode(table, {
        timestamps: options.timestamps !== false,
        softDelete: options.softDelete === true
      })

      // Write file
      writeFileSync(filePath, modelCode, 'utf-8')
      logger.info(`${prism.green('✓')} Generated ${prism.cyan(fileName)}`)
      generated++
    }

    if (generated === 0) {
      logger.warn('No models were generated')
    } else {
      logger.info('')
      logger.info(prism.green(`✅ Generated ${generated} model${generated !== 1 ? 's' : ''} successfully`))
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

function generateModelCode(table: TableInfo, options: { timestamps: boolean, softDelete: boolean }): string {
  const interfaceName = toPascalCase(table.name)
  const tableInterfaceName = `${interfaceName}Table`

  let imports = [`import type { Generated } from 'kysely'`]

  // Generate main interface
  let mainInterface = `export interface ${interfaceName} {\n`

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name)
    const fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(column.dataType, column.isNullable)

    mainInterface += `  ${fieldName}: ${fieldType}\n`
  }

  mainInterface += '}\n'

  // Generate table interface for Kysely
  let tableInterface = `export interface ${tableInterfaceName} {\n`

  for (const column of table.columns) {
    const fieldName = column.name // Keep original column name for database
    let fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(column.dataType, column.isNullable)

    // Wrap auto-generated columns with Generated<>
    if (column.isPrimaryKey && column.defaultValue) {
      fieldType = `Generated<${fieldType}>`
    } else if (column.defaultValue && column.defaultValue.toLowerCase().includes('current_timestamp')) {
      fieldType = `Generated<${fieldType}>`
    }

    tableInterface += `  ${fieldName}: ${fieldType}\n`
  }

  tableInterface += '}\n'

  // Generate NewModel interface (for inserts)
  let newInterface = `export interface New${interfaceName} {\n`

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name)

    // Skip auto-generated fields
    if (column.isPrimaryKey && column.defaultValue) {
      continue
    }
    if (column.defaultValue && column.defaultValue.toLowerCase().includes('current_timestamp')) {
      continue
    }

    let fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(column.dataType, column.isNullable)

    // Make nullable fields optional
    if (column.isNullable || column.defaultValue) {
      newInterface += `  ${fieldName}?: ${fieldType}\n`
    } else {
      newInterface += `  ${fieldName}: ${fieldType}\n`
    }
  }

  newInterface += '}\n'

  // Generate UpdateModel interface (for updates)
  let updateInterface = `export interface ${interfaceName}Update {\n`

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name)

    // Skip primary keys in updates
    if (column.isPrimaryKey) {
      continue
    }

    // Skip system fields
    if (['created_at', 'updated_at', 'deleted_at'].includes(column.name)) {
      continue
    }

    const fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(column.dataType, column.isNullable)
    updateInterface += `  ${fieldName}?: ${fieldType}\n`
  }

  updateInterface += '}\n'

  // Generate Database interface addition comment
  const databaseAddition = `// Add this to your Database interface:
// ${table.name}: ${tableInterfaceName}`

  // Combine all parts
  const code = `${imports.join('\n')}

${mainInterface}

${tableInterface}

${newInterface}

${updateInterface}

${databaseAddition}
`

  return code
}

// Utility functions for name conversion
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

function toKebabCase(str: string): string {
  return str.replace(/_/g, '-')
}