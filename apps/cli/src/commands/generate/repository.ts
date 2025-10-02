import { Command } from 'commander'
import { prism, spinner } from '@xec-sh/kit'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { DatabaseIntrospector, TableInfo } from './introspector.js'

export interface RepositoryOptions {
  table?: string
  output?: string
  overwrite?: boolean
  config?: string
  withValidation?: boolean
  withPagination?: boolean
  withSoftDelete?: boolean
  withTimestamps?: boolean
}

export function repositoryCommand(): Command {
  const cmd = new Command('repository')
    .description('Generate repository from database table')
    .argument('[table]', 'Table name to generate repository for')
    .option('-o, --output <path>', 'Output directory', './src/repositories')
    .option('--overwrite', 'Overwrite existing files', false)
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--with-validation', 'Include Zod validation', true)
    .option('--no-with-validation', 'Skip Zod validation')
    .option('--with-pagination', 'Include pagination methods', true)
    .option('--no-with-pagination', 'Skip pagination methods')
    .option('--with-soft-delete', 'Include soft delete support', false)
    .option('--with-timestamps', 'Include timestamp support', true)
    .option('--no-with-timestamps', 'Skip timestamp support')
    .action(async (table: string | undefined, options: RepositoryOptions) => {
      try {
        await generateRepository(table, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to generate repository: ${error instanceof Error ? error.message : String(error)}`,
          'GENERATE_REPOSITORY_ERROR'
        )
      }
    })

  return cmd
}

async function generateRepository(tableName: string | undefined, options: RepositoryOptions): Promise<void> {
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

    // Generate repositories
    const outputDir = options.output || './src/repositories'

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
      logger.debug(`Created output directory: ${outputDir}`)
    }

    let generated = 0

    for (const table of tables) {
      const fileName = `${toKebabCase(table.name)}.repository.ts`
      const filePath = join(outputDir, fileName)

      // Check if file exists
      if (existsSync(filePath) && !options.overwrite) {
        logger.warn(`Skipping ${fileName} (file exists, use --overwrite to replace)`)
        continue
      }

      // Generate repository code
      const repositoryCode = generateRepositoryCode(table, {
        withValidation: options.withValidation !== false,
        withPagination: options.withPagination !== false,
        withSoftDelete: options.withSoftDelete === true,
        withTimestamps: options.withTimestamps !== false
      })

      // Write file
      writeFileSync(filePath, repositoryCode, 'utf-8')
      logger.info(`${prism.green('✓')} Generated ${prism.cyan(fileName)}`)
      generated++
    }

    if (generated === 0) {
      logger.warn('No repositories were generated')
    } else {
      logger.info('')
      logger.info(prism.green(`✅ Generated ${generated} repositor${generated !== 1 ? 'ies' : 'y'} successfully`))
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

function generateRepositoryCode(
  table: TableInfo,
  options: {
    withValidation: boolean
    withPagination: boolean
    withSoftDelete: boolean
    withTimestamps: boolean
  }
): string {
  const entityName = toPascalCase(table.name)
  const repositoryName = `${entityName}Repository`
  const tableName = table.name
  const primaryKey = table.primaryKey?.[0] || 'id'

  let imports: string[] = [
    `import { Kysely } from 'kysely'`,
    `import type { ${entityName}, New${entityName}, ${entityName}Update, ${entityName}Table } from '../models/${toKebabCase(table.name)}.js'`,
    `import type { Database } from '../database.js'`
  ]

  if (options.withPagination) {
    imports.push(`import { paginate, type PaginationOptions, type PaginatedResult } from '@kysera/core'`)
  }

  if (options.withValidation) {
    imports.push(`import { ${entityName}Schema, New${entityName}Schema, Update${entityName}Schema } from '../schemas/${toKebabCase(table.name)}.schema.js'`)
  }

  if (options.withSoftDelete) {
    imports.push(`import { withSoftDelete } from '@kysera/soft-delete'`)
  }

  if (options.withTimestamps) {
    imports.push(`import { withTimestamps } from '@kysera/timestamps'`)
  }

  // Generate repository class
  let classCode = `export class ${repositoryName} {
  constructor(private db: Kysely<Database>) {`

  if (options.withSoftDelete) {
    classCode += `
    // Apply soft delete plugin if not already applied
    this.db = withSoftDelete(this.db)`
  }

  if (options.withTimestamps) {
    classCode += `
    // Apply timestamps plugin if not already applied
    this.db = withTimestamps(this.db)`
  }

  classCode += `
  }

  /**
   * Find a ${entityName.toLowerCase()} by ${primaryKey}
   */
  async findById(${primaryKey}: ${getPrimaryKeyType(table)}): Promise<${entityName} | undefined> {
    const result = await this.db
      .selectFrom('${tableName}')
      .selectAll()
      .where('${primaryKey}', '=', ${primaryKey})`

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`
  }

  classCode += `
      .executeTakeFirst()

    return result as ${entityName} | undefined
  }

  /**
   * Find all ${table.name}
   */
  async findAll(): Promise<${entityName}[]> {
    const results = await this.db
      .selectFrom('${tableName}')
      .selectAll()`

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`
  }

  classCode += `
      .execute()

    return results as ${entityName}[]
  }

  /**
   * Find ${table.name} with filters
   */
  async findMany(filters: Partial<${entityName}>): Promise<${entityName}[]> {
    let query = this.db
      .selectFrom('${tableName}')
      .selectAll()`

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`
  }

  classCode += `

    // Apply filters
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) {
        query = query.where(key as any, '=', value as any)
      }
    }

    const results = await query.execute()
    return results as ${entityName}[]
  }
`

  if (options.withPagination) {
    classCode += `
  /**
   * Find ${table.name} with pagination
   */
  async findPaginated(
    options: PaginationOptions<${entityName}Table> = {}
  ): Promise<PaginatedResult<${entityName}>> {
    let query = this.db
      .selectFrom('${tableName}')
      .selectAll()`

    if (options.withSoftDelete) {
      classCode += `
      .where('deleted_at', 'is', null)`
    }

    classCode += `

    return paginate(query, options) as Promise<PaginatedResult<${entityName}>>
  }
`
  }

  classCode += `
  /**
   * Create a new ${entityName.toLowerCase()}
   */
  async create(data: New${entityName}): Promise<${entityName}> {`

  if (options.withValidation) {
    classCode += `
    // Validate input
    const validated = New${entityName}Schema.parse(data)
`
  }

  classCode += `
    const result = await this.db
      .insertInto('${tableName}')
      .values(${options.withValidation ? 'validated' : 'data'} as any)
      .returningAll()
      .executeTakeFirstOrThrow()

    return result as ${entityName}
  }

  /**
   * Update a ${entityName.toLowerCase()}
   */
  async update(${primaryKey}: ${getPrimaryKeyType(table)}, data: ${entityName}Update): Promise<${entityName}> {`

  if (options.withValidation) {
    classCode += `
    // Validate input
    const validated = Update${entityName}Schema.parse(data)
`
  }

  classCode += `
    const result = await this.db
      .updateTable('${tableName}')
      .set(${options.withValidation ? 'validated' : 'data'} as any)
      .where('${primaryKey}', '=', ${primaryKey})`

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`
  }

  classCode += `
      .returningAll()
      .executeTakeFirstOrThrow()

    return result as ${entityName}
  }

  /**
   * Delete a ${entityName.toLowerCase()}
   */
  async delete(${primaryKey}: ${getPrimaryKeyType(table)}): Promise<void> {`

  if (options.withSoftDelete) {
    classCode += `
    // Soft delete
    await this.db
      .updateTable('${tableName}')
      .set({ deleted_at: new Date() } as any)
      .where('${primaryKey}', '=', ${primaryKey})
      .execute()`
  } else {
    classCode += `
    await this.db
      .deleteFrom('${tableName}')
      .where('${primaryKey}', '=', ${primaryKey})
      .execute()`
  }

  classCode += `
  }
`

  if (options.withSoftDelete) {
    classCode += `
  /**
   * Restore a soft-deleted ${entityName.toLowerCase()}
   */
  async restore(${primaryKey}: ${getPrimaryKeyType(table)}): Promise<${entityName}> {
    const result = await this.db
      .updateTable('${tableName}')
      .set({ deleted_at: null } as any)
      .where('${primaryKey}', '=', ${primaryKey})
      .returningAll()
      .executeTakeFirstOrThrow()

    return result as ${entityName}
  }

  /**
   * Find soft-deleted ${table.name}
   */
  async findDeleted(): Promise<${entityName}[]> {
    const results = await this.db
      .selectFrom('${tableName}')
      .selectAll()
      .where('deleted_at', 'is not', null)
      .execute()

    return results as ${entityName}[]
  }

  /**
   * Permanently delete a ${entityName.toLowerCase()}
   */
  async forceDelete(${primaryKey}: ${getPrimaryKeyType(table)}): Promise<void> {
    await this.db
      .deleteFrom('${tableName}')
      .where('${primaryKey}', '=', ${primaryKey})
      .execute()
  }
`
  }

  classCode += `
  /**
   * Count ${table.name}
   */
  async count(filters?: Partial<${entityName}>): Promise<number> {
    let query = this.db
      .selectFrom('${tableName}')
      .select(this.db.fn.countAll().as('count'))`

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`
  }

  classCode += `

    // Apply filters if provided
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined) {
          query = query.where(key as any, '=', value as any)
        }
      }
    }

    const result = await query.executeTakeFirst()
    return Number(result?.count ?? 0)
  }

  /**
   * Check if a ${entityName.toLowerCase()} exists
   */
  async exists(${primaryKey}: ${getPrimaryKeyType(table)}): Promise<boolean> {
    const result = await this.db
      .selectFrom('${tableName}')
      .select(this.db.fn.countAll().as('count'))
      .where('${primaryKey}', '=', ${primaryKey})`

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`
  }

  classCode += `
      .executeTakeFirst()

    return Number(result?.count ?? 0) > 0
  }
}

// Export singleton instance
export const ${toCamelCase(table.name)}Repository = (db: Kysely<Database>) => new ${repositoryName}(db)
`

  // Combine all parts
  return `${imports.join('\n')}

${classCode}`
}

function getPrimaryKeyType(table: TableInfo): string {
  const primaryKeyColumn = table.columns.find(col => col.isPrimaryKey)
  if (!primaryKeyColumn) {
    return 'number' // Default to number
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