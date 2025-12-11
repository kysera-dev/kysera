# @kysera/infra

Infrastructure utilities for Kysera - production-ready health monitoring, resilience patterns, and graceful shutdown for database applications.

## Installation

```bash
# npm
npm install @kysera/infra kysely

# pnpm
pnpm add @kysera/infra kysely

# bun
bun add @kysera/infra kysely
```

## Features

- **Health Monitoring** - Database connectivity checks with latency tracking
- **Retry Logic** - Automatic retries with exponential backoff for transient errors
- **Circuit Breaker** - Prevent cascading failures when database is unavailable
- **Graceful Shutdown** - Clean database connection termination
- **Pool Metrics** - Connection pool monitoring for PostgreSQL, MySQL, and SQLite
- **TypeScript First** - Full type safety with strict TypeScript
- **Zero Dependencies** - Only peer dependency is Kysely
- **Cross-Runtime** - Works in Node.js, Bun, and Deno

## Quick Start

```typescript
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import {
  checkDatabaseHealth,
  HealthMonitor,
  withRetry,
  CircuitBreaker,
  registerShutdownHandlers,
  createMetricsPool,
} from '@kysera/infra';

// Create database connection
const pgPool = new pg.Pool({
  host: 'localhost',
  database: 'mydb',
  max: 10,
});

const db = new Kysely({
  dialect: new PostgresDialect({ pool: pgPool }),
});

// Create metrics-enabled pool
const metricsPool = createMetricsPool(pgPool);

// 1. Health monitoring
const monitor = new HealthMonitor(db, {
  pool: metricsPool,
  intervalMs: 30000,
});

monitor.start((result) => {
  if (result.status !== 'healthy') {
    console.warn('Database health issue:', result);
  }
});

// 2. Resilience patterns
const breaker = new CircuitBreaker(5, 60000);

const users = await breaker.execute(() =>
  withRetry(() => db.selectFrom('users').selectAll().execute())
);

// 3. Graceful shutdown
registerShutdownHandlers(db, {
  timeout: 10000,
  onShutdown: async () => {
    monitor.stop();
    console.log('Cleanup complete');
  },
});
```

## Modules

The package is organized into four main modules, each available as a subpath export:

- `@kysera/infra/health` - Health checks and monitoring
- `@kysera/infra/resilience` - Retry and circuit breaker patterns
- `@kysera/infra/pool` - Connection pool metrics
- `@kysera/infra/shutdown` - Graceful shutdown utilities

You can also import everything from the main entry point:

```typescript
import { checkDatabaseHealth, withRetry, CircuitBreaker } from '@kysera/infra';
```

## Health Monitoring

### Health Checks

Check database connectivity and measure response latency:

```typescript
import { checkDatabaseHealth } from '@kysera/infra/health';

const result = await checkDatabaseHealth(db);

console.log(result.status); // 'healthy' | 'degraded' | 'unhealthy'
console.log(result.metrics?.checkLatency); // Response time in ms
console.log(result.checks); // Individual check results
```

**Health Status Levels:**

- `healthy` - Latency < 100ms
- `degraded` - Latency 100-500ms
- `unhealthy` - Latency > 500ms or connection failed

### Health Checks with Pool Metrics

Include connection pool metrics in health checks:

```typescript
import { checkDatabaseHealth } from '@kysera/infra/health';
import { createMetricsPool } from '@kysera/infra/pool';

const metricsPool = createMetricsPool(pgPool);
const result = await checkDatabaseHealth(db, metricsPool);

console.log(result.metrics?.poolMetrics);
// {
//   totalConnections: 10,
//   activeConnections: 2,
//   idleConnections: 8,
//   waitingRequests: 0
// }
```

### Comprehensive Health Check

Use `performHealthCheck` for extended diagnostics:

```typescript
import { performHealthCheck } from '@kysera/infra/health';

const result = await performHealthCheck(db, {
  verbose: true,
  pool: metricsPool,
  logger: customLogger,
});
```

### Continuous Health Monitoring

Monitor database health at regular intervals:

```typescript
import { HealthMonitor } from '@kysera/infra/health';

const monitor = new HealthMonitor(db, {
  pool: metricsPool,
  intervalMs: 30000, // Check every 30 seconds
  logger: customLogger,
});

// Start monitoring with callback
monitor.start((result) => {
  if (result.status !== 'healthy') {
    console.warn('Health degraded:', result);
    // Send alert, log to monitoring system, etc.
  }
});

// Check if running
console.log(monitor.isRunning()); // true

// Get last check result
const lastCheck = monitor.getLastCheck();

// Perform immediate check
const immediateCheck = await monitor.checkNow();

// Stop monitoring
monitor.stop();
```

### Query Metrics

Get real query performance metrics from executed queries:

```typescript
import { withDebug } from '@kysera/debug';
import { getMetrics } from '@kysera/infra/health';

// Enable metrics tracking
const debugDb = withDebug(db, { maxMetrics: 1000 });

// Perform some queries
await debugDb.selectFrom('users').selectAll().execute();
await debugDb.selectFrom('orders').selectAll().execute();

// Get metrics from actual execution
const metrics = getMetrics(debugDb, {
  slowQueryThreshold: 100,
  pool: metricsPool,
});

console.log(metrics.queries);
// {
//   total: 150,
//   avgDuration: 45.32,
//   minDuration: 2.15,
//   maxDuration: 234.56,
//   p95Duration: 120.45,
//   p99Duration: 180.23,
//   slowCount: 12
// }

console.log(metrics.recommendations);
// [
//   "High number of slow queries detected (12/150). Consider query optimization or indexing."
// ]
```

**Important:** `getMetrics` requires the database to be wrapped with `withDebug()` from `@kysera/debug` to track query execution metrics. Without this, it will throw an error.

## Resilience Patterns

### Retry with Exponential Backoff

Automatically retry operations that fail with transient errors:

```typescript
import { withRetry } from '@kysera/infra/resilience';

// Basic retry (defaults: 3 attempts, 1s delay, exponential backoff)
const users = await withRetry(() =>
  db.selectFrom('users').selectAll().execute()
);

// Custom retry configuration
const result = await withRetry(
  () => db.insertInto('orders').values(orderData).execute(),
  {
    maxAttempts: 5,
    delayMs: 500,
    backoff: true, // Exponential backoff
    onRetry: (attempt, error) => {
      console.log(`Retry attempt ${attempt}:`, error);
    },
    shouldRetry: (error) => {
      // Custom retry logic
      return isTransientError(error) || isCustomRetryableError(error);
    },
  }
);
```

**Transient Error Codes:**

The `isTransientError` function recognizes these error codes:

- **Network:** `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, `EPIPE`
- **PostgreSQL:** `57P03`, `08006`, `08001`, `08003`, `08004`, `40001`, `40P01`
- **MySQL:** `ER_LOCK_DEADLOCK`, `ER_LOCK_WAIT_TIMEOUT`, `ER_CON_COUNT_ERROR`
- **SQLite:** `SQLITE_BUSY`, `SQLITE_LOCKED`

### Reusable Retry Wrapper

Create retry-enabled functions:

```typescript
import { createRetryWrapper } from '@kysera/infra/resilience';

const fetchUsers = async (limit: number) =>
  db.selectFrom('users').limit(limit).selectAll().execute();

const fetchUsersWithRetry = createRetryWrapper(fetchUsers, {
  maxAttempts: 3,
  delayMs: 1000,
});

// Use the wrapped function
const users = await fetchUsersWithRetry(100);
```

### Circuit Breaker

Prevent cascading failures by failing fast when a service is unavailable:

```typescript
import { CircuitBreaker } from '@kysera/infra/resilience';

const breaker = new CircuitBreaker({
  threshold: 5, // Open after 5 failures
  resetTimeMs: 60000, // Try again after 1 minute
  onStateChange: (newState, oldState) => {
    console.log(`Circuit: ${oldState} -> ${newState}`);
  },
});

// Execute with circuit breaker protection
try {
  const result = await breaker.execute(() =>
    db.selectFrom('users').execute()
  );
} catch (error) {
  if (error.message.includes('Circuit breaker is open')) {
    // Service unavailable, handle gracefully
    console.log('Service temporarily unavailable');
  }
}

