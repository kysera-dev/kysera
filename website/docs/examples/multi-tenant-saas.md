---
sidebar_position: 4
title: Multi-Tenant SaaS
description: Multi-tenant architecture patterns
---

# Multi-Tenant SaaS

Enterprise multi-tenant architecture demonstrating automatic tenant isolation using the RLS plugin.

> **Note**: This is a CLI demonstration example showing automatic tenant isolation using the `@kysera/rls` plugin. It implements:
>
> - ✅ RLS plugin for automatic tenant filtering (no manual WHERE clauses needed)
> - ✅ RLS context management with `rlsContext.runAsync()`
> - ✅ Complete CRUD operations with automatic tenant isolation
> - ✅ System context support for cross-tenant operations
> - ❌ Does NOT implement audit logging (schema only)
> - ❌ Only users repository implemented (projects/tasks are schema-only)
>
> **Note**: While a `TenantContext` class exists in the codebase, it is NOT used by the actual implementation. The example uses `rlsContext` from `@kysera/rls` instead.

## What This Example Demonstrates

This example shows the **production-ready pattern** for tenant isolation using the RLS plugin:

- **Discriminator Column Pattern** - Using `tenant_id` column for row-level isolation
- **Automatic Tenant Filtering** - RLS plugin automatically adds `WHERE tenant_id = ctx.auth.tenantId` to all queries
- **RLS Context Management** - Using `rlsContext.runAsync()` to set tenant scope
- **Cross-Tenant Protection** - Complete isolation between tenants, verified with tests
- **System Context Support** - Ability to bypass RLS for admin/system operations
- **Type-Safe Repositories** - Full TypeScript support with Kysely

This is the recommended approach for production applications as it eliminates the risk of forgetting to add tenant filters manually.

## Database Schema

The actual implementation uses this TypeScript schema (see `src/db/schema.ts`):

```typescript
interface Database {
  tenants: {
    id: Generated<number>
    name: string
    slug: string // unique identifier (e.g., 'acme-corp')
    plan: 'free' | 'pro' | 'enterprise'
    max_users: number
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }

  users: {
    id: Generated<number>
    tenant_id: number
    email: string
    name: string
    role: 'owner' | 'admin' | 'member'
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }

  projects: {
    id: Generated<number>
    tenant_id: number
    name: string
    description: string | null
    status: 'active' | 'archived'
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }

  tasks: {
    id: Generated<number>
    tenant_id: number
    project_id: number
    title: string
    description: string | null
    status: 'todo' | 'in_progress' | 'done'
    assigned_to: number | null
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }

  audit_logs: {
    id: Generated<number>
    tenant_id: number
    table_name: string
    entity_id: string
    operation: 'INSERT' | 'UPDATE' | 'DELETE'
    old_values: string | null // Note: string, not JSONB
    new_values: string | null // Note: string, not JSONB
    user_id: number | null
    created_at: Generated<Date>
  }
}
```

**Implementation Status**:

- ✅ Users repository - Fully implemented with tenant isolation
- 📋 Projects, tasks, audit_logs - Schema defined but repositories not yet implemented

## RLS Context Management

### Context Setup with rlsContext

The actual implementation uses RLS context from `@kysera/rls` (see `src/index.ts`):

```typescript
import { rlsContext, rlsPlugin, defineRLSSchema, filter } from '@kysera/rls'
import { createExecutor } from '@kysera/executor'

// Define RLS schema with automatic tenant filtering
const rlsSchema = defineRLSSchema<Database>({
  users: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
    ],
    defaultDeny: false
  }
})

// Create executor with RLS plugin
const executor = await createExecutor(db, [
  rlsPlugin({
    schema: rlsSchema,
    requireContext: true,
    allowUnfilteredQueries: false
  })
])

// Usage in CLI example - wrap operations in rlsContext.runAsync():
await rlsContext.runAsync(
  {
    auth: {
      userId: 1,
      roles: ['admin'],
      tenantId: 1, // Acme Corporation
      isSystem: false
    },
    timestamp: new Date()
  },
  async () => {
    const userRepo = createUserRepository(executor)

    // All queries automatically filtered by tenant_id = 1
    const users = await userRepo.findAll()
    // SELECT * FROM users WHERE tenant_id = 1 (automatic!)
  }
)
```

