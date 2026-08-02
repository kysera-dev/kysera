---
sidebar_position: 9
title: query
description: Database query utilities and tools
---

# kysera query

Database query utilities for timestamp-based queries, soft-deleted records, and query analysis.

## Commands

| Command        | Description                       |
| -------------- | --------------------------------- |
| `by-timestamp` | Query records by timestamp ranges |
| `soft-deleted` | Manage soft-deleted records       |
| `analyze`      | Analyze query performance         |
| `explain`      | Show query execution plan         |

## by-timestamp

Query records by timestamp with flexible date ranges.

```bash
kysera query by-timestamp [options]
```

### Options

| Option                | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `-t, --table <name>`  | Table name to query (required)                         |
| `-c, --column <name>` | Timestamp column name (default: created_at)            |
| `--from <date>`       | Start date (ISO format)                                |
| `--to <date>`         | End date (ISO format)                                  |
| `--last <duration>`   | Last N hours/days/weeks/months (e.g., 24h, 7d, 2w, 1m) |
| `--order <dir>`       | Sort order: asc or desc (default: desc)                |
| `-l, --limit <n>`     | Limit results (default: 100)                           |
| `--json`              | Output as JSON                                         |
| `--config <path>`     | Path to configuration file                             |

### Duration Format

The `--last` option accepts these formats:

- `Nh` - Last N hours (e.g., `24h`)
- `Nd` - Last N days (e.g., `7d`)
- `Nw` - Last N weeks (e.g., `2w`)
- `Nm` - Last N months (e.g., `1m`)

### Examples

```bash
# Query users created in the last 24 hours
kysera query by-timestamp --table users --last 24h

# Query orders from last 7 days
kysera query by-timestamp --table orders --last 7d

# Query with specific date range
kysera query by-timestamp --table posts \
  --from "2025-01-01" \
  --to "2025-01-31"

# Query by updated_at column
kysera query by-timestamp --table products \
  --column updated_at \
  --last 1w

# Query oldest first
kysera query by-timestamp --table logs --last 24h --order asc

# Output as JSON
kysera query by-timestamp --table events --last 1h --json
```

### Output

Results are displayed in a formatted table showing all columns from the queried table. NULL values are shown in gray, dates are formatted as ISO strings.

## soft-deleted

Manage soft-deleted records in tables using the @kysera/soft-delete plugin.

```bash
kysera query soft-deleted [options]
```

### Options

| Option                | Description                                   |
| --------------------- | --------------------------------------------- |
| `-t, --table <name>`  | Table name to query (required)                |
| `-c, --column <name>` | Soft delete column name (default: deleted_at) |
| `-r, --restore <id>`  | Restore a soft-deleted record by ID           |
| `--purge`             | Permanently delete all soft-deleted records   |
| `--force`             | Skip confirmation for purge                   |
| `-l, --limit <n>`     | Limit results (default: 100)                  |
| `--json`              | Output as JSON                                |
| `--config <path>`     | Path to configuration file                    |
| `-s, --schema <name>` | PostgreSQL schema name (default: public)      |

### Examples

```bash
# List soft-deleted users
kysera query soft-deleted -t users

# List soft-deleted records with custom column
kysera query soft-deleted -t users -c deleted_at

# Restore a specific record
kysera query soft-deleted -t users --restore 123

# Purge all soft-deleted records (with confirmation)
kysera query soft-deleted -t users --purge

# Purge without confirmation
kysera query soft-deleted -t users --purge --force
```

## analyze

Analyze query performance and identify optimization opportunities.

```bash
kysera query analyze [options]
```

The query is passed via `-q/--query` or read from a file with `-f/--file` — there is no positional argument.

### Options

