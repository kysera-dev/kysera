import { Command } from 'commander'
import { prism, spinner, table } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ListRepositoriesOptions {
  directory?: string
  pattern?: string
  showMethods?: boolean
  showSchemas?: boolean
  json?: boolean
  config?: string
}

interface RepositoryInfo {
  name: string
  path: string
  className: string
  tableName?: string
  entity?: string
  methods?: string[]
  schema?: {
    properties: string[]
    required: string[]
  }
  stats?: {
    linesOfCode: number
    methodCount: number
    hasValidation: boolean
    hasPagination: boolean
    hasSoftDelete: boolean
  }
}

export function listRepositoriesCommand(): Command {
  const cmd = new Command('list')
    .description('List all repository classes in the project')
    .option('-d, --directory <path>', 'Directory to scan', 'src')
    .option('-p, --pattern <glob>', 'File pattern to match', '**/*Repository.ts')
    .option('--show-methods', 'Show repository methods', false)
    .option('--show-schemas', 'Show entity schemas', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: ListRepositoriesOptions) => {
      try {
        await listRepositories(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to list repositories: ${error instanceof Error ? error.message : String(error)}`,
          'REPOSITORY_LIST_ERROR'
        )
      }
    })

  return cmd
}

async function listRepositories(options: ListRepositoriesOptions): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config)

  const listSpinner = spinner()
  listSpinner.start('Scanning for repository files...')

  try {
    // Get project root directory
    const projectRoot = process.cwd()
    const scanDirectory = path.join(projectRoot, options.directory || 'src')

    // Check if directory exists
    try {
      await fs.access(scanDirectory)
    } catch {
      listSpinner.fail(`Directory not found: ${scanDirectory}`)
      return
    }

    // Find repository files
    const repositoryFiles = await findRepositoryFiles(
      scanDirectory,
      options.pattern || '**/*Repository.ts'
    )

    if (repositoryFiles.length === 0) {
      listSpinner.warn('No repository files found')
      console.log('')
      console.log(prism.gray(`Searched in: ${scanDirectory}`))
      console.log(prism.gray(`Pattern: ${options.pattern || '**/*Repository.ts'}`))
      console.log('')
      console.log(prism.yellow('💡 Tips:'))
      console.log('  - Make sure your repositories follow the naming convention (*Repository.ts)')
      console.log('  - Check that the search directory is correct')
      console.log('  - Use --pattern to specify a custom file pattern')
      return
    }

    listSpinner.succeed(`Found ${repositoryFiles.length} repository file${repositoryFiles.length !== 1 ? 's' : ''}`)

    // Parse repository information
    const repositories: RepositoryInfo[] = []

    for (const file of repositoryFiles) {
      const repoInfo = await parseRepositoryFile(file, options)
      if (repoInfo) {
        repositories.push(repoInfo)
      }
    }

    // Display results
    if (options.json) {
      console.log(JSON.stringify(repositories, null, 2))
    } else {
      displayRepositories(repositories, options)
    }

  } catch (error) {
    listSpinner.fail('Failed to scan repositories')
    throw error
  }
}

async function findRepositoryFiles(directory: string, pattern: string): Promise<string[]> {
  const files: string[] = []

  async function scanDir(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await scanDir(fullPath)
      } else if (entry.isFile()) {
        // Check if file matches pattern
        if (entry.name.endsWith('Repository.ts') || entry.name.endsWith('Repository.js')) {
          files.push(fullPath)
        }
      }
    }
  }

  await scanDir(directory)
  return files
}

async function parseRepositoryFile(filePath: string, options: ListRepositoriesOptions): Promise<RepositoryInfo | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')

    // Extract class name
    const classMatch = content.match(/export\s+(?:default\s+)?class\s+(\w+Repository)/m)
    if (!classMatch) {
      return null
    }

    const className = classMatch[1]

    // Extract table name
    const tableMatch = content.match(/tableName[:\s=]+['"`](\w+)['"`]/m)
    const tableName = tableMatch ? tableMatch[1] : undefined

    // Extract entity name
    const entityMatch = content.match(/(?:interface|type)\s+(\w+Entity)/m)
    const entity = entityMatch ? entityMatch[1] : undefined

    // Extract methods if requested
    let methods: string[] | undefined
    if (options.showMethods) {
      const methodMatches = content.matchAll(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*{/gm)
      methods = []
      for (const match of methodMatches) {
        const methodName = match[1]
        if (!['constructor', 'get', 'set'].includes(methodName)) {
          methods.push(methodName)
        }
      }
    }

    // Extract schema if requested
    let schema: RepositoryInfo['schema'] | undefined
    if (options.showSchemas) {
      const schemaMatch = content.match(/(?:const|let)\s+\w+Schema\s*=\s*z\.object\(\{([^}]+)\}/m)
      if (schemaMatch) {
        const schemaContent = schemaMatch[1]
        const properties: string[] = []
        const required: string[] = []

        // Parse properties
        const propMatches = schemaContent.matchAll(/(\w+)\s*:\s*z\./gm)
        for (const match of propMatches) {
          const propName = match[1]
          properties.push(propName)

          // Check if optional
          if (!schemaContent.includes(`${propName}:`) || !schemaContent.includes('.optional()')) {
            required.push(propName)
          }
        }

        schema = { properties, required }
      }
    }

    // Calculate stats
    const stats: RepositoryInfo['stats'] = {
      linesOfCode: content.split('\n').length,
      methodCount: methods?.length || 0,
      hasValidation: content.includes('z.object') || content.includes('zod'),
      hasPagination: content.includes('paginate') || content.includes('limit'),
      hasSoftDelete: content.includes('soft') && content.includes('delete')
    }

    return {
      name: className,
      path: path.relative(process.cwd(), filePath),
      className,
      tableName,
      entity,
      methods,
      schema,
      stats
    }
  } catch (error) {
    logger.debug(`Failed to parse ${filePath}: ${error}`)
    return null
  }
}

function displayRepositories(repositories: RepositoryInfo[], options: ListRepositoriesOptions): void {
  console.log('')
  console.log(prism.bold(`🗃️  Repository Classes`))
  console.log(prism.gray('─'.repeat(60)))

  if (options.showMethods || options.showSchemas) {
    // Detailed view
    for (const repo of repositories) {
      console.log('')
      console.log(prism.cyan(prism.bold(repo.name)))
      console.log(`  Path: ${prism.gray(repo.path)}`)
      if (repo.tableName) console.log(`  Table: ${repo.tableName}`)
      if (repo.entity) console.log(`  Entity: ${repo.entity}`)

      // Stats
      console.log(`  Stats:`)
      console.log(`    Lines: ${repo.stats?.linesOfCode}`)
      console.log(`    Methods: ${repo.stats?.methodCount}`)
      if (repo.stats?.hasValidation) console.log(`    ✅ Has validation`)
      if (repo.stats?.hasPagination) console.log(`    📄 Has pagination`)
      if (repo.stats?.hasSoftDelete) console.log(`    🗑️ Has soft delete`)

      // Methods
      if (options.showMethods && repo.methods && repo.methods.length > 0) {
        console.log('')
        console.log('  Methods:')
        for (const method of repo.methods) {
          console.log(`    • ${method}()`)
        }
      }

      // Schema
      if (options.showSchemas && repo.schema) {
        console.log('')
        console.log('  Schema:')
        console.log('    Properties:')
        for (const prop of repo.schema.properties) {
          const isRequired = repo.schema.required.includes(prop)
          console.log(`      • ${prop}${isRequired ? ' (required)' : ''}`)
        }
      }
    }
  } else {
    // Table view
    const tableData = repositories.map(repo => ({
      Repository: repo.name,
      Table: repo.tableName || prism.gray('N/A'),
      Path: repo.path,
      Methods: String(repo.stats?.methodCount || 0),
      Features: [
        repo.stats?.hasValidation ? '✅' : '',
        repo.stats?.hasPagination ? '📄' : '',
        repo.stats?.hasSoftDelete ? '🗑️' : ''
      ].filter(Boolean).join(' ') || prism.gray('None')
    }))

    console.log('')
    console.log(table(tableData))
  }

  // Summary
  console.log('')
  console.log(prism.gray('─'.repeat(60)))
  console.log(prism.cyan('Summary:'))
  console.log(`  Total Repositories: ${repositories.length}`)

  const withValidation = repositories.filter(r => r.stats?.hasValidation).length
  const withPagination = repositories.filter(r => r.stats?.hasPagination).length
  const withSoftDelete = repositories.filter(r => r.stats?.hasSoftDelete).length

  console.log(`  With Validation: ${withValidation} (${Math.round(withValidation / repositories.length * 100)}%)`)
  console.log(`  With Pagination: ${withPagination} (${Math.round(withPagination / repositories.length * 100)}%)`)
  console.log(`  With Soft Delete: ${withSoftDelete} (${Math.round(withSoftDelete / repositories.length * 100)}%)`)

  // Tips
  if (repositories.some(r => !r.stats?.hasValidation)) {
    console.log('')
    console.log(prism.yellow('💡 Tip: Consider adding Zod validation to repositories without it'))
  }
}