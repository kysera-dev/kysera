---
sidebar_position: 5
title: '@kysera/dialects'
description: Dialect-specific utilities for PostgreSQL, MySQL, SQLite, and MSSQL
---

# @kysera/dialects

Dialect-specific utilities for Kysely database operations. Provides a unified adapter interface for PostgreSQL, MySQL, SQLite, and MSSQL with connection management, error detection, database introspection, multi-tenant schema utilities, and productivity tools.

## Installation

```bash
npm install @kysera/dialects kysely
```

## Overview

**Dependencies:** None (peer: kysely >=0.28.8)
**Database Support:** PostgreSQL, MySQL, SQLite, MSSQL

:::info Package Type
This is a **utility package** providing dialect-specific abstractions. It works with Kysely instances directly and is used internally by other Kysera packages (executor, repository, DAL) for cross-database compatibility.
:::

## Key Features

- **Unified Adapter Interface** - Single API for all supported dialects
- **Connection URL Utilities** - Parse and build connection URLs
- **Error Detection** - Identify constraint violations (unique, foreign key, not-null)
- **Database Introspection** - Check table existence, get columns, list tables
- **Schema Management** - Create, drop, clone schemas (PostgreSQL/MSSQL)
- **Multi-Tenant Utilities** - Generate and parse tenant schema names
- **Schema Inspection** - Get indexes, foreign keys, schema info (PostgreSQL)
- **Search Path Management** - Control PostgreSQL search_path
- **Dialect Helpers** - Identifier escaping, timestamp formatting, date handling
- **Testing Utilities** - Truncate tables, get database size

## Quick Start

### Using Adapters (Recommended)

```typescript
import { getAdapter } from '@kysera/dialects'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

const db = new Kysely({
  dialect: new PostgresDialect({
    pool: new Pool({
      /* ... */
    })
  })
})

// Get adapter for your dialect
const adapter = getAdapter('postgres')

// Use adapter methods
const exists = await adapter.tableExists(db, 'users')
console.log('Users table exists:', exists)

// With schema support
const authTables = await adapter.getTables(db, { schema: 'auth' })
console.log('Auth tables:', authTables)

// Get table columns
const columns = await adapter.getTableColumns(db, 'users', { schema: 'auth' })
console.log('Columns:', columns)

// Check error types
try {
  await db.insertInto('users').values({ email: 'duplicate@example.com' }).execute()
} catch (error) {
  if (adapter.isUniqueConstraintError(error)) {
    console.log('Duplicate email!')
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
  buildConnectionUrl,
  // Multi-tenant utilities
  getTenantSchemaName,
  filterTenantSchemas,
  // Error detection
  errorMatchers
} from '@kysera/dialects'

// Check table existence with schema
const exists = await tableExists(db, 'users', 'postgres', { schema: 'auth' })

// Get columns
const columns = await getTableColumns(db, 'users', 'mysql')

// Escape identifier
const escaped = escapeIdentifier('my-table', 'sqlite')

// Parse connection URL
const config = parseConnectionUrl('postgresql://user:pass@localhost:5432/mydb?ssl=true')
// { host: 'localhost', port: 5432, database: 'mydb', user: 'user', password: 'pass', ssl: true }

// Multi-tenant schema naming
const tenantSchema = getTenantSchemaName('acme')  // 'tenant_acme'

// Pre-built error matchers
if (errorMatchers.postgres.uniqueConstraint(error)) {
  console.log('Duplicate value!')
}
```

## Exports

