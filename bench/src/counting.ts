/**
 * Query-counting instrumentation.
 *
 * Wraps a Kysely {@link Dialect} so that every statement that reaches the
 * database — including BEGIN/COMMIT issued by the driver and any query made
 * through `__rawDb` escapes inside plugins — is recorded. This is the ground
 * truth for the mutation round-trip suite: it counts what actually hits
 * SQLite, not what the query builder was asked to do.
 */
import type {
  CompiledQuery,
  DatabaseConnection,
  Dialect,
  Driver,
  QueryResult,
  TransactionSettings
} from 'kysely'

export interface RecordedStatement {
  sql: string
  kind: string
}

export class QueryRecorder {
  #active = false
  statements: RecordedStatement[] = []

  start(): void {
    this.statements = []
    this.#active = true
  }

  stop(): void {
    this.#active = false
  }

  record(sql: string): void {
    if (!this.#active) return
    const kind = sql.trimStart().split(/[\s(]/, 1)[0]?.toLowerCase() ?? 'unknown'
    this.statements.push({ sql, kind })
  }

  byKind(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const statement of this.statements) {
      counts[statement.kind] = (counts[statement.kind] ?? 0) + 1
    }
    return counts
  }
}

class CountingConnection implements DatabaseConnection {
  readonly inner: DatabaseConnection
  readonly #recorder: QueryRecorder

  constructor(inner: DatabaseConnection, recorder: QueryRecorder) {
    this.inner = inner
    this.#recorder = recorder
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.#recorder.record(compiledQuery.sql)
    return await this.inner.executeQuery<R>(compiledQuery)
  }

  streamQuery<R>(
    compiledQuery: CompiledQuery,
    chunkSize: number
  ): AsyncIterableIterator<QueryResult<R>> {
    this.#recorder.record(compiledQuery.sql)
    return this.inner.streamQuery<R>(compiledQuery, chunkSize)
  }
}

function unwrapConnection(connection: DatabaseConnection): DatabaseConnection {
  return connection instanceof CountingConnection ? connection.inner : connection
}

/**
 * Delegating driver. Transaction control statements (BEGIN/COMMIT/ROLLBACK)
 * are executed by the inner driver *through the wrapped connection*, so they
 * are recorded like any other statement.
 */
class CountingDriver implements Driver {
  readonly #inner: Driver
  readonly #recorder: QueryRecorder

  constructor(inner: Driver, recorder: QueryRecorder) {
    this.#inner = inner
    this.#recorder = recorder
  }

  async init(): Promise<void> {
    await this.#inner.init()
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new CountingConnection(await this.#inner.acquireConnection(), this.#recorder)
  }

  async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings
  ): Promise<void> {
    await this.#inner.beginTransaction(connection, settings)
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await this.#inner.commitTransaction(connection)
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await this.#inner.rollbackTransaction(connection)
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    await this.#inner.releaseConnection(unwrapConnection(connection))
  }

  async destroy(): Promise<void> {
    await this.#inner.destroy()
  }
}

export function withQueryCounting(inner: Dialect, recorder: QueryRecorder): Dialect {
  return {
    createAdapter: () => inner.createAdapter(),
    createDriver: () => new CountingDriver(inner.createDriver(), recorder),
    createIntrospector: db => inner.createIntrospector(db),
    createQueryCompiler: () => inner.createQueryCompiler()
  }
}
