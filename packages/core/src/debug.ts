import type { Kysely, PluginTransformQueryArgs, PluginTransformResultArgs, QueryResult, UnknownRow, KyselyPlugin, RootOperationNode } from 'kysely'

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

interface QueryData {
  startTime: number
  node: RootOperationNode
}

/**
 * Debug plugin for Kysely
 */
class DebugPlugin implements KyselyPlugin {
  private metrics: QueryMetrics[] = []
  private queryData = new WeakMap<object, QueryData>()

  constructor(private options: DebugOptions = {}) {
    this.options = {
      logQuery: true,
      logParams: false,
      slowQueryThreshold: 100,
      logger: console.log,
      ...options
    }
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const startTime = performance.now()

    // Store query data for later use in transformResult
    this.queryData.set(args.queryId, {
      startTime,
      node: args.node
    })

    // Log will happen in transformResult when we have the compiled query

    return args.node
  }

  async transformResult(
    args: PluginTransformResultArgs
  ): Promise<QueryResult<UnknownRow>> {
    const data = this.queryData.get(args.queryId)

    if (data) {
      const endTime = performance.now()
      const duration = endTime - data.startTime
      this.queryData.delete(args.queryId)

      // Get compiled query for logging/metrics
      // This is a simplified version - in reality, the SQL would need to be
      // extracted from the execution context
      const sql = this.extractSQL(data.node)
      const params: unknown[] = []

      const metric: QueryMetrics = {
        sql,
        params,
        duration,
        timestamp: Date.now()
      }

      this.metrics.push(metric)

      if (this.options.logQuery) {
        const message = this.options.logParams
          ? `[SQL] ${sql}\n[Params] ${JSON.stringify(params)}`
          : `[SQL] ${sql}`
        this.options.logger?.(message)
        this.options.logger?.(`[Duration] ${duration.toFixed(2)}ms`)
      }

      // Check for slow query
      if (this.options.slowQueryThreshold && duration > this.options.slowQueryThreshold) {
        if (this.options.onSlowQuery) {
          this.options.onSlowQuery(sql, duration)
        } else {
          this.options.logger?.(`[SLOW QUERY] ${duration.toFixed(2)}ms: ${sql}`)
        }
      }
    }

    return args.result
  }

  private extractSQL(node: RootOperationNode): string {
    // Simple SQL extraction based on node type
    // In a real implementation, this would use the query compiler
    const nodeType = (node as any).kind
    switch (nodeType) {
      case 'SelectQueryNode':
        return 'SELECT * FROM ...'
      case 'InsertQueryNode':
        return 'INSERT INTO ...'
      case 'UpdateQueryNode':
        return 'UPDATE ...'
      case 'DeleteQueryNode':
        return 'DELETE FROM ...'
      default:
        return 'SQL Query'
    }
  }

  getMetrics(): QueryMetrics[] {
    return [...this.metrics]
  }

  clearMetrics(): void {
    this.metrics = []
  }
}

/**
 * Debug wrapper for Kysely database
 */
export function withDebug<DB>(
  db: Kysely<DB>,
  options: DebugOptions = {}
): Kysely<DB> & { getMetrics: () => QueryMetrics[], clearMetrics: () => void } {
  const plugin = new DebugPlugin(options)
  const debugDb = db.withPlugin(plugin) as Kysely<DB> & {
    getMetrics: () => QueryMetrics[],
    clearMetrics: () => void
  }

  // Attach metrics methods
  debugDb.getMetrics = () => plugin.getMetrics()
  debugDb.clearMetrics = () => plugin.clearMetrics()

  return debugDb
}

/**
 * Format SQL for better readability
 */
export function formatSQL(sql: string): string {
  // Add newlines before SQL keywords
  return sql
    .replace(/(SELECT)/gi, '\n$1')
    .replace(/(FROM)/gi, '\n$1')
    .replace(/(WHERE)/gi, '\n$1')
    .replace(/(JOIN)/gi, '\n$1')
    .replace(/(ORDER BY)/gi, '\n$1')
    .replace(/(GROUP BY)/gi, '\n$1')
    .replace(/(HAVING)/gi, '\n$1')
    .replace(/(LIMIT)/gi, '\n$1')
    .replace(/(OFFSET)/gi, '\n$1')
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