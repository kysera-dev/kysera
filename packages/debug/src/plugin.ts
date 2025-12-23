/**
 * Debug plugin for Kysely.
 *
 * @module @kysera/debug
 */

import type {
  Kysely,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  UnknownRow,
  KyselyPlugin,
  RootOperationNode
} from 'kysely'
import { DefaultQueryCompiler } from 'kysely'
import { consoleLogger, type KyseraLogger, type QueryMetrics } from '@kysera/core'
import { CircularBuffer } from './circular-buffer.js'

// Re-export QueryMetrics for backwards compatibility
export type { QueryMetrics }

/**
 * Options for debug plugin.
 */
export interface DebugOptions {
  /**
   * Log query SQL.
   * @default true
   */
  logQuery?: boolean

  /**
   * Log query parameters.
   * @default false
   */
  logParams?: boolean

  /**
   * Duration threshold (ms) to consider a query slow.
   * @default 100
   */
  slowQueryThreshold?: number

  /**
   * Callback for slow queries.
   */
  onSlowQuery?: (sql: string, duration: number) => void

  /**
   * Logger for debug messages.
   * @default consoleLogger
   */
  logger?: KyseraLogger

  /**
   * Maximum number of metrics to keep in memory.
   * When limit is reached, oldest metrics are removed (circular buffer).
   * @default 1000
   */
  maxMetrics?: number
}

/**
 * Internal query data for tracking execution.
 * @internal
 */
interface QueryData {
  startTime: number
  sql: string
  params: readonly unknown[]
}

/**
 * Debug plugin implementation.
 * @internal
 */
class DebugPlugin implements KyselyPlugin {
  private readonly metricsBuffer: CircularBuffer<QueryMetrics>
  private queryData = new WeakMap<object, QueryData>()
  private readonly logger: KyseraLogger
  private readonly options: Required<
    Pick<DebugOptions, 'logQuery' | 'logParams' | 'slowQueryThreshold'>
  >
  private readonly onSlowQuery: ((sql: string, duration: number) => void) | undefined

  constructor(options: DebugOptions = {}) {
    this.logger = options.logger ?? consoleLogger
    this.metricsBuffer = new CircularBuffer<QueryMetrics>(options.maxMetrics ?? 1000)
    this.onSlowQuery = options.onSlowQuery
    this.options = {
      logQuery: options.logQuery ?? true,
      logParams: options.logParams ?? false,
      slowQueryThreshold: options.slowQueryThreshold ?? 100
    }
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const startTime = performance.now()

    // Compile the query to get SQL and parameters
    const compiler = new DefaultQueryCompiler()
    const compiled = compiler.compileQuery(args.node, args.queryId)

    // Store query data for later use in transformResult
    this.queryData.set(args.queryId, {
      startTime,
      sql: compiled.sql,
      params: compiled.parameters
    })

    return args.node
  }

  transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const data = this.queryData.get(args.queryId)

    if (data) {
      const endTime = performance.now()
      const duration = endTime - data.startTime
      this.queryData.delete(args.queryId)

      const metric: QueryMetrics = {
        sql: data.sql,
        params: [...data.params],
        duration,
        timestamp: Date.now()
      }

      // Add to circular buffer (O(1) operation)
      this.metricsBuffer.add(metric)

      if (this.options.logQuery) {
        const message = this.options.logParams
          ? '[SQL] ' + data.sql + '\n[Params] ' + JSON.stringify(data.params)
          : '[SQL] ' + data.sql
        this.logger.debug(message)
        this.logger.debug('[Duration] ' + duration.toFixed(2) + 'ms')
      }

      // Check for slow query
      if (duration > this.options.slowQueryThreshold) {
        if (this.onSlowQuery) {
          this.onSlowQuery(data.sql, duration)
        } else {
          this.logger.warn('[SLOW QUERY] ' + duration.toFixed(2) + 'ms: ' + data.sql)
        }
      }
    }

    return Promise.resolve(args.result)
  }

  getMetrics(): QueryMetrics[] {
    return this.metricsBuffer.getOrdered()
  }

  clearMetrics(): void {
    this.metricsBuffer.clear()
  }
}

/**
 * Database with debug capabilities.
 */
export interface DebugDatabase<DB> extends Kysely<DB> {
  /** Get all collected query metrics */
  getMetrics(): QueryMetrics[]
  /** Clear all collected metrics */
  clearMetrics(): void
}

/**
 * Wrap a Kysely database with debug capabilities.
 *
 * Adds query logging, metrics collection, and slow query detection.
 *
 * @param db - Kysely database instance
 * @param options - Debug options
 * @returns Database with debug capabilities
 *
 * @example Basic usage
 * ```typescript
 * import { withDebug } from '@kysera/debug';
 *
 * const debugDb = withDebug(db);
 *
 * // Queries are now logged and timed
 * await debugDb.selectFrom('users').selectAll().execute();
 *
 * // Get collected metrics
 * const metrics = debugDb.getMetrics();
 * console.log('Total queries: ' + metrics.length);
 * ```
 *
 * @example With custom options
 * ```typescript
 * import { withDebug } from '@kysera/debug';
 *
 * const debugDb = withDebug(db, {
 *   logQuery: true,
 *   logParams: true,
 *   slowQueryThreshold: 50,
 *   maxMetrics: 500,
 *   onSlowQuery: (sql, duration) => {
 *     alertService.notify('Slow query: ' + duration + 'ms');
 *   },
 * });
 * ```
 */
export function withDebug<DB>(db: Kysely<DB>, options: DebugOptions = {}): DebugDatabase<DB> {
  const plugin = new DebugPlugin(options)
  const debugDb = db.withPlugin(plugin) as DebugDatabase<DB>

  // Attach metrics methods
  debugDb.getMetrics = (): QueryMetrics[] => plugin.getMetrics()
  debugDb.clearMetrics = (): void => {
    plugin.clearMetrics()
  }

  return debugDb
}
