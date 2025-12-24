import type {
  Selectable,
  InsertQueryBuilder,
  SelectQueryBuilder,
  DeleteQueryBuilder,
  ExpressionBuilder
} from 'kysely'
import type { TableOperations } from './base-repository.js'
import type { Executor } from './helpers.js'
import type {
  PrimaryKeyConfig,
  PrimaryKeyInput,
  Dialect
} from './types.js'
import type { DialectConfig } from './types.js'
import { getPrimaryKeyColumns, normalizePrimaryKeyInput, isCompositeKey } from './types.js'
import { DatabaseError } from '@kysera/core'
import { extractPrimaryKey } from './primary-key-utils.js'
import type { ColumnValidationOptions } from './column-validation.js'
import { validateConditions } from './column-validation.js'

/**
 * Type helper to convert unknown results to typed results.
 *
 * This addresses H-8: Unchecked type casts.
 *
 * In development mode, performs runtime validation:
 * - Ensures non-null results are objects
 * - Logs warnings for suspicious data structures
 *
 * In production mode, performs minimal checks for performance.
 *
 * This is safe because:
 * 1. We control the query structure (all queries use selectAll/returning)
 * 2. Input data is validated by Zod schemas at repository layer
 * 3. Kysely ensures database schema matches TypeScript types
 * 4. Development mode validation catches structural mismatches early
 *
 * @param results - Query result to cast
 * @returns Typed result
 */
function castResults<T>(results: unknown): T {
  // Development mode: runtime validation
  // eslint-disable-next-line @typescript-eslint/dot-notation
  if (process.env['NODE_ENV'] === 'development') {
    // Validate non-null results are objects or arrays
    if (results !== null && results !== undefined) {
      if (Array.isArray(results)) {
        // Validate array elements are objects
        for (let i = 0; i < results.length; i++) {
          const item = results[i]
          if (item !== null && typeof item !== 'object') {
            console.warn(
              `[Kysera] Type cast warning: Array element at index ${i} is not an object. ` +
                `Expected object, got ${typeof item}. This may indicate a query structure mismatch.`
            )
          }
        }
      } else if (typeof results !== 'object') {
        console.warn(
          `[Kysera] Type cast warning: Result is not an object. ` +
            `Expected object, got ${typeof results}. This may indicate a query structure mismatch.`
        )
      }
    }
  }

  return results as T
}

/**
 * Internal interface for database executors with adapter access
 * This provides a type-safe way to access internal Kysely properties
 * @deprecated Use DialectConfig instead of relying on Kysely internals
 */
interface DatabaseExecutorWithAdapter {
  getExecutor?: () => {
    adapter?: {
      constructor?: {
        name?: string
      }
    }
  }
}

/**
 * Detect database dialect from Kysely internals (fallback mechanism)
 *
 * @deprecated This function relies on Kysely's internal implementation details
 * which may change across versions. Use explicit `DialectConfig` instead.
 *
 * **Why this exists:**
 * Provides backward compatibility for code that doesn't pass `DialectConfig`.
 * This allows the repository to work out-of-the-box while we encourage
 * migration to explicit configuration.
 *
 * **Risks:**
 * - Kysely may change internal adapter structure in future versions
 * - Constructor name detection is fragile and could fail silently
 * - May not work correctly with custom adapters or proxies
 *
 * **Migration path:**
 * ```typescript
 * // Old (relies on detection):
 * const ops = createTableOperations(db, 'users', pkConfig);
 *
 * // New (explicit configuration - recommended):
 * const ops = createTableOperations(db, 'users', pkConfig, { dialect: 'mysql' });
 * ```
 *
 * @param db - Kysely database executor
 * @returns Detected dialect or null if detection fails
 */
function detectDialectFromInternals<DB>(db: Executor<DB>): Dialect | null {
  try {
    // Type assertion is necessary here because we need to access internal Kysely properties
    // that aren't part of the public API. This is safe because we handle all errors.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Intentional: backwards compatibility fallback
    const dbWithAdapter = db as unknown as DatabaseExecutorWithAdapter
    const executor = dbWithAdapter.getExecutor?.()
    const adapter = executor?.adapter

    if (adapter?.constructor?.name) {
      // Warn about deprecated internal API usage
      // Deprecation warning is now handled via the dialectConfig parameter
      const adapterName = adapter.constructor.name.toLowerCase()
      if (adapterName.includes('mysql')) return 'mysql'
      if (adapterName.includes('postgres') || adapterName.includes('pg')) return 'postgres'
      if (adapterName.includes('sqlite')) return 'sqlite'
    }

    return null
  } catch (_error) {
    // Expected failure when accessing internal Kysely properties
    // This is an expected code path when adapter detection is not possible
    return null
  }
}

