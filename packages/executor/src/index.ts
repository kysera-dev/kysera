/**
 * @kysera/executor - Unified Execution Layer for Kysera
 *
 * Provides plugin-aware Kysely wrapper that enables plugins to work
 * with both Repository and DAL patterns.
 *
 * @module @kysera/executor
 *
 * @example Basic usage
 * ```typescript
 * import { createExecutor } from '@kysera/executor';
 * import { softDeletePlugin } from '@kysera/soft-delete';
 *
 * const executor = await createExecutor(db, [softDeletePlugin()]);
 *
 * // All queries now have soft-delete filter applied automatically
 * const users = await executor.selectFrom('users').selectAll().execute();
 * ```
 *
 * @example With DAL
 * ```typescript
 * import { createExecutor } from '@kysera/executor';
 * import { createContext, createQuery } from '@kysera/dal';
 *
 * const executor = await createExecutor(db, plugins);
 * const ctx = createContext(executor);
 *
 * const getUsers = createQuery((ctx) =>
 *   ctx.db.selectFrom('users').selectAll().execute()
 * );
 *
 * // Plugins applied automatically
 * const users = await getUsers(ctx);
 * ```
 */

// Types
export type {
  Plugin,
  QueryBuilderContext,
  KyseraExecutor,
  KyseraTransaction,
  AnyKyseraExecutor,
  ExecutorConfig,
  KyseraExecutorMarker,
  PluginValidationDetails,
  PluginValidationErrorType,
  BaseRepositoryLike
} from './types.js'

// Type guard function
export { isRepositoryLike } from './types.js'

// Executor
export {
  createExecutor,
  createExecutorSync,
  isKyseraExecutor,
  getPlugins,
  getRawDb,
  wrapTransaction,
  applyPlugins,
  validatePlugins,
  resolvePluginOrder,
  PluginValidationError,
  destroyExecutor,
  INTERCEPTED_METHODS
} from './executor.js'

// Export InterceptedMethod type for advanced users
export type { InterceptedMethod } from './executor.js'
