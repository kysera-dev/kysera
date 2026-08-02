---
sidebar_position: 5
title: Row-Level Security
description: Row-level security plugin for multi-tenant applications
---

# Row-Level Security (RLS) Plugin

Implement declarative authorization policies for multi-tenant applications with automatic query transformation using AsyncLocalStorage for context propagation.

The RLS plugin uses the unified `@kysera/executor` Plugin interface and works with both **Repository** and **DAL** patterns through query interception.

:::caution Breaking Change in v0.8.0
**SECURITY: `requireContext` now defaults to `true` (secure-by-default)**

Starting from v0.8.0, the RLS plugin requires an RLS context by default. If you're upgrading from an earlier version and your application allows queries without RLS context (e.g., background jobs, system operations), you need to explicitly configure the plugin:

```typescript
// Option 1: Use system context for privileged operations (recommended)
await rlsContext.asSystemAsync(async () => {
  await postRepo.findAll() // Runs with full access
})

// Option 2: Disable requireContext and allow unfiltered queries (use with caution)
const plugin = rlsPlugin({
  schema: rlsSchema,
  requireContext: false,      // Don't throw on missing context
  allowUnfilteredQueries: true // Allow unfiltered access (SECURITY RISK)
})
```

**This change prevents accidental data leaks by ensuring all queries have proper RLS context.**

