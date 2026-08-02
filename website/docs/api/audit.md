---
sidebar_position: 10
title: '@kysera/audit'
description: Audit logging plugin API reference
---

# @kysera/audit

Audit logging plugin for Kysera - Automatically track all database changes with comprehensive audit logging.

## Installation

```bash
npm install @kysera/audit
```

## Overview

| Metric                | Value                                                                             |
| --------------------- | --------------------------------------------------------------------------------- |
| **Bundle Size**       | ~8 KB (minified)                                                                   |
| **Dependencies**      | @kysera/core                                                                       |
| **Peer Dependencies** | @kysera/executor, kysely >=0.29.0, @kysera/repository (optional), zod (optional) |

## Exports

{/* doc-snippet: skip */}
```typescript
// Main plugin
export { auditPlugin } from './index'

// Deprecated aliases — each simply calls auditPlugin(), which auto-detects the dialect
/** @deprecated Use auditPlugin() instead */
export { auditPluginPostgreSQL, auditPluginMySQL, auditPluginSQLite }

// Types
export type {
  AuditOptions,
  AuditLogEntry,
  AuditFilters,
  AuditRepositoryExtensions,
  ParsedAuditLogEntry,
  AuditPaginationOptions,
  AuditTimestamp
}

// Schema (optional, requires Zod)
export { AuditOptionsSchema, type AuditOptionsSchemaType } from './schema'
```

## auditPlugin

Creates an audit logging plugin instance.

{/* doc-snippet: skip */}
```typescript
function auditPlugin(options?: AuditOptions): Plugin
```

### AuditOptions

```typescript
interface AuditOptions {
  /**
   * Name of the audit log table
   * @default 'audit_logs'
   */
  auditTable?: string

  /**
   * Name of the primary key column in tracked tables
   * @default 'id'
   */
  primaryKeyColumn?: string

  /**
   * Capture old values on UPDATE/DELETE
   * The pre-mutation fetch reads the row via the raw db (v0.10+) and goes
   * through @kysera/core's per-operation row cache, so it is shared with
   * other plugins guarding the same call (e.g. RLS's policy fetch) — one
   * SELECT per operation instead of one per plugin
   * @default true
   */
  captureOldValues?: boolean

  /**
   * Capture new values on INSERT/UPDATE
   * @default true
   */
  captureNewValues?: boolean

  /**
   * Skip audit for system operations (migrations, seeds)
   * @default false
   */
  skipSystemOperations?: boolean

  /**
   * List of tables to audit (whitelist)
   * If not specified, all tables except excludeTables will be audited
   */
  tables?: string[]

  /**
   * List of tables to exclude from auditing (blacklist)
   */
  excludeTables?: string[]

  /**
   * Function to get the current user ID
   */
  getUserId?: () => string | null

  /**
   * Function to get the timestamp for audit entries.
   * By default the plugin stores formatTimestampForDb(new Date(), dialect) —
   * ISO 8601 for PostgreSQL/SQLite, 'YYYY-MM-DD HH:MM:SS.mmm' for MySQL/MSSQL.
   * A returned Date is formatted the same way; a returned string is stored as-is.
   */
  getTimestamp?: () => Date | string

  /**
   * Function to get additional metadata for audit entries
   */
  metadata?: () => Record<string, unknown>

  /**
   * Logger for plugin operations
   */
  logger?: KyseraLogger
}
```

### Configuration Examples

{/* doc-snippet: skip */}
```typescript
import { auditPlugin } from '@kysera/audit'

// Basic setup
const plugin = auditPlugin({
  getUserId: () => currentUser?.id
})

// Full setup with metadata
const plugin = auditPlugin({
  getUserId: () => currentUser?.id,
  captureOldValues: true,
  captureNewValues: true,
  metadata: () => ({
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    requestId: request.id,
    sessionId: session?.id
  }),
  excludeTables: ['sessions', 'audit_logs']
})

// UUID primary keys
const plugin = auditPlugin({
  primaryKeyColumn: 'uuid',
  getUserId: () => currentUser?.uuid
})

// Only specific tables
const plugin = auditPlugin({
  tables: ['users', 'orders', 'payments'],
  getUserId: () => currentUser?.id
})

// Custom audit table name
const plugin = auditPlugin({
  auditTable: 'change_history',
  getUserId: () => currentUser?.id
})
```