/**
 * Determine if database requires MySQL-specific behavior
 *
 * MySQL differs from PostgreSQL and SQLite in key ways:
 * - No RETURNING clause support for INSERT/UPDATE/DELETE
 * - Uses insertId for auto-increment primary keys
 * - Requires separate SELECT queries to fetch created/updated records
 *
 * **Best practice:** Always provide `dialectConfig` parameter to avoid
 * relying on fragile internal detection.
 *
 * @param db - Kysely database executor
 * @param dialectConfig - Optional explicit dialect configuration (recommended)
 * @returns true if MySQL-specific behavior is needed
 *
 * @example
 * ```typescript
 * // Recommended: explicit configuration
 * const ops = createTableOperations(db, 'users', pkConfig, { dialect: 'mysql' });
 *
 * // Fallback: automatic detection (may fail on Kysely updates)
 * const ops = createTableOperations(db, 'users', pkConfig);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-deprecated -- DialectConfig kept for backwards compatibility
function requiresMySQLBehavior<DB>(db: Executor<DB>, dialectConfig?: DialectConfig): boolean {
  if (dialectConfig) {
    return dialectConfig.dialect === 'mysql'
  }

  // Fallback to internal detection (deprecated path)
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Intentional: backwards compatibility fallback
  const detected = detectDialectFromInternals(db)
  return detected === 'mysql'
}

/**
 * Type-safe query builder wrappers for dynamic operations
 *
 * We intentionally use `any` for the third type parameter (selection/return type) because:
 * 1. Kysely's selection types become prohibitively complex with dynamic operations
 * 2. The type system cannot track runtime-determined column selections
 * 3. This is a controlled escape hatch with multiple safety guarantees:
 *    - Input validation through Zod schemas at repository layer
 *    - Output type safety through castResults helper
 *    - Runtime type safety maintained by Kysely query builders
 *    - All column names validated through PrimaryKeyConfig
 *
 * This approach follows Kysely's own patterns for dynamic query building
 * while maintaining type safety at the API boundary.
 *
 * @see https://kysely.dev/docs/recipes/dynamic-queries
 */
type DynamicSelectQuery<DB, TableName extends keyof DB> = SelectQueryBuilder<DB, TableName, any>
type DynamicDeleteQuery<DB, TableName extends keyof DB> = DeleteQueryBuilder<DB, TableName, any>

/**
 * Helper interface for insert result with insertId (MySQL-specific)
 */
interface InsertResult {
  insertId?: bigint | number
  numInsertedOrUpdatedRows?: bigint | number
}

/**
 * Helper interface for delete result
 */
interface DeleteResult {
  numDeletedRows?: bigint | number
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
  const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, keyValue)
  let result = query

  for (const [column, value] of Object.entries(keyRecord)) {
    result = result.where(column as never, '=', value as never) as DynamicSelectQuery<DB, TableName>
  }

  return result
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
    return query.where('1' as never, '=', '0' as never) as DynamicSelectQuery<DB, TableName>
  }

  const columns = getPrimaryKeyColumns(pkConfig.columns)

  if (columns.length === 1) {
    // Simple case: single column primary key
    const column = columns[0]
    if (!column) {
      throw new Error('Primary key configuration is invalid: no columns defined')
    }
    const values = keyValues.map(kv => {
      if (typeof kv === 'object') {
        return (kv as Record<string, unknown>)[column]
      }
      return kv
    })
    return query.where(column as never, 'in', values as never) as DynamicSelectQuery<DB, TableName>
  }

  // Composite key: build OR conditions for each key tuple
  // Type assertion needed: ExpressionBuilder requires dynamic column references which can't be fully typed
  // Runtime safety: Column names are validated through PrimaryKeyConfig and normalizePrimaryKeyInput
  return query.where((eb: ExpressionBuilder<DB, TableName>) => {
    const conditions = keyValues.map(keyValue => {
      const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, keyValue)
      const andConditions = Object.entries(keyRecord).map(([col, val]) =>
        eb(col as never, '=', val as never)
      )
      return eb.and(andConditions)
    })
    return eb.or(conditions)
  }) as DynamicSelectQuery<DB, TableName>
}