See [Migration from v0.7](#migration-from-v07) for details.
:::


## Installation

```bash
npm install @kysera/rls
```

`kysely` and `@kysera/executor` are **required** peer dependencies. `@kysera/repository` is an optional peer — install it when you use the Repository pattern (`createORM`), which unlocks the value-level policy checks and repository extensions described below. `zod` is optional and only needed for the `@kysera/rls/schema` validation subpath.

## Basic Usage

<!-- doc-snippet: skip -->
```typescript
import { createORM } from '@kysera/repository'
import { rlsPlugin, defineRLSSchema, allow, filter, rlsContext } from '@kysera/rls'

// Define security schema
const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [
      // Multi-tenant isolation
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),

      // Authors can edit their own posts
      allow(['update', 'delete'], ctx => ctx.auth.userId === ctx.row?.author_id),

      // Only published posts visible to non-admins
      filter('read', ctx => (ctx.auth.roles?.includes('admin') ? {} : { status: 'published' }))
    ],
    defaultDeny: true
  }
})

// Create repository manager with RLS
const orm = await createORM(db, [rlsPlugin({ schema: rlsSchema })])
const postRepo = orm.createRepository(createPostRepository)

// Use within RLS context
await rlsContext.runAsync({ auth: { userId: 1, tenantId: 'acme', roles: ['user'] } }, async () => {
  // All queries automatically filtered by tenant_id
  const posts = await postRepo.findAll()
})
```

## Configuration

### Plugin Options

```typescript
interface RLSPluginOptions<DB = unknown> {
  schema: RLSSchema<DB> // RLS policy schema (required)

  // Table selection
  tables?: string[]        // Whitelist: only these tables get RLS (takes precedence over excludeTables)
  excludeTables?: string[] // Tables to exclude from RLS

  // Security settings
  requireContext?: boolean          // Require RLS context (default: true)
  allowUnfilteredQueries?: boolean  // Allow queries without context (default: false)

  // Bypass options
  bypassRoles?: string[]  // Roles that bypass RLS for all tables

  // Logging & debugging
  logger?: KyseraLogger                          // Logger instance
  auditDecisions?: boolean                       // Log policy decisions
  onViolation?: (violation: RLSPolicyViolation) => void // Custom violation handler

  // Configuration
  primaryKeyColumn?: string  // Primary key column name (default: 'id')
  maxBulkRowChecks?: number  // Per-row policy evaluation bound for bulk mutations (default: 1000)

  // Conditional policy activation (see "Conditional Policy Activation")
  activation?: {
    environment?: string // Environment for whenEnvironment gates (default: NODE_ENV)
    features?: Set<string> | string[] | Record<string, unknown> // Feature flags for whenFeature gates
    meta?: Record<string, unknown> // Static activation metadata; per-request ctx.meta overrides on conflict
  }
}
```

To validate these options at runtime, the optional `@kysera/rls/schema` subpath (requires `zod`) exports `RLSPluginOptionsSchema` together with its `RLSPluginOptionsInput` / `RLSPluginOptionsOutput` types.

### Security Configuration (v0.8.0+)

The RLS plugin provides multiple security modes to balance safety and flexibility:

#### Secure Mode (Default - Recommended)

**Configuration:**
```typescript
const plugin = rlsPlugin({
  schema: rlsSchema
  // requireContext: true (implicit default)
  // allowUnfilteredQueries: false (implicit default)
})
```

**Behavior:**
- **Missing context throws `RLSContextError`** - prevents unfiltered database access
- Ensures all queries have proper user context
- **Recommended for production applications**

**When to use:** Multi-tenant SaaS, user-facing applications, any system where data isolation is critical.

#### System Operations Mode

**Configuration:**
```typescript
const plugin = rlsPlugin({
  schema: rlsSchema,
  requireContext: false,       // Don't throw on missing context
  allowUnfilteredQueries: true // Allow queries without filtering
})
```

**Behavior:**
- Missing context allows unfiltered access
- No errors thrown
- **Use with caution** - can expose data across tenant boundaries

**When to use:** Background jobs, system maintenance tasks, data migrations, cron jobs that don't have user context.

**Better alternative:** Use system context instead:
```typescript
await rlsContext.asSystemAsync(async () => {
  // Full access with explicit intent
  await postRepo.findAll()
})
```

#### Defensive Mode

**Configuration:**
```typescript
const plugin = rlsPlugin({
  schema: rlsSchema,
  requireContext: false,        // Don't throw
  allowUnfilteredQueries: false // Return empty results
})
```

**Behavior:**
- Missing context logs warning and **returns empty results** — reads come back empty, and UPDATE/DELETE are narrowed to match zero rows
- Safe but doesn't throw errors
- Useful during RLS migration

**When to use:** Transitioning legacy applications to RLS, mixed code paths with gradual rollout.

#### Security Matrix

| requireContext | allowUnfilteredQueries | Missing Context Behavior                      | Use Case                    |
|----------------|------------------------|-----------------------------------------------|-----------------------------|
| `true` (default) | N/A                  | **Throws `RLSContextError`** (secure)         | Production apps (default)   |
| `false`        | `false` (default)    | **Returns empty results; UPDATE/DELETE match zero rows** (safe) | RLS migration, defensive    |
| `false`        | `true`               | **Allows unfiltered access** (⚠️ unsafe)      | Background jobs, migrations |

:::danger Security Warning
Only use `allowUnfilteredQueries: true` if you:
1. Understand the security implications
2. Have other security controls in place (e.g., network isolation)
3. Are running background jobs or system operations without user context
4. Cannot use `rlsContext.asSystemAsync()` for explicit bypass

**This setting can expose sensitive data across tenant boundaries. Use system context instead whenever possible.**
:::

#### Examples

**Production SaaS Application:**
```typescript
// Secure by default
const orm = await createORM(db, [
  rlsPlugin({ schema: rlsSchema })
])

// All requests must have context
app.use(async (req, res, next) => {
  const user = await authenticate(req)

  await rlsContext.runAsync(
    {
      auth: {
        userId: user.id,
        tenantId: user.tenantId,
        roles: user.roles
      },
      timestamp: new Date()
    },
    next
  )
})
```

**Background Job (Option 1 - Recommended):**
```typescript
// Use system context explicitly
const orm = await createORM(db, [
  rlsPlugin({ schema: rlsSchema }) // Keep secure defaults
])
const postRepo = orm.createRepository(createPostRepository)

// In your cron job
async function cleanupExpiredPosts() {
  await rlsContext.runAsync(
    {
      auth: {
        userId: 'system',
        roles: [],
        isSystem: true // Explicit bypass
      },
      timestamp: new Date()
    },
    async () => {
      // Full access with clear intent
      const expired = await postRepo.findAll()
      // ... cleanup logic
    }
  )
}
```

**Background Job (Option 2 - Less Safe):**
```typescript
// Allow unfiltered queries (use with caution)
const orm = await createORM(db, [
  rlsPlugin({
    schema: rlsSchema,
    requireContext: false,
    allowUnfilteredQueries: true
  })
])
const postRepo = orm.createRepository(createPostRepository)

// No context needed but less explicit
async function cleanupExpiredPosts() {
  // Runs without RLS filtering
  const expired = await postRepo.findAll()
  // ... cleanup logic
}
```

### Table Schema Options

```typescript
interface TableRLSConfig {
  policies: PolicyDefinition[] // List of policies for this table
  defaultDeny?: boolean // Deny access when no policy matches (default: true)
  skipFor?: string[] // Roles that bypass RLS for this table only
}
```

Each element of `policies` is a `PolicyDefinition` — a single interface shared by all policy types (there are no per-type interfaces):

```typescript
interface PolicyDefinition {
  type: PolicyType // 'allow' | 'deny' | 'filter' | 'validate'
  operation: Operation | Operation[] // 'read' | 'create' | 'update' | 'delete' | 'all'
  condition: PolicyCondition // returns boolean for allow/deny/validate, a conditions object for filter
  name?: string // Used in error messages, audit logs, and overridePolicy()
  priority?: number // Higher runs first (default 0; deny defaults to 100)
  using?: string // Native RLS only: SQL for the USING clause
  withCheck?: string // Native RLS only: SQL for the WITH CHECK clause
  role?: string // Native RLS only: target database role
  hints?: PolicyHints // Performance optimization hints
}
```

You rarely write these by hand — the [policy builders](#policy-builders) below return them.

### Bypass Options Comparison

**Plugin-level bypass** (`excludeTables`, `bypassRoles`):

- Applies to **all tables** globally
- Set at plugin initialization time
- Useful for excluding system tables or super-admin roles

**Table-level bypass** (`skipFor`):

- Applies to **specific table** only
- Set in the table's schema definition
- Useful for table-specific admin access

<!-- doc-snippet: skip -->
```typescript
// Example: Using both levels
const orm = await createORM(db, [
  rlsPlugin({
    schema: rlsSchema,
    excludeTables: ['migrations', 'system_config'],  // Global: Skip these tables entirely
    bypassRoles: ['superadmin'],                      // Global: Superadmins bypass all RLS
  })
])

const rlsSchema = defineRLSSchema<Database>({
  users: {
    policies: [...],
    skipFor: ['hr_admin'],  // Table-specific: HR admins bypass RLS on users table only
  },
  posts: {
    policies: [...],
    skipFor: ['content_admin'],  // Content admins bypass RLS on posts table only
  },
})
```

## Policy Builders

All four builders take an optional final argument `options?: PolicyOptions` and return a `ConditionalPolicyDefinition` (a `PolicyDefinition` that may additionally carry an activation condition):

```typescript
interface PolicyOptions {
  name?: string // Policy name for debugging and audit logs
  priority?: number // Higher runs first (deny defaults to 100, others to 0)
  hints?: PolicyHints // Performance optimization hints
  condition?: PolicyActivationCondition // Activation gate — see Conditional Policy Activation
}
```

### allow

Grant permission based on condition. Returns `true` to allow access, `false` to deny.

<!-- doc-snippet: skip -->
```typescript
// Authors can update their own posts
allow('update', ctx => ctx.auth.userId === ctx.row?.author_id)

// Admins can do anything
allow(['read', 'create', 'update', 'delete'], ctx => ctx.auth.roles?.includes('admin'))

// Multiple operations with options
allow(['update', 'delete'], ctx => ctx.auth.userId === ctx.row?.author_id, {
  name: 'ownership-policy',
  priority: 10
})
```

**Operations:** `'read'`, `'create'`, `'update'`, `'delete'`, `'all'`, or an array of operations.

### deny

Explicitly deny access. Takes precedence over allow policies. Returns `true` to deny access.

<!-- doc-snippet: skip -->
```typescript
// Never allow deleting system users
deny('delete', ctx => ctx.row?.is_system === true)

// Prevent banned users from any access
deny('all', ctx => ctx.auth.attributes?.banned === true, {
  name: 'block-banned-users',
  priority: 200 // High priority for deny policies
})

// Deny all access (no condition defaults to always deny)
deny('all')
```

**Priority:** Deny policies default to priority `100` (higher than allow policies).

### filter

Add WHERE conditions to queries. Returns an object with column-value pairs. Filter predicates are applied to SELECT queries **and to the row scope of UPDATE and DELETE statements** — the policy registry ignores the declared operation when collecting filters, so a `filter('read', ...)` also narrows which rows an UPDATE or DELETE can touch.

:::warning Synchronous Only
**Filter conditions must be synchronous functions.** Async filter policies are not supported because filters are applied directly to query builders at query construction time. Use `allow()` or `validate()` policies if you need async operations.
:::

```typescript
// Tenant isolation
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))

// Status-based filtering
filter('read', ctx =>
  ctx.auth.roles?.includes('admin')
    ? {} // Admins see everything
    : { status: 'active', visibility: 'public' }
)

// Multiple conditions
filter('read', ctx => ({
  tenant_id: ctx.auth.tenantId,
  deleted_at: null,
  status: 'published'
}))

// Arrays become IN (...) clauses — there is no $in operator
filter('read', ctx => ({ organization_id: ctx.auth.organizationIds ?? [] }))
```

**Operations:** Only `'read'` or `'all'` (which becomes `'read'`).

**Condition values:** plain values compile to `=` comparisons and `null` to `IS NULL`. Pass an array directly to get a SQL `IN` clause — an empty array produces an impossible condition, so the query matches no rows. `undefined` values are skipped.

### validate

Validate input data before create/update operations. Returns `true` if data is valid, `false` otherwise.

<!-- doc-snippet: skip -->
```typescript
// Users can only create posts for themselves
validate('create', ctx => ctx.data?.author_id === ctx.auth.userId)

// Validate tenant_id matches user's tenant
validate('create', ctx => ctx.data?.tenant_id === ctx.auth.tenantId)

// Validate status transitions
validate('update', ctx => {
  if (!ctx.data?.status) return true
  const validStatuses = ['draft', 'published', 'archived']
  return validStatuses.includes(ctx.data.status)
})
```

**Operations:** `'create'`, `'update'`, or `'all'` (expands to both create and update).

## Schema Definition

<!-- doc-snippet: skip -->
```typescript
const rlsSchema = defineRLSSchema<Database>({
  // Table-specific policies
  users: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow('update', ctx => ctx.auth.userId === ctx.row?.id)
    ],
    defaultDeny: true // Deny operations not explicitly allowed
  },

  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow(
        ['update', 'delete'],
        ctx => ctx.auth.userId === ctx.row?.author_id || ctx.auth.roles?.includes('admin')
      )
    ]
  },

  // Admin table with role-based bypass
  audit_logs: {
    policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))],
    skipFor: ['admin', 'superuser'], // Admins can see all audit logs
    defaultDeny: true
  },

  // To leave a table without RLS, omit it from the schema entirely
  // (or list it in excludeTables). To keep it listed with full access:
  public_content: { policies: [], defaultDeny: false }
})

// Merge multiple schemas
const fullSchema = mergeRLSSchemas(tenantSchema, roleSchema, customSchema)
```

`defineRLSSchema<DB>(schema: RLSSchema<DB>)` validates the schema and returns it; the table keys are type-constrained to the tables of `DB`. Every listed table must provide `policies` as an **array** — anything else (e.g. `public_content: {}`) throws `RLSSchemaError`. An empty `policies: []` array alone is not full access either: with the default `defaultDeny: true`, mutations on that table are denied because no allow policy can ever match. Full, unfiltered access is expressed by omitting the table from the schema (or via `excludeTables`), or — to keep the table listed explicitly — `{ policies: [], defaultDeny: false }`, which applies no filters and allows all mutations.

## Context Management

RLS uses Node.js `AsyncLocalStorage` to automatically propagate context through async operations without manual parameter passing.

### Setting Context

```typescript
import { rlsContext, createRLSContext } from '@kysera/rls'

// Express middleware
app.use(async (req, res, next) => {
  const user = await authenticate(req)

  await rlsContext.runAsync(
    {
      auth: {
        userId: user.id,
        tenantId: user.tenantId,
        roles: user.roles,
        isSystem: false,
        permissions: user.permissions
      },
      timestamp: new Date()
    },
    async () => {
      next()
    }
  )
})

// Or use the convenience function
import { withRLSContextAsync } from '@kysera/rls'

await withRLSContextAsync(
  { auth: { userId: 1, roles: ['user'], tenantId: 'acme' }, timestamp: new Date() },
  async () => {
    // Your code here
  }
)
```

### RLS Context Structure

```typescript
interface RLSContext<TUser = unknown, TMeta = unknown> {
  auth: RLSAuthContext<TUser> // Required authentication context
  request?: RLSRequestContext // Optional request info (for audit)
  meta?: TMeta // Optional custom metadata
  timestamp?: Date // Context creation timestamp (auto-set to new Date() when omitted)
}
```

### Auth Context Structure

```typescript
interface RLSAuthContext<TUser = unknown> {
  userId: string | number // Required: Unique user identifier
  roles: string[] // Required: User roles array
  tenantId?: string | number // Optional: Tenant ID for multi-tenancy
  organizationIds?: (string | number)[] // Optional: For multi-org scenarios
  permissions?: string[] // Optional: Granular permissions
  attributes?: Record<string, unknown> // Optional: Custom attributes
  user?: TUser // Optional: Full user object
  isSystem?: boolean // Optional: Bypass all policies (default: false)
}
```

### Context Helper Methods

<!-- doc-snippet: skip -->
```typescript
// Get current context (throws if not set)
const ctx = rlsContext.getContext()

// Get current context or null (safe)
const ctx = rlsContext.getContextOrNull()

// Check if context exists
if (rlsContext.hasContext()) {
  // Context is available
}

// Get auth context
const auth = rlsContext.getAuth() // Throws if no context

// Get specific auth properties
const userId = rlsContext.getUserId() // Throws if no context
const tenantId = rlsContext.getTenantId() // Returns undefined if no tenant

// Check roles and permissions
if (rlsContext.hasRole('admin')) {
  // User has admin role
}

if (rlsContext.hasPermission('posts:delete')) {
  // User has specific permission
}

// Check if system context
if (rlsContext.isSystem()) {
  // Running in system/bypass mode
}
```

### System Context (Bypass RLS)

```typescript
// Create system context from existing context
await rlsContext.asSystemAsync(async () => {
  // All policies bypassed - full data access
  const allPosts = await postRepo.findAll()
})

// Synchronous version
const result = rlsContext.asSystem(() => {
  // System operations
  return someValue
})

// Or set isSystem: true directly
await rlsContext.runAsync(
  { auth: { userId: 'system', roles: [], isSystem: true }, timestamp: new Date() },
  async () => {
    // Full access to all data
    const allPosts = await postRepo.findAll()
  }
)
```

**Note:** `asSystem()` and `asSystemAsync()` require an existing RLS context and throw `RLSContextError` if none exists.

## Policy Evaluation

### Context Available in Policies

```typescript
interface PolicyEvaluationContext {
  auth: RLSAuthContext // Authentication context
  row?: Record<string, unknown> // Current row (for update/delete)
  data?: Record<string, unknown> // Input data (for create/update)
  request?: RLSRequestContext // Request context (optional)
  db?: Kysely<DB> // Database instance for complex policies
  meta?: Record<string, unknown> // Custom metadata
  table?: string // Table name
  operation?: string // Operation being performed
}
```

### Policy Evaluation Flow

At initialization the plugin compiles the schema into a `PolicyRegistry` (also exported for advanced use), which groups each table's policies into allows, denies, filters, and validates. Policies are then evaluated differently depending on operation type:

**For SELECT queries (`interceptQuery`):**

```
1. Check bypass conditions (excludeTables, isSystem, bypassRoles)
2. Get filter policies for table → registry.getFilters(table)
3. For each filter:
   - Call filter.getConditions(ctx) → { tenant_id: 1, status: 'active' }
   - Apply as WHERE conditions (AND logic)
4. Return transformed query
```

**For UPDATE/DELETE statements (`interceptQuery`):**

```
1. Check bypass conditions (excludeTables, isSystem, bypassRoles)
2. Get filter policies for table → registry.getFilters(table)
3. Append each filter's conditions to the statement's WHERE clause
   → the mutation can only touch rows the context is allowed to see
```

**For mutations (create/update/delete via `extendRepository`):**

```
1. Check bypass conditions (excludeTables, isSystem, bypassRoles)
2. DENY policies first (highest priority)
   - If ANY deny evaluates to true → RLSPolicyViolation
3. VALIDATE policies (create/update only)
   - ALL validate policies must return true
   - If ANY returns false → RLSPolicyViolation
4. ALLOW policies
   - At least ONE must return true
   - If defaultDeny=true and no allows → RLSPolicyViolation
   - If no allows match → RLSPolicyViolation
```

### Policy Type Summary

| Type         | Operations     | Evaluation              | Behavior              |
| ------------ | -------------- | ----------------------- | --------------------- |
| **filter**   | SELECT + UPDATE/DELETE row scope | `interceptQuery`        | Adds WHERE conditions |
| **deny**     | All mutations  | First in mutation guard | If true → throw       |
| **validate** | create, update | After deny              | All must be true      |
| **allow**    | All mutations  | Last                    | ≥1 must be true       |

## Repository Extensions

When using RLS with Repository pattern, the plugin automatically extends repositories with RLS-aware methods.

### withoutRLS

Execute operations bypassing RLS (requires existing context):

```typescript
// Temporarily bypass RLS for specific operation
const result = await repo.withoutRLS(async () => {
  // No RLS filtering applied
  return repo.findAll()
})
```

**Equivalent to:** `rlsContext.asSystemAsync()`

### canAccess

Check if current user can perform operation on a row:

```typescript
const post = await postRepo.findById(1)

// Check permissions before attempting operation
const canUpdate = await postRepo.canAccess('update', post)
if (canUpdate) {
  await postRepo.update(1, { title: 'New title' })
} else {
  throw new Error('Permission denied')
}

// Check multiple operations
const canDelete = await postRepo.canAccess('delete', post)
const canRead = await postRepo.canAccess('read', post)
```

**Operations:** `'read'`, `'create'`, `'update'`, `'delete'`

**Returns:** `true` if access is allowed, `false` otherwise. Never throws.

### Bulk Mutations

`bulkCreate` / `bulkUpdate` / `bulkDelete` enforce the same value-based
policies as N single-row calls — a bulk mutation is never a policy bypass:

- **bulkCreate** evaluates `validate('create')` / `allow('create')` per input
  (no row fetch involved, so it is unbounded).
- **bulkUpdate / bulkDelete** fetch the affected rows in ONE batched SELECT
  (through the shared per-operation row cache, so rows the audit plugin
  already fetched for old-values capture are reused) and evaluate
  `allow`/`deny`/`validate` per row. Ids that match no row are left to the
  base method's not-found handling, exactly like single-row calls.
- Tables whose policies for the operation are **filter-only** (and not
  default-deny) skip the fetch entirely — `filter()` policies are already
  enforced in SQL for `SELECT`, `UPDATE` and `DELETE` statements.

Per-row evaluation is bounded by `maxBulkRowChecks` (default `1000`). A
larger batch throws `RLSPolicyEvaluationError` instead of silently degrading:

<!-- doc-snippet: skip -->
```typescript
// RLSPolicyEvaluationError: bulk mutation targets 5000 rows, but value-based
// policies (...) require per-row evaluation, bounded at maxBulkRowChecks=1000.
// Split the call into smaller batches, raise 'maxBulkRowChecks', or express
// the policy as filter() so it is enforced in SQL without row fetches.
await repo.bulkUpdate(fiveThousandUpdates)
```

:::caution Soft-delete bulk methods
The soft-delete plugin's own methods (`softDelete`, `restore`,
`softDeleteMany`, `restoreMany`, `hardDelete`, `hardDeleteMany`) are scoped
by `filter()` policies at the SQL level, but value-based `allow`/`deny`
policies do NOT run for them (the soft-delete plugin extends repositories
after RLS, so RLS cannot wrap methods that do not exist yet). Express
soft-delete access rules as `filter()` policies, or gate those calls with
`canAccess()`.
:::

Like the single-row wrappers, bulk checks are check-then-act: run them inside
a transaction when concurrent writers could change row ownership between the
check and the mutation (TOCTOU).

## Multi-Tenant Patterns

### Discriminator Column

<!-- doc-snippet: skip -->
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
// Extract tenant from subdomain
const tenantId = extractTenantFromSubdomain(req.hostname)
// 'acme.app.com' → 'acme'

await rlsContext.runAsync({ auth: { userId: user.id, tenantId, roles: user.roles } }, async () => {
  // All queries scoped to tenant
})
```

## Error Handling

```typescript
import {
  RLSError,
  RLSPolicyViolation,
  RLSPolicyEvaluationError,
  RLSContextError
} from '@kysera/rls'

try {
  await postRepo.delete(postId)
} catch (error) {
  if (error instanceof RLSPolicyViolation) {
    // User doesn't have permission (legitimate access denial)
    res.status(403).json({ error: 'Permission denied' })
  }
  if (error instanceof RLSPolicyEvaluationError) {
    // Bug in policy code - should be investigated
    logger.error('Policy evaluation error:', {
      operation: error.operation,
      table: error.table,
      policyName: error.policyName,
      originalError: error.originalError
    })
    res.status(500).json({ error: 'Internal server error' })
  }
  if (error instanceof RLSContextError) {
    // No RLS context set
    res.status(401).json({ error: 'Not authenticated' })
  }
}
```

### Error Types

All RLS errors extend `RLSError`, which itself extends `DatabaseError` from `@kysera/core` — so existing `instanceof DatabaseError` handling catches them alongside other Kysera database errors.

**`RLSPolicyViolation`**

- Thrown when access is legitimately denied by a policy
- User doesn't have permission for the operation
- Carries `operation`, `table`, `reason`, and optionally `policyName` (no user information)
- Should result in a 403 response

**`RLSPolicyEvaluationError`**

- Thrown when a policy condition throws an error during evaluation
- Indicates a bug in the policy code itself
- Preserves original stack trace for debugging
- Should result in a 500 response and investigation

**Example:**

<!-- doc-snippet: skip -->
```typescript
// A policy with a bug
allow('read', ctx => {
  return ctx.row.someField.value // Throws if someField is undefined
})

// This will throw RLSPolicyEvaluationError, not RLSPolicyViolation
// The error includes:
// - operation: 'read'
// - table: 'posts'
// - policyName: (if available)
// - originalError: The original TypeError
```

**`RLSContextError`**

- Thrown when RLS context is missing
- Operation requires authentication but no context was set
- Default message: `"No RLS context found. Ensure code runs within withRLSContext()"` (a custom message can be passed)
- Should result in a 401 response

## DAL Pattern Support

RLS filtering works automatically with DAL pattern through `@kysera/executor` query interception.

### Usage with DAL

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
const getAllPosts = createQuery((ctx: DbContext<Database>) => ctx.db.selectFrom('posts').selectAll().execute())

const getPostById = createQuery((ctx: DbContext<Database>, id: number) =>
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

### What Works with DAL

| Feature                               | Works in DAL? | Notes                                |
| ------------------------------------- | ------------- | ------------------------------------ |
| `rlsContext.runAsync()`               | ✅ Yes        | Context management                   |
| `rlsContext.getContextOrNull()`       | ✅ Yes        | Context access                       |
| `rlsContext.asSystemAsync()`          | ✅ Yes        | System bypass                        |
| **Automatic SELECT filtering**        | ✅ **Yes**    | Via `interceptQuery`                 |
| **UPDATE/DELETE row-scope filtering** | ✅ **Yes**    | Filter predicates appended to WHERE  |
| Value-level mutation validation       | ❌ No         | Repository only (`extendRepository`) |
| INSERT policy checks                  | ❌ No         | No WHERE to narrow — use Repository  |
| `repo.withoutRLS()`                   | ❌ No         | Repository method only               |
| `repo.canAccess()`                    | ❌ No         | Repository method only               |

:::warning INSERT via DAL is not policy-checked
An INSERT statement has no WHERE clause for RLS to narrow, and builder-level
interception cannot see the values passed later to `.values()`. Route inserts
through repositories (where `allow`/`validate`/`deny` policies run), or add
database-native RLS as a backstop.
:::

### Filter vs Validation Policies

- **Filter policies** (`filter()`) work in **both Repository and DAL** — applied via `interceptQuery()`
  to SELECT **and, since v0.9, to UPDATE/DELETE row scope**
- **Validation policies** (`allow()`, `deny()`, `validate()`) work in **Repository only** — applied via `extendRepository()`

For comprehensive comparison, see [Repository vs DAL Guide](/docs/guides/dal-vs-repository).

## How RLS Works

The RLS plugin implements row-level security at the **application layer** using `@kysera/executor` for query transformations:

### Architecture

1. **createORM** or **createExecutor** creates a plugin-aware executor
2. The executor wraps Kysely with a Proxy that intercepts query methods
3. RLS plugin's `interceptQuery` hook is called for every query operation
4. For SELECT queries, filter policies add WHERE conditions
5. For UPDATE/DELETE statements, filter predicates are appended to the WHERE clause in `interceptQuery` (v0.9), so mutations can only touch rows the context is allowed to see
6. Value-level mutation policies (`allow`/`deny`/`validate`) remain Repository-only, applied in `extendRepository`
7. **Works with both Repository and DAL patterns** via unified Plugin interface

### Query Interception

<!-- doc-snippet: skip -->
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

- `selectFrom` → Automatic filtering via `interceptQuery` (works in both Repository and DAL)
- `insertInto` → Context available; value-level policy checks run in `extendRepository` (Repository only)
- `updateTable` → Filter predicates appended to WHERE in `interceptQuery` (v0.9); value-level allow/validate policies remain Repository-only
- `deleteFrom` → Filter predicates appended to WHERE in `interceptQuery` (v0.9); value-level allow/validate policies remain Repository-only

### getRawDb() for Internal Queries

When implementing RLS policies that need to fetch existing rows (e.g., for update/delete validation), the plugin uses `getRawDb()` from `@kysera/executor` to bypass RLS filtering and prevent infinite recursion:

<!-- doc-snippet: skip -->
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

:::tip PostgreSQL Native RLS
For database-level enforcement — defense in depth, or coverage of code paths that bypass the executor entirely — combine this plugin with PostgreSQL's native RLS. You don't need to hand-write `CREATE POLICY` SQL: the [`@kysera/rls/native` subpath](#database-native-rls-kyserarlsnative) generates the statements from the same schema and syncs the RLS context to `current_setting()` values.
:::

## Best Practices

### 1. Always Set Context with Timestamp

```typescript
// Every request should have RLS context
app.use(async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  await rlsContext.runAsync(
    {
      auth: {
        userId: req.user.id,
        roles: req.user.roles,
        tenantId: req.user.tenantId,
        isSystem: false
      },
      timestamp: new Date() // Always include timestamp
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
    await runMigration()
  }
)
```

### 3. Validate Context Requirements

`createRLSContext(options: CreateRLSContextOptions)` accepts `{ auth, request?, meta? }`, validates the auth context, and sets `timestamp` for you:

```typescript
// Use createRLSContext for validation
import { createRLSContext } from '@kysera/rls'

try {
  const ctx = createRLSContext({
    auth: {
      userId: user.id,
      roles: user.roles, // Required array
      tenantId: user.tenantId
    }
  })
  // Context is valid, timestamp added automatically
} catch (error) {
  // Will throw RLSContextValidationError if invalid
  console.error('Invalid RLS context:', error)
}
```

### 4. Test Policies Thoroughly

```typescript
describe('Post RLS Policies', () => {
  it('should filter by tenant', async () => {
    await rlsContext.runAsync(
      {
        auth: { userId: 1, tenantId: 'acme', roles: ['user'] },
        timestamp: new Date()
      },
      async () => {
        const posts = await postRepo.findAll()
        expect(posts.every(p => p.tenant_id === 'acme')).toBe(true)
      }
    )
  })

  it('should enforce ownership policies', async () => {
    await rlsContext.runAsync(
      {
        auth: { userId: 2, tenantId: 'acme', roles: ['user'] },
        timestamp: new Date()
      },
      async () => {
        const post = await postRepo.findById(1) // Owned by user 1
        const canUpdate = await postRepo.canAccess('update', post)
        expect(canUpdate).toBe(false)
      }
    )
  })

  it('should work with DAL queries', async () => {
    await rlsContext.runAsync(
      {
        auth: { userId: 1, tenantId: 'acme', roles: ['user'] },
        timestamp: new Date()
      },
      async () => {
        const posts = await getAllPosts(createContext(executor))
        expect(posts.every(p => p.tenant_id === 'acme')).toBe(true)
      }
    )
  })
})
```

### 5. Use Named Policies for Debugging

<!-- doc-snippet: skip -->
```typescript
const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }), {
        name: 'tenant-isolation',
        priority: 1000
      }),
      allow('update', ctx => ctx.auth.userId === ctx.row?.author_id, {
        name: 'author-ownership'
      }),
      deny('delete', ctx => ctx.row?.status === 'published', {
        name: 'prevent-delete-published',
        priority: 200
      })
    ]
  }
})
```

Named policies provide better error messages and audit logs.

## Complete Usage Examples

### Multi-Tenant SaaS Application

<!-- doc-snippet: skip -->
```typescript
import { createORM } from '@kysera/repository'
import { rlsPlugin, defineRLSSchema, filter, allow, deny, validate, rlsContext } from '@kysera/rls'

