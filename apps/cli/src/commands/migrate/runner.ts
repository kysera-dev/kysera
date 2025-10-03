import { Kysely, sql } from 'kysely'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prism } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'

export interface Migration {
  name: string
  timestamp: string
  up: (db: Kysely<any>) => Promise<void>
  down: (db: Kysely<any>) => Promise<void>
}

export interface MigrationFile {
  name: string
  path: string
  timestamp: string
}

export interface MigrationStatus {
  name: string
  timestamp: string
  executedAt?: Date
  status: 'pending' | 'executed'
}

export class MigrationRunner {
  constructor(
    private db: Kysely<any>,
    private migrationsDir: string,
    private tableName: string = 'kysera_migrations'
  ) {}

  /**
   * Initialize migration table
   */
  async init(): Promise<void> {
    const hasTable = await this.db.schema
      .createTable(this.tableName)
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar(255)', (col) => col.notNull().unique())
      .addColumn('timestamp', 'varchar(14)', (col) => col.notNull())
      .addColumn('executed_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('batch', 'integer', (col) => col.notNull())
      .execute()
      .then(() => true)
      .catch((err) => {
        // Table might already exist, that's fine
        if (err.message.includes('already exists')) {
          return false
        }
        throw err
      })

    if (hasTable) {
      logger.debug(`Created migration table: ${this.tableName}`)
    }
  }

  /**
   * Get all migration files from directory
   */
  async getMigrationFiles(): Promise<MigrationFile[]> {
    if (!existsSync(this.migrationsDir)) {
      logger.warn(`Migration directory does not exist: ${this.migrationsDir}`)
      return []
    }

    try {
      const files = readdirSync(this.migrationsDir)
        .filter(file => file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.mjs'))
        .sort()

      // Ensure files is an array before using map
      if (!files || !Array.isArray(files)) {
        logger.debug('No migration files found or files is not an array')
        return []
      }

      return files.map(file => {
        const timestamp = file.substring(0, 14) // First 14 chars are timestamp
        return {
          name: basename(file, file.includes('.') ? file.substring(file.lastIndexOf('.')) : ''),
          path: join(this.migrationsDir, file),
          timestamp
        }
      })
    } catch (error) {
      logger.error(`Failed to read migration directory: ${error}`)
      return []
    }
  }

  /**
   * Get executed migrations from database
   */
  async getExecutedMigrations(): Promise<Array<{ name: string; timestamp: string; executed_at: Date; batch: number }>> {
    try {
      const migrations = await this.db
        .selectFrom(this.tableName)
        .selectAll()
        .orderBy('batch')
        .orderBy('executed_at')
        .execute()

      // Ensure migrations is an array before using map
      if (!migrations || !Array.isArray(migrations)) {
        logger.debug('No migrations found in database or migrations is not an array:', migrations)
        return []
      }

      return migrations.map((m: any) => ({
        name: m.name,
        timestamp: m.timestamp,
        executed_at: m.executed_at,
        batch: m.batch
      }))
    } catch (error: any) {
      // Table might not exist yet
      if (error.message.includes('does not exist') || error.message.includes('no such table')) {
        return []
      }
      throw error
    }
  }

  /**
   * Get migration status (pending vs executed)
   */
  async getMigrationStatus(): Promise<MigrationStatus[]> {
    try {
      const files = await this.getMigrationFiles()
      const executed = await this.getExecutedMigrations()

      if (!files || !Array.isArray(files)) {
        logger.debug('No migration files found')
        return []
      }

      if (!executed || !Array.isArray(executed)) {
        // No migrations have been executed yet
        return files.map(file => ({
          name: file.name,
          timestamp: file.timestamp,
          status: 'pending' as const
        }))
      }

      // Extra safety check before creating the Map
      if (!Array.isArray(executed)) {
        logger.error('executed is not an array:', executed)
        return files.map(file => ({
          name: file.name,
          timestamp: file.timestamp,
          status: 'pending' as const
        }))
      }

      const executedMap = new Map(executed.map(m => [m.name, m]))

      return files.map(file => ({
        name: file.name,
        timestamp: file.timestamp,
        executedAt: executedMap.get(file.name)?.executed_at,
        status: executedMap.has(file.name) ? 'executed' as const : 'pending' as const
      }))
    } catch (error) {
      logger.error('Error in getMigrationStatus:', error)
      throw error
    }
  }

  /**
   * Load a migration module
   */
  async loadMigration(file: MigrationFile): Promise<Migration> {
    try {
      const fileUrl = pathToFileURL(file.path).href
      const module = await import(fileUrl)

      if (!module.up || typeof module.up !== 'function') {
        throw new Error(`Invalid migration ${file.name}: must export an 'up' function`)
      }

      if (!module.down || typeof module.down !== 'function') {
        throw new Error(`Invalid migration ${file.name}: must export a 'down' function`)
      }

      return {
        name: file.name,
        timestamp: file.timestamp,
        up: module.up,
        down: module.down
      }
    } catch (error: any) {
      throw new CLIError(
        `Failed to load migration ${file.name}: ${error.message}`,
        'MIGRATION_LOAD_ERROR'
      )
    }
  }

  /**
   * Run pending migrations up to a specific migration or steps
   */
  async up(options: {
    to?: string
    steps?: number
    dryRun?: boolean
    force?: boolean
    verbose?: boolean
  } = {}): Promise<{ executed: string[]; duration: number }> {
    await this.init()

    const startTime = Date.now()
    const executed: string[] = []

    const status = await this.getMigrationStatus()
    if (!status || !Array.isArray(status)) {
      logger.warn('getMigrationStatus returned invalid data:', status)
      return { executed, duration: Date.now() - startTime }
    }

    let pending = status.filter(m => m && m.status === 'pending')

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
      const file = await this.getMigrationFiles().then(files =>
        files.find(f => f.name === migrationStatus.name)
      )

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
        await this.db.transaction().execute(async (trx) => {
          await migration.up(trx)

          // Record migration
          await trx
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

      } catch (error: any) {
        const duration = Date.now() - migrationStart
        logger.error(`${prism.red('↑')} ${migration.name}... ${prism.red('✗')} (${duration}ms)`)
        throw new CLIError(
          `Migration ${migration.name} failed: ${error.message}`,
          'MIGRATION_FAILED'
        )
      }
    }

    const duration = Date.now() - startTime
    return { executed, duration }
  }

  /**
   * Rollback migrations
   */
  async down(options: {
    to?: string
    steps?: number
    all?: boolean
    dryRun?: boolean
    verbose?: boolean
  } = {}): Promise<{ rolledBack: string[]; duration: number }> {
    const startTime = Date.now()
    const rolledBack: string[] = []

    const executed = await this.getExecutedMigrations()
    if (executed.length === 0) {
      logger.info('No migrations to rollback')
      return { rolledBack, duration: Date.now() - startTime }
    }

    let toRollback: typeof executed = []

    if (options.all) {
      toRollback = [...executed].reverse()
    } else if (options.to) {
      const toIndex = executed.findIndex(m => m.name === options.to)
      if (toIndex === -1) {
        throw new CLIError(`Migration ${options.to} not found`, 'MIGRATION_NOT_FOUND')
      }
      toRollback = executed.slice(toIndex + 1).reverse()
    } else {
      const steps = options.steps || 1
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
    if (options.steps && options.steps === 1) {
      logger.info('Rolling back 1 migration')
    } else if (options.steps) {
      logger.info(`Rolling back ${options.steps} migration${options.steps > 1 ? 's' : ''}`)
    } else {
      logger.info('Rolling back')
    }

    for (const executedMigration of toRollback) {
      const file = await this.getMigrationFiles().then(files =>
        files.find(f => f.name === executedMigration.name)
      )

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
        await this.db.transaction().execute(async (trx) => {
          await migration.down(trx)

          // Remove migration record
          await trx
            .deleteFrom(this.tableName)
            .where('name', '=', migration.name)
            .execute()
        })

        const duration = Date.now() - migrationStart
        logger.info(`${prism.yellow('↓')} ${migration.name}... ${prism.green('✓')} (${duration}ms)`)
        rolledBack.push(migration.name)

      } catch (error: any) {
        const duration = Date.now() - migrationStart
        logger.error(`${prism.red('↓')} ${migration.name}... ${prism.red('✗')} (${duration}ms)`)
        throw new CLIError(
          `Rollback of ${migration.name} failed: ${error.message}`,
          'ROLLBACK_FAILED'
        )
      }
    }

    const duration = Date.now() - startTime
    return { rolledBack, duration }
  }

  /**
   * Reset all migrations
   */
  async reset(options: {
    force?: boolean
    seed?: boolean
  } = {}): Promise<{ rolledBack: string[]; duration: number }> {
    return this.down({ all: true, ...options })
  }

  /**
   * Get the last batch number
   */
  private async getLastBatch(): Promise<number> {
    try {
      const result = await this.db
        .selectFrom(this.tableName)
        .select(this.db.fn.max('batch').as('max_batch'))
        .executeTakeFirst()

      return (result as any)?.max_batch || 0
    } catch {
      return 0
    }
  }

  /**
   * Lock migrations to prevent concurrent execution
   */
  async acquireLock(): Promise<() => Promise<void>> {
    // Simple implementation - in production, use database advisory locks
    let lockAcquired = false

    try {
      await this.db
        .insertInto('kysera_migration_lock')
        .values({ id: 1, locked: true })
        .execute()
      lockAcquired = true
    } catch (error: any) {
      if (error.message.includes('already exists') || error.message.includes('duplicate')) {
        throw new CLIError(
          'Migrations are already running in another process',
          'MIGRATION_LOCKED'
        )
      }
      // Lock table doesn't exist, create it
      await this.db.schema
        .createTable('kysera_migration_lock')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey())
        .addColumn('locked', 'boolean', (col) => col.notNull())
        .execute()

      await this.db
        .insertInto('kysera_migration_lock')
        .values({ id: 1, locked: true })
        .execute()
      lockAcquired = true
    }

    return async () => {
      if (lockAcquired) {
        await this.db
          .deleteFrom('kysera_migration_lock')
          .where('id', '=', 1)
          .execute()
      }
    }
  }
}