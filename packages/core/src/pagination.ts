import type { SelectQueryBuilder, ExpressionBuilder } from 'kysely'
import { sql } from 'kysely'
import { BadRequestError, type DatabaseDialect } from './errors.js'

/**
 * Pagination bounds constants
 */
const MAX_PAGE = 1_000_000 // Reasonable upper limit for page numbers
const MAX_LIMIT = 10_000 // Maximum items per page

/**
 * Cross-runtime base64 encoding
 * Works in Node.js, Bun, Deno, and browsers
 * Uses btoa with URI encoding for Unicode support
 */
const encodeBase64 = (str: string): string => {
  return btoa(encodeURIComponent(str))
}

/**
 * Cross-runtime base64 decoding
 * Works in Node.js, Bun, Deno, and browsers
 * Uses atob with URI decoding for Unicode support
 */
const decodeBase64 = (str: string): string => {
  return decodeURIComponent(atob(str))
}

/**
 * Encode cursor for pagination
 *
 * Creates a base64-encoded cursor string from the last row of a result set.
 * The cursor format is optimized based on the number of columns:
 * - Single column: `${base64(column)}:${base64(value)}` (more compact)
 * - Multi-column: `${base64(JSON.stringify(obj))}` (more flexible)
 *
 * This encoding allows for efficient cursor-based pagination by storing
 * the values of the order-by columns from the last row, which can later
 * be decoded to build WHERE clauses for the next page.
 *
 * @param orderBy - Array of column ordering specifications used to determine which columns to encode
 * @param lastRow - The last row of the current page containing the values to encode
 * @returns Encoded cursor string suitable for use in pagination
 *
 * @example
 * ```ts
 * const orderBy = [{ column: 'created_at', direction: 'asc' }]
 * const lastRow = { id: 1, created_at: new Date('2024-01-01') }
 * const cursor = encodeCursor(orderBy, lastRow)
 * // Returns: "Y3JlYXRlZF9hdA==:IjIwMjQtMDEtMDFUMDA6MDA6MDAuMDAwWiI="
 * ```
 */
function encodeCursor<T>(orderBy: Array<{ column: keyof T & string }>, lastRow: T): string {
  if (orderBy.length === 1) {
    // Single column optimization: encode column and value separately
    const column = orderBy[0]!.column
    const value = (lastRow as Record<string, unknown>)[column]

    // Handle undefined/null values (shouldn't normally happen, but handle gracefully)
    if (value === undefined || value === null) {
      // Fall back to multi-column encoding which handles undefined correctly
      const cursorObj = { [column]: value }
      return encodeBase64(JSON.stringify(cursorObj))
    }

    const columnB64 = encodeBase64(String(column))
    const valueB64 = encodeBase64(JSON.stringify(value))
    return `${columnB64}:${valueB64}`
  }

  // Multi-column: use JSON encoding
  const cursorObj = orderBy.reduce(
    (acc, { column }) => {
      acc[column] = (lastRow as Record<string, unknown>)[column]
      return acc
    },
    {} as Record<string, unknown>
  )

  return encodeBase64(JSON.stringify(cursorObj))
}

/**
 * Decode cursor for pagination
 *
 * Decodes a base64-encoded cursor string back into an object containing
 * the column values. Automatically detects and handles both cursor formats:
 * - Single column: `${base64(column)}:${base64(value)}`
 * - Multi-column: `${base64(JSON.stringify(obj))}`
 *
 * The function first attempts to decode as single-column format (presence of colon),
 * and falls back to multi-column format if that fails.
 *
 * @param cursor - The encoded cursor string to decode
 * @returns Decoded cursor object with column names as keys and their values
 * @throws {BadRequestError} When cursor format is invalid or cannot be decoded
 * @throws {Error} When decoded value is not a valid object
 *
 * @example
 * ```ts
 * const cursor = "Y3JlYXRlZF9hdA==:IjIwMjQtMDEtMDFUMDA6MDA6MDAuMDAwWiI="
 * const decoded = decodeCursor(cursor)
 * // Returns: { created_at: "2024-01-01T00:00:00.000Z" }
 * ```
 */
