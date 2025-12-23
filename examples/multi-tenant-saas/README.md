# Multi-Tenant SaaS Example

A comprehensive multi-tenant SaaS application demonstrating Kysera's tenant isolation patterns:

- **Tenant Isolation**: Complete data separation between organizations ✅
- **Manual Tenant Filtering**: Explicit tenant_id filtering in repositories ✅
- **Tenant Context**: Request-scoped tenant identification ✅
- **User Repository**: Tenant-scoped user management with validation ✅
- **Database Schema**: Multi-table schema with tenant isolation ✅
- **Cross-Runtime**: Works on Node.js, Bun, and Deno ✅

**Note**: This example demonstrates the core tenant isolation pattern. Additional features like projects/tasks repositories, audit logging, and automatic timestamps are defined in the schema but not yet fully implemented in repository code.

## Architecture

### Tenant Isolation Strategy

This example uses **discriminator column** approach with `tenant_id`:

```
┌─────────────────────────────────────┐
│         Application Layer           │
│  (Extract tenant from request)      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│       Tenant Context Middleware     │
│   tenant_context.setTenantId(1)     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Tenant-Scoped Repositories        │
│  (Manual tenant_id injection)       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│         Database Layer              │
│  WHERE tenant_id = <current_tenant> │
└─────────────────────────────────────┘
```

### Database Schema

The schema defines tables for a complete multi-tenant system. Currently, the user repository is fully implemented:

```typescript
// Global table (not scoped)
tenants {
  id, name, slug, plan, max_users
}

// Tenant-scoped tables (all have tenant_id)
users { id, tenant_id, email, name, role }           // ✅ Repository implemented
projects { id, tenant_id, name, description, status } // Schema defined
tasks { id, tenant_id, project_id, title, status, assigned_to } // Schema defined
audit_logs { id, tenant_id, table_name, entity_id, operation } // Schema defined
```

## Features Demonstrated

### 1. Tenant Context

Extract tenant from various sources:

```typescript
// From subdomain: acme.app.com -> tenant 'acme'
const tenantSlug = extractTenantFromSubdomain(req.hostname)

// From header: X-Tenant-ID: 123
const tenantId = extractTenantFromHeader(req.headers)

// From JWT token
const tenantId = jwt.verify(token).tenantId

// Set tenant context
const tenantContext = new TenantContext()
tenantContext.setTenantId(tenantId)
```

### 2. Tenant-Scoped Repository

Manually filter by tenant_id in repository methods:

```typescript
const userRepo = createUserRepository(db, tenantContext)

// Repository manually adds WHERE tenant_id = 1 to all queries
const users = await userRepo.findAll()

// Repository manually injects tenant_id from context
const user = await userRepo.create({
  email: 'john@acme.com',
  name: 'John Doe'
})
// INSERT INTO users (email, name, tenant_id) VALUES (?, ?, 1)
```

### 3. Cross-Tenant Protection

Tenant isolation is enforced at repository level:

```typescript
const tenant1Context = new TenantContext()
tenant1Context.setTenantId(1) // Tenant 'Acme Corp'
const tenant1UserRepo = createUserRepository(db, tenant1Context)

// User from Tenant 1
const user = await tenant1UserRepo.findById(100)

const tenant2Context = new TenantContext()
tenant2Context.setTenantId(2) // Tenant 'Beta Inc'
const tenant2UserRepo = createUserRepository(db, tenant2Context)

// Same ID, different tenant -> returns null (not found)
const sameUser = await tenant2UserRepo.findById(100) // null
```

### 4. Data Validation

Each repository enforces schema validation:

```typescript
const userRepo = createUserRepository(db, tenantContext)

// Valid user creation
const user = await userRepo.create({
  email: 'valid@example.com',
  name: 'John Doe',
  role: 'member'
})

// Invalid data throws validation error
try {
  await userRepo.create({
    email: 'invalid-email', // Invalid email format
    name: '' // Empty name
  })
} catch (error) {
  console.error('Validation failed:', error)
}
```

**Note**: Audit logging is defined in the schema but not yet implemented in this example. See `/Users/taaliman/projects/luxquant/kysera-dev/kysera/packages/audit` for the audit package.

## Setup

