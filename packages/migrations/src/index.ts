import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { KyseraLogger } from '@kysera/core'
import { DatabaseError, NotFoundError, BadRequestError, silentLogger } from '@kysera/core'
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
}

/**
 * Object-based migration definition for Level 2 DX
 * Generic DB type allows type-safe migrations when schema is known,
 * defaults to unknown for maximum flexibility
 */
export interface MigrationDefinition<DB = unknown> {
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

/** Error codes for migration operations */
export type MigrationErrorCode =
  | 'MIGRATION_UP_FAILED'
  | 'MIGRATION_DOWN_FAILED'
  | 'MIGRATION_VALIDATION_FAILED'

/**
 * Migration-specific error extending DatabaseError from @kysera/core
 * Provides structured error information with code, migration context, and cause tracking
 */
export class MigrationError extends DatabaseError {
  public readonly migrationName: string
  public readonly operation: 'up' | 'down'

  constructor(message: string, migrationName: string, operation: 'up' | 'down', cause?: Error) {
    const code: MigrationErrorCode =
      operation === 'up' ? 'MIGRATION_UP_FAILED' : 'MIGRATION_DOWN_FAILED'
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

// ============================================================================
// Setup Functions
// ============================================================================

/**
 * Setup migrations table in database
 * Idempotent - safe to run multiple times
 * Uses Kysely<unknown> as migrations work with any database schema
 */
export async function setupMigrations(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('migrations')
    .ifNotExists()
    .addColumn('name', 'varchar(255)', col => col.primaryKey())
    .addColumn('executed_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  // Create index on name column for faster lookups
  // Using IF NOT EXISTS equivalent: ignore errors if index already exists
  try {
    await db.schema.createIndex('idx_migrations_name').on('migrations').column('name').execute()
  } catch (error) {
    // Index already exists or table doesn't support concurrent index creation
    // Safe to ignore as primary key provides index functionality
  }
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
  protected runnerOptions: Required<Omit<MigrationRunnerOptions, 'logger'>> & {
    logger: KyseraLogger
  }
  protected db: Kysely<DB>
  protected migrations: Migration<DB>[]

  constructor(db: Kysely<DB>, migrations: Migration<DB>[], options: MigrationRunnerOptions = {}) {
    // Validate and apply defaults using Zod schema
    const parsed = MigrationRunnerOptionsSchema.safeParse(options)
    if (!parsed.success) {
      throw new BadRequestError(`Invalid migration runner options: ${parsed.error.message}`)
    }

    this.db = db
    this.migrations = migrations
    this.logger = options.logger ?? silentLogger
    this.runnerOptions = {
      dryRun: parsed.data.dryRun,
      logger: this.logger,
      useTransactions: parsed.data.useTransactions,
      stopOnError: parsed.data.stopOnError,
      verbose: parsed.data.verbose
    }

    // Validate migrations on construction
    validateMigrations(migrations)
  }

  /**
   * Get list of executed migrations from database
   * Note: Uses type assertions for migrations table as it's not part of the user schema
   */
  async getExecutedMigrations(): Promise<string[]> {
    // Cast to any for migrations table operations - it's internal and not part of user schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setupMigrations(this.db as any)

    // The migrations table is internal and not part of the generic DB schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('migrations')
      .select('name')
      .orderBy('executed_at', 'asc')
      .execute()) as { name: string }[]

    return rows.map(r => r.name)
  }

  /**
   * Mark a migration as executed
   * Note: Uses type assertions for migrations table as it's not part of the user schema
   */
  async markAsExecuted(name: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any).insertInto('migrations').values({ name }).execute()
  }

  /**
   * Mark a migration as rolled back (remove from executed list)
   * Note: Uses type assertions for migrations table as it's not part of the user schema
   */
  async markAsRolledBack(name: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any).deleteFrom('migrations').where('name', '=', name).execute()
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
    operation: 'up' | 'down'
  ): Promise<void> {
    const fn = operation === 'up' ? migration.up : migration.down
    if (!fn) return

    if (this.runnerOptions.useTransactions) {
      await this.db.transaction().execute(async trx => {
        await fn(trx)
      })
    } else {
      await fn(this.db)
    }
  }

