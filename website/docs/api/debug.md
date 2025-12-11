---
sidebar_position: 5
title: "@kysera/debug"
description: Debug utilities API reference
---

# @kysera/debug

Debug utilities for Kysera - query logging, profiling, SQL formatting, and performance analysis.

## Installation

```bash
npm install @kysera/debug
```

## Overview

**Bundle Size:** ~5 KB (minified)
**Dependencies:** @kysera/core (peer: kysely >=0.28.8)

## Key Features

- **Query Logging** - Automatic logging of SQL queries and execution times
- **Performance Metrics** - Collect and analyze query performance data
- **Slow Query Detection** - Identify and alert on slow database queries
- **SQL Formatting** - Format and highlight SQL for better readability
- **Query Profiling** - Detailed performance analysis with statistics
- **Circular Buffer** - Memory-efficient metrics storage

## Quick Start

```typescript
import { Kysely } from 'kysely';
import { withDebug } from '@kysera/debug';

// Wrap your database with debug capabilities
const debugDb = withDebug(db);

// Execute queries - they're automatically logged and timed
await debugDb.selectFrom('users').selectAll().execute();

// Get collected metrics
const metrics = debugDb.getMetrics();
console.log(`Executed ${metrics.length} queries`);
```

## withDebug()

Wraps a Kysely database instance with debug capabilities.

```typescript
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

```typescript
interface DebugOptions {
  logQuery?: boolean;           // Log query SQL (default: true)
  logParams?: boolean;          // Log query parameters (default: false)
  slowQueryThreshold?: number;  // Threshold in ms (default: 100)
  onSlowQuery?: (sql: string, duration: number) => void;
  logger?: KyseraLogger;        // Custom logger
  maxMetrics?: number;          // Max metrics in buffer (default: 1000)
}
```

### DebugDatabase Methods

```typescript
interface DebugDatabase<DB> extends Kysely<DB> {
  getMetrics(): QueryMetrics[];  // Get all collected metrics
  clearMetrics(): void;          // Clear collected metrics
}
```

### QueryMetrics

```typescript
interface QueryMetrics {
  sql: string;          // SQL query string
  params?: unknown[];   // Query parameters
  duration: number;     // Execution time in ms
  timestamp: number;    // When query was executed
}
```

## QueryProfiler

Advanced profiler for detailed performance analysis.

```typescript
import { QueryProfiler } from '@kysera/debug';

const profiler = new QueryProfiler({ maxQueries: 500 });

// Record queries
profiler.record({
  sql: 'SELECT * FROM users WHERE id = $1',
  params: [123],
  duration: 10.5,
  timestamp: Date.now(),
});

// Get summary
const summary = profiler.getSummary();
console.log(`Total: ${summary.totalQueries}`);
console.log(`Average: ${summary.averageDuration.toFixed(2)}ms`);
console.log(`Slowest: ${summary.slowestQuery?.duration.toFixed(2)}ms`);

// Get slow queries
const slowQueries = profiler.getSlowQueries(50);

// Get top 10 slowest
const top10 = profiler.getSlowestQueries(10);
```

### ProfilerSummary

```typescript
interface ProfilerSummary {
  totalQueries: number;
  totalDuration: number;
  averageDuration: number;
  slowestQuery: QueryMetrics | null;
  fastestQuery: QueryMetrics | null;
  queries: QueryMetrics[];
}
```

## SQL Formatting Functions

### formatSQL()

Format SQL with newlines before major keywords.

```typescript
import { formatSQL } from '@kysera/debug';

const sql = 'SELECT id, name FROM users WHERE active = true ORDER BY name';
console.log(formatSQL(sql));
// SELECT id, name
// FROM users
// WHERE active = true
// ORDER BY name
```

### formatSQLPretty()

Format SQL with indentation for nested queries.

```typescript
import { formatSQLPretty } from '@kysera/debug';

const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)';
console.log(formatSQLPretty(sql, 2)); // 2 spaces indent
```

### minifySQL()

Remove unnecessary whitespace.

```typescript
import { minifySQL } from '@kysera/debug';

const sql = `
  SELECT id, name
  FROM users
`;
console.log(minifySQL(sql));
// SELECT id, name FROM users
```

### highlightSQL()

Highlight SQL keywords with ANSI color codes for terminal.

```typescript
import { highlightSQL } from '@kysera/debug';

console.log(highlightSQL('SELECT * FROM users'));
// Keywords highlighted in blue
```

## Usage Examples

### Slow Query Detection

```typescript
const debugDb = withDebug(db, {
  slowQueryThreshold: 50,
  onSlowQuery: (sql, duration) => {
    monitoring.recordSlowQuery({ sql, duration });
    logger.warn(`Slow query: ${duration.toFixed(2)}ms`, { sql });
  },
});
```

### Production Monitoring

```typescript
const debugDb = withDebug(db, {
  logQuery: false,           // Don't log in production
  slowQueryThreshold: 200,
  maxMetrics: 100,
  onSlowQuery: (sql, duration) => {
    apm.recordTransaction({
      type: 'db.query',
      duration,
      metadata: { sql },
    });

    if (duration > 1000) {
      alerting.critical('Query exceeded 1 second', { sql, duration });
    }
  },
});

// Periodic metrics reporting
setInterval(() => {
  const metrics = debugDb.getMetrics();
  if (metrics.length > 0) {
    const avgDuration = metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length;
    monitoring.gauge('db.query.avg_duration', avgDuration);
    debugDb.clearMetrics();
  }
}, 60000);
```

### Custom Logger

```typescript
import type { KyseraLogger } from '@kysera/core';

const customLogger: KyseraLogger = {
  debug: (message) => loggingService.debug('db-query', message),
  info: (message) => loggingService.info('db-query', message),
  warn: (message) => loggingService.warn('db-query', message),
  error: (message) => loggingService.error('db-query', message),
};

const debugDb = withDebug(db, { logger: customLogger });
```

## Performance Considerations

### Memory Management

The debug plugin uses a circular buffer:
- Default limit: 1000 metrics
- Oldest metrics removed when limit reached
- Configure via `maxMetrics` option

### Production Usage

```typescript
// Disable verbose logging
const debugDb = withDebug(db, {
  logQuery: false,
  logParams: false,
});

// Use slow query detection only
const debugDb = withDebug(db, {
  logQuery: false,
  slowQueryThreshold: 500,
  onSlowQuery: (sql, duration) => monitoring.recordSlowQuery({ sql, duration }),
});

// Smaller buffer for production
const debugDb = withDebug(db, {
  maxMetrics: 100,
});
```
