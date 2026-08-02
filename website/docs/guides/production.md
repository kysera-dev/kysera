---
sidebar_position: 2
title: Production Operations
description: Health checks, pool metrics, retry, circuit breakers, and graceful shutdown with @kysera/infra
---

# Production Operations

`@kysera/infra` packages the operational building blocks a database-backed service needs in production: health checks, connection pool metrics, retry with backoff, a circuit breaker, and graceful shutdown. It has no third-party runtime dependencies and works with any Kysely dialect.

```bash
pnpm add @kysera/infra
```

Everything is available from the package root, and each module is also exposed as a subpath for finer-grained imports:

| Subpath                    | Contents                                                       |
| -------------------------- | -------------------------------------------------------------- |
| `@kysera/infra/health`     | `checkDatabaseHealth`, `performHealthCheck`, `HealthMonitor`, `getMetrics`, `hasDatabaseMetrics` |
| `@kysera/infra/resilience` | `withRetry`, `createRetryWrapper`, `isTransientError`, `CircuitBreaker`, `CircuitBreakerError` |
| `@kysera/infra/pool`       | `createMetricsPool`, `isMetricsPool`                            |
| `@kysera/infra/shutdown`   | `gracefulShutdown`, `shutdownDatabase`, `registerShutdownHandlers`, `createShutdownController` |

:::warning

`CircuitBreakerError` is exported **only** from the `@kysera/infra/resilience` subpath, not from the package root. Import it from there when you need `instanceof` checks.

:::

## Health Checks

`checkDatabaseHealth` runs a lightweight ping query (`SELECT 1`, with a 5 second timeout) and classifies the result by latency: under 100&nbsp;ms is `healthy`, under 500&nbsp;ms is `degraded`, anything slower — or any error — is `unhealthy`.

```typescript
import { checkDatabaseHealth } from '@kysera/infra/health'

const result = await checkDatabaseHealth(db)

console.log(result.status) // 'healthy' | 'degraded' | 'unhealthy'
console.log(result.metrics?.checkLatency) // ping latency in ms
```

The result shape:

```typescript
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy' // worst of all checks
  checks: {
    name: string
    status: 'healthy' | 'degraded' | 'unhealthy'
    message?: string
    details?: Record<string, unknown>
  }[]
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

`performHealthCheck` is an extended variant that takes an options object (`HealthCheckOptions`): `pool` for connection metrics, `verbose` to include extra diagnostics (the `databaseVersion` field is currently a placeholder), and a custom `logger`.

```typescript
import { performHealthCheck } from '@kysera/infra/health'

const result = await performHealthCheck(db, {
  pool: metricsPool,
  verbose: true
})
```

## Pool Metrics

`createMetricsPool` wraps a driver connection pool (without mutating it) and adds a `getMetrics()` method returning `{ total, active, idle, waiting }`. Pass the wrapped pool to the health check functions to get `poolMetrics` in results.

```typescript
import { Pool } from 'pg'
import { createMetricsPool } from '@kysera/infra/pool'
import { checkDatabaseHealth } from '@kysera/infra/health'

const pool = new Pool({ connectionString: 'postgresql://localhost/app', max: 10 })
const metricsPool = createMetricsPool(pool)

const result = await checkDatabaseHealth(db, metricsPool)
console.log(result.metrics?.poolMetrics)
// { totalConnections: 10, activeConnections: 2, idleConnections: 8, waitingRequests: 0 }
```

Driver detection happens once, at creation time:

- **`pg`** (PostgreSQL) — real metrics from `totalCount` / `idleCount` / `waitingCount`
- **`mysql2`** — real metrics from the internal connection lists; `waiting` is always `0` (mysql2 does not expose it)
- **`better-sqlite3`** — SQLite has no pooling; reports a static single connection (`total: 1`)
- **tarn.js** (the pool behind kysely's `MssqlDialect` and knex) — real metrics from `numUsed()` / `numFree()` / `numPendingAcquires()`, if you hold the pool object yourself (kysely's `MssqlDialect` builds its tarn pool internally and doesn't expose it)
- **Anything else** — static placeholder values (`{ total: 10, idle: 0, active: 0, waiting: 0 }`)

Every result includes `detected: boolean` — `true` when the numbers came from a recognized pool, `false` for the placeholder values. Alert on real saturation, never on `detected: false` numbers.

## Continuous Monitoring

`HealthMonitor` runs `checkDatabaseHealth` on an interval and reports each result to a callback. Overlapping checks are skipped (if a check outlives the interval, the next tick is dropped rather than stacked).

```typescript
import { HealthMonitor } from '@kysera/infra/health'

