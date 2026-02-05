---
sidebar_position: 8
title: Configuration
description: CLI configuration reference
---

# Configuration

Kysera CLI configuration file reference.

## Configuration File

Create `kysera.config.ts` in your project root:

```typescript
import { defineConfig } from '@kysera/cli'

export default defineConfig({
  // Configuration options
})
```

## Full Configuration

```typescript
import { defineConfig } from '@kysera/cli'

export default defineConfig({
  // Database connection
  database: {
    dialect: 'postgres', // postgres | mysql | sqlite
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'myapp',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    schema: 'public', // PostgreSQL schema (default: 'public')
    pool: {
      min: 2,
      max: 10
    },
    ssl: process.env.DB_SSL === 'true'
  },

  // Migrations
  migrations: {
    directory: './migrations',
    tableName: 'kysera_migrations',
    timezone: 'UTC'
  },

  // Code generation
  generation: {
    outputDir: './src/generated',
    typescript: true,
    validation: 'zod' // zod | none
  },

  // Testing
  testing: {
    seeds: './seeds',
    fixtures: './fixtures',
    isolation: 'transaction' // transaction | schema | database
  },

  // Plugins
  plugins: {
    '@kysera/soft-delete': {
      enabled: true,
      deletedAtColumn: 'deleted_at'
    },
    '@kysera/timestamps': {
      enabled: true,
      createdAtColumn: 'created_at',
      updatedAtColumn: 'updated_at'
    },
    '@kysera/audit': {
      enabled: false
    },
    '@kysera/rls': {
      enabled: false
    }
  }
})
```

## Database Configuration

### PostgreSQL

```typescript
database: {
  dialect: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  user: 'postgres',
  password: 'secret',
  schema: 'public',              // Default schema for operations
  pool: { min: 2, max: 10 },
  ssl: {
    rejectUnauthorized: false  // For self-signed certs
  }
}
```

### PostgreSQL with Schema (Multi-Tenant)

For multi-tenant applications using schema-per-tenant pattern:

```typescript
database: {
  dialect: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  user: 'postgres',
  password: 'secret',
  schema: process.env.TENANT_SCHEMA || 'public'  // Dynamic schema
}
```

:::tip Schema Override
The `--schema` CLI option always takes precedence over the config file setting. This allows you to run operations on different schemas without modifying config:

```bash
# Run migrations on tenant schema
kysera migrate up --schema tenant_acme

# List tables in specific schema
kysera db tables --schema auth
```
:::

### MySQL

```typescript
database: {
  dialect: 'mysql',
  host: 'localhost',
  port: 3306,
  database: 'myapp',
  user: 'root',
  password: 'secret'
}
```

### SQLite

```typescript
database: {
  dialect: 'sqlite',
  database: './data/app.db'
}
```

## Environment Variables

Use environment variables for sensitive data:

```typescript
database: {
  host: process.env.DB_HOST,
  password: process.env.DB_PASSWORD
}
```

### .env File

```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=myapp
DB_USER=postgres
DB_PASSWORD=secret
```

## Multiple Environments

```typescript
import { defineConfig } from '@kysera/cli'

const env = process.env.NODE_ENV || 'development'

const databases = {
  development: {
    host: 'localhost',
    database: 'myapp_dev'
  },
  test: {
    host: 'localhost',
    database: 'myapp_test'
  },
  production: {
    host: process.env.DB_HOST,
    database: process.env.DB_NAME
  }
}

export default defineConfig({
  database: {
    dialect: 'postgres',
    ...databases[env],
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  }
})
```

## Plugin Configuration

### Soft Delete

```typescript
plugins: {
  '@kysera/soft-delete': {
    enabled: true,
    deletedAtColumn: 'deleted_at',
    tables: ['users', 'posts']      // Only these tables
  }
}
```

### Timestamps

```typescript
plugins: {
  '@kysera/timestamps': {
    enabled: true,
    createdAtColumn: 'created_at',
    updatedAtColumn: 'updated_at',
    dateFormat: 'iso'               // iso | unix | date
  }
}
```

### Audit

```typescript
plugins: {
  '@kysera/audit': {
    enabled: true,
    auditTable: 'audit_logs',
    excludeTables: ['audit_logs', 'sessions']
  }
}
```

## TypeScript Configuration

The config file uses TypeScript. Ensure your `tsconfig.json` supports it:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

## CLI Overrides

Command-line options override config file:

```bash
# Override database
kysera migrate up --config ./other-config.ts

# Override with env
DB_NAME=other_db kysera migrate status
```
