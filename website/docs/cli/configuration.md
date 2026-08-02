---
sidebar_position: 8
title: Configuration
description: CLI configuration reference
---

# Configuration

Kysera CLI configuration file reference.

## Precedence

Settings resolve in this order — earlier sources win:

1. **Command-line flags** (`--config`, `-s/--schema`, ...)
2. **Environment variables** (`DATABASE_URL`, `KYSERA_CONFIG`)
3. **`.env` file** in the working directory — loaded automatically into the environment, but it **never overrides** variables that are already set
4. **Configuration file** (`kysera.config.ts` and friends)
5. **Built-in defaults**

Two environment variables get special treatment:

- **`DATABASE_URL`** overrides the connection from the config file. The dialect is taken from `database.dialect` when configured, otherwise detected from the URL (`postgres://`/`postgresql://`, `mysql://`/`mysql2://`, `sqlite://` or a `.db`/`.sqlite` suffix); if neither yields a dialect, the command fails with a configuration error.
- **`KYSERA_CONFIG`** names the configuration file to load when `--config` is not given.

## Configuration File

The CLI searches the current directory and then each parent directory for the first matching file:

1. `kysera.config.ts`
2. `kysera.config.js`
3. `kysera.config.mjs`
4. `kysera.config.cjs`
5. `kysera.config.json`
6. `.kyserarc.ts`
7. `.kyserarc.js`
8. `.kyserarc.json`

Pass `--config <path>` (or set `KYSERA_CONFIG`) to use a specific file instead. Relative paths inside the file (`migrations.directory`, `generate.*`, `testing.*`) resolve relative to the config file's directory, not the working directory.

Create `kysera.config.ts` in your project root with a plain default export:

```typescript
export default {
  // Configuration options
}
```

:::note No imports needed
`@kysera/cli` is a binary-only package — it does not export a `defineConfig` helper (or anything else). Export a plain object; the CLI validates it against its configuration schema at load time, so mistakes are reported when a command runs.
:::

## Full Configuration

```typescript
export default {
  // Database connection
  database: {
    dialect: 'postgres', // postgres | mysql | sqlite

    // Primary form: connection string or object.
    // ${VAR} and $VAR are interpolated from the environment.
    connection: '${DATABASE_URL}',

    schema: 'public', // PostgreSQL schema (default: 'public')
    pool: {
      min: 2,
      max: 10
    },
    debug: false
  },

  // Migrations
  migrations: {
    directory: './migrations',
    pattern: '{timestamp}_{name}.ts',
    tableName: 'migrations', // default: 'migrations' (same as the library runner)
    lockTable: true,
    lockTimeout: 10000
  },

  // Code generation
  generate: {
    repositories: './src/repositories',
    models: './src/models',
    schemas: './src/schemas',
    migrations: './migrations',
    style: {
      quotes: 'single', // single | double
      semi: false,
      indent: 2,
      trailingComma: 'es5' // none | es5 | all
    }
  },

  // Testing
  testing: {
    seeds: './tests/seeds',
    fixtures: './tests/fixtures',
    isolation: {
      useTransactions: true,
      resetSequences: true
    }
  },

  // Plugins
  plugins: {
    softDelete: {
      enabled: true,
      deletedAtColumn: 'deleted_at'
    },
    timestamps: {
      enabled: true,
      createdAtColumn: 'created_at',
      updatedAtColumn: 'updated_at'
    },
    audit: {
      enabled: false
    },
    rls: {
      enabled: false
    }
  },

  // Logging
  logging: {
    level: 'info', // debug | info | warn | error
    format: 'pretty', // pretty | json
    destinations: [{ type: 'console' }]
  },

  // Health checks
  health: {
    enabled: true,
    interval: 60000,
    slowQueryThreshold: 100
  }
}
```

## Database Configuration

`connection` is the primary form and accepts a connection string or an object. When `connection` is absent, PostgreSQL and MySQL also honor the structured fields (`host`, `port`, `database`, `user`, `password`, `ssl`) directly on `database`. If both are present, `connection` wins.

### Connection String

```typescript
export default {
  database: {
    dialect: 'postgres',
    connection: 'postgres://user:pass@localhost:5432/myapp'
  }
}
```

Environment variables are interpolated with `${VAR}` or `$VAR` syntax:

```typescript
export default {
  database: {
    dialect: 'postgres',
    connection: '${DATABASE_URL}'
  }
}
```

### Connection Object

```typescript
export default {
  database: {
    dialect: 'postgres',
    connection: {
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      user: 'postgres',
      password: process.env.DB_PASSWORD ?? '',
      ssl: true
    }
  }
}
```

### Structured Fields (PostgreSQL/MySQL)

```typescript
export default {
  database: {
    dialect: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'myapp',
    user: 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: true,
    schema: 'public', // Default schema for operations
    pool: { min: 2, max: 10 }
  }
}
```

### PostgreSQL with Schema (Multi-Tenant)

For multi-tenant applications using schema-per-tenant pattern:

