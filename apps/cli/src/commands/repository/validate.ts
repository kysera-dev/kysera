import { Command } from 'commander'
import { prism, spinner, table, confirm } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface ValidateRepositoryOptions {
  directory?: string
  pattern?: string
  fix?: boolean
  strict?: boolean
  showDetails?: boolean
  json?: boolean
  config?: string
}

interface ValidationResult {
  repository: string
  tableName: string
  file: string
  valid: boolean
  issues: ValidationIssue[]
  suggestions: string[]
}

interface ValidationIssue {
  type: 'missing_table' | 'missing_column' | 'type_mismatch' | 'constraint_mismatch' | 'naming_convention' | 'missing_index'
  severity: 'error' | 'warning' | 'info'
  field?: string
  expected?: string
  actual?: string
  message: string
  fixable: boolean
}

interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  default?: string
  isPrimary: boolean
  isUnique: boolean
}

export function validateRepositoryCommand(): Command {
  const cmd = new Command('validate')
    .description('Validate repository schemas against database')
    .option('-d, --directory <path>', 'Directory to scan', 'src')
    .option('-p, --pattern <glob>', 'File pattern to match', '**/*Repository.ts')
    .option('--fix', 'Attempt to fix issues', false)
    .option('--strict', 'Enable strict validation', false)
    .option('--show-details', 'Show detailed validation results', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: ValidateRepositoryOptions) => {
      try {
        await validateRepositories(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to validate repositories: ${error instanceof Error ? error.message : String(error)}`,
          'REPOSITORY_VALIDATE_ERROR'
        )
      }
    })

  return cmd
}

async function validateRepositories(options: ValidateRepositoryOptions): Promise<void> {
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

  const validateSpinner = spinner()
  validateSpinner.start('Scanning for repository files...')

  try {
    // Get database connection
    const db = await getDatabaseConnection(config.database)

    if (!db) {
      throw new CLIError(
        'Failed to connect to database',
        'DATABASE_ERROR',
        ['Check your database configuration', 'Ensure the database server is running']
      )
    }

    // Find repository files
    const projectRoot = process.cwd()
    const scanDirectory = path.join(projectRoot, options.directory || 'src')

    const repositoryFiles = await findRepositoryFiles(scanDirectory, options.pattern || '**/*Repository.ts')

    if (repositoryFiles.length === 0) {
      validateSpinner.warn('No repository files found')
      await db.destroy()
      return
    }

    validateSpinner.succeed(`Found ${repositoryFiles.length} repository file${repositoryFiles.length !== 1 ? 's' : ''}`)

    // Validate each repository
    const validationResults: ValidationResult[] = []
    const validationSpinner = spinner()

    for (const file of repositoryFiles) {
      const fileName = path.basename(file)
      validationSpinner.start(`Validating ${fileName}...`)

      const result = await validateRepositoryFile(file, db, options)
      if (result) {
        validationResults.push(result)

        if (result.valid) {
          validationSpinner.succeed(`${fileName}: ✅ Valid`)
        } else {
          validationSpinner.fail(`${fileName}: ❌ ${result.issues.length} issue${result.issues.length !== 1 ? 's' : ''}`)
        }
      } else {
        validationSpinner.warn(`${fileName}: Skipped (could not parse)`)
      }
    }

    // Display results
    if (options.json) {
      console.log(JSON.stringify(validationResults, null, 2))
    } else {
      displayValidationResults(validationResults, options)
    }

    // Fix issues if requested
    if (options.fix && validationResults.some(r => r.issues.some(i => i.fixable))) {
      console.log('')
      const shouldFix = await confirm('Do you want to attempt automatic fixes?')

      if (shouldFix) {
        await attemptFixes(validationResults, db, options)
      }
    }

    // Close database connection
    await db.destroy()

  } catch (error) {
    validateSpinner.fail('Validation failed')
    throw error
  }
}

async function findRepositoryFiles(directory: string, pattern: string): Promise<string[]> {
  const files: string[] = []

  async function scanDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await scanDir(fullPath)
        } else if (entry.isFile() && (entry.name.endsWith('Repository.ts') || entry.name.endsWith('Repository.js'))) {
          files.push(fullPath)
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await scanDir(directory)
  return files
}

async function validateRepositoryFile(
  filePath: string,
  db: any,
  options: ValidateRepositoryOptions
): Promise<ValidationResult | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')

    // Extract repository info
    const classMatch = content.match(/export\s+(?:default\s+)?class\s+(\w+Repository)/m)
    if (!classMatch) {
      return null
    }

    const className = classMatch[1]

    // Extract table name
    const tableMatch = content.match(/tableName[:\s=]+['"`](\w+)['"`]/m)
    if (!tableMatch) {
      return {
        repository: className,
        tableName: '',
        file: filePath,
        valid: false,
        issues: [{
          type: 'missing_table',
          severity: 'error',
          message: 'No table name defined in repository',
          fixable: false
        }],
        suggestions: ['Add a tableName property to your repository']
      }
    }

    const tableName = tableMatch[1]

    // Check if table exists
    const tableExists = await checkTableExists(db, tableName)

    if (!tableExists) {
      return {
        repository: className,
        tableName,
        file: filePath,
        valid: false,
        issues: [{
          type: 'missing_table',
          severity: 'error',
          message: `Table '${tableName}' does not exist in database`,
          fixable: false
        }],
        suggestions: [`Create migration for table '${tableName}'`]
      }
    }

    // Get table columns
    const columns = await getTableColumns(db, tableName)

    // Extract entity/schema properties
    const entityProperties = extractEntityProperties(content)
    const schemaProperties = extractSchemaProperties(content)

    // Validate properties against database columns
    const issues: ValidationIssue[] = []
    const suggestions: string[] = []

    // Check entity properties
    for (const prop of entityProperties) {
      const column = columns.find(c => c.name === prop.name || c.name === toSnakeCase(prop.name))

      if (!column) {
        issues.push({
          type: 'missing_column',
          severity: 'error',
          field: prop.name,
          message: `Property '${prop.name}' has no corresponding database column`,
          fixable: false
        })
        suggestions.push(`Add column '${toSnakeCase(prop.name)}' to table '${tableName}'`)
      } else {
        // Check type compatibility
        const typeIssue = validateTypeCompatibility(prop, column, options.strict || false)
        if (typeIssue) {
          issues.push(typeIssue)
        }
      }
    }

    // Check for missing properties
    for (const column of columns) {
      const propName = toCamelCase(column.name)
      const hasProperty = entityProperties.some(p => p.name === propName || p.name === column.name)

      if (!hasProperty && !['created_at', 'updated_at', 'deleted_at'].includes(column.name)) {
        issues.push({
          type: 'missing_column',
          severity: 'warning',
          field: column.name,
          message: `Database column '${column.name}' has no corresponding property`,
          fixable: true
        })
        suggestions.push(`Add property '${propName}' to entity`)
      }
    }

    // Check naming conventions
    if (options.strict) {
      // Check table name convention
      if (!isSnakeCase(tableName)) {
        issues.push({
          type: 'naming_convention',
          severity: 'warning',
          message: `Table name '${tableName}' should be in snake_case`,
          fixable: false
        })
      }

      // Check repository name convention
      const expectedRepoName = toPascalCase(tableName) + 'Repository'
      if (className !== expectedRepoName) {
        issues.push({
          type: 'naming_convention',
          severity: 'info',
          message: `Repository name should be '${expectedRepoName}' to match table '${tableName}'`,
          fixable: false
        })
      }
    }

    // Check for indexes on foreign keys
    const foreignKeyColumns = columns.filter(c => c.name.endsWith('_id'))
    for (const fkColumn of foreignKeyColumns) {
      const hasIndex = await checkIndexExists(db, tableName, fkColumn.name)
      if (!hasIndex) {
        issues.push({
          type: 'missing_index',
          severity: 'warning',
          field: fkColumn.name,
          message: `Foreign key column '${fkColumn.name}' should have an index`,
          fixable: false
        })
        suggestions.push(`Create index on '${tableName}.${fkColumn.name}'`)
      }
    }

    return {
      repository: className,
      tableName,
      file: filePath,
      valid: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      suggestions
    }

  } catch (error) {
    logger.debug(`Failed to validate ${filePath}: ${error}`)
    return null
  }
}

async function checkTableExists(db: any, tableName: string): Promise<boolean> {
  try {
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_name', '=', tableName)
      .execute()

    return tables.length > 0
  } catch {
    return false
  }
}

async function getTableColumns(db: any, tableName: string): Promise<ColumnInfo[]> {
  try {
    const columns = await db
      .selectFrom('information_schema.columns')
      .select([
        'column_name as name',
        'data_type as type',
        'is_nullable as nullable',
        'column_default as default'
      ])
      .where('table_name', '=', tableName)
      .execute()

    return columns.map((col: any) => ({
      name: col.name,
      type: col.type,
      nullable: col.nullable === 'YES',
      default: col.default,
      isPrimary: false, // Would need additional query
      isUnique: false   // Would need additional query
    }))
  } catch {
    return []
  }
}

async function checkIndexExists(db: any, tableName: string, columnName: string): Promise<boolean> {
  try {
    const indexes = await db
      .selectFrom('information_schema.statistics')
      .select('index_name')
      .where('table_name', '=', tableName)
      .where('column_name', '=', columnName)
      .execute()

    return indexes.length > 0
  } catch {
    return false
  }
}

function extractEntityProperties(content: string): Array<{ name: string; type: string; optional: boolean }> {
  const properties: Array<{ name: string; type: string; optional: boolean }> = []

  const entityMatch = content.match(/(?:interface|type)\s+\w+Entity\s*(?:extends\s+\w+)?\s*\{([^}]+)\}/m)
  if (entityMatch) {
    const bodyContent = entityMatch[1]
    const propMatches = bodyContent.matchAll(/\s*(\w+)(\?)?:\s*([^;\n]+)(?:;|$)/gm)

    for (const match of propMatches) {
      properties.push({
        name: match[1],
        type: match[3].trim(),
        optional: match[2] === '?'
      })
    }
  }

  return properties
}

function extractSchemaProperties(content: string): Array<{ name: string; type: string; required: boolean }> {
  const properties: Array<{ name: string; type: string; required: boolean }> = []

  const schemaMatch = content.match(/(?:const|let)\s+\w+Schema\s*=\s*z\.object\(\{([^}]+)\}/m)
  if (schemaMatch) {
    const schemaBody = schemaMatch[1]
    const propMatches = schemaBody.matchAll(/(\w+):\s*z\.(\w+)\(\)([^,\n}]*)/gm)

    for (const match of propMatches) {
      properties.push({
        name: match[1],
        type: match[2],
        required: !match[3].includes('.optional()')
      })
    }
  }

  return properties
}

