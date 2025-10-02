import { Command } from 'commander'
import { prism, spinner, confirm, select } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

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
  databases: Array<{
    name: string
    status: 'dropped' | 'preserved' | 'failed'
    reason?: string
  }>
  artifacts: {
    cleaned: string[]
    preserved: string[]
  }
  duration: number
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

  const teardownSpinner = spinner()
  teardownSpinner.start('Scanning for test databases...')

  const result: TeardownResult = {
    environment: options.environment || 'test',
    databases: [],
    artifacts: {
      cleaned: [],
      preserved: []
    },
    duration: 0
  }

  try {
    // 1. Find test databases
    const testDatabases = await findTestDatabases(config.database, options)

    if (testDatabases.length === 0) {
      teardownSpinner.succeed('No test databases found')
      return
    }

    teardownSpinner.succeed(`Found ${testDatabases.length} test database${testDatabases.length !== 1 ? 's' : ''}`)

    // 2. Confirm cleanup
    if (!options.force && !options.json) {
      console.log('')
      console.log(prism.yellow('Test databases to clean:'))
      for (const dbName of testDatabases) {
        console.log(`  • ${dbName}`)
      }

      const action = options.keepData ? 'truncate' : 'drop'
      const shouldContinue = await confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${testDatabases.length} test database${testDatabases.length !== 1 ? 's' : ''}?`)

      if (!shouldContinue) {
        console.log(prism.gray('Teardown cancelled'))
        return
      }
    }

    // 3. Clean each database
    const cleanupSpinner = spinner()

    for (const dbName of testDatabases) {
      cleanupSpinner.start(`Cleaning ${dbName}...`)

      try {
        if (options.keepData) {
          // Truncate all tables but keep database
          await truncateDatabase(config.database, dbName, options.preserveLogs || false)
          result.databases.push({
            name: dbName,
            status: 'preserved',
            reason: 'Data truncated, structure preserved'
          })
          cleanupSpinner.succeed(`Truncated ${dbName}`)
        } else {
          // Drop the database
          await dropTestDatabase(config.database, dbName)
          result.databases.push({
            name: dbName,
            status: 'dropped'
          })
          cleanupSpinner.succeed(`Dropped ${dbName}`)
        }
      } catch (error) {
        result.databases.push({
          name: dbName,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error)
        })
        cleanupSpinner.fail(`Failed to clean ${dbName}: ${error}`)
      }
    }

    // 4. Clean test artifacts
    if (options.cleanArtifacts) {
      const artifactSpinner = spinner()
      artifactSpinner.start('Cleaning test artifacts...')

      const artifacts = await cleanTestArtifacts(options.preserveLogs || false)
      result.artifacts = artifacts

      artifactSpinner.succeed(`Cleaned ${artifacts.cleaned.length} artifact${artifacts.cleaned.length !== 1 ? 's' : ''}`)
    }

    result.duration = Date.now() - startTime

    // Display results
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      displayTeardownResults(result, options)
    }

  } catch (error) {
    teardownSpinner.fail('Teardown failed')
    throw error
  }
}

async function findTestDatabases(config: any, options: TestTeardownOptions): Promise<string[]> {
  const databases: string[] = []

  // If specific database is provided
  if (options.database) {
    databases.push(options.database)
    return databases
  }

  // Determine pattern to match
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

  // List databases based on dialect
  const dialect = config.dialect || 'postgresql'

  if (dialect === 'postgresql') {
    const adminConfig = {
      ...config,
      database: 'postgres'
    }

    const db = await getDatabaseConnection(adminConfig)
    if (db) {
      const result = await db
        .selectFrom('pg_database')
        .select('datname')
        .where('datname', 'like', `%${pattern}%`)
        .execute()

      databases.push(...result.map((r: any) => r.datname))
      await db.destroy()
    }
  } else if (dialect === 'mysql') {
    const adminConfig = {
      ...config,
      database: undefined
    }

    const db = await getDatabaseConnection(adminConfig)
    if (db) {
      const result = await db.raw('SHOW DATABASES')
      const dbNames = result[0].map((r: any) => r.Database || r.database)

      databases.push(...dbNames.filter((name: string) => name.includes(pattern)))
      await db.destroy()
    }
  } else if (dialect === 'sqlite') {
    // For SQLite, look for test database files
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

async function truncateDatabase(config: any, dbName: string, preserveLogs: boolean): Promise<void> {
  const testConfig = {
    ...config,
    database: dbName
  }

  const db = await getDatabaseConnection(testConfig)
  if (!db) {
    throw new Error(`Cannot connect to database ${dbName}`)
  }

  try {
    // Get all tables
    let tables: string[] = []

    if (db.dialectName === 'postgres') {
      const result = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', 'public')
        .where('table_type', '=', 'BASE TABLE')
        .execute()

      tables = result.map((r: any) => r.table_name)

      // Disable foreign key checks
      await db.raw('SET session_replication_role = replica')
    } else if (db.dialectName === 'mysql') {
      const result = await db.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
      `)

      tables = result[0].map((r: any) => r.TABLE_NAME || r.table_name)

      // Disable foreign key checks
      await db.raw('SET FOREIGN_KEY_CHECKS = 0')
    } else if (db.dialectName === 'sqlite') {
      const result = await db.raw(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      `)

      tables = result.map((r: any) => r.name)

      // Disable foreign key checks
      await db.raw('PRAGMA foreign_keys = OFF')
    }

    // Truncate each table
    for (const table of tables) {
      // Skip log tables if preserving logs
      if (preserveLogs && (table.includes('log') || table.includes('audit'))) {
        continue
      }

      if (db.dialectName === 'postgres' || db.dialectName === 'mysql') {
        await db.raw(`TRUNCATE TABLE ${table} CASCADE`)
      } else {
        await db.deleteFrom(table).execute()
      }
    }

    // Re-enable foreign key checks
    if (db.dialectName === 'postgres') {
      await db.raw('SET session_replication_role = DEFAULT')
    } else if (db.dialectName === 'mysql') {
      await db.raw('SET FOREIGN_KEY_CHECKS = 1')
    } else if (db.dialectName === 'sqlite') {
      await db.raw('PRAGMA foreign_keys = ON')
    }

  } finally {
    await db.destroy()
  }
}

async function dropTestDatabase(config: any, dbName: string): Promise<void> {
  const dialect = config.dialect || 'postgresql'

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

      await db.raw(`DROP DATABASE IF EXISTS "${dbName}"`)
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
    // For SQLite, delete the file
    try {
      await fs.unlink(dbName)
    } catch {
      // File might not exist
    }
  }
}

async function cleanTestArtifacts(preserveLogs: boolean): Promise<TeardownResult['artifacts']> {
  const artifacts: TeardownResult['artifacts'] = {
    cleaned: [],
    preserved: []
  }

  // Clean test output directories
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
      // Directory might not exist
    }
  }

  // Clean test config files
  const filesToClean = [
    'tests/test-config.ts',
    'tests/test-config.js',
    '.test.env'
  ]

  for (const file of filesToClean) {
    const fullPath = path.join(process.cwd(), file)
    try {
      await fs.unlink(fullPath)
      artifacts.cleaned.push(file)
    } catch {
      // File might not exist
    }
  }

  // Preserve certain artifacts
  if (preserveLogs) {
    const logsToPreserve = ['test-logs', 'logs/test']
    for (const log of logsToPreserve) {
      const fullPath = path.join(process.cwd(), log)
      try {
        await fs.access(fullPath)
        artifacts.preserved.push(log)
      } catch {
        // Directory doesn't exist
      }
    }
  }

  return artifacts
}

function displayTeardownResults(result: TeardownResult, options: TestTeardownOptions): void {
  console.log('')
  console.log(prism.bold('🧹 Test Environment Teardown Complete'))
  console.log(prism.gray('═'.repeat(50)))

  // Database cleanup results
  if (result.databases.length > 0) {
    console.log('')
    console.log(prism.cyan('Databases:'))

    const grouped = {
      dropped: result.databases.filter(d => d.status === 'dropped'),
      preserved: result.databases.filter(d => d.status === 'preserved'),
      failed: result.databases.filter(d => d.status === 'failed')
    }

    if (grouped.dropped.length > 0) {
      console.log(prism.green(`  ✅ Dropped: ${grouped.dropped.length}`))
      if (options.verbose) {
        for (const db of grouped.dropped) {
          console.log(`     • ${db.name}`)
        }
      }
    }

    if (grouped.preserved.length > 0) {
      console.log(prism.yellow(`  ⚠️  Preserved: ${grouped.preserved.length}`))
      if (options.verbose) {
        for (const db of grouped.preserved) {
          console.log(`     • ${db.name}: ${db.reason}`)
        }
      }
    }

    if (grouped.failed.length > 0) {
      console.log(prism.red(`  ❌ Failed: ${grouped.failed.length}`))
      for (const db of grouped.failed) {
        console.log(`     • ${db.name}: ${db.reason}`)
      }
    }
  }

  // Artifact cleanup results
  if (result.artifacts.cleaned.length > 0 || result.artifacts.preserved.length > 0) {
    console.log('')
    console.log(prism.cyan('Artifacts:'))

    if (result.artifacts.cleaned.length > 0) {
      console.log(`  Cleaned: ${result.artifacts.cleaned.length} item${result.artifacts.cleaned.length !== 1 ? 's' : ''}`)
      if (options.verbose) {
        for (const artifact of result.artifacts.cleaned) {
          console.log(`     • ${artifact}`)
        }
      }
    }

    if (result.artifacts.preserved.length > 0) {
      console.log(`  Preserved: ${result.artifacts.preserved.length} item${result.artifacts.preserved.length !== 1 ? 's' : ''}`)
      if (options.verbose) {
        for (const artifact of result.artifacts.preserved) {
          console.log(`     • ${artifact}`)
        }
      }
    }
  }

  // Summary
  console.log('')
  console.log(prism.cyan('Summary:'))
  console.log(`  Environment: ${result.environment}`)
  console.log(`  Duration: ${result.duration}ms`)

  // Tips
  if (result.databases.filter(d => d.status === 'failed').length > 0) {
    console.log('')
    console.log(prism.yellow('💡 Some databases could not be cleaned:'))
    console.log('  • Check for active connections')
    console.log('  • Verify database permissions')
    console.log('  • Use --force to skip confirmation')
  }

  if (options.keepData) {
    console.log('')
    console.log(prism.yellow('💡 Data was truncated but databases were preserved'))
    console.log('  Use without --keep-data to fully drop databases')
  }
}