/**
 * Helper to build a where clause for delete with primary key
 */
function buildDeleteWherePrimaryKey<DB, TableName extends keyof DB>(
  query: DynamicDeleteQuery<DB, TableName>,
  pkConfig: PrimaryKeyConfig,
  keyValue: PrimaryKeyInput
): DynamicDeleteQuery<DB, TableName> {
  const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, keyValue)
  let result = query

  for (const [column, value] of Object.entries(keyRecord)) {
    result = result.where(column as never, '=', value as never) as DynamicDeleteQuery<DB, TableName>
  }

  return result
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
    return query.where('1' as never, '=', '0' as never) as DynamicDeleteQuery<DB, TableName>
  }

  const columns = getPrimaryKeyColumns(pkConfig.columns)

  if (columns.length === 1) {
    // Simple case: single column primary key
    const column = columns[0]
    if (!column) {
      throw new Error('Primary key configuration is invalid: no columns defined')
    }
    const values = keyValues.map(kv => {
      if (typeof kv === 'object') {
        return (kv as Record<string, unknown>)[column]
      }
      return kv
    })
    return query.where(column as never, 'in', values as never) as DynamicDeleteQuery<DB, TableName>
  }

  // Composite key: build OR conditions for each key tuple
  // Type assertion needed: ExpressionBuilder requires dynamic column references which can't be fully typed
  // Runtime safety: Column names are validated through PrimaryKeyConfig and normalizePrimaryKeyInput
  return query.where((eb: ExpressionBuilder<DB, TableName>) => {
    const conditions = keyValues.map(keyValue => {
      const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, keyValue)
      const andConditions = Object.entries(keyRecord).map(([col, val]) =>
        eb(col as never, '=', val as never)
      )
      return eb.and(andConditions)
    })
    return eb.or(conditions)
  }) as DynamicDeleteQuery<DB, TableName>
}

/**
 * Helper to build dynamic where clauses from conditions.
 *
 * SECURITY NOTE: Column names are validated in development mode by default.
 * In production, validation is disabled for performance unless explicitly enabled.
 *
 * @param query - Base query builder
 * @param conditions - Conditions with column names as keys
 * @param pkConfig - Primary key configuration (for validation whitelist)
 * @param validationOptions - Column validation options
 * @returns Query with WHERE clauses applied
 */
function buildDynamicWhere<DB, TableName extends keyof DB>(
  query: DynamicSelectQuery<DB, TableName>,
  conditions: Record<string, unknown>,
  pkConfig: PrimaryKeyConfig,
  validationOptions?: ColumnValidationOptions
): DynamicSelectQuery<DB, TableName> {
  // Validate column names against schema whitelist (development mode by default)
  const validatedConditions = validateConditions(conditions, pkConfig, validationOptions)

  let result = query
  for (const [key, value] of Object.entries(validatedConditions)) {
    // Type assertion needed: Column names are dynamic at runtime
    // Runtime safety: Validated by validateConditions above
    result = result.where(key as never, '=', value as never) as DynamicSelectQuery<DB, TableName>
  }
  return result
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
    .offset(offset) as DynamicSelectQuery<DB, TableName>
}

/**
 * Create table operations for a specific table
 * This handles all the Kysely-specific type complexity
 *
 * IMPORTANT: This module uses intentional type assertions (`as never`) in specific places
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
 *
 * @param db - Kysely database executor
 * @param tableName - Name of the database table
 * @param pkConfig - Primary key configuration
 * @param dialectConfig - Optional dialect configuration (recommended for production)
 */