### Request Middleware (Recommended for Web Apps)

> **Note**: The actual example is a CLI application. The following Express middleware is a recommended pattern for production web applications using the RLS plugin.

```typescript
// Recommended pattern for Express applications
import { Request, Response, NextFunction } from 'express'
import { rlsContext } from '@kysera/rls'

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // Extract tenant from subdomain
  const subdomain = extractSubdomain(req.hostname)

  if (!subdomain) {
    return res.status(400).json({ error: 'Tenant not specified' })
  }

  // Look up tenant
  const tenant = await db
    .selectFrom('tenants')
    .where('slug', '=', subdomain)
    .selectAll()
    .executeTakeFirst()

  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found' })
  }

  // Set RLS context for this request
  await rlsContext.runAsync(
    {
      auth: {
        userId: req.user?.id || 0,
        tenantId: tenant.id,
        roles: req.user?.roles || [],
        isSystem: false
      },
      timestamp: new Date()
    },
    next
  )
}

function extractSubdomain(hostname: string): string | null {
  // acme.app.com → acme
  const parts = hostname.split('.')
  if (parts.length >= 3) {
    return parts[0] ?? null
  }
  return null
}
```

## Tenant-Scoped Repository with RLS Plugin

The actual implementation (see `src/repositories/user.repository.ts`) uses the RLS plugin for automatic tenant filtering:

```typescript
import { rlsContext } from '@kysera/rls'
import type { Executor } from '@kysera/core'

export function createUserRepository(executor: Executor<Database>) {
  const validateDbResults = process.env['NODE_ENV'] === 'development'

  return {
    async findById(id: number): Promise<User | null> {
      // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findByEmail(email: string): Promise<User | null> {
      // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findAll(): Promise<User[]> {
      // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
      const rows = await executor
        .selectFrom('users')
        .selectAll()
        .orderBy('created_at', 'desc')
        .execute()

      const users = rows.map(mapUserRow)
      return validateDbResults ? users.map(u => UserSchema.parse(u)) : users
    },

    async create(input: unknown): Promise<User> {
      const validated = CreateUserSchema.parse(input)

      // Get tenant_id from RLS context
      const ctx = rlsContext.getContextOrNull()
      if (!ctx?.auth?.tenantId) {
        throw new Error('RLS context with tenantId is required for create operations')
      }

      const row = await executor
        .insertInto('users')
        .values({
          ...validated,
          tenant_id: ctx.auth.tenantId as number, // Explicit tenant_id from context
          role: validated.role || 'member'
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async update(id: number, input: unknown): Promise<User> {
      const validated = UpdateUserSchema.parse(input)

      // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
      const row = await executor
        .updateTable('users')
        .set({
          ...validated,
          updated_at: new Date()
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async delete(id: number): Promise<void> {
      // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
      await executor
        .deleteFrom('users')
        .where('id', '=', id)
        .execute()
    }
  }
}
```

**Key Points**:

- **No manual tenant filtering needed** - RLS plugin automatically adds `WHERE tenant_id = ctx.auth.tenantId`
- **Takes only `Executor`** - No need to pass `TenantContext` or tenant ID
- **Automatic security** - All SELECT, UPDATE, and DELETE queries are filtered by tenant
- **Explicit INSERT** - `tenant_id` must be explicitly set from `rlsContext` for INSERT operations
- **Validation is optional** - Based on environment variable
- **Eliminates security bugs** - No risk of forgetting to add tenant filters

## Alternative Pattern: Manual Tenant Filtering (Not Used in Example)