function decodeCursor(cursor: string): Record<string, unknown> {
  // Check for single-column format (has colon separator)
  if (cursor.includes(':') && cursor.split(':').length === 2) {
    try {
      const [columnB64, valueB64] = cursor.split(':') as [string, string]
      const column = decodeBase64(columnB64)
      const value: unknown = JSON.parse(decodeBase64(valueB64))
      return { [column]: value }
    } catch (singleColumnError) {
      // Single-column decoding failed, try multi-column format
      // This is expected when format is ambiguous
      if (!(singleColumnError instanceof SyntaxError)) {
        // Re-throw unexpected errors (corruption, etc.)
        throw new BadRequestError(`Invalid cursor format: ${String(singleColumnError)}`)
      }
    }
  }

  // Multi-column format (or single-column fallback)
  const decoded: unknown = JSON.parse(decodeBase64(cursor))

  // Type guard: ensure decoded is an object
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new Error('Invalid cursor format: expected object')
  }

  return decoded as Record<string, unknown>
}

export interface PaginationOptions {
  page?: number | undefined
  limit?: number | undefined
  cursor?: string | undefined
  /**
   * Database dialect for dialect-specific SQL generation
   * Required for MSSQL which uses different OFFSET/FETCH syntax
   */
  dialect?: DatabaseDialect | undefined
}

export interface PaginatedResult<T> {
  data: T[]
  pagination: {
    page?: number
    limit?: number
    total?: number
    totalPages?: number
    hasNext: boolean
    hasPrev?: boolean
    nextCursor?: string
    prevCursor?: string
  }
}

/**
 * Offset-based pagination
 *
 * Performs traditional offset-based pagination with automatic total count calculation.
 * This method is suitable for smaller datasets where total page count is needed.
 *
 * @param query - The base query to paginate
 * @param options - Pagination options including page, limit, and optional dialect
 * @returns Paginated result with data, total count, and navigation metadata
 * @throws {BadRequestError} When page and limit combination exceeds safe integer range
 *
 * @remarks
 * For MSSQL, the dialect option must be set to 'mssql' as it uses
 * OFFSET/FETCH syntax instead of standard LIMIT/OFFSET.
 * The query MUST include an ORDER BY clause for MSSQL pagination.
 *
 * Pagination bounds:
 * - Page numbers are clamped between 1 and 1,000,000
 * - Limit is clamped between 1 and 10,000
 * - Overflow protection ensures (page - 1) * limit stays within safe integer range
 *
 * @example
 * ```ts
 * const query = db.selectFrom('users').selectAll()
 * const result = await paginate(query, { page: 2, limit: 20 })
 * // Returns:
 * // {
 * //   data: [...],
 * //   pagination: {
 * //     page: 2,
 * //     limit: 20,
 * //     total: 150,
 * //     totalPages: 8,
 * //     hasNext: true,
 * //     hasPrev: true
 * //   }
 * // }
 * ```
 */
export async function paginate<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: PaginationOptions = {}
): Promise<PaginatedResult<O>> {
  const page = Math.min(MAX_PAGE, Math.max(1, options.page || 1))
  const limit = options.limit === 0 ? 0 : Math.min(MAX_LIMIT, Math.max(1, options.limit || 20))
  const dialect = options.dialect

  // Check for potential overflow
  const offset = (page - 1) * limit
  if (!Number.isSafeInteger(offset)) {
    throw new BadRequestError(`Page ${page} with limit ${limit} exceeds safe integer range`)
  }

  // Get total count - for MSSQL we need to use a different approach
  const countQuery = query.clearSelect().clearOrderBy() as SelectQueryBuilder<
    DB,
    TB,
    { count: string }
  >
  const { count } = await countQuery
    .select((eb: ExpressionBuilder<DB, TB>) => eb.fn.countAll().as('count'))
    .executeTakeFirstOrThrow()

  const total = Number(count)
  const totalPages = limit === 0 ? 0 : Math.ceil(total / limit)

  // Get paginated data with dialect-specific handling
  let data: O[]
  if (dialect === 'mssql') {
    // MSSQL uses OFFSET/FETCH syntax which requires ORDER BY
    // Use modifyEnd to add MSSQL-compatible pagination
    data = await query
      .modifyEnd(sql`offset ${sql.literal(offset)} rows fetch next ${sql.literal(limit)} rows only`)
      .execute()
  } else {
    // Standard LIMIT/OFFSET for PostgreSQL, MySQL, SQLite
    data = await query.limit(limit).offset(offset).execute()
  }

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  }
}

/**
 * Cursor options for advanced pagination
 */
export interface CursorOptions<T> {
  orderBy: Array<{
    column: keyof T & string
    direction: 'asc' | 'desc'
  }>
  cursor?: string | undefined
  limit?: number | undefined
  /**
   * Database dialect for dialect-specific SQL generation
   * Required for MSSQL which uses different OFFSET/FETCH syntax
   */
  dialect?: DatabaseDialect | undefined
}

