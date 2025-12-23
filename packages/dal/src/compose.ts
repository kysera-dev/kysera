/**
 * Query composition utilities.
 *
 * @module @kysera/dal
 */

import type { Kysely } from 'kysely'
import type { KyseraExecutor } from '@kysera/executor'
import type { DbContext, QueryFunction } from './types.js'
import { isDbContext } from './types.js'
import { createContext } from './context.js'

/**
 * Normalize input to DbContext.
 * Uses Symbol-based detection for reliable context identification.
 * @internal
 */
function toContext<DB>(ctxOrDb: DbContext<DB> | Kysely<DB> | KyseraExecutor<DB>): DbContext<DB> {
  if (isDbContext<DB>(ctxOrDb)) {
    return ctxOrDb
  }
  return createContext(ctxOrDb)
}

/**
 * Compose two query functions sequentially.
 *
 * The result of the first query is passed to the second.
 *
 * @param first - First query function
 * @param second - Function that receives context and first result
 * @returns Composed query function
 *
 * @example
 * ```typescript
 * import { createQuery, compose } from '@kysera/dal';
 *
 * const getUserById = createQuery((ctx, id: number) =>
 *   ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
 * );
 *
 * const getPostsByUserId = createQuery((ctx, userId: number) =>
 *   ctx.db.selectFrom('posts').selectAll().where('user_id', '=', userId).execute()
 * );
 *
 * const getUserWithPosts = compose(
 *   getUserById,
 *   async (ctx, user) => ({
 *     ...user,
 *     posts: await getPostsByUserId(ctx, user.id),
 *   })
 * );
 *
 * const result = await getUserWithPosts(db, 1);
 * // { id: 1, name: '...', posts: [...] }
 * ```
 */