function validateTypeCompatibility(
  property: { name: string; type: string; optional: boolean },
  column: ColumnInfo,
  strict: boolean
): ValidationIssue | null {
  // Map TypeScript types to database types
  const typeMap: Record<string, string[]> = {
    'string': ['varchar', 'text', 'char', 'character varying'],
    'number': ['int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real'],
    'boolean': ['boolean', 'bool', 'tinyint'],
    'Date': ['timestamp', 'datetime', 'date', 'timestamptz'],
    'Buffer': ['bytea', 'blob', 'binary'],
    'any': [] // Skip validation for any
  }

  // Get base type (remove array notation, union types, etc.)
  let propType = property.type.replace(/\[\]$/, '').split('|')[0].trim()

  // Check nullable mismatch
  if (strict && !property.optional && column.nullable) {
    return {
      type: 'type_mismatch',
      severity: 'warning',
      field: property.name,
      expected: 'required',
      actual: 'nullable',
      message: `Property '${property.name}' is required but column is nullable`,
      fixable: false
    }
  }

  // Check type compatibility
  const compatibleTypes = typeMap[propType] || []
  const columnType = column.type.toLowerCase()

  if (compatibleTypes.length > 0 && !compatibleTypes.some(t => columnType.includes(t))) {
    return {
      type: 'type_mismatch',
      severity: 'error',
      field: property.name,
      expected: propType,
      actual: column.type,
      message: `Type mismatch for '${property.name}': TypeScript type '${propType}' may not be compatible with database type '${column.type}'`,
      fixable: false
    }
  }

  return null
}

