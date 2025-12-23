/**
 * Testing helper utilities.
 *
 * @module @kysera/testing
 */

import type { Kysely } from 'kysely'

/**
 * Options for waitFor function.
 */
export interface WaitForOptions {
  /**
   * Maximum time to wait in milliseconds.
   * @default 5000
   */
  timeout?: number

  /**
   * Interval between condition checks in milliseconds.
   * @default 100
   */
  interval?: number

  /**
   * Custom error message on timeout.
   * @default 'Condition not met within timeout'
   */
  timeoutMessage?: string
}

/**
 * Wait for a condition to be true.
 *
 * Useful for testing async operations like background jobs,
 * event handlers, or eventual consistency scenarios.
 *
 * @param condition - Function that returns true when condition is met
 * @param options - Configuration options
 * @throws {Error} If timeout is exceeded before condition is met
 *
 * @example Basic usage
 * ```typescript
 * import { waitFor } from '@kysera/testing';
 *
 * // Wait for user to appear in database
 * await waitFor(async () => {
 *   const user = await db
 *     .selectFrom('users')
 *     .where('email', '=', 'test@example.com')
 *     .executeTakeFirst();
 *   return user !== undefined;
 * });
 * ```
 *
 * @example With custom options
 * ```typescript
 * import { waitFor } from '@kysera/testing';
 *
 * await waitFor(
 *   async () => {
 *     const count = await getProcessedCount();
 *     return count >= 10;
 *   },
 *   {
 *     timeout: 10000,
 *     interval: 200,
 *     timeoutMessage: 'Jobs did not complete in time',
 *   }
 * );
 * ```
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  options: WaitForOptions = {}
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
 * Snapshot database state for later comparison.
 *
 * @param db - Kysely database instance
 * @param table - Table name to snapshot
 * @returns Array of all rows in the table
 *
 * @example
 * ```typescript
 * import { snapshotTable } from '@kysera/testing';
 *
 * const before = await snapshotTable(db, 'users');
 *
 * // Perform operations...
 *
 * const after = await snapshotTable(db, 'users');
 * expect(after.length).toBe(before.length + 1);
 * ```
 */
export async function snapshotTable<DB>(db: Kysely<DB>, table: string): Promise<unknown[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic table name requires any cast
  return await db.selectFrom(table as any).selectAll().execute()
}

/**
 * Count rows in a table.
 *
 * @param db - Kysely database instance
 * @param table - Table name
 * @returns Number of rows in the table
 *
 * @example
 * ```typescript
 * import { countRows } from '@kysera/testing';
 *
 * const initialCount = await countRows(db, 'users');
 * await createUser(db, userData);
 * const newCount = await countRows(db, 'users');
 *
 * expect(newCount).toBe(initialCount + 1);
 * ```
 */
export async function countRows<DB>(db: Kysely<DB>, table: string): Promise<number> {
  // Dynamic query building requires any cast as table name is runtime value
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Kysely dynamic query building
  const result = await (db as any)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Dynamic table name
    .selectFrom(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Expression builder typing
    .select((eb: any) => eb.fn.countAll().as('count'))
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Dynamic query result
    .executeTakeFirst()

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Result type unknown at compile time
  return result ? Number(result.count) : 0
}

/**
 * Internal helper to build and execute a query with dynamic conditions.
 *
 * @param db - Kysely database instance
 * @param table - Table name
 * @param where - Conditions to match
 * @returns The matched row or undefined
 * @internal
 */
async function findRow<DB>(
  db: Kysely<DB>,
  table: string,
  where: Record<string, unknown>
): Promise<unknown> {
  // Build query dynamically - requires any cast for runtime table/column names
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- Dynamic query building
  const anyDb = db as any
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Dynamic query building
  let query = anyDb.selectFrom(table).selectAll()

  for (const [key, value] of Object.entries(where)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Dynamic query building
    query = query.where(key, '=', value)
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Dynamic query building
  return await query.executeTakeFirst()
}

/**
 * Assert that a row exists in a table.
 *
 * @param db - Kysely database instance
 * @param table - Table name
 * @param where - Conditions to match
 * @returns The found row
 * @throws {Error} If no matching row is found
 *
 * @example
 * ```typescript
 * import { assertRowExists } from '@kysera/testing';
 *
 * const user = await assertRowExists(db, 'users', {
 *   email: 'test@example.com',
 * });
 *
 * expect(user.name).toBe('Test User');
 * ```
 */
export async function assertRowExists<DB>(
  db: Kysely<DB>,
  table: string,
  where: Record<string, unknown>
): Promise<unknown> {
  const row = await findRow(db, table, where)

  if (!row) {
    throw new Error(`Expected row to exist in ${table} with conditions: ${JSON.stringify(where)}`)
  }

  return row
}

/**
 * Assert that no row exists matching the conditions.
 *
 * @param db - Kysely database instance
 * @param table - Table name
 * @param where - Conditions to match
 * @throws {Error} If a matching row is found
 *
 * @example
 * ```typescript
 * import { assertRowNotExists } from '@kysera/testing';
 *
 * await deleteUser(db, userId);
 *
 * await assertRowNotExists(db, 'users', { id: userId });
 * ```
 */
export async function assertRowNotExists<DB>(
  db: Kysely<DB>,
  table: string,
  where: Record<string, unknown>
): Promise<void> {
  const row = await findRow(db, table, where)

  if (row) {
    throw new Error(
      `Expected no row to exist in ${table} with conditions: ${JSON.stringify(where)}`
    )
  }
}
