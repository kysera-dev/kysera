---
sidebar_position: 11
title: '@kysera/rls'
description: Row-Level Security plugin API reference
---

# @kysera/rls

Row-Level Security plugin for Kysera - Implement declarative authorization policies for multi-tenant applications with automatic query transformation.

## Installation

```bash
npm install @kysera/rls
```

## Overview

| Metric                | Value                                                  |
| --------------------- | ------------------------------------------------------ |
| **Bundle Size**       | ~10 KB (minified)                                      |
| **Dependencies**      | @kysera/core (workspace)                               |
| **Peer Dependencies** | kysely >=0.29.0, @kysera/executor (**required**), @kysera/repository (optional), zod ^4.3.6 (optional) |

## Exports

```typescript
// Main plugin
export { rlsPlugin } from './plugin'

// Schema definition
export { defineRLSSchema, mergeRLSSchemas } from './policy/schema'

// Policy builders
export { allow, deny, filter, validate } from './policy/builder'

// Context management
export { rlsContext, createRLSContext, withRLSContext, withRLSContextAsync } from './context'

// Errors
export { RLSError, RLSPolicyViolation, RLSPolicyEvaluationError, RLSContextError } from './errors'

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
   * Whitelist: apply RLS only to these tables
   * Takes precedence over excludeTables
   */
  tables?: string[]

  /**
   * Tables to exclude from RLS entirely (global bypass)
   */
  excludeTables?: string[]

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
   * @default true (changed in v0.8.0 for secure-by-default)
   */
  requireContext?: boolean

  /**
   * Allow queries without filtering when context is missing
   * Only applies when requireContext is false
   * @default false
   */
  allowUnfilteredQueries?: boolean

  /**
   * Log policy decisions for debugging
   * @default false
   */
  auditDecisions?: boolean

  /**
   * Custom handler for policy violations
   */
  onViolation?: (violation: RLSPolicyViolation) => void

  /**
   * Primary key column name for row lookups
   * Used when fetching existing rows for update/delete policy checks
   * @default 'id'
   */
  primaryKeyColumn?: string
}
```

### Configuration Examples

```typescript
import { rlsPlugin, defineRLSSchema, filter, allow } from '@kysera/rls'

// Basic multi-tenant setup
const plugin = rlsPlugin({
  schema: defineRLSSchema({
    users: {
      policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))]
    }
  })
})

// Full setup with bypass rules
const plugin = rlsPlugin({
  schema: rlsSchema,
  excludeTables: ['migrations', 'system_config'],
  bypassRoles: ['superadmin'],
  requireContext: true,
  auditDecisions: true,
  onViolation: violation => {
    logger.warn('RLS violation', violation)
  }
})
```

## Schema Definition

### defineRLSSchema

Define RLS policies for your tables.

```typescript
function defineRLSSchema<DB>(schema: RLSSchema<DB>): RLSSchema<DB>
```

Table keys are type-constrained to the tables of `DB`. The schema is validated at definition time — every listed table must provide `policies` as an **array**, otherwise `RLSSchemaError` is thrown.

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
      allow('update', ctx => ctx.auth.userId === ctx.row?.id)
    ],
    defaultDeny: true
  },

  posts: {
    policies: [
      // Tenant isolation
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),

      // Authors can modify their posts
      allow(
        ['update', 'delete'],
        ctx => ctx.auth.userId === ctx.row?.author_id || ctx.auth.roles?.includes('admin')
      )
    ]
  },

  audit_logs: {
    policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))],
    skipFor: ['admin', 'superuser'], // Admins see all
    defaultDeny: true
  },

  // Full access while staying listed: no filters, no default deny.
  // (`public_content: {}` throws RLSSchemaError — policies must be an array;
  // `policies: []` alone still denies mutations because defaultDeny defaults
  // to true. Alternatively, omit the table or use excludeTables.)
  public_content: { policies: [], defaultDeny: false }
})
```

### mergeRLSSchemas

Combine multiple schemas into one.

```typescript
function mergeRLSSchemas<DB>(...schemas: RLSSchema<DB>[]): RLSSchema<DB>
```

**Example:**

```typescript
const tenantSchema = defineRLSSchema({
  /* tenant policies */
})
const roleSchema = defineRLSSchema({
  /* role-based policies */
})
const customSchema = defineRLSSchema({
  /* custom policies */
})

const fullSchema = mergeRLSSchemas(tenantSchema, roleSchema, customSchema)
```

## Policy Builders

All four builders accept an optional final `options?: PolicyOptions` argument and return a `ConditionalPolicyDefinition`:

```typescript
interface PolicyOptions {
  name?: string // Policy name for debugging and audit logs
  priority?: number // Higher runs first (deny defaults to 100, others to 0)
  hints?: PolicyHints // Performance optimization hints
  condition?: PolicyActivationCondition // Activation gate — see Conditional Policy Activation
}
```

### allow

Grant permission based on a condition.

```typescript
function allow(
  operation: Operation | Operation[],
  condition: PolicyCondition, // (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
  options?: PolicyOptions
): ConditionalPolicyDefinition
```

**Operations:** `'read'`, `'create'`, `'update'`, `'delete'`, `'all'`, or an array of operations

**Examples:**

```typescript
// Authors can update their own posts
allow('update', ctx => ctx.auth.userId === ctx.row?.author_id)

