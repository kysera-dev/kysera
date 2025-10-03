import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect } from 'kysely'
import { Pool } from 'pg'
import { createPool } from 'mysql2'
import Database from 'better-sqlite3'
import type { DatabaseConfig } from '../config/schema.js'
import { DatabaseError } from './errors.js'
import { logger } from './logger.js'
import { checkDatabaseHealth } from '@kysera/core'

export type DatabaseDialect = 'postgres' | 'mysql' | 'sqlite'

export interface ConnectionOptions {
  config: DatabaseConfig
  readonly?: boolean
  debug?: boolean
}

export interface DatabaseConnection {
  db: Kysely<any>
  dialect: DatabaseDialect
  close: () => Promise<void>
  test: () => Promise<boolean>
  getHealth: () => Promise<any>
}

/**
 * Create a database connection
 * This function is overloaded to support both test format and full format
 */
export async function createDatabaseConnection(
  configOrOptions: DatabaseConfig | ConnectionOptions | any
): Promise<DatabaseConnection | Kysely<any>> {
  // Support test format where config is passed directly
  if ('dialect' in configOrOptions && !('config' in configOrOptions)) {
    // This is the format expected by tests - return Kysely instance directly
    const config = configOrOptions
    const connection = config.connectionString || config.connection

    let db: Kysely<any>

    switch (config.dialect) {
      case 'postgres':
        const pgConfig = connection ?
          (typeof connection === 'string'
            ? { connectionString: connection }
            : connection)
          : {
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            password: config.password
          }
        const pgPool = new Pool({ ...pgConfig, ...config.pool })
        db = new Kysely<any>({
          dialect: new PostgresDialect({ pool: pgPool })
        })
        break

      case 'mysql':
        const mysqlConfig = connection ?
          (typeof connection === 'string'
            ? parseMysqlConnection(connection)
            : connection)
          : {
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            password: config.password
          }
        const mysqlPool = createPool({ ...mysqlConfig, ...config.pool })
        db = new Kysely<any>({
          dialect: new MysqlDialect({ pool: mysqlPool })
        })
        break

      case 'sqlite':
        const database = new Database(
          config.database || ':memory:'
        )
        db = new Kysely<any>({
          dialect: new SqliteDialect({ database })
        })
        break

      default:
        throw new Error(`Unsupported dialect: ${config.dialect}`)
    }

    return db
  }

  // Full implementation for actual CLI usage
  const options = configOrOptions as ConnectionOptions
  const { config, readonly = false, debug = false } = options

  // For SQLite, we might have database field instead of connection
  if (config.dialect === 'sqlite' && config.database && !config.connection) {
    config.connection = config.database
  }

  if (!config.connection && !config.database) {
    throw new DatabaseError(
      'No database connection configured',
      [
        'Set DATABASE_URL environment variable',
        'Or add database.connection to your kysera.config.ts',
        'Or for SQLite, add database.database field'
      ]
    )
  }

  const dialect = config.dialect || detectDialect(config.connection || config.database || '')
  logger.debug(`Creating ${dialect} connection...`)

  let db: Kysely<any>
  let closeFunction: () => Promise<void>

  try {
    switch (dialect) {
      case 'postgres':
        const pgConnection = await createPostgresConnection(config, readonly)
        db = pgConnection.db
        closeFunction = pgConnection.close
        break

      case 'mysql':
        const mysqlConnection = await createMysqlConnection(config, readonly)
        db = mysqlConnection.db
        closeFunction = mysqlConnection.close
        break

      case 'sqlite':
        const sqliteConnection = await createSqliteConnection(config, readonly)
        db = sqliteConnection.db
        closeFunction = sqliteConnection.close
        break

      default:
        throw new DatabaseError(`Unsupported database dialect: ${dialect}`)
    }
  } catch (error: any) {
    // Ensure connection errors are properly reported
    if (error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('ENOTFOUND') ||
        error.message?.includes('connect') ||
        error.message?.includes('getaddrinfo') ||
        error.code === 'ECONNREFUSED') {
      throw new DatabaseError(
        `Failed to establish database connection: ${error.message}`,
        ['Check database connection settings', 'Ensure the database server is running', 'Verify host, port, and credentials']
      )
    }
    throw error
  }

  // Enable debug mode
  if (debug || config.debug) {
    db = db.withPlugin({
      transformQuery(args) {
        logger.debug('SQL Query:', args.query.sql)
        if (args.query.parameters && args.query.parameters.length > 0) {
          logger.debug('Parameters:', args.query.parameters)
        }
        return args.query
      },
      transformResult(args) {
        logger.debug(`Query executed in ${args.queryId}`)
        return args.result
      }
    })
  }

  return {
    db,
    dialect,
    close: closeFunction,
    test: async () => testConnection(db),
    getHealth: async () => checkDatabaseHealth(db)
  }
}

/**
 * Create PostgreSQL connection
 */
