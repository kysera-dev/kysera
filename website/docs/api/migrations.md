---
sidebar_position: 4
title: "@kysera/migrations"
description: Migration system API reference
---

# @kysera/migrations

Lightweight, type-safe database migration system.

## Installation

```bash
npm install @kysera/migrations
```

## Overview

**Version:** 0.7.0
**Bundle Size:** ~12 KB (minified)
**Dependencies:** @kysera/core

## Creating Migrations

### createMigration

Create a simple migration.

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
    async (db) => {
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
    async (db) => {
      await db.schema.dropTable('users').execute()
    }
  )
]
```

### createMigrationWithMeta

Create a migration with metadata.

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

```typescript
function defineMigrations(definitions: MigrationDefinitions): MigrationWithMeta[]

type MigrationDefinitions = Record<string, MigrationDefinition>
```

### Example

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

## Migration Runner

### createMigrationRunner

Create a migration runner.

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
}
```

### Runner Methods

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

```typescript
async function runMigrations(
  db: Kysely<any>,
  migrations: Migration[],
  options?: MigrationRunnerOptions
): Promise<MigrationResult>
```

### rollbackMigrations

```typescript
async function rollbackMigrations(
  db: Kysely<any>,
  migrations: Migration[],
  steps?: number,
  options?: MigrationRunnerOptions
): Promise<MigrationResult>
```

### getMigrationStatus

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
  afterMigration?(migration: Migration, operation: 'up' | 'down', duration: number): Promise<void> | void
  onMigrationError?(migration: Migration, operation: 'up' | 'down', error: unknown): Promise<void> | void
}
```

### Built-in Plugins

```typescript
// Logging plugin
const loggingPlugin = createLoggingPlugin(logger)

// Metrics plugin
const metricsPlugin = createMetricsPlugin()
```

### Usage

```typescript
import { createMigrationRunnerWithPlugins, createLoggingPlugin } from '@kysera/migrations'

const runner = await createMigrationRunnerWithPlugins(db, migrations, {
  plugins: [createLoggingPlugin()]
})
```

## Error Handling

```typescript
import { MigrationError } from '@kysera/migrations'

try {
  await runner.up()
} catch (error) {
  if (error instanceof MigrationError) {
    console.error(`Migration ${error.migrationName} failed:`, error.cause)
    console.error(`Operation: ${error.operation}`)
  }
}
```

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
  async (db) => { /* up */ },
  async (db) => { /* down - always include! */ }
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
