import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { createGracefulShutdown, createMetricsPool, withDebug } from '@kysera/core'
import type { Database } from './schema'

// Create base pool
const basePool = new Pool({
  connectionString: process.env['DATABASE_URL'] || 'postgresql://localhost/ecommerce_example',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// Create pool with metrics (for health checks)
export const pool = createMetricsPool(basePool)

// Create Kysely instance using base pool (not wrapped)
const baseDb = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: basePool }),
  log: process.env['NODE_ENV'] === 'development'
    ? ['query', 'error']
    : ['error']
})

// Add debug wrapper in development
export const db = process.env['NODE_ENV'] === 'development'
  ? withDebug(baseDb, {
      logQuery: true,
      logParams: false,
      slowQueryThreshold: 100,
      onSlowQuery: (sql, duration) => {
        console.warn(`Slow query (${duration}ms):`, sql)
      }
    })
  : baseDb

// Setup graceful shutdown (for production use)
export async function setupShutdownHandlers() {
  if (process.env['NODE_ENV'] === 'production') {
    await createGracefulShutdown(db, {
      onShutdown: async () => {
        console.log('Closing database connections...')
      }
    })
  }
}