function displayValidationResults(results: ValidationResult[], options: ValidateRepositoryOptions): void {
  console.log('')
  console.log(prism.bold('🔍 Repository Validation Results'))
  console.log(prism.gray('═'.repeat(60)))

  const summary = {
    total: results.length,
    valid: results.filter(r => r.valid).length,
    invalid: results.filter(r => !r.valid).length,
    errors: results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'error').length, 0),
    warnings: results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'warning').length, 0),
    info: results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'info').length, 0)
  }

  // Show summary
  console.log('')
  console.log(prism.cyan('Summary:'))
  console.log(`  Total Repositories: ${summary.total}`)
  console.log(`  Valid: ${prism.green(String(summary.valid))}`)
  console.log(`  Invalid: ${summary.invalid > 0 ? prism.red(String(summary.invalid)) : '0'}`)
  console.log(`  Issues: ${summary.errors} errors, ${summary.warnings} warnings, ${summary.info} info`)

  // Show details for invalid repositories
  const invalidRepos = results.filter(r => !r.valid)
  if (invalidRepos.length > 0) {
    console.log('')
    console.log(prism.red('❌ Invalid Repositories:'))

    for (const repo of invalidRepos) {
      console.log('')
      console.log(`  ${prism.bold(repo.repository)} (${repo.tableName})`)
      console.log(`  File: ${path.relative(process.cwd(), repo.file)}`)

      if (options.showDetails || repo.issues.length <= 5) {
        console.log('  Issues:')
        for (const issue of repo.issues) {
          const icon = issue.severity === 'error' ? '❌' :
                       issue.severity === 'warning' ? '⚠️' : 'ℹ️'
          console.log(`    ${icon} ${issue.message}`)

          if (issue.expected && issue.actual) {
            console.log(`       Expected: ${issue.expected}, Actual: ${issue.actual}`)
          }
        }

        if (repo.suggestions.length > 0) {
          console.log('  Suggestions:')
          for (const suggestion of repo.suggestions) {
            console.log(`    💡 ${suggestion}`)
          }
        }
      } else {
        console.log(`  ${repo.issues.length} issues (use --show-details to see all)`)
      }
    }
  }

  // Show valid repositories
  const validRepos = results.filter(r => r.valid)
  if (validRepos.length > 0 && options.showDetails) {
    console.log('')
    console.log(prism.green('✅ Valid Repositories:'))

    for (const repo of validRepos) {
      console.log(`  • ${repo.repository} (${repo.tableName})`)

      if (repo.issues.length > 0) {
        console.log(`    ${repo.issues.length} non-critical issue${repo.issues.length !== 1 ? 's' : ''}`)
      }
    }
  }

  // Show fixable issues
  const fixableCount = results.reduce((sum, r) => sum + r.issues.filter(i => i.fixable).length, 0)
  if (fixableCount > 0 && !options.fix) {
    console.log('')
    console.log(prism.yellow(`💡 ${fixableCount} issue${fixableCount !== 1 ? 's' : ''} can be automatically fixed. Use --fix to apply.`))
  }
}

