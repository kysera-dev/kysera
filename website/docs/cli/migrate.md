---
sidebar_position: 3
title: migrate
description: Database migration commands
---

# kysera migrate

Database migration management. This is the command group you'll live in day to day: create a migration file, apply it, check what state the database is in, and — when something went wrong — roll back, adopt, or verify. It is built directly on the [@kysera/migrations](/docs/api/migrations) runner, so an application using the library and the CLI share the same behavior and the same tracking table.

## Quick Reference

| Command    | Description                                                          |
| ---------- | -------------------------------------------------------------------- |
| `create`   | Create a new migration file                                           |
| `up`       | Run pending migrations                                                |
| `down`     | Rollback migrations (default: the most recent one)                    |
| `status`   | Show executed vs pending migrations                                   |
| `list`     | List all migrations                                                   |
| `baseline` | Mark migrations as executed without running them                      |
| `verify`   | Verify executed migrations match the files on disk (checksum drift)   |
| `reset`    | Rollback all migrations (dangerous!)                                  |
| `fresh`    | Drop all tables and re-run migrations (dangerous!)                    |

## How Runs Are Tracked and Locked

- **Tracking table** — executed migrations are recorded in the `migrations` table (configurable via `migrations.tableName`): `name` as primary key, `executed_at`, plus a nullable `checksum` column the CLI maintains for `verify`. The shape is compatible with tables created by `@kysera/migrations` directly (the checksum column is added in place) and with tables from older CLI versions (their extra columns keep being populated).
- **Advisory locks** — on PostgreSQL and MySQL, concurrent runs are serialized through a database advisory lock (SQLite is single-writer by nature). A second `kysera migrate up` waits up to `migrations.lockTimeout` (default 10s) and then fails with error code `MIGRATION_LOCKED` — it never runs interleaved. Disable with `migrations.lockTable: false` (unsafe).
- **Atomic bookkeeping** — each migration runs inside a transaction *together with* its tracking-table write, so a crash mid-run cannot leave an applied-but-unrecorded migration.
- **Read-only reads** — `status`, `list`, `verify`, and every `--dry-run` perform zero writes; they don't even create the tracking table.

## Migration Files

Files live in `migrations.directory` (default `./migrations`) and are named `YYYYMMDDHHMMSS_name.ts` — files are executed in filename order, and `.ts`, `.js`, and `.mjs` are all discovered. Every migration must export both `up` and `down`:

```typescript title="migrations/20260802140146_create_users.ts"
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('email', 'varchar(255)', col => col.notNull().unique())
    .addColumn('name', 'varchar(100)', col => col.notNull())
    .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('users').execute()
}
```

TypeScript migrations are imported directly — no build step. This relies on Node's type stripping (the CLI requires Node >= 22.18, where it is available; Bun works too), so keep migrations to erasable TypeScript syntax: type annotations are fine, enums and namespaces are not. Two files with the same basename (say, `.ts` and `.js` copies) are an error.

## create

Create a new migration file. The timestamp prefix is generated for you.

```bash
kysera migrate create add_users_table
```

**Options:**

| Option                  | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `-d, --dir <path>`      | Migration directory (default: `./migrations`)                 |
| `--directory <path>`    | Alias for `--dir`                                             |
| `-t, --template <type>` | Migration template (default: `default`)                       |
| `--ts` / `--no-ts`      | Generate TypeScript (default) or JavaScript                   |
| `--table <name>`        | Table name for table-based templates                          |
| `--columns <list>`      | Comma-separated column definitions (`name:type:nullable:default`) |
| `--json`                | Output `{ name, filename, path, template, timestamp }` as JSON |

:::note
`migrate create` only honors `--dir` for the output location — the `migrations.directory` config setting is not read by this subcommand. All other migrate commands honor the config.
:::

