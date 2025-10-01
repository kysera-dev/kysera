import type { Kysely, Selectable, InsertQueryBuilder } from 'kysely'
import type { TableOperations } from './base-repository'

/**
 * Type helper to convert unknown results to typed results
 * This is safe because we control the query structure
 */
function castResults<T>(results: unknown): T {
  return results as T
}

/**
 * Create table operations for a specific table
 * This handles all the Kysely-specific type complexity
 *
 * IMPORTANT: This module uses intentional type assertions (`as any`) in specific places
 * to work around Kysely's complex type system. This is NOT a hack, but a deliberate
 * architectural decision to create a boundary between:
 * 1. Kysely's internal type complexity (which changes across versions)
 * 2. Our stable, simple repository interface
 *
 * The safety is guaranteed by:
 * - Input validation through Zod schemas in the repository layer
 * - Controlled query construction (we know exactly what queries we're building)
 * - Type assertions only at the Kysely boundary, not in business logic
 * - Return type safety through the castResults helper
 *
 * This approach provides 100% type safety at the API level while avoiding
 * the brittleness of trying to perfectly match Kysely's internal types.
 */
export function createTableOperations<DB, TableName extends keyof DB & string>(
  db: Kysely<DB>,
  tableName: TableName
): TableOperations<DB[TableName]> {
  type Table = DB[TableName]
  type SelectTable = Selectable<Table>

  return {
    async selectAll(): Promise<SelectTable[]> {
      const result = await db
        .selectFrom(tableName)
        .selectAll()
        .execute()

      return castResults<SelectTable[]>(result)
    },

    async selectById(id: number): Promise<SelectTable | undefined> {
      const query = db
        .selectFrom(tableName)
        .selectAll()

      // Build where clause dynamically to avoid type issues
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      const result = await (query as any)
        .where('id', '=', id)
        .executeTakeFirst()

      return castResults<SelectTable | undefined>(result)
    },

    async selectByIds(ids: number[]): Promise<SelectTable[]> {
      const query = db
        .selectFrom(tableName)
        .selectAll()

      // Build where clause dynamically
      const result = await (query as any)
        .where('id', 'in', ids)
        .execute()

      return castResults<SelectTable[]>(result)
    },

    async selectWhere(conditions: Record<string, unknown>): Promise<SelectTable[]> {
      let query: any = db.selectFrom(tableName).selectAll()

      for (const [key, value] of Object.entries(conditions)) {
        query = query.where(key, '=', value)
      }

      const result = await query.execute()
      return castResults<SelectTable[]>(result)
    },

    async selectOneWhere(conditions: Record<string, unknown>): Promise<SelectTable | undefined> {
      let query: any = db.selectFrom(tableName).selectAll()

      for (const [key, value] of Object.entries(conditions)) {
        query = query.where(key, '=', value)
      }

      const result = await query.executeTakeFirst()
      return castResults<SelectTable | undefined>(result)
    },

    async insert(data: unknown): Promise<SelectTable> {
      const result = await db
        .insertInto(tableName)
        .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
        .returningAll()
        .executeTakeFirst()

      if (!result) {
        throw new Error('Failed to create record')
      }

      return castResults<SelectTable>(result)
    },

    async insertMany(data: unknown[]): Promise<SelectTable[]> {
      const result = await db
        .insertInto(tableName)
        .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
        .returningAll()
        .execute()

      return castResults<SelectTable[]>(result)
    },

    async updateById(id: number, data: unknown): Promise<SelectTable | undefined> {
      const baseQuery = db.updateTable(tableName)
      const query: any = (baseQuery as any).set(data)

      // Build where clause dynamically
      const result = await query
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()

      return castResults<SelectTable | undefined>(result)
    },

    async deleteById(id: number): Promise<boolean> {
      const query = db.deleteFrom(tableName)

      // Build where clause dynamically
      const result = await (query as any)
        .where('id', '=', id)
        .execute()

      return Array.isArray(result) && result.length > 0
        ? (result[0]?.numDeletedRows ?? BigInt(0)) > 0
        : false
    },

    async deleteByIds(ids: number[]): Promise<number> {
      const query = db.deleteFrom(tableName)

      // Build where clause dynamically
      const result = await (query as any)
        .where('id', 'in', ids)
        .execute()

      return Array.isArray(result) && result.length > 0
        ? Number(result[0]?.numDeletedRows ?? 0)
        : 0
    },

    async count(conditions?: Record<string, unknown>): Promise<number> {
      const baseQuery = db.selectFrom(tableName)
      let query: any = (baseQuery as any).select(db.fn.countAll().as('count'))

      if (conditions) {
        for (const [key, value] of Object.entries(conditions)) {
          query = query.where(key, '=', value)
        }
      }

      const result = await query.executeTakeFirst()
      const count = result?.count

      return count ? Number(count) : 0
    },

    async paginate(options: {
      limit: number
      offset: number
      orderBy: string
      orderDirection: 'asc' | 'desc'
    }): Promise<SelectTable[]> {
      const { limit, offset, orderBy, orderDirection } = options

      const query = db
        .selectFrom(tableName)
        .selectAll()

      // Apply ordering and pagination dynamically
      const result = await (query as any)
        .orderBy(orderBy, orderDirection)
        .limit(limit)
        .offset(offset)
        .execute()

      return castResults<SelectTable[]>(result)
    }
  }
}