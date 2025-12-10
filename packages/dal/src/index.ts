/**
 * @kysera/dal - Functional Data Access Layer for Kysera ORM
 *
 * Provides a functional approach to database access with:
 * - **Query functions** instead of Repository methods
 * - **Type inference** instead of explicit DTOs
 * - **Context passing** instead of DI containers
 * - **Colocation** - code near usage
 *
 * @module @kysera/dal
 *
 * @example Basic usage
 * ```typescript
 * import { createQuery, withTransaction, parallel } from '@kysera/dal';
 *
 * // Define query functions
 * const getUserById = createQuery((ctx, id: number) =>
 *   ctx.db
 *     .selectFrom('users')
 *     .select(['id', 'email', 'name'])
 *     .where('id', '=', id)
 *     .executeTakeFirst()
 * );
 *
 * const createUser = createQuery((ctx, data: { email: string; name: string }) =>
 *   ctx.db
 *     .insertInto('users')
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
 *   const user = await createUser(ctx, { email: 'test@example.com', name: 'Test' });
 *   return user;
 * });
 * ```
 *
 * @example Query composition
 * ```typescript
 * import { createQuery, compose, parallel } from '@kysera/dal';
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
  InferDB,
} from './types.js';

// Context
export {
  createContext,
  withTransaction,
  withContext,
  isInTransaction,
} from './context.js';

// Query creation
export {
  createQuery,
  createTransactionalQuery,
} from './query.js';

// Composition
export {
  compose,
  chain,
  parallel,
  conditional,
  mapResult,
  type ParallelResult,
} from './compose.js';