const monitor = new HealthMonitor(db, {
  intervalMs: 30_000, // default: 30000
  pool: metricsPool,  // optional
  logger: myLogger    // optional
})

monitor.start(result => {
  if (result.status !== 'healthy') {
    alerting.notify(`Database ${result.status}`, result.errors)
  }
})

monitor.isRunning()      // true
monitor.getLastCheck()   // last HealthCheckResult (or undefined)
await monitor.checkNow() // immediate out-of-band check

monitor.destroy() // stops the interval (alias for stop())
```

`HealthMonitor` implements `Disposable`, so with explicit resource management (TypeScript 5.2+) it stops itself when the scope exits:

```typescript
{
  using monitor = new HealthMonitor(db, { intervalMs: 30_000 })
  monitor.start()
  // ...
} // Symbol.dispose runs automatically and stops the monitor
```

## Retry with Backoff

`withRetry` re-executes a function on transient failures with exponential backoff and jitter:

```typescript
import { withRetry } from '@kysera/infra/resilience'

const users = await withRetry(() => db.selectFrom('users').selectAll().execute())

const order = await withRetry(
  () => db.insertInto('orders').values(orderData).execute(),
  {
    maxAttempts: 5,
    delayMs: 500,
    maxDelayMs: 10_000,
    onRetry: (attempt, error) => console.warn(`Retry #${attempt}`, error)
  }
)
```

`RetryOptions` and their defaults:

| Option         | Default            | Meaning                                                |
| -------------- | ------------------ | ------------------------------------------------------ |
| `maxAttempts`  | `3`                | Total attempts (must be at least 1)                    |
| `delayMs`      | `1000`             | Initial delay between attempts                         |
| `maxDelayMs`   | `30000`            | Cap for exponential backoff (must be ≥ `delayMs`)      |
| `backoff`      | `true`             | Exponential backoff (`delayMs * 2^attempt`)            |
| `jitterFactor` | `0.25`             | Randomizes each delay by ±25% to avoid thundering herd |
| `shouldRetry`  | `isTransientError` | Predicate deciding whether an error is retryable       |
| `onRetry`      | —                  | `(attempt, error)` callback before each retry          |

The default predicate, `isTransientError`, checks the error's `code` (and `number`, for MSSQL) against known transient families:

- **Network**: `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, `EPIPE`
- **PostgreSQL**: connection-failure class (`08000`, `08001`, `08003`, `08004`, `08006`, `57P01`–`57P03`), serialization failure `40001`, deadlock `40P01`
- **MySQL**: `ER_LOCK_DEADLOCK`, `ER_LOCK_WAIT_TIMEOUT`, `ER_CON_COUNT_ERROR`, `PROTOCOL_CONNECTION_LOST`
- **SQLite**: `SQLITE_BUSY`, `SQLITE_LOCKED`
- **MSSQL**: timeout (`-2`), deadlock (`1205`), lock timeout (`1222`), connection errors (`-1`, `233`, `10054`, `10053`)

To make a reusable retrying function instead of wrapping call sites, use `createRetryWrapper`:

```typescript
import { createRetryWrapper } from '@kysera/infra/resilience'

const fetchUser = (id: number) =>
  db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()

const fetchUserWithRetry = createRetryWrapper(fetchUser, { maxAttempts: 3 })

const user = await fetchUserWithRetry(42)
```

### Retrying Whole Transactions