## Repository Methods

When a repository is extended by the audit plugin, the following methods are added:

### AuditRepositoryExtensions Interface

```typescript
interface AuditRepositoryExtensions<T> {
  /**
   * Get change history for an entity
   * Returns parsed entries with old_values/new_values as objects
   */
  getAuditHistory(
    entityId: string | number,
    options?: AuditPaginationOptions
  ): Promise<ParsedAuditLogEntry[]>

  /**
   * Alias for getAuditHistory
   */
  getAuditLogs(
    entityId: string | number,
    options?: AuditPaginationOptions
  ): Promise<ParsedAuditLogEntry[]>

  /**
   * Get a specific audit log entry by ID (raw, unparsed)
   */
  getAuditLog(auditId: number): Promise<AuditLogEntry | null>

  /**
   * Get all audit logs for this table with optional filters
   * Returns parsed entries with old_values/new_values as objects
   */
  getTableAuditLogs(filters?: AuditFilters): Promise<ParsedAuditLogEntry[]>

  /**
   * Get all changes made by a specific user
   * Returns parsed entries with old_values/new_values as objects
   */
  getUserChanges(
    userId: string,
    options?: AuditPaginationOptions
  ): Promise<ParsedAuditLogEntry[]>

  /**
   * Restore entity to a previous state from an audit log
   */
  restoreFromAudit(auditId: number): Promise<T>
}
```

### getAuditHistory

Get the change history for a specific entity.

{/* doc-snippet: skip */}
```typescript
async getAuditHistory(
  entityId: string | number,
  options?: AuditPaginationOptions
): Promise<ParsedAuditLogEntry[]>
```

**Parameters:**

- `entityId` - Primary key of the entity
- `options.limit` - Maximum number of entries
- `options.offset` - Number of entries to skip

**Returns:** Array of parsed audit log entries, most recent first. The `old_values`, `new_values`, and `metadata` fields are automatically parsed from JSON strings into objects.

**Example:**

{/* doc-snippet: skip */}
```typescript
// Get full history
const history = await userRepo.getAuditHistory(userId)

// With pagination
const history = await userRepo.getAuditHistory(userId, {
  limit: 10,
  offset: 0
})

// Access changes - values are already parsed (no JSON.parse needed)
history.forEach(entry => {
  console.log(`${entry.operation} by ${entry.changed_by} at ${entry.changed_at}`)
  if (entry.old_values) {
    console.log('Before:', entry.old_values) // Already an object
  }
  if (entry.new_values) {
    console.log('After:', entry.new_values) // Already an object
  }
})
```

### getAuditLogs

Alias for `getAuditHistory`.

{/* doc-snippet: skip */}
```typescript
async getAuditLogs(
  entityId: string | number,
  options?: AuditPaginationOptions
): Promise<ParsedAuditLogEntry[]>
```

### getAuditLog

Get a specific audit log entry.

{/* doc-snippet: skip */}
```typescript
async getAuditLog(auditId: number): Promise<AuditLogEntry | null>
```

**Parameters:**

- `auditId` - ID of the audit log entry

**Returns:** The audit log entry or null

**Example:**

```typescript
const entry = await userRepo.getAuditLog(auditLogId)
if (entry) {
  console.log(`Operation: ${entry.operation}`)
  console.log(`Changed by: ${entry.changed_by}`)
}
```

### getTableAuditLogs

Get all audit logs for the table with optional filters.

{/* doc-snippet: skip */}
```typescript
async getTableAuditLogs(filters?: AuditFilters): Promise<ParsedAuditLogEntry[]>
```

**Parameters:**

- `filters` - Optional filters for the query

**Returns:** Array of parsed audit log entries matching the filters

**Example:**

```typescript
// Get all audit logs for the users table
const allLogs = await userRepo.getTableAuditLogs()

// Filter by operation type
const insertLogs = await userRepo.getTableAuditLogs({
  operation: 'INSERT'
})

// Filter by date range
const recentLogs = await userRepo.getTableAuditLogs({
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-31')
})

// Filter by user
const userLogs = await userRepo.getTableAuditLogs({
  userId: 'user-123'
})

// Combine multiple filters with pagination
const filteredLogs = await userRepo.getTableAuditLogs({
  operation: 'UPDATE',
  userId: 'admin',
  limit: 50,
  offset: 0
})
```

