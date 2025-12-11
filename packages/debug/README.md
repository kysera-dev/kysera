# @kysera/debug

Debug utilities for Kysera - query logging, profiling, SQL formatting, and performance analysis.

## Installation

```bash
# npm
npm install @kysera/debug

# pnpm
pnpm add @kysera/debug

# yarn
yarn add @kysera/debug

# bun
bun add @kysera/debug
```

## Features

- **Query Logging** - Automatic logging of SQL queries and execution times
- **Performance Metrics** - Collect and analyze query performance data
- **Slow Query Detection** - Identify and alert on slow database queries
- **SQL Formatting** - Format and highlight SQL for better readability
- **Query Profiling** - Detailed performance analysis with statistics
- **Circular Buffer** - Memory-efficient metrics storage with automatic cleanup
- **Zero Dependencies** - Only depends on `@kysera/core` and peer-depends on `kysely`

## Quick Start

```typescript
import { Kysely } from 'kysely';
import { withDebug } from '@kysera/debug';

// Wrap your database with debug capabilities
const db = new Kysely<Database>({ /* config */ });
const debugDb = withDebug(db);

// Execute queries - they're automatically logged and timed
await debugDb.selectFrom('users').selectAll().execute();

// Get collected metrics
const metrics = debugDb.getMetrics();
console.log(`Executed ${metrics.length} queries`);
```

## API Documentation

### withDebug()

Wraps a Kysely database instance with debug capabilities, adding query logging, metrics collection, and slow query detection.

```typescript
function withDebug<DB>(
  db: Kysely<DB>,
  options?: DebugOptions
): DebugDatabase<DB>
```

#### Parameters

- `db` - Kysely database instance to wrap
- `options` - Optional debug configuration

#### Returns

`DebugDatabase<DB>` - Enhanced database instance with debug methods

#### Example

```typescript
import { withDebug } from '@kysera/debug';

const debugDb = withDebug(db, {
  logQuery: true,
  logParams: true,
  slowQueryThreshold: 100,
  maxMetrics: 1000,
  onSlowQuery: (sql, duration) => {
    console.warn(`Slow query detected: ${duration}ms`);
  },
});
```

### DebugOptions

Configuration options for the debug plugin.

```typescript
interface DebugOptions {
  /**
   * Log query SQL.
   * @default true
   */
  logQuery?: boolean;

  /**
   * Log query parameters.
   * @default false
   */
  logParams?: boolean;

  /**
   * Duration threshold (ms) to consider a query slow.
   * @default 100
   */
  slowQueryThreshold?: number;

  /**
   * Callback for slow queries.
   */
  onSlowQuery?: (sql: string, duration: number) => void;

  /**
   * Logger for debug messages.
   * @default consoleLogger
   */
  logger?: KyseraLogger;

  /**
   * Maximum number of metrics to keep in memory.
   * When limit is reached, oldest metrics are removed (circular buffer).
   * @default 1000
   */
  maxMetrics?: number;
}
```

### DebugDatabase

Extended database interface with debug capabilities.

```typescript
interface DebugDatabase<DB> extends Kysely<DB> {
  /** Get all collected query metrics */
  getMetrics(): QueryMetrics[];

  /** Clear all collected metrics */
  clearMetrics(): void;
}
```

#### Methods

##### getMetrics()

Returns all collected query metrics.

```typescript
const metrics = debugDb.getMetrics();
console.log(`Total queries: ${metrics.length}`);
console.log(`Average duration: ${metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length}ms`);
```

##### clearMetrics()

Clears all collected metrics from memory.

```typescript
debugDb.clearMetrics();
```

### QueryMetrics

Query performance metrics data.

```typescript
interface QueryMetrics {
  /** SQL query string */
  sql: string;

  /** Query parameters */
  params?: unknown[];

  /** Query execution duration in milliseconds */
  duration: number;

  /** Timestamp when query was executed */
  timestamp: number;
}
```