> **Important**: The actual example implementation in `examples/multi-tenant-saas` DOES use the `@kysera/rls` plugin as shown above. However, you can also implement tenant isolation using manual filtering if you prefer more explicit control. This section shows the manual approach for educational purposes, though it's more error-prone since you can accidentally forget to add tenant filters.

### Manual Filtering with TenantContext

While a `TenantContext` class exists in the codebase at `src/middleware/tenant-context.ts`, it is NOT used by the actual implementation. Here's how you would use it for manual filtering:

```typescript
import { TenantContext } from './middleware/tenant-context.js'

export function createUserRepository(executor: Executor<Database>, tenantContext: TenantContext) {
  const getTenantId = () => tenantContext.getTenantId()

  return {
    async findById(id: number): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId()) // Manual filter - easy to forget!
        .executeTakeFirst()

      return row ? mapUserRow(row) : null
    },

    async create(input: unknown): Promise<User> {
      const validated = CreateUserSchema.parse(input)

      const row = await executor
        .insertInto('users')
        .values({
          ...validated,
          tenant_id: getTenantId(), // Manual injection
          role: validated.role || 'member'
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return mapUserRow(row)
    },

    async update(id: number, input: unknown): Promise<User> {
      const validated = UpdateUserSchema.parse(input)

      const row = await executor
        .updateTable('users')
        .set({ ...validated, updated_at: new Date() })
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId()) // Critical for security!
        .returningAll()
        .executeTakeFirstOrThrow()

      return mapUserRow(row)
    }
  }
}
```

**Drawbacks of Manual Filtering**:

- **Error-prone** - Easy to forget `.where('tenant_id', '=', getTenantId())`
- **Verbose** - Must add the filter to every query
- **Security risk** - A single forgotten filter can leak data across tenants
- **Hard to audit** - Need to verify every query manually

**Benefits of RLS Plugin (Used in Example)**:

- **Automatic** - Filters applied automatically to all queries
- **Safer** - Impossible to forget tenant filters
- **Cleaner code** - No repetitive WHERE clauses
- **System context** - Easy to bypass for admin operations when needed

### With ORM Pattern (Alternative to Current Implementation)

```typescript
import { createORM } from '@kysera/repository'
import { rlsPlugin, defineRLSSchema, filter, rlsContext } from '@kysera/rls'

// Define RLS schema
const rlsSchema = defineRLSSchema<Database>({
  users: {
    policies: [
      // Automatic tenant filtering on all operations
      filter(['read', 'create', 'update', 'delete'], ctx => ({
        tenant_id: ctx.auth.tenantId
      }))
    ],
    defaultDeny: true
  },
  projects: {
    policies: [
      filter(['read', 'create', 'update', 'delete'], ctx => ({
        tenant_id: ctx.auth.tenantId
      }))
    ],
    defaultDeny: true
  }
})

// Create repository manager with RLS plugin
const orm = await createORM(db, [rlsPlugin({ schema: rlsSchema })])

// Create repositories (no manual tenant filtering needed)
const userRepo = orm.createRepository(createUserRepository)

// Express middleware
app.use(async (req, res, next) => {
  await rlsContext.runAsync(
    {
      auth: {
        userId: req.user.id,
        tenantId: req.tenant.id,
        roles: req.user.roles
      }
    },
    next
  )
})

// All queries automatically filtered!
app.get('/users', async (req, res) => {
  const users = await userRepo.findAll()
  // WHERE tenant_id = <current tenant> is automatic
  res.json(users)
})
```

### With DAL Pattern

