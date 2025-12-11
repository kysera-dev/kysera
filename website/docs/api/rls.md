---
sidebar_position: 11
title: "@kysera/rls"
description: Row-Level Security plugin API reference
---

# @kysera/rls

Row-Level Security plugin for Kysera ORM - Implement declarative authorization policies for multi-tenant applications with automatic query transformation.

## Installation

```bash
npm install @kysera/rls
```

## Overview

| Metric | Value |
|--------|-------|
| **Version** | 0.7.0 |
| **Bundle Size** | ~10 KB (minified) |
| **Dependencies** | @kysera/core (workspace), @kysera/executor (workspace) |
| **Peer Dependencies** | kysely >=0.28.8 |

**New in v0.7**: RLS plugin now uses the unified `@kysera/executor` Plugin interface and works with both Repository and DAL patterns.

## Exports

```typescript
// Main plugin
export { rlsPlugin } from './plugin'

// Schema definition
export { defineRLSSchema, mergeRLSSchemas } from './policy/schema'

// Policy builders
export { allow, deny, filter, validate } from './policy/builder'

// Context management
export {
  rlsContext,
  createRLSContext,
  withRLSContext,
  withRLSContextAsync
} from './context'

// Errors
export {
  RLSError,
  RLSPolicyViolation,
  RLSPolicyEvaluationError,
  RLSContextError
} from './errors'

// Types
export type {
  RLSPluginOptions,
  RLSSchema,
  RLSAuthContext,
  RLSContext,
  TableRLSConfig,
  PolicyDefinition,
  PolicyEvaluationContext,
  RLSRequestContext
}
```

## rlsPlugin

Creates a Row-Level Security plugin instance.

```typescript
function rlsPlugin<DB = unknown>(options: RLSPluginOptions<DB>): Plugin
```

### RLSPluginOptions

```typescript
interface RLSPluginOptions<DB = unknown> {
  /**
   * RLS policy schema defining access rules per table
   */
  schema: RLSSchema<DB>

  /**
   * Tables to exclude from RLS entirely (global bypass)
   */
  skipTables?: string[]

  /**
   * Roles that bypass RLS for all tables (global bypass)
   */
  bypassRoles?: string[]

  /**
   * Logger for RLS operations
   */
  logger?: KyseraLogger

  /**
   * Require RLS context for all operations
   * Throws RLSContextError if context not set
   * @default false
   */
  requireContext?: boolean

  /**
   * Log policy decisions for debugging
   * @default false
   */
  auditDecisions?: boolean

  /**
   * Custom handler for policy violations
   */
  onViolation?: (violation: RLSPolicyViolation) => void
}
```

### Configuration Examples

```typescript
import { rlsPlugin, defineRLSSchema, filter, allow } from '@kysera/rls'

// Basic multi-tenant setup
const plugin = rlsPlugin({
  schema: defineRLSSchema({
    users: {
      policies: [
        filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
      ]
    }
  })
})

// Full setup with bypass rules
const plugin = rlsPlugin({
  schema: rlsSchema,
  skipTables: ['migrations', 'system_config'],
  bypassRoles: ['superadmin'],
  requireContext: true,
  auditDecisions: true,
  onViolation: (violation) => {
    logger.warn('RLS violation', violation)
  }
})
```

## Schema Definition

### defineRLSSchema

Define RLS policies for your tables.

```typescript
function defineRLSSchema<DB>(
  config: Record<string, TableRLSConfig>
): RLSSchema<DB>
```

### TableRLSConfig

```typescript
interface TableRLSConfig {
  /**
   * List of policies for this table
   */
  policies: PolicyDefinition[]

  /**
   * Deny access when no policy matches
   * @default true
   */
  defaultDeny?: boolean

  /**
   * Roles that bypass RLS for this table only
   */
  skipFor?: string[]
}
```

### Schema Example

