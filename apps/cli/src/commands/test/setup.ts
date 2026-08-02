import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { guardDestructive } from '../../utils/guard.js'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import {
  getDatabaseConnection,
  normalizeDialect,
  executeSqlScript,
  type DatabaseDialect
} from '../../utils/database.js'
import { escapeTypedIdentifier } from '../../utils/sql-sanitizer.js'
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

/** Module shape expected from a migration file. */
interface TestMigrationModule {
  up?: (db: Kysely<Database>) => unknown
}

/** Module shape expected from a seeder file. */
interface TestSeederModule {
  seed?: (db: Kysely<Database>) => unknown
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
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', undefined, [
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
      database: withDatabaseName(config.database, testDbName)
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
        await loadFixture(db, fixturePath, options.verbose ?? false)
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

/**
 * Rebuild a database config to point at a different database. Connection
 * strings are rewritten too: without this, drivers that prefer `connection`
 * over the structured `database` field would silently keep operating on the
 * ORIGINAL database while this command reports the test one.
 */
function withDatabaseName(config: DatabaseConfig, dbName: string): DatabaseConfig {
  const next: DatabaseConfig = { ...config, database: dbName }
  const dialect = normalizeDialect(config.dialect)

  if (dialect === 'sqlite') {
    // SQLite targets are plain file paths; the connection string (if any)
    // points at the original file, so drop it in favor of `database`.
    delete next.connection
    return next
  }

  const connection = config.connection
  if (typeof connection === 'string' && connection.includes('://')) {
    const url = new URL(connection)
    url.pathname = `/${dbName}`
    next.connection = url.toString()
  } else if (connection && typeof connection === 'object') {
    next.connection = { ...connection, database: dbName }
  }
  return next
}

/**
 * Connect to the server-level maintenance database (postgres /
 * information_schema) so CREATE/DROP DATABASE can run for a database that
 * does not exist yet.
 */
async function connectToAdminDatabase(
  config: DatabaseConfig,
  dialect: DatabaseDialect
): Promise<Kysely<Database> | null> {
  const adminName = dialect === 'postgres' ? 'postgres' : 'information_schema'
  return getDatabaseConnection(withDatabaseName(config, adminName))
}

async function checkDatabaseExists(config: DatabaseConfig): Promise<boolean> {
  const dialect = normalizeDialect(config.dialect)
  const dbName = config.database
  if (!dbName) return false

  if (dialect === 'sqlite') {
    try {
      await fs.access(dbName)
      return true
    } catch {
      return false
    }
  }

  const adminDb = await connectToAdminDatabase(config, dialect)
  if (!adminDb) return false

  try {
    const { CompiledQuery } = await import('kysely')
    const result =
      dialect === 'postgres'
        ? await adminDb.executeQuery(
            CompiledQuery.raw('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
          )
        : await adminDb.executeQuery(
            CompiledQuery.raw(
              'SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
              [dbName]
            )
          )
    return result.rows.length > 0
  } catch {
    return false
  } finally {
    await adminDb.destroy()
  }
}

async function createDatabase(config: DatabaseConfig): Promise<void> {
  const dialect = normalizeDialect(config.dialect)
  const dbName = config.database
  if (!dbName) {
    throw new CLIError('No test database name resolved', 'TEST_SETUP_ERROR')
  }

  if (dialect === 'sqlite') {
    const parent = path.dirname(dbName)
    if (parent && parent !== '.') {
      await fs.mkdir(parent, { recursive: true })
    }
    await fs.writeFile(dbName, '', { flag: 'a' })
    return
  }

  const adminDb = await connectToAdminDatabase(config, dialect)
  if (!adminDb) {
    throw new CLIError(
      `Cannot connect to the ${dialect} server to create database '${dbName}'`,
      'DATABASE_ERROR'
    )
  }

  try {
    const { CompiledQuery } = await import('kysely')
    if (dialect === 'postgres') {
      // PostgreSQL has no CREATE DATABASE IF NOT EXISTS: probe pg_database
      // first, then create with a validated, quoted identifier (CREATE
      // DATABASE cannot be parameterized).
      const exists = await adminDb.executeQuery(
        CompiledQuery.raw('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
      )
      if (exists.rows.length === 0) {
        await adminDb.executeQuery(
          CompiledQuery.raw(
            `CREATE DATABASE ${escapeTypedIdentifier(dbName, 'database', 'postgres')}`,
            []
          )
        )
      }
    } else {
      await adminDb.executeQuery(
        CompiledQuery.raw(
          `CREATE DATABASE IF NOT EXISTS ${escapeTypedIdentifier(dbName, 'database', 'mysql')}`,
          []
        )
      )
    }
  } finally {
    await adminDb.destroy()
  }
}

async function dropDatabase(config: DatabaseConfig): Promise<void> {
  const dialect = normalizeDialect(config.dialect)
  const dbName = config.database
  if (!dbName) return

  if (dialect === 'sqlite') {
    try {
      await fs.unlink(dbName)
    } catch {
      /* nothing to remove */
    }
    return
  }

  const adminDb = await connectToAdminDatabase(config, dialect)
  if (!adminDb) {
    throw new CLIError(
      `Cannot connect to the ${dialect} server to drop database '${dbName}'`,
      'DATABASE_ERROR'
    )
  }

  try {
    const { CompiledQuery } = await import('kysely')
    if (dialect === 'postgres') {
      await adminDb.executeQuery(
        CompiledQuery.raw(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [dbName]
        )
      )
      await adminDb.executeQuery(
        CompiledQuery.raw(
          `DROP DATABASE IF EXISTS ${escapeTypedIdentifier(dbName, 'database', 'postgres')}`,
          []
        )
      )
    } else {
      await adminDb.executeQuery(
        CompiledQuery.raw(
          `DROP DATABASE IF EXISTS ${escapeTypedIdentifier(dbName, 'database', 'mysql')}`,
          []
        )
      )
    }
  } finally {
    await adminDb.destroy()
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
  db: Kysely<Database>,
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
    await executeSqlScript(db, content)
  }

  if (verbose) {
    console.log(`  Loaded fixture: ${path.basename(fixturePath)}`)
  }
}

async function createTestHelpers(
  config: { database: DatabaseConfig },
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
