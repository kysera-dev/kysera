import type { Selectable } from 'kysely'
import type { z } from 'zod'
import type { Executor } from '@kysera/core'

export interface RepositoryOptions {
  validateDbResults?: boolean
}

export interface BaseRepository<T> {
  // Exposed for plugin extensions
  readonly executor: any
  readonly tableName: string
  // Methods
  findById(id: number): Promise<T | null>
  findAll(): Promise<T[]>
  create(input: unknown): Promise<T>
  update(id: number, input: unknown): Promise<T>
  delete(id: number): Promise<void>
  // Batch operations
  findByIds(ids: number[]): Promise<T[]>
  bulkCreate(inputs: unknown[]): Promise<T[]>
  bulkUpdate(updates: Array<{ id: number, data: unknown }>): Promise<T[]>
  bulkDelete(ids: number[]): Promise<void>
}

/**
 * Create a repository factory
 */
export function createRepositoryFactory<DB>(executor: Executor<DB>) {
  return {
    executor,

    /**
     * Create a repository with base CRUD operations
     */
    create<
      TableName extends keyof DB & string,
      Table extends DB[TableName],
      Entity
    >(config: {
      tableName: TableName
      mapRow: (row: Selectable<Table>) => Entity
      schemas: {
        entity?: z.ZodSchema<Entity>
        create: z.ZodSchema<any>
        update?: z.ZodSchema<any>
      }
      validateDbResults?: boolean
    }): BaseRepository<Entity> {
      const {
        tableName,
        mapRow,
        schemas,
        validateDbResults = (typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'development') || false
      } = config

      // Cast executor to any to avoid complex type overload issues
      const db = executor as any

      return {
        // Expose executor and tableName for plugin extensions
        executor: db,
        tableName,

        async findById(id: number): Promise<Entity | null> {
          const row = await db
            .selectFrom(tableName)
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst()

          if (!row) return null

          const entity = mapRow(row as unknown as Selectable<Table>)

          return validateDbResults && schemas.entity
            ? schemas.entity.parse(entity)
            : entity
        },

        async findAll(): Promise<Entity[]> {
          const rows = await db
            .selectFrom(tableName)
            .selectAll()
            .execute()

          const entities = rows.map((row: any) => mapRow(row as unknown as Selectable<Table>))

          return validateDbResults && schemas.entity
            ? entities.map((e: Entity) => schemas.entity!.parse(e))
            : entities
        },

        async create(input: unknown): Promise<Entity> {
          // Always validate input
          const validated = schemas.create.parse(input)

          const row = await db
            .insertInto(tableName)
            .values(validated)
            .returningAll()
            .executeTakeFirstOrThrow()

          const entity = mapRow(row as unknown as Selectable<Table>)

          return validateDbResults && schemas.entity
            ? schemas.entity.parse(entity)
            : entity
        },

        async update(id: number, input: unknown): Promise<Entity> {
          // Validate input if schema provided
          const validated = schemas.update
            ? schemas.update.parse(input)
            : input

          const row = await db
            .updateTable(tableName)
            .set(validated)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirstOrThrow()

          const entity = mapRow(row as unknown as Selectable<Table>)

          return validateDbResults && schemas.entity
            ? schemas.entity.parse(entity)
            : entity
        },

        async delete(id: number): Promise<void> {
          await db
            .deleteFrom(tableName)
            .where('id', '=', id)
            .execute()
        },

        async findByIds(ids: number[]): Promise<Entity[]> {
          if (ids.length === 0) return []

          const rows = await db
            .selectFrom(tableName)
            .selectAll()
            .where('id', 'in', ids)
            .execute()

          const entities = rows.map((row: any) => mapRow(row as unknown as Selectable<Table>))

          return validateDbResults && schemas.entity
            ? entities.map((e: Entity) => schemas.entity!.parse(e))
            : entities
        },

        async bulkCreate(inputs: unknown[]): Promise<Entity[]> {
          if (inputs.length === 0) return []

          // Validate all inputs
          const validated = inputs.map(input => schemas.create.parse(input))

          const rows = await db
            .insertInto(tableName)
            .values(validated)
            .returningAll()
            .execute()

          const entities = rows.map((row: any) => mapRow(row as unknown as Selectable<Table>))

          return validateDbResults && schemas.entity
            ? entities.map((e: Entity) => schemas.entity!.parse(e))
            : entities
        },

        async bulkUpdate(updates: Array<{ id: number, data: unknown }>): Promise<Entity[]> {
          if (updates.length === 0) return []

          const results: Entity[] = []

          // Process updates in a transaction for consistency
          await db.transaction().execute(async (trx: any) => {
            for (const update of updates) {
              const validated = schemas.update
                ? schemas.update.parse(update.data)
                : update.data

              const row = await trx
                .updateTable(tableName)
                .set(validated)
                .where('id', '=', update.id)
                .returningAll()
                .executeTakeFirstOrThrow()

              const entity = mapRow(row as unknown as Selectable<Table>)
              results.push(
                validateDbResults && schemas.entity
                  ? schemas.entity.parse(entity)
                  : entity
              )
            }
          })

          return results
        },

        async bulkDelete(ids: number[]): Promise<void> {
          if (ids.length === 0) return

          await db
            .deleteFrom(tableName)
            .where('id', 'in', ids)
            .execute()
        }
      }
    }
  }
}

/**
 * Repository factory for all repositories
 */
export function createRepositories<DB, Repos>(
  executor: Executor<DB>,
  factory: (executor: Executor<DB>) => Repos
): Repos {
  return factory(executor)
}