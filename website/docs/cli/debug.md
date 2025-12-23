---
sidebar_position: 8
title: debug
description: Debug and performance analysis tools
---

# kysera debug

Debug and performance analysis tools for SQL queries and database operations.

## Commands

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
| `sql`             | Real-time SQL query monitoring and debugging |
| `profile`         | Query profiling and performance analysis     |
| `errors`          | Error analysis and diagnostics               |
| `circuit-breaker` | Circuit breaker status and management        |
| `analyzer`        | Query pattern analyzer                       |

## sql

Real-time SQL query monitoring and debugging.

```bash
kysera debug sql [options]
```

### Options

| Option                      | Description                                   |
| --------------------------- | --------------------------------------------- |
| `-w, --watch`               | Watch mode - monitor queries in real-time     |
| `-f, --filter <pattern>`    | Filter queries by pattern (regex)             |
| `-h, --highlight <keyword>` | Highlight specific keywords                   |
| `--show-params`             | Show query parameters                         |
| `--show-duration`           | Show query execution time                     |
| `-l, --limit <n>`           | Limit number of queries to show (default: 50) |
| `-c, --config <path>`       | Path to configuration file                    |

### Examples

```bash
# Watch queries in real-time
kysera debug sql --watch

# Watch with duration display
kysera debug sql --watch --show-duration

# Filter queries by pattern
kysera debug sql --watch --filter "SELECT.*users"

# Highlight specific keywords
kysera debug sql --watch --highlight "JOIN"

# Show query parameters
kysera debug sql --watch --show-params

# Analyze recent queries from logs
kysera debug sql --limit 100
```

### Output

In watch mode, each query is displayed with:

- Timestamp
- Query ID and status (✓ success / ✗ error)
- Duration (if `--show-duration`)
- Row count
- SQL with syntax highlighting
- Parameters (if `--show-params`)

The command also provides summary statistics:

- Top query patterns by frequency
- Slow queries (>1s)
- Failed queries with errors
- Success rate, average duration, P95 duration

## profile

Query profiling and performance analysis with statistical metrics.

```bash
kysera debug profile [options]
```

### Options

| Option                   | Description                                    |
| ------------------------ | ---------------------------------------------- |
| `-q, --query <sql>`      | SQL query to profile                           |
| `-t, --table <name>`     | Profile queries on specific table              |
| `-o, --operation <type>` | Operation type: select, insert, update, delete |
| `-i, --iterations <n>`   | Number of iterations (default: 100)            |
| `-w, --warmup <n>`       | Number of warmup runs (default: 10)            |
| `--show-plan`            | Show query execution plan                      |
| `--compare <query>`      | Compare with another query                     |
| `--json`                 | Output as JSON                                 |
| `-c, --config <path>`    | Path to configuration file                     |

### Examples

```bash
# Profile a specific query
kysera debug profile --query "SELECT * FROM users WHERE status = 'active'"

# Profile table operations
kysera debug profile --table users --operation select

# Profile with execution plan
kysera debug profile --query "SELECT * FROM orders" --show-plan

# Compare two queries
kysera debug profile \
  --query "SELECT * FROM users WHERE id = 1" \
  --compare "SELECT * FROM users WHERE email = 'test@example.com'"

# Custom iterations
kysera debug profile --query "SELECT 1" --iterations 1000 --warmup 50
```

### Output

Profile results include:

**Performance Metrics:**

- Average duration
- Minimum/Maximum duration
- P50 (Median), P95, P99 percentiles
- Standard deviation

**Response Time Distribution:**

- Histogram showing timing distribution

**Execution Plan** (with `--show-plan`):

- PostgreSQL: EXPLAIN ANALYZE output
- MySQL: EXPLAIN output
- SQLite: EXPLAIN QUERY PLAN output

**Analysis:**

- Performance rating (Excellent/Good/Moderate/Poor)
- Consistency rating based on standard deviation

## errors

Error analysis and diagnostics.

```bash
kysera debug errors [options]
```

### Options

| Option                | Description                |
| --------------------- | -------------------------- |
| `--since <datetime>`  | Show errors since datetime |
| `--type <error-type>` | Filter by error type       |
| `-l, --limit <n>`     | Limit number of results    |
| `--json`              | Output as JSON             |
| `-c, --config <path>` | Path to configuration file |

### Examples

