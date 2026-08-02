/**
 * Minimal in-memory Kysely dialect for unit-testing dialect-specific runner
 * behavior (advisory locks) without a live database. Queries compile through
 * kysely's real PostgresQueryCompiler / MysqlQueryCompiler — so detectDialect
 * sees genuine placeholder styles — and execution is answered by a
 * test-provided handler returning canned rows (throw to simulate an error).
 */

import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler
} from 'kysely'
import type {
  CompiledQuery,
  DatabaseConnection,
  Dialect as KyselyDialect,
  Driver,
  QueryResult
} from 'kysely'

export interface ExecutedQuery {
  sql: string
  parameters: readonly unknown[]
}

/** Returns the rows for a query; throw to simulate a database error. */
export type QueryHandler = (query: ExecutedQuery) => unknown[]

export interface FakeDb {
  db: Kysely<unknown>
  /** Every executed query, in order, with compiled SQL and parameters. */
  executed: ExecutedQuery[]
}

export function createFakeDb(
  flavor: 'postgres' | 'mysql',
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
          createAdapter: () => new PostgresAdapter(),
          createDriver: () => driver,
          createIntrospector: db => new PostgresIntrospector(db),
          createQueryCompiler: () => new PostgresQueryCompiler()
        }
      : {
          createAdapter: () => new MysqlAdapter(),
          createDriver: () => driver,
          createIntrospector: db => new MysqlIntrospector(db),
          createQueryCompiler: () => new MysqlQueryCompiler()
        }

  return { db: new Kysely<unknown>({ dialect }), executed }
}
