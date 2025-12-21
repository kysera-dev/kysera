import type { Kysely, Insertable, Selectable } from 'kysely';

/**
 * Options for upsert operation
 */
export interface UpsertOptions<T> {
  /** Columns that define the conflict constraint */
  conflictColumns: (keyof T)[];
  /** Columns to update on conflict. If not specified, updates all except conflictColumns */
  updateColumns?: (keyof T)[];
  /** Whether to return the upserted record */
  returning?: boolean;
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
export async function upsert<
  DB,
  Table extends keyof DB & string,
  Row extends DB[Table] extends object ? DB[Table] : never
>(
  db: Kysely<DB>,
  table: Table,
  data: Insertable<Row>,
  options: UpsertOptions<Insertable<Row>>
): Promise<Selectable<Row> | void> {
  const { conflictColumns, updateColumns, returning = false } = options;

  // Determine which columns to update
  const dataKeys = Object.keys(data as object);
  const conflictSet = new Set(conflictColumns.map(String));
  const updateCols = updateColumns
    ? updateColumns.map(String)
    : dataKeys.filter(k => !conflictSet.has(k));

  // Build update set
  const updateSet = updateCols.reduce((acc, col) => {
    acc[col] = (data as any)[col];
    return acc;
  }, {} as Record<string, unknown>);

  let query = db
    .insertInto(table)
    .values(data as any)
    .onConflict((oc) =>
      oc.columns(conflictColumns as any).doUpdateSet(updateSet as any)
    );

  if (returning) {
    return query.returningAll().executeTakeFirstOrThrow() as Promise<Selectable<Row>>;
  }

  await query.execute();
}

/**
 * Batch upsert multiple records
 */
export async function upsertMany<
  DB,
  Table extends keyof DB & string,
  Row extends DB[Table] extends object ? DB[Table] : never
>(
  db: Kysely<DB>,
  table: Table,
  data: Insertable<Row>[],
  options: Omit<UpsertOptions<Insertable<Row>>, 'returning'> & { returning?: false }
): Promise<void>;
export async function upsertMany<
  DB,
  Table extends keyof DB & string,
  Row extends DB[Table] extends object ? DB[Table] : never
>(
  db: Kysely<DB>,
  table: Table,
  data: Insertable<Row>[],
  options: Omit<UpsertOptions<Insertable<Row>>, 'returning'> & { returning: true }
): Promise<Selectable<Row>[]>;
export async function upsertMany<
  DB,
  Table extends keyof DB & string,
  Row extends DB[Table] extends object ? DB[Table] : never
>(
  db: Kysely<DB>,
  table: Table,
  data: Insertable<Row>[],
  options: UpsertOptions<Insertable<Row>>
): Promise<Selectable<Row>[] | void> {
  if (data.length === 0) {
    return options.returning ? [] : undefined;
  }

  const { conflictColumns, updateColumns, returning = false } = options;

  // Use first item to determine update columns
  const firstItem = data[0]!;
  const dataKeys = Object.keys(firstItem as object);
  const conflictSet = new Set(conflictColumns.map(String));
  const updateCols = updateColumns
    ? updateColumns.map(String)
    : dataKeys.filter(k => !conflictSet.has(k));

  // Build update set using excluded.column reference
  // This ensures each row's values are used during the update
  const updateSet = updateCols.reduce((acc, col) => {
    // Use eb.ref to reference excluded values
    acc[col] = (eb: any) => eb.ref(`excluded.${col}`);
    return acc;
  }, {} as Record<string, any>);

  let query = db
    .insertInto(table)
    .values(data as any)
    .onConflict((oc) =>
      oc.columns(conflictColumns as any).doUpdateSet(updateSet as any)
    );

  if (returning) {
    return query.returningAll().execute() as Promise<Selectable<Row>[]>;
  }

  await query.execute();
}