**Templates:** `default`, `create-table`, `alter-table`, `add-columns`, `drop-columns`, `create-index`, `drop-index`, `add-foreign-key`, `seed-data`. The `alter-table`, `add-columns`, `drop-columns`, and `add-foreign-key` templates require `--table`; `create-table` derives the table name from the migration name (`add_posts` → `posts`) when `--table` is omitted.

**Examples:**

```bash
# Empty up/down skeleton
kysera migrate create add_users_table

# Create-table skeleton with columns
kysera migrate create create_posts --template create-table --table posts \
  --columns "title:varchar(255),body:text:nullable,views:integer::0"

# JavaScript migration
kysera migrate create add_flags --no-ts
```

## up

Run pending migrations, oldest first.

```bash
kysera migrate up
```

**Options:**

| Option                 | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `-t, --to <migration>` | Migrate up to a specific migration (inclusive)        |
| `--steps <number>`     | Number of migrations to run                           |
| `--count <number>`     | Alias for `--steps`                                   |
| `--dry-run`            | Show the execution plan without touching the database |
| `-v, --verbose`        | Show detailed output                                  |
| `-c, --config <path>`  | Path to configuration file                            |
| `--json`               | Output results as JSON                                |
| `-s, --schema <name>`  | PostgreSQL schema name (default: `public`)             |

**Examples:**

```bash
# Run everything pending
kysera migrate up

# Only the next two
kysera migrate up --steps 2

# Everything up to and including a target
kysera migrate up --to 20260802140146_add_posts

# See the plan first
kysera migrate up --dry-run
```

Progress goes to stderr, one line per migration:

```
Running migrations
↑ 20260802140146_add_posts ✓ (85ms)
↑ 20260802140146_add_users ✓ (5ms)

[OK] 2 migrations completed successfully (90ms)
```

**JSON shapes** — a real run emits `{ executed, count, duration, dryRun: false }`; a dry run emits the plan:

```bash
$ kysera migrate up --dry-run --json
{
  "dryRun": true,
  "count": 2,
  "plan": [
    { "name": "20260802140146_add_posts", "path": "/work/my-app/migrations/20260802140146_add_posts.ts" },
    { "name": "20260802140146_add_users", "path": "/work/my-app/migrations/20260802140146_add_users.ts" }
  ],
  "table": "migrations",
  "dialect": "postgres"
}
```

If a migration fails, the run stops there (already-applied migrations stay applied — each runs in its own transaction) and the error lists exactly which migrations were applied before the failure and which remain, plus the failing file path.

:::note `up --force` is gone
Older CLI versions had an `up --force` flag; the rebuilt runner has no force mode for `up` — fix the failing migration and re-run.
:::

## down

Rollback migrations, newest first. **By default only the single most recent migration is rolled back.**

```bash
kysera migrate down
```

**Options:**

| Option                 | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `--steps <number>`     | Number of migrations to rollback                      |
| `--count <number>`     | Alias for `--steps`                                   |
| `-t, --to <migration>` | Rollback everything *after* the given migration       |
| `--all`                | Rollback all migrations                               |
| `--dry-run`            | Show the rollback plan without touching the database  |
| `-v, --verbose`        | Show detailed output                                  |
| `-c, --config <path>`  | Path to configuration file                            |
| `--force`              | Skip confirmation prompt (used by `--all`)             |
| `--json`               | Output results as JSON                                |
| `-s, --schema <name>`  | PostgreSQL schema name (default: `public`)             |

**Examples:**

```bash
# Rollback the most recent migration (no prompt)
kysera migrate down

# Rollback the last three
kysera migrate down --steps 3

# Rollback everything applied after a target (the target itself stays)
kysera migrate down --to 20260802140146_add_posts

# Rollback everything — prompts in a terminal, requires --force headless
kysera migrate down --all --force

# Preview
kysera migrate down --dry-run
```

**JSON shapes** — `{ rolledBack, count, duration, dryRun: false }` for a real run; a dry run has the same `{ dryRun: true, count, plan, table, dialect }` shape as `up --dry-run --json`.

