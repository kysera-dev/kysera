import type { Selectable, InsertQueryBuilder, SelectQueryBuilder, DeleteQueryBuilder } from 'kysely';
import type { TableOperations } from './base-repository.js';
import type { Executor } from './helpers.js';
import type { PrimaryKeyConfig, PrimaryKeyInput, CompositeKeyValue } from './types.js';
import { getPrimaryKeyColumns, normalizePrimaryKeyInput, isCompositeKey } from './types.js';
import { DatabaseError } from '@kysera/core';

/**
 * Type helper to convert unknown results to typed results
 * This is safe because we control the query structure and validate inputs
 */
function castResults<T>(results: unknown): T {
  return results as T;
}

/**
 * Internal interface for database executors with adapter access
 * This provides a type-safe way to access internal Kysely properties
 */
interface DatabaseExecutorWithAdapter {
  getExecutor?: () => {
    adapter?: {
      constructor?: {
        name?: string;
      };
    };
  };
}

/**
 * Check if the database is MySQL
 * MySQL doesn't support RETURNING clause properly
 */
function isMySQL<DB>(db: Executor<DB>): boolean {
  try {
    // Type assertion is necessary here because we need to access internal Kysely properties
    // that aren't part of the public API. This is safe because we handle all errors.
    const dbWithAdapter = db as unknown as DatabaseExecutorWithAdapter;
    const executor = dbWithAdapter.getExecutor?.();
    const adapter = executor?.adapter;

    if (adapter?.constructor?.name) {
      const adapterName = adapter.constructor.name.toLowerCase();
      return adapterName.includes('mysql');
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Type-safe query builder wrappers for dynamic operations
 * We use `any` for the third type parameter because Kysely's selection types
 * become too complex with dynamic operations. This is intentional and safe because:
 * - Input is validated by Zod schemas
 * - Output is cast to the correct type via castResults
 * - The query builders themselves maintain runtime type safety
 */
type DynamicSelectQuery<DB, TableName extends keyof DB> = SelectQueryBuilder<DB, TableName, any>;
type DynamicDeleteQuery<DB, TableName extends keyof DB> = DeleteQueryBuilder<DB, TableName, any>;

/**
 * Helper interface for insert result with insertId (MySQL-specific)
 */
interface InsertResult {
  insertId?: bigint | number;
  numInsertedOrUpdatedRows?: bigint | number;
}

/**
 * Helper interface for delete result
 */
interface DeleteResult {
  numDeletedRows?: bigint | number;
}

/**
 * Helper to build a where clause for primary key lookup
 * Supports both single and composite primary keys
 */
function buildWherePrimaryKey<DB, TableName extends keyof DB>(
  query: DynamicSelectQuery<DB, TableName>,
  pkConfig: PrimaryKeyConfig,
  keyValue: PrimaryKeyInput
): DynamicSelectQuery<DB, TableName> {
  const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, keyValue);
  let result = query;

  for (const [column, value] of Object.entries(keyRecord)) {
    result = result.where(column as never, '=', value as never) as DynamicSelectQuery<DB, TableName>;
  }

  return result;
}

/**
 * Helper to build a where clause for 'id in (...)' operations
 * For composite keys, this builds multiple OR conditions
 */
function buildWherePrimaryKeyIn<DB, TableName extends keyof DB>(
  query: DynamicSelectQuery<DB, TableName>,
  pkConfig: PrimaryKeyConfig,
  keyValues: PrimaryKeyInput[]
): DynamicSelectQuery<DB, TableName> {
  if (keyValues.length === 0) {
    // Return a query that matches nothing
    return query.where('1' as never, '=', '0' as never) as DynamicSelectQuery<DB, TableName>;
  }

  const columns = getPrimaryKeyColumns(pkConfig.columns);

  if (columns.length === 1) {
    // Simple case: single column primary key
    const column = columns[0]!;
    const values = keyValues.map((kv) => {
      if (typeof kv === 'object') {
        return (kv as CompositeKeyValue)[column];
      }
      return kv;
    });
    return query.where(column as never, 'in', values as never) as DynamicSelectQuery<DB, TableName>;
  }

  // Composite key: build OR conditions for each key tuple
  return query.where((eb: any) => {
    const conditions = keyValues.map((keyValue) => {
      const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, keyValue);
      const andConditions = Object.entries(keyRecord).map(([col, val]) => eb(col, '=', val));
      return eb.and(andConditions);
    });
    return eb.or(conditions);
  }) as DynamicSelectQuery<DB, TableName>;
}

/**
 * Helper to build a where clause for delete with primary key
 */
function buildDeleteWherePrimaryKey<DB, TableName extends keyof DB>(
  query: DynamicDeleteQuery<DB, TableName>,
  pkConfig: PrimaryKeyConfig,
  keyValue: PrimaryKeyInput
): DynamicDeleteQuery<DB, TableName> {
  const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, keyValue);
  let result = query;

  for (const [column, value] of Object.entries(keyRecord)) {
    result = result.where(column as never, '=', value as never) as DynamicDeleteQuery<DB, TableName>;
  }

  return result;
}

