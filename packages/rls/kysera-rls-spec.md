# @kysera/rls - Row-Level Security System Specification

## Executive Summary

This specification defines a comprehensive, high-performance Row-Level Security (RLS) system for the Kysera ORM ecosystem. The solution synthesizes best practices from PostgreSQL native RLS, ZenStack, Supabase, and Drizzle ORM to create a TypeScript-first, type-safe authorization layer that operates at both ORM and database levels.

**Key Innovation**: Dual-layer enforcement with declarative policy DSL, automatic query transformation, and optional native PostgreSQL RLS generation.

---

## Table of Contents

1. [Research Analysis & Synthesis](#1-research-analysis--synthesis)
2. [Architecture Overview](#2-architecture-overview)
3. [Core Concepts](#3-core-concepts)
4. [Policy Definition DSL](#4-policy-definition-dsl)
5. [Runtime Context Management](#5-runtime-context-management)
6. [Query Transformation Engine](#6-query-transformation-engine)
7. [PostgreSQL Native RLS Integration](#7-postgresql-native-rls-integration)
8. [Type System](#8-type-system)
9. [Plugin Architecture](#9-plugin-architecture)
10. [Titan Integration](#10-titan-integration)
11. [Performance Optimizations](#11-performance-optimizations)
12. [Security Considerations](#12-security-considerations)
13. [API Reference](#13-api-reference)
14. [Implementation Plan](#14-implementation-plan)
15. [Migration Guide](#15-migration-guide)

---

## 1. Research Analysis & Synthesis

### 1.1 PostgreSQL Native RLS

**Strengths:**
- Database-level enforcement (can't bypass through raw SQL)
- Automatic WHERE clause injection
- USING/WITH CHECK separation for read vs write
- Role-based policy application

**Limitations:**
- Coarse-grained (row-level only, not field-level)
- Performance pitfalls (non-STABLE functions, missing indexes)
- Complex join policies cause performance degradation
- No centralized policy management

**Key Insights:**
```sql
-- Best practice: Use STABLE functions for context
CREATE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE SQL STABLE
AS $$ SELECT current_setting('app.tenant_id', true)::uuid $$;

-- Performance: Use subselect pattern for JWT caching
CREATE POLICY tenant_isolation ON resources
USING (tenant_id = (SELECT current_tenant_id()));
```

### 1.2 ZenStack

**Strengths:**
- Declarative @@allow/@@deny syntax
- Relationship traversal in policies
- auth() function for current user context
- Field-level access control (via relations)
- Auto-generated enhanced client

**Limitations:**
- Prisma-specific (V2), but V3 uses Kysely
- Limited native database enforcement
- Runtime overhead for policy evaluation

**Key Insights:**
```zmodel
// ZenStack's elegant syntax
@@allow('read', auth().roles?[permissions?[name == 'view']])
@@allow('create', auth().reputation >= 100)
@@deny('delete', status == 'published')
```

### 1.3 Supabase RLS

**Strengths:**
- Native PostgreSQL RLS with helper functions
- auth.uid(), auth.jwt() for context
- Subselect caching pattern
- Permissive/restrictive policy types

**Limitations:**
- PostgreSQL-only
- Requires manual SQL policy management
- Performance debugging is complex

**Key Insights:**
```sql
-- Supabase pattern: Cached context via subselect
USING (user_id = (SELECT auth.uid()))

-- Team-based access with array operators
USING (team_id = ANY((SELECT auth.jwt() -> 'app_metadata' -> 'teams')::uuid[]))
```

### 1.4 Drizzle ORM

**Strengths:**
- TypeScript-native policy definitions
- pgPolicy() in table schema
- crudPolicy() helper for common patterns
- Migration integration

**Limitations:**
- PostgreSQL-specific
- Generates native RLS only (no ORM enforcement)
- Limited dynamic policy support

**Key Insights:**
```typescript
// Drizzle's TypeScript-native approach
pgPolicy('tenant_isolation', {
  as: 'permissive',
  for: 'all',
  using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  withCheck: sql`tenant_id = current_setting('app.tenant_id')::uuid`
})
```

### 1.5 Synthesis: Kysera RLS Design Principles

Based on analysis, Kysera RLS must provide:

1. **Declarative Policy DSL** (inspired by ZenStack)
2. **Dual Enforcement** (ORM + optional native RLS)
3. **Type-Safe Context** (full TypeScript inference)
4. **Performance-First** (STABLE caching, index-aware)
5. **Multi-Dialect Support** (PostgreSQL, MySQL, SQLite)
6. **Plugin Architecture** (consistent with Kysera ecosystem)
7. **Titan Integration** (seamless decorator-based API)

---

## 2. Architecture Overview

### 2.1 System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Policy Schema  │  │  Context Setup  │  │  Repository Usage   │  │
│  │  (Declarative)  │  │  (per-request)  │  │  (transparent)      │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────┬───────────┘  │
└───────────┼──────────────────────────────────────────┼───────────────┘
            │                    │                      │
            ▼                    ▼                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         @kysera/rls PLUGIN                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ Policy Registry │  │ Context Manager │  │  Query Transformer  │  │
│  │ (compiled rules)│  │ (AsyncLocalStorage)│ │  (interceptQuery)   │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────┬───────────┘  │
│           │                    │                      │              │
│           └────────────────────┼──────────────────────┘              │
│                                │                                     │
│  ┌─────────────────────────────┴────────────────────────────────────┐│
│  │                    POLICY EVALUATION ENGINE                       ││
│  │  • Compile-time policy optimization                               ││
│  │  • Runtime condition evaluation                                   ││
│  │  • Row filtering (SELECT) + Mutation guards (INSERT/UPDATE/DELETE)││
│  └───────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
            │                                          │
            ▼                                          ▼
┌──────────────────────────────┐    ┌──────────────────────────────────┐
│    ORM-Level Enforcement     │    │  Native RLS Generation (Optional)│
│  • Query interception        │    │  • PostgreSQL CREATE POLICY      │
│  • WHERE clause injection    │    │  • Migration generation          │
│  • Mutation pre-checks       │    │  • Sync with ORM policies        │
└──────────────────────────────┘    └──────────────────────────────────┘
```

### 2.2 Package Structure

```
@kysera/rls/
├── src/
│   ├── index.ts                    # Public API exports
│   ├── plugin.ts                   # Kysera plugin implementation
│   ├── policy/
│   │   ├── schema.ts               # Policy schema definitions
│   │   ├── builder.ts              # Fluent policy builder
│   │   ├── compiler.ts             # Policy -> SQL compiler
│   │   ├── evaluator.ts            # Runtime policy evaluation
│   │   └── types.ts                # Policy type definitions
│   ├── context/
│   │   ├── manager.ts              # RLS context management
│   │   ├── storage.ts              # AsyncLocalStorage wrapper
│   │   └── types.ts                # Context types
│   ├── transformer/
│   │   ├── query.ts                # Query transformation logic
│   │   ├── select.ts               # SELECT query handler
│   │   ├── insert.ts               # INSERT mutation handler
│   │   ├── update.ts               # UPDATE mutation handler
│   │   └── delete.ts               # DELETE mutation handler
│   ├── native/
│   │   ├── postgres.ts             # PostgreSQL RLS generator
│   │   ├── migration.ts            # Migration file generator
│   │   └── sync.ts                 # ORM <-> Native sync
│   ├── decorators/
│   │   ├── policy.ts               # @Policy decorator
│   │   ├── allow.ts                # @Allow decorator
│   │   ├── deny.ts                 # @Deny decorator
│   │   └── field.ts                # @FieldPolicy decorator
│   └── utils/
│       ├── sql.ts                  # SQL generation utilities
│       ├── expression.ts           # Expression parser
│       └── validation.ts           # Policy validation
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── README.md
```

---

## 3. Core Concepts

### 3.1 Policy

A **Policy** defines access rules for database operations. Policies are:
- **Declarative**: Defined at schema level, not in business logic
- **Composable**: Multiple policies combine with AND/OR logic
- **Type-Safe**: Full TypeScript inference for entities and context

### 3.2 Policy Types

| Type | Description | Enforcement Point |
|------|-------------|-------------------|
| `allow` | Grants access when condition is true | Pre-query |
| `deny` | Blocks access when condition is true (overrides allow) | Pre-query |
| `filter` | Adds WHERE clause to queries | Query transformation |
| `validate` | Checks mutation data | Pre-execution |

### 3.3 Operations

| Operation | SQL | USING | WITH CHECK |
|-----------|-----|-------|------------|
| `read` | SELECT | ✅ | - |
| `create` | INSERT | - | ✅ |
| `update` | UPDATE | ✅ | ✅ |
| `delete` | DELETE | ✅ | - |
| `all` | All operations | ✅ | ✅ |

### 3.4 Context

The **RLS Context** provides runtime information for policy evaluation:
- Current user (identity, roles, attributes)
- Tenant/organization context
- Request metadata (IP, timestamp, etc.)
- Custom attributes

### 3.5 Policy Evaluation Order

```
1. Collect all policies for (table, operation)
2. Evaluate deny policies first
   → If ANY deny matches, REJECT
3. Evaluate allow policies
   → If NO allow matches, REJECT (default deny)
4. Apply filter policies to query
5. Apply validate policies to mutation data
6. Execute query
```

---

## 4. Policy Definition DSL

### 4.1 Schema-Based Definition (Primary)

```typescript
import { defineRLSSchema, allow, deny, filter } from '@kysera/rls';

// Define database schema with RLS policies
export const rlsSchema = defineRLSSchema<Database>({
  // Table-level policies
  users: {
    policies: [
      // Users can read their own profile
      allow('read', ({ auth, row }) => row.id === auth.userId),

      // Admins can read all users
      allow('read', ({ auth }) => auth.roles.includes('admin')),

      // Users can update their own profile
      allow('update', ({ auth, row }) => row.id === auth.userId),

      // Prevent deletion of admin users
      deny('delete', ({ row }) => row.role === 'admin'),

      // Super admins can do anything
      allow('all', ({ auth }) => auth.roles.includes('super_admin')),
    ],
  },

  // Multi-tenant resources
  resources: {
    policies: [
      // Tenant isolation filter (auto-applied to all SELECTs)
      filter('read', ({ auth }) => ({
        tenant_id: auth.tenantId,
      })),

      // Users can only create in their tenant
      allow('create', ({ auth, data }) => data.tenant_id === auth.tenantId),

      // Users can only modify resources they own
      allow('update', ({ auth, row }) => row.owner_id === auth.userId),
      allow('delete', ({ auth, row }) => row.owner_id === auth.userId),

      // Managers can modify any resource in their tenant
      allow(['update', 'delete'], ({ auth, row }) =>
        auth.roles.includes('manager') && row.tenant_id === auth.tenantId
      ),
    ],
  },

  // Documents with complex access rules
  documents: {
    policies: [
      // Public documents are readable by anyone
      allow('read', ({ row }) => row.visibility === 'public'),

      // Organization members can read org documents
      allow('read', ({ auth, row }) =>
        row.visibility === 'organization' &&
        auth.organizationIds.includes(row.organization_id)
      ),

      // Only owner can read private documents
      allow('read', ({ auth, row }) =>
        row.visibility === 'private' && row.owner_id === auth.userId
      ),

      // Shared documents (via join table)
      allow('read', async ({ auth, row, db }) => {
        const share = await db
          .selectFrom('document_shares')
          .where('document_id', '=', row.id)
          .where('user_id', '=', auth.userId)
          .executeTakeFirst();
        return share !== undefined;
      }),

      // Time-based access (e.g., embargo period)
      deny('read', ({ row }) =>
        row.embargo_until && new Date(row.embargo_until) > new Date()
      ),
    ],
  },

  // Audit logs (read-only, admin-only)
  audit_logs: {
    policies: [
      deny('create'),  // No direct inserts
      deny('update'),  // Immutable
      deny('delete'),  // Can't delete audit logs
      allow('read', ({ auth }) => auth.roles.includes('auditor')),
    ],
  },
});
```

### 4.2 Fluent Builder API (Alternative)

```typescript
import { RLSBuilder } from '@kysera/rls';

const policies = new RLSBuilder<Database>()
  .table('users')
    .allowRead(ctx => ctx.auth.userId === ctx.row.id)
    .allowRead(ctx => ctx.auth.isAdmin)
    .allowUpdate(ctx => ctx.auth.userId === ctx.row.id)
    .denyDelete(ctx => ctx.row.role === 'admin')
  .table('resources')
    .filterRead(ctx => ({ tenant_id: ctx.auth.tenantId }))
    .allowCreate(ctx => ctx.data.tenant_id === ctx.auth.tenantId)
    .allowUpdate(ctx => ctx.auth.userId === ctx.row.owner_id)
  .build();
```

### 4.3 Decorator-Based Definition (for Titan)

```typescript
import { Repository, Policy, Allow, Deny, Filter } from '@kysera/rls/decorators';

@Repository({ table: 'users' })
@Policy({
  defaultDeny: true,  // Reject unless explicitly allowed
})
export class UserRepository extends BaseRepository<User> {

  @Allow('read', ctx => ctx.auth.userId === ctx.row.id)
  @Allow('read', ctx => ctx.auth.isAdmin)
  async findById(id: number): Promise<User | null> {
    return super.findById(id);
  }

  @Allow('update', ctx => ctx.auth.userId === ctx.row.id)
  @Deny('update', ctx => ctx.row.locked)
  async update(id: number, data: UpdateUser): Promise<User> {
    return super.update(id, data);
  }

  @Filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
  async findAll(): Promise<User[]> {
    return super.findAll();
  }
}
```

### 4.4 Policy Expression Language

Support for declarative string-based expressions (for config files):

```typescript
const policies = defineRLSSchema({
  resources: {
    policies: [
      // String expression (parsed at compile time)
      allow('read', 'auth.userId == row.owner_id'),
      allow('read', 'auth.roles contains "admin"'),
      filter('read', 'row.tenant_id == auth.tenantId'),
      deny('delete', 'row.status == "published"'),

      // Complex expressions
      allow('update',
        '(auth.userId == row.owner_id) or (auth.roles contains "manager" and row.tenant_id == auth.tenantId)'
      ),
    ],
  },
});
```

### 4.5 Relationship Traversal (Advanced)

```typescript
const policies = defineRLSSchema({
  posts: {
    policies: [
      // User can read posts if they're a member of the post's organization
      allow('read', async ({ auth, row, db }) => {
        const membership = await db
          .selectFrom('organization_members')
          .where('organization_id', '=', row.organization_id)
          .where('user_id', '=', auth.userId)
          .executeTakeFirst();
        return membership !== undefined;
      }),

      // Shorthand for common patterns (pre-defined helpers)
      allow('read', belongsTo('organization_members', {
        on: ['organization_id', 'organization_id'],
        where: { user_id: 'auth.userId' }
      })),
    ],
  },
});
```

---

## 5. Runtime Context Management

### 5.1 Context Interface

```typescript
export interface RLSContext<TUser = unknown, TMeta = unknown> {
  /** Current authenticated user */
  auth: RLSAuthContext<TUser>;

  /** Request metadata */
  request?: RLSRequestContext;

  /** Custom metadata */
  meta?: TMeta;

  /** Timestamp of context creation */
  timestamp: Date;
}

export interface RLSAuthContext<TUser = unknown> {
  /** User ID (required) */
  userId: string | number;

  /** User's roles */
  roles: string[];

  /** Tenant/organization ID for multi-tenancy */
  tenantId?: string | number;

  /** Organization IDs user belongs to */
  organizationIds?: (string | number)[];

  /** User permissions (fine-grained) */
  permissions?: string[];

  /** Additional user attributes (for ABAC) */
  attributes?: Record<string, unknown>;

  /** Raw user object (type-safe) */
  user?: TUser;

  /** Is this a system/service account? (bypass RLS) */
  isSystem?: boolean;
}

export interface RLSRequestContext {
  /** Request ID for tracing */
  requestId?: string;

  /** Client IP address */
  ipAddress?: string;

  /** User agent */
  userAgent?: string;

  /** Request timestamp */
  timestamp: Date;

  /** Additional headers */
  headers?: Record<string, string>;
}
```

### 5.2 Context Storage (AsyncLocalStorage)

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RLSContext } from './types';

class RLSContextManager {
  private storage = new AsyncLocalStorage<RLSContext>();

  /**
   * Run a function within an RLS context
   */
  run<T>(context: RLSContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /**
   * Run async function within an RLS context
   */
  async runAsync<T>(context: RLSContext, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(context, fn);
  }

  /**
   * Get current RLS context
   * @throws RLSContextError if no context is set
   */
  getContext(): RLSContext {
    const ctx = this.storage.getStore();
    if (!ctx) {
      throw new RLSContextError('No RLS context found. Ensure code runs within rls.withContext()');
    }
    return ctx;
  }

  /**
   * Get current RLS context or null
   */
  getContextOrNull(): RLSContext | null {
    return this.storage.getStore() ?? null;
  }

  /**
   * Check if running within RLS context
   */
  hasContext(): boolean {
    return this.storage.getStore() !== undefined;
  }
}

export const rlsContext = new RLSContextManager();
```

### 5.3 Context Setup Patterns

#### Express/Fastify Middleware

```typescript
import { rlsContext, createRLSContext } from '@kysera/rls';

// Express middleware
export function rlsMiddleware(
  getUserFromRequest: (req: Request) => Promise<RLSAuthContext>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = await getUserFromRequest(req);
      const context = createRLSContext({
        auth,
        request: {
          requestId: req.headers['x-request-id'] as string,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          timestamp: new Date(),
        },
      });

      rlsContext.run(context, () => {
        next();
      });
    } catch (error) {
      next(error);
    }
  };
}
```

#### Titan Interceptor

```typescript
import { Interceptor, ExecutionContext } from '@omnitron-dev/titan';
import { rlsContext, createRLSContext } from '@kysera/rls';

@Interceptor()
export class RLSInterceptor {
  async intercept(context: ExecutionContext, next: () => Promise<unknown>) {
    const user = context.getUser(); // From auth interceptor

    const rlsCtx = createRLSContext({
      auth: {
        userId: user.id,
        roles: user.roles,
        tenantId: user.tenantId,
        permissions: user.permissions,
        user,
      },
      request: {
        requestId: context.getRequestId(),
        timestamp: new Date(),
      },
    });

    return rlsContext.runAsync(rlsCtx, () => next());
  }
}
```

#### Transaction Scoping

```typescript
// RLS context is preserved across async boundaries (transactions)
await db.transaction().execute(async (trx) => {
  // RLS context from outer scope is available here
  const repos = createRepositories(trx);

  // All operations respect RLS policies
  await repos.resources.findAll(); // Auto-filtered by tenant
  await repos.resources.create({ ... }); // Validated against policies
});
```

---

## 6. Query Transformation Engine

### 6.1 SELECT Query Transformation

```typescript
import type { SelectQueryBuilder } from 'kysely';
import { rlsContext } from '../context';
import type { PolicyRegistry, FilterPolicy } from '../policy/types';

export class SelectTransformer {
  constructor(private registry: PolicyRegistry) {}

  /**
   * Transform SELECT query by applying filter policies
   */
  transform<DB, TB extends keyof DB, O>(
    qb: SelectQueryBuilder<DB, TB, O>,
    table: string
  ): SelectQueryBuilder<DB, TB, O> {
    const ctx = rlsContext.getContext();

    // Get filter policies for this table
    const filters = this.registry.getFilters(table, 'read');

    if (filters.length === 0) {
      return qb;
    }

    // Apply each filter as WHERE condition
    let result = qb;
    for (const filter of filters) {
      const conditions = this.evaluateFilter(filter, ctx, table);
      result = this.applyConditions(result, conditions);
    }

    return result;
  }

  /**
   * Evaluate filter policy to get WHERE conditions
   */
  private evaluateFilter(
    filter: FilterPolicy,
    ctx: RLSContext,
    table: string
  ): Record<string, unknown> {
    // Filter functions return { column: value } conditions
    const evalCtx = {
      auth: ctx.auth,
      request: ctx.request,
      meta: ctx.meta,
    };

    return filter.condition(evalCtx);
  }

  /**
   * Apply conditions to query builder
   */
  private applyConditions<DB, TB extends keyof DB, O>(
    qb: SelectQueryBuilder<DB, TB, O>,
    conditions: Record<string, unknown>
  ): SelectQueryBuilder<DB, TB, O> {
    let result = qb;

    for (const [column, value] of Object.entries(conditions)) {
      if (value === null) {
        result = result.where(column as any, 'is', null);
      } else if (Array.isArray(value)) {
        result = result.where(column as any, 'in', value as any);
      } else {
        result = result.where(column as any, '=', value as any);
      }
    }

    return result;
  }
}
```

### 6.2 Mutation Pre-Check

```typescript
export class MutationGuard {
  constructor(private registry: PolicyRegistry) {}

  /**
   * Check if INSERT is allowed
   */
  async checkCreate<T>(
    table: string,
    data: T
  ): Promise<void> {
    const ctx = rlsContext.getContext();

    // System users bypass RLS
    if (ctx.auth.isSystem) return;

    // Evaluate deny policies first
    const denyPolicies = this.registry.getDenies(table, 'create');
    for (const policy of denyPolicies) {
      const denied = await policy.condition({ auth: ctx.auth, data });
      if (denied) {
        throw new RLSPolicyViolation('create', table, 'Denied by policy');
      }
    }

    // Evaluate allow policies
    const allowPolicies = this.registry.getAllows(table, 'create');
    if (allowPolicies.length === 0) {
      throw new RLSPolicyViolation('create', table, 'No allow policy');
    }

    let allowed = false;
    for (const policy of allowPolicies) {
      if (await policy.condition({ auth: ctx.auth, data })) {
        allowed = true;
        break;
      }
    }

    if (!allowed) {
      throw new RLSPolicyViolation('create', table, 'Not allowed');
    }
  }

  /**
   * Check if UPDATE is allowed (requires row data)
   */
  async checkUpdate<T, U>(
    table: string,
    existingRow: T,
    newData: U
  ): Promise<void> {
    const ctx = rlsContext.getContext();

    if (ctx.auth.isSystem) return;

    // Check deny policies
    const denyPolicies = this.registry.getDenies(table, 'update');
    for (const policy of denyPolicies) {
      const denied = await policy.condition({
        auth: ctx.auth,
        row: existingRow,
        data: newData
      });
      if (denied) {
        throw new RLSPolicyViolation('update', table, 'Denied by policy');
      }
    }

    // Check allow policies
    const allowPolicies = this.registry.getAllows(table, 'update');
    let allowed = false;
    for (const policy of allowPolicies) {
      if (await policy.condition({
        auth: ctx.auth,
        row: existingRow,
        data: newData
      })) {
        allowed = true;
        break;
      }
    }

    if (!allowed) {
      throw new RLSPolicyViolation('update', table, 'Not allowed');
    }
  }

  /**
   * Check if DELETE is allowed
   */
  async checkDelete<T>(
    table: string,
    row: T
  ): Promise<void> {
    const ctx = rlsContext.getContext();

    if (ctx.auth.isSystem) return;

    // Similar to checkUpdate, but for delete operation
    // ...
  }
}
```

### 6.3 Query Interceptor Integration

```typescript
import type { Plugin, QueryBuilderContext, AnyQueryBuilder } from '@kysera/repository';

export class RLSQueryInterceptor {
  private selectTransformer: SelectTransformer;
  private mutationGuard: MutationGuard;

  /**
   * Intercept and transform query
   */
  interceptQuery<QB extends AnyQueryBuilder>(
    qb: QB,
    context: QueryBuilderContext
  ): QB {
    const { operation, table, metadata } = context;

    // Skip if explicitly disabled
    if (metadata['skipRLS'] === true) {
      return qb;
    }

    // Check if context exists
    if (!rlsContext.hasContext()) {
      if (metadata['requireRLS'] === true) {
        throw new RLSContextError('RLS context required but not found');
      }
      return qb;
    }

    switch (operation) {
      case 'select':
        return this.selectTransformer.transform(qb as any, table) as QB;

      case 'insert':
      case 'update':
      case 'delete':
        // Mutations are handled by extendRepository wrapper
        // Store metadata for later checking
        metadata['__rlsChecked'] = false;
        return qb;

      default:
        return qb;
    }
  }
}
```

---

## 7. PostgreSQL Native RLS Integration

### 7.1 Native Policy Generator

```typescript
import { sql, type Kysely } from 'kysely';
import type { PolicySchema, PolicyDefinition } from '../policy/types';

export class PostgresRLSGenerator {
  /**
   * Generate PostgreSQL RLS statements from policy schema
   */
  generateStatements(
    schema: PolicySchema,
    options: GeneratorOptions = {}
  ): string[] {
    const statements: string[] = [];

    for (const [table, config] of Object.entries(schema)) {
      // Enable RLS on table
      statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);

      if (options.force) {
        statements.push(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      }

      // Generate policies
      let policyIndex = 0;
      for (const policy of config.policies) {
        const policyName = `rls_${table}_${policy.type}_${policyIndex++}`;
        const policySQL = this.generatePolicy(table, policyName, policy);
        statements.push(policySQL);
      }
    }

    return statements;
  }

  /**
   * Generate single policy statement
   */
  private generatePolicy(
    table: string,
    name: string,
    policy: PolicyDefinition
  ): string {
    const parts: string[] = [
      `CREATE POLICY ${name}`,
      `ON ${table}`,
    ];

    // Policy type (permissive/restrictive)
    if (policy.type === 'deny') {
      parts.push('AS RESTRICTIVE');
    } else {
      parts.push('AS PERMISSIVE');
    }

    // Target role
    parts.push(`TO ${policy.role ?? 'public'}`);

    // Operation
    parts.push(`FOR ${this.mapOperation(policy.operation)}`);

    // USING clause (for SELECT, UPDATE, DELETE)
    if (policy.using) {
      parts.push(`USING (${policy.using})`);
    }

    // WITH CHECK clause (for INSERT, UPDATE)
    if (policy.withCheck) {
      parts.push(`WITH CHECK (${policy.withCheck})`);
    }

    return parts.join('\n  ') + ';';
  }

  /**
   * Generate context-setting function
   */
  generateContextFunction(): string {
    return `
-- RLS Context Functions (STABLE for performance)
CREATE OR REPLACE FUNCTION rls_current_user_id()
RETURNS text LANGUAGE SQL STABLE
AS $$ SELECT current_setting('app.user_id', true) $$;

CREATE OR REPLACE FUNCTION rls_current_tenant_id()
RETURNS uuid LANGUAGE SQL STABLE
AS $$ SELECT current_setting('app.tenant_id', true)::uuid $$;

CREATE OR REPLACE FUNCTION rls_current_roles()
RETURNS text[] LANGUAGE SQL STABLE
AS $$ SELECT string_to_array(current_setting('app.roles', true), ',') $$;

CREATE OR REPLACE FUNCTION rls_has_role(role_name text)
RETURNS boolean LANGUAGE SQL STABLE
AS $$ SELECT role_name = ANY(rls_current_roles()) $$;
`;
  }

  private mapOperation(op: string | string[]): string {
    if (Array.isArray(op)) {
      return 'ALL';
    }
    switch (op) {
      case 'read': return 'SELECT';
      case 'create': return 'INSERT';
      case 'update': return 'UPDATE';
      case 'delete': return 'DELETE';
      case 'all': return 'ALL';
      default: return 'ALL';
    }
  }
}
```

### 7.2 Context Sync for Native RLS

```typescript
/**
 * Sync RLS context to PostgreSQL session settings
 */
export async function syncContextToPostgres<DB>(
  db: Kysely<DB>,
  context: RLSContext
): Promise<void> {
  // Set session variables that PostgreSQL RLS policies can access
  await sql`
    SELECT
      set_config('app.user_id', ${context.auth.userId}::text, true),
      set_config('app.tenant_id', ${context.auth.tenantId ?? ''}::text, true),
      set_config('app.roles', ${context.auth.roles.join(',')}::text, true)
  `.execute(db);
}

/**
 * Middleware to sync context on transaction start
 */
export function withPostgresRLSSync<DB>(
  db: Kysely<DB>
): Kysely<DB> {
  return db.withPlugin({
    transformQuery(args) {
      return args.node;
    },
    async transformResult(args) {
      // Sync context after connection is acquired
      const ctx = rlsContext.getContextOrNull();
      if (ctx && args.queryId.includes('transaction')) {
        await syncContextToPostgres(db, ctx);
      }
      return args.result;
    },
  });
}
```

### 7.3 Migration Generator

```typescript
import { Migrator } from '@kysera/migrations';
import type { PolicySchema } from '../policy/types';

export class RLSMigrationGenerator {
  /**
   * Generate migration file for RLS policies
   */
  generateMigration(
    schema: PolicySchema,
    name: string
  ): string {
    const generator = new PostgresRLSGenerator();
    const upStatements = generator.generateStatements(schema);
    const downStatements = this.generateDownStatements(schema);

    return `
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Create RLS context functions
  await sql.raw(\`${generator.generateContextFunction()}\`).execute(db);

  // Enable RLS and create policies
${upStatements.map(s => `  await sql.raw(\`${s}\`).execute(db);`).join('\n')}
}

export async function down(db: Kysely<any>): Promise<void> {
${downStatements.map(s => `  await sql.raw(\`${s}\`).execute(db);`).join('\n')}
}
`;
  }

  private generateDownStatements(schema: PolicySchema): string[] {
    const statements: string[] = [];

    for (const table of Object.keys(schema)) {
      statements.push(`DROP POLICY IF EXISTS rls_${table}_* ON ${table};`);
      statements.push(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`);
    }

    return statements;
  }
}
```

---

## 8. Type System

### 8.1 Policy Type Definitions

```typescript
import type { Kysely } from 'kysely';

/**
 * Policy evaluation context (passed to policy functions)
 */
export interface PolicyEvaluationContext<
  TAuth = unknown,
  TRow = unknown,
  TData = unknown,
  TDB = unknown
> {
  /** Current auth context */
  auth: RLSAuthContext<TAuth>;

  /** Existing row (for read/update/delete) */
  row?: TRow;

  /** New data (for create/update) */
  data?: TData;

  /** Request context */
  request?: RLSRequestContext;

  /** Database executor (for subqueries in policies) */
  db?: Kysely<TDB>;

  /** Custom metadata */
  meta?: Record<string, unknown>;
}

/**
 * Policy condition function type
 */
export type PolicyCondition<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> =
  | ((ctx: TCtx) => boolean | Promise<boolean>)
  | string; // Expression string

/**
 * Filter condition function type (returns WHERE conditions)
 */
export type FilterCondition<TCtx extends PolicyEvaluationContext = PolicyEvaluationContext> =
  | ((ctx: TCtx) => Record<string, unknown>)
  | Record<string, string>; // Static mapping { column: 'auth.field' }

/**
 * Policy definition
 */
export interface PolicyDefinition<
  TOperation extends Operation = Operation,
  TCondition = PolicyCondition
> {
  type: 'allow' | 'deny' | 'filter' | 'validate';
  operation: TOperation | TOperation[];
  condition: TCondition;
  name?: string;
  priority?: number;

  // For native RLS generation
  using?: string;
  withCheck?: string;
  role?: string;
}

/**
 * Operation types
 */
export type Operation = 'read' | 'create' | 'update' | 'delete' | 'all';

/**
 * Table RLS configuration
 */
export interface TableRLSConfig<TEntity = unknown> {
  policies: PolicyDefinition[];
  defaultDeny?: boolean;
  skipFor?: string[]; // Roles that bypass RLS
}

/**
 * Complete RLS schema
 */
export type RLSSchema<DB> = {
  [K in keyof DB]?: TableRLSConfig<DB[K]>;
};
```

### 8.2 Type-Safe Policy Builders

```typescript
/**
 * Type-safe allow policy builder
 */
export function allow<
  DB,
  TN extends keyof DB,
  Op extends Operation
>(
  operation: Op | Op[],
  condition: PolicyCondition<PolicyEvaluationContext<unknown, DB[TN], DB[TN]>>
): PolicyDefinition<Op> {
  return {
    type: 'allow',
    operation,
    condition,
  };
}

/**
 * Type-safe deny policy builder
 */
export function deny<
  DB,
  TN extends keyof DB,
  Op extends Operation
>(
  operation: Op | Op[],
  condition?: PolicyCondition<PolicyEvaluationContext<unknown, DB[TN], DB[TN]>>
): PolicyDefinition<Op> {
  return {
    type: 'deny',
    operation,
    condition: condition ?? (() => true), // Default: always deny
  };
}

/**
 * Type-safe filter policy builder
 */
export function filter<
  DB,
  TN extends keyof DB
>(
  operation: 'read' | 'all',
  condition: FilterCondition<PolicyEvaluationContext<unknown, DB[TN]>>
): PolicyDefinition<'read'> {
  return {
    type: 'filter',
    operation: 'read',
    condition: condition as any,
  };
}

/**
 * Define complete RLS schema with full type safety
 */
export function defineRLSSchema<DB>(
  schema: RLSSchema<DB>
): RLSSchema<DB> {
  return schema;
}
```

### 8.3 Inferred Types from Schema

```typescript
/**
 * Extract tables that have RLS configured
 */
export type RLSProtectedTables<S extends RLSSchema<any>> = {
  [K in keyof S]: S[K] extends TableRLSConfig ? K : never;
}[keyof S];

/**
 * Get policy operations for a table
 */
export type TableOperations<
  S extends RLSSchema<any>,
  T extends keyof S
> = S[T] extends TableRLSConfig
  ? S[T]['policies'][number]['operation']
  : never;

/**
 * Validate that all required policies exist
 */
export type ValidateRLSSchema<DB, S extends RLSSchema<DB>> = {
  [K in keyof DB]: K extends keyof S
    ? S[K] extends TableRLSConfig
      ? S[K]
      : 'Missing RLS configuration'
    : 'Unprotected table';
};
```

---

## 9. Plugin Architecture

### 9.1 Kysera Plugin Implementation

```typescript
import type {
  Plugin,
  QueryBuilderContext,
  AnyQueryBuilder
} from '@kysera/repository';
import { RLSErrorCodes } from './errors';

export interface RLSPluginOptions<DB = unknown> {
  /** RLS policy schema */
  schema: RLSSchema<DB>;

  /** Enable native PostgreSQL RLS sync */
  nativeSync?: boolean;

  /** Tables to skip RLS for */
  skipTables?: string[];

  /** Roles that bypass RLS */
  bypassRoles?: string[];

  /** Logger */
  logger?: KyseraLogger;

  /** Throw on missing context (default: false) */
  requireContext?: boolean;

  /** Enable audit logging of policy decisions */
  auditDecisions?: boolean;
}

/**
 * Main RLS plugin for Kysera
 */
export function rlsPlugin<DB>(options: RLSPluginOptions<DB>): Plugin {
  const {
    schema,
    nativeSync = false,
    skipTables = [],
    bypassRoles = [],
    logger = silentLogger,
    requireContext = false,
    auditDecisions = false,
  } = options;

  // Compile policies at initialization
  const registry = new PolicyRegistry(schema);
  const selectTransformer = new SelectTransformer(registry);
  const mutationGuard = new MutationGuard(registry);

  return {
    name: '@kysera/rls',
    version: '1.0.0',

    // Run after soft-delete, before audit
    priority: 50,

    // Dependencies
    dependencies: [], // Optional: ['@kysera/soft-delete']

    /**
     * Initialize plugin
     */
    async onInit<DB>(executor: Kysely<DB>): Promise<void> {
      logger.info('RLS plugin initialized', {
        tables: Object.keys(schema).length,
        nativeSync,
      });

      // Validate schema
      registry.validate();

      // Sync to PostgreSQL if enabled
      if (nativeSync) {
        const generator = new PostgresRLSGenerator();
        const statements = generator.generateStatements(schema as any);
        for (const stmt of statements) {
          await sql.raw(stmt).execute(executor);
        }
      }
    },

    /**
     * Intercept queries for RLS filtering
     */
    interceptQuery<QB extends AnyQueryBuilder>(
      qb: QB,
      context: QueryBuilderContext
    ): QB {
      const { operation, table, metadata } = context;

      // Skip if table is excluded
      if (skipTables.includes(table)) {
        return qb;
      }

      // Skip if explicitly disabled
      if (metadata['skipRLS'] === true) {
        logger.debug(`RLS skipped for ${table} (explicit)`);
        return qb;
      }

      // Check for context
      const rlsCtx = rlsContext.getContextOrNull();
      if (!rlsCtx) {
        if (requireContext) {
          throw new RLSContextError('RLS context required');
        }
        logger.warn(`No RLS context for ${operation} on ${table}`);
        return qb;
      }

      // Check bypass roles
      if (rlsCtx.auth.isSystem ||
          bypassRoles.some(r => rlsCtx.auth.roles.includes(r))) {
        logger.debug(`RLS bypassed for ${table} (system/bypass role)`);
        return qb;
      }

      // Apply SELECT filtering
      if (operation === 'select') {
        const transformed = selectTransformer.transform(qb as any, table);

        if (auditDecisions) {
          logger.info('RLS filter applied', { table, operation, userId: rlsCtx.auth.userId });
        }

        return transformed as QB;
      }

      return qb;
    },

    /**
     * Extend repository with RLS-aware methods
     */
    extendRepository<T extends object>(repo: T): T {
      const baseRepo = repo as unknown as BaseRepository;

      if (!('tableName' in baseRepo) || !('executor' in baseRepo)) {
        return repo;
      }

      const table = baseRepo.tableName;

      // Skip excluded tables
      if (skipTables.includes(table)) {
        return repo;
      }

      // Wrap mutation methods
      const originalCreate = baseRepo.create?.bind(baseRepo);
      const originalUpdate = baseRepo.update?.bind(baseRepo);
      const originalDelete = baseRepo.delete?.bind(baseRepo);
      const originalFindById = baseRepo.findById?.bind(baseRepo);

      const extendedRepo = {
        ...baseRepo,

        // Wrapped create with RLS check
        async create(data: unknown): Promise<unknown> {
          const ctx = rlsContext.getContextOrNull();

          if (ctx && !ctx.auth.isSystem &&
              !bypassRoles.some(r => ctx.auth.roles.includes(r))) {
            await mutationGuard.checkCreate(table, data);
          }

          return originalCreate?.(data);
        },

        // Wrapped update with RLS check
        async update(id: unknown, data: unknown): Promise<unknown> {
          const ctx = rlsContext.getContextOrNull();

          if (ctx && !ctx.auth.isSystem &&
              !bypassRoles.some(r => ctx.auth.roles.includes(r))) {
            // Fetch existing row for policy evaluation
            const existingRow = await originalFindById?.(id);
            if (!existingRow) {
              throw new NotFoundError('Record', { id });
            }
            await mutationGuard.checkUpdate(table, existingRow, data);
          }

          return originalUpdate?.(id, data);
        },

        // Wrapped delete with RLS check
        async delete(id: unknown): Promise<unknown> {
          const ctx = rlsContext.getContextOrNull();

          if (ctx && !ctx.auth.isSystem &&
              !bypassRoles.some(r => ctx.auth.roles.includes(r))) {
            const existingRow = await originalFindById?.(id);
            if (!existingRow) {
              throw new NotFoundError('Record', { id });
            }
            await mutationGuard.checkDelete(table, existingRow);
          }

          return originalDelete?.(id);
        },

        // Utility: bypass RLS for specific operation
        async withoutRLS<R>(fn: () => Promise<R>): Promise<R> {
          const ctx = rlsContext.getContextOrNull();
          if (!ctx) {
            return fn();
          }

          const systemCtx: RLSContext = {
            ...ctx,
            auth: { ...ctx.auth, isSystem: true },
          };

          return rlsContext.runAsync(systemCtx, fn);
        },
      };

      return extendedRepo as T;
    },
  };
}
```

### 9.2 Error Types

```typescript
import { ErrorCode, createError } from '@kysera/core';

export const RLSErrorCodes = {
  RLS_CONTEXT_MISSING: 'RLS_CONTEXT_MISSING' as ErrorCode,
  RLS_POLICY_VIOLATION: 'RLS_POLICY_VIOLATION' as ErrorCode,
  RLS_POLICY_INVALID: 'RLS_POLICY_INVALID' as ErrorCode,
  RLS_SCHEMA_INVALID: 'RLS_SCHEMA_INVALID' as ErrorCode,
} as const;

export class RLSContextError extends Error {
  public readonly code = RLSErrorCodes.RLS_CONTEXT_MISSING;

  constructor(message: string) {
    super(message);
    this.name = 'RLSContextError';
  }
}

export class RLSPolicyViolation extends Error {
  public readonly code = RLSErrorCodes.RLS_POLICY_VIOLATION;

  constructor(
    public readonly operation: string,
    public readonly table: string,
    public readonly reason: string
  ) {
    super(`RLS policy violation: ${operation} on ${table} - ${reason}`);
    this.name = 'RLSPolicyViolation';
  }
}
```

---

## 10. Titan Integration

### 10.1 Module Configuration

```typescript
// @kysera/rls/titan
import { TitanModule, type ModuleMetadata } from '@omnitron-dev/titan';
import { rlsPlugin, type RLSPluginOptions } from '@kysera/rls';

export interface RLSModuleOptions<DB = unknown> extends RLSPluginOptions<DB> {
  /** Global interceptor for context setup */
  contextProvider?: Type<RLSContextProvider>;
}

@TitanModule({
  providers: [
    RLSContextManager,
    RLSPolicyRegistry,
  ],
  exports: [
    RLSContextManager,
    RLSPolicyRegistry,
  ],
})
export class RLSModule {
  static forRoot<DB>(options: RLSModuleOptions<DB>): DynamicModule {
    return {
      module: RLSModule,
      providers: [
        {
          provide: RLS_OPTIONS,
          useValue: options,
        },
        {
          provide: RLS_PLUGIN,
          useFactory: (opts: RLSModuleOptions<DB>) => rlsPlugin(opts),
          inject: [RLS_OPTIONS],
        },
        ...(options.contextProvider ? [
          {
            provide: RLS_CONTEXT_PROVIDER,
            useClass: options.contextProvider,
          }
        ] : []),
      ],
      exports: [RLS_PLUGIN, RLS_OPTIONS],
    };
  }
}
```

### 10.2 Decorators

```typescript
import { createMethodDecorator, createClassDecorator } from '@omnitron-dev/titan';

/**
 * @Policy - Class decorator for repository-level policies
 */
export const Policy = createClassDecorator<PolicyDecoratorOptions>(
  (options) => {
    return (target) => {
      Reflect.defineMetadata(RLS_POLICY_METADATA, options, target);
      return target;
    };
  }
);

/**
 * @Allow - Method decorator for allow policies
 */
export const Allow = createMethodDecorator<AllowDecoratorOptions>(
  (operation: Operation | Operation[], condition: PolicyCondition) => {
    return (target, propertyKey, descriptor) => {
      const existing = Reflect.getMetadata(RLS_ALLOW_METADATA, target, propertyKey) || [];
      existing.push({ operation, condition });
      Reflect.defineMetadata(RLS_ALLOW_METADATA, existing, target, propertyKey);
      return descriptor;
    };
  }
);

/**
 * @Deny - Method decorator for deny policies
 */
export const Deny = createMethodDecorator<DenyDecoratorOptions>(
  (operation: Operation | Operation[], condition?: PolicyCondition) => {
    return (target, propertyKey, descriptor) => {
      const existing = Reflect.getMetadata(RLS_DENY_METADATA, target, propertyKey) || [];
      existing.push({ operation, condition: condition ?? (() => true) });
      Reflect.defineMetadata(RLS_DENY_METADATA, existing, target, propertyKey);
      return descriptor;
    };
  }
);

/**
 * @Filter - Method decorator for filter policies
 */
export const Filter = createMethodDecorator<FilterDecoratorOptions>(
  (operation: 'read' | 'all', condition: FilterCondition) => {
    return (target, propertyKey, descriptor) => {
      const existing = Reflect.getMetadata(RLS_FILTER_METADATA, target, propertyKey) || [];
      existing.push({ operation, condition });
      Reflect.defineMetadata(RLS_FILTER_METADATA, existing, target, propertyKey);
      return descriptor;
    };
  }
);

/**
 * @BypassRLS - Skip RLS for this method (requires system role)
 */
export const BypassRLS = createMethodDecorator(() => {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(RLS_BYPASS_METADATA, true, target, propertyKey);
    return descriptor;
  };
});
```

### 10.3 Repository Integration

```typescript
import {
  Repository,
  InjectRepository,
  Transactional
} from '@omnitron-dev/titan/module/database';
import { Policy, Allow, Deny, Filter, BypassRLS } from '@kysera/rls/titan';

@Repository({
  table: 'resources',
  plugins: ['@kysera/rls', '@kysera/soft-delete', '@kysera/timestamps'],
})
@Policy({
  defaultDeny: true,
})
export class ResourceRepository extends BaseRepository<Resource> {

  @Filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
  async findAll(): Promise<Resource[]> {
    return super.findAll();
  }

  @Filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
  async findById(id: number): Promise<Resource | null> {
    return super.findById(id);
  }

  @Allow('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId)
  async create(data: CreateResourceInput): Promise<Resource> {
    return super.create(data);
  }

  @Allow('update', ctx => ctx.auth.userId === ctx.row.owner_id)
  @Allow('update', ctx => ctx.auth.roles.includes('manager'))
  @Deny('update', ctx => ctx.row.locked)
  async update(id: number, data: UpdateResourceInput): Promise<Resource> {
    return super.update(id, data);
  }

  @Allow('delete', ctx => ctx.auth.userId === ctx.row.owner_id)
  @Deny('delete', ctx => ctx.row.status === 'published')
  async delete(id: number): Promise<void> {
    return super.delete(id);
  }

  // Admin-only method with RLS bypass
  @BypassRLS()
  @Transactional()
  async adminBulkDelete(ids: number[]): Promise<void> {
    for (const id of ids) {
      await super.delete(id);
    }
  }
}
```

### 10.4 Context Provider

```typescript
import { Injectable, Interceptor, ExecutionContext } from '@omnitron-dev/titan';
import { rlsContext, createRLSContext } from '@kysera/rls';

export interface RLSContextProvider {
  getContext(executionContext: ExecutionContext): Promise<RLSContext>;
}

@Injectable()
export class DefaultRLSContextProvider implements RLSContextProvider {
  async getContext(ctx: ExecutionContext): Promise<RLSContext> {
    const user = ctx.getUser();
    const request = ctx.getRequest();

    return createRLSContext({
      auth: {
        userId: user?.id,
        roles: user?.roles ?? [],
        tenantId: user?.tenantId,
        permissions: user?.permissions,
        user,
        isSystem: user?.isSystem ?? false,
      },
      request: {
        requestId: request?.id,
        ipAddress: request?.ip,
        userAgent: request?.headers?.['user-agent'],
        timestamp: new Date(),
      },
    });
  }
}

@Interceptor()
export class RLSInterceptor {
  constructor(private contextProvider: RLSContextProvider) {}

  async intercept(ctx: ExecutionContext, next: () => Promise<unknown>) {
    const rlsCtx = await this.contextProvider.getContext(ctx);
    return rlsContext.runAsync(rlsCtx, next);
  }
}
```

---

## 11. Performance Optimizations

### 11.1 Policy Compilation

```typescript
/**
 * Compile policies at startup for faster runtime evaluation
 */
export class PolicyCompiler {
  /**
   * Compile a policy condition to optimized evaluator
   */
  compile<TCtx>(condition: PolicyCondition<TCtx>): CompiledCondition<TCtx> {
    // String expressions are parsed and compiled once
    if (typeof condition === 'string') {
      return this.compileExpression(condition);
    }

    // Functions are wrapped with caching if STABLE
    return this.wrapWithCaching(condition);
  }

  /**
   * Parse and compile string expression
   */
  private compileExpression(expr: string): CompiledCondition<any> {
    // Parse expression into AST
    const ast = parseExpression(expr);

    // Optimize AST (constant folding, etc.)
    const optimized = optimizeAST(ast);

    // Generate efficient evaluator function
    return generateEvaluator(optimized);
  }

  /**
   * Wrap function with per-transaction caching (STABLE semantics)
   */
  private wrapWithCaching<TCtx>(
    fn: (ctx: TCtx) => boolean | Promise<boolean>
  ): CompiledCondition<TCtx> {
    const cache = new WeakMap<object, boolean>();

    return async (ctx: TCtx) => {
      // Use transaction/request as cache key
      const cacheKey = (ctx as any).auth;

      if (cache.has(cacheKey)) {
        return cache.get(cacheKey)!;
      }

      const result = await fn(ctx);
      cache.set(cacheKey, result);
      return result;
    };
  }
}
```

### 11.2 Filter Optimization

```typescript
/**
 * Optimize filter policies for query generation
 */
export class FilterOptimizer {
  /**
   * Combine multiple filters into single WHERE clause
   */
  combineFilters(
    filters: FilterPolicy[],
    ctx: RLSContext
  ): CombinedFilter {
    const conditions: Record<string, unknown> = {};

    for (const filter of filters) {
      const filterConditions = this.evaluateFilter(filter, ctx);

      // Merge conditions (AND logic)
      for (const [key, value] of Object.entries(filterConditions)) {
        if (key in conditions) {
          // Handle conflicting conditions
          conditions[key] = this.mergeCondition(conditions[key], value);
        } else {
          conditions[key] = value;
        }
      }
    }

    return conditions;
  }

  /**
   * Generate optimized WHERE clause from conditions
   */
  toWhereClause(
    conditions: Record<string, unknown>,
    table: string
  ): string {
    const parts: string[] = [];

    for (const [column, value] of Object.entries(conditions)) {
      const qualifiedColumn = `${table}.${column}`;

      if (value === null) {
        parts.push(`${qualifiedColumn} IS NULL`);
      } else if (Array.isArray(value)) {
        parts.push(`${qualifiedColumn} IN (${value.map(v => this.escape(v)).join(', ')})`);
      } else if (typeof value === 'object' && value !== null) {
        // Complex conditions (>, <, BETWEEN, etc.)
        parts.push(this.buildComplexCondition(qualifiedColumn, value as ConditionObject));
      } else {
        parts.push(`${qualifiedColumn} = ${this.escape(value)}`);
      }
    }

    return parts.join(' AND ');
  }
}
```

### 11.3 Index-Aware Policies

```typescript
/**
 * Policy hints for index usage
 */
export interface PolicyHints {
  /** Columns that should be indexed for this policy */
  indexColumns?: string[];

  /** Expected cardinality (for query planner) */
  selectivity?: 'high' | 'medium' | 'low';

  /** Mark as LEAKPROOF (PostgreSQL) */
  leakproof?: boolean;
}

// Example with hints
const policies = defineRLSSchema<Database>({
  resources: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }), {
        hints: {
          indexColumns: ['tenant_id'],
          selectivity: 'high', // Each tenant has many rows
        },
      }),
    ],
  },
});
```

### 11.4 Subselect Caching Pattern

```typescript
/**
 * Generate cached context accessor for native RLS
 */
export function generateCachedContext(): string {
  return `
-- Cached context accessors (evaluated once per statement)
CREATE OR REPLACE FUNCTION rls_get_context()
RETURNS TABLE (
  user_id text,
  tenant_id uuid,
  roles text[],
  permissions text[]
) LANGUAGE SQL STABLE AS $$
  SELECT
    current_setting('app.user_id', true),
    current_setting('app.tenant_id', true)::uuid,
    string_to_array(current_setting('app.roles', true), ','),
    string_to_array(current_setting('app.permissions', true), ',')
$$;

-- Usage in policies: (SELECT user_id FROM rls_get_context())
`;
}
```

### 11.5 Batch Policy Evaluation

```typescript
/**
 * Evaluate policies for multiple rows efficiently
 */
export class BatchPolicyEvaluator {
  async evaluateMany<T>(
    table: string,
    operation: Operation,
    rows: T[],
    ctx: RLSContext
  ): Promise<T[]> {
    const policies = this.registry.getAllows(table, operation);

    if (policies.length === 0) {
      return []; // Default deny
    }

    // Group policies by evaluation type
    const syncPolicies = policies.filter(p => !isAsyncPolicy(p));
    const asyncPolicies = policies.filter(p => isAsyncPolicy(p));

    // Fast path: sync policies can filter in-memory
    let remaining = rows;
    for (const policy of syncPolicies) {
      remaining = remaining.filter(row =>
        policy.condition({ auth: ctx.auth, row })
      );
    }

    // Async policies require individual evaluation (can be parallelized)
    if (asyncPolicies.length > 0 && remaining.length > 0) {
      const results = await Promise.all(
        remaining.map(async row => {
          for (const policy of asyncPolicies) {
            if (await policy.condition({ auth: ctx.auth, row, db: this.db })) {
              return row;
            }
          }
          return null;
        })
      );
      remaining = results.filter((r): r is T => r !== null);
    }

    return remaining;
  }
}
```

---

## 12. Security Considerations

### 12.1 Context Validation

```typescript
/**
 * Validate RLS context to prevent security issues
 */
export function validateContext(ctx: RLSContext): void {
  // User ID is required
  if (!ctx.auth.userId) {
    throw new RLSContextError('User ID is required in RLS context');
  }

  // Validate roles format
  if (!Array.isArray(ctx.auth.roles)) {
    throw new RLSContextError('Roles must be an array');
  }

  // Prevent privilege escalation via roles
  const dangerousRoles = ['admin', 'super_admin', 'system'];
  for (const role of ctx.auth.roles) {
    if (dangerousRoles.includes(role) && !ctx.auth.isVerified) {
      throw new RLSContextError(`Dangerous role "${role}" requires verified context`);
    }
  }

  // Validate tenant ID format if present
  if (ctx.auth.tenantId && !isValidUUID(ctx.auth.tenantId)) {
    throw new RLSContextError('Invalid tenant ID format');
  }
}
```

### 12.2 SQL Injection Prevention

```typescript
/**
 * Safe SQL generation with parameterization
 */
export class SafeSQLGenerator {
  /**
   * Generate parameterized WHERE clause
   */
  generateWhere(
    conditions: Record<string, unknown>
  ): { sql: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const [column, value] of Object.entries(conditions)) {
      // Validate column name (prevent injection)
      if (!this.isValidColumnName(column)) {
        throw new RLSSchemaError(`Invalid column name: ${column}`);
      }

      if (value === null) {
        parts.push(`${column} IS NULL`);
      } else if (Array.isArray(value)) {
        const placeholders = value.map(() => `$${paramIndex++}`);
        parts.push(`${column} IN (${placeholders.join(', ')})`);
        params.push(...value);
      } else {
        parts.push(`${column} = $${paramIndex++}`);
        params.push(value);
      }
    }

    return {
      sql: parts.join(' AND '),
      params,
    };
  }

  private isValidColumnName(name: string): boolean {
    // Only allow alphanumeric, underscore, and dots (for table.column)
    return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name);
  }
}
```

### 12.3 Audit Trail

```typescript
/**
 * Integration with @kysera/audit for RLS decisions
 */
export interface RLSAuditEntry {
  timestamp: Date;
  operation: Operation;
  table: string;
  userId: string | number;
  allowed: boolean;
  policyName?: string;
  reason?: string;
  rowId?: unknown;
  metadata?: Record<string, unknown>;
}

export class RLSAuditLogger {
  constructor(private auditRepo: AuditRepository) {}

  async logDecision(entry: RLSAuditEntry): Promise<void> {
    if (entry.allowed === false) {
      // Always log denials
      await this.auditRepo.create({
        type: 'RLS_DENIAL',
        ...entry,
      });
    } else if (this.options.logAllows) {
      // Optionally log allows
      await this.auditRepo.create({
        type: 'RLS_ALLOW',
        ...entry,
      });
    }
  }
}
```

### 12.4 Testing Utilities

```typescript
/**
 * Test helpers for RLS policies
 */
export class RLSTestHelper {
  /**
   * Test policy evaluation
   */
  async testPolicy<T>(
    table: string,
    operation: Operation,
    row: T,
    contexts: RLSContext[]
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const ctx of contexts) {
      const key = `${ctx.auth.userId}:${ctx.auth.roles.join(',')}`;

      try {
        await rlsContext.runAsync(ctx, async () => {
          switch (operation) {
            case 'read':
              await this.mutationGuard.checkRead(table, row);
              break;
            case 'update':
              await this.mutationGuard.checkUpdate(table, row, {});
              break;
            case 'delete':
              await this.mutationGuard.checkDelete(table, row);
              break;
          }
        });
        results.set(key, true);
      } catch (e) {
        if (e instanceof RLSPolicyViolation) {
          results.set(key, false);
        } else {
          throw e;
        }
      }
    }

    return results;
  }

  /**
   * Verify policy coverage
   */
  verifyCoverage(schema: RLSSchema<any>): CoverageReport {
    const report: CoverageReport = {
      tables: {},
      issues: [],
    };

    for (const [table, config] of Object.entries(schema)) {
      const operations = new Set(['read', 'create', 'update', 'delete']);
      const covered = new Set<string>();

      for (const policy of config.policies) {
        const ops = Array.isArray(policy.operation)
          ? policy.operation
          : [policy.operation];
        ops.forEach(op => covered.add(op === 'all' ? 'read' : op));
        if (policy.operation === 'all') {
          operations.forEach(op => covered.add(op));
        }
      }

      const uncovered = [...operations].filter(op => !covered.has(op));

      report.tables[table] = {
        covered: [...covered],
        uncovered,
        policyCount: config.policies.length,
      };

      if (uncovered.length > 0 && !config.defaultDeny) {
        report.issues.push({
          table,
          message: `Operations ${uncovered.join(', ')} have no policies and defaultDeny is false`,
        });
      }
    }

    return report;
  }
}
```

---

## 13. API Reference

### 13.1 Policy Definition

```typescript
// Core exports
export { defineRLSSchema, allow, deny, filter, validate } from '@kysera/rls';

// Type exports
export type {
  RLSSchema,
  RLSContext,
  RLSAuthContext,
  PolicyDefinition,
  PolicyCondition,
  FilterCondition,
  Operation,
} from '@kysera/rls';
```

### 13.2 Context Management

```typescript
// Context management
export {
  rlsContext,
  createRLSContext,
  withRLSContext,
} from '@kysera/rls';

// Context types
export type {
  RLSContext,
  RLSAuthContext,
  RLSRequestContext,
} from '@kysera/rls';
```

### 13.3 Plugin

```typescript
// Plugin export
export { rlsPlugin } from '@kysera/rls';

// Plugin options
export type { RLSPluginOptions } from '@kysera/rls';
```

### 13.4 Titan Integration

```typescript
// Module
export { RLSModule } from '@kysera/rls/titan';

// Decorators
export {
  Policy,
  Allow,
  Deny,
  Filter,
  BypassRLS,
} from '@kysera/rls/titan';

// Interceptor
export {
  RLSInterceptor,
  RLSContextProvider,
  DefaultRLSContextProvider,
} from '@kysera/rls/titan';
```

### 13.5 Native RLS

```typescript
// PostgreSQL RLS generation
export {
  PostgresRLSGenerator,
  RLSMigrationGenerator,
  syncContextToPostgres,
} from '@kysera/rls/native';
```

### 13.6 Errors

```typescript
// Error types
export {
  RLSContextError,
  RLSPolicyViolation,
  RLSSchemaError,
  RLSErrorCodes,
} from '@kysera/rls';
```

---

## 14. Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2)

1. **Context Management**
   - [ ] Implement `RLSContextManager` with AsyncLocalStorage
   - [ ] Create context types and interfaces
   - [ ] Add context validation
   - [ ] Write unit tests

2. **Policy Definition System**
   - [ ] Implement policy types and interfaces
   - [ ] Create `defineRLSSchema()` function
   - [ ] Implement `allow()`, `deny()`, `filter()` builders
   - [ ] Add policy validation

3. **Policy Registry**
   - [ ] Implement `PolicyRegistry` class
   - [ ] Add policy compilation
   - [ ] Implement policy lookup by table/operation

### Phase 2: Query Transformation (Week 3-4)

4. **SELECT Transformation**
   - [ ] Implement `SelectTransformer`
   - [ ] Add filter condition evaluation
   - [ ] Integrate with Kysely query builder
   - [ ] Write integration tests

5. **Mutation Guards**
   - [ ] Implement `MutationGuard` class
   - [ ] Add create/update/delete checks
   - [ ] Implement row fetching for policy evaluation
   - [ ] Handle async policies

6. **Plugin Implementation**
   - [ ] Create `rlsPlugin()` function
   - [ ] Implement `interceptQuery` hook
   - [ ] Implement `extendRepository` hook
   - [ ] Add configuration options

### Phase 3: Titan Integration (Week 5-6)

7. **Module & DI**
   - [ ] Create `RLSModule` for Titan
   - [ ] Implement provider registration
   - [ ] Add interceptor integration

8. **Decorators**
   - [ ] Implement `@Policy` class decorator
   - [ ] Implement `@Allow`, `@Deny`, `@Filter` method decorators
   - [ ] Implement `@BypassRLS` decorator
   - [ ] Add metadata reflection

9. **Context Provider**
   - [ ] Create `RLSContextProvider` interface
   - [ ] Implement `DefaultRLSContextProvider`
   - [ ] Create `RLSInterceptor`

### Phase 4: Native PostgreSQL Support (Week 7-8)

10. **RLS Generation**
    - [ ] Implement `PostgresRLSGenerator`
    - [ ] Add policy-to-SQL compilation
    - [ ] Create context functions generator

11. **Migration Integration**
    - [ ] Implement `RLSMigrationGenerator`
    - [ ] Add CLI command for migration generation
    - [ ] Support incremental policy updates

12. **Context Sync**
    - [ ] Implement `syncContextToPostgres()`
    - [ ] Add transaction-level sync
    - [ ] Create Kysely plugin for auto-sync

### Phase 5: Testing & Documentation (Week 9-10)

13. **Testing Utilities**
    - [ ] Create `RLSTestHelper`
    - [ ] Add policy coverage verification
    - [ ] Implement integration test helpers

14. **Documentation**
    - [ ] Write API documentation
    - [ ] Create usage examples
    - [ ] Add migration guide

15. **Performance Testing**
    - [ ] Benchmark policy evaluation
    - [ ] Test with large datasets
    - [ ] Optimize hot paths

---

## 15. Migration Guide

### 15.1 From Raw SQL Policies

```typescript
// Before: Manual SQL in repository
class ResourceRepository {
  async findAll(userId: string, tenantId: string) {
    return this.db
      .selectFrom('resources')
      .where('tenant_id', '=', tenantId)
      .where(eb => eb.or([
        eb('owner_id', '=', userId),
        eb('visibility', '=', 'public'),
      ]))
      .selectAll()
      .execute();
  }
}

// After: Declarative RLS
const schema = defineRLSSchema<Database>({
  resources: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow('read', ctx => ctx.auth.userId === ctx.row.owner_id),
      allow('read', ctx => ctx.row.visibility === 'public'),
    ],
  },
});

// Repository is now simple
class ResourceRepository {
  async findAll() {
    // RLS automatically applied
    return this.db.selectFrom('resources').selectAll().execute();
  }
}
```

### 15.2 From PostgreSQL Native RLS

```sql
-- Before: PostgreSQL policies
CREATE POLICY tenant_isolation ON resources
USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY owner_access ON resources
USING (owner_id = current_setting('app.user_id')::text);
```

```typescript
// After: Kysera RLS with native sync
const schema = defineRLSSchema<Database>({
  resources: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow('read', ctx => ctx.auth.userId === ctx.row.owner_id),
    ],
  },
});

