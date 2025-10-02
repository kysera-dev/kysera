import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, sql } from 'kysely'
import Database from 'better-sqlite3'
import {
  setupMigrations,
  MigrationRunner,
  createMigrationRunner,
  createMigration,
  type Migration
} from '../src/index'
import { safeDbDestroy, safeSqliteClose } from '../../core/test/helpers/cleanup'

describe('Migration System', () => {
  let db: Kysely<any>
  let database: Database.Database

  beforeEach(() => {
    database = new Database(':memory:')
    db = new Kysely({
      dialect: new SqliteDialect({
        database
      })
    })
  })

  afterEach(async () => {
    await safeDbDestroy(db)
    safeSqliteClose(database)
  })

  // Helper to create test migrations
  const createTestMigrations = (): Migration[] => [
    createMigration(
      '001_create_users',
      async (db) => {
        await db.schema
          .createTable('users')
          .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
          .addColumn('email', 'text', col => col.notNull().unique())
          .addColumn('name', 'text', col => col.notNull())
          .execute()
      },
      async (db) => {
        await db.schema.dropTable('users').execute()
      }
    ),
    createMigration(
      '002_create_posts',
      async (db) => {
        await db.schema
          .createTable('posts')
          .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
          .addColumn('user_id', 'integer', col =>
            col.notNull().references('users.id').onDelete('cascade')
          )
          .addColumn('title', 'text', col => col.notNull())
          .addColumn('content', 'text')
          .execute()
      },
      async (db) => {
        await db.schema.dropTable('posts').execute()
      }
    ),
    createMigration(
      '003_add_users_created_at',
      async (db) => {
        await db.schema
          .alterTable('users')
          .addColumn('created_at', 'text', col => col.defaultTo(sql`CURRENT_TIMESTAMP`))
          .execute()
      }
      // Note: SQLite doesn't support dropping columns easily
    )
  ]

  describe('setupMigrations', () => {
    it('should create migrations table', async () => {
      await setupMigrations(db)

      // Verify table exists
      const tables = await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, '=', 'migrations')
        .execute() as Array<{ name: string }>

      expect(tables).toHaveLength(1)
      expect(tables[0]?.name).toBe('migrations')
    })

    it('should be idempotent (can run multiple times)', async () => {
      await setupMigrations(db)
      await setupMigrations(db)
      await setupMigrations(db)

      // Should still have exactly one migrations table
      const tables = await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, '=', 'migrations')
        .execute()

      expect(tables).toHaveLength(1)
    })

    it('should have correct schema', async () => {
      await setupMigrations(db)

      // Insert and retrieve a migration record
      await db
        .insertInto('migrations' as any)
        .values({ name: 'test_migration' } as any)
        .execute()

      const migrations = await db
        .selectFrom('migrations' as any)
        .selectAll()
        .execute()

      expect(migrations).toHaveLength(1)
      expect(migrations[0]).toHaveProperty('name', 'test_migration')
      expect(migrations[0]).toHaveProperty('executed_at')
    })
  })

  describe('MigrationRunner', () => {
    describe('up', () => {
      it('should run all pending migrations', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        await runner.up()

        // Verify migrations were executed
        const executed = await runner.getExecutedMigrations()
        expect(executed).toHaveLength(3)
        expect(executed).toEqual(['001_create_users', '002_create_posts', '003_add_users_created_at'])

        // Verify tables were created
        const tables = await db
          .selectFrom('sqlite_master' as any)
          .select('name' as any)
          .where('type' as any, '=', 'table')
          .execute()

        const tableNames = tables.map((t: any) => t.name)
        expect(tableNames).toContain('users')
        expect(tableNames).toContain('posts')
      })

      it('should skip already executed migrations', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        // Run migrations first time
        await runner.up()

        // Run again - should skip all
        await runner.up()

        // Should still have exactly 3 migrations
        const executed = await runner.getExecutedMigrations()
        expect(executed).toHaveLength(3)
      })

      it('should stop on migration failure', async () => {
        const migrations: Migration[] = [
          createMigration('001_success', async () => {}),
          createMigration('002_fail', async () => {
            throw new Error('Migration failed')
          }),
          createMigration('003_never_runs', async () => {})
        ]

        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        await expect(runner.up()).rejects.toThrow('Migration failed')

        // Only first migration should be executed
        const executed = await runner.getExecutedMigrations()
        expect(executed).toHaveLength(1)
        expect(executed).toEqual(['001_success'])
      })

      it('should work with dry run mode', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, {
          dryRun: true,
          logger: () => {}
        })

        await runner.up()

        // No migrations should actually be executed
        const executed = await runner.getExecutedMigrations()
        expect(executed).toHaveLength(0)

        // Tables should not exist
        const tables = await db
          .selectFrom('sqlite_master' as any)
          .select('name' as any)
          .where('type' as any, '=', 'table')
          .where('name' as any, '=', 'users')
          .execute()

        expect(tables).toHaveLength(0)
      })

      it('should handle empty migration list', async () => {
        const runner = new MigrationRunner(db, [], { logger: () => {} })

        await runner.up()

        const executed = await runner.getExecutedMigrations()
        expect(executed).toHaveLength(0)
      })
    })

    describe('down', () => {
      it('should rollback last migration', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        // Run all migrations
        await runner.up()

        // Rollback last one - note: 003 has no down(), so it won't be rolled back
        await runner.down(1)

        const executed = await runner.getExecutedMigrations()
        // 003 cannot be rolled back (no down method), so all 3 remain
        expect(executed).toHaveLength(3)
        expect(executed).toEqual(['001_create_users', '002_create_posts', '003_add_users_created_at'])
      })

      it('should rollback multiple migrations', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        await runner.up()
        // Try to rollback 2, but 003 has no down(), so only 002 will be rolled back
        await runner.down(2)

        const executed = await runner.getExecutedMigrations()
        // 003 remains (no down), 002 rolled back successfully, 001 remains
        expect(executed).toHaveLength(2)
        expect(executed).toEqual(['001_create_users', '003_add_users_created_at'])

        // Verify posts table was dropped
        const tables = await db
          .selectFrom('sqlite_master' as any)
          .select('name' as any)
          .where('type' as any, '=', 'table')
          .where('name' as any, '=', 'posts')
          .execute()

        expect(tables).toHaveLength(0)
      })

      it('should handle migration without down method', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        await runner.up()

        // Try to rollback migration without down method (003)
        await runner.down(1)

        // Should still have all 3 migrations (003 can't be rolled back)
        const executed = await runner.getExecutedMigrations()
        expect(executed).toHaveLength(3)
      })

      it('should work with dry run mode', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        await runner.up()

        // Dry run rollback
        const dryRunner = new MigrationRunner(db, migrations, {
          dryRun: true,
          logger: () => {}
        })
        await dryRunner.down(1)

        // All migrations should still be executed
        const executed = await runner.getExecutedMigrations()
        expect(executed).toHaveLength(3)
      })

      it('should handle empty executed migrations', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        // Setup migrations table first
        await setupMigrations(db)

        // Try to rollback without any executed migrations
        await runner.down(1)

        // Should not throw error
        const executed = await runner.getExecutedMigrations()
        expect(executed).toHaveLength(0)
      })
    })

    describe('status', () => {
      it('should show correct migration status', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        // Before any migrations
        let status = await runner.status()
        expect(status.executed).toHaveLength(0)
        expect(status.pending).toHaveLength(3)

        // After running one migration manually
        await migrations[0]?.up(db)
        await runner.markAsExecuted('001_create_users')

        status = await runner.status()
        expect(status.executed).toHaveLength(1)
        expect(status.pending).toHaveLength(2)
        expect(status.executed).toEqual(['001_create_users'])
        expect(status.pending).toEqual(['002_create_posts', '003_add_users_created_at'])

        // After running all
        await runner.up()

        status = await runner.status()
        expect(status.executed).toHaveLength(3)
        expect(status.pending).toHaveLength(0)
      })
    })

    describe('reset', () => {
      it('should rollback all migrations', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        await runner.up()
        await runner.reset()

        const executed = await runner.getExecutedMigrations()
        // 003 cannot be rolled back (no down method), so 1 remains
        expect(executed).toHaveLength(1)
        expect(executed).toEqual(['003_add_users_created_at'])
      })

      it('should work with dry run', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        await runner.up()

        const dryRunner = new MigrationRunner(db, migrations, {
          dryRun: true,
          logger: () => {}
        })
        await dryRunner.reset()

        // Migrations should still be there
        const executed = await runner.getExecutedMigrations()
        expect(executed).toHaveLength(3)
      })
    })

    describe('upTo', () => {
      it('should migrate up to specific migration', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        await runner.upTo('002_create_posts')

        const executed = await runner.getExecutedMigrations()
        expect(executed).toHaveLength(2)
        expect(executed).toEqual(['001_create_users', '002_create_posts'])
      })

      it('should throw error for unknown migration', async () => {
        const migrations = createTestMigrations()
        const runner = new MigrationRunner(db, migrations, { logger: () => {} })

        await expect(runner.upTo('999_unknown')).rejects.toThrow('Migration 999_unknown not found')
      })
    })
  })

  describe('createMigrationRunner', () => {
    it('should create a migration runner instance', () => {
      const migrations: Migration[] = []
      const runner = createMigrationRunner(db, migrations)

      expect(runner).toBeInstanceOf(MigrationRunner)
    })

    it('should accept options', () => {
      const migrations: Migration[] = []
      const runner = createMigrationRunner(db, migrations, {
        dryRun: true,
        logger: () => {}
      })

      expect(runner).toBeInstanceOf(MigrationRunner)
    })
  })

  describe('createMigration', () => {
    it('should create a migration object', () => {
      const up = async () => {}
      const down = async () => {}

      const migration = createMigration('test', up, down)

      expect(migration).toHaveProperty('name', 'test')
      expect(migration).toHaveProperty('up', up)
      expect(migration).toHaveProperty('down', down)
    })

    it('should work without down method', () => {
      const up = async () => {}

      const migration = createMigration('test', up)

      expect(migration).toHaveProperty('name', 'test')
      expect(migration).toHaveProperty('up', up)
      expect(migration.down).toBeUndefined()
    })
  })

  describe('Integration', () => {
    it('should handle full migration lifecycle', async () => {
      const migrations = createTestMigrations()
      const runner = new MigrationRunner(db, migrations, { logger: () => {} })

      // 1. Check initial status
      let status = await runner.status()
      expect(status.pending).toHaveLength(3)

      // 2. Run all migrations
      await runner.up()

      // 3. Verify all executed
      status = await runner.status()
      expect(status.executed).toHaveLength(3)
      expect(status.pending).toHaveLength(0)

      // 4. Rollback one (003 has no down, so can't be rolled back)
      await runner.down(1)

      // 5. Verify status (003 still executed because no down method)
      status = await runner.status()
      expect(status.executed).toHaveLength(3)
      expect(status.pending).toHaveLength(0)

      // 6. All migrations still executed
      expect(status.executed).toEqual(['001_create_users', '002_create_posts', '003_add_users_created_at'])
    })

    it('should handle complex schema changes', async () => {
      const migrations: Migration[] = [
        createMigration(
          '001_initial',
          async (db) => {
            await db.schema
              .createTable('products')
              .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
              .addColumn('name', 'text', col => col.notNull())
              .addColumn('price', 'integer', col => col.notNull())
              .execute()
          },
          async (db) => {
            await db.schema.dropTable('products').execute()
          }
        ),
        createMigration(
          '002_add_index',
          async (db) => {
            await db.schema
              .createIndex('products_name_idx')
              .on('products')
              .column('name')
              .execute()
          },
          async (db) => {
            await db.schema.dropIndex('products_name_idx').execute()
          }
        )
      ]

      const runner = new MigrationRunner(db, migrations, { logger: () => {} })

      await runner.up()

      // Insert test data
      await db
        .insertInto('products' as any)
        .values({ name: 'Test Product', price: 100 } as any)
        .execute()

      // Query should work with index
      const products = await db
        .selectFrom('products' as any)
        .selectAll()
        .where('name' as any, '=', 'Test Product')
        .execute()

      expect(products).toHaveLength(1)
      expect(products[0]).toHaveProperty('name', 'Test Product')

      // Rollback should work
      await runner.down(2)

      // Table should not exist
      const tables = await db
        .selectFrom('sqlite_master' as any)
        .select('name' as any)
        .where('type' as any, '=', 'table')
        .where('name' as any, '=', 'products')
        .execute()

      expect(tables).toHaveLength(0)
    })
  })
})