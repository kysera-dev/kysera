import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Kysely } from 'kysely'
import {
  MigrationRunner as LibraryMigrationRunner,
  createMigrationHistory,
  MigrationError,
  MigrationLockError,
  type Migration,
  type MigrationResult
} from '@kysera/migrations'
import type { KyseraLogger } from '@kysera/core'
import { prism } from '@xec-sh/kit'
import type { Database } from '../../utils/database.js'
import { CLIError, ValidationError } from '../../utils/errors.js'
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
 * - a configurable bookkeeping table name and postgres schema through the shared history adapter, including compatibility with tables created by
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
  return files.map(file => {
    const checksum = checksumFile(file.path)
    return {
      name: file.name,
      ...(checksum ? { checksum } : {}),
      up: async (db: Kysely<Database>) => {
        const mod = await loadMigrationModule(file)
        await mod.up(db)
      },
      down: async (db: Kysely<Database>) => {
        const mod = await loadMigrationModule(file)
        await mod.down(db)
      }
    }
  })
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

export class MigrationRunner extends LibraryMigrationRunner<Database> {
  private readonly files: MigrationFile[]
  private readonly byName: Map<string, MigrationFile>
  private readonly libraryByName: Map<string, Migration<Database>>
  private readonly batchState: { value: number | null }

  constructor(
    db: Kysely<Database>,
    migrationsDir: string,
    tableName = 'migrations',
    schema = 'public',
    options: RunnerOptions = {}
  ) {
    const files = discoverMigrationFiles(migrationsDir)
    const migrations = toLibraryMigrations(files)
    const batchState: { value: number | null } = { value: null }
    const history = createMigrationHistory({
      tableName,
      ...(schema !== 'public' ? { schema } : {}),
      checksumColumn: 'checksum',
      recordValues: async (connection, record, columns) => {
        const values: Record<string, unknown> = {}
        if (columns.has('timestamp'))
          values.timestamp =
            files.find(f => f.name === record.name)?.timestamp ?? record.name.slice(0, 14)
        if (columns.has('batch')) {
          const meta = connection as unknown as Kysely<Database>
          if (batchState.value === null) {
            const row = await meta
              .selectFrom(tableName)
              .select(meta.fn.max('batch').as('max_batch'))
              .executeTakeFirst()
            batchState.value = Number(row?.max_batch ?? 0) + 1
          }
          values.batch = batchState.value
        }
        return values
      }
    })
    super(schema !== 'public' ? db.withSchema(schema) : db, migrations, {
      history,
      strictRollback: true,
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
    this.batchState = batchState
  }

  get migrationFiles(): readonly MigrationFile[] {
    return this.files
  }

  /** Read-only; SQL history is shared with the library and framework adapters. */
  async getExecutedRecords(
    db: Kysely<Database> = this.db
  ): Promise<{ name: string; executedAt: Date | null; checksum: string | null }[]> {
    return (await this.history.read(db)).map(record => ({
      ...record,
      executedAt: toDate(record.executedAt)
    }))
  }

  // --------------------------------------------------------------------
  // Plans and runs
  // --------------------------------------------------------------------

  /**
   * Pending migrations in run order, optionally limited to a target
   * migration (inclusive) or a step count. Read-only.
   */
  async planUp(
    options: Pick<UpOptions, 'to' | 'steps'> = {},
    db: Kysely<Database> = this.db
  ): Promise<MigrationFile[]> {
    const executed = new Set(await this.getExecutedMigrations(db))
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
    options: Pick<DownOptions, 'to' | 'steps' | 'all'> = {},
    db: Kysely<Database> = this.db
  ): Promise<RollbackTarget[]> {
    const executed = await this.getExecutedMigrations(db)
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
      const steps = options.steps ?? 1
      names = steps === 0 ? [] : executed.slice(-steps).reverse()
    }

    return names.map(name => ({ name, path: this.byName.get(name)?.path ?? null }))
  }

  override async up(options: UpOptions = {}): Promise<MigrationResult> {
    if (options.dryRun) {
      const plan = await this.planUp(options)
      return { executed: plan.map(f => f.name), skipped: [], failed: [], duration: 0, dryRun: true }
    }
    return this.withAdvisoryLock(async db => {
      this.batchState.value = null
      const plan = await this.planUp(options, db)
      const selection = plan
        .map(f => this.libraryByName.get(f.name))
        .filter((m): m is Migration<Database> => m !== undefined)
      const applied: string[] = []
      try {
        return await this.runUp(selection, this.progressHooks('up', applied), db)
      } catch (error) {
        this.rethrowRunError(
          error,
          'up',
          plan.map(f => f.name),
          applied
        )
      }
    }).catch((error: unknown) => this.rethrowRunError(error, 'up', [], []))
  }

  override async down(optionsOrSteps: DownOptions | number = {}): Promise<MigrationResult> {
    const options: DownOptions =
      typeof optionsOrSteps === 'number' ? { steps: optionsOrSteps } : optionsOrSteps
    if (
      options.steps !== undefined &&
      (!Number.isSafeInteger(options.steps) || options.steps < 0)
    ) {
      throw new ValidationError('Rollback steps must be a nonnegative safe integer')
    }
    if (options.dryRun) {
      const plan = await this.planDown(options)
      return { executed: plan.map(t => t.name), skipped: [], failed: [], duration: 0, dryRun: true }
    }
    return this.withAdvisoryLock(async db => {
      const targets = await this.planDown(options, db)
      const missing = targets.filter(t => t.path === null)
      if (missing.length)
        throw new CLIError(
          `Migration file not found: ${missing.map(t => t.name).join(', ')}`,
          'FILE_NOT_FOUND'
        )
      const applied: string[] = []
      try {
        return await this.runDown(targets.length, this.progressHooks('down', applied), db)
      } catch (error) {
        this.rethrowRunError(
          error,
          'down',
          targets.map(t => t.name),
          applied
        )
      }
    }).catch((error: unknown) => this.rethrowRunError(error, 'down', [], []))
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
}
