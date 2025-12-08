# @kysera/rls

> **Declarative Row-Level Security for Kysera ORM** - Type-safe authorization policies with automatic query transformation and native PostgreSQL RLS support.

[![npm version](https://img.shields.io/npm/v/@kysera/rls.svg)](https://www.npmjs.com/package/@kysera/rls)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9%2B-blue)](https://www.typescriptlang.org/)

---

## Features

- **Declarative Policy DSL** - Define authorization rules with intuitive `allow`, `deny`, `filter`, and `validate` builders
- **Automatic Query Transformation** - Transparently inject WHERE clauses and enforce policies without changing application code
- **Type-Safe Context** - Full TypeScript inference for user context, row data, and mutations
- **Multi-Tenant Isolation** - Built-in patterns for SaaS applications with tenant/organization separation
- **Native PostgreSQL RLS** - Optional generation of database-level policies for defense-in-depth
- **Role-Based Access Control** - Support for roles, permissions, and custom authorization attributes
- **Kysera Plugin Architecture** - Seamless integration with the Kysera ORM ecosystem
- **Zero Runtime Overhead** - Policies compiled at initialization, minimal performance impact
- **Async Local Storage** - Request-scoped context management without prop drilling
- **Audit Logging** - Optional decision logging for compliance and debugging

---

## Installation

```bash
npm install @kysera/rls kysely
# or
pnpm add @kysera/rls kysely
# or
yarn add @kysera/rls kysely
```

**Peer Dependencies:**
- `kysely` >= 0.28.8
- `@kysera/repository` (workspace package)
- `@kysera/core` (workspace package)

---

## Quick Start

```typescript
import { createORM } from '@kysera/repository';
import { rlsPlugin, defineRLSSchema, allow, filter, rlsContext } from '@kysera/rls';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

// Define your database schema
interface Database {
  posts: {
    id: number;
    title: string;
    content: string;
    author_id: number;
    tenant_id: number;
    status: 'draft' | 'published';
    created_at: Date;
  };
}

// Define RLS policies
const rlsSchema = defineRLSSchema<Database>({
  posts: {
    policies: [
      // Multi-tenant isolation - all users see only their tenant's data
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),

      // Authors can edit their own posts
      allow(['update', 'delete'], ctx =>
        ctx.auth.userId === ctx.row.author_id
      ),

      // Only published posts are visible to regular users
      filter('read', ctx =>
        ctx.auth.roles.includes('admin') ? {} : { status: 'published' }
      ),
    ],
    defaultDeny: true, // Require explicit allow
  },
});

// Create database connection
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool({ /* config */ }) }),
});

// Create ORM with RLS plugin
const orm = await createORM(db, [
  rlsPlugin({ schema: rlsSchema }),
]);

// Use within RLS context
app.use(async (req, res, next) => {
  // Extract user from JWT/session
  const user = await authenticate(req);

  await rlsContext.runAsync(
    {
      auth: {
        userId: user.id,
        tenantId: user.tenantId,
        roles: user.roles,
        isSystem: false,
      },
      timestamp: new Date(),
    },
    async () => {
      // All queries automatically filtered by tenant_id and policies
      const posts = await orm.posts.findAll(); // Only returns allowed posts
      res.json(posts);
    }
  );
});
```

---

## Core Concepts

### What is Row-Level Security?

Row-Level Security (RLS) is an authorization mechanism that controls access to individual rows in database tables based on user context. Instead of granting or denying access to entire tables, RLS policies determine which rows a user can read, create, update, or delete.

**Traditional Approach (Manual):**
```typescript
// ❌ Manual filtering - error-prone, easy to forget
const posts = await db
  .selectFrom('posts')
  .where('tenant_id', '=', req.user.tenantId) // Must remember every time!
  .where('status', '=', 'published')
  .selectAll()
  .execute();
```

**RLS Approach (Automatic):**
```typescript
// ✅ Automatic filtering - declarative, enforced everywhere
const posts = await orm.posts.findAll(); // Automatically filtered by tenant + status
```

### Policy Types

#### 1. **`allow`** - Grant Access

Grants access when the condition evaluates to `true`. Multiple `allow` policies are combined with OR logic.

```typescript
// Allow users to read their own posts
allow('read', ctx => ctx.auth.userId === ctx.row.author_id)

// Allow admins to perform any operation
allow('all', ctx => ctx.auth.roles.includes('admin'))

// Allow updates only for draft posts
allow('update', ctx => ctx.row.status === 'draft')
```

#### 2. **`deny`** - Block Access

Blocks access when the condition evaluates to `true`. Deny policies **override** allow policies and are evaluated first.

```typescript
// Deny access to banned users
deny('all', ctx => ctx.auth.attributes?.banned === true)

// Prevent deletion of published posts
deny('delete', ctx => ctx.row.status === 'published')

// Block all access to archived records
deny('all', ctx => ctx.row.archived === true)
```

#### 3. **`filter`** - Automatic Row Filtering

Adds WHERE conditions to SELECT queries automatically. Filter policies return an object with column-value pairs.

```typescript
// Filter by tenant (multi-tenancy)
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))

// Filter by organization with soft delete
filter('read', ctx => ({
  organization_id: ctx.auth.organizationIds?.[0],
  deleted_at: null,
}))

// Dynamic filtering based on role
filter('read', ctx =>
  ctx.auth.roles.includes('admin')
    ? {} // No filtering for admins
    : { status: 'published' } // Only published for others
)
```

#### 4. **`validate`** - Mutation Validation

Validates data during CREATE and UPDATE operations before execution. Useful for business rules and data integrity.

```typescript
// Validate user can only create posts in their tenant
validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId)

// Validate status transitions
validate('update', ctx => {
  const validTransitions = {
    draft: ['published', 'archived'],
    published: ['archived'],
    archived: [],
  };
  return !ctx.data.status ||
    validTransitions[ctx.row.status]?.includes(ctx.data.status);
})

// Validate email format
validate('create', ctx => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctx.data.email))
```

### Operations

Policies can target specific database operations:

| Operation | SQL Commands | Use Cases |
|-----------|-------------|-----------|
| `read` | SELECT | Control what data users can view |
| `create` | INSERT | Control what data users can create |
| `update` | UPDATE | Control what data users can modify |
| `delete` | DELETE | Control what data users can remove |
| `all` | All operations | Apply policy to all operations |

```typescript
// Single operation
allow('read', ctx => /* ... */)

// Multiple operations
allow(['read', 'update'], ctx => /* ... */)

// All operations
deny('all', ctx => ctx.auth.attributes?.suspended === true)
```

### Policy Evaluation Order

Policies are evaluated in a specific order to ensure security:

```
1. Check bypass conditions (system user, bypass roles)
   → If bypassed, ALLOW and skip all policies

2. Evaluate DENY policies (sorted by priority, highest first)
   → If ANY deny matches, REJECT immediately

3. Evaluate ALLOW policies (sorted by priority, highest first)
   → If NO allow matches and defaultDeny=true, REJECT

4. Apply FILTER policies (for SELECT queries)
   → Combine all filter conditions with AND logic

5. Apply VALIDATE policies (for CREATE/UPDATE)
   → All validate conditions must pass

6. Execute query
```

**Priority System:**
- Higher priority = evaluated first
- Deny policies default to priority `100`
- Allow/filter/validate policies default to priority `0`
- Explicit priority overrides defaults

```typescript
defineRLSSchema<Database>({
  posts: {
    policies: [
      // Evaluated FIRST (highest priority deny)
      deny('all', ctx => ctx.auth.suspended, { priority: 200 }),

      // Evaluated SECOND (default deny priority)
      deny('delete', ctx => ctx.row.locked, { priority: 100 }),

      // Evaluated THIRD (custom priority)
      allow('read', ctx => ctx.auth.roles.includes('premium'), { priority: 50 }),

      // Evaluated LAST (default priority)
      allow('read', ctx => ctx.row.public, { priority: 0 }),
    ],
  },
});
```

---

## Schema Definition

### `defineRLSSchema<DB>(schema)`

Define RLS policies for your database tables with full type safety.

```typescript
import { defineRLSSchema, allow, deny, filter, validate } from '@kysera/rls';

const schema = defineRLSSchema<Database>({
  // Table name (must match your Kysely schema)
  posts: {
    // Array of policies to enforce
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow('update', ctx => ctx.auth.userId === ctx.row.author_id),
      validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId),
    ],

    // Require explicit allow (default: true)
    defaultDeny: true,

    // Roles that bypass all policies (optional)
    skipFor: ['system', 'superadmin'],
  },

  comments: {
    policies: [
      // Policies for comments table
    ],
  },
});
```

**Options:**

- **`policies`** (required) - Array of policy definitions
- **`defaultDeny`** (default: `true`) - Deny access when no allow policies match
- **`skipFor`** (optional) - Array of roles that bypass RLS for this table

### `mergeRLSSchemas(...schemas)`

Combine multiple RLS schemas for modular policy management.

```typescript
// Base tenant isolation
const basePolicies = defineRLSSchema<Database>({
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
    ],
  },
});

// Admin overrides
const adminPolicies = defineRLSSchema<Database>({
  posts: {
    policies: [
      allow('all', ctx => ctx.auth.roles.includes('admin')),
    ],
  },
});

// Merged schema applies both
const schema = mergeRLSSchemas(basePolicies, adminPolicies);
```

---

## Policy Builders

### `allow(operation, condition, options?)`

Grant access when condition is true.

```typescript
// Basic allow
allow('read', ctx => ctx.auth.userId === ctx.row.user_id)

// Multiple operations
allow(['read', 'update'], ctx => ctx.row.owner_id === ctx.auth.userId)

// All operations (admin bypass)
allow('all', ctx => ctx.auth.roles.includes('admin'))

// With options
allow('read', ctx => ctx.auth.verified, {
  name: 'verified-users-only',
  priority: 10,
  hints: { indexColumns: ['verified'], selectivity: 'high' }
})

// Async condition
allow('update', async ctx => {
  const hasPermission = await checkPermission(ctx.auth.userId, 'posts:edit');
  return hasPermission;
})
```

### `deny(operation, condition?, options?)`

Block access when condition is true (overrides allow).

```typescript
// Basic deny
deny('delete', ctx => ctx.row.status === 'published')

// Deny all operations
deny('all', ctx => ctx.auth.attributes?.banned === true)

// Unconditional deny (no condition)
deny('all') // Always deny

// With high priority
deny('all', ctx => ctx.auth.suspended, {
  name: 'block-suspended-users',
  priority: 200
})
```

### `filter(operation, condition, options?)`

Add WHERE conditions to SELECT queries.

```typescript
// Simple filter
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))

// Multiple conditions
filter('read', ctx => ({
  organization_id: ctx.auth.organizationIds?.[0],
  deleted_at: null,
  status: 'active'
}))

// Dynamic filter
filter('read', ctx => {
  if (ctx.auth.roles.includes('admin')) {
    return {}; // No filtering
  }
  return { status: 'published', public: true };
})

// With options
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }), {
  name: 'tenant-isolation',
  priority: 1000, // High priority for tenant isolation
  hints: { indexColumns: ['tenant_id'], selectivity: 'high' }
})
```

**Note:** Filter policies only apply to `'read'` operations. Using `'all'` is automatically converted to `'read'`.

### `validate(operation, condition, options?)`

Validate mutation data during CREATE/UPDATE.

```typescript
// Validate create
validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId)

// Validate update
validate('update', ctx => {
  // Only allow changing specific fields
  const allowedFields = ['title', 'content', 'tags'];
  return Object.keys(ctx.data).every(key => allowedFields.includes(key));
})

// Validate both create and update
validate('all', ctx => {
  // Price must be positive
  return !ctx.data.price || ctx.data.price >= 0;
})

// Complex validation
validate('update', ctx => {
  // Validate status transitions
  const { status } = ctx.data;
  if (!status) return true; // Not changing status

  const validTransitions = {
    draft: ['published', 'archived'],
    published: ['archived'],
    archived: [],
  };

  return validTransitions[ctx.row.status]?.includes(status) ?? false;
})

// With options
validate('create', ctx => validateEmail(ctx.data.email), {
  name: 'validate-email-format'
})
```

**Note:** Validate policies apply to `'create'` and `'update'` operations. Using `'all'` applies to both.

### Policy Options

All policy builders accept an optional `options` parameter:

```typescript
interface PolicyOptions {
  /** Policy name for debugging and identification */
  name?: string;

  /** Priority (higher runs first, deny defaults to 100) */
  priority?: number;

  /** Performance optimization hints */
  hints?: {
    /** Columns that should be indexed */
    indexColumns?: string[];

    /** Expected selectivity (high = filters many rows) */
    selectivity?: 'high' | 'medium' | 'low';

    /** Whether policy is leakproof (safe to execute early) */
    leakproof?: boolean;

    /** Whether policy result is stable for same inputs */
    stable?: boolean;
  };
}
```

---

## Context Management

### RLSContext Interface

The RLS context contains all information needed for policy evaluation.

```typescript
interface RLSContext<TUser = unknown, TMeta = unknown> {
  /** Authentication context (required) */
  auth: {
    /** User identifier */
    userId: string | number;

    /** User roles for RBAC */
    roles: string[];

    /** Tenant ID for multi-tenancy (optional) */
    tenantId?: string | number;

    /** Organization IDs (optional) */
    organizationIds?: (string | number)[];

    /** Granular permissions (optional) */
    permissions?: string[];

    /** Custom user attributes (optional) */
    attributes?: Record<string, unknown>;

    /** Full user object (optional) */
    user?: TUser;

    /** System/admin bypass flag (default: false) */
    isSystem?: boolean;
  };

  /** Request context (optional) */
  request?: {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
    headers?: Record<string, string>;
  };

  /** Custom metadata (optional) */
  meta?: TMeta;

  /** Context creation timestamp */
  timestamp: Date;
}
```

### `rlsContext.runAsync(context, fn)`

Run a function within an RLS context (async).

```typescript
import { rlsContext } from '@kysera/rls';

await rlsContext.runAsync(
  {
    auth: {
      userId: 123,
      roles: ['user'],
      tenantId: 'acme-corp',
      isSystem: false,
    },
    timestamp: new Date(),
  },
  async () => {
    // All queries in this scope use the RLS context
    const posts = await orm.posts.findAll();
    await orm.posts.create({ title: 'New Post', /* ... */ });
  }
);
```

### `rlsContext.run(context, fn)`

Run a function within an RLS context (sync).

```typescript
rlsContext.run(
  {
    auth: { userId: 123, roles: ['user'], isSystem: false },
    timestamp: new Date(),
  },
  () => {
    // Synchronous code
    const currentUserId = rlsContext.getContext().auth.userId;
  }
);
```

### `createRLSContext(options)`

Create an RLS context object with validation.

```typescript
import { createRLSContext } from '@kysera/rls';

const ctx = createRLSContext({
  userId: 123,
  roles: ['user', 'editor'],
  tenantId: 'acme-corp',
  // Optional fields
  organizationIds: ['org-1'],
  permissions: ['posts:read', 'posts:write'],
  isSystem: false,
});

// Use with runAsync
await rlsContext.runAsync(ctx, async () => {
  // ...
});
```

### `withRLSContext(context, fn)`

Helper for async context execution (alternative to `runAsync`).

```typescript
import { withRLSContext } from '@kysera/rls';

const result = await withRLSContext(
  {
    auth: { userId: 123, roles: ['user'], isSystem: false },
    timestamp: new Date(),
  },
  async () => {
    return await orm.posts.findAll();
  }
);
```

### Context Helpers

```typescript
// Get current context (throws if not set)
const ctx = rlsContext.getContext();

// Get current context or null (safe)
const ctx = rlsContext.getContextOrNull();

// Check if context exists
if (rlsContext.hasContext()) {
  // Context is available
}

// Run as system user (bypass RLS)
await rlsContext.asSystemAsync(async () => {
  // All queries bypass RLS policies
  const allPosts = await orm.posts.findAll();
});
```

---

## Common Patterns

### Multi-Tenant Isolation

```typescript
const schema = defineRLSSchema<Database>({
  // Apply tenant isolation to all tables
  posts: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId),
      validate('update', ctx => !ctx.data.tenant_id ||
        ctx.data.tenant_id === ctx.auth.tenantId),
    ],
    defaultDeny: true,
  },

  comments: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId),
    ],
    defaultDeny: true,
  },
});

// Usage
app.use(async (req, res, next) => {
  const user = await authenticate(req);

  await rlsContext.runAsync(
    {
      auth: {
        userId: user.id,
        tenantId: user.tenant_id, // Tenant from JWT/session
        roles: user.roles,
        isSystem: false,
      },
      timestamp: new Date(),
    },
    async () => {
      // Automatically filtered by tenant_id
      const posts = await orm.posts.findAll();
      res.json(posts);
    }
  );
});
```

### Owner-Based Access

```typescript
const schema = defineRLSSchema<Database>({
  posts: {
    policies: [
      // Users can read all public posts
      filter('read', ctx => ({ public: true })),

      // Users can read their own posts (public or private)
      allow('read', ctx => ctx.auth.userId === ctx.row.author_id),

      // Users can update/delete only their own posts
      allow(['update', 'delete'], ctx =>
        ctx.auth.userId === ctx.row.author_id
      ),

      // Users can create posts
      allow('create', ctx => true),

      // Set author_id automatically
      validate('create', ctx => ctx.data.author_id === ctx.auth.userId),
    ],
    defaultDeny: true,
  },
});
```

### Role-Based Access Control (RBAC)

```typescript
const schema = defineRLSSchema<Database>({
  posts: {
    policies: [
      // Admins can do everything
      allow('all', ctx => ctx.auth.roles.includes('admin')),

      // Editors can read and update
      allow(['read', 'update'], ctx =>
        ctx.auth.roles.includes('editor')
      ),

      // Authors can create and edit their own
      allow(['read', 'update', 'delete'], ctx =>
        ctx.auth.roles.includes('author') &&
        ctx.auth.userId === ctx.row.author_id
      ),

      // Regular users can only read published posts
      allow('read', ctx =>
        ctx.auth.roles.includes('user') &&
        ctx.row.status === 'published'
      ),
    ],
    defaultDeny: true,
  },
});
```

### Status-Based Restrictions

```typescript
const schema = defineRLSSchema<Database>({
  posts: {
    policies: [
      // Can't delete published posts
      deny('delete', ctx => ctx.row.status === 'published'),

      // Can only update drafts and pending
      allow('update', ctx =>
        ['draft', 'pending'].includes(ctx.row.status)
      ),

      // Validate status transitions
      validate('update', ctx => {
        if (!ctx.data.status) return true;

        const transitions = {
          draft: ['pending', 'published'],
          pending: ['published', 'draft'],
          published: ['archived'],
          archived: [],
        };

        return transitions[ctx.row.status]?.includes(ctx.data.status) ?? false;
      }),
    ],
  },
});
```

---

## Native PostgreSQL RLS

Generate native database-level RLS policies for defense-in-depth security.

### `PostgresRLSGenerator`

Generate PostgreSQL `CREATE POLICY` statements from your RLS schema.

```typescript
import { PostgresRLSGenerator } from '@kysera/rls/native';

const generator = new PostgresRLSGenerator(rlsSchema, {
  contextFunctions: {
    // Define SQL functions to access context
    userId: 'current_setting(\'app.user_id\')::integer',
    tenantId: 'current_setting(\'app.tenant_id\')::uuid',
    roles: 'current_setting(\'app.roles\')::text[]',
  },
});

// Generate policies for a table
const sql = generator.generatePolicies('posts');
console.log(sql);

/*
Output:
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON posts
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY author_access ON posts
  FOR UPDATE
  USING (author_id = current_setting('app.user_id')::integer);
*/
```

### `RLSMigrationGenerator`

Generate migration files for PostgreSQL RLS policies.

```typescript
import { RLSMigrationGenerator } from '@kysera/rls/native';

const migrationGen = new RLSMigrationGenerator(rlsSchema, {
  contextFunctions: {
    userId: 'current_setting(\'app.user_id\')::integer',
    tenantId: 'current_setting(\'app.tenant_id\')::uuid',
  },
  migrationPath: './migrations',
  timestamp: true,
});

// Generate migration
const { up, down } = migrationGen.generateMigration();

console.log('--- UP ---');
console.log(up);
console.log('--- DOWN ---');
console.log(down);
```

### `syncContextToPostgres`

Sync RLS context to PostgreSQL session variables.

```typescript
import { syncContextToPostgres } from '@kysera/rls/native';
import { db } from './database';

await rlsContext.runAsync(
  {
    auth: { userId: 123, tenantId: 'acme', roles: ['user'], isSystem: false },
    timestamp: new Date(),
  },
  async () => {
    // Sync context to PostgreSQL session
    await syncContextToPostgres(db);

    // Now PostgreSQL policies can access:
    // current_setting('app.user_id')::integer = 123
    // current_setting('app.tenant_id')::text = 'acme'
    // current_setting('app.roles')::text[] = '{user}'

    // Execute raw SQL with native RLS
    await db.executeQuery(sql`SELECT * FROM posts`);
  }
);
```

---

## Error Handling

### Error Types

```typescript
import {
  RLSError,
  RLSContextError,
  RLSPolicyViolation,
  RLSSchemaError,
  RLSContextValidationError,
  RLSErrorCodes,
} from '@kysera/rls';
```

#### `RLSContextError`

Thrown when RLS context is missing or not set.

```typescript
try {
  // No RLS context set
  await orm.posts.findAll();
} catch (error) {
  if (error instanceof RLSContextError) {
    console.error('RLS context required:', error.message);
    // error.code === 'RLS_CONTEXT_MISSING'
  }
}
```

#### `RLSPolicyViolation`

Thrown when a database operation is denied by RLS policies.

```typescript
try {
  // User tries to update a post they don't own
  await orm.posts.update(1, { title: 'New Title' });
} catch (error) {
  if (error instanceof RLSPolicyViolation) {
    console.error('Policy violation:', {
      operation: error.operation, // 'update'
      table: error.table, // 'posts'
      reason: error.reason, // 'User does not own this post'
      policyName: error.policyName, // 'ownership_policy'
    });
  }
}
```

### Handling Violations

```typescript
import { rlsPlugin } from '@kysera/rls';

const orm = await createORM(db, [
  rlsPlugin({
    schema: rlsSchema,

    // Custom violation handler
    onViolation: (violation) => {
      console.error('RLS Violation:', {
        operation: violation.operation,
        table: violation.table,
        reason: violation.reason,
        policyName: violation.policyName,
      });

      // Log to audit system
      auditLog.record({
        type: 'rls_violation',
        operation: violation.operation,
        table: violation.table,
        timestamp: new Date(),
      });
    },

    // Enable audit logging
    auditDecisions: true,
  }),
]);
```

---

## TypeScript Support

### Full Type Inference

```typescript
// Database schema
interface Database {
  posts: {
    id: number;
    title: string;
    author_id: number;
    tenant_id: string;
  };
}

// Type-safe policy definition
const schema = defineRLSSchema<Database>({
  posts: {
    policies: [
      // ctx.row is typed as Database['posts']
      allow('read', ctx => {
        const post = ctx.row; // Type: Database['posts']
        const userId = ctx.auth.userId; // Type: string | number

        return post.author_id === userId;
      }),

      // ctx.data is typed as Partial<Database['posts']>
      validate('update', ctx => {
        const data = ctx.data; // Type: Partial<Database['posts']>
        const title = data.title; // Type: string | undefined

        return !title || title.length > 0;
      }),
    ],
  },
});
```

---

## Testing

### Unit Testing Policies

```typescript
import { describe, it, expect } from 'vitest';
import { allow, filter, validate } from '@kysera/rls';

describe('Post Policies', () => {
  it('should allow owner to update post', () => {
    const policy = allow('update', ctx =>
      ctx.auth.userId === ctx.row.author_id
    );

    const context = {
      auth: { userId: 123, roles: [], isSystem: false },
      row: { author_id: 123 },
    };

    const result = policy.condition(context as any);
    expect(result).toBe(true);
  });

  it('should filter posts by tenant', () => {
    const policy = filter('read', ctx => ({
      tenant_id: ctx.auth.tenantId
    }));

    const context = {
      auth: { userId: 123, tenantId: 'acme', roles: [], isSystem: false },
    };

    const result = policy.condition(context as any);
    expect(result).toEqual({ tenant_id: 'acme' });
  });
});
```

### Integration Testing

```typescript
import { describe, it, beforeEach, expect } from 'vitest';
import { createORM } from '@kysera/repository';
import { rlsPlugin, rlsContext, defineRLSSchema } from '@kysera/rls';

describe('RLS Integration', () => {
  let orm: ReturnType<typeof createORM>;

  beforeEach(async () => {
    const schema = defineRLSSchema<Database>({
      posts: {
        policies: [
          filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
        ],
      },
    });

    orm = await createORM(db, [rlsPlugin({ schema })]);
  });

  it('should filter posts by tenant', async () => {
    await rlsContext.runAsync(
      {
        auth: {
          userId: 1,
          tenantId: 'tenant-1',
          roles: ['user'],
          isSystem: false,
        },
        timestamp: new Date(),
      },
      async () => {
        const posts = await orm.posts.findAll();

        // All posts should belong to tenant-1
        expect(posts.every(p => p.tenant_id === 'tenant-1')).toBe(true);
      }
    );
  });
});
```

---

## API Reference

### Core Exports

```typescript
// Schema definition
export { defineRLSSchema, mergeRLSSchemas } from '@kysera/rls';

// Policy builders
export { allow, deny, filter, validate } from '@kysera/rls';

// Plugin
export { rlsPlugin } from '@kysera/rls';
export type { RLSPluginOptions } from '@kysera/rls';

// Context management
export {
  rlsContext,
  createRLSContext,
  withRLSContext,
  withRLSContextAsync,
} from '@kysera/rls';

// Errors
export {
  RLSError,
  RLSContextError,
  RLSPolicyViolation,
  RLSSchemaError,
  RLSContextValidationError,
  RLSErrorCodes,
} from '@kysera/rls';
```

### Native PostgreSQL Exports

```typescript
// Import from @kysera/rls/native
export {
  PostgresRLSGenerator,
  syncContextToPostgres,
  clearPostgresContext,
  RLSMigrationGenerator,
} from '@kysera/rls/native';
```

### Repository Extensions

When using the RLS plugin, repositories are extended with:

```typescript
interface RLSRepositoryExtensions {
  /**
   * Bypass RLS for specific operation
   * Requires existing context
   */
  withoutRLS<R>(fn: () => Promise<R>): Promise<R>;

  /**
   * Check if current user can perform operation on a row
   */
  canAccess(operation: Operation, row: Record<string, unknown>): Promise<boolean>;
}

// Usage
const canEdit = await repo.canAccess('update', post);
if (canEdit) {
  await repo.update(post.id, { title: 'New Title' });
}

// Bypass RLS (requires system context or bypass role)
const allPosts = await repo.withoutRLS(async () => {
  return repo.findAll(); // No RLS filtering
});
```

---

## Security Considerations

### Context Validation

Always validate RLS context before use:

```typescript
import { createRLSContext, RLSContextValidationError } from '@kysera/rls';

try {
  const ctx = createRLSContext({
    auth: {
      userId: user.id,       // Required
      roles: user.roles,     // Required (array)
      tenantId: user.tenant, // Optional
    },
  });
} catch (error) {
  if (error instanceof RLSContextValidationError) {
    // Handle invalid context
  }
}
```

### SQL Injection Prevention

All filter conditions are parameterized - never construct SQL from user input:

```typescript
// ✅ Safe - values are parameterized
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))

// ❌ Never do this - raw SQL from user input
filter('read', ctx => sql.raw(`tenant_id = '${userInput}'`))
```

### Defense in Depth

For maximum security, combine ORM-level RLS with native PostgreSQL RLS:

```typescript
const orm = await createORM(db, [
  rlsPlugin({
    schema: rlsSchema,
    nativeSync: true, // Generate PostgreSQL RLS policies
  }),
]);
```

### System User Access

The `isSystem: true` flag bypasses all RLS checks. Use sparingly:

```typescript
// Only for trusted system operations
await rlsContext.asSystemAsync(async () => {
  await db.selectFrom('audit_logs').selectAll().execute();
});
```

### Audit Logging

Enable audit logging in production:

```typescript
const orm = await createORM(db, [
  rlsPlugin({
    schema: rlsSchema,
    auditDecisions: true, // Log all policy decisions
    onViolation: (violation) => {
      logger.warn('RLS violation', {
        operation: violation.operation,
        table: violation.table,
        userId: violation.userId,
      });
    },
  }),
]);
```

---

## Performance Tips

### Index Filter Columns

Ensure columns used in filter policies are indexed:

```sql
-- tenant_id is commonly used in RLS filters
CREATE INDEX idx_posts_tenant ON posts (tenant_id);
CREATE INDEX idx_resources_tenant ON resources (tenant_id);
```

### Use Hints for Native RLS

When generating native PostgreSQL policies, use hints:

```typescript
filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }), {
  hints: {
    indexColumns: ['tenant_id'],
    selectivity: 'high', // Many rows per tenant
  },
})
```

### Avoid Async Policies for Hot Paths

Sync policies are faster than async:

```typescript
// ✅ Fast - synchronous evaluation
allow('read', ctx => ctx.auth.userId === ctx.row.owner_id)

// ⚠️ Slower - async evaluation (use when necessary)
allow('read', async ctx => {
  const membership = await db.selectFrom('memberships')...
  return membership !== undefined;
})
```

---

## Documentation

See [kysera-rls-spec.md](kysera-rls-spec.md) for detailed specification and architecture.

---

## License

MIT

---

**Built with ❤️ by the Kysera Team**
