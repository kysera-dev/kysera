# @kysera/dialects

> Dialect-specific utilities for Kysely - PostgreSQL, MySQL, and SQLite support with unified adapter interface.

[![Version](https://img.shields.io/npm/v/@kysera/dialects.svg)](https://www.npmjs.com/package/@kysera/dialects)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## 🎯 Features

- ✅ **Zero Runtime Dependencies** - Only peer dependency on Kysely
- ✅ **Unified Adapter Interface** - Consistent API across all dialects
- ✅ **Multi-Database Support** - PostgreSQL, MySQL, and SQLite with dialect-specific adapters
- ✅ **Error Detection** - Detect unique, foreign key, and not-null constraint violations
- ✅ **Connection Utilities** - Parse and build connection URLs
- ✅ **Schema Introspection** - Table existence checks, column enumeration, database size
- ✅ **Testing Helpers** - Truncate tables with recoverable vs critical error handling
- ✅ **100% Type Safe** - Full TypeScript support with strict mode
- ✅ **Cross-Runtime** - Works on Node.js, Bun, and Deno

## 📦 Related Packages

- **[@kysera/core](../core)** - Error handling, pagination, types, logger interface
- **[@kysera/executor](../executor)** - Unified Execution Layer with plugin interception
- **[@kysera/dal](../dal)** - Functional Data Access Layer with composable queries
- **[@kysera/repository](../repository)** - Repository pattern with plugin support
- **[@kysera/testing](../testing)** - Testing utilities, factories, database cleanup

## 📥 Installation

```bash
# npm
npm install @kysera/dialects kysely

# pnpm
pnpm add @kysera/dialects kysely

# bun
bun add @kysera/dialects kysely

# deno
import * as dialects from "npm:@kysera/dialects"
```

## 🚀 Quick Start

### Using Adapter Interface

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { getAdapter } from '@kysera/dialects'

// Create database connection
const db = new Kysely({
  dialect: new PostgresDialect({
    pool: new Pool({
      /* config */
    })
  })
})

// Get dialect adapter
const adapter = getAdapter('postgres')

// Check if table exists
const exists = await adapter.tableExists(db, 'users')

// Get table columns
const columns = await adapter.getTableColumns(db, 'users')
// ['id', 'email', 'name', 'created_at', 'updated_at']

// Get all tables
const tables = await adapter.getTables(db)

// Get database size
const sizeBytes = await adapter.getDatabaseSize(db, 'mydb')
```

### Using Helper Functions

```typescript
import {
  tableExists,
  getTableColumns,
  escapeIdentifier,
  isUniqueConstraintError,
  isForeignKeyError,
  isNotNullError
} from '@kysera/dialects'

// Standalone helpers (backward compatible)
const exists = await tableExists(db, 'users', 'postgres')
const columns = await getTableColumns(db, 'users', 'postgres')

// Escape identifiers
const escaped = escapeIdentifier('user-data', 'mysql') // `user-data`
const pgEscaped = escapeIdentifier('user-data', 'postgres') // "user-data"

// Error detection
try {
  await db.insertInto('users').values({ email: 'duplicate@example.com' }).execute()
} catch (error) {
  if (isUniqueConstraintError(error, 'postgres')) {
    console.error('Email already exists')
  }
}
```

### Connection URL Utilities

```typescript
import { parseConnectionUrl, buildConnectionUrl, getDefaultPort } from '@kysera/dialects'

// Parse connection URL
const config = parseConnectionUrl('postgresql://user:pass@localhost:5432/mydb?ssl=true')
// {
//   host: 'localhost',
//   port: 5432,
//   database: 'mydb',
//   user: 'user',
//   password: 'pass',
//   ssl: true
// }

// Build connection URL
const url = buildConnectionUrl('postgres', {
  host: 'localhost',
  database: 'mydb',
  user: 'admin',
  password: 'secret'
})
// 'postgresql://admin:secret@localhost:5432/mydb'

// Get default ports
getDefaultPort('postgres') // 5432
getDefaultPort('mysql') // 3306
getDefaultPort('sqlite') // null
```

---

## 📚 Table of Contents

1. [Adapter Interface](#-adapter-interface)
   - [PostgreSQL Adapter](#postgresql-adapter)
   - [MySQL Adapter](#mysql-adapter)
   - [SQLite Adapter](#sqlite-adapter)
2. [Connection Utilities](#-connection-utilities)
   - [Parse Connection URL](#parse-connection-url)
   - [Build Connection URL](#build-connection-url)
   - [Get Default Port](#get-default-port)
3. [Error Detection](#-error-detection)
   - [Unique Constraint Errors](#unique-constraint-errors)
   - [Foreign Key Errors](#foreign-key-errors)
   - [Not-Null Errors](#not-null-errors)
4. [Helper Functions](#-helper-functions)
   - [Schema Introspection](#schema-introspection)
   - [Identifier Escaping](#identifier-escaping)
   - [Timestamp Utilities](#timestamp-utilities)
   - [Database Management](#database-management)
5. [API Reference](#-api-reference)
6. [Best Practices](#-best-practices)

---

## 🔌 Adapter Interface

The adapter pattern provides a unified interface for dialect-specific operations. Each dialect has its own adapter implementing the `DialectAdapter` interface.

### Getting Adapters

```typescript
import { getAdapter, createDialectAdapter } from '@kysera/dialects'

// Get singleton adapter (recommended)
const adapter = getAdapter('postgres')

// Create new adapter instance
const newAdapter = createDialectAdapter('mysql')
```

### PostgreSQL Adapter

```typescript
import { PostgresAdapter, postgresAdapter } from '@kysera/dialects'

// Use singleton
const adapter = postgresAdapter

// Or create instance
const adapter = new PostgresAdapter()

// Adapter methods
adapter.getDefaultPort() // 5432
adapter.getCurrentTimestamp() // 'CURRENT_TIMESTAMP'
adapter.escapeIdentifier('col') // '"col"'
adapter.formatDate(new Date()) // ISO 8601 string

// PostgreSQL error detection
adapter.isUniqueConstraintError(error) // Code: 23505
adapter.isForeignKeyError(error) // Code: 23503
adapter.isNotNullError(error) // Code: 23502
```

**PostgreSQL-specific features:**

- Uses `information_schema.tables` for schema introspection
- Filters by `table_schema = 'public'` by default
- Supports `pg_database_size()` for database size queries
- Error detection via PostgreSQL error codes (23xxx series)

### MySQL Adapter

```typescript
import { MySQLAdapter, mysqlAdapter } from '@kysera/dialects'

const adapter = mysqlAdapter

adapter.getDefaultPort() // 3306
adapter.getCurrentTimestamp() // 'CURRENT_TIMESTAMP'
adapter.escapeIdentifier('col') // '`col`'
adapter.formatDate(new Date()) // ISO 8601 string

// MySQL error detection
adapter.isUniqueConstraintError(error) // ER_DUP_ENTRY, ER_DUP_KEY
adapter.isForeignKeyError(error) // ER_NO_REFERENCED_ROW, ER_ROW_IS_REFERENCED
adapter.isNotNullError(error) // ER_BAD_NULL_ERROR, ER_NO_DEFAULT_FOR_FIELD
```

**MySQL-specific features:**

- Uses `information_schema.tables` with `table_schema = database()`
- Supports backtick identifier escaping
- Error detection via MySQL error codes (ER\_\* constants)
- Database size queries via `information_schema.tables`

### SQLite Adapter

```typescript
import { SQLiteAdapter, sqliteAdapter } from '@kysera/dialects'

const adapter = sqliteAdapter

adapter.getDefaultPort() // null (file-based)
adapter.getCurrentTimestamp() // "datetime('now')"
adapter.escapeIdentifier('col') // '"col"'
adapter.formatDate(new Date()) // ISO 8601 string

// SQLite error detection (message-based)
adapter.isUniqueConstraintError(error) // "UNIQUE constraint failed"
adapter.isForeignKeyError(error) // "FOREIGN KEY constraint failed"
adapter.isNotNullError(error) // "NOT NULL constraint failed"
```

**SQLite-specific features:**

- Uses `sqlite_master` for schema introspection
- No default port (file-based database)
- Error detection via message parsing
- Lightweight database size calculation via `page_count * page_size`

### Custom Adapter Registration

```typescript
import { registerAdapter, type DialectAdapter } from '@kysera/dialects'

class CustomDialectAdapter implements DialectAdapter {
  readonly dialect = 'custom' as any

  getDefaultPort() {
    return 9999
  }
  getCurrentTimestamp() {
    return 'NOW()'
  }
  // ... implement all required methods
}

// Register custom adapter
registerAdapter(new CustomDialectAdapter())

// Now available via getAdapter
const adapter = getAdapter('custom' as any)
```

---

## 🔗 Connection Utilities

### Parse Connection URL

Parse a database connection URL into a structured configuration object.

```typescript
import { parseConnectionUrl } from '@kysera/dialects'

// PostgreSQL
const config = parseConnectionUrl('postgresql://user:pass@localhost:5432/mydb?ssl=true')
// {
//   host: 'localhost',
//   port: 5432,
//   database: 'mydb',
//   user: 'user',
//   password: 'pass',
//   ssl: true
// }

// MySQL
const mysqlConfig = parseConnectionUrl('mysql://admin:secret@db.example.com:3306/production')
// {
//   host: 'db.example.com',
//   port: 3306,
//   database: 'production',
//   user: 'admin',
//   password: 'secret',
//   ssl: false
// }

// SQLite (file path)
const sqliteConfig = parseConnectionUrl('sqlite:///path/to/database.db')
// {
//   host: '',
//   port: undefined,
//   database: '/path/to/database.db',
//   user: undefined,
//   password: undefined,
//   ssl: false
// }
```

**Supported URL formats:**

- `postgresql://[user[:password]@][host][:port]/database[?ssl=true]`
- `mysql://[user[:password]@][host][:port]/database[?ssl=true]`
- `sqlite:///path/to/file.db`

### Build Connection URL

Build a connection URL from a configuration object.

```typescript
import { buildConnectionUrl } from '@kysera/dialects'

// Basic URL
const url = buildConnectionUrl('postgres', {
  host: 'localhost',
  database: 'mydb'
})
// 'postgresql://localhost:5432/mydb'

// With authentication
const authUrl = buildConnectionUrl('mysql', {
  host: 'db.example.com',
  database: 'production',
  user: 'admin',
  password: 'secret',
  port: 3306
})
// 'mysql://admin:secret@db.example.com:3306/production'

// With SSL
const sslUrl = buildConnectionUrl('postgres', {
  host: 'secure.db.com',
  database: 'app',
  user: 'readonly',
  ssl: true
})
// 'postgresql://readonly@secure.db.com:5432/app?ssl=true'
```

**Default ports:**

- PostgreSQL: 5432
- MySQL: 3306
- SQLite: null (file-based)

### Get Default Port

```typescript
import { getDefaultPort } from '@kysera/dialects'

getDefaultPort('postgres') // 5432
getDefaultPort('mysql') // 3306
getDefaultPort('sqlite') // null
```

---

## 🚨 Error Detection

Detect database constraint violations across different dialects with a unified API.

### Unique Constraint Errors

```typescript
import { isUniqueConstraintError } from '@kysera/dialects'

try {
  await db.insertInto('users').values({ email: 'existing@example.com', name: 'John' }).execute()
} catch (error) {
  if (isUniqueConstraintError(error, 'postgres')) {
    console.error('Email already exists')
    // Handle duplicate error
  }
}
```

**Detection criteria:**

| Dialect    | Detection Method                                           |
| ---------- | ---------------------------------------------------------- |
| PostgreSQL | Error code `23505` or message contains "unique constraint" |
| MySQL      | Error code `ER_DUP_ENTRY` or `ER_DUP_KEY`                  |
| SQLite     | Message contains "UNIQUE constraint failed"                |

### Foreign Key Errors

```typescript
import { isForeignKeyError } from '@kysera/dialects'

try {
  await db.insertInto('posts').values({ user_id: 999, title: 'Post', content: '...' }).execute()
} catch (error) {
  if (isForeignKeyError(error, 'postgres')) {
    console.error('User does not exist')
    // Handle foreign key violation
  }
}
```

**Detection criteria:**

| Dialect    | Detection Method                                                |
| ---------- | --------------------------------------------------------------- |
| PostgreSQL | Error code `23503` or message contains "foreign key constraint" |
| MySQL      | Error code `ER_NO_REFERENCED_ROW` or `ER_ROW_IS_REFERENCED`     |
| SQLite     | Message contains "FOREIGN KEY constraint failed"                |

### Not-Null Errors

```typescript
import { isNotNullError } from '@kysera/dialects'

try {
  await db
    .insertInto('users')
    .values({ name: 'John' }) // Missing required email
    .execute()
} catch (error) {
  if (isNotNullError(error, 'postgres')) {
    console.error('Missing required field')
    // Handle not-null violation
  }
}
```

**Detection criteria:**

| Dialect    | Detection Method                                             |
| ---------- | ------------------------------------------------------------ |
| PostgreSQL | Error code `23502` or message contains "not-null constraint" |
| MySQL      | Error code `ER_BAD_NULL_ERROR` or `ER_NO_DEFAULT_FOR_FIELD`  |
| SQLite     | Message contains "NOT NULL constraint failed"                |

### Adapter-based Error Detection

```typescript
import { getAdapter } from '@kysera/dialects'

const adapter = getAdapter('postgres')

try {
  await db.insertInto('users').values(data).execute()
} catch (error) {
  if (adapter.isUniqueConstraintError(error)) {
    // Handle unique violation
  } else if (adapter.isForeignKeyError(error)) {
    // Handle foreign key violation
  } else if (adapter.isNotNullError(error)) {
    // Handle not-null violation
  }
}
```

---

## 🛠 Helper Functions

### Schema Introspection

#### Check Table Existence

```typescript
import { tableExists } from '@kysera/dialects'

const exists = await tableExists(db, 'users', 'postgres')

if (!exists) {
  console.log('Users table does not exist')
}
```

#### Get Table Columns

```typescript
import { getTableColumns } from '@kysera/dialects'

const columns = await getTableColumns(db, 'users', 'postgres')
// ['id', 'email', 'name', 'created_at', 'updated_at']

// Check if column exists
if (columns.includes('deleted_at')) {
  console.log('Table has soft-delete support')
}
```

#### Get All Tables

```typescript
import { getTables } from '@kysera/dialects'

const tables = await getTables(db, 'postgres')
// ['users', 'posts', 'comments', 'tags']

console.log(`Database has ${tables.length} tables`)
```

### Identifier Escaping

```typescript
import { escapeIdentifier } from '@kysera/dialects'

// PostgreSQL (double quotes)
escapeIdentifier('user-data', 'postgres') // "user-data"
escapeIdentifier('select', 'postgres') // "select"

// MySQL (backticks)
escapeIdentifier('user-data', 'mysql') // `user-data`
escapeIdentifier('order', 'mysql') // `order`

// SQLite (double quotes)
escapeIdentifier('user-data', 'sqlite') // "user-data"

// Handles quotes in identifiers
escapeIdentifier('user"data', 'postgres') // "user""data"
escapeIdentifier('user`data', 'mysql') // `user``data`
```

### Timestamp Utilities

#### Get Current Timestamp

```typescript
import { getCurrentTimestamp } from '@kysera/dialects'

// PostgreSQL
getCurrentTimestamp('postgres') // 'CURRENT_TIMESTAMP'

// MySQL
getCurrentTimestamp('mysql') // 'CURRENT_TIMESTAMP'

// SQLite
getCurrentTimestamp('sqlite') // "datetime('now')"

// Usage in queries
const timestamp = getCurrentTimestamp('postgres')
await db
  .insertInto('logs')
  .values({ message: 'Event', created_at: sql`${sql.raw(timestamp)}` })
  .execute()
```

#### Format Date

```typescript
import { formatDate } from '@kysera/dialects'

const date = new Date('2024-01-15T10:30:00Z')

// All dialects return ISO 8601 format
formatDate(date, 'postgres') // '2024-01-15T10:30:00.000Z'
formatDate(date, 'mysql') // '2024-01-15T10:30:00.000Z'
formatDate(date, 'sqlite') // '2024-01-15T10:30:00.000Z'
```

### Database Management

#### Get Database Size

```typescript
import { getDatabaseSize } from '@kysera/dialects'

// PostgreSQL
const size = await getDatabaseSize(db, 'mydb', 'postgres')
console.log(`Database size: ${(size / 1024 / 1024).toFixed(2)} MB`)

// MySQL
const mysqlSize = await getDatabaseSize(db, 'production', 'mysql')

// SQLite
const sqliteSize = await getDatabaseSize(db, undefined, 'sqlite')
```

**Returns:** Size in bytes

#### Truncate All Tables

```typescript
import { truncateAllTables } from '@kysera/dialects'

// Truncate all tables (for testing)
await truncateAllTables(db, 'postgres')

// Exclude specific tables
await truncateAllTables(db, 'postgres', ['migrations', 'schema_version'])
```

**Warning:** This permanently deletes all data. Use only in test environments.

**Error Handling:** The function uses sophisticated error classification:
- **Recoverable errors:** Table not found, already truncated → Logged as warnings, execution continues
- **Critical errors:** Permission denied, foreign key violations → Thrown immediately
- **Unknown errors:** All other errors → Thrown with full error context

**Behavior:**

- PostgreSQL: `TRUNCATE TABLE ... CASCADE`
- MySQL: `TRUNCATE TABLE ...`
- SQLite: `DELETE FROM ...` (no TRUNCATE support)

---

## 📖 API Reference

### Factory Functions

#### `getAdapter(dialect: Dialect): DialectAdapter`

Get singleton adapter for specified dialect.

**Parameters:**

- `dialect` - `'postgres' | 'mysql' | 'sqlite'`

**Returns:** Dialect adapter instance

**Throws:** Error if dialect is unknown

---

#### `createDialectAdapter(dialect: Dialect): DialectAdapter`

Create new adapter instance.

**Parameters:**

- `dialect` - `'postgres' | 'mysql' | 'sqlite'`

**Returns:** New dialect adapter instance

**Use Case:** When you need multiple adapter instances with different configurations.

---

#### `registerAdapter(adapter: DialectAdapter): void`

Register custom dialect adapter.

**Parameters:**

- `adapter` - Custom adapter implementing `DialectAdapter` interface

**Use Case:** Extend with custom database support.

---

### Adapter Interface

#### `DialectAdapter`

Interface for dialect-specific operations.

**Properties:**

- `dialect: Dialect` - The dialect this adapter handles

**Methods:**

- `getDefaultPort(): number | null` - Get default port for this dialect
- `getCurrentTimestamp(): string` - Get SQL expression for current timestamp
- `escapeIdentifier(identifier: string): string` - Escape identifier for this dialect
- `formatDate(date: Date): string` - Format date for this dialect
- `isUniqueConstraintError(error: unknown): boolean` - Check for unique constraint violation
- `isForeignKeyError(error: unknown): boolean` - Check for foreign key violation
- `isNotNullError(error: unknown): boolean` - Check for not-null violation
- `tableExists(db: Kysely<any>, tableName: string): Promise<boolean>` - Check if table exists
- `getTableColumns(db: Kysely<any>, tableName: string): Promise<string[]>` - Get table columns
- `getTables(db: Kysely<any>): Promise<string[]>` - Get all tables
- `getDatabaseSize(db: Kysely<any>, databaseName?: string): Promise<number>` - Get database size in bytes
- `truncateTable(db: Kysely<any>, tableName: string): Promise<void>` - Truncate a table
- `truncateAllTables(db: Kysely<any>, exclude?: string[]): Promise<void>` - Truncate all tables

---

### Connection Utilities

#### `parseConnectionUrl(url: string): ConnectionConfig`

Parse connection URL into configuration object.

**Parameters:**

- `url` - Database connection URL

**Returns:** `ConnectionConfig` object

---

#### `buildConnectionUrl(dialect: Dialect, config: ConnectionConfig): string`

Build connection URL from configuration.

**Parameters:**

- `dialect` - Database dialect
- `config` - Connection configuration

**Returns:** Connection URL string

---

#### `getDefaultPort(dialect: Dialect): number | null`

Get default port for dialect.

**Parameters:**

- `dialect` - Database dialect

**Returns:** Port number or null for SQLite

---

### Helper Functions

#### `tableExists(db: Kysely<any>, tableName: string, dialect: Dialect): Promise<boolean>`

Check if table exists.

---

#### `getTableColumns(db: Kysely<any>, tableName: string, dialect: Dialect): Promise<string[]>`

Get column names for a table.

---

#### `getTables(db: Kysely<any>, dialect: Dialect): Promise<string[]>`

Get all tables in database.

---

#### `escapeIdentifier(identifier: string, dialect: Dialect): string`

Escape identifier for SQL.

---

#### `getCurrentTimestamp(dialect: Dialect): string`

Get SQL expression for current timestamp.

---

#### `formatDate(date: Date, dialect: Dialect): string`

Format date for SQL.

---

#### `isUniqueConstraintError(error: unknown, dialect: Dialect): boolean`

Check if error is unique constraint violation.

---

#### `isForeignKeyError(error: unknown, dialect: Dialect): boolean`

Check if error is foreign key violation.

---

#### `isNotNullError(error: unknown, dialect: Dialect): boolean`

Check if error is not-null violation.

---

#### `getDatabaseSize(db: Kysely<any>, databaseName: string | undefined, dialect: Dialect): Promise<number>`

Get database size in bytes.

---

#### `truncateAllTables(db: Kysely<any>, dialect: Dialect, exclude?: string[]): Promise<void>`

Truncate all tables in database.

---

### Types

#### `type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql'`

Supported database dialects. Re-exported from `@kysera/core`.

---

#### `interface ConnectionConfig`

Database connection configuration.

```typescript
interface ConnectionConfig {
  host?: string | undefined
  port?: number | undefined
  database: string
  user?: string | undefined
  password?: string | undefined
  ssl?: boolean | undefined
}
```

---

#### `interface DatabaseErrorLike`

Error object shape for database error detection.

```typescript
interface DatabaseErrorLike {
  message?: string
  code?: string
}
```

---

## ✨ Best Practices

### 1. Use Adapter Interface for Dialect-Agnostic Code

```typescript
// ✅ Good: Works with any dialect
import { getAdapter, type Dialect } from '@kysera/dialects'

function checkSchema(db: Kysely<any>, dialect: Dialect) {
  const adapter = getAdapter(dialect)
  return adapter.tableExists(db, 'users')
}

// ❌ Bad: Hard-coded dialect logic
function checkSchema(db: Kysely<any>) {
  return db
    .selectFrom('information_schema.tables')
    .where('table_name', '=', 'users')
    .executeTakeFirst()
}
```

### 2. Use Helper Functions for Simple Operations

```typescript
// ✅ Good: Simple and readable
const exists = await tableExists(db, 'users', 'postgres')

// ❌ Unnecessary: Adapter for single operation
const adapter = getAdapter('postgres')
const exists = await adapter.tableExists(db, 'users')
```

### 3. Centralize Error Handling

```typescript
import { getAdapter, type Dialect } from '@kysera/dialects'
import { parseDatabaseError } from '@kysera/core'

async function handleDatabaseError(error: unknown, dialect: Dialect) {
  const adapter = getAdapter(dialect)

  if (adapter.isUniqueConstraintError(error)) {
    return { type: 'duplicate', message: 'Record already exists' }
  }

  if (adapter.isForeignKeyError(error)) {
    return { type: 'reference', message: 'Referenced record not found' }
  }

  if (adapter.isNotNullError(error)) {
    return { type: 'required', message: 'Required field missing' }
  }

  // Use @kysera/core for detailed error parsing
  const dbError = parseDatabaseError(error, dialect)
  return { type: 'database', message: dbError.message }
}
```

### 4. Parse Connection URLs in Configuration

```typescript
import { parseConnectionUrl } from '@kysera/dialects'

// ✅ Good: Parse from environment variable
const config = parseConnectionUrl(process.env.DATABASE_URL!)

const db = new Kysely({
  dialect: new PostgresDialect({
    pool: new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl
    })
  })
})
```

### 5. Use Type Guards for Error Detection

```typescript
import { getAdapter } from '@kysera/dialects'

const adapter = getAdapter(dialect)

try {
  await db.insertInto('users').values(data).execute()
} catch (error) {
  // ✅ Good: Type-safe error detection
  if (adapter.isUniqueConstraintError(error)) {
    throw new Error('Email already registered')
  }
  throw error
}
```

### 6. Escape Dynamic Identifiers

```typescript
import { escapeIdentifier, type Dialect } from '@kysera/dialects'
import { sql } from 'kysely'

// ✅ Good: Escape dynamic table/column names
function selectFromTable(tableName: string, dialect: Dialect) {
  const escaped = escapeIdentifier(tableName, dialect)
  return db.selectFrom(sql.raw(escaped)).selectAll()
}

// ❌ Bad: SQL injection risk
function selectFromTable(tableName: string) {
  return db.selectFrom(sql.raw(tableName)).selectAll()
}
```

### 7. Use Truncate for Test Cleanup

```typescript
import { truncateAllTables } from '@kysera/dialects'

describe('User tests', () => {
  afterEach(async () => {
    // ✅ Fast cleanup for tests
    await truncateAllTables(db, 'postgres', ['migrations'])
  })

  // ❌ Slow: Individual deletes
  afterEach(async () => {
    await db.deleteFrom('users').execute()
    await db.deleteFrom('posts').execute()
    // ...
  })
})
```

### 8. Cache Adapters in Long-Running Applications

```typescript
// ✅ Good: Cache adapter instance
const adapter = getAdapter(dialect)

for (const table of tables) {
  await adapter.tableExists(db, table)
}

// ❌ Unnecessary: Re-fetch adapter each time
for (const table of tables) {
  const adapter = getAdapter(dialect)
  await adapter.tableExists(db, table)
}
```

---

## 📄 License

MIT © Kysera

---

## 🔗 Links

- [GitHub Repository](https://github.com/kysera-dev/kysera)
- [Kysely Documentation](https://kysely.dev)
- [Issue Tracker](https://github.com/kysera-dev/kysera/issues)
- [Changelog](../../CHANGELOG.md)

---

**Built with ❤️ for production TypeScript applications**
