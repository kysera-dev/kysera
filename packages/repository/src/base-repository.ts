/* eslint-disable @typescript-eslint/no-deprecated -- DialectConfig kept for backwards compatibility */
import type { Selectable, Transaction } from 'kysely'
import type { Executor } from './helpers.js'
import type {
  PrimaryKeyColumn,
  PrimaryKeyTypeHint,
  PrimaryKeyInput,
  PrimaryKeyConfig,
  DialectConfig
} from './types.js'
import { normalizePrimaryKeyConfig, getPrimaryKeyColumns } from './types.js'
import { NotFoundError, getEnv } from '@kysera/core'
import type { ValidationSchema } from './validation-adapter.js'
import { extractPrimaryKey } from './primary-key-utils.js'
import { withTransaction } from '@kysera/dal'

/**
 * Core repository interface
 * Designed to work with any entity type and database schema
 * Supports custom primary keys (single, composite, UUID)
 */
export interface BaseRepository<DB, Entity, PK = number> {
  findById(id: PK): Promise<Entity | null>
  findAll(): Promise<Entity[]>
  create(input: unknown): Promise<Entity>
  update(id: PK, input: unknown): Promise<Entity>
  delete(id: PK): Promise<boolean>
  findByIds(ids: PK[]): Promise<Entity[]>
  bulkCreate(inputs: unknown[]): Promise<Entity[]>
  bulkUpdate(updates: { id: PK; data: unknown }[]): Promise<Entity[]>
  bulkDelete(ids: PK[]): Promise<number>
  find(options?: { where?: Record<string, unknown> }): Promise<Entity[]>
  findOne(options?: { where?: Record<string, unknown> }): Promise<Entity | null>
  count(options?: { where?: Record<string, unknown> }): Promise<number>
  exists(options?: { where?: Record<string, unknown> }): Promise<boolean>
  transaction<R>(fn: (trx: Transaction<DB>) => Promise<R>): Promise<R>
  paginate(options: {
    limit: number
    offset?: number
    orderBy?: string
    orderDirection?: 'asc' | 'desc'
  }): Promise<{ items: Entity[]; total: number; limit: number; offset: number }>
  paginateCursor<K extends keyof Entity>(options: {
    limit: number
    cursor?: {
      value: Entity[K]
      id: PK
    } | null
    orderBy?: K
    orderDirection?: 'asc' | 'desc'
  }): Promise<{
    items: Entity[]
    nextCursor: { value: Entity[K]; id: PK } | null
    hasMore: boolean
  }>
}

/**
 * Configuration for creating a repository
 */
export interface RepositoryConfig<Table, Entity> {
  tableName: string
  /**
   * PostgreSQL schema for this repository.
   * When set, all queries are scoped to this schema.
   *
   * @example
   * ```typescript
   * schema: 'auth'  // queries use auth.users
   * schema: 'tenant_123'  // multi-tenant pattern
   * ```
   */
  schema?: string
  /** Primary key column name(s). Default: 'id' */
  primaryKey?: PrimaryKeyColumn
  /** Primary key type hint. Default: 'number' */
  primaryKeyType?: PrimaryKeyTypeHint
  /**
   * Database dialect configuration.
   * Recommended for production to avoid relying on Kysely internals.
   *
   * @example
   * ```typescript
   * dialect: { dialect: 'postgres' }
   * dialect: { dialect: 'mysql' }
   * dialect: { dialect: 'sqlite' }
   * ```
   */
  dialect?: DialectConfig
  mapRow: (row: Selectable<Table>) => Entity
  /**
   * Validation schemas for entity, create, and update operations.
   * Supports any ValidationSchema-compatible validator (Zod, Valibot, TypeBox, etc.)
   *
   * @example With Zod adapter
   * ```typescript
   * import { z } from 'zod';
   * import { zodAdapter } from '@kysera/repository';
   *
   * schemas: {
   *   entity: zodAdapter(UserSchema),
   *   create: zodAdapter(CreateUserSchema),
   *   update: zodAdapter(UpdateUserSchema),
   * }
   * ```
   *
   * @example With native adapter (no validation)
   * ```typescript
   * import { nativeAdapter } from '@kysera/repository';
   *
   * schemas: {
   *   create: nativeAdapter<CreateUserInput>(),
   * }
   * ```
   */
  schemas: {
    entity?: ValidationSchema<Entity>
    create: ValidationSchema
    update?: ValidationSchema
  }
  validateDbResults?: boolean
  validationStrategy?: 'none' | 'strict'
}

/**
 * Type-safe table operations interface
 * These methods must be provided by the specific table implementation
 */