interface Database {
  users: { id: number; email: string; tenant_id: number; role: string }
  resources: { id: number; name: string; owner_id: number; tenant_id: number; is_archived: boolean }
  posts: { id: number; title: string; user_id: number; tenant_id: number; status: string }
}

// Define RLS schema
const rlsSchema = defineRLSSchema<Database>({
  users: {
    policies: [
      // Tenant isolation for all reads
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      // Users can update their own profile
      allow('update', ctx => ctx.auth.userId === ctx.row?.id),
      // Admins can update any user in their tenant
      allow('update', ctx => ctx.auth.roles.includes('admin')),
      // Only admins can delete users
      allow('delete', ctx => ctx.auth.roles.includes('admin')),
      // Cannot delete yourself
      deny('delete', ctx => ctx.auth.userId === ctx.row?.id, {
        name: 'prevent-self-delete',
        priority: 200
      })
    ],
    skipFor: ['superadmin'], // Superadmins bypass all RLS
    defaultDeny: true
  },
  resources: {
    policies: [
      // Tenant isolation
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      // Owners have full access
      allow('all', ctx => ctx.auth.userId === ctx.row?.owner_id),
      // Admins have full access
      allow('all', ctx => ctx.auth.roles.includes('admin')),
      // Deny archived resources for non-admins (except read)
      deny(['update', 'delete'], ctx => ctx.row?.is_archived && !ctx.auth.roles.includes('admin'))
    ],
    defaultDeny: true
  },
  posts: {
    policies: [
      // Tenant isolation
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      // Authors can manage their posts
      allow(['update', 'delete'], ctx => ctx.auth.userId === ctx.row?.user_id),
      // Editors can update any post
      allow('update', ctx => ctx.auth.roles.includes('editor')),
      // Cannot delete published posts
      deny('delete', ctx => ctx.row?.status === 'published'),
      // Validate tenant_id on create
      validate('create', ctx => ctx.data?.tenant_id === ctx.auth.tenantId)
    ]
  }
})