export function compose<DB, TArgs extends readonly unknown[], TFirst, TResult>(
  first: QueryFunction<DB, TArgs, TFirst>,
  second: (ctx: DbContext<DB>, result: TFirst) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult> {
  return async (
    ctxOrDb: DbContext<DB> | Kysely<DB> | KyseraExecutor<DB>,
    ...args: TArgs
  ): Promise<TResult> => {
    const ctx = toContext(ctxOrDb)
    const firstResult = await first(ctx, ...args)
    return await second(ctx, firstResult)
  }
}

/**
 * Chain multiple operations on a query result.
 *
 * Supports up to 8 type-safe transforms. For more than 8 transforms,
 * the return type falls back to `unknown` (use type assertion if needed).
 *
 * @param query - Initial query function
 * @param transforms - Array of transform functions (up to 8 with full type safety)
 * @returns Chained query function
 *
 * @example Basic usage (2 transforms)
 * ```typescript
 * import { createQuery, chain } from '@kysera/dal';
 *
 * const getUser = createQuery((ctx, id: number) =>
 *   ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
 * );
 *
 * const getUserFull = chain(
 *   getUser,
 *   async (ctx, user) => ({ ...user, posts: await getPosts(ctx, user.id) }),
 *   async (ctx, data) => ({ ...data, followers: await getFollowers(ctx, data.id) })
 * );
 * // Type: QueryFunction<DB, [number], { ...user, posts: Post[], followers: User[] }>
 * ```
 *
 * @example Maximum type-safe transforms (8)
 * ```typescript
 * const complexQuery = chain(
 *   getUser,
 *   async (ctx, user) => ({ ...user, posts: await getPosts(ctx, user.id) }),
 *   async (ctx, data) => ({ ...data, comments: await getComments(ctx, data.id) }),
 *   async (ctx, data) => ({ ...data, likes: await getLikes(ctx, data.id) }),
 *   async (ctx, data) => ({ ...data, shares: await getShares(ctx, data.id) }),
 *   async (ctx, data) => ({ ...data, followers: await getFollowers(ctx, data.id) }),
 *   async (ctx, data) => ({ ...data, following: await getFollowing(ctx, data.id) }),
 *   async (ctx, data) => ({ ...data, stats: await getStats(ctx, data.id) }),
 *   async (ctx, data) => ({ ...data, metadata: await getMetadata(ctx, data.id) })
 * );
 * // Type is still inferred correctly!
 * ```
 *
 * @example More than 8 transforms (fallback to unknown)
 * ```typescript
 * const veryComplexQuery = chain(
 *   getUser,
 *   t1, t2, t3, t4, t5, t6, t7, t8, t9  // 9 transforms
 * );
 * // Type: QueryFunction<DB, [number], unknown>
 * // Use type assertion: const result = await veryComplexQuery(db, 1) as MyType
 * ```
 */
export function chain<DB, TArgs extends readonly unknown[], T1, T2>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>
): QueryFunction<DB, TArgs, T2>
export function chain<DB, TArgs extends readonly unknown[], T1, T2, T3>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>,
  t2: (ctx: DbContext<DB>, result: T2) => Promise<T3>
): QueryFunction<DB, TArgs, T3>
export function chain<DB, TArgs extends readonly unknown[], T1, T2, T3, T4>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>,
  t2: (ctx: DbContext<DB>, result: T2) => Promise<T3>,
  t3: (ctx: DbContext<DB>, result: T3) => Promise<T4>
): QueryFunction<DB, TArgs, T4>
export function chain<DB, TArgs extends readonly unknown[], T1, T2, T3, T4, T5>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>,
  t2: (ctx: DbContext<DB>, result: T2) => Promise<T3>,
  t3: (ctx: DbContext<DB>, result: T3) => Promise<T4>,
  t4: (ctx: DbContext<DB>, result: T4) => Promise<T5>
): QueryFunction<DB, TArgs, T5>
export function chain<DB, TArgs extends readonly unknown[], T1, T2, T3, T4, T5, T6>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>,
  t2: (ctx: DbContext<DB>, result: T2) => Promise<T3>,
  t3: (ctx: DbContext<DB>, result: T3) => Promise<T4>,
  t4: (ctx: DbContext<DB>, result: T4) => Promise<T5>,
  t5: (ctx: DbContext<DB>, result: T5) => Promise<T6>
): QueryFunction<DB, TArgs, T6>
export function chain<DB, TArgs extends readonly unknown[], T1, T2, T3, T4, T5, T6, T7>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>,
  t2: (ctx: DbContext<DB>, result: T2) => Promise<T3>,
  t3: (ctx: DbContext<DB>, result: T3) => Promise<T4>,
  t4: (ctx: DbContext<DB>, result: T4) => Promise<T5>,
  t5: (ctx: DbContext<DB>, result: T5) => Promise<T6>,
  t6: (ctx: DbContext<DB>, result: T6) => Promise<T7>
): QueryFunction<DB, TArgs, T7>
export function chain<DB, TArgs extends readonly unknown[], T1, T2, T3, T4, T5, T6, T7, T8>(
  query: QueryFunction<DB, TArgs, T1>,
  t1: (ctx: DbContext<DB>, result: T1) => Promise<T2>,
  t2: (ctx: DbContext<DB>, result: T2) => Promise<T3>,
  t3: (ctx: DbContext<DB>, result: T3) => Promise<T4>,
  t4: (ctx: DbContext<DB>, result: T4) => Promise<T5>,
  t5: (ctx: DbContext<DB>, result: T5) => Promise<T6>,
  t6: (ctx: DbContext<DB>, result: T6) => Promise<T7>,
  t7: (ctx: DbContext<DB>, result: T7) => Promise<T8>
): QueryFunction<DB, TArgs, T8>
export function chain<DB, TArgs extends readonly unknown[]>(
  query: QueryFunction<DB, TArgs, unknown>,
  ...transforms: ((ctx: DbContext<DB>, result: unknown) => Promise<unknown>)[]
): QueryFunction<DB, TArgs, unknown> {
  return async (
    ctxOrDb: DbContext<DB> | Kysely<DB> | KyseraExecutor<DB>,
    ...args: TArgs
  ): Promise<unknown> => {
    const ctx = toContext(ctxOrDb)
    let result = await query(ctx, ...args)
    for (const transform of transforms) {
      result = await transform(ctx, result)
    }
    return result
  }
}

/**
 * Result type for parallel query execution.
 *
 * Uses mapped types to infer the result type of each query function,
 * maintaining full type safety across all database schemas.
 */
export type ParallelResult<
  DB,
  TArgs extends readonly unknown[],
  T extends Record<string, QueryFunction<DB, TArgs, unknown>>
> = {
  [K in keyof T]: T[K] extends QueryFunction<DB, TArgs, infer R> ? R : never
}

