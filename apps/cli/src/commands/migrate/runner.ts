import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import {
  MigrationRunner as LibraryMigrationRunner,
  MigrationError,
  MigrationLockError,
  type Migration,
  type MigrationResult
} from '@kysera/migrations'
import type { KyseraLogger } from '@kysera/core'
import { prism } from '@xec-sh/kit'
import type { Database } from '../../utils/database.js'
import { CLIError, ValidationError, isExpectedError } from '../../utils/errors.js'
import { diag, diagVerbose, toDate } from '../../utils/output.js'

/**
 * CLI adapter over @kysera/migrations.
 *
 * The heavy lifting (run ordering, per-migration transactions, advisory
 * locking on postgres/mysql, error surface) lives in the library. This file
 * only bridges CLI concerns:
 *
 * - file discovery (`YYYYMMDDHHMMSS_name.{ts,js,mjs}`, loose names allowed)
 *   into lazily-loaded library `Migration` objects
 * - a configurable bookkeeping table name and postgres schema (the library
 *   hardcodes `migrations`), including compatibility with tables created by
 *   older CLI versions (extra `timestamp`/`batch` columns) and by the
 *   library itself (`name`/`executed_at` only)
 * - content checksums stored in a sidecar `checksum` column for
 *   `kysera migrate verify`
 * - mapping library errors to CLIError with file path and applied/remaining
 *   context
 */

export interface MigrationFile {
  /** Migration name: file basename without extension */
  name: string
  /** Full path to the migration file */
  path: string
  /** Leading YYYYMMDDHHMMSS prefix, or '' when the name is not timestamped */
  timestamp: string
}

export interface MigrationStatusEntry {
  name: string
  timestamp: string
  status: 'pending' | 'executed'
  /** When the migration ran, null while pending */
  executedAt: Date | null
  /** Checksum recorded at execution time, null when unknown */
  checksum: string | null
  /** Checksum of the file as it exists now, null when the file is missing */
  currentChecksum: string | null
  /** File path, null for executed records whose file has disappeared */
  path: string | null
}

export interface UpOptions {
  to?: string | undefined
  steps?: number | undefined
  dryRun?: boolean | undefined
  /** Accepted for compatibility; verbosity is controlled by global output state */
  verbose?: boolean | undefined
}

export interface DownOptions {
  to?: string | undefined
  steps?: number | undefined
  all?: boolean | undefined
  dryRun?: boolean | undefined
  verbose?: boolean | undefined
}

export interface RollbackTarget {
  name: string
  /** Null when the executed record has no matching file on disk */
  path: string | null
}

export type VerifyIssueKind = 'modified' | 'missing_file' | 'unknown_checksum'

export interface VerifyIssue {
  name: string
  kind: VerifyIssueKind
  /** Checksum stored at execution time (modified only) */
  expected?: string
  /** Checksum of the file on disk right now (modified only) */
  actual?: string
  path?: string
}

export interface VerifyReport {
  /** False when a migration was modified after execution or its file is gone */
  ok: boolean
  /** Number of executed migrations that were checked */
  checked: number
  pending: number
  issues: VerifyIssue[]
}

export interface RunnerOptions {
  /** Serialize concurrent runs via a database advisory lock (default true) */
  lock?: boolean | undefined
  /** Max time to wait for the advisory lock (default 10s) */
  lockTimeoutMs?: number | undefined
}

const MIGRATION_EXTENSION = /\.(ts|js|mjs)$/
const TIMESTAMP_PREFIX = /^(\d{14})[_-]/

/** SHA-256 of the migration file content, hex-encoded (fits varchar(64)). */
export function checksumFile(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return null
  }
}

/**
 * Discover migration files in a directory, sorted by filename. Returns []
 * when the directory does not exist. Duplicate basenames (e.g. the same
 * migration as both .ts and .js) are an error: they would collide in the
 * bookkeeping table.
 */
export function discoverMigrationFiles(migrationsDir: string): MigrationFile[] {
  if (!existsSync(migrationsDir)) return []

  const entries = readdirSync(migrationsDir)
    .filter(
      file => MIGRATION_EXTENSION.test(file) && !file.endsWith('.d.ts') && !file.startsWith('.')
    )
    .sort()

  const seen = new Set<string>()
  return entries.map(file => {
    const name = file.replace(MIGRATION_EXTENSION, '')
    if (seen.has(name)) {
      throw new CLIError(
        `Duplicate migration name '${name}': multiple files in ${migrationsDir} share this basename`,
        'MIGRATION_DUPLICATE',
        undefined,
        ['Remove or rename one of the duplicate files']
      )
    }
    seen.add(name)
    return {
      name,
      path: join(migrationsDir, file),
      timestamp: TIMESTAMP_PREFIX.exec(file)?.[1] ?? ''
    }
  })
}