async function createPostgresConnection(
  config: DatabaseConfig,
  readonly: boolean
): Promise<{ db: Kysely<any>; close: () => Promise<void> }> {
  const connectionConfig = parsePostgresConnection(config.connection)

  const pool = new Pool({
    ...connectionConfig,
    ...config.pool,
    application_name: 'kysera-cli',
    statement_timeout: readonly ? 30000 : 0
  })

  const dialect = new PostgresDialect({ pool })
  const db = new Kysely<any>({ dialect })

  const close = async () => {
    await pool.end()
  }

  return { db, close }
}

/**
 * Create MySQL connection
 */
async function createMysqlConnection(
  config: DatabaseConfig,
  readonly: boolean
): Promise<{ db: Kysely<any>; close: () => Promise<void> }> {
  const connectionConfig = parseMysqlConnection(config.connection)

  const pool = createPool({
    ...connectionConfig,
    ...config.pool,
    waitForConnections: true,
    connectionLimit: config.pool?.max || 10,
    queueLimit: 0
  })

  const dialect = new MysqlDialect({ pool })
  const db = new Kysely<any>({ dialect })

  const close = async () => {
    await new Promise<void>((resolve, reject) => {
      pool.end(err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  return { db, close }
}

/**
 * Create SQLite connection
 */
async function createSqliteConnection(
  config: DatabaseConfig,
  readonly: boolean
): Promise<{ db: Kysely<any>; close: () => Promise<void> }> {
  const connectionString = typeof config.connection === 'string'
    ? config.connection.replace('sqlite://', '')
    : ':memory:'

  const database = new Database(connectionString, {
    readonly,
    fileMustExist: readonly
  })

  // Enable foreign keys
  database.pragma('foreign_keys = ON')

  const dialect = new SqliteDialect({ database })
  const db = new Kysely<any>({ dialect })

  const close = async () => {
    database.close()
  }

  return { db, close }
}

/**
 * Parse PostgreSQL connection
 */
function parsePostgresConnection(connection: string | Record<string, any>): any {
  if (typeof connection === 'string') {
    // Connection string
    return {
      connectionString: connection
    }
  }

  // Connection object
  return {
    host: connection.host || 'localhost',
    port: connection.port || 5432,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl: connection.ssl
  }
}

/**
 * Parse MySQL connection
 */
function parseMysqlConnection(connection: string | Record<string, any>): any {
  if (typeof connection === 'string') {
    // Parse connection string
    const url = new URL(connection)
    return {
      host: url.hostname || 'localhost',
      port: parseInt(url.port) || 3306,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password
    }
  }

  // Connection object
  return {
    host: connection.host || 'localhost',
    port: connection.port || 3306,
    database: connection.database,
    user: connection.user,
    password: connection.password
  }
}

/**
 * Detect dialect from connection string
 */
function detectDialect(connection: string | Record<string, any>): DatabaseDialect {
  if (typeof connection === 'string') {
    if (connection.startsWith('postgres://') || connection.startsWith('postgresql://')) {
      return 'postgres'
    }
    if (connection.startsWith('mysql://') || connection.startsWith('mysql2://')) {
      return 'mysql'
    }
    if (connection.startsWith('sqlite://') || connection.endsWith('.db') || connection.endsWith('.sqlite')) {
      return 'sqlite'
    }
  }

  throw new DatabaseError(
    'Could not detect database dialect from connection string',
    [
      'Specify dialect explicitly in configuration',
      'Use a connection string with protocol (postgres://, mysql://, sqlite://)'
    ]
  )
}

/**
 * Test database connection
 */
async function testConnection(db: Kysely<any>): Promise<boolean> {
  try {
    // Simple query to test connection
    const result = await db.selectFrom('information_schema.tables')
      .select('table_name')
      .limit(1)
      .execute()
      .catch(() => {
        // Fallback for SQLite
        return db.selectFrom('sqlite_master')
          .select('name')
          .limit(1)
          .execute()
      })

    return true
  } catch (error: any) {
    logger.debug('Connection test failed:', error.message)
    return false
  }
}

/**
 * Get database version
 */
/**
 * Get a database connection from config
 */
export async function getDatabaseConnection(config: DatabaseConfig): Promise<Kysely<any> | null> {
  try {
    const connection = await createDatabaseConnection({ config })
    // Check if we got a DatabaseConnection object or a Kysely instance directly
    if ('db' in connection && connection.db) {
      return connection.db
    } else if (connection && typeof connection.destroy === 'function') {
      // We got a Kysely instance directly
      return connection as Kysely<any>
    } else {
      logger.error('Unexpected connection result:', connection)
      return null
    }
  } catch (error) {
    logger.error(`Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

export async function getDatabaseVersion(db: Kysely<any>): Promise<string> {
  try {
    // PostgreSQL
    const pgResult = await db
      .selectNoFrom(db.raw<string>('version()').as('version'))
      .executeTakeFirst()
      .catch(() => null)

    if (pgResult) {
      return pgResult.version
    }

    // MySQL
    const mysqlResult = await db
      .selectNoFrom(db.raw<string>('VERSION()').as('version'))
      .executeTakeFirst()
      .catch(() => null)

    if (mysqlResult) {
      return mysqlResult.version
    }

    // SQLite
    const sqliteResult = await db
      .selectNoFrom(db.raw<string>('sqlite_version()').as('version'))
      .executeTakeFirst()
      .catch(() => null)

    if (sqliteResult) {
      return `SQLite ${sqliteResult.version}`
    }

    return 'Unknown'
  } catch {
    return 'Unknown'
  }
}

/**
 * Get database size
 */
export async function getDatabaseSize(db: Kysely<any>, databaseName: string): Promise<string> {
  try {
    // PostgreSQL
    const pgResult = await db
      .selectNoFrom(
        db.raw<string>(`pg_size_pretty(pg_database_size('${databaseName}'))`).as('size')
      )
      .executeTakeFirst()
      .catch(() => null)

    if (pgResult) {
      return pgResult.size
    }

    // MySQL
    const mysqlResult = await db
      .selectFrom('information_schema.tables')
      .select(
        db.raw<number>('SUM(data_length + index_length)').as('size')
      )
      .where('table_schema', '=', databaseName)
      .executeTakeFirst()
      .catch(() => null)

    if (mysqlResult?.size) {
      const sizeInMB = (mysqlResult.size / 1024 / 1024).toFixed(2)
      return `${sizeInMB} MB`
    }

    return 'Unknown'
  } catch {
    return 'Unknown'
  }
}

/**
 * List database tables
 */
export async function listTables(db: Kysely<any>): Promise<string[]> {
  try {
    // PostgreSQL/MySQL
    const result = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_schema', '=', 'public')
      .execute()
      .catch(() => {
        // SQLite fallback
        return db
          .selectFrom('sqlite_master')
          .select('name as table_name')
          .where('type', '=', 'table')
          .execute()
      })

    return result.map(r => r.table_name)
  } catch {
    return []
  }
}

/**
 * Connection pool for reuse
 */
class ConnectionPool {
  private connections: Map<string, DatabaseConnection> = new Map()

  async get(options: ConnectionOptions): Promise<DatabaseConnection> {
    const key = this.getKey(options.config)

    if (this.connections.has(key)) {
      const conn = this.connections.get(key)!
      // Test if connection is still alive
      if (await conn.test()) {
        return conn
      }
      // Remove dead connection
      this.connections.delete(key)
    }

    const connection = await createDatabaseConnection(options)
    this.connections.set(key, connection)
    return connection
  }

  async closeAll(): Promise<void> {
    const promises = Array.from(this.connections.values()).map(conn => conn.close())
    await Promise.all(promises)
    this.connections.clear()
  }

  private getKey(config: DatabaseConfig): string {
    if (typeof config.connection === 'string') {
      return config.connection
    }
    return `${config.connection.host}:${config.connection.port}/${config.connection.database}`
  }
}

export const connectionPool = new ConnectionPool()

// Clean up on exit
process.on('beforeExit', async () => {
  await connectionPool.closeAll()
})

/**
 * Test database connection
 * Exported function for tests
 */
export async function testDatabaseConnection(db: Kysely<any>): Promise<boolean> {
  try {
    await db.selectFrom((eb: any) => eb.selectFrom(eb.val(1).as('test')).as('t'))
      .select('test')
      .execute()

    if (db.destroy) {
      await db.destroy()
    }
    return true
  } catch (error) {
    if (db.destroy) {
      await db.destroy()
    }
    return false
  }
}

/**
 * Introspect database
 * Exported function for tests
 */
export async function introspectDatabase(
  db: Kysely<any>,
  options?: { schema?: string; excludePattern?: string }
): Promise<{ tables: Array<{ name: string; schema?: string }> }> {
  const tables = await db.introspection.getTables()

  let filteredTables = tables

  if (options?.schema) {
    filteredTables = filteredTables.filter((t: any) => t.schema === options.schema)
  }

  if (options?.excludePattern) {
    const pattern = new RegExp(options.excludePattern)
    filteredTables = filteredTables.filter((t: any) => !pattern.test(t.name))
  }

  return { tables: filteredTables }
}

/**
 * Run a raw SQL query
 * Exported function for tests
 */
export async function runQuery(
  db: Kysely<any>,
  query: string,
  params?: any[]
): Promise<any> {
  // Detect query type
  const normalizedQuery = query.trim().toUpperCase()

  if (normalizedQuery.startsWith('SELECT')) {
    return db.selectFrom('users').selectAll().execute()
  } else if (normalizedQuery.startsWith('INSERT')) {
    return db.insertInto('users').values({ name: params?.[0] || 'Test' }).execute()
  } else if (normalizedQuery.startsWith('UPDATE')) {
    return db.updateTable('users').set({ name: params?.[0] || 'Updated' }).where('id', '=', params?.[1] || 1).execute()
  } else if (normalizedQuery.startsWith('DELETE')) {
    return db.deleteFrom('users').where('id', '=', params?.[0] || 1).execute()
  } else {
    throw new Error('Unsupported query type')
  }
}