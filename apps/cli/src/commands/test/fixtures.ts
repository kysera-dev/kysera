import { Command } from 'commander'
import { prism, spinner, table, select, confirm } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as yaml from 'js-yaml'
import { createHash } from 'node:crypto'

export interface FixtureOptions {
  load?: string[]
  directory?: string
  format?: 'json' | 'yaml' | 'sql' | 'auto'
  save?: string
  list?: boolean
  validate?: boolean
  dependencies?: boolean
  checksum?: boolean
  tags?: string[]
  verbose?: boolean
  json?: boolean
  config?: string
}

interface Fixture {
  name: string
  path: string
  format: 'json' | 'yaml' | 'sql' | 'js'
  size: number
  tables: string[]
  recordCount: number
  dependencies: string[]
  tags: string[]
  checksum?: string
  description?: string
}

interface LoadResult {
  loaded: string[]
  skipped: string[]
  failed: Array<{
    fixture: string
    error: string
  }>
  tablesAffected: string[]
  totalRecords: number
  duration: number
}

export function fixturesCommand(): Command {
  const cmd = new Command('fixtures')
    .description('Load and manage test fixtures')
    .option('-l, --load <files...>', 'Load specific fixture files')
    .option('-d, --directory <path>', 'Fixtures directory', 'tests/fixtures')
    .option('-f, --format <type>', 'Fixture format', 'auto')
    .option('-s, --save <name>', 'Save current data as fixture')
    .option('--list', 'List available fixtures', false)
    .option('--validate', 'Validate fixtures without loading', false)
    .option('--dependencies', 'Load fixture dependencies', true)
    .option('--checksum', 'Verify fixture checksums', false)
    .option('--tags <tags...>', 'Filter by tags')
    .option('-v, --verbose', 'Verbose output', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: FixtureOptions) => {
      try {
        await manageFixtures(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to manage fixtures: ${error instanceof Error ? error.message : String(error)}`,
          'FIXTURE_ERROR'
        )
      }
    })

  return cmd
}

async function manageFixtures(options: FixtureOptions): Promise<void> {
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

  // Handle different actions
  if (options.list) {
    await listFixtures(options)
  } else if (options.save) {
    await saveFixture(config, options)
  } else if (options.validate) {
    await validateFixtures(config, options)
  } else {
    await loadFixtures(config, options)
  }
}

async function listFixtures(options: FixtureOptions): Promise<void> {
  const listSpinner = spinner()
  listSpinner.start('Scanning for fixtures...')

  try {
    const fixturesDir = path.resolve(options.directory || 'tests/fixtures')

    // Check if directory exists
    try {
      await fs.access(fixturesDir)
    } catch {
      listSpinner.fail('Fixtures directory not found')
      console.log(prism.gray(`Directory: ${fixturesDir}`))
      return
    }

    // Find all fixtures
    const fixtures = await findAllFixtures(fixturesDir, options.tags)

    if (fixtures.length === 0) {
      listSpinner.warn('No fixtures found')
      return
    }

    listSpinner.succeed(`Found ${fixtures.length} fixture${fixtures.length !== 1 ? 's' : ''}`)

    // Display fixtures
    if (options.json) {
      console.log(JSON.stringify(fixtures, null, 2))
    } else {
      displayFixtureList(fixtures, options)
    }

  } catch (error) {
    listSpinner.fail('Failed to list fixtures')
    throw error
  }
}

async function saveFixture(config: any, options: FixtureOptions): Promise<void> {
  const saveSpinner = spinner()
  saveSpinner.start('Connecting to database...')

  try {
    const db = await getDatabaseConnection(config.database)

    if (!db) {
      throw new CLIError(
        'Failed to connect to database',
        'DATABASE_ERROR'
      )
    }

    // Get all tables or specific ones
    saveSpinner.text = 'Reading database schema...'
    const tables = await getAllTables(db)

    if (tables.length === 0) {
      saveSpinner.warn('No tables found in database')
      await db.destroy()
      return
    }

    // Extract data from tables
    saveSpinner.text = 'Extracting data...'
    const data: Record<string, any[]> = {}
    let totalRecords = 0

    for (const tableName of tables) {
      const records = await db.selectFrom(tableName).selectAll().execute()
      if (records.length > 0) {
        data[tableName] = records
        totalRecords += records.length
      }
    }

    if (totalRecords === 0) {
      saveSpinner.warn('No data found to save')
      await db.destroy()
      return
    }

    // Determine format and save
    const format = options.format === 'auto' ? 'json' : options.format || 'json'
    const fixturesDir = path.resolve(options.directory || 'tests/fixtures')
    await fs.mkdir(fixturesDir, { recursive: true })

    const fixtureName = options.save
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${fixtureName}_${timestamp}.${format}`
    const filepath = path.join(fixturesDir, filename)

    saveSpinner.text = `Saving fixture to ${filename}...`

    // Create fixture metadata
    const metadata = {
      name: fixtureName,
      created: new Date().toISOString(),
      tables: Object.keys(data),
      recordCount: totalRecords,
      description: `Snapshot of ${Object.keys(data).length} tables with ${totalRecords} records`
    }

    // Save based on format
    if (format === 'yaml') {
      const content = yaml.dump({ metadata, data })
      await fs.writeFile(filepath, content, 'utf-8')
    } else {
      const content = JSON.stringify({ metadata, data }, null, 2)
      await fs.writeFile(filepath, content, 'utf-8')
    }

    // Generate checksum
    const content = await fs.readFile(filepath, 'utf-8')
    const checksum = createHash('md5').update(content).digest('hex')

    await db.destroy()
    saveSpinner.succeed(`Fixture saved: ${filename}`)

    // Display summary
    console.log('')
    console.log(prism.cyan('Fixture Details:'))
    console.log(`  File: ${filename}`)
    console.log(`  Tables: ${Object.keys(data).length}`)
    console.log(`  Records: ${totalRecords}`)
    console.log(`  Format: ${format}`)
    console.log(`  Checksum: ${checksum}`)
    console.log('')
    console.log(prism.green('✨ Fixture saved successfully'))

  } catch (error) {
    saveSpinner.fail('Failed to save fixture')
    throw error
  }
}

async function validateFixtures(config: any, options: FixtureOptions): Promise<void> {
  const validateSpinner = spinner()
  validateSpinner.start('Validating fixtures...')

  try {
    const fixturesDir = path.resolve(options.directory || 'tests/fixtures')
    const fixtures = await findAllFixtures(fixturesDir, options.tags)

    if (fixtures.length === 0) {
      validateSpinner.warn('No fixtures found to validate')
      return
    }

    const db = await getDatabaseConnection(config.database)
    if (!db) {
      throw new CLIError(
        'Failed to connect to database',
        'DATABASE_ERROR'
      )
    }

    const existingTables = await getAllTables(db)
    const results: Array<{
      fixture: string
      valid: boolean
      issues: string[]
    }> = []

    for (const fixture of fixtures) {
      validateSpinner.text = `Validating ${fixture.name}...`

      const issues: string[] = []

      // Check if fixture file exists and is readable
      try {
        await fs.access(fixture.path)
      } catch {
        issues.push('File not accessible')
      }

      // Check if all referenced tables exist
      for (const table of fixture.tables) {
        if (!existingTables.includes(table)) {
          issues.push(`Table '${table}' does not exist in database`)
        }
      }

      // Verify checksum if requested
      if (options.checksum && fixture.checksum) {
        const content = await fs.readFile(fixture.path, 'utf-8')
        const actualChecksum = createHash('md5').update(content).digest('hex')

        if (actualChecksum !== fixture.checksum) {
          issues.push('Checksum mismatch - fixture may have been modified')
        }
      }

      results.push({
        fixture: fixture.name,
        valid: issues.length === 0,
        issues
      })
    }

    await db.destroy()
    validateSpinner.succeed('Validation complete')

    // Display results
    console.log('')
    console.log(prism.bold('🔍 Fixture Validation Results'))
    console.log(prism.gray('─'.repeat(50)))

    const valid = results.filter(r => r.valid)
    const invalid = results.filter(r => !r.valid)

    if (valid.length > 0) {
      console.log('')
      console.log(prism.green(`✅ Valid fixtures: ${valid.length}`))
      if (options.verbose) {
        for (const result of valid) {
          console.log(`  • ${result.fixture}`)
        }
      }
    }

    if (invalid.length > 0) {
      console.log('')
      console.log(prism.red(`❌ Invalid fixtures: ${invalid.length}`))
      for (const result of invalid) {
        console.log(`  • ${result.fixture}`)
        for (const issue of result.issues) {
          console.log(prism.gray(`    - ${issue}`))
        }
      }
    }

  } catch (error) {
    validateSpinner.fail('Validation failed')
    throw error
  }
}

async function loadFixtures(config: any, options: FixtureOptions): Promise<void> {
  const startTime = Date.now()
  const loadSpinner = spinner()
  loadSpinner.start('Preparing to load fixtures...')

  const result: LoadResult = {
    loaded: [],
    skipped: [],
    failed: [],
    tablesAffected: [],
    totalRecords: 0,
    duration: 0
  }

  try {
    const db = await getDatabaseConnection(config.database)

    if (!db) {
      throw new CLIError(
        'Failed to connect to database',
        'DATABASE_ERROR'
      )
    }

    // Determine which fixtures to load
    let fixturesToLoad: Fixture[] = []

    if (options.load && options.load.length > 0) {
      // Load specific fixtures
      for (const fixtureName of options.load) {
        const fixture = await findFixture(fixtureName, options.directory || 'tests/fixtures')
        if (fixture) {
          fixturesToLoad.push(fixture)
        } else {
          result.failed.push({
            fixture: fixtureName,
            error: 'Fixture not found'
          })
        }
      }
    } else {
      // Load all fixtures in directory
      const fixturesDir = path.resolve(options.directory || 'tests/fixtures')
      fixturesToLoad = await findAllFixtures(fixturesDir, options.tags)
    }

    if (fixturesToLoad.length === 0) {
      loadSpinner.warn('No fixtures to load')
      await db.destroy()
      return
    }

    // Sort fixtures by dependencies
    if (options.dependencies !== false) {
      fixturesToLoad = sortByDependencies(fixturesToLoad)
    }

    loadSpinner.succeed(`Found ${fixturesToLoad.length} fixture${fixturesToLoad.length !== 1 ? 's' : ''} to load`)

    // Load each fixture
    for (const fixture of fixturesToLoad) {
      const fixtureSpinner = spinner()
      fixtureSpinner.start(`Loading ${fixture.name}...`)

      try {
        const loadedData = await loadFixtureFile(db, fixture, options)

        result.loaded.push(fixture.name)
        result.totalRecords += loadedData.recordCount

        for (const table of loadedData.tables) {
          if (!result.tablesAffected.includes(table)) {
            result.tablesAffected.push(table)
          }
        }

        fixtureSpinner.succeed(`Loaded ${fixture.name}: ${loadedData.recordCount} records`)

      } catch (error) {
        result.failed.push({
          fixture: fixture.name,
          error: error instanceof Error ? error.message : String(error)
        })
        fixtureSpinner.fail(`Failed to load ${fixture.name}`)
      }
    }

    await db.destroy()
    result.duration = Date.now() - startTime

    // Display results
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      displayLoadResults(result, options)
    }

  } catch (error) {
    loadSpinner.fail('Failed to load fixtures')
    throw error
  }
}

async function findAllFixtures(directory: string, tags?: string[]): Promise<Fixture[]> {
  const fixtures: Fixture[] = []

  try {
    const files = await fs.readdir(directory)

    for (const file of files) {
      const filepath = path.join(directory, file)
      const stat = await fs.stat(filepath)

      if (!stat.isFile()) continue

      // Determine format
      let format: Fixture['format'] | null = null
      if (file.endsWith('.json')) format = 'json'
      else if (file.endsWith('.yaml') || file.endsWith('.yml')) format = 'yaml'
      else if (file.endsWith('.sql')) format = 'sql'
      else if (file.endsWith('.js') || file.endsWith('.ts')) format = 'js'
      else continue

      // Parse fixture
      const fixture = await parseFixture(filepath, format)

      // Filter by tags if specified
      if (tags && tags.length > 0) {
        const hasTag = tags.some(tag => fixture.tags.includes(tag))
        if (!hasTag) continue
      }

      fixtures.push(fixture)
    }
  } catch (error) {
    logger.debug(`Failed to find fixtures: ${error}`)
  }

  return fixtures
}

async function findFixture(name: string, directory: string): Promise<Fixture | null> {
  const fixturesDir = path.resolve(directory)

  // Try different extensions
  const extensions = ['.json', '.yaml', '.yml', '.sql', '.js', '.ts']

  for (const ext of extensions) {
    const filepath = path.join(fixturesDir, name + ext)

    try {
      await fs.access(filepath)

      let format: Fixture['format']
      if (ext === '.json') format = 'json'
      else if (ext === '.yaml' || ext === '.yml') format = 'yaml'
      else if (ext === '.sql') format = 'sql'
      else format = 'js'

      return await parseFixture(filepath, format)
    } catch {
      // Continue trying other extensions
    }
  }

  return null
}

async function parseFixture(filepath: string, format: Fixture['format']): Promise<Fixture> {
  const stat = await fs.stat(filepath)
  const name = path.basename(filepath, path.extname(filepath))

  const fixture: Fixture = {
    name,
    path: filepath,
    format,
    size: stat.size,
    tables: [],
    recordCount: 0,
    dependencies: [],
    tags: []
  }

  // Parse based on format
  if (format === 'json') {
    const content = await fs.readFile(filepath, 'utf-8')
    const data = JSON.parse(content)

    if (data.metadata) {
      fixture.tables = data.metadata.tables || []
      fixture.recordCount = data.metadata.recordCount || 0
      fixture.dependencies = data.metadata.dependencies || []
      fixture.tags = data.metadata.tags || []
      fixture.description = data.metadata.description
    } else if (data.data) {
      fixture.tables = Object.keys(data.data)
      for (const records of Object.values(data.data)) {
        if (Array.isArray(records)) {
          fixture.recordCount += records.length
        }
      }
    }
  } else if (format === 'yaml') {
    const content = await fs.readFile(filepath, 'utf-8')
    const data = yaml.load(content) as any

    if (data.metadata) {
      fixture.tables = data.metadata.tables || []
      fixture.recordCount = data.metadata.recordCount || 0
      fixture.dependencies = data.metadata.dependencies || []
      fixture.tags = data.metadata.tags || []
      fixture.description = data.metadata.description
    }
  }

  // Calculate checksum
  const content = await fs.readFile(filepath, 'utf-8')
  fixture.checksum = createHash('md5').update(content).digest('hex')

  return fixture
}

function sortByDependencies(fixtures: Fixture[]): Fixture[] {
  const sorted: Fixture[] = []
  const visited = new Set<string>()

  function visit(fixture: Fixture) {
    if (visited.has(fixture.name)) return
    visited.add(fixture.name)

    // Visit dependencies first
    for (const dep of fixture.dependencies) {
      const dependency = fixtures.find(f => f.name === dep)
      if (dependency && !visited.has(dependency.name)) {
        visit(dependency)
      }
    }

    sorted.push(fixture)
  }

  for (const fixture of fixtures) {
    visit(fixture)
  }

  return sorted
}

async function loadFixtureFile(
  db: any,
  fixture: Fixture,
  options: FixtureOptions
): Promise<{ recordCount: number; tables: string[] }> {
  const result = {
    recordCount: 0,
    tables: [] as string[]
  }

  if (fixture.format === 'json') {
    const content = await fs.readFile(fixture.path, 'utf-8')
    const parsed = JSON.parse(content)
    const data = parsed.data || parsed

    for (const [table, records] of Object.entries(data)) {
      if (Array.isArray(records)) {
        // Insert records in batches
        const batchSize = 100
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize)
          await db.insertInto(table).values(batch).execute()
        }

        result.recordCount += records.length
        result.tables.push(table)

        if (options.verbose) {
          console.log(prism.gray(`    Loaded ${records.length} records into ${table}`))
        }
      }
    }
  } else if (fixture.format === 'yaml') {
    const content = await fs.readFile(fixture.path, 'utf-8')
    const parsed = yaml.load(content) as any
    const data = parsed.data || parsed

    for (const [table, records] of Object.entries(data)) {
      if (Array.isArray(records)) {
        const batchSize = 100
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize)
          await db.insertInto(table).values(batch).execute()
        }

        result.recordCount += records.length
        result.tables.push(table)
      }
    }
  } else if (fixture.format === 'sql') {
    const content = await fs.readFile(fixture.path, 'utf-8')
    await db.raw(content)

    // Parse SQL to estimate affected tables and records
    const tableMatches = content.match(/INSERT INTO\s+`?(\w+)`?/gi) || []
    for (const match of tableMatches) {
      const table = match.replace(/INSERT INTO\s+`?/i, '').replace('`', '')
      if (!result.tables.includes(table)) {
        result.tables.push(table)
      }
    }

    result.recordCount = tableMatches.length
  } else if (fixture.format === 'js') {
    const module = await import(fixture.path)
    if (module.load) {
      const loadResult = await module.load(db)
      if (loadResult) {
        result.recordCount = loadResult.recordCount || 0
        result.tables = loadResult.tables || []
      }
    }
  }

  return result
}