/**
 * Helper to build a where clause for delete with primary key in (...)
 */
function buildDeleteWherePrimaryKeyIn<DB, TableName extends keyof DB>(
  query: DynamicDeleteQuery<DB, TableName>,
  pkConfig: PrimaryKeyConfig,
  keyValues: PrimaryKeyInput[]
): DynamicDeleteQuery<DB, TableName> {
  if (keyValues.length === 0) {
    // Return a query that matches nothing
    return query.where('1' as never, '=', '0' as never) as DynamicDeleteQuery<DB, TableName>;
  }

  const columns = getPrimaryKeyColumns(pkConfig.columns);

  if (columns.length === 1) {
    // Simple case: single column primary key
    const column = columns[0]!;
    const values = keyValues.map((kv) => {
      if (typeof kv === 'object') {
        return (kv as CompositeKeyValue)[column];
      }
      return kv;
    });
    return query.where(column as never, 'in', values as never) as DynamicDeleteQuery<DB, TableName>;
  }

  // Composite key: build OR conditions for each key tuple
  return query.where((eb: any) => {
    const conditions = keyValues.map((keyValue) => {
      const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, keyValue);
      const andConditions = Object.entries(keyRecord).map(([col, val]) => eb(col, '=', val));
      return eb.and(andConditions);
    });
    return eb.or(conditions);
  }) as DynamicDeleteQuery<DB, TableName>;
}

/**
 * Helper to build dynamic where clauses from conditions
 */
function buildDynamicWhere<DB, TableName extends keyof DB>(
  query: DynamicSelectQuery<DB, TableName>,
  conditions: Record<string, unknown>
): DynamicSelectQuery<DB, TableName> {
  let result = query;
  for (const [key, value] of Object.entries(conditions)) {
    // Type assertion needed: Column names are dynamic at runtime
    // Runtime safety: Validated by Zod schemas in repository layer
    result = result.where(key as never, '=', value as never) as DynamicSelectQuery<DB, TableName>;
  }
  return result;
}

/**
 * Helper to build orderBy and pagination
 */
function buildOrderByAndPaginate<DB, TableName extends keyof DB>(
  query: DynamicSelectQuery<DB, TableName>,
  orderBy: string,
  orderDirection: 'asc' | 'desc',
  limit: number,
  offset: number
): DynamicSelectQuery<DB, TableName> {
  // Type assertion needed: orderBy column is dynamic
  // Runtime safety: Validated at repository layer
  return query
    .orderBy(orderBy as never, orderDirection)
    .limit(limit)
    .offset(offset) as DynamicSelectQuery<DB, TableName>;
}

/**
 * Extract primary key value from a row
 */
