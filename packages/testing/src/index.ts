/**
 * @kysera/testing - Testing utilities for Kysera
 *
 * Provides transaction-based testing, data factories, seeding utilities,
 * and test helpers for fast, isolated database testing.
 *
 * @module @kysera/testing
 *
 * @example Transaction-based testing
 * ```typescript
 * import { testInTransaction, createFactory } from '@kysera/testing';
 *
 * const createUser = createFactory({
 *   email: () => `user-${Date.now()}@example.com`,
 *   name: 'Test User',
 * });
 *
 * it('creates user', async () => {
 *   await testInTransaction(db, async (trx) => {
 *     const userData = createUser({ name: 'Alice' });
 *
 *     const user = await trx
 *       .insertInto('users')
 *       .values(userData)
 *       .returningAll()
 *       .executeTakeFirst();
 *
 *     expect(user?.name).toBe('Alice');
 *   });
 *   // Database automatically rolled back!
 * });
 * ```
 */

// Transaction utilities
export {
  testInTransaction,
  testWithSavepoints,
  testWithIsolation,
  type IsolationLevel,
} from './transaction.js';

// Cleanup utilities
export {
  cleanDatabase,
  type CleanupStrategy,
} from './cleanup.js';

// Factory utilities
export {
  createFactory,
  createMany,
  createSequenceFactory,
  type FactoryFunction,
  type FactoryDefaults,
} from './factories.js';

// Seeding utilities
export {
  seedDatabase,
  composeSeeders,
  type SeedFunction,
} from './seeding.js';

// Test helpers
export {
  waitFor,
  snapshotTable,
  countRows,
  assertRowExists,
  assertRowNotExists,
  type WaitForOptions,
} from './helpers.js';