/**
 * Execute multiple queries in parallel.
 *
 * All queries receive the same arguments and are executed concurrently.
 *
 * @param queries - Object of query functions
 * @returns Query function that returns object with all results
 *
 * @example
 * ```typescript
 * import { createQuery, parallel } from '@kysera/dal';
 *
 * const getUserById = createQuery((ctx, id: number) =>
 *   ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
 * );
 *
 * const getUserStats = createQuery((ctx, id: number) =>
 *   ctx.db.selectFrom('user_stats').selectAll().where('user_id', '=', id).executeTakeFirst()
 * );
 *
 * const getNotifications = createQuery((ctx, id: number) =>
 *   ctx.db.selectFrom('notifications').selectAll().where('user_id', '=', id).execute()
 * );
 *
 * const getDashboardData = parallel({
 *   user: getUserById,
 *   stats: getUserStats,
 *   notifications: getNotifications,
 * });
 *
 * const dashboard = await getDashboardData(db, userId);
 * // { user: {...}, stats: {...}, notifications: [...] }
 * ```
 */
export function parallel<
  DB,
  TArgs extends readonly unknown[],
  T extends Record<string, QueryFunction<DB, TArgs, unknown>>
>(
  queries: T
): QueryFunction<
  DB,
  TArgs,
  { [K in keyof T]: T[K] extends QueryFunction<DB, TArgs, infer R> ? R : never }
> {
  return async (ctxOrDb: DbContext<DB> | Kysely<DB> | KyseraExecutor<DB>, ...args: TArgs) => {
    const ctx = toContext(ctxOrDb)
    const entries = Object.entries(queries)
    const results = await Promise.all(
      entries.map(async ([key, query]) => {
        const result = await query(ctx, ...args)
        return [key, result] as const
      })
    )

    return Object.fromEntries(results) as {
      [K in keyof T]: T[K] extends QueryFunction<DB, TArgs, infer R> ? R : never
    }
  }
}

/**
 * Execute a query conditionally.
 *
 * @param condition - Condition function
 * @param query - Query to execute if condition is true
 * @param fallback - Optional fallback value if condition is false
 * @returns Conditional query function
 *
 * @example
 * ```typescript
 * import { createQuery, conditional } from '@kysera/dal';
 *
 * const getPremiumFeatures = createQuery((ctx, userId: number) =>
 *   ctx.db.selectFrom('premium_features').selectAll().where('user_id', '=', userId).execute()
 * );
 *
 * const getFeatures = conditional(
 *   (ctx, userId: number, isPremium: boolean) => isPremium,
 *   getPremiumFeatures,
 *   []  // Return empty array for non-premium users
 * );
 * ```
 */
export function conditional<DB, TArgs extends readonly unknown[], TResult, TFallback = undefined>(
  condition: (ctx: DbContext<DB>, ...args: TArgs) => boolean | Promise<boolean>,
  query: QueryFunction<DB, TArgs, TResult>,
  fallback?: TFallback
): QueryFunction<DB, TArgs, TResult | TFallback> {
  return async (
    ctxOrDb: DbContext<DB> | Kysely<DB> | KyseraExecutor<DB>,
    ...args: TArgs
  ): Promise<TResult | TFallback> => {
    const ctx = toContext(ctxOrDb)
    const shouldExecute = await condition(ctx, ...args)
    if (shouldExecute) {
      return await query(ctx, ...args)
    }
    return fallback as TFallback
  }
}

/**
 * Map over query results.
 *
 * @param query - Query that returns an array
 * @param mapper - Function to apply to each element
 * @returns Query with mapped results
 *
 * @example
 * ```typescript
 * import { createQuery, mapResult } from '@kysera/dal';
 *
 * const getUsers = createQuery((ctx) =>
 *   ctx.db.selectFrom('users').selectAll().execute()
 * );
 *
 * const getUserNames = mapResult(getUsers, (user) => user.name);
 *
 * const names = await getUserNames(db); // string[]
 * ```
 */
export function mapResult<DB, TArgs extends readonly unknown[], TItem, TResult>(
  query: QueryFunction<DB, TArgs, TItem[]>,
  mapper: (item: TItem, index: number) => TResult
): QueryFunction<DB, TArgs, TResult[]> {
  return async (
    ctxOrDb: DbContext<DB> | Kysely<DB> | KyseraExecutor<DB>,
    ...args: TArgs
  ): Promise<TResult[]> => {
    const ctx = toContext(ctxOrDb)
    const items = await query(ctx, ...args)
    return items.map(mapper)
  }
}
