# @kysera/cli

Comprehensive command-line interface for Kysera ORM - A production-ready TypeScript ORM framework with enterprise-grade features.

## 🚀 Features

- **🗄️ Database Management** - Complete lifecycle management with PostgreSQL, MySQL, and SQLite support
- **🔄 Migration System** - Robust migration creation, execution, and rollback with version control
- **⚙️ Code Generation** - Generate type-safe models, repositories, and CRUD operations
- **📊 Health Monitoring** - Real-time database health checks and performance metrics
- **📝 Audit Logging** - Comprehensive audit trail with history tracking and restoration
- **🧪 Test Utilities** - Test environment setup, fixtures, and intelligent data seeding
- **🔌 Plugin System** - Extensible architecture with plugin discovery and configuration
- **⚡ Performance** - Lazy loading, caching, connection pooling, and query optimization
- **🎯 Developer Experience** - Verbose/quiet modes, dry-run support, progress indicators

## 📦 Installation

```bash
# NPM
npm install -g @kysera/cli

# PNPM (recommended)
pnpm add -g @kysera/cli

# Yarn
yarn global add @kysera/cli

# Bun
bun add -g @kysera/cli

# Project-specific installation
pnpm add -D @kysera/cli
```

## 🛠 Quick Start

```bash
# Initialize a new project
kysera init my-app --dialect postgres --typescript

# Create and run migrations
kysera migrate create add_users_table
kysera migrate up

# Generate models and repositories
kysera generate model User --table users
kysera generate repository User --with-validation

# Generate complete CRUD with API
kysera generate crud Post --api --tests

# Check database health
kysera health check
```

## 🎯 Shell Completions

Kysera CLI provides shell completion scripts for Bash, Zsh, and Fish shells to enhance your development experience with tab completion for commands, subcommands, and options.

### Bash

**System-wide installation:**
```bash
sudo cp scripts/completions/kysera.bash /etc/bash_completion.d/kysera
# or on macOS with Homebrew:
sudo cp scripts/completions/kysera.bash /usr/local/etc/bash_completion.d/kysera
```

**User installation:**
```bash
# Add to your ~/.bashrc or ~/.bash_profile:
source /path/to/kysera-cli/scripts/completions/kysera.bash
```

Then reload your shell:
```bash
source ~/.bashrc
```

### Zsh

**System-wide installation:**
```bash
sudo cp scripts/completions/kysera.zsh /usr/local/share/zsh/site-functions/_kysera
```

**User installation:**
```bash
# Create completions directory if it doesn't exist
mkdir -p ~/.zsh/completions

# Copy the completion file
cp scripts/completions/kysera.zsh ~/.zsh/completions/_kysera

# Add to your ~/.zshrc:
fpath=(~/.zsh/completions $fpath)
autoload -U compinit && compinit
```

Then reload your shell:
```bash
source ~/.zshrc
```

### Fish

**Installation:**
```bash
# User installation (recommended)
cp scripts/completions/kysera.fish ~/.config/fish/completions/

# System-wide installation
sudo cp scripts/completions/kysera.fish /usr/share/fish/vendor_completions.d/
```

Fish will automatically load completions - no need to reload.

### Features

The completion scripts provide intelligent suggestions for:

- **Commands**: All main commands (`init`, `migrate`, `generate`, `db`, etc.)
- **Subcommands**: Context-aware subcommand completion (e.g., `migrate up`, `generate model`)
- **Options**: All global and command-specific flags
- **Values**: Predefined values for options like `--dialect`, `--validation`, `--strategy`
- **Files**: File path completion for config files and output directories

### Example Usage

```bash
# Type and press TAB:
kysera <TAB>
# Shows: init migrate generate db health audit debug query repository test plugin help

kysera migrate <TAB>
# Shows: create up down status list reset fresh rollback

kysera generate --validation <TAB>
# Shows: zod yup joi none

kysera --config <TAB>
# Shows: file path completions for .ts, .js, .json files
```

## 📚 Command Overview

| Command | Description | Aliases |
|---------|-------------|---------|
| `init` | Initialize a new Kysera project | |
| `migrate` | Database migration management | |
| `generate` | Code generation utilities | `g` |
| `db` | Database management tools | |
| `health` | Health monitoring and metrics | |
| `audit` | Audit logging and history | |
| `query` | Query analysis and utilities | |
| `test` | Test environment management | |
| `plugin` | Plugin management | |
| `debug` | Debug and diagnostic tools | |
| `repository` | Repository pattern utilities | |
| `hello` | Test command to verify CLI setup | |
| `stats` | Show CLI performance statistics | |

### Command Aliases

Some commands support short aliases for faster typing:

```bash
# Generate command has 'g' alias
kysera g model User
kysera generate model User  # equivalent

# Both commands do the same thing
kysera g repository Post
kysera generate repository Post  # equivalent
```

## ⚙️ Configuration

### Configuration Files

