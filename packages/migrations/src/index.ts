import type { Kysely } from 'kysely'
import { createMigrationHistory, type MigrationHistory, type MigrationRecord } from './history.js'
export { createMigrationHistory } from './history.js'
export type { MigrationHistory, MigrationHistoryOptions, MigrationRecord } from './history.js'
import { sql } from 'kysely'
import type { KyseraLogger } from '@kysera/core'
import {
  DatabaseError,
  NotFoundError,
  BadRequestError,
  ErrorCodes,
  silentLogger,
  detectDialect
} from '@kysera/core'
import { VERSION } from './version.js'

// ============================================================================
// Schema Exports
// ============================================================================

export {
  // Schemas
  MigrationRunnerOptionsSchema,
  MigrationDefinitionSchema,
  MigrationPluginOptionsSchema,
  MigrationPluginSchema,
  MigrationStatusSchema,
  MigrationResultSchema,
  MigrationRunnerWithPluginsOptionsSchema,
  // Type exports
  type MigrationRunnerOptionsInput,
  type MigrationRunnerOptionsOutput,
  type MigrationDefinitionInput,
  type MigrationDefinitionOutput,
  type MigrationPluginOptionsInput,
  type MigrationPluginOptionsOutput,
  type MigrationPluginInput,
  type MigrationPluginOutput,
  type MigrationStatusType,
  type MigrationResultType,
  type MigrationRunnerWithPluginsOptionsInput,
  type MigrationRunnerWithPluginsOptionsOutput,
  // Validation helpers
  parseMigrationRunnerOptions,
  safeParseMigrationRunnerOptions,
  parseMigrationDefinition,
  safeParseMigrationDefinition
} from './schemas.js'

import { MigrationRunnerOptionsSchema } from './schemas.js'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Migration interface - the core building block
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export interface Migration<DB = unknown> {
  /** Unique migration name (e.g., '001_create_users') */
  name: string
  /** Stable content digest supplied by the author or file loader. Never inferred from function source. */
  checksum?: string
  /** Migration up function - creates/modifies schema */
  up: (db: Kysely<DB>) => Promise<void>
  /** Optional migration down function - reverts changes */
  down?: (db: Kysely<DB>) => Promise<void>
}

/**
 * Migration with metadata for enhanced logging and tracking
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export interface MigrationWithMeta<DB = unknown> extends Migration<DB> {
  /** Human-readable description shown during migration */
  description?: string
  /** Whether this is a breaking change - shows warning before execution */
  breaking?: boolean
  /** Estimated duration in milliseconds for progress indication */
  estimatedDuration?: number
  /** Tags for categorization (e.g., ['schema', 'data', 'index']) */
  tags?: string[]
}

/**
 * Migration status result
 */
export interface MigrationStatus {
  /** List of executed migration names */
  executed: string[]
  /** List of pending migration names */
  pending: string[]
  /** Total migration count */
  total: number
}

/**
 * Migration runner options
 */
export interface MigrationRunnerOptions {
  /** Enable dry run mode (preview only, no changes) */
  dryRun?: boolean
  /**
   * Logger for migration operations.
   * Uses KyseraLogger interface from @kysera/core.
   *
   * @default silentLogger (no output)
   */
  logger?: KyseraLogger
  /** Wrap each migration in a transaction (default: false) */
  useTransactions?: boolean
  /** Stop on first error (default: true) */
  stopOnError?: boolean
  /** Show detailed metadata in logs (default: true) */
  verbose?: boolean
  /**
   * Serialize concurrent runners via a database advisory lock (default: true).
   *
   * Two application instances migrating at once would otherwise both see the
   * same pending list and run every migration twice. PostgreSQL uses
   * `pg_try_advisory_lock`, MySQL uses `GET_LOCK`, MSSQL uses `sp_getapplock`
   * with a session-owned lock; SQLite is single-writer by nature (no-op).
   */
  advisoryLock?: boolean
  /** Max time to wait for the advisory lock before failing (default: 60000) */
  lockTimeoutMs?: number
  /** Numeric PostgreSQL key, or a legacy text identity hashed by PostgreSQL. */
  advisoryLockKey?: bigint | number | string
  /** Optional external lock. It must protect the supplied connection for the entire run. */
  lockProvider?: MigrationLockProvider
  history?: MigrationHistory
  enforceChecksums?: boolean
  /** Explicit trust-on-first-use compatibility option; default false. */
  backfillMissingChecksums?: boolean
  rollbackChecksumPolicy?: 'error' | 'warn'
  missingMigrationPolicy?: 'error' | 'warn'
  /** Refuse an incomplete rollback plan before reverting anything. */
  strictRollback?: boolean
}

export interface MigrationLockProvider {
  acquire<DB>(db: Kysely<DB>): Promise<boolean>
  release<DB>(db: Kysely<DB>): Promise<void>
}

export interface MigrationInspection {
  executed: MigrationRecord[]
  pending: string[]
  drift: { name: string; recorded: string; current: string }[]
  missingFiles: string[]
  unknownChecksums: string[]
}

export class MigrationChecksumError extends Error {
  readonly code = 'MIGRATION_CHECKSUM_MISMATCH'
  constructor(readonly drift: MigrationInspection['drift']) {
    super(
      `Applied migration content has changed: ${drift.map(d => d.name).join(', ')}. Restore the applied source and add a new migration.`
    )
    this.name = 'MigrationChecksumError'
  }
}