// Create repository manager with RLS
const orm = await createORM(db, [rlsPlugin({ schema: rlsSchema })])
const postRepo = orm.createRepository(createPostRepository)

// Express middleware
app.use(async (req, res, next) => {
  const user = await authenticate(req)

  await rlsContext.runAsync(
    {
      auth: {
        userId: user.id,
        roles: user.roles,
        tenantId: user.tenantId,
        isSystem: false
      },
      timestamp: new Date()
    },
    next
  )
})

// Usage in routes
app.get('/api/posts', async (req, res) => {
  // Automatically filtered by tenant_id
  const posts = await postRepo.findAll()
  res.json(posts)
})

app.put('/api/posts/:id', async (req, res) => {
  try {
    const post = await postRepo.findById(req.params.id)

    // Check access before updating
    const canUpdate = await postRepo.canAccess('update', post)
    if (!canUpdate) {
      return res.status(403).json({ error: 'Permission denied' })
    }

    const updated = await postRepo.update(req.params.id, req.body)
    res.json(updated)
  } catch (error) {
    if (error instanceof RLSPolicyViolation) {
      return res.status(403).json({ error: error.message })
    }
    throw error
  }
})
```

### Role-Based Access Control (RBAC)

<!-- doc-snippet: skip -->
```typescript
import { defineRLSSchema, allow, deny, filter } from '@kysera/rls'

