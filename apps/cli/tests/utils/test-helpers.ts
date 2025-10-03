import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect } from 'kysely'
import { Pool } from 'pg'
import { createPool } from 'mysql2'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.join(__dirname, '../../dist/index.js')

/**
 * Test CLI command execution
 */
export async function runCLI(
  args: string[],
  options: {
    cwd?: string
    env?: Record<string, string>
    input?: string
    timeout?: number
  } = {}
): Promise<{
  code: number | null
  stdout: string
  stderr: string
}> {
  return new Promise((resolve, reject) => {
    // Use process.execPath to get the current Node.js executable
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',  // Always set NODE_ENV to test for CLI tests
        ...options.env
      },
      stdio: 'pipe'
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    // Set a timeout if specified (default 30 seconds for tests)
    const timeoutMs = options.timeout || 30000
    const timeoutId = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // Force kill after 1 second if still running
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL')
        }
      }, 1000)
    }, timeoutMs)

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    if (options.input) {
      child.stdin.write(options.input)
      child.stdin.end()
    } else {
      // Close stdin if no input to prevent hanging on input prompts
      child.stdin.end()
    }

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      if (timedOut) {
        reject(new Error(`Command timed out after ${timeoutMs}ms\nstdout: ${stdout}\nstderr: ${stderr}`))
      } else {
        resolve({ code, stdout, stderr })
      }
    })

    child.on('error', (error) => {
      clearTimeout(timeoutId)
      reject(error)
    })
  })
}

/**
 * Create a test database
 */
export async function createTestDatabase(
  dialect: 'postgres' | 'mysql' | 'sqlite',
  name: string
): Promise<Kysely<any>> {
  switch (dialect) {
    case 'postgres': {
      const pool = new Pool({
        host: process.env['DB_HOST'] || 'localhost',
        port: parseInt(process.env['DB_PORT'] || '5432'),
        user: process.env['DB_USER'] || 'postgres',
        password: process.env['DB_PASSWORD'] || 'postgres',
        database: 'postgres'
      })

      // Drop if exists and create
      await pool.query(`DROP DATABASE IF EXISTS "${name}"`)
      await pool.query(`CREATE DATABASE "${name}"`)
      await pool.end()

      return new Kysely({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: process.env['DB_HOST'] || 'localhost',
            port: parseInt(process.env['DB_PORT'] || '5432'),
            user: process.env['DB_USER'] || 'postgres',
            password: process.env['DB_PASSWORD'] || 'postgres',
            database: name
          })
        })
      })
    }

    case 'mysql': {
      const pool = createPool({
        host: process.env['DB_HOST'] || 'localhost',
        port: parseInt(process.env['DB_PORT'] || '3306'),
        user: process.env['DB_USER'] || 'root',
        password: process.env['DB_PASSWORD'] || 'root'
      })

      const connection = pool.promise()
      await connection.query(`DROP DATABASE IF EXISTS \`${name}\``)
      await connection.query(`CREATE DATABASE \`${name}\``)
      await pool.end()

      return new Kysely({
        dialect: new MysqlDialect({
          pool: createPool({
            host: process.env['DB_HOST'] || 'localhost',
            port: parseInt(process.env['DB_PORT'] || '3306'),
            user: process.env['DB_USER'] || 'root',
            password: process.env['DB_PASSWORD'] || 'root',
            database: name
          })
        })
      })
    }

    case 'sqlite': {
      const dbPath = path.join(__dirname, '../../.test-db', `${name}.db`)
      await fs.mkdir(path.dirname(dbPath), { recursive: true })

      // Remove if exists
      try {
        await fs.unlink(dbPath)
      } catch {
        // Ignore if doesn't exist
      }

      return new Kysely({
        dialect: new SqliteDialect({
          database: new Database(dbPath)
        })
      })
    }
  }
}

/**
 * Clean up test database
 */
export async function cleanupTestDatabase(
  dialect: 'postgres' | 'mysql' | 'sqlite',
  name: string
): Promise<void> {
  switch (dialect) {
    case 'postgres': {
      const pool = new Pool({
        host: process.env['DB_HOST'] || 'localhost',
        port: parseInt(process.env['DB_PORT'] || '5432'),
        user: process.env['DB_USER'] || 'postgres',
        password: process.env['DB_PASSWORD'] || 'postgres',
        database: 'postgres'
      })

      await pool.query(`DROP DATABASE IF EXISTS "${name}"`)
      await pool.end()
      break
    }

    case 'mysql': {
      const pool = createPool({
        host: process.env['DB_HOST'] || 'localhost',
        port: parseInt(process.env['DB_PORT'] || '3306'),
        user: process.env['DB_USER'] || 'root',
        password: process.env['DB_PASSWORD'] || 'root'
      })

      const connection = pool.promise()
      await connection.query(`DROP DATABASE IF EXISTS \`${name}\``)
      await pool.end()
      break
    }

    case 'sqlite': {
      const dbPath = path.join(__dirname, '../../.test-db', `${name}.db`)
      try {
        await fs.unlink(dbPath)
      } catch {
        // Ignore
      }
      break
    }
  }
}

