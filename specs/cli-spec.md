# Kysera CLI Specification

> Comprehensive command-line interface for Kysera ORM - Database automation, migration management, monitoring, and development tools.

**Version:** 1.0.0
**Status:** Design Specification
**Last Updated:** 2025-10-01

---

## 📋 Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Commands](#commands)
  - [kysera init](#kysera-init)
  - [kysera migrate](#kysera-migrate)
  - [kysera health](#kysera-health)
  - [kysera audit](#kysera-audit)
  - [kysera generate](#kysera-generate)
  - [kysera db](#kysera-db)
  - [kysera test](#kysera-test)
  - [kysera plugin](#kysera-plugin)
- [Configuration File](#configuration-file)
- [Plugin System](#plugin-system)
- [Environment Variables](#environment-variables)
- [Examples](#examples)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

---

## 🎯 Overview

Kysera CLI is a comprehensive command-line tool that provides automation and management capabilities for Kysera ORM applications. It integrates all Kysera packages:

- **@kysera/core** - Error handling, health checks, pagination, retry logic
- **@kysera/repository** - Repository pattern, CRUD operations, validation
- **@kysera/migrations** - Migration management with rollback support
- **@kysera/audit** - Audit logging and history tracking
- **@kysera/soft-delete** - Soft delete functionality
- **@kysera/timestamps** - Automatic timestamp management

### Key Features

- 🚀 **Project Scaffolding** - Initialize new Kysera projects with best practices
- 🔄 **Migration Management** - Create, run, rollback, and manage database migrations
- 💊 **Health Monitoring** - Check database health and connection pool status
- 📊 **Audit Querying** - Query and analyze audit logs
- ⚡ **Code Generation** - Generate repositories, migrations, and schemas
- 🧪 **Testing Utilities** - Database testing and seeding tools
- 🔌 **Plugin Management** - Enable/disable and configure Kysera plugins

---

## 📥 Installation

### Global Installation

```bash
# npm
npm install -g @kysera/cli

# pnpm
pnpm add -g @kysera/cli

# yarn
yarn global add @kysera/cli

# bun
bun add -g @kysera/cli
```

### Project Installation

```bash
# npm
npm install --save-dev @kysera/cli

# pnpm
pnpm add -D @kysera/cli

# yarn
yarn add -D @kysera/cli

# bun
bun add -d @kysera/cli
```

### Verify Installation

```bash
kysera --version
# @kysera/cli v1.0.0

kysera --help
# Displays available commands
```

---

## 🏗️ Architecture

```
kysera-cli/
├── src/
│   ├── commands/
│   │   ├── init/             # Project initialization
│   │   ├── migrate/          # Migration management
│   │   ├── health/           # Health checks
│   │   ├── audit/            # Audit log queries
│   │   ├── generate/         # Code generation
│   │   ├── db/               # Database utilities
│   │   ├── test/             # Testing tools
│   │   └── plugin/           # Plugin management
│   ├── config/
│   │   ├── loader.ts         # Configuration loader
│   │   └── validator.ts      # Config validation
│   ├── utils/
│   │   ├── database.ts       # Database connection
│   │   ├── logger.ts         # CLI logging
│   │   ├── prompts.ts        # Interactive prompts
│   │   └── templates.ts      # Code templates
│   ├── types/
│   │   └── index.ts          # TypeScript types
│   └── index.ts              # CLI entry point
├── templates/                # Project templates
│   ├── project/
│   ├── migration/
│   ├── repository/
│   └── model/
└── package.json
```

### Technology Stack

- **CLI Framework**: [Commander.js](https://github.com/tj/commander.js) - Command-line interface
- **Prompts/Logging/Colors/Spinners**: [XecKit](https://www.npmjs.com/package/@xec-sh/kit?activeTab=readme) - Interactive prompts
- **Templates**: [Handlebars](https://handlebarsjs.com/) - Template engine
- **File System**: [fs-extra](https://github.com/jprichardson/node-fs-extra) - Enhanced file operations

---

## ⚙️ Configuration

### Configuration File: `kysera.config.ts`

```typescript
import { defineConfig } from '@kysera/cli'

export default defineConfig({
  // Database connection
  database: {
    // Connection can be a string or object
    connection: process.env.DATABASE_URL || {
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      user: 'postgres',
      password: 'postgres'
    },
    // Database dialect: 'postgres' | 'mysql' | 'sqlite'
    dialect: 'postgres',
    // Connection pool settings
    pool: {
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000
    }
  },

  // Migration settings
  migrations: {
    // Directory for migration files
    directory: './migrations',
    // Migration file naming pattern
    pattern: '{timestamp}_{name}.ts',
    // Table name for tracking migrations
    tableName: 'migrations',
    // Lock table to prevent concurrent migrations
    lockTable: true
  },

  // Plugin configuration
  plugins: {
    // Enable/disable plugins
    audit: {
      enabled: true,
      tables: ['users', 'posts', 'orders'],
      captureOldValues: true,
      captureNewValues: true
    },
    softDelete: {
      enabled: true,
      tables: ['users', 'posts', 'comments'],
      column: 'deleted_at'
    },
    timestamps: {
      enabled: true,
      tables: ['*'],
      createdAtColumn: 'created_at',
      updatedAtColumn: 'updated_at'
    }
  },

  // Code generation settings
  generate: {
    // Output directories
    repositories: './src/repositories',
    models: './src/models',
    migrations: './migrations',
    schemas: './src/schemas',
    // Code style
    style: {
      quotes: 'single',
      semi: false,
      indent: 2
    }
  },

  // Health check settings
  health: {
    // Health check interval in ms
    interval: 60000,
    // Slow query threshold in ms
    slowQueryThreshold: 100,
    // Enable metrics collection
    collectMetrics: true
  },

  // Testing settings
  testing: {
    // Test database connection
    database: process.env.TEST_DATABASE_URL,
    // Seed files directory
    seeds: './tests/seeds',
    // Fixtures directory
    fixtures: './tests/fixtures'
  }
})
```

---

## 📜 Commands

## kysera init

Initialize a new Kysera project with best practices and boilerplate code.

### Usage

```bash
kysera init [project-name] [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--template <name>` | `-t` | Project template | `basic` |
| `--database <dialect>` | `-d` | Database dialect (postgres/mysql/sqlite) | `postgres` |
| `--plugins <list>` | `-p` | Comma-separated list of plugins | `timestamps,soft-delete` |
| `--package-manager <pm>` | `-pm` | Package manager (npm/pnpm/yarn/bun) | `pnpm` |
| `--typescript` | `-ts` | Use TypeScript | `true` |
| `--git` | `-g` | Initialize git repository | `true` |
| `--install` | `-i` | Install dependencies | `true` |

### Templates

#### 1. `basic` - Basic Project

Minimal setup with core packages.

```
my-app/
├── src/
│   ├── database.ts           # Database connection
│   ├── repositories/         # Repository layer
│   └── index.ts              # Entry point
├── migrations/               # Database migrations
├── kysera.config.ts          # Kysera configuration
├── package.json
└── tsconfig.json
```

#### 2. `api` - REST API Project

Full-featured REST API with Express.

```
my-app/
├── src/
│   ├── database.ts
│   ├── repositories/
│   ├── services/             # Business logic
│   ├── controllers/          # API controllers
│   ├── middleware/           # Express middleware
│   ├── routes/               # API routes
│   └── index.ts
├── migrations/
├── tests/                    # Test files
├── kysera.config.ts
├── package.json
└── tsconfig.json
```

#### 3. `graphql` - GraphQL API Project

GraphQL API with Apollo Server.

```
my-app/
├── src/
│   ├── database.ts
│   ├── repositories/
│   ├── resolvers/            # GraphQL resolvers
│   ├── schema/               # GraphQL schema
│   ├── dataloaders/          # DataLoader instances
│   └── index.ts
├── migrations/
├── tests/
├── kysera.config.ts
├── package.json
└── tsconfig.json
```

#### 4. `monorepo` - Monorepo Setup

Multi-package monorepo with shared database layer.

```
my-monorepo/
├── apps/
│   ├── api/                  # API application
│   └── worker/               # Background worker
├── packages/
│   ├── database/             # Shared database layer
│   ├── repositories/         # Shared repositories
│   └── schemas/              # Shared schemas
├── migrations/
├── pnpm-workspace.yaml
├── turbo.json
└── kysera.config.ts
```

### Examples

```bash
# Basic project with PostgreSQL
kysera init my-app

# API project with MySQL
kysera init my-api --template api --database mysql

# GraphQL project with all plugins
kysera init my-graphql --template graphql --plugins audit,timestamps,soft-delete

# Monorepo with custom package manager
kysera init my-monorepo --template monorepo --package-manager pnpm

# Initialize in current directory
kysera init . --template basic

# Skip dependency installation
kysera init my-app --no-install

# Skip git initialization
kysera init my-app --no-git
```

### Interactive Mode

```bash
kysera init
# ? Project name: my-awesome-app
# ? Select template: (Use arrow keys)
#   ❯ basic - Basic project setup
#     api - REST API with Express
#     graphql - GraphQL API with Apollo
#     monorepo - Monorepo setup
# ? Select database: (Use arrow keys)
#   ❯ PostgreSQL
#     MySQL
#     SQLite
# ? Enable plugins: (Space to select, Enter to confirm)
#   ◉ Timestamps
#   ◉ Soft Delete
#   ◯ Audit Logging
# ? Package manager: pnpm
# ? Initialize git? (Y/n)
# ? Install dependencies? (Y/n)
#
# ✨ Creating project...
# 📦 Installing dependencies...
# ✅ Project created successfully!
#
# Next steps:
#   cd my-awesome-app
#   kysera migrate up
#   npm run dev
```

---

## kysera migrate

Manage database migrations with full rollback support.

### Usage

```bash
kysera migrate <command> [options]
```

### Subcommands

#### `kysera migrate create`

Create a new migration file.

```bash
kysera migrate create <name> [options]

Options:
  -d, --directory <path>    Migration directory (default: ./migrations)
  -t, --template <type>     Migration template (default: default)
  --ts                      Generate TypeScript file (default: true)
  --table <name>            Table name for table-based templates
  --columns <list>          Comma-separated column definitions
```

**Templates:**
- `default` - Empty migration template
- `create-table` - Create table migration
- `alter-table` - Alter table migration
- `add-columns` - Add columns migration
- `drop-columns` - Drop columns migration
- `create-index` - Create index migration
- `drop-index` - Drop index migration

**Examples:**

```bash
# Create empty migration
kysera migrate create add_user_roles

# Create table migration
kysera migrate create create_users_table --template create-table --table users

# Add columns migration
kysera migrate create add_user_columns \
  --template add-columns \
  --table users \
  --columns "bio:text,avatar_url:varchar(255)"

# Create index migration
kysera migrate create create_email_index \
  --template create-index \
  --table users \
  --columns "email"
```

**Generated File Example:**

```typescript
// migrations/20250101120000_add_user_roles.ts
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('role', 'varchar(50)', col => col.notNull().defaultTo('user'))
    .execute()

  await db.schema
    .createIndex('users_role_idx')
    .on('users')
    .column('role')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('users')
    .dropColumn('role')
    .execute()

  await db.schema
    .dropIndex('users_role_idx')
    .execute()
}
```

#### `kysera migrate up`

Run pending migrations.

```bash
kysera migrate up [options]

Options:
  -t, --to <migration>      Migrate up to specific migration
  -s, --steps <number>      Number of migrations to run (default: all)
  --dry-run                 Preview migrations without executing
  --force                   Force migration even if already executed
  -v, --verbose             Show detailed output
```

**Examples:**

```bash
# Run all pending migrations
kysera migrate up

# Run specific number of migrations
kysera migrate up --steps 2

# Migrate to specific migration
kysera migrate up --to 20250101120000_add_user_roles

# Dry run (preview only)
kysera migrate up --dry-run

# Verbose output
kysera migrate up --verbose
```

**Output:**

```
Running migrations...
↑ 001_create_users_table... ✓ (45ms)
↑ 002_create_posts_table... ✓ (32ms)
↑ 003_add_indexes... ✓ (18ms)

✅ 3 migrations completed successfully (95ms)
```

#### `kysera migrate down`

Rollback migrations.

```bash
kysera migrate down [options]

Options:
  -s, --steps <number>      Number of migrations to rollback (default: 1)
  -t, --to <migration>      Rollback to specific migration
  --all                     Rollback all migrations
  --dry-run                 Preview rollback without executing
  -v, --verbose             Show detailed output
```

**Examples:**

```bash
# Rollback last migration
kysera migrate down

# Rollback last 3 migrations
kysera migrate down --steps 3

# Rollback to specific migration
kysera migrate down --to 20250101100000_create_users

# Rollback all migrations
kysera migrate down --all

# Dry run
kysera migrate down --dry-run
```

**Output:**

```
Rolling back migrations...
↓ 003_add_indexes... ✓ (12ms)
↓ 002_create_posts_table... ✓ (28ms)

✅ 2 migrations rolled back successfully (40ms)
```

#### `kysera migrate status`

Show migration status.

```bash
kysera migrate status [options]

Options:
  --json                    Output as JSON
  -v, --verbose             Show detailed information
```

**Example:**

```bash
kysera migrate status
```

**Output:**

```
📊 Migration Status

Executed (3):
  ✓ 001_create_users_table       (2025-01-01 10:00:00)
  ✓ 002_create_posts_table       (2025-01-01 10:05:00)
  ✓ 003_add_indexes              (2025-01-01 10:10:00)

Pending (2):
  - 004_add_comments_table
  - 005_add_user_roles

Database: PostgreSQL 15.2
Connection: postgres://localhost:5432/myapp
```

#### `kysera migrate reset`

Reset all migrations (dangerous!).

```bash
kysera migrate reset [options]

Options:
  --force                   Skip confirmation prompt
  --seed                    Run seeds after reset
```

**Example:**

```bash
kysera migrate reset
# ⚠️  WARNING: This will rollback ALL migrations!
# ? Are you sure? (y/N)
```

#### `kysera migrate fresh`

Drop all tables and re-run migrations.

```bash
kysera migrate fresh [options]

Options:
  --seed                    Run seeds after migration
  --force                   Skip confirmation prompt
```

**Example:**

```bash
kysera migrate fresh --seed
# ⚠️  WARNING: This will DROP ALL TABLES!
# ? Are you sure? (y/N)
```

#### `kysera migrate list`

List all migrations.

```bash
kysera migrate list [options]

Options:
  --pending                 Show only pending migrations
  --executed                Show only executed migrations
  --json                    Output as JSON
```

---

## kysera health

Monitor database health and performance.

### Usage

```bash
kysera health [command] [options]
```

### Subcommands

#### `kysera health check`

Perform a health check.

```bash
kysera health check [options]

Options:
  --json                    Output as JSON
  --watch                   Watch mode (continuous monitoring)
  --interval <ms>           Check interval in ms (default: 5000)
  -v, --verbose             Show detailed metrics
```

**Example:**

```bash
kysera health check
```

**Output:**

```
🏥 Database Health Check

Status: ✅ Healthy

Connection:
  ✓ Database connected
  ✓ Latency: 2ms
  ✓ Version: PostgreSQL 15.2

Pool:
  Active: 3/10
  Idle: 7
  Waiting: 0

Queries (last 1m):
  Total: 1,234
  Avg: 15ms
  Slow (>100ms): 5
  Errors: 0

Last check: 2025-01-01 12:00:00
```

#### `kysera health watch`

Continuous health monitoring.

```bash
kysera health watch [options]

Options:
  --interval <ms>           Check interval in ms (default: 5000)
  --json                    Output as JSON
  --log <file>              Log to file
```

**Example:**

```bash
kysera health watch --interval 10000
```

**Output:**

```
🔍 Watching database health (Ctrl+C to stop)

12:00:00 | ✅ Healthy | Latency: 2ms | Pool: 3/10 | Queries: 45
12:00:10 | ✅ Healthy | Latency: 3ms | Pool: 4/10 | Queries: 52
12:00:20 | ⚠️  Warning | Latency: 150ms | Pool: 8/10 | Queries: 89
12:00:30 | ✅ Healthy | Latency: 2ms | Pool: 5/10 | Queries: 61
```

#### `kysera health metrics`

Show detailed metrics.

```bash
kysera health metrics [options]

Options:
  --period <duration>       Time period (1m, 5m, 1h, 1d) (default: 1h)
  --json                    Output as JSON
  --export <file>           Export metrics to file
```

**Example:**

```bash
kysera health metrics --period 1h
```

**Output:**

```
📊 Database Metrics (Last 1 hour)

Query Performance:
  Total queries: 45,678
  Avg duration: 12ms
  P50: 8ms
  P95: 45ms
  P99: 120ms
  Slow queries (>100ms): 234 (0.5%)

Connection Pool:
  Avg active: 4.2/10
  Avg idle: 5.8
  Max waiting: 3
  Timeouts: 0

Error Rate:
  Total errors: 12
  Connection errors: 0
  Query errors: 12
  Error rate: 0.03%

Top Slow Queries:
  1. SELECT * FROM users WHERE ... (avg: 234ms, count: 45)
  2. SELECT * FROM posts WHERE ... (avg: 189ms, count: 32)
  3. SELECT * FROM comments WHERE ... (avg: 156ms, count: 28)
```

---

## kysera audit

Query and analyze audit logs.

### Usage

```bash
kysera audit <command> [options]
```

### Subcommands

#### `kysera audit logs`

Query audit logs.

```bash
kysera audit logs [options]

Options:
  --table <name>            Filter by table name
  --operation <type>        Filter by operation (INSERT/UPDATE/DELETE)
  --user <id>               Filter by user ID
  --entity <id>             Filter by entity ID
  --from <date>             Start date (ISO format or relative: 1h, 1d, 1w)
  --to <date>               End date (ISO format or relative)
  --limit <number>          Number of records (default: 100)
  --format <type>           Output format (table/json/csv) (default: table)
  --export <file>           Export to file
```

**Examples:**

```bash
# Recent audit logs
kysera audit logs --limit 50

# Logs for specific table
kysera audit logs --table users

# Logs for specific operation
kysera audit logs --operation DELETE --table users

# Logs by user
kysera audit logs --user admin-123

# Logs in time range
kysera audit logs --from 1h --to now

# Logs for specific entity
kysera audit logs --table users --entity 42

# Export to CSV
kysera audit logs --table orders --format csv --export orders_audit.csv
```

**Output:**

```
📋 Audit Logs (50 results)

┌────────┬────────────┬───────────┬──────────┬──────────────────────┬──────────────┐
│ ID     │ Table      │ Entity ID │ Operation│ Changed At           │ Changed By   │
├────────┼────────────┼───────────┼──────────┼──────────────────────┼──────────────┤
│ 10045  │ users      │ 123       │ UPDATE   │ 2025-01-01 12:00:00  │ admin-42     │
│ 10044  │ posts      │ 456       │ INSERT   │ 2025-01-01 11:55:00  │ user-89      │
│ 10043  │ users      │ 789       │ DELETE   │ 2025-01-01 11:50:00  │ admin-42     │
└────────┴────────────┴───────────┴──────────┴──────────────────────┴──────────────┘
```

#### `kysera audit history`

Show entity history.

```bash
kysera audit history <table> <entity-id> [options]

Options:
  --format <type>           Output format (table/json/timeline) (default: timeline)
  --show-values             Show old/new values
  --limit <number>          Number of records (default: 50)
```

**Example:**

```bash
kysera audit history users 123 --show-values
```

**Output:**

```
📜 Entity History: users #123

2025-01-01 12:00:00 | UPDATE | admin-42
  name: "John Doe" → "Jane Doe"
  email: "john@example.com" → "jane@example.com"

2025-01-01 10:00:00 | UPDATE | user-123
  status: "active" → "inactive"

2024-12-31 15:00:00 | INSERT | system
  Created with:
    name: "John Doe"
    email: "john@example.com"
    status: "active"
```

#### `kysera audit restore`

Restore entity from audit log.

```bash
kysera audit restore <audit-log-id> [options]

Options:
  --dry-run                 Preview restore without executing
  --force                   Skip confirmation prompt
```

**Example:**

```bash
kysera audit restore 10043
# This will restore entity from audit log #10043
# ? Are you sure? (y/N)
```

#### `kysera audit stats`

Show audit statistics.

```bash
kysera audit stats [options]

Options:
  --table <name>            Filter by table
  --user <id>               Filter by user
  --period <duration>       Time period (1h, 1d, 1w, 1m) (default: 1d)
  --format <type>           Output format (table/json/chart) (default: table)
```

**Example:**

```bash
kysera audit stats --period 1w
```

**Output:**

```
📊 Audit Statistics (Last 7 days)

Operations by Type:
  INSERT: 1,234 (45%)
  UPDATE: 1,089 (40%)
  DELETE: 411 (15%)

Top Modified Tables:
  users: 567 changes
  posts: 423 changes
  comments: 389 changes
  orders: 234 changes

Top Users:
  admin-42: 678 changes
  user-123: 456 changes
  system: 234 changes

Changes Over Time:
  2025-01-01: 456 changes ████████████████████
  2024-12-31: 389 changes ████████████████
  2024-12-30: 423 changes ██████████████████
  2024-12-29: 367 changes ███████████████
```

#### `kysera audit cleanup`

Clean up old audit logs.

```bash
kysera audit cleanup [options]

Options:
  --older-than <duration>   Delete logs older than duration (30d, 3m, 1y)
  --table <name>            Clean specific table only
  --dry-run                 Preview cleanup without deleting
  --force                   Skip confirmation prompt
```

**Example:**

```bash
kysera audit cleanup --older-than 3m
# This will delete audit logs older than 3 months
# ? Are you sure? (y/N)
```

---

## kysera generate

Generate code (repositories, migrations, schemas, etc.).

### Usage

```bash
kysera generate <type> <name> [options]
```

### Types

#### `kysera generate repository`

Generate repository class.

```bash
kysera generate repository <name> [options]

Options:
  --table <name>            Database table name
  --model <path>            Model file path
  --schema <path>           Zod schema file path
  --output <path>           Output directory (default: ./src/repositories)
  --plugins <list>          Comma-separated plugins to enable
```

**Example:**

```bash
kysera generate repository User \
  --table users \
  --plugins timestamps,soft-delete,audit
```

**Generated File:**

```typescript
// src/repositories/user.repository.ts
import { createRepositoryFactory } from '@kysera/repository'
import { db } from '../database'
import { User } from '../models/user'
import { CreateUserSchema, UpdateUserSchema } from '../schemas/user.schema'

const factory = createRepositoryFactory(db)

export const userRepository = factory.create<'users', User>({
  tableName: 'users',
  mapRow: (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  }),
  schemas: {
    create: CreateUserSchema,
    update: UpdateUserSchema
  }
})
```

#### `kysera generate migration`

Generate migration file (alias for `kysera migrate create`).

```bash
kysera generate migration <name> [options]
```

#### `kysera generate model`

Generate TypeScript model/interface.

```bash
kysera generate model <name> [options]

Options:
  --table <name>            Database table name
  --columns <list>          Comma-separated column definitions
  --output <path>           Output directory (default: ./src/models)
  --from-db                 Introspect from database
```

**Example:**

```bash
kysera generate model User \
  --columns "id:number,email:string,name:string,createdAt:Date"
```

**Generated File:**

```typescript
// src/models/user.ts
import { Generated } from 'kysely'

export interface User {
  id: number
  email: string
  name: string
  createdAt: Date
  updatedAt: Date | null
  deletedAt: Date | null
}

export interface UserTable {
  id: Generated<number>
  email: string
  name: string
  created_at: Generated<Date>
  updated_at: Date | null
  deleted_at: Date | null
}

export interface NewUser {
  email: string
  name: string
}

export interface UserUpdate {
  email?: string
  name?: string
}
```

#### `kysera generate schema`

Generate Zod validation schema.

```bash
kysera generate schema <name> [options]

Options:
  --model <path>            Model file path
  --columns <list>          Comma-separated column definitions
  --output <path>           Output directory (default: ./src/schemas)
  --validation <rules>      Validation rules (JSON)
```

**Example:**

```bash
kysera generate schema User \
  --columns "email:string,name:string,age:number"
```

**Generated File:**

```typescript
// src/schemas/user.schema.ts
import { z } from 'zod'

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  age: z.number().int().min(0).max(150)
})

export const UpdateUserSchema = CreateUserSchema.partial()

export type CreateUserInput = z.infer<typeof CreateUserSchema>
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>
```

#### `kysera generate crud`

Generate full CRUD stack (model + repository + schema).

```bash
kysera generate crud <name> [options]

Options:
  --table <name>            Database table name
  --columns <list>          Comma-separated column definitions
  --plugins <list>          Comma-separated plugins
  --output <path>           Output base directory (default: ./src)
```

**Example:**

```bash
kysera generate crud User \
  --table users \
  --columns "email:string,name:string" \
  --plugins timestamps,soft-delete
```

**Generated Files:**

```
src/
├── models/
│   └── user.ts               # User model
├── schemas/
│   └── user.schema.ts        # Zod schemas
└── repositories/
    └── user.repository.ts    # User repository
```

---

## kysera db

Database utilities and operations.

### Usage

```bash
kysera db <command> [options]
```

### Subcommands

#### `kysera db seed`

Run database seeders.

```bash
kysera db seed [options]

Options:
  --file <path>             Specific seed file to run
  --class <name>            Specific seeder class to run
  --force                   Force re-seeding (truncate tables)
```

**Example:**

```bash
kysera db seed
kysera db seed --file ./seeds/users.seed.ts
kysera db seed --class UserSeeder --force
```

#### `kysera db reset`

Reset database (drop all tables).

```bash
kysera db reset [options]

Options:
  --force                   Skip confirmation prompt
  --seed                    Run seeders after reset
```

#### `kysera db dump`

Export database dump.

```bash
kysera db dump [options]

Options:
  --output <file>           Output file path (default: dump_{timestamp}.sql)
  --tables <list>           Comma-separated table names
  --data-only               Export data only (no schema)
  --schema-only             Export schema only (no data)
  --format <type>           Format (sql/json) (default: sql)
```

**Example:**

```bash
kysera db dump --output backup.sql
kysera db dump --tables users,posts --format json
```

#### `kysera db restore`

Restore from dump.

```bash
kysera db restore <file> [options]

Options:
  --force                   Skip confirmation prompt
```

#### `kysera db tables`

List all tables.

```bash
kysera db tables [options]

Options:
  --json                    Output as JSON
  --verbose                 Show detailed info (columns, indexes, etc.)
```

**Example:**

```bash
kysera db tables
```

**Output:**

```
📋 Database Tables

┌────────────────┬──────────┬──────────────┬─────────┐
│ Table          │ Rows     │ Size         │ Indexes │
├────────────────┼──────────┼──────────────┼─────────┤
│ users          │ 1,234    │ 256 KB       │ 3       │
│ posts          │ 5,678    │ 1.2 MB       │ 5       │
│ comments       │ 12,345   │ 890 KB       │ 2       │
│ audit_logs     │ 45,678   │ 3.4 MB       │ 4       │
│ migrations     │ 12       │ 8 KB         │ 1       │
└────────────────┴──────────┴──────────────┴─────────┘

Total: 5 tables, 4.7 MB
```

#### `kysera db introspect`

Introspect database schema.

```bash
kysera db introspect [options]

Options:
  --output <file>           Save to file (TypeScript types)
  --tables <list>           Comma-separated table names
  --format <type>           Output format (typescript/json) (default: typescript)
```

**Example:**

```bash
kysera db introspect --output ./src/database.types.ts
```

**Generated File:**

```typescript
// database.types.ts
import { Generated } from 'kysely'

export interface Database {
  users: UsersTable
  posts: PostsTable
  comments: CommentsTable
}

export interface UsersTable {
  id: Generated<number>
  email: string
  name: string
  created_at: Generated<Date>
  updated_at: Date | null
  deleted_at: Date | null
}

// ... more tables
```

#### `kysera db console`

Open interactive database console.

```bash
kysera db console [options]

Options:
  --query <sql>             Execute SQL query and exit
```

**Example:**

```bash
kysera db console
# kysera> SELECT * FROM users LIMIT 5;
# kysera> .tables
# kysera> .describe users
```

---

## kysera test

Testing utilities and helpers.

### Usage

```bash
kysera test <command> [options]
```

### Subcommands

#### `kysera test setup`

Setup test database.

```bash
kysera test setup [options]

Options:
  --drop                    Drop existing test database
  --migrate                 Run migrations
  --seed                    Run seeders
```

**Example:**

```bash
kysera test setup --drop --migrate --seed
```

#### `kysera test teardown`

Teardown test database.

```bash
kysera test teardown [options]

Options:
  --force                   Skip confirmation
```

#### `kysera test seed`

Seed test database.

```bash
kysera test seed [options]

Options:
  --file <path>             Specific seed file
```

#### `kysera test fixtures`

Load test fixtures.

```bash
kysera test fixtures [options]

Options:
  --file <path>             Fixture file path
  --truncate                Truncate tables before loading
```

**Example:**

```bash
kysera test fixtures --file ./tests/fixtures/users.json --truncate
```

---

## kysera debug

Debug and troubleshooting utilities for development and production.

### Usage

```bash
kysera debug <command> [options]
```

### Subcommands

#### `kysera debug sql`

Watch and debug SQL queries in real-time.

```bash
kysera debug sql [options]

Options:
  --watch                   Watch SQL queries in real-time
  --format                  Format SQL output
  --slow-only               Show only slow queries (>100ms)
  --threshold <ms>          Custom slow query threshold
  --log <file>              Log to file
  --filter <pattern>        Filter queries by pattern
  --explain                 Run EXPLAIN on queries
```

**Example:**

```bash
kysera debug sql --watch --slow-only
```

**Output:**

```
🔍 Watching SQL queries (Ctrl+C to stop)

12:00:00 | 234ms | ⚠️  SLOW
SELECT * FROM users u
  JOIN posts p ON p.user_id = u.id
  WHERE u.status = 'active'
  ORDER BY p.created_at DESC
  LIMIT 100

12:00:02 | 5ms | ✅
INSERT INTO audit_logs (table_name, entity_id, operation, user_id)
VALUES ('posts', 123, 'UPDATE', 'user-456')

12:00:05 | 156ms | ⚠️  SLOW
SELECT COUNT(*) FROM comments
WHERE post_id IN (SELECT id FROM posts WHERE user_id = 789)
```

#### `kysera debug profile`

Profile query performance.

```bash
kysera debug profile [options]

Options:
  --live                    Live query profiling
  --duration <time>         Profiling duration (1m, 5m, 1h)
  --slowest <count>         Show N slowest queries
  --most-frequent <count>   Show N most frequent queries
  --export <file>           Export profile data
  --format <type>           Export format (json/csv/html)
```

**Example:**

```bash
kysera debug profile --duration 5m --slowest 10
```

**Output:**

```
📊 Query Profile Report (5 minutes)

Top 10 Slowest Queries:
1. AVG: 345ms | COUNT: 45 | TOTAL: 15.5s
   SELECT * FROM orders WHERE status = 'pending' AND ...

2. AVG: 289ms | COUNT: 12 | TOTAL: 3.5s
   SELECT u.*, COUNT(p.id) FROM users u LEFT JOIN posts p ...

Most Frequent Queries:
1. COUNT: 1,234 | AVG: 5ms | TOTAL: 6.2s
   SELECT * FROM users WHERE id = ?

2. COUNT: 567 | AVG: 12ms | TOTAL: 6.8s
   INSERT INTO audit_logs ...

Performance Summary:
  Total queries: 3,456
  Average duration: 18ms
  P50: 8ms | P95: 89ms | P99: 234ms
  Slow queries (>100ms): 123 (3.6%)
```

#### `kysera debug errors`

Analyze database errors.

```bash
kysera debug errors [options]

Options:
  --recent <count>          Show recent errors (default: 50)
  --type <error-type>       Filter by error type
  --analyze                 Analyze error patterns
  --table <name>            Filter by table
  --period <duration>       Time period (1h, 1d, 1w)
```

**Example:**

```bash
kysera debug errors --analyze --period 1d
```

**Output:**

```
🚨 Error Analysis (Last 24 hours)

Error Summary:
  Total errors: 45
  Unique errors: 8
  Error rate: 0.12%

Top Error Types:
1. UNIQUE_VIOLATION (18 occurrences)
   - Table: users (12)
   - Table: posts (6)
   - Most common: "duplicate key value violates unique constraint"

2. FOREIGN_KEY_VIOLATION (10 occurrences)
   - Table: comments (7)
   - Table: likes (3)
   - Most common: "violates foreign key constraint"

3. CHECK_VIOLATION (8 occurrences)
   - Table: orders (5)
   - Table: payments (3)
   - Most common: "new row violates check constraint"

Recommendations:
  ✓ Add duplicate check before inserting users
  ✓ Verify parent records exist before creating comments
  ✓ Validate order amounts before insertion
```

#### `kysera debug circuit-breaker`

Monitor and manage circuit breakers.

```bash
kysera debug circuit-breaker [options]

Options:
  --status                  Show circuit breaker status
  --reset                   Reset circuit breaker
  --threshold <number>      Set failure threshold
  --timeout <ms>            Set timeout duration
  --watch                   Watch circuit breaker status
```

**Example:**

```bash
kysera debug circuit-breaker --status
```

**Output:**

```
⚡ Circuit Breaker Status

Database Connection:
  State: CLOSED ✅
  Failures: 0/5
  Success rate: 99.8%
  Last failure: 2 hours ago

External API (payments):
  State: HALF_OPEN ⚠️
  Failures: 3/5
  Success rate: 87.2%
  Last failure: 2 minutes ago
  Next retry: in 30 seconds

Redis Cache:
  State: OPEN 🔴
  Failures: 5/5
  Success rate: 0%
  Last failure: 10 seconds ago
  Circuit opens: 4 minutes 50 seconds
```

---

## kysera query

Advanced query utilities for data exploration and analysis.

### Usage

```bash
kysera query <command> [options]
```

### Subcommands

#### `kysera query by-timestamp`

Query records by timestamp fields.

```bash
kysera query by-timestamp [options]

Options:
  --table <name>            Target table (required)
  --created-after <date>    Records created after date
  --created-before <date>   Records created before date
  --updated-after <date>    Records updated after date
  --recently-created <n>    N most recently created
  --recently-updated <n>    N most recently updated
  --format <type>           Output format (table/json/csv)
  --export <file>           Export results
```

**Example:**

```bash
kysera query by-timestamp --table users \
  --created-after "2025-01-01" \
  --recently-updated 10
```

#### `kysera query soft-deleted`

Query and manage soft-deleted records.

```bash
kysera query soft-deleted [options]

Options:
  --table <name>            Target table
  --count                   Count soft-deleted records
  --list                    List soft-deleted records
  --restore <id>            Restore specific record
  --purge                   Permanently delete records
  --older-than <duration>   Filter by deletion date
```

**Example:**

```bash
kysera query soft-deleted --table users --count
# Soft-deleted records in 'users': 45

kysera query soft-deleted --table posts --list --limit 5
```

#### `kysera query analyze`

Analyze query performance and suggest optimizations.

```bash
kysera query analyze <sql> [options]

Options:
  --explain                 Show query execution plan
  --suggest                 Suggest optimizations
  --indexes                 Suggest missing indexes
  --format <type>           Output format
```

**Example:**

```bash
kysera query analyze "SELECT * FROM users WHERE email LIKE '%@gmail.com'" --suggest
```

**Output:**

```
📊 Query Analysis

Query:
  SELECT * FROM users WHERE email LIKE '%@gmail.com'

Execution Plan:
  Seq Scan on users (cost=0.00..1234.56)
  Filter: email LIKE '%@gmail.com'

Performance Issues:
  ⚠️  Full table scan detected
  ⚠️  Leading wildcard prevents index usage

Suggestions:
  1. Consider using full-text search for email domain queries
  2. Add computed column for email domain:
     ALTER TABLE users ADD COLUMN email_domain VARCHAR(255)
     GENERATED ALWAYS AS (SPLIT_PART(email, '@', 2)) STORED;
  3. Create index: CREATE INDEX idx_users_email_domain ON users(email_domain);

Estimated improvement: 95% faster
```

#### `kysera query explain`

Show query execution plan.

```bash
kysera query explain <sql> [options]

Options:
  --analyze                 Run EXPLAIN ANALYZE
  --buffers                 Show buffer usage
  --verbose                 Verbose output
  --format <type>           Output format (text/json/yaml)
```

---

## kysera repository

Repository management and introspection.

### Usage

```bash
kysera repository <command> [options]
```

### Subcommands

#### `kysera repository list`

List all repositories in the project.

```bash
kysera repository list [options]

Options:
  --show-methods            Show available methods
  --show-plugins            Show enabled plugins
  --show-tables             Show database tables
  --json                    Output as JSON
```

**Example:**

```bash
kysera repository list --show-plugins
```

**Output:**

```
📚 Repositories

UserRepository (./src/repositories/user.repository.ts)
  Table: users
  Plugins: ✓ timestamps, ✓ soft-delete, ✓ audit
  Methods: 24 (14 base + 10 from plugins)

PostRepository (./src/repositories/post.repository.ts)
  Table: posts
  Plugins: ✓ timestamps, ✓ audit
  Methods: 20 (14 base + 6 from plugins)

CommentRepository (./src/repositories/comment.repository.ts)
  Table: comments
  Plugins: ✓ timestamps
  Methods: 18 (14 base + 4 from plugins)
```

#### `kysera repository inspect`

Inspect a specific repository.

```bash
kysera repository inspect <name> [options]

Options:
  --show-schema             Show Zod schemas
  --show-methods            Show all methods
  --show-validation         Show validation rules
  --show-types              Show TypeScript types
```

**Example:**

```bash
kysera repository inspect UserRepository --show-schema
```

**Output:**

```
📋 UserRepository

File: ./src/repositories/user.repository.ts
Table: users
Entity Type: User

Validation Schemas:

CreateUserSchema:
  email: z.string().email()
  name: z.string().min(2).max(100)
  password: z.string().min(8)
  role: z.enum(['user', 'admin']).optional()

UpdateUserSchema:
  email: z.string().email().optional()
  name: z.string().min(2).max(100).optional()
  password: z.string().min(8).optional()
  role: z.enum(['user', 'admin']).optional()

Available Methods:
  Base: findById, findAll, create, update, delete, ...
  Timestamps: findCreatedAfter, findRecentlyUpdated, touch, ...
  SoftDelete: softDelete, restore, hardDelete, findDeleted, ...
  Audit: getAuditHistory, restoreFromAudit, ...
```

#### `kysera repository validate`

Validate repository schemas against database.

```bash
kysera repository validate <name> [options]

Options:
  --fix                     Auto-fix validation issues
  --strict                  Strict validation mode
```

**Example:**

```bash
kysera repository validate UserRepository
```

**Output:**

```
🔍 Validating UserRepository

Database Schema:
  ✅ Table 'users' exists
  ✅ All required columns present
  ⚠️  Column 'middle_name' in database but not in schema

TypeScript Types:
  ✅ Entity type matches database
  ✅ Create/Update types are valid subsets

Zod Schemas:
  ✅ All required fields have validation
  ⚠️  Field 'age' has no max validation

Recommendations:
  1. Add 'middle_name' to User entity type or remove from database
  2. Add max validation to 'age' field: z.number().max(150)
```

#### `kysera repository methods`

Show all available methods for a repository.

```bash
kysera repository methods <name> [options]

Options:
  --group-by-plugin         Group methods by plugin
  --show-signatures         Show method signatures
  --markdown                Output as markdown
```

---

## kysera plugin

Manage Kysera plugins.

### Usage

```bash
kysera plugin <command> [options]
```

### Subcommands

#### `kysera plugin list`

List available and enabled plugins.

```bash
kysera plugin list [options]

Options:
  --available               Show all available plugins
  --enabled                 Show only enabled plugins
```

**Example:**

```bash
kysera plugin list
```

**Output:**

```
📦 Kysera Plugins

Enabled:
  ✓ @kysera/timestamps     v0.3.0   Automatic timestamp management
  ✓ @kysera/soft-delete    v0.3.0   Soft delete functionality

Available:
  ○ @kysera/audit          v0.3.0   Audit logging

To enable a plugin: kysera plugin enable <name>
```

#### `kysera plugin enable`

Enable a plugin.

```bash
kysera plugin enable <name> [options]

Options:
  --config <json>           Plugin configuration (JSON)
  --tables <list>           Comma-separated table names
```

**Example:**

```bash
kysera plugin enable @kysera/audit --tables users,posts,orders
```

#### `kysera plugin disable`

Disable a plugin.

```bash
kysera plugin disable <name>
```

#### `kysera plugin config`

Configure a plugin.

```bash
kysera plugin config <name> [options]

Options:
  --set <key=value>         Set configuration value
  --get <key>               Get configuration value
  --interactive             Interactive configuration
```

**Example:**

```bash
kysera plugin config @kysera/audit --set captureOldValues=true
kysera plugin config @kysera/timestamps --interactive
```

---

## 📄 Configuration File

### `kysera.config.ts` - Complete Example

```typescript
import { defineConfig } from '@kysera/cli'
import { z } from 'zod'

export default defineConfig({
  // Database Configuration
  database: {
    // Connection string or object
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'myapp',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      ssl: process.env.DB_SSL === 'true'
    },

    // Database dialect
    dialect: 'postgres' as const,

    // Connection pool
    pool: {
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000,
      acquireTimeoutMillis: 60000
    },

    // Debug mode
    debug: process.env.NODE_ENV === 'development'
  },

  // Migration Configuration
  migrations: {
    directory: './migrations',
    pattern: '{timestamp}_{name}.ts',
    tableName: 'migrations',
    lockTable: true,
    lockTimeout: 10000,

    // Migration templates
    templates: {
      create: './templates/migration.hbs',
      table: './templates/create-table.hbs'
    }
  },

  // Plugin Configuration
  plugins: {
    // Audit plugin
    audit: {
      enabled: true,
      tables: ['users', 'posts', 'orders', 'payments'],
      excludeTables: ['migrations', 'sessions'],
      captureOldValues: true,
      captureNewValues: true,
      auditTable: 'audit_logs',
      getUserId: () => {
        // Custom logic to get current user ID
        return globalThis.currentUserId || null
      },
      metadata: () => ({
        environment: process.env.NODE_ENV,
        hostname: require('os').hostname()
      })
    },

    // Soft delete plugin
    softDelete: {
      enabled: true,
      tables: ['users', 'posts', 'comments'],
      deletedAtColumn: 'deleted_at',
      includeDeleted: false
    },

    // Timestamps plugin
    timestamps: {
      enabled: true,
      tables: ['*'], // All tables
      excludeTables: ['migrations'],
      createdAtColumn: 'created_at',
      updatedAtColumn: 'updated_at',
      dateFormat: 'iso', // 'iso' | 'unix' | 'date'
      setUpdatedAtOnInsert: false
    }
  },

  // Code Generation Configuration
  generate: {
    repositories: './src/repositories',
    models: './src/models',
    schemas: './src/schemas',
    migrations: './migrations',

    // Code style
    style: {
      quotes: 'single',
      semi: false,
      indent: 2,
      trailingComma: 'es5'
    },

    // Template paths
    templates: {
      repository: './templates/repository.hbs',
      model: './templates/model.hbs',
      schema: './templates/schema.hbs'
    }
  },

  // Health Check Configuration
  health: {
    enabled: true,
    interval: 60000, // 1 minute
    slowQueryThreshold: 100, // ms
    collectMetrics: true,
    metricsRetention: 3600000, // 1 hour

    // Alerts
    alerts: {
      enabled: true,
      slack: {
        webhook: process.env.SLACK_WEBHOOK,
        channel: '#database-alerts'
      },
      email: {
        to: ['admin@example.com'],
        from: 'alerts@example.com'
      }
    }
  },

  // Testing Configuration
  testing: {
    database: {
      connection: process.env.TEST_DATABASE_URL || {
        host: 'localhost',
        port: 5432,
        database: 'myapp_test',
        user: 'postgres',
        password: 'postgres'
      },
      dialect: 'postgres' as const
    },

    seeds: './tests/seeds',
    fixtures: './tests/fixtures',

    // Test isolation
    isolation: {
      // Use transactions for test isolation
      useTransactions: true,
      // Truncate tables before each test
      truncateTables: ['users', 'posts'],
      // Reset sequences after truncation
      resetSequences: true
    }
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'json', // 'json' | 'pretty'

    // Log destinations
    destinations: [
      { type: 'console' },
      { type: 'file', path: './logs/kysera.log' }
    ],

    // Query logging
    queries: {
      enabled: true,
      slowQueryThreshold: 100,
      includeParams: true
    }
  }
})
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgres://user:pass@localhost:5432/myapp
DB_HOST=localhost
DB_PORT=5432
DB_NAME=myapp
DB_USER=postgres
DB_PASSWORD=postgres
DB_SSL=false

# Test Database
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/myapp_test

# CLI Configuration
KYSERA_CONFIG=./kysera.config.ts
LOG_LEVEL=info
NODE_ENV=development

# Alerts
SLACK_WEBHOOK=https://hooks.slack.com/services/...
```

---

## 🔌 Plugin System

### Creating Custom Plugins

```typescript
// plugins/custom-plugin.ts
import type { Plugin } from '@kysera/cli'

export const customPlugin: Plugin = {
  name: 'custom-plugin',
  version: '1.0.0',

  // CLI commands
  commands: [
    {
      name: 'custom',
      description: 'Custom command',
      action: async (options) => {
        console.log('Running custom command')
      }
    }
  ],

  // Repository extensions
  extendRepository: (repo) => {
    return {
      ...repo,
      customMethod: async () => {
        // Custom logic
      }
    }
  },

  // Migration helpers
  migrationHelpers: {
    addCustomColumn: async (db, table, column) => {
      // Custom migration logic
    }
  }
}
```

### Using Custom Plugins

```typescript
// kysera.config.ts
import { defineConfig } from '@kysera/cli'
import { customPlugin } from './plugins/custom-plugin'

export default defineConfig({
  plugins: {
    custom: customPlugin
  }
})
```

---

## 📚 Examples

### Complete Workflow Example

```bash
# 1. Initialize new project
kysera init my-app --template api --database postgres

cd my-app

# 2. Create database migration
kysera migrate create create_users_table --template create-table --table users

# 3. Run migrations
kysera migrate up

# 4. Generate CRUD stack
kysera generate crud User \
  --table users \
  --columns "email:string,name:string" \
  --plugins timestamps,soft-delete,audit

# 5. Check database health
kysera health check

# 6. Seed database
kysera db seed

# 7. Check migration status
kysera migrate status

# 8. View audit logs
kysera audit logs --table users --limit 20

# 9. Generate database types
kysera db introspect --output ./src/database.types.ts

# 10. Run tests
kysera test setup --migrate --seed
npm test
```

### CI/CD Pipeline Example

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: pnpm install

      - name: Check database health
        run: kysera health check

      - name: Run migrations
        run: kysera migrate up

      - name: Verify migration status
        run: kysera migrate status

      - name: Run tests
        run: pnpm test

      - name: Generate audit report
        run: kysera audit stats --period 1d --format json --export audit-report.json
```

---

## ⚠️ Error Handling

### Error Codes

| Code | Description | Action |
|------|-------------|--------|
| `E001` | Database connection failed | Check connection string |
| `E002` | Migration failed | Review migration file |
| `E003` | Configuration error | Fix kysera.config.ts |
| `E004` | Plugin error | Check plugin configuration |
| `E005` | Generation error | Verify template files |

### Error Output Example

```bash
kysera migrate up

✗ Migration failed: E002

Error: Column 'email' already exists
  at 002_add_email_column.ts:5:10

Suggestions:
  1. Check if migration was already executed
  2. Run 'kysera migrate status' to verify
  3. Use 'kysera migrate down' to rollback

Stack trace:
  at MigrationRunner.up (...)
  at runMigrations (...)

Need help? Run 'kysera help migrate up'
```

---

## 💡 Best Practices

### 1. Use Configuration File

Always use `kysera.config.ts` for project-specific settings:

```typescript
export default defineConfig({
  database: {
    connection: process.env.DATABASE_URL
  }
})
```

### 2. Version Control Migrations

Commit migration files to version control:

```bash
git add migrations/
git commit -m "Add user table migration"
```

### 3. Test Migrations

Always test migrations in development:

```bash
kysera migrate up --dry-run
kysera migrate up
kysera migrate down
kysera migrate up
```

### 4. Monitor Health

Set up continuous health monitoring:

```bash
kysera health watch --interval 60000 --log ./logs/health.log
```

### 5. Regular Audit Cleanup

Schedule regular audit log cleanup:

```bash
# Cron job
0 0 * * 0 kysera audit cleanup --older-than 3m --force
```

### 6. Backup Before Migrations

Always backup before running migrations in production:

```bash
kysera db dump --output backup-$(date +%Y%m%d).sql
kysera migrate up
```

### 7. Use Dry Run in Production

Preview changes before execution:

```bash
kysera migrate up --dry-run
kysera migrate up
```

---

## 📖 Additional Resources

- **Documentation**: https://kysera.dev/docs/cli
- **GitHub**: https://github.com/kysera/cli
- **Examples**: https://github.com/kysera/cli-examples
- **Discord**: https://discord.gg/kysera

---

## 🚀 Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2) ✅ COMPLETED

#### 1.1 Project Setup (2 days) ✅

**Tasks:**
1. Create `apps/cli` directory structure
2. Setup package.json with dependencies
3. Configure TypeScript (tsconfig.json)
4. Setup build pipeline (tsup)
5. Create entry point and command structure

**Directory Structure:**
```
apps/cli/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── cli.ts                # Main CLI setup
│   ├── commands/             # Command implementations
│   ├── config/               # Configuration management
│   ├── utils/                # Shared utilities
│   ├── types/                # TypeScript types
│   └── templates/            # Code templates
├── templates/                # Project templates
├── tests/                    # Test files
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

**Dependencies:**
```json
{
  "dependencies": {
    "commander": "^14.0.1",
    "@xec-sh/kit": "^0.8.2",
    "handlebars": "^4.7.8",
    "fs-extra": "^11.3.2",
    "kysely": "^0.28.7",
    "zod": "^4.1.11",
    "@kysera/core": "workspace:*",
    "@kysera/repository": "workspace:*",
    "@kysera/migrations": "workspace:*",
    "@kysera/audit": "workspace:*",
    "@kysera/soft-delete": "workspace:*",
    "@kysera/timestamps": "workspace:*"
  },
  "devDependencies": {
    "@types/fs-extra": "^11.0.4",
    "tsup": "^8.5.0",
    "vitest": "^3.2.4"
  }
}
```

#### 1.2 Configuration System (3 days) ✅

**Files created:**
- `src/config/loader.ts` - Load and parse kysera.config.ts
- `src/config/validator.ts` - Validate configuration with Zod
- `src/config/schema.ts` - Configuration schema definitions
- `src/config/defaults.ts` - Default configuration values
- `src/config/resolver.ts` - Resolve paths and environment variables

**Key Features:**
- Support for TypeScript config files
- Environment variable resolution
- Path resolution (relative to config file)
- Config file discovery (walk up directory tree)
- Config validation with helpful error messages
- Support for multiple config formats (.ts, .js, .json)

#### 1.3 Database Connection Manager (2 days) ✅

**Files created:**
- `src/utils/database.ts` - Database connection utilities
- `src/utils/dialects/postgres.ts` - PostgreSQL specific
- `src/utils/dialects/mysql.ts` - MySQL specific
- `src/utils/dialects/sqlite.ts` - SQLite specific
- `src/utils/pool.ts` - Connection pool management

**Key Features:**
- Multi-dialect support (PostgreSQL, MySQL, SQLite)
- Connection pool management
- Connection testing and validation
- SSL/TLS configuration
- Connection retry logic

#### 1.4 Core Utilities (3 days) ✅

**Files created:**
- `src/utils/logger.ts` - Logging with XecKit
- `src/utils/prompts.ts` - Interactive prompts
- `src/utils/templates.ts` - Handlebars template engine
- `src/utils/spinner.ts` - Loading spinners
- `src/utils/table.ts` - Table formatting
- `src/utils/colors.ts` - Color utilities
- `src/utils/errors.ts` - Error handling
- `src/utils/fs.ts` - File system utilities

**Key Features:**
- Colored console output
- Interactive prompts (select, multiselect, confirm, text)
- Progress bars and spinners
- Table formatting for output
- Template compilation and rendering
- Error formatting with stack traces

### Phase 2: Essential Commands (Week 2-3)

#### 2.1 Init Command (3 days)

**Files to create:**
- `src/commands/init/index.ts` - Main init command
- `src/commands/init/templates.ts` - Project templates
- `src/commands/init/generator.ts` - File generator
- `src/commands/init/dependencies.ts` - Dependency installer
- `templates/basic/` - Basic template
- `templates/api/` - API template
- `templates/graphql/` - GraphQL template
- `templates/monorepo/` - Monorepo template

**Key Features:**
- Interactive project setup wizard
- Multiple project templates
- Package manager detection and installation
- Git repository initialization
- Environment file generation
- TypeScript configuration
- ESLint/Prettier setup

#### 2.2 Migration Commands (4 days)

**Files to create:**
- `src/commands/migrate/index.ts` - Migration command group
- `src/commands/migrate/create.ts` - Create migration
- `src/commands/migrate/up.ts` - Run migrations
- `src/commands/migrate/down.ts` - Rollback migrations
- `src/commands/migrate/status.ts` - Migration status
- `src/commands/migrate/reset.ts` - Reset migrations
- `src/commands/migrate/list.ts` - List migrations
- `src/commands/migrate/runner.ts` - Migration runner
- `src/commands/migrate/templates/` - Migration templates

**Key Features:**
- Migration file generation with templates
- Up/down migration execution
- Rollback support with transaction safety
- Dry-run mode
- Migration status tracking
- Lock mechanism for concurrent execution
- Migration validation before execution

#### 2.3 Health Commands (3 days)

**Files to create:**
- `src/commands/health/index.ts` - Health command group
- `src/commands/health/check.ts` - Health check
- `src/commands/health/watch.ts` - Continuous monitoring
- `src/commands/health/metrics.ts` - Metrics collection
- `src/commands/health/pool.ts` - Connection pool monitoring
- `src/commands/health/export.ts` - Export metrics

**Key Features:**
- Database connectivity check
- Connection pool monitoring
- Query performance metrics
- Slow query detection
- Export metrics in multiple formats
- Real-time monitoring with auto-refresh
- Alert thresholds and notifications

### Phase 3: Code Generation (Week 3-4)

#### 3.1 Generate Commands (4 days)

**Files to create:**
- `src/commands/generate/index.ts` - Generate command group
- `src/commands/generate/repository.ts` - Repository generator
- `src/commands/generate/model.ts` - Model generator
- `src/commands/generate/schema.ts` - Schema generator
- `src/commands/generate/crud.ts` - CRUD generator
- `src/commands/generate/introspector.ts` - Database introspection
- `src/commands/generate/templates/` - Generation templates

**Key Features:**
- Database introspection for type generation
- Repository generation with plugin support
- Zod schema generation
- TypeScript interface generation
- CRUD stack generation (model + repository + schema)
- Custom template support
- Code formatting after generation

#### 3.2 Database Commands (3 days)

**Files to create:**
- `src/commands/db/index.ts` - Database command group
- `src/commands/db/seed.ts` - Database seeding
- `src/commands/db/reset.ts` - Database reset
- `src/commands/db/dump.ts` - Database dump
- `src/commands/db/restore.ts` - Database restore
- `src/commands/db/tables.ts` - List tables
- `src/commands/db/introspect.ts` - Introspect schema
- `src/commands/db/console.ts` - Interactive console

**Key Features:**
- Database seeding from files
- Database dump/restore
- Table listing with statistics
- Schema introspection
- Interactive SQL console
- Multi-dialect support

### Phase 4: Advanced Features (Week 4-5)

#### 4.1 Audit Commands (3 days)

**Files to create:**
- `src/commands/audit/index.ts` - Audit command group
- `src/commands/audit/logs.ts` - Query audit logs
- `src/commands/audit/history.ts` - Entity history
- `src/commands/audit/restore.ts` - Restore from audit
- `src/commands/audit/stats.ts` - Audit statistics
- `src/commands/audit/cleanup.ts` - Cleanup old logs
- `src/commands/audit/compare.ts` - Compare audit entries
- `src/commands/audit/diff.ts` - Show entity diff

**Key Features:**
- Audit log querying with filters
- Entity history timeline
- Restore entities from audit logs
- Audit statistics and analytics
- Cleanup old audit logs
- Compare audit entries
- Visual diff for changes

#### 4.2 Debug Commands (3 days)

**Files to create:**
- `src/commands/debug/index.ts` - Debug command group
- `src/commands/debug/sql.ts` - SQL debugging
- `src/commands/debug/profile.ts` - Query profiling
- `src/commands/debug/errors.ts` - Error analysis
- `src/commands/debug/circuit-breaker.ts` - Circuit breaker monitoring
- `src/commands/debug/analyzer.ts` - Query analyzer

**Key Features:**
- Real-time SQL query monitoring
- Query profiling and analysis
- Error pattern detection
- Circuit breaker management
- Query optimization suggestions
- EXPLAIN plan visualization

#### 4.3 Query Commands (2 days)

**Files to create:**
- `src/commands/query/index.ts` - Query command group
- `src/commands/query/by-timestamp.ts` - Timestamp queries
- `src/commands/query/soft-deleted.ts` - Soft delete queries
- `src/commands/query/analyze.ts` - Query analysis
- `src/commands/query/explain.ts` - Query explain

**Key Features:**
- Timestamp-based queries
- Soft-deleted records management
- Query performance analysis
- EXPLAIN plan execution
- Index suggestions

#### 4.4 Repository Commands (2 days)

**Files to create:**
- `src/commands/repository/index.ts` - Repository command group
- `src/commands/repository/list.ts` - List repositories
- `src/commands/repository/inspect.ts` - Inspect repository
- `src/commands/repository/validate.ts` - Validate schemas
- `src/commands/repository/methods.ts` - Show methods

**Key Features:**
- Repository discovery and listing
- Repository inspection with schemas
- Schema validation against database
- Method documentation generation

### Phase 5: Testing & Plugin System (Week 5-6)

#### 5.1 Test Commands (2 days)

**Files to create:**
- `src/commands/test/index.ts` - Test command group
- `src/commands/test/setup.ts` - Test setup
- `src/commands/test/teardown.ts` - Test teardown
- `src/commands/test/seed.ts` - Test seeding
- `src/commands/test/fixtures.ts` - Load fixtures

**Key Features:**
- Test database setup/teardown
- Test data seeding
- Fixture loading
- Isolation strategies

#### 5.2 Plugin Commands (2 days)

**Files to create:**
- `src/commands/plugin/index.ts` - Plugin command group
- `src/commands/plugin/list.ts` - List plugins
- `src/commands/plugin/enable.ts` - Enable plugin
- `src/commands/plugin/disable.ts` - Disable plugin
- `src/commands/plugin/config.ts` - Configure plugin

**Key Features:**
- Plugin discovery
- Plugin enable/disable
- Plugin configuration
- Custom plugin loading

#### 5.3 Testing Infrastructure (2 days)

**Files to create:**
- `tests/unit/` - Unit tests
- `tests/integration/` - Integration tests
- `tests/e2e/` - End-to-end tests
- `tests/fixtures/` - Test fixtures
- `tests/utils/` - Test utilities

**Key Features:**
- Unit tests for all utilities
- Integration tests for commands
- E2E tests for complete workflows
- Cross-platform testing
- Multi-dialect testing

### Phase 6: Polish & Documentation (Week 6)

#### 6.1 Error Handling & UX (2 days)

**Tasks:**
- Implement comprehensive error handling
- Add helpful error messages and suggestions
- Improve command output formatting
- Add progress indicators for long operations
- Implement verbose/quiet modes
- Add dry-run support where applicable

#### 6.2 Performance Optimization (1 day)

**Tasks:**
- Optimize startup time
- Lazy load command modules
- Implement caching where appropriate
- Optimize file operations
- Profile and optimize hot paths

#### 6.3 Documentation (2 days)

**Tasks:**
- Write comprehensive README.md
- Create command documentation
- Add inline help for all commands
- Create example workflows
- Document configuration options
- Create migration guide

#### 6.4 Release Preparation (1 day)

**Tasks:**
- Setup npm publishing
- Create GitHub releases workflow
- Add changelog generation
- Setup versioning strategy
- Create installation scripts
- Test installation on different platforms

### Implementation Priorities

#### Priority 1 (Must Have - Week 1-3)
- [x] Core infrastructure ✅ Completed
- [x] Configuration system ✅ Completed
- [x] Database connection ✅ Completed
- [ ] Init command
- [ ] Migration commands (create, up, down, status)
- [ ] Basic health check

#### Priority 2 (Should Have - Week 3-4)
- [ ] Code generation (repository, model, schema)
- [ ] Database utilities (seed, reset, tables)
- [ ] Audit commands (logs, history)
- [ ] Plugin management

#### Priority 3 (Nice to Have - Week 5-6)
- [ ] Debug commands
- [ ] Query commands
- [ ] Repository introspection
- [ ] Test utilities
- [ ] Advanced health monitoring
- [ ] Interactive console

### Technology Decisions

#### CLI Framework
**Choice:** Commander.js
- **Reason:** Mature, well-documented, TypeScript support
- **Alternatives considered:** Yargs, Oclif, CAC

#### UI/UX Library
**Choice:** XecKit (@xec-sh/kit)
- **Reason:** Modern, all-in-one solution for prompts, colors, spinners
- **Alternatives considered:** Inquirer + Chalk + Ora

#### Template Engine
**Choice:** Handlebars
- **Reason:** Simple, powerful, widely used
- **Alternatives considered:** EJS, Mustache

#### File Operations
**Choice:** fs-extra
- **Reason:** Enhanced fs with promises, extra utilities
- **Alternatives considered:** Native fs/promises, node-fs

### Testing Strategy

#### Unit Tests
- Test all utility functions
- Test configuration loading and validation
- Test template generation
- Test error handling
- Coverage target: >95%

#### Integration Tests
- Test command execution
- Test database operations
- Test file generation
- Test plugin system
- Coverage target: >85%

#### E2E Tests
- Test complete workflows (init → migrate → generate)
- Test cross-platform compatibility
- Test with different databases
- Test error scenarios

### Release Strategy

#### Version 0.1.0 (Alpha)
- Core commands (init, migrate, health)
- Basic functionality
- Limited to PostgreSQL

#### Version 0.2.0 (Beta)
- All planned commands
- Multi-dialect support
- Plugin system

#### Version 1.0.0 (Stable)
- Production ready
- Comprehensive documentation
- Performance optimized
- Full test coverage

### Success Metrics

1. **Functionality**
   - All planned commands implemented
   - Multi-dialect support working
   - Plugin system functional

2. **Performance**
   - CLI startup < 100ms
   - Command execution < 1s for simple operations
   - Memory usage < 50MB

3. **Quality**
   - Test coverage > 90%
   - Zero TypeScript errors
   - Zero ESLint warnings
   - No runtime dependencies vulnerabilities

4. **Usability**
   - Clear error messages
   - Helpful command output
   - Interactive mode for complex operations
   - Comprehensive --help for all commands

5. **Documentation**
   - All commands documented
   - Examples for common workflows
   - Configuration reference
   - Migration guide from other ORMs

---

## 📝 License

MIT © Kysera Team

---

**Last Updated:** 2025-10-02
**Version:** 1.0.0
**Status:** Design Specification with Implementation Plan
