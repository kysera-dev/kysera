import type {
  Kysely,
  RootOperationNode,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  UnknownRow
} from 'kysely'
import type { DatabaseConfig } from '../config/schema.js'
import { CLIDatabaseError, ValidationError } from './errors.js'
import { logger } from './logger.js'

export type DatabaseDialect = 'postgres' | 'mysql' | 'sqlite'

// Generic database type - can be extended with specific table schemas
export type Database = Record<string, Record<string, unknown>>;

export interface ConnectionOptions {
  config: DatabaseConfig
  readonly?: boolean
  debug?: boolean
}

export interface PostgresConnectionConfig {
  connectionString?: string
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  ssl?: boolean | Record<string, unknown>
}

export interface MysqlConnectionConfig {
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
}

export interface PoolConfig {
  min?: number
  max?: number
  idleTimeoutMillis?: number
  acquireTimeoutMillis?: number
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy'
  latency?: number
  details?: Record<string, unknown>
}

export interface DatabaseConnection {
  db: Kysely<Database>
  dialect: DatabaseDialect
  close: () => Promise<void>
  test: () => Promise<boolean>
  getHealth: () => Promise<HealthCheckResult>
}

/**
 * Create a database connection
 * This function is overloaded to support both test format and full format
 *
 * Database drivers (pg/mysql2/better-sqlite3) and kysely itself are
 * imported on demand so that building the command tree stays cheap.
 */
export async function createDatabaseConnection(
  configOrOptions: DatabaseConfig | ConnectionOptions
): Promise<DatabaseConnection | Kysely<Database>> {
  // Support test format where config is passed directly
  if ('dialect' in configOrOptions && !('config' in configOrOptions)) {
    // This is the format expected by tests - return Kysely instance directly
    const config = configOrOptions
    const connection =
      (config as { connectionString?: string }).connectionString ?? config.connection

    const { Kysely, PostgresDialect, MysqlDialect, SqliteDialect } = await import('kysely')

    let db: Kysely<Database>

    switch (config.dialect) {
      case 'postgres': {
        const pgConfig = connection
          ? typeof connection === 'string'
            ? { connectionString: connection }
            : connection
          : {
              host: config.host,
              port: config.port,
              database: config.database,
              user: config.user,
              password: config.password
            }
        const { Pool } = await import('pg')
        const pgPool = new Pool({ ...pgConfig, ...config.pool })
        db = new Kysely<Database>({
          dialect: new PostgresDialect({ pool: pgPool })
        })
        break
      }

      case 'mysql': {
        const mysqlConfig = connection
          ? typeof connection === 'string'
            ? parseMysqlConnection(connection)
            : connection
          : {
              host: config.host,
              port: config.port,
              database: config.database,
              user: config.user,
              password: config.password
            }
        const { createPool } = await import('mysql2')
        const mysqlPool = createPool({ ...mysqlConfig, ...config.pool })
        db = new Kysely<Database>({
          dialect: new MysqlDialect({ pool: mysqlPool })
        })
        break
      }

      case 'sqlite': {
        const { default: SqliteDatabase } = await import('better-sqlite3')
        const database = new SqliteDatabase(config.database ?? ':memory:')
        db = new Kysely<Database>({
          dialect: new SqliteDialect({ database })
        })
        break
      }

      default:
        throw new CLIDatabaseError(`Unsupported dialect: ${String(config.dialect)}`)
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
    throw new CLIDatabaseError('No database connection configured', [
      'Set DATABASE_URL environment variable',
      'Or add database.connection to your kysera.config.ts',
      'Or for SQLite, add database.database field'
    ])
  }

  // The schema requires dialect, but plain-JS callers may omit it
  const dialect =
    (config as { dialect?: DatabaseDialect }).dialect ??
    detectDialect(config.connection ?? config.database ?? '')
  logger.debug(`Creating ${dialect} connection...`)

  let db: Kysely<Database>
  let closeFunction: () => Promise<void>

  try {
    switch (dialect) {
      case 'postgres': {
        const pgConnection = await createPostgresConnection(config, readonly)
        db = pgConnection.db
        closeFunction = pgConnection.close
        break
      }

      case 'mysql': {
        const mysqlConnection = await createMysqlConnection(config, readonly)
        db = mysqlConnection.db
        closeFunction = mysqlConnection.close
        break
      }

      case 'sqlite': {
        const sqliteConnection = await createSqliteConnection(config, readonly)
        db = sqliteConnection.db
        closeFunction = sqliteConnection.close
        break
      }

      default:
        throw new CLIDatabaseError(`Unsupported database dialect: ${String(dialect)}`)
    }
  } catch (error) {
    const err = error as Error & { code?: string }
    // Ensure connection errors are properly reported
    if (
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ENOTFOUND') ||
      err.message.includes('connect') ||
      err.message.includes('getaddrinfo') ||
      err.code === 'ECONNREFUSED'
    ) {
      throw new CLIDatabaseError(`Failed to establish database connection: ${err.message}`, [
        'Check database connection settings',
        'Ensure the database server is running',
        'Verify host, port, and credentials'
      ])
    }
    throw error
  }

  // Enable debug mode
  if (debug || config.debug) {
    const { DefaultQueryCompiler } = await import('kysely')
    db = db.withPlugin({
      transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
        const compiler = new DefaultQueryCompiler()
        const compiled = compiler.compileQuery(args.node, args.queryId)
        logger.debug('SQL Query:', compiled.sql)
        if (compiled.parameters.length > 0) {
          logger.debug('Parameters:', compiled.parameters)
        }
        return args.node
      },
      transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
        logger.debug('Query executed', args.queryId)
        return Promise.resolve(args.result)
      }
    })
  }

  return {
    db,
    dialect,
    close: closeFunction,
    test: async () => testConnection(db),
    getHealth: async () => {
      const { checkDatabaseHealth } = await import('@kysera/infra')
      return checkDatabaseHealth(db)
    }
  }
}

