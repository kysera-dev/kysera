import type { Kysely } from 'kysely'
import { existsSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prism } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError, isExpectedError, ValidationError } from '../../utils/errors.js'
import type { Database } from '../../utils/database.js'

export interface Migration {
  name: string
  timestamp: string
  up: (db: Kysely<Database>) => Promise<void>
  down: (db: Kysely<Database>) => Promise<void>
}

export interface MigrationFile {
  name: string
  path: string
  timestamp: string
}

export interface MigrationStatus {
  name: string
  timestamp: string
  /** Date on PostgreSQL/MySQL, string on SQLite */
  executedAt?: Date | string
  status: 'pending' | 'executed'
}

interface ExecutedMigrationRow {
  name: string
  timestamp: string
  executed_at: Date | string
  batch: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class MigrationRunner {
  private schemaDb: Kysely<Database>

  constructor(
    private db: Kysely<Database>,
    private migrationsDir: string,
    private tableName = 'migrations',
    private schema = 'public'
  ) {
    // Create schema-scoped database instance for PostgreSQL
    this.schemaDb = this.schema !== 'public' ? this.db.withSchema(this.schema) : this.db
  }

  /**
   * Get the fully qualified table name for the migration table
   */
  private get qualifiedTableName(): string {
    return this.schema !== 'public' ? `${this.schema}.${this.tableName}` : this.tableName
  }

  /**
   * Initialize migration table
   */
  async init(): Promise<void> {
    const { sql } = await import('kysely')
    // Create schema if it doesn't exist (PostgreSQL only)
    if (this.schema !== 'public') {
      try {
        await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(this.schema)}`.execute(this.db)
        logger.debug(`Ensured schema exists: ${this.schema}`)
      } catch (err) {
        // Schema creation might fail on non-PostgreSQL, ignore
        logger.debug(`Could not create schema (might not be PostgreSQL): ${errorMessage(err)}`)
      }
    }

    const hasTable = await this.schemaDb.schema
      .createTable(this.tableName)
      .ifNotExists()
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('name', 'varchar(255)', col => col.notNull().unique())
      .addColumn('timestamp', 'varchar(14)', col => col.notNull())
      .addColumn('executed_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('batch', 'integer', col => col.notNull())
      .execute()
      .then(() => true)
      .catch((err: unknown) => {
        // Table might already exist, that's fine
        if (errorMessage(err).includes('already exists')) {
          return false
        }
        throw err
      })

    if (hasTable) {
      logger.debug(`Created migration table: ${this.qualifiedTableName}`)
    }
  }

  /**
   * Get all migration files from directory
   */
  getMigrationFiles(): MigrationFile[] {
    if (!existsSync(this.migrationsDir)) {
      logger.debug(`Migration directory does not exist: ${this.migrationsDir}`)
      return []
    }

    try {
      const files = readdirSync(this.migrationsDir)
        .filter(file => file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.mjs'))
        .sort()

      return files.map(file => {
        const timestamp = file.substring(0, 14) // First 14 chars are timestamp
        return {
          name: basename(file, file.includes('.') ? file.substring(file.lastIndexOf('.')) : ''),
          path: join(this.migrationsDir, file),
          timestamp
        }
      })
    } catch (error) {
      logger.error(`Failed to read migration directory: ${errorMessage(error)}`)
      return []
    }
  }

  /**
   * Get executed migrations from database
   */
  async getExecutedMigrations(): Promise<ExecutedMigrationRow[]> {
    try {
      const migrations = await this.schemaDb
        .selectFrom(this.tableName)
        .selectAll()
        .orderBy('batch')
        .orderBy('executed_at')
        .execute()

      return migrations.map(m => ({
        name: m.name as string,
        timestamp: m.timestamp as string,
        executed_at: m.executed_at as Date | string,
        batch: m.batch as number
      }))
    } catch (error) {
      // Check if this is the expected "table doesn't exist" error (first migration run)
      if (isExpectedError(error, ['does not exist', 'no such table'])) {
        logger.debug(
          `Migration table "${this.tableName}" does not exist yet - will be created on first migration run`
        )
        return []
      }

      // Unexpected error - wrap and re-throw
      throw new CLIError(
        `Failed to query migrations table: ${errorMessage(error)}`,
        'DATABASE_ERROR',
        { tableName: this.tableName, originalError: errorMessage(error) },
        [
          'Ensure the database is accessible',
          'Check database permissions',
          'Verify database connection'
        ]
      )
    }
  }

  /**
   * Get migration status (pending vs executed)
   */
  async getMigrationStatus(): Promise<MigrationStatus[]> {
    const files = this.getMigrationFiles()
    const executed = await this.getExecutedMigrations()

    const executedMap = new Map(executed.map(m => [m.name, m]))

    return files.map(file => ({
      name: file.name,
      timestamp: file.timestamp,
      executedAt: executedMap.get(file.name)?.executed_at,
      status: executedMap.has(file.name) ? ('executed' as const) : ('pending' as const)
    }))
  }

  /**
   * Load a migration module
   */
  async loadMigration(file: MigrationFile): Promise<Migration> {
    try {
      const fileUrl = pathToFileURL(file.path).href
      const module = (await import(fileUrl)) as Record<string, unknown>

      if (typeof module.up !== 'function') {
        throw new ValidationError(`Invalid migration ${file.name}: must export an 'up' function`)
      }

      if (typeof module.down !== 'function') {
        throw new ValidationError(`Invalid migration ${file.name}: must export a 'down' function`)
      }

      return {
        name: file.name,
        timestamp: file.timestamp,
        up: module.up as Migration['up'],
        down: module.down as Migration['down']
      }
    } catch (error) {
      throw new CLIError(
        `Failed to load migration ${file.name}: ${errorMessage(error)}`,
        'MIGRATION_LOAD_ERROR'
      )
    }
  }

  /**
   * Run pending migrations up to a specific migration or steps
   */
  async up(
    options: {
      to?: string
      steps?: number
      dryRun?: boolean
      force?: boolean
      verbose?: boolean
    } = {}
  ): Promise<{ executed: string[]; duration: number }> {
    await this.init()

    const startTime = Date.now()
    const executed: string[] = []

    const status = await this.getMigrationStatus()
    let pending = status.filter(m => m.status === 'pending')

    // Apply filters
    if (options.to) {
      const toIndex = pending.findIndex(m => m.name === options.to)
      if (toIndex === -1) {
        throw new CLIError(`Migration ${options.to} not found`, 'MIGRATION_NOT_FOUND')
      }
      pending = pending.slice(0, toIndex + 1)
    }

    if (options.steps && options.steps > 0) {
      pending = pending.slice(0, options.steps)
    }

    if (pending.length === 0) {
      logger.info('No pending migrations')
      return { executed, duration: Date.now() - startTime }
    }

    // Get next batch number
    const lastBatch = await this.getLastBatch()
    const batch = lastBatch + 1

    logger.info('Running migrations')

    for (const migrationStatus of pending) {
      const file = this.getMigrationFiles().find(f => f.name === migrationStatus.name)

      if (!file) {
        throw new CLIError(`Migration file not found: ${migrationStatus.name}`, 'FILE_NOT_FOUND')
      }

      const migration = await this.loadMigration(file)

      if (options.dryRun) {
        logger.info(`[DRY RUN] Would run: ${migration.name}`)
        continue
      }

      const migrationStart = Date.now()

      try {
        if (options.verbose) {
          logger.debug(`Running migration: ${migration.name}`)
        }

        // Run migration in transaction
        await this.db.transaction().execute(async trx => {
          // Pass schema-aware transaction to migration
          const schemaAwareTrx = this.schema !== 'public' ? trx.withSchema(this.schema) : trx
          await migration.up(schemaAwareTrx)

          // Record migration in the schema-qualified table
          const migrationTrx = this.schema !== 'public' ? trx.withSchema(this.schema) : trx
          await migrationTrx
            .insertInto(this.tableName)
            .values({
              name: migration.name,
              timestamp: migration.timestamp,
              batch
            })
            .execute()
        })

        const duration = Date.now() - migrationStart
        logger.info(`${prism.green('↑')} ${migration.name}... ${prism.green('✓')} (${duration}ms)`)
        executed.push(migration.name)
      } catch (error) {
        const duration = Date.now() - migrationStart
        logger.error(`${prism.red('↑')} ${migration.name}... ${prism.red('✗')} (${duration}ms)`)
        const remaining = pending.slice(pending.indexOf(migrationStatus) + 1).map(m => m.name)
        throw new CLIError(
          `Migration ${migration.name} failed: ${errorMessage(error)}`,
          'MIGRATION_FAILED',
          { migration: migration.name, file: file.path, applied: executed, remaining },
          [
            `Failed migration file: ${file.path}`,
            executed.length > 0
              ? `${executed.length} migration(s) were applied before the failure: ${executed.join(', ')}`
              : 'No migrations were applied before the failure',
            remaining.length > 0
              ? `${remaining.length} migration(s) were not run: ${remaining.join(', ')}`
              : 'No further migrations were pending',
            `Fix the migration and re-run 'kysera migrate up'`
          ]
        )
      }
    }

    const duration = Date.now() - startTime
    return { executed, duration }
  }

  /**
   * Rollback migrations
   */
  async down(
    options: {
      to?: string
      steps?: number
      all?: boolean
      dryRun?: boolean
      verbose?: boolean
    } = {}
  ): Promise<{ rolledBack: string[]; duration: number }> {
    const startTime = Date.now()
    const rolledBack: string[] = []

    const executed = await this.getExecutedMigrations()
    if (executed.length === 0) {
      logger.info('No migrations to rollback')
      return { rolledBack, duration: Date.now() - startTime }
    }

    let toRollback: typeof executed

    if (options.all) {
      toRollback = [...executed].reverse()
    } else if (options.to) {
      const toIndex = executed.findIndex(m => m.name === options.to)
      if (toIndex === -1) {
        throw new CLIError(`Migration ${options.to} not found`, 'MIGRATION_NOT_FOUND')
      }
      toRollback = executed.slice(toIndex + 1).reverse()
    } else {
      const steps = options.steps ?? 1
      const lastBatch = await this.getLastBatch()
      toRollback = executed
        .filter(m => m.batch === lastBatch)
        .slice(-steps)
        .reverse()
    }

    if (toRollback.length === 0) {
      logger.info('No migrations to rollback')
      return { rolledBack, duration: Date.now() - startTime }
    }

    // Show message based on number of migrations
    if (options.steps === 1) {
      logger.info('Rolling back 1 migration')
    } else if (options.steps) {
      logger.info(`Rolling back ${options.steps} migration${options.steps > 1 ? 's' : ''}`)
    } else {
      logger.info('Rolling back')
    }

    for (const executedMigration of toRollback) {
      const file = this.getMigrationFiles().find(f => f.name === executedMigration.name)

      if (!file) {
        throw new CLIError(`Migration file not found: ${executedMigration.name}`, 'FILE_NOT_FOUND')
      }

      const migration = await this.loadMigration(file)

      if (options.dryRun) {
        logger.info(`[DRY RUN] Would rollback: ${migration.name}`)
        continue
      }

      const migrationStart = Date.now()

      try {
        if (options.verbose) {
          logger.debug(`Rolling back migration: ${migration.name}`)
        }

        // Run rollback in transaction
        await this.db.transaction().execute(async trx => {
          // Pass schema-aware transaction to migration
          const schemaAwareTrx = this.schema !== 'public' ? trx.withSchema(this.schema) : trx
          await migration.down(schemaAwareTrx)

          // Remove migration record from the schema-qualified table
          const migrationTrx = this.schema !== 'public' ? trx.withSchema(this.schema) : trx
          await migrationTrx.deleteFrom(this.tableName).where('name', '=', migration.name).execute()
        })

        const duration = Date.now() - migrationStart
        logger.info(`${prism.yellow('↓')} ${migration.name}... ${prism.green('✓')} (${duration}ms)`)
        rolledBack.push(migration.name)
      } catch (error) {
        const duration = Date.now() - migrationStart
        logger.error(`${prism.red('↓')} ${migration.name}... ${prism.red('✗')} (${duration}ms)`)
        const remaining = toRollback.slice(toRollback.indexOf(executedMigration) + 1).map(m => m.name)
        throw new CLIError(
          `Rollback of ${migration.name} failed: ${errorMessage(error)}`,
          'ROLLBACK_FAILED',
          { migration: migration.name, file: file.path, rolledBack, remaining },
          [
            `Failed migration file: ${file.path}`,
            rolledBack.length > 0
              ? `${rolledBack.length} migration(s) were rolled back before the failure: ${rolledBack.join(', ')}`
              : 'No migrations were rolled back before the failure',
            remaining.length > 0
              ? `${remaining.length} migration(s) remain applied: ${remaining.join(', ')}`
              : 'No further migrations were selected for rollback'
          ]
        )
      }
    }

    const duration = Date.now() - startTime
    return { rolledBack, duration }
  }

  /**
   * Reset all migrations
   */
  async reset(
    options: {
      force?: boolean
      seed?: boolean
    } = {}
  ): Promise<{ rolledBack: string[]; duration: number }> {
    return await this.down({ all: true, ...options })
  }

  /**
   * Get the last batch number
   */
  private async getLastBatch(): Promise<number> {
    try {
      const result = await this.schemaDb
        .selectFrom(this.tableName)
        .select(this.schemaDb.fn.max('batch').as('max_batch'))
        .executeTakeFirst()

      return Number((result as { max_batch?: unknown } | undefined)?.max_batch ?? 0)
    } catch {
      return 0
    }
  }

  /**
   * Lock migrations to prevent concurrent execution
   */
  async acquireLock(): Promise<() => Promise<void>> {
    // Simple implementation - in production, use database advisory locks
    const lockTableName = 'kysera_migration_lock'

    try {
      await this.schemaDb.insertInto(lockTableName).values({ id: 1, locked: true }).execute()
    } catch (error) {
      const message = errorMessage(error)
      if (message.includes('already exists') || message.includes('duplicate')) {
        throw new CLIError('Migrations are already running in another process', 'MIGRATION_LOCKED')
      }
      // Lock table doesn't exist, create it
      await this.schemaDb.schema
        .createTable(lockTableName)
        .ifNotExists()
        .addColumn('id', 'integer', col => col.primaryKey())
        .addColumn('locked', 'boolean', col => col.notNull())
        .execute()

      await this.schemaDb.insertInto(lockTableName).values({ id: 1, locked: true }).execute()
    }

    // Lock is held once either insert above succeeded
    return async () => {
      await this.schemaDb.deleteFrom(lockTableName).where('id', '=', 1).execute()
    }
  }
}
