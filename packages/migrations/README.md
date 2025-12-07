# @kysera/migrations

> Lightweight, type-safe database migration management for Kysera ORM with dry-run support, flexible rollback capabilities, and plugin system.

[![npm version](https://img.shields.io/npm/v/@kysera/migrations.svg)](https://www.npmjs.com/package/@kysera/migrations)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## Package Information

| Property | Value |
|----------|-------|
| **Package** | `@kysera/migrations` |
| **Version** | `0.5.1` |
| **Bundle Size** | ~4.5 KB (minified) |
| **Dependencies** | `@kysera/core` (peer: kysely) |
| **Test Coverage** | 35 tests, comprehensive |
| **Supported Databases** | PostgreSQL, MySQL, SQLite |
| **Type Safety** | Full TypeScript support |

## Features

### Core Migration Management
- **Simple API** - Intuitive migration creation and execution
- **Type-safe** - Full TypeScript support with Kysely integration
- **State tracking** - Automatic migration history in database
- **Sequential execution** - Migrations run in order
- **Dry run mode** - Preview changes before execution

### Advanced Features
- **Rollback support** - Roll back one or multiple migrations
- **Partial migration** - Run up to specific migration
- **Status reporting** - View executed and pending migrations
- **Error handling** - Typed errors with `MigrationError` class
- **Transaction support** - Optional transaction wrapping per migration
- **Duplicate detection** - Validates unique migration names

### Developer Experience (v0.5.0+)
- **`defineMigrations()`** - Object-based migration definition
- **`runMigrations()`** - One-liner to run pending migrations
- **`rollbackMigrations()`** - One-liner for rollbacks
- **Migration metadata** - Description, breaking flag, tags, timing

### Plugin System (v0.5.0+)
- **Plugin hooks** - Before/after migration events
- **Built-in plugins** - Logging and metrics plugins
- **Extensible** - Create custom plugins for your needs

## Installation

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

## Quick Start

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

// Check status
await runner.status()

// Rollback last migration
await runner.down(1)
```

### Minimalist API (v0.5.0+)

```typescript
import { Kysely } from 'kysely'
import { defineMigrations, runMigrations } from '@kysera/migrations'

// Define migrations with object syntax
const migrations = defineMigrations({
  '001_create_users': {
    description: 'Create users table with email and name',
    up: async (db) => {
      await db.schema
        .createTable('users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('email', 'varchar(255)', col => col.notNull().unique())
        .execute()
    },
    down: async (db) => {
      await db.schema.dropTable('users').execute()
    },
  },

  '002_create_posts': {
    description: 'Create posts table',
    breaking: false,
    tags: ['schema'],
    up: async (db) => {
      await db.schema
        .createTable('posts')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('title', 'varchar(255)', col => col.notNull())
        .execute()
    },
  },
})

// One-liner to run all migrations
await runMigrations(db, migrations)
```

### Dry Run Mode

```typescript
import { runMigrations } from '@kysera/migrations'

// Preview what would happen without making changes
const result = await runMigrations(db, migrations, { dryRun: true })

console.log('Would execute:', result.executed)
console.log('Would skip:', result.skipped)
// No actual changes made to database
```

## API Reference

### Types

#### `Migration`

```typescript
interface Migration {
  name: string
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
}
```

#### `MigrationWithMeta`

```typescript
interface MigrationWithMeta extends Migration {
  description?: string      // Shown in logs
  breaking?: boolean        // Shows warning
  estimatedDuration?: number // In milliseconds
  tags?: string[]           // For categorization
}
```

#### `MigrationStatus`

```typescript
interface MigrationStatus {
  executed: string[]
  pending: string[]
  total: number
}
```

#### `MigrationResult`

```typescript
interface MigrationResult {
  executed: string[]   // Successfully executed
  skipped: string[]    // Already executed or no down()
  failed: string[]     // Failed migrations
  duration: number     // Total time in ms
  dryRun: boolean      // Whether dry run mode
}
```

#### `MigrationRunnerOptions`

```typescript
interface MigrationRunnerOptions {
  dryRun?: boolean          // Preview only (default: false)
  logger?: (msg: string) => void  // Custom logger
  useTransactions?: boolean // Wrap in transactions (default: false)
  stopOnError?: boolean     // Stop on first error (default: true)
  verbose?: boolean         // Show metadata (default: true)
}
```

#### `MigrationDefinition`

```typescript
interface MigrationDefinition {
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
  description?: string
  breaking?: boolean
  estimatedDuration?: number
  tags?: string[]
}
```

#### `MigrationDefinitions`

```typescript
type MigrationDefinitions = Record<string, MigrationDefinition>
```

#### `MigrationRunnerWithPluginsOptions`

```typescript
interface MigrationRunnerWithPluginsOptions extends MigrationRunnerOptions {
  plugins?: MigrationPlugin[]
}
```

#### `MigrationErrorCode`

```typescript
type MigrationErrorCode = 'MIGRATION_UP_FAILED' | 'MIGRATION_DOWN_FAILED' | 'MIGRATION_VALIDATION_FAILED'
```

### Factory Functions

#### `createMigration(name, up, down?)`

Create a simple migration:

```typescript
const migration = createMigration(
  '001_create_users',
  async (db) => { /* up */ },
  async (db) => { /* down */ }
)
```

#### `createMigrationWithMeta(name, options)`

Create a migration with metadata:

```typescript
const migration = createMigrationWithMeta('001_create_users', {
  description: 'Create users table',
  breaking: true,
  tags: ['schema', 'users'],
  estimatedDuration: 5000,
  up: async (db) => { /* ... */ },
  down: async (db) => { /* ... */ },
})
```

#### `createMigrationRunner(db, migrations, options?)`

Create a MigrationRunner instance:

```typescript
const runner = createMigrationRunner(db, migrations, {
  dryRun: false,
  logger: console.log,
  useTransactions: true,
})
```

#### `createMigrationRunnerWithPlugins(db, migrations, options?)`

Create a MigrationRunner with plugin support (async factory):

```typescript
const runner = await createMigrationRunnerWithPlugins(db, migrations, {
  plugins: [createLoggingPlugin(), createMetricsPlugin()],
  useTransactions: true,
})

// Runner is ready with plugins initialized via onInit
await runner.up()
```

### One-Liner Functions (v0.5.0+)

#### `defineMigrations(definitions)`

Define migrations using object syntax:

```typescript
const migrations = defineMigrations({
  '001_users': {
    description: 'Create users',
    up: async (db) => { /* ... */ },
    down: async (db) => { /* ... */ },
  },
})
```

#### `runMigrations(db, migrations, options?)`

Run all pending migrations:

```typescript
const result = await runMigrations(db, migrations)
const result = await runMigrations(db, migrations, { dryRun: true })
```

#### `rollbackMigrations(db, migrations, steps?, options?)`

Rollback migrations:

```typescript
await rollbackMigrations(db, migrations)        // Last 1
await rollbackMigrations(db, migrations, 3)     // Last 3
await rollbackMigrations(db, migrations, 1, { dryRun: true })
```

#### `getMigrationStatus(db, migrations, options?)`

Get migration status:

```typescript
const status = await getMigrationStatus(db, migrations)
console.log(`Executed: ${status.executed.length}`)
console.log(`Pending: ${status.pending.length}`)
```

### MigrationRunner Methods

#### `up(): Promise<MigrationResult>`

Run all pending migrations:

```typescript
const result = await runner.up()
console.log(`Executed: ${result.executed.length} migrations`)
```

#### `down(steps?): Promise<MigrationResult>`

Rollback last N migrations:

```typescript
await runner.down(1)   // Rollback last one
await runner.down(3)   // Rollback last three
```

#### `status(): Promise<MigrationStatus>`

Get migration status:

```typescript
const status = await runner.status()
// Logs status to console and returns object
```

#### `reset(): Promise<MigrationResult>`

Rollback all migrations:

```typescript
await runner.reset()  // Dangerous! Rolls back everything
```

#### `upTo(targetName): Promise<MigrationResult>`

Run migrations up to a specific one:

```typescript
await runner.upTo('002_create_posts')
// Runs 001 and 002, stops before 003
```

#### `getExecutedMigrations(): Promise<string[]>`

Get list of executed migrations:

```typescript
const executed = await runner.getExecutedMigrations()
```

#### `markAsExecuted(name): Promise<void>`

Manually mark a migration as executed:

```typescript
await runner.markAsExecuted('001_create_users')
```

#### `markAsRolledBack(name): Promise<void>`

Manually mark a migration as rolled back:

```typescript
await runner.markAsRolledBack('001_create_users')
```

### Standalone Functions

#### `setupMigrations(db)`

Manually create the migrations tracking table:

```typescript
import { setupMigrations } from '@kysera/migrations'

await setupMigrations(db)
// Creates migrations table if not exists
```

## Plugin System (v0.5.0+)

### Plugin Interface

Consistent with `@kysera/repository` Plugin interface:

```typescript
interface MigrationPlugin {
  name: string
  version: string
  // Called once when runner is initialized (consistent with repository Plugin.onInit)
  onInit?(runner: MigrationRunner): Promise<void> | void
  beforeMigration?(migration: Migration, operation: 'up' | 'down'): Promise<void> | void
  afterMigration?(migration: Migration, operation: 'up' | 'down', duration: number): Promise<void> | void
  // Unknown error type for consistency with repository Plugin.onError
  onMigrationError?(migration: Migration, operation: 'up' | 'down', error: unknown): Promise<void> | void
}
```

### Built-in Plugins

#### Logging Plugin

```typescript
import { createLoggingPlugin } from '@kysera/migrations'

const loggingPlugin = createLoggingPlugin(console.log)
// or with custom logger
const loggingPlugin = createLoggingPlugin((msg) => logger.info(msg))
```

#### Metrics Plugin

```typescript
import { createMetricsPlugin } from '@kysera/migrations'

const metricsPlugin = createMetricsPlugin()

// After running migrations
const metrics = metricsPlugin.getMetrics()
console.log(metrics.migrations)
// [{ name: '001_users', operation: 'up', duration: 45, success: true }, ...]
```

### Creating Custom Plugins

```typescript
const notificationPlugin: MigrationPlugin = {
  name: 'notification-plugin',
  version: '1.0.0',

  // Called when runner is created via createMigrationRunnerWithPlugins()
  async onInit(runner) {
    console.log('Notification plugin initialized')
  },

  async beforeMigration(migration, operation) {
    await slack.send(`Starting ${operation} for ${migration.name}`)
  },

  async afterMigration(migration, operation, duration) {
    await slack.send(`Completed ${migration.name} in ${duration}ms`)
  },

  async onMigrationError(migration, operation, error) {
    // Error is unknown type - handle appropriately
    const message = error instanceof Error ? error.message : String(error)
    await pagerduty.alert(`Migration failed: ${message}`)
  },
}
```

## Error Handling

### MigrationError

Extends `DatabaseError` from `@kysera/core` for consistency:

```typescript
import { MigrationError } from '@kysera/migrations'

try {
  await runner.up()
} catch (error) {
  if (error instanceof MigrationError) {
    console.log('Migration:', error.migrationName)
    console.log('Operation:', error.operation) // 'up' or 'down'
    console.log('Code:', error.code) // 'MIGRATION_UP_FAILED' or 'MIGRATION_DOWN_FAILED'
    console.log('Cause:', error.cause?.message)

    // Serialize for logging
    console.log(error.toJSON())
    // { name, message, code, detail, migrationName, operation, cause }
  }
}
```

### BadRequestError

For validation errors (e.g., duplicate migration names):

```typescript
import { BadRequestError } from '@kysera/migrations'

try {
  createMigrationRunner(db, [
    createMigration('001_users', ...),
    createMigration('001_users', ...), // Duplicate!
  ])
} catch (error) {
  if (error instanceof BadRequestError) {
    console.log(error.message) // "Duplicate migration name: 001_users"
    console.log(error.code)    // "BAD_REQUEST"
  }
}
```

### NotFoundError

Uses `NotFoundError` from `@kysera/core`:

```typescript
import { NotFoundError } from '@kysera/migrations'

try {
  await runner.upTo('nonexistent_migration')
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log(error.message) // "Migration not found"
  }
}
```

## Best Practices

### 1. Use Numeric Prefixes

```typescript
// Good - clear ordering
'001_create_users'
'002_create_posts'
'003_add_indexes'

// Bad - no guaranteed order
'create_users'
'create_posts'
```

### 2. Always Provide down() Methods

```typescript
createMigration(
  '001_create_users',
  async (db) => { /* up */ },
  async (db) => { /* down - always provide this! */ }
)
```

### 3. Use Metadata for Complex Migrations

```typescript
createMigrationWithMeta('005_big_refactor', {
  description: 'Refactors user permissions system',
  breaking: true,  // Will show warning
  tags: ['breaking', 'permissions'],
  up: async (db) => { /* ... */ },
})
```

### 4. Test with Dry Run First

```typescript
// Preview in production
await runMigrations(db, migrations, { dryRun: true })

// Then run for real
await runMigrations(db, migrations)
```

### 5. Use Transactions for Safety

```typescript
const runner = createMigrationRunner(db, migrations, {
  useTransactions: true,  // Each migration wrapped in transaction
})
```

## Migration Script Example

```typescript
// scripts/migrate.ts
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { runMigrations, rollbackMigrations, getMigrationStatus, defineMigrations } from '@kysera/migrations'

const migrations = defineMigrations({
  // ... your migrations
})

async function main() {
  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: process.env.DATABASE_URL })
    })
  })

  const command = process.argv[2]

  try {
    switch (command) {
      case 'up':
        console.log('Running migrations...')
        const upResult = await runMigrations(db, migrations)
        console.log(`Executed: ${upResult.executed.length} migrations`)
        break

      case 'down':
        const steps = parseInt(process.argv[3] || '1')
        console.log(`Rolling back ${steps} migration(s)...`)
        await rollbackMigrations(db, migrations, steps)
        break

      case 'status':
        await getMigrationStatus(db, migrations)
        break

      case 'dry-run':
        console.log('Dry run mode...')
        await runMigrations(db, migrations, { dryRun: true })
        break

      default:
        console.log('Usage: pnpm migrate [up|down|status|dry-run] [steps]')
    }
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
    "migrate": "tsx scripts/migrate.ts up",
    "migrate:down": "tsx scripts/migrate.ts down",
    "migrate:status": "tsx scripts/migrate.ts status",
    "migrate:dry-run": "tsx scripts/migrate.ts dry-run"
  }
}
```

## Multi-Database Support

### PostgreSQL

```typescript
createMigration(
  '001_create_users',
  async (db) => {
    await db.schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('created_at', 'timestamp', col =>
        col.notNull().defaultTo(db.fn('now'))
      )
      .execute()
  }
)
```

### MySQL

```typescript
createMigration(
  '001_create_users',
  async (db) => {
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col =>
        col.primaryKey().autoIncrement()
      )
      .addColumn('created_at', 'datetime', col =>
        col.notNull().defaultTo(db.fn('now'))
      )
      .execute()
  }
)
```

### SQLite

```typescript
createMigration(
  '001_create_users',
  async (db) => {
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col =>
        col.primaryKey().autoIncrement()
      )
      .addColumn('created_at', 'text', col =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute()
  }
)
```

## Changelog

### v0.5.1

- **Breaking** `MigrationError` now extends `DatabaseError` from `@kysera/core` with `code` property
- **Breaking** `onMigrationError` hook now receives `error: unknown` (consistent with repository Plugin)
- **Breaking** `createMigrationRunnerWithPlugins()` is now async (returns `Promise<MigrationRunnerWithPlugins>`)
- **Added** `onInit` hook to `MigrationPlugin` interface (consistent with repository Plugin)
- **Added** `MigrationErrorCode` type export
- **Added** `MigrationDefinition` and `MigrationDefinitions` type exports
- **Added** `MigrationRunnerWithPluginsOptions` interface export
- **Added** `DatabaseError` and `BadRequestError` re-exports from `@kysera/core`
- **Changed** Validation errors now throw `BadRequestError` instead of generic `Error`

### v0.5.0

- **Added** `@kysera/core` integration with typed errors
- **Added** `MigrationWithMeta` support with description, breaking flag, tags
- **Added** `defineMigrations()` for object-based syntax
- **Added** `runMigrations()`, `rollbackMigrations()`, `getMigrationStatus()` one-liners
- **Added** `MigrationResult` return type for all operations
- **Added** Plugin system with `MigrationPlugin` interface
- **Added** Built-in `createLoggingPlugin()` and `createMetricsPlugin()`
- **Added** `MigrationError` class for better error handling
- **Added** Duplicate migration name validation
- **Added** `useTransactions` option for transaction wrapping
- **Added** `stopOnError` option for error handling control
- **Fixed** Inconsistent dry run behavior in `reset()` and `upTo()`
- **Fixed** `MigrationStatus` now includes `total` count

### v0.4.1

- Initial release

## Related Packages

- [`@kysera/core`](../kysera-core) - Core utilities and error handling
- [`@kysera/repository`](../kysera-repository) - Repository pattern implementation
- [`@kysera/audit`](../kysera-audit) - Audit logging plugin
- [`@kysera/soft-delete`](../kysera-soft-delete) - Soft delete plugin
- [`@kysera/timestamps`](../kysera-timestamps) - Automatic timestamp management

## License

MIT