const rbacSchema = defineRLSSchema<Database>({
  documents: {
    policies: [
      // Admins see everything
      allow('all', ctx => ctx.auth.roles.includes('admin')),

      // Editors can read and update
      allow(['read', 'update'], ctx => ctx.auth.roles.includes('editor')),

      // Viewers can only read
      allow('read', ctx => ctx.auth.roles.includes('viewer')),

      // Authors can manage their own documents
      allow('all', ctx => ctx.auth.userId === ctx.row?.author_id),

      // Hide draft documents from viewers
      filter('read', ctx => (ctx.auth.roles.includes('viewer') ? { status: 'published' } : {})),

      // Prevent deletion of published documents
      deny('delete', ctx => ctx.row?.status === 'published')
    ],
    defaultDeny: true
  }
})
```

### Using with DAL Pattern

```typescript
import { createQuery, createContext, withTransaction } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { rlsPlugin, rlsContext } from '@kysera/rls'

// Create executor with RLS
const executor = await createExecutor(db, [rlsPlugin({ schema: rlsSchema })])

// Define DAL queries
const getUserPosts = createQuery((ctx: DbContext<Database>, userId: number) =>
  ctx.db.selectFrom('posts').where('user_id', '=', userId).selectAll().execute()
)

const getDashboardStats = createQuery(async (ctx: DbContext<Database>, userId: number) => {
  // All queries automatically get RLS filtering
  const posts = await ctx.db.selectFrom('posts').selectAll().execute()
  const resources = await ctx.db.selectFrom('resources').selectAll().execute()

  return {
    totalPosts: posts.length,
    totalResources: resources.length,
    userPosts: posts.filter(p => p.user_id === userId).length
  }
})