```typescript
const rlsSchema = defineRLSSchema<Database>({
  users: {
    policies: [
      // Multi-tenant isolation
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),

      // Users can update their own profile
      allow('update', ctx => ctx.auth.userId === ctx.row?.id),
    ],
    defaultDeny: true,
  },

  posts: {
    policies: [
      // Tenant isolation
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),

      // Authors can modify their posts
      allow(['update', 'delete'], ctx =>
        ctx.auth.userId === ctx.row?.author_id ||
        ctx.auth.roles?.includes('admin')
      ),
    ],
  },

  audit_logs: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
    ],
    skipFor: ['admin', 'superuser'],  // Admins see all
    defaultDeny: true,
  },

  // No policies = full access
  public_content: {},
})
```

### mergeRLSSchemas

Combine multiple schemas into one.

```typescript
function mergeRLSSchemas<DB>(...schemas: RLSSchema<DB>[]): RLSSchema<DB>
```

**Example:**
```typescript
const tenantSchema = defineRLSSchema({ /* tenant policies */ })
const roleSchema = defineRLSSchema({ /* role-based policies */ })
const customSchema = defineRLSSchema({ /* custom policies */ })

const fullSchema = mergeRLSSchemas(tenantSchema, roleSchema, customSchema)
```

## Policy Builders

### allow

Grant permission based on a condition.

```typescript
function allow(
  operations: Operation | Operation[],
  condition: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
): PolicyDefinition
```

**Operations:** `'read'`, `'create'`, `'update'`, `'delete'`

**Examples:**
```typescript
// Authors can update their own posts
allow('update', ctx => ctx.auth.userId === ctx.row?.author_id)

// Admins can do anything
allow(['read', 'create', 'update', 'delete'], ctx =>
  ctx.auth.roles?.includes('admin')
)

// Members can read
allow('read', ctx => ctx.auth.roles?.includes('member'))
```

### deny

Explicitly deny access based on a condition.

```typescript
function deny(
  operations: Operation | Operation[],
  condition: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
): PolicyDefinition
```

**Examples:**
```typescript
// Never allow deleting system users
deny('delete', ctx => ctx.row?.is_system === true)

// Guests cannot modify
deny(['create', 'update', 'delete'], ctx =>
  ctx.auth.roles?.includes('guest')
)
```

### filter

Add WHERE conditions to queries automatically.

```typescript
function filter(
  operations: Operation | Operation[],
  getFilter: (ctx: PolicyEvaluationContext) => Record<string, unknown>
): PolicyDefinition
```

**Examples:**
```typescript
// Tenant isolation - all queries filtered by tenant_id
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))

// Status-based filtering
filter('read', ctx =>
  ctx.auth.roles?.includes('admin')
    ? {}  // No filter for admins
    : { status: 'active', visibility: 'public' }
)

// Multi-org support
filter('read', ctx => ({
  organization_id: { $in: ctx.auth.organizationIds }
}))
```

### validate

Validate input data before operations.

```typescript
function validate(
  operations: Operation | Operation[],
  validator: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
): PolicyDefinition
```

**Examples:**
```typescript
// Users can only create posts for themselves
validate('create', ctx =>
  ctx.data?.author_id === ctx.auth.userId
)

// Users can only update within their tenant
validate('update', ctx =>
  ctx.data?.tenant_id === undefined ||
  ctx.data?.tenant_id === ctx.auth.tenantId
)
```

## Context Management

### rlsContext

AsyncLocalStorage-based context manager for RLS authentication.

```typescript
const rlsContext: {
  // Set and run within context
  runAsync<T>(context: RLSContext, fn: () => Promise<T>): Promise<T>
  run<T>(context: RLSContext, fn: () => T): T

  // Get current context
  getContext(): RLSContext
  getContextOrNull(): RLSContext | null
  hasContext(): boolean

  // Context helpers
  getAuth(): RLSAuthContext
  getUserId(): string | number
  getTenantId(): string | number | undefined
  hasRole(role: string): boolean
  hasPermission(permission: string): boolean
  isSystem(): boolean

  // System context (bypass RLS)
  asSystem<T>(fn: () => T): T
  asSystemAsync<T>(fn: () => Promise<T>): Promise<T>
}
```

