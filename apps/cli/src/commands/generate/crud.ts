import { Command } from 'commander'
import { prism, spinner, confirm } from '@xec-sh/kit'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { DatabaseIntrospector, TableInfo } from './introspector.js'
import { execSync } from 'node:child_process'

export interface CrudOptions {
  table: string
  outputDir?: string
  overwrite?: boolean
  config?: string
  withValidation?: boolean
  withPagination?: boolean
  withSoftDelete?: boolean
  withTimestamps?: boolean
  format?: boolean
}

export function crudCommand(): Command {
  const cmd = new Command('crud')
    .description('Generate complete CRUD stack (model, repository, schema) for a table')
    .argument('<table>', 'Table name to generate CRUD for')
    .option('-o, --output-dir <path>', 'Base output directory', './src')
    .option('--overwrite', 'Overwrite existing files', false)
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--with-validation', 'Include Zod validation', true)
    .option('--no-with-validation', 'Skip Zod validation')
    .option('--with-pagination', 'Include pagination methods', true)
    .option('--no-with-pagination', 'Skip pagination methods')
    .option('--with-soft-delete', 'Include soft delete support', false)
    .option('--with-timestamps', 'Include timestamp support', true)
    .option('--no-with-timestamps', 'Skip timestamp support')
    .option('--format', 'Format generated files with Prettier', true)
    .option('--no-format', 'Skip formatting')
    .action(async (table: string, options: CrudOptions) => {
      try {
        await generateCrud(table, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to generate CRUD: ${error instanceof Error ? error.message : String(error)}`,
          'GENERATE_CRUD_ERROR'
        )
      }
    })

  return cmd
}

async function generateCrud(tableName: string, options: CrudOptions): Promise<void> {
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
  generateSpinner.start(`Introspecting table '${tableName}'...`)

  try {
    const introspector = new DatabaseIntrospector(db, config.database.dialect as any)

    // Get table information
    let tableInfo: TableInfo
    try {
      tableInfo = await introspector.getTableInfo(tableName)
    } catch (error) {
      generateSpinner.fail(`Table '${tableName}' not found`)
      throw new CLIError(
        `Table '${tableName}' does not exist in the database`,
        'TABLE_NOT_FOUND',
        ['Check the table name spelling', 'Ensure you are connected to the correct database']
      )
    }

    generateSpinner.succeed(`Found table '${tableName}' with ${tableInfo.columns.length} columns`)

    // Check for existing files
    const outputDir = options.outputDir || './src'
    const filesToGenerate = [
      {
        type: 'Model',
        path: join(outputDir, 'models', `${toKebabCase(tableName)}.ts`),
        generator: generateModelCode
      },
      {
        type: 'Repository',
        path: join(outputDir, 'repositories', `${toKebabCase(tableName)}.repository.ts`),
        generator: generateRepositoryCode
      },
      {
        type: 'Schema',
        path: join(outputDir, 'schemas', `${toKebabCase(tableName)}.schema.ts`),
        generator: generateSchemaCode
      }
    ]

    if (!options.overwrite) {
      const existingFiles = filesToGenerate.filter(f => existsSync(f.path))

      if (existingFiles.length > 0) {
        console.log('')
        console.log(prism.yellow('The following files already exist:'))
        for (const file of existingFiles) {
          console.log(`  • ${file.type}: ${prism.cyan(file.path)}`)
        }
        console.log('')

        const shouldOverwrite = await confirm({
          message: 'Do you want to overwrite these files?',
          initialValue: false
        })

        if (!shouldOverwrite) {
          logger.info('Generation cancelled')
          return
        }
      }
    }

    // Generate all files
    console.log('')
    logger.info('Generating CRUD stack...')

    const generatedFiles: string[] = []

    for (const file of filesToGenerate) {
      // Ensure directory exists
      const dir = join(file.path, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      // Generate code
      const code = file.generator(tableInfo, {
        withValidation: options.withValidation !== false,
        withPagination: options.withPagination !== false,
        withSoftDelete: options.withSoftDelete === true,
        withTimestamps: options.withTimestamps !== false
      })

      // Write file
      writeFileSync(file.path, code, 'utf-8')
      logger.info(`  ${prism.green('✓')} Generated ${file.type}: ${prism.cyan(file.path)}`)
      generatedFiles.push(file.path)
    }

    // Format files if requested
    if (options.format !== false && generatedFiles.length > 0) {
      try {
        const formatSpinner = spinner()
        formatSpinner.start('Formatting generated files...')

        execSync(`npx prettier --write ${generatedFiles.join(' ')}`, {
          stdio: 'ignore'
        })

        formatSpinner.succeed('Files formatted successfully')
      } catch (error) {
        logger.warn('Failed to format files (Prettier may not be installed)')
      }
    }

    // Generate index file to export everything
    const indexPath = join(outputDir, 'index.ts')
    const indexExports = [
      `export * from './models/${toKebabCase(tableName)}.js'`,
      `export * from './repositories/${toKebabCase(tableName)}.repository.js'`,
      `export * from './schemas/${toKebabCase(tableName)}.schema.js'`
    ]

    if (existsSync(indexPath)) {
      // Append to existing index
      const existingContent = require('fs').readFileSync(indexPath, 'utf-8')
      const newExports = indexExports.filter(exp => !existingContent.includes(exp))

      if (newExports.length > 0) {
        require('fs').appendFileSync(indexPath, '\n' + newExports.join('\n'), 'utf-8')
        logger.info(`  ${prism.green('✓')} Updated index file`)
      }
    } else {
      // Create new index
      writeFileSync(indexPath, indexExports.join('\n') + '\n', 'utf-8')
      logger.info(`  ${prism.green('✓')} Created index file`)
    }

    // Success message
    console.log('')
    console.log(prism.green('✨ CRUD stack generated successfully!'))
    console.log('')
    console.log('Next steps:')
    console.log(`  1. Update your Database interface in ${prism.cyan('src/database.ts')}:`)
    console.log(`     ${prism.gray(`${tableName}: ${toPascalCase(tableName)}Table`)}`)
    console.log(`  2. Import and use the generated repository:`)
    console.log(`     ${prism.gray(`import { ${toPascalCase(tableName)}Repository } from './repositories/${toKebabCase(tableName)}.repository.js'`)}`)
    console.log(`     ${prism.gray(`const repo = new ${toPascalCase(tableName)}Repository(db)`)}`)
    console.log(`  3. Run migrations if needed:`)
    console.log(`     ${prism.gray('kysera migrate up')}`)
    console.log('')

  } finally {
    // Close database connection
    await db.destroy()
  }
}

// Import generator functions (simplified versions)
function generateModelCode(table: TableInfo, options: any): string {
  const entityName = toPascalCase(table.name)
  const tableInterfaceName = `${entityName}Table`

  let code = `import type { Generated } from 'kysely'

export interface ${entityName} {
${table.columns.map(col =>
  `  ${toCamelCase(col.name)}: ${DatabaseIntrospector.mapDataTypeToTypeScript(col.dataType, col.isNullable)}`
).join('\n')}
}

export interface ${tableInterfaceName} {
${table.columns.map(col => {
  let type = DatabaseIntrospector.mapDataTypeToTypeScript(col.dataType, col.isNullable)
  if (col.isPrimaryKey && col.defaultValue) {
    type = `Generated<${type}>`
  }
  return `  ${col.name}: ${type}`
}).join('\n')}
}

export interface New${entityName} {
${table.columns
  .filter(col => !(col.isPrimaryKey && col.defaultValue))
  .map(col => {
    const optional = col.isNullable || col.defaultValue ? '?' : ''
    return `  ${toCamelCase(col.name)}${optional}: ${DatabaseIntrospector.mapDataTypeToTypeScript(col.dataType, col.isNullable)}`
  }).join('\n')}
}

export interface ${entityName}Update {
${table.columns
  .filter(col => !col.isPrimaryKey && !['created_at', 'updated_at', 'deleted_at'].includes(col.name))
  .map(col =>
    `  ${toCamelCase(col.name)}?: ${DatabaseIntrospector.mapDataTypeToTypeScript(col.dataType, col.isNullable)}`
  ).join('\n')}
}
`

  return code
}

function generateRepositoryCode(table: TableInfo, options: any): string {
  const entityName = toPascalCase(table.name)
  const repositoryName = `${entityName}Repository`
  const tableName = table.name
  const primaryKey = table.primaryKey?.[0] || 'id'

  let imports: string[] = [
    `import { Kysely } from 'kysely'`,
    `import type { ${entityName}, New${entityName}, ${entityName}Update } from '../models/${toKebabCase(table.name)}.js'`,
    `import type { Database } from '../database.js'`
  ]

  if (options.withPagination) {
    imports.push(`import { paginate, type PaginationOptions, type PaginatedResult } from '@kysera/core'`)
  }

  if (options.withValidation) {
    imports.push(`import { New${entityName}Schema, Update${entityName}Schema } from '../schemas/${toKebabCase(table.name)}.schema.js'`)
  }

  let code = `${imports.join('\n')}

export class ${repositoryName} {
  constructor(private db: Kysely<Database>) {}

  async findById(id: ${getPrimaryKeyType(table)}): Promise<${entityName} | undefined> {
    return await this.db
      .selectFrom('${tableName}')
      .selectAll()
      .where('${primaryKey}', '=', id)
      .executeTakeFirst() as ${entityName} | undefined
  }

  async findAll(): Promise<${entityName}[]> {
    return await this.db
      .selectFrom('${tableName}')
      .selectAll()
      .execute() as ${entityName}[]
  }

  async create(data: New${entityName}): Promise<${entityName}> {
    ${options.withValidation ? `const validated = New${entityName}Schema.parse(data)` : ''}
    return await this.db
      .insertInto('${tableName}')
      .values(${options.withValidation ? 'validated' : 'data'} as any)
      .returningAll()
      .executeTakeFirstOrThrow() as ${entityName}
  }

  async update(id: ${getPrimaryKeyType(table)}, data: ${entityName}Update): Promise<${entityName}> {
    ${options.withValidation ? `const validated = Update${entityName}Schema.parse(data)` : ''}
    return await this.db
      .updateTable('${tableName}')
      .set(${options.withValidation ? 'validated' : 'data'} as any)
      .where('${primaryKey}', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow() as ${entityName}
  }

  async delete(id: ${getPrimaryKeyType(table)}): Promise<void> {
    await this.db
      .deleteFrom('${tableName}')
      .where('${primaryKey}', '=', id)
      .execute()
  }

  async count(): Promise<number> {
    const result = await this.db
      .selectFrom('${tableName}')
      .select(this.db.fn.countAll().as('count'))
      .executeTakeFirst()
    return Number(result?.count ?? 0)
  }
}

export const ${toCamelCase(table.name)}Repository = (db: Kysely<Database>) => new ${repositoryName}(db)
`

  return code
}

function generateSchemaCode(table: TableInfo, options: any): string {
  const entityName = toPascalCase(table.name)

  let code = `import { z } from 'zod'

export const ${entityName}Schema = z.object({
${table.columns.map(col =>
  `  ${toCamelCase(col.name)}: ${DatabaseIntrospector.mapDataTypeToZod(col.dataType, col.isNullable)}`
).join(',\n')}
}).strict()

export const New${entityName}Schema = z.object({
${table.columns
  .filter(col => !(col.isPrimaryKey && col.defaultValue) && !['created_at', 'updated_at'].includes(col.name))
  .map(col => {
    let zodType = DatabaseIntrospector.mapDataTypeToZod(col.dataType, col.isNullable)
    if (col.isNullable || col.defaultValue) {
      zodType += '.optional()'
    }
    return `  ${toCamelCase(col.name)}: ${zodType}`
  }).join(',\n')}
}).strict()

export const Update${entityName}Schema = z.object({
${table.columns
  .filter(col => !col.isPrimaryKey && !['created_at', 'updated_at', 'deleted_at'].includes(col.name))
  .map(col =>
    `  ${toCamelCase(col.name)}: ${DatabaseIntrospector.mapDataTypeToZod(col.dataType, col.isNullable)}.optional()`
  ).join(',\n')}
}).strict()

export type ${entityName} = z.infer<typeof ${entityName}Schema>
export type New${entityName} = z.infer<typeof New${entityName}Schema>
export type Update${entityName} = z.infer<typeof Update${entityName}Schema>
`

  return code
}

function getPrimaryKeyType(table: TableInfo): string {
  const primaryKeyColumn = table.columns.find(col => col.isPrimaryKey)
  if (!primaryKeyColumn) {
    return 'number'
  }
  return DatabaseIntrospector.mapDataTypeToTypeScript(primaryKeyColumn.dataType, false)
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