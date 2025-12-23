import type { SelectQueryBuilder } from 'kysely'

/**
 * SQLite maximum row limit (max 32-bit signed integer)
 * Used when OFFSET is specified without LIMIT, as SQLite requires LIMIT with OFFSET
 */
const SQLITE_MAX_ROWS = 2147483647

/**
 * Cross-runtime environment variable access
 * Works in Node.js, Bun, and Deno
 *
 * @param key - Environment variable name
 * @returns Environment variable value or undefined
 *
 * @example
 * ```typescript
 * const nodeEnv = getEnv('NODE_ENV');
 * const apiKey = getEnv('API_KEY');
 * ```
 */
export function getEnv(key: string): string | undefined {
  // Node.js / Bun
  if (globalThis.process?.env) {
    return globalThis.process.env[key]
  }
  // Deno
  if (
    typeof (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno !==
    'undefined'
  ) {
    try {
      return (
        globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }
      ).Deno?.env?.get(key)
    } catch {
      return undefined
    }
  }
  // Browser / other - no env vars
  return undefined
}

// Module-level type guards for better performance
function isCountResult(val: unknown): val is { count: string | number } {
  return typeof val === 'object' && val !== null && 'count' in val
}

function isGroupedCountRow(
  val: unknown
): val is Record<string, unknown> & { count: string | number } {
  return typeof val === 'object' && val !== null && 'count' in val
}

/**
 * Options for offset-based pagination without total count
 *
 * Use this when you don't need the total count (lighter than paginate()).
 * Ideal for infinite scroll, simple "Load More" buttons, or when total count is expensive.
 */
export interface OffsetOptions {
  /** Maximum number of rows to return (default: 20, max: 100) */
  limit?: number
  /** Number of rows to skip before starting to return rows (default: 0) */
  offset?: number
}

/**
 * Options for date range filtering
 *
 * Apply date-based filters to queries. Both boundaries are inclusive.
 * If neither from nor to is provided, the query is returned unchanged.
 */
export interface DateRangeOptions {
  /** Start of date range (inclusive) */
  from?: Date
  /** End of date range (inclusive) */
  to?: Date
}

/**
 * Applies limit/offset to a query without counting total.
 *
 * This is a lightweight alternative to `paginate()` that skips the expensive COUNT(*) query.
 * Use this when you don't need pagination metadata (total pages, total count).
 *
 * **Performance characteristics:**
 * - No COUNT(*) query -> ~50% faster than paginate() on large tables
 * - Still requires full table scan for high offsets (consider cursor pagination for deep pagination)
 *
 * **Limits:**
 * - Default limit: 20 rows
 * - Maximum limit: 100 rows (prevents accidental large queries)
 * - Minimum limit: 1 row
 *
 * @param query - The Kysely SelectQueryBuilder to apply pagination to
 * @param options - Pagination options (limit and offset)
 * @returns Modified query with limit/offset applied
 *
 * @example
 * Basic usage with defaults (limit: 20, offset: 0):
 * ```typescript
 * const users = await applyOffset(
 *   db.selectFrom('users').selectAll().where('status', '=', 'active')
 * ).execute();
 * // Returns first 20 active users
 * ```
 *
 * @example
 * Custom limit and offset:
 * ```typescript
 * const users = await applyOffset(
 *   db.selectFrom('users').selectAll(),
 *   { limit: 50, offset: 100 }
 * ).execute();
 * // Returns users 101-150
 * ```
 *
 * @example
 * Infinite scroll / "Load More" pattern:
 * ```typescript
 * async function loadMore(offset: number) {
 *   const posts = await applyOffset(
 *     db.selectFrom('posts')
 *       .selectAll()
 *       .where('published', '=', true)
 *       .orderBy('created_at', 'desc'),
 *     { limit: 20, offset }
 *   ).execute();
 *
 *   return {
 *     posts,
 *     hasMore: posts.length === 20 // If we got full page, there might be more
 *   };
 * }
 * ```
 *
 * @example
 * With complex query:
 * ```typescript
 * const products = await applyOffset(
 *   db.selectFrom('products')
 *     .innerJoin('categories', 'categories.id', 'products.category_id')
 *     .select(['products.id', 'products.name', 'categories.name as category'])
 *     .where('products.price', '>', 100)
 *     .where('products.in_stock', '=', true)
 *     .orderBy('products.price'),
 *   { limit: 10, offset: 0 }
 * ).execute();
 * ```
 */
