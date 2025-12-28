---
sidebar_position: 1
title: CLI Overview
description: Kysera CLI tool overview and installation
---

# Kysera CLI

Command-line interface for Kysera - database management, migrations, code generation, and more.

## Installation

```bash
npm install -g @kysera/cli
# or
npx @kysera/cli <command>
```

## Quick Start

```bash
# Initialize new project
kysera init my-app -d postgres

# Create a migration
kysera migrate create add_users_table

# Run migrations
kysera migrate up

# Generate CRUD for a table
kysera generate crud User

# Check database health
kysera health check
```

## Global Options

All commands support these flags:

```
-v, --version          Show CLI version
--verbose              Detailed output
-q, --quiet            Minimal output
--dry-run              Preview without executing
--config <path>        Custom configuration file
--json                 Output as JSON
--no-color             Disable colors
--env <environment>    Set environment (default: development)
--stats                Show CLI performance stats
```

## Command Groups

### [init](/docs/cli/init)

Initialize new Kysera projects with interactive setup.

```bash
kysera init my-app
kysera init my-app -d postgres -t api
```

### [migrate](/docs/cli/migrate)

Database migration management.

```bash
kysera migrate create <name>
kysera migrate up
kysera migrate down
kysera migrate status
kysera migrate list
kysera migrate reset
kysera migrate fresh            # Drop all tables and run migrations from scratch
```

### [generate](/docs/cli/generate)

Code generation from database schema.

```bash
kysera generate model User
kysera generate repository User
kysera generate crud User
```

### [db](/docs/cli/db)

Database utilities.

```bash
kysera db seed               # Run seeders
kysera db reset              # Reset database
kysera db tables             # List tables
kysera db dump               # Export data
kysera db restore            # Restore from backup
kysera db introspect         # Introspect schema
kysera db console            # Interactive SQL console
```

### [health](/docs/cli/health)

Health monitoring.

```bash
kysera health check
kysera health check --watch
kysera health metrics
```

### [test](/docs/cli/test)

Test environment management.

```bash
kysera test setup
kysera test seed
kysera test teardown
```

### audit

Audit logging and history tracking.

```bash
kysera audit logs              # View audit logs
kysera audit history <id>      # View entity history
kysera audit restore <id>      # Restore from audit
kysera audit stats             # Audit statistics
kysera audit cleanup           # Clean old logs
```

### debug

Debug and performance analysis tools.

```bash
kysera debug sql               # SQL query debugging
kysera debug profile           # Performance profiling
kysera debug errors            # Error analysis
kysera debug circuit-breaker   # Circuit breaker status
kysera debug analyzer          # Query analyzer
```

### query

Database query utilities.

```bash
kysera query by-timestamp      # Query by timestamp range
kysera query soft-deleted      # Manage soft-deleted records
kysera query analyze           # Analyze query performance
kysera query explain           # Show execution plan
```

### repository

Repository introspection and management.

```bash
kysera repository list         # List all repositories
kysera repository inspect <n>  # Inspect repository
kysera repository validate     # Validate schemas
kysera repository methods      # Show available methods
```

### plugin

Plugin management and configuration.

```bash
kysera plugin list             # List available plugins
kysera plugin enable <name>    # Enable a plugin
kysera plugin disable <name>   # Disable a plugin
kysera plugin config <name>    # Configure plugin
```

## Configuration

Create `kysera.config.ts` in your project root:

```typescript
import { defineConfig } from '@kysera/cli'

export default defineConfig({
  database: {
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'myapp',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD
  },
  migrations: {
    directory: './migrations',
    tableName: 'kysera_migrations'
  },
  generation: {
    outputDir: './src/generated',
    typescript: true
  }
})
```

See [Configuration](/docs/cli/configuration) for full options.

## Environment Support

- **Node.js** 20+
- **Bun** 1.0+
- **Database**: PostgreSQL, MySQL, SQLite, MSSQL
