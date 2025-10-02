import { Command } from 'commander'
import { prism, spinner, confirm } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface TestSetupOptions {
  environment?: 'test' | 'ci' | 'local'
  database?: string
  clean?: boolean
  migrate?: boolean
  seed?: boolean
  fixtures?: string[]
  parallel?: boolean
  isolation?: 'database' | 'schema' | 'transaction'
  verbose?: boolean
  json?: boolean
  config?: string
}

interface SetupResult {
  environment: string
  database: {
    name: string
    dialect: string
    host?: string
    port?: number
  }
  status: {
    created: boolean
    migrated: boolean
    seeded: boolean
    fixturesLoaded: number
  }
  isolation: string
  parallel: boolean
  duration: number
}

export function testSetupCommand(): Command {
  const cmd = new Command('setup')
    .description('Set up test database and environment')
    .option('-e, --environment <env>', 'Test environment', 'test')
    .option('-d, --database <name>', 'Test database name')
    .option('--clean', 'Clean existing test database', false)
    .option('--migrate', 'Run migrations', true)
    .option('--seed', 'Run seeders', false)
    .option('--fixtures <files...>', 'Load specific fixtures')
    .option('--parallel', 'Enable parallel test execution', false)
    .option('--isolation <type>', 'Test isolation strategy', 'transaction')
    .option('-v, --verbose', 'Verbose output', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: TestSetupOptions) => {
      try {
        await setupTestEnvironment(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to set up test environment: ${error instanceof Error ? error.message : String(error)}`,
          'TEST_SETUP_ERROR'
        )
      }
    })

  return cmd
}

async function setupTestEnvironment(options: TestSetupOptions): Promise<void> {
  const startTime = Date.now()

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

  const setupSpinner = spinner()
  setupSpinner.start('Setting up test environment...')

  const result: SetupResult = {
    environment: options.environment || 'test',
    database: {
      name: '',
      dialect: config.database.dialect || 'postgresql'
    },
    status: {
      created: false,
      migrated: false,
      seeded: false,
      fixturesLoaded: 0
    },
    isolation: options.isolation || 'transaction',
    parallel: options.parallel || false,
    duration: 0
  }

  try {
    // 1. Determine test database name
    const testDbName = options.database || generateTestDatabaseName(config.database.database, options.environment)
    result.database.name = testDbName

    // Create test configuration
    const testConfig = {
      ...config,
      database: {
        ...config.database,
        database: testDbName
      }
    }

    // 2. Check if database exists
    const dbExists = await checkDatabaseExists(testConfig.database)

    if (dbExists && options.clean) {
      setupSpinner.text = `Dropping existing database '${testDbName}'...`

      const shouldDrop = options.json || await confirm(
        `Database '${testDbName}' exists. Drop and recreate?`
      )

      if (shouldDrop) {
        await dropDatabase(testConfig.database)
        await createDatabase(testConfig.database)
        result.status.created = true
      }
    } else if (!dbExists) {
      setupSpinner.text = `Creating test database '${testDbName}'...`
      await createDatabase(testConfig.database)
      result.status.created = true
    }

    // 3. Get database connection
    const db = await getDatabaseConnection(testConfig.database)

    if (!db) {
      throw new CLIError(
        'Failed to connect to test database',
        'DATABASE_ERROR'
      )
    }

    // 4. Set up isolation strategy
    if (options.isolation === 'schema') {
      setupSpinner.text = 'Creating test schema...'
      await setupSchemaIsolation(db, options.environment || 'test')
    }

    // 5. Run migrations if requested
    if (options.migrate !== false) {
      setupSpinner.text = 'Running migrations...'

      const migrationsDir = path.join(process.cwd(), 'migrations')
      const migrationFiles = await findMigrationFiles(migrationsDir)

      if (migrationFiles.length > 0) {
        await runMigrations(db, migrationFiles, options.verbose || false)
        result.status.migrated = true

        if (options.verbose) {
          console.log(prism.gray(`  Applied ${migrationFiles.length} migrations`))
        }
      }
    }

    // 6. Run seeders if requested
    if (options.seed) {
      setupSpinner.text = 'Running seeders...'

      const seedersDir = path.join(process.cwd(), 'seeders')
      const seederFiles = await findSeederFiles(seedersDir)

      if (seederFiles.length > 0) {
        await runSeeders(db, seederFiles, options.verbose || false)
        result.status.seeded = true

        if (options.verbose) {
          console.log(prism.gray(`  Executed ${seederFiles.length} seeders`))
        }
      }
    }

    // 7. Load fixtures if specified
    if (options.fixtures && options.fixtures.length > 0) {
      setupSpinner.text = 'Loading fixtures...'

      for (const fixturePath of options.fixtures) {
        await loadFixture(db, fixturePath, options.verbose || false)
        result.status.fixturesLoaded++
      }

      if (options.verbose) {
        console.log(prism.gray(`  Loaded ${result.status.fixturesLoaded} fixtures`))
      }
    }

    // 8. Configure parallel execution if requested
    if (options.parallel) {
      await configureParallelExecution(db, options.isolation || 'transaction')
    }

    // 9. Create test helper files
    await createTestHelpers(testConfig, options)

    // Close database connection
    await db.destroy()

    result.duration = Date.now() - startTime
    setupSpinner.succeed('Test environment set up successfully')

    // Display results
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      displaySetupResults(result, options)
    }

  } catch (error) {
    setupSpinner.fail('Failed to set up test environment')
    throw error
  }
}

function generateTestDatabaseName(baseName: string, environment?: string): string {
  const env = environment || 'test'
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)

  if (env === 'ci') {
    // For CI, include build number or commit hash if available
    const buildId = process.env.CI_BUILD_ID || process.env.GITHUB_RUN_ID || random
    return `${baseName}_test_${buildId}`
  }

  if (env === 'local') {
    // For local development, use a stable name
    return `${baseName}_test_local`
  }

  // Default test database name
  return `${baseName}_test`
}

async function checkDatabaseExists(config: any): Promise<boolean> {
  try {
    const db = await getDatabaseConnection(config)
    if (db) {
      await db.destroy()
      return true
    }
    return false
  } catch {
    return false
  }
}

async function createDatabase(config: any): Promise<void> {
  const dialect = config.dialect || 'postgresql'
  const dbName = config.database

  if (dialect === 'postgresql') {
    // Connect to default postgres database to create the test database
    const adminConfig = {
      ...config,
      database: 'postgres'
    }

    const db = await getDatabaseConnection(adminConfig)
    if (db) {
      await db.schema.createDatabase(dbName).ifNotExists().execute()
      await db.destroy()
    }
  } else if (dialect === 'mysql') {
    // MySQL create database
    const adminConfig = {
      ...config,
      database: undefined
    }

    const db = await getDatabaseConnection(adminConfig)
    if (db) {
      await db.raw(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``)
      await db.destroy()
    }
  } else if (dialect === 'sqlite') {
    // SQLite - just create the file
    const dbPath = config.database
    await fs.mkdir(path.dirname(dbPath), { recursive: true })
    await fs.writeFile(dbPath, '', { flag: 'a' })
  }
}

async function dropDatabase(config: any): Promise<void> {
  const dialect = config.dialect || 'postgresql'
  const dbName = config.database

  if (dialect === 'postgresql') {
    const adminConfig = {
      ...config,
      database: 'postgres'
    }

    const db = await getDatabaseConnection(adminConfig)
    if (db) {
      // Terminate existing connections
      await db.raw(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${dbName}' AND pid <> pg_backend_pid()
      `)
      await db.schema.dropDatabase(dbName).ifExists().execute()
      await db.destroy()
    }
  } else if (dialect === 'mysql') {
    const adminConfig = {
      ...config,
      database: undefined
    }

    const db = await getDatabaseConnection(adminConfig)
    if (db) {
      await db.raw(`DROP DATABASE IF EXISTS \`${dbName}\``)
      await db.destroy()
    }
  } else if (dialect === 'sqlite') {
    // SQLite - delete the file
    const dbPath = config.database
    try {
      await fs.unlink(dbPath)
    } catch {
      // File might not exist
    }
  }
}

