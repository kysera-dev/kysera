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

## 📚 Command Overview

| Command | Description |
|---------|-------------|
| `init` | Initialize a new Kysera project |
| `migrate` | Database migration management |
| `generate` | Code generation utilities |
| `db` | Database management tools |
| `health` | Health monitoring and metrics |
| `audit` | Audit logging and history |
| `query` | Query analysis and utilities |
| `test` | Test environment management |
| `plugin` | Plugin management |
| `debug` | Debug and diagnostic tools |
| `repository` | Repository pattern utilities |

## ⚙️ Configuration

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

## 🎯 Global Options

All commands support these global options:

```bash
-v, --verbose        # Detailed output
-q, --quiet         # Minimal output
--dry-run          # Preview without executing
--config <path>    # Custom config file
--json            # JSON output
--no-color       # Disable colors
```

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