export interface TableOperations<Table> {
  selectAll(): Promise<Selectable<Table>[]>
  selectById(id: PrimaryKeyInput): Promise<Selectable<Table> | undefined>
  selectByIds(ids: PrimaryKeyInput[]): Promise<Selectable<Table>[]>
  selectWhere(conditions: Record<string, unknown>): Promise<Selectable<Table>[]>
  selectOneWhere(conditions: Record<string, unknown>): Promise<Selectable<Table> | undefined>
  insert(data: unknown): Promise<Selectable<Table>>
  insertMany(data: unknown[]): Promise<Selectable<Table>[]>
  updateById(id: PrimaryKeyInput, data: unknown): Promise<Selectable<Table> | undefined>
  deleteById(id: PrimaryKeyInput): Promise<boolean>
  deleteByIds(ids: PrimaryKeyInput[]): Promise<number>
  count(conditions?: Record<string, unknown>): Promise<number>
  paginate(options: {
    limit: number
    offset: number
    orderBy: string
    orderDirection: 'asc' | 'desc'
  }): Promise<Selectable<Table>[]>
  paginateCursor(options: {
    limit: number
    cursor?: {
      value: unknown
      id: PrimaryKeyInput
    } | null
    orderBy: string
    orderDirection: 'asc' | 'desc'
  }): Promise<Selectable<Table>[]>
}

/**
 * Extract primary key value from an entity based on config
 * @deprecated Use extractPrimaryKey from primary-key-utils.ts instead
 * @internal Kept for backward compatibility, wraps the shared utility
 */
function extractPrimaryKeyFromEntity<Entity, PK>(entity: Entity, pkConfig: PrimaryKeyConfig): PK {
  return extractPrimaryKey(entity, pkConfig) as PK
}

/**
 * Create a base repository implementation
 * This function creates a repository with full CRUD operations
 */