async function setupSchemaIsolation(db: any, environment: string): Promise<void> {
  const schemaName = `test_${environment}_${Date.now()}`

  try {
    // Create schema (PostgreSQL/MySQL)
    await db.schema.createSchema(schemaName).ifNotExists().execute()

    // Set search path for PostgreSQL
    if (db.dialectName === 'postgres') {
      await db.raw(`SET search_path TO ${schemaName}, public`)
    }
  } catch (error) {
    logger.debug(`Schema isolation not supported for this dialect: ${error}`)
  }
}

async function findMigrationFiles(directory: string): Promise<string[]> {
  try {
    const files = await fs.readdir(directory)
    return files
      .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
      .sort()
      .map(f => path.join(directory, f))
  } catch {
    return []
  }
}

async function findSeederFiles(directory: string): Promise<string[]> {
  try {
    const files = await fs.readdir(directory)
    return files
      .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
      .sort()
      .map(f => path.join(directory, f))
  } catch {
    return []
  }
}

async function runMigrations(db: any, files: string[], verbose: boolean): Promise<void> {
  for (const file of files) {
    if (verbose) {
      console.log(prism.gray(`  Running migration: ${path.basename(file)}`))
    }

    try {
      const migration = await import(file)
      if (migration.up) {
        await migration.up(db)
      }
    } catch (error) {
      throw new CLIError(
        `Failed to run migration ${path.basename(file)}: ${error}`,
        'MIGRATION_ERROR'
      )
    }
  }
}

async function runSeeders(db: any, files: string[], verbose: boolean): Promise<void> {
  for (const file of files) {
    if (verbose) {
      console.log(prism.gray(`  Running seeder: ${path.basename(file)}`))
    }

    try {
      const seeder = await import(file)
      if (seeder.seed) {
        await seeder.seed(db)
      }
    } catch (error) {
      throw new CLIError(
        `Failed to run seeder ${path.basename(file)}: ${error}`,
        'SEEDER_ERROR'
      )
    }
  }
}

