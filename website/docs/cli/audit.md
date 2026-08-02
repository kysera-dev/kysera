---
sidebar_position: 12
title: audit
description: Audit logging and history tracking
---

# kysera audit

Audit logging and history tracking commands for viewing, managing, and analyzing audit logs.

## Commands

| Command   | Description                                        |
| --------- | -------------------------------------------------- |
| `init`    | Generate a migration that creates the audit table  |
| `logs`    | Query audit logs with filters                      |
| `history` | Show entity history timeline                       |
| `restore` | Restore entity from audit log                      |
| `stats`   | Audit log statistics                               |
| `cleanup` | Clean up old audit logs                            |
| `compare` | Compare entity versions                            |
| `diff`    | Show differences between versions                  |

## init

Generate a migration that creates the audit log table — the schema-managed alternative to letting [@kysera/audit](/docs/plugins/audit) auto-create the table on first use.

```bash
kysera audit init
```

### Options

| Option                | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `--table <name>`      | Audit table name (default: from config or `audit_logs`)       |
| `--dialect-ddl`       | Emit dialect-tuned DDL instead of the plugin's portable schema |
| `-d, --dir <path>`    | Migrations directory (default: from configuration)             |
| `-c, --config <path>` | Path to configuration file                                     |

### Portable vs Dialect-Tuned DDL

By default the migration matches the **portable** schema the plugin auto-creates: `TEXT` columns everywhere, JSON payloads stored as serialized text, `changed_at` as an ISO-8601 string. That works identically on PostgreSQL, MySQL, and SQLite.

`--dialect-ddl` trades portability for queryability on the configured dialect:

| Dialect    | Tuned types                                             | Extras                                                        |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| PostgreSQL | `JSONB` payloads, `TIMESTAMPTZ`, `IDENTITY` primary key   | Indexes on `(table_name, entity_id)` and `changed_at`          |
| MySQL      | `JSON` payloads, `DATETIME(3)`, `AUTO_INCREMENT`          | Same indexes                                                   |
| SQLite     | Portable types (TEXT is native anyway)                    | Same indexes                                                   |

The plugin writes the same values either way (JSON strings and ISO timestamps are coerced by the database) — but a dialect-tuned migration is tied to that dialect. `--dialect-ddl` requires `database.dialect` in your configuration.

### Example

```bash
$ kysera audit init
Migration created: 20260802140538_create_audit_logs.ts
  /work/my-app/migrations/20260802140538_create_audit_logs.ts
Run 'kysera migrate up' to create the 'audit_logs' table
```

The command respects global `--dry-run` (reports without writing) and global `--json` (emits `{ file, table, mode, dialect }`, where `mode` is `"portable"` or `"dialect"`). It refuses to overwrite an existing migration file of the same name.

## logs

Query audit logs with flexible filtering options.

```bash
kysera audit logs [options]
```

### Options

| Option                   | Description                                 |
| ------------------------ | ------------------------------------------- |
| `-t, --table <name>`     | Filter by table name                        |
| `-u, --user <id>`        | Filter by user ID                           |
| `-a, --action <type>`    | Filter by action: INSERT, UPDATE, DELETE    |
| `-l, --limit <n>`        | Limit number of results (default: 50)       |
| `--since <datetime>`     | Show logs since datetime (ISO 8601)         |
| `--until <datetime>`     | Show logs until datetime (ISO 8601)         |
| `-e, --entity-id <id>`   | Filter by entity ID                         |
| `--json`                 | Output as JSON                              |
| `-v, --verbose`          | Show detailed information including changes |
| `-c, --config <path>`    | Path to configuration file                  |
| `-s, --schema <name>`    | PostgreSQL schema name (default: public)    |

### Examples

```bash
# View recent audit logs
kysera audit logs

# Filter by table
kysera audit logs --table users

# Filter by action type
kysera audit logs --action UPDATE

# Filter by user
kysera audit logs --user "admin-123"

# Filter by time range
kysera audit logs --since "2025-01-01T00:00:00" --until "2025-01-31T23:59:59"

# Filter by entity
kysera audit logs --table orders --entity-id "order-456"

# Verbose output with change details
kysera audit logs --table users --verbose

# Output as JSON
kysera audit logs --json
```

### Output

**Table View (default):**

| ID  | Time             | Table  | Action | Entity  | User   | Changes |
| --- | ---------------- | ------ | ------ | ------- | ------ | ------- |
| 123 | 2025-01-15 10:00 | users  | ~      | user-1  | admin  | 3       |
| 122 | 2025-01-15 09:45 | orders | +      | order-5 | system | -       |

Action symbols:

