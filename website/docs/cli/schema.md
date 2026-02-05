---
sidebar_position: 11
title: schema
description: PostgreSQL schema management commands
---

# kysera schema

PostgreSQL schema management commands for multi-tenant and modular database architectures.

:::info PostgreSQL Only
Schema management commands are only available for PostgreSQL databases. SQLite has no schema support, and MySQL uses databases as the equivalent concept.
:::

## Commands

| Command   | Description                                      |
| --------- | ------------------------------------------------ |
| `list`    | List all database schemas                        |
| `create`  | Create a new database schema                     |
| `drop`    | Drop a database schema                           |
| `info`    | Show detailed information about a schema         |
| `clone`   | Clone a schema structure to a new schema         |
| `compare` | Compare two schemas and show differences         |

---

### list

List all database schemas.

```bash
kysera schema list
```

**Options:**

```
--json               Output as JSON
--tenant             Only show tenant schemas (tenant_* pattern)
-v, --verbose        Show detailed information (tables, owner, size)
-c, --config <path>  Path to configuration file
```

**Examples:**

```bash
# List all schemas
kysera schema list

# Show detailed information
kysera schema list --verbose

# Only tenant schemas
kysera schema list --tenant

# JSON output
kysera schema list --json
```

**Output:**

```
Database Schemas

  [tenant] tenant_acme
  [tenant] tenant_globex
           public
           auth
           admin

Use --verbose for detailed information
```

**Verbose Output:**

```
Database Schemas

name           tables  owner      size      tenant
─────────────────────────────────────────────────────
public         12      postgres   4.25 MB   -
auth           5       postgres   1.12 MB   -
tenant_acme    15      app_user   2.34 MB   acme
tenant_globex  15      app_user   1.87 MB   globex
```

---

### create

Create a new database schema.

```bash
kysera schema create <name>
```

**Arguments:**

- `name` - Schema name to create

**Options:**

```
--tenant <id>        Create as tenant schema with specified ID
--if-not-exists      Do not error if schema already exists
--force              Skip confirmation prompt
-v, --verbose        Show detailed output
-c, --config <path>  Path to configuration file
```

**Examples:**

```bash
# Create a schema
kysera schema create auth

# Create without confirmation
kysera schema create auth --force

# Create tenant schema (uses tenant_<id> naming convention)
kysera schema create --tenant acme
# Creates schema: tenant_acme

# Create if not exists
kysera schema create auth --if-not-exists
```

**Tenant Schema Creation:**

When using `--tenant`, the schema name follows the `tenant_<id>` naming convention:

```bash
kysera schema create --tenant 123
# Output:
# Schema 'tenant_123' created successfully
#
# Tenant schema created with naming convention:
#   Schema: tenant_123
#   Tenant ID: 123
#
# Next steps:
#   1. Run migrations in the new schema:
#      kysera migrate up --schema tenant_123
#   2. Or clone from a template schema:
#      kysera schema clone template tenant_123
```

---

### drop

Drop a database schema.

```bash
kysera schema drop <name>
```

**Arguments:**

- `name` - Schema name to drop

**Options:**

```
--cascade            Drop all objects in the schema (CASCADE)
--if-exists          Do not error if schema does not exist
--force              Skip confirmation prompt
-v, --verbose        Show detailed output
-c, --config <path>  Path to configuration file
```

**Protected Schemas:**

The following schemas cannot be dropped:
- `public`
- `pg_catalog`
- `information_schema`

**Examples:**

```bash
# Drop a schema (requires confirmation)
kysera schema drop old_tenant

# Drop with CASCADE (drops all contained objects)
kysera schema drop old_tenant --cascade

# Drop without confirmation
kysera schema drop old_tenant --cascade --force

# Drop if exists (no error if not found)
kysera schema drop old_tenant --if-exists
```

**Confirmation Output:**

```
Warning: You are about to drop schema 'tenant_old'
  Tables: 15
  Size: 2.34 MB
  CASCADE: All objects in the schema will be dropped!

? Are you sure you want to drop schema 'tenant_old'? (y/N)
```

---

### info

Show detailed information about a schema.

```bash
kysera schema info <name>
```

**Arguments:**

- `name` - Schema name

**Options:**

```
--json               Output as JSON
--indexes            Show index information
--foreign-keys       Show foreign key relationships
-v, --verbose        Show all details (indexes, foreign keys)
-c, --config <path>  Path to configuration file
```

**Examples:**

```bash
# Basic info
kysera schema info public

# With indexes
kysera schema info public --indexes

# With foreign keys
kysera schema info public --foreign-keys

# Full details
kysera schema info public --verbose

# JSON output
kysera schema info public --json
```

**Output:**

```
Schema: public
──────────────────────────────────────────────────

General Information:
  Owner: postgres
  Tables: 12
  Size: 4.25 MB

Tables:
  - users
  - posts
  - comments
  - categories
  - tags
  - post_tags

Commands:
  Clone: kysera schema clone public <target>
  Drop: kysera schema drop public --cascade
  Compare: kysera schema compare public <other>
```

**Verbose Output (with --verbose):**

```
Schema: tenant_acme
──────────────────────────────────────────────────

General Information:
  Owner: app_user
  Tables: 15
  Size: 2.34 MB

Tenant Information:
  Tenant ID: acme
  Schema Pattern: tenant_<id>

Tables:
  - users
  - posts
  - comments
  ...

Indexes:
table       index              type    unique  primary  columns
────────────────────────────────────────────────────────────────
users       users_pkey         btree   Yes     Yes      id
users       users_email_idx    btree   Yes     No       email
posts       posts_pkey         btree   Yes     Yes      id
posts       posts_user_id_idx  btree   No      No       user_id

Foreign Keys:
constraint          table    column    references                 onDelete  onUpdate
──────────────────────────────────────────────────────────────────────────────────────
posts_user_id_fkey  posts    user_id   public.users.id            CASCADE   CASCADE
comments_post_fkey  comments post_id   public.posts.id            CASCADE   CASCADE
```