Kysera CLI uses [cosmiconfig](https://github.com/davidtheclark/cosmiconfig) for flexible configuration loading. The CLI will automatically search for configuration in the following locations (in order of priority):

1. `kysera.config.ts` (recommended for TypeScript projects)
2. `kysera.config.js`
3. `kysera.config.mjs`
4. `kysera.config.cjs`
5. `kysera.config.json`
6. `.kyserarc.ts`
7. `.kyserarc.js`
8. `.kyserarc.json`

You can also specify a custom config file using the `--config` flag:

```bash
kysera migrate up --config ./custom-config.ts
```

### TypeScript Configuration

Create `kysera.config.ts` in your project root (recommended):

```typescript
import { defineConfig } from '@kysera/cli'

export default defineConfig({
  database: {
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'myapp',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    pool: { min: 2, max: 10 }
  },

  migrations: {
    directory: './migrations',
    tableName: 'kysera_migrations',
    timezone: 'UTC'
  },

  generation: {
    outputDir: './src/generated',
    typescript: true,
    validation: 'zod'
  },

  plugins: {
    '@kysera/soft-delete': { enabled: true },
    '@kysera/timestamps': { enabled: true },
    '@kysera/audit': { enabled: true }
  }
})
```

### JSON Configuration

For simpler projects, you can use `kysera.config.json`:

```json
{
  "database": {
    "dialect": "postgres",
    "host": "localhost",
    "port": 5432,
    "database": "myapp"
  },
  "migrations": {
    "directory": "./migrations"
  }
}
```

## 🎯 Global Options

All commands support these global options:

| Option | Description | Default |
|--------|-------------|---------|
| `--verbose` | Enable detailed output with debug information | `false` |
| `-q, --quiet` | Suppress non-essential output | `false` |
| `--dry-run` | Preview changes without executing | `false` |
| `--config <path>` | Path to custom configuration file | Auto-detect |
| `--json` | Output results as JSON | `false` |
| `--no-color` | Disable colored output | `false` |
| `--env <environment>` | Set environment (development/production/test) | `development` |
| `--stats` | Show performance statistics after command execution | `false` |

### Examples

```bash
# Verbose output with debug information
kysera migrate up --verbose

# Quiet mode - minimal output
kysera generate model User --quiet

# Preview changes without executing
kysera db reset --dry-run

# Use custom config file
kysera migrate up --config ./config/db.ts

# JSON output for scripting
kysera health check --json

# Disable colors for CI/CD
kysera test setup --no-color

# Set environment
kysera migrate up --env production

# Show performance stats
kysera generate crud Post --stats
```

## 🛠 Built-in Utility Commands

### Hello Command

Test command to verify CLI setup and configuration:

```bash
# Basic hello
kysera hello
# Output: Hello, World! 👋

# With custom name
kysera hello --name John
# Output: Hello, John! 👋

# With verbose output
kysera hello --verbose
# Output:
# Hello, World! 👋
# CLI is working correctly!
```

### Stats Command

Show CLI performance statistics including command load times, cache hit rates, and usage patterns:

```bash
kysera stats
```

Example output:

```
CLI Performance Statistics
────────────────────────────────────────────────────────────
Command Load Times:
  migrate: 45ms (used 23 times)
  generate: 38ms (used 15 times)
  health: 12ms (used 8 times)

Cache Hit Rate: 85%

Most Used Commands:
  1. migrate
  2. generate
  3. health
────────────────────────────────────────────────────────────
Startup time: 124ms
```

The stats command helps you:
- Identify frequently used commands (which are preloaded for faster startup)
- Monitor cache efficiency
- Track command load times
- Optimize CLI performance

## 🧪 Testing Support

```bash
# Setup test environment
kysera test setup --env test

# Seed test data
kysera test seed --count 1000 --strategy realistic

# Load fixtures
kysera test fixtures users.json posts.yaml

# Teardown
kysera test teardown --env test --force
```

### Docker Support

```bash
# Start test databases
docker compose -f docker-compose.test.yml up -d

# Run multi-database tests
TEST_POSTGRES=true TEST_MYSQL=true pnpm test
```

## 🚀 Advanced Features

### Progress Indicators
```bash
kysera migrate up
✓ Running migration: 001_create_users.ts
⠋ Running migration: 002_create_posts.ts [45%]
```

### Dry Run Mode
```bash
kysera migrate up --dry-run
[DRY RUN] Would execute:
  - 001_create_users.ts
  - 002_create_posts.ts
```

### Performance Monitoring
```bash
kysera stats
Command Load Times:
  migrate: 45ms (23 uses)
Cache Hit Rate: 85%
```

## 📖 Documentation

- [Full Documentation](https://kysera.dev/docs/cli)
- [API Reference](https://kysera.dev/api/cli)
- [Migration Guide](https://kysera.dev/guides/migrations)
- [Plugin Development](https://kysera.dev/guides/plugins)

## 🤝 Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development setup and guidelines.

## 📄 License

MIT © Kysera Team