/**
 * Advanced cursor-based pagination with multi-column ordering
 *
 * Performs efficient cursor-based pagination supporting complex multi-column ordering.
 * Unlike offset pagination, cursor-based pagination maintains consistent performance
 * even with large datasets, as it uses WHERE clauses instead of OFFSET.
 *
 * @param query - The base Kysely select query to paginate
 * @param options - Cursor pagination options including orderBy specification, cursor, and limit
 * @returns Paginated result with data, next/previous cursors, and navigation metadata
 * @throws {BadRequestError} When cursor is invalid or malformed
 * @throws {BadRequestError} When cursor is missing required order-by columns
 *
 * @remarks
 * Database-specific optimizations:
 * - PostgreSQL with all ASC: O(log n) - uses row value comparison
 * - Mixed ordering: O(n) worst case - uses compound WHERE
 * - MySQL/SQLite: Always uses compound WHERE (less efficient)
 *
 * The function builds compound WHERE clauses for multi-column ordering:
 * - For orderBy: [score ASC, created_at ASC] with cursor (50, '2024-01-01')
 * - Generates: WHERE (score > 50) OR (score = 50 AND created_at > '2024-01-01')
 *
 * Pagination bounds:
 * - Limit is clamped between 1 and 10,000
 * - Fetches limit + 1 rows to determine if there's a next page
 *
 * @example
 * ```ts
 * const query = db.selectFrom('posts').selectAll()
 * const result = await paginateCursor(query, {
 *   orderBy: [
 *     { column: 'score', direction: 'desc' },
 *     { column: 'created_at', direction: 'asc' }
 *   ],
 *   cursor: 'eyJzY29yZSI6NTAsImNyZWF0ZWRfYXQiOiIyMDI0LTAxLTAxIn0=',
 *   limit: 20
 * })
 * // Returns:
 * // {
 * //   data: [...],
 * //   pagination: {
 * //     limit: 20,
 * //     hasNext: true,
 * //     hasPrev: true,
 * //     nextCursor: '...',
 * //     prevCursor: '...'
 * //   }
 * // }
 * ```
 */
