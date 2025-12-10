---
sidebar_position: 5
title: db
description: Database utility commands
---

# kysera db

Database management utilities.

## Commands

| Command | Description |
|---------|-------------|
| `seed` | Run database seeders |
| `reset` | Truncate all tables |
| `tables` | List database tables |
| `dump` | Export database schema and data |
| `restore` | Restore database from dump |
| `introspect` | Analyze database schema |
| `console` | Interactive database console |

### seed

Run database seeders.

```bash
kysera db seed
```

**Options:**
```
-f, --file <path>         Specific seed file to run
-d, --directory <path>    Seed directory (default: ./seeds)
--fresh                   Truncate tables before seeding
--dry-run                 Show what would execute
--transaction             Run in single transaction
-v, --verbose             Detailed output
```

**Examples:**
```bash
# Run all seeds
kysera db seed

# Run specific seed file
kysera db seed --file seeds/users.ts

# Fresh seed (truncate first)
kysera db seed --fresh

# Preview
kysera db seed --dry-run
```

### reset

Truncate all tables.

```bash
kysera db reset
```

**Options:**
```
--force                   Skip confirmation
--exclude <tables>        Tables to exclude
```

### tables

List database tables.

```bash
kysera db tables
```

**Options:**
```
--json                    Output as JSON
-v, --verbose             Show column details
```

**Output:**
```
Database Tables
===============

users (4 columns)
  id          serial       PRIMARY KEY
  email       varchar(255) NOT NULL UNIQUE
  name        varchar(100) NOT NULL
  created_at  timestamp    NOT NULL

posts (5 columns)
  id          serial       PRIMARY KEY
  user_id     integer      REFERENCES users(id)
  title       varchar(255) NOT NULL
  content     text
  created_at  timestamp    NOT NULL

Total: 2 tables
```

### dump

Export database schema and data.

```bash
kysera db dump
```

**Options:**
```
-o, --output <path>       Output file path
--schema-only             Export schema only
--data-only               Export data only
--format <type>           Format: sql, json
--tables <list>           Specific tables
```

**Examples:**
```bash
# Full dump
kysera db dump -o backup.sql

# Schema only
kysera db dump --schema-only -o schema.sql

# Data only as JSON
kysera db dump --data-only --format json -o data.json
```

### restore

Restore database from dump.

```bash
kysera db restore
```

**Options:**
```
-f, --file <path>         Dump file to restore
--clean                   Drop tables before restore
--verify                  Verify after restore
```

### introspect

Analyze database schema.

```bash
kysera db introspect
```

Generates TypeScript interfaces from existing database.

### console

Interactive database console.

```bash
kysera db console
```

Opens a REPL for executing SQL queries.

## Seed File Structure

```typescript
// seeds/users.ts
import { Kysely } from 'kysely'

export async function seed(db: Kysely<any>): Promise<void> {
  await db.insertInto('users')
    .values([
      { email: 'admin@example.com', name: 'Admin' },
      { email: 'user@example.com', name: 'User' }
    ])
    .execute()
}
```

## Best Practices

### 1. Use Transactions for Seeds

```bash
kysera db seed --transaction
```

### 2. Order Seed Files

```
seeds/
├── 01_users.ts
├── 02_posts.ts
└── 03_comments.ts
```

### 3. Backup Before Reset

```bash
kysera db dump -o backup.sql
kysera db reset --force
```