/**
 * Create PostgreSQL connection
 */
async function createPostgresConnection(
  config: DatabaseConfig,
  readonly: boolean
): Promise<{ db: Kysely<Database>; close: () => Promise<void> }> {
  // `connection` (string or object) takes precedence; otherwise fall back to
  // the structured top-level fields (host/port/database/user/password/ssl)
  const connectionConfig: PostgresConnectionConfig = config.connection
    ? parsePostgresConnection(config.connection)
    : {
        host: config.host ?? 'localhost',
        port: config.port ?? 5432,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl
      }

  const [{ Kysely, PostgresDialect }, { Pool }] = await Promise.all([
    import('kysely'),
    import('pg')
  ])

  const pool = new Pool({
    ...connectionConfig,
    ...config.pool,
    application_name: 'kysera-cli',
    statement_timeout: readonly ? 30000 : 0
  })

  const dialect = new PostgresDialect({ pool })
  const db = new Kysely<Database>({ dialect })

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
  _readonly: boolean
): Promise<{ db: Kysely<Database>; close: () => Promise<void> }> {
  // `connection` (string or object) takes precedence; otherwise fall back to
  // the structured top-level fields (host/port/database/user/password)
  const connectionConfig: MysqlConnectionConfig = config.connection
    ? parseMysqlConnection(config.connection)
    : {
        host: config.host ?? 'localhost',
        port: config.port ?? 3306,
        database: config.database,
        user: config.user,
        password: config.password
      }

  const [{ Kysely, MysqlDialect }, { createPool }] = await Promise.all([
    import('kysely'),
    import('mysql2')
  ])

  const pool = createPool({
    ...connectionConfig,
    ...config.pool,
    waitForConnections: true,
    connectionLimit: config.pool?.max ?? 10,
    queueLimit: 0
  })

  const dialect = new MysqlDialect({ pool })
  const db = new Kysely<Database>({ dialect })

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
): Promise<{ db: Kysely<Database>; close: () => Promise<void> }> {
  const connectionString =
    typeof config.connection === 'string' ? config.connection.replace('sqlite://', '') : ':memory:'

  const [{ Kysely, SqliteDialect }, { default: SqliteDatabase }] = await Promise.all([
    import('kysely'),
    import('better-sqlite3')
  ])

  const database = new SqliteDatabase(connectionString, {
    readonly,
    fileMustExist: readonly
  })

  // Enable foreign keys
  database.pragma('foreign_keys = ON')

  const dialect = new SqliteDialect({ database })
  const db = new Kysely<Database>({ dialect })

  const close = (): Promise<void> => {
    database.close()
    return Promise.resolve()
  }

  return { db, close }
}