// Admins can do anything
allow(['read', 'create', 'update', 'delete'], ctx => ctx.auth.roles?.includes('admin'))

// Members can read
allow('read', ctx => ctx.auth.roles?.includes('member'))
```

### deny

Explicitly deny access based on a condition.

```typescript
function deny(
  operation: Operation | Operation[],
  condition?: PolicyCondition, // optional — omitting it means "always deny"
  options?: PolicyOptions
): ConditionalPolicyDefinition
```

Deny policies default to priority `100`, so they run before allow policies. `deny('all')` with no condition unconditionally blocks the operations.

**Examples:**

```typescript
// Never allow deleting system users
deny('delete', ctx => ctx.row?.is_system === true)

// Guests cannot modify
deny(['create', 'update', 'delete'], ctx => ctx.auth.roles?.includes('guest'))
```

### filter

Add WHERE conditions to queries automatically. Filter predicates apply to SELECT queries **and to the row scope of UPDATE and DELETE statements** — the policy registry ignores the declared operation when collecting filters, so any filter policy also narrows which rows a mutation can touch.

:::warning Synchronous Only
**Filter conditions must be synchronous functions.** Async filter policies are not currently supported and will result in runtime errors. Use `allow()` or `validate()` for policies that require async operations.
:::

```typescript
function filter(
  operation: 'read' | 'all', // 'all' normalizes to 'read'
  condition: FilterCondition, // (ctx: PolicyEvaluationContext) => Record<string, unknown>
  options?: PolicyOptions
): ConditionalPolicyDefinition
```

**Condition values:** plain values compile to `=`, `null` to `IS NULL`, arrays to `IN (...)` (an empty array yields an impossible condition — no rows), and `undefined` values are skipped.

**Examples:**

```typescript
// Tenant isolation - all queries filtered by tenant_id
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))

// Status-based filtering
filter('read', ctx =>
  ctx.auth.roles?.includes('admin')
    ? {} // No filter for admins
    : { status: 'active', visibility: 'public' }
)

// Multi-org support — pass the array directly; there is no $in operator
filter('read', ctx => ({
  organization_id: ctx.auth.organizationIds ?? []
}))
```

### validate

Validate input data before operations.

```typescript
function validate(
  operation: 'create' | 'update' | 'all', // 'all' expands to both create and update
  condition: PolicyCondition,
  options?: PolicyOptions
): ConditionalPolicyDefinition
```

**Examples:**

```typescript
// Users can only create posts for themselves
validate('create', ctx => ctx.data?.author_id === ctx.auth.userId)

// Users can only update within their tenant
validate(
  'update',
  ctx => ctx.data?.tenant_id === undefined || ctx.data?.tenant_id === ctx.auth.tenantId
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
   * Auto-set to new Date() when omitted
   */
  timestamp?: Date
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
        permissions: user.permissions
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
async function withRLSContextAsync<T>(context: RLSContext, fn: () => Promise<T>): Promise<T>
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

### createRLSContext

Build and validate a context object without entering a scope.

```typescript
function createRLSContext<TUser = unknown, TMeta = unknown>(
  options: CreateRLSContextOptions<TUser, TMeta>
): RLSContext<TUser, TMeta>

interface CreateRLSContextOptions<TUser = unknown, TMeta = unknown> {
  auth: RLSAuthContext<TUser>
  request?: Partial<RLSRequestContext>
  meta?: TMeta
}
```

Validates the auth context (throws `RLSContextValidationError` on invalid input), defaults `isSystem` to `false`, and sets `timestamp` automatically.

### System Context (Bypass)

```typescript
// System operations bypass all policies
await rlsContext.runAsync(
  {
    auth: {
      userId: 'system',
      roles: [],
      isSystem: true // Bypass all RLS
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
interface PolicyEvaluationContext<TAuth = unknown, TRow = unknown, TData = unknown, TDB = unknown> {
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
   * Current operation (e.g. 'create', 'update', 'delete')
   */
  operation?: string
}
```

## Policy Precedence

At initialization the schema is compiled into a `PolicyRegistry` (also exported for advanced use), which groups each table's policies into allows, denies, filters, and validates. Policies are evaluated differently based on the operation type.

**For SELECT queries (via `interceptQuery`):**
- **`filter`** policies add WHERE conditions to the query builder

**For UPDATE/DELETE statements (via `interceptQuery`, v0.9+):**
- **`filter`** predicates are appended to the statement's WHERE clause, narrowing which rows the mutation can touch

**For mutations (create/update/delete via `extendRepository`):**

1. **`deny`** policies - evaluated first; if ANY deny condition returns `true`, access is denied
2. **`validate`** policies - evaluated next (create/update only); ALL must return `true`
3. **`allow`** policies - evaluated last; at least ONE must return `true`
4. **`defaultDeny`** - if `true` and no allow policies exist, access is denied

```typescript
const rlsSchema = defineRLSSchema({
  posts: {
    policies: [
      // 1. Deny evaluated first (takes precedence)
      deny('delete', ctx => ctx.row?.is_pinned === true),

      // 2. Validate evaluated next (for create/update)
      validate('create', ctx => ctx.data?.author_id === ctx.auth.userId),

      // 3. Allow evaluated last (at least one must match)
      allow(['update', 'delete'], ctx => ctx.auth.userId === ctx.row?.author_id),

      // Filter adds WHERE to SELECT and narrows UPDATE/DELETE row scope
      // (not part of the value-level mutation evaluation above)
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
    ],
    defaultDeny: true // 4. Deny if no allow policies match
  }
})
```

## Bypass Options

### Global Bypass

Applied at plugin initialization, affects all tables:

```typescript
rlsPlugin({
  schema: rlsSchema,
  excludeTables: ['migrations', 'system_config'], // Exclude these tables
  bypassRoles: ['superadmin'] // These roles bypass all
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

// Base error class — extends DatabaseError from @kysera/core,
// so `instanceof DatabaseError` also catches all RLS errors
class RLSError extends DatabaseError {
  constructor(message: string, code: RLSErrorCode)
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

// Missing context — default message:
// "No RLS context found. Ensure code runs within withRLSContext()"
class RLSContextError extends RLSError {
  constructor(message?: string)
}
```

Also exported: `RLSSchemaError` (invalid schema definition, carries `details`) and `RLSContextValidationError` (invalid context, carries `field`).

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
      operation: error.operation, // 'delete'
      table: error.table, // 'posts'
      reason: error.reason, // 'User does not own this post'
      policyName: error.policyName // 'ownership_policy'
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
  return ctx.row.someField.value
})

