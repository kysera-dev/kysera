---
sidebar_position: 3
title: Audit
description: Audit logging plugin for Kysera
---

# Audit Plugin

Automatically track database changes with comprehensive audit logging. This is a **repository-level plugin**: it works by wrapping repository mutation methods via `extendRepository()` and has no query interceptor — only mutations made through repositories are audited.

## Installation

```bash
npm install @kysera/audit
```

## Basic Usage

### With Repository Pattern

{/* doc-snippet: skip */}
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

### Direct Executor Writes Are NOT Audited

The plugin has no `interceptQuery` hook — auditing happens only in the repository method wrappers. A write issued directly on the executor (or from a DAL mutation) executes normally but produces **no audit log entry**. This is silent: nothing fails, the row simply never appears in the audit trail.

```typescript
import { createExecutor } from '@kysera/executor'
import { auditPlugin } from '@kysera/audit'

const executor = await createExecutor(db, [
  auditPlugin({
    getUserId: () => currentUser?.id || null
  })
])

// Executes fine — but NO audit entry is written (silent audit-trail loss)
const user = await executor
  .insertInto('users')
  .values({ email: 'john@example.com', name: 'John' })
  .returningAll()
  .executeTakeFirst()
```

:::warning
If a complete audit trail matters, route **every mutation** through a repository and keep direct executor/DAL usage for reads.
:::

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

{/* doc-snippet: skip */}
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

| Method                                | Description                                    | Returns                  |
| ------------------------------------- | ---------------------------------------------- | ------------------------ |
| `getAuditHistory(entityId, options?)` | Get change history for an entity               | `ParsedAuditLogEntry[]`  |
| `getAuditLogs(entityId, options?)`    | Alias for getAuditHistory                      | `ParsedAuditLogEntry[]`  |
| `getAuditLog(auditId)`                | Get specific audit log entry (raw)             | `AuditLogEntry \| null`  |
| `getTableAuditLogs(filters?)`         | Query audit logs across the table with filters | `ParsedAuditLogEntry[]`  |
| `getUserChanges(userId, options?)`    | Changes made by a user to this repository's table | `ParsedAuditLogEntry[]`  |
| `restoreFromAudit(auditId)`           | Restore entity to previous state               | `T`                      |

:::info Parsed vs Raw
Most query methods return `ParsedAuditLogEntry[]` where `old_values`, `new_values`, and `metadata` are automatically parsed from JSON strings into objects. Only `getAuditLog()` returns the raw `AuditLogEntry` with JSON strings.
:::

## Querying Audit Logs

{/* doc-snippet: skip */}
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

