import type { SelectQueryBuilder, ExpressionBuilder } from 'kysely';

/**
 * Encode cursor for pagination
 *
 * Optimizations:
 * - Single column: encodes value directly (more compact)
 * - Multi-column: uses JSON encoding (more flexible)
 *
 * Format:
 * - Single column: `${base64(column)}:${base64(value)}`
 * - Multi-column: `${base64(JSON.stringify(obj))}`
 */
function encodeCursor<T>(orderBy: Array<{ column: keyof T & string }>, lastRow: T): string {
  if (orderBy.length === 1) {
    // Single column optimization: encode column and value separately
    const column = orderBy[0]!.column;
    const value = (lastRow as any)[column];

    // Handle undefined/null values (shouldn't normally happen, but handle gracefully)
    if (value === undefined || value === null) {
      // Fall back to multi-column encoding which handles undefined correctly
      const cursorObj = { [column]: value };
      return Buffer.from(JSON.stringify(cursorObj)).toString('base64');
    }

    const columnB64 = Buffer.from(String(column)).toString('base64');
    const valueB64 = Buffer.from(JSON.stringify(value)).toString('base64');
    return `${columnB64}:${valueB64}`;
  }

  // Multi-column: use JSON encoding
  const cursorObj = orderBy.reduce(
    (acc, { column }) => {
      acc[column] = (lastRow as any)[column];
      return acc;
    },
    {} as Record<string, any>
  );

  return Buffer.from(JSON.stringify(cursorObj)).toString('base64');
}

/**
 * Decode cursor for pagination
 *
 * Supports both formats:
 * - Single column: `${base64(column)}:${base64(value)}`
 * - Multi-column: `${base64(JSON.stringify(obj))}`
 */
function decodeCursor(cursor: string): Record<string, any> {
  // Check for single-column format (has colon separator)
  if (cursor.includes(':') && cursor.split(':').length === 2) {
    try {
      const [columnB64, valueB64] = cursor.split(':') as [string, string];
      const column = Buffer.from(columnB64, 'base64').toString();
      const value = JSON.parse(Buffer.from(valueB64, 'base64').toString());
      return { [column]: value };
    } catch {
      // Fall through to multi-column decoding
    }
  }

  // Multi-column format (or single-column fallback)
  const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
  return decoded as Record<string, any>;
}

export interface PaginationOptions {
  page?: number | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasNext: boolean;
    hasPrev?: boolean;
    nextCursor?: string;
    prevCursor?: string;
  };
}

/**
 * Offset-based pagination
 */
export async function paginate<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: PaginationOptions = {}
): Promise<PaginatedResult<O>> {
  const page = Math.max(1, options.page || 1);
  const limit = options.limit === 0 ? 0 : Math.min(100, Math.max(1, options.limit || 20));
  const offset = (page - 1) * limit;

  // Get total count
  const countQuery = query.clearSelect().clearOrderBy() as SelectQueryBuilder<DB, TB, { count: string }>;
  const { count } = await countQuery
    .select((eb: ExpressionBuilder<DB, TB>) => eb.fn.countAll().as('count'))
    .executeTakeFirstOrThrow();

  const total = Number(count);
  const totalPages = limit === 0 ? 0 : Math.ceil(total / limit);

  // Get paginated data
  const data = await query.limit(limit).offset(offset).execute();

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Cursor options for advanced pagination
 */
export interface CursorOptions<T> {
  orderBy: Array<{
    column: keyof T & string;
    direction: 'asc' | 'desc';
  }>;
  cursor?: string | undefined;
  limit?: number | undefined;
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
  const { orderBy, cursor, limit = 20 } = options;

  let finalQuery = query;

  if (cursor) {
    // Decode and validate cursor
    let decoded: Record<string, any>;
    try {
      decoded = decodeCursor(cursor);
    } catch {
      throw new Error('Invalid pagination cursor: unable to decode');
    }

    // Validate cursor has all required columns
    for (const { column } of orderBy) {
      if (!(column in decoded)) {
        throw new Error(`Invalid pagination cursor: missing column '${String(column)}'`);
      }
    }

    // Build compound WHERE clause for cursor
    if (orderBy.length === 1) {
      // Simple single-column cursor
      const firstOrder = orderBy[0];
      if (firstOrder) {
        const { column, direction } = firstOrder;
        const op = direction === 'asc' ? '>' : '<';
        finalQuery = finalQuery.where(column as any, op, decoded[column]);
      }
    } else {
      // Multi-column cursor - Build compound OR conditions
      // For each level, create: (previous columns =) AND (current column >/<)
      //
      // Example for score ASC, created_at ASC with cursor (50, '2024-01-01'):
      // WHERE (score > 50)
      //    OR (score = 50 AND created_at > '2024-01-01')

      finalQuery = finalQuery.where((eb: any) => {
        const conditions: any[] = [];

        for (let i = 0; i < orderBy.length; i++) {
          const currentOrder = orderBy[i];
          if (!currentOrder) continue;

          const { column, direction } = currentOrder;
          const value = decoded[column];
          const op = direction === 'asc' ? '>' : '<';

          // Build AND condition for this level
          const andConditions: any[] = [];

          // Equality on all previous columns
          for (let j = 0; j < i; j++) {
            const prevOrder = orderBy[j];
            if (prevOrder) {
              const prevCol = prevOrder.column;
              andConditions.push(eb(prevCol, '=', decoded[prevCol]));
            }
          }

          // Comparison on current column
          andConditions.push(eb(column, op, value));

          // Combine with AND
          if (andConditions.length === 1) {
            conditions.push(andConditions[0]);
          } else {
            conditions.push(eb.and(andConditions));
          }
        }

        // Combine all conditions with OR
        return eb.or(conditions);
      });
    }
  }

  // Apply ordering
  for (const { column, direction } of orderBy) {
    finalQuery = finalQuery.orderBy(column as any, direction);
  }

  // Fetch one extra row to determine if there's a next page
  const data = await finalQuery.limit(limit + 1).execute();

  const hasNext = data.length > limit;
  if (hasNext) data.pop();

  // Encode cursor from last row (optimized for single-column cursors)
  const nextCursor = hasNext && data.length > 0 ? encodeCursor(orderBy, data[data.length - 1] as O) : undefined;

  const result: PaginatedResult<O> = {
    data,
    pagination: {
      limit,
      hasNext,
    },
  };

  if (nextCursor !== undefined) {
    result.pagination.nextCursor = nextCursor;
  }

  return result;
}

/**
 * Simple cursor pagination (backward compatible)
 */
export async function paginateCursorSimple<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  options: PaginationOptions = {}
): Promise<PaginatedResult<O>> {
  const cursorOptions: CursorOptions<O> = {
    orderBy: [{ column: 'id' as keyof O & string, direction: 'asc' }],
  };

  if (options.cursor !== undefined) {
    cursorOptions.cursor = options.cursor;
  }

  if (options.limit !== undefined) {
    cursorOptions.limit = options.limit;
  }

  return paginateCursor(query, cursorOptions);
}