```bash
# Show recent errors
kysera debug errors

# Show errors from last 24 hours
kysera debug errors --since "2025-01-01T00:00:00"

# Filter by error type
kysera debug errors --type "UNIQUE_CONSTRAINT"
```

## circuit-breaker

Circuit breaker status and management.

```bash
kysera debug circuit-breaker [options]
```

### Options

| Option                 | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `-a, --action <type>`  | Action: status, reset, open, close (default: status) |
| `-s, --service <name>` | Service name: database, cache, api                   |
| `-t, --threshold <n>`  | Error threshold for opening circuit (default: 5)     |
| `--timeout <ms>`       | Reset timeout in milliseconds (default: 30000)       |
| `-w, --watch`          | Watch mode - monitor in real-time                    |
| `--json`               | Output as JSON                                       |
| `-c, --config <path>`  | Path to configuration file                           |

### Examples

```bash
# Check circuit breaker status
kysera debug circuit-breaker --action status

# Check specific service
kysera debug circuit-breaker --service database

# Reset circuit breaker
kysera debug circuit-breaker --action reset

# Manually open circuit breaker
kysera debug circuit-breaker --action open --service database

# Close circuit breaker
kysera debug circuit-breaker --action close

# Watch mode - real-time monitoring
kysera debug circuit-breaker --watch

# Configure threshold and timeout
kysera debug circuit-breaker --threshold 10 --timeout 60000
```

### Circuit Breaker States

| State       | Description                             |
| ----------- | --------------------------------------- |
| `CLOSED`    | Normal operation, requests pass through |
| `OPEN`      | Circuit is open, requests fail fast     |
| `HALF_OPEN` | Testing if service recovered            |

## analyzer

Query analyzer for identifying optimization opportunities, index usage, and performance insights.

```bash
kysera debug analyzer [options]
```

### Options

| Option                | Description                                   |
| --------------------- | --------------------------------------------- |
| `-q, --query <sql>`   | SQL query to analyze                          |
| `-t, --table <name>`  | Analyze queries for specific table            |
| `-e, --explain`       | Show execution plan                           |
| `-s, --suggestions`   | Show optimization suggestions (default: true) |
| `-i, --indexes`       | Analyze index usage                           |
| `--statistics`        | Show table statistics                         |
| `--json`              | Output as JSON                                |
| `-c, --config <path>` | Path to configuration file                    |

### Examples

```bash
# Analyze a specific query
kysera debug analyzer --query "SELECT * FROM users WHERE email = 'test@example.com'"

# Analyze with execution plan
kysera debug analyzer --query "SELECT * FROM orders" --explain

# Analyze table indexes
kysera debug analyzer --table users --indexes

# Show table statistics
kysera debug analyzer --table orders --statistics

# Get optimization suggestions
kysera debug analyzer --query "SELECT * FROM users" --suggestions

# Full analysis with all features
kysera debug analyzer --table users --indexes --statistics --suggestions

# Output as JSON
kysera debug analyzer --table users --json
```

### Output

**Query Analysis:**

- Estimated cost and rows
- Index recommendations
- Missing indexes detection
- Query complexity score

**Index Analysis (with `--indexes`):**

- Index usage statistics
- Unused indexes
- Duplicate indexes
- Recommended indexes

**Table Statistics (with `--statistics`):**

- Row count
- Table size
- Index size
- Average row size

## Configuration

Debug commands use the database configuration from `kysera.config.ts`:

```typescript
import { defineConfig } from '@kysera/cli'

export default defineConfig({
  database: {
    dialect: 'postgres',
    host: 'localhost',
    database: 'myapp'
  }
})
```

## Requirements

Some debug features require additional setup:

### Query Logging Table

For `debug sql` without watch mode:

```sql
CREATE TABLE query_logs (
  id SERIAL PRIMARY KEY,
  query_text TEXT NOT NULL,
  duration_ms INTEGER,
  error TEXT,
  executed_at TIMESTAMP DEFAULT NOW()
);
```

### Kysera Debug Plugin

For automatic query logging, use `@kysera/debug`:

```typescript
import { createDebugPlugin } from '@kysera/debug'

const debugPlugin = createDebugPlugin({
  logQueries: true,
  logSlowQueries: true,
  slowQueryThreshold: 1000
})
```

## See Also

- [Health Commands](/docs/cli/health) - Database health monitoring
- [@kysera/debug](/docs/api/debug) - Debug plugin API
- [@kysera/infra](/docs/api/infra) - Circuit breaker and resilience
