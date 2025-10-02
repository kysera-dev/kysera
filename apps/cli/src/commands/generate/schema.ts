import { Command } from 'commander'
import { prism, spinner } from '@xec-sh/kit'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { DatabaseIntrospector, TableInfo } from './introspector.js'

export interface SchemaOptions {
  table?: string
  output?: string
  overwrite?: boolean
  config?: string
  strict?: boolean
}

export function schemaCommand(): Command {
  const cmd = new Command('schema')
    .description('Generate Zod schema from database table')
    .argument('[table]', 'Table name to generate schema for')
    .option('-o, --output <path>', 'Output directory', './src/schemas')
    .option('--overwrite', 'Overwrite existing files', false)
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--strict', 'Use strict validation (no unknown keys)', true)
    .option('--no-strict', 'Allow unknown keys in validation')
    .action(async (table: string | undefined, options: SchemaOptions) => {
      try {
        await generateSchema(table, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to generate schema: ${error instanceof Error ? error.message : String(error)}`,
          'GENERATE_SCHEMA_ERROR'
        )
      }
    })

  return cmd
}

async function generateSchema(tableName: string | undefined, options: SchemaOptions): Promise<void> {
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

    // Generate schemas
    const outputDir = options.output || './src/schemas'

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
      logger.debug(`Created output directory: ${outputDir}`)
    }

    let generated = 0

    for (const table of tables) {
      const fileName = `${toKebabCase(table.name)}.schema.ts`
      const filePath = join(outputDir, fileName)

      // Check if file exists
      if (existsSync(filePath) && !options.overwrite) {
        logger.warn(`Skipping ${fileName} (file exists, use --overwrite to replace)`)
        continue
      }

      // Generate schema code
      const schemaCode = generateSchemaCode(table, {
        strict: options.strict !== false
      })

      // Write file
      writeFileSync(filePath, schemaCode, 'utf-8')
      logger.info(`${prism.green('✓')} Generated ${prism.cyan(fileName)}`)
      generated++
    }

    if (generated === 0) {
      logger.warn('No schemas were generated')
    } else {
      logger.info('')
      logger.info(prism.green(`✅ Generated ${generated} schema${generated !== 1 ? 's' : ''} successfully`))
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

function generateSchemaCode(table: TableInfo, options: { strict: boolean }): string {
  const entityName = toPascalCase(table.name)
  const primaryKey = table.primaryKey?.[0] || 'id'

  let imports = [`import { z } from 'zod'`]

  // Base schema with all fields
  let baseSchemaFields: string[] = []

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name)
    let zodType = DatabaseIntrospector.mapDataTypeToZod(column.dataType, column.isNullable)

    // Add constraints based on column properties
    if (column.maxLength && column.dataType.includes('char')) {
      zodType = zodType.replace('z.string()', `z.string().max(${column.maxLength})`)
    }

    // Add min constraint for primary keys
    if (column.isPrimaryKey && column.dataType.includes('int')) {
      zodType = zodType.replace('z.number().int()', 'z.number().int().positive()')
    }

    // Add email validation for email fields
    if (column.name.includes('email')) {
      zodType = 'z.string().email()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    // Add URL validation for URL fields
    if (column.name.includes('url') || column.name.includes('website')) {
      zodType = 'z.string().url()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    // Add UUID validation for UUID fields
    if (column.dataType.includes('uuid') || column.name.includes('uuid')) {
      zodType = 'z.string().uuid()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    // Add date coercion for date fields
    if (column.dataType.includes('date') || column.dataType.includes('time')) {
      zodType = 'z.coerce.date()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    baseSchemaFields.push(`  ${fieldName}: ${zodType}`)
  }

  // Generate base schema
  let baseSchema = `// Base schema with all fields
export const ${entityName}Schema = z.object({
${baseSchemaFields.join(',\n')}
})${options.strict ? '.strict()' : ''}

export type ${entityName} = z.infer<typeof ${entityName}Schema>
`

  // Generate schema for creating new records (without auto-generated fields)
  let newSchemaFields: string[] = []

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name)

    // Skip auto-generated fields
    if (column.isPrimaryKey && column.defaultValue) {
      continue
    }
    if (column.defaultValue && column.defaultValue.toLowerCase().includes('current_timestamp')) {
      continue
    }
    if (column.name === 'created_at' || column.name === 'updated_at') {
      continue
    }

    let zodType = DatabaseIntrospector.mapDataTypeToZod(column.dataType, column.isNullable)

    // Add constraints
    if (column.maxLength && column.dataType.includes('char')) {
      zodType = zodType.replace('z.string()', `z.string().max(${column.maxLength})`)
    }

    // Handle email fields
    if (column.name.includes('email')) {
      zodType = 'z.string().email()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    // Handle URL fields
    if (column.name.includes('url') || column.name.includes('website')) {
      zodType = 'z.string().url()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    // Handle UUID fields
    if (column.dataType.includes('uuid') || column.name.includes('uuid')) {
      zodType = 'z.string().uuid()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    // Handle date fields
    if (column.dataType.includes('date') || column.dataType.includes('time')) {
      zodType = 'z.coerce.date()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    // Make nullable fields or fields with defaults optional
    if (column.isNullable || column.defaultValue) {
      zodType += '.optional()'
    }

    newSchemaFields.push(`  ${fieldName}: ${zodType}`)
  }

  let newSchema = `
// Schema for creating new records
export const New${entityName}Schema = z.object({
${newSchemaFields.join(',\n')}
})${options.strict ? '.strict()' : ''}

export type New${entityName} = z.infer<typeof New${entityName}Schema>
`

  // Generate update schema (all fields optional except primary key)
  let updateSchemaFields: string[] = []

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name)

    // Skip primary keys
    if (column.isPrimaryKey) {
      continue
    }

    // Skip system fields
    if (['created_at', 'updated_at', 'deleted_at'].includes(column.name)) {
      continue
    }

    let zodType = DatabaseIntrospector.mapDataTypeToZod(column.dataType, column.isNullable)

    // Add constraints
    if (column.maxLength && column.dataType.includes('char')) {
      zodType = zodType.replace('z.string()', `z.string().max(${column.maxLength})`)
    }

    // Handle special field types
    if (column.name.includes('email')) {
      zodType = 'z.string().email()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    if (column.name.includes('url') || column.name.includes('website')) {
      zodType = 'z.string().url()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    if (column.dataType.includes('uuid') || column.name.includes('uuid')) {
      zodType = 'z.string().uuid()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    if (column.dataType.includes('date') || column.dataType.includes('time')) {
      zodType = 'z.coerce.date()'
      if (column.isNullable) {
        zodType += '.nullable()'
      }
    }

    // All fields are optional in update schema
    zodType += '.optional()'

    updateSchemaFields.push(`  ${fieldName}: ${zodType}`)
  }

  let updateSchema = `
// Schema for updating records
export const Update${entityName}Schema = z.object({
${updateSchemaFields.join(',\n')}
})${options.strict ? '.strict()' : ''}

export type Update${entityName} = z.infer<typeof Update${entityName}Schema>
`

  // Generate filter schema for queries
  let filterSchema = `
// Schema for filtering/querying records
export const ${entityName}FilterSchema = ${entityName}Schema.partial()

export type ${entityName}Filter = z.infer<typeof ${entityName}FilterSchema>
`

  // Generate ID schema for validating IDs
  const primaryKeyColumn = table.columns.find(col => col.isPrimaryKey)
  let idSchema = ''

  if (primaryKeyColumn) {
    const idType = DatabaseIntrospector.mapDataTypeToZod(primaryKeyColumn.dataType, false)
    idSchema = `
// Schema for validating ${primaryKey}
export const ${entityName}IdSchema = ${idType}

export type ${entityName}Id = z.infer<typeof ${entityName}IdSchema>
`
  }

  // Combine all parts
  const code = `${imports.join('\n')}

${baseSchema}
${newSchema}
${updateSchema}
${filterSchema}${idSchema}

// Validation helpers
export const validate${entityName} = (data: unknown) => ${entityName}Schema.parse(data)
export const validateNew${entityName} = (data: unknown) => New${entityName}Schema.parse(data)
export const validateUpdate${entityName} = (data: unknown) => Update${entityName}Schema.parse(data)
export const validate${entityName}Filter = (data: unknown) => ${entityName}FilterSchema.parse(data)${
  primaryKeyColumn ? `
export const validate${entityName}Id = (id: unknown) => ${entityName}IdSchema.parse(id)` : ''
}

// Safe parse helpers (return result object instead of throwing)
export const safeParse${entityName} = (data: unknown) => ${entityName}Schema.safeParse(data)
export const safeParseNew${entityName} = (data: unknown) => New${entityName}Schema.safeParse(data)
export const safeParseUpdate${entityName} = (data: unknown) => Update${entityName}Schema.safeParse(data)
export const safeParse${entityName}Filter = (data: unknown) => ${entityName}FilterSchema.safeParse(data)${
  primaryKeyColumn ? `
export const safeParse${entityName}Id = (id: unknown) => ${entityName}IdSchema.safeParse(id)` : ''
}
`

  return code
}

// Utility functions
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