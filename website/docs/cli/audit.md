---
sidebar_position: 12
title: audit
description: Audit logging and history tracking
---

# kysera audit

Audit logging and history tracking commands for viewing, managing, and analyzing audit logs.

## Commands

| Command | Description |
|---------|-------------|
| `logs` | Query audit logs with filters |
| `history` | Show entity history timeline |
| `restore` | Restore entity from audit log |
| `stats` | Audit log statistics |
| `cleanup` | Clean up old audit logs |
| `compare` | Compare entity versions |
| `diff` | Show differences between versions |

## logs

Query audit logs with flexible filtering options.

```bash
kysera audit logs [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-t, --table <name>` | Filter by table name |
| `-u, --user <id>` | Filter by user ID |
| `-a, --action <type>` | Filter by action: INSERT, UPDATE, DELETE |
| `-l, --limit <n>` | Limit number of results (default: 50) |
| `-s, --since <datetime>` | Show logs since datetime (ISO 8601) |
| `--until <datetime>` | Show logs until datetime (ISO 8601) |
| `-e, --entity-id <id>` | Filter by entity ID |
| `--json` | Output as JSON |
| `-v, --verbose` | Show detailed information including changes |
| `-c, --config <path>` | Path to configuration file |

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

| ID | Time | Table | Action | Entity | User | Changes |
|----|------|-------|--------|--------|------|---------|
| 123 | 2025-01-15 10:00 | users | ~ | user-1 | admin | 3 |
| 122 | 2025-01-15 09:45 | orders | + | order-5 | system | - |

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
|----------|-------------|
| `table` | Table name |
| `id` | Entity ID |

### Options

| Option | Description |
|--------|-------------|
| `-l, --limit <n>` | Limit number of results (default: 20) |
| `--show-values` | Show changed values |
| `--json` | Output as JSON |
| `--reverse` | Show oldest first (default: newest first) |
| `-c, --config <path>` | Path to configuration file |

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

| Argument | Description |
|----------|-------------|
| `audit-id` | Audit log ID to restore from |

### Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview restore without executing |
| `--force` | Skip confirmation prompt |
| `-c, --config <path>` | Path to configuration file |

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

| Option | Description |
|--------|-------------|
| `--since <datetime>` | Statistics since datetime |
| `--until <datetime>` | Statistics until datetime |
| `-t, --table <name>` | Statistics for specific table |
| `--json` | Output as JSON |
| `-c, --config <path>` | Path to configuration file |

### Examples

```bash
# Overall statistics
kysera audit stats

# Statistics for last 30 days
kysera audit stats --since "2024-12-15"

# Statistics for specific table
kysera audit stats --table users
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

| Option | Description |
|--------|-------------|
| `--before <datetime>` | Delete logs before datetime |
| `--keep-days <n>` | Keep logs from last N days |
| `-t, --table <name>` | Clean specific table only |
| `--dry-run` | Preview without deleting |
| `--force` | Skip confirmation |
| `-c, --config <path>` | Path to configuration file |

### Examples

```bash
# Preview cleanup of logs older than 90 days
kysera audit cleanup --keep-days 90 --dry-run

# Clean logs before a specific date
kysera audit cleanup --before "2024-01-01"

# Clean specific table
kysera audit cleanup --table users --keep-days 30

# Force cleanup
kysera audit cleanup --keep-days 90 --force
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
kysera audit compare <audit-id-1> <audit-id-2> [options]
```

### Examples

```bash
# Compare two audit entries
kysera audit compare 100 123
```

## diff

Show differences between entity versions.

```bash
kysera audit diff <table> <id> [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--from <audit-id>` | Starting version |
| `--to <audit-id>` | Ending version (default: current) |

### Examples

```bash
# Diff from specific audit to current
kysera audit diff users user-123 --from 100

# Diff between two versions
kysera audit diff users user-123 --from 100 --to 123
```

## Requirements

Audit commands require the `audit_logs` table. If not present, you'll see:

```
The audit_logs table does not exist.
To enable audit logging:
  1. Install @kysera/audit package
  2. Run: kysera migrate create create_audit_logs
  3. Add audit plugin to your repositories
```

### Audit Table Schema

```sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(255) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  action VARCHAR(10) NOT NULL,
  user_id VARCHAR(255),
  old_values JSONB,
  new_values JSONB,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
```

## See Also

- [@kysera/audit](/docs/plugins/audit) - Audit plugin configuration
- [History Commands](/docs/cli/query) - Query by timestamp
- [Debug Commands](/docs/cli/debug) - Error analysis
