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

| Metric                | Value                               |
| --------------------- | ----------------------------------- |
| **Bundle Size**       | ~8 KB (minified)                    |
| **Dependencies**      | @kysera/core (workspace)            |
| **Peer Dependencies** | kysely >=0.28.8, @kysera/repository |

## Exports

```typescript
// Main plugin
export { auditPlugin } from './index'

// Database-specific plugins
export { auditPluginPostgreSQL } from './dialects/postgres'
export { auditPluginMySQL } from './dialects/mysql'
export { auditPluginSQLite } from './dialects/sqlite'

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
   * Function to get the timestamp for audit entries
   * @default () => new Date().toISOString()
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

### AuditMethods Interface

```typescript
interface AuditMethods<T> {
  /**
   * Get change history for an entity
   */
  getAuditHistory(
    entityId: string | number,
    options?: { limit?: number; offset?: number }
  ): Promise<AuditLogEntry[]>

  /**
   * Alias for getAuditHistory
   */
  getAuditLogs(
    entityId: string | number,
    options?: { limit?: number; offset?: number }
  ): Promise<AuditLogEntry[]>

  /**
   * Get a specific audit log entry by ID
   */
  getAuditLog(auditId: number): Promise<AuditLogEntry | null>

  /**
   * Get all audit logs for this table with optional filters
   */
  getTableAuditLogs(filters?: AuditFilters): Promise<AuditLogEntry[]>

  /**
   * Get all changes made by a specific user
   */
  getUserChanges(
    userId: string | number,
    options?: { limit?: number; offset?: number }
  ): Promise<AuditLogEntry[]>

  /**
   * Restore entity to a previous state from an audit log
   */
  restoreFromAudit(auditId: number): Promise<T>
}
```

### getAuditHistory

Get the change history for a specific entity.

```typescript
async getAuditHistory(
  entityId: string | number,
  options?: { limit?: number; offset?: number }
): Promise<AuditLogEntry[]>
```

**Parameters:**

- `entityId` - Primary key of the entity
- `options.limit` - Maximum number of entries
- `options.offset` - Number of entries to skip

**Returns:** Array of audit log entries, most recent first

**Example:**

```typescript
// Get full history
const history = await userRepo.getAuditHistory(userId)

// With pagination
const history = await userRepo.getAuditHistory(userId, {
  limit: 10,
  offset: 0
})

// Access changes
history.forEach(entry => {
  console.log(`${entry.operation} by ${entry.changed_by} at ${entry.changed_at}`)
  if (entry.old_values) {
    console.log('Before:', JSON.parse(entry.old_values))
  }
  if (entry.new_values) {
    console.log('After:', JSON.parse(entry.new_values))
  }
})
```

### getAuditLogs

Alias for `getAuditHistory`.

```typescript
async getAuditLogs(
  entityId: string | number,
  options?: { limit?: number; offset?: number }
): Promise<AuditLogEntry[]>
```

### getAuditLog

Get a specific audit log entry.

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

```typescript
async getTableAuditLogs(filters?: AuditFilters): Promise<AuditLogEntry[]>
```

**Parameters:**

- `filters` - Optional filters for the query

**Returns:** Array of audit log entries matching the filters

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

```typescript
async getUserChanges(
  userId: string | number,
  options?: { limit?: number; offset?: number }
): Promise<AuditLogEntry[]>
```

**Parameters:**

- `userId` - ID of the user whose changes to retrieve
- `options.limit` - Maximum number of entries
- `options.offset` - Number of entries to skip

**Returns:** Array of audit log entries for the user

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

```typescript
async restoreFromAudit(auditId: number): Promise<T>
```

**Parameters:**

- `auditId` - ID of the audit log entry to restore from

**Returns:** The restored entity

**Example:**

```typescript
// Restore user to previous state
const restoredUser = await userRepo.restoreFromAudit(auditLogId)

// This will:
// 1. Read the old_values from the audit log
// 2. Update the entity with those values
// 3. Create a new audit entry for the restore operation
```

## AuditLogEntry

Structure of audit log entries.

```typescript
interface AuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: AuditOperation
  old_values: string | null // JSON string
  new_values: string | null // JSON string
  changed_by: string | null
  changed_at: string
  metadata: string | null // JSON string
}

type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE'
```

## AuditFilters

Filters for querying audit logs.

```typescript
interface AuditFilters {
  /** Filter by operation type */
  operation?: AuditOperation
  /** Filter by user who made the change */
  userId?: string
  /** Filter changes from this date */
  startDate?: Date | string
  /** Filter changes until this date */
  endDate?: Date | string
  /** Maximum number of entries to return */
  limit?: number
  /** Number of entries to skip */
  offset?: number
}
```

### Parsed Values

When accessing `old_values` and `new_values`, parse them as JSON:

```typescript
const history = await userRepo.getAuditHistory(userId)

history.forEach(entry => {
  const oldValues = entry.old_values ? JSON.parse(entry.old_values) : null
  const newValues = entry.new_values ? JSON.parse(entry.new_values) : null

  console.log('Changed from:', oldValues)
  console.log('Changed to:', newValues)
})
```

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

## Query Interception

The plugin intercepts operations to capture changes:

```typescript
// Plugin implementation (simplified)
async interceptQuery(qb, context) {
  if (context.operation === 'update') {
    // Capture old values before update
    const oldValues = await fetchCurrentValues(context.entityId)

    // Execute update
    const result = await qb.execute()

    // Log audit entry
    await logAuditEntry({
      operation: 'UPDATE',
      oldValues,
      newValues: context.data
    })

    return result
  }
}
```

## Usage with Plugin Container

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

## Database-Specific Plugins

For optimized performance, use database-specific variants:

```typescript
// PostgreSQL - uses JSONB
import { auditPluginPostgreSQL } from '@kysera/audit'

// MySQL - uses JSON type
import { auditPluginMySQL } from '@kysera/audit'

// SQLite - uses TEXT with JSON
import { auditPluginSQLite } from '@kysera/audit'

const orm = await createORM(db, [
  auditPluginPostgreSQL({
    getUserId: () => currentUser?.id
  })
])
```

## Database Schema

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

```typescript
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)

  await repos.users.update(userId, { status: 'active' })
  await repos.orders.create({ user_id: userId, ... })

  // If transaction fails, audit logs are also rolled back
})
```

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

### AuditRepository

```typescript
type AuditRepository<Entity, DB> = Repository<Entity, DB> & AuditMethods<Entity>
```

### AuditLogEntry

```typescript
interface AuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
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