:::warning Rollback semantics
- `down` with no options rolls back exactly **one** migration — and does so without a confirmation prompt. Use `--dry-run` first if you're unsure what's on top.
- `--to <name>` rolls back everything executed *after* `<name>`, leaving `<name>` itself applied.
- `--all` is guarded: it prompts on a TTY and **fails** in CI/pipes/JSON mode unless `--force` is given — destructive operations never auto-proceed.
- If a recorded migration's file has been deleted, `down` refuses (`FILE_NOT_FOUND`) rather than silently skipping it and leaving schema and bookkeeping out of sync. Restore the file, or adopt the current state with `baseline`.
:::

## status

Show executed vs pending migrations. Read-only.

```bash
kysera migrate status
```

**Options:**

| Option                | Description                                   |
| --------------------- | --------------------------------------------- |
| `--json`              | Output as JSON                                 |
| `-v, --verbose`       | Show dialect/schema/directory/table details    |
| `-c, --config <path>` | Path to configuration file                     |
| `-s, --schema <name>` | PostgreSQL schema name (default: `public`)      |

Text output lists executed migrations (with timestamps, flagging any whose file has disappeared) and pending ones. The JSON shape is stable for CI consumers:

```bash
$ kysera migrate status --json
{
  "total": 2,
  "executed": [
    {
      "name": "20260802140146_add_posts",
      "executedAt": "2026-08-02T08:01:47.000Z",
      "checksum": "818423de0f33a778218558a64d0524c3e95193aa..."
    }
  ],
  "pending": [
    { "name": "20260802150000_add_comments", "path": "/work/my-app/migrations/20260802150000_add_comments.ts" }
  ],
  "table": "migrations",
  "dialect": "postgres"
}
```

With `--verbose --json` a `database` object is added (dialect, schema, connection) — the connection string is always credential-redacted.

## list

List migrations, optionally filtered. Read-only; works without a reachable database when the migrations directory doesn't exist yet (emits `[]`).

```bash
kysera migrate list
```

**Options:**

| Option                | Description                               |
| --------------------- | ----------------------------------------- |
| `--pending`           | Show only pending migrations               |
| `--executed`          | Show only executed migrations              |
| `--json`              | Output as JSON                             |
| `-c, --config <path>` | Path to configuration file                 |
| `-s, --schema <name>` | PostgreSQL schema name (default: `public`)  |

`list --json` is a flat **array** — one entry per migration:

```bash
$ kysera migrate list --json
[
  {
    "name": "20260802140146_add_posts",
    "timestamp": "20260802140146",
    "status": "executed",
    "executedAt": "2026-08-02T08:01:47.000Z",
    "path": "/work/my-app/migrations/20260802140146_add_posts.ts"
  }
]
```

## baseline

Mark migrations as executed **without running them** — for adopting a schema that already exists (created by hand, by another tool, or by a database restore).

```bash
kysera migrate baseline <names...>
kysera migrate baseline --all
```

**Options:**

| Option                | Description                               |
| --------------------- | ----------------------------------------- |
| `--all`               | Baseline every pending migration           |
| `-v, --verbose`       | Show detailed output                       |
| `-c, --config <path>` | Path to configuration file                 |
| `--json`              | Output results as JSON                     |
| `-s, --schema <name>` | PostgreSQL schema name (default: `public`)  |

Already-executed names are skipped (reported, not an error); unknown names fail with the list of available migrations. JSON shape: `{ marked, skipped, count, table, dialect }`.

**Typical flow — adopting an existing database:**

```bash
# The schema already matches migrations 1..N; record that fact:
kysera migrate baseline --all

# From here on, only new migrations actually run:
kysera migrate up
```

## verify

Compare executed migrations against the files on disk using the SHA-256 checksums recorded at execution time. This is your guard against history rewrites: a migration edited *after* it ran means the file no longer describes what the database went through.

```bash
kysera migrate verify
```

**Options:**