```typescript
// Types
export type {
  Dialect,                // 'postgres' | 'mysql' | 'sqlite' | 'mssql' (from @kysera/core)
  ConnectionConfig,       // Connection configuration interface
  DialectAdapter,         // Adapter interface
  DialectAdapterOptions,  // Adapter configuration options
  SchemaOptions,          // Schema-aware operation options
  DatabaseErrorLike,      // Error object shape
  TenantSchemaConfig,     // Multi-tenant configuration
  SchemaCopyOptions,      // Schema cloning options
  ExtractedErrorInfo,     // Normalized error information
  ErrorMatcherConfig      // Error matcher configuration
} from './types'

// Factory and adapters
export {
  getAdapter,             // Get singleton adapter instance
  createDialectAdapter,   // Create new adapter instance
  registerAdapter         // Register custom adapter
} from './factory'

export {
  PostgresAdapter,        // PostgreSQL adapter class
  postgresAdapter,        // PostgreSQL singleton
  createPostgresAdapter,  // Factory function
  type PostgresAdapterOptions
} from './adapters/postgres'

export {
  MySQLAdapter,           // MySQL adapter class
  mysqlAdapter,           // MySQL singleton
  createMySQLAdapter,     // Factory function
  type MySQLAdapterOptions
} from './adapters/mysql'

export {
  SQLiteAdapter,          // SQLite adapter class
  sqliteAdapter,          // SQLite singleton
  createSQLiteAdapter,    // Factory function
  type SQLiteAdapterOptions
} from './adapters/sqlite'

export {
  MSSQLAdapter,           // MSSQL adapter class
  mssqlAdapter,           // MSSQL singleton
  createMSSQLAdapter,     // Factory function
  type MSSQLAdapterOptions
} from './adapters/mssql'

// Connection utilities
export {
  parseConnectionUrl,     // Parse database URL
  buildConnectionUrl,     // Build database URL
  getDefaultPort          // Get default port for dialect
} from './connection'

// Helper functions (standalone, backward compatible)
export {
  validateIdentifier,     // Validate SQL identifier
  assertValidIdentifier,  // Assert valid identifier (throws)
  tableExists,            // Check if table exists
  getTableColumns,        // Get table column names
  getTables,              // Get all tables
  escapeIdentifier,       // Escape SQL identifier
  getCurrentTimestamp,    // Get current timestamp expression
  formatDate,             // Format date for database
  isUniqueConstraintError,// Check unique constraint error
  isForeignKeyError,      // Check foreign key error
  isNotNullError,         // Check not-null constraint error
  getDatabaseSize,        // Get database size in bytes
  truncateAllTables,      // Truncate all tables (testing)
  // Schema utilities
  resolveSchema,          // Resolve schema name with validation
  qualifyTableName,       // Create qualified table name
  // Multi-tenant utilities
  getTenantSchemaName,    // Generate tenant schema name
  parseTenantSchemaName,  // Extract tenant ID from schema name
  isTenantSchema,         // Check if schema is a tenant schema
  filterTenantSchemas,    // Filter array to tenant schemas only
  extractTenantIds,       // Extract tenant IDs from schema array
  // Error detection utilities
  extractErrorInfo,       // Extract normalized error info
  createErrorMatcher,     // Create custom error matcher
  errorMatchers           // Pre-built error matchers
} from './helpers'
```

## Core Concepts

### Adapter Pattern

The `DialectAdapter` interface provides a unified API for dialect-specific operations:

```typescript
interface DialectAdapter {
  readonly dialect: Dialect
  readonly defaultSchema: string

  // Port and formatting
  getDefaultPort(): number | null
  getCurrentTimestamp(): string
  escapeIdentifier(identifier: string): string
  formatDate(date: Date): string

  // Error detection
  isUniqueConstraintError(error: unknown): boolean
  isForeignKeyError(error: unknown): boolean
  isNotNullError(error: unknown): boolean

  // Introspection (with optional schema support)
  tableExists(db: Kysely<any>, tableName: string, options?: SchemaOptions): Promise<boolean>
  getTableColumns(db: Kysely<any>, tableName: string, options?: SchemaOptions): Promise<string[]>
  getTables(db: Kysely<any>, options?: SchemaOptions): Promise<string[]>

  // Testing utilities (with optional schema support)
  getDatabaseSize(db: Kysely<any>, databaseName?: string): Promise<number>
  truncateTable(db: Kysely<any>, tableName: string, options?: SchemaOptions): Promise<boolean>
  truncateAllTables(db: Kysely<any>, exclude?: string[], options?: SchemaOptions): Promise<void>
}
```

### SchemaOptions Interface

Options for schema-aware database operations:

```typescript
interface SchemaOptions {
  /**
   * Schema name for the operation.
   * - PostgreSQL: Defaults to 'public' if not specified
   * - MySQL: Uses DATABASE() (schema = database in MySQL)
   * - SQLite: Not supported (single schema only)
   * - MSSQL: Defaults to 'dbo' if not specified
   */
  schema?: string
}
```

**Example:**
```typescript
// Query tables in specific schema
await adapter.tableExists(db, 'users', { schema: 'auth' })

// Multi-tenant usage
await adapter.getTables(db, { schema: `tenant_${tenantId}` })
```

## API Reference

### Factory Functions

#### `getAdapter(dialect)`

Get a singleton adapter instance for the specified dialect.

```typescript
function getAdapter(dialect: Dialect): DialectAdapter

// Example
const adapter = getAdapter('postgres')
console.log(adapter.getDefaultPort())   // 5432
console.log(adapter.defaultSchema)      // 'public'
```

**Supported dialects:** `postgres`, `mysql`, `sqlite`, `mssql`

