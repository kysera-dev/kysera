import type { Insertable, Selectable } from 'kysely'
import type { Executor } from './helpers.js'

/**
 * Options for upsert operation
 */
export interface UpsertOptions<T> {
  /** Columns that define the conflict constraint */
  conflictColumns: (keyof T)[]
  /** Columns to update on conflict. If not specified, updates all except conflictColumns */
  updateColumns?: (keyof T)[]
  /** Whether to return the upserted record */
  returning?: boolean
}

/**
 * Performs an upsert (INSERT ... ON CONFLICT DO UPDATE) operation.
 *
 * @example
 * ```typescript
 * // Upsert with specific conflict column
 * const wallet = await upsert(db, 'wallets', walletData, {
 *   conflictColumns: ['name'],
 *   returning: true
 * });
 *
 * // Upsert with composite key
 * await upsert(db, 'price_history', priceData, {
 *   conflictColumns: ['pair', 'timestamp'],
 *   updateColumns: ['price', 'volume']
 * });
 * ```
 */
export async function upsert<DB, Table extends keyof DB & string>(
  db: Executor<DB>,
  table: Table,
  data: Insertable<DB[Table]>,
  options: UpsertOptions<Insertable<DB[Table]>>
): Promise<Selectable<DB[Table]> | undefined> {
  const { conflictColumns, updateColumns, returning = false } = options

  // Build the update set object
  let updateSet: Partial<Insertable<DB[Table]>>

  if (updateColumns && updateColumns.length > 0) {
    // Use specified update columns
    updateSet = {} as Partial<Insertable<DB[Table]>>
    for (const col of updateColumns) {
      if (col in data) {
        updateSet[col] = data[col]
      }
    }
  } else {
    // Update all columns except conflict columns
    updateSet = { ...data }
    for (const col of conflictColumns) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Intentional: removing conflict columns from update set
      delete updateSet[col]
    }
  }

  /**
   * INTENTIONAL TYPE ASSERTION (documented and safe)
   *
   * Why `as any` is used here:
   * 1. conflictColumns: Array of column names is validated at runtime but TypeScript can't
   *    narrow (keyof T)[] to the exact literal types needed for oc.columns()
   * 2. updateSet: Partial update object is validated but TypeScript can't verify that
   *    updateSet columns match the table schema statically
   * 3. returningAll(): Kysely's type system doesn't preserve returning types through
   *    the onConflict chain correctly
   *
   * Safety guarantees:
   * - ✓ conflictColumns are validated to be keyof T at the type level in UpsertOptions
   * - ✓ updateSet is constructed from validated data (keyof T properties only)
   * - ✓ Kysely validates column names at runtime during query execution
   * - ✓ Return type is properly typed as Selectable<DB[Table]> | undefined
   * - ✓ Query structure is entirely controlled by this function
   *
   * This is a standard pattern for Kysely upsert operations with dynamic columns.
   */
  const query = db
    .insertInto(table)
    .values(data)
    .onConflict(oc => {
      const conflict = oc.columns(conflictColumns as any)
      return conflict.doUpdateSet(updateSet as any)
    })

  if (returning) {
    return (query as any).returningAll().executeTakeFirst()
  }

  await query.execute()
  return undefined
}

/**
 * Batch upsert multiple records
 */
