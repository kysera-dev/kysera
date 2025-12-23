# Multi-Tenant SaaS Example with RLS Plugin

A comprehensive multi-tenant SaaS application demonstrating Kysera's **automatic Row-Level Security (RLS)** for tenant isolation:

- **Automatic Tenant Isolation**: Complete data separation using @kysera/rls plugin ✅
- **Zero Manual Filtering**: No WHERE tenant_id = X needed in queries ✅
- **RLS Context Management**: Simple context switching between tenants ✅
- **Type-Safe Repositories**: Full TypeScript support ✅
- **Cross-Runtime**: Works on Node.js, Bun, and Deno ✅

## Key Features

This example demonstrates the **modern approach** to multi-tenant SaaS using the `@kysera/rls` plugin:

- **No Manual Filters**: RLS plugin automatically adds `WHERE tenant_id = X` to ALL queries
- **Auto-Injection**: `tenant_id` is automatically injected on INSERT operations
- **Context-Aware**: Simply set tenant context once, all queries are filtered
- **Impossible to Bypass**: Tenant isolation is enforced at the plugin level
- **Clean Code**: Repositories focus on business logic, not security plumbing

## Architecture

### RLS-Based Tenant Isolation

```
┌─────────────────────────────────────┐
│         Application Layer           │
│  (Extract tenant from request)      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│       RLS Context Manager           │
│   rlsContext.run({ tenantId: 1 })   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Executor with RLS Plugin          │
│  (Automatic tenant_id filtering)    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│         Database Layer              │
│  WHERE tenant_id = X (automatic!)   │
└─────────────────────────────────────┘
```

### Database Schema

```typescript
// Global table (not scoped)
tenants {
  id, name, slug, plan, max_users
}

// Tenant-scoped tables (all have tenant_id)
users { id, tenant_id, email, name, role }
projects { id, tenant_id, name, description, status }
tasks { id, tenant_id, project_id, title, status, assigned_to }
audit_logs { id, tenant_id, table_name, entity_id, operation }
```

## Quick Start

```bash
# Install dependencies
cd examples/multi-tenant-saas
pnpm install

# Set up PostgreSQL database
createdb multitenant_example

# Set environment variables
export DATABASE_URL="postgresql://localhost/multitenant_example"

# Run migrations
pnpm migrate

# Seed test data (2 tenants with users, projects, tasks)
pnpm seed

# Run the example
pnpm dev
```

## Usage Examples

### 1. Define RLS Schema

```typescript
import { defineRLSSchema, filter, validate } from '@kysera/rls'

const rlsSchema = defineRLSSchema<Database>({
  // Users table - tenant scoped
  users: {
    policies: [
      // Filter all reads by tenant_id
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      // Validate creates have correct tenant_id
      validate('create', ctx => {
        if (!ctx.data.tenant_id) {
          ctx.data.tenant_id = ctx.auth.tenantId // Auto-inject
        }
        return ctx.data.tenant_id === ctx.auth.tenantId
      })
    ],
    defaultDeny: false
  },
  // Similar for projects, tasks, audit_logs...
})
```

### 2. Create Executor with RLS Plugin

```typescript
import { createExecutor } from '@kysera/executor'
import { rlsPlugin } from '@kysera/rls'

const executor = await createExecutor(db, [
  rlsPlugin({
    schema: rlsSchema,
    requireContext: true, // Require RLS context for all operations
    allowUnfilteredQueries: false // Prevent unfiltered queries
  })
])
```

### 3. Simple Repository (No Manual Filtering!)

```typescript
export function createUserRepository(executor: Executor<Database>) {
  return {
    // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
    async findAll() {
      return executor.selectFrom('users').selectAll().execute()
    },

    async findById(id: number) {
      return executor
        .selectFrom('users')
        .where('id', '=', id)
        .selectAll()
        .executeTakeFirst()
    },

    // RLS plugin automatically injects tenant_id
    async create(input: CreateUserInput) {
      return executor
        .insertInto('users')
        .values({
          ...validated,
          role: validated.role || 'member'
          // No tenant_id needed - RLS plugin handles it!
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    }
  }
}
```

### 4. Use with RLS Context

```typescript
import { rlsContext } from '@kysera/rls'

// Tenant 1 operations
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
    console.log(`Tenant 1 users: ${users.length}`)
  }
)

// Tenant 2 operations
await rlsContext.runAsync(
  {
    auth: { userId: 3, roles: ['admin'], tenantId: 2, isSystem: false },
    timestamp: new Date()
  },
  async () => {
    const userRepo = createUserRepository(executor)

    // All queries automatically filtered by tenant_id = 2
    const users = await userRepo.findAll()
    console.log(`Tenant 2 users: ${users.length}`)
  }
)
```

### 5. Cross-Tenant Protection

```typescript
// Get user ID from Tenant 1
let tenant1UserId: number

await rlsContext.runAsync(
  { auth: { userId: 1, roles: ['admin'], tenantId: 1, isSystem: false } },
  async () => {
    const users = await userRepo.findAll()
    tenant1UserId = users[0].id
  }
)

// Try to access from Tenant 2 context
await rlsContext.runAsync(
  { auth: { userId: 3, roles: ['admin'], tenantId: 2, isSystem: false } },
  async () => {
    const user = await userRepo.findById(tenant1UserId)
    console.log(user) // null - RLS plugin blocked access!
  }
)
```

### 6. System Context (Bypass RLS)