async function loadFixture(db: any, fixturePath: string, verbose: boolean): Promise<void> {
  try {
    const resolvedPath = path.resolve(fixturePath)
    const content = await fs.readFile(resolvedPath, 'utf-8')

    // Determine fixture format
    if (fixturePath.endsWith('.json')) {
      const data = JSON.parse(content)
      await loadJsonFixture(db, data, verbose)
    } else if (fixturePath.endsWith('.sql')) {
      await db.raw(content)
    } else if (fixturePath.endsWith('.ts') || fixturePath.endsWith('.js')) {
      const fixture = await import(resolvedPath)
      if (fixture.load) {
        await fixture.load(db)
      }
    }

    if (verbose) {
      console.log(prism.gray(`  Loaded fixture: ${path.basename(fixturePath)}`))
    }
  } catch (error) {
    throw new CLIError(
      `Failed to load fixture ${fixturePath}: ${error}`,
      'FIXTURE_ERROR'
    )
  }
}

async function loadJsonFixture(db: any, data: any, verbose: boolean): Promise<void> {
  // Load JSON fixture data into database
  for (const [table, records] of Object.entries(data)) {
    if (Array.isArray(records)) {
      for (const record of records) {
        await db.insertInto(table).values(record).execute()
      }

      if (verbose) {
        console.log(prism.gray(`    Inserted ${records.length} records into ${table}`))
      }
    }
  }
}

async function configureParallelExecution(db: any, isolation: string): Promise<void> {
  // Set up database for parallel test execution
  if (isolation === 'transaction') {
    // Ensure database supports savepoints for nested transactions
    if (db.dialectName === 'postgres' || db.dialectName === 'mysql') {
      await db.raw('SET autocommit = 0')
    }
  }
}

async function createTestHelpers(config: any, options: TestSetupOptions): Promise<void> {
  // Create test helper configuration file
  const helperContent = `// Auto-generated test configuration
export const testConfig = {
  environment: '${options.environment || 'test'}',
  database: {
    dialect: '${config.database.dialect}',
    database: '${config.database.database}',
    host: '${config.database.host || 'localhost'}',
    port: ${config.database.port || 5432}
  },
  isolation: '${options.isolation || 'transaction'}',
  parallel: ${options.parallel || false}
}

export async function getTestDatabase() {
  const { getDatabaseConnection } = await import('../../src/utils/database.js')
  return getDatabaseConnection(testConfig.database)
}

export async function withTestTransaction(fn: (db: any) => Promise<void>) {
  const db = await getTestDatabase()

  try {
    await db.transaction().execute(async (trx: any) => {
      await fn(trx)
      throw new Error('ROLLBACK')
    })
  } catch (error: any) {
    if (error.message !== 'ROLLBACK') {
      throw error
    }
  } finally {
    await db.destroy()
  }
}
`

  const testDir = path.join(process.cwd(), 'tests')
  await fs.mkdir(testDir, { recursive: true })
  await fs.writeFile(path.join(testDir, 'test-config.ts'), helperContent)
}

function displaySetupResults(result: SetupResult, options: TestSetupOptions): void {
  console.log('')
  console.log(prism.bold('🧪 Test Environment Setup Complete'))
  console.log(prism.gray('═'.repeat(50)))

  console.log('')
  console.log(prism.cyan('Environment:'))
  console.log(`  Type: ${result.environment}`)
  console.log(`  Database: ${result.database.name}`)
  console.log(`  Dialect: ${result.database.dialect}`)
  console.log(`  Isolation: ${result.isolation}`)
  if (result.parallel) {
    console.log(`  Parallel: ${prism.green('Enabled')}`)
  }

  console.log('')
  console.log(prism.cyan('Status:'))
  if (result.status.created) {
    console.log(`  Database: ${prism.green('Created')}`)
  } else {
    console.log(`  Database: ${prism.gray('Existing')}`)
  }

  if (result.status.migrated) {
    console.log(`  Migrations: ${prism.green('Applied')}`)
  }

  if (result.status.seeded) {
    console.log(`  Seeders: ${prism.green('Executed')}`)
  }

  if (result.status.fixturesLoaded > 0) {
    console.log(`  Fixtures: ${prism.green(`${result.status.fixturesLoaded} loaded`)}`)
  }

  console.log('')
  console.log(prism.cyan('Next Steps:'))
  console.log('  1. Run your tests with: npm test')
  console.log('  2. Use test helpers from: tests/test-config.ts')
  console.log('  3. Clean up with: kysera test teardown')

  if (options.isolation === 'transaction') {
    console.log('')
    console.log(prism.yellow('💡 Transaction isolation enabled:'))
    console.log('  Each test will run in a rolled-back transaction')
  }

  console.log('')
  console.log(prism.gray(`Setup completed in ${result.duration}ms`))
}