/**
 * Object-based migration definition for Level 2 DX
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export interface MigrationDefinition<DB = unknown> {
  checksum?: string
  up: (db: Kysely<DB>) => Promise<void>
  down?: (db: Kysely<DB>) => Promise<void>
  description?: string
  breaking?: boolean
  estimatedDuration?: number
  tags?: string[]
}

/**
 * Migration definitions map for defineMigrations()
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export type MigrationDefinitions<DB = unknown> = Record<string, MigrationDefinition<DB>>

/**
 * Result of a migration run
 */
export interface MigrationResult {
  /** Successfully executed migrations */
  executed: string[]
  /** Migrations that were skipped (already executed) */
  skipped: string[]
  /** Migrations that failed */
  failed: string[]
  /** Total duration in milliseconds */
  duration: number
  /** Whether the run was in dry-run mode */
  dryRun: boolean
}

// ============================================================================
// Error Classes (extending @kysera/core)
// ============================================================================

/** Error codes for migration operations — references unified codes from @kysera/core */
export const MigrationErrorCodes = {
  UP_FAILED: ErrorCodes.MIGRATION_UP_FAILED,
  DOWN_FAILED: ErrorCodes.MIGRATION_DOWN_FAILED,
  VALIDATION_FAILED: ErrorCodes.MIGRATION_VALIDATION_FAILED
} as const

export type MigrationErrorCode = (typeof MigrationErrorCodes)[keyof typeof MigrationErrorCodes]

/**
 * Migration-specific error extending DatabaseError from @kysera/core
 * Provides structured error information with code, migration context, and cause tracking
 */
export class MigrationError extends DatabaseError {
  public readonly migrationName: string
  public readonly operation: 'up' | 'down'

  constructor(message: string, migrationName: string, operation: 'up' | 'down', cause?: Error) {
    const code =
      operation === 'up' ? MigrationErrorCodes.UP_FAILED : MigrationErrorCodes.DOWN_FAILED
    super(message, code, migrationName)
    this.name = 'MigrationError'
    this.migrationName = migrationName
    this.operation = operation
    if (cause) {
      this.cause = cause
    }
  }

  override toJSON(): Record<string, unknown> {
    const causeError = this.cause instanceof Error ? this.cause : undefined
    return {
      ...super.toJSON(),
      migrationName: this.migrationName,
      operation: this.operation,
      cause: causeError?.message
    }
  }
}

/** A notification hook failed after the operation committed. Never reapply blindly. */
export class MigrationHookError extends Error {
  readonly code = 'MIGRATION_AFTER_HOOK_FAILED'
  readonly applied = true
  constructor(
    readonly migrationName: string,
    readonly operation: 'up' | 'down',
    cause: unknown
  ) {
    super(`Migration ${migrationName} ${operation} committed, but its after hook failed`, { cause })
    this.name = 'MigrationHookError'
  }
}

// ============================================================================
// Setup Functions
// ============================================================================

/**
 * Setup migrations table in database
 * Idempotent - safe to run multiple times
 * Uses Kysely<unknown> as migrations work with any database schema
 */