#### `createDialectAdapter(dialect, options?)`

Create a new adapter instance with custom options.

```typescript
function createDialectAdapter(dialect: Dialect, options?: DialectAdapterOptions): DialectAdapter

// Example - custom default schema
const adapter = createDialectAdapter('postgres', { defaultSchema: 'auth' })
console.log(adapter.defaultSchema)  // 'auth'
```

#### `registerAdapter(adapter)`

Register a custom dialect adapter, replacing the default instance.

```typescript
function registerAdapter(adapter: DialectAdapter): void

// Example
const customAdapter = new PostgresAdapter({ defaultSchema: 'custom' })
registerAdapter(customAdapter)
```

### Connection Utilities

#### `parseConnectionUrl(url)`

Parse database connection URL into configuration object.

```typescript
function parseConnectionUrl(url: string): ConnectionConfig

// Examples
const config1 = parseConnectionUrl('postgresql://user:pass@localhost:5432/mydb?ssl=true')
// { host: 'localhost', port: 5432, database: 'mydb', user: 'user', password: 'pass', ssl: true }

const config2 = parseConnectionUrl('mysql://localhost/testdb')
// { host: 'localhost', database: 'testdb' }
```

#### `buildConnectionUrl(dialect, config)`

Build connection URL from configuration object.

```typescript
function buildConnectionUrl(dialect: Dialect, config: ConnectionConfig): string

// Examples
const url = buildConnectionUrl('postgres', {
  host: 'localhost',
  database: 'mydb',
  user: 'admin',
  password: 'secret',
  ssl: true
})
// 'postgresql://admin:secret@localhost:5432/mydb?ssl=true'
```

#### `getDefaultPort(dialect)`

Get default port for a dialect.

```typescript
getDefaultPort('postgres')  // 5432
getDefaultPort('mysql')     // 3306
getDefaultPort('sqlite')    // null
getDefaultPort('mssql')     // 1433
```

---

## Multi-Tenant Utilities

Utilities for managing schema-per-tenant multi-tenancy patterns.

### `getTenantSchemaName(tenantId, config?)`

Generates a tenant schema name from a tenant ID.

```typescript
function getTenantSchemaName(tenantId: string, config?: TenantSchemaConfig): string

// Examples
getTenantSchemaName('123')                        // 'tenant_123'
getTenantSchemaName('acme')                       // 'tenant_acme'
getTenantSchemaName('corp', { prefix: 'org_' })   // 'org_corp'
```

**Throws:** Error if resulting schema name is invalid

### `parseTenantSchemaName(schemaName, config?)`

Extracts tenant ID from a tenant schema name.

```typescript
function parseTenantSchemaName(schemaName: string, config?: TenantSchemaConfig): string | null

// Examples
parseTenantSchemaName('tenant_123')                       // '123'
parseTenantSchemaName('tenant_acme')                      // 'acme'
parseTenantSchemaName('public')                           // null
parseTenantSchemaName('org_corp', { prefix: 'org_' })     // 'corp'
```

### `isTenantSchema(schemaName, config?)`

Checks if a schema name matches the tenant schema pattern.

```typescript
function isTenantSchema(schemaName: string, config?: TenantSchemaConfig): boolean

// Examples
isTenantSchema('tenant_123')                       // true
isTenantSchema('public')                           // false
isTenantSchema('org_corp', { prefix: 'org_' })     // true
```

### `filterTenantSchemas(schemas, config?)`

Filters an array of schema names to only tenant schemas.

```typescript
function filterTenantSchemas(schemas: string[], config?: TenantSchemaConfig): string[]

// Example
filterTenantSchemas(['public', 'tenant_1', 'tenant_2', 'auth'])
// ['tenant_1', 'tenant_2']
```

### `extractTenantIds(schemas, config?)`

Extracts tenant IDs from an array of schema names.

```typescript
function extractTenantIds(schemas: string[], config?: TenantSchemaConfig): string[]

// Example
extractTenantIds(['public', 'tenant_1', 'tenant_2', 'auth'])
// ['1', '2']
```

### `TenantSchemaConfig` Interface

```typescript
interface TenantSchemaConfig {
  /** Prefix for tenant schema names (default: 'tenant_') */
  prefix?: string
}
```

---

## Error Detection Utilities

Utilities for detecting and handling database constraint errors.

### `extractErrorInfo(error)`

Extracts and normalizes error information from a database error.

