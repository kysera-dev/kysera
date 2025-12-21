---
sidebar_position: 5
title: "@kysera/dialects"
description: Dialect-specific utilities for PostgreSQL, MySQL, and SQLite
---

# @kysera/dialects

Dialect-specific utilities for Kysely database operations. Provides a unified adapter interface for PostgreSQL, MySQL, and SQLite with connection management, error detection, and database introspection.

## Installation

```bash
npm install @kysera/dialects kysely
```

## Overview

**Dependencies:** None (peer: kysely >=0.28.8)
**Database Support:** PostgreSQL, MySQL, SQLite

:::info Package Type
This is a **utility package** providing dialect-specific abstractions. It works with Kysely instances directly and is used internally by other Kysera packages (executor, repository, DAL) for cross-database compatibility.
:::

## Key Features

- **Unified Adapter Interface** - Single API for all supported dialects
- **Connection URL Utilities** - Parse and build connection URLs
- **Error Detection** - Identify constraint violations (unique, foreign key, not-null)
- **Database Introspection** - Check table existence, get columns, list tables
- **Dialect Helpers** - Identifier escaping, timestamp formatting, date handling
- **Testing Utilities** - Truncate tables, get database size

## Quick Start

### Using Adapters (Recommended)

```typescript
import { getAdapter } from '@kysera/dialects';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

const db = new Kysely({
  dialect: new PostgresDialect({ pool: new Pool({ /* ... */ }) })
});

// Get adapter for your dialect
const adapter = getAdapter('postgres');

// Use adapter methods
const exists = await adapter.tableExists(db, 'users');
console.log('Users table exists:', exists);

// Get table columns
const columns = await adapter.getTableColumns(db, 'users');
console.log('Columns:', columns);

// Get all tables
const tables = await adapter.getTables(db);
console.log('Tables:', tables);

// Escape identifiers
const escaped = adapter.escapeIdentifier('user-data');
console.log('Escaped:', escaped); // "user-data"

// Check error types
try {
  await db.insertInto('users').values({ email: 'duplicate@example.com' }).execute();
} catch (error) {
  if (adapter.isUniqueConstraintError(error)) {
    console.log('Duplicate email!');
  }
}
```

### Using Helper Functions (Backward Compatible)

```typescript
import {
  tableExists,
  getTableColumns,
  escapeIdentifier,
  isUniqueConstraintError,
  parseConnectionUrl,
  buildConnectionUrl
} from '@kysera/dialects';

// Check table existence
const exists = await tableExists(db, 'users', 'postgres');

// Get columns
const columns = await getTableColumns(db, 'users', 'mysql');

// Escape identifier
const escaped = escapeIdentifier('my-table', 'sqlite');

// Parse connection URL
const config = parseConnectionUrl('postgresql://user:pass@localhost:5432/mydb?ssl=true');
// { host: 'localhost', port: 5432, database: 'mydb', user: 'user', password: 'pass', ssl: true }

// Build connection URL
const url = buildConnectionUrl('postgres', {
  host: 'localhost',
  database: 'mydb',
  user: 'admin',
  password: 'secret'
});
// 'postgresql://admin:secret@localhost:5432/mydb'
```

## Exports

```typescript
// Types
export type {
  DatabaseDialect,      // 'postgres' | 'mysql' | 'sqlite'
  ConnectionConfig,     // Connection configuration interface
  DialectAdapter,       // Adapter interface
  DatabaseErrorLike     // Error object shape
} from './types';

// Factory and adapters
export {
  getAdapter,           // Get singleton adapter instance
  createDialectAdapter, // Create new adapter instance
  registerAdapter       // Register custom adapter
} from './factory';

export {
  PostgresAdapter,      // PostgreSQL adapter class
  postgresAdapter       // PostgreSQL singleton
} from './adapters/postgres';

export {
  MySQLAdapter,         // MySQL adapter class
  mysqlAdapter          // MySQL singleton
} from './adapters/mysql';

export {
  SQLiteAdapter,        // SQLite adapter class
  sqliteAdapter         // SQLite singleton
} from './adapters/sqlite';

// Connection utilities
export {
  parseConnectionUrl,   // Parse database URL
  buildConnectionUrl,   // Build database URL
  getDefaultPort        // Get default port for dialect
} from './connection';

// Helper functions (standalone, backward compatible)
export {
  tableExists,          // Check if table exists
  getTableColumns,      // Get table column names
  getTables,            // Get all tables
  escapeIdentifier,     // Escape SQL identifier
  getCurrentTimestamp,  // Get current timestamp expression
  formatDate,           // Format date for database
  isUniqueConstraintError,    // Check unique constraint error
  isForeignKeyError,          // Check foreign key error
  isNotNullError,             // Check not-null constraint error
  getDatabaseSize,            // Get database size in bytes
  truncateAllTables           // Truncate all tables (testing)
} from './helpers';
```