```bash
# Install dependencies
cd examples/multi-tenant-saas
pnpm install

# Set up PostgreSQL database
createdb multitenant_saas

# Set environment variables
export DATABASE_URL="postgresql://localhost/multitenant_saas"

# Note: Migration script not yet implemented
# You'll need to create the tables manually or use a migration tool
# See src/db/schema.ts for the schema definition

# Build
pnpm build

# Run the example
pnpm start
```

## Running the Example

```bash
pnpm start
```

This will:

1. Check database health
2. Create tenant contexts for two tenants
3. Create users for each tenant
4. Demonstrate tenant isolation (users are scoped to their tenant)
5. Show cross-tenant protection (tenant 2 cannot access tenant 1's users)
6. Test update operations within tenant scope
7. Search users by email within tenant scope
8. Clean up and close database connection

## Code Examples

### Creating Tenants

```typescript
// Create tenant (global scope, no tenant_id)
const tenant = await db
  .insertInto('tenants')
  .values({
    name: 'Acme Corp',
    slug: 'acme',
    plan: 'enterprise',
    max_users: 100
  })
  .returningAll()
  .executeTakeFirstOrThrow()
```

### Tenant-Scoped Operations

```typescript
// Set tenant context
const tenantContext = new TenantContext()
tenantContext.setTenantId(tenant.id)

// Create user repository for this tenant
const userRepo = createUserRepository(db, tenantContext)

// All operations are manually scoped to the tenant by the repository
const user = await userRepo.create({
  email: 'john@acme.com',
  name: 'John Doe',
  role: 'owner'
})

// Update user (only within same tenant)
const updatedUser = await userRepo.update(user.id, {
  name: 'John Doe (Updated)'
})

// Find user by email (only within same tenant)
const foundUser = await userRepo.findByEmail('john@acme.com')

// Get all users (only for current tenant)
const allUsers = await userRepo.findAll()
```

### Querying Across Tenants (Admin)

```typescript
// Get all tenants (admin operation, not scoped)
const allTenants = await db.selectFrom('tenants').selectAll().execute()

for (const tenant of allTenants) {
  // Create a context for each tenant
  const tenantContext = new TenantContext()
  tenantContext.setTenantId(tenant.id)

  // Create repository scoped to this tenant
  const userRepo = createUserRepository(db, tenantContext)

  // Get users for this tenant
  const users = await userRepo.findAll()

  console.log(`${tenant.name}: ${users.length} user(s)`)
}
```

## Security Considerations

### ✅ DO

- **Always** validate tenant_id before operations
- **Use** tenant context middleware in every request
- **Enforce** tenant isolation at repository level
- **Audit** all cross-tenant operations
- **Limit** admin operations with proper authorization
- **Test** tenant isolation thoroughly

### ❌ DON'T

- **Never** trust tenant_id from client input
- **Don't** expose tenant IDs in URLs (use slugs instead)
- **Avoid** global admin endpoints without strict auth
- **Don't** share database connections across tenants
- **Never** bypass tenant context for convenience

## Production Considerations

### 1. Tenant Extraction

```typescript
// Extract from JWT (recommended)
const token = req.headers.authorization?.replace('Bearer ', '')
const payload = await verifyJWT(token)
const tenantId = payload.tenantId

// Extract from subdomain
const subdomain = req.hostname.split('.')[0]
const tenant = await db
  .selectFrom('tenants')
  .where('slug', '=', subdomain)
  .select('id')
  .executeTakeFirst()
```

### 2. Request Middleware (Express)

```typescript
app.use(async (req, res, next) => {
  try {
    // Extract tenant from request
    const tenantId = await extractTenantId(req)

    // Create tenant context
    req.tenantContext = new TenantContext()
    req.tenantContext.setTenantId(tenantId)

    // Create tenant-scoped user repository
    req.userRepo = createUserRepository(db, req.tenantContext)

    next()
  } catch (error) {
    res.status(403).json({ error: 'Invalid tenant' })
  }
})
```

### 3. Database Indexes

```sql
-- Critical indexes for multi-tenant queries
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);

-- If implementing projects and tasks:
CREATE INDEX idx_projects_tenant_id ON projects(tenant_id);
CREATE INDEX idx_tasks_tenant_id ON tasks(tenant_id);
CREATE INDEX idx_tasks_tenant_project ON tasks(tenant_id, project_id);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);

-- Composite indexes for common queries
CREATE INDEX idx_projects_tenant_status ON projects(tenant_id, status);
CREATE INDEX idx_tasks_tenant_status ON tasks(tenant_id, status);
```

### 4. Rate Limiting Per Tenant

```typescript
import rateLimit from 'express-rate-limit'

const createTenantRateLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: req => {
      // Get tenant plan from database
      const tenant = req.tenant
      return tenant.plan === 'enterprise' ? 1000 : 100
    },
    keyGenerator: req => {
      return `tenant:${req.tenantContext.getTenantId()}`
    }
  })
```

## Advanced Patterns

### Multi-Database Per Tenant

For larger tenants, use separate databases:

```typescript
const getDatabaseForTenant = (tenantId: number) => {
  const tenant = tenants.get(tenantId)

  if (tenant.plan === 'enterprise') {
    // Dedicated database for enterprise tenants
    return new Kysely({
      dialect: new PostgresDialect({
        database: `tenant_${tenantId}`
      })
    })
  }

  // Shared database with tenant_id for smaller tenants
  return sharedDb
}
```

### Tenant-Specific Configuration

```typescript
const tenantConfig = await db
  .selectFrom('tenant_config')
  .where('tenant_id', '=', tenantContext.getTenantId())
  .selectAll()
  .executeTakeFirst()

// Apply tenant-specific settings
const features = tenantConfig.enabled_features
const limits = tenantConfig.resource_limits
```

## Project Structure

```
multi-tenant-saas/
├── src/
│   ├── db/
│   │   ├── schema.ts           # Database schema (TypeScript types)
│   │   └── connection.ts       # DB connection setup
│   ├── middleware/
│   │   └── tenant-context.ts   # Tenant context management
│   ├── repositories/
│   │   └── user.repository.ts  # Tenant-scoped user repository ✅
│   └── index.ts                # Example runner
├── package.json
├── tsconfig.json
└── README.md
```

**Note**: The schema defines tables for projects, tasks, and audit_logs, but repositories for these are not yet implemented. This example focuses on demonstrating the tenant isolation pattern with the user repository.

## Key Takeaways

1. **Tenant Isolation**: Enforced at repository level through manual tenant_id filtering
2. **Context Management**: Request-scoped tenant identification via TenantContext
3. **Manual Filtering**: Repositories explicitly add WHERE tenant_id clauses to all queries
4. **Validation**: Zod schemas ensure data integrity for each tenant
5. **Security**: Cross-tenant data access is prevented at the repository layer
6. **Scalability**: Pattern supports millions of tenants with proper indexing
7. **Type Safety**: Full TypeScript support with Kysely's type-safe query builder

## Implementation Status

✅ **Fully Implemented:**

- Tenant context management (`TenantContext`)
- User repository with tenant isolation
- Cross-tenant protection
- Zod validation for user data
- Database health checks

📋 **Schema Defined (Not Yet Implemented):**

- Projects repository
- Tasks repository
- Audit logging repository
- Migration scripts

## Using Unified Execution Layer with RLS (v0.7) 🆕

**New in v0.7**: Kysera introduces the Unified Execution Layer with automatic Row-Level Security (RLS) that eliminates manual tenant filtering.

### Why Use the Unified Execution Layer?

The traditional approach (shown in this example) requires **manual** `WHERE tenant_id = getTenantId()` in every query. This is error-prone:

```typescript
// ❌ Old pattern: Easy to forget tenant filter
async findAll() {
  return executor
    .selectFrom('users')
    .selectAll()
    // Oops! Forgot .where('tenant_id', '=', getTenantId())
    .execute() // 🚨 SECURITY BREACH: Returns ALL tenants' users!
}
```

With the Unified Execution Layer + RLS plugin, tenant filtering is **automatic** and **impossible to bypass**:

```typescript
// ✅ New pattern: Automatic tenant isolation
async findAll() {
  return executor
    .selectFrom('users')
    .selectAll()
    .execute() // ✅ Automatically filtered by tenant_id
}
```

### Setup with Unified Execution Layer

**Step 1: Define RLS Schema**

```typescript
import { createExecutor } from '@kysera/executor'
import { rlsPlugin } from '@kysera/rls'
import type { Database } from './db/schema'

// Define which tables need tenant isolation
const rlsSchema = {
  users: {
    column: 'tenant_id',
    getContext: () => tenantContext.getTenantId()
  },
  projects: {
    column: 'tenant_id',
    getContext: () => tenantContext.getTenantId()
  },
  tasks: {
    column: 'tenant_id',
    getContext: () => tenantContext.getTenantId()
  },
  audit_logs: {
    column: 'tenant_id',
    getContext: () => tenantContext.getTenantId()
  }
  // Note: 'tenants' table is intentionally excluded (global scope)
}

// Create executor with RLS plugin
const executor = await createExecutor<Database>(db, [
  rlsPlugin({ schema: rlsSchema })
])
```

**Step 2: Simplified Repository (No Manual Filters)**

```typescript
export function createUserRepository(
  executor: Executor<Database>
  // Note: No tenantContext needed anymore!
) {
  return {
    // All queries automatically filtered by tenant_id
    async findAll() {
      return executor.selectFrom('users').selectAll().execute()
      // RLS plugin automatically adds: WHERE tenant_id = <current_tenant>
    },

    async findById(id: string) {
      return executor
        .selectFrom('users')
        .where('id', '=', id)
        .selectAll()
        .executeTakeFirst()
      // RLS plugin automatically adds: AND tenant_id = <current_tenant>
    },

    async create(data: NewUser) {
      return executor
        .insertInto('users')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow()
      // RLS plugin automatically injects tenant_id into values
    },

    async update(id: string, data: Partial<UserUpdate>) {
      return executor
        .updateTable('users')
        .set(data)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()
      // RLS plugin ensures you can only update users in your tenant
    }
  }
}
```

### Benefits for Multi-Tenant Applications

1. **Security by Default**
   - Automatic tenant isolation on **ALL** queries (SELECT, INSERT, UPDATE, DELETE)
   - Impossible to accidentally leak data between tenants
   - No manual `WHERE tenant_id = ?` clauses needed

2. **Clean Code**
   - Repositories don't need tenant context parameter
   - No repetitive tenant filtering boilerplate
   - Focus on business logic, not security plumbing

3. **Maintainability**
   - Single source of truth for RLS rules (the RLS schema)
   - Changes to tenant isolation logic happen in one place
   - Easier to audit and test

4. **Performance**
   - RLS filters are added at query build time (no runtime overhead)
   - Database can optimize queries with tenant_id in WHERE clause
   - Works with all database indexes

### Combined with Audit Logging

For complete multi-tenant security, combine RLS with audit logging:

```typescript
import { auditPlugin } from '@kysera/audit'
import { rlsPlugin } from '@kysera/rls'

const executor = await createExecutor<Database>(db, [
  // Automatic tenant isolation
  rlsPlugin({ schema: rlsSchema }),

  // Automatic audit logging with tenant context
  auditPlugin({
    tenantId: () => tenantContext.getTenantId(),
    userId: () => getCurrentUserId(),
    enableRestore: true // Enable audit log restoration
  })
])

// Now ALL queries are:
// 1. Automatically filtered by tenant_id (RLS)
// 2. Automatically logged with tenant context (Audit)
const user = await executor
  .selectFrom('users')
  .where('email', '=', 'john@acme.com')
  .selectAll()
  .executeTakeFirst()

// Audit log entry created:
// {
//   tenant_id: 1,
//   user_id: 'current-user-id',
//   table_name: 'users',
//   operation: 'SELECT',
//   entity_id: user.id,
//   timestamp: '2025-12-23T10:30:00Z'
// }
```

### Database Support for Multi-Tenant

The Unified Execution Layer with RLS works across all supported databases:

| Database   | RLS Support | Notes                                     |
| ---------- | ----------- | ----------------------------------------- |
| PostgreSQL | ✅ Full     | Native RLS + plugin-based RLS             |
| MySQL      | ✅ Full     | Plugin-based RLS (no native RLS)          |
| SQLite     | ✅ Full     | Plugin-based RLS (no native RLS)          |
| MSSQL      | ✅ Full     | Native RLS + plugin-based RLS (see below) |

**PostgreSQL Native RLS (Alternative Approach)**

PostgreSQL also supports native Row-Level Security policies:

```sql
-- Enable RLS on table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policy for tenant isolation
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant_id')::integer);

-- In application, set tenant context
await db.executeQuery(
  sql`SET LOCAL app.current_tenant_id = ${tenantId}`
)
```

**When to use native RLS:**
- Maximum security (enforced at database level, even for raw SQL)
- Multi-language applications (policies work for all clients)
- Auditing requirements (database-level enforcement)

**When to use plugin-based RLS (Kysera):**
- Cross-database compatibility (works on MySQL, SQLite, etc.)
- Application-level control (easier testing, debugging)
- Better TypeScript integration
- Dynamic RLS rules (can change at runtime)

### Migration Path from Manual Filtering

If you're upgrading an existing multi-tenant app:

**Before (Manual):**
```typescript
const userRepo = createUserRepository(db, tenantContext)
const users = await userRepo.findAll()
```

**After (Unified Execution Layer):**
```typescript
const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema })
])
const userRepo = createUserRepository(executor)
const users = await userRepo.findAll()
```

**Migration Steps:**
1. Install packages: `pnpm add @kysera/executor @kysera/rls`
2. Define RLS schema for all tenant-scoped tables
3. Create executor with `rlsPlugin`
4. Update repositories to remove manual `WHERE tenant_id = ?` clauses
5. Remove `tenantContext` parameter from repositories
6. Test thoroughly (RLS should produce identical results)

### Testing Tenant Isolation

```typescript
import { describe, it, expect } from 'vitest'

describe('Tenant Isolation with RLS', () => {
  it('should isolate users by tenant', async () => {
    // Create executor for tenant 1
    const tenant1Context = new TenantContext()
    tenant1Context.setTenantId(1)
    const executor1 = await createExecutor(db, [
      rlsPlugin({
        schema: {
          users: {
            column: 'tenant_id',
            getContext: () => tenant1Context.getTenantId()
          }
        }
      })
    ])

    // Create executor for tenant 2
    const tenant2Context = new TenantContext()
    tenant2Context.setTenantId(2)
    const executor2 = await createExecutor(db, [
      rlsPlugin({
        schema: {
          users: {
            column: 'tenant_id',
            getContext: () => tenant2Context.getTenantId()
          }
        }
      })
    ])

    // Insert user for tenant 1
    const user1 = await executor1
      .insertInto('users')
      .values({ email: 'alice@tenant1.com', name: 'Alice' })
      .returningAll()
      .executeTakeFirstOrThrow()

    // Tenant 2 should NOT see tenant 1's user
    const users = await executor2.selectFrom('users').selectAll().execute()
    expect(users).not.toContainEqual(expect.objectContaining({ id: user1.id }))

    // Tenant 1 should see their own user
    const tenant1Users = await executor1.selectFrom('users').selectAll().execute()
    expect(tenant1Users).toContainEqual(expect.objectContaining({ id: user1.id }))
  })
})
```

## Extending This Example

To add more repositories, follow the pattern in `user.repository.ts`:

### Traditional Approach (Manual Filtering)

1. Create a repository file (e.g., `project.repository.ts`)
2. Accept `executor` and `tenantContext` parameters
3. Add `WHERE tenant_id = getTenantId()` to all queries
4. Auto-inject `tenant_id` in create/insert operations
5. Add Zod schemas for validation

Example:

```typescript
export function createProjectRepository(
  executor: Executor<Database>,
  tenantContext: TenantContext
) {
  const getTenantId = () => tenantContext.getTenantId()

  return {
    async findAll() {
      return executor
        .selectFrom('projects')
        .selectAll()
        .where('tenant_id', '=', getTenantId()) // Key: tenant filter
        .execute()
    }
  }
}
```

### Recommended Approach (v0.7 Unified Execution Layer)

1. Create a repository file (e.g., `project.repository.ts`)
2. Accept `executor` parameter (no `tenantContext` needed)
3. **NO** manual tenant filtering required
4. Add Zod schemas for validation

Example:

```typescript
export function createProjectRepository(executor: Executor<Database>) {
  return {
    async findAll() {
      return executor
        .selectFrom('projects')
        .selectAll()
        .execute() // RLS plugin automatically adds tenant filter
    },

    async create(data: NewProject) {
      return executor
        .insertInto('projects')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow() // RLS plugin automatically injects tenant_id
    }
  }
}
```

## Learn More

- [Multi-Tenancy Patterns](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches)
- [Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Kysera Best Practices](../../BEST_PRACTICES.md)