### RLSContext and RLSAuthContext

```typescript
interface RLSContext<TUser = unknown, TMeta = unknown> {
  /**
   * Authentication context (required)
   */
  auth: RLSAuthContext<TUser>

  /**
   * Request context (optional)
   */
  request?: RLSRequestContext

  /**
   * Custom metadata (optional)
   */
  meta?: TMeta

  /**
   * Context creation timestamp
   */
  timestamp: Date
}

interface RLSAuthContext<TUser = unknown> {
  /**
   * User ID - required
   */
  userId: string | number

  /**
   * User roles - required
   */
  roles: string[]

  /**
   * Tenant ID for multi-tenant apps
   */
  tenantId?: string | number

  /**
   * Organization IDs for multi-org scenarios
   */
  organizationIds?: (string | number)[]

  /**
   * Permission strings
   */
  permissions?: string[]

  /**
   * Custom user attributes
   */
  attributes?: Record<string, unknown>

  /**
   * Full user object if needed
   */
  user?: TUser

  /**
   * Bypass all policies
   * @default false
   */
  isSystem?: boolean
}

interface RLSRequestContext {
  requestId?: string
  ipAddress?: string
  userAgent?: string
  timestamp: Date
  headers?: Record<string, string>
}
```

### Setting Context

```typescript
import { rlsContext } from '@kysera/rls'

// Express middleware
app.use(async (req, res, next) => {
  const user = await authenticate(req)

  await rlsContext.runAsync(
    {
      auth: {
        userId: user.id,
        tenantId: user.tenantId,
        roles: user.roles,
        permissions: user.permissions,
      },
      request: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
        timestamp: new Date()
      },
      timestamp: new Date()
    },
    async () => {
      next()
    }
  )
})
```

### withRLSContext and withRLSContextAsync

Helper functions for wrapping operations.

```typescript
function withRLSContext<T>(context: RLSContext, fn: () => T): T
async function withRLSContextAsync<T>(
  context: RLSContext,
  fn: () => Promise<T>
): Promise<T>
```

**Example:**
```typescript
const result = await withRLSContextAsync(
  {
    auth: { userId: 1, roles: ['user'], tenantId: 'acme' },
    timestamp: new Date()
  },
  async () => {
    return await postRepo.findAll()
  }
)
```

### System Context (Bypass)

```typescript
// System operations bypass all policies
await rlsContext.runAsync(
  {
    auth: {
      userId: 'system',
      roles: [],
      isSystem: true  // Bypass all RLS
    },
    timestamp: new Date()
  },
  async () => {
    // Full access to all data
    const allPosts = await postRepo.findAll()
  }
)

// Or within existing context
await repo.withoutRLS(async () => {
  // Temporarily bypass RLS
  return await repo.findAll()
})
```

## Policy Evaluation Context

Context available when evaluating policies.

```typescript
interface PolicyEvaluationContext<
  TAuth = unknown,
  TRow = unknown,
  TData = unknown,
  TDB = unknown
> {
  /**
   * Authentication context
   */
  auth: RLSAuthContext<TAuth>

  /**
   * Current row data (for update/delete)
   */
  row?: TRow

  /**
   * Input data (for create/update)
   */
  data?: TData

  /**
   * Request context
   */
  request?: RLSRequestContext

  /**
   * Database instance for complex policies
   */
  db?: Kysely<TDB>

  /**
   * Custom metadata
   */
  meta?: Record<string, unknown>

  /**
   * Current table name
   */
  table?: string

  /**
   * Current operation
   */
  operation?: 'read' | 'create' | 'update' | 'delete'
}
```

## Policy Precedence

Policies are evaluated in this order:

1. **`deny`** policies - evaluated first, any match denies access
2. **`allow`** policies - evaluated next, any match grants access
3. **`filter`** policies - add WHERE conditions to queries
4. **`validate`** policies - check input data
5. **`defaultDeny`** - determines behavior when no policy matches