## Core Concepts

### Adapter Pattern

The `DialectAdapter` interface provides a unified API for dialect-specific operations:

```typescript
interface DialectAdapter {
  readonly dialect: DatabaseDialect;

  // Port and formatting
  getDefaultPort(): number | null;
  getCurrentTimestamp(): string;
  escapeIdentifier(identifier: string): string;
  formatDate(date: Date): string;

  // Error detection
  isUniqueConstraintError(error: unknown): boolean;
  isForeignKeyError(error: unknown): boolean;
  isNotNullError(error: unknown): boolean;

  // Introspection
  tableExists(db: Kysely<any>, tableName: string): Promise<boolean>;
  getTableColumns(db: Kysely<any>, tableName: string): Promise<string[]>;
  getTables(db: Kysely<any>): Promise<string[]>;

  // Testing utilities
  getDatabaseSize(db: Kysely<any>, databaseName?: string): Promise<number>;
  truncateTable(db: Kysely<any>, tableName: string): Promise<void>;
  truncateAllTables(db: Kysely<any>, exclude?: string[]): Promise<void>;
}
```

**Benefits:**
- Single API for all databases
- Type-safe dialect operations
- Extensible (register custom adapters)
- Zero runtime dependencies

## API Reference

### Factory Functions

#### `getAdapter(dialect)`

Get a singleton adapter instance for the specified dialect.

```typescript
function getAdapter(dialect: DatabaseDialect): DialectAdapter

// Example
const adapter = getAdapter('postgres');
console.log(adapter.getDefaultPort()); // 5432
```

**Supported dialects:** `postgres`, `mysql`, `sqlite`

#### `createDialectAdapter(dialect)`

Create a new adapter instance (useful for testing or customization).

```typescript
function createDialectAdapter(dialect: DatabaseDialect): DialectAdapter

// Example
const adapter = createDialectAdapter('mysql');
```

#### `registerAdapter(adapter)`

Register a custom dialect adapter.

```typescript
function registerAdapter(adapter: DialectAdapter): void

// Example
class CustomAdapter implements DialectAdapter {
  readonly dialect = 'postgres' as const;
  // ... implement all methods
}

registerAdapter(new CustomAdapter());
```

### Adapter Interface

Each adapter implements the full `DialectAdapter` interface:

#### Port and Formatting Methods

```typescript
// Get default port
adapter.getDefaultPort()
// postgres: 5432, mysql: 3306, sqlite: null

// Get current timestamp SQL expression
adapter.getCurrentTimestamp()
// postgres/mysql: 'CURRENT_TIMESTAMP', sqlite: "datetime('now')"

// Escape identifier
adapter.escapeIdentifier('my-table')
// postgres: "my-table", mysql: `my-table`, sqlite: "my-table"

// Format date for database
adapter.formatDate(new Date('2024-01-15T10:30:00Z'))
// postgres: '2024-01-15T10:30:00.000Z'
// mysql: '2024-01-15 10:30:00'
// sqlite: '2024-01-15T10:30:00.000Z'
```

#### Error Detection Methods