async function attemptFixes(results: ValidationResult[], db: any, options: ValidateRepositoryOptions): Promise<void> {
  const fixSpinner = spinner()
  let fixedCount = 0

  for (const result of results) {
    const fixableIssues = result.issues.filter(i => i.fixable)

    if (fixableIssues.length > 0) {
      fixSpinner.start(`Fixing issues in ${result.repository}...`)

      try {
        // Read file content
        const content = await fs.readFile(result.file, 'utf-8')
        let updatedContent = content

        for (const issue of fixableIssues) {
          if (issue.type === 'missing_column' && issue.field) {
            // Add missing property to entity
            const entityMatch = updatedContent.match(/((?:interface|type)\s+\w+Entity\s*(?:extends\s+\w+)?\s*\{)([^}]+)(\})/m)
            if (entityMatch) {
              const columnInfo = await getColumnInfo(db, result.tableName, issue.field)
              if (columnInfo) {
                const propType = mapDatabaseTypeToTypeScript(columnInfo.type)
                const optional = columnInfo.nullable ? '?' : ''
                const newProp = `\n  ${toCamelCase(issue.field)}${optional}: ${propType};`

                updatedContent = updatedContent.replace(
                  entityMatch[0],
                  entityMatch[1] + entityMatch[2] + newProp + '\n' + entityMatch[3]
                )
                fixedCount++
              }
            }
          }
        }

        // Write updated content if changes were made
        if (updatedContent !== content) {
          await fs.writeFile(result.file, updatedContent)
          fixSpinner.succeed(`Fixed ${fixableIssues.length} issue${fixableIssues.length !== 1 ? 's' : ''} in ${result.repository}`)
        } else {
          fixSpinner.warn(`Could not fix issues in ${result.repository}`)
        }

      } catch (error) {
        fixSpinner.fail(`Failed to fix ${result.repository}: ${error}`)
      }
    }
  }

  if (fixedCount > 0) {
    console.log('')
    console.log(prism.green(`✅ Fixed ${fixedCount} issue${fixedCount !== 1 ? 's' : ''}`))
  } else {
    console.log('')
    console.log(prism.yellow('No issues could be automatically fixed'))
  }
}

async function getColumnInfo(db: any, tableName: string, columnName: string): Promise<ColumnInfo | null> {
  try {
    const column = await db
      .selectFrom('information_schema.columns')
      .select([
        'column_name as name',
        'data_type as type',
        'is_nullable as nullable'
      ])
      .where('table_name', '=', tableName)
      .where('column_name', '=', columnName)
      .executeTakeFirst()

    if (column) {
      return {
        name: column.name,
        type: column.type,
        nullable: column.nullable === 'YES',
        isPrimary: false,
        isUnique: false
      }
    }
  } catch {
    // Ignore errors
  }

  return null
}

function mapDatabaseTypeToTypeScript(dbType: string): string {
  const typeMap: Record<string, string> = {
    'varchar': 'string',
    'text': 'string',
    'char': 'string',
    'int': 'number',
    'integer': 'number',
    'bigint': 'bigint',
    'decimal': 'number',
    'numeric': 'number',
    'float': 'number',
    'double': 'number',
    'boolean': 'boolean',
    'bool': 'boolean',
    'timestamp': 'Date',
    'datetime': 'Date',
    'date': 'Date',
    'json': 'any',
    'jsonb': 'any',
    'uuid': 'string'
  }

  const baseType = dbType.toLowerCase().split('(')[0]
  return typeMap[baseType] || 'any'
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (match, index) => {
    return index > 0 ? '_' + match.toLowerCase() : match.toLowerCase()
  })
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

function isSnakeCase(str: string): boolean {
  return /^[a-z]+(_[a-z]+)*$/.test(str)
}