```typescript
const rlsSchema = defineRLSSchema({
  posts: {
    policies: [
      // 1. Deny takes precedence
      deny('delete', ctx => ctx.row?.is_pinned === true),

      // 2. Allow grants access
      allow(['update', 'delete'], ctx =>
        ctx.auth.userId === ctx.row?.author_id
      ),

      // 3. Filter adds WHERE conditions
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),

      // 4. Validate checks input
      validate('create', ctx => ctx.data?.author_id === ctx.auth.userId),
    ],
    defaultDeny: true,  // 5. Deny if nothing matches
  },
})
```

## Bypass Options

### Global Bypass

Applied at plugin initialization, affects all tables:

```typescript
rlsPlugin({
  schema: rlsSchema,
  skipTables: ['migrations', 'system_config'],  // Skip these tables
  bypassRoles: ['superadmin'],                  // These roles bypass all
})
```

### Table-Level Bypass

Applied per-table in schema definition:

```typescript
const rlsSchema = defineRLSSchema({
  users: {
    policies: [...],
    skipFor: ['hr_admin'],  // HR admins bypass RLS on users only
  },
  posts: {
    policies: [...],
    skipFor: ['content_admin'],  // Content admins bypass RLS on posts only
  },
})
```

## Error Handling

### Error Types

```typescript
import {
  RLSError,
  RLSPolicyViolation,
  RLSPolicyEvaluationError,
  RLSContextError
} from '@kysera/rls'

// Base error class
class RLSError extends Error {
  code: string
}

// Policy violation (legitimate access denial)
class RLSPolicyViolation extends RLSError {
  operation: string
  table: string
  reason: string
  policyName?: string
}

// Policy evaluation error (bug in policy code)
class RLSPolicyEvaluationError extends RLSError {
  operation: string
  table: string
  policyName?: string
  originalError?: Error
}

// Missing context
class RLSContextError extends RLSError {
  message: 'RLS context not set'
}
```

### RLSPolicyViolation

Thrown when access is legitimately denied by an RLS policy.

**Properties:**
- `operation` - The operation that was denied (read, create, update, delete)
- `table` - The table where the violation occurred
- `reason` - Human-readable reason for the denial
- `policyName` - Name of the policy that denied access (optional)
- `code` - Error code: `'RLS_POLICY_VIOLATION'`

**When to use:**
- User doesn't have permission for an operation
- Policy condition evaluated to `false` (access denied)
- Should result in HTTP 403 response

**Example:**
```typescript
try {
  await postRepo.delete(postId)
} catch (error) {
  if (error instanceof RLSPolicyViolation) {
    console.error('Access denied:', {
      operation: error.operation,    // 'delete'
      table: error.table,             // 'posts'
      reason: error.reason,           // 'User does not own this post'
      policyName: error.policyName    // 'ownership_policy'
    })
    res.status(403).json({ error: 'Permission denied' })
  }
}
```

### RLSPolicyEvaluationError

Thrown when a policy condition throws an error during evaluation. This is distinct from `RLSPolicyViolation` - it indicates a **bug in the policy code itself**, not a legitimate access denial.

**Properties:**
- `operation` - The operation being performed when the error occurred
- `table` - The table where the error occurred
- `policyName` - Name of the policy that threw (optional)
- `originalError` - The original error thrown by the policy (optional)
- `code` - Error code: `'RLS_POLICY_EVALUATION_ERROR'`
- `stack` - Combined stack trace including the original error's stack

**When thrown:**
- Policy condition throws an unexpected error
- Bug in policy code (e.g., accessing undefined property)
- Type errors in policy logic

**Why separate from RLSPolicyViolation:**
- Helps distinguish between "access denied" (expected) and "policy bug" (unexpected)
- Preserves original stack trace for debugging
- Indicates need to fix policy code, not user permissions

