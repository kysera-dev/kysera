/**
 * Transaction-based testing utilities.
 *
 * @module @kysera/testing
 */

import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

/**
 * Internal error class used to trigger transaction rollback.
 * @internal
 */
class RollbackError extends Error {
  constructor() {
    super('ROLLBACK');
    this.name = 'RollbackError';
  }
}

/**
 * Test in a transaction that automatically rolls back.
 *
 * This is the **fastest testing approach** - no cleanup needed!
 * All changes made within the transaction are automatically rolled back
 * after the test completes, leaving the database in its original state.
 *
 * @param db - Kysely database instance
 * @param fn - Test function that receives a transaction
 *
 * @example
 * ```typescript
 * import { testInTransaction } from '@kysera/testing';
 *
 * it('creates user', async () => {
 *   await testInTransaction(db, async (trx) => {
 *     const user = await trx
 *       .insertInto('users')
 *       .values({ email: 'test@example.com' })
 *       .returningAll()
 *       .executeTakeFirst();
 *
 *     expect(user?.email).toBe('test@example.com');
 *   });
 *   // Transaction automatically rolled back - database is clean!
 * });
 * ```
 */
export async function testInTransaction<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      await fn(trx);
      throw new RollbackError();
    });
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error;
    }
  }
}

/**
 * Test with savepoints for nested transaction testing.
 *
 * Useful for testing complex business logic that uses nested transactions.
 * Creates a savepoint before running the test function and rolls back
 * to the savepoint after completion.
 *
 * @param db - Kysely database instance
 * @param fn - Test function that receives a transaction
 *
 * @example
 * ```typescript
 * import { testWithSavepoints } from '@kysera/testing';
 *
 * it('handles nested operations', async () => {
 *   await testWithSavepoints(db, async (trx) => {
 *     // Test complex nested transaction logic
 *     await createUserWithProfile(trx, userData);
 *
 *     // Verify results
 *     const user = await trx.selectFrom('users').selectAll().executeTakeFirst();
 *     expect(user).toBeDefined();
 *   });
 * });
 * ```
 */
export async function testWithSavepoints<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      await sql`SAVEPOINT test_sp`.execute(trx);

      try {
        await fn(trx);
      } finally {
        try {
          await sql`ROLLBACK TO SAVEPOINT test_sp`.execute(trx);
        } catch {
          // Savepoint might not exist if transaction already failed
          // This is expected when the transaction has already rolled back
        }
      }

      throw new RollbackError();
    });
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error;
    }
  }
}

/**
 * Isolation level for transactions.
 */
export type IsolationLevel =
  | 'read uncommitted'
  | 'read committed'
  | 'repeatable read'
  | 'serializable';

/**
 * Test with specific transaction isolation level.
 *
 * Useful for testing behavior under different isolation levels,
 * such as testing for race conditions or phantom reads.
 *
 * @param db - Kysely database instance
 * @param isolationLevel - Transaction isolation level
 * @param fn - Test function that receives a transaction
 *
 * @example
 * ```typescript
 * import { testWithIsolation } from '@kysera/testing';
 *
 * it('handles serializable isolation', async () => {
 *   await testWithIsolation(db, 'serializable', async (trx) => {
 *     // Test behavior under serializable isolation
 *   });
 * });
 * ```
 */
export async function testWithIsolation<DB, T>(
  db: Kysely<DB>,
  isolationLevel: IsolationLevel,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      // Access raw() method which is not in Kysely type definitions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call -- Kysely raw() not in types
      await (trx as any)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Kysely raw() method access
        .raw(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel.toUpperCase()}`)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Kysely execute() method access
        .execute();

      await fn(trx);

      throw new RollbackError();
    });
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error;
    }
  }
}