### getUserChanges

Get all changes made by a specific user across this table.

{/* doc-snippet: skip */}
```typescript
async getUserChanges(
  userId: string,
  options?: AuditPaginationOptions
): Promise<ParsedAuditLogEntry[]>
```

**Parameters:**

- `userId` - ID of the user whose changes to retrieve (string)
- `options.limit` - Maximum number of entries
- `options.offset` - Number of entries to skip

**Returns:** Array of parsed audit log entries for the user

**Example:**

```typescript
// Get all changes made by a specific user
const userChanges = await userRepo.getUserChanges('admin-user-id')

// With pagination
const recentChanges = await userRepo.getUserChanges('admin-user-id', {
  limit: 20,
  offset: 0
})

// Review what a user changed
userChanges.forEach(entry => {
  console.log(`${entry.operation} on entity ${entry.entity_id}`)
  console.log(`At: ${entry.changed_at}`)
})
```

### restoreFromAudit

Restore an entity to a previous state from an audit log entry.

{/* doc-snippet: skip */}
```typescript
async restoreFromAudit(auditId: number): Promise<T>
```

**Parameters:**

- `auditId` - ID of the audit log entry to restore from

**Returns:** The restored entity

**Behavior by operation type:**

- `UPDATE` entries — the entity is updated back to the entry's `old_values`, reverting the change. This works even if the row was soft-deleted after the audited update. The restore runs through the audited `update()`, so a new audit entry is written for it.
- `DELETE` entries — the entity is re-created from `old_values` via the audited `create()`, which records a new INSERT entry.
- `INSERT` entries — cannot be restored (the entity already exists); throws `AuditRestoreError`.

**Throws:**

- `NotFoundError` — no audit log entry exists with the given ID
- `AuditMissingValuesError` — the entry has no `old_values` (or they cannot be parsed)
- `AuditRestoreError` — INSERT entries, a missing primary key in `old_values`, or a repository without the needed `create`/`update` method

All three error classes are exported from `@kysera/core`.

**Example:**

```typescript
// Revert an UPDATE (or undo a DELETE) recorded in the audit log
const restoredUser = await userRepo.restoreFromAudit(auditLogId)
```

## AuditLogEntry

Structure of audit log entries.

```typescript
interface AuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: string
  old_values: string | null // JSON string
  new_values: string | null // JSON string
  changed_by: string | null
  changed_at: string
  metadata: string | null // JSON string
}
```

`operation` is typed as a plain `string` (there is no exported `AuditOperation` type); the plugin writes the conventional values `'INSERT'`, `'UPDATE'`, and `'DELETE'`.

## AuditFilters

Filters for querying audit logs.

```typescript
interface AuditFilters extends AuditPaginationOptions {
  /** Filter by operation type ('INSERT', 'UPDATE', 'DELETE') */
  operation?: string
  /** Filter by user who made the change */
  userId?: string
  /** Filter changes from this date - accepts Date, ISO string, or unix timestamp (ms) */
  startDate?: Date | string | number
  /** Filter changes until this date - accepts Date, ISO string, or unix timestamp (ms) */
  endDate?: Date | string | number
}

interface AuditPaginationOptions {
  /** Maximum number of entries to return */
  limit?: number
  /** Number of entries to skip */
  offset?: number
}
```

### ParsedAuditLogEntry

The query methods (`getAuditHistory`, `getAuditLogs`, `getTableAuditLogs`, `getUserChanges`) return `ParsedAuditLogEntry[]` where `old_values`, `new_values`, and `metadata` are automatically parsed from JSON strings into objects:

```typescript
interface ParsedAuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: string
  old_values: Record<string, unknown> | null  // Parsed from JSON
  new_values: Record<string, unknown> | null  // Parsed from JSON
  changed_by: string | null
  changed_at: Date | string
  metadata: Record<string, unknown> | null    // Parsed from JSON
}
```

