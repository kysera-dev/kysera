# Multi-Tenant SaaS Example

A comprehensive multi-tenant SaaS application demonstrating Kysera's tenant isolation patterns:

- **Tenant Isolation**: Complete data separation between organizations
- **Row-Level Security**: Automatic tenant_id filtering
- **Tenant Context**: Request-scoped tenant identification
- **Audit Logging**: Track all changes per tenant
- **Timestamps**: Automatic created_at/updated_at
- **Validation**: Tenant-specific data validation

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
│  (Automatic tenant_id injection)    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│         Database Layer              │
│  WHERE tenant_id = <current_tenant> │
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

### 2. Tenant-Scoped Repositories

Automatically filter by tenant_id:

```typescript
const repos = createTenantRepositories(db, tenantContext)

// This query is automatically filtered: WHERE tenant_id = 1
const users = await repos.users.findAll()

// Tenant_id is automatically injected
const user = await repos.users.create({
  email: 'john@acme.com',
  name: 'John Doe'
})
// INSERT INTO users (email, name, tenant_id) VALUES (?, ?, 1)
```

### 3. Cross-Tenant Protection

Tenant isolation is enforced at repository level:

```typescript
tenantContext.setTenantId(1) // Tenant 'Acme Corp'

// User from Tenant 1
const user = await repos.users.findById(100)

tenantContext.setTenantId(2) // Switch to Tenant 'Beta Inc'

// Same ID, different tenant -> returns null (not found)
const sameUser = await repos.users.findById(100) // null
```

### 4. Audit Logging Per Tenant

Track all changes scoped to tenant:

```typescript
// Audit logs automatically include tenant_id
const user = await repos.users.create({ email, name })

// Audit log created:
{
  tenant_id: 1,
  table_name: 'users',
  entity_id: '123',
  operation: 'INSERT',
  new_values: { email, name }
}

// Query audit logs for current tenant only
const logs = await db
  .selectFrom('audit_logs')
  .where('tenant_id', '=', tenantContext.getTenantId())
  .selectAll()
  .execute()
```

## Setup

```bash
# Install dependencies
cd examples/multi-tenant-saas
pnpm install

# Set up PostgreSQL database
createdb multitenant_saas

# Set environment variables
export DATABASE_URL="postgresql://localhost/multitenant_saas"

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
1. Create two tenants (Acme Corp, Beta Inc)
2. Create users for each tenant
3. Create projects and tasks
4. Demonstrate tenant isolation
5. Show cross-tenant protection
6. Display audit logs per tenant
7. Clean up

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
tenantContext.setTenantId(tenant.id)

// Create repositories for this tenant
const repos = createTenantRepositories(db, tenantContext)

// All operations are automatically scoped
const user = await repos.users.create({
  email: 'john@acme.com',
  name: 'John Doe',
  role: 'owner'
})

const project = await repos.projects.create({
  name: 'Website Redesign',
  description: 'Redesign company website',
  status: 'active'
})

const task = await repos.tasks.create({
  project_id: project.id,
  title: 'Design mockups',
  status: 'todo',
  assigned_to: user.id
})
```

### Querying Across Tenants (Admin)

```typescript
// Get all tenants (admin operation)
const allTenants = await db
  .selectFrom('tenants')
  .selectAll()
  .execute()

for (const tenant of allTenants) {
  tenantContext.setTenantId(tenant.id)
  const repos = createTenantRepositories(db, tenantContext)

  const userCount = await db
    .selectFrom('users')
    .where('tenant_id', '=', tenant.id)
    .select(({ fn }) => fn.countAll().as('count'))
    .executeTakeFirst()

  console.log(`${tenant.name}: ${userCount?.count} users`)
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

    // Create tenant-scoped repositories
    req.repos = createTenantRepositories(db, req.tenantContext)

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
CREATE INDEX idx_projects_tenant_id ON projects(tenant_id);
CREATE INDEX idx_tasks_tenant_id ON tasks(tenant_id);
CREATE INDEX idx_tasks_tenant_project ON tasks(tenant_id, project_id);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);

-- Composite indexes for common queries
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
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
│   │   ├── schema.ts           # Database schema
│   │   └── connection.ts       # DB connection
│   ├── middleware/
│   │   └── tenant-context.ts   # Tenant context management
│   ├── repositories/
│   │   └── tenant-scoped.factory.ts  # Tenant-scoped repositories
│   └── index.ts                # Example runner
├── package.json
├── tsconfig.json
└── README.md
```

## Key Takeaways

1. **Tenant Isolation**: Enforced at repository level
2. **Context Management**: Request-scoped tenant identification
3. **Automatic Filtering**: Repository methods inject tenant_id
4. **Audit Trail**: Complete history per tenant
5. **Security**: Multiple layers of protection
6. **Scalability**: Pattern supports millions of tenants

## Learn More

- [Multi-Tenancy Patterns](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches)
- [Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Kysera Best Practices](../../BEST_PRACTICES.md)
