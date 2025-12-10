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
| **Version** | 0.6.0 |
| **Bundle Size** | ~10 KB (minified) |
| **Dependencies** | @kysera/core (workspace) |
| **Peer Dependencies** | kysely >=0.28.8, @kysera/repository |

## Exports

```typescript
// Main plugin
export { rlsPlugin } from './index'

// Schema definition
export { defineRLSSchema, mergeRLSSchemas } from './schema'

// Policy builders
export { allow, deny, filter, validate } from './policies'

// Context management
export { rlsContext, createRLSContext, withRLSContext } from './context'

// Errors
export { RLSError, RLSPolicyViolation, RLSContextError } from './errors'

// Types
export type {
  RLSPluginOptions,
  RLSSchema,
  RLSAuthContext,
  TableRLSConfig,
  PolicyDefinition,
  PolicyEvaluationContext,
  RLSRequestContext,
  RLSPolicyViolation
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
  condition: (ctx: PolicyEvaluationContext) => boolean
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
  condition: (ctx: PolicyEvaluationContext) => boolean
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
  validator: (ctx: PolicyEvaluationContext) => boolean
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

AsyncLocalStorage-based context for RLS authentication.

```typescript
const rlsContext: {
  runAsync<T>(context: RLSContext, fn: () => Promise<T>): Promise<T>
  getStore(): RLSContext | undefined
}
```

### RLSContext and RLSAuthContext

```typescript
interface RLSContext {
  auth: RLSAuthContext
  request?: RLSRequestContext
  meta?: Record<string, unknown>
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
  ip?: string
  userAgent?: string
  requestId?: string
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
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id
      }
    },
    async () => {
      next()
    }
  )
})
```

### withRLSContext

Helper function for wrapping operations.

```typescript
async function withRLSContext<T>(
  context: RLSContext,
  fn: () => Promise<T>
): Promise<T>
```

**Example:**
```typescript
const result = await withRLSContext(
  { auth: { userId: 1, roles: ['user'] } },
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
    }
  },
  async () => {
    // Full access to all data
    const allPosts = await postRepo.findAll()
  }
)
```

## Policy Evaluation Context

Context available when evaluating policies.

```typescript
interface PolicyEvaluationContext {
  /**
   * Authentication context
   */
  auth: RLSAuthContext

  /**
   * Current row data (for update/delete)
   */
  row?: Record<string, unknown>

  /**
   * Input data (for create/update)
   */
  data?: Record<string, unknown>

  /**
   * Request context
   */
  request?: RLSRequestContext

  /**
   * Database instance for complex policies
   */
  db?: Kysely<DB>

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
  RLSContextError
} from '@kysera/rls'

// Base error class
class RLSError extends Error {
  code: string
}

// Policy violation
class RLSPolicyViolation extends RLSError {
  table: string
  operation: string
  userId: string | number
  reason: string
}

// Missing context
class RLSContextError extends RLSError {
  message: 'RLS context not set'
}
```

### Handling Errors

```typescript
try {
  await postRepo.delete(postId)
} catch (error) {
  if (error instanceof RLSPolicyViolation) {
    // User doesn't have permission
    res.status(403).json({
      error: 'Permission denied',
      table: error.table,
      operation: error.operation
    })
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

The plugin implements row-level security at the **application layer** using Kysely query transformations:

```typescript
// Original query
const posts = await postRepo.findAll()

// With RLS filter policy
// SQL: SELECT * FROM posts WHERE tenant_id = $1

// Filter is automatically added based on context
```

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
      }
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

## Usage with createORM

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
  { auth: { userId: 1, tenantId: 'acme', roles: ['user'] } },
  async () => {
    // Automatically filtered by tenant_id
    const posts = await postRepo.findAll()

    // Will throw RLSPolicyViolation if not author
    await postRepo.delete(postId)
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

  await rlsContext.runAsync({ auth: req.user }, next)
})
```

### 2. Use System Context Sparingly

```typescript
// Only for background jobs, migrations, etc.
await rlsContext.runAsync(
  { auth: { userId: 'system', roles: [], isSystem: true } },
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
      { auth: { userId: 1, tenantId: 'acme', roles: [] } },
      async () => {
        const posts = await postRepo.findAll()
        expect(posts.every(p => p.tenant_id === 'acme')).toBe(true)
      }
    )
  })

  it('should deny cross-tenant access', async () => {
    await rlsContext.runAsync(
      { auth: { userId: 1, tenantId: 'other', roles: [] } },
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

### RLSRepository

```typescript
type RLSRepository<Entity, DB> = Repository<Entity, DB>
// RLS policies are applied transparently - no additional methods
```

### Full Type Definitions

```typescript
type Operation = 'read' | 'create' | 'update' | 'delete'

type PolicyDefinition =
  | AllowPolicy
  | DenyPolicy
  | FilterPolicy
  | ValidatePolicy

interface AllowPolicy {
  type: 'allow'
  operations: Operation[]
  condition: (ctx: PolicyEvaluationContext) => boolean
}

interface DenyPolicy {
  type: 'deny'
  operations: Operation[]
  condition: (ctx: PolicyEvaluationContext) => boolean
}

interface FilterPolicy {
  type: 'filter'
  operations: Operation[]
  getFilter: (ctx: PolicyEvaluationContext) => Record<string, unknown>
}

interface ValidatePolicy {
  type: 'validate'
  operations: Operation[]
  validator: (ctx: PolicyEvaluationContext) => boolean
}
```

## See Also

- [RLS Plugin Guide](/docs/plugins/rls)
- [@kysera/repository](/docs/api/repository)
- [@kysera/audit](/docs/api/audit)