**Example:**
```typescript
// Policy with a bug
allow('read', ctx => {
  // Bug: someField might be undefined
  return ctx.row.someField.value;
});

// When this policy runs:
try {
  await postRepo.findAll()
} catch (error) {
  if (error instanceof RLSPolicyEvaluationError) {
    // This indicates a bug in the policy, not user permissions
    logger.error('Policy bug detected:', {
      operation: error.operation,        // 'read'
      table: error.table,                 // 'posts'
      policyName: error.policyName,       // 'read_policy'
      originalError: error.originalError  // TypeError: Cannot read property 'value' of undefined
    })

    // Full stack trace including original error
    console.error(error.stack)

    res.status(500).json({ error: 'Internal server error' })
  }
}
```

**Best practices:**
- Log these errors with full stack traces for debugging
- Return HTTP 500 (not 403) since this is a server error
- Fix the policy code to handle edge cases properly
- Add null checks and proper error handling in policies

**Example of fixing a policy:**
```typescript
// Before (buggy):
allow('read', ctx => {
  return ctx.row.someField.value;  // Can throw
});

// After (safe):
allow('read', ctx => {
  return ctx.row?.someField?.value ?? false;  // Safe navigation
});
```

### RLSContextError

Thrown when RLS context is missing but required for an operation.

**When thrown:**
- Operation executed outside of `rlsContext.runAsync()`
- `requireContext: true` is set in plugin options
- No authentication context available

**Example:**
```typescript
try {
  // Missing context
  await postRepo.findAll()
} catch (error) {
  if (error instanceof RLSContextError) {
    res.status(401).json({ error: 'Not authenticated' })
  }
}
```

### Handling Errors

```typescript
try {
  await postRepo.delete(postId)
} catch (error) {
  if (error instanceof RLSPolicyViolation) {
    // User doesn't have permission (legitimate access denial)
    res.status(403).json({
      error: 'Permission denied',
      table: error.table,
      operation: error.operation,
      reason: error.reason
    })
  }

  if (error instanceof RLSPolicyEvaluationError) {
    // Bug in policy code - should be investigated
    logger.error('Policy evaluation error:', {
      operation: error.operation,
      table: error.table,
      policyName: error.policyName,
      originalError: error.originalError,
      stack: error.stack
    })
    res.status(500).json({ error: 'Internal server error' })
  }

  if (error instanceof RLSContextError) {
    // No RLS context set
    res.status(401).json({ error: 'Not authenticated' })
  }
}
```

### Custom Violation Handler

```typescript
rlsPlugin({
  schema: rlsSchema,
  onViolation: (violation) => {
    logger.warn('RLS violation', {
      user: violation.userId,
      table: violation.table,
      operation: violation.operation,
      reason: violation.reason
    })

    // Send to monitoring
    monitoring.trackEvent('rls_violation', violation)
  }
})
```

## How RLS Works

The plugin implements row-level security at the **application layer** using **@kysera/executor** for query transformations:

```typescript
// Original query
const posts = await postRepo.findAll()

// With RLS filter policy
// SQL: SELECT * FROM posts WHERE tenant_id = $1

// Filter is automatically added based on context
```

### Architecture

1. **createORM** or **createExecutor** creates a plugin-aware executor
2. The executor wraps Kysely with a Proxy that intercepts query methods
3. RLS plugin's `interceptQuery` hook is called for every query operation
4. For SELECT queries, filter policies add WHERE conditions
5. For mutations (INSERT/UPDATE/DELETE), validation happens in `extendRepository`
6. **Works with both Repository and DAL patterns** via unified Plugin interface

### Query Interception

```typescript
// Plugin implementation (simplified)
interceptQuery(qb, context) {
  const rlsCtx = rlsContext.getStore()

  if (!rlsCtx && requireContext) {
    throw new RLSContextError()
  }

  // Check bypass rules
  if (rlsCtx?.auth.isSystem) {
    return qb  // No filtering
  }

  // Apply filter policies
  for (const policy of filterPolicies) {
    if (policy.operations.includes(context.operation)) {
      const filter = policy.getFilter({ auth: rlsCtx.auth, ...context })
      qb = qb.where(filter)
    }
  }

  return qb
}
```

**Intercepted operations:**
- `selectFrom` → Automatic filtering via `interceptQuery`
- `insertInto` → Context available, validation in `extendRepository`
- `updateTable` → Context available, validation in `extendRepository`
- `deleteFrom` → Context available, validation in `extendRepository`