- `+` INSERT (green)
- `~` UPDATE (yellow)
- `-` DELETE (red)

**Verbose View (with `--verbose`):**

```
Audit Log #123
--------------------------------------------------
  Timestamp: 2025-01-15 10:00:00
  Table: users
  Action: UPDATE
  Entity ID: user-1
  User: admin

  Changes:
      email: "old@example.com" -> "new@example.com"
      name: "Old Name" -> "New Name"
      updated_at: 2025-01-14... -> 2025-01-15...
```

## history

Show the complete history timeline for a specific entity.

```bash
kysera audit history <table> <id> [options]
```

### Arguments

| Argument | Description |
| -------- | ----------- |
| `table`  | Table name  |
| `id`     | Entity ID   |

### Options

| Option                | Description                               |
| --------------------- | ----------------------------------------- |
| `-l, --limit <n>`     | Limit number of results (default: 20)     |
| `--show-values`       | Show changed values                       |
| `--json`              | Output as JSON                            |
| `--reverse`           | Show oldest first (default: newest first) |
| `-c, --config <path>` | Path to configuration file                |
| `-s, --schema <name>` | PostgreSQL schema name (default: public)  |

### Examples

```bash
# View entity history
kysera audit history users user-123

# Show with change details
kysera audit history users user-123 --show-values

# Show more history
kysera audit history orders order-456 --limit 50

# Chronological order
kysera audit history users user-123 --reverse
```

### Output

```
Entity History: users #user-123

Current State
  {"id": "user-123", "email": "current@example.com", ...}

|- 2025-01-15 10:00:00 | UPDATE | admin
|   Audit #123
|   Changed fields:
|     email: "old@example.com" -> "current@example.com"
|
|- 2025-01-10 14:30:00 | UPDATE | system
|   Audit #120
|   Changed fields:
|     last_login: NULL -> 2025-01-10...
|
+- 2025-01-01 09:00:00 | INSERT | admin
    Audit #100
    Created with:
      id: "user-123"
      email: "original@example.com"
      ...

--------------------------------------------------
Summary:
  Total Changes: 3
  Time Span: 14 days, 1 hours
  Actions: INSERT (1), UPDATE (2)
  Top Users: admin (2), system (1)
```

## restore

Restore an entity to a previous state from audit log.

```bash
kysera audit restore <audit-id> [options]
```

### Arguments

| Argument   | Description                  |
| ---------- | ---------------------------- |
| `audit-id` | Audit log ID to restore from |

### Options

| Option                | Description                       |
| --------------------- | --------------------------------- |
| `--dry-run`           | Preview restore without executing |
| `--force`             | Skip confirmation prompt          |
| `--json`              | Output as JSON                    |
| `-c, --config <path>` | Path to configuration file        |

### Examples

```bash
# Preview restore
kysera audit restore 123 --dry-run

# Restore with confirmation
kysera audit restore 123

# Force restore without confirmation
kysera audit restore 123 --force
```

### Output

```
Restoring from Audit Log #123

Table: users
Entity ID: user-123
Restore Point: 2025-01-15 10:00:00

Changes to apply:
  email: "current@example.com" -> "old@example.com"
  name: "Current Name" -> "Old Name"

? Proceed with restore? (y/N)
```

## stats

Show audit log statistics and insights.

```bash
kysera audit stats [options]
```

### Options

| Option                    | Description                                        |
| ------------------------- | -------------------------------------------------- |
| `-t, --table <name>`      | Filter statistics by table name                    |
| `-u, --user <id>`         | Filter statistics by user ID                       |
| `-p, --period <duration>` | Time period: 1h, 1d, 1w, 1m (default: 1d)          |
| `-f, --format <type>`     | Output format: table, json, chart (default: table) |
| `-c, --config <path>`     | Path to configuration file                         |

### Examples

```bash
# Overall statistics for last day
kysera audit stats

# Statistics for last week
kysera audit stats --period 1w

# Statistics for specific table
kysera audit stats --table users

# Statistics for specific user
kysera audit stats --user "admin-123"

# Output as JSON
kysera audit stats --format json

# Statistics for last month as chart
kysera audit stats --period 1m --format chart
```

### Output

```
Audit Log Statistics
──────────────────────────────────────────────────

Time Range: 2025-01-01 to 2025-01-15

Total Entries: 15,432

By Action:
  INSERT: 5,234 (33.9%)
  UPDATE: 8,456 (54.8%)
  DELETE: 1,742 (11.3%)

By Table:
  orders:    8,234 (53.4%)
  users:     4,567 (29.6%)
  products:  2,631 (17.0%)

By User:
  system:    9,000 (58.3%)
  admin:     4,432 (28.7%)
  api-user:  2,000 (13.0%)

Peak Activity:
  Day: Monday (3,456 entries)
  Hour: 14:00-15:00 (1,234 entries)

Storage:
  Total Size: 45.2 MB
  Avg Entry Size: 2.9 KB
```

