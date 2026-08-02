---
sidebar_position: 4
title: '@kysera/migrations'
description: Migration system API reference
---

# @kysera/migrations

Lightweight, type-safe database migration system.

## Installation

```bash
npm install @kysera/migrations kysely zod
```

## Overview

**Dependencies:** @kysera/core
**Peer Dependencies:** kysely >=0.29.0 and zod ^4.3.6 — both required

The Zod option schemas (`MigrationRunnerOptionsSchema`, `MigrationDefinitionSchema`,
`MigrationPluginOptionsSchema`, `MigrationPluginSchema`, `MigrationStatusSchema`,
`MigrationResultSchema`, `MigrationRunnerWithPluginsOptionsSchema`) are exported
from the package root together with their Input/Output types and the
`parseMigrationRunnerOptions` / `safeParseMigrationRunnerOptions` /
`parseMigrationDefinition` / `safeParseMigrationDefinition` helpers. The same
schemas are also available via the `@kysera/migrations/schemas` subpath export
for tooling that validates migration configuration.

## Creating Migrations

### createMigration

Create a simple migration.

{/* doc-snippet: skip */}
```typescript
function createMigration(
  name: string,
  up: (db: Kysely<any>) => Promise<void>,
  down?: (db: Kysely<any>) => Promise<void>
): Migration

interface Migration {
  name: string
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
}
```

### Example

```typescript
import { createMigration } from '@kysera/migrations'
import { sql } from 'kysely'

const migrations = [
  createMigration(
    '001_create_users',
    async db => {
      await db.schema
        .createTable('users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('email', 'varchar(255)', col => col.notNull().unique())
        .addColumn('name', 'varchar(100)', col => col.notNull())
        .addColumn('created_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .execute()
    },
    async db => {
      await db.schema.dropTable('users').execute()
    }
  )
]
```

### createMigrationWithMeta

Create a migration with metadata.

{/* doc-snippet: skip */}
```typescript
function createMigrationWithMeta(
  name: string,
  options: {
    up: (db: Kysely<any>) => Promise<void>
    down?: (db: Kysely<any>) => Promise<void>
    description?: string
    breaking?: boolean
    estimatedDuration?: number
    tags?: string[]
  }
): MigrationWithMeta
```

### defineMigrations

Define multiple migrations concisely.

{/* doc-snippet: skip */}
```typescript
function defineMigrations(definitions: MigrationDefinitions): MigrationWithMeta[]

type MigrationDefinitions = Record<string, MigrationDefinition>
```

### Example

{/* doc-snippet: skip */}
```typescript
const migrations = defineMigrations({
  '001_create_users': {
    description: 'Create users table',
    up: async (db) => {
      await db.schema.createTable('users')./* ... */.execute()
    },
    down: async (db) => {
      await db.schema.dropTable('users').execute()
    }
  },
  '002_add_posts': {
    description: 'Create posts table',
    breaking: false,
    up: async (db) => { /* ... */ },
    down: async (db) => { /* ... */ }
  }
})
```

## Setup

### setupMigrations

Create the `migrations` bookkeeping table (`name` primary key + `executed_at`).
Idempotent — safe to run multiple times. The migration runner calls it
automatically before its first database access, so calling it yourself is only
needed for custom tooling.

{/* doc-snippet: skip */}
```typescript
async function setupMigrations(db: Kysely<unknown>): Promise<void>
```

## Migration Runner

### createMigrationRunner

Create a migration runner.

{/* doc-snippet: skip */}
```typescript
function createMigrationRunner(
  db: Kysely<any>,
  migrations: Migration[],
  options?: MigrationRunnerOptions
): MigrationRunner

interface MigrationRunnerOptions {
  dryRun?: boolean
  logger?: KyseraLogger
  useTransactions?: boolean
  stopOnError?: boolean
  verbose?: boolean
  /** Serialize concurrent runners via a database advisory lock (default: true) */
  advisoryLock?: boolean
  /** How long to wait for the advisory lock before failing (default: 60000) */
  lockTimeoutMs?: number
}
```

With `advisoryLock` enabled (the default), concurrent `up()` runs from several
application instances are serialized through a database advisory lock; a
runner that cannot acquire the lock within `lockTimeoutMs` throws
`MigrationLockError`. The lock is skipped for dry runs.