/**
 * Parse PostgreSQL connection
 */
function parsePostgresConnection(
  connection: string | Record<string, unknown> | undefined
): PostgresConnectionConfig {
  if (typeof connection === 'string') {
    // Connection string
    return {
      connectionString: connection
    }
  }

  if (!connection) {
    return {}
  }

  // Connection object
  return {
    host: (connection.host as string) || 'localhost',
    port: (connection.port as number) || 5432,
    database: connection.database as string,
    user: connection.user as string,
    password: connection.password as string,
    ssl: connection.ssl as boolean | Record<string, unknown>
  }
}

/**
 * Parse MySQL connection
 */
function parseMysqlConnection(
  connection: string | Record<string, unknown> | undefined
): MysqlConnectionConfig {
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

  if (!connection) {
    return {}
  }

  // Connection object
  return {
    host: (connection.host as string) || 'localhost',
    port: (connection.port as number) || 3306,
    database: connection.database as string,
    user: connection.user as string,
    password: connection.password as string
  }
}

/**
 * Detect dialect from connection string
 */
function detectDialect(connection: string | Record<string, unknown>): DatabaseDialect {
  if (typeof connection === 'string') {
    if (connection.startsWith('postgres://') || connection.startsWith('postgresql://')) {
      return 'postgres'
    }
    if (connection.startsWith('mysql://') || connection.startsWith('mysql2://')) {
      return 'mysql'
    }
    if (
      connection.startsWith('sqlite://') ||
      connection.endsWith('.db') ||
      connection.endsWith('.sqlite')
    ) {
      return 'sqlite'
    }
  }

  throw new CLIDatabaseError('Could not detect database dialect from connection string', [
    'Specify dialect explicitly in configuration',
    'Use a connection string with protocol (postgres://, mysql://, sqlite://)'
  ])
}

/**
 * Test database connection
 */
async function testConnection(db: Kysely<Database>): Promise<boolean> {
  try {
    // Simple query to test connection
    await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .limit(1)
      .execute()
      .catch(() => {
        // Fallback for SQLite
        return db.selectFrom('sqlite_master').select('name').limit(1).execute()
      })

    return true
  } catch (error) {
    const err = error as Error
    logger.debug('Connection test failed:', err.message)
    return false
  }
}

/**
 * Get a database connection from config
 */
