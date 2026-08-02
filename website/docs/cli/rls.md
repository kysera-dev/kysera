---
sidebar_position: 13
title: rls
description: Generate native PostgreSQL Row-Level Security policies
---

# kysera rls

Row-Level Security utilities for native PostgreSQL policies. When you define policies with `defineRLSSchema` from [@kysera/rls](/docs/plugins/rls), the plugin can enforce them in the ORM layer — but PostgreSQL can also enforce them in the database itself with `CREATE POLICY`. These commands translate your RLS schema module into that native SQL: `rls generate` prints (or writes) the raw statements, `rls migration` wraps them in a ready-to-run Kysely migration.

Neither command connects to the database — they only load your configuration (to confirm the dialect is PostgreSQL) and your schema module.

## Quick Reference

| Command                        | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `rls generate <schema-module>` | Generate native PostgreSQL RLS statements from an RLS schema module |
| `rls migration <schema-module>`| Generate a Kysely migration file applying the policies              |

:::warning PostgreSQL only
Native RLS targets PostgreSQL's row security features. With any other configured dialect both commands fail up front (`RLS_DIALECT_ERROR`). For MySQL and SQLite, use the ORM-level `rlsPlugin()` from `@kysera/rls` instead.
:::

## The Schema Module

Both commands take a path to a module that default-exports the result of `defineRLSSchema(...)` (named exports `rlsSchema` or `schema` are accepted as fallbacks). Only policies carrying native SQL in `using` and/or `withCheck` become `CREATE POLICY` statements — ORM-only policies (`filter`/`validate`, or function conditions without SQL) are skipped with a note.

```typescript title="rls/schema.ts"
import { defineRLSSchema } from '@kysera/rls'

export default defineRLSSchema({
  posts: {
    policies: [
      {
        type: 'allow',
        operation: 'read',
        role: 'app_user',
        condition: '', // ORM-side rule; empty string for native-only policies
        using: "tenant_id = current_setting('app.tenant_id')::uuid"
      },
      {
        type: 'allow',
        operation: 'create',
        role: 'app_user',
        condition: '',
        withCheck: "tenant_id = current_setting('app.tenant_id')::uuid"
      }
    ]
  }
})
```

:::tip `condition` is required
`defineRLSSchema` validates every policy and requires a `condition` (the rule the ORM plugin evaluates — a function or string). For policies that only exist as native SQL, pass `condition: ''` and put the SQL in `using`/`withCheck`.
:::

Module loading rules:

- Compiled `.js`/`.mjs`/`.cjs` modules always load.
- `.ts`/`.mts` modules load when the runtime can import TypeScript — Node.js >= 22.18 (erasable-syntax type stripping) or Bun. Since the CLI itself requires Node >= 22.18, plain type-annotated modules work out of the box; modules using non-erasable syntax (enums, namespaces) must be compiled first.
- The module's own imports must resolve — `@kysera/rls` has to be installed in your project.

## rls generate

Print the native SQL to stdout, or write it to a file.

```bash
kysera rls generate ./rls/schema.ts
```

### Options

| Option                     | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `-o, --output <file>`      | Write SQL to a file instead of stdout                                 |
| `--drop`                   | Generate DROP/DISABLE statements instead of CREATE/ENABLE             |
| `--functions`              | Prepend the RLS context helper functions (`rls_current_user_id`, ...) |
| `-s, --schema <name>`      | PostgreSQL schema name (default: `public`)                            |
| `--policy-prefix <prefix>` | Prefix for generated policy names (default: `rls`)                    |
| `--no-force`               | Skip `FORCE ROW LEVEL SECURITY` (table owners bypass RLS)              |
| `--json`                   | Output `{ statements: [...] }` as JSON                                 |
| `-c, --config <path>`      | Path to configuration file                                             |

### Example

```bash
$ kysera rls generate ./rls/schema.ts
ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."posts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "rls_posts_allow_0"
  ON "public"."posts"
  AS PERMISSIVE
  TO "app_user"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY "rls_posts_allow_1"
  ON "public"."posts"
  AS PERMISSIVE
  TO "app_user"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

Policy names follow `<prefix>_<table>_<type>_<index>` unless a policy sets its own `name`.

Rolling back is symmetric — `--drop` emits a `DO $$` block that drops every policy matching the prefix on each table, then disables row security:

```bash
kysera rls generate ./rls/schema.ts --drop -o drop-rls.sql
```

`--functions` prepends the `STABLE` SQL helper functions the policies can build on (`rls_current_user_id()`, `rls_current_tenant_id()`, `rls_current_roles()`, `rls_has_role()`, `rls_current_permissions()`, `rls_has_permission()`), each reading an `app.*` session variable. It cannot be combined with `--drop`.

With `-o/--output`, the target directory is created as needed and a summary goes to stdout; global `--dry-run` reports what would be written without touching the file.

:::warning FORCE is on by default
Generated SQL includes `FORCE ROW LEVEL SECURITY`, so even the table owner is subject to the policies. Pass `--no-force` if your application connects as the owning role and must bypass RLS — and understand what that means for enforcement.
:::

## rls migration

Generate a Kysely migration file instead of raw SQL — the same statements wrapped in `up()`/`down()`, written into your migrations directory alongside your other migrations.

```bash
kysera rls migration ./rls/schema.ts
```

### Options

| Option                     | Description                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| `-d, --dir <path>`         | Migrations directory (default: from configuration)                |
| `-n, --name <name>`        | Migration name (default: `rls_policies`)                          |
| `-s, --schema <name>`      | PostgreSQL schema name (default: `public`)                        |
| `--policy-prefix <prefix>` | Prefix for generated policy names (default: `rls`)                |
| `--no-force`               | Skip `FORCE ROW LEVEL SECURITY` (table owners bypass RLS)          |
| `--no-functions`           | Omit the RLS context helper functions from the migration           |
| `-c, --config <path>`      | Path to configuration file                                         |

### Example

```bash
$ kysera rls migration ./rls/schema.ts -n enable_rls
Migration created: 20260802140351_enable_rls.ts
  /work/my-app/migrations/20260802140351_enable_rls.ts
Run 'kysera migrate up' to apply the RLS policies
```

The file is named `<timestamp>_<name>.ts`, matching `kysera migrate create` filenames, so [`kysera migrate up`](/docs/cli/migrate) picks it up in order. Its `up()` creates the context functions (unless `--no-functions`), enables row security, and creates the policies; `down()` drops them again. If a file with the same name already exists the command fails rather than overwriting; global `--dry-run` previews without writing.

Note the defaults differ deliberately: `rls generate` omits the helper functions unless you pass `--functions`, while `rls migration` includes them unless you pass `--no-functions` — a migration should be self-contained.

## Typical Workflow

```bash
# 1. Define policies once, in code
#    (rls/schema.ts default-exporting defineRLSSchema({...}))

# 2. Emit a migration and apply it
kysera rls migration ./rls/schema.ts -n enable_rls
kysera migrate up

# 3. In the application, set the session variables the policies read
#    (app.tenant_id etc.) — the @kysera/rls plugin does this for you
#    when configured with the same schema.
```

## See Also

- [@kysera/rls plugin](/docs/plugins/rls) — ORM-level enforcement of the same schema, and how session context is set
- [migrate](/docs/cli/migrate) — applying the generated migration
- [schema](/docs/cli/schema) — multi-tenant schema-per-tenant management, an alternative isolation strategy
