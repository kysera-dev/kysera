/**
 * Example: Using Real Metrics Collection with Kysera
 *
 * This example demonstrates how to collect real database metrics
 * using the fixed getMetrics() function that no longer returns fake data.
 */

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { withDebug, getMetrics, createMetricsPool } from '@omnitron-dev/kysera-core';

// Define your database schema
interface Database {
  users: {
    id: number;
    email: string;
    name: string;
    created_at: Date;
  };
}

async function main() {
  // 1. Create a PostgreSQL connection pool
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'myapp',
    user: 'myuser',
    password: 'mypassword',
    max: 20, // Maximum pool size
  });

  // 2. Create a Kysely database instance
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  // 3. IMPORTANT: Wrap the database with the debug plugin to enable metrics tracking
  const debugDb = withDebug(db, {
    logQuery: false, // Don't log queries to console
    slowQueryThreshold: 100, // Consider queries >100ms as slow
    maxMetrics: 1000, // Keep last 1000 query metrics in memory
  });

  // 4. Create a metrics-enabled pool for connection statistics
  const metricsPool = createMetricsPool(pool);

  console.log('Executing database operations...\n');

  // 5. Perform some database operations
  try {
    // Insert operations
    await debugDb
      .insertInto('users')
      .values([
        { email: 'alice@example.com', name: 'Alice' },
        { email: 'bob@example.com', name: 'Bob' },
      ])
      .execute();

    // Select operations
    await debugDb.selectFrom('users').selectAll().execute();

    await debugDb
      .selectFrom('users')
      .where('email', 'like', '%@example.com')
      .selectAll()
      .execute();

    // Update operation
    await debugDb
      .updateTable('users')
      .set({ name: 'Alice Smith' })
      .where('email', '=', 'alice@example.com')
      .execute();

    // Complex query
    await debugDb
      .selectFrom('users')
      .select(['id', 'email', 'name'])
      .where('created_at', '>', new Date('2024-01-01'))
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();

    console.log('Database operations completed.\n');

    // 6. Get REAL metrics from executed queries
    const metrics = await getMetrics(debugDb, {
      pool: metricsPool,
      slowQueryThreshold: 100,
      period: '5m',
    });

    // 7. Display the real metrics
    console.log('=== DATABASE METRICS (REAL DATA) ===\n');

    console.log(`Period: ${metrics.period}`);
    console.log(`Timestamp: ${metrics.timestamp}\n`);

    if (metrics.connections) {
      console.log('Connection Pool:');
      console.log(`  Total Connections: ${metrics.connections.total}`);
      console.log(`  Active: ${metrics.connections.active}`);
      console.log(`  Idle: ${metrics.connections.idle}`);
      console.log(`  Max: ${metrics.connections.max}`);
      console.log(
        `  Utilization: ${((metrics.connections.active / metrics.connections.total) * 100).toFixed(1)}%\n`
      );
    }

    if (metrics.queries) {
      console.log('Query Statistics:');
      console.log(`  Total Queries: ${metrics.queries.total}`);
      console.log(`  Avg Duration: ${metrics.queries.avgDuration.toFixed(2)}ms`);
      console.log(`  Min Duration: ${metrics.queries.minDuration.toFixed(2)}ms`);
      console.log(`  Max Duration: ${metrics.queries.maxDuration.toFixed(2)}ms`);
      console.log(`  P95 Duration: ${metrics.queries.p95Duration.toFixed(2)}ms`);
      console.log(`  P99 Duration: ${metrics.queries.p99Duration.toFixed(2)}ms`);
      console.log(`  Slow Queries (>100ms): ${metrics.queries.slowCount}\n`);
    }

    if (metrics.recommendations && metrics.recommendations.length > 0) {
      console.log('Recommendations:');
      metrics.recommendations.forEach((rec, idx) => {
        console.log(`  ${idx + 1}. ${rec}`);
      });
      console.log();
    } else {
      console.log('No recommendations - all metrics look healthy!\n');
    }
  } catch (error) {
    console.error('Error during database operations:', error);
  } finally {
    // 8. Clean up
    await db.destroy();
    console.log('Database connection closed.');
  }
}

/**
 * Example: What happens if you DON'T use withDebug
 */
async function exampleWithoutDebug() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'myapp',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  // ❌ WRONG: Database is not wrapped with debug plugin
  try {
    const metrics = await getMetrics(db);
    console.log('This will never execute');
  } catch (error) {
    console.error('Error:', (error as Error).message);
    // Error: Database metrics are not available.
    // To collect query metrics, wrap your database with the debug plugin...
  } finally {
    await db.destroy();
  }
}

/**
 * Example: Production monitoring setup
 */
async function productionMonitoring() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'myapp',
    max: 50, // Large pool for production
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  // Enable metrics with production-optimized settings
  const debugDb = withDebug(db, {
    logQuery: false, // Don't spam logs
    slowQueryThreshold: 200, // Production tolerance
    maxMetrics: 10000, // Keep more history for analysis
    onSlowQuery: (sql, duration) => {
      // Custom slow query handler
      console.warn(`SLOW QUERY DETECTED (${duration.toFixed(2)}ms):`);
      console.warn(sql.substring(0, 200)); // First 200 chars
    },
  });

  const metricsPool = createMetricsPool(pool);

  // Periodic metrics collection (every 60 seconds)
  setInterval(
    async () => {
      try {
        const metrics = await getMetrics(debugDb, {
          pool: metricsPool,
          slowQueryThreshold: 200,
          period: '1m',
        });

        // Send to monitoring system (e.g., Prometheus, DataDog, CloudWatch)
        await sendToMonitoring(metrics);

        // Check for critical issues
        if (metrics.queries && metrics.queries.slowCount > 100) {
          await alertOps('High number of slow queries detected!');
        }

        if (metrics.connections && metrics.connections.active / metrics.connections.total > 0.9) {
          await alertOps('Connection pool nearly exhausted!');
        }
      } catch (error) {
        console.error('Error collecting metrics:', error);
      }
    },
    60000
  ); // Every 60 seconds

  // Keep alive
  await new Promise(() => {});
}

// Mock functions for example
async function sendToMonitoring(metrics: any) {
  // Send to your monitoring service
  console.log('Metrics sent to monitoring:', metrics.timestamp);
}

async function alertOps(message: string) {
  // Alert operations team
  console.log('ALERT:', message);
}

// Run the main example
if (require.main === module) {
  main().catch(console.error);
}
