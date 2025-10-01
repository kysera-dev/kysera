import type { Kysely, Transaction } from 'kysely'

/**
 * Executor type that can be either a Kysely instance or a Transaction
 */
export type Executor<DB> = Kysely<DB> | Transaction<DB>

/**
 * A map of table names to repository factory functions
 */
export type RepositoryFactoryMap<DB, Repos> = {
  [K in keyof Repos]: (executor: Executor<DB>) => Repos[K]
}

/**
 * Creates a repository bundle factory that can be used with both Kysely and Transaction
 *
 * This allows you to create all repositories at once for easy usage:
 *
 * @example
 * ```typescript
 * // Define your repository factories
 * const createRepositories = createRepositoriesFactory({
 *   users: createUserRepository,
 *   posts: createPostRepository,
 *   comments: createCommentRepository
 * })
 *
 * // Use with database instance
 * const repos = createRepositories(db)
 * await repos.users.findById(1)
 *
 * // Use within transaction (clean one-liner!)
 * await db.transaction().execute(async (trx) => {
 *   const repos = createRepositories(trx)
 *   await repos.users.create({ name: 'Alice' })
 *   await repos.posts.create({ userId: 1, title: 'Hello' })
 * })
 * ```
 *
 * @param factories - Map of table names to repository factory functions
 * @returns A function that creates all repositories from an executor
 */
export function createRepositoriesFactory<DB, Repos extends Record<string, any>>(
  factories: RepositoryFactoryMap<DB, Repos>
): (executor: Executor<DB>) => Repos {
  return (executor: Executor<DB>): Repos => {
    const repos = {} as Repos

    for (const [key, factory] of Object.entries(factories)) {
      repos[key as keyof Repos] = factory(executor)
    }

    return repos
  }
}

/**
 * Type helper to extract repository types from a factory map
 */
export type RepositoriesFromFactory<T extends (...args: any[]) => any> = ReturnType<T>
