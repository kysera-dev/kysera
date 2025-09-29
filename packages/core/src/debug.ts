import type { Kysely } from 'kysely'

export interface DebugOptions {
  logQuery?: boolean
  logParams?: boolean
  slowQueryThreshold?: number
  onSlowQuery?: (sql: string, duration: number) => void
  logger?: (message: string) => void
}

export interface QueryMetrics {
  sql: string
  params?: unknown[]
  duration: number
  timestamp: number
}

/**
 * Debug wrapper for Kysely database
 */
export function withDebug<DB>(
  db: Kysely<DB>,
  _options: DebugOptions = {}
): Kysely<DB> {
  // Track query metrics
  const metrics: QueryMetrics[] = []

  // For now, just return the db as-is since the plugin API needs more complex implementation
  // In a real implementation, you would use a proper plugin that tracks execution time
  const debugDb = db

  // Attach metrics getter
  ;(debugDb as any).getMetrics = () => metrics

  return debugDb
}

/**
 * Format SQL for better readability
 */
export function formatSQL(sql: string): string {
  return sql
    .replace(/SELECT/gi, '\nSELECT')
    .replace(/FROM/gi, '\nFROM')
    .replace(/WHERE/gi, '\nWHERE')
    .replace(/JOIN/gi, '\nJOIN')
    .replace(/ORDER BY/gi, '\nORDER BY')
    .replace(/GROUP BY/gi, '\nGROUP BY')
    .replace(/HAVING/gi, '\nHAVING')
    .replace(/LIMIT/gi, '\nLIMIT')
    .replace(/OFFSET/gi, '\nOFFSET')
    .trim()
}

/**
 * Create a query profiler
 */
export class QueryProfiler {
  private queries: QueryMetrics[] = []

  record(metric: QueryMetrics): void {
    this.queries.push(metric)
  }

  getSummary() {
    if (this.queries.length === 0) {
      return {
        totalQueries: 0,
        totalDuration: 0,
        averageDuration: 0,
        slowestQuery: null as QueryMetrics | null,
        fastestQuery: null as QueryMetrics | null
      }
    }

    const totalDuration = this.queries.reduce((sum, q) => sum + q.duration, 0)
    const sorted = [...this.queries].sort((a, b) => b.duration - a.duration)

    return {
      totalQueries: this.queries.length,
      totalDuration,
      averageDuration: totalDuration / this.queries.length,
      slowestQuery: sorted[0],
      fastestQuery: sorted[sorted.length - 1],
      queries: this.queries
    }
  }

  clear(): void {
    this.queries = []
  }
}