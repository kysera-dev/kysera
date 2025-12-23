---
sidebar_position: 4
title: Multi-Tenant SaaS
description: Multi-tenant architecture patterns
---

# Multi-Tenant SaaS

Enterprise multi-tenant architecture demonstrating manual tenant isolation patterns.

> **Note**: This is a CLI demonstration example showing the foundational pattern of tenant isolation using manual filtering. It implements:
>
> - ✅ TenantContext for storing current tenant ID
> - ✅ Manual tenant filtering in user repository (`.where('tenant_id', '=', getTenantId())`)
> - ✅ Complete CRUD operations with tenant isolation
> - ❌ Does NOT use @kysera/rls plugin (shown as alternative pattern below)
> - ❌ Does NOT implement audit logging (schema only)
> - ❌ Only users repository implemented (projects/tasks are schema-only)
>
> The Express middleware examples shown below are recommended patterns for integrating this into web applications.

## What This Example Demonstrates

This example shows the **foundational pattern** for tenant isolation:

- **Discriminator Column Pattern** - Using `tenant_id` column for row-level isolation
- **Manual Tenant Filtering** - Explicit `.where('tenant_id', '=', getTenantId())` in all queries
- **TenantContext Management** - Simple class for storing current tenant ID
- **Cross-Tenant Protection** - Preventing access to other tenants' data
- **Type-Safe Repositories** - Full TypeScript support with Kysely

This is the most transparent and educational approach. For production applications, consider using the `@kysera/rls` plugin (shown below) which automates the filtering.

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

## Tenant Context

### Context Manager

The actual implementation (see `src/middleware/tenant-context.ts`):

```typescript
export class TenantContext {
  private tenantId: number | null = null

  setTenantId(tenantId: number): void {
    this.tenantId = tenantId
  }

  getTenantId(): number {
    if (this.tenantId === null) {
      throw new Error('Tenant context not set. Call setTenantId() first.')
    }
    return this.tenantId
  }

  hasTenant(): boolean {
    return this.tenantId !== null
  }

  clear(): void {
    this.tenantId = null
  }
}

// Usage in CLI example:
const tenant1Context = new TenantContext()
tenant1Context.setTenantId(1)

const tenant2Context = new TenantContext()
tenant2Context.setTenantId(2)
```

### Request Middleware (Recommended for Web Apps)

> **Note**: The actual example is a CLI application. The following Express middleware is a recommended pattern for production web applications.

```typescript
// Recommended pattern for Express applications
import { Request, Response, NextFunction } from 'express'

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // Extract tenant from subdomain
  const subdomain = extractSubdomain(req.hostname)

  if (!subdomain) {
    return res.status(400).json({ error: 'Tenant not specified' })
  }

  // Look up tenant
  const tenant = await db
    .selectFrom('tenants')
    .where('slug', '=', subdomain) // Note: uses 'slug', not 'subdomain'
    .selectAll()
    .executeTakeFirst()

  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found' })
  }

  // Create tenant context for this request
  req.tenantContext = new TenantContext()
  req.tenantContext.setTenantId(tenant.id)
  req.tenant = tenant

  next()
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

## Tenant-Scoped Repository

The actual implementation (see `src/repositories/user.repository.ts`):

```typescript
export function createUserRepository(executor: Executor<Database>, tenantContext: TenantContext) {
  const validateDbResults = process.env['NODE_ENV'] === 'development'
  const getTenantId = () => tenantContext.getTenantId()

  return {
    async findById(id: number): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId()) // Tenant filter
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findByEmail(email: string): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .where('tenant_id', '=', getTenantId()) // Tenant filter
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findAll(): Promise<User[]> {
      const rows = await executor
        .selectFrom('users')
        .selectAll()
        .where('tenant_id', '=', getTenantId()) // Tenant filter
        .orderBy('created_at', 'desc')
        .execute()

      const users = rows.map(mapUserRow)
      return validateDbResults ? users.map(u => UserSchema.parse(u)) : users
    },

    async create(input: unknown): Promise<User> {
      const validated = CreateUserSchema.parse(input)

      const row = await executor
        .insertInto('users')
        .values({
          ...validated,
          tenant_id: getTenantId(), // Auto-inject tenant_id
          role: validated.role || 'member'
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async update(id: number, input: unknown): Promise<User> {
      const validated = UpdateUserSchema.parse(input)

      const row = await executor
        .updateTable('users')
        .set({
          ...validated,
          updated_at: new Date()
        })
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId()) // Security!
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async delete(id: number): Promise<void> {
      await executor
        .deleteFrom('users')
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId()) // Security!
        .execute()
    }
  }
}
```

**Key Points**:

- Takes `TenantContext` instance, not a function
- All queries include `WHERE tenant_id = getTenantId()`
- Creates automatically inject `tenant_id`
- Updates/deletes verify `tenant_id` for security
- Validation is optional based on environment

## Alternative Pattern: Using @kysera/rls Plugin

> **Important**: The actual example implementation in `examples/multi-tenant-saas` does NOT use the `@kysera/rls` plugin. It demonstrates the foundational pattern using manual tenant filtering in repositories (as shown above). This section shows an alternative approach using the RLS plugin with unified executor, which is recommended for production applications as it provides automatic filtering and reduces the risk of accidentally omitting tenant filters.

### With Repository Pattern

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
2. **Manual Filtering** - Explicit `WHERE tenant_id = getTenantId()` in repositories
3. **Automatic Injection** - `tenant_id` added to inserts via `getTenantId()`
4. **Context Management** - `TenantContext` class for storing current tenant
5. **No Cross-Tenant Access** - WHERE clause enforced in all repository methods
6. **Type Safety** - Full TypeScript support with Kysely

## Security Considerations

```typescript
// Always include tenant filter in updates/deletes
await executor
  .updateTable('users')
  .set(data)
  .where('id', '=', id)
  .where('tenant_id', '=', getTenantId()) // CRITICAL!
  .execute()

// Never trust client tenant ID
const tenantId = getTenantId() // From server context, not request
```