// Plugin generates equivalent PostgreSQL RLS
const orm = await createORM(db, [
  rlsPlugin({ schema, nativeSync: true }),
]);
```

### 15.3 From Manual Permission Checks

```typescript
// Before: Manual checks in every method
async updateResource(id: number, data: UpdateInput, user: User) {
  const resource = await this.findById(id);

  if (!resource) throw new NotFoundError();

  if (resource.tenant_id !== user.tenantId) {
    throw new ForbiddenError('Wrong tenant');
  }

  if (resource.owner_id !== user.id && !user.roles.includes('admin')) {
    throw new ForbiddenError('Not owner or admin');
  }

  if (resource.locked) {
    throw new ForbiddenError('Resource is locked');
  }

  return this.update(id, data);
}

// After: Declarative policies
@Allow('update', ctx => ctx.auth.userId === ctx.row.owner_id)
@Allow('update', ctx => ctx.auth.roles.includes('admin'))
@Deny('update', ctx => ctx.row.locked)
async updateResource(id: number, data: UpdateInput) {
  // Authorization automatically enforced
  return this.update(id, data);
}
```

---

## Appendix A: Expression Language Syntax

```
// Basic comparisons
auth.userId == row.owner_id
auth.tenantId == row.tenant_id
row.status == "active"
row.count > 10

