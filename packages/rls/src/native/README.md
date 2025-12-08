# Native PostgreSQL RLS Generation

This module provides native PostgreSQL Row-Level Security (RLS) policy generation from Kysera RLS schemas.

## Features

- **PostgreSQL RLS Generation**: Convert Kysera RLS schemas to native PostgreSQL `CREATE POLICY` statements
- **Context Functions**: Generate STABLE PostgreSQL functions for RLS context (optimized for query planner)
- **Migration Support**: Generate Kysely migration files with up/down support
- **Session Management**: Utilities to sync RLS context to PostgreSQL session variables

## Usage

### 1. Define RLS Schema with Native PostgreSQL Support

```typescript
import type { RLSSchema } from '@kysera/rls';

interface Database {
  users: {
    id: number;
    email: string;
    tenant_id: string;
  };
}

const rlsSchema: RLSSchema<Database> = {
  users: {
    policies: [
      {
        type: 'allow',
        operation: 'read',
        name: 'users_read_own',
        condition: () => true, // ORM-side condition
        using: 'id = rls_current_user_id()::integer', // Native PostgreSQL
        role: 'authenticated',
      },
    ],
  },
};
```

### 2. Generate PostgreSQL Statements

```typescript
import { PostgresRLSGenerator } from '@kysera/rls/native';

const generator = new PostgresRLSGenerator();

// Generate RLS policies
const statements = generator.generateStatements(rlsSchema, {
  schemaName: 'public',
  policyPrefix: 'app_rls',
  force: true, // Force RLS on table owners
});

// Generate context functions
const contextFunctions = generator.generateContextFunctions();

// Generate cleanup statements
const dropStatements = generator.generateDropStatements(rlsSchema, {
  schemaName: 'public',
  policyPrefix: 'app_rls',
});
```

### 3. Generate Kysely Migration

```typescript
import { RLSMigrationGenerator } from '@kysera/rls/native';

const migrationGenerator = new RLSMigrationGenerator();

const migrationContent = migrationGenerator.generateMigration(rlsSchema, {
  name: 'setup_rls',
  schemaName: 'public',
  policyPrefix: 'app_rls',
  includeContextFunctions: true,
  force: true,
});

// Get suggested filename with timestamp
const filename = migrationGenerator.generateFilename('setup_rls');
// Example: 20231208_123456_setup_rls.ts

// Write to migrations directory
import fs from 'fs';
fs.writeFileSync(`migrations/${filename}`, migrationContent);
```

### 4. Sync Context to PostgreSQL Session

```typescript
import { syncContextToPostgres, clearPostgresContext } from '@kysera/rls/native';
import { Kysely } from 'kysely';

const db = new Kysely<Database>({ ... });

// At the start of each request/transaction
await syncContextToPostgres(db, {
  userId: 123,
  tenantId: 'tenant-uuid',
  roles: ['user', 'admin'],
  permissions: ['read:posts', 'write:posts'],
  isSystem: false,
});

// Execute queries - RLS policies will be enforced
const users = await db.selectFrom('users').selectAll().execute();

// Clear context when done (optional, resets on connection close)
await clearPostgresContext(db);
```

## Policy Definition

### Native RLS Fields

Extend your Kysera policy definitions with native PostgreSQL support:

```typescript
{
  type: 'allow' | 'deny',        // 'deny' becomes RESTRICTIVE policy
  operation: Operation | Operation[],
  condition: () => true,          // ORM-side evaluation

  // Native PostgreSQL RLS fields:
  using?: string,                 // USING clause (for SELECT/UPDATE/DELETE)
  withCheck?: string,             // WITH CHECK clause (for INSERT/UPDATE)
  role?: string,                  // Target role (default: 'public')
  name?: string,                  // Policy name
}
```

### Policy Types

- **`allow`**: Maps to `AS PERMISSIVE` policy
- **`deny`**: Maps to `AS RESTRICTIVE` policy (takes precedence)
- **`filter`**: ORM-only, not generated as native RLS
- **`validate`**: ORM-only, not generated as native RLS

