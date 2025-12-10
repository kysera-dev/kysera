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
const allTenants = await db
  .selectFrom('tenants')
  .selectAll()
  .execute()

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

const createTenantRateLimiter = () => rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Get tenant plan from database
    const tenant = req.tenant
    return tenant.plan === 'enterprise' ? 1000 : 100
  },
  keyGenerator: (req) => {
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

## Extending This Example

To add more repositories, follow the pattern in `user.repository.ts`:

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

## Learn More

- [Multi-Tenancy Patterns](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches)
- [Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Kysera Best Practices](../../BEST_PRACTICES.md)
