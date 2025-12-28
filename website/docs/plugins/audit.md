---
sidebar_position: 3
title: Audit
description: Audit logging plugin for Kysera
---

# Audit Plugin

Automatically track all database changes with comprehensive audit logging. Works through **@kysera/executor's** Unified Execution Layer for consistent behavior.

## Installation

```bash
npm install @kysera/audit
```

## Basic Usage

### With Repository Pattern

```typescript
import { createORM } from '@kysera/repository'
import { auditPlugin } from '@kysera/audit'

const orm = await createORM(db, [
  auditPlugin({
    getUserId: () => currentUser?.id || null,
    captureOldValues: true,
    captureNewValues: true
  })
])

const userRepo = orm.createRepository(executor => {
  const factory = createRepositoryFactory(executor)
  return factory.create({ tableName: 'users' /* ... */ })
})

// All operations are automatically audited
await userRepo.create({ email: 'john@example.com', name: 'John' })
await userRepo.update(userId, { name: 'John Smith' })
await userRepo.delete(userId)

// Get audit history
const history = await userRepo.getAuditHistory(userId)
```

### With Executor Directly

```typescript
import { createExecutor } from '@kysera/executor'
import { auditPlugin } from '@kysera/audit'

const executor = await createExecutor(db, [
  auditPlugin({
    getUserId: () => currentUser?.id || null
  })
])

// Audit logging works with direct executor usage
const user = await executor
  .insertInto('users')
  .values({ email: 'john@example.com', name: 'John' })
  .returningAll()
  .executeTakeFirst()
// Audit log entry created automatically
```

## Configuration

```typescript
interface AuditOptions {
  auditTable?: string // Default: 'audit_logs'
  primaryKeyColumn?: string // Default: 'id'
  captureOldValues?: boolean // Default: true
  captureNewValues?: boolean // Default: true
  skipSystemOperations?: boolean // Default: false
  tables?: string[] // Whitelist tables
  excludeTables?: string[] // Blacklist tables
  getUserId?: () => string | null
  getTimestamp?: () => Date | string
  metadata?: () => Record<string, unknown> // Custom metadata
  logger?: KyseraLogger
}
```

### Configuration Examples

```typescript
// Basic setup
auditPlugin({
  getUserId: () => currentUser?.id
})

// Full setup with metadata
auditPlugin({
  getUserId: () => currentUser?.id,
  captureOldValues: true,
  captureNewValues: true,
  metadata: () => ({
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    requestId: request.id
  }),
  excludeTables: ['sessions', 'audit_logs']
})

// UUID primary keys
auditPlugin({
  primaryKeyColumn: 'uuid',
  getUserId: () => currentUser?.uuid
})
```

## Audit Log Structure

```typescript
interface AuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  old_values: string | null // JSON
  new_values: string | null // JSON
  changed_by: string | null
  changed_at: string
  metadata: string | null // JSON
}
```

## Added Methods

| Method                                | Description                                    |
| ------------------------------------- | ---------------------------------------------- |
| `getAuditHistory(entityId, options?)` | Get change history for an entity               |
| `getAuditLogs(entityId, options?)`    | Alias for getAuditHistory                      |
| `getAuditLog(auditId)`                | Get specific audit log entry                   |
| `getTableAuditLogs(filters?)`         | Query audit logs across the table with filters |
| `getUserChanges(userId, options?)`    | Get all changes made by a specific user        |
| `restoreFromAudit(auditId)`           | Restore entity to previous state               |

## Querying Audit Logs

```typescript
// Get history for specific entity
const history = await userRepo.getAuditHistory(userId)

// With pagination
const history = await userRepo.getAuditHistory(userId, {
  limit: 10,
  offset: 0
})

// Get specific audit entry
const entry = await userRepo.getAuditLog(auditLogId)

// Access parsed values
console.log(history[0].old_values) // Parsed object
console.log(history[0].new_values) // Parsed object
```

### Table-Wide Queries

```typescript
// Query audit logs across the entire table with filters
const logs = await userRepo.getTableAuditLogs({
  operation: 'UPDATE',
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-01-31'),
  limit: 100
})

// Filter by specific operations
const deletions = await userRepo.getTableAuditLogs({
  operation: 'DELETE',
  limit: 50
})
```