  /**
   * Run all pending migrations
   */
  async up(): Promise<MigrationResult> {
    const startTime = Date.now()
    const result: MigrationResult = {
      executed: [],
      skipped: [],
      failed: [],
      duration: 0,
      dryRun: this.runnerOptions.dryRun
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setupMigrations(this.db as any)
    const executed = await this.getExecutedMigrations()

    const pending = this.migrations.filter(m => !executed.includes(m.name))

    if (pending.length === 0) {
      this.logger.info('No pending migrations')
      result.skipped = executed
      result.duration = Date.now() - startTime
      return result
    }

    if (this.runnerOptions.dryRun) {
      this.logger.info('DRY RUN - No changes will be made')
    }

    for (const migration of this.migrations) {
      if (executed.includes(migration.name)) {
        this.logger.info(`${migration.name} (already executed)`)
        result.skipped.push(migration.name)
        continue
      }

      try {
        this.logger.info(`Running ${migration.name}...`)
        this.logMigrationMeta(migration)

        if (!this.runnerOptions.dryRun) {
          await this.executeMigration(migration, 'up')
          await this.markAsExecuted(migration.name)
        }

        this.logger.info(`${migration.name} completed`)
        result.executed.push(migration.name)
      } catch (error) {
        const errorMsg = formatError(error)
        this.logger.error(`${migration.name} failed: ${errorMsg}`)
        result.failed.push(migration.name)

        if (this.runnerOptions.stopOnError) {
          throw new MigrationError(
            `Migration ${migration.name} failed: ${errorMsg}`,
            migration.name,
            'up',
            error instanceof Error ? error : undefined
          )
        }
      }
    }

    if (!this.runnerOptions.dryRun) {
      this.logger.info('All migrations completed successfully')
    } else {
      this.logger.info('Dry run completed - no changes made')
    }

    result.duration = Date.now() - startTime
    return result
  }

  /**
   * Rollback last N migrations
   */
  async down(steps = 1): Promise<MigrationResult> {
    const startTime = Date.now()
    const result: MigrationResult = {
      executed: [],
      skipped: [],
      failed: [],
      duration: 0,
      dryRun: this.runnerOptions.dryRun
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setupMigrations(this.db as any)
    const executed = await this.getExecutedMigrations()

    if (executed.length === 0) {
      this.logger.warn('No executed migrations to rollback')
      result.duration = Date.now() - startTime
      return result
    }

    const toRollback = executed.slice(-steps).reverse()

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

      try {
        this.logger.info(`Rolling back ${name}...`)
        this.logMigrationMeta(migration)

        if (!this.runnerOptions.dryRun) {
          await this.executeMigration(migration, 'down')
          await this.markAsRolledBack(name)
        }

        this.logger.info(`${name} rolled back`)
        result.executed.push(name)
      } catch (error) {
        const errorMsg = formatError(error)
        this.logger.error(`${name} rollback failed: ${errorMsg}`)
        result.failed.push(name)

        if (this.runnerOptions.stopOnError) {
          throw new MigrationError(
            `Rollback of ${name} failed: ${errorMsg}`,
            name,
            'down',
            error instanceof Error ? error : undefined
          )
        }
      }
    }

    if (!this.runnerOptions.dryRun) {
      this.logger.info('Rollback completed successfully')
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setupMigrations(this.db as any)
    const executed = await this.getExecutedMigrations()
    const pending = this.migrations.filter(m => !executed.includes(m.name)).map(m => m.name)

    this.logger.info('Migration Status:')
    this.logger.info(`  Executed: ${executed.length}`)
    this.logger.info(`  Pending: ${pending.length}`)
    this.logger.info(`  Total: ${this.migrations.length}`)

    if (executed.length > 0) {
      this.logger.info('Executed migrations:')
      for (const name of executed) {
        const migration = this.migrations.find(m => m.name === name)
        if (migration && hasMeta(migration) && (migration as MigrationWithMeta).description) {
          this.logger.info(`  ${name} - ${(migration as MigrationWithMeta).description}`)
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
    const startTime = Date.now()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setupMigrations(this.db as any)
    const executed = await this.getExecutedMigrations()

    if (executed.length === 0) {
      this.logger.warn('No migrations to reset')
      return {
        executed: [],
        skipped: [],
        failed: [],
        duration: Date.now() - startTime,
        dryRun: this.runnerOptions.dryRun
      }
    }

    this.logger.warn(`Resetting ${executed.length} migrations...`)

    if (this.runnerOptions.dryRun) {
      this.logger.info('DRY RUN - Would rollback the following migrations:')
      for (const name of [...executed].reverse()) {
        const migration = this.migrations.find(m => m.name === name)
        if (!migration?.down) {
          this.logger.warn(`  ${name} (no down method - would be skipped)`)
        } else {
          this.logger.info(`  ${name}`)
        }
      }
      this.logger.info('Dry run completed - no changes made')
      return {
        executed: [],
        skipped: executed,
        failed: [],
        duration: Date.now() - startTime,
        dryRun: true
      }
    }

    const result = await this.down(executed.length)
    this.logger.info('All migrations reset')
    return result
  }

  /**
   * Run migrations up to a specific migration (inclusive)
   */
  async upTo(targetName: string): Promise<MigrationResult> {
    const startTime = Date.now()
    const result: MigrationResult = {
      executed: [],
      skipped: [],
      failed: [],
      duration: 0,
      dryRun: this.runnerOptions.dryRun
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setupMigrations(this.db as any)
    const executed = await this.getExecutedMigrations()

    const targetIndex = this.migrations.findIndex(m => m.name === targetName)
    if (targetIndex === -1) {
      throw new NotFoundError('Migration', { name: targetName })
    }

    const migrationsToRun = this.migrations.slice(0, targetIndex + 1)

    if (this.runnerOptions.dryRun) {
      this.logger.info('DRY RUN - No changes will be made')
    }

    for (const migration of migrationsToRun) {
      if (executed.includes(migration.name)) {
        this.logger.info(`${migration.name} (already executed)`)
        result.skipped.push(migration.name)
        continue
      }

      try {
        this.logger.info(`Running ${migration.name}...`)
        this.logMigrationMeta(migration)

        if (!this.runnerOptions.dryRun) {
          await this.executeMigration(migration, 'up')
          await this.markAsExecuted(migration.name)
        }

        this.logger.info(`${migration.name} completed`)
        result.executed.push(migration.name)
      } catch (error) {
        const errorMsg = formatError(error)
        this.logger.error(`${migration.name} failed: ${errorMsg}`)
        result.failed.push(migration.name)

        throw new MigrationError(
          `Migration ${migration.name} failed: ${errorMsg}`,
          migration.name,
          'up',
          error instanceof Error ? error : undefined
        )
      }
    }

    if (!this.runnerOptions.dryRun) {
      this.logger.info(`Migrated up to ${targetName}`)
    } else {
      this.logger.info(`Dry run completed - would migrate up to ${targetName}`)
    }

    result.duration = Date.now() - startTime
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

  /**
   * Run all pending migrations with plugin hooks
   * Overrides parent to call beforeMigration/afterMigration/onMigrationError hooks
   */
  override async up(): Promise<MigrationResult> {
    const startTime = Date.now()
    const result: MigrationResult = {
      executed: [],
      skipped: [],
      failed: [],
      duration: 0,
      dryRun: this.runnerOptions.dryRun
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setupMigrations(this.db as any)
    const executed = await this.getExecutedMigrations()

    const pending = this.migrations.filter(m => !executed.includes(m.name))

    if (pending.length === 0) {
      this.logger.info('No pending migrations')
      result.skipped = executed
      result.duration = Date.now() - startTime
      return result
    }

    if (this.runnerOptions.dryRun) {
      this.logger.info('DRY RUN - No changes will be made')
    }

    for (const migration of this.migrations) {
      if (executed.includes(migration.name)) {
        this.logger.info(`${migration.name} (already executed)`)
        result.skipped.push(migration.name)
        continue
      }

      const migrationStartTime = Date.now()

      try {
        // Call beforeMigration hooks
        await this.runBeforeHooks(migration, 'up')

        this.logger.info(`Running ${migration.name}...`)
        this.logMigrationMeta(migration)

        if (!this.runnerOptions.dryRun) {
          await this.executeMigration(migration, 'up')
          await this.markAsExecuted(migration.name)
        }

        const migrationDuration = Date.now() - migrationStartTime

        // Call afterMigration hooks
        await this.runAfterHooks(migration, 'up', migrationDuration)

        this.logger.info(`${migration.name} completed`)
        result.executed.push(migration.name)
      } catch (error) {
        // Call onMigrationError hooks
        await this.runErrorHooks(migration, 'up', error)

        const errorMsg = formatError(error)
        this.logger.error(`${migration.name} failed: ${errorMsg}`)
        result.failed.push(migration.name)

        if (this.runnerOptions.stopOnError) {
          throw new MigrationError(
            `Migration ${migration.name} failed: ${errorMsg}`,
            migration.name,
            'up',
            error instanceof Error ? error : undefined
          )
        }
      }
    }

    if (!this.runnerOptions.dryRun) {
      this.logger.info('All migrations completed successfully')
    } else {
      this.logger.info('Dry run completed - no changes made')
    }

    result.duration = Date.now() - startTime
    return result
  }

  /**
   * Rollback last N migrations with plugin hooks
   * Overrides parent to call beforeMigration/afterMigration/onMigrationError hooks
   */
  override async down(steps = 1): Promise<MigrationResult> {
    const startTime = Date.now()
    const result: MigrationResult = {
      executed: [],
      skipped: [],
      failed: [],
      duration: 0,
      dryRun: this.runnerOptions.dryRun
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setupMigrations(this.db as any)
    const executed = await this.getExecutedMigrations()

    if (executed.length === 0) {
      this.logger.warn('No executed migrations to rollback')
      result.duration = Date.now() - startTime
      return result
    }

    const toRollback = executed.slice(-steps).reverse()

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

      const migrationStartTime = Date.now()

      try {
        // Call beforeMigration hooks
        await this.runBeforeHooks(migration, 'down')

        this.logger.info(`Rolling back ${name}...`)
        this.logMigrationMeta(migration)

        if (!this.runnerOptions.dryRun) {
          await this.executeMigration(migration, 'down')
          await this.markAsRolledBack(name)
        }

        const migrationDuration = Date.now() - migrationStartTime

        // Call afterMigration hooks
        await this.runAfterHooks(migration, 'down', migrationDuration)

        this.logger.info(`${name} rolled back`)
        result.executed.push(name)
      } catch (error) {
        // Call onMigrationError hooks
        await this.runErrorHooks(migration, 'down', error)

        const errorMsg = formatError(error)
        this.logger.error(`${name} rollback failed: ${errorMsg}`)
        result.failed.push(name)

        if (this.runnerOptions.stopOnError) {
          throw new MigrationError(
            `Rollback of ${name} failed: ${errorMsg}`,
            name,
            'down',
            error instanceof Error ? error : undefined
          )
        }
      }
    }

    if (!this.runnerOptions.dryRun) {
      this.logger.info('Rollback completed successfully')
    } else {
      this.logger.info('Dry run completed - no changes made')
    }

    result.duration = Date.now() - startTime
    return result
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
      logger.info(`Completed ${operation} for ${migration.name} in ${duration}ms`)
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