### QueryProfiler

Advanced query profiler for collecting and analyzing query performance with detailed statistics.

```typescript
class QueryProfiler {
  constructor(options?: ProfilerOptions);

  /** Record a query metric */
  record(metric: QueryMetrics): void;

  /** Get profiling summary */
  getSummary(): ProfilerSummary;

  /** Get the slowest N queries */
  getSlowestQueries(count: number): QueryMetrics[];

  /** Get queries slower than a threshold */
  getSlowQueries(thresholdMs: number): QueryMetrics[];

  /** Clear all recorded queries */
  clear(): void;

  /** Get the number of recorded queries */
  get count(): number;
}
```

#### Example

```typescript
import { QueryProfiler } from '@kysera/debug';

const profiler = new QueryProfiler({ maxQueries: 500 });

// Record queries manually
profiler.record({
  sql: 'SELECT * FROM users WHERE id = $1',
  params: [123],
  duration: 10.5,
  timestamp: Date.now(),
});

// Get summary
const summary = profiler.getSummary();
console.log(`Total queries: ${summary.totalQueries}`);
console.log(`Average duration: ${summary.averageDuration.toFixed(2)}ms`);
console.log(`Slowest query: ${summary.slowestQuery?.duration.toFixed(2)}ms`);

// Get slow queries
const slowQueries = profiler.getSlowQueries(50);
console.log(`Queries slower than 50ms: ${slowQueries.length}`);

// Get top 10 slowest
const top10 = profiler.getSlowestQueries(10);
```

### ProfilerOptions

Configuration options for QueryProfiler.

```typescript
interface ProfilerOptions {
  /**
   * Maximum number of queries to keep in memory.
   * @default 1000
   */
  maxQueries?: number;
}
```

### ProfilerSummary

Summary statistics from the query profiler.

```typescript
interface ProfilerSummary {
  /** Total number of recorded queries */
  totalQueries: number;

  /** Sum of all query durations */
  totalDuration: number;

  /** Average query duration */
  averageDuration: number;

  /** Slowest recorded query */
  slowestQuery: QueryMetrics | null;

  /** Fastest recorded query */
  fastestQuery: QueryMetrics | null;

  /** All recorded queries */
  queries: QueryMetrics[];
}
```

### SQL Formatting Functions

#### formatSQL()

Format SQL for better readability by adding newlines before major keywords.

```typescript
function formatSQL(sql: string): string
```

**Example:**

```typescript
import { formatSQL } from '@kysera/debug';

const sql = 'SELECT id, name FROM users WHERE active = true ORDER BY name';
console.log(formatSQL(sql));
// Output:
// SELECT id, name
// FROM users
// WHERE active = true
// ORDER BY name
```

#### formatSQLPretty()

Format SQL with indentation for nested queries and subqueries.

```typescript
function formatSQLPretty(sql: string, indentSize?: number): string
```

**Parameters:**
- `sql` - SQL string to format
- `indentSize` - Number of spaces for indentation (default: 2)

**Example:**

```typescript
import { formatSQLPretty } from '@kysera/debug';

const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 100)';
console.log(formatSQLPretty(sql));
// Output with proper indentation for subqueries
```

#### minifySQL()

Minify SQL by removing unnecessary whitespace.

```typescript
function minifySQL(sql: string): string
```

**Example:**

```typescript
import { minifySQL } from '@kysera/debug';

const sql = `
  SELECT id, name
  FROM users
  WHERE active = true
`;
console.log(minifySQL(sql));
// Output: SELECT id, name FROM users WHERE active = true
```

#### highlightSQL()

Highlight SQL keywords with ANSI color codes for terminal output.

```typescript
function highlightSQL(sql: string): string
```

**Example:**

```typescript
import { highlightSQL } from '@kysera/debug';

console.log(highlightSQL('SELECT * FROM users WHERE active = true'));
// Keywords will be highlighted in blue in terminal
```

## Usage Examples