### User Activity Tracking

```typescript
// Get all changes made by a specific user
const userActivity = await userRepo.getUserChanges('admin-123', {
  limit: 100,
  offset: 0
})

// Track what a user modified
for (const change of userActivity) {
  console.log(`${change.operation} on ${change.entity_id} at ${change.changed_at}`)
}
```

### Filter Types

```typescript
interface AuditFilters extends AuditPaginationOptions {
  /** Filter by operation type */
  operation?: 'INSERT' | 'UPDATE' | 'DELETE'
  /** Filter by user ID (changed_by field) */
  userId?: string
  /** Filter by start date (inclusive) */
  startDate?: Date | string
  /** Filter by end date (inclusive) */
  endDate?: Date | string
}

interface AuditPaginationOptions {
  /** Maximum number of records to return */
  limit?: number
  /** Number of records to skip */
  offset?: number
}
```

## Restoring from Audit

```typescript
// Restore entity to a previous state
const restoredUser = await userRepo.restoreFromAudit(auditLogId)

// This will:
// 1. Read the old_values from the audit log
// 2. Update the entity with those values
// 3. Create a new audit entry for the restore operation
```

## Database Schema

Create the audit_logs table:

```sql
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

:::tip Performance Optimizations (v0.7.3)
The audit plugin includes significant performance optimizations for batch operations, achieving **~100x faster** execution for large batches compared to naive implementations.
:::

The audit plugin optimizes bulk operations using batch INSERT for all audit entries:

```typescript
// Instead of N queries for old values, uses single IN query
await userRepo.bulkUpdate([
  { id: 1, data: { status: 'active' } },
  { id: 2, data: { status: 'active' } },
  { id: 3, data: { status: 'active' } }
])
// 1 query to fetch old values
// 1 query to update
// 1 query to insert audit logs (batch INSERT)
```

### Performance Comparison

| Approach | 100 records | Query Count |
| -------- | ----------- | ----------- |
| **Old (N+1)** | 100 INSERT queries | ~102 queries |
| **New (batch)** | 1 batch INSERT | ~3 queries |
| **Improvement** | **~100x faster** | **~97% fewer queries** |

### Optimized Methods

All bulk methods use batch audit logging:

- `createMany(inputs)` - Single batch INSERT for audit entries
- `updateMany(ids, data)` - Batch fetch old values, batch audit INSERT
- `deleteMany(ids)` - Batch fetch old values, batch audit INSERT
- `bulkUpdate(updates)` - Optimized for mixed updates

## Database-Specific Plugins

For optimal compatibility, use the database-specific audit plugin:

| Database   | Plugin                     | Notes                            |
| ---------- | -------------------------- | -------------------------------- |
| PostgreSQL | `auditPluginPostgreSQL()`  | Full feature support             |
| MySQL      | `auditPluginMySQL()`       | DATETIME timestamp handling      |
| SQLite     | `auditPluginSQLite()`      | SQLite-specific optimizations    |

### MySQL Timestamp Handling

MySQL's DATETIME type requires specific formatting:

```typescript
import { auditPluginMySQL } from '@kysera/audit'

const plugins = [
  auditPluginMySQL({
    tableName: 'audit_logs',
    getUserId: () => getCurrentUserId()
  })
]

const executor = await createExecutor(db, plugins)
```

### All Database-Specific Variants

```typescript
// PostgreSQL-optimized (ISO8601 timestamps)
import { auditPluginPostgreSQL } from '@kysera/audit'

// MySQL-optimized (DATETIME format: 'YYYY-MM-DD HH:MM:SS')
import { auditPluginMySQL } from '@kysera/audit'

// SQLite-optimized (ISO8601 timestamps)
import { auditPluginSQLite } from '@kysera/audit'
```

:::note
All database-specific plugins currently use the same core implementation with database-appropriate timestamp formatting. The generic `auditPlugin()` also works across all databases. The database-specific variants are provided for future optimizations and explicit type clarity.
:::

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
    userAgent: request.headers['user-agent']
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