export async function setupMigrations(db: Kysely<unknown>): Promise<void> {
  await createMigrationHistory().setup(db)
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if migration has metadata
 * Type guard to narrow Migration<DB> to MigrationWithMeta<DB>
 */
function hasMeta<DB>(migration: Migration<DB>): migration is MigrationWithMeta<DB> {
  return 'description' in migration || 'breaking' in migration || 'tags' in migration
}

/**
 * Format error message for logging
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Advisory lock identity shared by every Kysera migration runner.
 * PostgreSQL wants a bigint key; MySQL wants a string name.
 * @internal
 */
const MIGRATION_LOCK_KEY = 8982422971203 // stable app-wide key ("kysera" digits)
const MIGRATION_LOCK_NAME = 'kysera_migrations'
const MIGRATION_LOCK_POLL_MS = 250

/** @internal */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Thrown when the migration advisory lock cannot be acquired in time —
 * usually means another instance is still migrating.
 */
export class MigrationLockError extends DatabaseError {
  constructor(timeoutMs: number) {
    super(
      `Could not acquire migration advisory lock within ${String(timeoutMs)}ms — ` +
        `another migration runner is probably active. ` +
        `Increase lockTimeoutMs or set advisoryLock: false to bypass (unsafe).`,
      ErrorCodes.MIGRATION_UP_FAILED
    )
    this.name = 'MigrationLockError'
  }
}

/**
 * Validate migrations for duplicate names
 * @throws {BadRequestError} When duplicate migration names are found
 */
function validateMigrations<DB>(migrations: Migration<DB>[]): void {
  const names = new Set<string>()
  for (const migration of migrations) {
    if (names.has(migration.name)) {
      throw new BadRequestError(`Duplicate migration name: ${migration.name}`)
    }
    names.add(migration.name)
  }
}

// ============================================================================
// Migration Runner Class
// ============================================================================

/**
 * Migration runner with state tracking and metadata support
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export class MigrationRunner<DB = unknown> {
  protected logger: KyseraLogger
  protected runnerOptions: Required<
    Pick<
      MigrationRunnerOptions,
      'dryRun' | 'useTransactions' | 'stopOnError' | 'verbose' | 'advisoryLock' | 'lockTimeoutMs'
    >
  > & {
    logger: KyseraLogger
  }
  protected db: Kysely<DB>
  protected migrations: Migration<DB>[]
  protected readonly history: MigrationHistory
  private readonly options: MigrationRunnerOptions
  private active = false

  constructor(db: Kysely<DB>, migrations: Migration<DB>[], options: MigrationRunnerOptions = {}) {
    // Validate and apply defaults using Zod schema
    const parsed = MigrationRunnerOptionsSchema.safeParse(options)
    if (!parsed.success) {
      throw new BadRequestError(`Invalid migration runner options: ${parsed.error.message}`)
    }

    this.db = db
    this.options = { ...options }
    this.history = options.history ?? createMigrationHistory()
    this.migrations = [...migrations]
    const lockKey = options.advisoryLockKey
    if (typeof lockKey === 'number' && !Number.isSafeInteger(lockKey))
      throw new BadRequestError('Migration lock key must be a safe integer or bigint')
    if (typeof lockKey === 'bigint' && (lockKey < -(2n ** 63n) || lockKey >= 2n ** 63n))
      throw new BadRequestError('Migration lock key must fit a signed 64-bit integer')
    this.logger = options.logger ?? silentLogger
    this.runnerOptions = {
      dryRun: parsed.data.dryRun,
      logger: this.logger,
      useTransactions: parsed.data.useTransactions,
      stopOnError: parsed.data.stopOnError,
      verbose: parsed.data.verbose,
      advisoryLock: parsed.data.advisoryLock,
      lockTimeoutMs: parsed.data.lockTimeoutMs
    }

    // Validate migrations on construction
    validateMigrations(migrations)
  }

  /**
   * Serialize a migration run against concurrent runners using a database
   * advisory lock. Concurrent calls on one instance are rejected; every
   * statement uses the pinned connection. Dry runs perform no writes.
   *
   * @internal
   */
  protected async withAdvisoryLock<T>(fn: (db: Kysely<DB>) => Promise<T>): Promise<T> {
    if (this.active)
      throw new BadRequestError('This migration runner already has an active operation')
    this.active = true
    try {
      return await this.acquireRunLock(fn)
    } finally {
      this.active = false
    }
  }

  private async acquireRunLock<T>(fn: (db: Kysely<DB>) => Promise<T>): Promise<T> {
    if (this.runnerOptions.dryRun) return fn(this.db)
    if (this.options.lockProvider) {
      const provider = this.options.lockProvider
      return this.withConnectionLock(
        fn,
        async conn => {
          if (!(await provider.acquire(conn)))
            throw new MigrationLockError(this.runnerOptions.lockTimeoutMs)
        },
        conn => provider.release(conn)
      )
    }
    if (!this.runnerOptions.advisoryLock) return fn(this.db)
    const dialect = detectDialect(this.db)

    if (dialect === 'postgres') {
      const identity = this.options.advisoryLockKey ?? MIGRATION_LOCK_KEY
      const key =
        typeof identity === 'string'
          ? sql`hashtext(${identity})::bigint`
          : sql`${String(identity)}::bigint`
      return await this.withConnectionLock(
        fn,
        async conn => {
          const deadline = Date.now() + this.runnerOptions.lockTimeoutMs
          for (;;) {
            const result = await sql<{ locked: boolean }>`
              select pg_try_advisory_lock(${key}) as locked
            `.execute(conn)
            if (result.rows[0]?.locked) return
            if (Date.now() >= deadline) {
              throw new MigrationLockError(this.runnerOptions.lockTimeoutMs)
            }
            await sleep(Math.min(MIGRATION_LOCK_POLL_MS, Math.max(0, deadline - Date.now())))
          }
        },
        async conn => {
          await sql`select pg_advisory_unlock(${key})`.execute(conn)
        }
      )
    }

    if (dialect === 'mysql') {
      const timeoutSeconds = Math.max(1, Math.ceil(this.runnerOptions.lockTimeoutMs / 1000))
      return await this.withConnectionLock(
        fn,
        async conn => {
          const result = await sql<{ locked: number | null }>`
            select get_lock(${MIGRATION_LOCK_NAME}, ${sql.lit(timeoutSeconds)}) as locked
          `.execute(conn)
          if (result.rows[0]?.locked !== 1) {
            throw new MigrationLockError(this.runnerOptions.lockTimeoutMs)
          }
        },
        async conn => {
          await sql`select release_lock(${MIGRATION_LOCK_NAME})`.execute(conn)
        }
      )
    }

    if (dialect === 'mssql') {
      const timeoutMs = this.runnerOptions.lockTimeoutMs
      return await this.withConnectionLock(
        fn,
        async conn => {
          // @LockOwner = 'Session': the lock belongs to the pinned connection
          // (not a transaction), so it survives the per-migration transactions
          // executed on this same pinned connection.
          // sp_getapplock return codes: 0 granted, 1 granted after waiting,
          // -1 timeout, -2 canceled, -3 deadlock victim, -999 invalid call.
          const result = await sql<{ result: number }>`
            declare @kysera_lock_result int;
            exec @kysera_lock_result = sp_getapplock
              @Resource = ${MIGRATION_LOCK_NAME},
              @LockMode = 'Exclusive',
              @LockOwner = 'Session',
              @LockTimeout = ${sql.lit(timeoutMs)};
            select @kysera_lock_result as result;
          `.execute(conn)
          const code = result.rows[0]?.result ?? -999
          if (code < 0) {
            if (code === -1) {
              throw new MigrationLockError(timeoutMs)
            }
            throw new DatabaseError(
              `sp_getapplock failed with result code ${String(code)} ` +
                `(-2 = canceled, -3 = deadlock victim, -999 = invalid call)`,
              ErrorCodes.MIGRATION_UP_FAILED
            )
          }
        },
        async conn => {
          await sql`
            exec sp_releaseapplock @Resource = ${MIGRATION_LOCK_NAME}, @LockOwner = 'Session'
          `.execute(conn)
        }
      )
    }

    // SQLite reports writer contention through its transaction. Keep the
    // history write atomic with the body; never retry ambiguous failures.
    return await fn(this.db)
  }

  /**
   * Run acquire/fn/release with the lock pinned to ONE pooled connection —
   * advisory locks are session-scoped, so acquire and release must happen
   * on the same connection.
   *
   * @internal
   */
  private async withConnectionLock<T>(
    fn: (db: Kysely<DB>) => Promise<T>,
    acquire: (conn: Kysely<DB>) => Promise<void>,
    release: (conn: Kysely<DB>) => Promise<void>
  ): Promise<T> {
    return await this.db.connection().execute(async conn => {
      await acquire(conn)
      let failure: unknown
      try {
        return await fn(conn)
      } catch (error) {
        failure = error
        throw error
      } finally {
        try {
          await release(conn)
        } catch (error) {
          this.logger.error(`Failed to release migration advisory lock: ${formatError(error)}`)
          const releaseError = new Error(
            'Migration lock release failed; changes may already be committed. Inspect status before retrying.',
            { cause: error }
          )
          if (failure !== undefined)
            throw new AggregateError(
              [failure, releaseError],
              'Migration failed and its lock could not be released'
            )
          throw releaseError
        }
      }
    })
  }

  protected async ensureSetup(db: Kysely<DB> = this.db): Promise<void> {
    await this.history.setup(db)
  }

  /** Read-only, including on an empty database. */
  async getExecutedMigrations(db: Kysely<DB> = this.db): Promise<string[]> {
    return (await this.history.read(db)).map(record => record.name)
  }

  async markAsExecuted(name: string, db: Kysely<DB> = this.db): Promise<void> {
    if (db === this.db) await this.ensureSetup(db)
    const migration = this.migrations.find(m => m.name === name)
    await this.history.insert(db, { name, checksum: migration?.checksum ?? null, executedAt: null })
  }

  async markAsRolledBack(name: string, db: Kysely<DB> = this.db): Promise<void> {
    await this.history.remove(db, name)
  }

  /** Read-only integrity report; never creates or repairs history. */
  async inspect(db: Kysely<DB> = this.db): Promise<MigrationInspection> {
    const executed = await this.history.read(db)
    const byName = new Map(this.migrations.map(m => [m.name, m]))
    const names = new Set(executed.map(r => r.name))
    const drift: MigrationInspection['drift'] = []
    for (const record of executed) {
      const current = byName.get(record.name)?.checksum
      if (record.checksum !== null && current !== undefined && record.checksum !== current) {
        drift.push({ name: record.name, recorded: record.checksum, current })
      }
    }
    return {
      executed,
      pending: this.migrations.filter(m => !names.has(m.name)).map(m => m.name),
      drift,
      missingFiles: executed.filter(r => !byName.has(r.name)).map(r => r.name),
      unknownChecksums: executed
        .filter(r => r.checksum === null || byName.get(r.name)?.checksum === undefined)
        .map(r => r.name)
    }
  }

  protected async checkIntegrity(db: Kysely<DB>, operation: 'up' | 'down'): Promise<void> {
    const report = await this.inspect(db)
    if (report.drift.length && this.options.enforceChecksums !== false) {
      if (operation === 'down' && this.options.rollbackChecksumPolicy === 'warn') {
        this.logger.warn(`Migration checksum drift: ${report.drift.map(d => d.name).join(', ')}`)
      } else throw new MigrationChecksumError(report.drift)
    }
    if (report.missingFiles.length) {
      const message = `Applied migrations not in this build: ${report.missingFiles.join(', ')}`
      if (this.options.missingMigrationPolicy === 'error') throw new BadRequestError(message)
      this.logger.warn(message)
    }
    if (this.options.backfillMissingChecksums && !this.runnerOptions.dryRun) {
      await this.adoptMissingChecksums(db)
    }
  }

  private async adoptMissingChecksums(db: Kysely<DB>): Promise<string[]> {
    const records = await this.history.read(db)
    const adopted: string[] = []
    const apply = async (tx: Kysely<DB>): Promise<void> => {
      for (const record of records) {
        const checksum = this.migrations.find(m => m.name === record.name)?.checksum
        if (record.checksum === null && checksum !== undefined) {
          await this.history.setChecksum(tx, record.name, checksum)
          adopted.push(record.name)
        }
      }
    }
    if (db.isTransaction) await apply(db)
    else await db.transaction().execute(apply)
    if (adopted.length)
      this.logger.warn(
        `Backfilled missing checksum(s), trusting current source: ${adopted.join(', ')}`
      )
    return adopted
  }

  async adoptChecksums(): Promise<string[]> {
    if (this.runnerOptions.dryRun)
      throw new BadRequestError('Checksum adoption cannot run in dry-run mode')
    return this.withAdvisoryLock(async db => {
      await this.ensureSetup(db)
      return this.adoptMissingChecksums(db)
    })
  }

  async baseline(names: string[]): Promise<{ marked: string[]; skipped: string[] }> {
    for (const name of names) {
      if (!this.migrations.some(m => m.name === name))
        throw new NotFoundError('Migration', { name })
    }
    if (this.runnerOptions.dryRun) throw new BadRequestError('Baseline cannot run in dry-run mode')
    return this.withAdvisoryLock(async db => {
      await this.ensureSetup(db)
      const apply = async (tx: Kysely<DB>): Promise<{ marked: string[]; skipped: string[] }> => {
        const executed = new Set(await this.getExecutedMigrations(tx))
        const result = { marked: [] as string[], skipped: [] as string[] }
        for (const name of names) {
          if (executed.has(name)) result.skipped.push(name)
          else {
            await this.markAsExecuted(name, tx)
            result.marked.push(name)
            executed.add(name)
          }
        }
        return result
      }
      return db.isTransaction ? apply(db) : db.transaction().execute(apply)
    })
  }

  /**
   * Log migration metadata if available
   */
  protected logMigrationMeta(migration: Migration<DB>): void {
    if (!this.runnerOptions.verbose || !hasMeta(migration)) return

    const meta = migration

    if (meta.description) {
      this.logger.info(`  Description: ${meta.description}`)
    }

    if (meta.breaking) {
      this.logger.warn(`  BREAKING CHANGE - Review carefully before proceeding`)
    }

    if (meta.tags && meta.tags.length > 0) {
      this.logger.info(`  Tags: ${meta.tags.join(', ')}`)
    }

    if (meta.estimatedDuration) {
      const seconds = (meta.estimatedDuration / 1000).toFixed(1)
      this.logger.info(`  Estimated: ${seconds}s`)
    }
  }

  /**
   * Execute a single migration with optional transaction wrapping
   */
  protected async executeMigration(
    migration: Migration<DB>,
    operation: 'up' | 'down',
    db: Kysely<DB> = this.db
  ): Promise<void> {
    const fn = operation === 'up' ? migration.up : migration.down
    if (!fn) return
    const apply = async (tx: Kysely<DB>): Promise<void> => {
      await fn(tx)
      if (operation === 'up') await this.markAsExecuted(migration.name, tx)
      else await this.markAsRolledBack(migration.name, tx)
    }
    if (this.runnerOptions.useTransactions && !db.isTransaction)
      await db.transaction().execute(apply)
    else await apply(db)
  }

  /**
   * Run all pending migrations
   */
  async up(): Promise<MigrationResult> {
    return await this.withAdvisoryLock(db => this.runUp(this.migrations, undefined, db))
  }

  /**
   * Core up logic — used by up(), upTo(), and overridden by MigrationRunnerWithPlugins.
   * Protected to allow hook injection by subclasses.
   */
  protected async runUp(
    migrationsToConsider: Migration<DB>[],
    hooks?: {
      before?: (migration: Migration<DB>) => Promise<void>
      after?: (migration: Migration<DB>, duration: number) => Promise<void>
      onError?: (migration: Migration<DB>, error: unknown) => Promise<void>
    },
    db: Kysely<DB> = this.db
  ): Promise<MigrationResult> {
    const startTime = Date.now()
    const result: MigrationResult = {
      executed: [],
      skipped: [],
      failed: [],
      duration: 0,
      dryRun: this.runnerOptions.dryRun
    }

    if (!this.runnerOptions.dryRun) await this.ensureSetup(db)
    await this.checkIntegrity(db, 'up')
    const executedList = await this.getExecutedMigrations(db)
    const executedSet = new Set(executedList)

    const pending = migrationsToConsider.filter(m => !executedSet.has(m.name))

    if (pending.length === 0) {
      this.logger.info('No pending migrations')
      result.skipped = executedList
      result.duration = Date.now() - startTime
      return result
    }

    if (this.runnerOptions.dryRun) {
      this.logger.info('DRY RUN - No changes will be made')
    }

    for (const migration of migrationsToConsider) {
      if (executedSet.has(migration.name)) {
        this.logger.info(`${migration.name} (already executed)`)
        result.skipped.push(migration.name)
        continue
      }

      await this.applyMigration(migration, 'up', result, hooks, db)
    }

    if (!this.runnerOptions.dryRun) {
      if (result.failed.length > 0) {
        this.logger.warn(`Migrations completed with ${String(result.failed.length)} failure(s)`)
      } else {
        this.logger.info('All migrations completed successfully')
      }
    } else {
      this.logger.info('Dry run completed - no changes made')
    }

    result.duration = Date.now() - startTime
    return result
  }

  /**
   * Run one migration in the given direction, updating the shared result and
   * firing lifecycle hooks. Throws MigrationError when stopOnError is set.
   * @internal
   */
  private async applyMigration(
    migration: Migration<DB>,
    operation: 'up' | 'down',
    result: MigrationResult,
    hooks?: {
      before?: (migration: Migration<DB>) => Promise<void>
      after?: (migration: Migration<DB>, duration: number) => Promise<void>
      onError?: (migration: Migration<DB>, error: unknown) => Promise<void>
    },
    db: Kysely<DB> = this.db
  ): Promise<void> {
    const migrationStart = Date.now()
    const verb = operation === 'up' ? 'Running' : 'Rolling back'
    const doneVerb = operation === 'up' ? 'completed' : 'rolled back'

    try {
      await hooks?.before?.(migration)

      this.logger.info(`${verb} ${migration.name}...`)
      this.logMigrationMeta(migration)

      if (!this.runnerOptions.dryRun) {
        await this.executeMigration(migration, operation, db)
      }

      this.logger.info(`${migration.name} ${doneVerb}`)
      result.executed.push(migration.name)
    } catch (error) {
      try {
        await hooks?.onError?.(migration, error)
      } catch (hookError) {
        this.logger.error(`Migration error hook failed: ${formatError(hookError)}`)
      }
      this.recordMigrationFailure(migration, operation, error, result)
      return
    }
    try {
      await hooks?.after?.(migration, Date.now() - migrationStart)
    } catch (error) {
      throw new MigrationHookError(migration.name, operation, error)
    }
  }

  /**
   * Record a failed migration and rethrow as MigrationError when
   * stopOnError is enabled.
   * @internal
   */
  private recordMigrationFailure(
    migration: Migration<DB>,
    operation: 'up' | 'down',
    error: unknown,
    result: MigrationResult
  ): void {
    const errorMsg = formatError(error)
    const failVerb = operation === 'up' ? 'failed' : 'rollback failed'
    this.logger.error(`${migration.name} ${failVerb}: ${errorMsg}`)
    result.failed.push(migration.name)

    if (this.runnerOptions.stopOnError) {
      throw new MigrationError(
        operation === 'up'
          ? `Migration ${migration.name} failed: ${errorMsg}`
          : `Rollback of ${migration.name} failed: ${errorMsg}`,
        migration.name,
        operation,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Rollback last N migrations
   */
  async down(steps = 1): Promise<MigrationResult> {
    return await this.withAdvisoryLock(db => this.runDown(steps, undefined, db))
  }

  /**
   * Core down logic — used by down() and overridden by MigrationRunnerWithPlugins.
   * Protected to allow hook injection by subclasses.
   */
  protected async runDown(
    steps: number,
    hooks?: {
      before?: (migration: Migration<DB>) => Promise<void>
      after?: (migration: Migration<DB>, duration: number) => Promise<void>
      onError?: (migration: Migration<DB>, error: unknown) => Promise<void>
    },
    db: Kysely<DB> = this.db
  ): Promise<MigrationResult> {
    if (!Number.isSafeInteger(steps) || steps < 0)
      throw new BadRequestError('Rollback steps must be a nonnegative safe integer')
    const startTime = Date.now()
    const result: MigrationResult = {
      executed: [],
      skipped: [],
      failed: [],
      duration: 0,
      dryRun: this.runnerOptions.dryRun
    }

    if (!this.runnerOptions.dryRun) await this.ensureSetup(db)
    await this.checkIntegrity(db, 'down')
    const executed = await this.getExecutedMigrations(db)

    if (executed.length === 0) {
      this.logger.warn('No executed migrations to rollback')
      result.duration = Date.now() - startTime
      return result
    }

    const toRollback = steps === 0 ? [] : executed.slice(-steps).reverse()
    if (this.options.strictRollback) {
      const unavailable = toRollback.filter(
        name => !this.migrations.find(m => m.name === name)?.down
      )
      if (unavailable.length)
        throw new BadRequestError(
          `Rollback unavailable for: ${unavailable.join(', ')}. No migrations were reverted.`
        )
    }

    if (this.runnerOptions.dryRun) {
      this.logger.info('DRY RUN - No changes will be made')
    }

    for (const name of toRollback) {
      const migration = this.migrations.find(m => m.name === name)

      if (!migration) {
        this.logger.warn(`Migration ${name} not found in codebase`)
        result.skipped.push(name)
        continue
      }

      if (!migration.down) {
        this.logger.warn(`Migration ${name} has no down method - skipping`)
        result.skipped.push(name)
        continue
      }

      await this.applyMigration(migration, 'down', result, hooks, db)
    }

    if (!this.runnerOptions.dryRun) {
      if (result.failed.length > 0) {
        this.logger.warn(`Rollback completed with ${String(result.failed.length)} failure(s)`)
      } else {
        this.logger.info('Rollback completed successfully')
      }
    } else {
      this.logger.info('Dry run completed - no changes made')
    }

    result.duration = Date.now() - startTime
    return result
  }

  /**
   * Show migration status
   */
  async status(): Promise<MigrationStatus> {
    const executed = await this.getExecutedMigrations()
    const pending = this.migrations.filter(m => !executed.includes(m.name)).map(m => m.name)

    this.logger.info('Migration Status:')
    this.logger.info(`  Executed: ${String(executed.length)}`)
    this.logger.info(`  Pending: ${String(pending.length)}`)
    this.logger.info(`  Total: ${String(this.migrations.length)}`)

    if (executed.length > 0) {
      this.logger.info('Executed migrations:')
      for (const name of executed) {
        const migration = this.migrations.find(m => m.name === name)
        const description =
          migration && hasMeta(migration) ? (migration as MigrationWithMeta).description : undefined
        if (description) {
          this.logger.info(`  ${name} - ${description}`)
        } else {
          this.logger.info(`  ${name}`)
        }
      }
    }

    if (pending.length > 0) {
      this.logger.info('Pending migrations:')
      for (const name of pending) {
        const migration = this.migrations.find(m => m.name === name)
        if (migration && hasMeta(migration)) {
          const meta = migration as MigrationWithMeta
          const suffix = meta.breaking ? ' BREAKING' : ''
          const desc = meta.description ? ` - ${meta.description}` : ''
          this.logger.info(`  ${name}${desc}${suffix}`)
        } else {
          this.logger.info(`  ${name}`)
        }
      }
    }

    return { executed, pending, total: this.migrations.length }
  }

  /**
   * Reset all migrations (dangerous!)
   * In dry run mode, shows what would be rolled back
   */
  async reset(): Promise<MigrationResult> {
    return this.withAdvisoryLock(async db => {
      const executed = await this.getExecutedMigrations(db)
      if (executed.length === 0) this.logger.warn('No migrations to reset')
      return this.runDown(executed.length, undefined, db)
    })
  }

  /**
   * Run migrations up to a specific migration (inclusive)
   */
  async upTo(targetName: string): Promise<MigrationResult> {
    const targetIndex = this.migrations.findIndex(m => m.name === targetName)
    if (targetIndex === -1) {
      throw new NotFoundError('Migration', { name: targetName })
    }

    const migrationsToRun = this.migrations.slice(0, targetIndex + 1)
    const result = await this.withAdvisoryLock(db => this.runUp(migrationsToRun, undefined, db))

    if (!this.runnerOptions.dryRun && result.failed.length === 0) {
      this.logger.info(`Migrated up to ${targetName}`)
    }

    return result
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a migration runner instance
 * Options are validated using Zod schema
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export function createMigrationRunner<DB = unknown>(
  db: Kysely<DB>,
  migrations: Migration<DB>[],
  options?: MigrationRunnerOptions
): MigrationRunner<DB> {
  return new MigrationRunner(db, migrations, options)
}

/**
 * Helper to create a simple migration
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export function createMigration<DB = unknown>(
  name: string,
  up: (db: Kysely<DB>) => Promise<void>,
  down?: (db: Kysely<DB>) => Promise<void>
): Migration<DB> {
  const migration: Migration<DB> = { name, up }
  if (down !== undefined) {
    migration.down = down
  }
  return migration
}

/**
 * Helper to create a migration with metadata
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export function createMigrationWithMeta<DB = unknown>(
  name: string,
  options: {
    up: (db: Kysely<DB>) => Promise<void>
    down?: (db: Kysely<DB>) => Promise<void>
    checksum?: string
    description?: string
    breaking?: boolean
    estimatedDuration?: number
    tags?: string[]
  }
): MigrationWithMeta<DB> {
  const migration: MigrationWithMeta<DB> = {
    name,
    up: options.up
  }
  if (options.checksum !== undefined) migration.checksum = options.checksum
  if (options.down !== undefined) {
    migration.down = options.down
  }
  if (options.description !== undefined) {
    migration.description = options.description
  }
  if (options.breaking !== undefined) {
    migration.breaking = options.breaking
  }
  if (options.estimatedDuration !== undefined) {
    migration.estimatedDuration = options.estimatedDuration
  }
  if (options.tags !== undefined) {
    migration.tags = options.tags
  }
  return migration
}

// ============================================================================
// Level 2: Developer Experience APIs
// ============================================================================

/**
 * Define migrations using an object-based syntax for cleaner code
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export function defineMigrations<DB = unknown>(
  definitions: MigrationDefinitions<DB>
): MigrationWithMeta<DB>[] {
  return Object.entries(definitions).map(([name, def]) => {
    const migration: MigrationWithMeta<DB> = {
      name,
      up: def.up
    }
    if (def.checksum !== undefined) migration.checksum = def.checksum
    if (def.down !== undefined) {
      migration.down = def.down
    }
    if (def.description !== undefined) {
      migration.description = def.description
    }
    if (def.breaking !== undefined) {
      migration.breaking = def.breaking
    }
    if (def.estimatedDuration !== undefined) {
      migration.estimatedDuration = def.estimatedDuration
    }
    if (def.tags !== undefined) {
      migration.tags = def.tags
    }
    return migration
  })
}

/**
 * Run all pending migrations - one-liner convenience function
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export async function runMigrations<DB = unknown>(
  db: Kysely<DB>,
  migrations: Migration<DB>[],
  options?: MigrationRunnerOptions
): Promise<MigrationResult> {
  const runner = new MigrationRunner(db, migrations, options)
  return await runner.up()
}

/**
 * Rollback migrations - one-liner convenience function
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export async function rollbackMigrations<DB = unknown>(
  db: Kysely<DB>,
  migrations: Migration<DB>[],
  steps = 1,
  options?: MigrationRunnerOptions
): Promise<MigrationResult> {
  const runner = new MigrationRunner(db, migrations, options)
  return await runner.down(steps)
}

/**
 * Get migration status - one-liner convenience function
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export async function getMigrationStatus<DB = unknown>(
  db: Kysely<DB>,
  migrations: Migration<DB>[],
  options?: Pick<MigrationRunnerOptions, 'logger' | 'verbose'>
): Promise<MigrationStatus> {
  const runner = new MigrationRunner(db, migrations, options)
  return await runner.status()
}

// ============================================================================
// Level 3: Ecosystem Integration
// ============================================================================

/**
 * Migration plugin interface - consistent with @kysera/repository Plugin
 * Provides lifecycle hooks for migration execution
 * Generic DB type allows type-safe plugins when schema is known,
 * defaults to unknown for maximum flexibility
 */
export interface MigrationPlugin<DB = unknown> {
  /** Plugin name */
  name: string
  /** Plugin version */
  version: string
  /** Called once when the runner is initialized (consistent with repository Plugin.onInit) */
  onInit?(runner: MigrationRunner<DB>): Promise<void> | void
  /** Called before migration execution */
  beforeMigration?(migration: Migration<DB>, operation: 'up' | 'down'): Promise<void> | void
  /** Called after successful migration execution */
  afterMigration?(
    migration: Migration<DB>,
    operation: 'up' | 'down',
    duration: number
  ): Promise<void> | void
  /** Called on migration error (unknown type for consistency with repository Plugin.onError) */
  onMigrationError?(
    migration: Migration<DB>,
    operation: 'up' | 'down',
    error: unknown
  ): Promise<void> | void
}

/**
 * Extended migration runner options with plugin support
 * Generic DB type allows type-safe plugins when schema is known,
 * defaults to unknown for maximum flexibility
 */
export interface MigrationRunnerWithPluginsOptions<DB = unknown> extends MigrationRunnerOptions {
  /** Plugins to apply */
  plugins?: MigrationPlugin<DB>[]
}

/**
 * Create a migration runner with plugin support
 * Async factory to properly initialize plugins (consistent with @kysera/repository createORM)
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export async function createMigrationRunnerWithPlugins<DB = unknown>(
  db: Kysely<DB>,
  migrations: Migration<DB>[],
  options?: MigrationRunnerWithPluginsOptions<DB>
): Promise<MigrationRunnerWithPlugins<DB>> {
  const runner = new MigrationRunnerWithPlugins(db, migrations, options)

  // Initialize plugins (consistent with repository Plugin.onInit pattern)
  if (options?.plugins) {
    for (const plugin of options.plugins) {
      if (plugin.onInit) {
        const result = plugin.onInit(runner)
        if (result instanceof Promise) {
          await result
        }
      }
    }
  }

  return runner
}

/**
 * Extended migration runner with plugin support
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 *
 * This class overrides up() and down() to call plugin lifecycle hooks
 * (beforeMigration, afterMigration, onMigrationError) around each migration execution.
 */
export class MigrationRunnerWithPlugins<DB = unknown> extends MigrationRunner<DB> {
  private plugins: MigrationPlugin<DB>[]

  constructor(
    db: Kysely<DB>,
    migrations: Migration<DB>[],
    options: MigrationRunnerWithPluginsOptions<DB> = {}
  ) {
    super(db, migrations, options)
    this.plugins = options.plugins ?? []
  }

  /**
   * Execute plugin hooks before migration
   * Can be called by consumers extending this class
   */
  protected async runBeforeHooks(
    migration: Migration<DB>,
    operation: 'up' | 'down'
  ): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.beforeMigration) {
        await plugin.beforeMigration(migration, operation)
      }
    }
  }

  /**
   * Execute plugin hooks after migration
   * Can be called by consumers extending this class
   */
  protected async runAfterHooks(
    migration: Migration<DB>,
    operation: 'up' | 'down',
    duration: number
  ): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.afterMigration) {
        await plugin.afterMigration(migration, operation, duration)
      }
    }
  }

  /**
   * Execute plugin hooks on error
   * Can be called by consumers extending this class
   */
  protected async runErrorHooks(
    migration: Migration<DB>,
    operation: 'up' | 'down',
    error: unknown
  ): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onMigrationError) {
        await plugin.onMigrationError(migration, operation, error)
      }
    }
  }

  /**
   * Get the list of registered plugins
   */
  getPlugins(): MigrationPlugin<DB>[] {
    return [...this.plugins]
  }

  protected override async runUp(
    migrations: Migration<DB>[],
    _hooks?: Parameters<MigrationRunner<DB>['runUp']>[1],
    db: Kysely<DB> = this.db
  ): Promise<MigrationResult> {
    return super.runUp(
      migrations,
      {
        before: migration => this.runBeforeHooks(migration, 'up'),
        after: (migration, duration) => this.runAfterHooks(migration, 'up', duration),
        onError: (migration, error) => this.runErrorHooks(migration, 'up', error)
      },
      db
    )
  }

  protected override async runDown(
    steps: number,
    _hooks?: Parameters<MigrationRunner<DB>['runDown']>[1],
    db: Kysely<DB> = this.db
  ): Promise<MigrationResult> {
    return super.runDown(
      steps,
      {
        before: migration => this.runBeforeHooks(migration, 'down'),
        after: (migration, duration) => this.runAfterHooks(migration, 'down', duration),
        onError: (migration, error) => this.runErrorHooks(migration, 'down', error)
      },
      db
    )
  }
}