```typescript
function extractErrorInfo(error: unknown): ExtractedErrorInfo

// Example
try {
  await db.insertInto('users').values(data).execute()
} catch (error) {
  const info = extractErrorInfo(error)
  console.log(info.code)            // '23505'
  console.log(info.message)         // 'unique constraint violation' (lowercase)
  console.log(info.originalMessage) // 'Unique constraint violation'
  console.log(info.number)          // undefined (or MSSQL error number)
}
```

### `ExtractedErrorInfo` Interface

```typescript
interface ExtractedErrorInfo {
  code: string                  // Error code (e.g., '23505')
  message: string               // Lowercase message for matching
  originalMessage: string       // Original error message
  number: number | undefined    // MSSQL error number
}
```

### `createErrorMatcher(config)`

Creates a custom error matcher function.

```typescript
function createErrorMatcher(config: ErrorMatcherConfig): (error: unknown) => boolean

// Example - create a unique constraint matcher
const isUniqueConstraint = createErrorMatcher({
  codes: ['23505'],
  messages: ['unique constraint']
})

if (isUniqueConstraint(error)) {
  console.log('Duplicate value!')
}
```

### `ErrorMatcherConfig` Interface

```typescript
interface ErrorMatcherConfig {
  codes?: string[]      // PostgreSQL/MySQL error codes
  numbers?: number[]    // MSSQL error numbers
  messages?: string[]   // Message substrings (case-insensitive)
}
```

### `errorMatchers` Object

Pre-built error matchers for all dialects:

```typescript
const errorMatchers = {
  postgres: {
    uniqueConstraint: (error) => boolean,  // code '23505'
    foreignKey: (error) => boolean,        // code '23503'
    notNull: (error) => boolean            // code '23502'
  },
  mysql: {
    uniqueConstraint: (error) => boolean,  // code 'ER_DUP_ENTRY' or '1062'
    foreignKey: (error) => boolean,        // code 'ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2', 'ER_ROW_IS_REFERENCED', 'ER_NO_REFERENCED_ROW', '1451', '1452'
    notNull: (error) => boolean            // code 'ER_BAD_NULL_ERROR' or '1048'
  },
  sqlite: {
    uniqueConstraint: (error) => boolean,  // message 'unique constraint failed'
    foreignKey: (error) => boolean,        // message 'foreign key constraint failed'
    notNull: (error) => boolean            // message 'not null constraint failed'
  },
  mssql: {
    uniqueConstraint: (error) => boolean,  // number 2627, 2601
    foreignKey: (error) => boolean,        // number 547
    notNull: (error) => boolean            // number 515
  }
}
```

**Example:**
```typescript
import { errorMatchers } from '@kysera/dialects'

try {
  await db.insertInto('users').values(data).execute()
} catch (error) {
  if (errorMatchers.postgres.uniqueConstraint(error)) {
    console.log('Duplicate email')
  } else if (errorMatchers.postgres.foreignKey(error)) {
    console.log('Invalid foreign key reference')
  }
}
```

---

## Schema Utilities

### `resolveSchema(defaultSchema, options?)`

Resolves schema name with validation.

```typescript
function resolveSchema(defaultSchema: string, options?: SchemaOptions): string

// Examples
resolveSchema('public', { schema: 'auth' })  // 'auth'
resolveSchema('public', {})                  // 'public'
resolveSchema('public')                      // 'public'
```

**Throws:** Error if schema name is invalid

### `qualifyTableName(schema, tableName, escapeIdentifierFn)`

Creates a qualified table name with schema prefix.

```typescript
function qualifyTableName(
  schema: string,
  tableName: string,
  escapeIdentifierFn: (id: string) => string
): string

// Examples
qualifyTableName('auth', 'users', (id) => `"${id}"`)
// PostgreSQL: "auth"."users"

qualifyTableName('app', 'users', (id) => `\`${id}\``)
// MySQL: `app`.`users`
```

### `validateIdentifier(name)`

Validates a SQL identifier (table name, column name, schema name).

```typescript
function validateIdentifier(name: string): boolean

// Examples
validateIdentifier('users')           // true
validateIdentifier('public.users')    // true
validateIdentifier('_private_table')  // true
validateIdentifier('123invalid')      // false (starts with number)
validateIdentifier('table-name')      // false (contains hyphen)
validateIdentifier('')                // false (empty)
```

**Rules:**
- Must start with letter or underscore
- Can contain letters, numbers, underscores, and dots
- Maximum 128 characters

### `assertValidIdentifier(name, context?)`

Asserts that an identifier is valid, throwing an error if not.

```typescript
function assertValidIdentifier(name: string, context?: string): void