// Use within RLS context
await rlsContext.runAsync(
  {
    auth: { userId: 1, tenantId: 'acme', roles: ['user'] },
    timestamp: new Date()
  },
  async () => {
    const ctx = createContext(executor)

    // RLS filtering applied automatically
    const posts = await getUserPosts(ctx, 1)
    const stats = await getDashboardStats(ctx, 1)

    // Works in transactions too
    await withTransaction(executor, async txCtx => {
      const newPost = await txCtx.db
        .insertInto('posts')
        .values({ title: 'New Post', user_id: 1, tenant_id: 'acme' })
        .returningAll()
        .executeTakeFirst()

      // RLS filtering still active
      const allPosts = await getUserPosts(txCtx, 1)
    })
  }
)
```

### CQRS-lite Pattern (Repository + DAL)

```typescript
import { createORM } from '@kysera/repository'
import { createQuery, createContext } from '@kysera/dal'
import { rlsPlugin, rlsContext } from '@kysera/rls'

const orm = await createORM(db, [rlsPlugin({ schema: rlsSchema })])

// DAL for complex reads
const getPostAnalytics = createQuery(async (ctx: DbContext<Database>, postId: number) => {
  const post = await ctx.db
    .selectFrom('posts')
    .where('id', '=', postId)
    .selectAll()
    .executeTakeFirst()

  const comments = await ctx.db
    .selectFrom('comments')
    .where('post_id', '=', postId)
    .selectAll()
    .execute()

  return {
    post,
    commentCount: comments.length,
    authors: [...new Set(comments.map(c => c.author_id))]
  }
})

// Use both patterns in same transaction
await rlsContext.runAsync(
  {
    auth: { userId: 1, tenantId: 'acme', roles: ['user'] },
    timestamp: new Date()
  },
  async () => {
    await orm.transaction(async ctx => {
      // Repository for writes
      const postRepo = orm.createRepository(createPostRepository)
      const post = await postRepo.create({
        title: 'New Post',
        user_id: 1,
        tenant_id: 'acme',
        status: 'draft'
      })

      // DAL for complex reads (same transaction, same RLS context)
      const analytics = await getPostAnalytics(ctx, post.id)

      console.log(`Created post with ${analytics.commentCount} comments`)
    })
  }
)
```

## Migration from v0.7

### Breaking Change: `requireContext` Default

**What changed:**
- v0.7.x: `requireContext` defaults to `false` (permissive)
- v0.8.0+: `requireContext` defaults to `true` (secure-by-default)

**Why it changed:**
The previous default allowed queries without RLS context, which could lead to accidental data leaks in multi-tenant applications. The new default ensures all queries have proper context.

**Migration strategies:**

#### Strategy 1: Add RLS Context Everywhere (Recommended)

Update your application to always provide RLS context:

```typescript
// Before v0.8.0 (worked without context)
const posts = await postRepo.findAll()

// After v0.8.0 (requires context)
await rlsContext.runAsync(
  {
    auth: {
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles
    },
    timestamp: new Date()
  },
  async () => {
    const posts = await postRepo.findAll()
  }
)
```

**Pros:** Most secure, explicit context, catches missing context at runtime
**Cons:** Requires code changes throughout your application

#### Strategy 2: Use System Context for Background Jobs

Keep secure defaults but use system context for privileged operations:

```typescript
// Plugin config (secure defaults)
const orm = await createORM(db, [
  rlsPlugin({ schema: rlsSchema })
])
const postRepo = orm.createRepository(createPostRepository)

// User requests (require context)
app.get('/api/posts', async (req, res) => {
  await rlsContext.runAsync(userContext, async () => {
    const posts = await postRepo.findAll()
    res.json(posts)
  })
})

// Background jobs (explicit system context)
async function cleanupJob() {
  await rlsContext.runAsync(
    {
      auth: { userId: 'system', roles: [], isSystem: true },
      timestamp: new Date()
    },
    async () => {
      const expired = await postRepo.findAll()
      // ... cleanup logic
    }
  )
}
```

**Pros:** Secure by default, explicit intent for privileged access
**Cons:** Requires wrapping background jobs in system context

#### Strategy 3: Opt Out of Secure Defaults (Not Recommended)

Restore the old behavior by explicitly setting `requireContext: false`:

```typescript
// ⚠️ Not recommended - only for temporary migration
const orm = await createORM(db, [
  rlsPlugin({
    schema: rlsSchema,
    requireContext: false,      // Restore old behavior
    allowUnfilteredQueries: true // Allow queries without context
  })
])
```

**Pros:** No code changes required
**Cons:** Not secure, can leak data, defeats the purpose of RLS

**Use this only as a temporary measure during migration, then switch to Strategy 1 or 2.**

### Breaking Change: `skipTables` Removed

**What changed in v0.8.0:**
- The deprecated `skipTables` option has been removed
- Use `excludeTables` instead for table exclusion

**Migration:**

<!-- doc-snippet: skip -->
```typescript
// ❌ No longer supported (removed in v0.8.0)
rlsPlugin({
  schema: rlsSchema,
  skipTables: ['migrations', 'audit_logs', 'system_config']
})

// ✅ Use excludeTables instead
rlsPlugin({
  schema: rlsSchema,
  excludeTables: ['migrations', 'audit_logs', 'system_config']
})
```

**Migration checklist:**

1. Search for `skipTables` in your codebase
2. Replace all instances with `excludeTables`
3. Test that excluded tables still bypass RLS

### Testing Your Migration

After upgrading to v0.8.0, test these scenarios:

**1. User Queries Require Context**
```typescript
// Should throw RLSContextError (if requireContext: true)
try {
  await postRepo.findAll() // ❌ No context
} catch (error) {
  if (error instanceof RLSContextError) {
    console.log('✅ Correctly requires context')
  }
}
```

**2. System Context Bypasses RLS**
```typescript
// Should allow full access
await rlsContext.asSystemAsync(async () => {
  const allPosts = await postRepo.findAll() // ✅ System access
  console.log('✅ System context works')
})
```

**3. Excluded Tables Bypass RLS**
```typescript
// Should work without context (if in excludeTables)
const migrationRepo = orm.createRepository(createMigrationRepository)
const migrations = await migrationRepo.findAll() // ✅ Excluded table
console.log('✅ Excluded tables work')
```

**4. User Context Filters Correctly**
```typescript
await rlsContext.runAsync(
  {
    auth: { userId: 1, tenantId: 'acme', roles: ['user'] },
    timestamp: new Date()
  },
  async () => {
    const posts = await postRepo.findAll()
    // Should only return posts for tenant 'acme'
    console.log('✅ RLS filtering works', posts.every(p => p.tenant_id === 'acme'))
  }
)
```

## Advanced Features

The RLS plugin includes enterprise-grade features for complex authorization scenarios. The sections below cover the primary surface; see the package's index export for the full set of helper types and utilities.

### Context Resolvers

Pre-fetch and cache async data (like organization memberships) before policy evaluation. This keeps policies synchronous and fast.

```typescript
import {
  createResolverManager,
  createResolver,
  type EnhancedRLSContext
} from '@kysera/rls'

