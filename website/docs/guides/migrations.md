---
sidebar_position: 3
title: Migrations
description: Database migration strategies
---

# Migrations

Best practices for database migrations with Kysera.

## Creating Migrations

### Using CLI

```bash
kysera migrate create add_users_table
```

### Manual Creation

```typescript
// migrations/001_create_users.ts
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('email', 'varchar(255)', col => col.notNull().unique())
    .addColumn('name', 'varchar(100)', col => col.notNull())
    .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('users').execute()
}
```

## Migration Patterns

### Creating Tables

```typescript
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('posts')
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('user_id', 'integer', col =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('title', 'varchar(255)', col => col.notNull())
    .addColumn('content', 'text')
    .addColumn('status', 'varchar(20)', col => col.notNull().defaultTo('draft'))
    .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'timestamp')
    .execute()

  // Create indexes
  await db.schema.createIndex('idx_posts_user_id').on('posts').column('user_id').execute()

  await db.schema.createIndex('idx_posts_status').on('posts').column('status').execute()
}
```

### Adding Columns

```typescript
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('avatar_url', 'varchar(500)')
    .addColumn('bio', 'text')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('users').dropColumn('avatar_url').dropColumn('bio').execute()
}
```

### Modifying Columns

```typescript
export async function up(db: Kysely<any>): Promise<void> {
  // PostgreSQL
  await sql`ALTER TABLE users ALTER COLUMN name TYPE varchar(200)`.execute(db)

  // Or using schema builder
  await db.schema
    .alterTable('users')
    .alterColumn('name', col => col.setDataType('varchar(200)'))
    .execute()
}
```

### Adding Indexes

```typescript
export async function up(db: Kysely<any>): Promise<void> {
  // Simple index
  await db.schema.createIndex('idx_users_email').on('users').column('email').execute()

  // Composite index
  await db.schema
    .createIndex('idx_posts_created_user')
    .on('posts')
    .columns(['created_at', 'user_id'])
    .execute()

  // Unique index
  await db.schema
    .createIndex('idx_users_username')
    .on('users')
    .column('username')
    .unique()
    .execute()

  // Partial index (PostgreSQL)
  await sql`
    CREATE INDEX idx_active_users ON users (id)
    WHERE status = 'active'
  `.execute(db)
}
```

### Adding Foreign Keys

```typescript
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('posts')
    .addForeignKeyConstraint('fk_posts_category', ['category_id'], 'categories', ['id'])
    .onDelete('set null')
    .execute()
}
```

## Running Migrations

### Using API

{/* doc-snippet: skip */}
```typescript
import { createMigrationRunner, runMigrations } from '@kysera/migrations'
import type { Kysely } from 'kysely'

// Full control
const runner = createMigrationRunner(db, migrations)
const result = await runner.up()
const status = await runner.status()
await runner.down(1)

// One-liner
await runMigrations(db, migrations)

// With options
const runner = createMigrationRunner(db, migrations, {
  useTransactions: true, // Wrap each migration in transaction
  logger: console // Enable logging
})
```

### Concurrent Deployments (Advisory Lock)

Two application instances migrating at once would both see the same pending
list and run every migration twice. Since v0.9 the runner serializes
concurrent runs with a database advisory lock (enabled by default):

- **PostgreSQL** — `pg_try_advisory_lock` polled until `lockTimeoutMs`
- **MySQL** — `GET_LOCK('kysera_migrations', timeout)`
- **SQLite** — no-op (single-writer by design)
- **MSSQL** — not supported yet (no-op)

```typescript
const runner = createMigrationRunner(db, migrations, {
  advisoryLock: true, // default
  lockTimeoutMs: 60000 // fail with MigrationLockError after 60s
})
```

If the lock cannot be acquired in time, `up()`/`down()` throw
`MigrationLockError` — another runner is probably still migrating.

### Using CLI

```bash
# Run all pending
kysera migrate up

# Run specific number
kysera migrate up --steps 2

# Preview
kysera migrate up --dry-run

# Rollback
kysera migrate down --steps 1

# Status
kysera migrate status
```

## Advanced

### Defining Migrations with Helpers

`createMigration` and `createMigrationWithMeta` build migration objects; `defineMigrations` turns an object literal into an array of migrations with metadata:

```typescript
import { createMigration, createMigrationWithMeta, defineMigrations } from '@kysera/migrations'

// Simple: name + up + optional down
const createUsers = createMigration(
  '001_create_users',
  async db => {
    await db.schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .execute()
  },
  async db => {
    await db.schema.dropTable('users').execute()
  }
)

// With metadata
const addPhone = createMigrationWithMeta('002_add_users_phone', {
  up: async db => {
    await db.schema.alterTable('users').addColumn('phone', 'varchar(20)').execute()
  },
  down: async db => {
    await db.schema.alterTable('users').dropColumn('phone').execute()
  },
  description: 'Add phone number to users',
  breaking: false,
  estimatedDuration: 100, // ms
  tags: ['users']
})

// Object syntax - keys become migration names
const migrations = defineMigrations({
  '001_create_users': {
    up: async db => { /* ... */ },
    down: async db => { /* ... */ },
    description: 'Create users table'
  },
  '002_add_users_phone': {
    up: async db => { /* ... */ },
    tags: ['users']
  }
})
```