// When this policy runs:
try {
  await postRepo.findAll()
} catch (error) {
  if (error instanceof RLSPolicyEvaluationError) {
    // This indicates a bug in the policy, not user permissions
    logger.error('Policy bug detected:', {
      operation: error.operation, // 'read'
      table: error.table, // 'posts'
      policyName: error.policyName, // 'read_policy'
      originalError: error.originalError // TypeError: Cannot read property 'value' of undefined
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
  return ctx.row.someField.value // Can throw
})

// After (safe):
allow('read', ctx => {
  return ctx.row?.someField?.value ?? false // Safe navigation
})
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
  onViolation: violation => {
    // RLSPolicyViolation carries operation/table/reason/policyName only —
    // read the user from rlsContext if you need it
    logger.warn('RLS violation', {
      table: violation.table,
      operation: violation.operation,
      reason: violation.reason,
      policyName: violation.policyName,
      userId: rlsContext.getContextOrNull()?.auth.userId
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
5. For UPDATE/DELETE statements, filter predicates are appended to the WHERE clause in `interceptQuery` (v0.9), so mutations can only touch rows the context is allowed to see
6. Value-level mutation policies (`allow`/`deny`/`validate`) remain Repository-only, applied in `extendRepository`
7. **Works with both Repository and DAL patterns** via unified Plugin interface

### Query Interception

```typescript
// Plugin implementation (simplified)
interceptQuery(qb, context) {
  const rlsCtx = rlsContext.getContextOrNull()

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
- `insertInto` → Context available; value-level policy checks run in `extendRepository` (Repository only)
- `updateTable` → Filter predicates appended to WHERE in `interceptQuery` (v0.9); value-level allow/validate policies remain Repository-only
- `deleteFrom` → Filter predicates appended to WHERE in `interceptQuery` (v0.9); value-level allow/validate policies remain Repository-only

### DAL Mutations

Because filter predicates are applied in `interceptQuery`, UPDATE and DELETE
statements built through the DAL (or raw executor queries) are automatically
narrowed to the rows the current context may see. Value-level policies
(`allow`, `deny`, `validate`) still run only through repositories.

:::warning INSERT via DAL is not policy-checked
An INSERT statement has no WHERE clause for RLS to narrow, and builder-level
interception cannot see the values passed later to `.values()`. Route inserts
through repositories (where `allow`/`validate`/`deny` policies run), or add
database-native RLS as a backstop.
:::

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
      validate('create', ctx => ctx.data?.tenant_id === ctx.auth.tenantId)
    ]
  },
  posts: {
    policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))]
  }
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
// Pass the array directly — it compiles to an IN (...) clause;
// an empty array yields an impossible condition (no rows match)
filter('read', ctx => ({
  organization_id: ctx.auth.organizationIds ?? []
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
  return await repo.findAll() // No RLS filtering
})

// Check if current user can perform operation
const post = await repo.findById(1)
const canUpdate = await repo.canAccess('update', post)
if (canUpdate) {
  await repo.update(1, { title: 'New title' })
}
```

## Usage with DAL Pattern

RLS filtering now works with DAL pattern via executor interception.

```typescript
import { createQuery, createContext, withTransaction } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { rlsPlugin, defineRLSSchema, filter, rlsContext } from '@kysera/rls'

// Define schema
const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))]
  }
})

// Create executor with RLS plugin
const executor = await createExecutor(db, [rlsPlugin({ schema: rlsSchema })])

// Define DAL queries
const getAllPosts = createQuery(ctx => ctx.db.selectFrom('posts').selectAll().execute())

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
    const posts = await getAllPosts(createContext(executor))

    // Works in transactions too
    await withTransaction(executor, async txCtx => {
      const post = await getPostById(txCtx, 1)
      // RLS filtering still active in transaction
    })
  }
)
```

**Note**: DAL pattern supports **filter policies only** — they filter SELECT queries and also narrow the row scope of UPDATE/DELETE statements. Validation policies (`allow`, `deny`, `validate`) only work with Repository pattern since they require repository method interception.

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
    .select(eb => [eb.fn.count('id').as('total'), eb.fn.avg('views').as('avgViews')])
    .where('author_id', '=', userId)
    .executeTakeFirst()
)

await rlsContext.runAsync(
  {
    auth: { userId: 1, tenantId: 'acme', roles: ['user'] },
    timestamp: new Date()
  },
  async () => {
    await orm.transaction(async ctx => {
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

For maximum security, combine application-level RLS with PostgreSQL native RLS. You don't need to hand-write `CREATE POLICY` SQL — the [`@kysera/rls/native` subpath](#native-postgresql-rls-kyserarlsnative) generates the statements from your schema and syncs the RLS context to `current_setting()` values:

```typescript
import { RLSMigrationGenerator, syncContextToPostgres } from '@kysera/rls/native'

const migrationSql = new RLSMigrationGenerator().generateMigration(rlsSchema)

// Per request/transaction, before running queries:
await syncContextToPostgres(trx, { userId: user.id, tenantId: user.tenantId })
```

## TypeScript Types

### Full Type Definitions

```typescript
type Operation = 'read' | 'create' | 'update' | 'delete' | 'all'

type PolicyType = 'allow' | 'deny' | 'filter' | 'validate'

// ONE shared interface for all policy types — there are no per-type interfaces
interface PolicyDefinition<
  TOperation extends Operation = Operation,
  TCondition = PolicyCondition
> {
  type: PolicyType
  operation: TOperation | TOperation[]
  condition: TCondition // boolean-returning for allow/deny/validate; conditions object for filter
  name?: string
  priority?: number // Higher runs first (default 0; deny defaults to 100)
  using?: string // Native RLS only: SQL for the USING clause
  withCheck?: string // Native RLS only: SQL for the WITH CHECK clause
  role?: string // Native RLS only: target database role
  hints?: PolicyHints // Performance hints (e.g. indexColumns)
}

// What the policy builders actually return
interface ConditionalPolicyDefinition extends PolicyDefinition {
  activationCondition?: PolicyActivationCondition
}
```

## Context Resolvers

Pre-fetch and cache async data before policy evaluation.

### ResolverManager

```typescript
class ResolverManager<TResolved extends ResolvedData = ResolvedData> {
  constructor(options?: ResolverManagerOptions)

  // Register/unregister resolvers
  register<T extends ResolvedData>(resolver: ContextResolver<T>): void
  unregister(name: string): boolean
  hasResolver(name: string): boolean
  getResolverNames(): string[]

  // Resolve context
  resolve(baseContext: BaseResolverContext): Promise<EnhancedRLSContext<unknown, TResolved>>
  resolveOne<T>(name: string, baseContext: BaseResolverContext): Promise<T | null>

  // Cache management
  invalidateCache(userId: string | number, resolverName?: string): Promise<void>
  clearCache(): Promise<void>
}
```

### createResolver

```typescript
function createResolver<TResolved extends ResolvedData>(
  config: ContextResolver<TResolved>
): ContextResolver<TResolved>

interface ContextResolver<TResolved = ResolvedData> {
  name: string
  resolve: (ctx: BaseResolverContext) => Promise<TResolved>
  cacheKey?: (ctx: BaseResolverContext) => string | undefined // undefined disables caching
  cacheTtl?: number
  dependsOn?: string[]
  required?: boolean
  priority?: number
}
```

### ResolverManagerOptions

```typescript
interface ResolverManagerOptions {
  cacheProvider?: ResolverCacheProvider
  defaultCacheTtl?: number // Default: 300
  parallelResolution?: boolean // Default: true
  resolverTimeout?: number // Default: 5000ms
  logger?: KyseraLogger
}
```

## Field-Level Access Control

### FieldAccessRegistry

```typescript
class FieldAccessRegistry<DB = unknown> {
  constructor(schema?: FieldAccessSchema<DB>, options?: { logger?: KyseraLogger })

  loadSchema(schema: FieldAccessSchema<DB>): void
  registerTable(table: string, config: TableFieldAccessConfig): void

  // Both async; conditions take the standard PolicyEvaluationContext
  // (there is no separate FieldAccessContext type)
  canReadField(table: string, field: string, ctx: PolicyEvaluationContext): Promise<boolean>
  canWriteField(table: string, field: string, ctx: PolicyEvaluationContext): Promise<boolean>

  getFieldConfig(table: string, field: string): CompiledFieldAccess | undefined
  getTableConfig(table: string): CompiledTableFieldAccess | undefined
  getConfiguredFields(table: string): string[]

  hasTable(table: string): boolean
  getTables(): string[]
  clear(): void
}
```

### FieldAccessProcessor

```typescript
class FieldAccessProcessor<DB = unknown> {
  constructor(registry: FieldAccessRegistry<DB>, defaultMaskValue?: unknown) // default: null

  // The RLS context comes from AsyncLocalStorage (rlsContext), never as a parameter —
  // call these inside rlsContext.runAsync(...)
  maskRow<T extends Record<string, unknown>>(
    table: string,
    row: T,
    options?: FieldAccessOptions
  ): Promise<MaskedRow<T>>

  maskRows<T extends Record<string, unknown>>(
    table: string,
    rows: T[],
    options?: FieldAccessOptions
  ): Promise<MaskedRow<T>[]>

  // Throws RLSPolicyViolation if any field in data is not writable
  validateWrite(
    table: string,
    data: Record<string, unknown>,
    existingRow?: Record<string, unknown>
  ): Promise<void>

  // Strips unwritable fields instead of throwing
  filterWritableFields(
    table: string,
    data: Record<string, unknown>,
    existingRow?: Record<string, unknown>
  ): Promise<{ data: Record<string, unknown>; removedFields: string[] }>

  getReadableFields(table: string, row: Record<string, unknown>): Promise<string[]>
  getWritableFields(table: string, row: Record<string, unknown>): Promise<string[]>
}

interface MaskedRow<T = Record<string, unknown>> {
  data: Partial<T> // Row with field access applied
  maskedFields: string[]
  omittedFields: string[]
}

interface FieldAccessOptions {
  throwOnDenied?: boolean // Default: false
  includeMetadata?: boolean // Default: false
  includeFields?: string[] // Whitelist
  excludeFields?: string[] // Blacklist
}
```

### Predefined Access Patterns

```typescript
type FieldAccessCondition = (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>

// Only row owner can read/write (compares ctx.auth.userId to row[ownerField])
function ownerOnly(ownerField?: string): FieldAccessConfig // ownerField default: 'id'

// Only specified roles can access
function rolesOnly(roles: string[]): FieldAccessConfig

// Readable (optionally gated by a condition), never writable
function readOnly(readCondition?: FieldAccessCondition): FieldAccessConfig

// Never readable or writable; field omitted from results
function neverAccessible(): FieldAccessConfig

// Anyone reads, the condition gates writes
function publicReadRestrictedWrite(writeCondition: FieldAccessCondition): FieldAccessConfig

// Applies maskFn(value) unless the read condition passes
function maskedField(
  maskFn: (value: unknown) => unknown,
  readCondition: FieldAccessCondition
): FieldAccessConfig & { maskFn: (value: unknown) => unknown }

// Owner or specified roles
function ownerOrRoles(roles: string[], ownerField?: string): FieldAccessConfig
```

## ReBAC (Relationship-Based Access Control)

### ReBAcRegistry

```typescript
class ReBAcRegistry<DB = unknown> {
  constructor(schema?: ReBAcSchema<DB>, options?: { logger?: KyseraLogger })

  loadSchema(schema: ReBAcSchema<DB>): void
  registerTable(table: string, config: TableReBAcConfig): void
  registerRelationship(path: RelationshipPath): void

  getPolicies(table: string, operation: Operation): CompiledReBAcPolicy[]
  getRelationship(name: string, table?: string): CompiledRelationshipPath | undefined

  hasTable(table: string): boolean
  getTables(): string[]
  clear(): void
}
```

### ReBAcTransformer

```typescript
class ReBAcTransformer<DB = unknown> {
  constructor(registry: ReBAcRegistry<DB>, options?: ReBAcQueryOptions)

  // Applies every matching relationship policy as an EXISTS / NOT EXISTS
  // condition. Reads the RLS context from AsyncLocalStorage; returns the
  // query unchanged when there is no context or the caller is a system user.
  transform<TB extends keyof DB & string, O>(
    qb: SelectQueryBuilder<DB, TB, O>,
    table: string,
    operation?: Operation // default: 'read'
  ): SelectQueryBuilder<DB, TB, O>

  // Raw SQL for one policy's EXISTS condition (debugging / manual assembly)
  generateExistsSql(
    policy: CompiledReBAcPolicy,
    ctx: RLSContext,
    mainTable: string,
    mainTableAlias?: string
  ): { sql: string; params: unknown[] }
}

interface ReBAcQueryOptions {
  qualifyColumns?: boolean // Default: true
  dialect?: 'postgres' | 'mysql' | 'sqlite' // Default: 'postgres'
  mainTableAlias?: string
}
```

### Predefined Relationship Paths

```typescript
// table -> organizations -> org_members
function orgMembershipPath(
  resourceTable: string,
  orgIdColumn?: string
): RelationshipPath

// table -> shops -> organizations -> org_members
function shopOrgMembershipPath(
  resourceTable: string,
  shopIdColumn?: string
): RelationshipPath

// table -> teams (recursive) -> team_members
function teamHierarchyPath(
  resourceTable: string,
  teamIdColumn?: string
): RelationshipPath
```

### Policy Builders

```typescript
// The end condition is a plain object or a context function —
// there is no dedicated end-condition type
function allowRelation(
  operation: Operation | Operation[],
  relationshipPath: string,
  endCondition: ((ctx: PolicyEvaluationContext) => Record<string, unknown>) | Record<string, unknown>,
  options?: { name?: string; priority?: number }
): ReBAcPolicyDefinition

// Same signature; generates NOT EXISTS and defaults to priority 100
function denyRelation(
  operation: Operation | Operation[],
  relationshipPath: string,
  endCondition: ((ctx: PolicyEvaluationContext) => Record<string, unknown>) | Record<string, unknown>,
  options?: { name?: string; priority?: number }
): ReBAcPolicyDefinition
```

## Policy Composition

### Predefined Policy Templates

```typescript
function createTenantIsolationPolicy(config?: TenantIsolationConfig): ReusablePolicy
function createOwnershipPolicy(config?: OwnershipConfig): ReusablePolicy
function createSoftDeletePolicy(config?: SoftDeleteConfig): ReusablePolicy
function createStatusAccessPolicy(config: StatusAccessConfig): ReusablePolicy
function createAdminPolicy(roles: string[]): ReusablePolicy
```

### Configuration Types

```typescript
interface TenantIsolationConfig {
  tenantColumn?: string // Default: 'tenant_id'
  operations?: Operation[] // Default: ['read', 'create', 'update', 'delete']
  validateOnMutation?: boolean // Default: true — validates create sets the caller's
                               // tenant and update doesn't change it
}

interface OwnershipConfig {
  ownerColumn?: string // Default: 'owner_id'
  ownerOperations?: Operation[] // Default: ['read', 'update', 'delete']
  canDelete?: boolean // Default: true — false adds an explicit delete deny
}

interface SoftDeleteConfig {
  deletedColumn?: string // Default: 'deleted_at'
  filterOnRead?: boolean // Default: true — filters rows where deletedColumn is not null
  preventHardDelete?: boolean // Default: true — denies delete operations
}

interface StatusAccessConfig {
  statusColumn?: string // Default: 'status'
  publicStatuses?: string[] // Statuses that are publicly readable
  editableStatuses?: string[] // Statuses that can be updated
  deletableStatuses?: string[] // Statuses that can be deleted
}
```

### Composition Functions

```typescript
// Concatenates the policies of several templates under a new name
function composePolicies(name: string, policies: ReusablePolicy[]): ReusablePolicy

// Appends policy definitions to a template (name becomes `${base.name}_extended`)
function extendPolicy(base: ReusablePolicy, additional: PolicyDefinition[]): ReusablePolicy

// Replaces a template's policies by their `name` (name becomes `${base.name}_overridden`)
function overridePolicy(
  base: ReusablePolicy,
  overrides: Record<string, PolicyDefinition>
): ReusablePolicy
```

### Policy Definition Builders

```typescript
// Wrap raw policy definitions into a named ReusablePolicy
function definePolicy(
  config: { name: string; description?: string; tags?: string[] },
  policies: PolicyDefinition[]
): ReusablePolicy

function defineFilterPolicy(
  name: string,
  filterFn: (ctx: PolicyEvaluationContext) => Record<string, unknown>,
  options?: { priority?: number }
): ReusablePolicy

function defineAllowPolicy(
  name: string,
  operation: Operation | Operation[],
  condition: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>,
  options?: { priority?: number }
): ReusablePolicy

function defineDenyPolicy(
  name: string,
  operation: Operation | Operation[],
  condition?: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>, // omit = always deny
  options?: { priority?: number }
): ReusablePolicy

function defineValidatePolicy(
  name: string,
  operation: 'create' | 'update' | 'all',
  condition: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>,
  options?: { priority?: number }
): ReusablePolicy

// Several policy types in one call — allow/deny take operation-keyed
// condition maps; validate takes { create?, update? }
function defineCombinedPolicy(
  name: string,
  config: {
    filter?: (ctx: PolicyEvaluationContext) => Record<string, unknown>
    allow?: Record<string, (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>>
    deny?: Record<string, (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>>
    validate?: {
      create?: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
      update?: (ctx: PolicyEvaluationContext) => boolean | Promise<boolean>
    }
  }
): ReusablePolicy
```

## Audit Trail

### AuditLogger

```typescript
class AuditLogger {
  constructor(config: AuditConfig)

  // Log decisions — per-call options are inline object types
  // (there is no AuditLogOptions type)
  logDecision(
    operation: Operation,
    table: string,
    decision: AuditDecision,
    policyName?: string,
    options?: {
      reason?: string
      rowIds?: (string | number)[]
      queryHash?: string
      durationMs?: number
      context?: Record<string, unknown>
    }
  ): Promise<void>

  logAllow(
    operation: Operation,
    table: string,
    policyName?: string,
    options?: { reason?: string; rowIds?: (string | number)[]; context?: Record<string, unknown> }
  ): Promise<void>
  logDeny(
    operation: Operation,
    table: string,
    policyName?: string,
    options?: { reason?: string; rowIds?: (string | number)[]; context?: Record<string, unknown> }
  ): Promise<void>
  logFilter(table: string, policyName?: string, options?: { context?: Record<string, unknown> }): Promise<void>

  // Buffer management
  flush(): Promise<void>
  close(): Promise<void>

  // Properties
  get bufferSize(): number
  get enabled(): boolean
  setEnabled(enabled: boolean): void
}
```

### AuditConfig

```typescript
interface AuditConfig {
  adapter: RLSAuditAdapter
  enabled?: boolean // Default: true
  bufferSize?: number // Default: 100
  flushInterval?: number // Default: 5000ms
  async?: boolean // Default: true
  sampleRate?: number // Default: 1.0

  defaults?: {
    logAllowed?: boolean // Default: false
    logDenied?: boolean // Default: true
    logFilters?: boolean // Default: false
    includeContext?: string[]
    excludeContext?: string[]
  }

  tables?: Record<string, TableAuditConfig>
  onError?: (error: Error, events: RLSAuditEvent[]) => void
}
```

### Built-in Adapters

```typescript
class ConsoleAuditAdapter implements RLSAuditAdapter {
  constructor(options?: {
    format?: 'text' | 'json'
    colors?: boolean
    includeTimestamp?: boolean
  })
}

class InMemoryAuditAdapter implements RLSAuditAdapter {
  constructor(maxSize?: number)

  getEvents(): RLSAuditEvent[]
  query(params: AuditQueryParams): RLSAuditEvent[]
  getStats(params?: { startTime?: Date; endTime?: Date }): AuditStats
  clear(): void
  get size(): number
}
```

### RLSAuditEvent

```typescript
interface RLSAuditEvent {
  timestamp: Date
  userId: string | number
  tenantId?: string | number
  operation: Operation
  table: string
  policyName?: string
  decision: 'allow' | 'deny' | 'filter'
  reason?: string
  context?: Record<string, unknown>
  rowIds?: (string | number)[]
  queryHash?: string
  requestId?: string
  ipAddress?: string
  userAgent?: string
  durationMs?: number
}
```

## Policy Testing

### PolicyTester

```typescript
class PolicyTester<DB = unknown> {
  constructor(schema: RLSSchema<DB>)

  // Evaluate full policy chain
  evaluate(
    table: string,
    operation: Operation,
    context: TestContext
  ): Promise<PolicyEvaluationResult>

  // Get filter conditions
  getFilters(
    table: string,
    operation: 'read',
    context: Pick<TestContext, 'auth' | 'meta'>
  ): FilterEvaluationResult

  // Test specific policy
  testPolicy(
    table: string,
    policyName: string,
    context: TestContext
  ): Promise<{ found: boolean; result?: boolean }>

  // Introspection
  listPolicies(table: string): {
    allows: string[]
    denies: string[]
    filters: string[]
    validates: string[]
  }

  getTables(): string[]
}
```

### Result Types

```typescript
interface PolicyEvaluationResult {
  allowed: boolean
  policyName?: string
  decisionType: 'allow' | 'deny' | 'default'
  reason?: string
  evaluatedPolicies: {
    name: string
    type: 'allow' | 'deny' | 'validate'
    result: boolean
  }[]
}

interface FilterEvaluationResult {
  conditions: Record<string, unknown>
  appliedFilters: string[]
}
```

### Test Helpers

```typescript
function createTestAuthContext(
  overrides: Partial<RLSAuthContext> & { userId: string | number }
): RLSAuthContext

function createTestRow<T extends Record<string, unknown>>(data: T): T

const policyAssertions: {
  assertAllowed(result: PolicyEvaluationResult, message?: string): void
  assertDenied(result: PolicyEvaluationResult, message?: string): void
  assertPolicyUsed(result: PolicyEvaluationResult, policyName: string, message?: string): void
  assertFiltersInclude(result: FilterEvaluationResult, expected: Record<string, unknown>, message?: string): void
}
```

## Conditional Policy Activation

### Activation Wrappers

```typescript
// Takes an ARRAY of environment names
function whenEnvironment(
  environments: string[],
  policyFn: () => ConditionalPolicyDefinition
): ConditionalPolicyDefinition

function whenFeature(
  feature: string,
  policyFn: () => ConditionalPolicyDefinition
): ConditionalPolicyDefinition

// Start hour inclusive, end hour exclusive; supports overnight ranges (e.g. 22 → 6)
function whenTimeRange(
  startHour: number,
  endHour: number,
  policyFn: () => ConditionalPolicyDefinition
): ConditionalPolicyDefinition

function whenCondition(
  condition: PolicyActivationCondition, // (ctx: PolicyActivationContext) => boolean
  policyFn: () => ConditionalPolicyDefinition
): ConditionalPolicyDefinition
```

Each wrapper sets the policy's `activationCondition` — the same field the policy builders accept via `options.condition`. Note that `rlsPlugin()` does not evaluate activation conditions during query interception; filter your policy list yourself (e.g. at startup) with `policy.activationCondition?.(activationCtx) ?? true`.

### PolicyActivationContext

```typescript
// Standalone type — does NOT extend PolicyEvaluationContext
interface PolicyActivationContext {
  environment?: string
  features?: Set<string> | string[] | Record<string, unknown>
  timestamp?: Date
  meta?: Record<string, unknown>
  auth?: { userId?: string; roles?: string[]; isSystem?: boolean; [key: string]: unknown }
}
```

## Native PostgreSQL RLS (`@kysera/rls/native`)

Generates database-native RLS from the same schema, for defense in depth or connections that bypass the executor.

```typescript
import {
  PostgresRLSGenerator,
  RLSMigrationGenerator,
  syncContextToPostgres,
  clearPostgresContext,
  type PostgresRLSOptions,
  type MigrationOptions
} from '@kysera/rls/native'

interface PostgresRLSOptions {
  force?: boolean // FORCE ROW LEVEL SECURITY (default: true)
  schemaName?: string // Default: 'public'
  policyPrefix?: string // Prefix for generated policy names (default: 'rls')
}

class PostgresRLSGenerator {
  // ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY + CREATE POLICY statements.
  // Only allow/deny policies that carry `using` / `withCheck` SQL are translated
  // (deny → AS RESTRICTIVE, `role` → TO clause); filter/validate stay application-side.
  generateStatements<DB>(schema: RLSSchema<DB>, options?: PostgresRLSOptions): string[]
  generateDropStatements<DB>(schema: RLSSchema<DB>, options?: PostgresRLSOptions): string[]
}

interface MigrationOptions extends PostgresRLSOptions {
  name?: string // Default: 'rls_policies'
  includeContextFunctions?: boolean // Default: true
}

class RLSMigrationGenerator {
  // Complete up/down migration script
  generateMigration<DB>(schema: RLSSchema<DB>, options?: MigrationOptions): string
}

// Sets app.user_id / app.tenant_id / app.roles / app.permissions / app.is_system
// via set_config(..., true) — transaction-scoped, readable with current_setting()
function syncContextToPostgres<DB>(
  db: Kysely<DB>,
  context: {
    userId: string | number
    tenantId?: string | number
    roles?: string[]
    permissions?: string[]
    isSystem?: boolean
  }
): Promise<void>

// Resets those settings
function clearPostgresContext<DB>(db: Kysely<DB>): Promise<void>
```

## Plugin Options Validation (`@kysera/rls/schema`)

Optional runtime validation of `RLSPluginOptions` (requires `zod`):

```typescript
import {
  RLSPluginOptionsSchema,
  type RLSPluginOptionsInput,
  type RLSPluginOptionsOutput
} from '@kysera/rls/schema'
```

## Complete Exports

```typescript
// Core
export { defineRLSSchema, mergeRLSSchemas } from '@kysera/rls'
export { allow, deny, filter, validate } from '@kysera/rls'
export { whenEnvironment, whenFeature, whenTimeRange, whenCondition } from '@kysera/rls'
export { rlsPlugin } from '@kysera/rls'
export { rlsContext, createRLSContext, withRLSContext, withRLSContextAsync } from '@kysera/rls'

// Context Resolvers
export { ResolverManager, createResolverManager, createResolver, InMemoryCacheProvider } from '@kysera/rls'

// ReBAC
export { ReBAcRegistry, ReBAcTransformer, createReBAcRegistry, createReBAcTransformer } from '@kysera/rls'
export { orgMembershipPath, shopOrgMembershipPath, teamHierarchyPath, allowRelation, denyRelation } from '@kysera/rls'

// Field Access
export { FieldAccessRegistry, FieldAccessProcessor, createFieldAccessRegistry, createFieldAccessProcessor } from '@kysera/rls'
export { ownerOnly, rolesOnly, readOnly, neverAccessible, publicReadRestrictedWrite, maskedField, ownerOrRoles } from '@kysera/rls'

// Policy registry (advanced — compiled schema, exported for tooling)
export { PolicyRegistry } from '@kysera/rls'

// Policy Composition
export { createTenantIsolationPolicy, createOwnershipPolicy, createSoftDeletePolicy, createStatusAccessPolicy, createAdminPolicy } from '@kysera/rls'
export { composePolicies, extendPolicy, overridePolicy } from '@kysera/rls'
export { definePolicy, defineFilterPolicy, defineAllowPolicy, defineDenyPolicy, defineValidatePolicy, defineCombinedPolicy } from '@kysera/rls'

// Audit Trail
export { AuditLogger, createAuditLogger, ConsoleAuditAdapter, InMemoryAuditAdapter } from '@kysera/rls'

// Testing
export { PolicyTester, createPolicyTester, createTestAuthContext, createTestRow, policyAssertions } from '@kysera/rls'

// Errors
export { RLSError, RLSContextError, RLSPolicyViolation, RLSPolicyEvaluationError, RLSSchemaError, RLSContextValidationError, RLSErrorCodes } from '@kysera/rls'

// Subpaths
export { PostgresRLSGenerator, RLSMigrationGenerator, syncContextToPostgres, clearPostgresContext } from '@kysera/rls/native'
export { RLSPluginOptionsSchema } from '@kysera/rls/schema'
```

Supporting types (`PolicyOptions`, `CreateRLSContextOptions`, `PolicyActivationContext`, resolver/audit/field-access/ReBAC types, ...) are re-exported from the package root — see the package's `index.ts` for the full type surface.

## See Also

- [RLS Plugin Guide](/docs/plugins/rls)
- [Executor API Reference](/docs/api/executor)
- [DAL API Reference](/docs/api/dal)
- [Repository API Reference](/docs/api/repository)
- [Audit Plugin API Reference](/docs/api/audit)