/**
 * Create a test configuration file
 */
export async function createTestConfig(
  dir: string,
  config: any
): Promise<string> {
  const configPath = path.join(dir, 'kysera.config.json')
  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  return configPath
}

/**
 * Create test migrations
 */
export async function createTestMigrations(dir: string): Promise<void> {
  const migrationsDir = path.join(dir, 'migrations')
  await fs.mkdir(migrationsDir, { recursive: true })

  // Create a simple migration (no Kysely import needed as db is passed)
  const migration = `
export async function up(db) {
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('name', 'varchar(255)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .execute()

  await db.schema
    .createTable('posts')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id'))
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('content', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .execute()
}

export async function down(db) {
  await db.schema.dropTable('posts').execute()
  await db.schema.dropTable('users').execute()
}
`

  await fs.writeFile(
    path.join(migrationsDir, '001_initial.ts'),
    migration.trim()
  )
}

/**
 * Create a test project directory
 */
export async function createTestProject(
  name: string,
  options: {
    dialect?: 'postgres' | 'mysql' | 'sqlite'
    withMigrations?: boolean
    withConfig?: boolean
  } = {}
): Promise<{
  dir: string
  cleanup: () => Promise<void>
}> {
  const tempDir = path.join(__dirname, '../../.test-projects', name)
  await fs.mkdir(tempDir, { recursive: true })

  if (options.withConfig) {
    await createTestConfig(tempDir, {
      database: {
        dialect: options.dialect || 'sqlite',
        database: name,
        host: 'localhost',
        user: 'test',
        password: 'test'
      }
    })
  }

  if (options.withMigrations) {
    await createTestMigrations(tempDir)
  }

  return {
    dir: tempDir,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}

/**
 * Mock user input for interactive prompts
 */
export class InputMocker {
  private inputs: string[] = []
  private currentIndex = 0

  constructor(inputs: string[]) {
    this.inputs = inputs
  }

  getNext(): string {
    if (this.currentIndex >= this.inputs.length) {
      throw new Error('No more mocked inputs available')
    }
    return this.inputs[this.currentIndex++]
  }

  reset(): void {
    this.currentIndex = 0
  }

  hasMore(): boolean {
    return this.currentIndex < this.inputs.length
  }
}

/**
 * Capture console output
 */
export function captureConsole(): {
  getOutput: () => string[]
  getErrors: () => string[]
  restore: () => void
} {
  const originalLog = console.log
  const originalError = console.error

  const output: string[] = []
  const errors: string[] = []

  console.log = (...args: any[]) => {
    output.push(args.map(String).join(' '))
  }

  console.error = (...args: any[]) => {
    errors.push(args.map(String).join(' '))
  }

  return {
    getOutput: () => [...output],
    getErrors: () => [...errors],
    restore: () => {
      console.log = originalLog
      console.error = originalError
    }
  }
}

/**
 * Test fixtures helper
 */
export async function loadTestFixture(name: string): Promise<any> {
  const fixturePath = path.join(__dirname, '../fixtures', name)
  const content = await fs.readFile(fixturePath, 'utf-8')

  if (name.endsWith('.json')) {
    return JSON.parse(content)
  } else if (name.endsWith('.sql')) {
    return content
  } else if (name.endsWith('.yaml') || name.endsWith('.yml')) {
    const yaml = await import('js-yaml')
    return yaml.load(content)
  }

  return content
}

/**
 * Compare two objects, ignoring specified fields
 */
export function compareObjects(
  actual: any,
  expected: any,
  ignoreFields: string[] = []
): boolean {
  const clean = (obj: any): any => {
    if (obj === null || obj === undefined) return obj
    if (typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(clean)

    const cleaned = { ...obj }
    for (const field of ignoreFields) {
      delete cleaned[field]
    }

    return Object.keys(cleaned).reduce((acc, key) => {
      acc[key] = clean(cleaned[key])
      return acc
    }, {} as any)
  }

  const cleanedActual = clean(actual)
  const cleanedExpected = clean(expected)

  return JSON.stringify(cleanedActual) === JSON.stringify(cleanedExpected)
}

/**
 * Get test database connection string
 */
export function getTestDatabaseUrl(
  dialect: 'postgres' | 'mysql' | 'sqlite',
  dbName: string
): string {
  switch (dialect) {
    case 'postgres':
      return `postgres://postgres:postgres@localhost:5432/${dbName}`
    case 'mysql':
      return `mysql://root:root@localhost:3306/${dbName}`
    case 'sqlite':
      return `sqlite://.test-db/${dbName}.db`
    default:
      throw new Error(`Unsupported dialect: ${dialect}`)
  }
}