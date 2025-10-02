import { Command } from 'commander'
import { prism, spinner, table, select } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { loadConfig } from '../../config/loader.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface ShowMethodsOptions {
  repository?: string
  file?: string
  groupBy?: 'visibility' | 'type' | 'category'
  filter?: string
  showSignatures?: boolean
  showExamples?: boolean
  showComplexity?: boolean
  markdown?: boolean
  json?: boolean
  config?: string
}

interface MethodInfo {
  name: string
  signature: string
  visibility: 'public' | 'private' | 'protected'
  type: 'query' | 'mutation' | 'utility' | 'validation'
  async: boolean
  parameters: Array<{
    name: string
    type: string
    optional: boolean
    default?: string
  }>
  returnType: string
  description?: string
  example?: string
  complexity?: number
  linesOfCode: number
  calls?: string[]
  category?: string
}

interface RepositoryMethods {
  repository: string
  file: string
  tableName?: string
  methods: MethodInfo[]
  stats: {
    total: number
    public: number
    private: number
    protected: number
    async: number
    queries: number
    mutations: number
    utilities: number
  }
}

export function showMethodsCommand(): Command {
  const cmd = new Command('methods')
    .description('Show available methods in repository classes')
    .option('-r, --repository <name>', 'Repository class name')
    .option('-f, --file <path>', 'Repository file path')
    .option('-g, --group-by <type>', 'Group methods by (visibility/type/category)', 'visibility')
    .option('--filter <pattern>', 'Filter methods by name pattern')
    .option('--show-signatures', 'Show full method signatures', false)
    .option('--show-examples', 'Show usage examples', false)
    .option('--show-complexity', 'Show complexity metrics', false)
    .option('--markdown', 'Output as markdown documentation', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: ShowMethodsOptions) => {
      try {
        await showMethods(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to show methods: ${error instanceof Error ? error.message : String(error)}`,
          'REPOSITORY_METHODS_ERROR'
        )
      }
    })

  return cmd
}

async function showMethods(options: ShowMethodsOptions): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config)

  const methodsSpinner = spinner()

  try {
    let filePath: string

    // Determine which file to analyze
    if (options.file) {
      filePath = path.resolve(options.file)
      methodsSpinner.start(`Analyzing ${path.basename(filePath)}...`)
    } else if (options.repository) {
      methodsSpinner.start(`Searching for ${options.repository}...`)

      // Search for the repository
      const found = await findRepositoryFile(options.repository)
      if (!found) {
        methodsSpinner.fail(`Repository '${options.repository}' not found`)
        return
      }
      filePath = found
    } else {
      // Interactive selection
      methodsSpinner.start('Finding repository files...')
      const files = await findAllRepositoryFiles('src')
      methodsSpinner.stop()

      if (files.length === 0) {
        console.log(prism.yellow('No repository files found'))
        return
      }

      const selected = await select(
        'Select a repository to analyze:',
        files.map(f => ({
          label: path.basename(f),
          value: f,
          description: path.relative(process.cwd(), f)
        }))
      )

      filePath = selected
      methodsSpinner.start(`Analyzing ${path.basename(filePath)}...`)
    }

    // Check if file exists
    try {
      await fs.access(filePath)
    } catch {
      methodsSpinner.fail(`File not found: ${filePath}`)
      return
    }

    // Analyze the repository
    const content = await fs.readFile(filePath, 'utf-8')
    const analysis = analyzeRepository(content, filePath, options)

    if (!analysis) {
      methodsSpinner.fail('Failed to analyze repository')
      return
    }

    methodsSpinner.succeed(`Found ${analysis.methods.length} method${analysis.methods.length !== 1 ? 's' : ''} in ${analysis.repository}`)

    // Apply filter if specified
    if (options.filter) {
      const pattern = new RegExp(options.filter, 'i')
      analysis.methods = analysis.methods.filter(m => pattern.test(m.name))
    }

    // Display results
    if (options.json) {
      console.log(JSON.stringify(analysis, null, 2))
    } else if (options.markdown) {
      displayMarkdownDocumentation(analysis, options)
    } else {
      displayMethods(analysis, options)
    }

  } catch (error) {
    methodsSpinner.fail('Failed to analyze repository')
    throw error
  }
}

function analyzeRepository(
  content: string,
  filePath: string,
  options: ShowMethodsOptions
): RepositoryMethods | null {
  // Extract class name
  const classMatch = content.match(/export\s+(?:default\s+)?class\s+(\w+Repository)/m)
  if (!classMatch) {
    return null
  }

  const className = classMatch[1]

  // Extract table name
  const tableMatch = content.match(/tableName[:\s=]+['"`](\w+)['"`]/m)
  const tableName = tableMatch ? tableMatch[1] : undefined

  // Extract methods
  const methods: MethodInfo[] = []
  const methodRegex = /(\/\*\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)?\s*(public\s+|private\s+|protected\s+)?(async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/gm

  let match
  while ((match = methodRegex.exec(content)) !== null) {
    const jsdoc = match[1]
    const visibility = match[2] ? match[2].trim() as any : 'public'
    const isAsync = !!match[3]
    const methodName = match[4]
    const params = match[5]
    const returnType = match[6]?.trim() || (isAsync ? 'Promise<void>' : 'void')

    // Skip constructor and getters/setters
    if (['constructor', 'get', 'set'].includes(methodName)) {
      continue
    }

    // Parse JSDoc
    const description = extractJSDocDescription(jsdoc)
    const example = extractJSDocExample(jsdoc)

    // Parse parameters
    const parameters = parseMethodParameters(params, jsdoc)

    // Find method body
    const methodBody = extractMethodBody(content, match.index + match[0].length)

    // Determine method type
    const type = determineMethodType(methodName, methodBody)

    // Determine category
    const category = determineMethodCategory(methodName, type)

    // Extract calls
    const calls = extractMethodCalls(methodBody)

    // Calculate complexity if requested
    let complexity: number | undefined
    if (options.showComplexity) {
      complexity = calculateMethodComplexity(methodBody)
    }

    // Count lines
    const linesOfCode = methodBody.split('\n').length

    // Build signature
    const signature = buildMethodSignature(methodName, parameters, returnType, isAsync)

    methods.push({
      name: methodName,
      signature,
      visibility,
      type,
      async: isAsync,
      parameters,
      returnType,
      description,
      example,
      complexity,
      linesOfCode,
      calls: calls.length > 0 ? calls : undefined,
      category
    })
  }

  // Calculate stats
  const stats = {
    total: methods.length,
    public: methods.filter(m => m.visibility === 'public').length,
    private: methods.filter(m => m.visibility === 'private').length,
    protected: methods.filter(m => m.visibility === 'protected').length,
    async: methods.filter(m => m.async).length,
    queries: methods.filter(m => m.type === 'query').length,
    mutations: methods.filter(m => m.type === 'mutation').length,
    utilities: methods.filter(m => m.type === 'utility').length
  }

  return {
    repository: className,
    file: filePath,
    tableName,
    methods,
    stats
  }
}

function extractJSDocDescription(jsdoc?: string): string | undefined {
  if (!jsdoc) return undefined

  const lines = jsdoc.split('\n')
  const description: string[] = []

  for (const line of lines) {
    const cleaned = line.replace(/^\s*\*\s?/, '').trim()
    if (cleaned && !cleaned.startsWith('@')) {
      description.push(cleaned)
    } else if (cleaned.startsWith('@')) {
      break
    }
  }

  return description.length > 0 ? description.join(' ') : undefined
}

function extractJSDocExample(jsdoc?: string): string | undefined {
  if (!jsdoc) return undefined

  const exampleMatch = jsdoc.match(/@example\s*\n([^@]*)/m)
  if (exampleMatch) {
    const example = exampleMatch[1]
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .trim()
    return example
  }

  return undefined
}

function parseMethodParameters(
  params: string,
  jsdoc?: string
): MethodInfo['parameters'] {
  if (!params.trim()) return []

  const parameters: MethodInfo['parameters'] = []
  const paramDocs: Record<string, string> = {}

  // Extract parameter descriptions from JSDoc
  if (jsdoc) {
    const paramMatches = jsdoc.matchAll(/@param\s+(?:\{[^}]+\}\s+)?(\w+)\s+([^\n@]*)/gm)
    for (const match of paramMatches) {
      paramDocs[match[1]] = match[2].trim()
    }
  }

  // Parse parameters
  const paramParts = splitParameters(params)

  for (const part of paramParts) {
    const paramMatch = part.match(/\s*(\w+)(\?)?:\s*([^=]+?)(?:\s*=\s*(.+))?$/)
    if (paramMatch) {
      const name = paramMatch[1]
      const optional = !!paramMatch[2] || !!paramMatch[4]
      const type = paramMatch[3].trim()
      const defaultValue = paramMatch[4]?.trim()

      parameters.push({
        name,
        type,
        optional,
        default: defaultValue
      })
    }
  }

  return parameters
}

function splitParameters(params: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0

  for (const char of params) {
    if (char === '<' || char === '(' || char === '{' || char === '[') {
      depth++
    } else if (char === '>' || char === ')' || char === '}' || char === ']') {
      depth--
    }

    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) {
    parts.push(current.trim())
  }

  return parts
}

function extractMethodBody(content: string, startIndex: number): string {
  let braceCount = 1
  let bodyEnd = startIndex

  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '{') braceCount++
    if (content[i] === '}') {
      braceCount--
      if (braceCount === 0) {
        bodyEnd = i
        break
      }
    }
  }

  return content.substring(startIndex, bodyEnd)
}

function determineMethodType(name: string, body: string): MethodInfo['type'] {
  // Check for database operations
  if (body.includes('.selectFrom') || body.includes('.select(') || name.match(/^(get|find|fetch|list|search|query)/i)) {
    return 'query'
  }

  if (body.includes('.insertInto') || body.includes('.updateTable') || body.includes('.deleteFrom') ||
      name.match(/^(create|update|delete|remove|save|add|set)/i)) {
    return 'mutation'
  }

  if (body.includes('.parse(') || body.includes('validate') || name.match(/^(validate|check|verify)/i)) {
    return 'validation'
  }

  return 'utility'
}

function determineMethodCategory(name: string, type: MethodInfo['type']): string {
  // Common categories based on name patterns
  if (name.match(/^find/i)) return 'Finding'
  if (name.match(/^get/i)) return 'Retrieval'
  if (name.match(/^list/i)) return 'Listing'
  if (name.match(/^search/i)) return 'Search'
  if (name.match(/^create/i)) return 'Creation'
  if (name.match(/^update/i)) return 'Update'
  if (name.match(/^delete|remove/i)) return 'Deletion'
  if (name.match(/^validate|check/i)) return 'Validation'
  if (name.match(/^paginate/i)) return 'Pagination'
  if (name.match(/^count/i)) return 'Counting'
  if (name.match(/^exists/i)) return 'Existence'

  // Default to type
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function extractMethodCalls(body: string): string[] {
  const calls: Set<string> = new Set()

  // Extract Kysely method calls
  const kyselyMatches = body.matchAll(/\.(selectFrom|insertInto|updateTable|deleteFrom|where|orderBy|limit|offset|innerJoin|leftJoin)\(/gm)
  for (const match of kyselyMatches) {
    calls.add(match[1])
  }

  // Extract other method calls
  const methodMatches = body.matchAll(/this\.(\w+)\(/gm)
  for (const match of methodMatches) {
    calls.add(`this.${match[1]}`)
  }

  return Array.from(calls)
}

function calculateMethodComplexity(body: string): number {
  let complexity = 1

  // Count decision points
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\bwhile\b/g,
    /\bfor\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\?\s*[^:]+:/g, // ternary operator
    /&&/g,
    /\|\|/g
  ]

  for (const pattern of patterns) {
    const matches = body.match(pattern)
    if (matches) {
      complexity += matches.length
    }
  }

  return complexity
}

function buildMethodSignature(
  name: string,
  parameters: MethodInfo['parameters'],
  returnType: string,
  isAsync: boolean
): string {
  const paramStr = parameters.map(p => {
    const optional = p.optional ? '?' : ''
    const defaultVal = p.default ? ` = ${p.default}` : ''
    return `${p.name}${optional}: ${p.type}${defaultVal}`
  }).join(', ')

  const asyncPrefix = isAsync ? 'async ' : ''
  return `${asyncPrefix}${name}(${paramStr}): ${returnType}`
}

async function findRepositoryFile(repositoryName: string): Promise<string | null> {
  const searchPaths = [
    `src/repositories/${repositoryName}.ts`,
    `src/repository/${repositoryName}.ts`,
    `src/models/${repositoryName}.ts`,
    `src/**/${repositoryName}.ts`
  ]

  for (const searchPath of searchPaths) {
    const resolvedPath = path.resolve(searchPath)
    try {
      await fs.access(resolvedPath)
      return resolvedPath
    } catch {
      // Continue searching
    }
  }

  // Try with Repository suffix
  if (!repositoryName.endsWith('Repository')) {
    return findRepositoryFile(repositoryName + 'Repository')
  }

  return null
}

async function findAllRepositoryFiles(directory: string): Promise<string[]> {
  const files: string[] = []

  async function scanDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await scanDir(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('Repository.ts')) {
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

function displayMethods(analysis: RepositoryMethods, options: ShowMethodsOptions): void {
  console.log('')
  console.log(prism.bold(`📚 Repository Methods: ${analysis.repository}`))
  if (analysis.tableName) {
    console.log(prism.gray(`Table: ${analysis.tableName}`))
  }
  console.log(prism.gray('═'.repeat(60)))

  // Display stats
  console.log('')
  console.log(prism.cyan('📊 Statistics:'))
  console.log(`  Total Methods: ${analysis.stats.total}`)
  console.log(`  Visibility: ${analysis.stats.public} public, ${analysis.stats.private} private, ${analysis.stats.protected} protected`)
  console.log(`  Types: ${analysis.stats.queries} queries, ${analysis.stats.mutations} mutations, ${analysis.stats.utilities} utilities`)
  console.log(`  Async Methods: ${analysis.stats.async}`)

  // Group methods
  const groups = groupMethods(analysis.methods, options.groupBy || 'visibility')

  // Display methods by group
  for (const [groupName, methods] of Object.entries(groups)) {
    if (methods.length === 0) continue

    console.log('')
    console.log(prism.cyan(`${groupName}:`))

    if (options.showSignatures) {
      // Detailed view with signatures
      for (const method of methods) {
        console.log('')
        console.log(`  ${prism.bold(method.name)}`)

        if (method.description) {
          console.log(`    ${prism.gray(method.description)}`)
        }

        console.log(`    ${prism.green(method.signature)}`)

        if (options.showComplexity && method.complexity) {
          const complexityColor = method.complexity > 10 ? prism.red :
                                 method.complexity > 5 ? prism.yellow :
                                 prism.green
          console.log(`    Complexity: ${complexityColor(String(method.complexity))}, Lines: ${method.linesOfCode}`)
        }

        if (method.calls && method.calls.length > 0) {
          console.log(`    Calls: ${method.calls.join(', ')}`)
        }

        if (options.showExamples && method.example) {
          console.log('')
          console.log('    Example:')
          const exampleLines = method.example.split('\n')
          for (const line of exampleLines) {
            console.log(`      ${prism.gray(line)}`)
          }
        }
      }
    } else {
      // Simple table view
      const tableData = methods.map(m => ({
        Method: m.name,
        Type: m.type,
        Async: m.async ? '✅' : '',
        Parameters: m.parameters.length,
        Lines: m.linesOfCode,
        Complexity: options.showComplexity ? String(m.complexity || 1) : undefined
      }))

      // Remove undefined columns
      const cleanedData = tableData.map(row => {
        const cleaned: any = {}
        for (const [key, value] of Object.entries(row)) {
          if (value !== undefined) {
            cleaned[key] = value
          }
        }
        return cleaned
      })

      console.log(table(cleanedData))
    }
  }

  // Show usage tips
  console.log('')
  console.log(prism.cyan('💡 Tips:'))
  console.log('  • Use --show-signatures to see full method signatures')
  console.log('  • Use --show-examples to see usage examples')
  console.log('  • Use --markdown to generate documentation')
  console.log('  • Use --filter to search for specific methods')
}

function groupMethods(
  methods: MethodInfo[],
  groupBy: 'visibility' | 'type' | 'category'
): Record<string, MethodInfo[]> {
  const groups: Record<string, MethodInfo[]> = {}

  for (const method of methods) {
    let key: string

    switch (groupBy) {
      case 'visibility':
        key = method.visibility.charAt(0).toUpperCase() + method.visibility.slice(1)
        break
      case 'type':
        key = method.type.charAt(0).toUpperCase() + method.type.slice(1) + ' Methods'
        break
      case 'category':
        key = method.category || 'Other'
        break
      default:
        key = 'All Methods'
    }

    if (!groups[key]) {
      groups[key] = []
    }
    groups[key].push(method)
  }

  return groups
}

function displayMarkdownDocumentation(analysis: RepositoryMethods, options: ShowMethodsOptions): void {
  console.log(`# ${analysis.repository}`)
  console.log('')

  if (analysis.tableName) {
    console.log(`**Table:** \`${analysis.tableName}\``)
    console.log('')
  }

  console.log('## Statistics')
  console.log('')
  console.log(`- **Total Methods:** ${analysis.stats.total}`)
  console.log(`- **Public Methods:** ${analysis.stats.public}`)
  console.log(`- **Private Methods:** ${analysis.stats.private}`)
  console.log(`- **Async Methods:** ${analysis.stats.async}`)
  console.log('')

  console.log('## Methods')
  console.log('')

  // Group methods by category
  const groups = groupMethods(analysis.methods, 'category')

  for (const [category, methods] of Object.entries(groups)) {
    console.log(`### ${category}`)
    console.log('')

    for (const method of methods) {
      console.log(`#### \`${method.name}\``)
      console.log('')

      if (method.description) {
        console.log(method.description)
        console.log('')
      }

      console.log('**Signature:**')
      console.log('```typescript')
      console.log(method.signature)
      console.log('```')
      console.log('')

      if (method.parameters.length > 0) {
        console.log('**Parameters:**')
        for (const param of method.parameters) {
          const optional = param.optional ? ' _(optional)_' : ''
          const defaultVal = param.default ? ` = \`${param.default}\`` : ''
          console.log(`- \`${param.name}\`: \`${param.type}\`${optional}${defaultVal}`)
        }
        console.log('')
      }

      console.log(`**Returns:** \`${method.returnType}\``)
      console.log('')

      if (method.example) {
        console.log('**Example:**')
        console.log('```typescript')
        console.log(method.example)
        console.log('```')
        console.log('')
      }

      console.log('---')
      console.log('')
    }
  }
}