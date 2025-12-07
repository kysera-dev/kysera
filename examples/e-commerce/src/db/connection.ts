import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { createGracefulShutdown, createMetricsPool, withDebug } from '@kysera/core'
import type { Database } from './schema.js'

// Create base pool
const basePool = new Pool({
  connectionString: process.env['DATABASE_URL'] || 'postgresql://localhost/ecommerce_example',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// Create pool with metrics (for health checks)
export const pool = createMetricsPool(basePool)

// Create Kysely instance
const baseDb = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: basePool }),
  log: process.env['NODE_ENV'] === 'development'
    ? ['query', 'error']
    : ['error']
})

// Add debug wrapper - always wrap for consistent typing
const debugDb = withDebug(baseDb, {
  logQuery: process.env['NODE_ENV'] === 'development',
  logParams: false,
  slowQueryThreshold: 100,
  onSlowQuery: (sql, duration) => {
    console.warn(`Slow query (${duration}ms):`, sql)
  }
})

// Export the database instance with proper typing
export const db: Kysely<Database> = debugDb

// Setup graceful shutdown (for production use)
export async function setupShutdownHandlers() {
  if (process.env['NODE_ENV'] === 'production') {
    await createGracefulShutdown(baseDb, {
      onShutdown: async () => {
        console.log('Closing database connections...')
      }
    })
  }
}