### getRawDb() for Internal Queries

When implementing RLS policies that need to fetch existing rows (e.g., for update/delete validation), the plugin uses `getRawDb()` from `@kysera/executor` to bypass RLS filtering and prevent infinite recursion:

```typescript
import { getRawDb } from '@kysera/executor'

// Inside plugin's extendRepository
const rawDb = getRawDb(baseRepo.executor)

// Fetch existing row without RLS filtering
const existingRow = await rawDb
  .selectFrom(table)
  .selectAll()
  .where('id', '=', id)
  .executeTakeFirst()
```

This ensures that internal queries used for policy evaluation don't trigger RLS filtering themselves.

## Multi-Tenant Patterns

### Discriminator Column

```typescript
const tenantSchema = defineRLSSchema<Database>({
  users: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      validate('create', ctx => ctx.data?.tenant_id === ctx.auth.tenantId),
    ],
  },
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
    ],
  },
})
```

### Subdomain Extraction

```typescript
// Express middleware
app.use(async (req, res, next) => {
  const tenantId = extractTenantFromSubdomain(req.hostname)
  // 'acme.app.com' → 'acme'

  const user = await authenticate(req)

  await rlsContext.runAsync(
    {
      auth: {
        userId: user.id,
        tenantId,
        roles: user.roles
      },
      timestamp: new Date()
    },
    next
  )
})
```

### Multi-Organization

```typescript
filter('read', ctx => ({
  organization_id: { $in: ctx.auth.organizationIds }
}))
```

## Usage with Repository Pattern

```typescript
import { createORM, createRepositoryFactory } from '@kysera/repository'
import { rlsPlugin, defineRLSSchema, filter, allow, rlsContext } from '@kysera/rls'

const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow(['update', 'delete'], ctx =>
        ctx.auth.userId === ctx.row?.author_id
      ),
    ],
    defaultDeny: true,
  },
})

const orm = await createORM(db, [
  rlsPlugin({ schema: rlsSchema })
])

const postRepo = orm.createRepository((executor) => {
  const factory = createRepositoryFactory(executor)
  return factory.create({
    tableName: 'posts',
    mapRow: (row) => ({ ... }),
    schemas: { create: ... }
  })
})

// Use within RLS context
await rlsContext.runAsync(
  {
    auth: { userId: 1, tenantId: 'acme', roles: ['user'] },
    timestamp: new Date()
  },
  async () => {
    // Automatically filtered by tenant_id
    const posts = await postRepo.findAll()

    // Will throw RLSPolicyViolation if not author
    await postRepo.delete(postId)
  }
)
```

### Repository Extensions

RLS plugin adds these methods to repositories:

```typescript
// Bypass RLS for specific operation (requires existing context)
await repo.withoutRLS(async () => {
  return await repo.findAll()  // No RLS filtering
})

// Check if current user can perform operation
const post = await repo.findById(1)
const canUpdate = await repo.canAccess('update', post)
if (canUpdate) {
  await repo.update(1, { title: 'New title' })
}
```

## Usage with DAL Pattern

**New in v0.7**: RLS filtering now works with DAL pattern via executor interception.

```typescript
import { createQuery, createContext, withTransaction } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { rlsPlugin, defineRLSSchema, filter, rlsContext } from '@kysera/rls'

// Define schema
const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
    ],
  },
})

// Create executor with RLS plugin
const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema })
])

// Define DAL queries
const getAllPosts = createQuery((ctx) =>
  ctx.db.selectFrom('posts').selectAll().execute()
)

const getPostById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('posts').where('id', '=', id).executeTakeFirst()
)

// Use within RLS context
await rlsContext.runAsync(
  {
    auth: { userId: 1, tenantId: 'acme', roles: ['user'] },
    timestamp: new Date()
  },
  async () => {
    // RLS filter automatically applied
    const posts = await getAllPosts(executor)

    // Works in transactions too
    await withTransaction(executor, async (txCtx) => {
      const post = await getPostById(txCtx, 1)
      // RLS filtering still active in transaction
    })
  }
)
```