```typescript
import { createExecutor } from '@kysera/executor'
import { createQuery, createContext } from '@kysera/dal'
import { rlsPlugin, defineRLSSchema, filter, rlsContext } from '@kysera/rls'

// Define RLS schema
const rlsSchema = defineRLSSchema<Database>({
  users: {
    policies: [
      filter(['read', 'create', 'update', 'delete'], ctx => ({
        tenant_id: ctx.auth.tenantId
      }))
    ],
    defaultDeny: true
  }
})

// Create executor with RLS plugin
const executor = await createExecutor(db, [rlsPlugin({ schema: rlsSchema })])

// Define DAL queries (no manual tenant filtering needed)
const getUsers = createQuery(ctx => ctx.db.selectFrom('users').selectAll().execute())

const createUser = createQuery((ctx, data) =>
  ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
)

// Express middleware
app.use(async (req, res, next) => {
  await rlsContext.runAsync(
    {
      auth: {
        userId: req.user.id,
        tenantId: req.tenant.id,
        roles: req.user.roles
      }
    },
    next
  )
})

// All queries automatically filtered!
app.get('/users', async (req, res) => {
  const ctx = createContext(executor)
  const users = await getUsers(ctx)
  // WHERE tenant_id = <current tenant> is automatic
  res.json(users)
})
```

**Benefits of using @kysera/rls:**

- Automatic tenant filtering on all queries (no manual WHERE clauses)
- Centralized policy definitions
- System context support via `rlsContext.asSystemAsync()`
- Row-level access validation
- Reduced risk of security bugs from forgotten filters

## Alternative Pattern: Using @kysera/audit Plugin

> **Important**: The actual example in `examples/multi-tenant-saas` does NOT implement audit logging functionality. While the schema includes an `audit_logs` table structure (with `string` columns for old_values/new_values, not JSONB), there is no repository implementation or plugin configured for it. This section demonstrates how you could add audit logging using the `@kysera/audit` package in your own application.

```typescript
import { auditPlugin } from '@kysera/audit'

const audit = auditPlugin({
  getUserId: () => getCurrentUserId(),
  metadata: () => ({
    tenant_id: tenantContext.getTenantId(),
    ip: getCurrentRequest().ip
  })
})

const orm = await createORM(db, [audit])

// All changes logged with tenant context
```

**Note**: If you implement audit logging in your application, remember that the example's audit_logs schema uses `string` columns for old_values/new_values. You would need to JSON.stringify your data before storing it, or modify the schema to use JSONB if your database supports it.

## Key Patterns

1. **Discriminator Column** - `tenant_id` on every tenant-scoped table
2. **Automatic RLS Filtering** - RLS plugin automatically adds `WHERE tenant_id = ctx.auth.tenantId` to all queries
3. **RLS Context Management** - Using `rlsContext.runAsync()` to set tenant scope for each request/operation
4. **Explicit INSERT tenant_id** - For INSERT operations, `tenant_id` is explicitly pulled from `rlsContext.get().auth.tenantId`
5. **System Context Support** - Use `isSystem: true` in RLS context to bypass tenant filters for admin operations
6. **Complete Isolation** - Impossible to access other tenants' data without changing context
7. **Type Safety** - Full TypeScript support with Kysely

## Security Considerations

```typescript
// With RLS plugin, tenant filtering is automatic and enforced
await rlsContext.runAsync(
  {
    auth: {
      userId: req.user.id,
      tenantId: req.tenant.id, // From server-side tenant resolution, NEVER from client
      roles: req.user.roles,
      isSystem: false
    },
    timestamp: new Date()
  },
  async () => {
    // All queries automatically filtered - no way to forget!
    await executor
      .updateTable('users')
      .set(data)
      .where('id', '=', id)
      .execute()
    // WHERE tenant_id = req.tenant.id is added automatically by RLS plugin
  }
)

// CRITICAL: Never trust client-provided tenant ID
// Always resolve tenant server-side from:
// - Subdomain (acme.app.com → tenant lookup)
// - Verified JWT token
// - Session data
// - Database lookup

// For admin/system operations that need cross-tenant access
await rlsContext.runAsync(
  {
    auth: {
      userId: adminUserId,
      tenantId: 0,
      roles: ['system'],
      isSystem: true // Bypasses RLS filters
    },
    timestamp: new Date()
  },
  async () => {
    // Can access all tenants' data
    const allUsers = await executor.selectFrom('users').selectAll().execute()
  }
)
```