{/* doc-snippet: skip */}
```typescript
const history = await userRepo.getAuditHistory(userId)

// Values are already parsed -- no JSON.parse needed
history.forEach(entry => {
  console.log('Changed from:', entry.old_values) // Already an object or null
  console.log('Changed to:', entry.new_values)   // Already an object or null
})
```

**Note:** The `getAuditLog(auditId)` method returns a raw `AuditLogEntry` (with JSON strings), not a `ParsedAuditLogEntry`.

### BigInt and Date Serialization

`old_values` and `new_values` are stored as JSON. Values JSON cannot represent natively are written in a tagged form and transparently revived by `restoreFromAudit()`:

```json
{ "created_at": { "$kysera": "date", "value": "2026-01-15T10:30:00.000Z" } }
{ "big_number": { "$kysera": "bigint", "value": "9007199254740993" } }
```

On restore, tagged dates come back as `Date` objects and tagged bigints as `bigint` values — instead of degrading to strings (Date) or throwing during serialization (BigInt).

## Automatic Audit Logging

The plugin automatically logs changes for INSERT, UPDATE, and DELETE operations:

### On INSERT

```typescript
await userRepo.create({ email: 'john@example.com', name: 'John' })

// Audit log entry:
// {
//   operation: 'INSERT',
//   old_values: null,
//   new_values: '{"email":"john@example.com","name":"John","id":1}'
// }
```

### On UPDATE

```typescript
await userRepo.update(userId, { name: 'John Smith' })

// Audit log entry:
// {
//   operation: 'UPDATE',
//   old_values: '{"name":"John"}',
//   new_values: '{"name":"John Smith"}'
// }
```

### On DELETE

```typescript
await userRepo.delete(userId)

// Audit log entry:
// {
//   operation: 'DELETE',
//   old_values: '{"id":1,"email":"john@example.com","name":"John Smith"}',
//   new_values: null
// }
```

## How It Works

The plugin has **no query interceptor** — it works entirely through the `extendRepository()` hook. When a repository is created, the plugin wraps its mutation methods (`create`, `update`, `delete`, their bulk variants, and the soft-delete methods when present) so each call captures old/new values and writes an audit entry:

{/* doc-snippet: skip */}
```typescript
// Plugin implementation (simplified)
extendRepository(repo) {
  const originalUpdate = repo.update.bind(repo)

  return {
    ...repo,
    async update(id, input) {
      const oldValues = await repo.findById(id) // capture old values
      const result = await originalUpdate(id, input)
      await insertAuditEntry({
        operation: 'UPDATE',
        old_values: oldValues,
        new_values: result
      })
      return result
    }
    // create/delete/bulk methods are wrapped the same way
  }
}
```

Because the plugin wraps repository methods rather than intercepting queries, mutations made directly through the executor or DAL (`executor.updateTable(...)`, raw Kysely queries) are **not** audited — only repository methods are.

## Usage with Plugin Container

{/* doc-snippet: skip */}
```typescript
import { createORM, createRepositoryFactory } from '@kysera/repository'
import { auditPlugin } from '@kysera/audit'
import { z } from 'zod'

// createORM creates a plugin container (repository manager), not a traditional ORM
const orm = await createORM(db, [
  auditPlugin({
    getUserId: () => currentUser?.id,
    captureOldValues: true,
    captureNewValues: true
  })
])

const userRepo = orm.createRepository(executor => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'users',
    mapRow: row => ({
      id: row.id,
      email: row.email,
      name: row.name
    }),
    schemas: {
      create: z.object({
        email: z.string().email(),
        name: z.string()
      })
    }
  })
})

// All operations are automatically audited
await userRepo.create({ email: 'john@example.com', name: 'John' })
await userRepo.update(userId, { name: 'John Smith' })
await userRepo.delete(userId)

// Get audit history
const history = await userRepo.getAuditHistory(userId)
```

## Database-Specific Plugins (Deprecated)

:::warning Deprecated
Since v0.8.7, `auditPlugin()` automatically detects the dialect and formats timestamps correctly. Use `auditPlugin()` for all databases. `auditPluginPostgreSQL`, `auditPluginMySQL`, and `auditPluginSQLite` are thin aliases that simply call `auditPlugin()` — they contain no dialect-specific behavior of their own.
:::