### Basic Query Logging

```typescript
import { Kysely } from 'kysely';
import { withDebug } from '@kysera/debug';

const db = new Kysely<Database>({ /* config */ });
const debugDb = withDebug(db, {
  logQuery: true,
  logParams: false,
});

// Queries are automatically logged
await debugDb
  .selectFrom('users')
  .where('active', '=', true)
  .selectAll()
  .execute();
// Console output:
// [SQL] SELECT * FROM "users" WHERE "active" = $1
// [Duration] 12.34ms
```

### Detecting Slow Queries

```typescript
import { withDebug } from '@kysera/debug';

const debugDb = withDebug(db, {
  slowQueryThreshold: 50, // 50ms threshold
  onSlowQuery: (sql, duration) => {
    // Send to monitoring service
    monitoring.recordSlowQuery({ sql, duration });

    // Log to error tracking
    logger.warn(`Slow query detected: ${duration.toFixed(2)}ms`, { sql });
  },
});

// If query takes > 50ms, callback is triggered
await debugDb.selectFrom('users').selectAll().execute();
```

### Collecting and Analyzing Metrics

```typescript
import { withDebug, formatSQL } from '@kysera/debug';

const debugDb = withDebug(db, {
  maxMetrics: 500, // Keep last 500 queries
});

// Execute some queries
await debugDb.selectFrom('users').selectAll().execute();
await debugDb.selectFrom('posts').selectAll().execute();

// Analyze metrics
const metrics = debugDb.getMetrics();
const totalDuration = metrics.reduce((sum, m) => sum + m.duration, 0);
const avgDuration = totalDuration / metrics.length;

console.log(`Total queries: ${metrics.length}`);
console.log(`Average duration: ${avgDuration.toFixed(2)}ms`);

// Find slowest query
const slowest = metrics.reduce((max, m) =>
  m.duration > max.duration ? m : max
);
console.log('Slowest query:');
console.log(formatSQL(slowest.sql));
console.log(`Duration: ${slowest.duration.toFixed(2)}ms`);
```

### Advanced Profiling

```typescript
import { QueryProfiler } from '@kysera/debug';

const profiler = new QueryProfiler({ maxQueries: 1000 });

// Record queries from debug database
const debugDb = withDebug(db);
// ... execute queries ...

const metrics = debugDb.getMetrics();
metrics.forEach(m => profiler.record(m));

// Get comprehensive summary
const summary = profiler.getSummary();
console.log('Query Performance Summary:');
console.log(`  Total Queries: ${summary.totalQueries}`);
console.log(`  Total Time: ${summary.totalDuration.toFixed(2)}ms`);
console.log(`  Average: ${summary.averageDuration.toFixed(2)}ms`);
console.log(`  Slowest: ${summary.slowestQuery?.duration.toFixed(2)}ms`);
console.log(`  Fastest: ${summary.fastestQuery?.duration.toFixed(2)}ms`);

// Analyze slow queries
const slowQueries = profiler.getSlowQueries(100);
if (slowQueries.length > 0) {
  console.log(`\nFound ${slowQueries.length} queries slower than 100ms:`);
  slowQueries.forEach(q => {
    console.log(`  ${q.duration.toFixed(2)}ms: ${q.sql.substring(0, 80)}...`);
  });
}

// Get top 5 slowest
const top5 = profiler.getSlowestQueries(5);
console.log('\nTop 5 Slowest Queries:');
top5.forEach((q, i) => {
  console.log(`${i + 1}. ${q.duration.toFixed(2)}ms`);
  console.log(formatSQL(q.sql));
  console.log('');
});
```

### Custom Logger Integration

