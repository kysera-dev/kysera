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

```typescript
interface RLSPluginOptions<DB = unknown> {
  schema: RLSSchema<DB>
  skipTables?: string[]           // Tables to exclude from RLS
  bypassRoles?: string[]          // Roles that bypass RLS entirely
  logger?: KyseraLogger
  requireContext?: boolean        // Require RLS context for all operations
  auditDecisions?: boolean        // Log policy decisions
  onViolation?: (violation: RLSPolicyViolation) => void  // Custom violation handler
}
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
  ctx.input?.author_id === ctx.auth.userId
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
  auth: RLSAuthContext
  row?: Record<string, unknown>     // Current row (for update/delete)
  input?: Record<string, unknown>   // Input data (for create/update)
  operation: 'read' | 'create' | 'update' | 'delete'
  table: string
  timestamp: Date
}
```

### Policy Precedence

1. `deny` policies are evaluated first
2. `allow` policies grant access
3. `filter` policies add WHERE conditions
4. `validate` policies check input
5. `defaultDeny` determines behavior when no policy matches

## Multi-Tenant Patterns

### Discriminator Column

```typescript
const tenantSchema = defineRLSSchema<Database>({
  users: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      validate('create', ctx => ctx.input?.tenant_id === ctx.auth.tenantId),
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
import { RLSError, RLSPolicyViolation, RLSContextError } from '@kysera/rls'

try {
  await postRepo.delete(postId)
} catch (error) {
  if (error instanceof RLSPolicyViolation) {
    // User doesn't have permission
    res.status(403).json({ error: 'Permission denied' })
  }
  if (error instanceof RLSContextError) {
    // No RLS context set
    res.status(401).json({ error: 'Not authenticated' })
  }
}
```

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