### Operations

| Kysera | PostgreSQL |
|--------|------------|
| `read` | `SELECT` |
| `create` | `INSERT` |
| `update` | `UPDATE` |
| `delete` | `DELETE` |
| `all` | `ALL` |

## Context Functions

The generator creates these STABLE PostgreSQL functions for optimal performance:

```sql
-- Get current user ID
rls_current_user_id() -> text

-- Get current tenant ID
rls_current_tenant_id() -> uuid

-- Get current user roles
rls_current_roles() -> text[]

-- Check if user has role
rls_has_role(role_name text) -> boolean

-- Get current permissions
rls_current_permissions() -> text[]

-- Check if user has permission
rls_has_permission(permission_name text) -> boolean

-- Check if this is a system account
rls_is_system() -> boolean
```

These functions read from PostgreSQL session variables set by `syncContextToPostgres()`.

## Examples

### Multi-Tenant Application

```typescript
const rlsSchema: RLSSchema<Database> = {
  posts: {
    policies: [
      {
        type: 'allow',
        operation: 'read',
        name: 'posts_read_tenant',
        condition: () => true,
        using: 'tenant_id = rls_current_tenant_id()',
        role: 'authenticated',
      },
      {
        type: 'allow',
        operation: 'create',
        name: 'posts_create_own',
        condition: () => true,
        withCheck: 'user_id = rls_current_user_id()::integer AND tenant_id = rls_current_tenant_id()',
        role: 'authenticated',
      },
    ],
    defaultDeny: true,
  },
};
```

### Role-Based Access Control

```typescript
const rlsSchema: RLSSchema<Database> = {
  admin_settings: {
    policies: [
      {
        type: 'allow',
        operation: 'all',
        name: 'admin_full_access',
        condition: () => true,
        using: 'rls_has_role(\'admin\')',
        role: 'authenticated',
      },
      {
        type: 'deny',
        operation: 'all',
        name: 'deny_non_admin',
        condition: () => true,
        using: 'NOT rls_has_role(\'admin\')',
        role: 'authenticated',
      },
    ],
    defaultDeny: true,
  },
};
```

### System Bypass

```typescript
{
  type: 'allow',
  operation: 'all',
  name: 'system_bypass',
  condition: () => true,
  using: 'rls_is_system()',
  role: 'authenticated',
}
```

## Performance Considerations

1. **STABLE Functions**: All context functions are marked as `STABLE`, allowing PostgreSQL's query planner to optimize policy evaluation.

2. **Session Variables**: Context is stored in PostgreSQL session variables (`set_config`) for fast access without database lookups.

3. **Policy Ordering**: Policies run in order of priority (higher first). Deny policies have default priority 100.

4. **Index Support**: Create indexes on columns used in RLS policies for better performance:

```sql
CREATE INDEX idx_posts_tenant ON posts(tenant_id);
CREATE INDEX idx_posts_user ON posts(user_id);
```

## Migration Workflow

1. **Generate Migration**:
   ```bash
   npx tsx -e "import { RLSMigrationGenerator } from './src/native'; ..."
   ```

2. **Review Generated SQL**: Check migration file before applying

3. **Run Migration**:
   ```bash
   npx kysely migrate:latest
   ```

4. **Test Policies**: Verify RLS policies work as expected

5. **Rollback if Needed**:
   ```bash
   npx kysely migrate:down
   ```

## API Reference

### `PostgresRLSGenerator`

#### Methods

- `generateStatements(schema, options)`: Generate RLS policy statements
- `generateContextFunctions()`: Generate context function SQL
- `generateDropStatements(schema, options)`: Generate cleanup statements

### `RLSMigrationGenerator`

#### Methods

- `generateMigration(schema, options)`: Generate Kysely migration file content
- `generateFilename(name)`: Generate timestamped migration filename

### `syncContextToPostgres(db, context)`

Sync RLS context to PostgreSQL session variables.

### `clearPostgresContext(db)`

Clear RLS context from PostgreSQL session.

## License

MIT