export function applyOffset<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options?: OffsetOptions
): SelectQueryBuilder<DB, TB, O> {
  let q = query

  // Apply offset first (no upper bound, but must be non-negative)
  if (options?.offset !== undefined) {
    const boundedOffset = Math.max(0, options.offset)
    q = q.offset(boundedOffset)
  }

  // Apply limit with bounds checking
  if (options?.limit !== undefined) {
    // Ensure limit is between 1 and 100
    const boundedLimit = Math.min(100, Math.max(1, options.limit))
    q = q.limit(boundedLimit)
  } else if (options?.offset !== undefined) {
    // SQLite requires LIMIT when OFFSET is used
    // If no limit was specified but offset was, use SQLite max rows constant
    q = q.limit(SQLITE_MAX_ROWS)
  }

  return q
}

/**
 * Applies date range filter to a query.
 *
 * Adds WHERE clauses to filter rows by a date column. Both boundaries are inclusive (>= and <=).
 * This is a convenience helper that handles common date filtering patterns.
 *
 * **Date handling:**
 * - `from` -> `column >= from` (inclusive start)
 * - `to` -> `column <= to` (inclusive end)
 * - Both dates are converted to the database's native date format
 *
 * **Edge cases:**
 * - If neither `from` nor `to` is provided, the query is returned unchanged
 * - If only `from` is provided, filters for dates on or after that date
 * - If only `to` is provided, filters for dates on or before that date
 *
 * @param query - The Kysely SelectQueryBuilder to apply date filtering to
 * @param column - The date column name to filter on (e.g., 'created_at', 'updated_at')
 * @param options - Date range options (from and/or to)
 * @returns Modified query with date range filters applied
 *
 * @example
 * Full date range (from and to):
 * ```typescript
 * const orders = await applyDateRange(
 *   db.selectFrom('orders').selectAll(),
 *   'created_at',
 *   {
 *     from: new Date('2024-01-01'),
 *     to: new Date('2024-12-31')
 *   }
 * ).execute();
 * // Returns orders created between Jan 1 and Dec 31, 2024 (inclusive)
 * ```
 *
 * @example
 * Open-ended range (only from):
 * ```typescript
 * const recentPosts = await applyDateRange(
 *   db.selectFrom('posts').selectAll(),
 *   'published_at',
 *   { from: new Date('2024-06-01') }
 * ).execute();
 * // Returns all posts published on or after June 1, 2024
 * ```
 *
 * @example
 * Open-ended range (only to):
 * ```typescript
 * const oldUsers = await applyDateRange(
 *   db.selectFrom('users').selectAll(),
 *   'created_at',
 *   { to: new Date('2023-12-31') }
 * ).execute();
 * // Returns users created on or before Dec 31, 2023
 * ```
 *
 * @example
 * Combining with other filters and helpers:
 * ```typescript
 * const analytics = await applyOffset(
 *   applyDateRange(
 *     db.selectFrom('events')
 *       .select(['event_type', 'user_id', 'created_at'])
 *       .where('event_type', '=', 'page_view')
 *       .orderBy('created_at', 'desc'),
 *     'created_at',
 *     {
 *       from: new Date('2024-01-01'),
 *       to: new Date('2024-01-31')
 *     }
 *   ),
 *   { limit: 100, offset: 0 }
 * ).execute();
 * // Get first 100 page views from January 2024
 * ```
 *
 * @example
 * Last N days pattern:
 * ```typescript
 * function getLastNDays(days: number): DateRangeOptions {
 *   const now = new Date();
 *   const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
 *   return { from, to: now };
 * }
 *
 * const weeklyPosts = await applyDateRange(
 *   db.selectFrom('posts').selectAll().orderBy('created_at', 'desc'),
 *   'created_at',
 *   getLastNDays(7)
 * ).execute();
 * ```
 *
 * @example
 * With transactions:
 * ```typescript
 * await db.transaction().execute(async (trx) => {
 *   const deletedRecords = await applyDateRange(
 *     trx.selectFrom('audit_logs').selectAll(),
 *     'created_at',
 *     { to: new Date('2023-01-01') } // Logs older than 2023
 *   ).execute();
 *
 *   // Delete old audit logs
 *   await trx.deleteFrom('audit_logs')
 *     .where('id', 'in', deletedRecords.map(r => r.id))
 *     .execute();
 * });
 * ```
 */