// Check circuit state
console.log(breaker.getState());
// {
//   state: 'open',
//   failures: 5,
//   lastFailureTime: 1678901234567
// }

// Manual control
breaker.reset(); // Reset to closed
breaker.forceOpen(); // Force open for maintenance
console.log(breaker.isOpen()); // true
console.log(breaker.isClosed()); // false
```

**Circuit States:**

- `closed` - Normal operation, all requests pass through
- `open` - Too many failures, requests fail immediately
- `half-open` - Testing recovery, allows one request

### Combining Retry and Circuit Breaker

Use both patterns together for maximum resilience:

```typescript
import { withRetry, CircuitBreaker } from '@kysera/infra/resilience';

const breaker = new CircuitBreaker(5, 60000);

const result = await breaker.execute(() =>
  withRetry(() => db.selectFrom('users').execute(), {
    maxAttempts: 3,
    delayMs: 1000,
  })
);
```

## Connection Pool Metrics

Extract metrics from different database connection pools:

### PostgreSQL Pool

```typescript
import pg from 'pg';
import { createMetricsPool } from '@kysera/infra/pool';

const pgPool = new pg.Pool({
  host: 'localhost',
  database: 'mydb',
  max: 10,
});

const metricsPool = createMetricsPool(pgPool);

const metrics = metricsPool.getMetrics();
console.log(metrics);
// {
//   total: 10,
//   idle: 8,
//   active: 2,
//   waiting: 0
// }
```

### MySQL Pool

```typescript
import mysql from 'mysql2/promise';
import { createMetricsPool } from '@kysera/infra/pool';

const mysqlPool = mysql.createPool({
  host: 'localhost',
  database: 'mydb',
  connectionLimit: 10,
});

const metricsPool = createMetricsPool(mysqlPool);
const metrics = metricsPool.getMetrics();
```

### SQLite (Single Connection)

```typescript
import Database from 'better-sqlite3';
import { createMetricsPool } from '@kysera/infra/pool';

const sqliteDb = new Database(':memory:');
const metricsPool = createMetricsPool(sqliteDb as unknown as DatabasePool);

const metrics = metricsPool.getMetrics();
// {
//   total: 1,
//   idle: 0,
//   active: 1,
//   waiting: 0
// }
```

### Type Guard

Check if a pool has metrics capabilities:

```typescript
import { isMetricsPool } from '@kysera/infra/pool';

if (isMetricsPool(pool)) {
  const metrics = pool.getMetrics();
}
```

## Graceful Shutdown

### Automatic Shutdown Handlers

Register signal handlers for clean shutdown:

```typescript
import { registerShutdownHandlers } from '@kysera/infra/shutdown';

registerShutdownHandlers(db, {
  signals: ['SIGTERM', 'SIGINT'], // Default
  timeout: 30000,
  onShutdown: async () => {
    console.log('Cleaning up...');
    await flushCache();
    monitor.stop();
  },
  logger: customLogger,
});

// Now when you press Ctrl+C or send SIGTERM:
// 1. onShutdown callback runs
// 2. Database connections close
// 3. Process exits cleanly
```

### Manual Shutdown

Trigger shutdown programmatically:

```typescript
import { gracefulShutdown } from '@kysera/infra/shutdown';

// Basic shutdown
await gracefulShutdown(db);

// With custom handler and timeout
await gracefulShutdown(db, {
  timeout: 10000,
  onShutdown: async () => {
    console.log('Flushing pending writes...');
    await flushWrites();
  },
});
```

### Simple Shutdown

Direct database termination:

```typescript
import { shutdownDatabase } from '@kysera/infra/shutdown';

await shutdownDatabase(db);
```

### Shutdown Controller

Advanced shutdown management with more control:

```typescript
import { createShutdownController } from '@kysera/infra/shutdown';

const shutdown = createShutdownController(db, {
  timeout: 10000,
  onShutdown: async () => {
    console.log('Cleanup starting...');
  },
});

// Option 1: Register signal handlers
shutdown.registerSignals();

// Option 2: Manual shutdown
async function handleCustomEvent() {
  if (!shutdown.isShuttingDown()) {
    await shutdown.execute();
  }
}