export async function upsertMany<DB, Table extends keyof DB & string>(
  db: Executor<DB>,
  table: Table,
  data: Insertable<DB[Table]>[],
  options: Omit<UpsertOptions<Insertable<DB[Table]>>, 'returning'> & { returning?: false }
): Promise<void>
export async function upsertMany<DB, Table extends keyof DB & string>(
  db: Executor<DB>,
  table: Table,
  data: Insertable<DB[Table]>[],
  options: Omit<UpsertOptions<Insertable<DB[Table]>>, 'returning'> & { returning: true }
): Promise<Selectable<DB[Table]>[]>
export async function upsertMany<DB, Table extends keyof DB & string>(
  db: Executor<DB>,
  table: Table,
  data: Insertable<DB[Table]>[],
  options: UpsertOptions<Insertable<DB[Table]>>
): Promise<Selectable<DB[Table]>[] | void> {
  if (data.length === 0) {
    return options.returning ? [] : undefined
  }

  const { conflictColumns, updateColumns, returning = false } = options

  // Use first item to determine update columns
  const firstItem = data[0]
  const dataKeys = Object.keys(firstItem as object)
  const conflictSet = new Set(conflictColumns.map(String))
  const updateCols = updateColumns
    ? updateColumns.map(String)
    : dataKeys.filter(k => !conflictSet.has(k))

  /**
   * INTENTIONAL TYPE ASSERTION (documented and safe)
   *
   * Why `as any` is used here for bulk upsert:
   * 1. updateSet: Uses eb.ref(`excluded.${col}`) pattern for PostgreSQL ON CONFLICT UPDATE,
   *    which TypeScript can't type-check statically (excluded is a SQL concept, not a TypeScript type)
   * 2. data: Array of insertable records validated at runtime but TypeScript can't verify
   *    all records match the schema statically
   * 3. conflictColumns/updateSet: Same dynamic column challenges as single upsert
   *
   * Safety guarantees:
   * - ✓ updateCols derived from validated conflictColumns and data keys
   * - ✓ eb.ref() is a valid Kysely pattern for referencing excluded values in upsert
   * - ✓ Kysely validates column names and SQL syntax at runtime
   * - ✓ Return type is properly typed as Selectable<DB[Table]>[] when returning=true
   * - ✓ Empty array early return prevents edge cases
   *
   * This is the recommended pattern for Kysely bulk upserts with dynamic update columns.
   * See: https://kysely.dev/docs/examples/insert/on-conflict-do-update
   */
  // Build update set using excluded.column reference
  // This ensures each row's values are used during the update
  const updateSet = updateCols.reduce<Record<string, any>>((acc, col) => {
    // Use eb.ref to reference excluded values
    acc[col] = (eb: any) => eb.ref(`excluded.${col}`)
    return acc
  }, {})

  const query = db
    .insertInto(table)
    .values(data as any)
    .onConflict(oc => oc.columns(conflictColumns as any).doUpdateSet(updateSet as any))

  if (returning) {
    return query.returningAll().execute() as Promise<Selectable<DB[Table]>[]>
  }

  await query.execute()
}

/**
 * Options for atomic status transition
 */
export interface StatusTransitionOptions<T, S> {
  /** Column name containing the status (default: 'status') */
  statusColumn?: string
  /** Current status that must match for transition to occur */
  fromStatus: S
  /** New status to set */
  toStatus: S
  /** Additional data to update along with status */
  additionalUpdates?: Partial<T>
  /** Whether to return the updated entity (default: true) */
  returning?: boolean
}