function extractPrimaryKeyFromRow<T>(
  row: T,
  pkConfig: PrimaryKeyConfig
): PrimaryKeyInput {
  const columns = getPrimaryKeyColumns(pkConfig.columns);
  
  if (columns.length === 1) {
    const column = columns[0]!;
    return (row as any)[column];
  }

  const result: CompositeKeyValue = {};
  for (const column of columns) {
    result[column] = (row as any)[column];
  }
  return result;
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
  db: Executor<DB>,
  tableName: TableName,
  pkConfig: PrimaryKeyConfig = { columns: 'id', type: 'number' }
): TableOperations<DB[TableName]> {
  type Table = DB[TableName];
  type SelectTable = Selectable<Table>;

  // Get the first primary key column for default ordering
  const defaultOrderColumn = getPrimaryKeyColumns(pkConfig.columns)[0] ?? 'id';

  return {
    async selectAll(): Promise<SelectTable[]> {
      const result = await db.selectFrom(tableName).selectAll().execute();

      return castResults<SelectTable[]>(result);
    },

    async selectById(id: PrimaryKeyInput): Promise<SelectTable | undefined> {
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
      const query = buildWherePrimaryKey(baseQuery, pkConfig, id);
      const result = await query.executeTakeFirst();

      return castResults<SelectTable | undefined>(result);
    },

    async selectByIds(ids: PrimaryKeyInput[]): Promise<SelectTable[]> {
      if (ids.length === 0) return [];
      
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
      const query = buildWherePrimaryKeyIn(baseQuery, pkConfig, ids);
      const result = await query.execute();

      return castResults<SelectTable[]>(result);
    },

    async selectWhere(conditions: Record<string, unknown>): Promise<SelectTable[]> {
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
      const query = buildDynamicWhere(baseQuery, conditions);
      const result = await query.execute();

      return castResults<SelectTable[]>(result);
    },

    async selectOneWhere(conditions: Record<string, unknown>): Promise<SelectTable | undefined> {
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
      const query = buildDynamicWhere(baseQuery, conditions);
      const result = await query.executeTakeFirst();

      return castResults<SelectTable | undefined>(result);
    },

    async insert(data: unknown): Promise<SelectTable> {
      const usesMySQL = isMySQL(db);

      if (usesMySQL) {
        // MySQL doesn't support RETURNING, use insertId
        const result = await db
          .insertInto(tableName)
          .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
          .executeTakeFirst();

        // Type assertion needed: MySQL returns insertId which isn't in Kysely's type definitions
        const insertResult = result as unknown as InsertResult;
        
        // For auto-increment PKs, use insertId; otherwise, get PK from input data
        let lookupKey: PrimaryKeyInput;
        
        if (pkConfig.type === 'number' && !isCompositeKey(pkConfig.columns) && insertResult.insertId) {
          lookupKey = Number(insertResult.insertId);
        } else {
          // For non-auto-increment keys, the key should be in the input data
          lookupKey = extractPrimaryKeyFromRow(data, pkConfig);
        }

        // Fetch the inserted record
        const selectQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
        const queryWithWhere = buildWherePrimaryKey(selectQuery, pkConfig, lookupKey);
        const record = await queryWithWhere.executeTakeFirst();

        if (!record) {
          throw new DatabaseError('Failed to fetch created record', 'FETCH_FAILED', tableName);
        }

        return castResults<SelectTable>(record);
      } else {
        // PostgreSQL and SQLite support RETURNING
        const result = await db
          .insertInto(tableName)
          .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
          .returningAll()
          .executeTakeFirst();

        if (!result) {
          throw new DatabaseError('Failed to create record', 'INSERT_FAILED', tableName);
        }

        return castResults<SelectTable>(result);
      }
    },

    async insertMany(data: unknown[]): Promise<SelectTable[]> {
      const usesMySQL = isMySQL(db);

      if (usesMySQL) {
        // MySQL doesn't support RETURNING for bulk inserts
        // We need to insert each row and fetch it back
        const results: SelectTable[] = [];

        for (const item of data) {
          const result = await db
            .insertInto(tableName)
            .values(item as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
            .executeTakeFirst();

          // Type assertion needed: MySQL returns insertId which isn't in Kysely's type definitions
          const insertResult = result as unknown as InsertResult;
          
          let lookupKey: PrimaryKeyInput;
          
          if (pkConfig.type === 'number' && !isCompositeKey(pkConfig.columns) && insertResult.insertId) {
            lookupKey = Number(insertResult.insertId);
          } else {
            lookupKey = extractPrimaryKeyFromRow(item, pkConfig);
          }

          // Fetch the inserted record
          const selectQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
          const queryWithWhere = buildWherePrimaryKey(selectQuery, pkConfig, lookupKey);
          const record = await queryWithWhere.executeTakeFirst();

          if (record) {
            results.push(castResults<SelectTable>(record));
          }
        }

        return results;
      } else {
        // PostgreSQL and SQLite support RETURNING
        const result = await db
          .insertInto(tableName)
          .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
          .returningAll()
          .execute();

        return castResults<SelectTable[]>(result);
      }
    },

    async updateById(id: PrimaryKeyInput, data: unknown): Promise<SelectTable | undefined> {
      const usesMySQL = isMySQL(db);
      const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, id);

      // Type assertion needed: .set() accepts dynamic data that can't be fully typed at compile time
      // Runtime safety: Data is validated by Zod schemas in repository layer
      const baseQuery = db.updateTable(tableName);
      let query: any = (baseQuery as any).set(data);

      // Add where conditions for primary key
      for (const [column, value] of Object.entries(keyRecord)) {
        query = query.where(column, '=', value);
      }

      if (usesMySQL) {
        // MySQL doesn't support RETURNING for UPDATE
        await query.execute();

        // Fetch the updated record
        const selectQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
        const queryWithWhere = buildWherePrimaryKey(selectQuery, pkConfig, id);
        const record = await queryWithWhere.executeTakeFirst();

        return castResults<SelectTable | undefined>(record);
      } else {
        // PostgreSQL and SQLite support RETURNING
        const result = await query.returningAll().executeTakeFirst();

        return castResults<SelectTable | undefined>(result);
      }
    },

    async deleteById(id: PrimaryKeyInput): Promise<boolean> {
      const baseQuery = db.deleteFrom(tableName) as DynamicDeleteQuery<DB, TableName>;
      const query = buildDeleteWherePrimaryKey(baseQuery, pkConfig, id);
      const result = await query.execute();

      // Type assertion needed: Delete result structure varies by database
      const deleteResult = result as unknown as DeleteResult[];
      return Array.isArray(deleteResult) && deleteResult.length > 0
        ? (deleteResult[0]?.numDeletedRows ?? BigInt(0)) > 0
        : false;
    },

    async deleteByIds(ids: PrimaryKeyInput[]): Promise<number> {
      if (ids.length === 0) return 0;
      
      const baseQuery = db.deleteFrom(tableName) as DynamicDeleteQuery<DB, TableName>;
      const query = buildDeleteWherePrimaryKeyIn(baseQuery, pkConfig, ids);
      const result = await query.execute();

      // Type assertion needed: Delete result structure varies by database
      const deleteResult = result as unknown as DeleteResult[];
      return Array.isArray(deleteResult) && deleteResult.length > 0
        ? Number(deleteResult[0]?.numDeletedRows ?? 0)
        : 0;
    },

    async count(conditions?: Record<string, unknown>): Promise<number> {
      const baseQuery = db.selectFrom(tableName);
      // Type assertion needed: Function calls create complex return types that can't be fully typed
      // Runtime safety: Query structure is controlled and known
      let query: any = (baseQuery as any).select(db.fn.countAll().as('count'));

      if (conditions) {
        for (const [key, value] of Object.entries(conditions)) {
          query = query.where(key, '=', value);
        }
      }

      const result = await query.executeTakeFirst();
      const count = result?.count;

      return count ? Number(count) : 0;
    },

    async paginate(options: {
      limit: number;
      offset: number;
      orderBy: string;
      orderDirection: 'asc' | 'desc';
    }): Promise<SelectTable[]> {
      const { limit, offset, orderBy, orderDirection } = options;

      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;
      const query = buildOrderByAndPaginate(baseQuery, orderBy, orderDirection, limit, offset);
      const result = await query.execute();

      return castResults<SelectTable[]>(result);
    },

    async paginateCursor(options: {
      limit: number;
      cursor?: {
        value: unknown;
        id: PrimaryKeyInput;
      } | null;
      orderBy: string;
      orderDirection: 'asc' | 'desc';
    }): Promise<SelectTable[]> {
      const { limit, cursor, orderBy, orderDirection } = options;

      let query = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>;

      // Apply keyset pagination using WHERE clause
      if (cursor) {
        const { value, id } = cursor;
        const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, id);
        
        // For composite keys, we need to handle tie-breaking differently
        const pkColumns = getPrimaryKeyColumns(pkConfig.columns);
        const firstPkColumn = pkColumns[0] ?? 'id';

        // Type assertion needed: ExpressionBuilder requires dynamic column references
        // Runtime safety: orderBy is validated at repository layer
        if (orderDirection === 'asc') {
          // For ascending: (orderBy > value) OR (orderBy = value AND pk > cursor.pk)
          query = query.where((eb: any) =>
            eb.or([
              eb(orderBy, '>', value),
              eb.and([
                eb(orderBy, '=', value),
                eb(firstPkColumn, '>', keyRecord[firstPkColumn]),
              ]),
            ])
          ) as DynamicSelectQuery<DB, TableName>;
        } else {
          // For descending: (orderBy < value) OR (orderBy = value AND pk > cursor.pk)
          query = query.where((eb: any) =>
            eb.or([
              eb(orderBy, '<', value),
              eb.and([
                eb(orderBy, '=', value),
                eb(firstPkColumn, '>', keyRecord[firstPkColumn]),
              ]),
            ])
          ) as DynamicSelectQuery<DB, TableName>;
        }
      }

      // Apply ordering (primary by orderBy, secondary by first pk column for tie-breaking)
      // Type assertion needed: orderBy is a dynamic column name
      query = query
        .orderBy(orderBy as never, orderDirection)
        .orderBy(defaultOrderColumn as never, 'asc')
        .limit(limit) as DynamicSelectQuery<DB, TableName>;

      const result = await query.execute();

      return castResults<SelectTable[]>(result);
    },
  };
}
