/**
 * Query function creation utilities.
 *
 * @module @kysera/dal
 */

import type { Kysely } from 'kysely';
import type { KyseraExecutor } from '@kysera/executor';
import type { DbContext, QueryFunction } from './types.js';
import { createContext } from './context.js';

/**
 * Create a typed query function.
 *
 * Query functions are the core building blocks of Functional DAL.
 * They receive a database context and arguments, and return a Promise.
 *
 * The result type is automatically inferred from the query.
 * Supports raw Kysely instances and plugin-aware KyseraExecutor.
 *
 * @param queryFn - Query implementation function
 * @returns Callable query function
 *
 * @example Basic query
 * ```typescript
 * import { createQuery } from '@kysera/dal';
 *
 * const getUserById = createQuery(
 *   (ctx, id: number) =>
 *     ctx.db
 *       .selectFrom('users')
 *       .select(['id', 'email', 'name'])
 *       .where('id', '=', id)
 *       .executeTakeFirst()
 * );
 *
 * // Usage with raw Kysely
 * const user = await getUserById(db, 1);
 * // Type: { id: number; email: string; name: string } | undefined
 * ```
 *
 * @example With KyseraExecutor (plugins applied)
 * ```typescript
 * import { createQuery } from '@kysera/dal';
 * import { createExecutor } from '@kysera/executor';
 * import { softDeletePlugin } from '@kysera/soft-delete';
 *
 * const executor = await createExecutor(db, [softDeletePlugin()]);
 *
 * const getUsers = createQuery((ctx) =>
 *   ctx.db.selectFrom('users').selectAll().execute()
 * );
 *
 * // Soft-delete filter automatically applied
 * const users = await getUsers(executor);
 * ```
 *
 * @example With transaction
 * ```typescript
 * import { createQuery, withTransaction } from '@kysera/dal';
 *
 * const result = await withTransaction(db, async (ctx) => {
 *   return getUserById(ctx, 1);
 * });
 * ```
 */
export function createQuery<DB, TArgs extends readonly unknown[], TResult>(
  queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult> {
  return (dbOrCtx: Kysely<DB> | KyseraExecutor<DB> | DbContext<DB>, ...args: TArgs): Promise<TResult> => {
    const ctx: DbContext<DB> =
      'db' in dbOrCtx && 'isTransaction' in dbOrCtx
        ? dbOrCtx
        : createContext(dbOrCtx);

    return queryFn(ctx, ...args);
  };
}

/**
 * Create a query function that requires a transaction.
 *
 * Throws an error if called outside a transaction context.
 *
 * @param queryFn - Query implementation function
 * @returns Query function that requires transaction
 *
 * @example
 * ```typescript
 * import { createTransactionalQuery, withTransaction } from '@kysera/dal';
 *
 * const transferFunds = createTransactionalQuery(
 *   async (ctx, fromId: number, toId: number, amount: number) => {
 *     await ctx.db
 *       .updateTable('accounts')
 *       .set((eb) => ({ balance: eb('balance', '-', amount) }))
 *       .where('id', '=', fromId)
 *       .execute();
 *
 *     await ctx.db
 *       .updateTable('accounts')
 *       .set((eb) => ({ balance: eb('balance', '+', amount) }))
 *       .where('id', '=', toId)
 *       .execute();
 *
 *     return { success: true };
 *   }
 * );
 *
 * // This will work
 * await withTransaction(db, (ctx) => transferFunds(ctx, 1, 2, 100));
 *
 * // This will throw an error
 * await transferFunds(db, 1, 2, 100); // Error: Query requires transaction
 * ```
 */
export function createTransactionalQuery<DB, TArgs extends readonly unknown[], TResult>(
  queryFn: (ctx: DbContext<DB>, ...args: TArgs) => Promise<TResult>
): QueryFunction<DB, TArgs, TResult> {
  return createQuery(async (ctx: DbContext<DB>, ...args: TArgs) => {
    if (!ctx.isTransaction) {
      throw new Error(
        'Query requires a transaction. Use withTransaction() to execute this query.'
      );
    }
    return await queryFn(ctx, ...args);
  });
}
