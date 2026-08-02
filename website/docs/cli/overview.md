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

Requires Node.js >= 22.18 (or Bun >= 1.0). Verify the install and your environment in one step:

```bash
kysera doctor
```

## Quick Start

```bash
# Initialize new project
kysera init my-app -d postgres

# Sanity-check environment, config, driver, database
kysera doctor

# Create a migration
kysera migrate create add_users_table

# Run migrations
kysera migrate up

# Generate Kysely types for the whole database
kysera generate database

# Generate CRUD for a table
kysera generate crud users

# Check database health
kysera health check
```

## Global Options

```
--version              Show CLI version
--verbose              Detailed output
--quiet                Minimal output
--dry-run              Preview without executing
--config <path>        Custom configuration file
--json                 Output as JSON
--no-color             Disable colors
--env <environment>    Set environment (default: development)
-h, --help             Display help
```

Global flags are recognized **both before and after** the subcommand — `kysera --json migrate status` and `kysera migrate status --json` behave identically. When a subcommand defines the same flag itself, the value given on the subcommand wins.

The root command deliberately registers `--version` and `--quiet` as long-only flags, so single-letter shorts like `-v` and `-q` always belong to the subcommand you invoke: `kysera migrate status -v` enables verbose output, and `kysera query analyze -q "SELECT 1"` passes the query.

## CLI Contracts

These hold across every command — build scripts against them with confidence:

- **stdout is data, stderr is diagnostics.** Results (JSON, tables, generated SQL) go to stdout; progress notes, warnings, and errors go to stderr. `kysera migrate list --json > list.json` never captures spinner noise.
- **`--json` everywhere.** Every command emits machine-readable output with `--json`; errors in JSON mode are emitted as a JSON document (`{ "error": { name, message, code, suggestions } }`) on stderr.
- **Exit codes.** `0` on success, `1` on any failure. `--help` and `--version` exit `0`. `kysera doctor` exits `0` when no check fails (warnings allowed).
- **Destructive operations never auto-proceed.** Commands that drop or delete (e.g. `migrate fresh`, `db reset`, `schema drop`) prompt on an interactive terminal and **fail** with `CONFIRMATION_REQUIRED` when headless (CI, pipes, JSON mode) unless `--force` is passed.
- **Fast startup.** The command tree is registered eagerly but heavy dependencies load lazily, so `kysera --help` responds in well under a second (typically 100–200 ms).
- **Version from the package.** `kysera --version` reports the `@kysera/cli` package version.

## Command Groups

### [init](/docs/cli/init)

Initialize new Kysera projects with interactive setup.

```bash
kysera init my-app
kysera init my-app -d postgres -t api
```

### [doctor](/docs/cli/doctor)

Diagnose environment, configuration, driver, and database health.

```bash
kysera doctor
kysera doctor --json        # { checks: [...], summary } for CI
```

### [migrate](/docs/cli/migrate)

Database migration management, built on `@kysera/migrations` (advisory-locked, checksum-verified).

```bash
kysera migrate create <name>
kysera migrate up
kysera migrate down              # rolls back the most recent migration
kysera migrate status --json
kysera migrate list
kysera migrate baseline --all    # adopt an existing schema
kysera migrate verify            # detect drift in executed migrations
kysera migrate reset             # rollback everything (dangerous)
kysera migrate fresh             # drop all tables and re-run (dangerous)
```

### [generate](/docs/cli/generate)

Code generation from database schema (alias: `kysera g`).

```bash
kysera generate database     # one Kysely schema file for the whole DB
kysera generate model users
kysera generate repository users
kysera generate crud users
```

### [db](/docs/cli/db)

Database utilities.

```bash
kysera db seed               # Run seeders
kysera db reset              # Reset database (drops all tables!)
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
kysera audit init              # Generate the audit-table migration
kysera audit logs              # View audit logs
kysera audit history <t> <id>  # View entity history
kysera audit restore <id>      # Restore from audit
kysera audit stats             # Audit statistics
kysera audit cleanup           # Clean old logs
```

### [rls](/docs/cli/rls)

Native PostgreSQL Row-Level Security from a `defineRLSSchema` module.

```bash
kysera rls generate ./rls/schema.ts     # print CREATE POLICY statements
kysera rls migration ./rls/schema.ts    # emit a Kysely migration
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

Settings resolve with the precedence **flags > environment > `.env` > config file > defaults**: a `.env` file in the working directory is loaded automatically (it never overrides variables already set in the environment), `DATABASE_URL` overrides the configured connection, and `KYSERA_CONFIG` names a config file when `--config` isn't given. See [Configuration](/docs/cli/configuration) for the full reference.

## Shell Completions

Tab-completion scripts for bash, zsh, and fish are generated from the actual command tree (all 15 top-level commands and 61 subcommands, including per-subcommand options and enum values). They live in the Kysera repository under [`apps/cli/scripts/completions/`](https://github.com/kysera/kysera/tree/main/apps/cli/scripts/completions) — grab the file for your shell:

```bash
# Bash — add to ~/.bashrc or ~/.bash_profile
source /path/to/kysera.bash

# Zsh
mkdir -p ~/.zsh/completions
cp kysera.zsh ~/.zsh/completions/_kysera
echo 'fpath=(~/.zsh/completions $fpath)' >> ~/.zshrc
echo 'autoload -U compinit && compinit' >> ~/.zshrc

# Fish
cp kysera.fish ~/.config/fish/completions/
```

Completion covers enumerated option values too, e.g. `kysera init --database <TAB>` offers `postgres mysql sqlite`.

## Environment Support

- **Node.js** >= 22.18
- **Bun** >= 1.0
- **Database**: PostgreSQL, MySQL, SQLite