`withRetry` re-runs a *function*; that is wrong for transactions that lose a
serialization race — the failed transaction is rolled back, and the retry
must be a **new transaction** that re-reads current data. Use
`withTransactionRetry` for that:

```typescript
import { withTransactionRetry } from '@kysera/infra/resilience'

await withTransactionRetry(
  db, // Kysely or KyseraExecutor — plugins stay active inside attempts
  async trx => {
    // Optional: escalate isolation — re-applied on every attempt because
    // each attempt is a brand-new transaction
    // await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`.execute(trx)

    const seat = await trx
      .selectFrom('seats')
      .where('id', '=', seatId)
      .where('status', '=', 'free')
      .selectAll()
      .executeTakeFirst()
    if (!seat) throw new SeatTakenError(seatId)
    await trx.updateTable('seats').where('id', '=', seatId)
      .set({ status: 'held', held_by: userId }).execute()
  },
  { maxAttempts: 5, onRetry: attempt => metrics.increment('txn_retry') }
)
```

It retries only genuine "re-run me" errors (`isSerializationError`): PostgreSQL
`40001`/`40P01`, MySQL 1213/1205, MSSQL 1205 (deadlock victim), SQLite
`SQLITE_BUSY*`. Connection errors are deliberately **not** retried — a
transaction that died mid-commit may have committed, so blindly re-running it
could double-apply. Keep external side effects (emails, queue publishes)
out of the callback: every attempt re-executes it from the top.

## Circuit Breaker

`CircuitBreaker` fails fast once a failure threshold is reached, instead of hammering a database that is already down. States: `closed` (normal), `open` (rejecting immediately), `half-open` (after `resetTimeMs`, one probe request is allowed through; success closes the circuit, failure reopens it). A success while closed resets the consecutive-failure counter.

```typescript
import { CircuitBreaker, CircuitBreakerError } from '@kysera/infra/resilience'

// Positional form: threshold, resetTimeMs
const breaker = new CircuitBreaker(5, 60_000)

// Or the options form
const breaker2 = new CircuitBreaker({
  threshold: 5,       // default: 5 failures
  resetTimeMs: 60_000, // default: 60000
  onStateChange: (next, prev) => console.log(`circuit: ${prev} -> ${next}`)
})

try {
  const orders = await breaker.execute(() =>
    db.selectFrom('orders').selectAll().execute()
  )
} catch (error) {
  if (error instanceof CircuitBreakerError) {
    // Circuit is open — serve a fallback, do not retry immediately
  } else {
    throw error
  }
}
```

Inspection is synchronous; state mutation is asynchronous (mutex-guarded):

```typescript
breaker.getState() // { state, failures, lastFailureTime, isTestingHalfOpen }
breaker.isOpen()   // boolean
breaker.isClosed() // boolean

await breaker.reset()     // force back to closed
await breaker.forceOpen() // manual intervention: trip the circuit
```

Retry and breaker compose naturally — retry *inside* the breaker so retries count as one protected call:

```typescript
const rows = await breaker.execute(() =>
  withRetry(() => db.selectFrom('users').selectAll().execute())
)
```

## Graceful Shutdown

`gracefulShutdown` runs an optional `onShutdown` hook, then `db.destroy()`, racing against a timeout (default 30 s; it rejects with a timeout error if exceeded). `registerShutdownHandlers` wires this to process signals:

```typescript
import { registerShutdownHandlers } from '@kysera/infra/shutdown'

registerShutdownHandlers(db, {
  signals: ['SIGTERM', 'SIGINT'], // default
  timeout: 10_000,                // default: 30000
  onShutdown: async () => {
    monitor.destroy()
    await flushPendingWork()
  }
})
```

On a signal it closes the database and exits with code 0 (or 1 on failure). Duplicate signals during shutdown are ignored. In runtimes without process signal support it logs a warning and registers nothing — use `createShutdownController` for manual control there:

```typescript
import { createShutdownController } from '@kysera/infra/shutdown'

const shutdown = createShutdownController(db, { timeout: 10_000 })