```typescript
// System user can see all data across tenants
await rlsContext.runAsync(
  {
    auth: { userId: 0, roles: ['system'], tenantId: 0, isSystem: true },
    timestamp: new Date()
  },
  async () => {
    const allUsers = await userRepo.findAll()
    console.log(`System sees ALL users: ${allUsers.length}`)
    console.log('Tenants:', [...new Set(allUsers.map(u => u.tenant_id))])
  }
)
```

## Running the Example

```bash
pnpm dev
```

This will:

1. Initialize RLS plugin with tenant isolation schema
2. Create users in two different tenants (Acme and Beta)
3. Demonstrate automatic tenant filtering
4. Test cross-tenant access protection (returns null)
5. Show update and delete operations (tenant-scoped)
6. Demonstrate rapid context switching
7. Show system context bypassing RLS

## Benefits of RLS Plugin

### ✅ Security by Default

- **Automatic Filtering**: ALL queries filtered by tenant_id (no manual WHERE clauses)
- **Impossible to Bypass**: Can't forget to add tenant filter
- **Auto-Injection**: tenant_id automatically added to INSERT operations
- **Policy Enforcement**: Validates UPDATE/DELETE against tenant_id

### ✅ Clean Code

```typescript
// ❌ Old approach: Manual filtering (error-prone)
async findAll() {
  return executor
    .selectFrom('users')
    .selectAll()
    .where('tenant_id', '=', getTenantId()) // Easy to forget!
    .execute()
}

// ✅ New approach: Automatic filtering (RLS plugin)
async findAll() {
  return executor
    .selectFrom('users')
    .selectAll()
    .execute() // RLS plugin handles it!
}
```

### ✅ Maintainability

- **Single Source of Truth**: RLS schema defines all isolation rules
- **No Boilerplate**: Repositories don't need tenant context parameter
- **Easy Testing**: Mock RLS context for tests
- **Centralized Auditing**: All tenant access in one place

## Production Considerations

### 1. Tenant Extraction Middleware

```typescript
// Express middleware
app.use(async (req, res, next) => {
  try {
    // Extract tenant from JWT
    const token = req.headers.authorization?.replace('Bearer ', '')
    const { tenantId, userId, roles } = await verifyJWT(token)

    // Run request in RLS context
    await rlsContext.runAsync(
      {
        auth: { userId, roles, tenantId, isSystem: false },
        timestamp: new Date()
      },
      async () => {
        await next()
      }
    )
  } catch (error) {
    res.status(403).json({ error: 'Invalid tenant' })
  }
})
```

### 2. Database Indexes

```sql
-- Critical indexes for multi-tenant queries
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX idx_projects_tenant_id ON projects(tenant_id);
CREATE INDEX idx_tasks_tenant_id ON tasks(tenant_id);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);

-- Composite indexes for common queries
CREATE INDEX idx_projects_tenant_status ON projects(tenant_id, status);
CREATE INDEX idx_tasks_tenant_status ON tasks(tenant_id, status);
```

### 3. Combined with Audit Logging

```typescript
import { auditPlugin } from '@kysera/audit'
import { rlsPlugin } from '@kysera/rls'

const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema }), // Automatic tenant isolation
  auditPlugin({ enableRestore: true }) // Automatic audit logging
])

// Now ALL queries are:
// 1. Automatically filtered by tenant_id (RLS)
// 2. Automatically logged (Audit)
```

## Database Support

| Database   | RLS Plugin | Native RLS |
| ---------- | ---------- | ---------- |
| PostgreSQL | ✅ Full    | ✅ Yes     |
| MySQL      | ✅ Full    | ❌ No      |
| SQLite     | ✅ Full    | ❌ No      |
| MSSQL      | ✅ Full    | ✅ Yes     |

## Testing Tenant Isolation

```typescript
import { describe, it, expect } from 'vitest'

describe('Tenant Isolation', () => {
  it('should isolate users by tenant', async () => {
    // Tenant 1 creates user
    await rlsContext.runAsync(
      { auth: { userId: 1, roles: [], tenantId: 1, isSystem: false } },
      async () => {
        await userRepo.create({ email: 'alice@tenant1.com', name: 'Alice' })
      }
    )

    // Tenant 2 should NOT see Tenant 1's user
    await rlsContext.runAsync(
      { auth: { userId: 2, roles: [], tenantId: 2, isSystem: false } },
      async () => {
        const users = await userRepo.findAll()
        expect(users).toHaveLength(0) // RLS filtered it out
      }
    )
  })
})
```

## Project Structure

```
multi-tenant-saas/
├── src/
│   ├── db/
│   │   ├── schema.ts           # Database schema (TypeScript types)
│   │   ├── connection.ts       # DB connection setup
│   │   ├── migrations.ts       # Migration definitions
│   │   ├── migrate.ts          # Migration runner
│   │   └── seed.ts             # Seed test data
│   ├── repositories/
│   │   └── user.repository.ts  # User repository (RLS-enabled)
│   └── index.ts                # Example runner
├── package.json
├── tsconfig.json
└── README.md
```

## Key Takeaways

1. **Zero Manual Filtering**: RLS plugin handles ALL tenant isolation automatically
2. **Security by Default**: Impossible to accidentally leak data between tenants
3. **Clean Repositories**: No tenant context parameter, no manual WHERE clauses
4. **Type-Safe**: Full TypeScript support with Kysely's query builder
5. **Production-Ready**: Works with all major databases, includes audit logging
6. **Easy Testing**: Mock RLS context for unit tests

## Learn More

- [@kysera/rls Documentation](../../packages/rls/README.md)
- [@kysera/executor Documentation](../../packages/executor/README.md)
- [Multi-Tenancy Patterns](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches)
- [PostgreSQL Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