---

### clone

Clone a schema's structure (and optionally data) to a new schema.

```bash
kysera schema clone <source> <target>
```

**Arguments:**

- `source` - Source schema name
- `target` - Target schema name

**Options:**

```
--include-data         Include table data in the clone
--exclude <tables...>  Tables to exclude from cloning
--tenant <id>          Create target as tenant schema with specified ID
--force                Skip confirmation prompt
-v, --verbose          Show detailed output
-c, --config <path>    Path to configuration file
```

**Examples:**

```bash
# Clone structure only
kysera schema clone template new_tenant

# Clone with data
kysera schema clone template new_tenant --include-data

# Clone as tenant schema
kysera schema clone template --tenant acme
# Creates: tenant_acme

# Exclude certain tables
kysera schema clone template new_tenant --exclude logs sessions

# Without confirmation
kysera schema clone template new_tenant --force
```

**Confirmation Output:**

```
Clone Schema
──────────────────────────────────────────────────
  Source: template
  Target: tenant_acme
  Tables: 15
  Size: 1.24 MB
  Include Data: No

? Clone schema 'template' to 'tenant_acme'? (Y/n)
```

**Success Output:**

```
Schema 'template' cloned to 'tenant_acme' successfully

Clone Summary:
  Tables cloned: 15
  Size: 48 KB

Tenant schema created:
  Schema: tenant_acme
  Tenant ID: acme

Next steps:
  View schema: kysera schema info tenant_acme
  Run queries: kysera query --schema tenant_acme
```

---

### compare

Compare two schemas and show differences.

```bash
kysera schema compare <schema1> <schema2>
```

**Arguments:**

- `schema1` - First schema name
- `schema2` - Second schema name

**Options:**

```
--json               Output as JSON
-v, --verbose        Show detailed output (list all common tables)
-c, --config <path>  Path to configuration file
```

**Examples:**

```bash
# Compare two schemas
kysera schema compare template tenant_acme

# Verbose output
kysera schema compare template tenant_acme --verbose

# JSON output
kysera schema compare template tenant_acme --json
```

**Output:**

```
Schema Comparison
============================================================

Schema Overview:

  template                       tenant_acme
  ------------------------------ ------------------------------
  Tables: 15                     Tables: 16
  Size: 1.24 MB                  Size: 2.34 MB

Tables only in 'template' (1):
  - archived_users

Tables only in 'tenant_acme' (2):
  + custom_settings
  + tenant_config

Common tables (14):
  users, posts, comments, categories, tags ... and 9 more

------------------------------------------------------------

Summary:
  Total tables in 'template': 15
  Total tables in 'tenant_acme': 16
  Common tables: 14
  Unique to 'template': 1
  Unique to 'tenant_acme': 2

Hints:
  To sync missing tables, run migrations on 'tenant_acme'
```

**Identical Schemas Output:**

```
Schema Comparison
============================================================

Schema Overview:

  template                       tenant_new
  ------------------------------ ------------------------------
  Tables: 15                     Tables: 15
  Size: 1.24 MB                  Size: 48 KB

Schemas have identical table structures

------------------------------------------------------------

Summary:
  Total tables in 'template': 15
  Total tables in 'tenant_new': 15
  Common tables: 15
  Unique to 'template': 0
  Unique to 'tenant_new': 0
```

---

## Multi-Tenant Workflow

### Initial Setup

1. **Create a template schema:**

   ```bash
   # Create template schema
   kysera schema create template

   # Run migrations in template
   kysera migrate up --schema template
   ```

2. **Provision new tenants:**

   ```bash
   # Clone template for new tenant
   kysera schema clone template --tenant acme

   # Or create and migrate separately
   kysera schema create --tenant acme
   kysera migrate up --schema tenant_acme
   ```

3. **Manage tenant schemas:**

   ```bash
   # List all tenant schemas
   kysera schema list --tenant

   # Check schema drift
   kysera schema compare template tenant_acme

   # Remove old tenant
   kysera schema drop tenant_old --cascade --force
   ```

### Schema Migration Strategy

When updating the database structure:

```bash
# 1. Update template first
kysera migrate up --schema template

# 2. Check differences with existing tenants
kysera schema compare template tenant_acme

# 3. Run migrations on each tenant
kysera migrate up --schema tenant_acme
kysera migrate up --schema tenant_globex
```

### Automated Tenant Provisioning

```bash
#!/bin/bash
TENANT_ID=$1

# Create tenant schema from template
kysera schema clone template --tenant "$TENANT_ID" --force

# Verify schema
kysera schema info "tenant_$TENANT_ID"

echo "Tenant $TENANT_ID provisioned successfully"
```

---

## Configuration

### Schema in Configuration File

You can set a default schema in `kysera.config.ts`:

```typescript
import { defineConfig } from '@kysera/cli'

export default defineConfig({
  database: {
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'myapp',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    schema: 'public'  // Default schema
  }
})
```

### Environment-Based Schema

```typescript
export default defineConfig({
  database: {
    // ...
    schema: process.env.DB_SCHEMA || 'public'
  }
})
```

---

## Related Documentation

- [PostgreSQL Schema Management](/docs/api/dialects#schema-management-methods) - Programmatic API
- [Multi-Tenant SaaS Example](/docs/examples/multi-tenant-saas) - Full example application
- [Migration Commands](/docs/cli/migrate) - Running migrations with `--schema`
- [Database Commands](/docs/cli/db) - Database utilities with schema support
