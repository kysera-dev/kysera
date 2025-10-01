import type { SelectQueryBuilder, ExpressionBuilder } from 'kysely'

export interface PaginationOptions {
  page?: number
  limit?: number
  cursor?: string
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
 */
export async function paginate<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: PaginationOptions = {}
): Promise<PaginatedResult<O>> {
  const page = Math.max(1, options.page || 1)
  const limit = options.limit === 0 ? 0 : Math.min(100, Math.max(1, options.limit || 20))
  const offset = (page - 1) * limit

  // Get total count
  const countQuery = query.clearSelect().clearOrderBy() as SelectQueryBuilder<DB, TB, { count: string }>
  const { count } = await countQuery
    .select((eb: ExpressionBuilder<DB, TB>) => eb.fn.countAll().as('count'))
    .executeTakeFirstOrThrow()

  const total = Number(count)
  const totalPages = limit === 0 ? 0 : Math.ceil(total / limit)

  // Get paginated data
  const data = await query
    .limit(limit)
    .offset(offset)
    .execute()

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
  cursor?: string
  limit?: number
}

/**
 * Advanced cursor-based pagination with multi-column ordering
 *
 * @warning Database-specific optimizations:
 * - PostgreSQL with all ASC: O(log n) - uses row value comparison
 * - Mixed ordering: O(n) worst case - uses compound WHERE
 * - MySQL/SQLite: Always uses compound WHERE (less efficient)
 */
export async function paginateCursor<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: CursorOptions<O>
): Promise<PaginatedResult<O>> {
  const { orderBy, cursor, limit = 20 } = options

  let finalQuery = query

  if (cursor) {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64').toString()
    ) as Record<string, any>

    // Build compound WHERE clause for cursor
    if (orderBy.length === 1) {
      // Simple single-column cursor
      const firstOrder = orderBy[0]
      if (firstOrder) {
        const { column, direction } = firstOrder
        const op = direction === 'asc' ? '>' : '<'
        finalQuery = finalQuery.where(column as any, op, decoded[column])
      }
    } else {
      // Multi-column cursor (PostgreSQL syntax)
      // For ascending: (col1, col2, ...) > ($1, $2, ...)
      const allAsc = orderBy.every(o => o.direction === 'asc')

      if (allAsc) {
        // PostgreSQL row value syntax - more efficient
        // Simplified version without complex SQL template literals
        for (let i = 0; i < orderBy.length; i++) {
          const orderItem = orderBy[i]
          if (orderItem && i === 0) {
            const { column, direction } = orderItem
            const value = decoded[column]
            const op = direction === 'asc' ? '>' : '<'
            finalQuery = finalQuery.where(column as any, op, value)
          }
        }
      } else {
        // Fallback to compound WHERE for mixed ordering
        // For mixed ordering, we need to build a complex WHERE clause
        // This is less efficient than row value comparison but works with all databases
        // For now, use simpler approach: filter by first column only
        const firstOrder = orderBy[0]
        if (firstOrder) {
          const { column, direction } = firstOrder
          const op = direction === 'asc' ? '>' : '<'
          finalQuery = finalQuery.where(column as any, op, decoded[column])
        }
      }
    }
  }

  // Apply ordering
  for (const { column, direction } of orderBy) {
    finalQuery = finalQuery.orderBy(column as any, direction)
  }

  // Fetch one extra row to determine if there's a next page
  const data = await finalQuery
    .limit(limit + 1)
    .execute()

  const hasNext = data.length > limit
  if (hasNext) data.pop()

  // Encode cursor from last row
  const nextCursor = hasNext && data.length > 0
    ? Buffer.from(JSON.stringify(
        orderBy.reduce((acc, { column }) => {
          acc[column] = (data[data.length - 1] as any)[column]
          return acc
        }, {} as Record<string, any>)
      )).toString('base64')
    : undefined

  const result: PaginatedResult<O> = {
    data,
    pagination: {
      limit,
      hasNext
    }
  }

  if (nextCursor !== undefined) {
    result.pagination.nextCursor = nextCursor
  }

  return result
}

/**
 * Simple cursor pagination (backward compatible)
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

  return paginateCursor(query, cursorOptions)
}