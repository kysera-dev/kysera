import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { guardDestructive } from '../../utils/guard.js'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Kysely } from 'kysely'
import type { Database } from '../../utils/database.js'
import type { KyseraConfig, DatabaseConfig } from '../../config/schema.js'

export interface TestSetupOptions {
  environment?: 'test' | 'ci' | 'local'
  database?: string
  clean?: boolean
  force?: boolean
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
  database: { name: string; dialect: string }
  status: { created: boolean; migrated: boolean; seeded: boolean; fixturesLoaded: number }
  isolation: string
  parallel: boolean
  duration: number
}

/**
 * Database target as this command consumes it. Kept loose on purpose:
 * schema-validated configs carry dialect 'postgres', but the branches below
 * (and test doubles) historically compare against 'postgresql', so the
 * dialect stays a plain string.
 */
interface TestDatabaseTarget {
  dialect?: string
  database: string
  host?: string
  port?: number
}

/** Module shape expected from a migration file. */
interface TestMigrationModule {
  up?: (db: Kysely<Database>) => unknown
}

/** Module shape expected from a seeder file. */
interface TestSeederModule {
  seed?: (db: Kysely<Database>) => unknown
}

/**
 * Structural view of the connection used by loadFixture: test doubles provide
 * a knex-style promise-returning `raw` alongside the insert builder.
 */
interface FixtureLoadDatabase {
  insertInto(table: string): {
    values(row: Record<string, unknown>): { execute(): Promise<unknown> }
  }
  raw(sql: string): Promise<unknown>
}

export function testSetupCommand(): Command {
  const cmd = new Command('setup')
    .description('Set up test database and environment')
    .option('-e, --environment <env>', 'Test environment', 'test')
    .option('-d, --database <name>', 'Test database name')
    .option('--clean', 'Clean existing test database', false)
    .option('-f, --force', 'Skip confirmation when dropping an existing database', false)
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
  // Widened: mocked loaders may resolve null even though the declared return
  // type is non-nullable; the runtime guard below must stay meaningful.
  const config = (await loadConfig(options.config)) as KyseraConfig | null

  if (!config?.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option'
    ])
  }

  const setupSpinner = spinner()
  setupSpinner.start('Setting up test environment...')

  const result: SetupResult = {
    environment: options.environment ?? 'test',
    // loadConfig zod-validates, so dialect is always present here
    database: { name: '', dialect: config.database.dialect },
    status: { created: false, migrated: false, seeded: false, fixturesLoaded: 0 },
    isolation: options.isolation ?? 'transaction',
    parallel: options.parallel ?? false,
    duration: 0
  }

  try {
    const testDbName =
      options.database ??
      generateTestDatabaseName(config.database.database ?? 'test', options.environment)
    result.database.name = testDbName

    const testConfig = {
      ...config,
      database: { ...config.database, database: testDbName }
    }

    const dbExists = await checkDatabaseExists(testConfig.database)

    if (dbExists && options.clean) {
      setupSpinner.text = `Dropping existing database '${testDbName}'...`

      const shouldDrop = await guardDestructive(
        `Database '${testDbName}' exists. Drop and recreate?`,
        { force: options.force }
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

    const db = await getDatabaseConnection(testConfig.database)
    if (!db) {
      throw new CLIError('Failed to connect to test database', 'DATABASE_ERROR')
    }

    if (options.migrate !== false) {
      setupSpinner.text = 'Running migrations...'
      const migrationsDir = path.join(process.cwd(), 'migrations')
      const migrationFiles = await findMigrationFiles(migrationsDir)

      if (migrationFiles.length > 0) {
        await runMigrations(db, migrationFiles, options.verbose ?? false)
        result.status.migrated = true
      }
    }

    if (options.seed) {
      setupSpinner.text = 'Running seeders...'
      const seedersDir = path.join(process.cwd(), 'seeders')
      const seederFiles = await findSeederFiles(seedersDir)

      if (seederFiles.length > 0) {
        await runSeeders(db, seederFiles, options.verbose ?? false)
        result.status.seeded = true
      }
    }

    if (options.fixtures && options.fixtures.length > 0) {
      setupSpinner.text = 'Loading fixtures...'

      for (const fixturePath of options.fixtures) {
        await loadFixture(db as unknown as FixtureLoadDatabase, fixturePath, options.verbose ?? false)
        result.status.fixturesLoaded++
      }
    }

    await createTestHelpers(testConfig, options)
    await db.destroy()

    result.duration = Date.now() - startTime
    setupSpinner.succeed('Test environment set up successfully')

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      displaySetupResults(result)
    }
  } catch (error) {
    setupSpinner.fail('Failed to set up test environment')
    throw error
  }
}

