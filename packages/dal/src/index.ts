/**
 * @kysera/dal - Functional Data Access Layer for Kysera
 *
 * Provides a functional approach to database access with:
 * - **Query functions** instead of Repository methods
 * - **Type inference** instead of explicit DTOs
 * - **Context passing** instead of DI containers
 * - **Plugin support** via KyseraExecutor integration
 * - **Colocation** - code near usage
 *
 * @module @kysera/dal
 *
 * @example Basic usage
 * ```typescript
 * import { createQuery, withTransaction, parallel } from "@kysera/dal";
 *
 * // Define query functions
 * const getUserById = createQuery((ctx, id: number) =>
 *   ctx.db
 *     .selectFrom("users")
 *     .select(["id", "email", "name"])
 *     .where("id", "=", id)
 *     .executeTakeFirst()
 * );
 *
 * const createUser = createQuery((ctx, data: { email: string; name: string }) =>
 *   ctx.db
 *     .insertInto("users")
 *     .values(data)
 *     .returningAll()
 *     .executeTakeFirstOrThrow()
 * );
 *
 * // Use directly with database
 * const user = await getUserById(db, 1);
 *
 * // Use within transaction
 * const result = await withTransaction(db, async (ctx) => {
 *   const user = await createUser(ctx, { email: "test@example.com", name: "Test" });
 *   return user;
 * });
 * ```
 *
 * @example With plugins (KyseraExecutor)
 * ```typescript
 * import { createExecutor } from "@kysera/executor";
 * import { softDeletePlugin } from "@kysera/soft-delete";
 * import { createQuery, withTransaction } from "@kysera/dal";
 *
 * const executor = await createExecutor(db, [softDeletePlugin()]);
 *
 * const getUsers = createQuery((ctx) =>
 *   ctx.db.selectFrom("users").selectAll().execute()
 * );
 *
 * // Soft-delete filter automatically applied
 * const users = await getUsers(executor);
 *
 * // Plugins propagate to transactions
 * await withTransaction(executor, async (ctx) => {
 *   const activeUsers = await getUsers(ctx);
 *   return activeUsers;
 * });
 * ```
 *
 * @example Query composition
 * ```typescript
 * import { createQuery, compose, parallel } from "@kysera/dal";
 *
 * // Compose queries
 * const getUserWithPosts = compose(
 *   getUserById,
 *   async (ctx, user) => ({
 *     ...user,
 *     posts: await getPostsByUserId(ctx, user.id),
 *   })
 * );
 *
 * // Parallel execution
 * const getDashboard = parallel({
 *   user: getUserById,
 *   stats: getUserStats,
 *   notifications: getNotifications,
 * });
 *
 * const dashboard = await getDashboard(db, userId);
 * // { user: {...}, stats: {...}, notifications: [...] }
 * ```
 */

// Types
export type {
  DbContext,
  TransactionOptions,
  QueryFunction,
  InferResult,
  InferArgs,
  InferDB
} from './types.js'

// Symbols for advanced use cases
export {
  DB_CONTEXT_SYMBOL,
  IN_TRANSACTION_SYMBOL,
  SAVEPOINT_COUNTER_SYMBOL,
  isDbContext
} from './types.js'

// Re-export executor types for convenience
export type {
  Plugin,
  KyseraExecutor,
  KyseraTransaction,
  AnyKyseraExecutor,
  QueryBuilderContext,
  ExecutorConfig,
  KyseraExecutorMarker,
  PluginValidationDetails,
  PluginValidationErrorType
} from '@kysera/executor'

// Re-export executor error for convenience
export { PluginValidationError } from '@kysera/executor'

// Errors
export { TransactionRequiredError } from './errors.js'

// Context
export {
  createContext,
  createSchemaContext,
  withTransaction,
  withContext,
  isInTransaction,
  type TransactionOptionsWithLogger,
  type CreateContextOptions
} from './context.js'

// Query creation
export { createQuery, createTransactionalQuery } from './query.js'

// Composition
export { compose, chain, parallel, conditional, mapResult, type ParallelResult } from './compose.js'