const orgResolver = createResolver({
  name: 'org-memberships',
  resolve: async (ctx) => {
    const memberships = await db
      .selectFrom('organization_members')
      .where('user_id', '=', ctx.auth.userId)
      .select(['organization_id', 'role'])
      .execute()
    return {
      resolvedAt: new Date(),
      organizationIds: memberships.map(m => m.organization_id)
    }
  },
  cacheKey: (ctx) => `rls:org:${ctx.auth.userId}`,
  cacheTtl: 300
})

const manager = createResolverManager({ parallelResolution: true })
manager.register(orgResolver)

// Resolve context before using RLS
const enhancedCtx = await manager.resolve(baseCtx)

await rlsContext.runAsync(enhancedCtx, async () => {
  // Policies can access ctx.auth.resolved.organizationIds synchronously
  const posts = await postRepo.findAll()
})
```

`cacheKey` may return `undefined` to disable caching for a given context; `cacheTtl` is in seconds (default 300).

### Field-Level Access Control

Control access to individual columns with masking support.

:::caution Standalone API
Field-level access control is **not wired into `rlsPlugin()`** — queries do not
mask columns automatically. Create the registry and processor yourself and call
`maskRows()` on query results manually.
:::

<!-- doc-snippet: skip -->
```typescript
import {
  createFieldAccessRegistry,
  createFieldAccessProcessor,
  ownerOnly,
  rolesOnly,
  maskedField
} from '@kysera/rls'

const fieldSchema = {
  users: {
    fields: {
      email: ownerOnly('id'),
      salary: rolesOnly(['hr', 'admin']),
      // maskedField takes a masking FUNCTION and a read condition
      ssn: maskedField(
        () => '***-**-****',
        ctx => String(ctx.auth.userId) === String(ctx.row?.id)
      )
    }
  }
}

const registry = createFieldAccessRegistry(fieldSchema)
// Optional second argument: defaultMaskValue used for inaccessible fields (default: null)
const processor = createFieldAccessProcessor(registry)

// Reads the active RLS context — call inside rlsContext.runAsync(...)
const masked = await processor.maskRows('users', rows, { includeMetadata: true })
// Each entry is a MaskedRow wrapper:
// { data: { ...row with masking applied }, maskedFields: ['ssn'], omittedFields: [] }
const safeRows = masked.map(m => m.data)
```

Per-field config is `{ read?, write?, maskedValue?, omitWhenHidden? }` (conditions may be async); per-table config supports `default: 'allow' | 'deny'` for unconfigured fields and `skipFor` bypass roles.

**Processor methods** (the context always comes from AsyncLocalStorage, never as a parameter):

- `maskRow(table, row, options?)` / `maskRows(table, rows, options?)` → `Promise<MaskedRow<T>>` (or an array of them)
- `validateWrite(table, data, existingRow?)` — throws `RLSPolicyViolation` if any field in `data` is not writable
- `filterWritableFields(table, data, existingRow?)` → `{ data, removedFields }` — strips unwritable fields instead of throwing
- `getReadableFields(table, row)` / `getWritableFields(table, row)` → `Promise<string[]>`

The registry exposes `canReadField(table, field, ctx)` and `canWriteField(table, field, ctx)` — both async, taking a `PolicyEvaluationContext` and returning `Promise<boolean>` — plus `getFieldConfig`, `getTableConfig`, `getConfiguredFields`, and `clear()`.

**Predefined Patterns:**

- `ownerOnly(ownerField = 'id')` - Only the row owner can read/write
- `ownerOrRoles(roles, ownerField = 'id')` - Owner or the listed roles
- `rolesOnly(roles)` - Only specified roles
- `readOnly(readCondition?)` - Readable (optionally gated), never writable
- `neverAccessible()` - Never readable or writable (field omitted from results)
- `maskedField(maskFn, readCondition)` - Applies `maskFn(value)` unless the read condition passes
- `publicReadRestrictedWrite(writeCondition)` - Anyone reads, the condition gates writes

### Relationship-Based Access Control (ReBAC)

Define access based on relationships using EXISTS subqueries.

:::caution Standalone API
ReBAC is **not wired into `rlsPlugin()`** — relationship policies are not
applied to intercepted queries. Create the registry and transformer yourself
and run queries through `transform()` manually.
:::

```typescript
import {
  createReBAcRegistry,
  createReBAcTransformer,
  shopOrgMembershipPath,
  allowRelation
} from '@kysera/rls'

const rebacSchema = {
  products: {
    relationships: [
      shopOrgMembershipPath('products', 'shop_id')
    ],
    policies: [
      allowRelation('read', 'products_shop_org_membership', ctx => ({
        user_id: ctx.auth.userId,
        status: 'active'
      }))
    ]
  }
}

const registry = createReBAcRegistry(rebacSchema)
const transformer = createReBAcTransformer(registry) // options?: { dialect?, qualifyColumns?, mainTableAlias? }

// Adds an EXISTS subquery for the relationship check
// (reads the RLS context from AsyncLocalStorage)
const products = await transformer
  .transform(db.selectFrom('products').selectAll(), 'products', 'read')
  .execute()
```

`transform(qb, table, operation = 'read')` applies every matching relationship policy to the query builder. For debugging or manual SQL assembly, `generateExistsSql(policy, ctx, mainTable, mainTableAlias?)` returns the raw `{ sql, params }` for one policy's EXISTS condition.

`allowRelation(operation, relationshipPath, endCondition, options?)` and `denyRelation(...)` take the end condition as either a plain object or a function `(ctx) => Record<string, unknown>` — there is no dedicated end-condition type — plus optional `{ name?, priority? }`. Deny policies default to priority 100 and generate `NOT EXISTS`.

### Policy Composition

Create reusable policy templates.

```typescript
import {
  createTenantIsolationPolicy,
  createOwnershipPolicy,
  createSoftDeletePolicy,
  composePolicies
} from '@kysera/rls'

const tenantPolicy = createTenantIsolationPolicy({ tenantColumn: 'tenant_id' })
const ownerPolicy = createOwnershipPolicy({ ownerColumn: 'user_id' })
const softDeletePolicy = createSoftDeletePolicy({ deletedColumn: 'deleted_at' })

const combinedPolicy = composePolicies('post-access', [tenantPolicy, ownerPolicy, softDeletePolicy])

const schema = defineRLSSchema({
  posts: {
    policies: combinedPolicy.policies,
    defaultDeny: true
  }
})
```

**Prebuilt templates** (each returns a `ReusablePolicy` whose `policies` array plugs into the schema):

- `createTenantIsolationPolicy({ tenantColumn?, operations?, validateOnMutation? })` — filters reads by `tenantColumn` (default `'tenant_id'`); with `validateOnMutation: true` (default) also validates that creates set the caller's tenant and updates don't change it
- `createOwnershipPolicy({ ownerColumn?, ownerOperations?, canDelete? })` — allows `ownerOperations` (default `['read', 'update', 'delete']`) when the row's `ownerColumn` (default `'owner_id'`) matches the caller; `canDelete: false` (default `true`) adds an explicit delete deny
- `createSoftDeletePolicy({ deletedColumn?, filterOnRead?, preventHardDelete? })` — with `filterOnRead: true` (default) filters reads to rows where `deletedColumn` (default `'deleted_at'`) is null; `preventHardDelete: true` (default) denies deletes
- `createStatusAccessPolicy({ statusColumn?, publicStatuses?, editableStatuses?, deletableStatuses? })` — allows public reads for `publicStatuses` and denies updates/deletes outside `editableStatuses`/`deletableStatuses` on `statusColumn` (default `'status'`)
- `createAdminPolicy(roles: string[])` — allows all operations for the given roles

**Building your own templates:**

- `definePolicy({ name, description?, tags? }, policies: PolicyDefinition[])` — wrap raw policy definitions into a named `ReusablePolicy`
- `defineFilterPolicy(name, filterFn, options?)`, `defineAllowPolicy(name, operation, condition, options?)`, `defineDenyPolicy(name, operation, condition?, options?)`, `defineValidatePolicy(name, operation, condition, options?)`
- `defineCombinedPolicy(name, { filter?, allow?, deny?, validate? })` — several policy types in one call; `allow`/`deny` take operation-keyed condition maps and `validate` takes `{ create?, update? }`

**Composing and adapting:**

- `composePolicies(name: string, policies: ReusablePolicy[])` — concatenates the policies of several templates under a new name
- `extendPolicy(base, additional: PolicyDefinition[])` — appends policies to a template
- `overridePolicy(base, overrides: Record<string, PolicyDefinition>)` — replaces a template's policies by their `name`

### Audit Trail

Log all policy decisions with buffering and sampling.

```typescript
import {
  createAuditLogger,
  ConsoleAuditAdapter
} from '@kysera/rls'