// Examples
assertValidIdentifier('users', 'table name')     // passes
assertValidIdentifier('123bad', 'table name')    // throws: "Invalid table name: 123bad"
```

---

## PostgreSQL Adapter

### PostgresAdapterOptions

```typescript
interface PostgresAdapterOptions extends DialectAdapterOptions {
  logger?: KyseraLogger
}
```

### Creating an Adapter

```typescript
import { createPostgresAdapter } from '@kysera/dialects'

// Default (public schema)
const adapter = createPostgresAdapter()

// Custom default schema
const authAdapter = createPostgresAdapter({ defaultSchema: 'auth' })

// With logger
const adapter = createPostgresAdapter({
  defaultSchema: 'app',
  logger: myLogger
})
```

### Schema Management Methods

PostgreSQL adapter provides full schema management capabilities:

#### `schemaExists(db, schemaName)`

Checks if a schema exists.

```typescript
const exists = await adapter.schemaExists(db, 'auth')
```

#### `getSchemas(db)`

Gets all schemas (excludes system schemas: `pg_%`, `information_schema`).

```typescript
const schemas = await adapter.getSchemas(db)
// ['public', 'auth', 'admin', 'tenant_1', 'tenant_2']
```

#### `createSchema(db, schemaName, options?)`

Creates a new schema.

```typescript
// Basic usage
await adapter.createSchema(db, 'tenant_123')

// With IF NOT EXISTS
await adapter.createSchema(db, 'tenant_123', { ifNotExists: true })
```

**Returns:** `true` if created, `false` if already exists

#### `dropSchema(db, schemaName, options?)`

Drops a schema.

```typescript
// Basic usage
await adapter.dropSchema(db, 'tenant_123')

// With IF EXISTS
await adapter.dropSchema(db, 'tenant_123', { ifExists: true })

// With CASCADE (drops all contained objects)
await adapter.dropSchema(db, 'tenant_123', { ifExists: true, cascade: true })
```

**Protected schemas** (cannot drop):
- `public`
- `pg_catalog`
- `information_schema`

### Schema Inspection Methods

#### `getSchemaInfo(db, schemaName)`

Gets detailed information about a schema.

```typescript
const info = await adapter.getSchemaInfo(db, 'tenant_123')
// {
//   name: 'tenant_123',
//   tableCount: 15,
//   owner: 'app_user',
//   sizeBytes: 1048576
// }
```

#### `getSchemaIndexes(db, options?)`

Gets index information for all tables in a schema.

```typescript
const indexes = await adapter.getSchemaIndexes(db, { schema: 'auth' })
// [
//   {
//     tableName: 'users',
//     indexName: 'users_pkey',
//     indexType: 'btree',
//     isUnique: true,
//     isPrimary: true,
//     columns: ['id']
//   },
//   {
//     tableName: 'users',
//     indexName: 'users_email_idx',
//     indexType: 'btree',
//     isUnique: true,
//     isPrimary: false,
//     columns: ['email']
//   }
// ]
```

#### `getSchemaForeignKeys(db, options?)`

Gets foreign key relationships in a schema.

```typescript
const fks = await adapter.getSchemaForeignKeys(db, { schema: 'public' })
// [
//   {
//     constraintName: 'posts_user_id_fkey',
//     tableName: 'posts',
//     columnName: 'user_id',
//     referencedSchema: 'public',
//     referencedTable: 'users',
//     referencedColumn: 'id',
//     onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
//   }
// ]
```

### Search Path Management

#### `getSearchPath(db)`

Gets the current search_path setting.

```typescript
const path = await adapter.getSearchPath(db)
// ['public', 'tenant_123']
```

#### `setSearchPath(db, schemas)`

Sets the search_path for the current session.

```typescript
await adapter.setSearchPath(db, ['tenant_123', 'public'])
```

#### `withSearchPath(db, schemas, fn)`

Executes a function with a temporary search_path, then restores the original.

```typescript
const result = await adapter.withSearchPath(db, ['tenant_123'], async () => {
  // All queries here use tenant_123 schema by default
  return await db.selectFrom('users').selectAll().execute()
})
// Search path is automatically restored after execution
```

### Schema Cloning Methods

#### `cloneSchema(db, sourceSchema, targetSchema, options?)`

Clones a schema's structure (tables, indexes, constraints) to a new schema.

```typescript
// Clone structure only
await adapter.cloneSchema(db, 'template', 'tenant_456')

// Clone with data
await adapter.cloneSchema(db, 'template', 'tenant_456', { includeData: true })

// Exclude certain tables
await adapter.cloneSchema(db, 'template', 'tenant_456', { excludeTables: ['logs'] })

