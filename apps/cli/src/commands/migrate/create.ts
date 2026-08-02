import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { diag, isJsonMode, output } from '../../utils/output.js'
import { MIGRATION_TEMPLATES, parseColumns, type ParsedColumn } from './templates.js'

export interface CreateCommandOptions {
  dir?: string
  directory?: string
  template?: string
  ts?: boolean
  table?: string
  columns?: string
  json?: boolean
}

interface TemplateData {
  table?: string
  columns?: ParsedColumn[]
}

export function createCommand(): Command {
  const cmd = new Command('create')
    .description('Create a new migration file')
    .argument('<name>', 'Migration name')
    .option('-d, --dir <path>', 'Migration directory', './migrations')
    .option('--directory <path>', 'Migration directory (alias for --dir)', './migrations')
    .option('-t, --template <type>', 'Migration template', 'default')
    .option('--ts', 'Generate TypeScript file', true)
    .option('--no-ts', 'Generate JavaScript file')
    .option('--table <name>', 'Table name for table-based templates')
    .option('--columns <list>', 'Comma-separated column definitions (name:type:nullable:default)')
    .option('--json', 'Output results as JSON')
    .action((name: string, options: CreateCommandOptions, command: Command) => {
      try {
        createMigration(name, options, command)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to create migration: ${error instanceof Error ? error.message : String(error)}`,
          'CREATE_MIGRATION_ERROR'
        )
      }
    })

  return cmd
}

/** `--dir` wins when given explicitly; `--directory` is honored otherwise. */
function resolveDirectory(command: Command, options: CreateCommandOptions): string {
  if (command.getOptionValueSource('dir') === 'cli' && options.dir !== undefined) {
    return options.dir
  }
  if (command.getOptionValueSource('directory') === 'cli' && options.directory !== undefined) {
    return options.directory
  }
  return options.dir ?? './migrations'
}

function createMigration(name: string, options: CreateCommandOptions, command: Command): void {
  const directory = resolveDirectory(command, options)
  const template = options.template ?? 'default'
  const useTypeScript = options.ts !== false

  if (!Object.hasOwn(MIGRATION_TEMPLATES, template)) {
    throw new CLIError(`Invalid template: ${template}`, 'INVALID_TEMPLATE', undefined, [
      `Available templates: ${Object.keys(MIGRATION_TEMPLATES).join(', ')}`
    ])
  }

  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true })
  }

  const timestamp = generateTimestamp()
  const safeName = name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()
  const extension = useTypeScript ? '.ts' : '.js'
  const filename = `${timestamp}_${safeName}${extension}`
  const filepath = join(directory, filename)

  if (existsSync(filepath)) {
    throw new CLIError(`Migration file already exists: ${filename}`, 'FILE_EXISTS')
  }

  const templateData: TemplateData = {}
  if (options.table !== undefined) {
    templateData.table = options.table
  }
  if (options.columns !== undefined) {
    templateData.columns = parseColumns(options.columns)
  }

  // Templates that alter an existing table need to know which one
  const tableTemplates = ['alter-table', 'add-columns', 'drop-columns', 'add-foreign-key']
  if (tableTemplates.includes(template) && templateData.table === undefined) {
    throw new CLIError(`Template '${template}' requires --table option`, 'MISSING_TABLE')
  }

  if (template === 'create-table' && templateData.table === undefined) {
    // Derive the table name from the migration name ("add_posts" -> "posts")
    const derived = safeName.replace(/^(add_|create_)/, '')
    templateData.table = derived !== '' && derived !== safeName ? derived : 'table_name'
  }

  if (template === 'create-index' && templateData.table === undefined) {
    templateData.table = 'table_name'
  }

  let content = MIGRATION_TEMPLATES[template as keyof typeof MIGRATION_TEMPLATES]
  if (content.includes('{{')) {
    content = processTemplate(content, templateData)
  }
  if (content.includes('sql`')) {
    content = content.replace('import { Kysely }', 'import { Kysely, sql }')
  }

  writeFileSync(filepath, content, 'utf-8')

  if (options.json === true || isJsonMode()) {
    output(
      { name: safeName, filename, path: filepath, template, timestamp },
      { format: 'json' }
    )
    return
  }

  output(`Migration created: ${filename}`)
  diag(`${prism.green('✓')} Created migration: ${prism.cyan(filename)}`)
  diag(`  ${prism.gray(filepath)}`)
  diag('')
  diag('Next steps:')
  diag('  1. Edit the migration file to add your changes')
  diag(`  2. Run ${prism.cyan('kysera migrate up')} to apply the migration`)
}

function generateTimestamp(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')

  return `${year}${month}${day}${hours}${minutes}${seconds}`
}

function processTemplate(template: string, data: TemplateData): string {
  let result = template

  if (data.table !== undefined) {
    result = result.replace(/\{\{table\}\}/g, data.table)
  }

  const columns = data.columns
  if (columns !== undefined && columns.length > 0) {
    const eachRegex = /\{\{#each columns\}\}([\s\S]*?)\{\{\/each\}\}/g
    result = result.replace(eachRegex, (_match, body: string) =>
      columns
        .map(col => {
          let line = body
            .replace(/\{\{this\.name\}\}/g, col.name)
            .replace(/\{\{this\.type\}\}/g, col.type)
            .replace(/\{\{this\}\}/g, col.name)

          if (col.nullable) {
            line = line.replace(/\{\{#if this\.nullable\}\}.*?\{\{else\}\}(.*?)\{\{\/if\}\}/g, '')
          } else {
            line = line.replace(
              /\{\{#if this\.nullable\}\}(.*?)\{\{else\}\}(.*?)\{\{\/if\}\}/g,
              '$2'
            )
          }

          if (col.defaultValue !== undefined) {
            line = line.replace(/\{\{#if this\.defaultValue\}\}(.*?)\{\{\/if\}\}/g, '$1')
            line = line.replace(/\{\{this\.defaultValue\}\}/g, col.defaultValue)
          } else {
            line = line.replace(/\{\{#if this\.defaultValue\}\}.*?\{\{\/if\}\}/g, '')
          }

          return line
        })
        .join('')
    )
  } else {
    result = result.replace(/\s*\{\{#each columns\}\}[\s\S]*?\{\{\/each\}\}/g, '')
  }

  // Placeholders without CLI flags fall back to their defaults
  result = result.replace(/\{\{indexName\}\}/g, 'idx')
  result = result.replace(/\{\{column\}\}/g, '')
  result = result.replace(/\{\{referencedTable\}\}/g, '')
  result = result.replace(/\{\{referencedColumn\}\}/g, 'id')
  result = result.replace(/\{\{#if unique\}\}(.*?)\{\{\/if\}\}/g, '')
  result = result.replace(/\{\{#if onDelete\}\}(.*?)\{\{\/if\}\}/g, '')
  result = result.replace(/\{\{#if onUpdate\}\}(.*?)\{\{\/if\}\}/g, '')
  result = result.replace(/\{\{onDelete\}\}/g, 'CASCADE')
  result = result.replace(/\{\{onUpdate\}\}/g, 'CASCADE')

  return result
}