```typescript
// Recommended: works with all databases
import { auditPlugin } from '@kysera/audit'

// @deprecated — aliases of auditPlugin(), kept for backwards compatibility
import { auditPluginPostgreSQL, auditPluginMySQL, auditPluginSQLite } from '@kysera/audit'

const orm = await createORM(db, [
  auditPluginPostgreSQL({
    getUserId: () => currentUser?.id
  })
])
```

## Database Schema

:::info Automatic table creation
`auditPlugin()` checks for the audit table during `onInit` and creates it automatically if missing, using a portable all-TEXT column schema. The DDL below is optional — write it yourself when you want database-native types (JSONB, DATETIME), indexes, or partitioning.
:::

Create the audit_logs table:

```sql
-- PostgreSQL
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(255) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  operation VARCHAR(10) NOT NULL,
  old_values JSONB,
  new_values JSONB,
  changed_by VARCHAR(255),
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

-- Indexes for common queries
CREATE INDEX idx_audit_logs_table_entity ON audit_logs(table_name, entity_id);
CREATE INDEX idx_audit_logs_changed_by ON audit_logs(changed_by);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at);

-- MySQL
CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(255) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  operation VARCHAR(10) NOT NULL,
  old_values JSON,
  new_values JSON,
  changed_by VARCHAR(255),
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSON
);

-- SQLite
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  old_values TEXT,
  new_values TEXT,
  changed_by TEXT,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT
);
```

## Transaction Support

Audit logs are transaction-aware:

{/* doc-snippet: skip */}
```typescript
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)

  await repos.users.update(userId, { status: 'active' })
  await repos.orders.create({ user_id: userId, ... })

  // If transaction fails, audit logs are also rolled back
})
```

### Atomic Audit Entries (v0.9)

Since v0.9, mutations on the **root executor** (outside any transaction) are re-dispatched through an implicit transaction, so the mutation and its audit entry commit or roll back together. If the repository cannot be rebound to a transaction (e.g. custom repository shapes without `withTransaction`), the plugin falls back to best-effort sequential writes — the mutation commits first and the audit entry is written afterwards. Inside an explicit transaction, both writes simply join it and the caller controls atomicity.

## Bulk Operation Optimization

The audit plugin optimizes bulk operations:

```typescript
// Instead of N queries for old values, uses single IN query
await userRepo.bulkUpdate([
  { id: 1, data: { status: 'active' } },
  { id: 2, data: { status: 'active' } },
  { id: 3, data: { status: 'active' } }
])

// Execution:
// 1 query to fetch old values (SELECT ... WHERE id IN (1, 2, 3))
// 1 query to update
// 1 query to insert audit logs (bulk insert)
```

## TypeScript Types

### AuditRepositoryExtensions

The package does not export an `AuditRepository` type — compose the `AuditRepositoryExtensions<T>` interface with your repository type instead:

{/* doc-snippet: skip */}
```typescript
import type { AuditRepositoryExtensions } from '@kysera/audit'

type AuditedUserRepo = Repository<User, Database> & AuditRepositoryExtensions<User>

const userRepo = orm.createRepository(createUserRepository) as AuditedUserRepo
const history = await userRepo.getAuditHistory(123)
```

### AuditLogEntry

```typescript
interface AuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: string // 'INSERT' | 'UPDATE' | 'DELETE' by convention
  old_values: string | null
  new_values: string | null
  changed_by: string | null
  changed_at: string
  metadata: string | null
}
```

## Best Practices

### 1. Exclude Audit Table from Auditing

```typescript
auditPlugin({
  excludeTables: ['audit_logs'] // Prevent infinite loop
})
```

### 2. Include Request Context

```typescript
auditPlugin({
  getUserId: () => currentUser?.id,
  metadata: () => ({
    ip: request.ip,
    sessionId: session.id,
    userAgent: request.headers['user-agent'],
    requestId: request.id
  })
})
```

### 3. Partition Large Audit Tables

```sql
-- PostgreSQL partitioning by date
CREATE TABLE audit_logs (
  ...
) PARTITION BY RANGE (changed_at);

CREATE TABLE audit_logs_2024_q1 PARTITION OF audit_logs
  FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');

CREATE TABLE audit_logs_2024_q2 PARTITION OF audit_logs
  FOR VALUES FROM ('2024-04-01') TO ('2024-07-01');
```