// ============================================================================
// Built-in Plugins
// ============================================================================

/**
 * Logging plugin - logs migration events with timing
 * Works with any DB type (generic plugin)
 */
export function createLoggingPlugin<DB = unknown>(
  logger: KyseraLogger = silentLogger
): MigrationPlugin<DB> {
  return {
    name: '@kysera/migrations/logging',
    version: VERSION,
    beforeMigration(migration, operation) {
      logger.info(`Starting ${operation} for ${migration.name}`)
    },
    afterMigration(migration, operation, duration) {
      logger.info(`Completed ${operation} for ${migration.name} in ${String(duration)}ms`)
    },
    onMigrationError(migration, operation, error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Error during ${operation} for ${migration.name}: ${message}`)
    }
  }
}

/**
 * Metrics plugin - collects migration metrics
 * Works with any DB type (generic plugin)
 */
export function createMetricsPlugin<DB = unknown>(): MigrationPlugin<DB> & {
  getMetrics(): {
    migrations: { name: string; operation: string; duration: number; success: boolean }[]
  }
} {
  const metrics: { name: string; operation: string; duration: number; success: boolean }[] = []

  return {
    name: '@kysera/migrations/metrics',
    version: VERSION,
    afterMigration(migration, operation, duration) {
      metrics.push({ name: migration.name, operation, duration, success: true })
    },
    onMigrationError(migration, operation) {
      metrics.push({ name: migration.name, operation, duration: 0, success: false })
    },
    getMetrics() {
      return { migrations: [...metrics] }
    }
  }
}

// ============================================================================
// Re-exports from @kysera/core for convenience
// ============================================================================

export { DatabaseError, NotFoundError, BadRequestError, silentLogger } from '@kysera/core'
export type { KyseraLogger } from '@kysera/core'