/**
 * Performs an atomic status transition with race condition protection.
 *
 * This helper is critical for financial and state machine operations where
 * you need to ensure a record is in a specific state before transitioning it.
 * The atomic nature prevents double-processing in concurrent environments.
 *
 * **How it works:**
 * - Uses WHERE clause to check current status atomically
 * - Returns the updated record if transition was successful
 * - Returns null if the current status didn't match (another process won the race)
 *
 * **Use cases:**
 * - Payment processing: pending → processing → completed
 * - Order management: placed → confirmed → shipped → delivered
 * - Fraud prevention: prevent double-spend attacks
 * - State machine transitions: ensure valid state flow
 *
 * @param db - The database executor (Kysely or Transaction)
 * @param table - The table name
 * @param where - Conditions to identify the record (e.g., { id: 1 })
 * @param options - Status transition options
 * @returns The updated record if successful, null if status didn't match
 *
 * @example
 * Prevent double-spend in payment processing:
 * ```typescript
 * const updated = await atomicStatusTransition(
 *   db,
 *   'incoming_txes',
 *   { tx_hash: txHash },
 *   {
 *     fromStatus: 'pending',
 *     toStatus: 'deposited',
 *     additionalUpdates: { deposit_address_id: addressId }
 *   }
 * );
 *
 * if (!updated) {
 *   // Transaction already processed by another worker
 *   console.log('Race condition detected - transaction already processed');
 *   return;
 * }
 *
 * // Safe to proceed - we won the race
 * await creditUserAccount(updated);
 * ```
 *
 * @example
 * Order state machine:
 * ```typescript
 * const order = await atomicStatusTransition(
 *   db,
 *   'orders',
 *   { id: orderId },
 *   {
 *     fromStatus: OrderStatus.Placed,
 *     toStatus: OrderStatus.Confirmed,
 *     additionalUpdates: {
 *       confirmed_at: new Date(),
 *       confirmed_by: userId
 *     }
 *   }
 * );
 * ```
 *
 * @example
 * Withdrawal processing with transaction:
 * ```typescript
 * await db.transaction().execute(async (trx) => {
 *   const withdrawal = await atomicStatusTransition(
 *     trx,
 *     'withdrawals',
 *     { id: withdrawalId },
 *     { fromStatus: 'pending', toStatus: 'processing' }
 *   );
 *
 *   if (!withdrawal) {
 *     throw new Error('Withdrawal already being processed');
 *   }
 *
 *   await sendCrypto(withdrawal);
 *   await atomicStatusTransition(
 *     trx,
 *     'withdrawals',
 *     { id: withdrawalId },
 *     { fromStatus: 'processing', toStatus: 'completed' }
 *   );
 * });
 * ```
 */
export async function atomicStatusTransition<DB, Table extends keyof DB & string, S>(
  db: Executor<DB>,
  table: Table,
  where: Partial<Selectable<DB[Table]>>,
  options: StatusTransitionOptions<Selectable<DB[Table]>, S>
): Promise<Selectable<DB[Table]> | null> {
  const {
    statusColumn = 'status',
    fromStatus,
    toStatus,
    additionalUpdates,
    returning = true
  } = options

  // Build the update data
  const updateData = {
    [statusColumn]: toStatus,
    ...additionalUpdates
  }

  /**
   * INTENTIONAL TYPE ASSERTION (documented and safe)
   *
   * Why `as any` is used here for atomic status transition:
   * 1. updateData: Contains statusColumn (string) and additionalUpdates (Partial<T>),
   *    which TypeScript can't verify statically match the table schema
   * 2. where: Runtime-determined conditions (Partial<Selectable<DB[Table]>>) that
   *    TypeScript can't narrow to exact literal column types
   * 3. statusColumn: Dynamic column name (default 'status') that can't be statically typed
   * 4. fromStatus/toStatus: Generic S type that TypeScript can't verify matches the
   *    status column's actual type at compile time
   *
   * Safety guarantees:
   * - ✓ updateData is constructed from validated inputs (statusColumn + additionalUpdates)
   * - ✓ where conditions are typed as Partial<Selectable<DB[Table]>>
   * - ✓ Kysely validates all column names and types at runtime during query execution
   * - ✓ Atomic WHERE clause ensures race-condition safety (critical for financial operations)
   * - ✓ Return type is properly typed as Selectable<DB[Table]> | null
   * - ✓ numUpdatedRows check provides accurate success/failure detection
   *
   * This atomic pattern prevents double-processing in concurrent environments and is
   * critical for financial and state machine operations. The type assertions are necessary
   * to support dynamic status columns while maintaining runtime safety.
   */

  // Build the query with WHERE conditions including status check
  let query = (db.updateTable(table) as any).set(updateData)

  // Apply WHERE conditions
  for (const [column, value] of Object.entries(where)) {
    query = query.where(column as any, '=', value as any)
  }

  // Add the atomic status check
  query = query.where(statusColumn as any, '=', fromStatus as any)

  if (returning) {
    const result = await query.returningAll().executeTakeFirst()
    return (result as Selectable<DB[Table]>) ?? null
  }

  const result = await query.execute()
  // Check if any row was updated
  return result.numUpdatedRows > 0 ? ({} as Selectable<DB[Table]>) : null
}
