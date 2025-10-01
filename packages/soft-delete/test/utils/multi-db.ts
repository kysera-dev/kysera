import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect, type Generated } from 'kysely'
import { Pool } from 'pg'
import { createPool } from 'mysql2'
import betterSqlite3 from 'better-sqlite3'

export type DatabaseType = 'postgres' | 'mysql' | 'sqlite'

export interface MultiDbTestDatabase {
  users: {
    id: Generated<number>
    email: string
    name: string | null
    deleted_at: Date | string | null
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    content: string | null
    deleted_at: Date | string | null
  }
}

/**
 * Configuration for each database type
 */
export const DB_CONFIGS = {
  postgres: {
    host: 'localhost',
    port: 5432,
    database: 'kysera_test',
    user: 'test',
    password: 'test'
  },
  mysql: {
    host: 'localhost',
    port: 3306,
    database: 'kysera_test',
    user: 'test',
    password: 'test'
  },
  sqlite: {
    filename: ':memory:'
  }
}

/**
 * Create a test database connection
 */
export function createTestDb(type: DatabaseType): Kysely<MultiDbTestDatabase> {
  switch (type) {
    case 'postgres':
      return new Kysely<MultiDbTestDatabase>({
        dialect: new PostgresDialect({
          pool: new Pool(DB_CONFIGS.postgres)
        })
      })

    case 'mysql':
      return new Kysely<MultiDbTestDatabase>({
        dialect: new MysqlDialect({
          pool: createPool({
            ...DB_CONFIGS.mysql,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
          })
        })
      })

    case 'sqlite': {
      const sqlite = new betterSqlite3(DB_CONFIGS.sqlite.filename)
      // Enable foreign keys for SQLite
      sqlite.pragma('foreign_keys = ON')
      return new Kysely<MultiDbTestDatabase>({
        dialect: new SqliteDialect({ database: sqlite })
      })
    }

    default:
      throw new Error(`Unsupported database type: ${String(type)}`)
  }
}

/**
 * Initialize database schema
 */
export async function initializeSchema(db: Kysely<MultiDbTestDatabase>, type: DatabaseType): Promise<void> {
  // Drop existing tables
  await db.schema.dropTable('posts').ifExists().execute()
  await db.schema.dropTable('users').ifExists().execute()

  // Create users table
  let usersTable = db.schema
    .createTable('users')
    .addColumn('id', type === 'postgres' ? 'serial' : 'integer', col =>
      col.primaryKey().autoIncrement())
    .addColumn('email', 'varchar(255)', col => col.notNull().unique())
    .addColumn('name', 'varchar(255)')

  if (type === 'sqlite') {
    usersTable = usersTable.addColumn('deleted_at', 'text')
  } else {
    usersTable = usersTable.addColumn('deleted_at', 'timestamp')
  }

  await usersTable.execute()

  // Create posts table
  let postsTable = db.schema
    .createTable('posts')
    .addColumn('id', type === 'postgres' ? 'serial' : 'integer', col =>
      col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', col => col.notNull().references('users.id'))
    .addColumn('title', 'varchar(255)', col => col.notNull())
    .addColumn('content', 'text')

  if (type === 'sqlite') {
    postsTable = postsTable.addColumn('deleted_at', 'text')
  } else {
    postsTable = postsTable.addColumn('deleted_at', 'timestamp')
  }

  await postsTable.execute()
}

/**
 * Clear all data from database
 */
export async function clearDatabase(db: Kysely<MultiDbTestDatabase>): Promise<void> {
  await db.deleteFrom('posts').execute()
  await db.deleteFrom('users').execute()
}