```typescript
// Check unique constraint violation
adapter.isUniqueConstraintError(error)
// postgres: code === '23505'
// mysql: code === 'ER_DUP_ENTRY'
// sqlite: message includes 'UNIQUE constraint failed'

// Check foreign key violation
adapter.isForeignKeyError(error)
// postgres: code === '23503'
// mysql: code === 'ER_NO_REFERENCED_ROW_2'
// sqlite: message includes 'FOREIGN KEY constraint failed'

// Check not-null violation
adapter.isNotNullError(error)
// postgres: code === '23502'
// mysql: code === 'ER_BAD_NULL_ERROR'
// sqlite: message includes 'NOT NULL constraint failed'
```

#### Introspection Methods

```typescript
// Check if table exists
await adapter.tableExists(db, 'users')
// Returns: boolean

// Get table columns
await adapter.getTableColumns(db, 'users')
// Returns: ['id', 'name', 'email', 'created_at']

// Get all tables
await adapter.getTables(db)
// Returns: ['users', 'posts', 'comments']

// Get database size in bytes
await adapter.getDatabaseSize(db, 'mydb')
// Returns: number (bytes)

// Truncate single table
await adapter.truncateTable(db, 'users')

// Truncate all tables (exclude migrations)
await adapter.truncateAllTables(db, ['kysely_migrations'])
```

### Connection Utilities

#### `parseConnectionUrl(url)`

Parse database connection URL into configuration object.

```typescript
function parseConnectionUrl(url: string): ConnectionConfig

// Examples
const config1 = parseConnectionUrl('postgresql://user:pass@localhost:5432/mydb?ssl=true');
// {
//   host: 'localhost',
//   port: 5432,
//   database: 'mydb',
//   user: 'user',
//   password: 'pass',
//   ssl: true
// }

const config2 = parseConnectionUrl('mysql://localhost/testdb');
// {
//   host: 'localhost',
//   port: undefined,
//   database: 'testdb',
//   user: undefined,
//   password: undefined,
//   ssl: false
// }

const config3 = parseConnectionUrl('sqlite://./data/app.db');
// {
//   host: '.',
//   port: undefined,
//   database: 'data/app.db',
//   user: undefined,
//   password: undefined,
//   ssl: false
// }
```

#### `buildConnectionUrl(dialect, config)`

Build connection URL from configuration object.

```typescript
function buildConnectionUrl(
  dialect: DatabaseDialect,
  config: ConnectionConfig
): string

// Examples
const url1 = buildConnectionUrl('postgres', {
  host: 'localhost',
  database: 'mydb',
  user: 'admin',
  password: 'secret',
  ssl: true
});
// 'postgresql://admin:secret@localhost:5432/mydb?ssl=true'

const url2 = buildConnectionUrl('mysql', {
  host: 'db.example.com',
  port: 3307,
  database: 'production'
});
// 'mysql://db.example.com:3307/production'

const url3 = buildConnectionUrl('sqlite', {
  database: './data/app.db'
});
// 'sqlite://localhost/./data/app.db'
```

**Features:**
- Auto-fills default ports
- Supports optional authentication
- Handles SSL configuration
- Protocol mapping (postgres → postgresql)

#### `getDefaultPort(dialect)`

Get default port for a dialect.

```typescript
function getDefaultPort(dialect: DatabaseDialect): number | null

getDefaultPort('postgres') // 5432
getDefaultPort('mysql')    // 3306
getDefaultPort('sqlite')   // null
```

### Helper Functions

All helper functions accept `dialect` as the last parameter for backward compatibility:

```typescript
// Introspection
await tableExists(db, 'users', 'postgres')
await getTableColumns(db, 'users', 'mysql')
await getTables(db, 'sqlite')

// Formatting
escapeIdentifier('my-table', 'postgres')    // "my-table"
getCurrentTimestamp('mysql')                // 'CURRENT_TIMESTAMP'
formatDate(new Date(), 'sqlite')            // '2024-01-15T10:30:00.000Z'

// Error detection
isUniqueConstraintError(error, 'postgres')
isForeignKeyError(error, 'mysql')
isNotNullError(error, 'sqlite')

// Testing utilities
await getDatabaseSize(db, 'postgres', 'mydb')
await truncateAllTables(db, 'postgres', ['kysely_migrations'])
```

:::tip Recommendation
Use the adapter interface (`getAdapter()`) instead of helper functions for better type safety and performance (avoids repeated adapter lookups).
:::

