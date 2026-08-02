/**
 * Minimal in-memory Kysely dialect for unit-testing adapters without a live
 * database. Queries are compiled through kysely's real query compilers, so
 * the SQL asserted in tests is exactly what a live database would receive.
 * Execution is routed to a test-provided handler that returns canned rows
 * (or throws to simulate a database error).
 */

import {
  Kysely,
  PostgresAdapter as KyselyPostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  MysqlAdapter as KyselyMysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  SqliteAdapter as KyselySqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler
} from 'kysely'
import type {
  CompiledQuery,
  DatabaseConnection,
  Dialect as KyselyDialect,
  Driver,
  QueryResult
} from 'kysely'
import type { KyseraLogger } from '@kysera/core'

export interface ExecutedQuery {
  sql: string
  parameters: readonly unknown[]
}

/** Returns the rows for a query; throw to simulate a database error. */
export type QueryHandler = (query: ExecutedQuery) => unknown[]

export interface FakeDb {
  db: Kysely<any>
  /** Every executed query, in order, with compiled SQL and parameters. */
  executed: ExecutedQuery[]
}

/**
 * Create a Kysely instance whose driver executes nothing: every query is
 * recorded and answered by `handler` (default: no rows).
 */
export function createFakeDb(
  flavor: 'postgres' | 'mysql' | 'sqlite',
  handler: QueryHandler = () => []
): FakeDb {
  const executed: ExecutedQuery[] = []

  const connection: DatabaseConnection = {
    executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
      const query = { sql: compiledQuery.sql, parameters: compiledQuery.parameters }
      executed.push(query)
      return Promise.resolve({ rows: handler(query) as R[] })
    },
    streamQuery(): AsyncIterableIterator<QueryResult<never>> {
      throw new Error('streamQuery is not supported by the fake driver')
    }
  }

  const driver: Driver = {
    init: () => Promise.resolve(),
    acquireConnection: () => Promise.resolve(connection),
    beginTransaction: () => Promise.resolve(),
    commitTransaction: () => Promise.resolve(),
    rollbackTransaction: () => Promise.resolve(),
    releaseConnection: () => Promise.resolve(),
    destroy: () => Promise.resolve()
  }

  const dialect: KyselyDialect =
    flavor === 'postgres'
      ? {
          createAdapter: () => new KyselyPostgresAdapter(),
          createDriver: () => driver,
          createIntrospector: db => new PostgresIntrospector(db),
          createQueryCompiler: () => new PostgresQueryCompiler()
        }
      : flavor === 'mysql'
        ? {
            createAdapter: () => new KyselyMysqlAdapter(),
            createDriver: () => driver,
            createIntrospector: db => new MysqlIntrospector(db),
            createQueryCompiler: () => new MysqlQueryCompiler()
          }
        : {
            createAdapter: () => new KyselySqliteAdapter(),
            createDriver: () => driver,
            createIntrospector: db => new SqliteIntrospector(db),
            createQueryCompiler: () => new SqliteQueryCompiler()
          }

  return { db: new Kysely<any>({ dialect }), executed }
}

export interface LogEntry {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  message: string
  args: unknown[]
}

/** Logger that records every call so tests can assert on log output. */
export function createCapturingLogger(): { logger: KyseraLogger; entries: LogEntry[] } {
  const entries: LogEntry[] = []
  const record =
    (level: LogEntry['level']) =>
    (message: string, ...args: unknown[]): void => {
      entries.push({ level, message, args })
    }
  return {
    logger: {
      trace: record('trace'),
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      fatal: record('fatal')
    },
    entries
  }
}
