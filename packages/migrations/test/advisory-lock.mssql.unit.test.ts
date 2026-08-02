/**
 * MSSQL advisory lock (sp_getapplock) — unit tests over compiled SQL.
 *
 * A stub dialect compiles with kysely's real MssqlQueryCompiler (so
 * detectDialect() sees `@n` placeholders → 'mssql') while a recording driver
 * captures every executed statement. This pins the lock protocol without a
 * live SQL Server:
 *   - session-owned sp_getapplock on the shared resource name
 *   - @LockTimeout wired from lockTimeoutMs
 *   - acquire and release happen on the SAME pinned connection,
 *     bookkeeping queries on other pooled connections
 *   - result codes: >= 0 success, -1 timeout, -2/-3/-999 hard failure
 */
import { describe, it, expect } from 'vitest'
import {
  Kysely,
  MssqlAdapter,
  MssqlIntrospector,
  MssqlQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult
} from 'kysely'
import {
  createMigrationRunner,
  DatabaseError,
  MigrationLockError,
  type Migration
} from '../src/index.js'

type DB = Record<string, Record<string, unknown>>

interface RecordedQuery {
  sql: string
  parameters: readonly unknown[]
  connectionId: number
}

class RecordingConnection implements DatabaseConnection {
  constructor(
    private readonly id: number,
    private readonly log: RecordedQuery[],
    private readonly lockResults: number[]
  ) {}

  executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.log.push({
      sql: compiledQuery.sql,
      parameters: compiledQuery.parameters,
      connectionId: this.id
    })
    const text = compiledQuery.sql.toLowerCase()
    if (text.includes('sp_getapplock')) {
      const result = this.lockResults.length > 0 ? (this.lockResults.shift() ?? 0) : 0
      return Promise.resolve({ rows: [{ result } as unknown as R] })
    }
    if (text.includes('sp_releaseapplock')) {
      return Promise.resolve({ rows: [{ result: 0 } as unknown as R] })
    }
    // migrations bookkeeping: empty executed list, writes acknowledged
    return Promise.resolve({ rows: [] })
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming not supported by the recording stub')
  }
}

class RecordingDriver implements Driver {
  private nextConnectionId = 1

  constructor(
    private readonly log: RecordedQuery[],
    private readonly lockResults: number[]
  ) {}

  init(): Promise<void> {
    return Promise.resolve()
  }

  acquireConnection(): Promise<DatabaseConnection> {
    return Promise.resolve(
      new RecordingConnection(this.nextConnectionId++, this.log, this.lockResults)
    )
  }

  beginTransaction(): Promise<void> {
    return Promise.resolve()
  }

  commitTransaction(): Promise<void> {
    return Promise.resolve()
  }

  rollbackTransaction(): Promise<void> {
    return Promise.resolve()
  }

  releaseConnection(): Promise<void> {
    return Promise.resolve()
  }

  destroy(): Promise<void> {
    return Promise.resolve()
  }
}

/**
 * Kysely instance that compiles like MSSQL but executes against the
 * recording stub. `lockResults` scripts successive sp_getapplock outcomes.
 */
function createStubMssqlDb(
  log: RecordedQuery[],
  lockResults: number[] = []
): Kysely<DB> {
  const dialect: Dialect = {
    createAdapter: () => new MssqlAdapter(),
    createDriver: () => new RecordingDriver(log, lockResults),
    createIntrospector: db => new MssqlIntrospector(db),
    createQueryCompiler: () => new MssqlQueryCompiler()
  }
  return new Kysely<DB>({ dialect })
}

const noopMigrations = (): Migration<DB>[] => [
  {
    name: '001_noop',
    up: async () => {
      // no schema work — the lock protocol around it is what's under test
    }
  }
]