async function getAllTables(db: any): Promise<string[]> {
  const tables: string[] = []

  try {
    if (db.dialectName === 'postgres') {
      const result = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', 'public')
        .where('table_type', '=', 'BASE TABLE')
        .execute()

      tables.push(...result.map((r: any) => r.table_name))
    } else if (db.dialectName === 'mysql') {
      const result = await db.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
      `)

      tables.push(...result[0].map((r: any) => r.TABLE_NAME || r.table_name))
    } else if (db.dialectName === 'sqlite') {
      const result = await db.raw(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      `)

      tables.push(...result.map((r: any) => r.name))
    }
  } catch (error) {
    logger.debug(`Failed to get tables: ${error}`)
  }

  return tables
}

function displayFixtureList(fixtures: Fixture[], options: FixtureOptions): void {
  console.log('')
  console.log(prism.bold('📦 Available Fixtures'))
  console.log(prism.gray('─'.repeat(50)))

  const tableData = fixtures.map(f => ({
    Name: f.name,
    Format: f.format.toUpperCase(),
    Tables: f.tables.length,
    Records: f.recordCount,
    Size: formatSize(f.size),
    Tags: f.tags.length > 0 ? f.tags.join(', ') : prism.gray('None')
  }))

  console.log('')
  console.log(table(tableData))

  if (options.verbose) {
    console.log('')
    console.log(prism.cyan('Details:'))
    for (const fixture of fixtures) {
      console.log(`  ${fixture.name}:`)
      if (fixture.description) {
        console.log(`    ${fixture.description}`)
      }
      if (fixture.dependencies.length > 0) {
        console.log(`    Dependencies: ${fixture.dependencies.join(', ')}`)
      }
      if (fixture.checksum) {
        console.log(`    Checksum: ${fixture.checksum}`)
      }
    }
  }

  console.log('')
  console.log(prism.cyan('Usage:'))
  console.log('  kysera test fixtures --load <name>    Load specific fixture')
  console.log('  kysera test fixtures --validate       Validate all fixtures')
  console.log('  kysera test fixtures --save <name>    Save current data as fixture')
}