// Check shutdown status
if (shutdown.isShuttingDown()) {
  console.log('Shutdown in progress...');
}
```

## API Reference

### Health Module (`@kysera/infra/health`)

#### Functions

- `checkDatabaseHealth<DB>(db: Kysely<DB>, pool?: MetricsPool): Promise<HealthCheckResult>` - Perform basic health check
- `performHealthCheck<DB>(db: Kysely<DB>, options?: HealthCheckOptions): Promise<HealthCheckResult>` - Comprehensive health check with options
- `getMetrics<DB>(db: Kysely<DB> & DatabaseWithMetrics<DB>, options?: GetMetricsOptions): MetricsResult` - Get query performance metrics
- `hasDatabaseMetrics<DB>(db: Kysely<DB>): boolean` - Check if database has metrics tracking

#### Classes

- `HealthMonitor<DB>` - Continuous health monitoring
  - `constructor(db: Kysely<DB>, options?: HealthMonitorOptions)`
  - `start(onCheck?: HealthCheckCallback): void`
  - `stop(): void`
  - `checkNow(): Promise<HealthCheckResult>`
  - `getLastCheck(): HealthCheckResult | undefined`
  - `isRunning(): boolean`

#### Types

```typescript
type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface HealthCheckResult {
  status: HealthStatus;
  checks: HealthCheck[];
  errors?: string[];
  metrics?: HealthMetrics;
  timestamp: Date;
}

interface HealthCheckOptions {
  pool?: MetricsPool;
  verbose?: boolean;
  logger?: KyseraLogger;
}

interface HealthMonitorOptions {
  pool?: MetricsPool;
  intervalMs?: number; // Default: 30000
  logger?: KyseraLogger;
}

interface GetMetricsOptions {
  period?: string; // Default: '1h'
  pool?: MetricsPool;
  slowQueryThreshold?: number; // Default: 100
}

interface MetricsResult {
  period: string;
  timestamp: string;
  connections?: {
    total: number;
    active: number;
    idle: number;
    max: number;
  };
  queries?: {
    total: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    p95Duration: number;
    p99Duration: number;
    slowCount: number;
  };
  recommendations?: string[];
}
```

### Resilience Module (`@kysera/infra/resilience`)

#### Functions

- `withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>` - Retry with exponential backoff
- `createRetryWrapper<TArgs, TResult>(fn: (...args: TArgs) => Promise<TResult>, options?: RetryOptions): (...args: TArgs) => Promise<TResult>` - Create reusable retry wrapper
- `isTransientError(error: unknown): boolean` - Check if error is transient

#### Classes

- `CircuitBreaker` - Circuit breaker pattern
  - `constructor(thresholdOrOptions: number | CircuitBreakerOptions, resetTimeMs?: number)`
  - `execute<T>(fn: () => Promise<T>): Promise<T>`
  - `reset(): void`
  - `getState(): CircuitBreakerState`
  - `isOpen(): boolean`
  - `isClosed(): boolean`
  - `forceOpen(): void`

#### Types

```typescript
interface RetryOptions {
  maxAttempts?: number; // Default: 3
  delayMs?: number; // Default: 1000
  backoff?: boolean; // Default: true
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  threshold?: number; // Default: 5
  resetTimeMs?: number; // Default: 60000
  onStateChange?: (newState: CircuitState, previousState: CircuitState) => void;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureTime: number | undefined;
}
```

### Pool Module (`@kysera/infra/pool`)

#### Functions

- `createMetricsPool(pool: DatabasePool): MetricsPool` - Add metrics to any pool
- `isMetricsPool(pool: DatabasePool): boolean` - Type guard for metrics pool

#### Types

```typescript
interface PoolMetrics {
  total: number;
  idle: number;
  active: number;
  waiting: number;
}

interface DatabasePool {
  end(): Promise<void> | void;
  query?(sql: string, values?: unknown[]): Promise<unknown>;
}

