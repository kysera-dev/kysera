---
sidebar_position: 3
title: Health (Moved)
description: Health check utilities have been moved to @kysera/infra
---

# Health Checks

:::warning Module Moved
Health monitoring utilities have been moved to **[@kysera/infra](/docs/api/infra)** for better separation of concerns and tree-shaking.

```bash
npm install @kysera/infra
```

```typescript
// Before (deprecated)
import { checkDatabaseHealth, HealthMonitor } from '@kysera/core';

// After
import { checkDatabaseHealth, HealthMonitor } from '@kysera/infra';
```

See the full documentation at **[@kysera/infra](/docs/api/infra)**.
:::

---

## Legacy Documentation

The following documentation is kept for reference. For current implementation, see [@kysera/infra](/docs/api/infra).

---

Database health monitoring and metrics collection.

## checkDatabaseHealth

Perform a comprehensive health check.

```typescript
async function checkDatabaseHealth<DB>(
  db: Kysely<DB>,
  pool?: MetricsPool
): Promise<HealthCheckResult>
```

### HealthCheckResult

```typescript
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: Array<{
    name: string
    status: 'healthy' | 'degraded' | 'unhealthy'
    message?: string
    details?: Record<string, any>
  }>
  errors?: string[]
  metrics?: {
    databaseVersion?: string
    poolMetrics?: {
      totalConnections: number
      activeConnections: number
      idleConnections: number
      waitingRequests: number
    }
    queryMetrics?: {
      totalQueries?: number
      avgResponseTime?: number
      slowQueries?: number
      errors?: number
    }
    checkLatency?: number
  }
  timestamp: Date
}
```

### Example

```typescript
import { checkDatabaseHealth, createMetricsPool } from '@kysera/core'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: '...' })
const metricsPool = createMetricsPool(pool)

const health = await checkDatabaseHealth(db, metricsPool)

console.log(health)
// {
//   status: 'healthy',
//   checks: [
//     { name: 'database', status: 'healthy', details: { latency: 12 } },
//     { name: 'pool', status: 'healthy', details: { active: 2, idle: 8 } }
//   ],
//   metrics: { checkLatency: 15, poolMetrics: {...} },
//   timestamp: Date
// }
```

## createMetricsPool

Wrap a database pool with metrics capabilities.

```typescript
function createMetricsPool(pool: DatabasePool): MetricsPool
```

Automatically detects and supports:
- PostgreSQL (`pg.Pool`)
- MySQL (`mysql2.Pool`)
- SQLite (`better-sqlite3.Database`)

### Example

```typescript
import { createMetricsPool } from '@kysera/core'
import { Pool } from 'pg'

const pool = new Pool({ max: 10 })
const metricsPool = createMetricsPool(pool)

// Get metrics
console.log(metricsPool.totalCount)   // 10
console.log(metricsPool.idleCount)    // 8
console.log(metricsPool.waitingCount) // 0
```

## performHealthCheck

Alternative health check function with more options.

```typescript
async function performHealthCheck<DB>(
  db: Kysely<DB>,
  options?: {
    verbose?: boolean
    pool?: MetricsPool
  }
): Promise<HealthCheckResult>
```

## HealthMonitor

Continuous health monitoring.

```typescript
class HealthMonitor {
  constructor(
    db: Kysely<any>,
    options?: {
      interval?: number      // Check interval in ms (default: 30000)
      pool?: MetricsPool
    }
  )

  start(onCheck?: (result: HealthCheckResult) => void): void
  stop(): void
  getLastCheck(): HealthCheckResult | undefined
}
```

### Example

```typescript
import { HealthMonitor } from '@kysera/core'

const monitor = new HealthMonitor(db, {
  interval: 30000,
  pool: metricsPool
})

monitor.start((result) => {
  if (result.status !== 'healthy') {
    alertOps('Database health degraded', result)
  }
})

// Later
monitor.stop()
```

## getMetrics

Get detailed metrics from a debug-enabled database.

```typescript
async function getMetrics<DB>(
  db: Kysely<DB> | DatabaseWithMetrics<DB>,
  options?: GetMetricsOptions
): Promise<MetricsResult>
```

### MetricsResult

```typescript
interface MetricsResult {
  queries: {
    total: number
    avgDuration: number
    p95Duration: number
    p99Duration: number
    slowQueries: number
    errors: number
  }
  pool?: {
    total: number
    active: number
    idle: number
    waiting: number
  }
}
```

## Status Determination

| Latency | Status |
|---------|--------|
| < 100ms | healthy |
| 100-500ms | degraded |
| > 500ms | unhealthy |

## HTTP Endpoint Example

```typescript
app.get('/health', async (req, res) => {
  const health = await checkDatabaseHealth(db, metricsPool)

  const statusCode = health.status === 'healthy' ? 200
    : health.status === 'degraded' ? 200
    : 503

  res.status(statusCode).json(health)
})

app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' })
})

app.get('/health/ready', async (req, res) => {
  const health = await checkDatabaseHealth(db)
  res.status(health.status === 'unhealthy' ? 503 : 200).json(health)
})
```
