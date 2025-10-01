# @kysera/audit

> Comprehensive audit logging plugin for Kysera ORM with automatic change tracking, user attribution, and transaction support.

[![npm version](https://img.shields.io/npm/v/@kysera/audit.svg)](https://www.npmjs.com/package/@kysera/audit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## 📦 Package Information

| Property | Value |
|----------|-------|
| **Package** | `@kysera/audit` |
| **Version** | `0.3.0` |
| **Bundle Size** | 6.1 KB (minified) |
| **Dependencies** | `zod` (validation only) |
| **Test Coverage** | 40 tests, comprehensive |
| **Supported Databases** | PostgreSQL, MySQL, SQLite |
| **Transaction Support** | ✅ Full ACID compliance |
| **Type Safety** | ✅ Full TypeScript support |

## 🎯 Features

### Core Audit Logging
- ✅ **Automatic tracking** - Logs all INSERT, UPDATE, DELETE operations
- ✅ **Old/New values** - Captures state before and after changes
- ✅ **User attribution** - Tracks who made each change
- ✅ **Timestamp tracking** - Records when changes occurred
- ✅ **Metadata support** - Add custom context (IP, user agent, etc.)

### Advanced Features
- ✅ **Transaction-aware** - Audit logs commit/rollback with transactions
- ✅ **Bulk operations** - Optimized for bulkCreate, bulkUpdate, bulkDelete
- ✅ **Restoration** - Restore deleted entities or revert updates
- ✅ **Query methods** - Rich API for querying audit history
- ✅ **Table filtering** - Whitelist/blacklist specific tables
- ✅ **Auto-initialization** - Creates audit_logs table automatically

### Performance Optimizations
- ✅ **Single-query fetching** - Bulk operations avoid N+1 queries
- ✅ **Minimal overhead** - <5% performance impact
- ✅ **Selective auditing** - Audit only what you need
- ✅ **Database-native timestamps** - Uses CURRENT_TIMESTAMP

## 📥 Installation

```bash
# pnpm (recommended)
pnpm add @kysera/audit

# npm
npm install @kysera/audit

# yarn
yarn add @kysera/audit

# bun
bun add @kysera/audit
```

## 🚀 Quick Start

### Basic Usage

```typescript
import { Kysely } from 'kysely'
import { auditPlugin } from '@kysera/audit'
import { createORM, createRepositoryFactory } from '@kysera/repository'

// Create audit plugin with user tracking
const audit = auditPlugin({
  getUserId: () => currentUser?.id || null,
  metadata: () => ({ ip: request.ip, userAgent: request.headers['user-agent'] })
})

// Initialize ORM with audit plugin
const orm = await createORM(db, [audit])

// Create repository - audit logging is automatic!
const factory = createRepositoryFactory(db)
const userRepo = orm.createRepository(() =>
  factory.create({
    tableName: 'users',
    mapRow: (row) => row as User,
    schemas: {
      create: CreateUserSchema,
      update: UpdateUserSchema
    }
  })
)

// All CRUD operations are automatically audited
const user = await userRepo.create({
  email: 'john@example.com',
  name: 'John Doe'
})
// ✅ Audit log created: INSERT operation with new_values

await userRepo.update(user.id, { name: 'Jane Doe' })
// ✅ Audit log created: UPDATE operation with old_values and new_values

await userRepo.delete(user.id)
// ✅ Audit log created: DELETE operation with old_values
```

### View Audit History

```typescript
// Get complete history for an entity
const history = await userRepo.getAuditHistory(user.id)
console.log(history)
// [
//   {
//     id: 3,
//     table_name: 'users',
//     entity_id: '1',
//     operation: 'DELETE',
//     old_values: { id: 1, email: 'john@example.com', name: 'Jane Doe' },
//     new_values: null,
//     changed_by: 'admin-user',
//     changed_at: '2025-01-15T10:30:00.000Z',
//     metadata: { ip: '192.168.1.1', userAgent: 'Mozilla/5.0...' }
//   },
//   {
//     id: 2,
//     table_name: 'users',
//     entity_id: '1',
//     operation: 'UPDATE',
//     old_values: { id: 1, email: 'john@example.com', name: 'John Doe' },
//     new_values: { id: 1, email: 'john@example.com', name: 'Jane Doe' },
//     changed_by: 'admin-user',
//     changed_at: '2025-01-15T10:25:00.000Z',
//     metadata: { ip: '192.168.1.1', userAgent: 'Mozilla/5.0...' }
//   },
//   {
//     id: 1,
//     table_name: 'users',
//     entity_id: '1',
//     operation: 'INSERT',
//     old_values: null,
//     new_values: { id: 1, email: 'john@example.com', name: 'John Doe' },
//     changed_by: 'admin-user',
//     changed_at: '2025-01-15T10:20:00.000Z',
//     metadata: { ip: '192.168.1.1', userAgent: 'Mozilla/5.0...' }
//   }
// ]
```

### Restore from Audit Log

```typescript
// Restore deleted entity
const deleteLogs = await userRepo.getTableAuditLogs({ operation: 'DELETE' })
const restored = await userRepo.restoreFromAudit(deleteLogs[0].id)
console.log(restored) // Entity recreated with original values

// Revert an update
const updateLogs = await userRepo.getAuditHistory(user.id)
const updateLog = updateLogs.find(log => log.operation === 'UPDATE')
const reverted = await userRepo.restoreFromAudit(updateLog.id)
console.log(reverted) // Entity reverted to old_values
```

## 📖 Table of Contents

- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
  - [Plugin Options](#plugin-options)
  - [Table Filtering](#table-filtering)
  - [User Attribution](#user-attribution)
  - [Custom Metadata](#custom-metadata)
- [Audit Log Schema](#-audit-log-schema)
- [Repository Methods](#-repository-methods)
  - [Automatic Logging](#automatic-logging)
  - [Query Methods](#query-methods)
  - [Restoration Methods](#restoration-methods)
- [Transaction Support](#-transaction-support)
- [Bulk Operations](#-bulk-operations)
- [Multi-Database Support](#-multi-database-support)
  - [PostgreSQL](#postgresql)
  - [MySQL](#mysql)
  - [SQLite](#sqlite)
- [Advanced Usage](#-advanced-usage)
  - [Custom Timestamps](#custom-timestamps)
  - [Selective Value Capture](#selective-value-capture)
  - [System Operations](#system-operations)
- [Performance](#-performance)
- [Type Safety](#-type-safety)
- [API Reference](#-api-reference)
- [Best Practices](#-best-practices)
- [Troubleshooting](#-troubleshooting)

## ⚙️ Configuration

### Plugin Options

```typescript
export interface AuditOptions {
  /**
   * Table name for storing audit logs
   * @default 'audit_logs'
   */
  auditTable?: string

  /**
   * Whether to capture old values in updates/deletes
   * @default true
   */
  captureOldValues?: boolean

  /**
   * Whether to capture new values in inserts/updates
   * @default true
   */
  captureNewValues?: boolean

  /**
   * Skip auditing for system operations (migrations, seeds)
   * @default false
   */
  skipSystemOperations?: boolean

  /**
   * Whitelist of tables to audit (if specified, only these tables will be audited)
   */
  tables?: string[]

  /**
   * Blacklist of tables to exclude from auditing
   */
  excludeTables?: string[]

  /**
   * Function to get the current user ID
   * @returns User ID or null
   */
  getUserId?: () => string | null

  /**
   * Function to get the current timestamp
   * @default () => new Date()
   */
  getTimestamp?: () => Date | string

  /**
   * Function to get additional metadata for audit entries
   * @returns Metadata object or null
   */
  metadata?: () => Record<string, unknown>
}
```

### Complete Configuration Example

```typescript
import { auditPlugin } from '@kysera/audit'

const audit = auditPlugin({
  // Custom audit table name
  auditTable: 'my_audit_logs',

  // Value capture options
  captureOldValues: true,  // Capture state before changes
  captureNewValues: true,   // Capture state after changes

  // User tracking
  getUserId: () => {
    // From session, JWT, or request context
    return currentUser?.id || null
  },

  // Custom metadata
  metadata: () => ({
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    endpoint: request.path,
    sessionId: request.session.id
  }),

  // Custom timestamp (optional)
  getTimestamp: () => new Date().toISOString(),

  // Skip system operations
  skipSystemOperations: false,

  // Table filtering (whitelist)
  tables: ['users', 'posts', 'comments'],

  // Or use blacklist
  // excludeTables: ['sessions', 'cache', 'migrations']
})
```

### Table Filtering

#### Whitelist Approach (Recommended)

```typescript
// Only audit specific tables
const audit = auditPlugin({
  tables: ['users', 'posts', 'orders', 'payments']
})

// ✅ Audited: users, posts, orders, payments
// ❌ Not audited: sessions, cache, logs, etc.
```

#### Blacklist Approach

```typescript
// Audit everything except specific tables
const audit = auditPlugin({
  excludeTables: ['sessions', 'cache', 'migrations', 'temp_data']
})

// ✅ Audited: all tables
// ❌ Not audited: sessions, cache, migrations, temp_data
```

### User Attribution

```typescript
// Simple user ID from global variable
let currentUserId: string | null = null

const audit = auditPlugin({
  getUserId: () => currentUserId
})

// Set user ID per request
app.use((req, res, next) => {
  currentUserId = req.user?.id || null
  next()
})

// Advanced: Extract from JWT
import jwt from 'jsonwebtoken'

const audit = auditPlugin({
  getUserId: () => {
    const token = request.headers.authorization?.split(' ')[1]
    if (!token) return null

    try {
      const decoded = jwt.verify(token, SECRET_KEY)
      return decoded.userId
    } catch {
      return null
    }
  }
})

// Express middleware example
const audit = auditPlugin({
  getUserId: () => {
    // Access from async local storage or request context
    return asyncLocalStorage.getStore()?.userId || null
  }
})
```

### Custom Metadata

```typescript
const audit = auditPlugin({
  metadata: () => {
    const metadata: Record<string, unknown> = {}

    // HTTP request information
    if (request) {
      metadata.ip = request.ip
      metadata.userAgent = request.headers['user-agent']
      metadata.endpoint = request.path
      metadata.method = request.method
    }

    // Application context
    metadata.environment = process.env.NODE_ENV
    metadata.version = process.env.APP_VERSION
    metadata.hostname = os.hostname()

    // Session information
    if (session) {
      metadata.sessionId = session.id
      metadata.sessionStart = session.createdAt
    }

    // Business context
    metadata.tenant = currentTenant?.id
    metadata.department = currentUser?.department
    metadata.reason = currentOperation?.reason

    return metadata
  }
})
```

## 🗄️ Audit Log Schema

### Database Schema

The audit plugin automatically creates an `audit_logs` table with the following structure:

#### PostgreSQL Schema

```sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(255) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  operation VARCHAR(50) NOT NULL,       -- 'INSERT', 'UPDATE', 'DELETE'
  old_values TEXT,                      -- JSON string of values before change
  new_values TEXT,                      -- JSON string of values after change
  changed_by VARCHAR(255),              -- User ID who made the change
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT                         -- JSON string of custom metadata
);

-- Recommended indexes
CREATE INDEX idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_operation ON audit_logs(operation);
CREATE INDEX idx_audit_logs_changed_by ON audit_logs(changed_by);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at);
```

#### MySQL Schema

```sql
CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(255) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  operation VARCHAR(50) NOT NULL,
  old_values TEXT,
  new_values TEXT,
  changed_by VARCHAR(255),
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT,
  INDEX idx_audit_logs_table_name (table_name),
  INDEX idx_audit_logs_entity_id (entity_id),
  INDEX idx_audit_logs_operation (operation),
  INDEX idx_audit_logs_changed_by (changed_by),
  INDEX idx_audit_logs_changed_at (changed_at)
) ENGINE=InnoDB;
```

#### SQLite Schema

```sql
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

CREATE INDEX idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_operation ON audit_logs(operation);
CREATE INDEX idx_audit_logs_changed_by ON audit_logs(changed_by);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at);
```

### TypeScript Types

```typescript
/**
 * Raw audit log entry from database
 */
export interface AuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: string              // 'INSERT' | 'UPDATE' | 'DELETE'
  old_values: string | null      // JSON string
  new_values: string | null      // JSON string
  changed_by: string | null
  changed_at: string
  metadata: string | null        // JSON string
}

/**
 * Parsed audit log entry with JSON values parsed
 */
export interface ParsedAuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: string
  old_values: Record<string, unknown> | null  // Parsed JSON
  new_values: Record<string, unknown> | null  // Parsed JSON
  changed_by: string | null
  changed_at: Date | string
  metadata: Record<string, unknown> | null    // Parsed JSON
}
```

### Example Audit Log Records

```typescript
// INSERT operation
{
  id: 1,
  table_name: 'users',
  entity_id: '123',
  operation: 'INSERT',
  old_values: null,
  new_values: {
    id: 123,
    email: 'john@example.com',
    name: 'John Doe',
    created_at: '2025-01-15T10:00:00.000Z'
  },
  changed_by: 'admin-user',
  changed_at: '2025-01-15T10:00:00.000Z',
  metadata: {
    ip: '192.168.1.1',
    userAgent: 'Mozilla/5.0...'
  }
}

// UPDATE operation
{
  id: 2,
  table_name: 'users',
  entity_id: '123',
  operation: 'UPDATE',
  old_values: {
    id: 123,
    email: 'john@example.com',
    name: 'John Doe'
  },
  new_values: {
    id: 123,
    email: 'john@example.com',
    name: 'Jane Smith'
  },
  changed_by: 'admin-user',
  changed_at: '2025-01-15T11:00:00.000Z',
  metadata: {
    ip: '192.168.1.1',
    reason: 'Name correction'
  }
}

// DELETE operation
{
  id: 3,
  table_name: 'users',
  entity_id: '123',
  operation: 'DELETE',
  old_values: {
    id: 123,
    email: 'john@example.com',
    name: 'Jane Smith'
  },
  new_values: null,
  changed_by: 'admin-user',
  changed_at: '2025-01-15T12:00:00.000Z',
  metadata: {
    ip: '192.168.1.1',
    reason: 'User requested account deletion'
  }
}
```

## 📚 Repository Methods

### Automatic Logging

All standard repository CRUD operations are automatically logged:

```typescript
// CREATE - Logs INSERT operation
const user = await userRepo.create({
  email: 'alice@example.com',
  name: 'Alice'
})
// Audit log: operation='INSERT', old_values=null, new_values={...}

// UPDATE - Logs UPDATE operation
const updated = await userRepo.update(user.id, {
  name: 'Alice Smith'
})
// Audit log: operation='UPDATE', old_values={...}, new_values={...}

// DELETE - Logs DELETE operation
await userRepo.delete(user.id)
// Audit log: operation='DELETE', old_values={...}, new_values=null

// BULK CREATE - Logs multiple INSERT operations
const users = await userRepo.bulkCreate([
  { email: 'bob@example.com', name: 'Bob' },
  { email: 'charlie@example.com', name: 'Charlie' }
])
// Audit logs: 2 INSERT operations

// BULK UPDATE - Logs multiple UPDATE operations
await userRepo.bulkUpdate([
  { id: 1, data: { name: 'New Name 1' } },
  { id: 2, data: { name: 'New Name 2' } }
])
// Audit logs: 2 UPDATE operations with old/new values

// BULK DELETE - Logs multiple DELETE operations
await userRepo.bulkDelete([1, 2, 3])
// Audit logs: 3 DELETE operations with old_values
```

### Query Methods

The audit plugin extends repositories with powerful query methods:

#### getAuditHistory()

Get complete history for a specific entity:

```typescript
interface Repository<T> {
  /**
   * Get audit history for a specific entity
   * @param entityId - The entity ID to get history for
   * @returns Array of parsed audit log entries, most recent first
   */
  getAuditHistory(entityId: number | string): Promise<ParsedAuditLogEntry[]>
}

// Usage
const history = await userRepo.getAuditHistory(123)

console.log(history)
// [
//   { id: 5, operation: 'DELETE', changed_at: '2025-01-15T15:00:00Z', ... },
//   { id: 4, operation: 'UPDATE', changed_at: '2025-01-15T14:00:00Z', ... },
//   { id: 3, operation: 'UPDATE', changed_at: '2025-01-15T13:00:00Z', ... },
//   { id: 2, operation: 'UPDATE', changed_at: '2025-01-15T12:00:00Z', ... },
//   { id: 1, operation: 'INSERT', changed_at: '2025-01-15T11:00:00Z', ... }
// ]

// Alias available for backwards compatibility
const logs = await userRepo.getAuditLogs(123)  // Same as getAuditHistory
```

#### getAuditLog()

Get a specific audit log entry by ID:

```typescript
interface Repository<T> {
  /**
   * Get a specific audit log entry
   * @param auditId - The audit log ID
   * @returns Raw audit log entry or null
   */
  getAuditLog(auditId: number): Promise<AuditLogEntry | null>
}

// Usage
const log = await userRepo.getAuditLog(42)

if (log) {
  console.log(`Operation: ${log.operation}`)
  console.log(`Changed by: ${log.changed_by}`)
  console.log(`Changed at: ${log.changed_at}`)

  const oldValues = log.old_values ? JSON.parse(log.old_values) : null
  const newValues = log.new_values ? JSON.parse(log.new_values) : null

  console.log('Old values:', oldValues)
  console.log('New values:', newValues)
}
```

#### getTableAuditLogs()

Query audit logs for entire table with filters:

```typescript
interface Repository<T> {
  /**
   * Get audit logs for entire table with optional filters
   * @param filters - Optional filters
   * @returns Array of parsed audit log entries
   */
  getTableAuditLogs(filters?: {
    operation?: string          // Filter by operation type
    userId?: string             // Filter by user
    startDate?: Date | string   // Filter by date range
    endDate?: Date | string
  }): Promise<ParsedAuditLogEntry[]>
}

// Get all INSERT operations
const inserts = await userRepo.getTableAuditLogs({
  operation: 'INSERT'
})

// Get changes by specific user
const userChanges = await userRepo.getTableAuditLogs({
  userId: 'admin-123'
})

// Get changes in date range
const recentChanges = await userRepo.getTableAuditLogs({
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-01-31')
})

// Combine filters
const adminDeletesLastWeek = await userRepo.getTableAuditLogs({
  operation: 'DELETE',
  userId: 'admin-123',
  startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
})
```

#### getUserChanges()

Get all changes made by a specific user:

```typescript
interface Repository<T> {
  /**
   * Get all changes made by a specific user for this table
   * @param userId - The user ID
   * @returns Array of parsed audit log entries
   */
  getUserChanges(userId: string): Promise<ParsedAuditLogEntry[]>
}

// Usage
const adminChanges = await userRepo.getUserChanges('admin-123')

console.log(`Admin made ${adminChanges.length} changes`)

// Analyze changes
const operations = adminChanges.reduce((acc, log) => {
  acc[log.operation] = (acc[log.operation] || 0) + 1
  return acc
}, {} as Record<string, number>)

console.log('Operations:', operations)
// { INSERT: 50, UPDATE: 120, DELETE: 10 }
```

### Restoration Methods

#### restoreFromAudit()

Restore entity from audit log:

```typescript
interface Repository<T> {
  /**
   * Restore entity from audit log
   * @param auditId - The audit log ID to restore from
   * @returns Restored entity
   * @throws Error if audit log not found or cannot restore
   */
  restoreFromAudit(auditId: number): Promise<T>
}

// Restore deleted entity
const deleteLogs = await userRepo.getTableAuditLogs({
  operation: 'DELETE'
})

if (deleteLogs.length > 0) {
  // Restore the most recently deleted user
  const restored = await userRepo.restoreFromAudit(deleteLogs[0].id)
  console.log('Restored user:', restored)
  // Entity is re-created with original values
}

// Revert an update
const updateLogs = await userRepo.getAuditHistory(userId)
const badUpdate = updateLogs.find(log =>
  log.operation === 'UPDATE' &&
  log.changed_at > '2025-01-15T10:00:00Z'
)

if (badUpdate) {
  const reverted = await userRepo.restoreFromAudit(badUpdate.id)
  console.log('Reverted to:', reverted)
  // Entity is updated with old_values
}

// Restoration rules:
// - DELETE logs: Re-creates entity using old_values
// - UPDATE logs: Updates entity with old_values (reverts change)
// - INSERT logs: Cannot restore (throws error)
```

## 🔄 Transaction Support

### Transaction-Aware Logging

**CRITICAL**: Audit logs respect ACID properties and are transaction-aware:

```typescript
// ✅ CORRECT: Audit logs are part of transaction
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx)  // Use transaction executor

  await repos.users.create({ email: 'test@example.com' })
  await repos.posts.create({ user_id: 1, title: 'First Post' })

  // If transaction rolls back, both operations AND their audit logs roll back
  throw new Error('Rollback everything')
})
// Result: No user, no post, no audit logs ✅

// ❌ INCORRECT: Using db instead of trx
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(db)  // Wrong! Using db, not trx

  await repos.users.create({ email: 'test@example.com' })

  throw new Error('Rollback')
})
// Result: User rolled back, but audit log persists ❌
```

### Complete Transaction Example

```typescript
import { Kysely } from 'kysely'
import { auditPlugin } from '@kysera/audit'
import { createORM, createRepositoryFactory } from '@kysera/repository'

// Setup
const db = new Kysely<Database>({ /* ... */ })
const audit = auditPlugin({ getUserId: () => currentUserId })
const orm = await createORM(db, [audit])

// Transaction with audit logging
async function transferFunds(fromId: number, toId: number, amount: number) {
  return await db.transaction().execute(async (trx) => {
    // Create repositories using transaction executor
    const accountRepo = orm.createRepository(() =>
      createRepositoryFactory(trx).create({
        tableName: 'accounts',
        mapRow: (row) => row as Account,
        schemas: { update: UpdateAccountSchema }
      })
    )

    // Deduct from source account
    const fromAccount = await accountRepo.findById(fromId)
    if (!fromAccount || fromAccount.balance < amount) {
      throw new Error('Insufficient funds')
    }
    await accountRepo.update(fromId, {
      balance: fromAccount.balance - amount
    })
    // Audit log: UPDATE with old/new balance

    // Add to destination account
    const toAccount = await accountRepo.findById(toId)
    if (!toAccount) {
      throw new Error('Destination account not found')
    }
    await accountRepo.update(toId, {
      balance: toAccount.balance + amount
    })
    // Audit log: UPDATE with old/new balance

    // If anything throws, both updates AND audit logs roll back
    return { success: true }
  })
}

// Successful transaction
await transferFunds(1, 2, 100)
// ✅ Both accounts updated
// ✅ Both audit logs committed

// Failed transaction
try {
  await transferFunds(1, 2, 999999)  // Insufficient funds
} catch (error) {
  // ✅ No accounts updated
  // ✅ No audit logs created
}
```

### Rollback Behavior

```typescript
// Example: Rollback with audit logs
async function createUserWithPosts() {
  try {
    await db.transaction().execute(async (trx) => {
      const userRepo = orm.createRepository(() =>
        createRepositoryFactory(trx).create({
          tableName: 'users',
          mapRow: (row) => row as User,
          schemas: { create: CreateUserSchema }
        })
      )

      const postRepo = orm.createRepository(() =>
        createRepositoryFactory(trx).create({
          tableName: 'posts',
          mapRow: (row) => row as Post,
          schemas: { create: CreatePostSchema }
        })
      )

      // Create user
      const user = await userRepo.create({
        email: 'test@example.com',
        name: 'Test User'
      })
      // Audit log created (in transaction)

      // Create posts
      for (let i = 0; i < 5; i++) {
        await postRepo.create({
          user_id: user.id,
          title: `Post ${i}`,
          content: 'Test content'
        })
        // Audit logs created (in transaction)
      }

      // Simulate error
      if (Math.random() > 0.5) {
        throw new Error('Random failure')
      }

      return user
    })
  } catch (error) {
    console.log('Transaction rolled back')
    // All operations rolled back:
    // - User not created
    // - Posts not created
    // - Audit logs not created
  }
}

// Verify rollback
const auditLogs = await db
  .selectFrom('audit_logs')
  .selectAll()
  .where('changed_by', '=', currentUserId)
  .execute()

console.log(auditLogs.length)  // 0 if rolled back, 6 if committed
```

## 🚀 Bulk Operations

### Optimized Performance

Bulk operations use optimized single-query fetching to avoid N+1 problems:

```typescript
// Old approach (N+1 queries):
// - Fetch entity 1
// - Fetch entity 2
// - ...
// - Fetch entity N
// Total: N queries

// New approach (optimized):
// - Fetch all entities in single query: WHERE id IN (1, 2, ..., N)
// Total: 1 query

// Performance comparison (100 records):
// - Sequential: ~1000ms (100 queries × 10ms)
// - Optimized: ~10ms (1 query)
// - Improvement: 100x faster ⚡
```

### bulkCreate()

```typescript
// Create multiple records with audit logging
const users = await userRepo.bulkCreate([
  { email: 'user1@example.com', name: 'User 1' },
  { email: 'user2@example.com', name: 'User 2' },
  { email: 'user3@example.com', name: 'User 3' },
  // ... 100 more users
])

// Result:
// - 103 users created
// - 103 audit logs (INSERT operations)
// - All new_values captured
// - Single transaction
```

### bulkUpdate()

```typescript
// Update multiple records with audit logging
const updates = users.map(user => ({
  id: user.id,
  data: { status: 'active' }
}))

await userRepo.bulkUpdate(updates)

// Optimization:
// 1. Fetch old values in single query: SELECT * FROM users WHERE id IN (...)
// 2. Perform updates
// 3. Create audit logs with old/new values
//
// Performance:
// - Old approach: 100 SELECT + 100 UPDATE + 100 INSERT = 300 queries
// - New approach: 1 SELECT + 100 UPDATE + 100 INSERT = 201 queries
// - Improvement: 33% faster
```

### bulkDelete()

```typescript
// Delete multiple records with audit logging
const idsToDelete = [1, 2, 3, 4, 5]

await userRepo.bulkDelete(idsToDelete)

// Optimization:
// 1. Fetch old values in single query: SELECT * FROM users WHERE id IN (1,2,3,4,5)
// 2. Delete all records: DELETE FROM users WHERE id IN (1,2,3,4,5)
// 3. Create audit logs with old_values
//
// Performance:
// - Old approach: 5 SELECT + 5 DELETE + 5 INSERT = 15 queries
// - New approach: 1 SELECT + 1 DELETE + 5 INSERT = 7 queries
// - Improvement: 2x faster
```

### Performance Benchmarks

```typescript
// Benchmark: bulkUpdate with 100 records
const startTime = Date.now()

await userRepo.bulkUpdate(
  Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    data: { status: 'updated' }
  }))
)

const elapsed = Date.now() - startTime
console.log(`Completed in ${elapsed}ms`)
// Typical result: 50-100ms (with audit logging)

// Benchmark: bulkDelete with 100 records
const startTime = Date.now()

await userRepo.bulkDelete(
  Array.from({ length: 100 }, (_, i) => i + 1)
)

const elapsed = Date.now() - startTime
console.log(`Completed in ${elapsed}ms`)
// Typical result: 40-80ms (with audit logging)

// Performance characteristics:
// - Linear scaling: O(n) where n = number of records
// - Minimal overhead: <10% compared to non-audited operations
// - Transaction safety: All operations atomic
```

## 🗃️ Multi-Database Support

### PostgreSQL

```typescript
import { auditPluginPostgreSQL } from '@kysera/audit'

const audit = auditPluginPostgreSQL({
  getUserId: () => currentUser?.id || null,
  captureOldValues: true,
  captureNewValues: true
})

const orm = await createORM(db, [audit])

// PostgreSQL-specific features:
// - JSONB columns for efficient storage (future)
// - Native TIMESTAMP type
// - Full transaction support
// - RETURNING clause support
```

#### PostgreSQL Schema

```sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(255) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  operation VARCHAR(50) NOT NULL,
  old_values TEXT,                    -- Future: JSONB
  new_values TEXT,                    -- Future: JSONB
  changed_by VARCHAR(255),
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT                       -- Future: JSONB
);

-- Recommended indexes
CREATE INDEX idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_operation ON audit_logs(operation);
CREATE INDEX idx_audit_logs_changed_by ON audit_logs(changed_by);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at DESC);

-- Optional: Composite indexes for common queries
CREATE INDEX idx_audit_logs_table_entity
  ON audit_logs(table_name, entity_id);

CREATE INDEX idx_audit_logs_operation_date
  ON audit_logs(operation, changed_at DESC);
```

### MySQL

```typescript
import { auditPluginMySQL } from '@kysera/audit'

const audit = auditPluginMySQL({
  getUserId: () => currentUser?.id || null,
  captureOldValues: true,
  captureNewValues: true
})

const orm = await createORM(db, [audit])

// MySQL-specific features:
// - JSON columns for structured data (future)
// - DATETIME type with proper formatting
// - InnoDB transaction support
// - Optimized for large-scale auditing
```

#### MySQL Schema

```sql
CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(255) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  operation VARCHAR(50) NOT NULL,
  old_values TEXT,                    -- Future: JSON
  new_values TEXT,                    -- Future: JSON
  changed_by VARCHAR(255),
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT,                      -- Future: JSON
  INDEX idx_audit_logs_table_name (table_name),
  INDEX idx_audit_logs_entity_id (entity_id),
  INDEX idx_audit_logs_operation (operation),
  INDEX idx_audit_logs_changed_by (changed_by),
  INDEX idx_audit_logs_changed_at (changed_at),
  INDEX idx_audit_logs_table_entity (table_name, entity_id),
  INDEX idx_audit_logs_operation_date (operation, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### SQLite

```typescript
import { auditPluginSQLite } from '@kysera/audit'

const audit = auditPluginSQLite({
  getUserId: () => currentUser?.id || null,
  captureOldValues: true,
  captureNewValues: true
})

const orm = await createORM(db, [audit])

// SQLite-specific features:
// - TEXT storage for JSON
// - ISO8601 string timestamps
// - Full ACID transaction support
// - Perfect for testing and development
```

#### SQLite Schema

```sql
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

-- Indexes
CREATE INDEX idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_operation ON audit_logs(operation);
CREATE INDEX idx_audit_logs_changed_by ON audit_logs(changed_by);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at);
CREATE INDEX idx_audit_logs_table_entity ON audit_logs(table_name, entity_id);
```

## 🔧 Advanced Usage

### Custom Timestamps

```typescript
// Use custom timestamp format
const audit = auditPlugin({
  getTimestamp: () => {
    // Unix timestamp
    return Math.floor(Date.now() / 1000).toString()
  }
})

// Or use specific timezone
const audit = auditPlugin({
  getTimestamp: () => {
    return new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York'
    })
  }
})

// Or use UTC explicitly
const audit = auditPlugin({
  getTimestamp: () => {
    return new Date().toISOString()
  }
})
```

### Selective Value Capture

```typescript
// Minimize storage by capturing only new values
const audit = auditPlugin({
  captureOldValues: false,   // Don't capture old values
  captureNewValues: true     // Only capture new values
})

// Useful for:
// - Insert-only tables
// - High-volume logging
// - Storage optimization

// Or capture only old values (for compliance)
const audit = auditPlugin({
  captureOldValues: true,    // Capture what was there
  captureNewValues: false    // Don't capture new values
})

// Useful for:
// - Compliance requirements (prove what existed)
// - Deletion tracking
// - Before-state logging
```

### System Operations

```typescript
// Skip auditing for system operations
const audit = auditPlugin({
  skipSystemOperations: true,
  getUserId: () => currentUser?.id || null
})

// Usage in migrations
async function runMigration() {
  currentUser = null  // No user for system operations

  await userRepo.bulkCreate([
    /* ... seed data ... */
  ])

  // No audit logs created because:
  // 1. skipSystemOperations = true
  // 2. currentUser = null
}

// Regular operations still audited
currentUser = { id: 'user-123' }
await userRepo.create({ email: 'test@example.com' })
// Audit log created ✅
```

### Multiple Tables with Different Configs

```typescript
// Different audit configs for different tables
const userAudit = auditPlugin({
  tables: ['users'],
  captureOldValues: true,
  captureNewValues: true,
  metadata: () => ({ sensitive: true })
})

const logAudit = auditPlugin({
  tables: ['activity_logs'],
  captureOldValues: false,
  captureNewValues: true,
  metadata: () => ({ sensitive: false })
})

// Apply both plugins
const orm = await createORM(db, [userAudit, logAudit])

// Result:
// - users: Full audit with old/new values
// - activity_logs: Only new values captured
// - Other tables: Not audited
```

### Conditional Auditing

```typescript
// Conditional auditing based on environment
const audit = auditPlugin({
  skipSystemOperations: process.env.NODE_ENV === 'development',
  captureOldValues: process.env.AUDIT_LEVEL === 'full',
  captureNewValues: true,

  getUserId: () => {
    if (process.env.NODE_ENV === 'test') {
      return 'test-user'
    }
    return currentUser?.id || null
  },

  metadata: () => {
    const meta: Record<string, unknown> = {
      environment: process.env.NODE_ENV
    }

    if (process.env.NODE_ENV === 'production') {
      meta.ip = request.ip
      meta.userAgent = request.headers['user-agent']
    }

    return meta
  }
})
```

## ⚡ Performance

### Performance Characteristics

```typescript
// Performance metrics (approximate, based on benchmarks)

// Single operations:
// - INSERT: +2-5ms overhead
// - UPDATE: +5-10ms overhead (fetches old values)
// - DELETE: +5-10ms overhead (fetches old values)

// Bulk operations (100 records):
// - bulkCreate: +20-30ms overhead
// - bulkUpdate: +50-80ms overhead (optimized fetch)
// - bulkDelete: +40-60ms overhead (optimized fetch)

// Query operations:
// - getAuditHistory: 5-20ms (with indexes)
// - getTableAuditLogs: 10-50ms (depends on filters)
// - getUserChanges: 10-50ms (depends on volume)
```

### Optimization Tips

```typescript
// 1. Use table filtering to audit only what you need
const audit = auditPlugin({
  tables: ['users', 'orders', 'payments']  // Critical tables only
})

// 2. Disable value capture for high-volume tables
const audit = auditPlugin({
  tables: ['activity_logs'],
  captureOldValues: false,
  captureNewValues: false  // Only log that operation happened
})

// 3. Create proper indexes
// - table_name + entity_id (most common query)
// - operation + changed_at (for filtering)
// - changed_by (for user tracking)

// 4. Archive old audit logs periodically
async function archiveOldAuditLogs() {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  // Move to archive table
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('audit_logs_archive')
      .columns([...])
      .from(
        trx
          .selectFrom('audit_logs')
          .selectAll()
          .where('changed_at', '<', threeMonthsAgo.toISOString())
      )
      .execute()

    await trx
      .deleteFrom('audit_logs')
      .where('changed_at', '<', threeMonthsAgo.toISOString())
      .execute()
  })
}

// 5. Use connection pooling for high-volume scenarios
const pool = new Pool({
  max: 20,  // Increase pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
})
```

### Storage Considerations

```typescript
// Estimate storage requirements:

// Single audit log entry:
// - Row metadata: ~100 bytes
// - old_values: ~500-2000 bytes (depends on entity size)
// - new_values: ~500-2000 bytes
// - metadata: ~100-500 bytes
// Total: ~1-5 KB per entry

// Example: 1000 operations/day × 365 days = 365,000 entries
// Storage: 365,000 × 2 KB = 730 MB/year

// Optimization strategies:
// 1. Compress old audit logs
// 2. Archive to separate storage
// 3. Capture only essential fields
// 4. Set retention policies
```

## 🔒 Type Safety

### Fully Typed Audit Logs

```typescript
import type { ParsedAuditLogEntry } from '@kysera/audit'

// Type-safe audit queries
interface User {
  id: number
  email: string
  name: string
  role: string
}

const history: ParsedAuditLogEntry[] = await userRepo.getAuditHistory(123)

// Type-safe access
history.forEach(entry => {
  console.log(entry.operation)        // 'INSERT' | 'UPDATE' | 'DELETE'
  console.log(entry.changed_by)       // string | null
  console.log(entry.changed_at)       // Date | string

  if (entry.old_values) {
    // Type: Record<string, unknown>
    const oldUser = entry.old_values as User
    console.log(oldUser.email)
  }

  if (entry.new_values) {
    // Type: Record<string, unknown>
    const newUser = entry.new_values as User
    console.log(newUser.email)
  }
})
```

### Repository Type Extensions

```typescript
import type { Repository } from '@kysera/repository'

// Audit methods are automatically added to repositories
interface AuditRepository<T> extends Repository<T> {
  // Audit query methods
  getAuditHistory(entityId: number | string): Promise<ParsedAuditLogEntry[]>
  getAuditLog(auditId: number): Promise<AuditLogEntry | null>
  getTableAuditLogs(filters?: {
    operation?: string
    userId?: string
    startDate?: Date | string
    endDate?: Date | string
  }): Promise<ParsedAuditLogEntry[]>
  getUserChanges(userId: string): Promise<ParsedAuditLogEntry[]>

  // Restoration method
  restoreFromAudit(auditId: number): Promise<T>

  // Alias
  getAuditLogs(entityId: number | string): Promise<ParsedAuditLogEntry[]>
}

// Usage with full type safety
const userRepo: AuditRepository<User> = orm.createRepository(...)

const history: ParsedAuditLogEntry[] = await userRepo.getAuditHistory(123)
const restored: User = await userRepo.restoreFromAudit(42)
```

## 📖 API Reference

### Plugin Functions

```typescript
/**
 * Generic audit plugin (works with all databases)
 */
export function auditPlugin(options?: AuditOptions): Plugin

/**
 * PostgreSQL-specific audit plugin
 */
export function auditPluginPostgreSQL(options?: AuditOptions): Plugin

/**
 * MySQL-specific audit plugin
 */
export function auditPluginMySQL(options?: AuditOptions): Plugin

/**
 * SQLite-specific audit plugin
 */
export function auditPluginSQLite(options?: AuditOptions): Plugin
```

### Types

```typescript
export interface AuditOptions {
  auditTable?: string
  captureOldValues?: boolean
  captureNewValues?: boolean
  skipSystemOperations?: boolean
  tables?: string[]
  excludeTables?: string[]
  getUserId?: () => string | null
  getTimestamp?: () => Date | string
  metadata?: () => Record<string, unknown>
}

export interface AuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: string
  old_values: string | null
  new_values: string | null
  changed_by: string | null
  changed_at: string
  metadata: string | null
}

export interface ParsedAuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  changed_by: string | null
  changed_at: Date | string
  metadata: Record<string, unknown> | null
}

export type AuditTimestamp = Date | string
```

### Extended Repository Methods

All repositories extended with audit plugin gain these methods:

```typescript
interface AuditRepositoryExtensions<T> {
  getAuditHistory(entityId: number | string): Promise<ParsedAuditLogEntry[]>
  getAuditLogs(entityId: number | string): Promise<ParsedAuditLogEntry[]>
  getAuditLog(auditId: number): Promise<AuditLogEntry | null>
  getTableAuditLogs(filters?: AuditFilters): Promise<ParsedAuditLogEntry[]>
  getUserChanges(userId: string): Promise<ParsedAuditLogEntry[]>
  restoreFromAudit(auditId: number): Promise<T>
}

interface AuditFilters {
  operation?: string
  userId?: string
  startDate?: Date | string
  endDate?: Date | string
}
```

## ✅ Best Practices

### 1. Always Use Transaction Executor

```typescript
// ✅ CORRECT
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx)  // Pass transaction
  await repos.users.create(...)
})

// ❌ INCORRECT
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(db)   // Wrong executor!
  await repos.users.create(...)
})
```

### 2. Create Indexes for Performance

```sql
-- Essential indexes
CREATE INDEX idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);

-- Composite index for most common query
CREATE INDEX idx_audit_logs_table_entity
  ON audit_logs(table_name, entity_id);
```

### 3. Set Up Retention Policies

```typescript
// Archive old logs periodically
async function maintainAuditLogs() {
  const retentionDays = 90
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

  await db.transaction().execute(async (trx) => {
    // Archive to separate table
    await trx
      .insertInto('audit_logs_archive')
      .from(
        trx
          .selectFrom('audit_logs')
          .selectAll()
          .where('changed_at', '<', cutoffDate.toISOString())
      )
      .execute()

    // Delete archived logs
    await trx
      .deleteFrom('audit_logs')
      .where('changed_at', '<', cutoffDate.toISOString())
      .execute()
  })
}

// Run monthly
setInterval(maintainAuditLogs, 30 * 24 * 60 * 60 * 1000)
```

### 4. Use Table Filtering

```typescript
// Only audit critical tables
const audit = auditPlugin({
  tables: ['users', 'orders', 'payments', 'accounts']
})

// Or exclude high-volume non-critical tables
const audit = auditPlugin({
  excludeTables: ['sessions', 'cache', 'temp_data', 'logs']
})
```

### 5. Add Business Context in Metadata

```typescript
const audit = auditPlugin({
  metadata: () => ({
    // Technical context
    ip: request.ip,
    userAgent: request.headers['user-agent'],

    // Business context
    reason: currentOperation.reason,
    department: currentUser.department,
    approvalId: currentOperation.approvalId,

    // Audit trail
    requestId: generateRequestId(),
    sessionId: currentSession.id
  })
})
```

### 6. Handle Sensitive Data

```typescript
// Don't log sensitive fields
const audit = auditPlugin({
  captureOldValues: true,
  captureNewValues: true
})

// In your repository, implement custom mapRow to exclude sensitive fields
const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => {
    // Remove sensitive fields before they reach audit logs
    const { password, ssn, creditCard, ...safeData } = row
    return safeData as User
  },
  schemas: { /* ... */ }
})
```

### 7. Monitor Audit Log Growth

```typescript
// Periodic monitoring
async function checkAuditLogSize() {
  const stats = await db
    .selectFrom('audit_logs')
    .select([
      db.fn.count('id').as('total_logs'),
      db.fn
        .count('id')
        .filterWhere('changed_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .as('logs_today')
    ])
    .executeTakeFirst()

  console.log('Audit log stats:', stats)

  // Alert if growth is too fast
  if (Number(stats?.logs_today) > 100000) {
    console.warn('High audit log growth detected!')
  }
}
```

## 🐛 Troubleshooting

### Audit Logs Not Created

**Problem**: Operations succeed but no audit logs appear

**Solutions**:
```typescript
// 1. Check table filtering
const audit = auditPlugin({
  tables: ['users']  // Make sure your table is included
})

// 2. Check if skipSystemOperations is blocking
const audit = auditPlugin({
  skipSystemOperations: false  // Don't skip unless needed
})

// 3. Verify audit_logs table exists
const tableExists = await db.schema
  .hasTable('audit_logs')
  .execute()
console.log('Audit table exists:', tableExists)

// 4. Check repository is using audit plugin
// Make sure you're using orm.createRepository(), not plain factory
const userRepo = orm.createRepository(...)  // ✅ Has audit
const userRepo = factory.create(...)         // ❌ No audit
```

### Transaction Rollback Issues

**Problem**: Audit logs persist even when transaction rolls back

**Solution**:
```typescript
// ❌ WRONG: Using db instead of trx
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(db)  // Wrong!
  await repos.users.create(...)
})

// ✅ CORRECT: Use transaction executor
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx)  // Correct!
  await repos.users.create(...)
})
```

### Old Values Not Captured

**Problem**: UPDATE/DELETE logs show null for old_values

**Solutions**:
```typescript
// 1. Enable old value capture
const audit = auditPlugin({
  captureOldValues: true  // Must be true
})

// 2. Check entity exists before operation
const user = await userRepo.findById(123)
if (!user) {
  throw new Error('User not found')
}
await userRepo.update(123, { name: 'New Name' })

// 3. Verify permissions on table
// Make sure your database user can SELECT from the table
```

### Slow Performance

**Problem**: Operations take too long with audit logging

**Solutions**:
```typescript
// 1. Create indexes
CREATE INDEX idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);

// 2. Audit only critical tables
const audit = auditPlugin({
  tables: ['users', 'orders']  // Limit scope
})

// 3. Disable value capture for high-volume tables
const audit = auditPlugin({
  tables: ['activity_logs'],
  captureOldValues: false,
  captureNewValues: false
})

// 4. Archive old logs
// Move logs older than 3 months to archive table
```

### JSON Parse Errors

**Problem**: JSON.parse() fails when reading audit logs

**Solution**:
```typescript
// Use parsed entries instead of raw entries
const history: ParsedAuditLogEntry[] = await userRepo.getAuditHistory(123)
// old_values and new_values are already parsed ✅

// If using raw query:
const logs = await db.selectFrom('audit_logs').selectAll().execute()
logs.forEach(log => {
  try {
    const oldValues = log.old_values ? JSON.parse(log.old_values) : null
    const newValues = log.new_values ? JSON.parse(log.new_values) : null
    // Use oldValues and newValues
  } catch (error) {
    console.error('Failed to parse audit log:', log.id, error)
  }
})
```

### Memory Issues with Bulk Operations

**Problem**: Out of memory when processing large batches

**Solution**:
```typescript
// Process in smaller batches
async function bulkUpdateInBatches(updates: Update[], batchSize = 100) {
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize)
    await userRepo.bulkUpdate(batch)

    // Optional: Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

// Usage
await bulkUpdateInBatches(largeUpdateArray, 50)
```

## 📄 License

MIT © [Omnitron Dev](https://github.com/omnitron-dev)

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](../../CONTRIBUTING.md) for details.

## 📚 Related Packages

- [`@kysera/core`](../core) - Core utilities and error handling
- [`@kysera/repository`](../repository) - Repository pattern implementation
- [`@kysera/soft-delete`](../soft-delete) - Soft delete plugin
- [`@kysera/timestamps`](../timestamps) - Automatic timestamp management

## 🔗 Links

- [Documentation](https://kysera.dev/docs/audit)
- [GitHub Repository](https://github.com/omnitron-dev/kysera)
- [Issue Tracker](https://github.com/omnitron-dev/kysera/issues)
- [Changelog](./CHANGELOG.md)

---

**Built with ❤️ using TypeScript and Kysely**
