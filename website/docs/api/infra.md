---
sidebar_position: 4
title: '@kysera/infra'
description: Infrastructure utilities API reference
---

# @kysera/infra

Infrastructure utilities for Kysera - health monitoring, resilience patterns, and graceful shutdown.

## Installation

```bash
npm install @kysera/infra kysely
```

## Overview

**Dependencies:** @kysera/core (peer: kysely >=0.29.0)

:::info Package Type
This is a **utility package** providing infrastructure and resilience features. It's not part of the Repository/DAL pattern - it works with Kysely instances directly.
:::

## Module Exports

Everything is available from the package root, plus four subpath exports for targeted imports:

```typescript
import { checkDatabaseHealth, CircuitBreaker } from '@kysera/infra' // Package root
import { performHealthCheck, getMetrics } from '@kysera/infra/health' // Health checks & metrics
import { withRetry, CircuitBreakerError } from '@kysera/infra/resilience' // Retry & circuit breaker
import { createMetricsPool } from '@kysera/infra/pool' // Pool metrics
import { registerShutdownHandlers } from '@kysera/infra/shutdown' // Graceful shutdown
```

:::note
`CircuitBreakerError` is exported **only** from the `@kysera/infra/resilience` subpath, not from the package root.
:::

## Key Features

- **Health Monitoring** - Database connectivity checks with latency tracking
- **Retry Logic** - Automatic retries with exponential backoff
- **Circuit Breaker** - Prevent cascading failures
- **Graceful Shutdown** - Clean database connection termination
- **Pool Metrics** - Connection pool monitoring (`pg`, `mysql2`, `better-sqlite3`; other pools report static placeholders)

## Quick Start

```typescript
import {
  checkDatabaseHealth,
  HealthMonitor,
  withRetry,
  CircuitBreaker,
  registerShutdownHandlers,
  createMetricsPool
} from '@kysera/infra'

// Create metrics-enabled pool
const metricsPool = createMetricsPool(pgPool)

// Health monitoring
const monitor = new HealthMonitor(db, { pool: metricsPool, intervalMs: 30000 })
monitor.start(result => {
  if (result.status !== 'healthy') console.warn('Health issue:', result)
})

// Resilience patterns
const breaker = new CircuitBreaker(5, 60000)
const users = await breaker.execute(() => withRetry(() => db.selectFrom('users').execute()))

// Graceful shutdown
registerShutdownHandlers(db, {
  timeout: 10000,
  onShutdown: async () => monitor.stop()
})
```

## Health Monitoring

### Basic Health Check

```typescript
import { checkDatabaseHealth } from '@kysera/infra'

const result = await checkDatabaseHealth(db)
console.log(result.status) // 'healthy' | 'degraded' | 'unhealthy'
```

**Health Status Levels:**

- `healthy` - Latency < 100ms
- `degraded` - Latency 100-500ms
- `unhealthy` - Latency > 500ms or connection failed

### With Pool Metrics

```typescript
import { checkDatabaseHealth, createMetricsPool } from '@kysera/infra'

const metricsPool = createMetricsPool(pgPool)
const result = await checkDatabaseHealth(db, metricsPool)

console.log(result.metrics?.poolMetrics)
// { totalConnections: 10, activeConnections: 2, idleConnections: 8, waitingRequests: 0 }
```

### Extended Health Check

`performHealthCheck` wraps `checkDatabaseHealth` with an options object and verbose mode:

```typescript
import { performHealthCheck } from '@kysera/infra'

const result = await performHealthCheck(db, {
  pool: metricsPool,
  verbose: true // Adds databaseVersion to metrics
})
```

```typescript
interface HealthCheckOptions {
  pool?: MetricsPool // Connection pool for metrics extraction
  verbose?: boolean // Include verbose information
  logger?: KyseraLogger // Custom logger
}
```

### Continuous Monitoring

```typescript
import { HealthMonitor } from '@kysera/infra'

const monitor = new HealthMonitor(db, {
  pool: metricsPool,
  intervalMs: 30000
})

monitor.start(result => {
  if (result.status !== 'healthy') {
    // Send alert, log to monitoring system
  }
})

monitor.getLastCheck() // Get last result
await monitor.checkNow() // Immediate check
monitor.isRunning() // true while started
monitor.stop()
monitor.destroy() // Alias for stop() with explicit destruction semantics
```

`HealthMonitor` implements `Disposable`, so it works with explicit resource management (`using`):

```typescript
{
  using monitor = new HealthMonitor(db, { intervalMs: 30000 })
  monitor.start()
} // Automatically stopped when scope exits (Symbol.dispose calls stop())
```

### Database Metrics

`getMetrics` aggregates real query statistics from a database wrapped with `withDebug()` from `@kysera/debug`:

```typescript
import { withDebug } from '@kysera/debug'
import { getMetrics, hasDatabaseMetrics } from '@kysera/infra'

const debugDb = withDebug(db, { maxMetrics: 1000 })
await debugDb.selectFrom('users').selectAll().execute()

const metrics = getMetrics(debugDb, {
  slowQueryThreshold: 100,
  pool: metricsPool
})
console.log(metrics.queries?.avgDuration) // Real average from tracked queries
console.log(metrics.recommendations) // Performance recommendations
```

:::warning
`getMetrics` works **only** on a `withDebug`-wrapped database - it throws an error otherwise. Use the `hasDatabaseMetrics(db)` type guard to check whether a database instance tracks metrics.
:::

```typescript
interface GetMetricsOptions {
  period?: string // Time period label (informational, default: '1h')
  pool?: MetricsPool // Optional pool for connection metrics
  slowQueryThreshold?: number // Slow query threshold in ms (default: 100)
}

interface MetricsResult {
  period: string
  timestamp: string // ISO timestamp of collection
  connections?: { total: number; active: number; idle: number; max: number }
  queries?: {
    total: number
    avgDuration: number
    minDuration: number
    maxDuration: number
    p95Duration: number
    p99Duration: number
    slowCount: number
  }
  recommendations?: string[]
}
```

## Resilience Patterns

### Retry with Exponential Backoff

```typescript
import { withRetry, isTransientError } from '@kysera/infra'

const result = await withRetry(() => db.selectFrom('users').execute(), {
  maxAttempts: 5,
  delayMs: 500,
  backoff: true,
  onRetry: (attempt, error) => console.log(`Retry ${attempt}:`, error),
  shouldRetry: isTransientError
})
```

**Recognized Transient Errors:**

- Network: `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, `EPIPE`
- PostgreSQL: `57P03`, `08006`, `40001`, `40P01` (deadlock)
- MySQL: `ER_LOCK_DEADLOCK`, `ER_LOCK_WAIT_TIMEOUT`
- SQLite: `SQLITE_BUSY`, `SQLITE_LOCKED`

### Reusable Retry Wrapper

`createRetryWrapper` wraps a function once so every call retries with the same options:

```typescript
import { createRetryWrapper } from '@kysera/infra'

const fetchUsers = async () => db.selectFrom('users').selectAll().execute()
const fetchUsersWithRetry = createRetryWrapper(fetchUsers, { maxAttempts: 3 })

const users = await fetchUsersWithRetry() // Retries automatically
```

```typescript
function createRetryWrapper<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options?: RetryOptions
): (...args: TArgs) => Promise<TResult>
```

### Circuit Breaker

```typescript
import { CircuitBreaker } from '@kysera/infra'
import { CircuitBreakerError } from '@kysera/infra/resilience'

// Constructor signature 1: Simple parameters
const breaker1 = new CircuitBreaker(5, 60000) // threshold, resetTimeMs

// Constructor signature 2: Options object
const breaker2 = new CircuitBreaker({
  threshold: 5,
  resetTimeMs: 60000,
  onStateChange: (newState, oldState) => console.log(`${oldState} -> ${newState}`)
})

try {
  const result = await breaker.execute(() => db.selectFrom('users').execute())
} catch (error) {
  if (error instanceof CircuitBreakerError) {
    // Service unavailable (circuit open or testing recovery)
  }
}

// Check circuit state (synchronous reads)
if (breaker.isOpen()) {
  console.log('Circuit is open - service unavailable')
}
if (breaker.isClosed()) {
  console.log('Circuit is closed - operating normally')
}

breaker.getState() // { state: 'open', failures: 5, lastFailureTime: ..., isTestingHalfOpen: false }
await breaker.reset() // Reset to closed (async)
await breaker.forceOpen() // Force open for maintenance (async)
```

**Circuit States:**

- `closed` - Normal operation
- `open` - Too many failures, requests fail immediately
- `half-open` - Testing recovery, allows one request

**Concurrency Contract:**
- `execute()`, `reset()`, and `forceOpen()` serialize state transitions through an internal mutex - that's why they're async
- `getState()`, `isOpen()`, and `isClosed()` are synchronous snapshot reads (JavaScript is single-threaded, so reads are atomic and need no mutex)
- Safe to use across multiple concurrent requests

**CircuitBreakerError:**

`execute()` rejects with `CircuitBreakerError` when the circuit is open (`'Circuit breaker is open'`) or while a half-open test request is already in flight (`'Circuit breaker is testing recovery'`). It extends `DatabaseError` from `@kysera/core` and is exported only from the `@kysera/infra/resilience` subpath.

### Combined Resilience

```typescript
const result = await breaker.execute(() =>
  withRetry(() => db.selectFrom('users').execute(), { maxAttempts: 3 })
)
```

## Connection Pool Metrics

```typescript
import { createMetricsPool, isMetricsPool } from '@kysera/infra'