type MigrationFn = (db: Kysely<Database>) => Promise<void>

/**
 * Import a migration module and validate its exports. CLI migrations must
 * export both `up` and `down` functions.
 */
async function loadMigrationModule(file: MigrationFile): Promise<{
  up: MigrationFn
  down: MigrationFn
}> {
  let mod: Record<string, unknown>
  try {
    mod = (await import(pathToFileURL(file.path).href)) as Record<string, unknown>
  } catch (error) {
    throw new CLIError(
      `Failed to load migration ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      'MIGRATION_LOAD_ERROR',
      { file: file.path },
      [`Check the migration file for syntax errors: ${file.path}`]
    )
  }

  const { up, down } = mod
  if (typeof up !== 'function') {
    throw new ValidationError(`Invalid migration ${file.name}: must export an 'up' function`)
  }
  if (typeof down !== 'function') {
    throw new ValidationError(`Invalid migration ${file.name}: must export a 'down' function`)
  }
  return { up: up as MigrationFn, down: down as MigrationFn }
}

/**
 * Bridge discovered files to library Migration objects. Modules are loaded
 * lazily, inside the migration transaction, so a broken file only fails the
 * run that actually needs it — already-executed migrations are never
 * re-imported.
 */
function toLibraryMigrations(files: MigrationFile[]): Migration<Database>[] {
  return files.map(file => ({
    name: file.name,
    up: async (db: Kysely<Database>) => {
      const mod = await loadMigrationModule(file)
      await mod.up(db)
    },
    down: async (db: Kysely<Database>) => {
      const mod = await loadMigrationModule(file)
      await mod.down(db)
    }
  }))
}

/** Library progress lines are diagnostics: verbose-only, never on stdout. */
const libraryLogger: KyseraLogger = {
  trace: message => {
    diagVerbose(message)
  },
  debug: message => {
    diagVerbose(message)
  },
  info: message => {
    diagVerbose(message)
  },
  warn: message => {
    diagVerbose(prism.yellow(message))
  },
  error: message => {
    diagVerbose(prism.red(message))
  },
  fatal: message => {
    diagVerbose(prism.red(message))
  }
}

const MISSING_TABLE_PATTERNS = ['does not exist', 'no such table', "doesn't exist"]

export class MigrationRunner extends LibraryMigrationRunner<Database> {
  private readonly files: MigrationFile[]
  private readonly byName: Map<string, MigrationFile>
  private readonly libraryByName: Map<string, Migration<Database>>
  private readonly tableName: string
  private readonly schemaName: string
  /** Bookkeeping table columns; null = table absent; undefined = not yet introspected */
  private tableColumns: Set<string> | null | undefined
  private setupComplete = false
  /**
   * Migration just recorded inside its own transaction by executeMigration.
   * The base class calls markAsExecuted/markAsRolledBack right after — that
   * call must become a no-op or the record would be written twice.
   */
  private recordedInTransaction: string | null = null
  /** Batch number for the current run (legacy tables with a batch column only) */
  private runBatch: number | null = null

  constructor(
    db: Kysely<Database>,
    migrationsDir: string,
    tableName = 'migrations',
    schema = 'public',
    options: RunnerOptions = {}
  ) {
    const files = discoverMigrationFiles(migrationsDir)
    const migrations = toLibraryMigrations(files)
    super(schema !== 'public' ? db.withSchema(schema) : db, migrations, {
      useTransactions: true,
      stopOnError: true,
      verbose: false,
      logger: libraryLogger,
      advisoryLock: options.lock !== false,
      lockTimeoutMs: Math.max(1, Math.trunc(options.lockTimeoutMs ?? 10_000))
    })
    this.files = files
    this.byName = new Map(files.map(f => [f.name, f]))
    this.libraryByName = new Map(migrations.map(m => [m.name, m]))
    this.tableName = tableName
    this.schemaName = schema
  }

  get migrationFiles(): readonly MigrationFile[] {
    return this.files
  }

  // --------------------------------------------------------------------
  // Bookkeeping table (overrides the library's hardcoded 'migrations')
  // --------------------------------------------------------------------

  /**
   * Introspect the bookkeeping table once. Returns its column names, or
   * null when the table does not exist yet.
   */
  private async tableInfo(): Promise<Set<string> | null> {
    if (this.tableColumns !== undefined) return this.tableColumns
    const tables = await this.db.introspection.getTables({ withInternalKyselyTables: true })
    const candidates = tables.filter(t => t.name === this.tableName)
    const match =
      this.schemaName !== 'public'
        ? candidates.find(t => t.schema === this.schemaName)
        : (candidates.find(
            t => t.schema === undefined || t.schema === 'public' || t.schema === 'main'
          ) ?? candidates[0])
    this.tableColumns = match ? new Set(match.columns.map(c => c.name)) : null
    return this.tableColumns
  }

  private async requireColumns(): Promise<Set<string>> {
    const columns = await this.tableInfo()
    if (!columns) {
      throw new CLIError(
        `Migrations table '${this.tableName}' does not exist`,
        'DATABASE_ERROR',
        undefined,
        ["Run 'kysera migrate up' to create it"]
      )
    }
    return columns
  }

  /**
   * Create the bookkeeping table when missing. New tables use the library's
   * shape (name primary key, executed_at default CURRENT_TIMESTAMP) plus a
   * nullable checksum column, so applications running @kysera/migrations
   * directly can share the table with the CLI. Pre-existing tables (older
   * CLI versions, or created by the library) get the checksum column added
   * in place when possible.
   */
  protected override async ensureSetup(): Promise<void> {
    if (this.setupComplete) return

    if (this.schemaName !== 'public') {
      try {
        await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(this.schemaName)}`.execute(this.db)
      } catch (error) {
        // Non-postgres dialects have no schemas; the withSchema scope is a no-op there
        diagVerbose(
          `Could not ensure schema '${this.schemaName}': ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    const existing = await this.tableInfo()
    if (existing === null) {
      await this.db.schema
        .createTable(this.tableName)
        .ifNotExists()
        .addColumn('name', 'varchar(255)', col => col.primaryKey())
        .addColumn('executed_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .addColumn('checksum', 'varchar(64)')
        .execute()
      this.tableColumns = new Set(['name', 'executed_at', 'checksum'])
    } else if (!existing.has('checksum')) {
      try {
        await this.db.schema
          .alterTable(this.tableName)
          .addColumn('checksum', 'varchar(64)')
          .execute()
        existing.add('checksum')
      } catch (error) {
        diagVerbose(
          `Could not add checksum column to '${this.tableName}': ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    this.setupComplete = true
  }

  /**
   * Executed migration records, oldest first. Read-only: unlike the library
   * default this never creates the bookkeeping table, so status/list/verify
   * and dry runs perform zero writes.
   */
  async getExecutedRecords(): Promise<
    { name: string; executedAt: Date | null; checksum: string | null }[]
  > {
    const columns = await this.tableInfo()
    if (columns === null) return []

    const selected = columns.has('checksum')
      ? ['name', 'executed_at', 'checksum']
      : ['name', 'executed_at']

    try {
      const rows = await this.db
        .selectFrom(this.tableName)
        .select(selected)
        .orderBy('executed_at', 'asc')
        .orderBy('name', 'asc')
        .execute()

      return rows.map(row => ({
        name: String(row.name),
        executedAt: toDate(row.executed_at),
        checksum: typeof row.checksum === 'string' ? row.checksum : null
      }))
    } catch (error) {
      if (isExpectedError(error, MISSING_TABLE_PATTERNS)) return []
      throw new CLIError(
        `Failed to query migrations table '${this.tableName}': ${error instanceof Error ? error.message : String(error)}`,
        'DATABASE_ERROR',
        { tableName: this.tableName },
        ['Ensure the database is accessible', 'Check database permissions']
      )
    }
  }

  override async getExecutedMigrations(): Promise<string[]> {
    return (await this.getExecutedRecords()).map(r => r.name)
  }

  /** Write one executed record, matching whatever columns the table has. */
  private async insertRecord(db: Kysely<Database>, name: string): Promise<void> {
    const columns = await this.requireColumns()
    const file = this.byName.get(name)
    const record: Record<string, unknown> = { name }

    if (columns.has('checksum')) {
      record.checksum = file ? checksumFile(file.path) : null
    }
    // Legacy columns from CLI <= 0.8 are NOT NULL: keep populating them
    if (columns.has('timestamp')) {
      record.timestamp = file && file.timestamp !== '' ? file.timestamp : name.slice(0, 14)
    }
    if (columns.has('batch')) {
      record.batch = await this.nextBatch(db)
    }

    await db.insertInto(this.tableName).values(record).execute()
  }

  private async nextBatch(db: Kysely<Database>): Promise<number> {
    if (this.runBatch !== null) return this.runBatch
    const row = await db
      .selectFrom(this.tableName)
      .select(db.fn.max('batch').as('max_batch'))
      .executeTakeFirst()
    const max = Number(row?.max_batch ?? 0)
    this.runBatch = (Number.isFinite(max) ? max : 0) + 1
    return this.runBatch
  }

  override async markAsExecuted(name: string): Promise<void> {
    if (this.recordedInTransaction === name) {
      this.recordedInTransaction = null
      return
    }
    await this.ensureSetup()
    await this.insertRecord(this.db, name)
  }

  override async markAsRolledBack(name: string): Promise<void> {
    if (this.recordedInTransaction === name) {
      this.recordedInTransaction = null
      return
    }
    await this.db.deleteFrom(this.tableName).where('name', '=', name).execute()
  }

  /**
   * Run the migration function and its bookkeeping write in ONE transaction,
   * so a crash mid-run never leaves an applied-but-unrecorded migration
   * (the library alone records only after the transaction commits).
   */
  protected override async executeMigration(
    migration: Migration<Database>,
    operation: 'up' | 'down'
  ): Promise<void> {
    const fn = operation === 'up' ? migration.up : migration.down
    if (!fn) return

    await this.db.transaction().execute(async trx => {
      await fn(trx)
      if (operation === 'up') {
        await this.insertRecord(trx, migration.name)
      } else {
        await trx.deleteFrom(this.tableName).where('name', '=', migration.name).execute()
      }
    })
    this.recordedInTransaction = migration.name
  }

  // --------------------------------------------------------------------
  // Plans and runs
  // --------------------------------------------------------------------

  /**
   * Pending migrations in run order, optionally limited to a target
   * migration (inclusive) or a step count. Read-only.
   */
  async planUp(options: Pick<UpOptions, 'to' | 'steps'> = {}): Promise<MigrationFile[]> {
    const executed = new Set(await this.getExecutedMigrations())
    let pending = this.files.filter(f => !executed.has(f.name))

    if (options.to !== undefined) {
      const index = pending.findIndex(f => f.name === options.to)
      if (index === -1) {
        throw new CLIError(`Migration ${options.to} not found`, 'MIGRATION_NOT_FOUND', undefined, [
          'Check pending migration names with: kysera migrate status'
        ])
      }
      pending = pending.slice(0, index + 1)
    }

    if (options.steps !== undefined && options.steps > 0) {
      pending = pending.slice(0, options.steps)
    }

    return pending
  }

  /**
   * Rollback targets, newest first. Read-only. Default is the most recent
   * migration; --to rolls back everything after (not including) the target.
   */
  async planDown(
    options: Pick<DownOptions, 'to' | 'steps' | 'all'> = {}
  ): Promise<RollbackTarget[]> {
    const executed = await this.getExecutedMigrations()
    let names: string[]

    if (options.all) {
      names = [...executed].reverse()
    } else if (options.to !== undefined) {
      const index = executed.indexOf(options.to)
      if (index === -1) {
        throw new CLIError(`Migration ${options.to} not found`, 'MIGRATION_NOT_FOUND', undefined, [
          'Check executed migration names with: kysera migrate status'
        ])
      }
      names = executed.slice(index + 1).reverse()
    } else {
      const steps = options.steps !== undefined && options.steps > 0 ? options.steps : 1
      names = executed.slice(-steps).reverse()
    }

    return names.map(name => ({ name, path: this.byName.get(name)?.path ?? null }))
  }

  override async up(options: UpOptions = {}): Promise<MigrationResult> {
    const plan = await this.planUp(options)

    if (options.dryRun) {
      return { executed: plan.map(f => f.name), skipped: [], failed: [], duration: 0, dryRun: true }
    }
    if (plan.length === 0) {
      return { executed: [], skipped: [], failed: [], duration: 0, dryRun: false }
    }

    await this.ensureSetup()
    this.runBatch = null

    const selection = plan
      .map(f => this.libraryByName.get(f.name))
      .filter((m): m is Migration<Database> => m !== undefined)
    const planned = plan.map(f => f.name)
    const applied: string[] = []

    try {
      return await this.withAdvisoryLock(() =>
        this.runUp(selection, this.progressHooks('up', applied))
      )
    } catch (error) {
      this.rethrowRunError(error, 'up', planned, applied)
    }
  }

  override async down(optionsOrSteps: DownOptions | number = {}): Promise<MigrationResult> {
    const options: DownOptions =
      typeof optionsOrSteps === 'number' ? { steps: optionsOrSteps } : optionsOrSteps

    const targets = await this.planDown(options)

    if (options.dryRun) {
      return {
        executed: targets.map(t => t.name),
        skipped: [],
        failed: [],
        duration: 0,
        dryRun: true
      }
    }
    if (targets.length === 0) {
      return { executed: [], skipped: [], failed: [], duration: 0, dryRun: false }
    }

    // Refuse to roll back when a file is gone: silently skipping would leave
    // the schema and the bookkeeping table out of sync.
    const missing = targets.filter(t => t.path === null)
    if (missing.length > 0) {
      throw new CLIError(
        `Migration file not found: ${missing.map(t => t.name).join(', ')}`,
        'FILE_NOT_FOUND',
        { missing: missing.map(t => t.name) },
        [
          'Restore the migration file(s) before rolling back',
          "Or adopt the current state with 'kysera migrate baseline'"
        ]
      )
    }

    await this.ensureSetup()
    const planned = targets.map(t => t.name)
    const applied: string[] = []

    try {
      return await this.withAdvisoryLock(() =>
        this.runDown(targets.length, this.progressHooks('down', applied))
      )
    } catch (error) {
      this.rethrowRunError(error, 'down', planned, applied)
    }
  }

  /** Per-migration progress lines on stderr; collects completed names. */
  private progressHooks(
    operation: 'up' | 'down',
    applied: string[]
  ): {
    after: (migration: Migration<Database>, duration: number) => Promise<void>
    onError: (migration: Migration<Database>, error: unknown) => Promise<void>
  } {
    const arrow = operation === 'up' ? '↑' : '↓'
    return {
      after: (migration, duration) => {
        applied.push(migration.name)
        diag(`${prism.green(arrow)} ${migration.name} ${prism.green('✓')} (${duration}ms)`)
        return Promise.resolve()
      },
      onError: migration => {
        diag(`${prism.red(arrow)} ${migration.name} ${prism.red('✗')}`)
        return Promise.resolve()
      }
    }
  }

  /** Map library errors to the CLI error surface with full run context. */
  private rethrowRunError(
    error: unknown,
    operation: 'up' | 'down',
    planned: string[],
    applied: string[]
  ): never {
    // Structural fallback alongside instanceof: survives duplicated
    // @kysera/migrations instances in the module graph. Consumers keep
    // detecting contention via CLIError.code === 'MIGRATION_LOCKED'.
    const isLockError =
      error instanceof MigrationLockError ||
      (error instanceof Error && error.name === 'MigrationLockError')

    if (isLockError) {
      throw new CLIError(
        'Migrations are already running in another process',
        'MIGRATION_LOCKED',
        undefined,
        [
          'Wait for the other migration runner to finish',
          'Increase migrations.lockTimeout in your config if runs legitimately overlap',
          'Set migrations.lockTable: false to disable locking (unsafe)'
        ]
      )
    }

    if (error instanceof MigrationError) {
      const file = this.byName.get(error.migrationName)
      const index = planned.indexOf(error.migrationName)
      const remaining = index === -1 ? [] : planned.slice(index + 1)
      const doneVerb = operation === 'up' ? 'applied' : 'rolled back'

      const suggestions = [
        `Failed migration file: ${file?.path ?? 'unknown'}`,
        applied.length > 0
          ? `${applied.length} migration(s) were ${doneVerb} before the failure: ${applied.join(', ')}`
          : `No migrations were ${doneVerb} before the failure`,
        remaining.length > 0
          ? `${remaining.length} migration(s) were not ${operation === 'up' ? 'run' : 'rolled back'}: ${remaining.join(', ')}`
          : operation === 'up'
            ? 'No further migrations were pending'
            : 'No further migrations were selected for rollback'
      ]
      if (operation === 'up') {
        suggestions.push("Fix the migration and re-run 'kysera migrate up'")
      }

      throw new CLIError(
        error.message,
        operation === 'up' ? 'MIGRATION_FAILED' : 'ROLLBACK_FAILED',
        { migration: error.migrationName, file: file?.path, applied, remaining },
        suggestions
      )
    }

    if (error instanceof Error) throw error
    throw new CLIError(String(error), 'MIGRATION_FAILED')
  }

  // --------------------------------------------------------------------
  // Status, baseline, verify
  // --------------------------------------------------------------------

  /**
   * Merged view of files on disk and executed records, in file order.
   * Executed records without a matching file are appended last. Read-only.
   */
  async getStatusEntries(): Promise<MigrationStatusEntry[]> {
    const records = await this.getExecutedRecords()
    const recordByName = new Map(records.map(r => [r.name, r]))

    const entries: MigrationStatusEntry[] = this.files.map(file => {
      const record = recordByName.get(file.name)
      return {
        name: file.name,
        timestamp: file.timestamp,
        status: record ? 'executed' : 'pending',
        executedAt: record?.executedAt ?? null,
        checksum: record?.checksum ?? null,
        currentChecksum: checksumFile(file.path),
        path: file.path
      }
    })

    for (const record of records) {
      if (this.byName.has(record.name)) continue
      entries.push({
        name: record.name,
        timestamp: '',
        status: 'executed',
        executedAt: record.executedAt,
        checksum: record.checksum,
        currentChecksum: null,
        path: null
      })
    }

    return entries
  }

  /**
   * Record migrations as executed without running them — adopting the
   * current database state (e.g. a schema created before this tool).
   */
  async baseline(names: string[]): Promise<{ marked: string[]; skipped: string[] }> {
    const unknown = names.filter(name => !this.byName.has(name))
    if (unknown.length > 0) {
      throw new CLIError(
        `Migration ${unknown.join(', ')} not found`,
        'MIGRATION_NOT_FOUND',
        { unknown },
        [
          this.files.length > 0
            ? `Available migrations: ${this.files.map(f => f.name).join(', ')}`
            : 'No migration files found in the migrations directory'
        ]
      )
    }

    await this.ensureSetup()
    const executed = new Set(await this.getExecutedMigrations())
    const marked: string[] = []
    const skipped: string[] = []

    for (const name of names) {
      if (executed.has(name)) {
        skipped.push(name)
        continue
      }
      await this.markAsExecuted(name)
      marked.push(name)
    }

    return { marked, skipped }
  }

  /**
   * Compare executed records against the files on disk. `modified` and
   * `missing_file` fail the check; `unknown_checksum` (records written
   * before checksums existed, or by the library directly) is reported but
   * does not fail — run `verify --update` to adopt current file hashes.
   */
  async verify(): Promise<VerifyReport> {
    const entries = await this.getStatusEntries()
    const executed = entries.filter(e => e.status === 'executed')
    const issues: VerifyIssue[] = []

    for (const entry of executed) {
      if (entry.path === null) {
        issues.push({ name: entry.name, kind: 'missing_file' })
      } else if (entry.checksum === null) {
        issues.push({ name: entry.name, kind: 'unknown_checksum', path: entry.path })
      } else if (entry.currentChecksum !== null && entry.checksum !== entry.currentChecksum) {
        issues.push({
          name: entry.name,
          kind: 'modified',
          expected: entry.checksum,
          actual: entry.currentChecksum,
          path: entry.path
        })
      }
    }

    return {
      ok: issues.every(issue => issue.kind === 'unknown_checksum'),
      checked: executed.length,
      pending: entries.filter(e => e.status === 'pending').length,
      issues
    }
  }

  /**
   * Store current file checksums for executed records that have none.
   * Never overwrites an existing (mismatching) checksum.
   */
  async adoptChecksums(): Promise<string[]> {
    await this.ensureSetup()
    const columns = await this.requireColumns()
    if (!columns.has('checksum')) {
      throw new CLIError(
        `Migrations table '${this.tableName}' has no checksum column and it could not be added`,
        'DATABASE_ERROR'
      )
    }

    const entries = await this.getStatusEntries()
    const updated: string[] = []
    for (const entry of entries) {
      if (entry.status !== 'executed' || entry.checksum !== null) continue
      if (entry.currentChecksum === null) continue
      await this.db
        .updateTable(this.tableName)
        .set({ checksum: entry.currentChecksum })
        .where('name', '=', entry.name)
        .execute()
      updated.push(entry.name)
    }
    return updated
  }
}
