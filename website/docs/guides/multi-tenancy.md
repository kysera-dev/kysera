---
sidebar_position: 5
title: Multi-Tenancy with RLS
description: Tenant isolation with the RLS plugin, schema-per-tenant scoping, and native PostgreSQL RLS
---

# Multi-Tenancy with RLS

This guide walks through building a multi-tenant application with Kysera: choosing an isolation architecture, enforcing row-based isolation with `@kysera/rls`, scoping by schema with `@kysera/executor`, and optionally generating native PostgreSQL RLS policies.

## Choosing an Architecture

**Row-based isolation** — all tenants share the same tables; every tenant-owned row carries a `tenant_id` column, and the [RLS plugin](/docs/plugins/rls) injects `WHERE tenant_id = ...` into queries automatically. One schema, one migration path, one connection pool. This is the right default for SaaS with many small tenants.

**Schema-per-tenant** — each tenant gets its own PostgreSQL schema with identical tables; queries are scoped with `executor.withSchema('tenant_x')`. Stronger physical separation and easy per-tenant export/drop, at the cost of running migrations once per tenant. Choose it for fewer, larger tenants or when isolation requirements demand separate namespaces.

The two compose: you can run row-based isolation inside a handful of shared schemas.

## Row-Based Isolation, End to End

The examples below use this schema:

```typescript
interface Database {
  tenants: { id: string; name: string }
  users: { id: string; tenant_id: string; email: string }
  orders: {
    id: string
    tenant_id: string
    owner_id: string
    status: string
  }
}
```

### 1. Define Policies

`defineRLSSchema` validates and returns a per-table policy map. Policies are created with the builder functions:

- `filter(operation, condition, options?)` — adds WHERE conditions; `operation` is `'read'` or `'all'`. The condition **must be synchronous** and return an object of column/value pairs.
- `allow(operation | operations[], condition, options?)` — grants access when the condition is true (evaluated against the affected row for update/delete).
- `deny(operation, condition?, options?)` — blocks access when the condition is true; runs before allows (default priority 100). With no condition, always denies.
- `validate('create' | 'update' | 'all', condition, options?)` — checks mutation data before execution.

<!-- doc-snippet: skip -->
```typescript
import { defineRLSSchema, filter, allow, deny, validate } from '@kysera/rls'

const rlsSchema = defineRLSSchema<Database>({
  orders: {
    policies: [
      // Every read is scoped to the caller's tenant
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),

      // New orders must belong to the caller's tenant
      validate('create', ctx => ctx.data?.tenant_id === ctx.auth.tenantId),

      // Only the owner may update or delete
      allow(['update', 'delete'], ctx => ctx.row?.owner_id === ctx.auth.userId),

      // Nobody deletes archived orders
      deny('delete', ctx => ctx.row?.status === 'archived')
    ],
    // Roles listed here bypass RLS for this table only
    skipFor: ['support']
  },
  users: {
    policies: [filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))]
  }
})
```

Per-table config also accepts `defaultDeny: true`, which flips the fallback: an operation is rejected unless an `allow` policy explicitly matches, instead of being permitted when no policy matches.

### 2. Create the Executor

```typescript
import { createExecutor } from '@kysera/executor'
import { rlsPlugin } from '@kysera/rls'

const executor = await createExecutor(db, [
  rlsPlugin({
    schema: rlsSchema,
    requireContext: true // the default — queries without a context throw
  })
])
```

Useful `rlsPlugin` options (all optional except `schema`): `tables` / `excludeTables` to scope which tables the plugin touches, `bypassRoles` for roles that skip RLS on **all** tables, `auditDecisions: true` to log every policy decision, `onViolation` callback, and `primaryKeyColumn` (default `'id'`) for the row lookups the mutation guards perform.

### 3. Establish Request-Scoped Context

The plugin reads tenant identity from an `AsyncLocalStorage`-backed context. Wrap each request in `rlsContext.run` / `rlsContext.runAsync` so every query inside the handler — through Repository, DAL, or the executor directly — is filtered without passing tenant IDs around:

```typescript
import { createRLSContext, rlsContext } from '@kysera/rls'

interface AuthedRequest {
  auth: { userId: string; tenantId: string; roles: string[] }
}

// Generic HTTP middleware (works with any framework exposing next())
function tenantMiddleware(req: AuthedRequest, _res: unknown, next: () => void) {
  const context = createRLSContext({
    auth: {
      userId: req.auth.userId,     // required
      roles: req.auth.roles,       // required (string[])
      tenantId: req.auth.tenantId  // optional, used by your filter policies
    }
  })
  rlsContext.run(context, next)
}

// Inside a handler: nothing tenant-specific in the query itself
const orders = await executor
  .selectFrom('orders')
  .selectAll()
  .execute() // WHERE tenant_id = <ctx.auth.tenantId> applied automatically
```

`createRLSContext` validates that `userId` is present and `roles` is an array. The auth object also accepts `organizationIds`, `permissions`, `attributes`, and `isSystem`.

### 4. What Is Enforced Where (0.9)

Since v0.9, filter policies are enforced at the **SQL level for UPDATE and DELETE as well as SELECT** — a mutation issued through any path (Repository, DAL, raw executor) cannot touch rows outside the caller's filter scope, because the same predicates are appended to the statement's WHERE clause.

INSERT has no WHERE clause to narrow, so value-level checks (`validate` and `allow` policies) run in the repository method wrappers (`create` / `update` / `delete` on repositories created via `createORM`). If you insert through the DAL or executor directly, route creates through a repository — or back them with [native PostgreSQL RLS](#native-postgresql-rls) — to keep value-level enforcement.

Repositories extended by the plugin also gain two helpers:

```typescript
await repo.withoutRLS(() => repo.findAll())   // run one operation as system
await repo.canAccess('update', row)           // boolean pre-flight check
```

### 5. System Jobs

Two distinct cases:

```typescript
import { createRLSContext, rlsContext } from '@kysera/rls'

// (a) Inside a request that already has a context: elevate temporarily.
// asSystemAsync THROWS if no context is active.
const allTenantsReport = await rlsContext.asSystemAsync(async () => {
  return executor.selectFrom('orders').selectAll().execute()
})

// (b) Standalone worker with no ambient context: run with an explicit
// system context instead.
const systemContext = createRLSContext({
  auth: { userId: 'system', roles: [], isSystem: true }
})

await rlsContext.runAsync(systemContext, async () => {
  await executor.deleteFrom('orders').where('status', '=', 'expired').execute()
})
```

`isSystem: true` bypasses all policies; it is context-bound and visible in audit logs, unlike a raw-connection escape hatch.

### 6. Test Policies Without a Database

The testing utilities are exported from the main `@kysera/rls` entry point:

```typescript
import {
  createPolicyTester,
  createTestAuthContext,
  policyAssertions
} from '@kysera/rls'

const tester = createPolicyTester(rlsSchema)

// evaluate() is async; returns { allowed, policyName?, decisionType, reason?, evaluatedPolicies }
const result = await tester.evaluate('orders', 'delete', {
  auth: createTestAuthContext({ userId: 'u1', tenantId: 't1', roles: ['member'] }),
  row: { id: 'o1', tenant_id: 't1', owner_id: 'u1', status: 'archived' }
})
policyAssertions.assertDenied(result) // deny('delete') on archived rows wins

// getFilters() is synchronous; returns { conditions, appliedFilters }
const filters = tester.getFilters('orders', 'read', {
  auth: createTestAuthContext({ userId: 'u1', tenantId: 't1' })
})
policyAssertions.assertFiltersInclude(filters, { tenant_id: 't1' })
```

`PolicyTester` also offers `testPolicy(table, policyName, context)`, `listPolicies(table)`, and `getTables()`.

## Schema-Per-Tenant

For schema-based isolation, scope queries with `withSchema` — the returned instance keeps full plugin interception — and use the built-in `schemaPlugin` from `@kysera/executor` to validate and default schemas centrally:

```typescript
import { createExecutor, schemaPlugin } from '@kysera/executor'

const executor = await createExecutor(db, [
  schemaPlugin({
    defaultSchema: 'public',
    allowedSchemas: ['public', 'tenant_a', 'tenant_b'],
    strictValidation: true // default: throw SchemaValidationError on unknown schemas
  })
])

// Per request:
const tenantDb = executor.withSchema(`tenant_${tenantId}`)
const orders = await tenantDb.selectFrom('orders').selectAll().execute()
```

Notes:

- `schemaPlugin` runs in the CONTEXT tier (priority 1100, before security plugins), and also accepts a `resolveSchema(context)` function for dynamic routing plus an async `validateSchema` hook checked at init. Other plugins can read the outcome via `getResolvedSchema(context)`.
- `withSchema` proxies are cached per executor in an LRU cache capped at **100 schemas**; beyond that, the least recently used proxy is rebuilt on demand. Calling `withSchema` per request is cheap.
- Migrations must run once per tenant schema — budget for that in your deploy pipeline.

## Native PostgreSQL RLS

For defense in depth on PostgreSQL you can enforce policies in the database itself, so even connections that bypass the application (psql, BI tools) are constrained. The `@kysera/rls/native` subpath generates the DDL from the same schema object.

Native generation only covers `allow` / `deny` policies that carry raw SQL in `using` / `withCheck` — those fields exist on plain policy object literals (the builder functions do not set them). `filter` and `validate` policies are ORM-only and are skipped:

```typescript
import { PostgresRLSGenerator, syncContextToPostgres } from '@kysera/rls/native'
import { defineRLSSchema } from '@kysera/rls'

const nativeSchema = defineRLSSchema<Database>({
  orders: {
    policies: [
      {
        type: 'allow',
        operation: 'all',
        condition: '', // unused for native policies
        name: 'tenant_isolation',
        using: 'tenant_id = rls_current_tenant_id()',
        withCheck: 'tenant_id = rls_current_tenant_id()'
      }
    ]
  }
})

const generator = new PostgresRLSGenerator()

generator.generateContextFunctions()
// SQL creating rls_current_user_id(), rls_current_tenant_id(), rls_has_role(), ...
// (STABLE functions reading app.* session settings)

generator.generateStatements(nativeSchema, {
  schemaName: 'public', // default
  force: true,          // default: FORCE ROW LEVEL SECURITY (applies to table owner too)
  policyPrefix: 'rls'   // default: prefix for generated policy names
})
// ['ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;', 'CREATE POLICY ...', ...]

generator.generateDropStatements(nativeSchema) // teardown
```

At runtime, mirror the application context into PostgreSQL session settings. `syncContextToPostgres` uses `set_config(..., true)`, which is **transaction-scoped** — call it at the start of each transaction (or request, when using a dedicated connection):

<!-- doc-snippet: skip -->
```typescript
import { clearPostgresContext } from '@kysera/rls/native'

await db.transaction().execute(async trx => {
  await syncContextToPostgres(trx, {
    userId: ctx.auth.userId,
    tenantId: ctx.auth.tenantId,
    roles: ctx.auth.roles
  })

  // Statements in this transaction are constrained by the native policies
  await trx.selectFrom('orders').selectAll().execute()
})

// For long-lived sessions outside transactions:
await clearPostgresContext(db)
```

## Pitfalls

:::warning

- **Never use `getRawDb` in tenant-facing code.** It returns the unwrapped Kysely instance and bypasses *every* plugin, including RLS. It exists for plugin internals. If you need to opt out of one plugin's behavior (e.g. include soft-deleted rows), use `withPluginMetadata(executor, {...})` — it keeps all other plugins active.
- **`withPluginMetadata` cannot disable RLS.** The metadata channel is reachable by any caller without authentication, so `@kysera/rls` deliberately ignores it. Sanctioned bypasses are context-bound and auditable: `ctx.auth.isSystem`, plugin-level `bypassRoles`, table-level `skipFor`, or `repo.withoutRLS()`.
- **`requireContext` defaults to `true`.** A query without a context throws `RLSContextError` — that's the secure default; don't turn it off to silence errors in jobs, give the job a system context instead. If you do set `requireContext: false` while keeping `allowUnfilteredQueries: false`, context-less SELECT/UPDATE/DELETE statements get an impossible predicate and match zero rows.
- **Filter conditions are synchronous.** Fetch anything async (e.g. a tenant lookup) *before* building the context, and read it from `ctx.auth` inside the filter.

:::

## Related

- [RLS Plugin](/docs/plugins/rls) — full plugin documentation
- [@kysera/rls API Reference](/docs/api/rls)
- [Multi-Tenant SaaS Example](/docs/examples/multi-tenant-saas)
- [Multi-Database Configuration](/docs/guides/multi-database)