shutdown.registerSignals()   // same as registerShutdownHandlers
await shutdown.execute()     // or trigger manually (idempotent)
shutdown.isShuttingDown()    // boolean
```

`shutdownDatabase(db)` is a plain `db.destroy()` wrapper for symmetry.

### What Actually Drains (and What Doesn't)

`gracefulShutdown` adds a timeout and a hook around `db.destroy()` — the
draining itself is the driver's behavior:

- **In-flight queries finish.** The `pg` driver's `destroy()` is
  `pool.end()`, which waits for checked-out connections instead of killing
  them (verified by an integration test against live PostgreSQL); `mysql2`
  behaves the same.
- **New queries are not blocked.** Anything issued after destroy begins
  fails with "driver has already been destroyed". Shutdown is not a request
  gate.
- **The `timeout` rejects, it does not cancel.** After a timeout rejection,
  the underlying `destroy()` continues in the background.

So the drain order is on you: **stop intake first** (close the HTTP server,
stop pulling jobs), **await your in-flight work**, and only then call
`gracefulShutdown` — exactly what the `onShutdown` hook is for.

## Query Metrics

`getMetrics` from `@kysera/infra/health` aggregates real query statistics — but only from a database wrapped with `withDebug` from [`@kysera/debug`](/docs/api/debug), which is what collects per-query timings.

{/* doc-snippet: skip */}
```typescript
import { withDebug } from '@kysera/debug'
import { getMetrics, hasDatabaseMetrics } from '@kysera/infra/health'

const debugDb = withDebug(db, { maxMetrics: 1000, logQuery: false })

// Run traffic through debugDb...
await debugDb.selectFrom('users').selectAll().execute()

// Synchronous — no await
const metrics = getMetrics(debugDb, {
  slowQueryThreshold: 100, // ms, default: 100
  pool: metricsPool        // optional: adds connection stats
})

console.log(metrics.queries)
// { total, avgDuration, minDuration, maxDuration, p95Duration, p99Duration, slowCount }
console.log(metrics.recommendations)
// e.g. ['High number of slow queries detected (12/100). ...']
```

:::warning

`getMetrics` **throws** if the instance was not wrapped with `withDebug` — there is nothing to aggregate otherwise. Guard with `hasDatabaseMetrics(db)` when the wrapping is conditional (e.g. only enabled in staging).

:::

## Putting It Together

A minimal production bootstrap combining the pieces:

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { createMetricsPool } from '@kysera/infra/pool'
import { HealthMonitor } from '@kysera/infra/health'
import { withRetry, CircuitBreaker } from '@kysera/infra/resilience'
import { registerShutdownHandlers } from '@kysera/infra/shutdown'

interface Database {
  users: { id: number; email: string; name: string }
  orders: { id: number; user_id: number; status: string }
}

const pool = new Pool({ connectionString: 'postgresql://localhost/app', max: 10 })
const metricsPool = createMetricsPool(pool)

const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })

// Periodic health checks feeding your alerting
const monitor = new HealthMonitor(db, { pool: metricsPool, intervalMs: 30_000 })
monitor.start(result => {
  if (result.status === 'unhealthy') console.error('DB unhealthy', result.errors)
})

// One breaker for the database as a dependency
const breaker = new CircuitBreaker({ threshold: 5, resetTimeMs: 60_000 })

export function resilient<T>(fn: () => Promise<T>): Promise<T> {
  return breaker.execute(() => withRetry(fn))
}

// Clean exit on SIGTERM/SIGINT
registerShutdownHandlers(db, {
  timeout: 10_000,
  onShutdown: () => {
    monitor.destroy()
  }
})
```

Expose the health check on an endpoint (`/healthz` returning 200/503 based on `result.status`) and you have the full loop: liveness for your orchestrator, metrics for capacity planning, resilience for transient faults, and clean connection teardown on deploys.

## Related

- [Best Practices](/docs/guides/best-practices) — general production patterns
- [@kysera/infra API Reference](/docs/api/infra)
- [@kysera/debug API Reference](/docs/api/debug) — query logging and profiling
- [Troubleshooting](/docs/guides/troubleshooting)
