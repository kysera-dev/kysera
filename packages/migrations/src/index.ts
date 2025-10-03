import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Migration interface
 */
export interface Migration {
  /** Unique migration name (e.g., '001_create_users') */
  name: string
  /** Migration up function - creates/modifies schema */
  up: (db: Kysely<any>) => Promise<void>
  /** Optional migration down function - reverts changes */
  down?: (db: Kysely<any>) => Promise<void>
}

/**
 * Migration metadata for tracking purposes
 */
export interface MigrationWithMeta extends Migration {
  /** Human-readable description */
  description?: string
  /** Whether this is a breaking change */
  breaking?: boolean
  /** Estimated duration in milliseconds */
  estimatedDuration?: number
}

/**
 * Migration status result
 */
export interface MigrationStatus {
  /** List of executed migration names */
  executed: string[]
  /** List of pending migration names */
  pending: string[]
}

/**
 * Migration runner options
 */
export interface MigrationRunnerOptions {
  /** Enable dry run mode (don't execute, just show what would run) */
  dryRun?: boolean
  /** Logger function */
  logger?: (message: string) => void
}

/**
 * Setup migrations table in database
 */
export async function setupMigrations(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('migrations')
    .ifNotExists()
    .addColumn('name', 'varchar(255)', col => col.primaryKey())
    .addColumn('executed_at', 'timestamp', col =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()
}

/**
 * Migration runner with state tracking
 */
export class MigrationRunner {
  private logger: (message: string) => void

  constructor(
    private db: Kysely<any>,
    private migrations: Migration[],
    private options: MigrationRunnerOptions = {}
  ) {
    this.logger = options.logger || console.log
  }

  /**
   * Get list of executed migrations from database
   */
  async getExecutedMigrations(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('migrations' as any)
      .select('name' as any)
      .orderBy('executed_at' as any, 'asc')
      .execute()

    return rows.map((r: any) => r.name)
  }

  /**
   * Mark a migration as executed
   */
  async markAsExecuted(name: string): Promise<void> {
    await this.db
      .insertInto('migrations' as any)
      .values({ name } as any)
      .execute()
  }

  /**
   * Mark a migration as rolled back (remove from executed list)
   */
  async markAsRolledBack(name: string): Promise<void> {
    await this.db
      .deleteFrom('migrations' as any)
      .where('name' as any, '=', name)
      .execute()
  }

  /**
   * Run all pending migrations
   */
  async up(): Promise<void> {
    await setupMigrations(this.db)
    const executed = await this.getExecutedMigrations()

    const pending = this.migrations.filter(m => !executed.includes(m.name))

    if (pending.length === 0) {
      this.logger('✅ No pending migrations')
      return
    }

    if (this.options.dryRun) {
      this.logger('\n🔍 DRY RUN - No changes will be made\n')
    }

    for (const migration of this.migrations) {
      if (executed.includes(migration.name)) {
        this.logger(`✓ ${migration.name} (already executed)`)
        continue
      }

      try {
        this.logger(`↑ Running ${migration.name}...`)

        if (!this.options.dryRun) {
          await migration.up(this.db)
          await this.markAsExecuted(migration.name)
        }

        this.logger(`✓ ${migration.name} completed`)
      } catch (error) {
        this.logger(`✗ ${migration.name} failed: ${error}`)
        throw error
      }
    }

    if (!this.options.dryRun) {
      this.logger('\n✅ All migrations completed successfully')
    }
  }

  /**
   * Rollback last N migrations
   */
  async down(steps = 1): Promise<void> {
    const executed = await this.getExecutedMigrations()

    if (executed.length === 0) {
      this.logger('⚠️  No executed migrations to rollback')
      return
    }

    const toRollback = executed.slice(-steps).reverse()

    if (this.options.dryRun) {
      this.logger('\n🔍 DRY RUN - No changes will be made\n')
    }

    for (const name of toRollback) {
      const migration = this.migrations.find(m => m.name === name)

      if (!migration) {
        this.logger(`⚠️  Migration ${name} not found in codebase`)
        continue
      }

      if (!migration.down) {
        this.logger(`⚠️  Migration ${name} has no down method`)
        continue
      }

      try {
        this.logger(`↓ Rolling back ${name}...`)

        if (!this.options.dryRun) {
          await migration.down(this.db)
          await this.markAsRolledBack(name)
        }

        this.logger(`✓ ${name} rolled back`)
      } catch (error) {
        this.logger(`✗ ${name} rollback failed: ${error}`)
        throw error
      }
    }

    if (!this.options.dryRun) {
      this.logger('\n✅ Rollback completed successfully')
    }
  }

  /**
   * Show migration status
   */
  async status(): Promise<MigrationStatus> {
    await setupMigrations(this.db)
    const executed = await this.getExecutedMigrations()
    const pending = this.migrations
      .filter(m => !executed.includes(m.name))
      .map(m => m.name)

    this.logger('\n📊 Migration Status:')
    this.logger(`  ✅ Executed: ${executed.length}`)
    this.logger(`  ⏳ Pending: ${pending.length}`)

    if (executed.length > 0) {
      this.logger('\nExecuted migrations:')
      executed.forEach(name => { this.logger(`  ✓ ${name}`); })
    }

    if (pending.length > 0) {
      this.logger('\nPending migrations:')
      pending.forEach(name => { this.logger(`  - ${name}`); })
    }

    return { executed, pending }
  }

  /**
   * Reset all migrations (dangerous!)
   */
  async reset(): Promise<void> {
    if (this.options.dryRun) {
      this.logger('\n🔍 DRY RUN - Would rollback all migrations')
      return
    }

    const executed = await this.getExecutedMigrations()
    this.logger(`\n⚠️  Resetting ${executed.length} migrations...`)

    await this.down(executed.length)
    this.logger('\n✅ All migrations reset')
  }

  /**
   * Run migrations up to a specific migration (inclusive)
   */
  async upTo(targetName: string): Promise<void> {
    await setupMigrations(this.db)
    const executed = await this.getExecutedMigrations()

    const targetIndex = this.migrations.findIndex(m => m.name === targetName)
    if (targetIndex === -1) {
      throw new Error(`Migration ${targetName} not found`)
    }

    const migrationsToRun = this.migrations.slice(0, targetIndex + 1)

    for (const migration of migrationsToRun) {
      if (executed.includes(migration.name)) {
        this.logger(`✓ ${migration.name} (already executed)`)
        continue
      }

      try {
        this.logger(`↑ Running ${migration.name}...`)

        if (!this.options.dryRun) {
          await migration.up(this.db)
          await this.markAsExecuted(migration.name)
        }

        this.logger(`✓ ${migration.name} completed`)
      } catch (error) {
        this.logger(`✗ ${migration.name} failed: ${error}`)
        throw error
      }
    }

    this.logger(`\n✅ Migrated up to ${targetName}`)
  }
}

/**
 * Create a migration runner instance
 */
export function createMigrationRunner(
  db: Kysely<any>,
  migrations: Migration[],
  options?: MigrationRunnerOptions
): MigrationRunner {
  return new MigrationRunner(db, migrations, options)
}

/**
 * Helper to create a simple migration
 */
export function createMigration(
  name: string,
  up: (db: Kysely<any>) => Promise<void>,
  down?: (db: Kysely<any>) => Promise<void>
): Migration {
  const migration: Migration = { name, up }
  if (down !== undefined) {
    migration.down = down
  }
  return migration
}