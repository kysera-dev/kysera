---
sidebar_position: 6
title: health
description: Health monitoring commands
---

# kysera health

Database health monitoring and metrics.

## Commands

### check

Perform health check.

```bash
kysera health check
```

**Options:**
```
--json                    Output as JSON
--watch                   Continuous monitoring
--interval <ms>           Check interval (default: 5000)
-v, --verbose             Detailed metrics
```

**Output:**
```
Database Health Check
=====================

Status: ✓ HEALTHY

Connection
  Status:    Connected
  Latency:   23ms
  Version:   PostgreSQL 14.5

Pool
  Active:    2/10
  Idle:      8
  Waiting:   0

Query Metrics
  Total:     1,234
  Avg Time:  15ms
  Slow:      3
  Errors:    0

Last Check: 2024-01-15 10:30:00
```

### watch

Continuous monitoring mode.

```bash
kysera health check --watch
```

**Options:**
```
--interval <ms>           Check interval (default: 5000)
--alert <threshold>       Alert on latency above threshold
```

Press `Ctrl+C` to stop.

### metrics

Detailed metrics report.

```bash
kysera health metrics
```

**Options:**
```
--json                    Output as JSON
--period <duration>       Time period (1h, 24h, 7d)
```

**Output:**
```
Database Metrics (Last 24h)
===========================

Queries
  Total:        12,345
  Per Second:   0.14
  Avg Duration: 18ms
  P95:          45ms
  P99:          120ms

Slow Queries (>100ms)
  Count:        23
  Percentage:   0.19%

Errors
  Total:        5
  Rate:         0.04%

Pool Usage
  Peak Active:  8/10
  Avg Active:   3/10
  Timeouts:     0
```

## Health Status

| Status | Condition |
|--------|-----------|
| HEALTHY | Latency < 100ms |
| DEGRADED | 100ms < Latency < 500ms |
| UNHEALTHY | Latency > 500ms or errors |

## JSON Output

```bash
kysera health check --json
```

```json
{
  "status": "healthy",
  "checks": [
    {
      "name": "database",
      "status": "healthy",
      "details": {
        "latency": 23,
        "version": "PostgreSQL 14.5"
      }
    },
    {
      "name": "pool",
      "status": "healthy",
      "details": {
        "total": 10,
        "active": 2,
        "idle": 8,
        "waiting": 0
      }
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Use in CI/CD

```bash
# Exit with error if unhealthy
kysera health check || exit 1

# Check with timeout
timeout 30s kysera health check
```

## HTTP Endpoint Integration

Use CLI for Kubernetes probes:

```yaml
# kubernetes deployment
livenessProbe:
  exec:
    command:
      - kysera
      - health
      - check
  initialDelaySeconds: 30
  periodSeconds: 10
```