| Option                   | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `-q, --query <sql>`      | SQL query to analyze                              |
| `-f, --file <path>`      | Read query from file                              |
| `--format <type>`        | Output format: simple, detailed, json (default: simple) |
| `-i, --show-indexes`     | Show index usage information                      |
| `-s, --show-statistics`  | Show table statistics                             |
| `--suggestions`          | Show optimization suggestions (default: true)     |
| `-b, --benchmark <n>`    | Benchmark query N times (default: 1)              |
| `--json`                 | Output results as JSON (same as `--format json`)  |
| `-c, --config <path>`    | Path to configuration file                        |

### Examples

```bash
# Analyze a SELECT query
kysera query analyze -q "SELECT * FROM users WHERE status = 'active'"

# Analyze a query stored in a file
kysera query analyze -f ./queries/dashboard.sql

# Detailed report with index usage and statistics
kysera query analyze -q "SELECT * FROM orders" --format detailed -i -s

# Benchmark the query 10 times
kysera query analyze -q "SELECT * FROM users" -b 10

# Machine-readable output
kysera query analyze -q "SELECT * FROM users" --format json
```

### Output

Analysis includes:

- Query type detection
- Table references
- Index usage recommendations
- Potential performance issues
- Optimization suggestions

## explain

Show query execution plan from the database.

```bash
kysera query explain [options]
```

Like `analyze`, the query comes from `-q/--query` or `-f/--file` — there is no positional argument.

### Options

| Option                | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `-q, --query <sql>`   | SQL query to explain                                   |
| `-f, --file <path>`   | Read query from file                                   |
| `-a, --analyze`       | Execute query and show actual times (EXPLAIN ANALYZE)  |
| `-v, --verbose`       | Show verbose output                                    |
| `--format <type>`     | Output format: text, json, tree, yaml (default: text)  |
| `--buffers`           | Show buffer usage (PostgreSQL)                         |
| `--costs`             | Show cost estimates (default: true)                    |
| `--timing`            | Show timing information (default: true)                |
| `--summary`           | Show summary at the end (default: true)                |
| `--json`              | Output results as JSON (same as `--format json`)       |
| `-c, --config <path>` | Path to configuration file                             |
| `-s, --schema <name>` | PostgreSQL schema name (default: public)               |

### Examples

```bash
# Basic execution plan
kysera query explain --query "SELECT * FROM users WHERE id = 1"

# With analyze (runs the query)
kysera query explain --query "SELECT * FROM orders WHERE user_id = 5" --analyze

# Tree format with buffer usage
kysera query explain --query "SELECT * FROM products" --format tree --buffers
```

### Database-Specific Plans

**PostgreSQL:**

```
EXPLAIN [ANALYZE] <query>
```

**MySQL:**

```
EXPLAIN <query>
```

**SQLite:**

```
EXPLAIN QUERY PLAN <query>
```

## Use Cases

### Auditing Recent Activity

```bash
# Find all changes in the last hour
kysera query by-timestamp --table audit_logs --last 1h

# Find records modified today
kysera query by-timestamp --table users --column updated_at --last 24h
```

### Managing Soft Deletes

```bash
# Review soft-deleted records
kysera query soft-deleted -t orders

# Restore a specific record
kysera query soft-deleted -t orders --restore 123

# Permanently delete all soft-deleted records
kysera query soft-deleted -t orders --purge --force
```

### Performance Troubleshooting

```bash
# Check if a slow query uses indexes
kysera query explain --query "SELECT * FROM orders WHERE status = 'pending'" --analyze

# Analyze query patterns
kysera query analyze --query "SELECT * FROM users WHERE email LIKE '%@gmail.com'"
```

## Configuration

Query commands use the database configuration from `kysera.config.ts`:

```typescript
export default {
  database: {
    dialect: 'postgres',
    connection: '${DATABASE_URL}'
  }
}
```

## See Also

- [Debug Commands](/docs/cli/debug) - Query debugging and profiling
- [@kysera/soft-delete](/docs/plugins/soft-delete) - Soft delete plugin
- [Pagination Guide](/docs/guides/pagination) - Cursor and offset pagination
