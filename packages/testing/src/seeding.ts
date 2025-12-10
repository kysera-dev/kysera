/**
 * Database seeding utilities.
 *
 * @module @kysera/testing
 */

import type { Kysely, Transaction } from 'kysely';

/**
 * Seed database with test data.
 *
 * Executes the seeding function within a transaction.
 * If the seeding function throws, the transaction is rolled back.
 *
 * @param db - Kysely database instance
 * @param fn - Seeding function that receives a transaction
 *
 * @example
 * ```typescript
 * import { seedDatabase } from '@kysera/testing';
 *
 * beforeAll(async () => {
 *   await seedDatabase(db, async (trx) => {
 *     // Insert test users
 *     await trx
 *       .insertInto('users')
 *       .values([
 *         { email: 'alice@example.com', name: 'Alice' },
 *         { email: 'bob@example.com', name: 'Bob' },
 *       ])
 *       .execute();
 *
 *     // Insert related data
 *     await trx
 *       .insertInto('posts')
 *       .values([
 *         { user_id: 1, title: 'First Post' },
 *       ])
 *       .execute();
 *   });
 * });
 * ```
 */
export async function seedDatabase<DB>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<void>
): Promise<void> {
  await db.transaction().execute(fn);
}

/**
 * Seed function type for reusable seeders.
 */
export type SeedFunction<DB> = (trx: Transaction<DB>) => Promise<void>;

/**
 * Create a composable seeder.
 *
 * Allows combining multiple seeders into one.
 *
 * @param seeders - Array of seed functions
 * @returns Combined seed function
 *
 * @example
 * ```typescript
 * import { composeSeeders, seedDatabase } from '@kysera/testing';
 *
 * const seedUsers: SeedFunction<DB> = async (trx) => {
 *   await trx.insertInto('users').values([...]).execute();
 * };
 *
 * const seedPosts: SeedFunction<DB> = async (trx) => {
 *   await trx.insertInto('posts').values([...]).execute();
 * };
 *
 * const seedAll = composeSeeders([seedUsers, seedPosts]);
 *
 * beforeAll(async () => {
 *   await seedDatabase(db, seedAll);
 * });
 * ```
 */
export function composeSeeders<DB>(
  seeders: SeedFunction<DB>[]
): SeedFunction<DB> {
  return async (trx: Transaction<DB>): Promise<void> => {
    for (const seeder of seeders) {
      await seeder(trx);
    }
  };
}