describe('MSSQL advisory lock protocol (compiled SQL)', () => {
  it('acquires a session-owned exclusive applock and releases it on the same connection', async () => {
    const log: RecordedQuery[] = []
    const db = createStubMssqlDb(log, [0])

    const result = await createMigrationRunner(db, noopMigrations()).up()
    expect(result.executed).toEqual(['001_noop'])

    const acquire = log.find(q => q.sql.includes('sp_getapplock'))
    expect(acquire).toBeDefined()
    expect(acquire?.sql).toContain("@LockMode = 'Exclusive'")
    expect(acquire?.sql).toContain("@LockOwner = 'Session'")
    // default lockTimeoutMs = 60000, inlined as a literal
    expect(acquire?.sql).toContain('@LockTimeout = 60000')
    // resource name travels as the only bound parameter
    expect(acquire?.parameters).toEqual(['kysera_migrations'])

    const release = log.find(q => q.sql.includes('sp_releaseapplock'))
    expect(release).toBeDefined()
    expect(release?.sql).toContain("@LockOwner = 'Session'")
    expect(release?.parameters).toEqual(['kysera_migrations'])

    // protocol order: lock first, unlock last
    expect(log[0]?.sql).toContain('sp_getapplock')
    expect(log[log.length - 1]?.sql).toContain('sp_releaseapplock')

    // session locks live on ONE pinned connection; bookkeeping runs elsewhere
    expect(release?.connectionId).toBe(acquire?.connectionId)
    const others = log.filter(
      q => !q.sql.includes('sp_getapplock') && !q.sql.includes('sp_releaseapplock')
    )
    expect(others.length).toBeGreaterThan(0)
    for (const query of others) {
      expect(query.connectionId).not.toBe(acquire?.connectionId)
    }
  })

  it('treats result code 1 (granted after waiting) as success', async () => {
    const log: RecordedQuery[] = []
    const db = createStubMssqlDb(log, [1])

    const result = await createMigrationRunner(db, noopMigrations()).up()
    expect(result.executed).toEqual(['001_noop'])
    expect(log.some(q => q.sql.includes('sp_releaseapplock'))).toBe(true)
  })

  it('wires a custom lockTimeoutMs into @LockTimeout', async () => {
    const log: RecordedQuery[] = []
    const db = createStubMssqlDb(log, [0])

    await createMigrationRunner(db, noopMigrations(), { lockTimeoutMs: 1234 }).up()

    const acquire = log.find(q => q.sql.includes('sp_getapplock'))
    expect(acquire?.sql).toContain('@LockTimeout = 1234')
  })

  it('maps result code -1 (timeout) to MigrationLockError and runs nothing', async () => {
    const log: RecordedQuery[] = []
    const db = createStubMssqlDb(log, [-1])
    let migrationRan = false
    const migrations: Migration<DB>[] = [
      {
        name: '001_should_not_run',
        up: async () => {
          migrationRan = true
        }
      }
    ]

    const runner = createMigrationRunner(db, migrations, { lockTimeoutMs: 500 })
    const failure = await runner.up().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(MigrationLockError)
    expect(String((failure as Error).message)).toContain('500ms')

    expect(migrationRan).toBe(false)
    // nothing but lock acquisition attempts hit the database
    expect(log.every(q => q.sql.includes('sp_getapplock'))).toBe(true)
  })

  it.each([
    [-2, 'canceled'],
    [-3, 'deadlock victim'],
    [-999, 'invalid call']
  ])('maps result code %i to a DatabaseError naming the cause', async (code, phrase) => {
    const log: RecordedQuery[] = []
    const db = createStubMssqlDb(log, [code])

    const runner = createMigrationRunner(db, noopMigrations())
    const failure = await runner.up().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(DatabaseError)
    expect(failure).not.toBeInstanceOf(MigrationLockError)
    expect(String((failure as Error).message)).toContain(`result code ${String(code)}`)
    expect(String((failure as Error).message)).toContain(phrase)
  })

  it('skips the applock entirely when advisoryLock is false', async () => {
    const log: RecordedQuery[] = []
    const db = createStubMssqlDb(log)

    const result = await createMigrationRunner(db, noopMigrations(), {
      advisoryLock: false
    }).up()

    expect(result.executed).toEqual(['001_noop'])
    expect(log.some(q => q.sql.includes('sp_getapplock'))).toBe(false)
  })

  it('skips the applock in dry-run mode (no writes to guard)', async () => {
    const log: RecordedQuery[] = []
    const db = createStubMssqlDb(log)

    const result = await createMigrationRunner(db, noopMigrations(), { dryRun: true }).up()

    expect(result.dryRun).toBe(true)
    expect(log.some(q => q.sql.includes('sp_getapplock'))).toBe(false)
  })

  it('wraps down() in the same applock protocol', async () => {
    const log: RecordedQuery[] = []
    const db = createStubMssqlDb(log, [0, 0])

    const runner = createMigrationRunner(db, noopMigrations())
    await runner.down()

    // down() on an empty history still serializes via the lock
    const locks = log.filter(q => q.sql.includes('sp_getapplock'))
    const releases = log.filter(q => q.sql.includes('sp_releaseapplock'))
    expect(locks.length).toBe(1)
    expect(releases.length).toBe(1)
  })
})
