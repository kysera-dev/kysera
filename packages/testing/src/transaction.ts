/**
 * Transaction-based testing utilities.
 *
 * @module @kysera/testing
 */

import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import { silentLogger, type KyseraLogger } from '@kysera/core'

/**
 * Internal error class used to trigger transaction rollback.
 * @internal
 */
class RollbackError extends Error {
  constructor() {
    super('ROLLBACK')
    this.name = 'RollbackError'
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
    await db.transaction().execute(async trx => {
      await fn(trx)
      throw new RollbackError()
    })
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error
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
 * @param logger - Optional logger for warnings (defaults to silentLogger)
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
  fn: (trx: Transaction<DB>) => Promise<T>,
  logger: KyseraLogger = silentLogger
): Promise<void> {
  try {
    await db.transaction().execute(async trx => {
      await sql`SAVEPOINT test_sp`.execute(trx)

      try {
        await fn(trx)
      } finally {
        try {
          await sql`ROLLBACK TO SAVEPOINT test_sp`.execute(trx)
        } catch (error: unknown) {
          // Savepoint might not exist if transaction already failed
          // Only ignore expected "savepoint not found" or transaction-related errors
          const errorMessage = error instanceof Error ? error.message : String(error)
          const isExpectedError =
            errorMessage.toLowerCase().includes('savepoint') ||
            errorMessage.toLowerCase().includes('transaction') ||
            errorMessage.toLowerCase().includes('aborted')
          if (!isExpectedError) {
            logger.warn('Unexpected savepoint rollback error:', error)
          }
        }
      }

      throw new RollbackError()
    })
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error
    }
  }
}

/**
 * Isolation level for transactions.
 * Subset of kysely's IsolationLevel supported across dialects.
 */
export type IsolationLevel =
  | 'read uncommitted'
  | 'read committed'
  | 'repeatable read'
  | 'serializable'

/** Valid isolation levels (runtime validation for JS callers) */
const VALID_ISOLATION_LEVELS: ReadonlySet<string> = new Set<IsolationLevel>([
  'read uncommitted',
  'read committed',
  'repeatable read',
  'serializable'
])

/**
 * Test with specific transaction isolation level.
 *
 * Uses kysely's dialect-aware `setIsolationLevel`, which emits the correct
 * statements per database (PostgreSQL/MSSQL: inside the transaction; MySQL:
 * before starting it — a raw `SET TRANSACTION` inside an active MySQL
 * transaction would fail with ER_CANT_CHANGE_TX_CHARACTERISTICS).
 * SQLite: kysely's SqliteDriver accepts only 'serializable' natively; other
 * levels are silently ignored (the driver issues a plain `begin`), no error.
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
  // Runtime validation for JS callers (TS already narrows the type)
  if (!VALID_ISOLATION_LEVELS.has(isolationLevel)) {
    throw new Error(
      `Invalid isolation level: ${isolationLevel}. Valid levels are: ${[...VALID_ISOLATION_LEVELS].join(', ')}`
    )
  }

  try {
    await db
      .transaction()
      .setIsolationLevel(isolationLevel)
      .execute(async trx => {
        await fn(trx)

        throw new RollbackError()
      })
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error
    }
  }
}