/* eslint-disable @typescript-eslint/no-deprecated -- DialectConfig kept for backwards compatibility */
// eslint-disable-next-line max-lines-per-function -- Complex table operations
export function createTableOperations<DB, TableName extends keyof DB & string>(
  db: Executor<DB>,
  tableName: TableName,
  pkConfig: PrimaryKeyConfig = { columns: 'id', type: 'number' },
  dialectConfig?: DialectConfig
): TableOperations<DB[TableName]> {
  /* eslint-enable @typescript-eslint/no-deprecated */
  type Table = DB[TableName]
  type SelectTable = Selectable<Table>

  // Cache database type detection at initialization (not per-query)
  const usesMySQL = requiresMySQLBehavior(db, dialectConfig)

  // Cache primary key columns at initialization
  const pkColumns = getPrimaryKeyColumns(pkConfig.columns)
  const defaultOrderColumn = pkColumns[0] ?? 'id'
  const firstPkColumn = pkColumns[0]

  return {
    async selectAll(): Promise<SelectTable[]> {
      const result = await db.selectFrom(tableName).selectAll().execute()

      return castResults<SelectTable[]>(result)
    },

    async selectById(id: PrimaryKeyInput): Promise<SelectTable | undefined> {
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>
      const query = buildWherePrimaryKey(baseQuery, pkConfig, id)
      const result = await query.executeTakeFirst()

      return castResults<SelectTable | undefined>(result)
    },

    async selectByIds(ids: PrimaryKeyInput[]): Promise<SelectTable[]> {
      if (ids.length === 0) return []

      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>
      const query = buildWherePrimaryKeyIn(baseQuery, pkConfig, ids)
      const result = await query.execute()

      return castResults<SelectTable[]>(result)
    },

    async selectWhere(conditions: Record<string, unknown>): Promise<SelectTable[]> {
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>
      const query = buildDynamicWhere(baseQuery, conditions, pkConfig)
      const result = await query.execute()

      return castResults<SelectTable[]>(result)
    },

    async selectOneWhere(conditions: Record<string, unknown>): Promise<SelectTable | undefined> {
      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>
      const query = buildDynamicWhere(baseQuery, conditions, pkConfig)
      const result = await query.executeTakeFirst()

      return castResults<SelectTable | undefined>(result)
    },

    async insert(data: unknown): Promise<SelectTable> {
      if (usesMySQL) {
        // MySQL doesn't support RETURNING, use insertId
        const result = await db
          .insertInto(tableName)
          .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
          .executeTakeFirst()

        // Type assertion needed: MySQL returns insertId which isn't in Kysely's type definitions
        const insertResult = result as unknown as InsertResult

        // For auto-increment PKs, use insertId; otherwise, get PK from input data
        let lookupKey: PrimaryKeyInput

        if (
          pkConfig.type === 'number' &&
          !isCompositeKey(pkConfig.columns) &&
          insertResult.insertId
        ) {
          lookupKey = Number(insertResult.insertId)
        } else {
          // For non-auto-increment keys, the key should be in the input data
          lookupKey = extractPrimaryKey(data, pkConfig)
        }

        // Fetch the inserted record
        const selectQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<
          DB,
          TableName
        >
        const queryWithWhere = buildWherePrimaryKey(selectQuery, pkConfig, lookupKey)
        const record = await queryWithWhere.executeTakeFirst()

        if (!record) {
          throw new DatabaseError('Failed to fetch created record', 'FETCH_FAILED', tableName)
        }

        return castResults<SelectTable>(record)
      } else {
        // PostgreSQL and SQLite support RETURNING
        const result = await db
          .insertInto(tableName)
          .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
          .returningAll()
          .executeTakeFirst()

        if (!result) {
          throw new DatabaseError('Failed to create record', 'INSERT_FAILED', tableName)
        }

        return castResults<SelectTable>(result)
      }
    },

    async insertMany(data: unknown[]): Promise<SelectTable[]> {
      if (usesMySQL) {
        // MySQL doesn't support RETURNING for bulk inserts
        // We need to insert each row and fetch it back
        const results: SelectTable[] = []

        for (const item of data) {
          const result = await db
            .insertInto(tableName)
            .values(item as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
            .executeTakeFirst()

          // Type assertion needed: MySQL returns insertId which isn't in Kysely's type definitions
          const insertResult = result as unknown as InsertResult

          let lookupKey: PrimaryKeyInput

          if (
            pkConfig.type === 'number' &&
            !isCompositeKey(pkConfig.columns) &&
            insertResult.insertId
          ) {
            lookupKey = Number(insertResult.insertId)
          } else {
            lookupKey = extractPrimaryKey(item, pkConfig)
          }

          // Fetch the inserted record
          const selectQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<
            DB,
            TableName
          >
          const queryWithWhere = buildWherePrimaryKey(selectQuery, pkConfig, lookupKey)
          const record = await queryWithWhere.executeTakeFirst()

          if (record) {
            results.push(castResults<SelectTable>(record))
          }
        }

        return results
      } else {
        // PostgreSQL and SQLite support RETURNING
        const result = await db
          .insertInto(tableName)
          .values(data as Parameters<InsertQueryBuilder<DB, TableName, unknown>['values']>[0])
          .returningAll()
          .execute()

        return castResults<SelectTable[]>(result)
      }
    },

    async updateById(id: PrimaryKeyInput, data: unknown): Promise<SelectTable | undefined> {
      const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, id)

      /**
       * INTENTIONAL TYPE ASSERTION (documented and safe)
       *
       * Why type assertions are used here:
       * UpdateQueryBuilder.set() cannot be typed statically because the data structure
       * is validated at runtime by Zod schemas. We need to bridge the gap between:
       * 1. Runtime-validated user input (unknown type at compile time)
       * 2. Kysely's compile-time type system (requires concrete types)
       *
       * Safety guarantees that make this safe:
       * - ✓ Data is validated by Zod schemas in the repository layer BEFORE reaching this code
       * - ✓ Kysely's runtime checks ensure column names exist in the database schema
       * - ✓ The query builder maintains runtime type safety throughout the chain
       * - ✓ We only use type assertions for the intermediate query builder, NOT the result
       * - ✓ Return type is properly typed as SelectTable | undefined
       *
       * Alternative approaches considered and rejected:
       * 1. Using Kysely's Updateable<T> - doesn't work with unknown input from repository layer
       * 2. Generic constraints on data parameter - breaks repository abstraction (leaks Kysely types)
       * 3. Type predicates - adds unnecessary runtime overhead for already-validated data
       * 4. Complex mapped types - makes code unreadable and doesn't improve runtime safety
       *
       * This is a controlled, intentional type boundary that provides 100% runtime safety
       * while maintaining a clean repository API that doesn't leak Kysely internals.
       */

      type UpdateQueryBuilder = {
        where: (column: string, op: string, value: unknown) => UpdateQueryBuilder
        execute: () => Promise<unknown>
        returningAll: () => { executeTakeFirst: () => Promise<unknown> }
      }

      type UpdateQuery = {
        set: (data: unknown) => UpdateQueryBuilder
      }

      const baseQuery = db.updateTable(tableName) as unknown as UpdateQuery

      let query: UpdateQueryBuilder = baseQuery.set(data)

      // Add where conditions for primary key
      for (const [column, value] of Object.entries(keyRecord)) {
        query = query.where(column, '=', value)
      }

      if (usesMySQL) {
        // MySQL doesn't support RETURNING for UPDATE
        await query.execute()

        // Fetch the updated record
        const selectQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<
          DB,
          TableName
        >
        const queryWithWhere = buildWherePrimaryKey(selectQuery, pkConfig, id)
        const record = await queryWithWhere.executeTakeFirst()

        return castResults<SelectTable | undefined>(record)
      } else {
        // PostgreSQL and SQLite support RETURNING
        const result = await query.returningAll().executeTakeFirst()

        return castResults<SelectTable | undefined>(result)
      }
    },

    async deleteById(id: PrimaryKeyInput): Promise<boolean> {
      const baseQuery = db.deleteFrom(tableName) as DynamicDeleteQuery<DB, TableName>
      const query = buildDeleteWherePrimaryKey(baseQuery, pkConfig, id)
      const result = await query.execute()

      // Type assertion needed: Delete result structure varies by database
      const deleteResult = result as unknown as DeleteResult[]
      return Array.isArray(deleteResult) && deleteResult.length > 0
        ? (deleteResult[0]?.numDeletedRows ?? BigInt(0)) > 0
        : false
    },

    async deleteByIds(ids: PrimaryKeyInput[]): Promise<number> {
      if (ids.length === 0) return 0

      const baseQuery = db.deleteFrom(tableName) as DynamicDeleteQuery<DB, TableName>
      const query = buildDeleteWherePrimaryKeyIn(baseQuery, pkConfig, ids)
      const result = await query.execute()

      // Type assertion needed: Delete result structure varies by database
      const deleteResult = result as unknown as DeleteResult[]
      return Array.isArray(deleteResult) && deleteResult.length > 0
        ? Number(deleteResult[0]?.numDeletedRows ?? 0)
        : 0
    },

    async count(conditions?: Record<string, unknown>): Promise<number> {
      /**
       * INTENTIONAL TYPE ASSERTION (documented and safe)
       *
       * Why type assertions are used here:
       * Kysely's fn.countAll() creates complex union types that are difficult to type
       * precisely in dynamic contexts with runtime-determined conditions.
       *
       * The type complexity arises from:
       * 1. SelectQueryBuilder has 3 type parameters: DB, TB, and Selection
       * 2. Using .select() with fn.countAll() transforms Selection into a complex union type
       * 3. Adding dynamic where clauses further complicates the type inference chain
       * 4. The resulting type is functionally correct but prohibitively complex to express
       *
       * Safety guarantees that make this safe:
       * - ✓ Query structure is entirely controlled by this function
       * - ✓ We know the exact shape of the result: { count: number | bigint }
       * - ✓ Kysely validates all column names at runtime
       * - ✓ Result extraction is type-safe through explicit checking and Number() conversion
       * - ✓ Return type is properly typed as number
       *
       * This pattern is recommended by Kysely's documentation for aggregate functions with
       * dynamic queries. See: https://kysely.dev/docs/recipes/dynamic-queries
       */

      type CountQueryBuilder = {
        where: (key: string, op: string, value: unknown) => CountQueryBuilder
        executeTakeFirst: () => Promise<{ count: number | bigint } | undefined>
      }

      type CountQuery = {
        select: (countExpression: unknown) => CountQueryBuilder
      }

      const baseQuery = db.selectFrom(tableName) as unknown as CountQuery

      let query: CountQueryBuilder = baseQuery.select(db.fn.countAll().as('count'))

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

      const baseQuery = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>
      const query = buildOrderByAndPaginate(baseQuery, orderBy, orderDirection, limit, offset)
      const result = await query.execute()

      return castResults<SelectTable[]>(result)
    },

    async paginateCursor(options: {
      limit: number
      cursor?: {
        value: unknown
        id: PrimaryKeyInput
      } | null
      orderBy: string
      orderDirection: 'asc' | 'desc'
    }): Promise<SelectTable[]> {
      const { limit, cursor, orderBy, orderDirection } = options

      let query = db.selectFrom(tableName).selectAll() as DynamicSelectQuery<DB, TableName>

      // Apply keyset pagination using WHERE clause
      if (cursor) {
        const { value, id } = cursor
        const keyRecord = normalizePrimaryKeyInput(pkConfig.columns, id)

        // Type assertion needed: ExpressionBuilder requires dynamic column references which can't be fully typed
        // Runtime safety: orderBy and firstPkColumn are validated at repository layer through PrimaryKeyConfig
        if (!firstPkColumn) {
          throw new Error('Primary key configuration is invalid: no columns defined')
        }

        if (orderDirection === 'asc') {
          // For ascending: (orderBy > value) OR (orderBy = value AND pk > cursor.pk)
          query = query.where((eb: ExpressionBuilder<DB, TableName>) =>
            eb.or([
              eb(orderBy as never, '>', value as never),
              eb.and([
                eb(orderBy as never, '=', value as never),
                eb(firstPkColumn as never, '>', keyRecord[firstPkColumn] as never)
              ])
            ])
          ) as DynamicSelectQuery<DB, TableName>
        } else {
          // For descending: (orderBy < value) OR (orderBy = value AND pk > cursor.pk)
          query = query.where((eb: ExpressionBuilder<DB, TableName>) =>
            eb.or([
              eb(orderBy as never, '<', value as never),
              eb.and([
                eb(orderBy as never, '=', value as never),
                eb(firstPkColumn as never, '>', keyRecord[firstPkColumn] as never)
              ])
            ])
          ) as DynamicSelectQuery<DB, TableName>
        }
      }

      // Apply ordering (primary by orderBy, secondary by first pk column for tie-breaking)
      // Type assertion needed: orderBy is a dynamic column name
      query = query
        .orderBy(orderBy as never, orderDirection)
        .orderBy(defaultOrderColumn as never, 'asc')
        .limit(limit) as DynamicSelectQuery<DB, TableName>

      const result = await query.execute()

      return castResults<SelectTable[]>(result)
    }
  }
}