// Include only specific tables
await adapter.cloneSchema(db, 'template', 'tenant_456', { includeTables: ['users', 'settings'] })
```

**Options:**
- `includeData` - Include table data (default: `false`)
- `excludeTables` - Tables to exclude from cloning
- `includeTables` - Tables to include (if specified, only these are copied)

#### `compareSchemas(db, schema1, schema2)`

Compares two schemas and returns the differences.

```typescript
const diff = await adapter.compareSchemas(db, 'template', 'tenant_123')
// {
//   onlyInFirst: ['archived_users'],
//   onlyInSecond: ['custom_settings'],
//   inBoth: ['users', 'posts']
// }
```

---

## MySQL Adapter

### MySQLAdapterOptions

```typescript
interface MySQLAdapterOptions extends DialectAdapterOptions {
  logger?: KyseraLogger
}
```

:::note MySQL Schema Behavior
In MySQL, "schema" and "database" are synonymous. The `schema` option maps to the current database context. Empty string means use current database (`DATABASE()`).
:::

### Creating an Adapter

```typescript
import { createMySQLAdapter } from '@kysera/dialects'

// Default (current database)
const adapter = createMySQLAdapter()

// Specific database as default
const adapter = createMySQLAdapter({ defaultSchema: 'my_database' })
```

### Dialect-Specific Behavior

```typescript
const adapter = getAdapter('mysql')

adapter.getDefaultPort()                    // 3306
adapter.getCurrentTimestamp()               // 'CURRENT_TIMESTAMP'
adapter.escapeIdentifier('my-table')        // `my-table`
adapter.formatDate(new Date())              // 'YYYY-MM-DD HH:MM:SS'
adapter.isUniqueConstraintError(e)          // code 'ER_DUP_ENTRY' or '1062'
adapter.isForeignKeyError(e)                // code '1451', '1452'
adapter.isNotNullError(e)                   // code 'ER_BAD_NULL_ERROR' or '1048'
```

---

## SQLite Adapter

### SQLiteAdapterOptions

```typescript
interface SQLiteAdapterOptions extends DialectAdapterOptions {
  logger?: KyseraLogger
}
```

:::note SQLite Schema Behavior
SQLite has no schema support (single schema only). SchemaOptions are accepted for interface compatibility but are ignored. The `defaultSchema` is `'main'`.
:::

### Creating an Adapter

```typescript
import { createSQLiteAdapter } from '@kysera/dialects'

const adapter = createSQLiteAdapter()
```

### Dialect-Specific Behavior

```typescript
const adapter = getAdapter('sqlite')

adapter.getDefaultPort()                    // null (file-based)
adapter.getCurrentTimestamp()               // "datetime('now')"
adapter.escapeIdentifier('my-table')        // "my-table"
adapter.formatDate(new Date())              // ISO string
adapter.isUniqueConstraintError(e)          // message 'UNIQUE constraint failed'
adapter.isForeignKeyError(e)                // message 'FOREIGN KEY constraint failed'
adapter.isNotNullError(e)                   // message 'NOT NULL constraint failed'
```

---

## MSSQL Adapter

### MSSQLAdapterOptions

```typescript
interface MSSQLAdapterOptions extends DialectAdapterOptions {
  logger?: KyseraLogger
}
```

Supports SQL Server 2017+, Azure SQL Database, and Azure SQL Edge.

### Creating an Adapter

```typescript
import { createMSSQLAdapter } from '@kysera/dialects'

// Default (dbo schema)
const adapter = createMSSQLAdapter()

// Custom default schema
const adapter = createMSSQLAdapter({ defaultSchema: 'app' })
```

### Schema Management Methods

MSSQL adapter provides schema management similar to PostgreSQL:

```typescript
// Check if schema exists
const exists = await adapter.schemaExists(db, 'auth')

// Get all schemas (excludes system schemas)
const schemas = await adapter.getSchemas(db)
// ['dbo', 'auth', 'admin', ...]

// Create a new schema
await adapter.createSchema(db, 'auth')

// Drop a schema
await adapter.dropSchema(db, 'auth')
```

**Protected schemas** (cannot drop):
- `dbo`
- `sys`
- `INFORMATION_SCHEMA`
- `guest`

### Dialect-Specific Behavior

```typescript
const adapter = getAdapter('mssql')