function generateTestDatabaseName(baseName: string, environment?: string): string {
  const env = environment ?? 'test'
  if (env === 'ci') {
    // `?? ''` keeps the original ||-chain semantics: an explicitly empty env
    // var still falls through to the next candidate.
    const buildId =
      (process.env.CI_BUILD_ID ?? '') ||
      (process.env.GITHUB_RUN_ID ?? '') ||
      Math.random().toString(36).substring(2, 8)
    return `${baseName}_test_${buildId}`
  }
  if (env === 'local') {
    return `${baseName}_test_local`
  }
  return `${baseName}_test`
}

async function checkDatabaseExists(config: DatabaseConfig): Promise<boolean> {
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

async function createDatabase(config: TestDatabaseTarget): Promise<void> {
  const { sql } = await import('kysely')
  const dialect = config.dialect ?? 'postgresql'
  const dbName = config.database

  if (dialect === 'postgresql') {
    const adminConfig = { ...config, database: 'postgres' }
    const db = await getDatabaseConnection(adminConfig as unknown as DatabaseConfig)
    if (db) {
      // Pre-existing: sql.id() interpolates as "[object Object]" in this raw
      // string; kept as-is (behavior-neutral sweep), cast only silences lint.
      await sql
        .raw(`CREATE DATABASE IF NOT EXISTS ${sql.id(dbName) as unknown as string}`)
        .execute(db)
      await db.destroy()
    }
  } else if (dialect === 'sqlite') {
    const dbPath = config.database
    await fs.mkdir(path.dirname(dbPath), { recursive: true })
    await fs.writeFile(dbPath, '', { flag: 'a' })
  }
}

async function dropDatabase(config: TestDatabaseTarget): Promise<void> {
  const { sql } = await import('kysely')
  const dialect = config.dialect ?? 'postgresql'
  const dbName = config.database

  if (dialect === 'postgresql') {
    const adminConfig = { ...config, database: 'postgres' }
    const db = await getDatabaseConnection(adminConfig as unknown as DatabaseConfig)
    if (db) {
      // Pre-existing: sql.id() interpolates as "[object Object]" in this raw
      // string; kept as-is (behavior-neutral sweep), cast only silences lint.
      await sql
        .raw(`DROP DATABASE IF EXISTS ${sql.id(dbName) as unknown as string}`)
        .execute(db)
      await db.destroy()
    }
  } else if (dialect === 'sqlite') {
    try {
      await fs.unlink(config.database)
    } catch {
      /* nothing to remove */
    }
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

async function runMigrations(db: Kysely<Database>, files: string[], verbose: boolean): Promise<void> {
  for (const file of files) {
    if (verbose) {
      console.log(`  Running migration: ${path.basename(file)}`)
    }
    const migration = (await import(file)) as TestMigrationModule
    if (migration.up) {
      await migration.up(db)
    }
  }
}

async function runSeeders(db: Kysely<Database>, files: string[], verbose: boolean): Promise<void> {
  for (const file of files) {
    if (verbose) {
      console.log(`  Running seeder: ${path.basename(file)}`)
    }
    const seeder = (await import(file)) as TestSeederModule
    if (seeder.seed) {
      await seeder.seed(db)
    }
  }
}

async function loadFixture(
  db: FixtureLoadDatabase,
  fixturePath: string,
  verbose: boolean
): Promise<void> {
  const resolvedPath = path.resolve(fixturePath)
  const content = await fs.readFile(resolvedPath, 'utf-8')

  if (fixturePath.endsWith('.json')) {
    const data = JSON.parse(content) as Record<string, unknown>
    for (const [table, records] of Object.entries(data)) {
      if (Array.isArray(records)) {
        for (const record of records as Record<string, unknown>[]) {
          await db.insertInto(table).values(record).execute()
        }
      }
    }
  } else if (fixturePath.endsWith('.sql')) {
    await db.raw(content)
  }

  if (verbose) {
    console.log(`  Loaded fixture: ${path.basename(fixturePath)}`)
  }
}

async function createTestHelpers(
  config: { database: { dialect: string; database: string; host?: string; port?: number } },
  options: TestSetupOptions
): Promise<void> {
  const helperContent = `// Auto-generated test configuration
export const testConfig = {
  environment: '${options.environment ?? 'test'}',
  database: {
    dialect: '${config.database.dialect}',
    database: '${config.database.database}',
    host: '${config.database.host ?? 'localhost'}',
    port: ${config.database.port ?? 5432}
  },
  isolation: '${options.isolation ?? 'transaction'}',
  parallel: ${options.parallel ?? false}
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

function displaySetupResults(result: SetupResult): void {
  console.log('')
  console.log(prism.bold('Test Environment Setup Complete'))
  console.log(prism.gray('='.repeat(50)))

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

  console.log('')
  console.log(prism.gray(`Setup completed in ${result.duration}ms`))
}
