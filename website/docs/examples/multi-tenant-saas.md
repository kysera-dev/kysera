---
sidebar_position: 4
title: Multi-Tenant SaaS
description: Multi-tenant architecture patterns
---

# Multi-Tenant SaaS

Enterprise multi-tenant architecture with automatic tenant isolation.

## Features

- Tenant isolation (discriminator column)
- Automatic tenant filtering
- Request-scoped context management
- Cross-tenant protection
- Per-tenant audit logging
- Subdomain extraction

## Database Schema

```sql
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(100) NOT NULL UNIQUE,
  plan VARCHAR(20) NOT NULL DEFAULT 'free',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, email)
);

CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  table_name VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  operation VARCHAR(20) NOT NULL,
  old_values JSONB,
  new_values JSONB,
  user_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for tenant filtering
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_projects_tenant ON projects(tenant_id);
CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id);
```

## Tenant Context

### Context Manager

```typescript
// tenant-context.ts
export class TenantContext {
  private tenantId: number | null = null

  setTenantId(id: number): void {
    this.tenantId = id
  }

  getTenantId(): number {
    if (this.tenantId === null) {
      throw new Error('Tenant context not initialized')
    }
    return this.tenantId
  }

  clear(): void {
    this.tenantId = null
  }
}

export const tenantContext = new TenantContext()
```

### Request Middleware

```typescript
// middleware/tenant.ts
import { Request, Response, NextFunction } from 'express'

export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Extract tenant from subdomain
  const subdomain = extractSubdomain(req.hostname)

  if (!subdomain) {
    return res.status(400).json({ error: 'Tenant not specified' })
  }

  // Look up tenant
  const tenant = await db
    .selectFrom('tenants')
    .where('subdomain', '=', subdomain)
    .selectAll()
    .executeTakeFirst()

  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found' })
  }

  // Set context
  tenantContext.setTenantId(tenant.id)
  req.tenant = tenant

  next()
}

function extractSubdomain(hostname: string): string | null {
  // acme.app.com → acme
  const parts = hostname.split('.')
  if (parts.length >= 3) {
    return parts[0]
  }
  return null
}
```

## Tenant-Scoped Repository

```typescript
// repositories/user.repository.ts
export function createUserRepository(
  executor: Executor<Database>,
  getTenantId: () => number
) {
  return {
    async findById(id: number): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId())  // Automatic filter!
        .selectAll()
        .executeTakeFirst()

      return row ? mapUserRow(row) : null
    },

    async findAll(): Promise<User[]> {
      const rows = await executor
        .selectFrom('users')
        .where('tenant_id', '=', getTenantId())  // Automatic filter!
        .selectAll()
        .execute()

      return rows.map(mapUserRow)
    },

    async create(input: CreateUserInput): Promise<User> {
      const validated = CreateUserSchema.parse(input)

      const row = await executor
        .insertInto('users')
        .values({
          ...validated,
          tenant_id: getTenantId(),  // Auto-inject!
          role: validated.role || 'member'
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return mapUserRow(row)
    },

    async update(id: number, input: UpdateUserInput): Promise<User> {
      const validated = UpdateUserSchema.parse(input)

      const row = await executor
        .updateTable('users')
        .set(validated)
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId())  // Security!
        .returningAll()
        .executeTakeFirst()

      if (!row) {
        throw new NotFoundError('User not found')
      }

      return mapUserRow(row)
    },

    async delete(id: number): Promise<void> {
      const result = await executor
        .deleteFrom('users')
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId())  // Security!
        .executeTakeFirst()

      if (result.numDeletedRows === 0n) {
        throw new NotFoundError('User not found')
      }
    }
  }
}
```

## Using RLS Plugin

Alternative approach using the RLS plugin:

```typescript
import { rlsPlugin, defineRLSSchema, filter, rlsContext } from '@kysera/rls'

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

const orm = await createORM(db, [
  rlsPlugin({ schema: rlsSchema })
])

// Usage in request
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

## Per-Tenant Audit

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

## Key Patterns

1. **Discriminator Column** - `tenant_id` on every table
2. **Automatic Injection** - Tenant ID added to all queries
3. **Request Scoping** - Context per HTTP request
4. **No Cross-Tenant Access** - WHERE clause on every query
5. **Subdomain Routing** - Tenant from URL
6. **Audit Per Tenant** - Track changes with tenant context

## Security Considerations

```typescript
// Always include tenant filter in updates/deletes
await executor
  .updateTable('users')
  .set(data)
  .where('id', '=', id)
  .where('tenant_id', '=', getTenantId())  // CRITICAL!
  .execute()

// Never trust client tenant ID
const tenantId = getTenantId()  // From server context, not request
```