Advisory locking is implemented for **PostgreSQL** (`pg_try_advisory_lock`),
**MySQL** (`GET_LOCK`), and **MSSQL** (`sp_getapplock` with
`@LockOwner = 'Session'`, so the lock survives across the runner's individual
statements and is released with `sp_releaseapplock`). Acquire and release are
pinned to a single pooled connection on every dialect — advisory locks are
session-scoped. On SQLite the option is a no-op (single-writer by design).

MSSQL maps `sp_getapplock` result codes as follows: `0`/`1` (granted, granted
after waiting) succeed; `-1` (timeout after `lockTimeoutMs`) throws
`MigrationLockError`; `-2` (canceled), `-3` (deadlock victim), and `-999`
(invalid call) throw `DatabaseError` naming the code.

### Runner Methods

{/* doc-snippet: skip */}
```typescript
class MigrationRunner {
  // Run all pending migrations
  async up(): Promise<MigrationResult>

  // Rollback migrations (default: 1 step)
  async down(steps = 1): Promise<MigrationResult>

  // Get status
  async status(): Promise<MigrationStatus>

  // Reset all migrations
  async reset(): Promise<MigrationResult>

  // Run up to specific migration
  async upTo(targetName: string): Promise<MigrationResult>

  // Get executed migrations
  async getExecutedMigrations(): Promise<string[]>

  // Manual marking
  async markAsExecuted(name: string): Promise<void>
  async markAsRolledBack(name: string): Promise<void>
}
```

### MigrationResult

```typescript
interface MigrationResult {
  executed: string[]
  skipped: string[]
  failed: string[]
  duration: number
  dryRun: boolean
}
```

### MigrationStatus

```typescript
interface MigrationStatus {
  executed: string[]
  pending: string[]
  total: number
}
```

### Example

```typescript
import { createMigrationRunner } from '@kysera/migrations'

const runner = createMigrationRunner(db, migrations, {
  verbose: true
})

// Run all pending
const result = await runner.up()
console.log(`Executed: ${result.executed.join(', ')}`)

// Check status
const status = await runner.status()
console.log(`Pending: ${status.pending.length}`)

// Rollback last migration
await runner.down(1)

// Reset all
await runner.reset()
```

## One-Liner Functions

### runMigrations

{/* doc-snippet: skip */}
```typescript
async function runMigrations(
  db: Kysely<any>,
  migrations: Migration[],
  options?: MigrationRunnerOptions
): Promise<MigrationResult>
```

### rollbackMigrations

{/* doc-snippet: skip */}
```typescript
async function rollbackMigrations(
  db: Kysely<any>,
  migrations: Migration[],
  steps?: number,
  options?: MigrationRunnerOptions
): Promise<MigrationResult>
```

### getMigrationStatus

{/* doc-snippet: skip */}
```typescript
async function getMigrationStatus(
  db: Kysely<any>,
  migrations: Migration[],
  options?: Pick<MigrationRunnerOptions, 'logger' | 'verbose'>
): Promise<MigrationStatus>
```

### Example

```typescript
// Quick usage
await runMigrations(db, migrations)
await rollbackMigrations(db, migrations, 1)
const status = await getMigrationStatus(db, migrations)
```

## Dry Run

Preview migrations without executing:

```typescript
const result = await runMigrations(db, migrations, { dryRun: true })
console.log('Would execute:', result.executed)
```

## Plugin System

### MigrationPlugin

```typescript
interface MigrationPlugin {
  name: string
  version: string
  onInit?(runner: MigrationRunner): Promise<void> | void
  beforeMigration?(migration: Migration, operation: 'up' | 'down'): Promise<void> | void
  afterMigration?(
    migration: Migration,
    operation: 'up' | 'down',
    duration: number
  ): Promise<void> | void
  onMigrationError?(
    migration: Migration,
    operation: 'up' | 'down',
    error: unknown
  ): Promise<void> | void
}
```

### Built-in Plugins

```typescript
// Logging plugin
const loggingPlugin = createLoggingPlugin(logger)

// Metrics plugin
const metricsPlugin = createMetricsPlugin()
```

