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

**Dependencies:** None (peer: kysely >=0.28.8)

:::info Package Type
This is a **utility package** providing infrastructure and resilience features. It's not part of the Repository/DAL pattern - it works with Kysely instances directly.
:::

## Key Features

- **Health Monitoring** - Database connectivity checks with latency tracking
- **Retry Logic** - Automatic retries with exponential backoff
- **Circuit Breaker** - Prevent cascading failures
- **Graceful Shutdown** - Clean database connection termination
- **Pool Metrics** - Connection pool monitoring (PostgreSQL, MySQL, SQLite, MSSQL)

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
monitor.stop()
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

### Circuit Breaker

```typescript
import { CircuitBreaker } from '@kysera/infra'

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
  if (error.message.includes('Circuit breaker is open')) {
    // Service unavailable
  }
}

// Check circuit state (async methods)
if (await breaker.isOpen()) {
  console.log('Circuit is open - service unavailable')
}
if (await breaker.isClosed()) {
  console.log('Circuit is closed - operating normally')
}

await breaker.getState() // { state: 'open', failures: 5, lastFailureTime: ... }
await breaker.reset() // Reset to closed
await breaker.forceOpen() // Force open for maintenance
```

**Circuit States:**

- `closed` - Normal operation
- `open` - Too many failures, requests fail immediately
- `half-open` - Testing recovery, allows one request

**Thread Safety:**
- Circuit breaker uses mutex for thread-safe state transitions
- Prevents race conditions in concurrent environments
- Safe to use across multiple requests simultaneously

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

interface HealthMonitorOptions {
  pool?: MetricsPool
  intervalMs?: number // Default: 30000
  logger?: KyseraLogger
}
```

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

  // State management (all async for thread-safe mutex-based operations)
  getState(): Promise<CircuitBreakerState>
  isOpen(): Promise<boolean> // Check if circuit is open
  isClosed(): Promise<boolean> // Check if circuit is closed
  reset(): Promise<void> // Reset to closed state
  forceOpen(): Promise<void> // Force circuit open
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