interface MetricsPool extends DatabasePool {
  getMetrics(): PoolMetrics;
}
```

### Shutdown Module (`@kysera/infra/shutdown`)

#### Functions

- `gracefulShutdown<DB>(db: Kysely<DB>, options?: ShutdownOptions): Promise<void>` - Graceful shutdown with timeout
- `shutdownDatabase<DB>(db: Kysely<DB>): Promise<void>` - Simple database shutdown
- `registerShutdownHandlers<DB>(db: Kysely<DB>, options?: RegisterShutdownOptions): void` - Register signal handlers
- `createShutdownController<DB>(db: Kysely<DB>, options?: RegisterShutdownOptions)` - Create shutdown controller

#### Types

```typescript
interface ShutdownOptions {
  timeout?: number; // Default: 30000
  onShutdown?: () => void | Promise<void>;
  logger?: KyseraLogger;
}

interface RegisterShutdownOptions extends ShutdownOptions {
  signals?: NodeJS.Signals[]; // Default: ['SIGTERM', 'SIGINT']
}
```

## Complete Example

```typescript
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import {
  HealthMonitor,
  CircuitBreaker,
  withRetry,
  createMetricsPool,
  registerShutdownHandlers,
  getMetrics,
} from '@kysera/infra';
import { withDebug } from '@kysera/debug';

// 1. Setup database connection
const pgPool = new pg.Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  max: 20,
});

const db = new Kysely({
  dialect: new PostgresDialect({ pool: pgPool }),
});

// 2. Enable metrics tracking
const metricsPool = createMetricsPool(pgPool);
const debugDb = withDebug(db, { maxMetrics: 1000 });

// 3. Setup health monitoring
const monitor = new HealthMonitor(debugDb, {
  pool: metricsPool,
  intervalMs: 30000,
});

monitor.start((result) => {
  if (result.status !== 'healthy') {
    console.error('Health check failed:', result);
  }
});

// 4. Setup resilience patterns
const breaker = new CircuitBreaker({
  threshold: 5,
  resetTimeMs: 60000,
  onStateChange: (newState, prevState) => {
    console.log(`Circuit breaker: ${prevState} -> ${newState}`);
  },
});

// 5. Create resilient database operations
async function getUsers(limit: number) {
  return await breaker.execute(() =>
    withRetry(() => debugDb.selectFrom('users').limit(limit).execute(), {
      maxAttempts: 3,
      delayMs: 1000,
    })
  );
}

// 6. Setup graceful shutdown
registerShutdownHandlers(debugDb, {
  timeout: 15000,
  onShutdown: async () => {
    console.log('Shutting down gracefully...');
    monitor.stop();

    // Log final metrics
    const finalMetrics = getMetrics(debugDb, {
      pool: metricsPool,
      slowQueryThreshold: 100,
    });
    console.log('Final query metrics:', finalMetrics);
  },
});

// 7. Use in your application
try {
  const users = await getUsers(100);
  console.log(`Fetched ${users.length} users`);

  // Get current metrics
  const metrics = getMetrics(debugDb, {
    pool: metricsPool,
    slowQueryThreshold: 100,
  });

  if (metrics.recommendations && metrics.recommendations.length > 0) {
    console.warn('Performance recommendations:', metrics.recommendations);
  }
} catch (error) {
  console.error('Operation failed:', error);
}
```

## Best Practices

1. **Always use health monitoring in production** - Detect issues before they affect users
2. **Combine retry and circuit breaker** - Retry for transient errors, circuit breaker for sustained failures
3. **Set appropriate timeouts** - Match your application's SLA requirements
4. **Monitor pool metrics** - Watch for connection exhaustion
5. **Register shutdown handlers early** - Prevent connection leaks on termination
6. **Use custom retry logic** - Tailor retry behavior to your specific error scenarios
7. **Track query metrics** - Use `withDebug` and `getMetrics` to identify performance issues

## Runtime Support

- **Node.js** - v20.0.0 or higher
- **Bun** - v1.0.0 or higher
- **Deno** - Latest version (with npm compatibility)

## License

MIT

## Contributing

See the main [Kysera repository](https://github.com/kysera-dev/kysera) for contribution guidelines.

## Related Packages

- `@kysera/core` - Core utilities and types
- `@kysera/debug` - Debug plugin for query tracking (required for `getMetrics`)
- `@kysera/repository` - Repository pattern implementation
- `kysely` - The underlying query builder (peer dependency)