## Types

### `DatabaseDialect`

Supported database dialects.

```typescript
type DatabaseDialect = 'postgres' | 'mysql' | 'sqlite'
```

### `ConnectionConfig`

Database connection configuration.

```typescript
interface ConnectionConfig {
  host?: string | undefined;
  port?: number | undefined;
  database: string;
  user?: string | undefined;
  password?: string | undefined;
  ssl?: boolean | undefined;
}
```

### `DialectAdapter`

Interface for dialect-specific operations (see [Adapter Pattern](#adapter-pattern) above).

### `DatabaseErrorLike`

Error object shape for database error detection.

```typescript
interface DatabaseErrorLike {
  message?: string;
  code?: string;
}
```

## Use Cases and Examples

### 1. Multi-Database Application

Support multiple databases in a single application:

```typescript
import { getAdapter, DatabaseDialect } from '@kysera/dialects';

async function setupDatabase(db: Kysely<any>, dialect: DatabaseDialect) {
  const adapter = getAdapter(dialect);

  // Check if migrations table exists
  const hasMigrations = await adapter.tableExists(db, 'kysely_migrations');
  if (!hasMigrations) {
    console.log('Running first-time setup...');
  }

  // Get all existing tables
  const tables = await adapter.getTables(db);
  console.log(`Found ${tables.length} tables`);
}

// Works with any dialect
await setupDatabase(postgresDb, 'postgres');
await setupDatabase(mysqlDb, 'mysql');
await setupDatabase(sqliteDb, 'sqlite');
```

### 2. Graceful Error Handling

Detect and handle database constraint violations:

```typescript
import { getAdapter } from '@kysera/dialects';

async function createUser(db: Kysely<Database>, email: string, dialect: DatabaseDialect) {
  const adapter = getAdapter(dialect);

  try {
    const user = await db
      .insertInto('users')
      .values({ email, name: 'New User' })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { success: true, user };
  } catch (error) {
    if (adapter.isUniqueConstraintError(error)) {
      return { success: false, error: 'Email already exists' };
    }
    if (adapter.isForeignKeyError(error)) {
      return { success: false, error: 'Invalid reference' };
    }
    if (adapter.isNotNullError(error)) {
      return { success: false, error: 'Required field missing' };
    }
    throw error; // Unknown error
  }
}
```

### 3. Dynamic SQL Generation

Generate dialect-specific SQL:

```typescript
import { getAdapter } from '@kysera/dialects';

function buildTimestampQuery(dialect: DatabaseDialect) {
  const adapter = getAdapter(dialect);

  return `
    INSERT INTO logs (message, created_at)
    VALUES ('System started', ${adapter.getCurrentTimestamp()})
  `;
}

// postgres/mysql: VALUES ('System started', CURRENT_TIMESTAMP)
// sqlite: VALUES ('System started', datetime('now'))
```

### 4. Database Introspection

Inspect database schema:

```typescript
import { getAdapter } from '@kysera/dialects';

async function inspectDatabase(db: Kysely<any>, dialect: DatabaseDialect) {
  const adapter = getAdapter(dialect);

  const tables = await adapter.getTables(db);

  const schema: Record<string, string[]> = {};
  for (const table of tables) {
    schema[table] = await adapter.getTableColumns(db, table);
  }

  return schema;
}

// Returns:
// {
//   users: ['id', 'name', 'email', 'created_at'],
//   posts: ['id', 'user_id', 'title', 'content', 'created_at']
// }
```

### 5. Testing Utilities

Clean database state between tests:

```typescript
import { getAdapter } from '@kysera/dialects';
import { beforeEach, describe, it } from 'vitest';

describe('User Repository', () => {
  const adapter = getAdapter('postgres');

  beforeEach(async () => {
    // Truncate all tables except migrations
    await adapter.truncateAllTables(db, ['kysely_migrations']);
  });

  it('creates user', async () => {
    const user = await createUser({ email: 'test@example.com' });
    expect(user.email).toBe('test@example.com');
  });
});
```

### 6. Connection URL Management

Parse and build connection URLs:

```typescript
import { parseConnectionUrl, buildConnectionUrl } from '@kysera/dialects';

// Parse from environment variable
const config = parseConnectionUrl(process.env.DATABASE_URL!);
console.log(`Connecting to ${config.host}:${config.port}`);

// Build for different environments
const devUrl = buildConnectionUrl('postgres', {
  host: 'localhost',
  database: 'myapp_dev',
  user: 'dev',
  password: 'dev'
});

const prodUrl = buildConnectionUrl('postgres', {
  host: 'db.production.com',
  database: 'myapp_prod',
  user: 'app',
  password: process.env.DB_PASSWORD!,
  ssl: true
});
```

### 7. Database Migration Validation

Validate migration state:

```typescript
import { getAdapter } from '@kysera/dialects';

async function validateMigrations(db: Kysely<any>, dialect: DatabaseDialect) {
  const adapter = getAdapter(dialect);

  const hasMigrationsTable = await adapter.tableExists(db, 'kysely_migrations');
  if (!hasMigrationsTable) {
    throw new Error('Migrations table not found. Run migrations first.');
  }

  const requiredTables = ['users', 'posts', 'comments'];
  const existingTables = await adapter.getTables(db);

  const missingTables = requiredTables.filter(
    table => !existingTables.includes(table)
  );

  if (missingTables.length > 0) {
    throw new Error(`Missing tables: ${missingTables.join(', ')}`);
  }

  console.log('✓ All required tables exist');
}
```

### 8. Database Size Monitoring

Monitor database growth:

```typescript
import { getAdapter } from '@kysera/dialects';

async function monitorDatabaseSize(db: Kysely<any>, dialect: DatabaseDialect) {
  const adapter = getAdapter(dialect);

  const sizeBytes = await adapter.getDatabaseSize(db);
  const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);

  console.log(`Database size: ${sizeMB} MB`);

  if (sizeBytes > 1024 * 1024 * 1024) { // 1 GB
    console.warn('Database exceeds 1 GB, consider archiving old data');
  }
}
```

## Dialect-Specific Behavior

### PostgreSQL

```typescript
const adapter = getAdapter('postgres');

adapter.getDefaultPort()              // 5432
adapter.getCurrentTimestamp()         // 'CURRENT_TIMESTAMP'
adapter.escapeIdentifier('my-table')  // "my-table"
adapter.formatDate(new Date())        // ISO string
adapter.isUniqueConstraintError(e)    // code === '23505'
adapter.isForeignKeyError(e)          // code === '23503'
adapter.isNotNullError(e)             // code === '23502'

// Uses information_schema.tables for introspection
// Uses pg_database_size() for database size
// TRUNCATE with RESTART IDENTITY CASCADE
```

### MySQL

```typescript
const adapter = getAdapter('mysql');

adapter.getDefaultPort()              // 3306
adapter.getCurrentTimestamp()         // 'CURRENT_TIMESTAMP'
adapter.escapeIdentifier('my-table')  // `my-table`
adapter.formatDate(new Date())        // 'YYYY-MM-DD HH:MM:SS'
adapter.isUniqueConstraintError(e)    // code === 'ER_DUP_ENTRY'
adapter.isForeignKeyError(e)          // code === 'ER_NO_REFERENCED_ROW_2'
adapter.isNotNullError(e)             // code === 'ER_BAD_NULL_ERROR'

// Uses information_schema.tables for introspection
// Uses SUM(data_length + index_length) for database size
// TRUNCATE with foreign key checks disabled
```

### SQLite

```typescript
const adapter = getAdapter('sqlite');

adapter.getDefaultPort()              // null
adapter.getCurrentTimestamp()         // "datetime('now')"
adapter.escapeIdentifier('my-table')  // "my-table"
adapter.formatDate(new Date())        // ISO string
adapter.isUniqueConstraintError(e)    // message includes 'UNIQUE constraint'
adapter.isForeignKeyError(e)          // message includes 'FOREIGN KEY constraint'
adapter.isNotNullError(e)             // message includes 'NOT NULL constraint'

// Uses sqlite_master for introspection
// Uses page_count * page_size for database size
// DELETE FROM for truncation (SQLite has no TRUNCATE)
```

## Integration with Other Packages

### Used by @kysera/executor

```typescript
// Executor uses dialects for error detection
import { createExecutor } from '@kysera/executor';
import { getAdapter } from '@kysera/dialects';

const executor = await createExecutor(db, [], {
  dialect: 'postgres' // Uses adapter internally
});
```

### Used by @kysera/repository

```typescript
// Repository uses dialects for constraint error handling
import { createORM } from '@kysera/repository';

const orm = await createORM(db, [], {
  dialect: 'mysql' // Uses adapter for error detection
});
```

### Used by @kysera/dal

```typescript
// DAL uses dialects for cross-database compatibility
import { createContext } from '@kysera/dal';

const ctx = createContext(db, {
  dialect: 'sqlite' // Uses adapter for introspection
});
```

## Best Practices

1. **Use adapters over helper functions:**
   ```typescript
   // ✅ Good - single adapter lookup
   const adapter = getAdapter('postgres');
   const exists = await adapter.tableExists(db, 'users');
   const columns = await adapter.getTableColumns(db, 'users');

   // ❌ Avoid - multiple adapter lookups
   const exists = await tableExists(db, 'users', 'postgres');
   const columns = await getTableColumns(db, 'users', 'postgres');
   ```

2. **Store dialect in configuration:**
   ```typescript
   // ✅ Good - single source of truth
   const config = { dialect: 'postgres' as DatabaseDialect };
   const adapter = getAdapter(config.dialect);

   // ❌ Avoid - hardcoded dialect strings
   const adapter = getAdapter('postgres');
   ```

3. **Handle all constraint errors:**
   ```typescript
   // ✅ Good - comprehensive error handling
   if (adapter.isUniqueConstraintError(e)) { /* ... */ }
   else if (adapter.isForeignKeyError(e)) { /* ... */ }
   else if (adapter.isNotNullError(e)) { /* ... */ }
   else throw e;
   ```

4. **Use connection URLs in production:**
   ```typescript
   // ✅ Good - single DATABASE_URL environment variable
   const config = parseConnectionUrl(process.env.DATABASE_URL!);

   // ❌ Avoid - multiple environment variables
   const config = {
     host: process.env.DB_HOST,
     port: parseInt(process.env.DB_PORT!),
     // ...
   };
   ```

5. **Exclude migrations from truncation:**
   ```typescript
   // ✅ Good - preserve migration history
   await adapter.truncateAllTables(db, ['kysely_migrations']);

   // ❌ Avoid - truncating everything
   await adapter.truncateAllTables(db);
   ```

## Performance Considerations

- **Adapter lookup is fast:** Singleton instances are cached
- **Introspection queries:** Use `information_schema` (fast for small schemas)
- **Truncate operations:** Use database-specific optimizations (CASCADE, RESTART IDENTITY)
- **Error detection:** String/code matching is fast (no regex)

## Cross-Runtime Support

Works on Node.js >=20, Bun >=1.0, and Deno (experimental):

```typescript
// Node.js with pg
import pg from 'pg';
const { Pool } = pg;

// Bun with pg
import { Pool } from 'pg';

// Node.js with better-sqlite3
import Database from 'better-sqlite3';

// All work the same way
const adapter = getAdapter('postgres');
```

## Migration Guide

If you were using internal Kysera utilities for dialect operations:

```typescript
// Before (internal utilities)
import { detectDialect, isConstraintError } from '@kysera/core/internal';

// After (dedicated package)
import { getAdapter, isUniqueConstraintError } from '@kysera/dialects';

const adapter = getAdapter('postgres');
if (adapter.isUniqueConstraintError(error)) {
  // Handle duplicate
}
```

## Related Packages

- [@kysera/core](/docs/api/core) - Core utilities and types
- [@kysera/executor](/docs/api/executor) - Unified execution layer (uses dialects)
- [@kysera/repository](/docs/api/repository) - Repository pattern (uses dialects)
- [@kysera/dal](/docs/api/dal) - Functional data access layer (uses dialects)