const auditLogger = createAuditLogger({
  adapter: new ConsoleAuditAdapter({ format: 'json' }),
  bufferSize: 100,
  flushInterval: 5000,
  defaults: {
    logAllowed: false,
    logDenied: true
  },
  tables: {
    sensitive_data: { logAllowed: true }
  }
})

await auditLogger.logAllow('read', 'posts', 'ownership-allow')
await auditLogger.logDeny('delete', 'posts', 'status-check', {
  reason: 'Cannot delete published posts'
})
```

### Policy Testing

Unit test policies without a database.

```typescript
import {
  createPolicyTester,
  createTestAuthContext,
  createTestRow,
  policyAssertions
} from '@kysera/rls'

const tester = createPolicyTester(rlsSchema)

it('should allow owner to update', async () => {
  const result = await tester.evaluate('posts', 'update', {
    auth: createTestAuthContext({ userId: 'user-1', roles: ['user'] }),
    row: createTestRow({ author_id: 'user-1' })
  })

  policyAssertions.assertAllowed(result)
})

it('should apply tenant filter', () => {
  const filters = tester.getFilters('posts', 'read', {
    auth: createTestAuthContext({ userId: 'user-1', tenantId: 'tenant-1' })
  })

  policyAssertions.assertFiltersInclude(filters, { tenant_id: 'tenant-1' })
})
```

### Conditional Policy Activation

Attach activation conditions to policies for environment-, feature-flag-, or time-gated behavior.

<!-- doc-snippet: skip -->
```typescript
import {
  whenEnvironment,
  whenFeature,
  whenTimeRange,
  whenCondition
} from '@kysera/rls'

const schema = defineRLSSchema({
  posts: {
    policies: [
      // Only in these environments (takes an ARRAY of environment names)
      whenEnvironment(['production'], () =>
        filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
      ),

      // Feature flag controlled (features can be a Set, array, or object map)
      whenFeature('strict-rls', () =>
        deny('delete', ctx => ctx.row?.status === 'published')
      ),

      // Time window: start hour inclusive, end hour exclusive;
      // supports overnight ranges (e.g. 22 → 6)
      whenTimeRange(9, 18, () =>
        allow('create', ctx => ctx.auth.roles.includes('user'))
      ),

      // Arbitrary activation condition
      whenCondition(ctx => ctx.meta?.['betaUser'] === true, () =>
        allow('read', () => true)
      )
    ]
  }
})
```

Each helper wraps the policy returned by `policyFn` and sets its `activationCondition` — the same field the builders accept directly via `options.condition`:

```typescript
// Equivalent: set the activation condition directly on any builder
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }), {
  condition: actx => actx.environment === 'production'
})
```

Activation conditions receive a `PolicyActivationContext`, a standalone type (it does **not** extend `PolicyEvaluationContext`):

```typescript
interface PolicyActivationContext {
  environment?: string // e.g. 'production'
  features?: Set<string> | string[] | Record<string, unknown>
  timestamp?: Date
  meta?: Record<string, unknown>
  auth?: { userId?: string | number; roles?: string[]; isSystem?: boolean; [key: string]: unknown }
}
```

`rlsPlugin()` evaluates activation conditions at enforcement time, on every call where policies are resolved. A policy whose condition returns `false` is treated as **absent** for that call: an absent `allow` under `defaultDeny` still denies, while an absent `deny`/`filter`/`validate` simply doesn't constrain.

The activation context is assembled per call from these sources:

- `environment` — the plugin's `activation.environment` option, falling back to the `NODE_ENV` environment variable
- `features` — the plugin's `activation.features` option (feature flags have no environment fallback)
- `timestamp` — the current time at query/mutation time (so `whenTimeRange` gates follow the clock, not the context's creation time)
- `auth` / `meta` — the active RLS context; `meta` merges the plugin's static `activation.meta` with the context's per-request `meta` (the context wins on conflicts)

```typescript
const orm = await createORM(db, [
  rlsPlugin({
    schema,
    activation: {
      environment: config.env,          // default: NODE_ENV
      features: { 'strict-rls': true }, // Set, array, or object map
      meta: { region: 'eu' }
    }
  })
])
```

:::info Sync-only, fail-active on error
Activation conditions must be **synchronous** — they run inside query transformation. Async conditions are rejected with `RLSSchemaError` at plugin init (or on first use, if a non-`async` function returns a Promise). A condition that **throws** fails closed: the policy is treated as **active** — the most restrictive interpretation, so a broken gate never silently widens access — and the error is logged through the plugin logger. Resolve async inputs (flag services, config stores) before defining the policy and close over the result.
:::

### Database-Native RLS (`@kysera/rls/native`)

The `@kysera/rls/native` subpath generates PostgreSQL-native RLS from the same schema, so the database enforces isolation even for connections that bypass the executor:

- `PostgresRLSGenerator` — `generateStatements(schema, options?)` emits `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY` plus `CREATE POLICY` statements; `generateDropStatements(schema, options?)` produces the teardown. Only `allow`/`deny` policies that carry `using` / `withCheck` SQL are translated (deny becomes `AS RESTRICTIVE`, `role` becomes the `TO` clause) — `filter`/`validate` policies stay application-side. Options: `{ force?, schemaName?, policyPrefix? }`.
- `RLSMigrationGenerator` — `generateMigration(schema, { name?, includeContextFunctions?, ...PostgresRLSOptions })` wraps the generator into a complete up/down migration script.
- `syncContextToPostgres(db, { userId, tenantId?, roles?, permissions?, isSystem? })` — sets `app.user_id`, `app.tenant_id`, `app.roles`, `app.permissions`, and `app.is_system` via `set_config(..., true)` (transaction-scoped), so native policies can read them with `current_setting()`.
- `clearPostgresContext(db)` — resets those settings.

<!-- doc-snippet: skip -->
```typescript
import { PostgresRLSGenerator, syncContextToPostgres } from '@kysera/rls/native'

const generator = new PostgresRLSGenerator()
const statements = generator.generateStatements(rlsSchema, { schemaName: 'public' })

// Per request/transaction, before running queries:
await syncContextToPostgres(trx, { userId: user.id, tenantId: user.tenantId })
```

## See Also

- [Plugin Overview](/docs/plugins/overview)
- [Plugin Authoring Guide](/docs/plugins/authoring-guide)
- [@kysera/rls API Reference](/docs/api/rls)
- [@kysera/executor API Reference](/docs/api/executor)
- [@kysera/dal API Reference](/docs/api/dal)
- [Repository vs DAL Guide](/docs/guides/dal-vs-repository)