### Partial Runs and Baselining

```typescript
const runner = createMigrationRunner(db, migrations)

// Run pending migrations up to (and including) a target
await runner.upTo('002_add_users_phone')

// Baseline: record a migration as executed WITHOUT running it
// (useful when adopting Kysera on an existing schema)
await runner.markAsExecuted('001_create_users')
```

### Runner Plugins

`MigrationRunnerWithPlugins` calls lifecycle hooks (`onInit`, `beforeMigration`, `afterMigration`, `onMigrationError`) around each migration. Two plugins ship with the package:

{/* doc-snippet: skip */}
```typescript
import {
  createMigrationRunnerWithPlugins,
  createLoggingPlugin,
  createMetricsPlugin
} from '@kysera/migrations'

const metrics = createMetricsPlugin()

const runner = await createMigrationRunnerWithPlugins(db, migrations, {
  plugins: [
    createLoggingPlugin(consoleLogger), // Defaults to silentLogger - pass a logger to see output
    metrics
  ]
})

await runner.up()

console.log(metrics.getMetrics())
// { migrations: [{ name: '001_create_users', operation: 'up', duration: 12, success: true }] }
```

Custom plugins implement the `MigrationPlugin` interface:

```typescript
import type { MigrationPlugin } from '@kysera/migrations'

const slackNotifier: MigrationPlugin = {
  name: 'slack-notifier',
  version: '1.0.0',
  async afterMigration(migration, operation, duration) {
    await notifySlack(`${migration.name} ${operation} completed in ${duration}ms`)
  },
  async onMigrationError(migration, operation, error) {
    await notifySlack(`${migration.name} ${operation} FAILED: ${String(error)}`)
  }
}
```

## Safe Migrations

### Non-Destructive Changes

Safe to run in production without downtime:

{/* doc-snippet: skip */}
```typescript
// Safe: Add nullable column
await db.schema
  .alterTable('users')
  .addColumn('phone', 'varchar(20)')  // Nullable by default
  .execute()

// Safe: Add index concurrently (PostgreSQL)
await sql`
  CREATE INDEX CONCURRENTLY idx_users_phone ON users (phone)
`.execute(db)

// Safe: Add new table
await db.schema.createTable('audit_logs')./* ... */.execute()
```

### Destructive Changes

Require careful planning:

```typescript
// Dangerous: Drop column
await db.schema.alterTable('users').dropColumn('legacy_field').execute()

// Dangerous: Change column type
await sql`ALTER TABLE users ALTER COLUMN age TYPE bigint`.execute(db)

// Dangerous: Add NOT NULL constraint
await db.schema
  .alterTable('users')
  .alterColumn('email', col => col.setNotNull())
  .execute()
```

### Safe Patterns for Destructive Changes

{/* doc-snippet: skip */}
```typescript
// Step 1: Add new nullable column
export async function up(db: Kysely<any>) {
  await db.schema.alterTable('users').addColumn('email_new', 'varchar(255)').execute()
}

// Step 2: Migrate data (separate migration)
export async function up(db: Kysely<any>) {
  await db
    .updateTable('users')
    .set(eb => ({ email_new: eb.ref('email') }))
    .execute()
}

// Step 3: Make new column not null, drop old (separate migration)
export async function up(db: Kysely<any>) {
  await db.schema
    .alterTable('users')
    .alterColumn('email_new', col => col.setNotNull())
    .dropColumn('email')
    .execute()

  await sql`ALTER TABLE users RENAME COLUMN email_new TO email`.execute(db)
}
```

## Best Practices

### 1. One Change Per Migration

```
001_create_users.ts        // Just users table
002_create_posts.ts        // Just posts table
003_add_users_phone.ts     // Just phone column
```

### 2. Always Include Down Migration

```typescript
export async function down(db: Kysely<any>) {
  await db.schema.dropTable('users').execute()
}
```

### 3. Use Transactions (When Possible)

```typescript
const runner = createMigrationRunner(db, migrations, {
  useTransactions: true,
  logger: consoleLogger // Optional: enable logging
})
```

### 4. Test Migrations

```typescript
it('should migrate up and down', async () => {
  const result = await runner.up()
  expect(result.executed.length).toBeGreaterThan(0)

  const status = await runner.status()
  expect(status.pending).toHaveLength(0)

  await runner.reset()
  const statusAfterReset = await runner.status()
  expect(statusAfterReset.pending).toHaveLength(migrations.length)
})
```

### 5. Use Dry Run First

```bash
kysera migrate up --dry-run
kysera migrate down --dry-run
```

### 6. Back Up Before Production Migrations

```bash
kysera db dump -o backup-before-migration.sql
kysera migrate up
```