export function applyDateRange<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  column: string,
  options?: DateRangeOptions
): SelectQueryBuilder<DB, TB, O> {
  let q = query

  // Apply start date filter (inclusive)
  if (options?.from) {
    // Convert Date to ISO string for SQLite compatibility
    const fromValue = options.from instanceof Date ? options.from.toISOString() : options.from
    q = q.where(column as never, '>=', fromValue as never)
  }

  // Apply end date filter (inclusive)
  if (options?.to) {
    // Convert Date to ISO string for SQLite compatibility
    const toValue = options.to instanceof Date ? options.to.toISOString() : options.to
    q = q.where(column as never, '<=', toValue as never)
  }

  return q
}

/**
 * Execute a count query and return the number directly.
 *
 * This is a convenience helper that eliminates the boilerplate of extracting
 * the count from a Kysely query result. It handles the common pattern of:
 * - Clearing existing selects
 * - Adding COUNT(*) aggregate
 * - Executing and extracting the numeric result
 * - Handling null/undefined safely
 *
 * **Performance characteristics:**
 * - Single COUNT(*) query
 * - Clears existing selects to minimize data transfer
 * - Returns primitive number, not object
 *
 * @param query - The Kysely SelectQueryBuilder to count
 * @returns The count as a number (0 if no results)
 *
 * @example
 * Count all active users:
 * ```typescript
 * const count = await executeCount(
 *   db.selectFrom('users').where('status', '=', 'active')
 * );
 * // Returns: 42
 * ```
 *
 * @example
 * Count with complex joins:
 * ```typescript
 * const count = await executeCount(
 *   db.selectFrom('orders')
 *     .innerJoin('users', 'users.id', 'orders.user_id')
 *     .where('users.country', '=', 'US')
 *     .where('orders.status', '=', 'completed')
 * );
 * // Returns: 156
 * ```
 *
 * @example
 * Use in pagination to get total:
 * ```typescript
 * const [data, total] = await Promise.all([
 *   applyOffset(query, { limit: 20, offset: 0 }).execute(),
 *   executeCount(query)
 * ]);
 * ```
 */
export async function executeCount<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>
): Promise<number> {
  const result = await query
    .clearSelect()
    .select(eb => eb.fn.countAll().as('count'))
    .executeTakeFirst()

  return Number(isCountResult(result) ? result.count : 0)
}

/**
 * Execute a grouped count query and return a Record.
 *
 * This is a convenience helper for common "count by category" patterns.
 * It groups rows by a column and returns a Record mapping each unique
 * value to its count.
 *
 * **Performance characteristics:**
 * - Single GROUP BY query
 * - Returns all groups in one query
 * - Result is typed as Record<string, number>
 *
 * @param query - The Kysely SelectQueryBuilder to count
 * @param groupColumn - The column to group by
 * @returns Record mapping group values to counts
 *
 * @example
 * Count orders by status:
 * ```typescript
 * const byStatus = await executeGroupedCount(
 *   db.selectFrom('orders'),
 *   'status'
 * );
 * // Returns: { pending: 5, completed: 10, cancelled: 2 }
 * ```
 *
 * @example
 * Count users by country with filtering:
 * ```typescript
 * const byCountry = await executeGroupedCount(
 *   db.selectFrom('users').where('is_active', '=', true),
 *   'country'
 * );
 * // Returns: { US: 100, UK: 50, DE: 30 }
 * ```
 *
 * @example
 * Count fraud alerts by level (from PaySys):
 * ```typescript
 * const byLevel = await executeGroupedCount(
 *   db.selectFrom('fraud_alerts').where('reviewed', '=', false),
 *   'level'
 * );
 * // Returns: { low: 10, medium: 5, high: 2, critical: 1 }
 * ```
 */
export async function executeGroupedCount<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  groupColumn: string
): Promise<Record<string, number>> {
  const results = await query
    .clearSelect()
    .select([groupColumn as never])
    .select(eb => eb.fn.countAll().as('count'))
    .groupBy(groupColumn as never)
    .execute()

  return results.reduce(
    (acc, row) => {
      if (isGroupedCountRow(row)) {
        const key = String(row[groupColumn])
        acc[key] = Number(row.count)
      }
      return acc
    },
    {} as Record<string, number>
  )
}