```typescript
export default {
  database: {
    dialect: 'postgres',
    connection: '${DATABASE_URL}',
    schema: process.env.TENANT_SCHEMA || 'public' // Dynamic schema
  }
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

{/* doc-snippet: skip */}
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

{/* doc-snippet: skip */}
```typescript
database: {
  dialect: 'sqlite',
  database: './data/app.db'
}
```

## Migrations Configuration

{/* doc-snippet: skip */}
```typescript
migrations: {
  directory: './migrations',        // Migration file location
  pattern: '{timestamp}_{name}.ts', // Filename pattern
  tableName: 'migrations',          // Tracking table (default: 'migrations')
  schema: 'public',                 // PostgreSQL schema for the tracking table
  lockTable: true,                  // Serialize concurrent runs via a database
                                    // advisory lock (postgres/mysql; sqlite is
                                    // single-writer anyway). false = unsafe
  lockTimeout: 10000,               // Max wait for the advisory lock, in ms
  templates: {
    create: './templates/migration.ts', // Optional custom templates
    table: './templates/table.ts'
  }
}
```

:::note
`kysera migrate create` writes to `./migrations` or the `--dir` flag — it does not currently read `migrations.directory` from the config. All other migrate commands honor the config.
:::

## Code Generation

{/* doc-snippet: skip */}
```typescript
generate: {
  repositories: './src/repositories', // Repository output directory
  models: './src/models',             // Model output directory
  schemas: './src/schemas',           // Zod schema output directory
  migrations: './migrations',         // Generated migration directory
  style: {
    quotes: 'single',
    semi: false,
    indent: 2,
    trailingComma: 'es5'
  },
  templates: {
    repository: './templates/repository.ts', // Optional custom templates
    model: './templates/model.ts',
    schema: './templates/schema.ts'
  }
}
```

## Testing Configuration

{/* doc-snippet: skip */}
```typescript
testing: {
  database: '${TEST_DATABASE_URL}', // Optional dedicated test database
  seeds: './tests/seeds',
  fixtures: './tests/fixtures',
  isolation: {
    useTransactions: true,            // Wrap tests in rolled-back transactions
    truncateTables: ['users', 'posts'], // Tables to truncate between tests
    resetSequences: true              // Reset auto-increment sequences
  }
}
```

## Plugin Configuration

Plugin keys are `softDelete`, `timestamps`, `audit`, and `rls`.

### Soft Delete

{/* doc-snippet: skip */}
```typescript
plugins: {
  softDelete: {
    enabled: true,
    deletedAtColumn: 'deleted_at',
    tables: ['users', 'posts']      // Only these tables
  }
}
```

### Timestamps

{/* doc-snippet: skip */}
```typescript
plugins: {
  timestamps: {
    enabled: true,
    createdAtColumn: 'created_at',
    updatedAtColumn: 'updated_at',
    dateFormat: 'iso'               // iso | unix | date
  }
}
```

### Audit

{/* doc-snippet: skip */}
```typescript
plugins: {
  audit: {
    enabled: true,
    auditTable: 'audit_logs',
    excludeTables: ['audit_logs', 'sessions']
  }
}
```

### Row-Level Security

{/* doc-snippet: skip */}
```typescript
plugins: {
  rls: {
    enabled: true,
    bypassRoles: ['admin'],
    requireContext: true,
    defaultDeny: true
  }
}
```

## Logging Configuration

{/* doc-snippet: skip */}
```typescript
logging: {
  level: 'info',    // debug | info | warn | error
  format: 'pretty', // pretty | json
  destinations: [
    { type: 'console' },
    { type: 'file', path: './logs/kysera.log' }
  ],
  queries: {
    enabled: false,
    slowQueryThreshold: 100, // ms
    includeParams: false
  }
}
```

## Health Configuration

{/* doc-snippet: skip */}
```typescript
health: {
  enabled: true,
  interval: 60000,          // Check interval in ms
  slowQueryThreshold: 100,  // ms
  collectMetrics: true,
  metricsRetention: 3600000 // ms
}
```

## Environment Variables

Use environment variables for sensitive data — either via `process.env` in a TypeScript config or `${VAR}` interpolation in connection strings:

{/* doc-snippet: skip */}
```typescript
database: {
  dialect: 'postgres',
  connection: 'postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/myapp'
}
```

:::tip .env is loaded automatically
On startup the CLI loads a `.env` file from the current working directory (if present), so `${VAR}` interpolation and `process.env` in a TypeScript config both see its values. Variables already set in the real environment are **never overridden** by `.env` — CI-provided values always win.
:::

The quickest zero-config setup is often no `connection` in the file at all:

```bash
# .env (gitignored)
DATABASE_URL=postgres://app:secret@localhost:5432/myapp
```

`DATABASE_URL` overrides whatever connection the config file specifies (see [Precedence](#precedence)).

## Multiple Environments

{/* doc-snippet: skip */}
```typescript
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

export default {
  database: {
    dialect: 'postgres',
    ...databases[env],
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
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