export async function getDatabaseConnection(
  config: DatabaseConfig
): Promise<Kysely<Database> | null> {
  try {
    const connection = await createDatabaseConnection({ config })
    // Check if we got a DatabaseConnection object or a Kysely instance directly
    if ('db' in connection) {
      return connection.db
    } else if (typeof (connection).destroy === 'function') {
      // We got a Kysely instance directly
      return connection
    } else {
      logger.error('Unexpected connection result:', connection)
      return null
    }
  } catch (error) {
    logger.error(
      `Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}

export async function getDatabaseVersion(db: Kysely<Database>): Promise<string> {
  const { sql } = await import('kysely')
  try {
    // PostgreSQL
    const pgResult = await db
      .selectNoFrom(sql<string>`version()`.as('version'))
      .executeTakeFirst()
      .catch(() => null)

    if (pgResult) {
      return pgResult.version
    }

    // MySQL
    const mysqlResult = await db
      .selectNoFrom(sql<string>`VERSION()`.as('version'))
      .executeTakeFirst()
      .catch(() => null)

    if (mysqlResult) {
      return mysqlResult.version
    }

    // SQLite
    const sqliteResult = await db
      .selectNoFrom(sql<string>`sqlite_version()`.as('version'))
      .executeTakeFirst()
      .catch(() => null)

    if (sqliteResult) {
      return `SQLite ${sqliteResult.version}`
    }

    return 'Unknown'
  } catch (error) {
    logger.debug('Failed to get database version:', error)
    return 'Unknown'
  }
}

/**
 * Get database size
 *
 * SECURITY: This function validates database names to prevent SQL injection attacks.
 * Database names are sanitized to only allow alphanumeric characters, underscores, and hyphens.
 * For PostgreSQL, we use current_database() instead of interpolating the database name.
 */
export async function getDatabaseSize(db: Kysely<Database>, databaseName: string): Promise<string> {
  const { sql } = await import('kysely')
  try {
    // SECURITY: Validate database name to prevent SQL injection
    // Database names should only contain alphanumeric characters, underscores, and hyphens
    if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) {
      throw new ValidationError('Invalid database name: contains unsafe characters')
    }

    // PostgreSQL - use parameterized query with sql and proper escaping
    const pgResult = await db
      .selectNoFrom(sql<string>`pg_size_pretty(pg_database_size(current_database()))`.as('size'))
      .executeTakeFirst()
      .catch(() => null)

    if (pgResult) {
      return pgResult.size
    }

    // MySQL - use parameterized WHERE clause (already safe)
    const mysqlResult = await db
      .selectFrom('information_schema.tables')
      .select(sql<number>`SUM(data_length + index_length)`.as('size'))
      .where('table_schema', '=', databaseName)
      .executeTakeFirst()
      .catch(() => null)

    if (mysqlResult?.size) {
      const sizeInMB = (mysqlResult.size / 1024 / 1024).toFixed(2)
      return `${sizeInMB} MB`
    }

    return 'Unknown'
  } catch (error) {
    logger.debug('Failed to get database size:', error)
    return 'Unknown'
  }
}

/**
 * List database tables
 */
export async function listTables(db: Kysely<Database>): Promise<string[]> {
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

    return result.map(r => r.table_name as string)
  } catch (error) {
    logger.debug('Failed to list database tables:', error)
    return []
  }
}

/**
 * Test database connection
 * Exported function for tests
 */
export async function testDatabaseConnection(db: Kysely<Database>): Promise<boolean> {
  const { sql } = await import('kysely')
  const destroy = async (): Promise<void> => {
    if (typeof (db as { destroy?: unknown }).destroy === 'function') {
      try {
        await db.destroy()
      } catch {
        // Connection already closed
      }
    }
  }
  try {
    // Simple SELECT 1 query that works across all databases
    await sql`SELECT 1 as test`.execute(db)
    await destroy()
    return true
  } catch {
    await destroy()
    return false
  }
}

interface TableMetadata {
  name: string
  schema?: string
}

/**
 * Introspect database
 * Exported function for tests
 */
export async function introspectDatabase(
  db: Kysely<Database>,
  options?: { schema?: string; excludePattern?: string }
): Promise<{ tables: TableMetadata[] }> {
  const tables = await db.introspection.getTables()

  let filteredTables = tables

  if (options?.schema) {
    filteredTables = filteredTables.filter(t => t.schema === options.schema)
  }

  if (options?.excludePattern) {
    const pattern = new RegExp(options.excludePattern)
    filteredTables = filteredTables.filter(t => !pattern.test(t.name))
  }

  return { tables: filteredTables }
}

/**
 * Run a raw SQL query, binding parameters when provided.
 */
export async function runQuery(
  db: Kysely<Database>,
  query: string,
  params?: unknown[]
): Promise<unknown> {
  const { CompiledQuery } = await import('kysely')
  const result = await db.executeQuery(CompiledQuery.raw(query, params ?? []))
  return result.rows
}