adapter.getDefaultPort()                    // 1433
adapter.getCurrentTimestamp()               // 'GETDATE()'
adapter.escapeIdentifier('my-table')        // [my-table]
adapter.formatDate(new Date())              // 'YYYY-MM-DD HH:MM:SS.mmm'
adapter.defaultSchema                       // 'dbo'
adapter.isUniqueConstraintError(e)          // number 2627 or 2601
adapter.isForeignKeyError(e)                // number 547
adapter.isNotNullError(e)                   // number 515
```

**MSSQL-specific error codes:**
- `2627` - Unique constraint violation (PRIMARY KEY)
- `2601` - Unique constraint violation (UNIQUE INDEX)
- `547` - Foreign key constraint violation
- `515` - NOT NULL constraint violation

---

## Use Cases and Examples

### 1. Multi-Tenant SaaS Application

Schema-per-tenant isolation pattern:

```typescript
import {
  createPostgresAdapter,
  getTenantSchemaName,
  filterTenantSchemas,
  extractTenantIds
} from '@kysera/dialects'

const adapter = createPostgresAdapter()

// Tenant provisioning
async function createTenant(db: Kysely<any>, tenantId: string) {
  const schema = getTenantSchemaName(tenantId)  // 'tenant_acme'

  // Create tenant schema from template
  await adapter.createSchema(db, schema)
  await adapter.cloneSchema(db, 'template', schema)

  return schema
}

// List all tenants
async function listTenants(db: Kysely<any>) {
  const schemas = await adapter.getSchemas(db)
  return extractTenantIds(schemas)  // ['acme', 'globex', '123']
}

// Tenant cleanup
async function deleteTenant(db: Kysely<any>, tenantId: string) {
  const schema = getTenantSchemaName(tenantId)
  await adapter.dropSchema(db, schema, { cascade: true })
}

// Query within tenant context
async function getTenantUsers(db: Kysely<any>, tenantId: string) {
  const schema = getTenantSchemaName(tenantId)

  return adapter.withSearchPath(db, [schema], async () => {
    return db.selectFrom('users').selectAll().execute()
  })
}
```

### 2. Graceful Error Handling

Detect and handle database constraint violations:

```typescript
import { getAdapter, errorMatchers, extractErrorInfo } from '@kysera/dialects'

async function createUser(db: Kysely<Database>, data: UserInput) {
  try {
    return await db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
  } catch (error) {
    const info = extractErrorInfo(error)

    if (errorMatchers.postgres.uniqueConstraint(error)) {
      throw new ConflictError(`User with email ${data.email} already exists`)
    }
    if (errorMatchers.postgres.foreignKey(error)) {
      throw new BadRequestError('Invalid organization reference')
    }
    if (errorMatchers.postgres.notNull(error)) {
      throw new BadRequestError(`Missing required field: ${info.originalMessage}`)
    }

    throw error  // Unknown error
  }
}
```

### 3. Database Schema Validation

Validate migration state and schema consistency:

```typescript
import { createPostgresAdapter } from '@kysera/dialects'

async function validateDatabase(db: Kysely<any>) {
  const adapter = createPostgresAdapter()

  // Check migrations table
  const hasMigrations = await adapter.tableExists(db, 'kysely_migrations')
  if (!hasMigrations) {
    throw new Error('Migrations table not found. Run migrations first.')
  }

  // Validate required tables
  const requiredTables = ['users', 'posts', 'comments']
  const existingTables = await adapter.getTables(db)

  const missingTables = requiredTables.filter(t => !existingTables.includes(t))
  if (missingTables.length > 0) {
    throw new Error(`Missing tables: ${missingTables.join(', ')}`)
  }

  // Validate indexes exist
  const indexes = await adapter.getSchemaIndexes(db)
  const requiredIndexes = ['users_email_idx', 'posts_user_id_idx']

  const indexNames = indexes.map(i => i.indexName)
  const missingIndexes = requiredIndexes.filter(i => !indexNames.includes(i))

  if (missingIndexes.length > 0) {
    console.warn(`Missing indexes: ${missingIndexes.join(', ')}`)
  }

  console.log('✓ Database validation passed')
}
```

### 4. Schema Drift Detection

Compare schemas to detect drift:

```typescript
import { createPostgresAdapter } from '@kysera/dialects'

async function detectSchemaDrift(db: Kysely<any>, tenantId: string) {
  const adapter = createPostgresAdapter()
  const tenantSchema = `tenant_${tenantId}`

  const diff = await adapter.compareSchemas(db, 'template', tenantSchema)

  if (diff.onlyInFirst.length > 0) {
    console.warn(`Tables missing in tenant schema: ${diff.onlyInFirst.join(', ')}`)
  }

  if (diff.onlyInSecond.length > 0) {
    console.info(`Custom tables in tenant schema: ${diff.onlyInSecond.join(', ')}`)
  }

  return {
    hasDrift: diff.onlyInFirst.length > 0,
    missingTables: diff.onlyInFirst,
    extraTables: diff.onlyInSecond
  }
}
```

### 5. Testing Utilities

Clean database state between tests:

```typescript
import { getAdapter } from '@kysera/dialects'
import { beforeEach, describe, it } from 'vitest'