### createMigrationRunnerWithPlugins

Async factory that awaits each plugin's `onInit` hook and returns a
`MigrationRunnerWithPlugins` instance.

{/* doc-snippet: skip */}
```typescript
async function createMigrationRunnerWithPlugins<DB = unknown>(
  db: Kysely<DB>,
  migrations: Migration<DB>[],
  options?: MigrationRunnerWithPluginsOptions<DB>
): Promise<MigrationRunnerWithPlugins<DB>>

interface MigrationRunnerWithPluginsOptions<DB = unknown> extends MigrationRunnerOptions {
  /** Plugins to apply */
  plugins?: MigrationPlugin<DB>[]
}
```

### MigrationRunnerWithPlugins

Subclass of `MigrationRunner` that overrides `up()` and `down()` to invoke the
plugin lifecycle hooks (`beforeMigration`, `afterMigration`,
`onMigrationError`) around each migration. All other runner methods are
inherited unchanged.

{/* doc-snippet: skip */}
```typescript
class MigrationRunnerWithPlugins<DB = unknown> extends MigrationRunner<DB> {
  constructor(db: Kysely<DB>, migrations: Migration<DB>[], options?: MigrationRunnerWithPluginsOptions<DB>)

  // Returns a copy of the registered plugin list
  getPlugins(): MigrationPlugin<DB>[]
}
```

### Usage

```typescript
import { createMigrationRunnerWithPlugins, createLoggingPlugin } from '@kysera/migrations'

const runner = await createMigrationRunnerWithPlugins(db, migrations, {
  plugins: [createLoggingPlugin()]
})

runner.getPlugins() // => [loggingPlugin]
```

## Error Handling

```typescript
import { MigrationError, MigrationLockError } from '@kysera/migrations'

try {
  await runner.up()
} catch (error) {
  if (error instanceof MigrationLockError) {
    // Another instance holds the migration advisory lock and did not release
    // it within lockTimeoutMs. Increase lockTimeoutMs, or set
    // advisoryLock: false to bypass (unsafe with concurrent runners).
    console.error(error.message)
  } else if (error instanceof MigrationError) {
    console.error(`Migration ${error.migrationName} failed:`, error.cause)
    console.error(`Operation: ${error.operation}`)
  }
}
```

### Error Codes

`MigrationError.code` uses the unified codes from `@kysera/core`:

```typescript
import { MigrationErrorCodes, type MigrationErrorCode } from '@kysera/migrations'

MigrationErrorCodes.UP_FAILED         // ErrorCodes.MIGRATION_UP_FAILED
MigrationErrorCodes.DOWN_FAILED       // ErrorCodes.MIGRATION_DOWN_FAILED
MigrationErrorCodes.VALIDATION_FAILED // ErrorCodes.MIGRATION_VALIDATION_FAILED
```

### Core Errors

The package root re-exports `DatabaseError`, `NotFoundError`,
`BadRequestError`, `silentLogger`, and the `KyseraLogger` type from
`@kysera/core`. Besides `MigrationError` and `MigrationLockError`, the runner
throws:

- `BadRequestError` — invalid runner options or duplicate migration names
- `NotFoundError` — `upTo(targetName)` names a migration that doesn't exist

## Best Practices

### 1. Name Migrations Sequentially

```
001_create_users.ts
002_create_posts.ts
003_add_email_to_users.ts
```

### 2. Always Include Down Migration

```typescript
createMigration(
  '001_create_users',
  async db => {
    /* up */
  },
  async db => {
    /* down - always include! */
  }
)
```

### 3. Use Dry Run First

```typescript
// Preview changes with dry run runner
const dryRunner = createMigrationRunner(db, migrations, { dryRun: true })
await dryRunner.up()

// Then execute with normal runner
const runner = createMigrationRunner(db, migrations)
await runner.up()
```

### 4. Test Migrations

```typescript
it('should migrate up and down', async () => {
  await runner.up()
  const upStatus = await runner.status()
  expect(upStatus.pending).toHaveLength(0)

  await runner.down()
  const downStatus = await runner.status()
  expect(downStatus.pending).toHaveLength(migrations.length)
})
```