## cleanup

Clean up old audit logs to manage storage.

```bash
kysera audit cleanup [options]
```

### Options

| Option                    | Description                                   |
| ------------------------- | --------------------------------------------- |
| `--older-than <duration>` | Delete logs older than duration (30d, 3m, 1y) |
| `-t, --table <name>`      | Clean specific table only                     |
| `--dry-run`               | Preview cleanup without deleting              |
| `--force`                 | Skip confirmation prompt                      |
| `--batch-size <n>`        | Delete in batches (default: 1000)             |
| `-c, --config <path>`     | Path to configuration file                    |

### Examples

```bash
# Preview cleanup of logs older than 90 days
kysera audit cleanup --older-than 90d --dry-run

# Clean logs older than 3 months
kysera audit cleanup --older-than 3m

# Clean specific table
kysera audit cleanup --table users --older-than 30d

# Force cleanup without confirmation
kysera audit cleanup --older-than 90d --force

# Cleanup in smaller batches
kysera audit cleanup --older-than 1y --batch-size 500
```

### Output

```
Audit Log Cleanup Preview
──────────────────────────────────────────────────

Criteria: Logs older than 90 days (before 2024-10-15)

Entries to delete:
  users:    2,345 entries
  orders:   5,678 entries
  products: 1,234 entries

  Total: 9,257 entries
  Storage freed: ~26.8 MB

? Proceed with cleanup? (y/N)
```

## compare

Compare two versions of an entity.

```bash
kysera audit compare <id1> <id2> [options]
```

### Arguments

| Argument | Description         |
| -------- | ------------------- |
| `id1`    | First audit log ID  |
| `id2`    | Second audit log ID |

### Options

| Option                | Description                |
| --------------------- | -------------------------- |
| `--json`              | Output as JSON             |
| `--show-values`       | Show full field values     |
| `-c, --config <path>` | Path to configuration file |

### Examples

```bash
# Compare two audit entries
kysera audit compare 100 123

# Compare with full values
kysera audit compare 100 123 --show-values

# Output as JSON
kysera audit compare 100 123 --json
```

## diff

Show differences between entity versions.

```bash
kysera audit diff <table> <id> [from] [to] [options]
```

### Arguments

| Argument | Description                                               |
| -------- | --------------------------------------------------------- |
| `table`  | Table name                                                |
| `id`     | Entity ID                                                 |
| `from`   | From audit log ID or timestamp (optional)                 |
| `to`     | To audit log ID or timestamp (optional, default: current) |

### Options

| Option                | Description                |
| --------------------- | -------------------------- |
| `--json`              | Output as JSON             |
| `-u, --unified`       | Show unified diff format   |
| `--no-color`          | Disable colored output     |
| `-c, --config <path>` | Path to configuration file |

### Examples

```bash
# Diff from specific audit to current
kysera audit diff users user-123 100

# Diff between two versions
kysera audit diff users user-123 100 123

# Unified diff format
kysera audit diff users user-123 100 --unified

# Output as JSON
kysera audit diff users user-123 100 123 --json
```

## Requirements

The query commands (`logs`, `history`, `restore`, `stats`, `cleanup`, `compare`, `diff`) work against the table `@kysera/audit` writes — columns `operation`, `changed_by`, and `changed_at`, with JSON payloads stored as text — on **PostgreSQL, MySQL, and SQLite** (existence is checked via database introspection, not `information_schema`). The table name follows `plugins.audit.auditTable` from your configuration (default `audit_logs`). If the table is missing you'll see a short setup hint instead of an error.

To set the table up, generate and run the migration:

```bash
kysera audit init
kysera migrate up
```

:::note Audit tables from Kysera versions before 0.9
Very old audit tables used the columns `action`, `user_id`, and `created_at`. The query commands now speak the current plugin schema (`operation` / `changed_by` / `changed_at`); against a pre-0.9 legacy table they will fail with unknown-column errors. Migrate such tables by renaming the columns (e.g. `ALTER TABLE audit_logs RENAME COLUMN action TO operation`, and likewise `user_id` → `changed_by`, `created_at` → `changed_at`).
:::

## See Also

- [@kysera/audit](/docs/plugins/audit) - Audit plugin configuration
- [History Commands](/docs/cli/query) - Query by timestamp
- [Debug Commands](/docs/cli/debug) - Error analysis