describe('User Repository', () => {
  const adapter = getAdapter('postgres')

  beforeEach(async () => {
    // Truncate all tables except migrations
    await adapter.truncateAllTables(db, ['kysely_migrations'])
  })

  it('creates user', async () => {
    const user = await createUser({ email: 'test@example.com' })
    expect(user.email).toBe('test@example.com')
  })
})
```

### 6. Database Monitoring

Monitor database and schema sizes:

```typescript
import { createPostgresAdapter, filterTenantSchemas } from '@kysera/dialects'

async function monitorDatabase(db: Kysely<any>) {
  const adapter = createPostgresAdapter()

  // Total database size
  const totalSize = await adapter.getDatabaseSize(db)
  console.log(`Total database size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)

  // Per-schema sizes
  const schemas = await adapter.getSchemas(db)
  const tenantSchemas = filterTenantSchemas(schemas)

  for (const schema of tenantSchemas) {
    const info = await adapter.getSchemaInfo(db, schema)
    console.log(`${schema}: ${info.tableCount} tables, ${(info.sizeBytes / 1024).toFixed(2)} KB`)
  }
}
```

---

## Best Practices

1. **Use adapters over helper functions:**

   ```typescript
   // ✅ Good - single adapter lookup
   const adapter = getAdapter('postgres')
   const exists = await adapter.tableExists(db, 'users')
   const columns = await adapter.getTableColumns(db, 'users')

   // ❌ Avoid - multiple adapter lookups
   const exists = await tableExists(db, 'users', 'postgres')
   const columns = await getTableColumns(db, 'users', 'postgres')
   ```

2. **Store dialect in configuration:**

   ```typescript
   // ✅ Good - single source of truth
   const config = { dialect: 'postgres' as Dialect }
   const adapter = getAdapter(config.dialect)
   ```

3. **Use pre-built error matchers:**

   ```typescript
   // ✅ Good - consistent error handling
   import { errorMatchers } from '@kysera/dialects'

   if (errorMatchers.postgres.uniqueConstraint(error)) {
     // Handle duplicate
   }
   ```

4. **Use multi-tenant utilities for schema naming:**

   ```typescript
   // ✅ Good - consistent naming
   import { getTenantSchemaName } from '@kysera/dialects'
   const schema = getTenantSchemaName(tenantId)

   // ❌ Avoid - manual concatenation
   const schema = `tenant_${tenantId}`
   ```

5. **Use withSearchPath for tenant context:**

   ```typescript
   // ✅ Good - automatic cleanup
   await adapter.withSearchPath(db, [tenantSchema], async () => {
     // Queries here
   })

   // ❌ Avoid - manual search path management
   await adapter.setSearchPath(db, [tenantSchema])
   // ... queries ...
   await adapter.setSearchPath(db, originalPath)  // Easy to forget!
   ```

6. **Exclude migrations from truncation:**

   ```typescript
   // ✅ Good - preserve migration history
   await adapter.truncateAllTables(db, ['kysely_migrations'])

   // ❌ Avoid - truncating everything
   await adapter.truncateAllTables(db)
   ```

---

## Performance Considerations

- **Adapter lookup is fast:** Singleton instances are cached
- **Schema proxy caching:** `withSchema()` proxies are cached (up to 100 schemas)
- **Introspection queries:** Use `information_schema` (fast for small schemas)
- **Truncate operations:** Use database-specific optimizations (CASCADE, RESTART IDENTITY)
- **Error detection:** String/code matching is fast (no regex)

---

## Cross-Runtime Support

Works on Node.js >=20, Bun >=1.0, and Deno (experimental):

```typescript
// Node.js with pg
import pg from 'pg'
const { Pool } = pg

// Bun with pg
import { Pool } from 'pg'

// Node.js with better-sqlite3
import Database from 'better-sqlite3'

// All work the same way
const adapter = getAdapter('postgres')
```

---

## Related Packages

- [@kysera/core](/docs/api/core) - Core utilities and types
- [@kysera/executor](/docs/api/executor) - Unified execution layer (uses dialects)
- [@kysera/repository](/docs/api/repository) - Repository pattern (uses dialects)
- [@kysera/dal](/docs/api/dal) - Functional data access layer (uses dialects)
- [@kysera/rls](/docs/api/rls) - Row-Level Security with schema support
