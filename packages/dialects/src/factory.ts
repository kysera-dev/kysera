/**
 * Dialect Adapter Factory
 */

import type { Dialect, DialectAdapter } from './types.js'
import { PostgresAdapter, postgresAdapter } from './adapters/postgres.js'
import { MySQLAdapter, mysqlAdapter } from './adapters/mysql.js'
import { SQLiteAdapter, sqliteAdapter } from './adapters/sqlite.js'
import { MSSQLAdapter, mssqlAdapter } from './adapters/mssql.js'

const adapters: Record<Dialect, DialectAdapter> = {
  postgres: postgresAdapter,
  mysql: mysqlAdapter,
  sqlite: sqliteAdapter,
  mssql: mssqlAdapter
}

/**
 * Get a dialect adapter for the specified dialect
 *
 * @example
 * const adapter = getAdapter('postgres');
 * console.log(adapter.getDefaultPort()); // 5432
 */
export function getAdapter(dialect: Dialect): DialectAdapter {
  const adapter = adapters[dialect]
  if (!adapter) {
    throw new Error(`Unknown dialect: ${dialect}. Supported: postgres, mysql, sqlite, mssql`)
  }
  return adapter
}

/**
 * Create a new dialect adapter instance
 *
 * @example
 * const adapter = createDialectAdapter('mysql');
 */
export function createDialectAdapter(dialect: Dialect): DialectAdapter {
  switch (dialect) {
    case 'postgres':
      return new PostgresAdapter()
    case 'mysql':
      return new MySQLAdapter()
    case 'sqlite':
      return new SQLiteAdapter()
    case 'mssql':
      return new MSSQLAdapter()
    default:
      throw new Error(`Unknown dialect: ${dialect}. Supported: postgres, mysql, sqlite, mssql`)
  }
}

/**
 * Register a custom dialect adapter
 *
 * @example
 * registerAdapter(customAdapter);
 */
export function registerAdapter(adapter: DialectAdapter): void {
  adapters[adapter.dialect] = adapter
}