// Array operations
auth.roles contains "admin"
auth.organizationIds contains row.organization_id
row.tags containsAny ["featured", "promoted"]

// Logical operators
auth.userId == row.owner_id or auth.roles contains "admin"
row.status == "active" and row.visibility == "public"
not row.locked

// Null checks
row.deleted_at is null
row.published_at is not null

// Date comparisons
row.created_at > "2024-01-01"
row.expires_at < now()

// Nested access
auth.user.department == row.department
auth.user.attributes.clearance >= row.required_clearance
```

---

## Appendix B: Common Policy Patterns

### Multi-Tenant Isolation
```typescript
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
allow('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId)
```

### Owner-Based Access
```typescript
allow('read', ctx => ctx.auth.userId === ctx.row.owner_id)
allow('update', ctx => ctx.auth.userId === ctx.row.owner_id)
allow('delete', ctx => ctx.auth.userId === ctx.row.owner_id)
```

### Role-Based Access Control (RBAC)
```typescript
allow('all', ctx => ctx.auth.roles.includes('admin'))
allow('read', ctx => ctx.auth.roles.includes('viewer'))
allow(['create', 'update'], ctx => ctx.auth.roles.includes('editor'))
```

### Attribute-Based Access Control (ABAC)
```typescript
allow('read', ctx => ctx.auth.attributes.clearance >= ctx.row.classification_level)
allow('update', ctx => ctx.auth.attributes.department === ctx.row.department)
```

### Team/Organization Access
```typescript
allow('read', async ({ auth, row, db }) => {
  const member = await db
    .selectFrom('team_members')
    .where('team_id', '=', row.team_id)
    .where('user_id', '=', auth.userId)
    .executeTakeFirst();
  return member !== undefined;
})
```

### Time-Based Access
```typescript
deny('read', ctx =>
  ctx.row.embargo_until && new Date(ctx.row.embargo_until) > new Date()
)
allow('read', ctx => ctx.row.published_at <= new Date())
```

### Status-Based Access
```typescript
allow('read', ctx => ctx.row.status === 'published')
deny('delete', ctx => ctx.row.status === 'archived')
deny('update', ctx => ctx.row.locked === true)
```

---

## Appendix C: Performance Benchmarks (Target)

| Scenario | Without RLS | With ORM RLS | With Native RLS |
|----------|-------------|--------------|-----------------|
| SELECT 1000 rows (tenant filter) | 5ms | 6ms (+20%) | 5.5ms (+10%) |
| SELECT with complex policy | 5ms | 8ms (+60%) | 6ms (+20%) |
| INSERT with validation | 2ms | 3ms (+50%) | 2.5ms (+25%) |
| UPDATE with row check | 3ms | 5ms (+66%) | 4ms (+33%) |
| Batch 100 inserts | 50ms | 80ms (+60%) | 60ms (+20%) |

**Target**: ORM-level RLS should add no more than 100% overhead for typical operations.

---

## References

- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [ZenStack Authorization](https://zenstack.dev/)
- [Supabase RLS Documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Drizzle ORM RLS](https://orm.drizzle.team/docs/rls)
- [Permit.io RLS Guide](https://www.permit.io/blog/postgres-rls-implementation-guide)
- [PostgreSQL RLS Performance](https://scottpierce.dev/posts/optimizing-postgres-rls/)
