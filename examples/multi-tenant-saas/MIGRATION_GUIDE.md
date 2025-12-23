# Migration Guide: Manual Filtering → RLS Plugin

This document explains the changes made to migrate the multi-tenant-saas example from manual tenant filtering to using the @kysera/rls plugin.

## What Changed

### Before (Manual Filtering)
- Repositories accepted `(db, tenantContext)` parameters
- Every query manually added `WHERE tenant_id = getTenantId()`
- Every insert manually added `tenant_id: getTenantId()`
- Error-prone: easy to forget tenant filter

### After (RLS Plugin)
- Repositories accept only `(executor)` parameter
- RLS plugin automatically adds `WHERE tenant_id = X` to ALL queries
- RLS plugin automatically injects `tenant_id` on inserts
- Impossible to bypass: tenant isolation enforced at plugin level

## File Changes

### 1. src/db/connection.ts
**Added:**
```typescript
import 'dotenv/config' // Load environment variables
```

### 2. src/db/migrations.ts (NEW)
**Created:** Migration definitions for all tables
- 001_create_tenants
- 002_create_users
- 003_create_projects
- 004_create_tasks
- 005_create_audit_logs

### 3. src/db/migrate.ts (NEW)
**Created:** Migration runner script
```bash
pnpm migrate  # Run migrations
```

### 4. src/db/seed.ts (NEW)
**Created:** Seed script to create test data
- Creates 2 tenants (Acme Corporation, Beta Industries)
- Creates 2 users per tenant
- Creates 1 project per tenant
- Creates 2 tasks per project

```bash
pnpm seed  # Seed test data
```

### 5. src/repositories/user.repository.ts
**Before:**
```typescript
export function createUserRepository(
  executor: Executor<Database>,
  tenantContext: TenantContext
) {
  const getTenantId = () => tenantContext.getTenantId()

  return {
    async findAll() {
      return executor
        .selectFrom('users')
        .selectAll()
        .where('tenant_id', '=', getTenantId()) // Manual filter
        .execute()
    },

    async create(input: unknown) {
      return executor
        .insertInto('users')
        .values({
          ...validated,
          tenant_id: getTenantId() // Manual injection
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    }
  }
}
```

**After:**
```typescript
export function createUserRepository(executor: Executor<Database>) {
  return {
    async findAll() {
      return executor
        .selectFrom('users')
        .selectAll()
        .execute() // RLS plugin handles filtering!
    },

    async create(input: unknown) {
      return executor
        .insertInto('users')
        .values({
          ...validated
          // RLS plugin handles tenant_id injection!
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    }
  }
}
```

### 6. src/index.ts
**Before:**
```typescript
const tenantContext = new TenantContext()
tenantContext.setTenantId(1)
const userRepo = createUserRepository(db, tenantContext)
```

**After:**
```typescript
// Define RLS schema
const rlsSchema = defineRLSSchema<Database>({
  users: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      validate('create', ctx => {
        if (!ctx.data.tenant_id) {
          ctx.data.tenant_id = ctx.auth.tenantId
        }
        return ctx.data.tenant_id === ctx.auth.tenantId
      })
    ]
  }
})

// Create executor with RLS plugin
const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema })
])

// Use RLS context
await rlsContext.runAsync(
  {
    auth: { userId: 1, roles: ['admin'], tenantId: 1, isSystem: false },
    timestamp: new Date()
  },
  async () => {
    const userRepo = createUserRepository(executor)
    const users = await userRepo.findAll()
  }
)
```

## Key Benefits

### 1. Security by Default
- **Before**: Easy to forget `WHERE tenant_id = X` (security breach!)
- **After**: Impossible to bypass tenant filter

### 2. Clean Code
- **Before**: Manual filtering boilerplate in every method
- **After**: Focus on business logic

### 3. Single Source of Truth
- **Before**: Tenant isolation logic scattered across repositories
- **After**: Centralized in RLS schema

### 4. Easy Testing
- **Before**: Mock `TenantContext` for every test
- **After**: Mock `rlsContext` once

## Migration Steps

If you're migrating your own multi-tenant app:

1. **Install packages**
   ```bash
   pnpm add @kysera/executor @kysera/rls
   ```

2. **Define RLS schema**
   ```typescript
   const rlsSchema = defineRLSSchema<Database>({
     users: {
       policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))]
     }
   })
   ```

3. **Create executor with RLS plugin**
   ```typescript
   const executor = await createExecutor(db, [rlsPlugin({ schema: rlsSchema })])
   ```

4. **Update repositories**
   - Remove `tenantContext` parameter
   - Remove manual `WHERE tenant_id = ?` clauses
   - Remove manual `tenant_id` injection

5. **Update usage**
   - Replace `new TenantContext()` with `rlsContext.runAsync()`
   - Pass tenant info to RLS context

6. **Test thoroughly**
   - Verify tenant isolation still works
   - Check cross-tenant protection
   - Ensure no data leakage

## Running the Example

```bash
# Setup
pnpm install
export DATABASE_URL="postgresql://localhost/multitenant_example"

# Create database
createdb multitenant_example

# Run migrations
pnpm migrate

# Seed test data
pnpm seed

# Run example
pnpm dev
```

## What You'll See

```
🏢 Multi-Tenant SaaS Example - Kysera RLS Plugin
Database health: { status: 'healthy', latency: 2 }

⚙️  Setting up RLS plugin...
✅ RLS plugin initialized

📋 Automatic Tenant Isolation Demo

--- Tenant 1 (Acme) Operations ---
Created user in Tenant 1: { id: 5, name: 'Eve Engineer', tenant_id: 1 }
Tenant 1 can see 3 user(s):
  - Alice Admin (alice@acme.com) [tenant_id: 1]
  - Bob Member (bob@acme.com) [tenant_id: 1]
  - Eve Engineer (eve@acme.com) [tenant_id: 1]

--- Tenant 2 (Beta) Operations ---
Created user in Tenant 2: { id: 6, name: 'Frank Finance', tenant_id: 2 }
Tenant 2 can see 3 user(s):
  - Charlie Admin (charlie@beta.com) [tenant_id: 2]
  - Diana Member (diana@beta.com) [tenant_id: 2]
  - Frank Finance (frank@beta.com) [tenant_id: 2]

⚠️  Cross-Tenant Access Test
Tenant 1 user ID to test: 1
✅ Tenant isolation working correctly!
   Tenant 2 cannot access Tenant 1 user
   RLS plugin automatically filtered the query

📊 Summary
✅ RLS plugin automatically filters all queries by tenant_id
✅ No manual WHERE tenant_id = X needed in repository methods
✅ Complete tenant isolation enforced
✅ Context switching is simple and clean
✅ System context can bypass RLS when needed
```

## Troubleshooting

### "RLS context required but not found"
**Cause:** Trying to query without RLS context
**Fix:** Wrap queries in `rlsContext.runAsync()`

### "Cannot read property 'tenantId' of undefined"
**Cause:** Invalid RLS context
**Fix:** Ensure `auth.tenantId` is set in context

### Queries returning empty results
**Cause:** Wrong tenant ID in context
**Fix:** Verify `tenantId` matches your test data

## Learn More

- [RLS Plugin Documentation](../../packages/rls/README.md)
- [Executor Documentation](../../packages/executor/README.md)
- [Multi-Tenancy Best Practices](../../docs/multi-tenancy.md)
