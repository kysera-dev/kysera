import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { guardDestructive } from '../../utils/guard.js'
import { logger } from '../../utils/logger.js'
import { CLIError, CLIDatabaseError } from '../../utils/errors.js'
import { getDatabaseConnection, normalizeDialect } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { validateIdentifier, safeTruncate, safeDropDatabase } from '../../utils/sql-sanitizer.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { KyseraConfig, DatabaseConfig } from '../../config/schema.js'

export interface TestTeardownOptions {
  environment?: 'test' | 'ci' | 'local' | 'all'
  database?: string
  force?: boolean
  keepData?: boolean
  preserveLogs?: boolean
  cleanArtifacts?: boolean
  pattern?: string
  verbose?: boolean
  json?: boolean
  config?: string
}

interface TeardownResult {
  environment: string
  databases: { name: string; status: 'dropped' | 'preserved' | 'failed'; reason?: string }[]
  artifacts: { cleaned: string[]; preserved: string[] }
  duration: number
}

/**
 * Database config as consumed here. Dialect stays a loose string on input
 * ('postgresql' from plain-JS configs is tolerated); every branch decision
 * goes through normalizeDialect.
 */
interface TeardownDatabaseConfig {
  dialect?: string
  database?: string
}

export function testTeardownCommand(): Command {
  const cmd = new Command('teardown')
    .description('Clean up test databases and artifacts')
    .option('-e, --environment <env>', 'Test environment to clean', 'test')
    .option('-d, --database <name>', 'Specific database to clean')
    .option('-f, --force', 'Force cleanup without confirmation', false)
    .option('--keep-data', 'Keep test data (truncate instead of drop)', false)
    .option('--preserve-logs', 'Preserve test execution logs', false)
    .option('--clean-artifacts', 'Clean test artifacts', true)
    .option('--pattern <pattern>', 'Database name pattern to match')
    .option('-v, --verbose', 'Verbose output', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: TestTeardownOptions) => {
      try {
        await teardownTestEnvironment(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to tear down test environment: ${error instanceof Error ? error.message : String(error)}`,
          'TEST_TEARDOWN_ERROR'
        )
      }
    })

  return cmd
}

async function teardownTestEnvironment(options: TestTeardownOptions): Promise<void> {
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

  const teardownSpinner = spinner()
  teardownSpinner.start('Scanning for test databases...')

  const result: TeardownResult = {
    environment: options.environment ?? 'test',
    databases: [],
    artifacts: { cleaned: [], preserved: [] },
    duration: 0
  }

  try {
    const testDatabases = await findTestDatabases(config.database, options)

    if (testDatabases.length === 0) {
      teardownSpinner.stop('No test databases found')
    } else {
      teardownSpinner.stop(
        `Found ${testDatabases.length} test database${testDatabases.length !== 1 ? 's' : ''}`
      )

      if (!options.force) {
        console.error('')
        console.error(prism.yellow('Test databases to clean:'))
        for (const dbName of testDatabases) {
          console.error(`  - ${dbName}`)
        }
      }

      const action = options.keepData ? 'truncate' : 'drop'
      const proceed = await guardDestructive(
        `${action.charAt(0).toUpperCase() + action.slice(1)} ${testDatabases.length} test database${testDatabases.length !== 1 ? 's' : ''}?`,
        { force: options.force }
      )
      if (!proceed) {
        console.error(prism.gray('Teardown cancelled'))
        return
      }

      const cleanupSpinner = spinner()

      for (const dbName of testDatabases) {
        cleanupSpinner.start(`Cleaning ${dbName}...`)

        try {
          if (options.keepData) {
            await truncateDatabase(config.database, dbName, options.preserveLogs ?? false)
            result.databases.push({
              name: dbName,
              status: 'preserved',
              reason: 'Data truncated, structure preserved'
            })
            cleanupSpinner.stop(`Truncated ${dbName}`)
          } else {
            await dropTestDatabase(config.database, dbName)
            result.databases.push({ name: dbName, status: 'dropped' })
            cleanupSpinner.stop(`Dropped ${dbName}`)
          }
        } catch (error) {
          result.databases.push({
            name: dbName,
            status: 'failed',
            reason: error instanceof Error ? error.message : String(error)
          })
          cleanupSpinner.stop(`Failed to clean ${dbName}: ${String(error)}`)
        }
      }
    }

    if (options.cleanArtifacts) {
      const artifactSpinner = spinner()
      artifactSpinner.start('Cleaning test artifacts...')

      const artifacts = await cleanTestArtifacts(options.preserveLogs ?? false)
      result.artifacts = artifacts

      artifactSpinner.stop(
        `Cleaned ${artifacts.cleaned.length} artifact${artifacts.cleaned.length !== 1 ? 's' : ''}`
      )
    }

    result.duration = Date.now() - startTime

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      displayTeardownResults(result)
    }
  } catch (error) {
    teardownSpinner.stop('Teardown failed')
    throw error
  }
}

async function findTestDatabases(
  config: TeardownDatabaseConfig,
  options: TestTeardownOptions
): Promise<string[]> {
  const databases: string[] = []

  if (options.database) {
    databases.push(options.database)
    return databases
  }

  let pattern: string
  if (options.pattern) {
    pattern = options.pattern
  } else if (options.environment === 'all') {
    pattern = '_test'
  } else if (options.environment === 'ci') {
    pattern = '_test_.*'
  } else if (options.environment === 'local') {
    pattern = '_test_local'
  } else {
    pattern = '_test'
  }

  const dialect = normalizeDialect(config.dialect)

  if (dialect === 'postgres') {
    const adminConfig = { ...config, database: 'postgres' }
    const db = await getDatabaseConnection(adminConfig as unknown as DatabaseConfig)
    if (db) {
      const result = await db
        .selectFrom('pg_database')
        .select('datname')
        .where('datname', 'like', `%${pattern}%`)
        .execute()
      databases.push(...result.map(r => r.datname as string))
      await db.destroy()
    }
  } else if (dialect === 'mysql') {
    const adminConfig = { ...config, database: 'information_schema' }
    const db = await getDatabaseConnection(adminConfig as unknown as DatabaseConfig)
    if (db) {
      const result = await db
        .selectFrom('information_schema.SCHEMATA')
        .select('SCHEMA_NAME as schema_name')
        .where('SCHEMA_NAME', 'like', `%${pattern}%`)
        .execute()
      databases.push(...result.map(r => r.schema_name as string))
      await db.destroy()
    }
  } else {
    const testDir = process.cwd()
    const files = await fs.readdir(testDir)
    for (const file of files) {
      if (file.includes(pattern) && (file.endsWith('.db') || file.endsWith('.sqlite'))) {
        databases.push(path.join(testDir, file))
      }
    }
  }

  return databases
}

async function truncateDatabase(
  config: TeardownDatabaseConfig,
  dbName: string,
  preserveLogs: boolean
): Promise<void> {
  const { sql } = await import('kysely')
  validateIdentifier(dbName, 'database')

  const testConfig = { ...config, database: dbName }
  const db = await getDatabaseConnection(testConfig as unknown as DatabaseConfig)
  if (!db) {
    throw new CLIDatabaseError(`Cannot connect to database ${dbName}`)
  }

  try {
    let tables: string[] = []
    const dialect = normalizeDialect(config.dialect)

    if (dialect === 'postgres') {
      const result = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', 'public')
        .where('table_type', '=', 'BASE TABLE')
        .execute()
      tables = result.map(r => r.table_name as string)
      await sql.raw('SET session_replication_role = replica').execute(db)
    } else if (dialect === 'mysql') {
      const result = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', sql<string>`DATABASE()`)
        .where('table_type', '=', 'BASE TABLE')
        .execute()
      tables = result.map(r => r.table_name as string)
      await sql.raw('SET FOREIGN_KEY_CHECKS = 0').execute(db)
    } else {
      const result = await sql
        .raw<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
        )
        .execute(db)
      tables = result.rows.map(r => r.name)
      await sql.raw('PRAGMA foreign_keys = OFF').execute(db)
    }

    for (const table of tables) {
      if (preserveLogs && (table.includes('log') || table.includes('audit'))) {
        continue
      }
      try {
        validateIdentifier(table, 'table')
        if (dialect === 'postgres' || dialect === 'mysql') {
          await sql.raw(safeTruncate(table, dialect, true)).execute(db)
        } else {
          await db.deleteFrom(table).execute()
        }
      } catch {
        logger.debug(`Skipping table with invalid name: ${table}`)
      }
    }

    if (dialect === 'postgres') {
      await sql.raw('SET session_replication_role = DEFAULT').execute(db)
    } else if (dialect === 'mysql') {
      await sql.raw('SET FOREIGN_KEY_CHECKS = 1').execute(db)
    } else {
      await sql.raw('PRAGMA foreign_keys = ON').execute(db)
    }
  } finally {
    await db.destroy()
  }
}

async function dropTestDatabase(config: TeardownDatabaseConfig, dbName: string): Promise<void> {
  const { sql } = await import('kysely')
  const dialect = normalizeDialect(config.dialect)

  if (dialect === 'postgres') {
    const validDbName = validateIdentifier(dbName, 'database')
    const adminConfig = { ...config, database: 'postgres' }
    const db = await getDatabaseConnection(adminConfig as unknown as DatabaseConfig)
    if (db) {
      await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${validDbName} AND pid <> pg_backend_pid()`.execute(
        db
      )
      await sql.raw(safeDropDatabase(dbName, 'postgres')).execute(db)
      await db.destroy()
    }
  } else if (dialect === 'mysql') {
    validateIdentifier(dbName, 'database')
    const adminConfig = { ...config, database: 'information_schema' }
    const db = await getDatabaseConnection(adminConfig as unknown as DatabaseConfig)
    if (db) {
      await sql.raw(safeDropDatabase(dbName, 'mysql')).execute(db)
      await db.destroy()
    }
  } else {
    try {
      await fs.unlink(dbName)
    } catch {
      /* nothing to remove */
    }
  }
}

async function cleanTestArtifacts(preserveLogs: boolean): Promise<TeardownResult['artifacts']> {
  const artifacts: TeardownResult['artifacts'] = { cleaned: [], preserved: [] }

  const dirsToClean = [
    'coverage',
    '.nyc_output',
    'test-results',
    'test-reports',
    'tmp/test',
    '.test-cache'
  ]
  if (!preserveLogs) {
    dirsToClean.push('test-logs', 'logs/test')
  }

  for (const dir of dirsToClean) {
    const fullPath = path.join(process.cwd(), dir)
    try {
      await fs.rm(fullPath, { recursive: true, force: true })
      artifacts.cleaned.push(dir)
    } catch {
      /* directory absent */
    }
  }

  const filesToClean = ['tests/test-config.ts', 'tests/test-config.js', '.test.env']
  for (const file of filesToClean) {
    const fullPath = path.join(process.cwd(), file)
    try {
      await fs.unlink(fullPath)
      artifacts.cleaned.push(file)
    } catch {
      /* file absent */
    }
  }

  if (preserveLogs) {
    const logsToPreserve = ['test-logs', 'logs/test']
    for (const log of logsToPreserve) {
      const fullPath = path.join(process.cwd(), log)
      try {
        await fs.access(fullPath)
        artifacts.preserved.push(log)
      } catch {
        /* nothing to preserve */
      }
    }
  }

  return artifacts
}

function displayTeardownResults(result: TeardownResult): void {
  console.log('')
  console.log(prism.bold('Test Environment Teardown Complete'))
  console.log(prism.gray('='.repeat(50)))

  if (result.databases.length > 0) {
    console.log('')
    console.log(prism.cyan('Databases:'))

    const grouped = {
      dropped: result.databases.filter(d => d.status === 'dropped'),
      preserved: result.databases.filter(d => d.status === 'preserved'),
      failed: result.databases.filter(d => d.status === 'failed')
    }

    if (grouped.dropped.length > 0) {
      console.log(prism.green(`  [OK] Dropped: ${grouped.dropped.length}`))
    }

    if (grouped.preserved.length > 0) {
      console.log(prism.yellow(`  [WARN] Preserved: ${grouped.preserved.length}`))
    }

    if (grouped.failed.length > 0) {
      console.log(prism.red(`  [ERROR] Failed: ${grouped.failed.length}`))
      for (const db of grouped.failed) {
        console.log(`     - ${db.name}: ${db.reason ?? ''}`)
      }
    }
  }

  if (result.artifacts.cleaned.length > 0 || result.artifacts.preserved.length > 0) {
    console.log('')
    console.log(prism.cyan('Artifacts:'))

    if (result.artifacts.cleaned.length > 0) {
      console.log(
        `  Cleaned: ${result.artifacts.cleaned.length} item${result.artifacts.cleaned.length !== 1 ? 's' : ''}`
      )
    }

    if (result.artifacts.preserved.length > 0) {
      console.log(
        `  Preserved: ${result.artifacts.preserved.length} item${result.artifacts.preserved.length !== 1 ? 's' : ''}`
      )
    }
  }

  console.log('')
  console.log(prism.cyan('Summary:'))
  console.log(`  Environment: ${result.environment}`)
  console.log(`  Duration: ${result.duration}ms`)
}