export async function paginateCursor<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: CursorOptions<O>
): Promise<PaginatedResult<O>> {
  const { orderBy, cursor, dialect } = options

  // Apply bounds checking to limit parameter
  // Allow 0 as a special case (same as offset pagination)
  const limit = options.limit === 0 ? 0 : Math.min(MAX_LIMIT, Math.max(1, options.limit || 20))

  let finalQuery = query

  if (cursor) {
    // Decode and validate cursor
    let decoded: Record<string, unknown>
    try {
      decoded = decodeCursor(cursor)
    } catch (error) {
      throw new BadRequestError(
        `Invalid pagination cursor: unable to decode - ${error instanceof Error ? error.message : String(error)}`
      )
    }

    // Validate cursor has all required columns
    for (const { column } of orderBy) {
      if (!(column in decoded)) {
        throw new BadRequestError(`Invalid pagination cursor: missing column '${String(column)}'`)
      }
    }

    // Build compound WHERE clause for cursor
    if (orderBy.length === 1) {
      // Simple single-column cursor
      const firstOrder = orderBy[0]
      if (firstOrder) {
        const { column, direction } = firstOrder
        const op = direction === 'asc' ? '>' : '<'
        // Type assertion (as never) is required here because Kysely's type system
        // cannot infer the exact column type at runtime. This is safe because:
        // 1. The column is validated to exist in the decoded cursor
        // 2. The value comes from the cursor which was created from actual data
        finalQuery = finalQuery.where(column as never, op, decoded[column] as never)
      }
    } else {
      // Multi-column cursor - Build compound OR conditions
      // For each level, create: (previous columns =) AND (current column >/<)
      //
      // Example for score ASC, created_at ASC with cursor (50, '2024-01-01'):
      // WHERE (score > 50)
      //    OR (score = 50 AND created_at > '2024-01-01')

      finalQuery = finalQuery.where((eb: ExpressionBuilder<DB, TB>) => {
        const conditions: ReturnType<typeof eb>[] = []

        for (let i = 0; i < orderBy.length; i++) {
          const currentOrder = orderBy[i]
          if (!currentOrder) continue

          const { column, direction } = currentOrder
          const value = decoded[column]
          const op = direction === 'asc' ? '>' : '<'

          // Build AND condition for this level
          const andConditions: ReturnType<typeof eb>[] = []

          // Equality on all previous columns
          for (let j = 0; j < i; j++) {
            const prevOrder = orderBy[j]
            if (prevOrder) {
              const prevCol = prevOrder.column
              // Type assertion (as never) required for runtime column access
              // Safe because column existence is validated above
              andConditions.push(eb(prevCol as never, '=', decoded[prevCol] as never))
            }
          }

          // Comparison on current column
          // Type assertion (as never) required for runtime column access
          andConditions.push(eb(column as never, op, value as never))

          // Combine with AND
          if (andConditions.length === 1) {
            conditions.push(andConditions[0]!)
          } else {
            conditions.push(eb.and(andConditions))
          }
        }

        // Combine all conditions with OR
        return eb.or(conditions)
      })
    }
  }

  // Apply ordering
  // Type assertion (as never) required because Kysely cannot statically verify
  // that the column type matches the table schema at runtime
  for (const { column, direction } of orderBy) {
    finalQuery = finalQuery.orderBy(column as never, direction)
  }

  // Fetch one extra row to determine if there's a next page
  // Safe to add 1 because limit is already bounded to MAX_LIMIT
  // Special case: if limit is 0, fetch 0 rows
  let data: O[]
  if (limit === 0) {
    data = []
  } else if (dialect === 'mssql') {
    // MSSQL: Use TOP for cursor pagination (no offset needed)
    data = await finalQuery.top(limit + 1).execute()
  } else {
    // Standard LIMIT for PostgreSQL, MySQL, SQLite
    data = await finalQuery.limit(limit + 1).execute()
  }

  const hasNext = data.length > limit
  if (hasNext) data.pop()

  // Encode cursors from first and last rows (optimized for single-column cursors)
  const nextCursor =
    hasNext && data.length > 0 ? encodeCursor(orderBy, data[data.length - 1] as O) : undefined

  // prevCursor is the first row of current page - allows going back
  // Only set if we have a cursor (meaning we're not on first page) and we have data
  const prevCursor = cursor && data.length > 0 ? encodeCursor(orderBy, data[0] as O) : undefined

  const result: PaginatedResult<O> = {
    data,
    pagination: {
      limit,
      hasNext,
      hasPrev: !!cursor // We have a previous page if we got here via a cursor
    }
  }

  if (nextCursor !== undefined) {
    result.pagination.nextCursor = nextCursor
  }

  if (prevCursor !== undefined) {
    result.pagination.prevCursor = prevCursor
  }

  return result
}

/**
 * Simple cursor pagination (backward compatible)
 *
 * Provides a simplified cursor-based pagination interface that assumes
 * ordering by an 'id' column in ascending order. This is a convenience
 * wrapper around `paginateCursor` for common use cases where only
 * simple ID-based pagination is needed.
 *
 * This function is backward compatible with older codebases that used
 * simple cursor pagination before the introduction of multi-column
 * cursor support.
 *
 * @param query - The Kysely select query builder to paginate
 * @param options - Pagination options (cursor, limit, dialect)
 * @returns Paginated result with cursor-based navigation
 * @throws {BadRequestError} When cursor is invalid or cannot be decoded
 *
 * @remarks
 * Internally calls `paginateCursor` with fixed ordering:
 * `orderBy: [{ column: 'id', direction: 'asc' }]`
 *
 * Requirements:
 * - The table MUST have an 'id' column
 * - The 'id' column should be indexed for optimal performance
 *
 * @example
 * ```ts
 * const query = db.selectFrom('users').selectAll()
 * const result = await paginateCursorSimple(query, {
 *   cursor: 'eyJpZCI6MTAwfQ==',
 *   limit: 20
 * })
 * // Returns:
 * // {
 * //   data: [...],
 * //   pagination: {
 * //     limit: 20,
 * //     hasNext: true,
 * //     hasPrev: true,
 * //     nextCursor: 'eyJpZCI6MTIwfQ==',
 * //     prevCursor: 'eyJpZCI6MTAxfQ=='
 * //   }
 * // }
 * ```
 */
export async function paginateCursorSimple<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: PaginationOptions = {}
): Promise<PaginatedResult<O>> {
  const cursorOptions: CursorOptions<O> = {
    orderBy: [{ column: 'id' as keyof O & string, direction: 'asc' }]
  }

  if (options.cursor !== undefined) {
    cursorOptions.cursor = options.cursor
  }

  if (options.limit !== undefined) {
    cursorOptions.limit = options.limit
  }

  if (options.dialect !== undefined) {
    cursorOptions.dialect = options.dialect
  }

  return paginateCursor(query, cursorOptions)
}