**Note**: DAL pattern supports **filter policies only**. Validation policies (`allow`, `deny`, `validate`) only work with Repository pattern since they require repository method interception.

## CQRS-lite Pattern (Repository + DAL)

Combine both patterns for writes and complex reads:

```typescript
import { createORM } from '@kysera/repository'
import { createQuery } from '@kysera/dal'
import { rlsPlugin, rlsContext } from '@kysera/rls'

const orm = await createORM(db, [rlsPlugin({ schema: rlsSchema })])

// Complex read query (DAL)
const getDashboardStats = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('posts')
    .select((eb) => [
      eb.fn.count('id').as('total'),
      eb.fn.avg('views').as('avgViews')
    ])
    .where('author_id', '=', userId)
    .executeTakeFirst()
)

await rlsContext.runAsync(
  {
    auth: { userId: 1, tenantId: 'acme', roles: ['user'] },
    timestamp: new Date()
  },
  async () => {
    await orm.transaction(async (ctx) => {
      // Repository for writes (with RLS validation)
      const userRepo = orm.createRepository(createUserRepository)
      const user = await userRepo.create({ name: 'Alice' })

      // DAL for complex reads (with RLS filtering)
      const stats = await getDashboardStats(ctx, user.id)
    })
  }
)
```

## Best Practices

### 1. Always Set Context

```typescript
app.use(async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  await rlsContext.runAsync(
    {
      auth: req.user,
      timestamp: new Date()
    },
    next
  )
})
```

### 2. Use System Context Sparingly

```typescript
// Only for background jobs, migrations, etc.
await rlsContext.runAsync(
  {
    auth: { userId: 'system', roles: [], isSystem: true },
    timestamp: new Date()
  },
  async () => {
    // Full access - use carefully!
  }
)
```

### 3. Test Policies

```typescript
describe('Post RLS Policies', () => {
  it('should filter by tenant', async () => {
    await rlsContext.runAsync(
      {
        auth: { userId: 1, tenantId: 'acme', roles: [] },
        timestamp: new Date()
      },
      async () => {
        const posts = await postRepo.findAll()
        expect(posts.every(p => p.tenant_id === 'acme')).toBe(true)
      }
    )
  })

  it('should deny cross-tenant access', async () => {
    await rlsContext.runAsync(
      {
        auth: { userId: 1, tenantId: 'other', roles: [] },
        timestamp: new Date()
      },
      async () => {
        const post = await postRepo.findById(acmePostId)
        expect(post).toBeNull()
      }
    )
  })
})
```

### 4. Combine with Database RLS

For maximum security, combine application-level RLS with PostgreSQL native RLS:

```sql
-- PostgreSQL native RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON posts
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::int);
```

```typescript
// Set PostgreSQL config before queries
await db.executeQuery(sql`SET app.tenant_id = ${tenantId}`)
```

## TypeScript Types

### Full Type Definitions

```typescript
type Operation = 'read' | 'create' | 'update' | 'delete' | 'all'

type PolicyDefinition =
  | AllowPolicy
  | DenyPolicy
  | FilterPolicy
  | ValidatePolicy

interface AllowPolicy {
  type: 'allow'
  operation: Operation | Operation[]
  condition: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
  name?: string
  priority?: number
}

interface DenyPolicy {
  type: 'deny'
  operation: Operation | Operation[]
  condition: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
  name?: string
  priority?: number
}

interface FilterPolicy {
  type: 'filter'
  operation: Operation | Operation[]
  condition: (ctx: PolicyEvaluationContext) => Record<string, unknown>
  name?: string
  priority?: number
}

interface ValidatePolicy {
  type: 'validate'
  operation: Operation | Operation[]
  condition: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
  name?: string
  priority?: number
}
```

## See Also

- [Executor API Reference](/docs/api/executor)
- [DAL API Reference](/docs/api/dal)
- [Repository API Reference](/docs/api/repository)
- [Audit Plugin API Reference](/docs/api/audit)