```typescript
import { withDebug } from '@kysera/debug';
import type { KyseraLogger } from '@kysera/core';

// Custom logger implementation
const customLogger: KyseraLogger = {
  debug: (message: string) => {
    // Send to logging service
    loggingService.debug('db-query', message);
  },
  info: (message: string) => {
    loggingService.info('db-query', message);
  },
  warn: (message: string) => {
    loggingService.warn('db-query', message);
  },
  error: (message: string) => {
    loggingService.error('db-query', message);
  },
};

const debugDb = withDebug(db, {
  logger: customLogger,
  logQuery: true,
  logParams: true,
});
```

### Production Monitoring

```typescript
import { withDebug } from '@kysera/debug';

const debugDb = withDebug(db, {
  logQuery: false, // Don't log in production
  slowQueryThreshold: 200, // Alert on queries > 200ms
  maxMetrics: 100, // Keep only recent queries
  onSlowQuery: (sql, duration) => {
    // Send to APM
    apm.recordTransaction({
      type: 'db.query',
      duration,
      metadata: { sql },
    });

    // Alert if extremely slow
    if (duration > 1000) {
      alerting.critical('Database query exceeded 1 second', {
        sql,
        duration,
      });
    }
  },
});

// Periodic metrics reporting
setInterval(() => {
  const metrics = debugDb.getMetrics();
  if (metrics.length > 0) {
    const avgDuration = metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length;

    monitoring.gauge('db.query.avg_duration', avgDuration);
    monitoring.gauge('db.query.count', metrics.length);

    debugDb.clearMetrics(); // Reset for next interval
  }
}, 60000); // Every minute
```

### Formatting SQL for Display

```typescript
import { formatSQL, formatSQLPretty, highlightSQL } from '@kysera/debug';

const sql = 'SELECT u.id, u.name, COUNT(p.id) as post_count FROM users u LEFT JOIN posts p ON u.id = p.user_id WHERE u.active = true GROUP BY u.id, u.name ORDER BY post_count DESC';

// Basic formatting
console.log('Basic Format:');
console.log(formatSQL(sql));

// Pretty formatting with indentation
console.log('\nPretty Format:');
console.log(formatSQLPretty(sql));

// Highlighted for terminal
console.log('\nHighlighted:');
console.log(highlightSQL(formatSQL(sql)));
```

## TypeScript Support

Full TypeScript support with strict type checking:

```typescript
import type {
  QueryMetrics,
  DebugOptions,
  DebugDatabase,
  ProfilerSummary,
  ProfilerOptions,
} from '@kysera/debug';

// Type-safe debug options
const options: DebugOptions = {
  logQuery: true,
  slowQueryThreshold: 100,
  onSlowQuery: (sql: string, duration: number) => {
    console.warn(`Slow: ${sql} (${duration}ms)`);
  },
};

// Type-safe database
interface Database {
  users: { id: number; name: string };
}

const debugDb: DebugDatabase<Database> = withDebug(db, options);
```

## Performance Considerations

### Memory Management

The debug plugin uses a circular buffer to manage memory efficiently:

- Default limit: 1000 metrics
- Oldest metrics automatically removed when limit reached
- Configure via `maxMetrics` option

```typescript
const debugDb = withDebug(db, {
  maxMetrics: 500, // Keep only last 500 queries
});
```

### Production Usage

For production environments:

1. **Disable verbose logging:**
   ```typescript
   const debugDb = withDebug(db, {
     logQuery: false,
     logParams: false,
   });
   ```

2. **Use slow query detection only:**
   ```typescript
   const debugDb = withDebug(db, {
     logQuery: false,
     slowQueryThreshold: 500,
     onSlowQuery: (sql, duration) => {
       monitoring.recordSlowQuery({ sql, duration });
     },
   });
   ```

3. **Limit metrics collection:**
   ```typescript
   const debugDb = withDebug(db, {
     maxMetrics: 100, // Smaller buffer for production
   });
   ```

## Runtime Compatibility

- Node.js >= 20.0.0
- Bun >= 1.0.0
- Deno (with Kysely Deno support)

## License

MIT

## Repository

[GitHub](https://github.com/kysera-dev/kysera/tree/main/packages/debug)
