/**
 * @kysera/debug - Debug utilities for Kysera ORM
 *
 * Provides query logging, metrics collection, profiling,
 * and SQL formatting utilities.
 *
 * @module @kysera/debug
 *
 * @example Basic usage
 * ```typescript
 * import { withDebug, QueryProfiler, formatSQL } from '@kysera/debug';
 *
 * // Add debug capabilities to database
 * const debugDb = withDebug(db, {
 *   logQuery: true,
 *   slowQueryThreshold: 100,
 * });
 *
 * // Execute queries
 * await debugDb.selectFrom('users').selectAll().execute();
 *
 * // Analyze metrics
 * const metrics = debugDb.getMetrics();
 * console.log(`Executed ${metrics.length} queries`);
 *
 * // Format SQL for display
 * console.log(formatSQL(metrics[0].sql));
 * ```
 */

// Plugin
export {
  type QueryMetrics,
  type DebugOptions,
  type DebugDatabase,
  withDebug,
} from './plugin.js';

// Profiler
export {
  type ProfilerSummary,
  type ProfilerOptions,
  QueryProfiler,
} from './profiler.js';

// Formatting
export {
  formatSQL,
  formatSQLPretty,
  minifySQL,
  highlightSQL,
} from './format.js';
