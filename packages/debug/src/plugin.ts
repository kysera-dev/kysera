/**
 * Debug plugin for Kysely.
 *
 * @module @kysera/debug
 */

import type {
  CompiledQuery,
  Kysely,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryId,
  QueryResult,
  UnknownRow,
  KyselyPlugin,
  RootOperationNode
} from 'kysely'
import { DefaultQueryCompiler } from 'kysely'
import { consoleLogger, type KyseraLogger, type QueryMetrics } from '@kysera/core'
import { CircularBuffer } from './circular-buffer.js'

/**
 * Compiles an operation node to SQL for logging purposes.
 * @internal
 */
type CompileFn = (node: RootOperationNode, queryId: QueryId) => CompiledQuery

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
  private readonly compile: CompileFn

  constructor(options: DebugOptions = {}, compile?: CompileFn) {
    this.logger = options.logger ?? consoleLogger
    this.metricsBuffer = new CircularBuffer<QueryMetrics>(options.maxMetrics ?? 1000)
    this.onSlowQuery = options.onSlowQuery
    this.options = {
      logQuery: options.logQuery ?? true,
      logParams: options.logParams ?? false,
      slowQueryThreshold: options.slowQueryThreshold ?? 100
    }
    // Fall back to the generic ANSI compiler when no dialect compiler is
    // available (e.g. hand-built mocks). Placeholders may then differ from
    // what the driver actually receives.
    this.compile =
      compile ??
      ((node, queryId) => new DefaultQueryCompiler().compileQuery(node, queryId))
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const startTime = performance.now()

    // Compile the query with the wrapped database's own dialect compiler so
    // logged SQL matches what the driver receives ($1 for pg, ? for sqlite...)
    const compiled = this.compile(args.node, args.queryId)

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
  // Borrow the real dialect compiler from the wrapped instance so logged SQL
  // matches driver SQL. getExecutor() is stable public API on Kysely.
  let compile: CompileFn | undefined
  try {
    const executor = (
      db as unknown as { getExecutor?: () => { compileQuery?: CompileFn } }
    ).getExecutor?.()
    const executorCompile = executor?.compileQuery
    if (typeof executorCompile === 'function') {
      compile = (node, queryId) => executorCompile.call(executor, node, queryId)
    }
  } catch {
    // Mocks or exotic wrappers — DebugPlugin falls back to DefaultQueryCompiler
  }

  const plugin = new DebugPlugin(options, compile)
  const debugDb = db.withPlugin(plugin) as DebugDatabase<DB>

  // Attach metrics methods (withPlugin returned a fresh instance — safe)
  debugDb.getMetrics = (): QueryMetrics[] => plugin.getMetrics()
  debugDb.clearMetrics = (): void => {
    plugin.clearMetrics()
  }

  return debugDb
}
