/**
 * Dialect Adapter Factory
 */

import type { Dialect, DialectAdapter, DialectAdapterOptions } from './types.js'
import { PostgresAdapter, postgresAdapter, type PostgresAdapterOptions } from './adapters/postgres.js'
import { MySQLAdapter, mysqlAdapter, type MySQLAdapterOptions } from './adapters/mysql.js'
import { SQLiteAdapter, sqliteAdapter, type SQLiteAdapterOptions } from './adapters/sqlite.js'
import { MSSQLAdapter, mssqlAdapter, type MSSQLAdapterOptions } from './adapters/mssql.js'

const adapters: Record<Dialect, DialectAdapter> = {
  postgres: postgresAdapter,
  mysql: mysqlAdapter,
  sqlite: sqliteAdapter,
  mssql: mssqlAdapter
}

/**
 * Get a dialect adapter for the specified dialect.
 * Returns a shared singleton instance with default configuration.
 *
 * @param dialect - Database dialect
 * @returns DialectAdapter instance
 *
 * @example
 * const adapter = getAdapter('postgres')
 * console.log(adapter.getDefaultPort()) // 5432
 * console.log(adapter.defaultSchema)    // 'public'
 */
export function getAdapter(dialect: Dialect): DialectAdapter {
  const adapter = adapters[dialect]
  if (!adapter) {
    throw new Error(`Unknown dialect: ${dialect}. Supported: postgres, mysql, sqlite, mssql`)
  }
  return adapter
}

/**
 * Adapter options by dialect type
 */
export type AdapterOptions =
  | { dialect: 'postgres'; options?: PostgresAdapterOptions }
  | { dialect: 'mysql'; options?: MySQLAdapterOptions }
  | { dialect: 'sqlite'; options?: SQLiteAdapterOptions }
  | { dialect: 'mssql'; options?: MSSQLAdapterOptions }

/**
 * Create a new dialect adapter instance with custom options.
 * Use this when you need a custom default schema or logger.
 *
 * @param dialect - Database dialect
 * @param options - Dialect-specific adapter options
 * @returns New DialectAdapter instance
 *
 * @example
 * // Create adapter with custom default schema
 * const adapter = createDialectAdapter('postgres', { defaultSchema: 'auth' })
 *
 * @example
 * // Create adapter with logger
 * const adapter = createDialectAdapter('postgres', {
 *   defaultSchema: 'app',
 *   logger: myLogger
 * })
 */
export function createDialectAdapter(
  dialect: 'postgres',
  options?: PostgresAdapterOptions
): PostgresAdapter
export function createDialectAdapter(
  dialect: 'mysql',
  options?: MySQLAdapterOptions
): MySQLAdapter
export function createDialectAdapter(
  dialect: 'sqlite',
  options?: SQLiteAdapterOptions
): SQLiteAdapter
export function createDialectAdapter(
  dialect: 'mssql',
  options?: MSSQLAdapterOptions
): MSSQLAdapter
export function createDialectAdapter(
  dialect: Dialect,
  options?: DialectAdapterOptions
): DialectAdapter
export function createDialectAdapter(
  dialect: Dialect,
  options?: DialectAdapterOptions
): DialectAdapter {
  switch (dialect) {
    case 'postgres':
      return new PostgresAdapter(options as PostgresAdapterOptions)
    case 'mysql':
      return new MySQLAdapter(options as MySQLAdapterOptions)
    case 'sqlite':
      return new SQLiteAdapter(options as SQLiteAdapterOptions)
    case 'mssql':
      return new MSSQLAdapter(options as MSSQLAdapterOptions)
    default:
      throw new Error(`Unknown dialect: ${dialect}. Supported: postgres, mysql, sqlite, mssql`)
  }
}

/**
 * Register a custom dialect adapter.
 * This replaces the default adapter for the given dialect.
 *
 * @param adapter - DialectAdapter instance to register
 *
 * @example
 * const customAdapter = new PostgresAdapter({ defaultSchema: 'custom' })
 * registerAdapter(customAdapter)
 */
export function registerAdapter(adapter: DialectAdapter): void {
  adapters[adapter.dialect] = adapter
}
