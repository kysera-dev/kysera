import type {
  Kysely,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  UnknownRow,
  KyselyPlugin,
  RootOperationNode,
} from 'kysely';
import { DefaultQueryCompiler } from 'kysely';
import type { KyseraLogger } from './logger.js';
import { consoleLogger } from './logger.js';

export interface DebugOptions {
  logQuery?: boolean;
  logParams?: boolean;
  slowQueryThreshold?: number;
  onSlowQuery?: (sql: string, duration: number) => void;
  /**
   * Logger for debug messages
   * @default consoleLogger
   */
  logger?: KyseraLogger;
  /**
   * Maximum number of metrics to keep in memory
   * When limit is reached, oldest metrics are removed (circular buffer)
   * @default 1000
   */
  maxMetrics?: number;
}

export interface QueryMetrics {
  sql: string;
  params?: unknown[];
  duration: number;
  timestamp: number;
}

interface QueryData {
  startTime: number;
  sql: string;
  params: readonly unknown[];
}

/**
 * Debug plugin for Kysely
 */
class DebugPlugin implements KyselyPlugin {
  private metrics: QueryMetrics[] = [];
  private queryData = new WeakMap<object, QueryData>();
  private maxMetrics: number;
  private logger: KyseraLogger;

  constructor(private options: DebugOptions = {}) {
    this.logger = options.logger ?? consoleLogger;
    this.options = {
      logQuery: true,
      logParams: false,
      slowQueryThreshold: 100,
      maxMetrics: 1000,
      logger: this.logger,
      ...options,
    };
    this.maxMetrics = this.options.maxMetrics ?? 1000;
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const startTime = performance.now();

    // Compile the query to get SQL and parameters
    const compiler = new DefaultQueryCompiler();
    const compiled = compiler.compileQuery(args.node, args.queryId);

    // Store query data for later use in transformResult
    this.queryData.set(args.queryId, {
      startTime,
      sql: compiled.sql,
      params: compiled.parameters,
    });

    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const data = this.queryData.get(args.queryId);

    if (data) {
      const endTime = performance.now();
      const duration = endTime - data.startTime;
      this.queryData.delete(args.queryId);

      const metric: QueryMetrics = {
        sql: data.sql,
        params: [...data.params],
        duration,
        timestamp: Date.now(),
      };

      // Circular buffer: keep only last N metrics
      this.metrics.push(metric);
      if (this.metrics.length > this.maxMetrics) {
        this.metrics.shift(); // Remove oldest metric
      }

      if (this.options.logQuery) {
        const message = this.options.logParams
          ? `[SQL] ${data.sql}\n[Params] ${JSON.stringify(data.params)}`
          : `[SQL] ${data.sql}`;
        this.logger.debug(message);
        this.logger.debug(`[Duration] ${duration.toFixed(2)}ms`);
      }

      // Check for slow query
      if (this.options.slowQueryThreshold && duration > this.options.slowQueryThreshold) {
        if (this.options.onSlowQuery) {
          this.options.onSlowQuery(data.sql, duration);
        } else {
          this.logger.warn(`[SLOW QUERY] ${duration.toFixed(2)}ms: ${data.sql}`);
        }
      }
    }

    return args.result;
  }

  getMetrics(): QueryMetrics[] {
    return [...this.metrics];
  }

  clearMetrics(): void {
    this.metrics = [];
  }
}

/**
 * Debug wrapper for Kysely database
 */
export function withDebug<DB>(
  db: Kysely<DB>,
  options: DebugOptions = {}
): Kysely<DB> & { getMetrics: () => QueryMetrics[]; clearMetrics: () => void } {
  const plugin = new DebugPlugin(options);
  const debugDb = db.withPlugin(plugin) as Kysely<DB> & {
    getMetrics: () => QueryMetrics[];
    clearMetrics: () => void;
  };

  // Attach metrics methods
  debugDb.getMetrics = () => plugin.getMetrics();
  debugDb.clearMetrics = () => {
    plugin.clearMetrics();
  };

  return debugDb;
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
    .trim();
}

/**
 * Create a query profiler
 *
 * @example
 * ```typescript
 * const profiler = new QueryProfiler({ maxQueries: 500 })
 * profiler.record({ sql: 'SELECT * FROM users', duration: 10, timestamp: Date.now() })
 * const summary = profiler.getSummary()
 * console.log(`Total queries: ${summary.totalQueries}`)
 * console.log(`Average duration: ${summary.averageDuration.toFixed(2)}ms`)
 * ```
 */
export class QueryProfiler {
  private queries: QueryMetrics[] = [];
  private maxQueries: number;

  /**
   * @param options.maxQueries - Maximum number of queries to keep in memory (default: 1000)
   */
  constructor(options: { maxQueries?: number } = {}) {
    this.maxQueries = options.maxQueries ?? 1000;
  }

  record(metric: QueryMetrics): void {
    this.queries.push(metric);
    // Circular buffer: keep only last N queries
    if (this.queries.length > this.maxQueries) {
      this.queries.shift(); // Remove oldest query
    }
  }

  getSummary(): {
    totalQueries: number;
    totalDuration: number;
    averageDuration: number;
    slowestQuery: QueryMetrics | null;
    fastestQuery: QueryMetrics | null;
    queries: QueryMetrics[];
  } {
    if (this.queries.length === 0) {
      return {
        totalQueries: 0,
        totalDuration: 0,
        averageDuration: 0,
        slowestQuery: null,
        fastestQuery: null,
        queries: [],
      };
    }

    const totalDuration = this.queries.reduce((sum, q) => sum + q.duration, 0);
    const sorted = [...this.queries].sort((a, b) => b.duration - a.duration);

    return {
      totalQueries: this.queries.length,
      totalDuration,
      averageDuration: totalDuration / this.queries.length,
      slowestQuery: sorted[0] ?? null,
      fastestQuery: sorted[sorted.length - 1] ?? null,
      queries: [...this.queries],
    };
  }

  clear(): void {
    this.queries = [];
  }
}
