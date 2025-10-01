import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'

/**
 * Testing utilities for Kysera ORM
 *
 * These utilities provide fast, isolated testing with automatic cleanup
 * using transaction-based testing patterns.
 */

/**
 * Internal error class used to trigger transaction rollback
 */
class RollbackError extends Error {
  constructor() {
    super('ROLLBACK')
    this.name = 'RollbackError'
  }
}

/**
 * Database cleanup strategies
 */
export type CleanupStrategy = 'truncate' | 'transaction' | 'delete'

/**
 * Test in a transaction that automatically rolls back
 *
 * This is the FASTEST testing approach - no cleanup needed!
 *
 * @example
 * ```typescript
 * it('creates user', async () => {
 *   await testInTransaction(db, async (trx) => {
 *     const user = await trx
 *       .insertInto('users')
 *       .values({ email: 'test@example.com' })
 *       .returningAll()
 *       .executeTakeFirst()
 *
 *     expect(user.email).toBe('test@example.com')
 *   })
 *   // Transaction automatically rolled back - database is clean!
 * })
 * ```
 *
 * @param db - Kysely database instance
 * @param fn - Test function that receives transaction
 */
export async function testInTransaction<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      await fn(trx)
      // Throw special error to trigger rollback
      throw new RollbackError()
    })
  } catch (error) {
    // Ignore RollbackError (expected), rethrow everything else
    if (!(error instanceof RollbackError)) {
      throw error
    }
  }
}

/**
 * Test with savepoints for nested transaction testing
 *
 * Useful for testing complex business logic that uses nested transactions
 *
 * @example
 * ```typescript
 * it('handles nested transactions', async () => {
 *   await testWithSavepoints(db, async (trx) => {
 *     // Create user
 *     await trx.insertInto('users').values({...}).execute()
 *
 *     // This will be rolled back
 *     await trx.raw('SAVEPOINT inner').execute()
 *     await trx.insertInto('posts').values({...}).execute()
 *     await trx.raw('ROLLBACK TO SAVEPOINT inner').execute()
 *
 *     // User remains, post is rolled back
 *   })
 * })
 * ```
 *
 * @param db - Kysely database instance
 * @param fn - Test function that receives transaction
 */
export async function testWithSavepoints<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      // Create initial savepoint
      await sql`SAVEPOINT test_sp`.execute(trx)

      try {
        await fn(trx)
      } finally {
        // Always rollback to savepoint before rolling back transaction
        try {
          await sql`ROLLBACK TO SAVEPOINT test_sp`.execute(trx)
        } catch {
          // Savepoint might not exist if transaction already failed
        }
      }

      // Trigger transaction rollback
      throw new RollbackError()
    })
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error
    }
  }
}

/**
 * Clean database using specified strategy
 *
 * @example
 * ```typescript
 * afterEach(async () => {
 *   await cleanDatabase(db, 'delete')
 * })
 * ```
 *
 * @param db - Kysely database instance
 * @param strategy - Cleanup strategy
 *   - 'transaction': No-op (used with testInTransaction)
 *   - 'delete': DELETE FROM each table (fast, preserves sequences)
 *   - 'truncate': TRUNCATE tables (thorough, resets sequences)
 * @param tables - Optional list of tables to clean (in deletion order)
 */
export async function cleanDatabase<DB>(
  db: Kysely<DB>,
  strategy: CleanupStrategy = 'transaction',
  tables?: string[]
): Promise<void> {
  if (strategy === 'transaction') {
    // No-op - testInTransaction handles cleanup
    return
  }

  if (!tables || tables.length === 0) {
    throw new Error(
      'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
    )
  }

  if (strategy === 'delete') {
    // Delete in reverse FK order (most dependent first)
    for (const table of tables) {
      await db.deleteFrom(table as any).execute()
    }
  } else if (strategy === 'truncate') {
    // TRUNCATE is database-specific
    const dialect = (db as any).getExecutor().adapter.dialect

    if (dialect.constructor.name.includes('Postgres')) {
      // PostgreSQL: Disable FK checks temporarily
      await (db as any).raw('SET session_replication_role = replica').execute()

      for (const table of tables) {
        await (db as any).raw(`TRUNCATE TABLE "${table}" CASCADE`).execute()
      }

      await (db as any).raw('SET session_replication_role = DEFAULT').execute()
    } else if (dialect.constructor.name.includes('Mysql')) {
      // MySQL: Disable FK checks
      await (db as any).raw('SET FOREIGN_KEY_CHECKS = 0').execute()

      for (const table of tables) {
        await (db as any).raw(`TRUNCATE TABLE \`${table}\``).execute()
      }

      await (db as any).raw('SET FOREIGN_KEY_CHECKS = 1').execute()
    } else {
      // SQLite: No TRUNCATE, use DELETE
      for (const table of tables) {
        await db.deleteFrom(table as any).execute()
        // Reset sequences
        await (db as any).raw(`DELETE FROM sqlite_sequence WHERE name='${table}'`).execute()
      }
    }
  }
}

