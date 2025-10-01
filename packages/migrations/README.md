# @kysera/migrations

> Lightweight, type-safe database migration management for Kysera ORM with dry-run support and flexible rollback capabilities.

[![npm version](https://img.shields.io/npm/v/@kysera/migrations.svg)](https://www.npmjs.com/package/@kysera/migrations)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## 📦 Package Information

| Property | Value |
|----------|-------|
| **Package** | `@kysera/migrations` |
| **Version** | `0.3.0` |
| **Bundle Size** | 3.7 KB (minified) |
| **Dependencies** | None (peer: kysely) |
| **Test Coverage** | 24 tests, comprehensive |
| **Supported Databases** | PostgreSQL, MySQL, SQLite |
| **Type Safety** | ✅ Full TypeScript support |

## 🎯 Features

### Core Migration Management
- ✅ **Simple API** - Intuitive migration creation and execution
- ✅ **Type-safe** - Full TypeScript support with Kysely integration
- ✅ **State tracking** - Automatic migration history in database
- ✅ **Sequential execution** - Migrations run in order
- ✅ **Dry run mode** - Preview changes before execution

### Advanced Features
- ✅ **Rollback support** - Roll back one or multiple migrations
- ✅ **Partial migration** - Run up to specific migration
- ✅ **Status reporting** - View executed and pending migrations
- ✅ **Error handling** - Graceful failure with detailed logging
- ✅ **Idempotent setup** - Safe to run multiple times
- ✅ **Zero dependencies** - Only Kysely as peer dependency

## 📥 Installation

```bash
# pnpm (recommended)
pnpm add @kysera/migrations kysely

# npm
npm install @kysera/migrations kysely

# yarn
yarn add @kysera/migrations kysely

# bun
bun add @kysera/migrations kysely
```

## 🚀 Quick Start

### Basic Usage

```typescript
import { Kysely } from 'kysely'
import { createMigrationRunner, createMigration } from '@kysera/migrations'

// Define your migrations
const migrations = [
  createMigration(
    '001_create_users',
    async (db) => {
      await db.schema
        .createTable('users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('email', 'varchar(255)', col => col.notNull().unique())
        .addColumn('name', 'varchar(255)', col => col.notNull())
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
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('user_id', 'integer', col =>
          col.notNull().references('users.id').onDelete('cascade')
        )
        .addColumn('title', 'varchar(255)', col => col.notNull())
        .addColumn('content', 'text')
        .execute()
    },
    async (db) => {
      await db.schema.dropTable('posts').execute()
    }
  )
]

// Create migration runner
const db = new Kysely<Database>({ /* ... */ })
const runner = createMigrationRunner(db, migrations)

// Run all pending migrations
await runner.up()
// ✅ All migrations completed successfully

// Check status
await runner.status()
// 📊 Migration Status:
//   ✅ Executed: 2
//   ⏳ Pending: 0

// Rollback last migration
await runner.down(1)
// ✅ Rollback completed successfully
```

### Dry Run Mode

```typescript
// Preview what would happen without making changes
const runner = createMigrationRunner(db, migrations, {
  dryRun: true,
  logger: console.log
})

await runner.up()
// 🔍 DRY RUN - No changes will be made
// ↑ Running 001_create_users...
// ✓ 001_create_users completed
// ↑ Running 002_create_posts...
// ✓ 002_create_posts completed
```

## 📖 Table of Contents

- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Core Concepts](#-core-concepts)
  - [Migrations](#migrations)
  - [Migration Runner](#migration-runner)
  - [State Tracking](#state-tracking)
- [API Reference](#-api-reference)
  - [createMigration()](#createmigration)
  - [createMigrationRunner()](#createmigrationrunner)
  - [MigrationRunner Methods](#migrationrunner-methods)
  - [setupMigrations()](#setupmigrations)
- [Migration Lifecycle](#-migration-lifecycle)
- [Advanced Usage](#-advanced-usage)
  - [Partial Migrations](#partial-migrations)
  - [Custom Logger](#custom-logger)
  - [Migration Metadata](#migration-metadata)
  - [Complex Schema Changes](#complex-schema-changes)
- [Best Practices](#-best-practices)
- [Multi-Database Support](#-multi-database-support)
- [Troubleshooting](#-troubleshooting)
- [Examples](#-examples)

## 💡 Core Concepts

### Migrations

A migration represents a set of database schema changes that can be applied and (optionally) reverted:

```typescript
interface Migration {
  /** Unique migration name (e.g., '001_create_users') */
  name: string

  /** Migration up function - creates/modifies schema */
  up: (db: Kysely<any>) => Promise<void>

  /** Optional migration down function - reverts changes */
  down?: (db: Kysely<any>) => Promise<void>
}
```

**Key points:**
- **name**: Must be unique, typically versioned (001_, 002_, etc.)
- **up**: Required, contains schema changes
- **down**: Optional, should revert the up changes
- Migrations run sequentially in the order they appear in the array

### Migration Runner

The `MigrationRunner` class manages migration execution and state:

```typescript
class MigrationRunner {
  // Run all pending migrations
  async up(): Promise<void>

  // Rollback last N migrations
  async down(steps?: number): Promise<void>

  // Show migration status
  async status(): Promise<MigrationStatus>

  // Reset all migrations (rollback everything)
  async reset(): Promise<void>

  // Migrate up to specific migration
  async upTo(targetName: string): Promise<void>

  // Get list of executed migrations
  async getExecutedMigrations(): Promise<string[]>
}
```

### State Tracking

Migrations are tracked in a `migrations` table:

```sql
CREATE TABLE migrations (
  name VARCHAR(255) PRIMARY KEY,
  executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

This table is automatically created when you run migrations and stores which migrations have been executed.

## 📚 API Reference

### createMigration()

Create a migration object with up and optional down functions.

```typescript
function createMigration(
  name: string,
  up: (db: Kysely<any>) => Promise<void>,
  down?: (db: Kysely<any>) => Promise<void>
): Migration
```

**Parameters:**
- `name` - Unique migration identifier (e.g., '001_create_users')
- `up` - Function that applies the migration
- `down` - Optional function that reverts the migration

**Returns:** Migration object

**Example:**
```typescript
const migration = createMigration(
  '001_create_users',
  async (db) => {
    await db.schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('email', 'varchar(255)', col => col.notNull().unique())
      .execute()
  },
  async (db) => {
    await db.schema.dropTable('users').execute()
  }
)
```

### createMigrationRunner()

Create a MigrationRunner instance.

```typescript
function createMigrationRunner(
  db: Kysely<any>,
  migrations: Migration[],
  options?: MigrationRunnerOptions
): MigrationRunner
```

**Parameters:**
- `db` - Kysely database instance
- `migrations` - Array of migration objects
- `options` - Optional configuration

**Options:**
```typescript
interface MigrationRunnerOptions {
  /** Enable dry run mode (preview only, no changes) */
  dryRun?: boolean

  /** Custom logger function (default: console.log) */
  logger?: (message: string) => void
}
```

**Returns:** MigrationRunner instance

**Example:**
```typescript
const runner = createMigrationRunner(db, migrations, {
  dryRun: false,
  logger: (msg) => console.log(`[MIGRATION] ${msg}`)
})
```

### MigrationRunner Methods

#### up()

Run all pending migrations sequentially.

```typescript
async up(): Promise<void>
```

**Behavior:**
- Creates migrations table if it doesn't exist
- Gets list of already-executed migrations
- Runs only migrations that haven't been executed
- Marks each migration as executed after successful completion
- Stops on first error (does not mark failed migration as executed)

**Example:**
```typescript
await runner.up()
// Output:
// ✓ 001_create_users (already executed)
// ↑ Running 002_create_posts...
// ✓ 002_create_posts completed
// ✅ All migrations completed successfully
```

#### down()

Rollback the last N migrations.

```typescript
async down(steps?: number): Promise<void>
```

**Parameters:**
- `steps` - Number of migrations to rollback (default: 1)

**Behavior:**
- Gets list of executed migrations
- Selects last N migrations to rollback (in reverse order)
- Calls down() method for each migration
- Removes migration from executed list after successful rollback
- Skips migrations without down() method
- Stops on first error

**Example:**
```typescript
// Rollback last migration
await runner.down(1)

// Rollback last 3 migrations
await runner.down(3)
```

#### status()

Display current migration status.

```typescript
async status(): Promise<MigrationStatus>
```

**Returns:**
```typescript
interface MigrationStatus {
  /** List of executed migration names */
  executed: string[]

  /** List of pending migration names */
  pending: string[]
}
```

**Example:**
```typescript
const status = await runner.status()
console.log(`Executed: ${status.executed.length}`)
console.log(`Pending: ${status.pending.length}`)

// Output:
// 📊 Migration Status:
//   ✅ Executed: 2
//   ⏳ Pending: 1
//
// Executed migrations:
//   ✓ 001_create_users
//   ✓ 002_create_posts
//
// Pending migrations:
//   - 003_add_indexes
```

#### reset()

Rollback all migrations (dangerous!).

```typescript
async reset(): Promise<void>
```

**Behavior:**
- Gets count of executed migrations
- Calls down() to rollback all migrations
- Only rolls back migrations that have down() methods

**Example:**
```typescript
await runner.reset()
// ⚠️  Resetting 3 migrations...
// ↓ Rolling back 003_add_indexes...
// ✓ 003_add_indexes rolled back
// ↓ Rolling back 002_create_posts...
// ✓ 002_create_posts rolled back
// ↓ Rolling back 001_create_users...
// ✓ 001_create_users rolled back
// ✅ All migrations reset
```

#### upTo()

Run migrations up to (and including) a specific migration.

```typescript
async upTo(targetName: string): Promise<void>
```

**Parameters:**
- `targetName` - Name of the target migration

**Behavior:**
- Finds the target migration in the list
- Runs all migrations up to and including the target
- Skips already-executed migrations
- Throws error if target migration not found

**Example:**
```typescript
await runner.upTo('002_create_posts')
// ↑ Running 001_create_users...
// ✓ 001_create_users completed
// ↑ Running 002_create_posts...
// ✓ 002_create_posts completed
// ✅ Migrated up to 002_create_posts
```

### setupMigrations()

Manually create the migrations tracking table.

```typescript
async function setupMigrations(db: Kysely<any>): Promise<void>
```

**Note:** This is called automatically by the runner, but you can call it manually if needed.

**Example:**
```typescript
import { setupMigrations } from '@kysera/migrations'

await setupMigrations(db)
// Creates migrations table if it doesn't exist
```

## 🔄 Migration Lifecycle

### Complete Migration Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Create Migrations                                    │
│    Define up/down functions                             │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Initialize Runner                                    │
│    createMigrationRunner(db, migrations, options)       │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Check Status (Optional)                              │
│    await runner.status()                                │
│    → Shows executed and pending migrations              │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Run Migrations                                       │
│    await runner.up()                                    │
│    → Executes pending migrations sequentially           │
│    → Marks each as executed after success               │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 5. Rollback (If Needed)                                 │
│    await runner.down(N)                                 │
│    → Reverts last N migrations                          │
│    → Removes from executed list                         │
└─────────────────────────────────────────────────────────┘
```

### Migration Execution Order

Migrations are executed in **array order**:

```typescript
const migrations = [
  createMigration('001_first', ...),   // Runs first
  createMigration('002_second', ...),  // Runs second
  createMigration('003_third', ...)    // Runs third
]
```

**Important:** Name your migrations with numeric prefixes to ensure proper ordering:
- ✅ `001_create_users`, `002_create_posts`, `003_add_indexes`
- ❌ `create_users`, `create_posts` (no guaranteed order)

### Error Handling

When a migration fails:
1. Execution stops immediately
2. Failed migration is **not** marked as executed
3. Previous successful migrations remain executed
4. Error is thrown for handling

```typescript
try {
  await runner.up()
} catch (error) {
  console.error('Migration failed:', error)
  // Handle error: notify admins, rollback, etc.
}
```

## 🔧 Advanced Usage

### Partial Migrations

Run migrations incrementally:

```typescript
const runner = createMigrationRunner(db, migrations)

// Run only the first two migrations
await runner.upTo('002_create_posts')

// Later, run the rest
await runner.up()
```

### Custom Logger

Integrate with your logging system:

```typescript
import { createMigrationRunner } from '@kysera/migrations'
import { logger } from './logger'

const runner = createMigrationRunner(db, migrations, {
  logger: (message) => {
    logger.info('[MIGRATIONS]', message)
  }
})

await runner.up()
// Logs will be sent to your logging system
```

### Disable Logging

```typescript
const runner = createMigrationRunner(db, migrations, {
  logger: () => {} // No-op logger
})

await runner.up() // Silent execution
```

### Migration Metadata

Add metadata to migrations for documentation:

```typescript
interface MigrationWithMeta extends Migration {
  /** Human-readable description */
  description?: string

  /** Whether this is a breaking change */
  breaking?: boolean

  /** Estimated duration in milliseconds */
  estimatedDuration?: number
}

const migration: MigrationWithMeta = {
  name: '001_create_users',
  description: 'Create users table with email and name',
  breaking: false,
  estimatedDuration: 500,
  up: async (db) => { /* ... */ },
  down: async (db) => { /* ... */ }
}
```

### Complex Schema Changes

Handle complex migrations with transactions:

```typescript
createMigration(
  '004_complex_refactor',
  async (db) => {
    // Use transaction for complex operations
    await db.transaction().execute(async (trx) => {
      // 1. Create new table
      await trx.schema
        .createTable('new_users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('email', 'varchar(255)', col => col.notNull())
        .addColumn('full_name', 'varchar(255)', col => col.notNull())
        .execute()

      // 2. Copy data
      await trx
        .insertInto('new_users')
        .columns(['email', 'full_name'])
        .from(
          trx.selectFrom('users')
            .select(['email', 'name as full_name'])
        )
        .execute()

      // 3. Drop old table
      await trx.schema.dropTable('users').execute()

      // 4. Rename new table
      await trx.schema.alterTable('new_users').renameTo('users').execute()
    })
  },
  async (db) => {
    // Revert complex changes
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .alterTable('users')
        .renameColumn('full_name', 'name')
        .execute()
    })
  }
)
```

### Data Migrations

Migrate data along with schema:

```typescript
createMigration(
  '005_migrate_user_roles',
  async (db) => {
    // 1. Add new column
    await db.schema
      .alterTable('users')
      .addColumn('role', 'varchar(50)', col => col.defaultTo('user'))
      .execute()

    // 2. Migrate data
    await db
      .updateTable('users')
      .set({ role: 'admin' })
      .where('email', 'like', '%@admin.com')
      .execute()

    // 3. Make column required
    await db.schema
      .alterTable('users')
      .alterColumn('role', col => col.setNotNull())
      .execute()
  },
  async (db) => {
    await db.schema
      .alterTable('users')
      .dropColumn('role')
      .execute()
  }
)
```

## ✅ Best Practices

### 1. Always Use Numeric Prefixes

```typescript
// ✅ Good: Clear ordering
const migrations = [
  createMigration('001_create_users', ...),
  createMigration('002_create_posts', ...),
  createMigration('003_add_indexes', ...)
]

// ❌ Bad: No guaranteed order
const migrations = [
  createMigration('create_users', ...),
  createMigration('create_posts', ...),
  createMigration('add_indexes', ...)
]
```

### 2. Keep Migrations Small and Focused

```typescript
// ✅ Good: One table per migration
createMigration('001_create_users', async (db) => {
  await db.schema.createTable('users')...execute()
})

createMigration('002_create_posts', async (db) => {
  await db.schema.createTable('posts')...execute()
})

// ❌ Bad: Multiple tables in one migration
createMigration('001_initial_schema', async (db) => {
  await db.schema.createTable('users')...execute()
  await db.schema.createTable('posts')...execute()
  await db.schema.createTable('comments')...execute()
})
```

### 3. Always Provide down() Methods

```typescript
// ✅ Good: Reversible migration
createMigration(
  '001_create_users',
  async (db) => {
    await db.schema.createTable('users')...execute()
  },
  async (db) => {
    await db.schema.dropTable('users').execute()
  }
)

// ⚠️ Acceptable but not ideal: No rollback
createMigration(
  '002_add_column',
  async (db) => {
    await db.schema
      .alterTable('users')
      .addColumn('status', 'varchar(50)')
      .execute()
  }
  // No down() method - can't be rolled back
)
```

### 4. Test Migrations Before Production

```typescript
// Test in development
const runner = createMigrationRunner(devDb, migrations, {
  logger: console.log
})

// 1. Test up
await runner.up()
// Verify schema is correct

// 2. Test down
await runner.down(1)
// Verify rollback works

// 3. Test up again
await runner.up()
// Ensure idempotency
```

### 5. Use Dry Run for Production

```typescript
// Preview changes in production
const dryRunner = createMigrationRunner(db, migrations, {
  dryRun: true,
  logger: console.log
})

await dryRunner.up()
// Review output, ensure it's safe

// Then run for real
const runner = createMigrationRunner(db, migrations)
await runner.up()
```

### 6. Organize Migrations in Separate Files

```typescript
// migrations/001_create_users.ts
export const migration_001 = createMigration(
  '001_create_users',
  async (db) => { /* ... */ },
  async (db) => { /* ... */ }
)

// migrations/002_create_posts.ts
export const migration_002 = createMigration(
  '002_create_posts',
  async (db) => { /* ... */ },
  async (db) => { /* ... */ }
)

// migrations/index.ts
import { migration_001 } from './001_create_users'
import { migration_002 } from './002_create_posts'

export const migrations = [
  migration_001,
  migration_002
]
```

### 7. Handle Breaking Changes Carefully

```typescript
// Mark breaking changes
const migration: MigrationWithMeta = {
  name: '010_remove_deprecated_columns',
  description: 'Remove deprecated user columns',
  breaking: true,  // Alert!
  up: async (db) => {
    // Drop columns that apps might still use
    await db.schema
      .alterTable('users')
      .dropColumn('old_column')
      .execute()
  },
  down: async (db) => {
    // Cannot fully revert - data loss!
    await db.schema
      .alterTable('users')
      .addColumn('old_column', 'text')
      .execute()
  }
}
```

## 🗃️ Multi-Database Support

### PostgreSQL

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { createMigrationRunner, createMigration } from '@kysera/migrations'

const db = new Kysely({
  dialect: new PostgresDialect({
    pool: new Pool({
      host: 'localhost',
      database: 'mydb',
      user: 'user',
      password: 'password'
    })
  })
})

const migrations = [
  createMigration(
    '001_create_users',
    async (db) => {
      await db.schema
        .createTable('users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('email', 'varchar(255)', col => col.notNull().unique())
        .addColumn('created_at', 'timestamp', col =>
          col.notNull().defaultTo(db.fn('now'))
        )
        .execute()

      // PostgreSQL-specific: Create index
      await db.schema
        .createIndex('users_email_idx')
        .on('users')
        .column('email')
        .execute()
    },
    async (db) => {
      await db.schema.dropTable('users').cascade().execute()
    }
  )
]

const runner = createMigrationRunner(db, migrations)
await runner.up()
```

### MySQL

```typescript
import { Kysely, MysqlDialect } from 'kysely'
import { createPool } from 'mysql2'
import { createMigrationRunner, createMigration } from '@kysera/migrations'

const db = new Kysely({
  dialect: new MysqlDialect({
    pool: createPool({
      host: 'localhost',
      database: 'mydb',
      user: 'user',
      password: 'password'
    })
  })
})

const migrations = [
  createMigration(
    '001_create_users',
    async (db) => {
      await db.schema
        .createTable('users')
        .addColumn('id', 'integer', col =>
          col.primaryKey().autoIncrement()
        )
        .addColumn('email', 'varchar(255)', col => col.notNull().unique())
        .addColumn('created_at', 'datetime', col =>
          col.notNull().defaultTo(db.fn('now'))
        )
        .execute()
    },
    async (db) => {
      await db.schema.dropTable('users').execute()
    }
  )
]

const runner = createMigrationRunner(db, migrations)
await runner.up()
```

### SQLite

```typescript
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import { createMigrationRunner, createMigration } from '@kysera/migrations'

const db = new Kysely({
  dialect: new SqliteDialect({
    database: new Database('mydb.sqlite')
  })
})

const migrations = [
  createMigration(
    '001_create_users',
    async (db) => {
      await db.schema
        .createTable('users')
        .addColumn('id', 'integer', col =>
          col.primaryKey().autoIncrement()
        )
        .addColumn('email', 'text', col => col.notNull().unique())
        .addColumn('created_at', 'text', col =>
          col.notNull().defaultTo(db.fn('datetime', ['now']))
        )
        .execute()
    },
    async (db) => {
      await db.schema.dropTable('users').execute()
    }
  )
]

const runner = createMigrationRunner(db, migrations)
await runner.up()
```

## 🐛 Troubleshooting

### Migration Not Running

**Problem**: Migration appears in pending list but doesn't execute

**Solutions:**
```typescript
// 1. Check migration is in the array
const migrations = [
  migration_001,
  migration_002,
  migration_003  // Make sure it's included!
]

// 2. Verify migration name is unique
const migrations = [
  createMigration('001_users', ...),
  createMigration('001_users', ...)  // ❌ Duplicate name!
]

// 3. Check for errors in up() function
createMigration('001_test', async (db) => {
  try {
    await db.schema.createTable('test')...execute()
  } catch (error) {
    console.error('Migration failed:', error)
    throw error
  }
})
```

### Rollback Fails

**Problem**: down() throws error or doesn't work

**Solutions:**
```typescript
// 1. Ensure down() method exists
const migration = createMigration(
  '001_test',
  async (db) => { /* up */ },
  async (db) => { /* down - required for rollback! */ }
)

// 2. Handle dependent objects (foreign keys, etc.)
createMigration(
  '001_create_posts',
  async (db) => {
    await db.schema.createTable('posts')
      .addColumn('user_id', 'integer', col =>
        col.references('users.id')
      )
      .execute()
  },
  async (db) => {
    // Must drop in correct order
    await db.schema.dropTable('posts').execute()  // ✅ Drop first
    // DON'T drop users table here if posts references it
  }
)

// 3. Use CASCADE for PostgreSQL
async (db) => {
  await db.schema.dropTable('users').cascade().execute()
}
```

### Migrations Table Not Found

**Problem**: `Error: Table 'migrations' does not exist`

**Solution:**
```typescript
// The migrations table is created automatically,
// but you can create it manually if needed:
import { setupMigrations } from '@kysera/migrations'

await setupMigrations(db)
await runner.up()
```

### Duplicate Migration Names

**Problem**: Same migration runs twice or state is inconsistent

**Solution:**
```typescript
// Ensure unique names with consistent prefixes
const migrations = [
  createMigration('001_create_users', ...),
  createMigration('002_create_posts', ...),
  createMigration('003_add_indexes', ...)
  // Not: '001_create_users', '001_another_table', ...
]

// Check for duplicates programmatically
const names = migrations.map(m => m.name)
const duplicates = names.filter((n, i) => names.indexOf(n) !== i)
if (duplicates.length > 0) {
  throw new Error(`Duplicate migrations: ${duplicates.join(', ')}`)
}
```

### Migration Stuck in Pending

**Problem**: Migration marked as executed but database changes not applied

**Solution:**
```typescript
// Manually remove from migrations table and re-run
await db
  .deleteFrom('migrations')
  .where('name', '=', 'problematic_migration_name')
  .execute()

await runner.up()
```

## 📝 Examples

### Complete Blog Application Migration

```typescript
import { createMigration } from '@kysera/migrations'
import { sql } from 'kysely'

export const blogMigrations = [
  // 001: Create users table
  createMigration(
    '001_create_users',
    async (db) => {
      await db.schema
        .createTable('users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('email', 'varchar(255)', col => col.notNull().unique())
        .addColumn('username', 'varchar(50)', col => col.notNull().unique())
        .addColumn('password_hash', 'varchar(255)', col => col.notNull())
        .addColumn('created_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .execute()

      await db.schema
        .createIndex('users_email_idx')
        .on('users')
        .column('email')
        .execute()
    },
    async (db) => {
      await db.schema.dropTable('users').cascade().execute()
    }
  ),

  // 002: Create posts table
  createMigration(
    '002_create_posts',
    async (db) => {
      await db.schema
        .createTable('posts')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('user_id', 'integer', col =>
          col.notNull().references('users.id').onDelete('cascade')
        )
        .addColumn('title', 'varchar(255)', col => col.notNull())
        .addColumn('slug', 'varchar(255)', col => col.notNull().unique())
        .addColumn('content', 'text', col => col.notNull())
        .addColumn('published', 'boolean', col => col.notNull().defaultTo(false))
        .addColumn('created_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .addColumn('updated_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .execute()

      await db.schema
        .createIndex('posts_user_id_idx')
        .on('posts')
        .column('user_id')
        .execute()

      await db.schema
        .createIndex('posts_slug_idx')
        .on('posts')
        .column('slug')
        .execute()
    },
    async (db) => {
      await db.schema.dropTable('posts').execute()
    }
  ),

  // 003: Create comments table
  createMigration(
    '003_create_comments',
    async (db) => {
      await db.schema
        .createTable('comments')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('post_id', 'integer', col =>
          col.notNull().references('posts.id').onDelete('cascade')
        )
        .addColumn('user_id', 'integer', col =>
          col.notNull().references('users.id').onDelete('cascade')
        )
        .addColumn('content', 'text', col => col.notNull())
        .addColumn('created_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .execute()

      await db.schema
        .createIndex('comments_post_id_idx')
        .on('comments')
        .column('post_id')
        .execute()
    },
    async (db) => {
      await db.schema.dropTable('comments').execute()
    }
  ),

  // 004: Add tags
  createMigration(
    '004_create_tags',
    async (db) => {
      await db.schema
        .createTable('tags')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('name', 'varchar(50)', col => col.notNull().unique())
        .addColumn('slug', 'varchar(50)', col => col.notNull().unique())
        .execute()

      await db.schema
        .createTable('post_tags')
        .addColumn('post_id', 'integer', col =>
          col.notNull().references('posts.id').onDelete('cascade')
        )
        .addColumn('tag_id', 'integer', col =>
          col.notNull().references('tags.id').onDelete('cascade')
        )
        .addPrimaryKeyConstraint('post_tags_pk', ['post_id', 'tag_id'])
        .execute()

      await db.schema
        .createIndex('post_tags_tag_id_idx')
        .on('post_tags')
        .column('tag_id')
        .execute()
    },
    async (db) => {
      await db.schema.dropTable('post_tags').execute()
      await db.schema.dropTable('tags').execute()
    }
  ),

  // 005: Add full-text search
  createMigration(
    '005_add_fulltext_search',
    async (db) => {
      // PostgreSQL specific
      await db.schema
        .alterTable('posts')
        .addColumn('search_vector', 'tsvector')
        .execute()

      await sql`
        CREATE INDEX posts_search_vector_idx
        ON posts
        USING gin(search_vector)
      `.execute(db)

      await sql`
        CREATE TRIGGER posts_search_vector_update
        BEFORE INSERT OR UPDATE ON posts
        FOR EACH ROW EXECUTE FUNCTION
        tsvector_update_trigger(
          search_vector, 'pg_catalog.english', title, content
        )
      `.execute(db)
    },
    async (db) => {
      await sql`DROP TRIGGER posts_search_vector_update ON posts`.execute(db)
      await db.schema
        .alterTable('posts')
        .dropColumn('search_vector')
        .execute()
    }
  )
]

// Usage
const runner = createMigrationRunner(db, blogMigrations)
await runner.up()
```

### Migration Script

```typescript
// scripts/migrate.ts
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { createMigrationRunner } from '@kysera/migrations'
import { migrations } from '../migrations'

async function main() {
  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env.DATABASE_URL
      })
    })
  })

  const command = process.argv[2]
  const runner = createMigrationRunner(db, migrations)

  try {
    switch (command) {
      case 'up':
        console.log('Running migrations...')
        await runner.up()
        break

      case 'down':
        const steps = parseInt(process.argv[3] || '1')
        console.log(`Rolling back ${steps} migration(s)...`)
        await runner.down(steps)
        break

      case 'status':
        await runner.status()
        break

      case 'reset':
        console.log('⚠️  WARNING: This will rollback ALL migrations!')
        await runner.reset()
        break

      default:
        console.log('Usage: pnpm migrate [up|down|status|reset] [steps]')
        process.exit(1)
    }
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await db.destroy()
  }
}

main()
```

```json
// package.json
{
  "scripts": {
    "migrate:up": "tsx scripts/migrate.ts up",
    "migrate:down": "tsx scripts/migrate.ts down",
    "migrate:status": "tsx scripts/migrate.ts status",
    "migrate:reset": "tsx scripts/migrate.ts reset"
  }
}
```

## 🔒 Type Safety

### Fully Typed Migrations

```typescript
import type { Kysely } from 'kysely'
import type { Database } from './database'

// Type-safe migration
const migration = createMigration(
  '001_create_users',
  async (db: Kysely<Database>) => {
    await db.schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('email', 'varchar(255)', col => col.notNull())
      .execute()
  },
  async (db: Kysely<Database>) => {
    await db.schema.dropTable('users').execute()
  }
)

// Type-safe data migration
createMigration(
  '002_migrate_data',
  async (db: Kysely<Database>) => {
    // TypeScript knows about 'users' table
    const users = await db
      .selectFrom('users')
      .selectAll()
      .execute()

    // Type-safe operations
    for (const user of users) {
      await db
        .updateTable('users')
        .set({ email: user.email.toLowerCase() })
        .where('id', '=', user.id)
        .execute()
    }
  }
)
```

## 📄 License

MIT © [Kysera Team](https://github.com/omnitron-dev)

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](../../CONTRIBUTING.md) for details.

## 📚 Related Packages

- [`@kysera/core`](../core) - Core utilities and error handling
- [`@kysera/repository`](../repository) - Repository pattern implementation
- [`@kysera/audit`](../audit) - Audit logging plugin
- [`@kysera/soft-delete`](../soft-delete) - Soft delete plugin
- [`@kysera/timestamps`](../timestamps) - Automatic timestamp management

## 🔗 Links

- [Documentation](https://kysera.dev/docs/migrations)
- [GitHub Repository](https://github.com/omnitron-dev/kysera)
- [Issue Tracker](https://github.com/omnitron-dev/kysera/issues)
- [Kysely Documentation](https://kysely.dev)

---

**Built with ❤️ using TypeScript and Kysely**
