import type { Kysely, Selectable, Transaction } from 'kysely'
import type { z } from 'zod'
import { createBaseRepository, type BaseRepository, type RepositoryConfig } from './base-repository'
import { createTableOperations } from './table-operations'

/**
 * Extended repository interface that includes database and table information
 * for plugin compatibility
 */
export interface Repository<Entity, DB> extends BaseRepository<DB, Entity> {
  readonly executor: Kysely<DB>
  readonly tableName: string
  withTransaction(trx: Transaction<DB>): Repository<Entity, DB>
}

/**
 * Create a repository factory with proper type safety
 */
export function createRepositoryFactory<DB>(executor: Kysely<DB>): {
  executor: Kysely<DB>
  create<
    TableName extends keyof DB & string,
    Entity
  >(config: {
    tableName: TableName
    mapRow: (row: Selectable<DB[TableName]>) => Entity
    schemas: {
      entity?: z.ZodType<Entity>
      create: z.ZodType
      update?: z.ZodType
    }
    validateDbResults?: boolean
    validationStrategy?: 'none' | 'strict'
  }): Repository<Entity, DB>
} {
  return {
    executor,

    create<
      TableName extends keyof DB & string,
      Entity
    >(config: {
      tableName: TableName
      mapRow: (row: Selectable<DB[TableName]>) => Entity
      schemas: {
        entity?: z.ZodType<Entity>
        create: z.ZodType
        update?: z.ZodType
      }
      validateDbResults?: boolean
      validationStrategy?: 'none' | 'strict'
    }): Repository<Entity, DB> {
      const { tableName } = config

      // Create table operations for this specific table
      const operations = createTableOperations(executor, tableName)

      // Create base repository
      const baseRepo = createBaseRepository<DB, DB[TableName], Entity>(
        operations,
        config as RepositoryConfig<DB[TableName], Entity>,
        executor
      )

      // Extend with additional properties and methods
      const repository: Repository<Entity, DB> = {
        ...baseRepo,
        executor,
        tableName,

        withTransaction(trx: Transaction<DB>): Repository<Entity, DB> {
          const factory = createRepositoryFactory(trx)
          return factory.create(config)
        }
      }

      return repository
    }
  }
}

/**
 * Simple repository without factory (for plugins)
 */
export function createSimpleRepository<DB, TableName extends keyof DB & string, Entity>(
  executor: Kysely<DB>,
  tableName: TableName,
  mapRow: (row: Selectable<DB[TableName]>) => Entity
): Repository<Entity, DB> {
  const factory = createRepositoryFactory(executor)

  return factory.create({
    tableName,
    mapRow,
    schemas: {
      create: { parse: (v: unknown) => v } as z.ZodType,
      update: { parse: (v: unknown) => v } as z.ZodType
    },
    validateDbResults: false
  })
}