/**
 * Generic test data factory
 *
 * @example
 * ```typescript
 * const createTestUser = createFactory<User>({
 *   id: 1,
 *   email: () => `test${Date.now()}@example.com`,
 *   name: 'Test User',
 *   created_at: () => new Date()
 * })
 *
 * const user1 = createTestUser() // Uses defaults
 * const user2 = createTestUser({ name: 'Custom Name' }) // Override
 * ```
 *
 * @param defaults - Default values (can be values or functions)
 * @returns Factory function that creates test data
 */
export function createFactory<T extends Record<string, any>>(
  defaults: {
    [K in keyof T]: T[K] | (() => T[K])
  }
): (overrides?: Partial<T>) => T {
  return (overrides = {}) => {
    const result = {} as T

    // Apply defaults
    for (const [key, value] of Object.entries(defaults)) {
      result[key as keyof T] = typeof value === 'function' ? (value as () => any)() : value
    }

    // Apply overrides
    for (const [key, value] of Object.entries(overrides)) {
      result[key as keyof T] = value as T[keyof T]
    }

    return result
  }
}

/**
 * Wait for a condition to be true (useful for async operations)
 *
 * @example
 * ```typescript
 * await waitFor(async () => {
 *   const user = await db.selectFrom('users').selectAll().executeTakeFirst()
 *   return user !== undefined
 * }, { timeout: 5000 })
 * ```
 *
 * @param condition - Function that returns true when condition is met
 * @param options - Configuration options
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  options: {
    timeout?: number
    interval?: number
    timeoutMessage?: string
  } = {}
): Promise<void> {
  const {
    timeout = 5000,
    interval = 100,
    timeoutMessage = 'Condition not met within timeout'
  } = options

  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const result = await condition()
    if (result) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  throw new Error(timeoutMessage)
}

/**
 * Seed database with test data
 *
 * @example
 * ```typescript
 * await seedDatabase(db, async (trx) => {
 *   await trx.insertInto('users').values([
 *     { email: 'user1@example.com', name: 'User 1' },
 *     { email: 'user2@example.com', name: 'User 2' }
 *   ]).execute()
 * })
 * ```
 *
 * @param db - Kysely database instance
 * @param fn - Seeding function
 */
export async function seedDatabase<DB>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<void>
): Promise<void> {
  await db.transaction().execute(fn)
}

/**
 * Isolation level for transactions
 */
export type IsolationLevel =
  | 'read uncommitted'
  | 'read committed'
  | 'repeatable read'
  | 'serializable'

/**
 * Test with specific transaction isolation level
 *
 * @example
 * ```typescript
 * await testWithIsolation(db, 'serializable', async (trx) => {
 *   // Test concurrent access scenarios
 * })
 * ```
 *
 * @param db - Kysely database instance
 * @param isolationLevel - Transaction isolation level
 * @param fn - Test function
 */
export async function testWithIsolation<DB, T>(
  db: Kysely<DB>,
  isolationLevel: IsolationLevel,
  fn: (trx: Transaction<DB>) => Promise<T>
): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      // Set isolation level
      await (trx as any)
        .raw(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel.toUpperCase()}`)
        .execute()

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
 * Snapshot database state for later comparison
 *
 * @example
 * ```typescript
 * const snapshot = await snapshotTable(db, 'users')
 *
 * // Make changes...
 *
 * const current = await snapshotTable(db, 'users')
 * expect(current).toEqual(snapshot) // Or check differences
 * ```
 *
 * @param db - Kysely database instance
 * @param table - Table name
 * @returns Array of all rows in the table
 */
export async function snapshotTable<DB>(
  db: Kysely<DB>,
  table: string
): Promise<any[]> {
  return db
    .selectFrom(table as any)
    .selectAll()
    .execute()
}

/**
 * Count rows in a table
 *
 * @example
 * ```typescript
 * const count = await countRows(db, 'users')
 * expect(count).toBe(5)
 * ```
 *
 * @param db - Kysely database instance
 * @param table - Table name
 * @returns Number of rows
 */
export async function countRows<DB>(
  db: Kysely<DB>,
  table: string
): Promise<number> {
  const result = await (db as any)
    .selectFrom(table)
    .select((eb: any) => eb.fn.countAll().as('count'))
    .executeTakeFirst()

  return result ? Number(result.count) : 0
}
