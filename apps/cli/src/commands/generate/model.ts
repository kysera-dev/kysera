import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../utils/logger.js'
import { isJsonMode, output } from '../../utils/output.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import { DatabaseIntrospector, type TableColumn, type TableInfo } from './introspector.js'
import { buildTableFilter, internalTables } from './table-filter.js'
import { toCamelCase, toPascalCase, toKebabCase } from '../../utils/templates.js'

export interface ModelOptions {
  table?: string
  output?: string
  overwrite?: boolean
  config?: string
  timestamps?: boolean
  softDelete?: boolean
  schema?: string
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
    .option('--json', 'Output results as JSON')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
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
  await withDatabase(
    { config: options.config, schema: options.schema },
    async (db, config, schema) => {
      const generateSpinner = spinner()
      generateSpinner.start(
        `Introspecting database${schema !== 'public' ? ` (schema: ${schema})` : ''}...`
      )

      const introspector = new DatabaseIntrospector(db, config.database.dialect, schema)

      let tables: TableInfo[]
      if (tableName) {
        tables = [await introspector.getTableInfo(tableName)]
      } else {
        // Internal bookkeeping tables (migrations, lock table) are skipped
        // when generating models for the whole database.
        const filter = buildTableFilter({ internal: internalTables(config) })
        tables = (await introspector.introspect()).filter(table => filter(table.name))
      }

      generateSpinner.succeed(`Found ${tables.length} table${tables.length !== 1 ? 's' : ''}`)

      const outputDir = options.output ?? './src/models'

      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true })
        logger.debug(`Created output directory: ${outputDir}`)
      }

      let generated = 0
      const files: string[] = []

      for (const table of tables) {
        const fileName = `${toKebabCase(table.name)}.ts`
        const filePath = join(outputDir, fileName)

        if (existsSync(filePath) && options.overwrite !== true) {
          logger.warn(`Skipping ${fileName} (file exists, use --overwrite to replace)`)
          continue
        }

        const modelCode = generateModelCode(table)

        writeFileSync(filePath, modelCode, 'utf-8')
        logger.info(`${prism.green('OK')} Generated ${prism.cyan(fileName)}`)
        generated++
        files.push(filePath)
      }

      if (isJsonMode()) {
        output({ generated, files })
        return
      }

      if (generated === 0) {
        logger.warn('No models were generated')
      } else {
        logger.info('')
        logger.info(
          prism.green(`Generated ${generated} model${generated !== 1 ? 's' : ''} successfully`)
        )
      }
    }
  )
}

/**
 * The database fills this column in when an insert omits it, so the Kysely
 * table interface must mark it `Generated<...>`.
 */
function isGeneratedColumn(column: TableColumn): boolean {
  return column.isAutoIncrement || column.defaultValue !== undefined
}

function generateModelCode(table: TableInfo): string {
  const interfaceName = toPascalCase(table.name)
  const tableInterfaceName = `${interfaceName}Table`

  const mainFields = table.columns.map(column => {
    const fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(
      column.dataType,
      column.isNullable
    )
    return `  ${toCamelCase(column.name)}: ${fieldType}`
  })

  const generatedColumns = new Set(
    table.columns.filter(column => isGeneratedColumn(column)).map(column => column.name)
  )
  const tableFields = table.columns.map(column => {
    let fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(column.dataType, column.isNullable)
    if (generatedColumns.has(column.name)) {
      fieldType = `Generated<${fieldType}>`
    }
    return `  ${column.name}: ${fieldType}`
  })

  const newFields = table.columns
    .filter(
      column =>
        !column.isAutoIncrement && !(column.isPrimaryKey && column.defaultValue !== undefined)
    )
    .map(column => {
      const optional = column.isNullable || column.defaultValue !== undefined ? '?' : ''
      const fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(
        column.dataType,
        column.isNullable
      )
      return `  ${toCamelCase(column.name)}${optional}: ${fieldType}`
    })

  const updateFields = table.columns
    .filter(
      column =>
        !column.isPrimaryKey && !['created_at', 'updated_at', 'deleted_at'].includes(column.name)
    )
    .map(column => {
      const fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(
        column.dataType,
        column.isNullable
      )
      return `  ${toCamelCase(column.name)}?: ${fieldType}`
    })

  const importSection =
    generatedColumns.size > 0 ? `import type { Generated } from 'kysely'\n\n` : ''

  return `${importSection}export interface ${interfaceName} {
${mainFields.join('\n')}
}

export interface ${tableInterfaceName} {
${tableFields.join('\n')}
}

export interface New${interfaceName} {
${newFields.join('\n')}
}

export interface ${interfaceName}Update {
${updateFields.join('\n')}
}

// Register this table in your Database interface, or run
// \`kysera generate database\` to emit the full schema file:
// ${table.name}: ${tableInterfaceName}
`
}