### 4. Archive Old Audit Logs

```sql
-- Move old logs to archive
INSERT INTO audit_logs_archive
SELECT * FROM audit_logs
WHERE changed_at < NOW() - INTERVAL '1 year';

DELETE FROM audit_logs
WHERE changed_at < NOW() - INTERVAL '1 year';
```

### 5. Use Indexes for Common Queries

```sql
-- Essential indexes
CREATE INDEX idx_audit_logs_table_entity ON audit_logs(table_name, entity_id);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at DESC);

-- Optional indexes based on usage
CREATE INDEX idx_audit_logs_changed_by ON audit_logs(changed_by);
CREATE INDEX idx_audit_logs_operation ON audit_logs(operation);
```

## Performance Considerations

### Memory Management

- Old/new values are captured per operation
- Use `captureOldValues: false` if not needed
- Use `captureNewValues: false` if not needed

### Query Optimization

- Bulk operations use single queries for old values
- Audit entries are bulk-inserted
- Indexes on `(table_name, entity_id)` are essential

### Storage Growth

- Audit logs grow with every change
- Plan for archival or partitioning
- Consider TTL policies for old entries

## Combining with Other Plugins

```typescript
const orm = await createORM(db, [
  timestampsPlugin(), // Auto timestamps
  softDeletePlugin(), // Soft delete (audited)
  auditPlugin({
    // Comprehensive audit
    getUserId: () => currentUser?.id,
    excludeTables: ['audit_logs']
  })
])

// All plugins work together:
// - Soft delete creates audit entry
// - Timestamps are included in audit values
```

### Soft-Delete Coverage

When the soft-delete plugin is installed alongside audit, its methods are audited too:

- `softDelete()` and `restore()` (plus `softDeleteMany()` / `restoreMany()`) are recorded as `UPDATE` entries — they are state transitions on the `deleted_at` column
- `hardDelete()` and `hardDeleteMany()` are recorded as `DELETE` entries
- Old values are fetched through an `includeDeleted`-scoped executor, so entries are complete even when the target row is already soft-deleted (e.g. a `restore()` or `hardDelete()` of an invisible row)

## Schema Validation (Optional)

The audit plugin provides optional Zod schemas for configuration validation. This is useful for CLI tools, configuration file parsing, and runtime validation.

:::info Separate Export
Schemas are exported from `@kysera/audit/schema` to keep Zod as an optional dependency. The main `@kysera/audit` export works without Zod installed.
:::

### AuditOptionsSchema

Zod schema for validating `AuditOptions` configuration.

```typescript
import { AuditOptionsSchema } from '@kysera/audit/schema'

// Validate configuration
const result = AuditOptionsSchema.safeParse({
  auditTable: 'audit_logs',
  captureOldValues: true,
  captureNewValues: true,
  excludeTables: ['migrations', 'sessions']
})

if (result.success) {
  console.log('Valid config:', result.data)
} else {
  console.error('Invalid config:', result.error.issues)
}
```

### Schema Fields

```typescript
const AuditOptionsSchema = z.object({
  auditTable: z.string().optional(),
  primaryKeyColumn: z.string().optional(),
  captureOldValues: z.boolean().optional(),
  captureNewValues: z.boolean().optional(),
  skipSystemOperations: z.boolean().optional(),
  tables: z.array(z.string()).optional(),
  excludeTables: z.array(z.string()).optional(),
  getUserId: z.function().optional(),
  getTimestamp: z.function().optional(),
  metadata: z.function().optional()
})
```

### Type Inference

```typescript
import { AuditOptionsSchema, type AuditOptionsSchemaType } from '@kysera/audit/schema'

// Type inferred from schema
type Options = AuditOptionsSchemaType

// Same as AuditOptions interface
const config: Options = {
  auditTable: 'change_history',
  captureOldValues: true
}
```

## See Also

- [Audit Plugin Guide](/docs/plugins/audit)
- [@kysera/repository](/docs/api/repository)
- [@kysera/soft-delete](/docs/api/soft-delete)
