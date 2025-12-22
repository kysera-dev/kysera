---
sidebar_position: 3
title: migrate
description: Database migration commands
---

# kysera migrate

Database migration management commands.

## Commands

### create

Create a new migration file.

```bash
kysera migrate create <name>
```

**Options:**
```
-d, --dir <path>           Migration directory (default: ./migrations)
-t, --template <type>      Template type
--ts                       Generate TypeScript (default: true)
--table <name>             Table name for templates
--columns <list>           Columns (name:type:nullable:default)
```

**Templates:**
- `default` - Empty up/down functions
- `create-table` - Create table skeleton
- `alter-table` - Alter table skeleton
- `add-columns` - Add columns
- `drop-columns` - Drop columns
- `create-index` - Create index
- `add-foreign-key` - Add foreign key

**Examples:**
```bash
# Basic migration
kysera migrate create add_users_table

# With template
kysera migrate create create_posts --template create-table --table posts

# Add columns
kysera migrate create add_email --template add-columns --table users
```

### up

Run pending migrations.

```bash
kysera migrate up
```

**Options:**
```
-t, --to <migration>      Migrate up to specific migration
-s, --steps <number>      Number of migrations to run
--dry-run                 Preview without executing
--force                   Force execution
-v, --verbose             Detailed output
-c, --config <path>       Path to configuration file
```

**Examples:**
```bash
# Run all pending
kysera migrate up

# Run next 2 migrations
kysera migrate up --steps 2

# Run up to specific version
kysera migrate up --to 20251003_add_posts

# Preview changes
kysera migrate up --dry-run
```

### down

Rollback migrations.

```bash
kysera migrate down
```

**Options:**
```
-s, --steps <number>      Migrations to rollback (default: 1)
-t, --to <migration>      Rollback to specific migration
--all                     Rollback all migrations
--dry-run                 Preview without executing
--force                   Skip confirmation
-v, --verbose             Detailed output
```

**Examples:**
```bash
# Rollback last migration
kysera migrate down

# Rollback 3 migrations
kysera migrate down --steps 3

# Rollback all (requires --force)
kysera migrate down --all --force

# Preview rollback
kysera migrate down --dry-run
```

### status

Show migration status.

```bash
kysera migrate status
```

**Options:**
```
--json                    Output as JSON
-v, --verbose             Show detailed table
```

**Output:**
```
Migration Status
================

Executed:
  ✓ 001_create_users           2024-01-15 10:30:00
  ✓ 002_create_posts           2024-01-15 10:31:00

Pending:
  ○ 003_add_comments
  ○ 004_add_indexes

Total: 4 | Executed: 2 | Pending: 2
```

### list

List all migration files.

```bash
kysera migrate list
```

### reset

Rollback all migrations and clear table.

```bash
kysera migrate reset
```

**Options:**
```
--force                   Skip confirmation prompt
--run                     Re-run migrations after reset
--seed                    Run seeds after reset
-c, --config <path>       Path to configuration file
-v, --verbose             Show detailed output
```

### fresh

Drop all tables and re-run all migrations.

```bash
kysera migrate fresh
```

**Options:**
```
--seed                    Run seeds after migration
--force                   Skip confirmation prompt
-c, --config <path>       Path to configuration file
-v, --verbose             Show detailed output
```

**Examples:**
```bash
# Fresh migration (requires confirmation)
kysera migrate fresh

# Fresh migration with seeds
kysera migrate fresh --seed

# Skip confirmation
kysera migrate fresh --force
```

## Migration File Structure

```typescript
// migrations/001_create_users.ts
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('email', 'varchar(255)', col => col.notNull().unique())
    .addColumn('name', 'varchar(100)', col => col.notNull())
    .addColumn('created_at', 'timestamp', col =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('users').execute()
}
```

## Best Practices

### 1. Name Migrations Descriptively

```
001_create_users_table
002_add_email_index_to_users
003_create_posts_with_user_fk
```

### 2. Always Test Down Migrations

```bash
kysera migrate up
kysera migrate down
kysera migrate up
```

### 3. Use Dry Run

```bash
kysera migrate up --dry-run
kysera migrate down --dry-run
```

### 4. Keep Migrations Small

One logical change per migration file.