// PostgreSQL
const metricsPool = createMetricsPool(pgPool)
const metrics = metricsPool.getMetrics()
// { total: 10, idle: 8, active: 2, waiting: 0 }

// Type guard
if (isMetricsPool(pool)) {
  const metrics = pool.getMetrics()
}
```

Pool type is detected once at creation. Recognized pools: `pg` (PostgreSQL), `mysql2`, and `better-sqlite3`. Any other pool type - including MSSQL/tedious - reports static placeholder metrics: `{ total: 10, idle: 0, active: 0, waiting: 0 }`.

## Graceful Shutdown

### Automatic Signal Handlers

```typescript
import { registerShutdownHandlers } from '@kysera/infra'

registerShutdownHandlers(db, {
  signals: ['SIGTERM', 'SIGINT'],
  timeout: 30000,
  onShutdown: async () => {
    await flushCache()
    monitor.stop()
  }
})
```

### Manual Shutdown

```typescript
import { gracefulShutdown, shutdownDatabase } from '@kysera/infra'

// With cleanup
await gracefulShutdown(db, {
  timeout: 10000,
  onShutdown: async () => console.log('Cleanup...')
})

// Simple
await shutdownDatabase(db)
```

### Shutdown Controller

```typescript
import { createShutdownController } from '@kysera/infra'

const shutdown = createShutdownController(db, { timeout: 10000 })
shutdown.registerSignals()

if (!shutdown.isShuttingDown()) {
  await shutdown.execute()
}
```

## API Reference

### Health Types

```typescript
type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

interface HealthCheckResult {
  status: HealthStatus
  checks: HealthCheck[]
  errors?: string[]
  metrics?: HealthMetrics
  timestamp: Date
}

interface HealthCheckOptions {
  pool?: MetricsPool
  verbose?: boolean
  logger?: KyseraLogger
}

interface HealthMonitorOptions {
  pool?: MetricsPool
  intervalMs?: number // Default: 30000
  logger?: KyseraLogger
}
```

See [Database Metrics](#database-metrics) for `GetMetricsOptions`, `MetricsResult`, and the `hasDatabaseMetrics` type guard.

### Resilience Types

```typescript
interface RetryOptions {
  maxAttempts?: number // Default: 3
  delayMs?: number // Default: 1000
  maxDelayMs?: number // Default: 30000 (caps exponential backoff)
  backoff?: boolean // Default: true
  jitterFactor?: number // Default: 0.25 (prevents thundering herd)
  shouldRetry?: (error: unknown) => boolean
  onRetry?: (attempt: number, error: unknown) => void
}

type CircuitState = 'closed' | 'open' | 'half-open'

interface CircuitBreakerOptions {
  threshold?: number // Default: 5
  resetTimeMs?: number // Default: 60000
  onStateChange?: (newState: CircuitState, previousState: CircuitState) => void
}

interface CircuitBreakerState {
  state: CircuitState
  failures: number
  lastFailureTime: number | undefined
  isTestingHalfOpen: boolean // True while a half-open test request is in flight
}
```

### CircuitBreaker Class

```typescript
class CircuitBreaker {
  // Constructor signatures
  constructor(threshold?: number, resetTimeMs?: number)
  constructor(options?: CircuitBreakerOptions)

  // Execute a function with circuit breaker protection
  execute<T>(fn: () => Promise<T>): Promise<T>

  // Synchronous state reads (atomic snapshots, no mutex needed)
  getState(): CircuitBreakerState
  isOpen(): boolean // Check if circuit is open
  isClosed(): boolean // Check if circuit is closed

  // Async state transitions (serialized through internal mutex)
  reset(): Promise<void> // Reset to closed state
  forceOpen(): Promise<void> // Force circuit open
}

// Thrown when execute() rejects a request (circuit open or half-open test in flight).
// Exported only from '@kysera/infra/resilience'.
class CircuitBreakerError extends DatabaseError {
  name: 'CircuitBreakerError'
}
```

### Pool Types

```typescript
interface PoolMetrics {
  total: number
  idle: number
  active: number
  waiting: number
}

interface MetricsPool extends DatabasePool {
  getMetrics(): PoolMetrics
}
```

### Shutdown Types

```typescript
interface ShutdownOptions {
  timeout?: number // Default: 30000
  onShutdown?: () => void | Promise<void>
  logger?: KyseraLogger
}

interface RegisterShutdownOptions extends ShutdownOptions {
  signals?: NodeJS.Signals[] // Default: ['SIGTERM', 'SIGINT']
}
```

## Best Practices

1. **Always use health monitoring in production**
2. **Combine retry and circuit breaker** for maximum resilience
3. **Set appropriate timeouts** matching your SLA
4. **Monitor pool metrics** for connection exhaustion
5. **Register shutdown handlers early** to prevent leaks