// Values are already parsed from JSON -- no JSON.parse needed
console.log(history[0].old_values) // Record<string, unknown> | null
console.log(history[0].new_values) // Record<string, unknown> | null
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
// Get changes made by a specific user to THIS repository's table
// (scoped with WHERE table_name = 'users' — query each repo for cross-table activity)
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
  /** Filter by start date (inclusive) - accepts Date, ISO string, or unix timestamp (ms) */
  startDate?: Date | string | number
  /** Filter by end date (inclusive) - accepts Date, ISO string, or unix timestamp (ms) */
  endDate?: Date | string | number
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
```

What happens depends on the operation recorded in the audit entry:

| Entry operation | Restore behavior                                                       |
| --------------- | ---------------------------------------------------------------------- |
| `UPDATE`        | Reverts the entity to `old_values` via an audited update. Works even if the row was soft-deleted after the audited change — the update is re-dispatched through an `includeDeleted`-scoped executor. |
| `DELETE`        | Re-creates the entity from `old_values` via an audited create.          |
| `INSERT`        | Throws `AuditRestoreError` — the entity already exists; there is no previous state to revert to. |

The restore runs through the audited create/update path, so it produces a new audit entry and is atomic like any other mutation.

## Database Schema

You do not have to create the audit table yourself: during initialization (`onInit`) the plugin checks whether the table exists and **auto-creates it if missing**, using portable `TEXT` columns for all value fields so it works on every supported dialect.

Creating the table manually is optional — do it when you want database-native types (e.g. `JSONB` on PostgreSQL) or when your migration system should own the schema:

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

{/* doc-snippet: skip */}
```typescript
await db.transaction().execute(async (trx) => {
  const repos = createRepos(trx)

  await repos.users.update(userId, { status: 'active' })
  await repos.orders.create({ user_id: userId, ... })

  // If transaction fails, audit logs are also rolled back
})
```

### Atomicity Outside Explicit Transactions

When a mutation runs on the **root executor** (no transaction open), the plugin re-dispatches it inside an implicit transaction with the full plugin chain re-applied, so the mutation and its audit entry commit or roll back **together**.

- **Inside an explicit transaction**: the caller already controls atomicity — mutation and audit entry are written on the same transaction.
- **Implicit transaction unavailable** (e.g. the repository cannot be rebuilt on a transaction): the plugin falls back to best-effort sequential logging — mutation first, audit entry after.

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

The audit plugin wraps the base repository's bulk methods with batch audit logging:

- `bulkCreate(inputs)` - Single batch INSERT for audit entries
- `bulkUpdate(updates)` - Batch fetch old values, batch audit INSERT
- `bulkDelete(ids)` - Batch pre-delete probe (also captures old values), batch audit INSERT

:::warning createMany / updateMany are NOT audited
`createMany()` and `updateMany()` are added by the **timestamps plugin** and write through the executor directly — they never pass through the audit wrappers, so they produce no audit entries. For audited bulk writes, use `bulkCreate()` / `bulkUpdate()` / `bulkDelete()`.
:::

### Shared Row Fetch with Other Plugins (v0.10+)

The old-values fetch for `update()`, `delete()` and `bulkUpdate()` runs
through the **per-operation row cache** in `@kysera/core` and reads the row
via the raw db (plugin interception bypassed). Stacked with `@kysera/rls`,
one guarded mutation now issues a single shared pre-fetch SELECT — audit's
old-values capture and RLS's value-policy check reuse the same row — instead
of one SELECT per plugin. The cache is scoped to exactly one repository call
and is never reused across calls.

Because audit entries are only written when the mutation actually succeeded
(a row that succeeded matched every SQL-level narrowing — RLS filters,
soft-delete predicate — at mutation time), switching the fetch to the raw db
does not change which entries are written. In check-then-act race windows the
captured `old_values` are now the row's true pre-image rather than
`null`-when-filtered.

### Soft-Delete Operation Coverage

When the soft-delete plugin extends the same repository (it runs first — higher priority), the audit plugin wraps its methods too:

| Method                                   | Audited As |
| ---------------------------------------- | ---------- |
| `softDelete(id)` / `softDeleteMany(ids)` | `UPDATE`   |
| `restore(id)` / `restoreMany(ids)`       | `UPDATE`   |
| `hardDelete(id)` / `hardDeleteMany(ids)` | `DELETE`   |

Old values for these entries are captured through an `includeDeleted`-scoped executor, so rows hidden by the soft-delete filter (a restore or hard-delete target) can still be read for the audit entry — every other plugin (RLS, ...) stays active. For `softDelete(id)` and `restore(id)` this fetch also goes through the per-operation row cache: soft-delete's own `restore()` existence probe has identical visibility and reuses it (one shared SELECT instead of two).

## Database-Specific Plugins

For optimal compatibility, use the database-specific audit plugin:

:::info Auto-Dialect Detection
Since v0.8.7, `auditPlugin()` automatically detects the database dialect via `detectDialect()` from `@kysera/core` and formats timestamps appropriately for each database. The dialect-specific variants are deprecated.
:::

| Database   | Plugin                     | Notes                            |
| ---------- | -------------------------- | -------------------------------- |
| All        | `auditPlugin()`            | Auto-detects dialect, formats timestamps correctly |
| PostgreSQL | ~~`auditPluginPostgreSQL()`~~ | **Deprecated** — use `auditPlugin()` |
| MySQL      | ~~`auditPluginMySQL()`~~      | **Deprecated** — use `auditPlugin()` |
| SQLite     | ~~`auditPluginSQLite()`~~     | **Deprecated** — use `auditPlugin()` |

### Recommended Usage (All Databases)

```typescript
import { auditPlugin } from '@kysera/audit'

// Works with PostgreSQL, MySQL, SQLite — dialect auto-detected
const plugins = [
  auditPlugin({
    getUserId: () => getCurrentUserId()
  })
]

const executor = await createExecutor(db, plugins)
```

### Deprecated Database-Specific Variants

```typescript
// @deprecated — use auditPlugin() instead
import { auditPluginPostgreSQL } from '@kysera/audit'
import { auditPluginMySQL } from '@kysera/audit'
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

## See Also

- [@kysera/audit API Reference](/docs/api/audit)
- [Timestamps Plugin Guide](/docs/plugins/timestamps)