export function createBaseRepository<DB, Table, Entity, PK = number>(
  operations: TableOperations<Table>,
  config: RepositoryConfig<Table, Entity>,
  db: Executor<DB>
): BaseRepository<DB, Entity, PK> {
  const {
    mapRow,
    schemas,
    primaryKey,
    primaryKeyType,
    validateDbResults = getEnv('NODE_ENV') === 'development',
    validationStrategy = 'strict'
  } = config

  const pkConfig = normalizePrimaryKeyConfig(primaryKey, primaryKeyType)
  const defaultOrderColumn = getPrimaryKeyColumns(pkConfig.columns)[0] ?? 'id'

  // Helper to validate and map rows
  const processRow = (row: Selectable<Table>): Entity => {
    const entity = mapRow(row)
    return validateDbResults && schemas.entity ? schemas.entity.parse(entity) : entity
  }

  // Helper to validate and map multiple rows
  const processRows = (rows: Selectable<Table>[]): Entity[] => {
    const entities = rows.map(mapRow)
    return validateDbResults && schemas.entity
      ? entities.map(e => schemas.entity!.parse(e))
      : entities
  }

  // Helper to validate input
  const validateInput = (input: unknown, schema: ValidationSchema): unknown => {
    return validationStrategy === 'none' ? input : schema.parse(input)
  }

  // Get the appropriate update schema
  const getUpdateSchema = (): ValidationSchema => {
    if (schemas.update) return schemas.update

    // Try to create a partial schema from create schema if it supports it
    const createSchema = schemas.create
    if (createSchema.partial) {
      return createSchema.partial()
    }

    return schemas.create
  }

  // Convert PK type to PrimaryKeyInput for table operations
  const toPrimaryKeyInput = (pk: PK): PrimaryKeyInput => {
    return pk as unknown as PrimaryKeyInput
  }

  return {
    async findById(id: PK): Promise<Entity | null> {
      const row = await operations.selectById(toPrimaryKeyInput(id))
      return row ? processRow(row) : null
    },

    async findAll(): Promise<Entity[]> {
      const rows = await operations.selectAll()
      return processRows(rows)
    },

    async create(input: unknown): Promise<Entity> {
      const validatedInput = validateInput(input, schemas.create)
      const row = await operations.insert(validatedInput)
      return processRow(row)
    },

    async update(id: PK, input: unknown): Promise<Entity> {
      const updateSchema = getUpdateSchema()
      const validatedInput = validateInput(input, updateSchema)
      const row = await operations.updateById(toPrimaryKeyInput(id), validatedInput)

      if (!row) {
        throw new NotFoundError('Record', { id })
      }

      return processRow(row)
    },

    async delete(id: PK): Promise<boolean> {
      return operations.deleteById(toPrimaryKeyInput(id))
    },

    async findByIds(ids: PK[]): Promise<Entity[]> {
      if (ids.length === 0) return []
      const rows = await operations.selectByIds(ids.map(toPrimaryKeyInput))
      return processRows(rows)
    },

    async bulkCreate(inputs: unknown[]): Promise<Entity[]> {
      if (inputs.length === 0) return []
      const validatedInputs = inputs.map(input => validateInput(input, schemas.create))
      const rows = await operations.insertMany(validatedInputs)
      return processRows(rows)
    },

    async bulkUpdate(updates: { id: PK; data: unknown }[]): Promise<Entity[]> {
      if (updates.length === 0) return []

      const updateSchema = getUpdateSchema()

      // Execute updates in parallel for better performance
      // Note: If transaction atomicity is required, wrap the bulkUpdate call
      // in a transaction at the application level
      const promises = updates.map(async ({ id, data }) => {
        const validatedInput = validateInput(data, updateSchema)
        const row = await operations.updateById(toPrimaryKeyInput(id), validatedInput)

        if (!row) {
          throw new NotFoundError('Record', { id })
        }

        return processRow(row)
      })

      return Promise.all(promises)
    },

    async bulkDelete(ids: PK[]): Promise<number> {
      if (ids.length === 0) return 0
      return operations.deleteByIds(ids.map(toPrimaryKeyInput))
    },

    async find(options?: { where?: Record<string, unknown> }): Promise<Entity[]> {
      const rows = options?.where
        ? await operations.selectWhere(options.where)
        : await operations.selectAll()
      return processRows(rows)
    },

    async findOne(options?: { where?: Record<string, unknown> }): Promise<Entity | null> {
      if (!options?.where) {
        const rows = await operations.selectAll()
        return rows[0] ? processRow(rows[0]) : null
      }

      const row = await operations.selectOneWhere(options.where)
      return row ? processRow(row) : null
    },

    async count(options?: { where?: Record<string, unknown> }): Promise<number> {
      return operations.count(options?.where)
    },

    async exists(options?: { where?: Record<string, unknown> }): Promise<boolean> {
      const count = await operations.count(options?.where)
      return count > 0
    },

    async transaction<R>(fn: (trx: Transaction<DB>) => Promise<R>): Promise<R> {
      // Delegate to DAL's withTransaction for:
      // 1. Savepoint support (nested transactions)
      // 2. Plugin propagation (soft-delete, RLS, etc.)
      // 3. Transaction markers for proper nesting detection
      return withTransaction(db, async ctx => {
        // Extract the raw transaction from the context
        return fn(ctx.db as Transaction<DB>)
      })
    },

    async paginate(options: {
      limit: number
      offset?: number
      orderBy?: string
      orderDirection?: 'asc' | 'desc'
    }): Promise<{ items: Entity[]; total: number; limit: number; offset: number }> {
      const { limit, offset = 0, orderBy = defaultOrderColumn, orderDirection = 'asc' } = options

      const total = await operations.count()
      const rows = await operations.paginate({
        limit,
        offset,
        orderBy,
        orderDirection
      })

      const items = processRows(rows)

      return {
        items,
        total,
        limit,
        offset
      }
    },

    async paginateCursor<K extends keyof Entity>(options: {
      limit: number
      cursor?: {
        value: Entity[K]
        id: PK
      } | null
      orderBy?: K
      orderDirection?: 'asc' | 'desc'
    }): Promise<{
      items: Entity[]
      nextCursor: { value: Entity[K]; id: PK } | null
      hasMore: boolean
    }> {
      const { limit, cursor, orderBy = defaultOrderColumn as K, orderDirection = 'asc' } = options

      // Fetch limit + 1 to determine if there are more results
      const rows = await operations.paginateCursor({
        limit: limit + 1,
        cursor: cursor
          ? {
              value: cursor.value,
              id: toPrimaryKeyInput(cursor.id)
            }
          : null,
        orderBy: String(orderBy),
        orderDirection
      })

      const hasMore = rows.length > limit
      const items = processRows(hasMore ? rows.slice(0, limit) : rows)

      // Generate nextCursor from the last item
      let nextCursor: { value: Entity[K]; id: PK } | null = null
      if (hasMore && items.length > 0) {
        const lastItem = items[items.length - 1]
        if (lastItem) {
          nextCursor = {
            value: lastItem[orderBy],
            id: extractPrimaryKeyFromEntity<Entity, PK>(lastItem, pkConfig)
          }
        }
      }

      return {
        items,
        nextCursor,
        hasMore
      }
    }
  }
}