| Option                | Description                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `--update`            | Store current file checksums for executed records that have none   |
| `-v, --verbose`       | Show detailed output                                               |
| `-c, --config <path>` | Path to configuration file                                         |
| `--json`              | Output results as JSON                                             |
| `-s, --schema <name>` | PostgreSQL schema name (default: `public`)                          |

Three kinds of findings:

| Kind               | Meaning                                                        | Fails the check |
| ------------------ | --------------------------------------------------------------- | --------------- |
| `modified`         | File content differs from the checksum recorded at execution    | Yes             |
| `missing_file`     | An executed migration's file is gone                             | Yes             |
| `unknown_checksum` | Record predates checksums (older CLI, or written by the library) | No (warn only)  |

On drift, the command exits `1` with error code `MIGRATION_DRIFT`. Records without checksums can adopt the current file hashes via `--update` (existing mismatching checksums are never overwritten).

```bash
$ kysera migrate verify --json
{
  "ok": true,
  "checked": 2,
  "pending": 0,
  "adopted": [],
  "issues": [],
  "table": "migrations",
  "dialect": "postgres"
}
```

## reset

Rollback **all** migrations. Optionally re-run and re-seed afterwards.

```bash
kysera migrate reset --force
```

**Options:**

| Option                | Description                               |
| --------------------- | ----------------------------------------- |
| `--force`             | Skip confirmation prompt                   |
| `--run`               | Re-run migrations after reset              |
| `--seed`              | Run seeds after reset                      |
| `-c, --config <path>` | Path to configuration file                 |
| `-v, --verbose`       | Show detailed output                       |
| `--json`              | Output results as JSON                     |
| `-s, --schema <name>` | PostgreSQL schema name (default: `public`)  |

## fresh

Drop **all tables** in the schema (not just migrated ones), then run every migration from scratch.

```bash
kysera migrate fresh --force
```

**Options:**

| Option                | Description                               |
| --------------------- | ----------------------------------------- |
| `--seed`              | Run seeds after migration                  |
| `--force`             | Skip confirmation prompt                   |
| `-c, --config <path>` | Path to configuration file                 |
| `-v, --verbose`       | Show detailed output                       |
| `--json`              | Output results as JSON                     |
| `-s, --schema <name>` | PostgreSQL schema name (default: `public`)  |

:::danger reset and fresh destroy data
`reset` runs every `down()` in reverse order; `fresh` drops every table in the target schema (CASCADE on PostgreSQL) including ones no migration created. Both prompt for confirmation on a TTY and **fail without `--force`** when headless. Take a backup first (`kysera db dump -o backup.sql`).
:::

## CI Recipes

```bash
# Fail the pipeline when migrations are pending
test "$(kysera migrate status --json | jq '.pending | length')" -eq 0

# Detect migration-history tampering
kysera migrate verify        # exits 1 on drift

# Review what a deploy would do
kysera migrate up --dry-run --json | jq -r '.plan[].name'

# Apply, with machine-readable result
kysera migrate up --json
```

Concurrent deploy jobs are safe on PostgreSQL/MySQL: the advisory lock makes the second runner wait, then fail with `MIGRATION_LOCKED` (also present as `error.code` in `--json` mode on stderr) if the first is still going after `migrations.lockTimeout`.

## Multi-Tenant Schemas

Every subcommand accepts `-s, --schema <name>` to operate on a PostgreSQL schema other than `public` — each schema gets its own tracking table. Precedence: `--schema` flag > `migrations.schema` > `database.schema` > `public`. See [schema](/docs/cli/schema) for provisioning tenant schemas.

```bash
kysera migrate up --schema tenant_acme
kysera migrate status --schema tenant_acme --json
```

## See Also

- [@kysera/migrations](/docs/api/migrations) — the library runner the CLI is built on
- [db](/docs/cli/db) — dump/restore around destructive operations
- [doctor](/docs/cli/doctor) — includes a migration-state check
- [Configuration](/docs/cli/configuration) — `migrations.*` settings
