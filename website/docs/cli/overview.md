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

Global flags belong before the command group, not after subcommands:

```bash
kysera --json migrate up
kysera --verbose db tables
```

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

### [schema](/docs/cli/schema)

PostgreSQL schema management for multi-tenant architectures.

```bash
kysera schema list           # List all schemas
kysera schema create <name>  # Create a new schema
kysera schema drop <name>    # Drop a schema
kysera schema info <name>    # Show schema details
kysera schema clone <s> <t>  # Clone schema structure
kysera schema compare <a> <b># Compare two schemas
```

### [health](/docs/cli/health)

Health monitoring.

```bash
kysera health check
kysera health watch
kysera health watch --log health.log
kysera health metrics
```

### [test](/docs/cli/test)

Test environment management.

```bash
kysera test setup
kysera test seed
kysera test teardown
```

### [audit](/docs/cli/audit)

Audit logging and history tracking.

```bash
kysera audit logs              # View audit logs
kysera audit history <id>      # View entity history
kysera audit restore <id>      # Restore from audit
kysera audit stats             # Audit statistics
kysera audit cleanup           # Clean old logs
```

### [debug](/docs/cli/debug)

Debug and performance analysis tools.

```bash
kysera debug sql               # SQL query debugging
kysera debug profile           # Performance profiling
kysera debug errors            # Error analysis
kysera debug circuit-breaker   # Circuit breaker status
kysera debug analyzer          # Query analyzer
```

### [query](/docs/cli/query)

Database query utilities.

```bash
kysera query by-timestamp      # Query by timestamp range
kysera query soft-deleted      # Manage soft-deleted records
kysera query analyze           # Analyze query performance
kysera query explain           # Show execution plan
```

### [repository](/docs/cli/repository)

Repository introspection and management.

```bash
kysera repository list         # List all repositories
kysera repository inspect -c <name>  # Inspect repository
kysera repository validate     # Validate schemas
kysera repository methods      # Show available methods
```

### [plugin](/docs/cli/plugin)

Plugin management and configuration.

```bash
kysera plugin list             # List available plugins
kysera plugin enable <name>    # Enable a plugin
kysera plugin disable <name>   # Disable a plugin
kysera plugin config <name>    # Configure plugin
```

### Utility Commands

```bash
kysera hello                   # Verify CLI setup (-n, --name <name> to customize)
kysera stats                   # Show CLI performance statistics
```

## Configuration

Create `kysera.config.ts` in your project root (plain default export — the package has no importable helpers):

```typescript
export default {
  database: {
    dialect: 'postgres',
    // Connection string or object; ${VAR} is interpolated from the environment
    connection: '${DATABASE_URL}'
    // Alternatively for postgres/mysql: host, port, database, user, password, ssl
  },
  migrations: {
    directory: './migrations'
  },
  generate: {
    repositories: './src/repositories',
    models: './src/models',
    schemas: './src/schemas'
  }
}
```

See [Configuration](/docs/cli/configuration) for full options.

## Shell Completions

Tab-completion scripts for bash, zsh, and fish ship with the package under `scripts/completions/`:

```bash
# Bash — add to ~/.bashrc or ~/.bash_profile
source /path/to/@kysera/cli/scripts/completions/kysera.bash

# Zsh
mkdir -p ~/.zsh/completions
cp /path/to/@kysera/cli/scripts/completions/kysera.zsh ~/.zsh/completions/_kysera
echo 'fpath=(~/.zsh/completions $fpath)' >> ~/.zshrc
echo 'autoload -U compinit && compinit' >> ~/.zshrc

# Fish
cp /path/to/@kysera/cli/scripts/completions/kysera.fish ~/.config/fish/completions/
```

With a global npm install, the scripts live at `$(npm root -g)/@kysera/cli/scripts/completions/`.

## Environment Support

- **Node.js** 22+
- **Bun** 1.0+
- **Database**: PostgreSQL, MySQL, SQLite
