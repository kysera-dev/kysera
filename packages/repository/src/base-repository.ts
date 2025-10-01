import type { Kysely, Selectable, Transaction } from 'kysely'
import type { z } from 'zod'

/**
 * Core repository interface
 * Designed to work with any entity type and database schema
 */
export interface BaseRepository<DB, Entity> {
  findById(id: number): Promise<Entity | null>
  findAll(): Promise<Entity[]>
  create(input: unknown): Promise<Entity>
  update(id: number, input: unknown): Promise<Entity>
  delete(id: number): Promise<boolean>
  findByIds(ids: number[]): Promise<Entity[]>
  bulkCreate(inputs: unknown[]): Promise<Entity[]>
  bulkUpdate(updates: { id: number, data: unknown }[]): Promise<Entity[]>
  bulkDelete(ids: number[]): Promise<number>
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
  }): Promise<{ items: Entity[], total: number, limit: number, offset: number }>
  paginateCursor(options: {
    limit: number
    cursor?: unknown
    orderBy?: string
  }): Promise<{ items: Entity[], nextCursor: unknown }>
}

/**
 * Configuration for creating a repository
 */
export interface RepositoryConfig<Table, Entity> {
  tableName: string
  mapRow: (row: Selectable<Table>) => Entity
  schemas: {
    entity?: z.ZodType<Entity>
    create: z.ZodType
    update?: z.ZodType
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
  selectById(id: number): Promise<Selectable<Table> | undefined>
  selectByIds(ids: number[]): Promise<Selectable<Table>[]>
  selectWhere(conditions: Record<string, unknown>): Promise<Selectable<Table>[]>
  selectOneWhere(conditions: Record<string, unknown>): Promise<Selectable<Table> | undefined>
  insert(data: unknown): Promise<Selectable<Table>>
  insertMany(data: unknown[]): Promise<Selectable<Table>[]>
  updateById(id: number, data: unknown): Promise<Selectable<Table> | undefined>
  deleteById(id: number): Promise<boolean>
  deleteByIds(ids: number[]): Promise<number>
  count(conditions?: Record<string, unknown>): Promise<number>
  paginate(options: {
    limit: number
    offset: number
    orderBy: string
    orderDirection: 'asc' | 'desc'
  }): Promise<Selectable<Table>[]>
}

/**
 * Create a base repository implementation
 * This function creates a repository with full CRUD operations
 */
export function createBaseRepository<DB, Table, Entity>(
  operations: TableOperations<Table>,
  config: RepositoryConfig<Table, Entity>,
  db: Kysely<DB>
): BaseRepository<DB, Entity> {
  const {
    mapRow,
    schemas,
    validateDbResults = (typeof process !== 'undefined' && process.env && process.env['NODE_ENV'] === 'development') || false,
    validationStrategy = 'strict'
  } = config

  // Helper to validate and map rows
  const processRow = (row: Selectable<Table>): Entity => {
    const entity = mapRow(row)
    return validateDbResults && schemas.entity
      ? schemas.entity.parse(entity)
      : entity
  }

  // Helper to validate and map multiple rows
  const processRows = (rows: Selectable<Table>[]): Entity[] => {
    const entities = rows.map(mapRow)
    return validateDbResults && schemas.entity
      ? entities.map(e => schemas.entity!.parse(e))
      : entities
  }

  // Helper to validate input
  const validateInput = (input: unknown, schema: z.ZodType): unknown => {
    return validationStrategy === 'none' ? input : schema.parse(input)
  }

  // Get the appropriate update schema
  const getUpdateSchema = (): z.ZodType => {
    if (schemas.update) return schemas.update

    // Try to create a partial schema from create schema if it's a ZodObject
    const createSchema = schemas.create
    if ('partial' in createSchema && typeof createSchema.partial === 'function') {
      return createSchema.partial()
    }

    return schemas.create
  }

  return {
    async findById(id: number): Promise<Entity | null> {
      const row = await operations.selectById(id)
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

    async update(id: number, input: unknown): Promise<Entity> {
      const updateSchema = getUpdateSchema()
      const validatedInput = validateInput(input, updateSchema)
      const row = await operations.updateById(id, validatedInput)

      if (!row) {
        throw new Error(`Record with id ${id} not found`)
      }

      return processRow(row)
    },

    async delete(id: number): Promise<boolean> {
      return operations.deleteById(id)
    },

    async findByIds(ids: number[]): Promise<Entity[]> {
      if (ids.length === 0) return []
      const rows = await operations.selectByIds(ids)
      return processRows(rows)
    },

    async bulkCreate(inputs: unknown[]): Promise<Entity[]> {
      if (inputs.length === 0) return []
      const validatedInputs = inputs.map(input => validateInput(input, schemas.create))
      const rows = await operations.insertMany(validatedInputs)
      return processRows(rows)
    },

    async bulkUpdate(updates: { id: number, data: unknown }[]): Promise<Entity[]> {
      if (updates.length === 0) return []

      const updateSchema = getUpdateSchema()

      // Execute updates in parallel for better performance
      // Note: If transaction atomicity is required, wrap the bulkUpdate call
      // in a transaction at the application level
      const promises = updates.map(async ({ id, data }) => {
        const validatedInput = validateInput(data, updateSchema)
        const row = await operations.updateById(id, validatedInput)

        if (!row) {
          throw new Error(`Failed to update record with id ${id}: Record not found`)
        }

        return processRow(row)
      })

      return Promise.all(promises)
    },

    async bulkDelete(ids: number[]): Promise<number> {
      if (ids.length === 0) return 0
      return operations.deleteByIds(ids)
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
      return db.transaction().execute(fn)
    },

    async paginate(options: {
      limit: number
      offset?: number
      orderBy?: string
      orderDirection?: 'asc' | 'desc'
    }): Promise<{ items: Entity[], total: number, limit: number, offset: number }> {
      const { limit, offset = 0, orderBy = 'id', orderDirection = 'asc' } = options

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

    async paginateCursor(options: {
      limit: number
      cursor?: unknown
      orderBy?: string
    }): Promise<{ items: Entity[], nextCursor: unknown }> {
      const { limit, cursor, orderBy = 'id' } = options

      // This is simplified - real implementation would need cursor-based pagination support
      const offset = cursor ? Number(cursor) : 0
      const rows = await operations.paginate({
        limit: limit + 1,
        offset,
        orderBy,
        orderDirection: 'asc'
      })

      const hasMore = rows.length > limit
      const items = processRows(hasMore ? rows.slice(0, limit) : rows)

      const nextCursor = hasMore ? offset + limit : null

      return {
        items,
        nextCursor
      }
    }
  }
}