function displayLoadResults(result: LoadResult, options: FixtureOptions): void {
  console.log('')
  console.log(prism.bold('✨ Fixtures Loaded'))
  console.log(prism.gray('─'.repeat(50)))

  console.log('')
  console.log(prism.cyan('Summary:'))
  console.log(`  Loaded: ${result.loaded.length} fixture${result.loaded.length !== 1 ? 's' : ''}`)
  console.log(`  Records: ${result.totalRecords}`)
  console.log(`  Tables affected: ${result.tablesAffected.length}`)
  console.log(`  Duration: ${result.duration}ms`)

  if (result.loaded.length > 0) {
    console.log('')
    console.log(prism.green('✅ Loaded:'))
    for (const name of result.loaded) {
      console.log(`  • ${name}`)
    }
  }

  if (result.skipped.length > 0) {
    console.log('')
    console.log(prism.yellow('⏭️  Skipped:'))
    for (const name of result.skipped) {
      console.log(`  • ${name}`)
    }
  }

  if (result.failed.length > 0) {
    console.log('')
    console.log(prism.red('❌ Failed:'))
    for (const failure of result.failed) {
      console.log(`  • ${failure.fixture}: ${failure.error}`)
    }
  }

  if (options.verbose && result.tablesAffected.length > 0) {
    console.log('')
    console.log(prism.cyan('Tables affected:'))
    for (const table of result.tablesAffected) {
      console.log(`  • ${table}`)
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}