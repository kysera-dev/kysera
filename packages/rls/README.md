# @kysera/rls

> **Row-Level Security Plugin for Kysera** - Declarative authorization policies with automatic query transformation through @kysera/executor's Unified Execution Layer and AsyncLocalStorage-based context management.

[![npm version](https://img.shields.io/npm/v/@kysera/rls.svg)](https://www.npmjs.com/package/@kysera/rls)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9%2B-blue)](https://www.typescriptlang.org/)

---

## Overview

`@kysera/rls` provides Row-Level Security (RLS) for Kysera through a declarative policy system. It automatically filters queries and enforces authorization rules at the database access layer, ensuring data isolation and access control without manual filtering in your application code.

### What is Row-Level Security?

RLS controls access to individual rows in database tables based on user context. Instead of manually adding WHERE clauses to every query, RLS policies are defined once and automatically applied to all database operations.

**Key Features:**

- **Declarative Policy DSL** - Define rules with `allow`, `deny`, `filter`, and `validate` builders
- **Automatic Query Transformation** - SELECT queries are filtered automatically via `interceptQuery` hook
- **Repository Extensions** - Wraps mutation methods via `extendRepository` hook for policy enforcement
- **Type-Safe Context** - Full TypeScript inference with reduced `any` usage through type utilities
- **Multi-Tenant Isolation** - Built-in patterns for SaaS tenant separation
- **Plugin Architecture** - Works with both Repository and DAL patterns via @kysera/executor's Unified Execution Layer
- **Zero Runtime Overhead** - Policies compiled at initialization
- **AsyncLocalStorage Context** - Request-scoped context without prop drilling
- **Optional Dependency** - Listed in peerDependencies with `optional: true` for @kysera/repository

---

## Installation

```bash
npm install @kysera/rls kysely
# or
pnpm add @kysera/rls kysely
# or
yarn add @kysera/rls kysely
```

**Dependencies:**

- `kysely` >= 0.28.8 (peer dependency)
- `@kysera/core` >= 0.7.0 - Core utilities (auto-installed)
- `@kysera/executor` >= 0.7.0 - Unified Execution Layer (auto-installed)
- `@kysera/repository` >= 0.7.0 or `@kysera/dal` >= 0.7.0 - For Repository or DAL patterns (install as needed)

**Note:** @kysera/rls is listed in peerDependencies with `optional: true` for @kysera/repository, allowing flexible installation based on your needs.

---

## Quick Start

### 1. Define RLS Schema

```typescript
import { defineRLSSchema, filter, allow, validate } from '@kysera/rls'

interface Database {
  posts: {
    id: number
    title: string
    content: string
    author_id: number
    tenant_id: number
    status: 'draft' | 'published'
  }
}

const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [
      // Multi-tenant isolation - filter by tenant
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),

      // Authors can edit their own posts
      allow(['update', 'delete'], ctx => ctx.auth.userId === ctx.row.author_id),

      // Validate new posts belong to user's tenant
      validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId)
    ],
    defaultDeny: true // Require explicit allow
  }
})
```

### 2. Register Plugin with Unified Execution Layer

```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { rlsPlugin, rlsContext } from '@kysera/rls'
import { Kysely, PostgresDialect } from 'kysely'

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    /* config */
  })
})

// Step 1: Create executor with RLS plugin
const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema })
])

// Step 2: Create ORM with plugin-enabled executor
const orm = await createORM(executor, [])
```

### 3. Execute Queries within RLS Context

```typescript
import { rlsContext } from '@kysera/rls'

// In your request handler
app.use(async (req, res, next) => {
  const user = await authenticate(req)

  await rlsContext.runAsync(
    {
      auth: {
        userId: user.id,
        tenantId: user.tenantId,
        roles: user.roles,
        isSystem: false
      },
      timestamp: new Date()
    },
    async () => {
      // All queries automatically filtered by policies
      const posts = await orm.posts.findAll()
      res.json(posts)
    }
  )
})
```

---

## Plugin Architecture

### Integration with @kysera/executor's Unified Execution Layer

The RLS plugin is built on @kysera/executor's Unified Execution Layer, which provides seamless plugin support that works with both Repository and DAL patterns.

**Plugin Metadata:**

```typescript
{
  name: '@kysera/rls',
  version: '0.8.0',
  priority: 50,  // Runs after soft-delete (0), before audit (100)
  dependencies: [],
}
```

**Type Utilities:**

The plugin uses type utilities to reduce `any` usage and improve type safety:
- Conditional types for precise type inference
- Generic constraints for database schemas
- Utility types for context and policy definitions

### How It Works

The RLS plugin implements two key hooks from @kysera/executor's plugin system:

#### 1. `interceptQuery` - Query Filtering (SELECT)

Registered via `createExecutor()`, the `interceptQuery` hook intercepts all query builder operations to apply RLS filtering:

```typescript
// Step 1: Register plugin with Unified Execution Layer
const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema })
])

// Step 2: Execute a SELECT query
const posts = await orm.posts.findAll()

// Step 3: The plugin interceptQuery hook:
// 1. Checks for RLS context (rlsContext.getContextOrNull())
// 2. Checks if system user (ctx.auth.isSystem) or bypass role
// 3. Applies filter policies as WHERE conditions via SelectTransformer
// 4. Returns filtered query builder
// 5. For mutations, marks metadata['__rlsRequired'] = true
```

**Key behavior:**

- SELECT operations: Policies are applied immediately as WHERE clauses
- INSERT/UPDATE/DELETE: Marked for validation (actual enforcement in `extendRepository`)
- Skip conditions: `excludeTables`, `metadata['skipRLS']`, `requireContext`, system user, bypass roles

#### 2. `extendRepository` - Mutation Enforcement (CREATE/UPDATE/DELETE)

Registered via `createExecutor()`, the `extendRepository` hook wraps repository mutation methods to enforce RLS policies:

```typescript
// Step 1: Plugin registered with Unified Execution Layer
const executor = await createExecutor(db, [rlsPlugin({ schema: rlsSchema })])

// Step 2: Call a mutation
await repo.update(postId, { title: 'New Title' })

// Step 3: The plugin extendRepository hook:
// 1. Wraps create/update/delete methods
// 2. Fetches existing row using getRawDb() (bypasses RLS filtering)
// 3. Evaluates allow/deny policies via MutationGuard
// 4. If allowed, calls original method
// 5. If denied, throws RLSPolicyViolation
// 6. Adds withoutRLS() and canAccess() utility methods
```

**Why use `getRawDb()`?** To prevent infinite recursion - we need to fetch the existing row without triggering RLS filtering. The `getRawDb()` function from @kysera/executor returns the original Kysely instance that bypasses all plugin hooks.

---

## Core Concepts

### Policy Types

#### 1. `allow` - Grant Access

Grants access when condition evaluates to `true`. Multiple allow policies use OR logic.

```typescript
// Allow users to read their own posts
allow('read', ctx => ctx.auth.userId === ctx.row.author_id)

// Allow admins all operations
allow('all', ctx => ctx.auth.roles.includes('admin'))

// Allow updates only for drafts
allow('update', ctx => ctx.row.status === 'draft')
```

#### 2. `deny` - Block Access

Blocks access when condition evaluates to `true`. Deny policies **override** allow policies.

```typescript
// Deny access to banned users
deny('all', ctx => ctx.auth.attributes?.banned === true)

// Prevent deletion of published posts
deny('delete', ctx => ctx.row.status === 'published')

// Unconditional deny
deny('all') // Always deny
```

#### 3. `filter` - Automatic Filtering

Adds WHERE conditions to SELECT queries automatically.

```typescript
// Filter by tenant
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))

// Dynamic filtering
filter('read', ctx =>
  ctx.auth.roles.includes('admin')
    ? {} // No filtering for admins
    : { status: 'published' }
)

// Multiple conditions
filter('read', ctx => ({
  organization_id: ctx.auth.organizationIds?.[0],
  deleted_at: null
}))
```

#### 4. `validate` - Mutation Validation

Validates data during CREATE/UPDATE operations.

```typescript
// Validate tenant ownership
validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId)

// Validate status transitions
validate('update', ctx => {
  const validTransitions = {
    draft: ['published', 'archived'],
    published: ['archived'],
    archived: []
  }
  return !ctx.data.status || validTransitions[ctx.row.status]?.includes(ctx.data.status)
})
```

### Operations

| Operation | SQL    | Description                   |
| --------- | ------ | ----------------------------- |
| `read`    | SELECT | Control what users can view   |
| `create`  | INSERT | Control what users can create |
| `update`  | UPDATE | Control what users can modify |
| `delete`  | DELETE | Control what users can remove |
| `all`     | All    | Apply to all operations       |

```typescript
// Single operation
allow('read', ctx => /* ... */)

// Multiple operations
allow(['read', 'update'], ctx => /* ... */)

// All operations
deny('all', ctx => ctx.auth.suspended)
```

### Policy Evaluation Order

```
1. Check bypass conditions (system user, bypass roles)
   → If bypassed, ALLOW and skip all policies

2. Evaluate DENY policies (priority: highest first)
   → If ANY deny matches, REJECT immediately

3. Evaluate ALLOW policies (priority: highest first)
   → If NO allow matches and defaultDeny=true, REJECT

4. Apply FILTER policies (for SELECT)
   → Combine all filters with AND

5. Apply VALIDATE policies (for CREATE/UPDATE)
   → All validations must pass

6. Execute query
```

**Priority System:**

- Higher priority = evaluated first
- Deny policies default to priority `100`
- Allow/filter/validate default to priority `0`

```typescript
defineRLSSchema<Database>({
  posts: {
    policies: [
      // Highest priority
      deny('all', ctx => ctx.auth.suspended, { priority: 200 }),

      // Default deny priority
      deny('delete', ctx => ctx.row.locked),

      // Custom priority
      allow('read', ctx => ctx.auth.premium, { priority: 50 }),

      // Default priority
      allow('read', ctx => ctx.row.public)
    ]
  }
})
```

---

## Policy Builders

### `allow(operation, condition, options?)`

```typescript
// Basic allow
allow('read', ctx => ctx.auth.userId === ctx.row.user_id)

// Multiple operations
allow(['read', 'update'], ctx => ctx.row.owner_id === ctx.auth.userId)

// All operations
allow('all', ctx => ctx.auth.roles.includes('admin'))

// With options
allow('read', ctx => ctx.auth.verified, {
  name: 'verified-users-only',
  priority: 10,
  hints: { indexColumns: ['verified'], selectivity: 'high' }
})

// Async condition
allow('update', async ctx => {
  const hasPermission = await checkPermission(ctx.auth.userId, 'posts:edit')
  return hasPermission
})
```

### `deny(operation, condition?, options?)`

```typescript
// Basic deny
deny('delete', ctx => ctx.row.status === 'published')

// Deny all operations
deny('all', ctx => ctx.auth.attributes?.banned === true)

// Unconditional deny
deny('all') // Always deny

// With priority
deny('all', ctx => ctx.auth.suspended, {
  name: 'block-suspended-users',
  priority: 200
})
```

### `filter(operation, condition, options?)`

```typescript
// Simple filter
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))

// Multiple conditions
filter('read', ctx => ({
  organization_id: ctx.auth.organizationIds?.[0],
  deleted_at: null,
  status: 'active'
}))

// Dynamic filter
filter('read', ctx => {
  if (ctx.auth.roles.includes('admin')) {
    return {} // No filtering
  }
  return { status: 'published', public: true }
})

// With hints
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }), {
  name: 'tenant-isolation',
  priority: 1000,
  hints: { indexColumns: ['tenant_id'], selectivity: 'high' }
})
```

### `validate(operation, condition, options?)`

```typescript
// Validate create
validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId)

// Validate update
validate('update', ctx => {
  const allowedFields = ['title', 'content', 'tags']
  return Object.keys(ctx.data).every(key => allowedFields.includes(key))
})

// Both create and update
validate('all', ctx => !ctx.data.price || ctx.data.price >= 0)
```

### Policy Options

```typescript
interface PolicyOptions {
  /** Policy name for debugging */
  name?: string

  /** Priority (higher runs first) */
  priority?: number

  /** Performance hints */
  hints?: {
    indexColumns?: string[]
    selectivity?: 'high' | 'medium' | 'low'
    leakproof?: boolean
    stable?: boolean
  }
}
```

---

## RLS Context

### RLSContext Interface

The RLS context is stored and managed using AsyncLocalStorage, providing automatic context propagation across async boundaries:

```typescript
interface RLSContext<TUser = unknown, TMeta = unknown> {
  auth: {
    userId: string | number // Required
    roles: string[] // Required
    tenantId?: string | number // Optional
    organizationIds?: (string | number)[]
    permissions?: string[]
    attributes?: Record<string, unknown>
    user?: TUser
    isSystem?: boolean // Default: false
  }
  request?: {
    requestId?: string
    ipAddress?: string
    userAgent?: string
    timestamp: Date
    headers?: Record<string, string>
  }
  meta?: TMeta
  timestamp: Date
}
```

**Context Storage:** The plugin uses `AsyncLocalStorage` internally to store the RLS context, which:

- Automatically propagates through async/await chains
- Is isolated per request (no cross-contamination)
- Requires no manual passing of context objects
- Works seamlessly with transactions

### Context Management

The RLS plugin provides a singleton `rlsContext` manager that wraps AsyncLocalStorage for context management.

#### `rlsContext.runAsync(context, fn)`

Run async function within RLS context (most common usage):

```typescript
await rlsContext.runAsync(
  {
    auth: {
      userId: 123,
      roles: ['user'],
      tenantId: 'acme-corp',
      isSystem: false
    },
    timestamp: new Date()
  },
  async () => {
    // All queries within this block use this context
    const posts = await orm.posts.findAll()

    // Context propagates through async operations
    await orm.posts.create({ title: 'New Post' })
  }
)
```

#### `rlsContext.run(context, fn)`

Run synchronous function within RLS context:

```typescript
const result = rlsContext.run(context, () => {
  // Synchronous operations
  return someValue
})
```

#### `createRLSContext(options)`

Create and validate RLS context with proper defaults:

```typescript
import { createRLSContext } from '@kysera/rls'

const ctx = createRLSContext({
  auth: {
    userId: 123,
    roles: ['user', 'editor'],
    tenantId: 'acme-corp',
    permissions: ['posts:read', 'posts:write']
  },
  // Optional request context
  request: {
    requestId: 'req-abc123',
    ipAddress: '192.168.1.1',
    timestamp: new Date()
  },
  // Optional metadata
  meta: {
    featureFlags: ['beta_access']
  }
})

await rlsContext.runAsync(ctx, async () => {
  // ...
})
```

#### Context Helper Methods

The `rlsContext` singleton provides helper methods for accessing context:

```typescript
// Get current context (throws RLSContextError if not set)
const ctx = rlsContext.getContext()

// Get context or null (safe, no throw)
const ctx = rlsContext.getContextOrNull()

// Check if running within context
if (rlsContext.hasContext()) {
  // Context is available
}

// Get auth context (throws if no context)
const auth = rlsContext.getAuth()

// Get user ID (throws if no context)
const userId = rlsContext.getUserId()

// Get tenant ID (throws if no context)
const tenantId = rlsContext.getTenantId()

// Check if user has role
if (rlsContext.hasRole('admin')) {
  // User has admin role
}

// Check if user has permission
if (rlsContext.hasPermission('posts:delete')) {
  // User can delete posts
}

// Check if running in system context
if (rlsContext.isSystem()) {
  // Bypasses RLS policies
}

// Run as system user (bypass RLS)
await rlsContext.asSystemAsync(async () => {
  // All operations bypass RLS policies
  const allPosts = await orm.posts.findAll()
})

// Synchronous system context
const result = rlsContext.asSystem(() => {
  return someOperation()
})
```

**Important:** The context helpers (`getContext`, `getAuth`, etc.) throw `RLSContextError` if called outside of a context. Always use `getContextOrNull()` or `hasContext()` if you need to check conditionally.

---

## Repository Extensions

When the RLS plugin is enabled, repositories are automatically extended with utility methods via the `extendRepository` hook:

### `withoutRLS(fn)`

Bypass RLS policies for specific operations by running them in a system context:

```typescript
// Fetch all posts including other tenants (bypasses RLS)
const allPosts = await repo.withoutRLS(async () => {
  return repo.findAll()
})

// Compare filtered vs unfiltered results
await rlsContext.runAsync(userContext, async () => {
  const userPosts = await repo.findAll() // Filtered by RLS policies

  const allPosts = await repo.withoutRLS(async () => {
    return repo.findAll() // Bypasses RLS, returns all records
  })

  console.log(`User can see ${userPosts.length} of ${allPosts.length} total posts`)
})
```

**Implementation:** `withoutRLS` internally calls `rlsContext.asSystemAsync(fn)`, which sets `auth.isSystem = true` for the duration of the callback.

### `canAccess(operation, row)`

Check if the current user can perform an operation on a specific row:

```typescript
const post = await repo.findById(postId)

// Check read access
const canRead = await repo.canAccess('read', post)

// Check update access before showing edit UI
const canUpdate = await repo.canAccess('update', post)
if (canUpdate) {
  // Show edit button in UI
}

// Pre-flight check to avoid policy violations
if (await repo.canAccess('delete', post)) {
  await repo.delete(post.id)
} else {
  console.log('User cannot delete this post')
}

// Check multiple operations
const operations = ['read', 'update', 'delete'] as const
for (const op of operations) {
  const allowed = await repo.canAccess(op, post)
  console.log(`${op}: ${allowed}`)
}
```

**Implementation:** `canAccess` evaluates the RLS policies against the provided row using the `MutationGuard`, returning `true` if allowed and `false` if denied or no context exists.

**Supported Operations:**

- `'read'` - Check if user can view the row
- `'create'` - Check if user can create with this data
- `'update'` - Check if user can update the row
- `'delete'` - Check if user can delete the row

---

## DAL Pattern Support

RLS works seamlessly with the DAL pattern through @kysera/executor's Unified Execution Layer:

```typescript
import { createExecutor } from '@kysera/executor'
import { createContext, createQuery, withTransaction } from '@kysera/dal'
import { rlsPlugin, defineRLSSchema, filter, rlsContext } from '@kysera/rls'

// Define schema
const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))]
  }
})

// Step 1: Register RLS plugin with Unified Execution Layer
const executor = await createExecutor(db, [rlsPlugin({ schema: rlsSchema })])

// Step 2: Create DAL context - plugins automatically apply
const dalCtx = createContext(executor)

// Step 3: Define queries - RLS applied automatically
const getPosts = createQuery(ctx => ctx.db.selectFrom('posts').selectAll().execute())

// Execute within RLS context
await rlsContext.runAsync(
  {
    auth: { userId: 1, tenantId: 'acme', roles: ['user'], isSystem: false },
    timestamp: new Date()
  },
  async () => {
    // Automatically filtered by tenant
    const posts = await getPosts(dalCtx)

    // Transactions propagate RLS context
    await withTransaction(dalCtx, async txCtx => {
      const txPosts = await getPosts(txCtx)
    })
  }
)
```

---

## Plugin Configuration

### `rlsPlugin(options)`

```typescript
interface RLSPluginOptions<DB = unknown> {
  /** RLS policy schema (required) */
  schema: RLSSchema<DB>

  /**
   * Tables to exclude from RLS (always bypass)
   */
  excludeTables?: string[]

  /** Roles that bypass RLS entirely */
  bypassRoles?: string[]

  /** Logger for RLS operations */
  logger?: KyseraLogger

  /**
   * Require RLS context (throws if missing)
   * @default true - SECURE BY DEFAULT
   *
   * SECURITY: Changed to true in v0.8.0+ for secure-by-default.
   * When true, missing context throws RLSContextError.
   * Only set to false if you have other security controls.
   */
  requireContext?: boolean

  /**
   * Allow unfiltered queries when context is missing
   * @default false - SECURE BY DEFAULT
   *
   * WARNING: Setting true allows queries without RLS filtering
   * when context is missing. Only enable if you understand the
   * security implications (e.g., background jobs, system ops).
   *
   * When requireContext=false and allowUnfilteredQueries=false:
   * - Missing context returns empty results with warnings
   */
  allowUnfilteredQueries?: boolean

  /** Enable audit logging of decisions */
  auditDecisions?: boolean

  /** Custom violation handler */
  onViolation?: (violation: RLSPolicyViolation) => void

  /** Primary key column name (default: 'id') */
  primaryKeyColumn?: string
}
```

**Example:**

```typescript
import { rlsPlugin } from '@kysera/rls'
import { createLogger } from '@kysera/core'

const plugin = rlsPlugin({
  schema: rlsSchema,
  excludeTables: ['audit_logs', 'migrations'],
  bypassRoles: ['admin', 'system'],
  logger: createLogger({ level: 'info' }),
  requireContext: true,
  auditDecisions: true,
  onViolation: violation => {
    auditLog.record({
      type: 'rls_violation',
      operation: violation.operation,
      table: violation.table,
      timestamp: new Date()
    })
  }
})

const orm = await createORM(db, [plugin])
```

### Security Configuration (v0.8.0+)

**BREAKING CHANGE**: Starting in v0.8.0, `requireContext` defaults to `true` for secure-by-default behavior.

#### Secure Defaults (Recommended)

```typescript
// Default behavior - secure by default
const plugin = rlsPlugin({
  schema: rlsSchema
  // requireContext: true (implicit)
  // allowUnfilteredQueries: false (implicit)
})

// Missing context throws RLSContextError
await orm.posts.findAll() // ❌ Throws: RLS context required
```

#### Background Jobs / System Operations

For operations that legitimately run without user context (e.g., cron jobs, system maintenance):

```typescript
const plugin = rlsPlugin({
  schema: rlsSchema,
  requireContext: false, // Don't throw on missing context
  allowUnfilteredQueries: true // Allow queries without filtering
})

// OR use system context for privileged operations:
await rlsContext.asSystemAsync(async () => {
  await orm.posts.findAll() // ✅ Runs as system user
})
```

#### Defensive Mode (No throws, but safe)

For applications transitioning to RLS or with mixed code paths:

```typescript
const plugin = rlsPlugin({
  schema: rlsSchema,
  requireContext: false, // Don't throw
  allowUnfilteredQueries: false // Return empty results
  // Missing context logs warning and returns no rows
})
```

**Security Matrix:**

| requireContext | allowUnfilteredQueries | Missing Context Behavior                |
| -------------- | ---------------------- | --------------------------------------- |
| `true` (default) | N/A                  | **Throws RLSContextError** (secure)     |
| `false`        | `false` (default)    | **Returns empty results** (safe)        |
| `false`        | `true`               | **Allows unfiltered access** (unsafe)   |

⚠️ **Security Warning**: Only use `allowUnfilteredQueries: true` if you:
1. Understand the security implications
2. Have other security controls in place
3. Are running background jobs or system operations without user context

---

## Error Handling

The RLS plugin provides specialized error classes for different failure scenarios:

### Error Types

```typescript
import {
  RLSError, // Base error class
  RLSContextError, // Missing context
  RLSPolicyViolation, // Access denied (expected)
  RLSPolicyEvaluationError, // Bug in policy code (unexpected)
  RLSSchemaError, // Invalid schema
  RLSContextValidationError // Invalid context
} from '@kysera/rls'
```

### Error Scenarios

#### `RLSContextError`

Thrown when RLS context is missing but required:

```typescript
try {
  // No context set, but requireContext: true
  await orm.posts.findAll()
} catch (error) {
  if (error instanceof RLSContextError) {
    // error.code === 'RLS_CONTEXT_MISSING'
    console.error('No RLS context found. Ensure code runs within rlsContext.runAsync()')
  }
}
```

**When thrown:**

- Operations executed outside `rlsContext.runAsync()` when `requireContext: true`
- Calling `rlsContext.getContext()` without active context
- Attempting `asSystem()` without existing context

#### `RLSPolicyViolation`

Thrown when operation is denied by policies (this is expected, not a bug):

```typescript
try {
  // User tries to update a post they don't own
  await orm.posts.update(1, { title: 'New Title' })
} catch (error) {
  if (error instanceof RLSPolicyViolation) {
    // error.code === 'RLS_POLICY_VIOLATION'
    console.error({
      operation: error.operation, // 'update'
      table: error.table, // 'posts'
      reason: error.reason, // 'User does not own this post'
      policyName: error.policyName // 'ownership_policy' (if named)
    })

    // Return 403 Forbidden to client
    res.status(403).json({
      error: 'Access denied',
      message: error.reason
    })
  }
}
```

**When thrown:**

- `deny` policy condition evaluates to `true`
- No `allow` policy matches and `defaultDeny: true`
- `validate` policy fails during CREATE/UPDATE

#### `RLSPolicyEvaluationError`

Thrown when policy condition throws an error (this is a bug in your policy code):

```typescript
try {
  await orm.posts.findAll()
} catch (error) {
  if (error instanceof RLSPolicyEvaluationError) {
    // error.code === 'RLS_POLICY_EVALUATION_ERROR'
    console.error({
      operation: error.operation, // 'read'
      table: error.table, // 'posts'
      policyName: error.policyName, // 'tenant_filter'
      originalError: error.originalError // TypeError: Cannot read property 'tenantId' of undefined
    })

    // This is a bug - fix your policy code!
    // Example: Policy tried to access ctx.auth.tenantId but it was undefined
  }
}
```

**When thrown:**

- Policy condition function throws an error
- Policy tries to access undefined properties
- Async policy rejects with an error

**Debugging:** The `originalError` property and stack trace are preserved to help identify the issue in your policy code.

#### `RLSContextValidationError`

Thrown when RLS context is malformed:

```typescript
try {
  const ctx = createRLSContext({
    auth: {
      // Missing userId!
      roles: ['user']
    }
  })
} catch (error) {
  if (error instanceof RLSContextValidationError) {
    // error.code === 'RLS_CONTEXT_INVALID'
    console.error({
      message: error.message, // 'userId is required in auth context'
      field: error.field // 'userId'
    })
  }
}
```

#### `RLSSchemaError`

Thrown when RLS schema is invalid:

```typescript
try {
  const schema = defineRLSSchema({
    posts: {
      policies: [
        // Invalid policy!
        { type: 'invalid-type', operation: 'read', condition: () => true }
      ]
    }
  })
} catch (error) {
  if (error instanceof RLSSchemaError) {
    // error.code === 'RLS_SCHEMA_INVALID'
    console.error(error.details)
  }
}
```

### Error Comparison Table

| Error                       | Meaning         | Severity | Action                                      |
| --------------------------- | --------------- | -------- | ------------------------------------------- |
| `RLSContextError`           | Missing context | Error    | Ensure code runs in `rlsContext.runAsync()` |
| `RLSPolicyViolation`        | Access denied   | Expected | Return 403 to client, normal behavior       |
| `RLSPolicyEvaluationError`  | Policy bug      | Critical | Fix the policy code immediately             |
| `RLSContextValidationError` | Invalid context | Error    | Fix context creation                        |
| `RLSSchemaError`            | Invalid schema  | Error    | Fix schema definition                       |

### Error Codes

All RLS errors include a `code` property for programmatic handling:

```typescript
import { RLSErrorCodes } from '@kysera/rls'

// RLSErrorCodes.RLS_CONTEXT_MISSING
// RLSErrorCodes.RLS_POLICY_VIOLATION
// RLSErrorCodes.RLS_POLICY_EVALUATION_ERROR
// RLSErrorCodes.RLS_CONTEXT_INVALID
// RLSErrorCodes.RLS_SCHEMA_INVALID
// RLSErrorCodes.RLS_POLICY_INVALID
```

---

## Architecture & Implementation

### Plugin Lifecycle

The RLS plugin follows the standard `@kysera/executor` plugin lifecycle:

1. **Initialization (`onInit`):**
   - Creates `PolicyRegistry` from schema
   - Validates all policies
   - Compiles policies for runtime
   - Creates `SelectTransformer` and `MutationGuard` instances

2. **Query Interception (`interceptQuery`):**
   - Called for every query builder operation
   - Checks skip conditions (skipTables, metadata, system user, bypass roles)
   - For SELECT: Applies filter policies via `SelectTransformer`
   - For mutations: Marks `metadata['__rlsRequired'] = true`

3. **Repository Extension (`extendRepository`):**
   - Wraps `create`, `update`, `delete` methods
   - Evaluates policies via `MutationGuard`
   - Uses `getRawDb()` to fetch existing rows (bypasses RLS)
   - Adds `withoutRLS()` and `canAccess()` utility methods

### Key Components

**PolicyRegistry:**

- Stores and indexes compiled policies by table and operation
- Validates schema structure
- Provides fast policy lookup

**SelectTransformer:**

- Transforms SELECT queries by adding WHERE conditions
- Combines multiple filter policies with AND logic
- Evaluates filter conditions in context

**MutationGuard:**

- Evaluates allow/deny policies for mutations
- Enforces policy evaluation order (deny → allow → validate)
- Throws `RLSPolicyViolation` or `RLSPolicyEvaluationError`

**AsyncLocalStorage:**

- Provides context isolation per request
- Automatic propagation through async/await chains
- No manual context passing required

### Performance Considerations

**Compiled Policies:**

- Policies are compiled once at initialization
- No runtime parsing or compilation overhead

**Filter Application:**

- Filters applied as SQL WHERE clauses
- Database handles filtering efficiently
- Index hints available via `PolicyOptions.hints`

**Context Access:**

- AsyncLocalStorage is very fast (V8-optimized)
- Context lookup has negligible overhead

**Bypass Mechanisms:**

- System context bypass is immediate (no policy evaluation)
- `excludeTables` bypass is immediate (no policy evaluation)
- Bypass roles checked before policy evaluation

### Transaction Support

RLS context automatically propagates through transactions:

```typescript
await rlsContext.runAsync(userContext, async () => {
  // Context available in transaction
  await orm.transaction(async trx => {
    // All queries use the same RLS context
    const user = await trx.users.findById(userId)
    await trx.posts.create({ title: 'Post', authorId: userId })
  })
})
```

**Note:** DAL transactions with executor preserve RLS context:

```typescript
await withTransaction(executor, async txCtx => {
  // RLS context preserved in transaction
  const posts = await getPosts(txCtx)
})
```

---

## Common Patterns

### Multi-Tenant Isolation

```typescript
const schema = defineRLSSchema<Database>({
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId)
    ],
    defaultDeny: true
  }
})

app.use(async (req, res, next) => {
  const user = await authenticate(req)

  await rlsContext.runAsync(
    { auth: { userId: user.id, tenantId: user.tenant_id, roles: user.roles } },
    async () => {
      const posts = await orm.posts.findAll()
      res.json(posts)
    }
  )
})
```

### Owner-Based Access

```typescript
const schema = defineRLSSchema<Database>({
  posts: {
    policies: [
      // Public posts visible to all
      filter('read', ctx => ({ public: true })),

      // Or own posts
      allow('read', ctx => ctx.auth.userId === ctx.row.author_id),

      // Only owner can update/delete
      allow(['update', 'delete'], ctx => ctx.auth.userId === ctx.row.author_id)
    ]
  }
})
```

### Role-Based Access Control

```typescript
const schema = defineRLSSchema<Database>({
  posts: {
    policies: [
      // Admins can do everything
      allow('all', ctx => ctx.auth.roles.includes('admin')),

      // Editors can read and update
      allow(['read', 'update'], ctx => ctx.auth.roles.includes('editor')),

      // Regular users read only
      allow('read', ctx => ctx.auth.roles.includes('user'))
    ]
  }
})
```

---

## TypeScript Support

Full type inference for policies:

```typescript
interface Database {
  posts: {
    id: number
    title: string
    author_id: number
    tenant_id: string
  }
}

const schema = defineRLSSchema<Database>({
  posts: {
    policies: [
      allow('read', ctx => {
        const post = ctx.row // Type: Database['posts']
        const userId = ctx.auth.userId // Type: string | number
        return post.author_id === userId
      }),

      validate('update', ctx => {
        const data = ctx.data // Type: Partial<Database['posts']>
        const title = data.title // Type: string | undefined
        return !title || title.length > 0
      })
    ]
  }
})
```

---

## API Reference

### Core Exports

```typescript
// Schema definition
export { defineRLSSchema, mergeRLSSchemas } from '@kysera/rls'

// Policy builders
export { allow, deny, filter, validate, type PolicyOptions } from '@kysera/rls'

// Plugin
export { rlsPlugin, type RLSPluginOptions } from '@kysera/rls'

// Context management
export {
  rlsContext,
  createRLSContext,
  withRLSContext,
  withRLSContextAsync,
  type RLSContext
} from '@kysera/rls'

// Errors
export {
  RLSError,
  RLSContextError,
  RLSPolicyViolation,
  RLSPolicyEvaluationError,
  RLSSchemaError,
  RLSContextValidationError,
  RLSErrorCodes
} from '@kysera/rls'
```

---

## License

MIT
