---
sidebar_position: 5
title: Row-Level Security
description: Row-level security plugin for multi-tenant applications
---

# Row-Level Security (RLS) Plugin

Implement declarative authorization policies for multi-tenant applications with automatic query transformation.

## Installation

```bash
npm install @kysera/rls
```

## Basic Usage

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
      allow(['update', 'delete'], ctx =>
        ctx.auth.userId === ctx.row?.author_id
      ),

      // Only published posts visible to non-admins
      filter('read', ctx =>
        ctx.auth.roles?.includes('admin') ? {} : { status: 'published' }
      ),
    ],
    defaultDeny: true,
  },
})

// Create ORM with RLS
const orm = await createORM(db, [
  rlsPlugin({ schema: rlsSchema })
])

// Use within RLS context
await rlsContext.runAsync(
  { auth: { userId: 1, tenantId: 'acme', roles: ['user'] } },
  async () => {
    // All queries automatically filtered by tenant_id
    const posts = await postRepo.findAll()
  }
)
```

## Configuration

### Plugin Options

```typescript
interface RLSPluginOptions<DB = unknown> {
  schema: RLSSchema<DB>           // RLS policy schema
  skipTables?: string[]           // Tables to exclude from RLS entirely
  bypassRoles?: string[]          // Roles that bypass RLS for all tables
  logger?: KyseraLogger           // Logger instance for RLS operations
  requireContext?: boolean        // Require RLS context for all operations
  auditDecisions?: boolean        // Log policy decisions for debugging
  onViolation?: (violation: RLSPolicyViolation) => void  // Custom violation handler
}
```

### Table Schema Options

```typescript
interface TableRLSConfig {
  policies: PolicyDefinition[]    // List of policies for this table
  defaultDeny?: boolean           // Deny access when no policy matches (default: true)
  skipFor?: string[]              // Roles that bypass RLS for this table only
}
```

### Bypass Options Comparison

**Plugin-level bypass** (`skipTables`, `bypassRoles`):
- Applies to **all tables** globally
- Set at plugin initialization time
- Useful for excluding system tables or super-admin roles

**Table-level bypass** (`skipFor`):
- Applies to **specific table** only
- Set in the table's schema definition
- Useful for table-specific admin access

```typescript
// Example: Using both levels
const orm = await createORM(db, [
  rlsPlugin({
    schema: rlsSchema,
    skipTables: ['migrations', 'system_config'],  // Global: Skip these tables entirely
    bypassRoles: ['superadmin'],                  // Global: Superadmins bypass all RLS
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

### allow

Grant permission based on condition:

```typescript
// Authors can update their own posts
allow('update', ctx => ctx.auth.userId === ctx.row?.author_id)

// Admins can do anything
allow(['read', 'create', 'update', 'delete'], ctx =>
  ctx.auth.roles?.includes('admin')
)
```

### deny

Explicitly deny access:

```typescript
// Never allow deleting system users
deny('delete', ctx => ctx.row?.is_system === true)
```

### filter

Add WHERE conditions to queries:

```typescript
// Tenant isolation
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))

// Status-based filtering
filter('read', ctx =>
  ctx.auth.roles?.includes('admin')
    ? {}
    : { status: 'active', visibility: 'public' }
)
```

### validate

Validate input data before operations:

```typescript
// Users can only create posts for themselves
validate('create', ctx =>
  ctx.data?.author_id === ctx.auth.userId
)
```

## Schema Definition

```typescript
const rlsSchema = defineRLSSchema<Database>({
  // Table-specific policies
  users: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow('update', ctx => ctx.auth.userId === ctx.row?.id),
    ],
    defaultDeny: true,  // Deny operations not explicitly allowed
  },

  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow(['update', 'delete'], ctx =>
        ctx.auth.userId === ctx.row?.author_id ||
        ctx.auth.roles?.includes('admin')
      ),
    ],
  },

  // Admin table with role-based bypass
  audit_logs: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
    ],
    skipFor: ['admin', 'superuser'],  // Admins can see all audit logs
    defaultDeny: true,
  },

  // No policies = full access
  public_content: {},
})

// Merge multiple schemas
const fullSchema = mergeRLSSchemas(tenantSchema, roleSchema, customSchema)
```

## Context Management

### Setting Context

```typescript
import { rlsContext, createRLSContext, withRLSContext } from '@kysera/rls'

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
        permissions: user.permissions,
      },
    },
    async () => {
      next()
    }
  )
})
```

### Auth Context Structure

```typescript
interface RLSAuthContext<TUser = unknown> {
  userId: string | number
  roles: string[]                          // Required
  tenantId?: string | number
  organizationIds?: (string | number)[]    // For multi-org scenarios
  permissions?: string[]                   // Permission strings
  attributes?: Record<string, unknown>
  user?: TUser                             // Full user object if needed
  isSystem?: boolean                       // Bypass all policies
}
```

### System Context (Bypass)

```typescript
// System operations bypass all policies
await rlsContext.runAsync(
  { auth: { userId: 'system', isSystem: true } },
  async () => {
    // Full access to all data
    const allPosts = await postRepo.findAll()
  }
)
```

## Policy Evaluation

### Context Available in Policies

```typescript
interface PolicyEvaluationContext {
  auth: RLSAuthContext              // Authentication context
  row?: Record<string, unknown>     // Current row (for update/delete)
  data?: Record<string, unknown>    // Input data (for create/update)
  request?: RLSRequestContext       // Request context (optional)
  db?: Kysely<DB>                   // Database instance for complex policies
  meta?: Record<string, unknown>    // Custom metadata
  table?: string                    // Table name
  operation?: string                // Operation being performed
}
```

### Policy Evaluation Flow

Policies are evaluated differently depending on operation type:

**For SELECT queries (`interceptQuery`):**
```
1. Check bypass conditions (skipTables, isSystem, bypassRoles)
2. Get filter policies for table → registry.getFilters(table)
3. For each filter:
   - Call filter.getConditions(ctx) → { tenant_id: 1, status: 'active' }
   - Apply as WHERE conditions (AND logic)
4. Return transformed query
```

**For mutations (create/update/delete via `extendRepository`):**
```
1. Check bypass conditions (skipTables, isSystem, bypassRoles)
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

| Type | Operations | Evaluation | Behavior |
|------|------------|------------|----------|
| **filter** | SELECT only | `interceptQuery` | Adds WHERE conditions |
| **deny** | All mutations | First in mutation guard | If true → throw |
| **validate** | create, update | After deny | All must be true |
| **allow** | All mutations | Last | ≥1 must be true |

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
// Extract tenant from subdomain
const tenantId = extractTenantFromSubdomain(req.hostname)
// 'acme.app.com' → 'acme'

await rlsContext.runAsync(
  { auth: { userId: user.id, tenantId } },
  async () => {
    // All queries scoped to tenant
  }
)
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

**`RLSPolicyViolation`**
- Thrown when access is legitimately denied by a policy
- User doesn't have permission for the operation
- Should result in a 403 response

**`RLSPolicyEvaluationError`**
- Thrown when a policy condition throws an error during evaluation
- Indicates a bug in the policy code itself
- Preserves original stack trace for debugging
- Should result in a 500 response and investigation

**Example:**
```typescript
// A policy with a bug
allow('read', ctx => {
  return ctx.row.someField.value; // Throws if someField is undefined
});

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
- Should result in a 401 response

## DAL Compatibility

:::warning Functional DAL Limitation
**RLS automatic filtering does not apply to `@kysera/dal` queries.** The RLS plugin is designed for the Repository pattern and intercepts queries through the plugin system, which DAL bypasses.
:::

### What Works with DAL

| Feature | Works in DAL? |
|---------|---------------|
| `rlsContext.runAsync()` | Yes |
| `rlsContext.getContextOrNull()` | Yes |
| `rlsContext.asSystemAsync()` | Yes |
| Automatic SELECT filtering | **No** |
| Automatic mutation validation | **No** |
| `repo.withoutRLS()` | **No** (repository method) |
| `repo.canAccess()` | **No** (repository method) |

### Manual RLS in DAL

If using DAL with RLS requirements, apply filters manually:

```typescript
import { createQuery } from '@kysera/dal';
import { rlsContext } from '@kysera/rls';

const getPostsByTenant = createQuery((ctx) => {
  const rlsCtx = rlsContext.getContextOrNull();

  let query = ctx.db.selectFrom('posts').selectAll();

  // Apply RLS filter manually
  if (rlsCtx && !rlsCtx.auth.isSystem && rlsCtx.auth.tenantId) {
    query = query.where('tenant_id', '=', rlsCtx.auth.tenantId);
  }

  return query.execute();
});

// Context is available
await rlsContext.runAsync(
  { auth: { userId: 1, tenantId: 'acme', roles: ['user'] } },
  async () => {
    const posts = await getPostsByTenant(db);
  }
);
```

For comprehensive comparison, see [Repository vs DAL Guide](/docs/guides/dal-vs-repository).

## How RLS Works

The RLS plugin implements row-level security at the **application layer** using Kysely query transformations. This approach:

- Works with any database (PostgreSQL, MySQL, SQLite)
- Provides consistent behavior across all environments
- Allows complex policies using JavaScript logic
- Integrates seamlessly with Kysely's type system

```typescript
// Policies are applied automatically to all queries
const posts = await postRepo.findAll()
// SQL: SELECT * FROM posts WHERE tenant_id = $1

// Filter policies add WHERE clauses
// Validation policies check before write operations
```

:::tip PostgreSQL Native RLS
If you need PostgreSQL's native RLS for database-level security, you can use it alongside or instead of this plugin. Native RLS policies are enforced at the database level using `current_setting()`:

```sql
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON posts
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::int);
```

Set the context before queries: `SET app.tenant_id = '123'`
:::

## Best Practices

### 1. Always Set Context

```typescript
// Every request should have RLS context
app.use(async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  await rlsContext.runAsync({ auth: req.user }, next)
})
```

### 2. Use System Context Sparingly

```typescript
// Only for background jobs, migrations, etc.
await rlsContext.runAsync(
  { auth: { userId: 'system', isSystem: true } },
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
      { auth: { tenantId: 'acme' } },
      async () => {
        const posts = await postRepo.findAll()
        expect(posts.every(p => p.tenant_id === 'acme')).toBe(true)
      }
    )
  })
})
```
