/**
 * Basic usage example for @kysera/migrations
 *
 * This example demonstrates:
 * - Creating migrations with up/down functions
 * - Running migrations sequentially
 * - Rolling back migrations
 * - Checking migration status
 * - Using dry-run mode
 * - Migration plugins
 */

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import {
  createMigrationRunner,
  createMigration,
  defineMigrations,
  runMigrations,
  rollbackMigrations,
  loggingPlugin,
  metricsPlugin,
} from '@kysera/migrations';

// ============================================================================
// 1. Create Database Connection
// ============================================================================

const db = new Kysely<any>({
  dialect: new PostgresDialect({
    pool: new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'myapp',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    }),
  }),
});

// ============================================================================
// 2. Define Migrations (Traditional Approach)
// ============================================================================

/**
 * Migration 001: Create users table
 */
const migration001 = createMigration(
  '001_create_users_table',
  // UP: Apply migration
  async (db) => {
    await db.schema
      .createTable('users')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .execute();

    console.log('✓ Created users table');
  },
  // DOWN: Rollback migration
  async (db) => {
    await db.schema.dropTable('users').execute();
    console.log('✓ Dropped users table');
  }
);

/**
 * Migration 002: Create posts table with foreign key
 */
const migration002 = createMigration(
  '002_create_posts_table',
  async (db) => {
    await db.schema
      .createTable('posts')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('title', 'varchar(255)', (col) => col.notNull())
      .addColumn('content', 'text', (col) => col.notNull())
      .addColumn('published', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .execute();

    console.log('✓ Created posts table');
  },
  async (db) => {
    await db.schema.dropTable('posts').execute();
    console.log('✓ Dropped posts table');
  }
);

/**
 * Migration 003: Add indexes for performance
 */
const migration003 = createMigration(
  '003_add_indexes',
  async (db) => {
    await db.schema.createIndex('idx_posts_user_id').on('posts').column('user_id').execute();

    await db.schema.createIndex('idx_posts_published').on('posts').column('published').execute();

    console.log('✓ Created indexes');
  },
  async (db) => {
    await db.schema.dropIndex('idx_posts_published').execute();
    await db.schema.dropIndex('idx_posts_user_id').execute();
    console.log('✓ Dropped indexes');
  }
);

// ============================================================================
// 3. Define Migrations (Object-Based Approach - v0.5.0+)
// ============================================================================

/**
 * Modern migration definition with metadata
 */
const modernMigrations = defineMigrations({
  '001_create_users_table': {
    description: 'Create users table with email and name',
    breaking: false,
    tags: ['schema', 'users'],
    up: async (db) => {
      await db.schema
        .createTable('users')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
        .addColumn('name', 'varchar(255)', (col) => col.notNull())
        .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
        .execute();
    },
    down: async (db) => {
      await db.schema.dropTable('users').execute();
    },
  },

  '002_create_posts_table': {
    description: 'Create posts table with user relationship',
    breaking: false,
    tags: ['schema', 'posts'],
    up: async (db) => {
      await db.schema
        .createTable('posts')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id').onDelete('cascade'))
        .addColumn('title', 'varchar(255)', (col) => col.notNull())
        .addColumn('content', 'text')
        .execute();
    },
    down: async (db) => {
      await db.schema.dropTable('posts').execute();
    },
  },
});

// ============================================================================
// 4. Basic Migration Runner
// ============================================================================

async function basicMigrationExample() {
  console.log('=== Basic Migration Runner ===\n');

  // Create migration runner
  const runner = createMigrationRunner({
    db,
    migrations: [migration001, migration002, migration003],
    migrationsTable: 'kysera_migrations', // Custom table name (optional)
  });

  // Check current status
  console.log('1. Checking migration status...');
  const status = await runner.getStatus();
  console.log(`Executed: ${status.executed.length}`);
  console.log(`Pending: ${status.pending.length}`);
  console.log();

  // Run all pending migrations
  console.log('2. Running all pending migrations...');
  const results = await runner.up();
  console.log(`Applied ${results.length} migrations:`);
  results.forEach((result) => {
    console.log(`  ✓ ${result.name} (${result.executedAt})`);
  });
  console.log();

  // Check status again
  console.log('3. Checking status after migrations...');
  const newStatus = await runner.getStatus();
  console.log(`Executed: ${newStatus.executed.length}`);
  console.log(`Pending: ${newStatus.pending.length}`);
  console.log();
}

// ============================================================================
// 5. Rollback Examples
// ============================================================================

async function rollbackExample() {
  console.log('=== Rollback Examples ===\n');

  const runner = createMigrationRunner({
    db,
    migrations: [migration001, migration002, migration003],
  });

  // Rollback last migration
  console.log('1. Rolling back last migration...');
  const rollbackResults = await runner.down();
  if (rollbackResults.length > 0) {
    console.log(`✓ Rolled back: ${rollbackResults[0].name}`);
  } else {
    console.log('No migrations to rollback');
  }
  console.log();

  // Rollback multiple migrations
  console.log('2. Rolling back 2 migrations...');
  const multipleRollback = await runner.down(2);
  console.log(`✓ Rolled back ${multipleRollback.length} migrations`);
  console.log();

  // Re-run migrations
  console.log('3. Re-running migrations...');
  await runner.up();
  console.log('✓ Migrations re-applied');
  console.log();
}

// ============================================================================
// 6. Dry Run Mode
// ============================================================================

async function dryRunExample() {
  console.log('=== Dry Run Mode ===\n');

  const runner = createMigrationRunner({
    db,
    migrations: [migration001, migration002, migration003],
  });

  // Run migrations in dry-run mode (preview only)
  console.log('1. Dry run - preview migrations without executing...');
  const dryRunResults = await runner.up({ dryRun: true });
  console.log(`Would apply ${dryRunResults.length} migrations:`);
  dryRunResults.forEach((result) => {
    console.log(`  • ${result.name}`);
  });
  console.log('(No changes made to database)');
  console.log();

  // Dry run rollback
  console.log('2. Dry run - preview rollback...');
  const dryRollback = await runner.down(1, { dryRun: true });
  if (dryRollback.length > 0) {
    console.log(`Would rollback: ${dryRollback[0].name}`);
  }
  console.log('(No changes made to database)');
  console.log();
}

// ============================================================================
// 7. Partial Migration (Run to Specific Version)
// ============================================================================

async function partialMigrationExample() {
  console.log('=== Partial Migration ===\n');

  const runner = createMigrationRunner({
    db,
    migrations: [migration001, migration002, migration003],
  });

  // First, rollback all migrations
  console.log('1. Resetting database...');
  await runner.down(999); // Rollback all
  console.log();

  // Run migrations up to specific version
  console.log('2. Running migrations up to 002_create_posts_table...');
  const results = await runner.upTo('002_create_posts_table');
  console.log(`Applied ${results.length} migrations:`);
  results.forEach((result) => {
    console.log(`  ✓ ${result.name}`);
  });
  console.log();

  // Check status
  const status = await runner.getStatus();
  console.log(`3. Status: ${status.executed.length} executed, ${status.pending.length} pending`);
  console.log();
}

// ============================================================================
// 8. Migration Plugins
// ============================================================================

async function pluginExample() {
  console.log('=== Migration Plugins ===\n');

  // Create runner with logging plugin
  console.log('1. Using logging plugin...');
  const runnerWithLogging = createMigrationRunner({
    db,
    migrations: [migration001, migration002],
    plugins: [
      loggingPlugin({
        logLevel: 'info',
        includeTimestamp: true,
      }),
    ],
  });

  await runnerWithLogging.down(999); // Reset
  await runnerWithLogging.up();
  console.log();

  // Create runner with metrics plugin
  console.log('2. Using metrics plugin...');
  const runnerWithMetrics = createMigrationRunner({
    db,
    migrations: [migration001, migration002],
    plugins: [
      metricsPlugin({
        onMetric: (metric) => {
          console.log(`[METRIC] ${metric.name}: ${metric.duration}ms (${metric.status})`);
        },
      }),
    ],
  });

  await runnerWithMetrics.down(999); // Reset
  await runnerWithMetrics.up();
  console.log();

  // Custom plugin
  console.log('3. Using custom plugin...');
  const customPlugin = {
    name: 'custom-plugin',
    beforeMigration: async (name: string) => {
      console.log(`[CUSTOM] Starting migration: ${name}`);
    },
    afterMigration: async (name: string, success: boolean, duration: number) => {
      console.log(`[CUSTOM] Finished ${name}: ${success ? 'SUCCESS' : 'FAILED'} (${duration}ms)`);
    },
  };

  const runnerWithCustom = createMigrationRunner({
    db,
    migrations: [migration001],
    plugins: [customPlugin],
  });

  await runnerWithCustom.down(999); // Reset
  await runnerWithCustom.up();
  console.log();
}

// ============================================================================
// 9. One-Liner API (v0.5.0+)
// ============================================================================

async function oneLinerExample() {
  console.log('=== One-Liner API ===\n');

  // Run all pending migrations (one-liner)
  console.log('1. Running migrations with one-liner...');
  await runMigrations({
    db,
    migrations: modernMigrations,
    plugins: [loggingPlugin()],
  });
  console.log();

  // Rollback with one-liner
  console.log('2. Rolling back with one-liner...');
  await rollbackMigrations({
    db,
    migrations: modernMigrations,
    count: 1,
  });
  console.log();
}

// ============================================================================
// 10. Error Handling
// ============================================================================

async function errorHandlingExample() {
  console.log('=== Error Handling ===\n');

  // Create a migration that will fail
  const failingMigration = createMigration(
    '999_failing_migration',
    async (db) => {
      // This will fail - table doesn't exist
      await db.schema.alterTable('nonexistent_table').addColumn('test', 'varchar(255)').execute();
    },
    async (db) => {
      // Rollback
    }
  );

  const runner = createMigrationRunner({
    db,
    migrations: [failingMigration],
  });

  try {
    console.log('1. Running failing migration...');
    await runner.up();
  } catch (error) {
    if (error instanceof Error) {
      console.error('✗ Migration failed:', error.message);
      console.log('Error was caught and handled properly');
    }
  }
  console.log();
}

// ============================================================================
// 11. Transaction Support
// ============================================================================

async function transactionExample() {
  console.log('=== Transaction Support ===\n');

  const transactionMigration = createMigration(
    '004_transactional_migration',
    async (db) => {
      // All these operations happen in a transaction
      // If any fails, all rollback
      await db.schema
        .createTable('comments')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('post_id', 'integer', (col) => col.notNull())
        .addColumn('content', 'text', (col) => col.notNull())
        .execute();

      console.log('✓ Created comments table (in transaction)');
    },
    async (db) => {
      await db.schema.dropTable('comments').execute();
    }
  );

  const runner = createMigrationRunner({
    db,
    migrations: [transactionMigration],
    // Each migration runs in its own transaction by default
  });

  console.log('1. Running migration with transaction support...');
  await runner.up();
  console.log('✓ Migration completed successfully');
  console.log();
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  try {
    console.log('Kysera Migrations - Basic Usage Examples\n');
    console.log('==========================================\n');

    // Run examples
    await basicMigrationExample();
    await rollbackExample();
    await dryRunExample();
    await partialMigrationExample();
    await pluginExample();
    await oneLinerExample();
    await errorHandlingExample();
    await transactionExample();

    console.log('==========================================');
    console.log('All examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
  } finally {
    // Clean up
    await db.destroy();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main, db, migration001, migration002, migration003, modernMigrations };
